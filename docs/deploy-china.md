# 部署 Yalelux（兼顾中国大陆访问）

Yalelux 是**一个 Node 进程 + 一个 SQLite 文件**：同一个端口同时提供网页和 `/api`。没有境外 CDN、没有外部字体，国内能直接打开。
上线只需要：一台小服务器、一个域名、一个发信服务。

## 1. 先在自己电脑上跑（现在就可以）

见 [README](../README.md#在自己电脑上跑起来)：装 Node 22 → `npm run seed` → `npm start`。验证码打印在终端里，不需要任何账号。

## 2. 服务器怎么选

| 方案 | 适合 | 国内访问 | 要不要 ICP 备案 |
|---|---|---|---|
| **A. 香港 / 新加坡的小 VPS**（腾讯云轻量、阿里云 ECS 香港等，1C1G–2C2G） | **第一期推荐** | 好 | 不需要 |
| B. 美国西部 VPS（包括你现在做 VPN 用的那台） | 内部测试 | 一般，偶尔慢 | 不需要 |
| C. 中国大陆服务器 | 以后用户主要在国内时 | 最好 | **需要**（域名备案，通常几周） |

**关于现有的美西 VPN 服务器**：可以拿来做内部测试；正式上线建议单独开一台，原因是
1）VPN 服务器的 IP 有被墙的风险，会连带网站打不开；2）VPN 往往占用 443 端口，和网站的 HTTPS 冲突；3）挂在个人账号下不方便交接，最好用 ACSSY 的账号开、费用走学联。

## 3. 域名

- 用学联已有域名的子域名，例如 `coffee.acssy.org`：在 DNS 里加一条 A 记录指向服务器 IP。
- 不建议注册带 "yale" 的域名：可能涉及耶鲁的商标政策和 ITS 的审批。产品名本身含 "Yale"，也建议上线前向学校确认一次（见 PRD 的待确认事项）。

## 4. 发信

- 推荐 [Resend](https://resend.com)（免费额度每月 3000 封，够第一期用）：在 Resend 里验证发信域名（按提示加 SPF / DKIM 记录），拿到 API key。
- 发往 `yale.edu`（Google 托管）和国内邮箱（QQ / 163）都要配好 SPF、DKIM、DMARC，否则容易进垃圾箱。上线前给自己的 QQ 邮箱、163 邮箱、yale 邮箱各发一次验证码测试。
- 联系邮箱的意义就在这里：国内同学不常看耶鲁邮箱，匹配和提醒发到他们常用的邮箱。

## 5. 部署步骤（Ubuntu 22.04 / 24.04）

```bash
# 1) 安装 Node 22 和 Caddy（自动 HTTPS 的反向代理）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git caddy

# 2) 拿代码
sudo mkdir -p /srv && cd /srv
sudo git clone https://github.com/YuchenZhu2335/YaleLink-connection-is-all-you-need.git yalelux
sudo useradd --system --home /srv/yalelux yalelux && sudo chown -R yalelux /srv/yalelux

# 3) 配置（只在服务器上，不进 Git）
sudo -u yalelux cp /srv/yalelux/server/.env.example /srv/yalelux/server/.env
sudo -u yalelux nano /srv/yalelux/server/.env
```

`server/.env` 至少要填：

```ini
NODE_ENV=production
PUBLIC_URL=https://coffee.acssy.org
APP_SECRET=（运行 openssl rand -hex 32 生成）
TRUST_PROXY=1
ADMIN_EMAILS=你的耶鲁邮箱,另一位负责人的耶鲁邮箱
MAIL_DRIVER=resend
MAIL_FROM=Yalelux <noreply@coffee.acssy.org>
RESEND_API_KEY=re_...
# 可选：智能推荐
# DEEPSEEK_API_KEY=sk-...
```

```bash
# 4) 开机自启：/etc/systemd/system/yalelux.service
sudo tee /etc/systemd/system/yalelux.service >/dev/null <<'UNIT'
[Unit]
Description=Yalelux
After=network.target

[Service]
User=yalelux
WorkingDirectory=/srv/yalelux
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now yalelux

# 5) HTTPS：/etc/caddy/Caddyfile 写一行，Caddy 会自动申请证书
echo 'coffee.acssy.org {
  reverse_proxy localhost:8787
}' | sudo tee /etc/caddy/Caddyfile && sudo systemctl reload caddy

# 6) 每天备份数据库（保留 30 份；再把 /srv/yalelux/server/data/backups 同步到别处）
echo '30 4 * * * yalelux cd /srv/yalelux && /usr/bin/node server/backup.js' | sudo tee /etc/cron.d/yalelux-backup
```

更新版本：`cd /srv/yalelux && sudo -u yalelux git pull && sudo systemctl restart yalelux`（数据库结构的变更会在启动时自动执行 `server/migrations/` 里新的文件）。

## 6. 上线前检查清单

- [ ] `npm run check` 全绿；在服务器上 `curl https://coffee.acssy.org/api/meta` 返回 `"dev": false`
- [ ] 用 yale 邮箱、aya 邮箱各注册一次；验证码邮件在 yale 邮箱、QQ 邮箱、163 邮箱都能收到（不在垃圾箱）
- [ ] 在国内手机网络、微信内置浏览器里打开首页、登录、选时间、发邀请
- [ ] 管理员能进后台；新建并发布第一个活动轮，活动页能转发到微信群
- [ ] 隐私说明的版本号（`CONSENT_VERSION`）和内容已由负责人确认
- [ ] 服务器开了防火墙（只放行 22、80、443），备份 cron 生效

## 7. 合规要点

- 《个人信息保护法》：注册时明示收集目的（隐私说明 + 同意）；提供注销（"我的" → 注销账号，立即删除）；只收集业务必需的字段。
- 数据出境：服务器在境外时，国内用户的数据存在境外；智能推荐会把**匿名**问卷答案发给 DeepSeek（境内）。两点都已写进隐私说明，DeepSeek 可在"我的"里关闭。
- 以后把服务器搬到大陆时：需要 ICP 备案；评估跨境传输（美国用户数据进入境内）。
