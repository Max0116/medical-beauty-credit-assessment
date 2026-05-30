# PR24 去 Supabase 前置审计

本文记录 PR24 要移除的 Supabase 依赖、不能提前移除的回滚能力，以及进入正式去 Supabase 前必须具备的证据。当前审计基于 PR23 分支现状；PR24 只有在 PR23 阿里云 RDS / OSS 模式完成线上验收后才应开始执行。

PR24 开始前可先运行：

```bash
npm run audit:supabase
```

也可以先运行 PR24 去 Supabase readiness gate。`preflight` 会检查浏览器构建产物和前端/生产路径的 Supabase 残留，但允许 PR23 期间仍保留回滚所需的 Supabase 迁移/上游线索：

```bash
npm run build:aliyun
SUPABASE_DECOMMISSION_PHASE=preflight \
SUPABASE_DECOMMISSION_DIST_DIR=dist \
npm run decommission:supabase:gate
```

注意：在 PR23 阶段运行该命令可能返回 `blocked`，这通常表示前端仍保留 Supabase 直连或回退逻辑。该结果不是部署失败，而是 PR24 的待清理证据；只有进入 PR24 Ready / final 前才要求阻断项清零。

如果要先验证阿里云 release 包内的 gate 是否能运行，可在解包后的 `api` 目录执行：

```bash
SUPABASE_DECOMMISSION_PHASE=preflight \
SUPABASE_DECOMMISSION_DIST_DIR=../h5 \
npm run decommission:supabase:gate
```

该命令用于确认发布包自带脚本、依赖脚本和 H5 构建产物路径完整；PR23 阶段返回 `manual_review` 属于预期，因为 `proxy` / `dual_write` 回滚链路仍会保留 Supabase 上游引用。

当 PR24 准备标记 Ready 时，应运行阻断模式：

```bash
SUPABASE_AUDIT_EXPECT=no-production npm run audit:supabase
```

阻断模式要求生产路径里不再包含 Supabase 依赖；迁移脚本、历史文档和归档源码可以按下文策略保留。

最终下线 Supabase 前必须运行 `final` gate：

```bash
SUPABASE_DECOMMISSION_PHASE=final \
SUPABASE_DECOMMISSION_ENV_FILE=/www/wwwroot/medical-credit-api/.env \
SUPABASE_DECOMMISSION_DIST_DIR=/www/wwwroot/medical-credit-assessment/current \
SUPABASE_DECOMMISSION_OUTPUT_FILE=/var/www/medical-credit-api/reports/pr24-supabase-decommission-final.json \
SUPABASE_DECOMMISSION_MARKDOWN_FILE=/var/www/medical-credit-api/reports/pr24-supabase-decommission-final.md \
npm run decommission:supabase:gate
```

`final` gate 要求 API 已处于 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`，服务端 `.env` 不再包含 `ASSESSMENT_UPSTREAM_*` 或 Supabase service role，且前端构建产物不含 Supabase URL / key。

`final` gate 的 JSON / Markdown 输出必须和当次 release 名称、SHA256、RDS 备份 ID、OSS 验收记录一起归档。若 gate 返回 `manual_review`，只能在人工复核确认剩余 Supabase 引用均为历史文档 / 迁移归档后继续；若返回 `blocked`，不得关闭 Supabase 或删除回滚链路。

## 一、PR24 进入条件

PR24 不能在以下条件缺失时启动：

- `MEDICAL_CREDIT_BACKEND_MODE=aliyun` 已在线上运行并通过 smoke。
- 前端只请求同域 `/api`，构建产物不含 Supabase URL / key。
- RDS 已保存草稿、评估记录、核验日志、人工确认记录。
- OSS 私有 bucket 已保存证据截图 / PDF，签名链接可打开。
- 智谱核验由阿里云 API 执行，核验日志写入 RDS。
- Supabase 迁移前备份目录、RDS / OSS 回填记录、验收报告均已归档。
- 已验证 `proxy` 回滚路径，且业务确认可以进入去 Supabase 阶段。

## 二、当前 Supabase 依赖分组

| 分组 | 当前位置 | PR24 处理方式 |
| --- | --- | --- |
| 浏览器旧回滚变量 | `.env.example`、`.github/workflows/deploy-pages.yml`、`src/assessmentRepository.js` | 删除 `VITE_SUPABASE_PUBLISHABLE_KEY` 回退逻辑；前端只保留 `/api` 或自有 API key |
| 阿里云 proxy / dual_write | `aliyun-api/proxyServer.js`、`aliyun-api/upstreamRepository.js`、`aliyun-api/apiServer.js`、`ops/aliyun/preflight-release.sh.example` | 在 PR24 后期移除 `proxy` / `dual_write` 或改为只读归档说明 |
| 迁移脚本 | `scripts/backup-supabase.mjs`、`scripts/migrate-supabase-to-aliyun-rds.mjs`、`scripts/migrate-supabase-evidence-to-aliyun-oss.mjs` 及 helper | 迁移验收归档后移出运行发布包；源码可保留到 `archive/` 或文档引用 |
| Supabase Edge Function | `supabase/functions/assessments/` | 归档为旧链路，不再部署；确认阿里云 API 覆盖同等契约 |
| Supabase migration | `supabase/migrations/` | 归档为旧链路 schema 来源，不再作为生产迁移入口 |
| 文档旧描述 | README、PR22/PR23 文档、`docs/remote-persistence-contract.md`、`docs/ai-verification-plan.md` | 更新为阿里云生产架构，旧 Supabase 仅作为历史迁移说明 |
| 发布包清单 | `scripts/build-aliyun-release.mjs`、`scripts/aliyun-release-manifest.mjs` | PR24 发布包不再携带 Supabase 迁移脚本和上游 proxy 配置 |
| CI / 扫描 | `scripts/verify-dist-no-secrets.mjs`、相关测试 | 继续保留“禁止 Supabase 进入浏览器产物”的扫描规则 |

## 三、不能提前删除的内容

在 PR23 未完成前，不得删除：

- `ASSESSMENT_UPSTREAM_URL` / `ASSESSMENT_UPSTREAM_API_KEY`，因为 `proxy` 和 `dual_write` 仍依赖它们回滚。
- Supabase 迁移脚本，因为还需要备份、dry-run、正式回填和验收。
- `supabase/functions/assessments/`，因为线上旧链路仍可能作为回滚参考。
- Supabase 相关文档中的迁移命令，因为 PR23 验收还需要审计证据。

## 四、PR24 建议拆分

### PR24-A：生产配置收敛

- 默认只支持 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`。
- `.env.example` 和 `ops/aliyun/medical-credit-api.env.example` 移除 Supabase 上游配置。
- preflight 不再要求 Supabase 旁路配置。
- README 改成阿里云 RDS / OSS / 智谱 API 的正式生产说明。

### PR24-B：代码依赖下线

- 移除前端 `VITE_SUPABASE_PUBLISHABLE_KEY` 回退逻辑。
- 移除或隔离 `proxyServer`、`upstreamRepository`、`dual_write` 分支。
- 发布包不再包含 Supabase 迁移脚本。
- 保留浏览器产物扫描，继续阻止 Supabase URL / key 进入 H5。

### PR24-C：历史链路归档

- 将 Supabase Edge Function、migration、迁移脚本和 PR22/PR23 回滚说明归档为历史资料。
- 增加生产运维文档：备份、恢复、日志、告警、故障处理、发布回滚。详见 `docs/pr24-aliyun-production-ops-runbook.md`。
- 更新最终交付说明：国内访问链路、数据位置、密钥位置、运维负责人。

## 五、PR24 验收清单

| 验收项 | 证据 |
| --- | --- |
| 前端构建产物不含 Supabase URL / key | `npm run verify:dist:aliyun` |
| 前端源码不再读取 `VITE_SUPABASE_PUBLISHABLE_KEY` | `rg VITE_SUPABASE_PUBLISHABLE_KEY src .env.example .github` 无生产引用 |
| PR24 readiness gate 通过 | `SUPABASE_DECOMMISSION_PHASE=final ... npm run decommission:supabase:gate` |
| 生产路径不再包含 Supabase 依赖 | `SUPABASE_AUDIT_EXPECT=no-production npm run audit:supabase` |
| 阿里云 API 不再需要 `ASSESSMENT_UPSTREAM_*` | preflight 和 `.env` 示例无该变量 |
| 发布包不包含 Supabase 迁移脚本 | `tar -tzf <release>.tar.gz | rg supabase` 仅允许历史文档或归档文件 |
| 关闭 Supabase Function 后核心链路可用 | 保存、核验、人工确认、附件、历史记录 smoke |
| RDS / OSS 备份策略已记录 | `docs/pr24-aliyun-production-ops-runbook.md` |
| 回滚策略已更新 | 回滚到上一份阿里云 release，而不是回滚到 Supabase |
| 微信扫码不开 VPN 可完整使用 | 手机 smoke 记录和二维码 |

## 六、PR24 后保留策略

PR24 不应立即删除历史备份和旧 Supabase 项目。建议：

1. 生产切 `aliyun` 后保留 Supabase 只读状态至少一个完整业务周期。
2. 保留 PR23 迁移备份、RDS 验收报告、OSS 验收报告。
3. 确认无回滚需求后，再由业务负责人决定是否关闭 Supabase 付费资源。
4. 关闭前导出最终快照，并记录关闭日期、执行人和恢复路径。
