# 医美机构账期评估系统

一个面向内部业务风控场景的手机端 H5 工具，用于评估下游医美机构是否可以给予账期、最长账期、建议额度、是否需要特批，以及系统给出判断的原因。

当前版本是产品化基线版本：已具备可交互评估流程、核心风控规则、移动端 UI、localStorage 保存和历史记录；数据库、联网核验、登录权限和审批流将按路线图分阶段接入。

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
- 公共信用联网核验模块预留。
- 规则单元测试覆盖关键验收项。

## 当前限制

- 暂未接数据库，评估记录只保存在当前浏览器。
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
- `src/App.jsx`：H5 应用主界面和交互。
- `src/styles.css`：移动端 UI 样式。
- `docs/product-roadmap.md`：产品化开发路线图。
- `docs/database-integration-prompt.md`：后续数据库接入提示词与表结构建议。
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署。

## 产品化路线

详见：

```text
docs/product-roadmap.md
```

推荐 PR 顺序：

1. 项目基线与在线静态部署。
2. 数据访问层抽象。
3. 数据库保存评估记录。
4. 评估详情与历史记录产品化。
5. 人工/联网核验留痕。
6. 特批流程 MVP。
7. 登录权限与内部发布。
