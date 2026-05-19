# 医美机构账期评估系统

一个面向内部业务风控场景的手机端 H5 工具，用于评估下游医美机构是否可以给予账期、最长账期、建议额度、是否需要特批，以及系统给出判断的原因。

当前版本是产品化基线版本：已具备可交互评估流程、核心风控规则、移动端 UI、通过数据访问层封装的本地/远端持久化入口；数据库、联网核验、登录权限和审批流将按路线图分阶段接入。

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
- `assessmentRepository` 数据访问层，支持默认本地模式和通过环境变量开启的远端 API 模式。
- 公共信用联网核验模块预留。
- 规则单元测试覆盖关键验收项。

## 当前限制

- 默认仍未接真实数据库，未配置远端 API 时评估记录只保存在当前浏览器。
- 远端持久化 adapter 已预留，需要后端或数据库服务实现约定 API。
- 暂未登录，暂无角色权限。
- 暂未接真实公共信用/处罚/失信查询接口。
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
```

PR 检查由 `.github/workflows/ci.yml` 自动执行：

- `npm ci`
- `npm test`
- `npm run build`

## 远端持久化配置

默认不需要环境变量，系统使用 localStorage。需要接入远端数据库或 API 时，复制 `.env.example` 并配置：

```bash
VITE_ASSESSMENT_API_URL=https://your-api.example.com
VITE_ASSESSMENT_API_KEY=optional-bearer-token
VITE_ASSESSMENT_API_TIMEOUT_MS=8000
```

配置 `VITE_ASSESSMENT_API_URL` 后，前端会自动切换为远端持久化模式。API 契约见：

```text
docs/remote-persistence-contract.md
```

## 在线部署

本项目使用 GitHub Pages 部署 Vite 静态站点。

部署流程：

1. 推送到 `main` 分支。
2. GitHub Actions 执行 `.github/workflows/deploy-pages.yml`。
3. Actions 内执行 `npm ci`、`npm test`、`GITHUB_PAGES=true npm run build`。
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
- `src/assessmentRepository.js`：评估草稿与历史记录的数据访问层，当前默认使用 localStorage。
- `src/assessmentRepository.test.js`：数据访问层单元测试。
- `src/App.jsx`：H5 应用主界面和交互。
- `src/styles.css`：移动端 UI 样式。
- `docs/product-roadmap.md`：产品化开发路线图。
- `docs/database-integration-prompt.md`：后续数据库接入提示词与表结构建议。
- `docs/remote-persistence-contract.md`：远端持久化 API 契约。
- `.env.example`：远端持久化环境变量示例。
- `.github/workflows/ci.yml`：PR 自动测试与构建。
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署。

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

下一阶段接数据库时，应优先让后端或数据库函数实现 `docs/remote-persistence-contract.md` 中的 API 契约，避免把 Supabase SDK、SQL 或权限逻辑写进 `App.jsx`。
