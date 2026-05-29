# PR22 阿里云临时上线记录

## 上线范围

- 日期：2026-05-30
- 入口：`http://101.132.137.25`
- 部署目录：`/www/wwwroot/medical-credit-assessment`
- Nginx 配置：`/www/server/panel/vhost/nginx/html_101.132.137.25.conf`
- 配置备份：`/www/server/panel/vhost/nginx/html_101.132.137.25.conf.bak-pr22-20260530003409`

## 本次部署内容

- 将当前 H5 构建为国内同源 API 模式：`VITE_ASSESSMENT_API_URL=/api`。
- 覆盖当前独立站点的 `index.html`、`assets/index-BHkfKaDP.css`、`assets/index-DqFM0JaN.js`。
- 在当前独立站点 Nginx 配置中新增 `/api/health` 和 `/api/*` 同源中转。
- 服务端 Nginx 注入 Supabase publishable key，前端构建产物不包含 Supabase Function URL 或 key。

## 未做事项

- 未迁移数据库。
- 未迁移附件。
- 未新增或修改阿里云账号内其他业务站点。
- 未改风控评分、红线、封顶或特批规则。
- 暂未配置备案域名与 HTTPS；当前入口仍是 IP + HTTP，适合临时验收。

## 验收结果

```bash
npm test
# 10 files passed, 59 tests passed

npm run build:aliyun
# build succeeded

SMOKE_BASE_URL=http://101.132.137.25 SMOKE_EXPECT_API=true npm run smoke:aliyun
# /api/health 200
# 390px mobile viewport no horizontal scroll
# no console errors

SMOKE_BASE_URL=http://101.132.137.25 SMOKE_EXPECT_API=true SMOKE_FULL_FLOW=true npm run smoke:aliyun
# /api/records 201
# /api/draft 200
# /api/records/:id/verification 200
# /api/records/:id/verification-reviews 200
# no console errors
```

## 回滚方式

1. 用备份文件恢复当前站点 Nginx 配置：
   `/www/server/panel/vhost/nginx/html_101.132.137.25.conf.bak-pr22-20260530003409`
2. Reload Nginx。
3. 如需回滚前端，恢复上一版 `index.html` 或重新部署旧构建产物。

## 后续建议

- 尽快绑定已备案域名，例如 `credit.xxx.com`，并配置 HTTPS。
- PR23 迁移数据库到阿里云 RDS、附件到 OSS。
- PR24 移除 Supabase 依赖，形成正式国内生产架构。
