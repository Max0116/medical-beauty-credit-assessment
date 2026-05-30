# PR23 阿里云 Node API 运行时路线

本文用于在不影响现有业务项目的前提下，选择 `medical-credit-assessment` 的后端运行方式。当前服务器只读盘点显示：Docker 已安装并运行，`node` / `npm` 不在 shell PATH 中，`127.0.0.1:8787` 未被占用。因此 PR23 推荐优先使用 Docker 独立容器运行 Node API。

## 一、路线判断

| 路线 | 适用场景 | 风险 | 当前建议 |
| --- | --- | --- | --- |
| Docker 独立容器 | 服务器已有 Docker，想避免改宿主机 Node 环境 | 需要 Docker 镜像构建与容器运维 | 推荐 |
| 宝塔 Node 项目 | IT 熟悉宝塔 Node 项目管理 | 依赖宝塔插件和项目配置，需确认不会混入现有项目 | 可选 |
| 宿主机 Node LTS + systemd | 需要传统 systemd 运维 | 会改变宿主机运行时，需要 IT 明确安装范围 | 暂不优先 |

## 二、Docker 路线

前置要求：

- Docker 服务 active。
- 独立 API 目录为 `/www/wwwroot/medical-credit-api` 或 `/var/www/medical-credit-api`。
- `.env` 只放在 API 根目录，例如 `/www/wwwroot/medical-credit-api/.env`。
- Nginx 只代理 `/api/` 到 `http://127.0.0.1:8787/api/`。

如果只有宝塔 Web 终端，没有 SSH 上传能力，可以直接在服务器上从 GitHub 拉取已审核分支并在 Docker 内构建发布包。该脚本只做 versioned staging，不切 `current`，不改 Nginx，不重启服务：

```bash
CONFIRM_SOURCE_STAGING=yes \
SOURCE_BRANCH=codex/pr23-aliyun-rds-oss \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
API_ROOT=/www/wwwroot/medical-credit-api \
WORK_ROOT=/www/wwwroot/medical-credit-deploy-work \
bash ops/aliyun/stage-from-github-source.sh.example
```

脚本会把源码放入 `WORK_ROOT/source-<timestamp>`，发布包解包到 `H5_ROOT/releases/<release>` 和 `API_ROOT/releases/<release>`。只有 IT 确认 `.env`、RDS、OSS、Nginx `/api/` 后，才允许显式切换 `current`。

只读预检：

```bash
cd /www/wwwroot/medical-credit-api/current
MEDICAL_CREDIT_RUNTIME=docker \
H5_ROOT=/www/wwwroot/medical-credit-assessment \
API_ROOT=/www/wwwroot/medical-credit-api \
bash /www/wwwroot/medical-credit-api/ops/aliyun/preflight-release.sh.example
```

构建镜像：

```bash
cd /www/wwwroot/medical-credit-api/current
docker build \
  -f /www/wwwroot/medical-credit-api/ops/aliyun/Dockerfile.medical-credit-api \
  -t medical-credit-assessment-api:pr23 .
```

启动容器：

```bash
docker run -d \
  --name medical-credit-api \
  --restart unless-stopped \
  --env-file /www/wwwroot/medical-credit-api/.env \
  -e MEDICAL_CREDIT_PROXY_HOST=0.0.0.0 \
  -e MEDICAL_CREDIT_PROXY_PORT=8787 \
  -e PORT=8787 \
  -p 127.0.0.1:8787:8787 \
  medical-credit-assessment-api:pr23
```

也可以使用发布包内的受限启动脚本。它只允许本项目 API 根目录，只绑定 `127.0.0.1:8787`，并且如果同名容器已存在会直接停止，不会自动替换：

```bash
API_ROOT=/www/wwwroot/medical-credit-api \
bash /www/wwwroot/medical-credit-api/ops/aliyun/docker-run-medical-credit-api.sh.example
```

如果服务器支持 Docker Compose，也可以复制 `ops/aliyun/docker-compose.medical-credit-api.yml.example` 后使用：

```bash
docker compose -f /www/wwwroot/medical-credit-api/ops/aliyun/docker-compose.medical-credit-api.yml up -d --build
```

验收：

```bash
curl -sS http://127.0.0.1:8787/api/health
HEALTH_BASE_URL=http://101.132.137.25 HEALTH_EXPECT_READY=true npm run health:aliyun
```

回滚：

```bash
docker stop medical-credit-api
```

然后把 Nginx `/api/` 代理切回 PR22 Supabase 中转配置，或恢复上一份 Nginx 配置备份。

## 三、宝塔 Node 项目路线

如果 IT 选择宝塔 Node 项目：

- 项目目录必须指向独立 API release：`/www/wwwroot/medical-credit-api/current`。
- 启动命令：`npm start`。
- 运行端口：`8787`。
- 环境变量从 `/www/wwwroot/medical-credit-api/.env` 配置，不能写入 H5 目录。
- 项目名建议：`medical-credit-api`。

验收方式与 Docker 路线一致。

## 四、宿主机 Node LTS + systemd 路线

如果 IT 选择宿主机 Node：

- Node 版本必须 >= 20。
- `npm install --omit=dev --package-lock=false` 只在 API release 目录执行。
- systemd 服务名：`medical-credit-api`。
- systemd `WorkingDirectory` 指向 `/www/wwwroot/medical-credit-api/current` 或 `/var/www/medical-credit-api/current`。
- `EnvironmentFile` 指向 API 根目录 `.env`，不能指向 H5 目录。

执行前必须通过：

```bash
MEDICAL_CREDIT_RUNTIME=node bash ops/aliyun/preflight-release.sh.example
```

## 五、停止条件

- 需要修改既有业务项目目录。
- 需要复用 `gohomesh`、`mediverseai`、`maxfuture` 任意已有数据库。
- `127.0.0.1:8787` 被非本项目占用。
- `.env` 或密钥被放进 H5 静态目录。
- Nginx `nginx -t` 失败。
- Docker / Node 路线未被 IT 明确确认。
