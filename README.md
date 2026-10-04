<p align="center">
  <img src="web/assets/logo.svg" width="72" alt="Yalelux">
</p>

<h1 align="center">Yalelux</h1>

<p align="center">
  <strong>Where Yale's light connects resources and ideas</strong><br>
  耶鲁之光，连接资源与想法 —— 耶鲁在校生与校友的开源社群平台
</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="docs/prd/yalelux-mvp.md">PRD</a> ·
  <a href="docs/api.md">接口</a> ·
  <a href="docs/design/system.md">设计规范</a> ·
  <a href="docs/engineering.md">开发规则</a> ·
  <a href="docs/rfcs/README.md">RFC</a> ·
  <a href="docs/deploy-china.md">部署</a>
</p>

---

名字呼应耶鲁校训 *Lux et Veritas*（光明与真理）。由耶鲁中国学生学者联合会（ACSSY）的志愿者开发和维护，代码开源。

## 第一期：Coffee Chat

量级要轻，和领英拉开距离：没有信息流、没有点赞关注、没有站内聊天。

1. **注册**：用耶鲁邮箱（`@yale.edu` / `@aya.yale.edu`）收验证码登录；再填一个常用的联系邮箱（国内同学收得到），填几道问卷、打几个标签。
2. **每周一轮**：勾几个这周有空的时间（美东 10:00–21:00，每次 15 分钟，旁边显示北京时间）。周六起开放下一周。
3. **推荐 + 自己挑**：池子满 20 人后先给你推荐 3 位（规则打分，可选 DeepSeek 辅助排序，只发匿名标签、可关闭）；也可以按身份 / 诉求 / 兴趣 / 领域自己逛。
4. **双向确认**：点「想认识」；对方也点了才算匹配。跳过不会通知对方。每人最多同时 5 个未回复的邀请。
5. **匹配之后**：双方看到彼此的联系方式（如微信）和共同空闲时间，点一下就约定，对方收到邮件；见面后点「见到了吗」。
6. **活动轮**：学联可以开「Coffee Chat 周 / 月」，活动页带文章和微信推文文案，不登录也能看，方便转发。
7. **邮件通知**：匹配成功即时发；「有人想认识你」每天最多一封汇总；约定前一天提醒；每周一提醒；活动开始通知。都能退订（匹配成功除外）。

完整需求、验收清单与上线计划见 [PRD](docs/prd/yalelux-mvp.md)。

## 在自己电脑上跑起来

只需要装 **Node.js 22 或更高版本**（[nodejs.org](https://nodejs.org) 下载 LTS 版）。不需要装数据库，也不需要任何账号。

```bash
git clone https://github.com/YuchenZhu2335/YaleLink-connection-is-all-you-need.git yalelux
cd yalelux
npm run seed     # 可选：放 24 位虚构的演示同学进本周这一轮，登录后马上能看到推荐
npm start        # 打开终端里打印的地址（默认 http://localhost:8787）
```

- **登录**：输入任意 `@yale.edu` 邮箱。本地不会真的发邮件——验证码会**打印在运行 `npm start` 的终端里**，也可以打开 `http://localhost:8787/api/dev/outbox` 查看。
- **演示账号**：`demo01@demo.yale.edu` … `demo24@demo.yale.edu`（验证码同样在终端里）。
- **管理后台**：复制 `server/.env.example` 为 `server/.env`，在 `ADMIN_EMAILS=` 后面填你的耶鲁邮箱，重启 `npm start`，登录后在「我的」里进入「管理」。
- **数据在哪**：`server/data/yalelux.sqlite`（一个文件；删掉它就是清空重来）。这个目录和 `server/.env` 都不会进 Git。

上线到服务器、配置真实发信（Resend）和 DeepSeek 的步骤见 [docs/deploy-china.md](docs/deploy-china.md)。

## 检查与测试

```bash
npm run check      # 问卷与词典校验 + 架构守门（前端 A1–A11、后端 S1–S4）+ 业务规则单测 + 后端接口测试（零依赖）
npm run test:e2e   # 浏览器端到端测试（需要先 npm ci）
```

测试名就是验收标准（中文），例如 `tests/server/api.test.js` 里的「约咖啡全流程：参加本轮 → 池子里想认识 → 对方想认识 → 匹配……」。

## 目录结构

```
server/              后端：Node 自带的 http + SQLite，零运行时依赖
  auth.js coffee.js admin.js   登录与账号 / 约咖啡 / 管理后台的接口
  jobs.js mailer.js recommend.js  定时任务 / 发信 / 推荐
  migrations/        数据库结构（按编号顺序执行）
web/                 网页（由后端一起提供，也是部署根目录）
  js/core/           平台基底：i18n · ui · registry · api · auth · router
  js/domain/         业务规则：纯函数，前后端共用，配单测
  js/modules/        每个功能一个文件：home · login · profile · coffee · events · admin · about
  data/matchQuestions.json   匹配问卷（改问卷 = 改这个文件，见下）
  css/ i18n/ assets/
docs/                PRD · 接口 · 设计 · 开发规则 · RFC · 部署
scripts/             校验与架构守门脚本
tests/               unit（规则）· server（接口）· smoke.spec.js（浏览器）
```

v0 静态原型里的职业、社群、学联后台等模块在 `main` 分支；本分支里它们的文件登记在 `scripts/parked.mjs`（暂停：不加载、不删除），以后一个模块一个 RFC 地迁回。

## 改问卷

匹配问卷完全由 `web/data/matchQuestions.json` 配置：题目、选项、哪些题公开、每题在推荐里的权重、互补关系、推荐理由的文案。同学设计好新问卷后，改这个文件提 PR；`npm run check` 会校验格式，后端启动时也会再校验一次。

## 治理

- `main` 受保护：所有改动走 Pull Request，维护者审核后合并（[CODEOWNERS](.github/CODEOWNERS)）。
- 新增模块、改核心层、改数据契约先写 [RFC](docs/rfcs/README.md)。开发规则见 [docs/engineering.md](docs/engineering.md)。
- 示例数据全部虚构；真实数据只在服务器上，不进仓库；密钥只放环境变量。

## 许可证

[MIT](LICENSE)
