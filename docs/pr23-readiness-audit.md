# PR23 当前就绪度审计

本文记录 `medical-credit-assessment` 从 PR22 Supabase 中转链路推进到 PR23 阿里云 RDS / OSS 链路的当前证据状态。PR23 不改风控评分规则，不删除 Supabase 回滚链路，不影响阿里云现有项目。

## 一、当前结论

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| PR23 代码准备 | 已具备提交条件 | 本地测试、构建、发布包生成均通过 |
| 风控评分规则 | 未改动 | 本轮改动集中在 smoke、验收文档和阿里云迁移交接 |
| 前端国内入口 | 当前可访问 | `http://101.132.137.25` smoke 通过 |
| 当前线上后端 | 仍是 PR22 兼容链路 | `/api/health` 显示 `proxy=aliyun-nginx`、`upstream=supabase` |
| PR23 RDS / OSS 真实部署 | 未完成 | 缺少有效宝塔入口或 SSH 登录，无法做服务器内部盘点和部署 |
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

## 四、当前阻塞

PR23 无法继续真实部署的原因不是代码，而是服务器入口：

| 阻塞项 | 当前表现 | 下一步 |
| --- | --- | --- |
| 宝塔安全入口 | 候选入口返回“安全入口校验失败” | IT 执行 `/etc/init.d/bt default` 查看真实入口 |
| SSH 登录 | `22` 端口可连通，但连接在认证前关闭 | IT 提供独立 SSH 用户、端口、认证方式和 sudo 边界 |
| 内部资源盘点 | 未进入服务器，无法确认目录、Nginx、端口、Node、systemd、现有项目 | 拿到入口后先执行只读盘点脚本 |
| RDS / OSS 实例 | 未获得实际连接信息和 RAM 权限 | IT 提供独立 RDS 库、私有 OSS bucket 和最小权限 RAM |

## 五、进入真实部署前必须确认

- 独立目录可用：`/var/www/medical-credit`、`/var/www/medical-credit-api`。
- 独立 API 端口可用：默认 `127.0.0.1:8787`。
- 新增 Nginx 配置不会覆盖已有业务。
- RDS PostgreSQL 库 `medical_credit` 和账号 `medical_credit_app` 已准备。
- OSS bucket `medical-credit-verification-evidence` 为私有。
- 智谱 Key、RDS 密码、OSS AccessKey 只在服务器 `.env` 中配置。
- Supabase service role 只用于一次性备份 / 回填 shell，不长期写入 `.env`。

## 六、下一步动作

1. 提交并推送当前 PR23 smoke 可追踪性和交接文档改动。
2. 将 `docs/aliyun-pr23-access-unlock-request.md` 发给 IT。
3. IT 提供真实宝塔入口或独立 SSH。
4. 执行只读服务器盘点。
5. 盘点通过后部署 PR23 包，先启用 `MEDICAL_CREDIT_BACKEND_MODE=dual_write`。
6. 完成 RDS / OSS 迁移、附件签名链接、API flow smoke 和微信端 smoke。
7. 验收通过后再切 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`。
