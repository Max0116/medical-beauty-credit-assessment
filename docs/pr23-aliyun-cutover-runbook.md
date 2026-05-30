# PR23 阿里云 RDS / OSS 灰度切换 Runbook

本文用于拿到真实宝塔入口或 SSH 后，按最小风险完成 PR23 从 Supabase 兼容链路到阿里云 RDS / OSS 链路的灰度切换。所有步骤默认不改变风控评分规则，不删除 Supabase 历史数据，不覆盖阿里云现有业务项目。

## 一、切换原则

- 只使用独立目录：`/var/www/medical-credit` / `/var/www/medical-credit-api`，或宝塔现有独立站点目录 `/www/wwwroot/medical-credit-assessment` 与独立 API 目录 `/www/wwwroot/medical-credit-api`。
- 只新增独立 Nginx vhost / location；不改已有业务站点配置。
- 先只读盘点，再 preflight，再部署，再 `dual_write`，最后才切 `aliyun`。
- 任一阻断项出现时，暂停切换并回滚到 `proxy`。
- 所有密钥只放 API 目录 `.env` 或受控 secret，不进入 H5 静态目录、Git、截图或聊天记录。

## 二、前置条件

| 条件 | 要求 |
| --- | --- |
| 服务器入口 | 真实宝塔入口或独立 SSH 可登录 |
| RDS | 独立库、最小权限账号、允许 ECS 内网访问 |
| OSS | 私有 bucket、RAM 最小权限、支持签名 URL |
| 智谱 | `ZHIPUAI_API_KEY` 可在服务器端访问 |
| API 运行时 | 推荐 Docker 独立容器；备选 Node LTS / 宝塔 Node 项目 |
| 域名 / HTTPS | 已备案域名优先；IP 只能作为临时测试 |
| 回滚链路 | `MEDICAL_CREDIT_BACKEND_MODE=proxy` 仍可访问 Supabase 上游 |

## 三、阶段 0：只读解锁与盘点

如果宝塔安全入口失效，先让 IT 在 ECS 控制台远程终端执行：

```bash
/etc/init.d/bt default
bt default
```

若发布包已经在服务器上，也可以执行只读辅助脚本：

```bash
bash ops/aliyun/bt-entry-readonly.sh.example
```

拿到入口后，第一步仍然只做盘点：

```bash
cd /var/www/medical-credit-api/current
bash ops/aliyun/server-inventory-readonly.sh.example > /tmp/medical-credit-inventory.txt
INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format
INVENTORY_REPORT_FILE=release/inventory/<report>.json npm run inventory:aliyun:gate
```

停止条件：

- `inventory:aliyun:gate` 输出 `blocked`。
- 目标目录已经被现有业务占用且未确认归属。
- 目标端口 `127.0.0.1:8787` 被现有服务占用且不能选择替代端口。
- 发现需要修改已有业务 Nginx 配置才能上线。

## 四、阶段 1：发布包校验

在本地或服务器校验发布包：

```bash
sha256sum medical-credit-assessment-aliyun-<commit>-<timestamp>.tar.gz
tar -tzf medical-credit-assessment-aliyun-<commit>-<timestamp>.tar.gz | grep MANIFEST.json
```

发布包必须包含：

- `h5/`
- `api/aliyun-api/`
- `api/aliyun-api/migrations/001_init_postgres.sql`
- `ops/aliyun/preflight-release.sh.example`
- `ops/aliyun/stage-release.sh.example`
- `ops/aliyun/rollback-release.sh.example`
- `docs/pr23-deployment-acceptance.md`
- `docs/pr23-aliyun-cutover-runbook.md`

如果当前服务器已经有宝塔 HTML 项目，先只 staging：

```bash
RELEASE_ARCHIVE=/tmp/medical-credit-assessment-aliyun-<commit>-<timestamp>.tar.gz \
RELEASE_SHA256=/tmp/medical-credit-assessment-aliyun-<commit>-<timestamp>.tar.gz.sha256 \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
API_ROOT=/www/wwwroot/medical-credit-api \
sudo -E bash ops/aliyun/stage-release.sh.example
```

`stage-release` 不切 `current`、不覆盖当前站点根目录、不改 Nginx、不重启服务。只有完成 preflight 和 IT 复核后，才显式执行 `ln -sfn` 切换 `current` 并 reload 独立服务。

如果只有宝塔 Web 终端、没有可靠的本地上传通道，可以使用源码 staging 脚本。它会在服务器独立工作目录拉取 PR 分支，在 Docker 内执行 `npm ci`、`npm test`、`npm run build`、`npm run release:aliyun`，再调用 `stage-release`；同样不切流量、不改 Nginx、不重启：

```bash
CONFIRM_SOURCE_STAGING=yes \
SOURCE_BRANCH=codex/pr23-aliyun-rds-oss \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
API_ROOT=/www/wwwroot/medical-credit-api \
WORK_ROOT=/www/wwwroot/medical-credit-deploy-work \
bash ops/aliyun/stage-from-github-source.sh.example
```

注意：Docker 镜像内可能没有 `git`，发布包脚本会优先使用 `MEDICAL_CREDIT_RELEASE_COMMIT` / `MEDICAL_CREDIT_RELEASE_BRANCH`，确保 release 名称和 `MANIFEST.json` 仍能追溯到源分支与 commit。

### 入口归属闸门

在把任何公网入口指向 medical-credit 前，先检查 Nginx `server_name` 是否与既有项目冲突。尤其不要复用已经被 `hear-us` 等项目占用的裸 IP：

如果 IT 已确认独立备案子域名，可以先生成一份待复核的 vhost 配置。生成器只输出文件，不会安装或 reload Nginx；默认拒绝裸 IP、外部 API upstream 和非 medical-credit 根目录：

```bash
NGINX_SERVER_NAME=credit.xxx.com \
NGINX_MODE=https \
NGINX_SSL_CERTIFICATE=/www/server/panel/vhost/cert/credit.xxx.com/fullchain.pem \
NGINX_SSL_CERTIFICATE_KEY=/www/server/panel/vhost/cert/credit.xxx.com/privkey.pem \
NGINX_OUTPUT_FILE=/tmp/medical-credit-credit.xxx.com.conf \
npm run nginx:aliyun:generate
```

生成后由 IT 复核，再放入独立 vhost 文件。随后执行：

```bash
nginx -T > /tmp/medical-credit-nginxT.txt 2>/tmp/medical-credit-nginxT.err
NGINX_DUMP_FILE=/tmp/medical-credit-nginxT.txt \
NGINX_TARGET_SERVER_NAMES=credit.xxx.com \
npm run nginx:aliyun:gate
```

如果输出 `blocked`，暂停切换；先让 IT 提供独立备案子域名或新的无冲突 `server_name`。不要直接修改已有 `hear-us` vhost。

## 五、阶段 2：API 环境预检

在 API 目录创建 `.env`，先使用 `dual_write`。当前服务器宿主机未检测到 `node` / `npm`，但 Docker 已安装并 active；运行时路线优先参考 [PR23 阿里云 Node API 运行时路线](./pr23-aliyun-node-runtime-options.md)。

可先生成服务端 `.env` 模板，生成器只输出占位符，不包含真实密钥：

```bash
ALIYUN_ENV_TEMPLATE_MODE=dual_write \
ALIYUN_ENV_TEMPLATE_DRIVER=postgres \
ALIYUN_ENV_TEMPLATE_ALLOWED_ORIGIN=https://credit.xxx.com \
ALIYUN_ENV_TEMPLATE_OUTPUT_FILE=/tmp/medical-credit-api.env.template \
npm run env:aliyun:template
```

```bash
MEDICAL_CREDIT_BACKEND_MODE=dual_write
MEDICAL_CREDIT_RUNTIME=docker
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.xxx.com,http://101.132.137.25
ALIYUN_DB_DRIVER=postgres
ALIYUN_RDS_HOST=<rds-host>
ALIYUN_RDS_PORT=5432
ALIYUN_RDS_DATABASE=<database>
ALIYUN_RDS_USER=<user>
ALIYUN_RDS_PASSWORD=<password>
ALIYUN_OSS_REGION=<region>
ALIYUN_OSS_BUCKET=<private-bucket>
ALIYUN_OSS_ACCESS_KEY_ID=<ram-access-key-id>
ALIYUN_OSS_ACCESS_KEY_SECRET=<ram-access-key-secret>
ZHIPUAI_API_KEY=<zhipu-key>
ASSESSMENT_UPSTREAM_URL=<supabase-function-url>
ASSESSMENT_UPSTREAM_API_KEY=<supabase-function-key>
```

若 IT 只能先提供 MySQL 兼容 RDS / 独立 MySQL 库，将 `ALIYUN_DB_DRIVER` 改为 `mysql`，并使用 `ALIYUN_MYSQL_HOST`、`ALIYUN_MYSQL_PORT`、`ALIYUN_MYSQL_DATABASE`、`ALIYUN_MYSQL_USER`、`ALIYUN_MYSQL_PASSWORD`。禁止复用 `gohomesh`、`mediverseai`、`maxfuture` 等既有业务库。

创建 `.env` 后，先运行服务端环境闸门；它只输出缺失项和脱敏结论，不打印密钥值：

```bash
ALIYUN_ENV_FILE=/www/wwwroot/medical-credit-api/.env \
ALIYUN_ENV_EXPECT_MODE=dual_write \
API_ROOT=/www/wwwroot/medical-credit-api \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
npm run env:aliyun:guard
```

再运行资源就绪检查，确认阿里云数据库 / OSS / 智谱 / Supabase 回滚上游是否都已经具备切换条件。该报告只输出 key 名、资源类型和脱敏摘要，不打印数据库密码、AccessKey 或智谱 Key：

```bash
ALIYUN_RESOURCE_ENV_FILE=/www/wwwroot/medical-credit-api/.env \
ALIYUN_RESOURCE_EXPECT_MODE=dual_write \
ALIYUN_RESOURCE_MARKDOWN_FILE=/tmp/medical-credit-resource-readiness.md \
npm run resources:aliyun:check
```

当前服务器已确认存在 MySQL 8.0.36，PgSQL 未安装；若 IT 决定先走 MySQL，请使用 `ALIYUN_DB_DRIVER=mysql` 和独立库 `medical_credit_assessment`。严禁复用 `gohomesh`、`mediverseai`、`maxfuture` 等既有业务库。

执行只读预检：

```bash
bash ops/aliyun/preflight-release.sh.example
```

若选择 Docker 路线，staging 和 `.env` 确认后可用受限脚本启动 API 容器：

```bash
API_ROOT=/www/wwwroot/medical-credit-api \
bash /www/wwwroot/medical-credit-api/ops/aliyun/docker-run-medical-credit-api.sh.example
```

停止条件：

- `dual_write` 所需 RDS / OSS / 智谱 / Supabase 旁路配置缺失。
- `resources:aliyun:check` 输出 `blocked`。
- preflight 输出任何密钥明文。
- `.env` 被放进 H5 目录。

## 六、阶段 3：RDS 建表与旧数据备份

建表：

```bash
cd /var/www/medical-credit-api/current
npm install --omit=dev --package-lock=false
ALIYUN_DB_DRIVER=postgres npm run db:migrate:aliyun
# 或：ALIYUN_DB_DRIVER=mysql npm run db:migrate:aliyun
```

迁移前备份 Supabase：

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run backup:supabase
```

停止条件：

- RDS migration 失败。
- 备份 manifest 缺失。
- 备份目录被写入 H5 静态根目录。

## 七、阶段 4：dry-run 回填

先跑附件 dry-run：

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run storage:migrate:supabase-to-oss
```

再跑数据 dry-run：

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run db:migrate:supabase-to-aliyun
```

停止条件：

- dry-run 无法读取四张业务表。
- 附件清单无法解析。
- 出现未脱敏密钥输出。

## 八、阶段 5：正式回填与校验

正式附件回填：

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run storage:migrate:supabase-to-oss
```

正式数据回填：

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run db:migrate:supabase-to-aliyun
```

校验：

```bash
BACKUP_DIR=/path/to/backups/supabase-pre-aliyun-xxx \
VERIFY_OSS=true \
npm run migration:verify:aliyun
```

停止条件：

- `migration:verify:aliyun` 未输出 `ok: true`。
- RDS 行数低于备份 manifest。
- OSS 对象缺失且未记录人工豁免原因。

## 九、阶段 6：dual_write 灰度

启动或重启独立 API 服务后检查：

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=dual_write \
npm run health:aliyun
```

API flow smoke：

```bash
API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_RUN_ID=pr23-dual-write-001 \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=dual_write \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
API_FLOW_UPLOAD_ATTACHMENT=true \
API_FLOW_VERIFY_SIGNED_URL=true \
npm run smoke:aliyun:api-flow
```

人工验收：

- 保存机构后，核验日志立即可见。
- 证据附件上传到 OSS，签名链接可打开。
- 历史记录显示最新最终等级。
- 微信扫码无横向滚动、无明显控制台错误。

## 十、阶段 7：切换 aliyun 模式

只有 `dual_write` 验收通过后，才把 `.env` 调整为：

```bash
MEDICAL_CREDIT_BACKEND_MODE=aliyun
```

再执行：

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=aliyun \
npm run health:aliyun

API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_RUN_ID=pr23-aliyun-001 \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=aliyun \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
API_FLOW_UPLOAD_ATTACHMENT=true \
API_FLOW_VERIFY_SIGNED_URL=true \
npm run smoke:aliyun:api-flow
```

## 十一、回滚

如果出现 API 错误率升高、保存失败、核验日志不可见、附件无法打开，先回滚运行模式：

```bash
MEDICAL_CREDIT_BACKEND_MODE=proxy
```

然后执行：

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=proxy \
npm run health:aliyun
```

回滚不删除：

- RDS 数据库
- OSS bucket
- Supabase 历史数据
- 迁移备份目录

## 十二、PR23 完成判定

PR23 只有在以下证据齐全后才能标记 Ready：

- PR CI 通过。
- 阿里云发布包 SHA256 已记录。
- 服务器只读盘点通过或完成 IT 人工复核。
- RDS migration 成功。
- Supabase 备份完成。
- RDS / OSS 回填 dry-run 和正式回填完成。
- `migration:verify:aliyun` 通过。
- `dual_write` health 和 API flow smoke 通过。
- `aliyun` health 和 API flow smoke 通过。
- 微信扫码不开 VPN 完整走通保存、核验、人工确认、附件、历史记录。
- 回滚到 `proxy` 的方式已验证或至少完成命令级演练。
