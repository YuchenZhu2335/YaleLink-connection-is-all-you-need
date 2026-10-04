# 开发规则 / Engineering rules

YaleLink 由一届届同学接力维护。这份文档把"核心框架怎么拆、技术栈怎么定、代码怎么做到可审计、新模块怎么搭、协作怎么走"写清楚。
能机器检查的规则都写进了 CI（规则编号 A1–A10 对应 `scripts/check-architecture.mjs`），人只需要审机器看不了的部分。

## 一页纸

1. **分四层，依赖只能往下**：界面 `modules` → 接口 `api` → 业务规则 `domain`；平台内核 `core` 谁都能用。
2. **写数据只有一条路**：新模块只通过 `YL.api.get / post` 读写业务数据；每条接口就是一份后端契约。
3. **规则只写一次**：状态机、权限、校验、限额都在 `web/js/domain/<模块>.js`，是纯函数，必须有单测；浏览器、校验脚本、将来的 Node 后端共用这一份。
4. **界面不判断权限**：能点哪些按钮，由接口返回的 `actions` / `state` 决定。
5. **每个写操作都留痕**：谁、何时、对哪条、做了什么、是否被允许；只记 id 和动作，不记正文。
6. **初期守住复杂度预算**（见 §6）：不做实时、不做聊天、不做支付、不做定时任务。
7. **提交前跑 `npm run check`**，改界面再跑 `npm run test:e2e`；CI 全绿 + 维护者审核才能合并。

## 1. 分层：核心框架怎么拆

```
web/
  config.js            部署配置（邮箱白名单、apiBase、数据清单）
  js/core/             平台内核 —— 维护者负责，改动需要 RFC
    i18n · ui · registry · audit · store · auth · api · router
  js/domain/<id>.js    业务规则 —— 纯函数，浏览器 / 校验脚本 / 后端共用，必须有单测
  js/api/<id>.js       接口实现 —— 原型版"后端"，YL.api.route(...)，用 YL.store 持久化
  js/modules/<id>.js   界面 —— registerModule(...)，只渲染与交互
  data/*.json          示例数据（虚构）
  i18n/{zh,en}.json    界面词典
```

```
  modules/coffee.js ──YL.api.get/post──▶ core/api.js ──本地模式──▶ api/coffee.js ──▶ domain/coffee.js
        │                                    │                         │
        └── YL.ui / i18n / auth / router     └─ apiBase 填了 → fetch    └─ YL.store（演示数据）+ YL.audit（审计）
                                                 到真实后端（同一份契约）
```

| 层 | 可以用 | 不可以 | 机器检查 |
|---|---|---|---|
| `domain` | 只用参数 | DOM、存储、网络、任何 `YL.*`、`YL_CONFIG`；自己取当前时间（`Date.now()` / `new Date()`）或随机数 | A1；必须有单测 A10 |
| `api` | `YL.domain`、`YL.store`、`YL.api.route / fail` | DOM、`YL.ui`、`YL.router`、直接 `fetch`、直接 `localStorage` | A2 |
| `modules` | `YL.api`、`YL.ui`、`YL.i18n`、`YL.auth`、`YL.router`、`YL.domain`（只读常量与纯函数）、字典表 `YL.store.term / terms / region / regions` | 直接读写存储与网络；新模块用 `YL.store` 读写业务数据；调用其他模块的内部函数 | A3 A4 A5 |
| `core` | 浏览器 API | 依赖任何模块 | 人审 + RFC |

- **模块之间**只用路由链接跳转（如目录页"约咖啡"→ `#/coffee/p/u01`），或调用白名单里的公开接口（`YL.careers.postCard`、`YL.careers.postForm`、`YL.acssy.openWizard`）。新增公开接口要在 PR 里说明并更新 [modules.md](modules.md)。
- **装载顺序**即分层顺序：`index.html` 里 config → core → domain → api → modules → app（A7）。
- **存量模块**（home、careers、events、circles、acssy、startup、life、directory、profile、login）还在直接读写 `YL.store`，列在守门脚本的 `LEGACY_STORE_MODULES` 里。接后端前逐个迁到 `YL.api`，迁完一个就从名单里删掉它——名单只减不增。

## 2. 技术栈

| 层 | 现在（v0.1 原型） | 接后端（v0.2） | 约束与理由 |
|---|---|---|---|
| 前端 | 原生 HTML / CSS / JS，零依赖、零构建 | 不变 | 门槛低，交接容易；不引框架和打包器 |
| 业务规则 | 纯 JS（UMD 包装），`node --test` 单测 | 后端直接 `require` 同一个文件 | 规则写一次，前后端一致 |
| 接口层 | `YL.api` 本地模式：浏览器内路由 + localStorage | `config.apiBase` 指向后端，同一份契约走 HTTP | 模块代码不用改 |
| 后端 | — | **Node.js 22 LTS + Hono + PostgreSQL**，单体，Docker 部署 | 与前端同语言、能复用 domain；Hono 的路由写法（`/coffee/bookings/:id/accept`）与 `YL.api.route` 一致 |
| 登录 | 邮箱白名单 + 演示验证码 | 邮箱验证码（服务端校验白名单、限频）+ httpOnly 会话 Cookie | `@yale.edu` / `@aya.yale.edu` 邮箱就是身份认证 |
| 通知 | 站内通知（原型） | 站内 + 事务邮件（配置 SPF / DKIM / DMARC） | 收件地址 = 登录时验证过的邮箱 |
| 测试 | 数据校验 · 架构守门 · 单测 · Playwright | + 后端接口测试（按同一份契约） | 全部进 CI |
| 部署 | GitHub Pages / COS / OSS 静态托管 | 自有域名 + 云服务器 + 托管 PostgreSQL（每日备份） | 不用 `*.vercel.app` 这类在国内常被墙的子域；境内长期运营见 [deploy-china.md](deploy-china.md) |

国内可达是硬约束：不加载任何境外 CDN、Web 字体、第三方脚本（A8）；接入的任何外部服务（邮件、监控）都要先确认在国内能用。

"零依赖、零构建"约束的是浏览器加载的 `web/`。后端代码（v0.2 起放在本仓库 `server/`，这样能直接 `require` 同一份 `web/js/domain/*.js`）可以有少量依赖（Web 框架、数据库驱动、发信客户端），每加一个都在 PR 里说明理由并锁定版本；密钥只放部署环境变量，不进仓库。

## 3. 模块底子：一个功能怎么搭

**只读、没有业务规则的模块**（指南、资源列表）：一个文件 `web/js/modules/<id>.js` 即可。

**有写操作或状态流转的模块**：三个同名文件（参考实现：coffee）——

| 文件 | 写什么 | 怎么验证 |
|---|---|---|
| `web/js/domain/<id>.js` | 状态机表、权限判断、字段校验、限额；纯函数，时间和 id 由参数传入 | `tests/unit/<id>.test.js`（A10 强制） |
| `web/js/api/<id>.js` | 每个动作一条 `YL.api.route`；顺序固定为：取当前用户 → 校验输入 → 读数据 → 调 domain 判断 → 写数据 → 返回 DTO | 端到端测试；"关于"页自动列出契约 |
| `web/js/modules/<id>.js` | 渲染与交互；`await` 之后先检查 `ctx.isActive()`；错误用 `YL.ui.errorText(err, "<id>")` | Playwright |

另外：数据文件 `web/data/<集合>.json` 登记进 `config.js` 的 `dataFiles`；种子数据的校验写进 `scripts/validate-data.mjs`（能用 domain 规则校验的就直接调用）；词典两边加 key；`index.html` 三层各加一行。

**模块生命周期**：功能提案（Issue）→ RFC（`docs/rfcs/`，写清范围、状态机、数据、接口、分工）→ 原型（本仓库，本地模式可点击）→ 内测（真实后端，限定人群和时间）→ 正式。

## 4. 接口约定

- **路径即资源，动作用动词子路径**：`GET /coffee/bookings`、`POST /coffee/bookings`、`POST /coffee/bookings/:id/accept`。不提供通用的"改任意字段"（PATCH）接口——每个动作单独一条，后端才知道该校验什么、该记什么审计。
- **返回格式统一**：`{ ok: true, data }` 或 `{ ok: false, error: { code, reason?, fields? } }`。
- **错误码与 HTTP 状态一一对应**：`invalid` 400 · `unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `conflict` 409 · `rate_limited` 429 · `internal` 500。`reason` 给出具体原因（如 `slot_taken`），`fields` 给出字段错误（如 `{ note: "too_long" }`），界面据此显示文案。
- **DTO 由服务端裁剪**：列表只给公开字段；私密字段（邮箱、联系方式、会议链接）按规则只给有权限的人。服务端顺带算好 `role`、`actions`、`state`，界面照着显示。
- **与你无关的记录一律 `not_found`**，不泄露它存在与否。
- **并发**：同一资源只能被占一次的场景（如时段），后端用唯一索引兜底，冲突返回 `409 conflict`。
- **演示专用接口**以 `/_demo/` 开头并标 `demo: true`，不属于后端契约。

## 5. 可审计：代码和数据都能追溯

| 手段 | 落在哪里 |
|---|---|
| **单一写路径**：新模块的所有写操作都经过 `YL.api` | A4 检查；本地模式下 `core/api.js` 自动记审计 |
| **状态机是一张表**：谁、在什么状态、能做什么，写在 `TRANSITIONS` 里，单测逐行覆盖 | `web/js/domain/*.js` + `tests/unit/` |
| **审计日志**：`{ actor, op, target, ok, code, at }`；被拒绝的尝试也记；管理员查看数据的读接口标 `audit: true` | `core/audit.js`；个人页"操作记录"可见；真实版写只追加的 `audit_log` 表 |
| **记录自带历史**：每次状态变化追加一条 `history`（时间、操作者、动作、前后状态） | domain 的 `transition()` |
| **种子数据也守规则**：校验脚本用同一份 domain 规则校验示例数据，并用状态机重放每条历史 | `scripts/validate-data.mjs` |
| **代码变更可追溯**：PR + CODEOWNERS 审核 + CI；核心层改动先写 RFC | `.github/` |

隐私最小化：审计日志只记 id 和动作，不记留言、联系方式等正文；示例数据必须虚构（邮箱一律 `@example.com`，校验脚本会检查）。

## 6. 复杂度预算（v0.x 阶段）

为了让后端"好干"，初期每个模块守住这些边界；超出需要在 RFC 里写明理由，由维护者拍板：

- 不做实时推送（WebSocket）和站内聊天——平台负责"牵线与组织"，聊天留在微信（见 [vision.md](vision.md)）；
- 不做支付、文件上传、第三方 SDK；
- 不做定时任务：和时间有关的状态（过期、截止）在读取时计算；
- 不跨模块写数据：一个模块只写自己的集合；
- 一个模块的接口控制在十来条、数据表控制在五张以内，状态机控制在一屏能看完。

## 7. 代码规范

- **文案**：界面文案全部走 `t(key)`，数据里的双语字段走 `L()`；中英两份词典 key 必须一致（校验脚本检查）。
- **转义**：插入 HTML 的动态内容一律 `esc()`；数据里的链接用 `YL.ui.safeUrl()`（`esc` 挡不住 `javascript:` 链接，A9 检查）；`t()` 的 key 含动态部分时，结果也要 `esc()`，或者先把动态部分限定在白名单里。
- **异步渲染**：`render` 可以是 `async`；每次 `await` 之后先检查 `ctx.isActive()`。
- **禁止**：`eval`、`new Function`、`document.write`（A9）。
- **样式**：优先复用 `css/components.css`，新增类名用 BEM；新模块不写内联样式。
- **注释**：写"为什么"，不写"做了什么"；中文为主，公共接口附一句英文。

## 8. 测试与 CI

| 命令 | 内容 | 耗时 |
|---|---|---|
| `npm run validate` | JSON 结构、id 唯一、双语齐全、引用完整、词典一致、种子数据符合业务规则 | 秒级 |
| `npm run lint:arch` | 架构规则 A1–A10 | 秒级 |
| `npm run test:unit` | `node --test`：业务规则与接口层单测（零依赖） | 秒级 |
| `npm run check` | 以上三项 | 秒级 |
| `npm run test:e2e` | Playwright：登录门槛、语言切换、全部路由、学联后台、coffee chat 全流程、截图 | 十秒级 |

CI 先跑 `check`，通过后再跑端到端。改了业务规则却没改单测、或者单测没跟上，PR 不予合并。

## 9. 协作流程

- **分支**：从 `main` 拉 `feat/<模块>-<事>`、`fix/<事>`、`docs/<事>`；外部贡献者 fork。
- **提交信息**：中文或英文都行，第一行说做了什么，正文说为什么；一个提交只做一件事。
- **PR**：填模板；一个 PR 只做一件事，界面改动附截图；CI 全绿后由 CODEOWNERS 审核。
- **负责人**：每个模块在 `.github/CODEOWNERS` 里写一位负责人；核心层（`web/js/core/`、`scripts/`、`.github/`）由维护者负责。
- **RFC**：新增模块、改动核心层、改变数据契约前，先在 `docs/rfcs/` 写一页（模板见 [rfcs/README.md](rfcs/README.md)），会上或 Issue 里讨论通过再动手。
- **数据边界**：真实校友数据、学联内部信息、密钥一律不进本仓库（见 [CONTRIBUTING.md](../CONTRIBUTING.md) §6）。

## 10. 哪些交给机器，哪些靠人审

| 规则 | 机器（CI） | 人审 |
|---|---|---|
| 分层依赖、单一写路径、模块注册、装载顺序、国内可达、危险 API、外链、单测存在 | ✅ A1–A10 | — |
| 数据结构、双语、引用、词典一致、示例数据合规 | ✅ validate | — |
| 业务规则正确 | ✅ 单测 | 审单测是否覆盖了 RFC 里的每条规则 |
| 隐私：哪些字段公开、哪些接受后可见 | — | ✅ 审 DTO（`api/<id>.js` 里的裁剪函数） |
| 文案、交互、可访问性 | 部分（E2E） | ✅ 截图 + 试用 |
| 是否超出复杂度预算 | — | ✅ 对照 RFC |

---

## English summary

Four layers with one-way dependencies — `modules` (UI) → `api` (the contract; the in-browser mock backend) → `domain` (pure business rules, unit-tested, shared with a future Node backend) — plus the `core` kernel. New modules read and write business data only through `YL.api`, so pointing `config.apiBase` at a real backend changes no module code. Every write is audited (who, when, what, allowed or not — never content). Rules A1–A10 are enforced by `scripts/check-architecture.mjs`; data and dictionaries by `scripts/validate-data.mjs`; behaviour by `node --test` and Playwright. Proposed backend stack: Node.js 22 + Hono + PostgreSQL, email-code sign-in, transactional email, no foreign CDNs. Keep v0.x modules small: no realtime, chat, payments, uploads or cron jobs.
