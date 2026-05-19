# 远端持久化适配器契约

PR3 引入的是前端数据访问层到远端持久化的适配边界，不绑定具体数据库供应商。默认没有配置 `VITE_ASSESSMENT_API_URL` 时，系统仍使用 `localStorage`。

## 环境变量

```bash
VITE_ASSESSMENT_API_URL=https://your-api.example.com
VITE_ASSESSMENT_API_KEY=optional-bearer-token
VITE_ASSESSMENT_API_TIMEOUT_MS=8000
```

## API 端点

远端服务需要实现以下 JSON API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/draft` | 读取最近草稿 |
| `PUT` | `/draft` | 保存最近草稿 |
| `DELETE` | `/draft` | 清空最近草稿 |
| `GET` | `/records` | 读取历史评估记录 |
| `POST` | `/records` | 保存评估记录 |
| `GET` | `/records/:id` | 读取单条评估记录 |

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
  "record": {}
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

如果配置 `VITE_ASSESSMENT_API_KEY`，前端会带上：

```http
Authorization: Bearer <token>
```

第一版适合接入轻量 API、Supabase Edge Function、Cloudflare Worker、Vercel Function 或自有后端。正式生产前需要补充用户身份、机构权限、审计日志和服务端规则校验。
