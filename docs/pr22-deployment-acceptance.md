# PR22 部署验收清单

用于记录阿里云 API 中转上线验收结果。PR22 不迁数据库、不迁附件、不改风控评分规则。

## 部署信息

| 项目 | 记录 |
| --- | --- |
| 部署日期 |  |
| 执行人 |  |
| 访问域名 / IP |  |
| 发布包名称 |  |
| 发布包 SHA256 |  |
| H5 目录 | `/var/www/medical-credit/current` |
| API 目录 | `/var/www/medical-credit-api/current` |
| API 端口 | `127.0.0.1:8787` |
| Nginx 配置 |  |
| systemd 服务 | `medical-credit-api` |

## 环境变量确认

服务端 `.env` 只能放在 API 目录，不能复制进 H5 静态目录。

| 变量 | 是否已配置 | 备注 |
| --- | --- | --- |
| `MEDICAL_CREDIT_ALLOWED_ORIGINS` |  | 必须包含正式域名 |
| `ASSESSMENT_UPSTREAM_URL` |  | 暂时指向 Supabase Function |
| `ASSESSMENT_UPSTREAM_API_KEY` |  | 服务端保存，不进前端 |
| `MEDICAL_CREDIT_PROXY_TIMEOUT_MS` |  | 默认 15000 |

## 命令验收

```bash
bash ops/aliyun/preflight-release.sh.example
curl -i https://credit.xxx.com/api/health
SMOKE_BASE_URL=https://credit.xxx.com npm run smoke:aliyun
SMOKE_BASE_URL=https://credit.xxx.com SMOKE_FULL_FLOW=true npm run smoke:aliyun
QR_URL=https://credit.xxx.com/?v=pr22 npm run qr:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| 服务器预检通过 |  |  |
| `/api/health` 返回 200 |  |  |
| H5 可打开 |  |  |
| 手机 390px 视口无横向滚动 |  |  |
| 控制台无明显错误 |  |  |
| 保存机构后触发 `/api/records` |  |  |
| 核验日志可展示 |  |  |
| 前端构建产物不含 Supabase key |  |  |
| 二维码可扫码打开 |  |  |

## 回滚记录

如果 PR22 中转异常，优先回滚到上一份已部署 release，不删除任何历史发布包。

```bash
RELEASE_NAME=<previous-release-name> sudo -E bash ops/aliyun/rollback-release.sh.example
```

| 回滚项 | 记录 |
| --- | --- |
| 回滚发布时间 |  |
| 回滚 release |  |
| 回滚执行人 |  |
| 回滚后 `/api/health` |  |
| 回滚后 H5 |  |
