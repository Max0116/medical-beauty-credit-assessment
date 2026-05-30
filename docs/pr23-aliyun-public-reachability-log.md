# PR23 阿里云公网只读可达性记录

本文记录在不登录服务器、不修改服务器、不使用任何密钥的前提下，对当前阿里云临时入口做的公网只读检查。该记录只能证明外部入口当前状态，不能替代服务器内部盘点、RDS/OSS 配置验收或 PR23 真实部署验收。

## 检查时间

- UTC：2026-05-29T18:30:10Z
- CST：2026-05-30 02:30:10

## 检查范围

| 项目 | 结论 |
| --- | --- |
| H5 临时入口 | `http://101.132.137.25/` 返回 `200 OK` |
| Web Server | 响应头显示 `nginx` |
| `/api/health` | 返回 `200` |
| 当前后端链路 | `/api/health` payload 仍为 PR22 兼容链路：`proxy=aliyun-nginx`、`upstream=supabase` |
| PR23 RDS / OSS readiness | 未证明；当前 health payload 没有 `ready`、`mode`、`backend.database`、`storage.configured`、`verification.configured` |
| 服务器面板端口 | 未登录只读 HEAD 返回 `404`，不能据此判断面板内项目、目录、Nginx 或数据库状态 |

## 命令摘要

```bash
curl -I --max-time 10 http://101.132.137.25/
curl -sS --max-time 10 http://101.132.137.25/api/health
HEALTH_BASE_URL=http://101.132.137.25 npm run health:aliyun
```

## 关键输出

```json
{
  "ok": true,
  "service": "medical-credit-assessment",
  "proxy": "aliyun-nginx",
  "upstream": "supabase"
}
```

```json
{
  "baseUrl": "http://101.132.137.25",
  "status": 200,
  "ok": true,
  "backend": {},
  "storage": {},
  "verification": {}
}
```

## 判断

- 当前国内临时入口仍可访问。
- 当前入口仍是 PR22 Supabase 中转模式，不是 PR23 RDS / OSS 真实模式。
- 不能根据公网检查确认服务器内部目录、现有项目、Nginx vhost、端口占用、RDS、OSS 或 RAM 权限。
- 下一步仍需执行服务器内部只读盘点，并生成脱敏盘点报告。

## 下一步

在目标服务器内执行：

```bash
bash ops/aliyun/server-inventory-readonly.sh.example > /tmp/medical-credit-inventory.txt
INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format
```

然后填写：

```text
docs/aliyun-pr23-server-inventory-checklist.md
```

## 追加检查：公网 IP 默认站点冲突

检查时间：

- UTC：2026-05-30T01:36:50Z
- CST：2026-05-30 09:36:50

只读结论：

| 项目 | 结论 |
| --- | --- |
| `http://101.132.137.25/` | 返回 `200 OK`，但页面内容已变为 `hear-us` Next.js 站点 |
| `http://101.132.137.25/api/health` | 返回 `404 Not Found`，同样由 `hear-us` Next.js 接管 |
| `html_101.132.137.25.conf` | 仍存在 medical-credit 静态根目录 `/www/wwwroot/medical-credit-assessment` 与 Supabase 中转 `/api` 配置 |
| `hear-us.conf` | 存在相同 `server_name 101.132.137.25`，代理到 `127.0.0.1:3010` |
| `nginx -T` | 输出 `conflicting server name "101.132.137.25" on 0.0.0.0:80, ignored` |

判断：

- 当前 IP 默认入口由前序 `hear-us` vhost 生效，medical-credit 的同名 IP vhost 被 Nginx 忽略。
- PR23 发布包已可 staging 到独立 `releases/` 目录，但不能把 `http://101.132.137.25/` 继续当作稳定 medical-credit smoke 地址。
- 下一步必须由 IT 提供独立备案域名 / 子域名，或明确一个不会与现有项目冲突的 Nginx server_name；不建议继续复用裸 IP 作为两个项目的入口。
- 在未确认独立入口前，不应修改 `hear-us.conf`，也不应强行把 IP 默认站点切回 medical-credit。

## 追加检查：面板与 SSH 入口

检查时间：

- UTC：2026-05-29T19:26:24Z
- CST：2026-05-30 03:26:24

只读结论：

| 项目 | 结论 |
| --- | --- |
| `80` / `443` / `29119` / `8888` | 外网端口可连通 |
| 宝塔面板候选入口 | 返回“安全入口校验失败”，说明当前安全入口路径不匹配 |
| SSH `22` | TCP 可连通，但连接被服务器关闭，未进入密码认证阶段 |
| `http://101.132.137.25/` | 返回 `200 OK`，仍由 `nginx` 服务 |
| `https://101.132.137.25/` | 返回自签证书页面，不可作为微信 HTTPS 正式入口 |

处理建议：

- 不关闭宝塔安全入口。
- 不猜测或爆破面板路径。
- 由 IT 在服务器执行 `/etc/init.d/bt default` 查看当前宝塔安全入口，或提供独立 SSH 账号。
- PR23 部署前仍需完成只读服务器盘点，确认独立目录、独立 Nginx 配置、Node 服务、RDS/OSS/RAM 权限均不会影响现有项目。
