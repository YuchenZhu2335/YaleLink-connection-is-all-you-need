# Yalelux 接口契约（前端 ↔ 后端）

实现：`server/*.js`；前端只通过 `YL.api.get / post` 调用（`web/js/core/api.js`）。改接口 = 同时改这里、后端实现、`tests/server/api.test.js`。

## 通用约定

- 地址前缀 `/api`。返回统一信封：成功 `{ ok: true, data }`，失败 `{ ok: false, error: { code, reason?, fields? } }`。
- 错误码与 HTTP 状态：`invalid` 400、`unauthorized` 401、`forbidden` 403、`not_found` 404、`conflict` 409、`too_large` 413、`rate_limited` 429、`internal` 500（前端网络失败为 `network`）。
- `fields`：表单逐项错误，如 `{ email: "not_yale" }`、`{ name: "required" }`、`{ q_interests: "too_many" }`（问卷题目的错误键是 `q_<题目 id>`）。
- 写请求必须 `Content-Type: application/json`，且来自本站（否则 `invalid / json_required`、`forbidden / bad_origin`）。
- 会话：登录成功后后端设置 httpOnly Cookie `yl_sid`（30 天）。前端不保存任何凭证。
- 鉴权级别：`none` 不需要登录；`user` 需要登录；`ready` 需要完成首次填写（同意当前版本的隐私说明 + 联系邮箱 + 资料），否则 `forbidden / profile_incomplete`；`admin` 管理员（环境变量 `ADMIN_EMAILS`，且本次用耶鲁邮箱登录）。
- 任何畸形请求（坏的 % 转义、超长 id、非对象 JSON、超过 100KB 的请求体）只会得到 400 / 404 / 413，不会影响服务。
- 所有写操作和管理员的查看都写审计日志。

## 公开信息

| 方法 | 路径 | 鉴权 | 入参 | 返回 data |
|---|---|---|---|---|
| GET | `/meta` | none | — | `{ consentVersion, dev, smartRecAvailable, questions }`；`questions` 即 `web/data/matchQuestions.json` 的题目数组；`dev` 为真时验证码打印在服务器终端 |
| GET | `/rounds/events` | none | — | 已发布的活动轮数组（见 RoundDTO + `open, upcoming, participants`），新的在前 |
| GET | `/rounds/:id` | none | — | 单个已发布轮次（同上） |

## 登录与账号

| 方法 | 路径 | 鉴权 | 入参 | 返回 data / 错误 |
|---|---|---|---|---|
| POST | `/auth/request-code` | none | `{ email, via? }`（`via: "yale"` 强制发到耶鲁邮箱） | `{ sent: true }`——**对任何邮箱都一样**，不透露是否注册过、发到了哪里（老用户默认发到已验证的联系邮箱；界面要一直提供"改发到耶鲁邮箱"）；错误 `fields.email = "not_yale"`、`rate_limited / resend_too_soon`（60 秒内重发）、`rate_limited / too_many_requests`（每小时上限）、`rate_limited / busy`（全站上限）、`internal / mail_failed`（邮件没发出去，可立即重试） |
| POST | `/auth/verify` | none | `{ email, code }` | `{ user: Me }`；错误 `fields.code = "wrong" \| "expired" \| "too_many_attempts"` |
| GET | `/auth/me` | none | — | `{ user: Me \| null }` |
| POST | `/auth/logout` | user | `{ all?: true }`（所有设备都退出） | `{ ok: true }` |
| GET | `/me` | user | — | `Me` |
| POST | `/me/consent` | user | `{ version }`（= `/meta` 的 `consentVersion`） | `Me` |
| POST | `/me/contact-email` | user | `{ email }` | `Me + { sentTo }`（发出验证码）；同一个已验证邮箱则直接返回 `Me`；换邮箱后其他设备的登录全部失效；错误 `fields.contactEmail = "invalid"`、`forbidden / reverify_yale`（已经填过联系邮箱之后再换，需要本次是用耶鲁邮箱登录的）、`rate_limited / resend_too_soon`、`internal / mail_failed` |
| POST | `/me/contact-email/verify` | user | `{ code }` | `Me`（验证后其他设备的登录失效）；错误同验证码、`conflict / email_changed` |
| POST | `/me/profile` | user | `{ name, identity: "student"\|"alumni", stage?, gradYear?, job?, city?, contactMethod, answers: { goals: [], interests: [], field: "", intro: "" } }` | `Me`；错误 `fields.*`：`required`、`too_long`、`invalid`、`q_<id>: required \| invalid \| too_many \| too_long` |
| POST | `/me/prefs` | user | `{ prefs: { invite_digest, reminder, weekly, event: bool }, smartRec: bool }` | `Me` |
| POST | `/me/delete` | user | `{ confirm: "DELETE" }` | `{ deleted: true }`（同时退出登录） |
| GET | `/email/unsubscribe?u&k&s` | none | 邮件里的签名链接 | HTML 确认页（只显示按钮，不改设置——邮件安全扫描器会自动打开链接） |
| POST | `/email/unsubscribe?u&k&s` | none | 表单提交或邮箱客户端的一键退订（RFC 8058） | HTML："已退订" |

`Me` = `{ id, loginEmail, contactEmail, contactVerified, via, needsConsent, needsContact, needsProfile, ready, isAdmin, adminNeedsYale, name, identity, stage, gradYear, job, city, contactMethod, answers, prefs, smartRec }`
- `via`：这次登录的验证码发到了哪里（`yale` / `contact`）
- `isAdmin`：管理员名单里**并且**本次用耶鲁邮箱登录；`adminNeedsYale = true` 表示在名单里但这次是用联系邮箱登录的（界面提示"用耶鲁邮箱重新登录才能进后台"）

## 约咖啡（全部需要 `ready`）

| 方法 | 路径 | 入参 | 返回 data / 错误 |
|---|---|---|---|
| GET | `/coffee/state` | — | `{ round: RoundDTO \| null, joined, slots: [slotId], participants, recsEnabled, locked: [slotId], incoming, matches }`（`incoming / matches` 是所有未结束轮次里的数量，用作角标） |
| POST | `/coffee/availability` | `{ slots: [slotId] }` | `{ id, slots, locked, joined }`。保存 = 参加这一轮；第一次至少要有一个还能约的时间；全部清空（且没有已约定的）= 退出这一轮（`joined: false`）；已约定的时段不能撤回；错误 `fields.slots = "invalid" \| "required"`、`conflict / round_closed`、`rate_limited / too_many_saves`（每天 40 次） |
| GET | `/coffee/recommendations` | — | 未开放：`{ enabled: false, threshold, participants, items: [] }`；开放：`{ enabled: true, engine: "rules"\|"deepseek"\|"rules_fallback", items: [Card + { reasons: [{zh,en}], overlap: [slotId], relation }] }`；错误 `forbidden / not_joined` |
| POST | `/coffee/recommendations/:id/dismiss` | — | `{ id }`（不再推荐这个人；只接受推荐里出现过的人） |
| GET | `/coffee/pool?identity&goal&interest&field` | 筛选都可选 | `[Card + { overlapCount, relation }]`，共同空闲多的在前；错误 `forbidden / not_joined`、`forbidden / browse_closed` |
| GET | `/coffee/people/:id` | — | `Card + { overlap: [slotId], relation }` |
| POST | `/coffee/invites` | `{ toId, note?（≤200 字）, source: "rec"\|"browse" }` | `{ id, matched }`（`matched: true` = 对方之前已邀请你，直接匹配——包括上一周还没结束的邀请）；错误 `conflict / already_invited \| already_matched \| round_closed`、`rate_limited / too_many_open`（所有进行中的轮合计最多 5 个；对方跳过的也算，直到那一轮结束）、`forbidden / not_joined \| self`、`not_found` |
| GET | `/coffee/inbox` | — | `{ incoming: [Card + { inviteId, note, createdAt, roundId }], outgoing: [Card + { inviteId, createdAt, roundId, state: "waiting" }] }` |
| POST | `/coffee/invites/:id/accept` 或 `/skip` | — | `{ id, status: "accepted"\|"skipped" }`；错误 `conflict / expired \| already_answered`、`forbidden / wrong_role` |
| GET | `/coffee/matches` | — | `[Card + { matchId, roundId, roundTitle, timezone, contactMethod, slot, scheduledBy: "me"\|"them"\|null, available: [slotId], canSchedule, myOutcome: "met"\|"missed"\|null, canReport }]` |
| POST | `/coffee/matches/:id/schedule` | `{ slot }`（`null` = 取消约定） | `{ id, slot }`（重复提交同一个时间不会重复发邮件）；错误 `conflict / slot_unavailable \| already_started \| not_matched` |
| POST | `/coffee/matches/:id/outcome` | `{ met: true\|false }` | `{ id, outcome }`；错误 `conflict / too_early` |
| POST | `/feedback` | `{ kind: "bug"\|"idea"\|"other", text（5–1000 字） }`（只需登录） | `{ id }` |

- `Card` = `{ id, name, identity, stage, gradYear, job, city, answers }`（`answers` 只含问卷里 `public: true` 的题目；**没有**邮箱和联系方式）
- 第三方看到的 `overlap` / `overlapCount` 只扣掉**查看者自己**已约定的时段；匹配双方的 `available` 扣掉两人在所有进行中的轮里已约定的时段
- 池子、推荐、详情里只有同意了当前版本隐私说明的人
- `relation` = `{ state: "none" \| "invited" \| "incoming" \| "matched" \| "no_reply", inviteId? }`（跨所有进行中的轮计算）
  - `invited` 我已邀请（对方跳过也显示这个——跳过不通知）；`incoming` 对方想认识我（我点"想认识"直接匹配）；`no_reply` 轮次已结束对方没回应
- `slotId` = `"YYYY-MM-DDTHH:MM"`，是轮次时区（`round.timezone`，默认 `America/New_York`）的墙上时间
- `RoundDTO` = `{ id, kind: "weekly"\|"event", title: {zh,en}, themeTags, startDate, endDate, timezone, dayStart, dayEnd, slotMinutes, gapMinutes, cutoffHours, recCount, maxOpenInvites, openBrowse, poolThreshold, post: { title, body, wechat } }`
- 时间表可以用 `YL.domain.coffee.slotIds(round)` 生成，`isClosed(round, slot, now)` 判断是否已过截止（开始前 12 小时）

## 管理（全部需要 `admin`：名单里的耶鲁邮箱 + 本次用耶鲁邮箱登录）

| 方法 | 路径 | 入参 | 返回 data |
|---|---|---|---|
| GET | `/admin/overview` | — | `{ users: { total, profileDone, contactVerified, smartRecOff }, round: { id, kind, title, participants, invites, pending, matches, skipped, scheduled, fromRecs, engines } \| null, allTime: { matches, met, missed }, emails7d: [{ kind, status, n }], feedback }` |
| GET | `/admin/rounds` | — | 轮次数组（RoundDTO + `status: "draft"\|"published"`） |
| POST | `/admin/rounds` | `{ id?（改已有活动轮）, title: {zh,en}, startDate, endDate, themeTags: [], recCount, openBrowse, status: "draft"\|"published", post: { title, body, wechat } }` | 保存后的轮次；错误 `fields.title / startDate / endDate`、`conflict / overlaps_event`（与另一个已发布活动轮时间重叠） |
| GET | `/admin/feedback` | — | `[{ id, kind, text, created_at, name }]` |
| GET | `/admin/emails` | — | `[{ id, kind, status: "sent"\|"failed"\|"skipped", error, created_at }]` |
| GET | `/admin/audit` | — | `[{ id, at, actor, op, target, ok, code }]` |

## 本地开发

| GET | `/dev/outbox` | none | 仅在非生产 + `MAIL_DRIVER=console` 时存在，并且只接受本机直接访问：最近 20 封"发出"的邮件，里面有验证码 |
|---|---|---|---|
