# Supabase 远端持久化适配器契约

PR3 引入的是前端数据访问层到 Supabase 远端持久化的适配边界。默认没有配置 `VITE_ASSESSMENT_API_URL` 时，系统仍使用 `localStorage`。

推荐落地方式是 **H5 前端 → Supabase Edge Function → Supabase Postgres**。不要让 H5 直接写表，也不要在浏览器中暴露 `service_role` / secret key。

## 环境变量

```bash
VITE_ASSESSMENT_API_URL=https://<project-ref>.functions.supabase.co/assessments
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_ASSESSMENT_API_TIMEOUT_MS=8000
```

`VITE_SUPABASE_PUBLISHABLE_KEY` 只能是 Supabase publishable key 或 legacy anon key。`service_role` / secret key 只能放在 Supabase Edge Function secrets 中。

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
