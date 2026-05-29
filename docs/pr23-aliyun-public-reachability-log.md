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
