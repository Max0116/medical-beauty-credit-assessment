# PR24 阿里云生产运维 Runbook

本文用于 PR24 去 Supabase 后的生产运维交接。目标是让 `medical-credit-assessment` 在阿里云国内链路上可备份、可恢复、可监控、可回滚。本文不改变风控评分规则，不要求删除 PR23 迁移备份。

## 一、生产架构基线

```text
微信 / 浏览器
  -> https://credit.xxx.com
  -> 阿里云 CDN / OSS 静态站点或 ECS Nginx
  -> H5
  -> 同域 /api
  -> ECS Node API 或函数计算
  -> 阿里云 RDS PostgreSQL
  -> 阿里云 OSS 私有 bucket
  -> 智谱 Web Search API
```

生产期望：

- 前端只请求 `https://credit.xxx.com/api`。
- API 只运行 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`。
- RDS 保存草稿、评估记录、核验日志、人工确认日志。
- OSS 保存证据截图和 PDF，前端只拿短期签名 URL。
- 智谱 API Key、RDS 密码、OSS AccessKey 只在服务端配置。

## 二、日常健康检查

每日或每次发布后执行：

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=aliyun \
npm run health:aliyun
```

每周或每次大版本发布后执行完整链路 smoke：

```bash
API_FLOW_BASE_URL=https://credit.xxx.com \
API_FLOW_RUN_ID=prod-weekly-$(date +%Y%m%d) \
API_FLOW_EXPECT_API_READY=true \
API_FLOW_EXPECT_BACKEND_MODE=aliyun \
API_FLOW_EXPECT_BACKEND_DATABASE=postgres \
API_FLOW_EXPECT_STORAGE_CONFIGURED=true \
API_FLOW_EXPECT_VERIFICATION_CONFIGURED=true \
API_FLOW_UPLOAD_ATTACHMENT=true \
API_FLOW_VERIFY_SIGNED_URL=true \
npm run smoke:aliyun:api-flow
```

验收点：

- `/api/health` 返回 ready。
- 保存记录成功。
- 核验日志能立即看到 pending / running。
- 附件上传到 OSS，签名链接可打开。
- 历史记录能看到 smoke 记录。

## 三、RDS 备份策略

建议开启：

- 自动备份：每天至少一次。
- 备份保留：不少于 7 天；正式生产建议 30 天。
- 重要发布前：手动创建一次 RDS 快照或逻辑备份。
- 重要迁移前：导出业务表 JSON 快照或使用 RDS 控制台备份。

关键业务表：

- `assessment_records`
- `assessment_drafts`
- `verification_logs`
- `verification_reviews`

发布前备份记录模板：

| 项目 | 记录 |
| --- | --- |
| 备份时间 |  |
| 执行人 |  |
| RDS 实例 |  |
| 备份类型 | 自动 / 手动 / 逻辑导出 |
| 备份 ID / 文件路径 |  |
| 是否验证可恢复 |  |

## 四、RDS 恢复演练

恢复演练不要直接在生产库执行。建议使用临时库：

1. 从最近备份恢复到临时实例或临时库。
2. 只读检查四张业务表行数。
3. 抽查 3 条评估记录和对应核验日志。
4. 抽查 1 条人工确认记录。
5. 记录恢复耗时和问题。

恢复演练验收：

| 验收项 | 结果 |
| --- | --- |
| 临时库创建成功 |  |
| 四张业务表存在 |  |
| 记录数量与备份时间点一致 |  |
| JSON 字段可读取 |  |
| 不影响生产库 |  |

## 五、OSS 备份与生命周期

OSS bucket 建议：

- 私有读写。
- 禁止公共读。
- 开启服务端加密。
- 开启版本控制或定期清单导出。
- 配置生命周期前，先确认业务证据保存期限。

证据对象命名应保持可追溯：

```text
verification-evidence/<clientInstanceId>/<recordId>/<fileName>
```

每周抽查：

- 最近 5 个附件对象存在。
- 签名 URL 可打开。
- PDF / 图片 MIME 类型正常。
- 业务记录中的附件 metadata 与 OSS 路径一致。

## 六、日志与告警

建议接入阿里云 SLS 或等价日志方案，至少采集：

- Node API stdout / stderr。
- Nginx access / error log。
- `/api/health` 检查结果。
- 智谱核验失败日志。
- OSS 上传失败日志。
- RDS 连接失败日志。

最低告警项：

| 告警 | 建议阈值 | 处理 |
| --- | --- | --- |
| `/api/health` 非 200 | 连续 3 次 | 检查 API 服务、Nginx、RDS |
| API 5xx | 5 分钟内超过 5 次 | 查看 Node 日志和最近发布 |
| RDS 连接失败 | 任意出现 | 检查白名单、账号、密码、连接数 |
| OSS 上传失败 | 5 分钟内超过 3 次 | 检查 RAM 权限、bucket、网络 |
| 智谱核验失败率升高 | 连续 10 条失败 | 检查 Key、余额、外网访问 |
| 磁盘使用率 | 超过 80% | 清理旧 release / 日志轮转 |

## 七、发布与回滚

发布前：

- `npm test` 通过。
- `npm run release:aliyun` 通过。
- `SUPABASE_DECOMMISSION_PHASE=final ... npm run decommission:supabase:gate` 已通过或已形成人工复核记录，并已保存 JSON / Markdown gate 报告。
- 发布包 SHA256 已记录。
- RDS 手动备份或自动备份时间已确认。
- OSS bucket 权限未变更。

发布后：

- 执行 `health:aliyun`。
- 执行 `smoke:aliyun:api-flow`。
- 手机微信扫码检查首屏、核验页、结果页。

回滚优先级：

1. 回滚到上一份阿里云 release。
2. 若 API 异常，恢复上一份 `.env` 或上一版 Node API。
3. 若前端异常，切回上一份 H5 静态目录。
4. PR24 后不再以 Supabase 作为常规回滚目标。

回滚记录：

| 项目 | 记录 |
| --- | --- |
| 回滚时间 |  |
| 执行人 |  |
| 原 release |  |
| 目标 release |  |
| 原因 |  |
| 验证命令 |  |
| 业务影响 |  |

PR24 去 Supabase 证据归档：

| 项目 | 记录 |
| --- | --- |
| release 名称 |  |
| release SHA256 |  |
| final gate JSON |  |
| final gate Markdown |  |
| RDS 备份 ID / 路径 |  |
| OSS 验收记录 |  |
| 人工复核人 |  |
| 是否保留 Supabase 只读周期 |  |

## 八、密钥轮换

建议轮换周期：

- RDS 密码：至少每 90 天或人员变更后。
- OSS RAM AccessKey：至少每 90 天或权限调整后。
- 智谱 API Key：按供应商安全策略或异常时立即轮换。

轮换流程：

1. 创建新 key / 新密码。
2. 更新 API `.env` 或 secret。
3. 重启独立 API 服务。
4. 执行 `health:aliyun`。
5. 执行附件上传 smoke。
6. 确认无误后禁用旧 key。

禁止：

- 把 key 写入 H5 静态目录。
- 把 key 贴到 PR、聊天、截图或 README。
- 在 CI 日志中打印 key。

## 九、故障处理

### 保存失败

检查顺序：

1. `/api/health` 是否 ready。
2. Node API 是否运行。
3. RDS 连接是否正常。
4. Nginx `/api` 代理是否指向正确端口。
5. 浏览器控制台是否是 CORS / 502 / 504。

### 核验一直 pending

检查顺序：

1. `ZHIPUAI_API_KEY` 是否配置。
2. 服务器能否访问智谱 API。
3. Node 日志是否有超时或余额错误。
4. `verification_logs` 是否写入 running / failed。
5. UI 是否读取同一条记录的日志。

### 附件打不开

检查顺序：

1. OSS 对象是否存在。
2. RAM 是否有 get / put 权限。
3. 签名 URL TTL 是否过短。
4. 业务记录中的 bucket / path 是否正确。
5. 文件 MIME 类型是否异常。

## 十、交接清单

PR24 完成后必须交接：

- 正式访问 URL 和二维码。
- 当前 release 名称和 SHA256。
- RDS 实例、库名、备份策略。
- OSS bucket、权限策略、生命周期策略。
- API 服务目录、端口、systemd / PM2 名称。
- Nginx 配置文件路径。
- 日志位置和告警联系人。
- 密钥存放位置和轮换负责人。
- 最近一次 `health:aliyun` 和 `smoke:aliyun:api-flow` 结果。
- 回滚到上一份阿里云 release 的命令和负责人。
