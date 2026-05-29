# 医美机构账期评估系统

一个面向内部业务风控场景的手机端 H5 工具，用于评估下游医美机构是否可以给予账期、最长账期、建议额度、是否需要特批，以及系统给出判断的原因。

当前版本是产品化基线版本：已具备可交互评估流程、核心风控规则、移动端 UI、通过数据访问层封装的本地/远端持久化入口；登录权限、审批流和管理端报表将按路线图分阶段接入。

## 产品目标

- 业务人员可用手机访问并填写机构评估。
- 系统按“红线 → 评分 → 等级 → 封顶 → 账期/额度 → 特批”的顺序实时给出判断。
- 输出最终等级、最长账期、建议额度、稳定月均销量、特批原因和风险标签。
- 为后续数据库保存、核验留痕、审批流程和管理端报表保留清晰边界。

## 当前能力

- 手机比例 H5 页面，适合微信扫码访问。
- 多步骤表单：基础、采购、履约、核验、结果。
- 顶部结果卡实时更新。
- 准入红线、评分体系、等级封顶、额度和特批规则。
- localStorage 自动保存最近草稿。
- 保存当前评估记录并查看历史记录。
- `assessmentRepository` 数据访问层，支持默认本地模式、Supabase 直连回滚模式，以及阿里云 `/api` 中转模式。
- 远端模式显示同步状态，并在保存失败时保留本机兜底记录。
- Supabase Edge Function 保存评估记录，并触发智谱联网核验日志。
- 核验页以“公共风险核验”工作台呈现智谱联网核验的进度、结构化判断、AI 线索摘要、建议、风险证据和原始来源链接。
- 已保存评估记录支持手动重新发起智谱联网核验，用于失败重试或资料更新后的补跑。
- 授权工商深度核验只在高额度、发现风险、合作未满 6 个月或需特批时提示；高额度阈值可通过业务参数配置，当前未配置供应商 Key 时不会发起授权工商核验。
- 结果页可查看后台联网核验状态：`pending` / `completed` / `failed` 等。
- 后台核验只把“机构名称匹配 + 搜索结果正文命中风险语义”识别为风险证据，避免把查询关键词本身误判为风险。
- 核验页支持人工确认闭环：采用系统建议、人工改判、上传证据截图/PDF、记录证据链接/截图编号、复核人和确认时间。
- 基础页可在填写机构名称后直接“保存并核验”，全局顶部展示当前机构、联网核验状态和进度条。
- 统一社会信用代码支持从服务端官方企业信用接口识别候选并由业务人员一键采用。
- 规则单元测试覆盖关键验收项。

## 当前限制

- 暂未登录，暂无角色权限。
- 未配置远端 API 时评估记录只保存在当前浏览器。
- 联网核验结果仍是辅助核验日志；公共信用建议必须通过人工确认日志采用或改判，不会由后台自动改写风控评分或红线判断。
- 证据附件通过 Supabase Edge Function 写入私有 Storage bucket；未接登录前仍按当前浏览器实例隔离。
- 未取得授权工商 API Key 前，默认使用智谱 Web Search 轻量核验；授权工商 API 仅作为条件触发的深度核验预留。
- 暂无正式特批审批流，只显示“需特批”和原因标签。
- 暂无管理端报表。

## 本地运行

```bash
npm install
npm run dev
```

默认本地地址：

```text
http://localhost:5173/
```

局域网手机访问地址以 Vite 输出为准，例如：

```text
http://你的局域网 IP:5173/
```

## 测试与构建

```bash
npm test
npm run build
npm run verify:dist
```

阿里云国内静态包建议使用：

```bash
npm run verify:release
```

该命令会以 `VITE_ASSESSMENT_API_URL=/api` 构建，并扫描 `dist`，确认不会把 Supabase Function URL、Supabase publishable key、智谱 key 或阿里云上游 key 标记打进前端产物。

需要交给 IT 或上传到 ECS 时，使用：

```bash
npm run release:aliyun
```

该命令会生成 `release/medical-credit-assessment-aliyun-*.tar.gz` 和对应 `.sha256`，包内包含 `h5/`、完整 `api/aliyun-api/`、RDS migration、`ops/aliyun/` 和发布清单。

部署后 smoke：

```bash
HEALTH_BASE_URL=https://credit.xxx.com HEALTH_EXPECT_READY=true HEALTH_EXPECT_BACKEND_MODE=aliyun npm run health:aliyun
SMOKE_BASE_URL=https://credit.xxx.com npm run smoke:aliyun
SMOKE_BASE_URL=https://credit.xxx.com SMOKE_FULL_FLOW=true npm run smoke:aliyun
SMOKE_BASE_URL=https://credit.xxx.com SMOKE_EXPECT_API_READY=true SMOKE_EXPECT_BACKEND_MODE=aliyun npm run smoke:aliyun
```

PR23 数据库回填：

```bash
# 先备份 Supabase 当前业务表和证据附件清单。输出目录默认在 backups/，不要放到 H5 静态目录。
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run backup:supabase

# 先建表
npm run db:migrate:aliyun

# 再从 Supabase REST 逐表回填到阿里云 RDS。service role key 只放在本次 shell 环境，不写进前端或仓库。
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run db:migrate:supabase-to-aliyun

# 如已有证据截图/PDF，先把 Supabase Storage 私有对象搬到阿里云 OSS。
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run storage:migrate:supabase-to-oss

# 回填后用备份目录校验 RDS 行数和 OSS 对象。
BACKUP_DIR=/path/to/backups/supabase-pre-aliyun-xxx \
VERIFY_OSS=true \
npm run migration:verify:aliyun
```

生成二维码：

```bash
QR_URL=https://credit.xxx.com/?v=pr22 npm run qr:aliyun
```

PR 检查由 `.github/workflows/ci.yml` 自动执行：

- `npm ci`
- `npm test`
- `npm run build`

## 远端持久化配置

默认不需要环境变量，系统使用 localStorage。需要接入远端数据库或 API 时，复制 `.env.example` 并配置：

```bash
VITE_ASSESSMENT_API_URL=/api
VITE_ASSESSMENT_API_KEY=
VITE_ASSESSMENT_API_TIMEOUT_MS=8000
VITE_DEEP_VERIFICATION_HIGH_LIMIT=50000
```

配置 `VITE_ASSESSMENT_API_URL` 后，前端会自动切换为远端持久化模式。国内部署推荐使用同域 `/api`，由阿里云 Node API 中转到当前后端；此时前端不需要 Supabase key。`VITE_SUPABASE_PUBLISHABLE_KEY` 仅保留给旧的 Supabase 直连回滚链路，不能填写 `service_role` / secret key。`VITE_DEEP_VERIFICATION_HIGH_LIMIT` 用于配置触发授权工商深度核验提示的高额度阈值，未配置时默认 `50000`。API 契约见：

```text
docs/remote-persistence-contract.md
```

PR22 的阿里云中转部署说明见：

```text
docs/aliyun-pr22-api-proxy.md
```

## 在线部署

当前 GitHub Pages 保留为回滚和对照链路；国内交付推荐使用阿里云 H5 静态入口 + `/api` 中转。

### 阿里云国内部署

推荐部署流程：

1. `VITE_ASSESSMENT_API_URL=/api npm run build`。
2. 将 `dist` 发布到阿里云 OSS 静态网站、CDN，或 ECS Nginx 独立目录。
3. 在同一域名下配置 `/api/` 反代到 `aliyun-api/server.js`。
4. Node API 环境变量中配置 `ASSESSMENT_UPSTREAM_URL` 和 `ASSESSMENT_UPSTREAM_API_KEY`。
5. 微信扫码访问备案域名，例如 `https://credit.xxx.com`。

详见：

```text
docs/aliyun-pr22-api-proxy.md
```

### GitHub Pages 回滚链路

部署流程：

1. 推送到 `main` 分支。
2. GitHub Actions 执行 `.github/workflows/deploy-pages.yml`。
3. Actions 内执行 `npm ci`、`npm test`、`npm run build`，并从 GitHub Actions Variables 注入 `VITE_ASSESSMENT_API_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_ASSESSMENT_API_TIMEOUT_MS`、`VITE_DEEP_VERIFICATION_HIGH_LIMIT`。
4. 将 `dist` 发布到 GitHub Pages。

计划线上地址：

```text
https://max0116.github.io/medical-beauty-credit-assessment/
```

线上二维码文件：

- `public/local-qr.png`
- `public/local-qr.svg`

## 主要文件

- `src/riskEngine.js`：唯一风控规则入口。
- `src/riskEngine.test.js`：核心规则测试。
- `src/assessmentRepository.js`：评估草稿与历史记录的数据访问层，当前默认使用 localStorage，支持配置 `/api` 国内中转。
- `src/assessmentRepository.test.js`：数据访问层单元测试。
- `src/App.jsx`：H5 应用主界面和交互。
- `src/styles.css`：移动端 UI 样式。
- `supabase/functions/assessments/verificationEvidence.ts`：智谱搜索结果的机构匹配、风险证据抽取和结构化核验判断。
- `supabase/functions/assessments/verificationEvidence.test.js`：联网核验误判回归测试。
- `docs/product-roadmap.md`：产品化开发路线图。
- `docs/database-integration-prompt.md`：后续数据库接入提示词与表结构建议。
- `docs/remote-persistence-contract.md`：远端持久化 API 契约。
- `docs/aliyun-pr22-api-proxy.md`：阿里云 API 中转部署、验收和回滚说明。
- `docs/aliyun-pr22-it-handoff.md`：给 IT 的 PR22 独立部署交接单。
- `docs/pr23-aliyun-rds-oss-migration-plan.md`：PR23 阿里云 RDS / OSS 迁移设计草案。
- `docs/aliyun-pr23-it-handoff.md`：给 IT 的 PR23 RDS / OSS 迁移交接单。
- `docs/pr23-deployment-acceptance.md`：PR23 迁移部署验收记录模板。
- `ops/aliyun/`：阿里云 Nginx、systemd、环境变量、部署预检模板。
- `scripts/verify-dist-no-secrets.mjs`：构建产物密钥与上游地址扫描脚本。
- `scripts/build-aliyun-release.mjs`：生成阿里云部署发布包，PR23 起包含完整 Node API、RDS migration 和 OSS / 智谱依赖声明。
- `scripts/check-aliyun-health.mjs`：部署后检查 `/api/health` readiness，可要求 RDS / OSS / 智谱均已配置。
- `scripts/backup-supabase.mjs`：PR23 迁移前备份脚本，导出 Supabase 业务表和证据附件清单。
- `scripts/migrate-supabase-to-aliyun-rds.mjs`：PR23 一次性数据回填脚本，将 Supabase 表数据 upsert 到阿里云 RDS。
- `scripts/migrate-supabase-evidence-to-aliyun-oss.mjs`：PR23 一次性附件回填脚本，将 Supabase Storage 证据文件上传到阿里云 OSS。
- `scripts/verify-aliyun-migration.mjs`：PR23 迁移后验收脚本，按备份 manifest 校验 RDS 行数和 OSS 对象。
- `scripts/smoke-aliyun-pr22.mjs`：阿里云部署后 H5 与 `/api` 自动 smoke。
- `scripts/generate-aliyun-qr.mjs`：根据 PR22 线上地址生成二维码。
- `docs/pr22-deployment-acceptance.md`：PR22 部署验收记录模板。
- `docs/ai-verification-plan.md`：智谱联网核验与多 AI Provider 规划。
- `.env.example`：远端持久化环境变量示例。
- `.github/workflows/ci.yml`：PR 自动测试与构建。
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署。
- `supabase/migrations/`：Supabase 数据表迁移。
- `supabase/functions/assessments/`：评估记录持久化与后台核验 Edge Function。
- `aliyun-api/`：PR22 新增的阿里云 Node API 中转服务，阶段一暂时代理 Supabase Function。

## 产品化路线

详见：

```text
docs/product-roadmap.md
```

推荐 PR 顺序：

1. 项目基线与在线静态部署。
2. 数据访问层抽象。
3. 数据库适配器与远端持久化接入。
4. 评估详情与历史记录产品化。
5. 人工/联网核验留痕。
6. 特批流程 MVP。
7. 登录权限与内部发布。

## 数据接入边界

当前 UI 不直接读写 `localStorage`。页面只调用 `src/assessmentRepository.js` 暴露的方法：

- `loadDraft`
- `saveDraft`
- `resetDraft`
- `listRecords`
- `saveRecord`
- `loadRecord`

下一阶段接数据库时，应优先让 Supabase Edge Function 实现 `docs/remote-persistence-contract.md` 中的 API 契约，避免把 Supabase service role、SQL 或权限逻辑写进 `App.jsx`。

## Supabase 接入

PR4 开始提供 Supabase 落地文件：

- `assessment_records`：保存评估记录快照。
- `assessment_drafts`：保存浏览器实例的最近草稿。
- `verification_logs`：保存后台联网核验日志。
- `verification_reviews`：保存核验人工确认、采用建议、人工改判和证据说明。
- `assessments` Edge Function：提供 `/draft`、`/records`、`/records/:id` API。

需要在 Supabase Function Secrets 中配置：

```bash
ZHIPUAI_API_KEY=你的智谱 API Key
ALLOWED_ORIGINS=https://max0116.github.io,http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174
ASSESSMENT_PUBLISHABLE_KEYS={"default":"sb_publishable_xxx"}
ASSESSMENT_SERVICE_ROLE_KEY=service_role_jwt_xxx
ASSESSMENT_SECRET_KEYS={"default":"sb_secret_xxx"}
```

本地前端 `.env` 只放 publishable / anon key，不放 service role：

```bash
VITE_ASSESSMENT_API_URL=https://<project-ref>.supabase.co/functions/v1/assessments
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_DEEP_VERIFICATION_HIGH_LIMIT=50000
```
