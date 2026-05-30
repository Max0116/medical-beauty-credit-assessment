# PR23 当前就绪度审计

本文记录 `medical-credit-assessment` 从 PR22 Supabase 中转链路推进到 PR23 阿里云 RDS / OSS 链路的当前证据状态。PR23 不改风控评分规则，不删除 Supabase 回滚链路，不影响阿里云现有项目。

## 一、当前结论

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| PR23 代码准备 | 已提交并推送到 PR #23，继续补强中 | PR #23 head 已补充安全 staging 发布脚本、Docker 源码 staging 脚本和 release commit 追溯 |
| 风控评分规则 | 未改动 | 本轮改动集中在 smoke、验收文档和阿里云迁移交接 |
| 前端国内入口 | 当前 IP 默认入口不再可作为 medical-credit 稳定 smoke 地址 | `http://101.132.137.25/` 当前由 `hear-us` vhost 接管，medical-credit 同名 IP vhost 被 Nginx ignored |
| 当前线上后端 | 不再能通过裸 IP `/api/health` 验证 medical-credit | `/api/health` 当前返回 `hear-us` Next.js 404；需要独立域名或明确 server_name 后再 smoke |
| PR23 RDS / OSS 真实部署 | 未完成，但发布包已完成服务器侧只 staging | 宝塔入口与 root 终端已确认可用；服务器当前未安装 PgSQL，已有 MySQL 服务和 3 个既有业务库，尚未创建本项目独立数据库 / OSS bucket / Node API |
| PR23 回滚策略 | 已设计 | 保留 `proxy` 模式，异常时切回 Supabase 中转，不删除 RDS / OSS / 备份 |

## 二、已验证命令

最近一轮完整验证已通过：

```bash
npm test
npm run build
git diff --check
bash -n ops/aliyun/stage-release.sh.example ops/aliyun/deploy-release.sh.example ops/aliyun/rollback-release.sh.example ops/aliyun/preflight-release.sh.example
npm test -- scripts/aliyun-release-manifest.test.js
npm run release:aliyun
HEALTH_BASE_URL=http://101.132.137.25 npm run health:aliyun
SMOKE_BASE_URL=http://101.132.137.25 SMOKE_EXPECT_API=true SMOKE_VERSION_LABEL=pr23-ready-to-commit npm run smoke:aliyun
```

最新 PR23 应用发布包（build commit `e89704fba3ee`；之后的审计文档更新不改变运行时代码）：

```text
release/medical-credit-assessment-aliyun-e89704fba3ee-20260530T004758Z.tar.gz
SHA256: 5dd841d01816c5c6b82c8712da214cd1e350c15bfbcaaf32451ea64f96ce2abc
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
- 已新增资源就绪检查：`npm run resources:aliyun:check`，用于在切流量前脱敏检查独立数据库、OSS、智谱和 Supabase 回滚上游。
- 已新增 MySQL bootstrap SQL 生成器：`npm run db:bootstrap:mysql`，用于生成独立库 / 独立用户 / 最小权限授权 SQL，拒绝既有业务库名且默认不向终端打印真实密码。
- 已新增 OSS / RAM 最小权限策略生成器：`npm run oss:policy:generate`，用于生成私有 bucket 的前缀级读写策略和 IT 交接说明。
- 已新增 PR23 总闸门：`npm run cutover:aliyun:gate`，用于汇总 inventory / Nginx / `.env` / resources / health / api-flow / migration verify 证据后给出 go/no-go。

## 四、服务器只读盘点结论

2026-05-30 通过已登录宝塔面板和宝塔终端做了只读盘点，没有修改任何配置、文件、数据库或服务。终端命令只读取系统、目录、端口、Node/Nginx 和服务状态。

| 项目 | 结果 | 影响 |
| --- | --- | --- |
| 宝塔入口 | `https://101.132.137.25:29119/home` 已登录可用 | 后续可通过面板终端和文件管理进行受控部署；本轮未点击任何修改入口 |
| Shell 用户 | `root@MaxFuture` | 可以执行后续 staging / preflight，但必须严格限制到本项目目录 |
| 系统内核 | `6.8.0-87-generic` | 与 Ubuntu 24 面板信息一致 |
| 独立 H5 站点 | 已存在 `medical-credit-assessment`，根目录 `/www/wwwroot/medical-credit-assessment` | 当前 H5 没有和其他项目混在同一目录 |
| 独立 API 目录 | `/www/wwwroot/medical-credit-api`、`/var/www/medical-credit`、`/var/www/medical-credit-api` 均不存在 | 后续部署前可新建独立 API 目录，不会覆盖已有业务目录 |
| 目标端口 | `127.0.0.1:8787` 未出现在监听列表 | 可作为本项目 Node API 默认端口候选 |
| Web / 数据库端口 | `80`、`443`、`29119`、`3306` 正在监听 | 当前 Nginx、宝塔面板、MySQL 正在运行 |
| Nginx 配置 | `html_101.132.137.25.conf` 中 `/api` 仍代理 Supabase Edge Function | 当前仍是 PR22 兼容链路，不是完整阿里云数据闭环 |
| Nginx server_name 冲突 | `hear-us.conf` 与 `html_101.132.137.25.conf` 均使用 `server_name 101.132.137.25` | 当前生效的是 `hear-us`，medical-credit IP vhost 被 Nginx ignored；不能继续把裸 IP 当作本项目稳定入口 |
| Nginx 测试 | `nginx -t` 成功 | 当前 Nginx 配置语法正常；后续新增配置仍需单独测试 |
| PostgreSQL / PgSQL | 宝塔 PgSQL 面板显示未安装 | 若坚持 PostgreSQL，需要安装 PgSQL 或购买 RDS PostgreSQL |
| MySQL | 已有 MySQL，本地已有 `gohomesh`、`mediverseai`、`maxfuture` 三个既有库 | 不能碰既有库；如走 MySQL，必须新建独立库 `medical_credit_assessment` |
| Node / npm | `node`、`npm` 不在当前 PATH | 若部署 Node API，需要先由 IT 安装 Node LTS，或改用 Docker / 宝塔 Node 项目能力 |
| Docker | `docker` 已安装，版本 `29.0.2`，服务 active | 当前更适合优先走 Docker 独立容器路线，避免改宿主机 Node 环境 |
| API 进程 | 未发现本项目独立 Node API 进程 | `/api` 目前仍按 PR22 由 Nginx 直接中转 Supabase，而非本地 Node API |

补充注意：若 Docker API 连接服务器本机 MySQL，`ALIYUN_MYSQL_HOST=127.0.0.1` / `localhost` 会指向容器自身而非宿主机。PR23 已补充 host-gateway 模板和资源就绪闸门；短期本机 MySQL 路线应使用 `host.docker.internal` 或由 IT 提供可达的 MySQL/RDS 地址。

### 服务器侧 staging 记录

2026-05-30 通过已登录宝塔终端执行了受控 staging 验证：

| 项目 | 结果 |
| --- | --- |
| GitHub codeload / clone | 服务器可拉取 `codex/pr23-aliyun-rds-oss` |
| Docker Node 镜像 | `node:20-bookworm-slim` 已可拉取 |
| Docker 内测试 | `npm test` 通过，`31 files / 143 tests passed` |
| Docker 内构建 | `npm run build` 与 `npm run release:aliyun` 通过 |
| H5 staging | 已进入 `/www/wwwroot/medical-credit-assessment/releases/medical-credit-assessment-aliyun--20260530T012618Z` |
| API staging | 已进入 `/www/wwwroot/medical-credit-api/releases/medical-credit-assessment-aliyun--20260530T012618Z` |
| 流量切换 | 未切 `current` |
| Nginx / 服务 / 数据库 | 未修改、未重启、未迁移 |

本次 staging 暴露出 Docker 镜像内缺少 `git` 时 release 名称可能丢 commit，因此 PR #23 已补充 `MEDICAL_CREDIT_RELEASE_COMMIT` / `MEDICAL_CREDIT_RELEASE_BRANCH` 环境变量兜底，并新增 `ops/aliyun/stage-from-github-source.sh.example` 固化后续源码 staging 流程。

## 五、当前阻塞

PR23 真实切换仍不能直接执行，阻塞点已经从“入口不可用”变成“阿里云数据资源尚未创建 / 未授权 / Node 运行时未准备”：

| 阻塞项 | 当前表现 | 下一步 |
| --- | --- | --- |
| 独立数据库 | 未看到 `medical_credit_assessment` 或 `medical_credit` 独立库 | 由 IT 确认使用 RDS PostgreSQL、RDS MySQL，或在本机 MySQL 新建独立库 |
| OSS bucket | 未获得 `medical-credit-verification-evidence` bucket / RAM Key | 创建私有 bucket 和最小权限 RAM 子账号 |
| API 服务目录 | 未看到 `/www/wwwroot/medical-credit-api` 或 `/var/www/medical-credit-api` 已部署 | 部署 PR23 release 包后创建独立 API 目录和 systemd 服务 |
| 生产域名与 HTTPS | 当前仅 IP 访问，站点 SSL 未部署 | 后续需要备案域名与证书，微信正式使用不建议长期用 IP |
| 裸 IP server_name 冲突 | `hear-us` 与 medical-credit 同时声明 `101.132.137.25` | 必须让 IT 提供独立备案子域名，例如 `credit.xxx.com`，或明确独立 server_name；不要改动 hear-us 现有配置 |
| Node 运行时 | 当前 shell 中 `node` / `npm` 不可用，Docker 可用 | 推荐优先使用 Docker 独立容器；备选为 IT 安装 Node LTS 或宝塔 Node 项目 |

## 六、进入真实部署前必须确认

- 独立目录可用：`/var/www/medical-credit`、`/var/www/medical-credit-api`。
- 独立 API 端口可用：默认 `127.0.0.1:8787`。
- 新增 Nginx 配置不会覆盖已有业务。
- RDS PostgreSQL 库 `medical_credit` 或 MySQL 兼容库 `medical_credit_assessment` 和账号 `medical_credit_app` 已准备。
- OSS bucket `medical-credit-verification-evidence` 为私有。
- 智谱 Key、RDS 密码、OSS AccessKey 只在服务器 `.env` 中配置。
- Supabase service role 只用于一次性备份 / 回填 shell，不长期写入 `.env`。

## 七、下一步动作

1. 由 IT 确认 Node API 部署路线：推荐 Docker 独立容器；备选为安装 Node LTS 或使用宝塔 Node 项目。路线说明见 `docs/pr23-aliyun-node-runtime-options.md`。
2. 选择数据库路线：优先 RDS PostgreSQL；如短期复用现有 MySQL 服务，则只允许新建独立库和账号。
3. 如果走 MySQL，先用 `npm run db:bootstrap:mysql` 生成 SQL，由 IT 复核后创建 `medical_credit_assessment` 和 `medical_credit_app`。
4. 使用 `npm run oss:policy:generate` 生成 OSS/RAM 策略，由 IT 创建私有 bucket 和最小权限 RAM 子账号。
5. 使用 `ops/aliyun/stage-from-github-source.sh.example` 或最新 release 包执行 `stage-release`，只放入 `releases/`，不切流量。
6. 在 API `.env` 完成后运行 `npm run env:aliyun:guard` 和 `npm run resources:aliyun:check`，确保独立 DB / OSS / 智谱 / 回滚上游具备条件。
7. preflight 通过后部署独立 Node API，先启用 `MEDICAL_CREDIT_BACKEND_MODE=dual_write`。
8. 运行 health、api-flow、附件上传 smoke，并用 `npm run cutover:aliyun:gate` 汇总判断。
9. 完成 RDS / OSS 迁移、附件签名链接、API flow smoke 和微信端 smoke。
10. 验收通过后再切 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`。
