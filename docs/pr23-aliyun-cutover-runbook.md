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

## 五、阶段 2：API 环境预检

在 API 目录创建 `.env`，先使用 `dual_write`：

```bash
MEDICAL_CREDIT_BACKEND_MODE=dual_write
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

执行只读预检：

```bash
bash ops/aliyun/preflight-release.sh.example
```

停止条件：

- `dual_write` 所需 RDS / OSS / 智谱 / Supabase 旁路配置缺失。
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
