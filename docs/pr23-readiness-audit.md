# PR23 当前就绪度审计

本文记录 `medical-credit-assessment` 从 PR22 Supabase 中转链路推进到 PR23 阿里云 RDS / OSS 链路的当前证据状态。PR23 不改风控评分规则，不删除 Supabase 回滚链路，不影响阿里云现有项目。

## 一、当前结论

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| PR23 代码准备 | 已提交并推送到 PR #23，继续补强中 | commit `65aaf5c3dbf5e9a9dfdce37e45a1f13b8686fbb2` 后继续增加 MySQL 兼容 RDS 支持 |
| 风控评分规则 | 未改动 | 本轮改动集中在 smoke、验收文档和阿里云迁移交接 |
| 前端国内入口 | 当前可访问 | `http://101.132.137.25` smoke 通过 |
| 当前线上后端 | 仍是 PR22 兼容链路 | `/api/health` 显示 `proxy=aliyun-nginx`、`upstream=supabase` |
| PR23 RDS / OSS 真实部署 | 未完成 | 宝塔入口已确认可用；服务器当前未安装 PgSQL，已有 MySQL 服务和 3 个既有业务库，尚未创建本项目独立数据库 / OSS bucket |
| PR23 回滚策略 | 已设计 | 保留 `proxy` 模式，异常时切回 Supabase 中转，不删除 RDS / OSS / 备份 |

## 二、已验证命令

最近一轮完整验证已通过：

```bash
npm test
npm run build
npm run verify:dist
npm run release:aliyun
HEALTH_BASE_URL=http://101.132.137.25 npm run health:aliyun
SMOKE_BASE_URL=http://101.132.137.25 SMOKE_EXPECT_API=true SMOKE_VERSION_LABEL=pr23-ready-to-commit npm run smoke:aliyun
git diff --check
```

最新 PR23 发布包：

```text
release/medical-credit-assessment-aliyun-743702aca873-20260529T211813Z.tar.gz
SHA256: e6a8c05f43f1a2b8c906f07f0db8d6a0fed02b95ec6e1c37481dd6a4a091dff8
```

补充聚焦验证：

```bash
npm test -- scripts/aliyun-api-flow-smoke.test.js
```

## 三、已补强能力

- `smoke:aliyun:api-flow` 支持 `API_FLOW_RUN_ID`。
- smoke 记录输出 `smoke.marker=PR23_API_FLOW_SMOKE` 和 `smoke.runId`。
- RDS 可按 `institution_name` 前缀 `PR23阿里云链路验收机构`、记录 ID 前缀 `api-flow-`、`form_snapshot.remarks` 中的 marker 定位测试记录。
- OSS 可按 `pr23-api-flow-smoke-<runId>.pdf` 定位测试 PDF。
- 验收文档已说明如何判断测试记录和附件。
- 已新增短版 IT 入口解锁请求：`docs/aliyun-pr23-access-unlock-request.md`。

## 四、服务器只读盘点结论

2026-05-30 通过已登录宝塔面板做了只读盘点，没有修改任何配置、文件、数据库或服务。

| 项目 | 结果 | 影响 |
| --- | --- | --- |
| 宝塔入口 | `https://101.132.137.25:29119/home` 已登录可用 | 后续可通过面板终端和文件管理进行受控部署 |
| 独立 H5 站点 | 已存在 `medical-credit-assessment`，根目录 `/www/wwwroot/medical-credit-assessment` | 当前 H5 没有和其他项目混在同一目录 |
| Nginx 配置 | `html_101.132.137.25.conf` 中 `/api` 仍代理 Supabase Edge Function | 当前仍是 PR22 兼容链路，不是完整阿里云数据闭环 |
| PostgreSQL / PgSQL | 宝塔 PgSQL 面板显示未安装 | 若坚持 PostgreSQL，需要安装 PgSQL 或购买 RDS PostgreSQL |
| MySQL | 已有 MySQL，本地已有 `gohomesh`、`mediverseai`、`maxfuture` 三个既有库 | 不能碰既有库；如走 MySQL，必须新建独立库 `medical_credit_assessment` |
| API 进程 | 未发现本项目独立 Node API 进程 | `/api` 目前由 Nginx 直接中转 Supabase，而非本地 Node API |

## 五、当前阻塞

PR23 真实切换仍不能直接执行，阻塞点已经从“入口不可用”变成“阿里云数据资源尚未创建 / 未授权”：

| 阻塞项 | 当前表现 | 下一步 |
| --- | --- | --- |
| 独立数据库 | 未看到 `medical_credit_assessment` 或 `medical_credit` 独立库 | 由 IT 确认使用 RDS PostgreSQL、RDS MySQL，或在本机 MySQL 新建独立库 |
| OSS bucket | 未获得 `medical-credit-verification-evidence` bucket / RAM Key | 创建私有 bucket 和最小权限 RAM 子账号 |
| API 服务目录 | 未看到 `/www/wwwroot/medical-credit-api` 或 `/var/www/medical-credit-api` 已部署 | 部署 PR23 release 包后创建独立 API 目录和 systemd 服务 |
| 生产域名与 HTTPS | 当前仅 IP 访问，站点 SSL 未部署 | 后续需要备案域名与证书，微信正式使用不建议长期用 IP |

## 五、进入真实部署前必须确认

- 独立目录可用：`/var/www/medical-credit`、`/var/www/medical-credit-api`。
- 独立 API 端口可用：默认 `127.0.0.1:8787`。
- 新增 Nginx 配置不会覆盖已有业务。
- RDS PostgreSQL 库 `medical_credit` 或 MySQL 兼容库 `medical_credit_assessment` 和账号 `medical_credit_app` 已准备。
- OSS bucket `medical-credit-verification-evidence` 为私有。
- 智谱 Key、RDS 密码、OSS AccessKey 只在服务器 `.env` 中配置。
- Supabase service role 只用于一次性备份 / 回填 shell，不长期写入 `.env`。

## 六、下一步动作

1. 将 `docs/aliyun-pr23-access-unlock-request.md` 发给 IT。
2. IT 提供真实宝塔入口或独立 SSH。
3. 执行只读服务器盘点。
4. 选择数据库路线：优先 RDS PostgreSQL；如短期复用现有 MySQL 服务，则只允许新建独立库和账号。
5. 盘点通过后部署 PR23 包，先启用 `MEDICAL_CREDIT_BACKEND_MODE=dual_write`。
6. 完成 RDS / OSS 迁移、附件签名链接、API flow smoke 和微信端 smoke。
7. 验收通过后再切 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`。
