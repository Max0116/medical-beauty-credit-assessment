# PR23 阿里云部署入口解锁请求

请 IT 协助为内部 H5 工具 `medical-credit-assessment` 解锁一个独立、安全、可回滚的部署入口。当前目标是把项目从 PR22 的 Supabase 中转链路推进到 PR23 的阿里云 RDS / OSS 灰度链路。

## 当前现象

- 外网 `http://101.132.137.25/` 可访问，当前仍是 PR22 兼容链路。
- 宝塔面板候选入口返回“安全入口校验失败”，说明入口路径不匹配。
- SSH `22` 端口可连通，但连接在认证前被服务器关闭，开发侧无法做只读盘点。

## 请先提供以下任一方式

方式一：提供当前宝塔真实入口。

```bash
# 请在服务器上执行，仅查看入口，不关闭安全入口
/etc/init.d/bt default
```

如果从阿里云控制台操作，可以进入：

```text
ECS 控制台 -> 实例 -> 远程连接 -> Workbench / VNC -> 服务器终端
```

然后复制执行：

```bash
echo "== 宝塔入口 =="
/etc/init.d/bt default

echo "== 当前登录用户 =="
whoami

echo "== 当前目录 =="
pwd
```

请把“宝塔入口”输出发回即可，不要截图或转发任何密码、AccessKey、API Key。

如果 PR23 发布包已经在服务器上，也可以在发布包目录执行同等只读脚本：

```bash
bash ops/aliyun/bt-entry-readonly.sh.example
```

方式二：提供独立 SSH 登录方式。

```text
服务器 IP：
SSH 端口：
用户名：
认证方式：密码 / 私钥
sudo 权限：允许执行只读盘点、创建独立目录、创建独立服务、reload 独立 Nginx 配置
```

## 权限边界

允许：

- 新增 `/var/www/medical-credit`
- 新增 `/var/www/medical-credit-api`
- 新增 `/var/www/medical-credit-deploy-work`
- 新增独立 Nginx 配置，例如 `medical-credit-assessment.conf`
- 新增独立 systemd 服务 `medical-credit-api`
- 使用独立 RDS PostgreSQL 库 `medical_credit`，或独立 MySQL 兼容库 `medical_credit_assessment`
- 使用独立私有 OSS bucket `medical-credit-verification-evidence`

禁止：

- 修改、移动、删除公司现有业务项目目录
- 覆盖已有 Nginx server 配置
- 关闭宝塔安全入口
- 把 RDS 密码、OSS AccessKey、智谱 Key、Supabase service role 放进 H5 静态目录或前端构建产物

## 拿到入口后的第一步

开发侧只执行只读盘点，不部署、不重启、不 reload、不写入现有项目。若发布包已经解压到服务器，进入发布包目录后执行：

```bash
bash ops/aliyun/server-inventory-readonly.sh.example > /tmp/medical-credit-inventory.txt
INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format
INVENTORY_REPORT_FILE=release/inventory/<report>.json npm run inventory:aliyun:gate
```

如果服务器上暂时还没有发布包，IT 可先只提供宝塔真实入口或 SSH；开发侧拿到后再上传 PR23 发布包并执行同一套只读盘点。

盘点通过后，才会进入 PR23 `dual_write` 灰度部署；如有异常，优先回滚到 `proxy` 模式，不删除 RDS / OSS / 备份。
