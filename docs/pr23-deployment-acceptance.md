# PR23 阿里云 RDS / OSS 迁移验收清单

用于记录 PR23 从 Supabase 中转模式迁移到阿里云 RDS / OSS 模式的验收结果。PR23 不改风控评分规则，不删除 Supabase 回滚链路。

## 一、部署信息

| 项目 | 记录 |
| --- | --- |
| 部署日期 |  |
| 执行人 |  |
| 访问域名 / IP |  |
| 发布包名称 |  |
| 发布包 SHA256 |  |
| H5 目录 | `/var/www/medical-credit/current` |
| API 目录 | `/var/www/medical-credit-api/current` |
| API 端口 | `127.0.0.1:8787` |
| RDS 实例 / 库名 |  |
| OSS bucket |  |
| 初始运行模式 | `dual_write` |
| 目标运行模式 | `aliyun` |

## 二、环境变量确认

服务端 `.env` 只能放在 API 目录，不能复制进 H5 静态目录。

| 变量 | 是否已配置 | 备注 |
| --- | --- | --- |
| `MEDICAL_CREDIT_BACKEND_MODE` |  | 先 `dual_write`，后 `aliyun` |
| `MEDICAL_CREDIT_ALLOWED_ORIGINS` |  | 必须包含正式域名 |
| `ALIYUN_RDS_HOST` |  |  |
| `ALIYUN_RDS_DATABASE` |  |  |
| `ALIYUN_RDS_USER` |  |  |
| `ALIYUN_RDS_PASSWORD` |  | 不进入前端、不截图明文 |
| `ALIYUN_OSS_REGION` |  |  |
| `ALIYUN_OSS_BUCKET` |  | 私有 bucket |
| `ALIYUN_OSS_ACCESS_KEY_ID` |  | 最小权限 RAM |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` |  | 不进入前端、不截图明文 |
| `ZHIPUAI_API_KEY` |  | 服务端保存 |
| `ASSESSMENT_UPSTREAM_URL` |  | `dual_write` / `proxy` 回滚需要 |
| `ASSESSMENT_UPSTREAM_API_KEY` |  | 服务端保存 |

完成 `.env` 后执行只读 preflight：

```bash
cd /var/www/medical-credit-api/current
bash ops/aliyun/preflight-release.sh.example
```

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| preflight 未打印任何密钥明文 |  |  |
| `MEDICAL_CREDIT_BACKEND_MODE` 与预期一致 |  |  |
| `proxy` 模式已检查 Supabase 上游配置 |  |  |
| `dual_write` 模式已检查 RDS / OSS / 智谱 / Supabase 旁路配置 |  |  |
| `aliyun` 模式已检查 RDS / OSS / 智谱配置 |  |  |
| 没有 blocking failure |  |  |

## 三、发布包检查

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| SHA256 校验通过 |  |  |
| 发布包包含完整 `api/aliyun-api/` |  |  |
| 发布包包含 RDS migration |  |  |
| 发布包包含 `backup:supabase` |  |  |
| 发布包包含 `db:migrate:supabase-to-aliyun` |  |  |
| 发布包包含 `storage:migrate:supabase-to-oss` |  |  |
| 发布包包含 `migration:verify:aliyun` |  |  |
| API 目录已执行生产依赖安装 |  |  |

## 四、迁移命令记录

### 1. RDS 建表

```bash
npm run db:migrate:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `assessment_records` 已创建 |  |  |
| `assessment_drafts` 已创建 |  |  |
| `verification_logs` 已创建 |  |  |
| `verification_reviews` 已创建 |  |  |

### 2. 迁移前备份

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run backup:supabase
```

| 项目 | 记录 |
| --- | --- |
| 备份目录 |  |
| `manifest.json` |  |
| `assessment_records.json` 行数 |  |
| `assessment_drafts.json` 行数 |  |
| `verification_logs.json` 行数 |  |
| `verification_reviews.json` 行数 |  |
| `evidence-attachments.json` 数量 |  |

### 3. Dry-run

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run storage:migrate:supabase-to-oss

SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=true \
npm run db:migrate:supabase-to-aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| 附件 dry-run 输出 `discovered` |  |  |
| 数据 dry-run 输出各表 `fetched` |  |  |
| dry-run 无报错 |  |  |

### 4. 正式回填

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run storage:migrate:supabase-to-oss

SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
MIGRATE_DRY_RUN=false \
npm run db:migrate:supabase-to-aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| 附件上传成功数 |  |  |
| 附件失败数为 0 或已记录 |  |  |
| RDS 回填各表成功 |  |  |
| `SUPABASE_SERVICE_ROLE_KEY` 已从临时环境清理 |  |  |

### 5. 目标端验收

```bash
BACKUP_DIR=/path/to/backups/supabase-pre-aliyun-xxx \
VERIFY_OSS=true \
npm run migration:verify:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `migration:verify:aliyun` 输出 `ok: true` |  |  |
| RDS 行数至少覆盖备份 manifest |  |  |
| OSS 对象全部存在 |  |  |

## 五、运行模式验收

### dual_write 灰度

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=dual_write \
npm run health:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `/api/health` 返回 200 |  |  |
| `ready=true` |  |  |
| `mode=dual_write` |  |  |
| `backend.database=postgres` |  |  |
| `storage.configured=true` |  |  |
| `verification.configured=true` |  |  |

### aliyun 正式模式

```bash
HEALTH_BASE_URL=https://credit.xxx.com \
HEALTH_EXPECT_READY=true \
HEALTH_EXPECT_BACKEND_MODE=aliyun \
npm run health:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| `/api/health` 返回 200 |  |  |
| `ready=true` |  |  |
| `mode=aliyun` |  |  |

## 六、业务链路 Smoke

```bash
SMOKE_BASE_URL=https://credit.xxx.com \
SMOKE_EXPECT_API_READY=true \
SMOKE_EXPECT_BACKEND_MODE=aliyun \
npm run smoke:aliyun
```

| 验收项 | 结果 | 备注 |
| --- | --- | --- |
| H5 可打开 |  |  |
| 手机 390px 无横向滚动 |  |  |
| 控制台无明显错误 |  |  |
| 保存机构后 RDS 出现记录 |  |  |
| 自动生成核验日志 |  |  |
| 核验证据和原文链接可展示 |  |  |
| 人工确认后 `verification_reviews` 写入 |  |  |
| 上传截图 / PDF 到 OSS |  |  |
| 签名链接可打开 |  |  |
| 历史记录可展示最终等级 |  |  |

## 七、回滚记录

如果 PR23 异常，优先切回 `proxy` 模式，不删除 RDS / OSS / 备份。

```bash
MEDICAL_CREDIT_BACKEND_MODE=proxy
sudo systemctl restart medical-credit-api
```

如需回滚发布包：

```bash
RELEASE_NAME=<previous-release-name> \
sudo -E bash ops/aliyun/rollback-release.sh.example
```

| 回滚项 | 记录 |
| --- | --- |
| 是否发生回滚 |  |
| 回滚原因 |  |
| 回滚时间 |  |
| 回滚执行人 |  |
| 回滚后 `/api/health` |  |
| 回滚后 H5 smoke |  |
