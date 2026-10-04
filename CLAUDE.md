# Yalelux — 给 AI 辅助贡献者的项目约定

## 项目是什么
**Yalelux**（原 YaleLink，呼应校训 Lux et Veritas；tagline: *Where Yale's light connects resources and ideas*）是 ACSSY 志愿者为耶鲁在校生与校友做的开源社群平台。
第一期只上线 **Coffee Chat**：耶鲁邮箱登录 → 联系邮箱 → 问卷资料 → 每周一轮选空闲时间 → 推荐 / 按标签找人 → "想认识"双向确认 → 匹配后看联系方式与共同时间、一键约定；外加活动轮（Coffee Chat 周 / 月）与活动页、邮件通知、管理后台。
需求见 `docs/prd/yalelux-mvp.md`，架构决定见 `docs/rfcs/0002-yalelux-launch.md`，接口契约见 `docs/api.md`，开发规则见 `docs/engineering.md`。

## 硬性约束
- **零依赖**：`server/` 只用 Node 22 内置模块（`node:http`、`node:sqlite`…）；`web/` 是原生 HTML/CSS/JS，不引入 npm 运行时依赖、打包器、框架；不引用境外 CDN、不加载外部字体（要在中国大陆可访问）。
- 前端分层，依赖只能往下：`modules`（界面）→ `domain`（纯函数业务规则，前后端共用）；`core` 谁都能用。
  - 业务数据只通过 `YL.api.get / post` 读写（对应 `server/*.js` 的接口）；模块里不许 fetch / localStorage；
  - 状态机、权限、校验写在 `web/js/domain/<id>.js`，不碰 DOM / 存储 / 网络 / 当前时间，配 `tests/unit/<id>.test.js`；
  - 界面不自己判断权限，按接口返回的状态显示按钮；`await` 之后先检查 `ctx.isActive()`；
  - 模块之间只用路由链接（`PUBLIC_MODULE_API` 白名单目前为空）。
- 后端：SQL 一律 `?` 占位符；管理员接口声明 `auth: "admin"`；每个写操作自动审计；密钥只放 `server/.env`（不进仓库）。
- 所有可见文案走 `YL.ui.t(key)`（key 以模块 id 开头），数据中的双语字段 `{zh, en}` 用 `YL.ui.L()`；两份词典 key 必须一致。
- 所有插入 HTML 的动态内容必须 `esc()`；数据里的链接用 `YL.ui.safeUrl()`；不写内联样式，只用 `docs/design/components.md` 里的组件 class；图标用 `YL.ui.icon()`，不用 emoji。
- 一个功能 = 一个模块 id：`web/js/modules/<id>.js`；`index.html` 按 core → domain → modules 的顺序各加一行 `<script>`。
- 新增模块、改核心层、改数据契约之前先写 RFC（`docs/rfcs/`）。
- v0 静态原型的旧模块登记在 `scripts/parked.mjs`（不加载、不检查、不删除），迁回时按 RFC 改写成 `YL.api` 版本。

## 目录速查
- `server/`：`app.js`（装配）、`http.js`（路由、会话、CSRF、安全头、审计）、`auth.js`、`coffee.js`、`admin.js`、`jobs.js`（定时邮件）、`mailer.js`、`recommend.js`（规则 + 可选 DeepSeek）、`db.js` + `migrations/`、`seed.js`。
- `web/js/core/`：i18n、ui（图标、表单报错、弹窗、复制）、registry（导航、角标）、api（HTTP）、auth（镜像后端登录状态）、router（requiresAuth / requiresReady / adminOnly）。
- `web/js/modules/`：home、login、profile（首次填写 + 我的）、coffee、events、admin、about。
- `web/data/matchQuestions.json`：匹配问卷（题目、权重、互补、推荐理由），前后端共用。
- `docs/`：prd、api、design（brief / system / components）、engineering、rfcs、deploy-china。

## 验证
```bash
npm run check        # 问卷与词典校验 + 架构守门（A1–A11、S1–S4）+ 规则单测 + 后端接口测试，全部零依赖
npm run test:e2e     # Playwright：tests/smoke.spec.js（会自己起一个临时数据库的服务；需要 npm ci）
npm run seed && npm start   # 本地运行，默认 http://localhost:8787；验证码打印在终端，或看 /api/dev/outbox
```

## 演示与测试约定
- 本地发信驱动是 `console`：邮件不发出，打印在终端并保留在 `/api/dev/outbox`（仅本地存在）。
- `npm run seed` 生成 24 位虚构用户 `demo01…demo24@demo.yale.edu`（联系邮箱 `@example.com`），都已参加当前报名中的每周轮。
- 管理员 = `server/.env` 的 `ADMIN_EMAILS`。
- 每周轮按美东时间周一到周日；周六起报名下一周。涉及时间的测试要固定时间或用 `signupWeek(now)` 计算。
- 示例数据全部虚构，不要加入真实联系人；示例邮箱一律 `@example.com`。
