# PR23 阿里云服务器只读盘点记录表

本文用于在已有业务项目的阿里云服务器上部署 `medical-credit-assessment` 前，记录只读盘点结果。目标是确认新增 H5/API/RDS/OSS 迁移链路不会影响现有项目。

本表不要求填写任何密码、AccessKey、API Key、数据库密码或证书私钥。

## 一、操作边界

允许做：

- 登录服务器面板查看概览。
- 查看网站列表、站点根目录、域名绑定、SSL 状态。
- 查看 Nginx 配置摘要。
- 查看当前监听端口。
- 查看 Node.js、Nginx、systemd、PM2 是否存在。
- 执行只读脚本：`bash ops/aliyun/server-inventory-readonly.sh.example`。
- 截图或复制输出时对域名、路径做必要脱敏。

禁止做：

- 不点击删除、重装、修复、重启、重载、升级、卸载。
- 不修改现有站点配置。
- 不覆盖现有站点根目录。
- 不修改现有数据库、OSS bucket、证书或 DNS。
- 不把 `.env`、密码、AccessKey、智谱 Key、Supabase service role 复制到聊天或截图中。

## 二、服务器基本信息

| 项目 | 记录 |
| --- | --- |
| 盘点日期 |  |
| 盘点人 |  |
| 服务器公网 IP |  |
| 面板类型 | 宝塔 / aaPanel / 其他 |
| 操作系统 |  |
| Nginx 版本 |  |
| Node.js 版本 |  |
| npm 版本 |  |
| 是否存在 PM2 |  |
| 是否存在 systemd |  |

## 三、现有项目边界

| 现有站点 / 项目 | 域名 | 根目录 | 端口 / 反代 | SSL 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

判断：

| 问题 | 结论 |
| --- | --- |
| 是否存在与 `/var/www/medical-credit` 冲突的项目 | 是 / 否 |
| 是否存在与 `/var/www/medical-credit-api` 冲突的项目 | 是 / 否 |
| 是否存在与 `/www/wwwroot/medical-credit-assessment` 冲突的项目 | 是 / 否 |
| 是否存在与 `/www/wwwroot/medical-credit-api` 冲突的项目 | 是 / 否 |
| 是否允许新增独立 Nginx server 或独立 location | 是 / 否 / 待 IT 确认 |

## 四、推荐目标目录确认

| 用途 | 推荐目录 | 是否可用 | 备注 |
| --- | --- | --- | --- |
| H5 静态目录 | `/var/www/medical-credit` |  |  |
| Node API 目录 | `/var/www/medical-credit-api` |  |  |
| 宝塔 H5 备选目录 | `/www/wwwroot/medical-credit-assessment` |  |  |
| 宝塔 API 备选目录 | `/www/wwwroot/medical-credit-api` |  |  |
| 临时解包目录 | `/var/www/medical-credit-deploy-work` |  |  |

最终选择：

| 项目 | 记录 |
| --- | --- |
| 最终 H5 目录 |  |
| 最终 API 目录 |  |
| 最终发布方式 | systemd / PM2 / 宝塔 Node 项目 / 其他 |

## 五、端口与 Nginx 确认

| 项目 | 记录 |
| --- | --- |
| 80 是否已有监听 | 是 / 否 |
| 443 是否已有监听 | 是 / 否 |
| `127.0.0.1:8787` 是否空闲 | 是 / 否 |
| 如 8787 被占用，替代端口 |  |
| 是否可以新增 `/api/` 反代 | 是 / 否 / 待确认 |
| Nginx `nginx -t` 当前是否通过 | 是 / 否 |

拟新增 Nginx 规则：

```text
credit.xxx.com
  root -> H5 current directory
  /api/ -> http://127.0.0.1:<api-port>/api/
```

## 六、RDS / OSS / 密钥准备

| 项目 | 状态 | 备注 |
| --- | --- | --- |
| 独立 RDS PostgreSQL 已创建 |  |  |
| RDS 库名 `medical_credit` 已创建 |  |  |
| RDS 账号 `medical_credit_app` 已创建 |  |  |
| ECS 到 RDS 网络可达 |  |  |
| 独立 OSS bucket 已创建 |  |  |
| OSS bucket 为私有读写 |  |  |
| RAM 权限只允许目标 bucket |  |  |
| 智谱 Key 只准备放在服务端 `.env` |  |  |
| Supabase service role 只用于一次性迁移 shell |  |  |

## 七、只读脚本输出摘要

执行命令：

```bash
bash ops/aliyun/server-inventory-readonly.sh.example
```

粘贴摘要，注意不要贴密钥：

```text

```

## 八、上线判定

可以进入 PR23 部署的条件：

- 独立 H5 / API 目录已确认，不覆盖现有项目。
- API 端口已确认空闲，或替代端口已确认。
- Nginx 新增配置方式已确认，不覆盖现有站点。
- RDS / OSS / RAM 权限已准备或有明确负责人。
- 回滚方式已确认：`MEDICAL_CREDIT_BACKEND_MODE=proxy` 或回滚发布包。

| 判定项 | 结论 |
| --- | --- |
| 是否可以部署 PR23 `proxy` / `dual_write` 包 | 可以 / 暂停 |
| 首次运行模式 | `dual_write` |
| 是否允许执行 RDS migration | 可以 / 暂停 |
| 是否允许执行 Supabase 备份 | 可以 / 暂停 |
| 是否允许执行附件 dry-run | 可以 / 暂停 |
| 是否允许执行数据 dry-run | 可以 / 暂停 |

暂停原因：

```text

```

下一步：

```text

```
