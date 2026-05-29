# PR23：阿里云 RDS / OSS 数据与附件迁移计划

PR23 目标是把 PR22 中转层后面的 Supabase Postgres / Supabase Storage 替换为阿里云 RDS / OSS，形成国内数据闭环。PR23 不改风控评分规则、不改 `src/riskEngine.js`、不改前端业务流程，只替换持久化与附件后端。

## 一、范围边界

本 PR 做：

- 阿里云 Node API 从 proxy 模式扩展为 RDS / OSS 模式。
- 建立 RDS 表结构，覆盖草稿、评估记录、核验日志、人工确认日志。
- 建立 OSS 私有 bucket，覆盖证据截图和 PDF 附件。
- 保持前端 API 契约不变：H5 仍只请求同域 `/api`。
- 保留 Supabase proxy 作为回滚模式。

本 PR 不做：

- 不改正式评分、红线、封顶、特批规则。
- 不新增登录权限系统。
- 不接新的工商 API。
- 不删除 Supabase 历史数据。
- 不让前端直连 RDS、OSS、智谱或任何云厂商密钥。

## 二、目标链路

```text
微信 / 浏览器
  -> https://credit.xxx.com
  -> H5
  -> https://credit.xxx.com/api
  -> 阿里云 Node API
  -> 阿里云 RDS
  -> 阿里云 OSS 私有 bucket
  -> 智谱 Web Search API
```

PR23 完成后，前端仍保持：

```bash
VITE_ASSESSMENT_API_URL=/api
VITE_ASSESSMENT_API_KEY=
```

## 三、运行模式

Node API 建议支持三种模式，方便灰度和回滚：

| 模式 | 环境变量 | 行为 |
| --- | --- | --- |
| `proxy` | `MEDICAL_CREDIT_BACKEND_MODE=proxy` | 沿用 PR22，转发到 Supabase Function |
| `aliyun` | `MEDICAL_CREDIT_BACKEND_MODE=aliyun` | 读写 RDS / OSS，智谱在 Node API 内执行 |
| `dual_write` | `MEDICAL_CREDIT_BACKEND_MODE=dual_write` | 主写阿里云，旁路写 Supabase，用于短期比对 |

上线建议：

1. 先 `proxy` 部署 PR22，确认国内入口稳定。
2. 再 `dual_write` 小流量验证 RDS / OSS 写入。
3. 验收后切 `aliyun`。
4. 保留 `proxy` 回滚配置，直到 PR24 去 Supabase。

### 当前实现状态

- `proxy`：沿用 PR22，可继续作为回滚模式。
- `aliyun`：已新增 Node API handler、RDS repository、OSS evidence storage、Postgres migration、智谱 Web Search 核验服务和 AI 线索摘要兜底。
- `dual_write`：已新增灰度 repository。读走 RDS；草稿、评估记录、人工确认写入以 RDS 为准，并最佳努力旁路写 Supabase。旁路失败只记录 warning，不影响阿里云主链路。

当前可用命令：

```bash
npm run db:migrate:aliyun
```

该命令读取 `aliyun-api/migrations/001_init_postgres.sql` 并对 `ALIYUN_RDS_*` 指向的 PostgreSQL 数据库建表。执行前必须由 IT 提供独立 RDS 库和最小权限账号。

智谱核验已迁入 Node API：

- 先跑快速初筛关键词：行政处罚、被执行人、失信被执行人、非法行医。
- 再跑剩余完整关键词，用 `Promise.allSettled` 保留部分成功结果。
- 每条原始结果保留标题、来源、摘要、链接、风险标签和相关性判断。
- AI 摘要失败时使用规则摘要兜底。
- 搜索结果仍只作为线索；人工确认后才写入正式风控字段。

`dual_write` 当前边界：

- 主链路：RDS / OSS / Node 智谱核验。
- 旁路：Supabase Function 仅用于草稿、评估记录、人工确认等兼容写入。
- 不旁路写核验日志，因为 PR23 的核验日志应以阿里云 RDS 为准，避免两套后台核验任务重复跑。

## 四、RDS 表结构

推荐优先使用阿里云 RDS PostgreSQL，原因是当前 Supabase 已是 Postgres，JSONB、timestamptz、索引和迁移成本最低。若 IT 只能提供 MySQL，需要单独做字段类型映射。

### assessment_records

```sql
create table if not exists assessment_records (
  id text primary key,
  client_instance_id text not null,
  institution_name text not null,
  final_grade text not null,
  final_decision text not null,
  total_score integer not null,
  max_term_days integer not null,
  suggested_limit numeric(14, 2) not null default 0,
  stable_monthly_average numeric(14, 2) not null default 0,
  needs_approval boolean not null default false,
  redline_reasons jsonb not null default '[]'::jsonb,
  cap_reasons jsonb not null default '[]'::jsonb,
  approval_reasons jsonb not null default '[]'::jsonb,
  form_snapshot jsonb not null,
  result_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessment_records_client_created_idx
  on assessment_records (client_instance_id, created_at desc);
```

### assessment_drafts

```sql
create table if not exists assessment_drafts (
  client_instance_id text primary key,
  form_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### verification_logs

```sql
create table if not exists verification_logs (
  id uuid primary key,
  assessment_record_id text references assessment_records(id) on delete cascade,
  client_instance_id text not null,
  provider text not null default 'zhipu_web_search',
  status text not null default 'pending',
  query_keywords jsonb not null default '[]'::jsonb,
  raw_results jsonb not null default '[]'::jsonb,
  extracted_flags jsonb not null default '{}'::jsonb,
  risk_tags jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verification_logs_status_check
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped'))
);

create index if not exists verification_logs_record_created_idx
  on verification_logs (assessment_record_id, created_at desc);

create index if not exists verification_logs_client_created_idx
  on verification_logs (client_instance_id, created_at desc);
```

### verification_reviews

```sql
create table if not exists verification_reviews (
  id uuid primary key,
  assessment_record_id text references assessment_records(id) on delete cascade,
  verification_log_id uuid references verification_logs(id) on delete set null,
  client_instance_id text not null,
  action text not null,
  reviewer_name text not null,
  reviewer_decision text not null,
  previous_public_credit_status text,
  suggested_public_credit_status text,
  evidence_url text,
  evidence_note text,
  verification_snapshot jsonb not null default '{}'::jsonb,
  applied_fields jsonb not null default '{}'::jsonb,
  evidence_attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint verification_reviews_action_check
    check (action in ('accept_suggestion', 'manual_override', 'mark_reviewed')),
  constraint verification_reviews_decision_check
    check (reviewer_decision in ('normal', 'unknown', 'medium', 'serious'))
);

create index if not exists verification_reviews_record_created_idx
  on verification_reviews (assessment_record_id, created_at desc);
```

## 五、MySQL 兼容映射

若必须使用 RDS MySQL：

| Postgres | MySQL |
| --- | --- |
| `jsonb` | `json` |
| `timestamptz` | `datetime(3)` |
| `uuid` | `char(36)` |
| `numeric(14,2)` | `decimal(14,2)` |
| `default now()` | `default current_timestamp(3)` |

MySQL 模式下，JSON 字段查询能力比 Postgres 弱，PR23 先不做复杂 JSON 查询，只保存和按记录读取。

## 六、OSS 附件设计

Bucket：

```text
medical-credit-verification-evidence
```

要求：

- 私有 bucket。
- 不开启公共读。
- 前端不持有 OSS AccessKey。
- Node API 使用 RAM 角色或最小权限 AccessKey 上传。
- 单文件上限 10MB。
- 允许 MIME：
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/heic`
  - `application/pdf`

对象路径建议：

```text
verification-evidence/<clientInstanceId>/<recordId>/<yyyyMMdd>/<uuid>-<safeFileName>
```

API 返回短期签名 URL：

```json
{
  "attachment": {
    "id": "uuid",
    "bucket": "medical-credit-verification-evidence",
    "path": "verification-evidence/client/record/20260530/file.png",
    "fileName": "处罚截图.png",
    "mimeType": "image/png",
    "size": 12345,
    "uploadedAt": "2026-05-30T00:00:00.000Z",
    "signedUrl": "https://..."
  }
}
```

签名 URL 建议有效期：10 分钟到 30 分钟。

## 七、API 契约保持不变

PR23 继续实现 PR22 / 前端已有端点：

| 方法 | 路径 | PR23 行为 |
| --- | --- | --- |
| `GET` | `/api/health` | 返回 API、RDS、OSS 基础状态 |
| `GET` | `/api/draft` | 从 RDS 读取草稿 |
| `PUT` | `/api/draft` | upsert RDS 草稿 |
| `DELETE` | `/api/draft` | 删除 RDS 草稿 |
| `GET` | `/api/records` | 从 RDS 读取历史记录 |
| `POST` | `/api/records` | 写入 RDS 评估记录，并触发智谱核验 |
| `GET` | `/api/records/:id` | 从 RDS 读取单条记录 |
| `GET` | `/api/records/:id/verification` | 读取 RDS 核验日志 |
| `POST` | `/api/records/:id/verification` | 新建核验日志并异步跑智谱 |
| `GET` | `/api/records/:id/verification-reviews` | 读取人工确认日志 |
| `POST` | `/api/records/:id/verification-reviews` | 保存人工确认日志，并按现有规则更新记录快照 |
| `POST` | `/api/records/:id/verification-attachments` | 上传 OSS，返回附件 metadata 与签名 URL |

## 八、服务端环境变量

PR23 新增：

```bash
MEDICAL_CREDIT_BACKEND_MODE=aliyun

ALIYUN_RDS_DIALECT=postgres
ALIYUN_RDS_HOST=rm-xxx.pg.rds.aliyuncs.com
ALIYUN_RDS_PORT=5432
ALIYUN_RDS_DATABASE=medical_credit
ALIYUN_RDS_USER=medical_credit_app
ALIYUN_RDS_PASSWORD=***
ALIYUN_RDS_SSL=true

ALIYUN_OSS_REGION=oss-cn-shanghai
ALIYUN_OSS_BUCKET=medical-credit-verification-evidence
ALIYUN_OSS_ACCESS_KEY_ID=***
ALIYUN_OSS_ACCESS_KEY_SECRET=***
ALIYUN_OSS_SIGNED_URL_TTL_SECONDS=1800

ZHIPUAI_API_KEY=***
```

仍保留 PR22 回滚变量：

```bash
ASSESSMENT_UPSTREAM_URL=https://<project-ref>.supabase.co/functions/v1/assessments
ASSESSMENT_UPSTREAM_API_KEY=sb_publishable_xxx
```

## 九、数据迁移策略

PR23 可先不做一次性全量迁移，建议走更安全的灰度路径：

1. RDS 建表。
2. OSS 建私有 bucket。
3. API 支持 `dual_write`。
4. 新记录同时写 Supabase 和 RDS。
5. 抽查最近 10 条记录：
   - form/result 快照一致。
   - verification log 字段一致。
   - evidence attachment metadata 一致。
6. 小流量切 `aliyun`。
7. 观察 1-2 个工作日。
8. 再决定是否导入 Supabase 历史数据。

若需要导入历史数据：

- 从 Supabase 导出 `assessment_records`、`assessment_drafts`、`verification_logs`、`verification_reviews`。
- 先导入 RDS staging schema。
- 校验数量、主键、关键 JSON 字段。
- 再导入生产 schema。
- 附件从 Supabase Storage 下载后上传 OSS，并更新 `evidence_attachments` 里的 bucket/path。

## 十、回滚策略

任一验收失败，回滚方式：

1. 将 `.env` 切回：

```bash
MEDICAL_CREDIT_BACKEND_MODE=proxy
```

2. 重启 Node API。
3. H5 仍访问 `/api`，不需要重新部署前端。
4. RDS / OSS 保留，不删除，用于排查。
5. 若 H5 静态包也需要回滚，使用 PR22 的 `rollback-release.sh.example` 切换 `current`。

## 十一、PR23 验收清单

本地：

```bash
npm test
npm run build
npm run release:aliyun
```

服务器：

```bash
curl -i https://credit.xxx.com/api/health
```

业务链路：

- 新建机构并保存，RDS 出现 `assessment_records`。
- 草稿保存和恢复可用。
- 历史记录列表可用。
- 保存后自动生成 `verification_logs`。
- 核验完成后 UI 展示线索、摘要、原文链接。
- 人工采用建议后，`verification_reviews` 写入，记录快照更新。
- 上传截图 / PDF 到 OSS，签名链接可打开。
- 关闭 Supabase Function 后，`MEDICAL_CREDIT_BACKEND_MODE=aliyun` 仍可完成核心链路。
- 切回 `MEDICAL_CREDIT_BACKEND_MODE=proxy` 后可回滚。

## 十二、IT 需要提前确认

| 项目 | 推荐值 |
| --- | --- |
| RDS 类型 | PostgreSQL 15+ |
| RDS 网络 | 与 ECS 同 VPC 或白名单允许 ECS 内网 IP |
| RDS 库名 | `medical_credit` |
| RDS 账号 | `medical_credit_app`，仅授权本库 |
| OSS Bucket | `medical-credit-verification-evidence` |
| OSS 权限 | 私有读写 |
| RAM 权限 | 仅允许指定 bucket 的 put/get/sign，避免全局权限 |
| Node.js | 20+ |
| 域名 | 已备案 `credit.xxx.com` |
| HTTPS | 阿里云证书或宝塔证书 |
