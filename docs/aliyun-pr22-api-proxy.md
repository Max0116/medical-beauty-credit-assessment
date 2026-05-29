# PR22：阿里云 API 中转与国内访问链路

## 目标

PR22 先解决国内微信访问链路中的“前端直连 Supabase”问题：

- H5 前端部署在阿里云国内入口。
- 前端只请求同域 `https://credit.xxx.com/api`。
- 阿里云 Node API 中转到现有 Supabase Edge Function。
- Supabase、智谱、后续数据库密钥全部留在服务端环境变量里。
- 不迁数据库、不迁附件、不改变风控评分规则。

## 新增组件

```text
aliyun-api/server.js       # Node API 入口
aliyun-api/proxyServer.js  # /api 到 Supabase Function 的中转逻辑
```

中转服务支持：

| 对外路径 | 上游路径 |
| --- | --- |
| `GET /api/health` | 本地健康检查，不访问上游 |
| `/api/draft` | `/draft` |
| `/api/records` | `/records` |
| `/api/records/:id` | `/records/:id` |
| `/api/records/:id/verification` | `/records/:id/verification` |
| `/api/records/:id/verification-reviews` | `/records/:id/verification-reviews` |
| `/api/records/:id/verification-attachments` | `/records/:id/verification-attachments` |
| `/api/assessments/*` | 同上，兼容未来更显式的 API 前缀 |

## 前端构建变量

国内部署推荐：

```bash
VITE_ASSESSMENT_API_URL=/api
VITE_ASSESSMENT_API_KEY=
VITE_ASSESSMENT_API_TIMEOUT_MS=8000
VITE_DEEP_VERIFICATION_HIGH_LIMIT=50000
```

这样前端构建产物里不会包含 Supabase publishable key。旧的 `VITE_SUPABASE_PUBLISHABLE_KEY` 只保留给 GitHub Pages / 本地直连 Supabase 回滚链路。

## 阿里云 API 环境变量

这些变量只配置在 ECS / 宝塔 Node 项目 / systemd / PM2 环境中，不能进入前端：

```bash
MEDICAL_CREDIT_PROXY_HOST=127.0.0.1
MEDICAL_CREDIT_PROXY_PORT=8787
MEDICAL_CREDIT_PROXY_TIMEOUT_MS=15000
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.xxx.com,http://101.132.137.25
ASSESSMENT_UPSTREAM_URL=https://<project-ref>.supabase.co/functions/v1/assessments
ASSESSMENT_UPSTREAM_API_KEY=sb_publishable_xxx
```

`ASSESSMENT_UPSTREAM_API_KEY` 当前仍使用 Supabase Function 允许的 publishable / anon key。它放在阿里云服务端，不放进 H5 构建产物。

`MEDICAL_CREDIT_ALLOWED_ORIGINS` 必须显式配置。未配置时，带 `Origin` 的浏览器请求会被拒绝，避免中转服务意外成为开放代理；不带 `Origin` 的服务器健康检查仍可访问。

## ECS + Nginx 部署建议

在不影响现有项目的前提下，只新增独立目录和独立 Nginx location：

```text
/var/www/medical-credit              # H5 dist 静态文件
/var/www/medical-credit-api          # Node API 中转代码
/etc/systemd/system/medical-credit-api.service
```

仓库内提供了可交给 IT 的模板：

```text
ops/aliyun/nginx-medical-credit.conf.example
ops/aliyun/medical-credit-api.service.example
ops/aliyun/medical-credit-api.env.example
```

Nginx 关键配置：

```nginx
server {
  server_name credit.xxx.com;

  root /var/www/medical-credit;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:8787/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

systemd 关键配置：

```ini
[Unit]
Description=medical-credit-assessment Aliyun API proxy
After=network.target

[Service]
WorkingDirectory=/var/www/medical-credit-api
ExecStart=/usr/bin/node aliyun-api/server.js
Restart=always
RestartSec=3
EnvironmentFile=/var/www/medical-credit-api/.env

[Install]
WantedBy=multi-user.target
```

## 验收

PR22 必须验证：

- `npm test`
- `npm run build`
- `npm run verify:dist`
- `GET /api/health` 返回 200。
- 前端构建产物不包含 `supabase.co/functions/v1/assessments`。
- 前端构建产物不包含 `sb_publishable`。
- 手机微信访问国内域名无横向滚动。
- 保存机构后能通过 `/api/records` 触发远端核验。
- 核验日志能在 UI 中展示。

## 回滚

PR22 不删除 Supabase，也不迁移数据。若阿里云 API 出现问题，可以：

1. 将前端构建变量切回：

```bash
VITE_ASSESSMENT_API_URL=https://<project-ref>.supabase.co/functions/v1/assessments
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

2. 重新 `npm run build` 并部署静态文件。
3. 停止 `medical-credit-api` Node 服务，不影响旧 Supabase Function。

## 下一阶段

PR23 再迁移数据和附件：

- Supabase Postgres → 阿里云 RDS
- Supabase Storage → 阿里云 OSS
- Node API 从 proxy 模式切为真实持久化模式
