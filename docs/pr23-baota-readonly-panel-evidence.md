# PR23 宝塔面板只读复核记录

本文记录 2026-05-30 11:35-11:39 CST 通过已登录宝塔面板完成的只读复核。复核过程只浏览页面和截图，没有点击新增、保存、删除、重启、安装、部署、修改配置等操作。

## 一、复核边界

- 面板地址：`https://101.132.137.25:29119`
- 复核方式：Chrome 已登录会话，只读浏览宝塔页面。
- 未执行动作：未改 Nginx、未改站点、未创建数据库、未安装 PgSQL、未启动 Docker 容器、未上传发布包、未切换流量。
- 安全边界：不影响现有业务库 `gohomesh`、`mediverseai`、`maxfuture`，不改已有业务项目。

## 二、当前面板证据

| 面板页面 | 只读观察 | 对 PR23 的影响 |
| --- | --- | --- |
| 数据库 / PgSQL | 页面显示“当前未安装 PgSql 环境/远程数据库”，列表为空 | 当前 ECS 宝塔环境不能直接执行 PostgreSQL 本机迁移；若坚持 PostgreSQL，应购买或接入 RDS PostgreSQL |
| 数据库 / MySQL | 已有 MySQL，列表显示 `gohomesh`、`mediverseai`、`maxfuture` 三个既有业务库 | 不能复用或修改既有库；如短期走 MySQL，只能创建独立库 `medical_credit_assessment` 和独立账号 `medical_credit_app` |
| 网站 / PHP 项目 | PHP 项目列表为空 | PHP 项目不承载本工具，不作为本项目入口 |
| 网站 / HTML 项目 | 已存在 HTML 项目 `101.132.137.25`，根目录 `/www/wwwroot/medical-credit-assessment`，备注为 `medical-credit-assessment 内部...`，SSL 显示未部署 | H5 独立目录已存在，但正式访问仍需要独立备案域名和 HTTPS；裸 IP 不应作为稳定入口 |
| Docker / 应用商店 | Docker 功能入口可打开 | 服务器具备 Docker 管理能力；PR23 推荐继续走 Docker 独立 API 容器路线，避免改宿主机 Node 环境 |

## 三、当前不能直接做的事

- 不能把 PR23 直接切成 `aliyun` 模式，因为数据库和 OSS 真实资源还没有完成创建和验收。
- 不能在 MySQL 中使用 `gohomesh`、`mediverseai`、`maxfuture` 任一既有业务库。
- 不能在没有独立域名的情况下继续把裸 IP 当作微信可扫码的稳定入口。
- 不能安装 PgSQL 或新增数据库前跳过 IT 复核。
- 不能修改已有 Nginx vhost 来抢占 `101.132.137.25` 的默认入口。

## 四、下一步建议

1. IT 确认是否购买或接入 RDS PostgreSQL；如果短期只用现有 MySQL，则执行 PR23 的 MySQL bootstrap 方案创建独立库。
2. IT 创建私有 OSS bucket `medical-credit-verification-evidence`，并使用 PR23 生成的最小权限 RAM policy。
3. 提供备案子域名，例如 `credit.xxx.com`，再生成独立 Nginx vhost 草案。
4. API 继续优先走 Docker 独立容器，绑定 `127.0.0.1:8787`，避免改宿主机 Node/npm。
5. 资源创建后运行 `env:aliyun:guard`、`resources:aliyun:check`、`cutover:aliyun:gate`，全部通过后再考虑从 Draft 进入 Ready。
