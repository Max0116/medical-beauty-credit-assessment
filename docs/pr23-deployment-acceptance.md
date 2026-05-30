# PR23 阿里云 RDS / OSS 迁移验收清单

用于记录 PR23 从 Supabase 中转模式迁移到阿里云 RDS / OSS 模式的验收结果。PR23 不改风控评分规则，不删除 Supabase 回滚链路。

## 一、部署信息

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
| API 运行时 | Docker / 宝塔 Node 项目 / systemd Node |
| RDS 类型 | PostgreSQL / MySQL |
| RDS 实例 / 库名 |  |
| OSS bucket |  |
| 初始运行模式 | `dual_write` |
| 目标运行模式 | `aliyun` |

## 二、环境变量确认

服务端 `.env` 只能放在 API 目录，不能复制进 H5 静态目录。

| 变量 | 是否已配置 | 备注 |
| --- | --- | --- |
| `MEDICAL_CREDIT_BACKEND_MODE` |  | 先 `dual_write`，后 `aliyun` |
| `MEDICAL_CREDIT_ALLOWED_ORIGINS` |  | 必须包含正式域名 |
| `ALIYUN_DB_DRIVER` |  | `postgres` 或 `mysql` |
| `ALIYUN_RDS_HOST` / `ALIYUN_MYSQL_HOST` |  | 按数据库类型二选一 |
| `ALIYUN_RDS_DATABASE` / `ALIYUN_MYSQL_DATABASE` |  | 独立库，禁止复用既有业务库 |
| `ALIYUN_RDS_USER` / `ALIYUN_MYSQL_USER` |  | 独立最小权限账号 |
| `ALIYUN_RDS_PASSWORD` / `ALIYUN_MYSQL_PASSWORD` |  | 不进入前端、不截图明文 |
| `ALIYUN_OSS_REGION` |  |  |
| `ALIYUN_OSS_BUCKET` |  | 私有 bucket |
| `ALIYUN_OSS_ACCESS_KEY_ID` |  | 最小权限 RAM |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` |  | 不进入前端、不截图明文 |
| `ZHIPUAI_API_KEY` |  | 服务端保存 |
| `ASSESSMENT_UPSTREAM_URL` |  | `dual_write` / `proxy` 回滚需要 |
| `ASSESSMENT_UPSTREAM_API_KEY` |  | 服务端保存 |
| `MEDICAL_CREDIT_RUNTIME` |  | `docker` 或 `node`，当前服务器推荐 `docker` |

完成 `.env` 后执行只读 preflight：

```bash
cd /var/www/medical-credit-api/current
ALIYUN_ENV_FILE=/www/wwwroot/medical-credit-api/.env ALIYUN_ENV_EXPECT_MODE=dual_write npm run env:aliyun:guard
ALIYUN_RESOURCE_ENV_FILE=/www/wwwroot/medical-credit-api/.env ALIYUN_RESOURCE_EXPECT_MODE=dual_write npm run resources:aliyun:check
bash ops/aliyun/preflight-release.sh.example
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `npm run env:aliyun:guard` 未输出 `blocked` |  |  |
| `.env` 位于 API 根目录，不在 H5 根目录 |  |  |
| preflight 未打印任何密钥明文 |  |  |
| `MEDICAL_CREDIT_BACKEND_MODE` 与预期一致 |  |  |
| `proxy` 模式已检查 Supabase 上游配置 |  |  |
| `dual_write` 模式已检查 RDS / OSS / 智谱 / Supabase 旁路配置 |  |  |
| `aliyun` 模式已检查 RDS / OSS / 智谱配置 |  |  |
| `npm run resources:aliyun:check` 未输出 `blocked` |  |  |
| 资源就绪报告未打印数据库密码、OSS AccessKey、智谱 Key 或 Supabase Key |  |  |
| 数据库为独立 medical-credit 库，未复用 `gohomesh` / `mediverseai` / `maxfuture` |  |  |
| OSS bucket 为私有 bucket，且仅供 evidence 附件使用 |  |  |
| 没有 blocking failure |  |  |

如使用 MySQL，先生成并复核 bootstrap SQL：

```bash
ALIYUN_MYSQL_BOOTSTRAP_DATABASE=medical_credit_assessment \
ALIYUN_MYSQL_BOOTSTRAP_USER=medical_credit_app \
ALIYUN_MYSQL_BOOTSTRAP_USER_HOST=<reviewed-mysql-user-host> \
ALIYUN_MYSQL_BOOTSTRAP_PASSWORD='<strong-password>' \
ALIYUN_MYSQL_BOOTSTRAP_OUTPUT_FILE=/tmp/medical-credit-mysql-bootstrap.sql \
npm run db:bootstrap:mysql
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `db:bootstrap:mysql` 生成 SQL 文件，未把真实密码打印到终端 |  |  |
| SQL 只创建 `medical_credit_assessment` 和 `medical_credit_app` |  |  |
| SQL 未引用 `gohomesh` / `mediverseai` / `maxfuture` |  |  |
| IT 已确认 MySQL user host 与 Docker/RDS 网络路径匹配 |  |  |

如使用 OSS 附件存储，先生成并复核 RAM 最小权限策略：

```bash
ALIYUN_OSS_BUCKET=medical-credit-verification-evidence \
ALIYUN_OSS_REGION=oss-cn-shanghai \
ALIYUN_OSS_POLICY_OUTPUT_FILE=/tmp/medical-credit-oss-policy.json \
ALIYUN_OSS_POLICY_MARKDOWN_FILE=/tmp/medical-credit-oss-policy.md \
npm run oss:policy:generate
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `oss:policy:generate` 生成 RAM Policy JSON 和 Markdown 交接文件 |  |  |
| RAM Policy 只允许 `medical-credit-verification-evidence/verification-evidence/*` 前缀 |  |  |
| RAM Policy 不包含 `oss:DeleteObject` 或 `oss:ListBuckets` |  |  |
| Bucket 权限保持私有，未开启公共读写 |  |  |
| OSS AccessKey 只写入 API `.env`，未进入 H5 目录或前端构建产物 |  |  |

PR23 切换前总闸门：

```bash
ALIYUN_CUTOVER_PHASE=dual_write \
ALIYUN_CUTOVER_INVENTORY_GATE_FILE=/tmp/medical-credit-inventory-gate.json \
ALIYUN_CUTOVER_NGINX_GATE_FILE=/tmp/medical-credit-nginx-gate.json \
ALIYUN_CUTOVER_ENV_GATE_FILE=/tmp/medical-credit-env-gate.json \
ALIYUN_CUTOVER_RESOURCE_FILE=/tmp/medical-credit-resource-readiness.json \
ALIYUN_CUTOVER_HEALTH_FILE=/tmp/medical-credit-health.json \
ALIYUN_CUTOVER_API_FLOW_FILE=/tmp/medical-credit-api-flow.json \
ALIYUN_CUTOVER_OUTPUT_FILE=/tmp/medical-credit-cutover-dual-write.json \
ALIYUN_CUTOVER_MARKDOWN_FILE=/tmp/medical-credit-cutover-dual-write.md \
npm run cutover:aliyun:gate
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `cutover:aliyun:gate` 未输出 `blocked` |  |  |
| 总闸门已读取 inventory / nginx / env / resource / health / api-flow 证据文件 |  |  |
| `aliyun` 最终切换前已额外读取 `migration:verify:aliyun` 证据文件 |  |  |

## 三、发布包检查

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| SHA256 校验通过 |  |  |
| 发布包包含完整 `api/aliyun-api/` |  |  |
| 发布包包含 RDS migration |  |  |
| 发布包包含只读服务器盘点脚本 |  | `ops/aliyun/server-inventory-readonly.sh.example` |
| 发布包包含只 staging 脚本 |  | `ops/aliyun/stage-release.sh.example` |
| 发布包包含只读盘点报告生成器 |  | `api/scripts/format-aliyun-inventory-report.mjs` |
| 发布包包含只读盘点闸门校验器 |  | `api/scripts/aliyun-inventory-gate.mjs` |
| 发布包包含只读盘点记录表 |  | `docs/aliyun-pr23-server-inventory-checklist.md` |
| 发布包包含 `backup:supabase` |  |  |
| 发布包包含 `db:bootstrap:mysql` |  |  |
| 发布包包含 `oss:policy:generate` |  |  |
| 发布包包含 `cutover:aliyun:gate` |  |  |
| 发布包包含 `db:migrate:supabase-to-aliyun` |  |  |
| 发布包包含 `storage:migrate:supabase-to-oss` |  |  |
| 发布包包含 `migration:verify:aliyun` |  |  |
| API 目录已执行生产依赖安装 |  |  |
| `npm run verify:dist:aliyun` 已确认 H5 只请求同源 `/api` |  |  |
| `npm run verify:dist:aliyun` 未发现 Supabase / 智谱 / 阿里云密钥标记进入 H5 |  |  |
| PR CI 已执行 `npm run release:aliyun` |  |  |

## 四、现有服务器只读盘点

部署前先执行：

```bash
cd /var/www/medical-credit-api/current
bash ops/aliyun/server-inventory-readonly.sh.example > /tmp/medical-credit-inventory.txt
INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format
INVENTORY_REPORT_FILE=release/inventory/<report>.json npm run inventory:aliyun:gate
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 盘点脚本未创建、删除、覆盖、重启任何资源 |  |  |
| 已记录现有 Web 根目录 |  |  |
| 已记录现有 Nginx vhost 摘要 |  |  |
| 已确认 `127.0.0.1:8787` 可用或已选择替代端口 |  |  |
| 已确认独立 H5 / API 目录不会覆盖现有项目 |  |  |
| 未打印 `.env` 明文或密钥 |  |  |
| 已生成脱敏 JSON / Markdown 盘点报告 |  |  |
| `inventory:aliyun:gate` 结果为 `go` 或已完成人工复核 |  |  |
| `docs/aliyun-pr23-server-inventory-checklist.md` 已填写 |  |  |

### 运行时路线确认

参考：[PR23 阿里云 Node API 运行时路线](./pr23-aliyun-node-runtime-options.md)。

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 已确认 API 运行时路线 |  | Docker / 宝塔 Node 项目 / systemd Node |
| Docker 路线已确认 `docker` daemon 可用 |  |  |
| Docker 路线已确认容器只绑定 `127.0.0.1:8787` |  |  |
| Docker 路线使用受限启动脚本或人工等效命令 |  | `ops/aliyun/docker-run-medical-credit-api.sh.example` |
| Docker + 本机 MySQL 路线未使用 `ALIYUN_MYSQL_HOST=127.0.0.1` / `localhost` |  | 推荐 RDS；本机 MySQL 使用 `host.docker.internal` 并由 IT 确认权限 |
| Node 路线已确认 Node 版本 >= 20 |  |  |
| API `.env` 位于 API 根目录而非 H5 根目录 |  |  |
| Nginx `/api/` 只代理到本项目独立端口 |  |  |

### 可选：只 staging 发布包

当前服务器若已有宝塔 HTML 项目，先只 staging，不切流量：

```bash
RELEASE_ARCHIVE=/tmp/medical-credit-assessment-aliyun-xxx.tar.gz \
RELEASE_SHA256=/tmp/medical-credit-assessment-aliyun-xxx.tar.gz.sha256 \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
API_ROOT=/www/wwwroot/medical-credit-api \
sudo -E bash ops/aliyun/stage-release.sh.example
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| staging 未切换 `current` |  |  |
| staging 未覆盖当前 H5 根目录文件 |  |  |
| staging 未修改 Nginx / systemd / PM2 |  |  |
| H5 release 已进入 `releases/` 版本目录 |  |  |
| API release 已进入独立 API 版本目录 |  |  |

如果只有宝塔 Web 终端、没有 SSH 上传通道，也可以使用源码 staging 脚本：

```bash
CONFIRM_SOURCE_STAGING=yes \
SOURCE_BRANCH=codex/pr23-aliyun-rds-oss \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
API_ROOT=/www/wwwroot/medical-credit-api \
WORK_ROOT=/www/wwwroot/medical-credit-deploy-work \
bash ops/aliyun/stage-from-github-source.sh.example
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 源码 staging 未切换 `current` |  |  |
| 源码 staging 未修改 Nginx / systemd / PM2 |  |  |
| Docker 内 `npm test` 通过 |  |  |
| Docker 内 `npm run build` 通过 |  |  |
| 发布包名称包含 commit 短 SHA |  |  |
| `MANIFEST.json` 记录 branch / commit |  |  |

### 入口归属确认

当前裸 IP 不能作为长期入口。若 `nginx -T` 出现相同 `server_name` 冲突，必须先确认独立域名或 server_name，不能覆盖既有项目：

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 已确认正式入口不会复用被其他项目占用的裸 IP server_name |  |  |
| 已确认不会修改 `hear-us` 等既有业务 vhost |  |  |
| 已确认 `credit.xxx.com` 或等效备案子域名可用 |  |  |
| `npm run nginx:aliyun:generate` 已生成独立域名 vhost 草案 |  |  |
| `npm run nginx:aliyun:gate` 未输出 `blocked` |  |  |

## 五、迁移命令记录

### 1. RDS 建表

```bash
ALIYUN_DB_DRIVER=postgres npm run db:migrate:aliyun
# 或：ALIYUN_DB_DRIVER=mysql npm run db:migrate:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `assessment_records` 已创建 |  |  |
| `assessment_drafts` 已创建 |  |  |
| `verification_logs` 已创建 |  |  |
| `verification_reviews` 已创建 |  |  |

### 2. 迁移前备份

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run backup:supabase
```

| 项目 | 记录 |
| --- | --- |
| 备份目录 |  |
| `manifest.json` |  |
| `assessment_records.json` 行数 |  |
| `assessment_drafts.json` 行数 |  |
| `verification_logs.json` 行数 |  |
| `verification_reviews.json` 行数 |  |
| `evidence-attachments.json` 数量 |  |

### 3. Dry-run

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run storage:migrate:supabase-to-oss

SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run db:migrate:supabase-to-aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| 附件 dry-run 输出 `discovered` |  |  |
| 数据 dry-run 输出各表 `fetched` |  |  |
| dry-run 无报错 |  |  |

### 4. 正式回填

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run storage:migrate:supabase-to-oss

SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run db:migrate:supabase-to-aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| 附件上传成功数 |  |  |
| 附件失败数为 0 或已记录 |  |  |
| RDS 回填各表成功 |  |  |
| `SUPABASE_SERVICE_ROLE_KEY` 已从临时环境清理 |  |  |

### 5. 目标端验收

```bash
BACKUP_DIR=/path/to/backups/supabase-pre-aliyun-xxx \
VERIFY_OSS=true \
npm run migration:verify:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `migration:verify:aliyun` 输出 `ok: true` |  |  |
| RDS 行数至少覆盖备份 manifest |  |  |
| OSS 对象全部存在 |  |  |

## 六、运行模式验收

### dual_write 灰度

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=dual_write \
npm run health:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `/api/health` 返回 200 |  |  |
| `ready=true` |  |  |
| `mode=dual_write` |  |  |
| `backend.database=postgres` |  |  |
| `storage.configured=true` |  |  |
| `verification.configured=true` |  |  |

### aliyun 正式模式

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=aliyun \
npm run health:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `/api/health` 返回 200 |  |  |
| `ready=true` |  |  |
| `mode=aliyun` |  |  |

## 七、业务链路 Smoke

```bash
SMOKE_BASE_URL=https://credit.xxx.com \
SMOKE_EXPECT_API_READY=true \
SMOKE_EXPECT_BACKEND_MODE=aliyun \
npm run smoke:aliyun

API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=aliyun \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
npm run smoke:aliyun:api-flow

API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=aliyun \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
API_FLOW_UPLOAD_ATTACHMENT=true \
API_FLOW_VERIFY_SIGNED_URL=true \
npm run smoke:aliyun:api-flow

API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_RUN_ID=it-acceptance-001 \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=aliyun \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
API_FLOW_UPLOAD_ATTACHMENT=true \
API_FLOW_VERIFY_SIGNED_URL=true \
npm run smoke:aliyun:api-flow
```

测试数据定位方式：

- RDS 记录：`institution_name` 前缀 `PR23阿里云链路验收机构`，或 `id` 前缀 `api-flow-`。
- 表单快照：`form_snapshot.remarks` 包含 `PR23_API_FLOW_SMOKE` 和 `runId=<本次 runId>`。
- OSS 测试附件：文件名前缀 `pr23-api-flow-smoke-<runId>`，路径位于 `verification-evidence/<clientInstanceId>/<recordId>/...`。

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| H5 可打开 |  |  |
| 手机 390px 无横向滚动 |  |  |
| 控制台无明显错误 |  |  |
| 保存机构后 RDS 出现记录 |  |  |
| 保存机构后立即生成 `pending` 核验日志，不等待智谱首批结果 |  |  |
| 智谱完成后同一条日志更新为 `running` / `completed` / `failed` |  |  |
| 核验证据和原文链接可展示 |  |  |
| 人工确认后 `verification_reviews` 写入 |  |  |
| `API_FLOW_UPLOAD_ATTACHMENT=true` 已上传测试 PDF 到 OSS |  |  |
| `API_FLOW_VERIFY_SIGNED_URL=true` 已确认签名链接可打开 |  |  |
| RDS / OSS 可按 `PR23_API_FLOW_SMOKE` 和 `runId` 定位 smoke 测试数据 |  |  |
| 历史记录可展示最终等级 |  |  |

## 八、回滚记录

如果 PR23 异常，优先切回 `proxy` 模式，不删除 RDS / OSS / 备份。

```bash
MEDICAL_CREDIT_BACKEND_MODE=proxy
sudo systemctl restart medical-credit-api
```

如需回滚发布包：

```bash
RELEASE_NAME=<previous-release-name> \
sudo -E bash ops/aliyun/rollback-release.sh.example
```

| 回滚项 | 记录 |
| --- | --- |
| 是否发生回滚 |  |
| 回滚原因 |  |
| 回滚时间 |  |
| 回滚执行人 |  |
| 回滚后 `/api/health` |  |
| 回滚后 H5 smoke |  |
