# PR23 / PR24 阿里云迁移交接索引

本文是 `medical-credit-assessment` 从 Supabase 兼容链路迁移到阿里云国内生产链路的交接入口。给 IT 或后续开发接手时，优先从本文开始，不需要先翻完整 README。

## 一、当前状态

| 项目 | 状态 |
| --- | --- |
| PR22 国内入口 | 已有临时 IP 入口，可用于 H5 预览 |
| PR23 RDS / OSS 代码 | 已具备发布包和迁移脚本 |
| PR23 真实部署 | 未完成，等待真实宝塔入口或 SSH |
| PR24 去 Supabase | 只能在 PR23 `aliyun` 模式线上验收后开始 |
| 风控评分规则 | 本迁移阶段不得修改 |
| 阿里云现有项目 | 不得改动、覆盖、删除 |

当前最大阻塞：

```text
缺少可用的服务器入口。需要 IT 提供真实宝塔安全入口或独立 SSH。
```

## 二、文档阅读顺序

### 1. 入口解锁

先看：

- `docs/aliyun-pr23-access-unlock-request.md`
- `ops/aliyun/bt-entry-readonly.sh.example`

目的：

- 找回真实宝塔入口。
- 或提供独立 SSH。
- 不要求开发侧修改服务器。

### 2. 只读盘点

入口可用后看：

- `docs/aliyun-pr23-server-inventory-checklist.md`
- `ops/aliyun/server-inventory-readonly.sh.example`

目的：

- 确认现有业务目录、Nginx、端口、服务不会被影响。
- 生成脱敏盘点报告。
- 盘点闸门不通过时暂停部署。

### 3. PR23 灰度切换

盘点通过后看：

- `docs/pr23-aliyun-cutover-runbook.md`
- `docs/aliyun-pr23-it-handoff.md`
- `docs/pr23-deployment-acceptance.md`

目的：

- 创建 / 使用独立 RDS 和 OSS。
- 先 `dual_write`，再 `aliyun`。
- 完成 RDS / OSS / 附件 / 智谱核验 / 微信 smoke。
- 异常时回滚到 `proxy`，不删除数据。

### 4. PR24 去 Supabase

PR23 `aliyun` 线上验收后看：

- `docs/pr24-supabase-decommission-audit.md`
- `scripts/audit-supabase-dependencies.mjs`
- `scripts/supabase-decommission-readiness.mjs`

目的：

- 找出生产路径中的 Supabase 依赖。
- 用 `SUPABASE_AUDIT_EXPECT=no-production npm run audit:supabase` 作为 PR24 Ready 闸门。
- 用 `SUPABASE_DECOMMISSION_PHASE=final ... npm run decommission:supabase:gate` 判断 Supabase 是否可控下线。
- 删除生产路径依赖前，先确认迁移备份和回滚策略。

### 5. 生产运维

PR24 完成前后看：

- `docs/pr24-aliyun-production-ops-runbook.md`

目的：

- 建立 RDS / OSS 备份与恢复演练。
- 建立日志、告警、发布、回滚和密钥轮换流程。
- 形成可交付的内部生产工具。

## 三、关键命令索引

### 本地验证

```bash
npm test
npm run release:aliyun
npm run audit:supabase
```

### 服务器只读入口

```bash
/etc/init.d/bt default
bt default
bash ops/aliyun/bt-entry-readonly.sh.example
```

### 服务器只读盘点

```bash
bash ops/aliyun/server-inventory-readonly.sh.example > /tmp/medical-credit-inventory.txt
INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format
INVENTORY_REPORT_FILE=release/inventory/<report>.json npm run inventory:aliyun:gate
```

### PR23 迁移

```bash
npm run db:migrate:aliyun
npm run backup:supabase
npm run storage:migrate:supabase-to-oss
npm run db:migrate:supabase-to-aliyun
npm run migration:verify:aliyun
```

### PR23 线上验收

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

### PR24 闸门

```bash
SUPABASE_DECOMMISSION_PHASE=preflight \
SUPABASE_DECOMMISSION_DIST_DIR=dist \
npm run decommission:supabase:gate

cd <release-package>/api
SUPABASE_DECOMMISSION_PHASE=preflight \
SUPABASE_DECOMMISSION_DIST_DIR=../h5 \
npm run decommission:supabase:gate

SUPABASE_AUDIT_EXPECT=no-production npm run audit:supabase

SUPABASE_DECOMMISSION_PHASE=final \
SUPABASE_DECOMMISSION_ENV_FILE=/www/wwwroot/medical-credit-api/.env \
SUPABASE_DECOMMISSION_DIST_DIR=/www/wwwroot/medical-credit-assessment/current \
SUPABASE_DECOMMISSION_OUTPUT_FILE=/var/www/medical-credit-api/reports/pr24-supabase-decommission-final.json \
SUPABASE_DECOMMISSION_MARKDOWN_FILE=/var/www/medical-credit-api/reports/pr24-supabase-decommission-final.md \
npm run decommission:supabase:gate
```

## 四、严禁事项

- 不改 `src/riskEngine.js` 风控评分、红线、封顶、特批规则。
- 不批量删除任何服务器文件、目录、OSS 对象或数据库表。
- 不覆盖现有业务项目目录。
- 不把 RDS 密码、OSS AccessKey、智谱 Key、Supabase service role 放进 H5 静态目录。
- 不把密钥贴到 PR、聊天、截图或 README。
- 不在 PR23 未完成前删除 Supabase 回滚链路。
- 不在没有备份和 smoke 的情况下切 `aliyun` 或执行 PR24 去 Supabase。

## 五、交付完成判定

PR23 完成需要：

- 阿里云服务器只读盘点通过。
- RDS migration 成功。
- Supabase 迁移前备份完成。
- RDS / OSS 回填和校验通过。
- `dual_write` 和 `aliyun` health / API flow smoke 通过。
- 手机微信不开 VPN 可完整使用。
- 回滚方式已记录。

PR24 完成需要：

- `decommission:supabase:gate` final 阶段通过或已形成明确人工复核记录。
- final gate JSON / Markdown 报告已随 release、RDS 备份和 OSS 验收记录归档。
- 生产路径 Supabase 依赖清零。
- 发布包不再携带 Supabase 运行依赖。
- 关闭 Supabase Function 后核心链路可用。
- RDS / OSS 备份和恢复演练记录完成。
- 生产运维交接清单完成。
