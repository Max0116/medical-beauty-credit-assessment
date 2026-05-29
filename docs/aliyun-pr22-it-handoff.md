# PR22 阿里云部署 IT 交接单

本文用于把 `medical-credit-assessment` 部署到阿里云国内入口。PR22 只做 **H5 + `/api` 中转**，不迁数据库、不迁附件、不改变风控评分规则。

## 一、部署边界

必须遵守：

- 不改动公司现有业务项目目录。
- 不覆盖现有 Nginx 站点配置。
- 不删除任何历史文件或发布包。
- 不把 Supabase / 智谱 / 阿里云密钥放进 H5 静态目录。
- 只新增独立目录、独立 Node 服务、独立 Nginx server 或独立 location。

推荐独立目录：

| 用途 | 路径 |
| --- | --- |
| H5 静态文件 | `/var/www/medical-credit` |
| Node API 中转 | `/var/www/medical-credit-api` |
| 临时解包目录 | `/var/www/medical-credit-deploy-work` |
| systemd 服务 | `/etc/systemd/system/medical-credit-api.service` |

如公司服务器使用宝塔，允许改用：

| 用途 | 路径 |
| --- | --- |
| H5 静态文件 | `/www/wwwroot/medical-credit-assessment` |
| Node API 中转 | `/www/wwwroot/medical-credit-api` |

## 二、需要 IT 提供的信息

| 项目 | 说明 |
| --- | --- |
| 服务器登录方式 | SSH 主机、端口、用户名，或宝塔面板入口 |
| 域名 | 已备案子域名，例如 `credit.xxx.com` |
| SSL 证书 | 阿里云证书路径，或是否由宝塔/证书服务自动签发 |
| Node.js | 建议 Node.js 20+ |
| Nginx | 确认可新增独立 server 配置或独立 location |
| 出网能力 | 服务器必须能访问 Supabase Function 和智谱 API |
| 防火墙 | 对外开放 80/443；`8787` 只监听 `127.0.0.1`，不对外开放 |

## 三、发布包

开发侧生成：

```bash
npm run release:aliyun
```

产物：

```text
release/medical-credit-assessment-pr22-<sha>-<timestamp>.tar.gz
release/medical-credit-assessment-pr22-<sha>-<timestamp>.tar.gz.sha256
```

上传到服务器后，先校验 SHA256，再部署。

## 四、部署命令

以下命令只写入独立 medical-credit 目录。

```bash
RELEASE_ARCHIVE=/tmp/medical-credit-assessment-pr22-xxx.tar.gz \
RELEASE_SHA256=/tmp/medical-credit-assessment-pr22-xxx.tar.gz.sha256 \
sudo -E bash ops/aliyun/deploy-release.sh.example
```

部署脚本完成后，需要人工创建或更新 API 环境变量：

```bash
sudo cp /var/www/medical-credit-api/ops/aliyun/medical-credit-api.env.example \
  /var/www/medical-credit-api/.env
sudo vi /var/www/medical-credit-api/.env
```

必须配置：

```bash
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.xxx.com
ASSESSMENT_UPSTREAM_URL=https://<project-ref>.supabase.co/functions/v1/assessments
ASSESSMENT_UPSTREAM_API_KEY=<server-side-key>
```

## 五、Nginx 与服务

HTTP 模板：

```text
ops/aliyun/nginx-medical-credit.conf.example
```

HTTPS 模板：

```text
ops/aliyun/nginx-medical-credit-https.conf.example
```

systemd 模板：

```text
ops/aliyun/medical-credit-api.service.example
```

部署后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable medical-credit-api
sudo systemctl restart medical-credit-api
sudo nginx -t
sudo systemctl reload nginx
```

## 六、验收

服务器侧：

```bash
curl -i https://credit.xxx.com/api/health
```

本地开发机侧：

```bash
SMOKE_BASE_URL=https://credit.xxx.com npm run smoke:aliyun
SMOKE_BASE_URL=https://credit.xxx.com SMOKE_FULL_FLOW=true npm run smoke:aliyun
QR_URL=https://credit.xxx.com/?v=pr22 npm run qr:aliyun
```

通过标准：

- `/api/health` 返回 `200` 和 `{ "ok": true }`。
- 手机视口无横向滚动。
- 控制台无明显错误。
- 保存机构后，前端请求同域 `/api/records`。
- 核验日志能在 UI 中显示。
- 前端构建产物中没有 Supabase Function URL、Supabase key、智谱 key。

## 七、回滚

回滚只切换 `current` 软链接，不删除发布包。

```bash
RELEASE_NAME=<previous-release-name> \
sudo -E bash ops/aliyun/rollback-release.sh.example

sudo systemctl restart medical-credit-api
sudo nginx -t
sudo systemctl reload nginx
```

回滚后再次验证：

```bash
curl -i https://credit.xxx.com/api/health
```

