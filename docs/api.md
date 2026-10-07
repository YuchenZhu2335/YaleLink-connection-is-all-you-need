# Yalelux 接口契约（前端 ↔ 后端）

实现：`server/*.js`；前端只通过 `YL.api.get / post` 调用（`web/js/core/api.js`）。改接口 = 同时改这里、后端实现、`tests/server/api.test.js`。

## 通用约定

- 地址前缀 `/api`。返回统一信封：成功 `{ ok: true, data }`，失败 `{ ok: false, error: { code, reason?, fields? } }`。
- 错误码与 HTTP 状态：`invalid` 400、`unauthorized` 401、`forbidden` 403、`not_found` 404、`conflict` 409、`too_large` 413、`rate_limited` 429、`internal` 500（前端网络失败为 `network`）。
- `fields`：表单逐项错误，如 `{ email: "not_yale" }`、`{ name: "required" }`、`{ q_interests: "too_many" }`（问卷题目的错误键是 `q_<题目 id>`）。
- 写请求必须 `Content-Type: application/json`，且来自本站（否则 `invalid / json_required`、`forbidden / bad_origin`）。唯一例外是上传简历 `POST /me/resume`：请求体就是 PDF 文件本身，必须 `Content-Type: application/pdf`（否则 `invalid`，`fields.resume = "not_pdf"`），来源同样要是本站。
- 会话：登录成功后后端设置 httpOnly Cookie `yl_sid`（30 天）。前端不保存任何凭证。
- 鉴权级别：`none` 不需要登录；`user` 需要登录；`consented` 需要登录并同意了当前版本的隐私说明（会写入个人信息的接口：资料、联系邮箱、邮件开关、意见箱、上传简历和简历可见范围），否则 `forbidden / needs_consent`（隐私说明升版后，重新同意之前同样被拒）；`ready` 需要完成首次填写（同意当前版本的隐私说明 + 联系邮箱 + 资料），否则 `forbidden / profile_incomplete`；`admin` 管理员（环境变量 `ADMIN_EMAILS`，且本次用耶鲁邮箱登录）。没登录时一律 `unauthorized`。
- **嘉宾**（RFC 0003 §5）：管理员登记过的非耶鲁邮箱（`guest_emails`）可以像耶鲁邮箱一样收验证码登录。下文的"耶鲁邮箱"对嘉宾来说就是他的登录邮箱：用登录邮箱收码的会话 `via` 也是 `"yale"`。
- 要求"本次是用耶鲁邮箱登录的"（`Me.via === "yale"`）的操作：换联系邮箱（已经填过之后）、改资料里的 `contactMethod`（已经填过、并且值真的变了）、注销账号；否则 `forbidden / reverify_yale`，界面提示用耶鲁邮箱重新登录。
- 任何畸形请求（坏的 % 转义、超长 id、非对象 JSON、超过 100KB 的请求体）只会得到 400 / 404 / 413，不会影响服务。上传简历的请求体上限单独放宽到 5 MB（超过 → 413 `too_large`，`fields.resume = "too_large"`），其他接口仍是 100KB。
- 所有写操作和管理员的查看都写审计日志。例外：没有用户编号的失败请求一律不记（没登录、不是 JSON、跨站来源、坏 JSON / 请求体太大、登录验证码错误、退订签名无效……），防止匿名请求刷大日志；登录用户的失败照记。
- 每个带有效会话的请求都记一次访问（每人每个 UTC 日最多写一次库，见 `docs/data-model.md` 的 `user_visits`），用于后台的 7 日回访；不改变任何返回。

## 公开信息

| 方法 | 路径 | 鉴权 | 入参 | 返回 data |
|---|---|---|---|---|
| GET | `/meta` | none | — | `{ consentVersion, dev, smartRecAvailable, questions }`；`questions` 即 `web/data/matchQuestions.json` 的题目数组；`dev` 为真时验证码打印在服务器终端 |
| GET | `/rounds/events` | none | — | 已发布的活动轮数组（见 RoundDTO + `open, upcoming, participants`），新的在前；`participants` 和约咖啡首页、后台概览同一个口径：保存了空闲时间、资料完整、同意了当前版本隐私说明的人数 |
| GET | `/rounds/:id` | none | — | 单个已发布轮次（同上） |

## 登录与账号

| 方法 | 路径 | 鉴权 | 入参 | 返回 data / 错误 |
|---|---|---|---|---|
| POST | `/auth/request-code` | none | `{ email, via? }`（`email` 是耶鲁邮箱或管理员登记过的嘉宾邮箱；`via: "yale"` 强制发到耶鲁邮箱；上一次是不带 `via` 的普通请求时，可以不等 60 秒立即改发一次——只看上一次是不是 `via: "yale"`，不看实际发到了哪里，所以不泄露是否注册） | `{ sent: true }`——**对任何邮箱都一样**，不透露是否注册过、发到了哪里（老用户默认发到已验证的联系邮箱——联系邮箱就是登录邮箱时按登录邮箱算，这次登录 `via = "yale"`；界面要一直提供"改发到耶鲁邮箱"）；错误 `fields.email = "not_yale"`（不是耶鲁邮箱、也不在嘉宾名单里——这会透露某个非耶鲁邮箱有没有被登记为嘉宾，RFC 0003 §5 接受这一点）、`rate_limited / resend_too_soon`（60 秒内重发）、`rate_limited / too_many_requests`（每小时上限）、`rate_limited / busy`（全站上限）、`internal / mail_failed`（邮件没发出去，可立即重试） |
| POST | `/auth/verify` | none | `{ email, code }` | `{ user: Me }`；错误 `fields.code = "wrong" \| "expired" \| "too_many_attempts"`、`fields.email = "not_yale"`（验证时再查一次嘉宾名单：登记删掉之后，手里还没用的验证码也建立不了新会话） |
| GET | `/auth/me` | none | — | `{ user: Me \| null }` |
| POST | `/auth/logout` | user | `{ all?: true }`（所有设备都退出） | `{ ok: true }` |
| GET | `/me` | user | — | `Me` |
| POST | `/me/consent` | user | `{ version }`（= `/meta` 的 `consentVersion`） | `Me` |
| POST | `/me/contact-email` | consented | `{ email }` | `Me + { sentTo }`（发出验证码）；同一个已验证邮箱则直接返回 `Me`；**和登录邮箱相同**（嘉宾通常如此）时不发验证码，直接算已验证、返回 `Me`（没有 `sentTo`），和正常验证一样让其他设备下线；换邮箱后其他设备的登录全部失效；错误 `forbidden / needs_consent`、`fields.contactEmail = "invalid"`、`forbidden / reverify_yale`（已经填过联系邮箱之后再换，需要本次是用耶鲁邮箱登录的）、`rate_limited / resend_too_soon \| too_many_requests`（每人每小时 5 次）、`internal / mail_failed` |
| POST | `/me/contact-email/verify` | consented | `{ code }` | `Me`（验证后其他设备的登录失效）；错误 `forbidden / needs_consent`、同验证码、`conflict / email_changed` |
| POST | `/me/profile` | consented | `{ name, preferredName?, identity: "student"\|"alumni"\|"guest", stage?, gradYear?, program?, job?, city?, meetMode, meetPlace?, freeText?, contactMethod, answers: { goals: [], interests: [], field: "", intro: "" } }`（见下方"资料字段"） | `Me`；错误 `forbidden / needs_consent`；`fields.*`：`required`、`too_long`、`invalid`、`q_<id>: required \| invalid \| too_many \| too_long`（先校验字段）；`fields.identity = "invalid"`：选了 `guest` 但不是嘉宾（`Me.isGuest` 为假）；`forbidden / reverify_yale`：已经填过联系方式、这次的 `contactMethod`（去掉首尾空格后）和原来不同、并且本次不是用耶鲁邮箱登录的（第一次填写不限；联系方式不变时改别的资料不限）。被拒时整份资料都没有保存 |
| POST | `/me/prefs` | consented | `{ prefs: { invite_digest, reminder, weekly, event: bool }, smartRec: bool }` | `Me`；错误 `forbidden / needs_consent` |
| POST | `/me/resume` | consented | 请求体 = PDF 文件本身，`Content-Type: application/pdf`，最大 5 MB | `Me`（`resume` 是新的）；替换时删掉旧文件；文件名随机、原文件名不保存；错误 `fields.resume = "not_pdf"`（类型不对，或文件开头不是 `%PDF-`）\| `"empty"`、413 `too_large`（`fields.resume = "too_large"`）、`rate_limited / too_many_uploads`（每人每天 20 次，被拒的也算）、`forbidden / needs_consent` |
| POST | `/me/resume/settings` | consented | `{ visibility: "invited"\|"all" }` | `Me`；没有简历时也可以先设好；错误 `fields.visibility = "invalid"` |
| POST | `/me/resume/delete` | user | — | `Me`（`resume: null`）；立即删掉文件；没有简历也返回成功；不要求先同意隐私说明 |
| GET | `/me/resume` | user | — | 本人的简历文件（响应头同 `/coffee/people/:id/resume`）；没有 → `not_found` |
| POST | `/me/delete` | user | `{ confirm: "DELETE" }` | `{ deleted: true }`（同时退出登录；简历文件立即删掉；嘉宾邮箱的登记不动）；不要求先同意隐私说明；错误 `fields.confirm = "required"`、`forbidden / reverify_yale`（本次不是用耶鲁邮箱登录的） |
| GET | `/email/unsubscribe?u&k&s` | none | 邮件里的签名链接 | HTML 确认页（只显示按钮，不改设置——邮件安全扫描器会自动打开链接） |
| POST | `/email/unsubscribe?u&k&s` | none | 表单提交或邮箱客户端的一键退订（RFC 8058） | HTML："已退订" |

`Me` = `{ id, loginEmail, contactEmail, contactVerified, via, needsConsent, needsContact, needsProfile, ready, isAdmin, adminNeedsYale, name, preferredName, identity, stage, gradYear, program, job, city, meetMode, meetPlace, freeText, contactMethod, answers, prefs, smartRec, role, isGuest, resume }`
- `via`：这次登录的验证码发到了哪里（`yale` = 登录邮箱，对嘉宾就是他登记的邮箱 / `contact`）
- `preferredName / program / meetMode / meetPlace / freeText`：没填过是 `""`（迁移 005 之前填的资料也是 `""`，下次保存资料时 `meetMode` 必填）
- `role`：`"member"` \| `"mentor"`（管理员在后台标记）；`isGuest`：能不能选身份"嘉宾"——登录邮箱在嘉宾名单里，或者不是耶鲁邮箱（只可能是登记过才登进来的；名单删掉以后已有会话照样能以嘉宾身份改资料）
- `resume`：`{ size, uploadedAt, visibility: "invited"\|"all" }`，没有简历是 `null`
- `isAdmin`：管理员名单里**并且**本次用耶鲁邮箱登录；`adminNeedsYale = true` 表示在名单里但这次是用联系邮箱登录的（界面提示"用耶鲁邮箱重新登录才能进后台"）

### 资料字段（RFC 0003；规则在 `web/js/domain/coffee.js` 的 `validateProfile / cleanProfile`）

| 字段 | 谁填 | 规则 | 谁能看 |
|---|---|---|---|
| `name` | 所有人 | 必填，≤ 40 字，单行 | 资料卡 |
| `preferredName` | 所有人 | 选填，≤ 40 字，单行（英文名 / 常用称呼，卡片上显示"王五 · Wu"） | 资料卡 |
| `identity` | 所有人 | `student` \| `alumni` \| `guest`；`guest` 只有 `Me.isGuest` 为真才能选 | 资料卡 |
| `stage` | 在读 | `undergrad` \| `master` \| `phd` \| `postdoc` \| `other` | 资料卡 |
| `program` | 在读 | 必填，≤ 80 字，单行（项目 / 研究方向，不要缩写） | 资料卡 |
| `gradYear` | 在读 | 本科 / 硕士 / 博士必填（今年到今年 + 7）；博士后、其他可以不填（`null` 或 `""`），填了也要在这个范围 | 资料卡 |
| `job`、`city` | 校友、嘉宾 | 必填，≤ 80 / 60 字，单行 | 资料卡 |
| `meetMode` | 所有人 | 必填：`online`（线上）\| `newhaven`（纽黑文线下）\| `either`（都可以） | 资料卡 |
| `meetPlace` | 所有人 | 选填，≤ 200 字，单行（Zoom 链接，或纽黑文的店名和地址） | **匹配后**才给对方（`/coffee/matches`） |
| `freeText` | 所有人 | 选填，≤ 500 字，**可以换行**：去掉控制字符和改变文字方向的字符，连续 3 个以上换行并成 2 个，去掉首尾空白；长度按清洗后算 | 资料卡（界面只在个人页和收件箱显示）；**不发给 DeepSeek** |
| `contactMethod` | 所有人 | 必填，≤ 80 字，单行 | **匹配后**才给对方 |

切换身份时另一种身份的字段清空：在读才有 `stage / gradYear / program`，校友和嘉宾才有 `job / city`。`role` 和简历不能通过 `/me/profile` 改。

## 约咖啡（除了 `/feedback`，全部需要 `ready`）

| 方法 | 路径 | 入参 | 返回 data / 错误 |
|---|---|---|---|
| GET | `/coffee/state` | — | `{ round: RoundDTO \| null, joined, slots: [slotId], participants, recsEnabled, locked: [slotId], incoming, matches }`（`incoming / matches` 是所有未结束轮次里的数量，用作角标） |
| POST | `/coffee/availability` | `{ slots: [slotId] }` | `{ id, slots, locked, joined }`。保存 = 参加这一轮；第一次至少要有一个还能约的时间；全部清空（且没有已约定的）= 退出这一轮（`joined: false`）；已约定的时段不能撤回；错误 `fields.slots = "invalid" \| "required"`、`conflict / round_closed`、`rate_limited / too_many_saves`（每天 40 次） |
| GET | `/coffee/recommendations` | — | 未开放：`{ enabled: false, threshold, participants, items: [] }`；开放：`{ enabled: true, engine: "rules"\|"deepseek"\|"rules_fallback", items: [Card + { reasons: [{zh,en}], overlap: [slotId], relation }] }`；错误 `forbidden / not_joined` |
| POST | `/coffee/recommendations/:id/dismiss` | — | `{ id }`（不再推荐这个人；只接受推荐里出现过的人） |
| GET | `/coffee/pool?identity&goal&interest&field&mentor` | 筛选都可选；`mentor=1` 只看导师 | `[Card + { overlapCount, relation }]`，共同空闲多的在前；错误 `forbidden / not_joined`、`forbidden / browse_closed` |
| GET | `/coffee/people/:id` | — | `Card + { overlap: [slotId], relation }` |
| GET | `/coffee/people/:id/resume` | — | 对方的简历文件（PDF 原样）。按 `canViewResume` 判断（见下），看不了、没有简历、文件不见了一律 `not_found`。响应头：`Content-Type: application/pdf`、`Content-Disposition: inline; filename="resume.pdf"`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`、`Content-Security-Policy: sandbox`。每次查看写审计（谁看了谁的，不记内容） |
| POST | `/coffee/invites` | `{ toId, note?（≤200 字）, source: "rec"\|"browse" }` | `{ id, matched }`（`matched: true` = 对方之前已邀请你，直接匹配——包括上一周还没结束的邀请）；错误 `conflict / already_invited \| already_matched \| round_closed`、`rate_limited / too_many_open`（所有进行中的轮合计最多 5 个；对方跳过的也算，直到那一轮结束）、`forbidden / not_joined \| self`、`not_found` |
| GET | `/coffee/inbox` | — | `{ incoming: [Card + { inviteId, note, createdAt, roundId, inRound }], outgoing: [Card + { inviteId, createdAt, roundId, inRound, state: "waiting" }] }`（`inRound`：你和对方现在都在当前这一轮里，可以打开 `/coffee/people/:id`；对方清空时间退出后为 `false`，邀请照样可以回应） |
| POST | `/coffee/invites/:id/accept` 或 `/skip` | — | `{ id, status: "accepted"\|"skipped" }`；错误 `conflict / expired \| already_answered`、`forbidden / wrong_role` |
| GET | `/coffee/matches` | — | `[Card + { matchId, roundId, roundTitle, timezone, contactMethod, meetPlace, myMeetPlace, invitee: "me"\|"them", slot, scheduledBy: "me"\|"them"\|null, available: [slotId], canSchedule, myOutcome: "met"\|"missed"\|null, canReport }]`（`meetPlace` = 对方填的具体地点，`myMeetPlace` = 我填的；`invitee` = 这次匹配里被邀请的一方，即那条邀请的接收人——**地点以被邀请人为准**；对方先邀请了我、我点"想认识"直接匹配时，被邀请的是我） |
| POST | `/coffee/matches/:id/schedule` | `{ slot }`（`null` = 取消约定） | `{ id, slot }`（重复提交同一个时间不会重复发邮件；约了新时间会清空双方之前的"见到了吗"回答，取消约定不清）；错误 `conflict / slot_unavailable \| already_started \| not_matched` |
| POST | `/coffee/matches/:id/outcome` | `{ met: true\|false\|null }`（`null` = 撤回自己的回答，只在没约时间时；约了新时间会清空双方之前的回答） | `{ id, outcome }`（撤回后 `outcome: null`）；错误 `conflict / too_early \| not_matched`、`fields.met = "invalid"`（不是布尔值；或约了时间还传 `null`） |
| POST | `/feedback` | `{ kind: "bug"\|"idea"\|"report"\|"other", text（5–1000 字） }`（鉴权 `consented`：不需要完成资料，但要先同意当前版本的隐私说明；`report` = 举报） | `{ id }`；错误 `forbidden / needs_consent`、`fields.kind = "invalid"`、`fields.text = "too_short" \| "too_long"`、`rate_limited / too_many_requests`（每人每小时 10 条） |

- `Card` = `{ id, name, preferredName, identity, stage, gradYear, program, job, city, meetMode, role, freeText, answers, hasResume? }`（`answers` 只含问卷里 `public: true` 的题目；**没有**邮箱、联系方式和具体见面地点；`role` = `"member"\|"mentor"`）
- `hasResume: true`：只在**这个查看者**能看对方简历时出现；看不了（包括对方没有简历）就不带这个字段，不透露有没有简历。判断（`canViewResume`，RFC 0003 §4）：本人能看；和对方匹配过（任意一轮，包括已结束的）、或者对方在还没结束的轮里邀请过我（不管我回没回）→ 能看；对方设为 `all`、并且我们俩都在当前这一轮的参与者里（和 `/coffee/people/:id` 同一个条件）→ 能看；其他都不能看。**我邀请过对方不算**。管理员在后台看不到任何人的简历
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
| GET | `/admin/overview` | — | `{ users: { total, profileDone, contactVerified, smartRecOff }, round: { id, kind, title, participants, invites, pending, matches, skipped, scheduled, fromRecs, engines } \| null, allTime: { matches, met, missed }, emails7d: [{ kind, status, n }], feedback, retention: { cohorts: [{ week, registered, returned, complete }] } }`（见下） |
| GET | `/admin/rounds` | — | 轮次数组（RoundDTO + `status: "draft"\|"published"`） |
| POST | `/admin/rounds` | `{ id?（改已有活动轮）, title: {zh,en}, startDate, endDate, themeTags: [], recCount, openBrowse, status: "draft"\|"published", post: { title, body, wechat } }` | 保存后的轮次；错误 `fields.title / startDate / endDate`、`fields.themeTags`（`too_many`：超过 5 个；`too_long`：某个超过 20 个字符，按码点计）、`conflict / overlaps_event`（与另一个已发布活动轮时间重叠） |
| GET | `/admin/feedback` | — | `[{ id, kind, text, created_at, name }]` |
| GET | `/admin/emails` | — | `[{ id, kind, status: "sent"\|"failed"\|"skipped", error, created_at }]` |
| GET | `/admin/audit` | — | `[{ id, at, actor, op, target, ok, code }]` |
| GET | `/admin/members` | — | `{ guests: [{ email, note, createdAt, registered, name }], mentors: [{ id, name, loginEmail }] }`（`registered` = 已经用这个邮箱注册了账号，`name` 是账号上的名字或 `null`；各最多 500 条）；查看写审计 |
| POST | `/admin/guests` | `{ email, note? }` | 同 `/admin/members`。登记嘉宾邮箱（已登记的就改备注）；邮箱去空格、小写，格式和登录一样严格（错误 `fields.email = "invalid"`）；备注按单行清洗、≤ 60 字（`fields.note = "too_long"`）。耶鲁邮箱也可以登记：那个人就能选身份"嘉宾" |
| POST | `/admin/guests/delete` | `{ email }` | 同 `/admin/members`。之后这个邮箱不能再建立新会话；已有账号、会话和数据保留（需要的话本人再注销）；没登记过 → `not_found` |
| POST | `/admin/mentors` | `{ email, mentor: true\|false }` | 同 `/admin/members` + `{ id }`（被标记的人的用户 id，审计记它）。按登录邮箱标记 / 取消导师；用户不存在 → `not_found`；`mentor` 不是布尔值 → `fields.mentor = "invalid"` |

- 成员接口的审计只记用户 id，不记嘉宾邮箱（审计日志在注销后也保留）。

- `round.participants`：和约咖啡首页（`/coffee/state`）、活动页（`/rounds/*`）同一个口径——这一轮保存了空闲时间、资料完整、同意了当前版本隐私说明的人数。
- `retention.cohorts`（PRD 1.3 的 7 日回访）：最近 4 周，新的在前。`week` = 注册那天（UTC 日期）所在那一周的周一（`YYYY-MM-DD`）；`registered` = 这一周注册、现在还在的账号数（已注销的不计）；`returned` = 其中注册后第 2–7 天（注册日之后的 1–6 个 UTC 日）又打开过网站（带登录状态请求过任一接口）的人数；`complete` = 这一周最晚注册的人的第 7 天也已经过完，数字不会再变（否则界面应标"统计中"）。回访率 = `returned / registered`。

## 本地开发

| GET | `/dev/outbox` | none | 仅在非生产 + `MAIL_DRIVER=console` 时存在，并且只接受本机直接访问：最近 20 封"发出"的邮件，里面有验证码 |
|---|---|---|---|
