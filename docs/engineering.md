# 开发规则 / Engineering rules

Yalelux 由一届届同学接力维护。这份文档把"核心框架怎么拆、技术栈怎么定、代码怎么做到可审计、新模块怎么搭、协作怎么走"写清楚。
能机器检查的规则都写进了 CI（前端 A1–A11、后端 S1–S4，对应 `scripts/check-architecture.mjs`），人只需要审机器看不了的部分。
上线版的架构决定见 [RFC 0002](rfcs/0002-yalelux-launch.md)。

## 一页纸

1. **前端分层，依赖只能往下**：界面 `modules` → 业务规则 `domain`；平台内核 `core` 谁都能用。
2. **写数据只有一条路**：模块只通过 `YL.api.get / post` 读写业务数据；每条接口写在 [api.md](api.md)，实现在 `server/`。
3. **规则只写一次**：状态机、权限、校验、限额都在 `web/js/domain/<模块>.js`，是纯函数，必须有单测；浏览器和 Node 后端 `require` 同一个文件。
4. **界面不判断权限**：能点哪些按钮，由接口返回的状态决定（例如 `relation.state`、`canSchedule`）；后端每个接口自己再校验一遍。
5. **每个写操作都留痕**：后端自动写审计日志（谁、何时、对哪条、做了什么、是否被允许）；只记 id 和动作，不记正文。管理员的查看也留痕。
6. **零依赖**：后端只用 Node 内置模块，前端只用浏览器原生能力；不引框架、打包器、境外 CDN。
7. **守住复杂度预算**（见 §6）：不做实时、不做聊天、不做支付、不做上传。
8. **提交前跑 `npm run check`**，改界面再跑 `npm run test:e2e`；CI 全绿 + 维护者审核才能合并。

## 1. 分层：核心框架怎么拆

```
server/                后端：一个 Node 进程，同时提供 web/ 和 /api
  app.js               装配（配置 → 数据库 → 规则 → 发信 → 路由）
  http.js              路由、会话 Cookie、CSRF、安全响应头、审计、静态文件
  auth.js coffee.js admin.js   各功能的接口：读库 → 调 domain 规则 → 写库 → 发信
  jobs.js mailer.js recommend.js db.js migrations/
web/
  config.js            前端部署配置（apiBase、站点名）
  js/core/             平台内核 —— 维护者负责，改动需要 RFC
    i18n · ui · registry · api · auth · router
  js/domain/<id>.js    业务规则 —— 纯函数，前后端共用，必须有单测
  js/modules/<id>.js   界面 —— registerModule(...)，只渲染与交互
  data/matchQuestions.json  匹配问卷配置（前后端共用）
  i18n/{zh,en}.json    界面词典
```

```
  modules/coffee.js ──YL.api.get/post──▶ core/api.js ──HTTP──▶ server/coffee.js ──▶ domain/coffee.js
        │                                                           │
        └── YL.ui / i18n / auth / router / YL.domain（只读）           └─ SQLite（db.js）+ 审计 + mailer
```

| 层 | 可以用 | 不可以 | 机器检查 |
|---|---|---|---|
| `domain` | 只用参数 | DOM、存储、网络、任何 `YL.*`、`YL_CONFIG`；自己取当前时间（`Date.now()` / `new Date()`）或随机数 | A1；必须有单测 A10 |
| `modules` | `YL.api`、`YL.ui`、`YL.i18n`、`YL.auth`、`YL.router`、`YL.registry`、`YL.domain`（只读常量与纯函数） | 直接读写存储与网络；调用其他模块的内部函数 | A3 A4 A5 |
| `core` | 浏览器 API | 依赖任何模块 | 人审 + RFC |
| `server` | Node 内置模块、`server/` 文件、`web/js/domain` | 任何 npm 依赖；SQL 拼接变量；管理员接口漏写 `auth: "admin"`；密钥写进代码 | S1–S4 + 接口测试 |

- **模块之间**只用路由链接跳转（如推荐卡 → `#/coffee/p/<id>`）。`PUBLIC_MODULE_API` 白名单目前为空。
- **装载顺序**即分层顺序：`index.html` 里 config → core → domain → modules → app（A7）。
- **暂停的 v0 文件**（职业、社群、学联后台等旧原型模块，以及 `store.js`、`audit.js`）登记在 `scripts/parked.mjs`：不加载、不检查、不删除（A11）。迁回某个模块 = 写 RFC → 按 `YL.api` 改写 → 从名单移出。名单只减不增。

## 2. 技术栈

| 层 | 选型 | 约束与理由 |
|---|---|---|
| 前端 | 原生 HTML / CSS / JS，零依赖、零构建 | 门槛低，交接容易；微信内置浏览器兼容好 |
| 业务规则 | 纯 JS（UMD 包装），`node --test` 单测 | 规则写一次，前后端一致 |
| 后端 | **Node.js 22 内置 `node:http` + `node:sqlite`**，零运行时依赖 | 本地 `npm start` 就能跑；没有供应链风险；同学只需会 JS |
| 数据库 | SQLite 单文件（WAL），`server/migrations/*.sql` 按编号执行 | 第一期规模绰绰有余；备份 = `npm run backup`；以后换 PostgreSQL 只改 `db.js` |
| 登录 | 耶鲁邮箱验证码 + httpOnly 会话 Cookie（库里只存 token 的哈希）；联系邮箱验证后可收验证码；每年用耶鲁邮箱重新验证 | 邮箱就是身份认证；国内同学收得到 |
| 通知 | 事务邮件：本地 `console` 驱动，线上 Resend；可退订（匹配成功除外） | 不做站内消息中心 |
| 推荐 | 问卷配置驱动的规则打分；可选 DeepSeek 重排（只发匿名答案，可关闭，失败退回规则） | 成本低、可解释 |
| 测试 | 校验 · 架构守门 · 规则单测 · 接口测试 · Playwright | 全部进 CI |
| 部署 | 一台小 VPS + Caddy（自动 HTTPS）+ systemd，见 [deploy-china.md](deploy-china.md) | 国内可达；不依赖境外 CDN |

国内可达是硬约束：不加载任何境外 CDN、Web 字体、第三方脚本（A8）；字体文件随站点自托管。

## 3. 模块底子：一个功能怎么搭

| 文件 | 写什么 | 怎么验证 |
|---|---|---|
| `web/js/domain/<id>.js` | 状态机、权限判断、字段校验、限额；纯函数，时间和 id 由参数传入 | `tests/unit/<id>.test.js`（A10 强制） |
| `server/<id>.js` | 每个动作一条 `app.route(...)`；顺序固定：取当前用户 → 校验输入 → 读数据 → 调 domain 判断 → 写数据 → 发信 → 返回裁剪过的 DTO | `tests/server/*.test.js`（真起服务、临时数据库） |
| `web/js/modules/<id>.js` | 渲染与交互；`await` 之后先检查 `ctx.isActive()`；错误用 `YL.ui.errorText(err, "<id>")`、字段错误用 `showFieldErrors` | Playwright |

另外：接口写进 [api.md](api.md)；数据库结构改动加一个新的 `server/migrations/NNN_*.sql`（不改旧文件）；词典两边加 key；`index.html` 加一行；页面只用 [组件 class](design/components.md)。

**模块生命周期**：功能提案（Issue）→ RFC（`docs/rfcs/`）→ 实现（domain + server + module + 测试）→ 内测 → 正式。

## 4. 接口约定

- **路径即资源，动作用动词子路径**：`POST /coffee/invites`、`POST /coffee/invites/:id/accept`。不提供通用的"改任意字段"接口——每个动作单独一条，后端才知道该校验什么、该记什么审计。
- **返回格式统一**：`{ ok: true, data }` 或 `{ ok: false, error: { code, reason?, fields? } }`。
- **错误码与 HTTP 状态一一对应**：`invalid` 400 · `unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `conflict` 409 · `rate_limited` 429 · `internal` 500。`reason` 给具体原因（如 `too_many_open`），`fields` 给字段错误（如 `{ note: "too_long" }`）。
- **DTO 由服务端裁剪**：列表只给公开字段；联系方式只给双方都点了"想认识"的人；服务端顺带算好 `relation`、`canSchedule` 等状态。
- **与你无关的记录一律 `not_found`**，不泄露它存在与否。
- **写请求只收 JSON、校验来源**（CSRF）；会话 Cookie `HttpOnly; SameSite=Lax`，线上加 `Secure`。

## 5. 可审计：代码和数据都能追溯

| 手段 | 落在哪里 |
|---|---|
| **单一写路径**：所有写操作都经过 `server/` 的接口 | A3 + 接口测试 |
| **规则是纯函数 + 单测**：测试名就是规则（中文） | `web/js/domain/*.js` + `tests/unit/` |
| **审计日志**：`{ at, actor, op, target, ok, code }`，被拒绝的尝试也记；管理员的查看也记 | `audit_log` 表；后台「审计」页 |
| **发信记录**：每封邮件的类型、状态、错误 | `emails` 表；后台「邮件」页 |
| **问卷可配置**：改匹配逻辑先改 `matchQuestions.json`，启动时校验 | `validateQuestions` |
| **代码变更可追溯**：PR + CODEOWNERS 审核 + CI；核心层改动先写 RFC | `.github/` |

隐私最小化：审计日志只记 id 和动作，不记留言、联系方式等正文；示例数据必须虚构（邮箱一律 `@example.com`）。

## 6. 复杂度预算（v0.x 阶段）

- 不做实时推送（WebSocket）和站内聊天——平台负责"牵线"，聊天留在微信；
- 不做支付、文件上传、第三方 SDK；
- 定时任务只有一个（`server/jobs.js`，进程内每 10 分钟，重复执行是安全的）；其余和时间有关的状态（过期、截止）在读取时计算；
- 一个模块的接口控制在十几条、数据表控制在五张左右，状态机控制在一屏能看完。

## 7. 代码规范

- **文案**：界面文案全部走 `t(key)`（key 以模块 id 开头），数据里的双语字段走 `L()`；中英两份词典 key 必须一致（校验脚本检查）。
- **转义**：插入 HTML 的动态内容一律 `esc()`；数据里的链接用 `YL.ui.safeUrl()`（A9）；`t()` 的 key 含动态部分时，结果也要 `esc()`。
- **样式**：只用 [components.md](design/components.md) 里的 class；颜色、字号用 `tokens.css` 的变量；不写内联样式；图标用 `YL.ui.icon()`，不用 emoji。
- **异步渲染**：`render` 可以是 `async`；每次 `await` 之后先检查 `ctx.isActive()`。
- **禁止**：`eval`、`new Function`、`document.write`（A9）；SQL 拼接（S2）。
- **注释**：写"为什么"，不写"做了什么"；中文为主，公共接口附一句英文。

## 8. 测试与 CI

| 命令 | 内容 | 耗时 |
|---|---|---|
| `npm run validate` | 问卷配置、词典一致、代码里用到的 key 都存在 | 秒级 |
| `npm run lint:arch` | 架构规则 A1–A11、S1–S4 | 秒级 |
| `npm run test:unit` | 业务规则单测 | 秒级 |
| `npm run test:server` | 后端接口测试（真起服务、临时数据库、console 发信） | 秒级 |
| `npm run check` | 以上四项 | 秒级 |
| `npm run test:e2e` | Playwright：注册全流程、约咖啡双向确认、管理员发布活动、手机与电脑截图 | 十秒级 |

## 9. 协作流程

- **分支**：从 `main` 拉 `feat/<模块>-<事>`、`fix/<事>`、`docs/<事>`；外部贡献者 fork。
- **提交信息**：第一行说做了什么，正文说为什么；一个提交只做一件事。
- **PR**：填模板；界面改动附手机和电脑截图；CI 全绿后由 CODEOWNERS 审核。
- **RFC**：新增模块、改动核心层、改变数据契约前，先在 `docs/rfcs/` 写一页。
- **数据边界**：真实用户数据、学联内部信息、密钥一律不进本仓库（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## 10. 哪些交给机器，哪些靠人审

| 规则 | 机器（CI） | 人审 |
|---|---|---|
| 分层依赖、单一写路径、模块注册、装载顺序、国内可达、危险 API、外链 | ✅ A1–A11 | — |
| 后端零依赖、SQL 占位符、管理员鉴权、密钥不进库 | ✅ S1–S4 | — |
| 问卷配置、词典一致 | ✅ validate | — |
| 业务规则与接口行为 | ✅ 单测 + 接口测试 | 审测试是否覆盖了 PRD 里的每条规则 |
| 隐私：哪些字段公开、哪些匹配后可见 | 部分（接口测试） | ✅ 审 `server/coffee.js` 的 `card()` 等裁剪函数 |
| 文案、交互、可访问性 | 部分（E2E） | ✅ 截图 + 试用 |

---

## English summary

Front end: `modules` (UI) → `domain` (pure business rules, unit-tested, `require`d by the server too) plus the `core` kernel; modules talk to the backend only through `YL.api`. Back end: one zero-dependency Node 22 process (`node:http` + `node:sqlite`) serving both `web/` and `/api`, with cookie sessions, CSRF checks, security headers, an append-only audit log, a console/Resend mailer and an optional DeepSeek re-ranker that only sees anonymized answers. Rules A1–A11 (front) and S1–S4 (server) are enforced by `scripts/check-architecture.mjs`; behaviour by unit tests, API integration tests and Playwright. No foreign CDNs or fonts; keep modules small: no realtime, chat, payments or uploads.
