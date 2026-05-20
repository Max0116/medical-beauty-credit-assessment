# Supabase 远端持久化适配器契约

PR3 引入的是前端数据访问层到 Supabase 远端持久化的适配边界。默认没有配置 `VITE_ASSESSMENT_API_URL` 时，系统仍使用 `localStorage`。

推荐落地方式是 **H5 前端 → Supabase Edge Function → Supabase Postgres**。不要让 H5 直接写表，也不要在浏览器中暴露 `service_role` / secret key。

## 环境变量

```bash
VITE_ASSESSMENT_API_URL=https://<project-ref>.supabase.co/functions/v1/assessments
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_ASSESSMENT_API_TIMEOUT_MS=8000
```

`VITE_SUPABASE_PUBLISHABLE_KEY` 只能是 Supabase publishable key 或 legacy anon key。`service_role` / secret key 只能放在 Supabase Edge Function secrets 中。

Edge Function 需要配置：

```bash
ALLOWED_ORIGINS=https://<github-user>.github.io,http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174
ASSESSMENT_PUBLISHABLE_KEYS={"default":"sb_publishable_xxx"}
ASSESSMENT_SERVICE_ROLE_KEY=service_role_jwt_xxx
ASSESSMENT_SECRET_KEYS={"default":"sb_secret_xxx"}
```

Supabase CLI 不允许自定义 secrets 使用 `SUPABASE_` 前缀，因此业务自定义 key 白名单使用 `ASSESSMENT_` 前缀。函数会优先使用 Edge Runtime 内置的 `SUPABASE_SERVICE_ROLE_KEY`；如果当前项目或运行环境没有内置该变量，可以用 `ASSESSMENT_SERVICE_ROLE_KEY` 显式配置 legacy service role JWT。`ASSESSMENT_SECRET_KEYS` 仅作为新版 server key 预留后备，不应暴露给 H5 前端。

## API 端点

Supabase Edge Function `assessments` 需要实现以下 JSON API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/draft` | 读取最近草稿 |
| `PUT` | `/draft` | 保存最近草稿 |
| `DELETE` | `/draft` | 清空最近草稿 |
| `GET` | `/records` | 读取历史评估记录 |
| `POST` | `/records` | 保存评估记录 |
| `GET` | `/records/:id` | 读取单条评估记录 |
| `GET` | `/records/:id/verification` | 读取后台联网核验日志 |
| `POST` | `/records/:id/verification` | 手动重新发起后台联网核验 |
| `GET` | `/records/:id/verification-reviews` | 读取核验人工确认日志 |
| `POST` | `/records/:id/verification-reviews` | 保存核验人工确认日志 |
| `POST` | `/records/:id/verification-attachments` | 上传核验证据截图 / PDF |

## 请求头

前端会发送：

```http
apikey: <VITE_SUPABASE_PUBLISHABLE_KEY>
x-client-instance-id: <browser-local-uuid>
content-type: application/json
```

当前阶段未接登录，`x-client-instance-id` 用于隔离同一浏览器的草稿和历史记录。接入 Supabase Auth 后，应改为基于 `auth.uid()` 做 RLS 和服务端权限校验。

## 请求格式

### 保存草稿

```json
{
  "form": {}
}
```

### 保存记录

```json
{
  "form": {},
  "result": {},
  "record": {},
  "clientInstanceId": "browser-local-uuid"
}
```

### 保存核验人工确认

```json
{
  "action": "accept_suggestion | manual_override | mark_reviewed",
  "reviewerName": "王经理",
  "reviewerDecision": "normal | unknown | medium | serious",
  "previousPublicCreditStatus": "unknown",
  "suggestedPublicCreditStatus": "normal",
  "verificationLogId": "uuid",
  "evidenceUrl": "screenshot://2026-05-20-001 或 https://...",
  "evidenceNote": "采用系统建议，已保留查询截图。",
  "evidenceAttachments": [
    {
      "id": "uuid",
      "bucket": "verification-evidence",
      "path": "client-id/record-id/file.png",
      "fileName": "处罚截图.png",
      "mimeType": "image/png",
      "size": 12345,
      "uploadedAt": "2026-05-20T00:00:00.000Z"
    }
  ],
  "verificationSnapshot": {},
  "appliedFields": {
    "publicCreditStatus": "normal"
  }
}
```

确认日志用于记录人工采用建议、人工改判或仅复核留痕。它可以记录业务人员主动采用的 `publicCreditStatus`，但不允许后端自动改写评分、红线或授信结论。

附件 metadata 会随确认日志写入 `verification_snapshot.evidenceAttachments`，因此即使远端数据库尚未应用 PR11 的结构化列 migration，线上 Function 也能保存和读取附件。`evidence_attachments` 列用于后续结构化查询和报表扩展。

### 上传核验证据附件

使用 `multipart/form-data`，字段名为 `file`。支持 `image/jpeg`、`image/png`、`image/webp`、`image/heic`、`application/pdf`，单个文件上限 10MB。

成功响应：

```json
{
  "attachment": {
    "id": "uuid",
    "bucket": "verification-evidence",
    "path": "client-id/record-id/file.png",
    "fileName": "处罚截图.png",
    "mimeType": "image/png",
    "size": 12345,
    "uploadedAt": "2026-05-20T00:00:00.000Z",
    "signedUrl": "https://..."
  }
}
```

附件上传由 Edge Function 使用 service role 写入私有 Storage bucket。H5 前端不得直接持有 `service_role`，也不直接开放 Storage 写权限。

`record` 是前端已规范化的记录快照，包含：

- `id`
- `institutionName`
- `finalGrade`
- `finalDecision`
- `totalScore`
- `maxTermDays`
- `suggestedLimit`
- `stableMonthlyAverage`
- `needsApproval`
- `redlineReasons`
- `capReasons`
- `approvalReasons`
- `createdAt`
- `updatedAt`
- `form`
- `result`

## 响应格式

远端可返回包裹对象，也可直接返回对象：

```json
{
  "form": {}
}
```

```json
{
  "records": []
}
```

```json
{
  "record": {}
}
```

```json
{
  "verificationLogs": [
    {
      "id": "uuid",
      "recordId": "record-id",
      "provider": "zhipu_web_search",
      "status": "pending | running | completed | failed | skipped",
      "queryKeywords": [],
      "riskTags": [],
      "rawResultCount": 0,
      "errorMessage": "",
      "verificationSummary": {
        "judgment": "clear | review_required | redline_suspected | pending | failed | skipped",
        "judgmentLabel": "未发现明显风险",
        "riskLevel": "low | medium | high | unknown",
        "conclusion": "已完成联网查询，未发现与该机构名称直接匹配的明显负面风险结果。",
        "recommendation": "可将公共信用状态暂按“正常”处理，但仍建议保留人工抽查记录。",
        "suggestedPublicCreditStatus": "normal | unknown | medium | serious",
        "sourceCount": 0,
        "matchedSourceCount": 0,
        "businessProfile": {
          "registryProvider": "official_registry",
          "registryStatus": "completed | empty | failed | unconfigured",
          "registryMessage": "官方企业信用接口已返回候选",
          "creditCodeCandidates": [
            {
              "value": "91330100MA2B123456",
              "source": "official_registry",
              "title": "机构名称",
              "url": "https://...",
              "name": "机构名称",
              "registrationStatus": "存续",
              "legalRepresentative": "张三",
              "registeredAddress": "注册地址",
              "businessScope": "经营范围"
            }
          ]
        },
        "riskTags": [],
        "evidenceInsight": {
          "overview": "AI 对联网线索的整体摘要，明确仅为线索不是结论。",
          "keyFindings": ["关键发现 1"],
          "riskQuestions": ["需要人工复核的问题 1"],
          "verificationFocus": ["下一步核验重点 1"],
          "sourceConfidence": "来源数量、类型和可信度提示。"
        },
        "evidenceSummaries": [
          {
            "category": "行政处罚",
            "title": "原始报道或公示标题",
            "source": "媒体或公示来源",
            "sourceHost": "example.com",
            "publishDate": "2026-05-19",
            "url": "https://...",
            "snippet": "搜索结果原始摘要，供人工复核前快速判断。",
            "riskSignal": "原文命中“行政处罚”相关表述"
          }
        ]
      },
      "createdAt": "2026-05-19T00:00:00.000Z"
    }
  ]
}
```

`POST /records/:id/verification` 会立即返回一条 `pending` 核验日志，并在后台复用该日志更新为 `completed`、`failed` 或 `skipped`：

```json
{
  "verificationLog": {
    "id": "uuid",
    "recordId": "record-id",
    "provider": "zhipu_web_search",
    "status": "pending",
    "queryKeywords": [],
    "riskTags": [],
    "rawResultCount": 0
  }
}
```

```json
{
  "verificationReviews": [
    {
      "id": "uuid",
      "recordId": "record-id",
      "verificationLogId": "uuid",
      "action": "accept_suggestion",
      "reviewerName": "王经理",
      "reviewerDecision": "normal",
      "previousPublicCreditStatus": "unknown",
      "suggestedPublicCreditStatus": "normal",
      "evidenceUrl": "screenshot://2026-05-20-001",
      "evidenceNote": "采用系统建议，截图已归档。",
      "evidenceAttachments": [
        {
          "id": "uuid",
          "bucket": "verification-evidence",
          "path": "client-id/record-id/file.png",
          "fileName": "处罚截图.png",
          "mimeType": "image/png",
          "size": 12345,
          "uploadedAt": "2026-05-20T00:00:00.000Z",
          "signedUrl": "https://..."
        }
      ],
      "verificationSnapshot": {},
      "appliedFields": {
        "publicCreditStatus": "normal"
      },
      "createdAt": "2026-05-20T00:00:00.000Z"
    }
  ]
}
```

`verificationSummary` 是给业务 UI 使用的结构化核验判断。后端必须避免把查询关键词本身当作风险命中；只有搜索结果标题或正文能匹配机构名称，并且结果正文出现风险语义时，才应生成 `riskTags` 和 `evidenceSummaries`。`evidenceInsight` 是 AI 基于已提取证据生成的线索摘要和复核问题，只能辅助人工阅读，不能替代原文核验。核验结论用于人工复核和公共信用字段建议，不在当前阶段自动改写风控评分或红线判断。

`businessProfile.creditCodeCandidates` 来自服务端官方 / 授权企业信用接口，只能作为“候选补全”。前端必须让业务人员点击采用，不能静默覆盖表单字段。未配置 `OFFICIAL_REGISTRY_API_URL` 时，`registryStatus` 为 `unconfigured`，不得再从智谱搜索摘要中猜测统一社会信用代码。

## 鉴权

第一版建议 Edge Function 使用 `--no-verify-jwt` 部署，并在函数内校验：

- `apikey` 是否匹配当前项目 publishable / anon key。
- `Origin` 是否来自允许的 H5 域名。
- `x-client-instance-id` 是否存在且格式合法。

接入 Supabase Auth 后再开启用户级鉴权：

- 前端通过 Supabase Auth 获取用户 session。
- `Authorization` 改为 `Bearer <user-jwt>`。
- 表内记录增加 `created_by uuid references auth.users(id)`。
- RLS 使用 `auth.uid()` 控制用户可读写范围。

## 建议表结构

```sql
create extension if not exists pgcrypto;

create table if not exists public.assessment_records (
  id uuid primary key default gen_random_uuid(),
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
  on public.assessment_records (client_instance_id, created_at desc);

alter table public.assessment_records enable row level security;
```

无登录阶段不建议直接把表暴露给 `anon` 写入。让 Edge Function 使用服务端 secret 写表，并在函数里限制 Origin、请求字段和频率。正式登录后再补：

```sql
alter table public.assessment_records
  add column if not exists created_by uuid references auth.users(id);
```

并按 `created_by = auth.uid()` 增加 RLS policy。

## PR4 建议

PR4 应增加：

- `supabase/functions/assessments/index.ts`
- `supabase/migrations/*_create_assessment_records.sql`
- Edge Function 单元或 smoke 测试脚本
- GitHub Actions 中 Supabase 函数部署所需的 secrets 说明
- `docs/ai-verification-plan.md`

正式生产前还需要补充用户身份、机构权限、审计日志、服务端规则校验和联网核验留痕。
