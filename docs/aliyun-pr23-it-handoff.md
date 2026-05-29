# PR23 阿里云 RDS / OSS 迁移 IT 交接单

本文用于把 `medical-credit-assessment` 从 PR22 的 Supabase 中转模式推进到 PR23 的阿里云 RDS / OSS 模式。PR23 不改风控评分规则，不改前端 API 契约，不删除 Supabase 旧链路。

如只需要先向 IT 要宝塔真实入口或独立 SSH 账号，可直接转发短版请求：[PR23 阿里云部署入口解锁请求](./aliyun-pr23-access-unlock-request.md)。

## 一、部署边界

必须遵守：

- 不改动公司现有业务项目目录。
- 不覆盖现有 Nginx 站点配置。
- 不删除历史发布包、备份目录或 Supabase 数据。
- 不把 Supabase service role、智谱 Key、RDS 密码、OSS AccessKey 放进 H5 静态目录。
- 优先使用独立目录、独立 Node 服务、独立 RDS 库、独立 OSS bucket。
- PR23 先用 `dual_write` 灰度，验收通过后再切 `aliyun`。

推荐独立资源：

| 用途 | 推荐值 |
| --- | --- |
| H5 静态目录 | `/var/www/medical-credit` |
| Node API 目录 | `/var/www/medical-credit-api` |
| 临时解包目录 | `/var/www/medical-credit-deploy-work` |
| RDS 库名 | `medical_credit` |
| RDS 账号 | `medical_credit_app` |
| OSS bucket | `medical-credit-verification-evidence` |
| systemd 服务 | `medical-credit-api` |

## 二、IT 需要提供

| 项目 | 说明 |
| --- | --- |
| 已备案域名 | 例如 `credit.xxx.com` |
| HTTPS 证书 | 阿里云证书或宝塔证书路径 |
| RDS PostgreSQL | 主机、端口、库名、账号、密码、SSL 要求 |
| OSS bucket | region、bucket 名、私有读写权限 |
| RAM 权限 | 仅允许指定 OSS bucket 上传/读取/签名 |
| 智谱 Key | 仅配置在服务器 `.env`，不进入前端 |
| Supabase 迁移 Key | 仅用于一次性备份/回填 shell，会后清理 |
| 出网能力 | 服务器可访问 Supabase、OSS、智谱 API |

## 三、当前入口解锁请求

如开发侧只能看到宝塔“安全入口校验失败”，或 SSH 连接在认证前被服务器关闭，请 IT 先完成以下最小动作之一：

```bash
# 在服务器上查看当前宝塔真实入口。不要关闭安全入口。
/etc/init.d/bt default
```

或提供一个独立 SSH 登录方式：

```text
服务器 IP：
SSH 端口：
用户名：
认证方式：密码 / 私钥
sudo 权限：可执行只读盘点、创建 /var/www/medical-credit* 独立目录、创建 medical-credit-api 独立服务
允许范围：仅 medical-credit-assessment 独立目录、独立 Nginx 配置、独立 systemd 服务
禁止范围：不得修改、移动、删除现有业务项目目录或已有 Nginx server 配置
```

开发侧拿到入口后，第一步只执行只读盘点，不部署、不重启、不 reload、不写入现有项目。

## 四、部署包

开发侧生成：

```bash
npm run release:aliyun
```

PR23 发布包应包含：

- `h5/`
- `api/aliyun-api/`
- `api/aliyun-api/migrations/001_init_postgres.sql`
- `api/scripts/format-aliyun-inventory-report.mjs`
- `api/scripts/aliyun-inventory-gate.mjs`
- `api/scripts/backup-supabase.mjs`
- `api/scripts/migrate-supabase-to-aliyun-rds.mjs`
- `api/scripts/migrate-supabase-evidence-to-aliyun-oss.mjs`
- `api/scripts/verify-aliyun-migration.mjs`
- `ops/aliyun/`
- `ops/aliyun/server-inventory-readonly.sh.example`
- `ops/aliyun/preflight-release.sh.example`
- `docs/aliyun-pr23-server-inventory-checklist.md`
- `docs/pr23-deployment-acceptance.md`

## 五、现有服务器只读盘点

在已有业务项目的服务器上部署前，先做只读盘点。该脚本用于看清楚当前服务器的 Web 根目录、Nginx vhost、监听端口、Node/runtime、systemd/PM2 线索和目标目录是否已存在；它不会创建、删除、覆盖、重启或 reload，也不会打印 `.env` 明文、密码、AccessKey、API Key 或证书内容。

```bash
cd /var/www/medical-credit-api/current
bash ops/aliyun/server-inventory-readonly.sh.example > /tmp/medical-credit-inventory.txt
INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format
INVENTORY_REPORT_FILE=release/inventory/<report>.json npm run inventory:aliyun:gate
```

如果还没有部署包目录，也可以从发布包解压目录直接执行同一个脚本。盘点输出建议交给 IT 确认以下事项：

- `medical-credit-assessment` 是否可以使用独立 H5 目录。
- `medical-credit-api` 是否可以使用独立 Node API 目录。
- `127.0.0.1:8787` 是否可作为本项目独立 API 端口。
- 新增 Nginx server 或 location 是否会覆盖已有站点。
- 是否已有 `medical-credit-api.service` 或 PM2 同名服务需要避让。

盘点结果记录到：

```text
docs/aliyun-pr23-server-inventory-checklist.md
```

格式化命令会在 `release/inventory/` 下生成脱敏 JSON 和 Markdown 报告，用于填入验收单；不要把原始日志中的敏感字段复制到聊天、PR 或截图中。

闸门判断输出：

- `go`：可以继续创建 `.env` 并执行 PR23 preflight。
- `manual_review`：先让 IT 确认提示项，再继续。
- `blocked`：暂停部署，先处理阻断项；命令会返回非 0。

## 六、上线前配置预检

部署前先运行只读 preflight。它只检查服务器能力、独立目录、端口、出网、Nginx、Node 版本和 `.env` 中 PR23 模式所需变量，不创建、不删除、不重启，也不会打印密钥明文。

```bash
cd /var/www/medical-credit-api/current
bash ops/aliyun/preflight-release.sh.example
```

检查逻辑会根据 `MEDICAL_CREDIT_BACKEND_MODE` 分流：

- `proxy`：必须有 Supabase 上游 URL / Key，作为 PR22 回滚链路。
- `dual_write`：必须同时具备 RDS、OSS、智谱和 Supabase 旁路写入配置。
- `aliyun`：必须具备 RDS、OSS、智谱配置；Supabase 仅作为可选回滚配置。

如 `SUPABASE_SERVICE_ROLE_KEY` 出现在持久 `.env` 中，preflight 会给出 warning。该 key 只应在一次性备份 / 迁移 shell 中临时使用。

## 七、服务器部署顺序

```bash
RELEASE_ARCHIVE=/tmp/medical-credit-assessment-aliyun-xxx.tar.gz \
RELEASE_SHA256=/tmp/medical-credit-assessment-aliyun-xxx.tar.gz.sha256 \
sudo -E bash ops/aliyun/deploy-release.sh.example

cd /var/www/medical-credit-api/current
npm install --omit=dev --package-lock=false
```

创建或更新 API 环境变量：

```bash
sudo cp /var/www/medical-credit-api/ops/aliyun/medical-credit-api.env.example \
  /var/www/medical-credit-api/.env
sudo vi /var/www/medical-credit-api/.env
```

PR23 推荐先配置：

```bash
MEDICAL_CREDIT_BACKEND_MODE=dual_write
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.xxx.com
ALIYUN_RDS_HOST=<rds-host>
ALIYUN_RDS_PORT=5432
ALIYUN_RDS_DATABASE=medical_credit
ALIYUN_RDS_USER=medical_credit_app
ALIYUN_RDS_PASSWORD=<password>
ALIYUN_RDS_SSL=true
ALIYUN_OSS_REGION=oss-cn-shanghai
ALIYUN_OSS_BUCKET=medical-credit-verification-evidence
ALIYUN_OSS_ACCESS_KEY_ID=<ram-access-key-id>
ALIYUN_OSS_ACCESS_KEY_SECRET=<ram-access-key-secret>
ZHIPUAI_API_KEY=<zhipu-key>
ASSESSMENT_UPSTREAM_URL=https://<project-ref>.supabase.co/functions/v1/assessments
ASSESSMENT_UPSTREAM_API_KEY=<server-side-key>
```

配置完成后再次执行：

```bash
bash ops/aliyun/preflight-release.sh.example
```

只有 preflight 没有 blocking failure 后，再启动服务和执行迁移。

## 八、迁移顺序

```bash
# 1. RDS 建表
npm run db:migrate:aliyun

# 2. 迁移前备份
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run backup:supabase

# 3. 附件 dry-run
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run storage:migrate:supabase-to-oss

# 4. 数据 dry-run
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run db:migrate:supabase-to-aliyun

# 5. 正式附件回填
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run storage:migrate:supabase-to-oss

# 6. 正式数据回填
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run db:migrate:supabase-to-aliyun

# 7. 目标端验收
BACKUP_DIR=/path/to/backups/supabase-pre-aliyun-xxx \
VERIFY_OSS=true \
npm run migration:verify:aliyun
```

迁移完成后，从 shell 历史、临时文件、CI 日志中清理 `SUPABASE_SERVICE_ROLE_KEY`。

## 九、服务重启与健康检查

```bash
sudo systemctl daemon-reload
sudo systemctl restart medical-credit-api
sudo nginx -t
sudo systemctl reload nginx

HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=dual_write \
npm run health:aliyun

API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_RUN_ID=it-acceptance-001 \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=dual_write \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
npm run smoke:aliyun:api-flow

API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=dual_write \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
API_FLOW_UPLOAD_ATTACHMENT=true \
API_FLOW_VERIFY_SIGNED_URL=true \
npm run smoke:aliyun:api-flow
```

`API_FLOW_RUN_ID` 可按验收批次改名。脚本输出 `smoke.marker=PR23_API_FLOW_SMOKE`；RDS 可按 `institution_name` 前缀 `PR23阿里云链路验收机构`、记录 ID 前缀 `api-flow-`、`form_snapshot.remarks` 中的 marker 查找测试记录，OSS 可按 `pr23-api-flow-smoke-<runId>` 查找测试 PDF。

`/api/health` 应显示：

- `ready: true`
- `mode: dual_write`
- `backend.database: postgres`
- `storage.configured: true`
- `verification.configured: true`

## 十、灰度与切换

先保持：

```bash
MEDICAL_CREDIT_BACKEND_MODE=dual_write
```

业务 smoke 通过后再改为：

```bash
MEDICAL_CREDIT_BACKEND_MODE=aliyun
```

切换后重启服务，并再次执行：

```bash
HEALTH_BASE_URL=https://credit.xxx.com HEALTH_EXPECT_READY=true HEALTH_EXPECT_BACKEND_MODE=aliyun npm run health:aliyun
SMOKE_BASE_URL=https://credit.xxx.com SMOKE_EXPECT_API_READY=true SMOKE_EXPECT_BACKEND_MODE=aliyun npm run smoke:aliyun
API_FLOW_BASE_URL=https://credit.xxx.com API_FLOW_EXPECT_API_READY=true API_FLOW_EXPECT_BACKEND_MODE=aliyun API_FLOW_EXPECT_BACKEND_DATABASE=postgres API_FLOW_EXPECT_STORAGE_CONFIGURED=true API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true npm run smoke:aliyun:api-flow
API_FLOW_BASE_URL=https://credit.xxx.com API_FLOW_RUN_ID=it-acceptance-aliyun-001 API_FLOW_EXPECT_API_READY=true API_FLOW_EXPECT_BACKEND_MODE=aliyun API_FLOW_EXPECT_BACKEND_DATABASE=postgres API_FLOW_EXPECT_STORAGE_CONFIGURED=true API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true API_FLOW_UPLOAD_ATTACHMENT=true API_FLOW_VERIFY_SIGNED_URL=true npm run smoke:aliyun:api-flow
```

## 十一、回滚

优先回滚模式，不删除 RDS / OSS / 备份：

```bash
MEDICAL_CREDIT_BACKEND_MODE=proxy
sudo systemctl restart medical-credit-api
```

如需回滚发布包，只切换 `current` 软链接：

```bash
RELEASE_NAME=<previous-release-name> \
sudo -E bash ops/aliyun/rollback-release.sh.example
```

回滚后验证：

```bash
curl -i https://credit.xxx.com/api/health
SMOKE_BASE_URL=https://credit.xxx.com npm run smoke:aliyun
```
