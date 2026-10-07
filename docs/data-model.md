# 数据模型 / Data model

## 上线版（Yalelux）：服务器上的数据库

一个 SQLite 文件（`server/data/yalelux.sqlite`），结构在 `server/migrations/`（只加新文件、不改旧文件）。时间一律 UTC ISO 字符串。

| 表 | 存什么 | 谁能看到 | 删除 |
|---|---|---|---|
| `users` | 登录邮箱（耶鲁邮箱或登记过的嘉宾邮箱）、联系邮箱（及是否验证）、隐私说明同意版本、名字和英文名、身份（在读 / 校友 / 嘉宾；学段、毕业年份、项目，或工作、所在地区）、见面方式和具体地点、自由留言、联系方式（如微信）、问卷答案、邮件偏好、是否参与智能推荐、最近访问时间（`last_seen_at`，迁移 004）、简历文件名 / 大小 / 上传时间 / 谁能看、角色（成员 / 导师）（迁移 005） | 本人看全部；其他参与者只看资料卡（名字、英文名、身份一行、项目、见面方式、导师标记、自由留言、问卷里公开的题目）；**联系方式和具体见面地点只给互相点了"想认识"的人**；简历按"谁能看"（见下）；管理员只看汇总数字和导师名单（名字、登录邮箱），看不到简历 | 注销即删除（简历文件一起删） |
| `login_codes` | 验证码的哈希（不存明文）、发到哪、是不是用户主动要求发到耶鲁邮箱（`forced_yale`）、尝试次数、过期时间 | 没有人 | 定期可清 |
| `sessions` | 会话令牌的哈希（令牌本身只在浏览器的 httpOnly Cookie 里）、这次登录走的是耶鲁邮箱还是联系邮箱。表里的 `last_seen_at` 列（001 建的）**不用**：会话在退出、退出所有设备、换 / 验证联系邮箱、过期时整行删除，记在这里会丢 | 没有人 | 退出登录 / 注销 / 过期即删除 |
| `user_visits` | 每人每个 UTC 日一行：`(user_id, day)`，这一天带登录状态打开过网站（迁移 004） | 管理员只看汇总（7 日回访） | 注销即删除 |
| `guest_emails` | 管理员登记的嘉宾邮箱（小写）、备注（如"创新学者"）、谁登记的（管理员的用户 id）、登记时间（迁移 005） | 管理员 | 管理员删除登记；注销账号**不**删（那是组织者的登记） |
| `rounds` | 每周轮与活动轮：日期、时段配置、推荐数、活动页文章与微信推文 | 公开（已发布的活动轮） | — |
| `participations` | 谁参加了哪一轮、选了哪些空闲时间 | 本人；别人只看到"你们有几个共同空闲时间" | 注销即删除 |
| `invites` | 谁想认识谁、留言、对方是否回应（跳过只有被邀请的人自己知道）、约定的时间、见到了吗 | 双方；管理员只看数量 | 注销即删除 |
| `recommendations` | 每人每轮的推荐结果、用的是规则还是 DeepSeek、规则阶段的候选（便于审计） | 本人 | 注销即删除 |
| `emails` | 每封邮件的收件地址、类型、发送状态、失败原因（邮箱地址换成 `***@***`）、去重用的 `ref`（迁移 002）。**不存标题和正文**：`subject` 列写的是邮件类型 | 管理员（不含收件地址） | 注销即删除（本人的） |
| `feedback` | 意见箱内容；`kind` = `bug`（问题）\| `idea`（建议）\| `report`（举报）\| `other` | 管理员 | 注销即删除 |
| `audit_log` | 谁、何时、对哪条记录、做了什么、是否被允许（只有 id 和动作，没有正文）。没有用户编号的失败请求不记（防止匿名请求刷大日志） | 管理员 | 保留（注销后只剩匿名 id） |

问卷题目不在数据库里，在 `web/data/matchQuestions.json`（前后端共用，启动时校验）。

简历文件也不在数据库里：在 `DATA_DIR/resumes/`（默认 `server/data/resumes/`，目录权限 700、文件 600），文件名是 32 位随机十六进制 + `.pdf`，数据库只记文件名。备份见下文。

### 资料补全、简历、导师与嘉宾（迁移 005，RFC 0003）

`users` 新加的列（老库直接升级：已有用户的新列为空，`resume_visibility` 默认 `invited`，`role` 默认 `member`；下次保存资料时 `meetMode`、在读的 `program` 变成必填）：

| 列 | 存什么 |
|---|---|
| `preferred_name` | 英文名 / 常用称呼（选填，≤ 40 字） |
| `program` | 项目 / 研究方向（在读才有，≤ 80 字） |
| `meet_mode` | `online` \| `newhaven` \| `either` |
| `meet_place` | 具体地点（选填，≤ 200 字）；匹配后才给对方 |
| `free_text` | 还有什么想说的（选填，≤ 500 字，保留换行）；不发给 DeepSeek |
| `resume_file` / `resume_size` / `resume_at` | 简历的随机文件名、字节数、上传时间；没有简历时都是 NULL |
| `resume_visibility` | `invited`（只给我邀请的人）\| `all`（所有能看到我资料的人），`NOT NULL DEFAULT 'invited'` |
| `role` | `member` \| `mentor`，`NOT NULL DEFAULT 'member'`；只有管理员能改（`POST /admin/mentors`） |

`stage` 多了 `postdoc`、`other`（这两种 `grad_year` 可以是 NULL）；`identity` 多了 `guest`（只有嘉宾能选：登录邮箱在 `guest_emails` 里，或者不是耶鲁邮箱）。

- **简历谁能看**（`web/js/domain/coffee.js` 的 `canViewResume`，事实由 `server/coffee.js` 的 `canSeeResume` 查）：本人；和本人匹配过的人（`invites` 里两人之间有一条 `accepted`，任意一轮）；本人在还没结束的轮里邀请过的人（不管回没回）；`resume_visibility = 'all'` 时再加上当前这一轮的参与者（两人都在 `participations` 里、资料完整、同意了当前版本）。管理员不在其中。
- **简历的生命周期**：上传（`POST /me/resume`）写一个新文件再改库，替换时删旧文件；删除简历、注销账号时立即删文件。原文件名不保存，下载时一律叫 `resume.pdf`。
- **嘉宾**：`guest_emails` 里的邮箱可以收验证码登录（请求和验证时都查）。删除登记只挡住新会话；账号、会话、数据都保留。
- **备份**：`npm run backup` 在每份数据库备份 `backups/yalelux-<时间>.sqlite` 旁边建一个 `backups/yalelux-<时间>-resumes/`，把当时的简历文件用硬链接"复制"进去（简历写好后不再修改，硬链接不多占磁盘；不在同一块磁盘时退回真复制）；和数据库备份一样只留最近 30 份。所以删掉的简历在旧备份里最多还留 30 份备份那么久——和数据库备份里已注销的资料一样。同步备份目录时用 `rsync -H` 保留硬链接。

### 访问记录与 7 日回访（迁移 004）

PRD 1.3 的"7 日回访" = 注册后第 2–7 天里又打开过网站的人 ÷ 当周注册人数。

- **怎么记**：`server/http.js` 在每个带有效会话的接口请求里（网页打开时一定会调 `GET /api/auth/me`），拿已经读出来的 `users.last_seen_at` 和今天的 UTC 日期比较：不是今天，才 `UPDATE users SET last_seen_at` 并 `INSERT OR IGNORE INTO user_visits (user_id, day)`；是今天就什么都不写。所以每人每天最多两条写入，同一天的其他请求零额外开销。登录成功（建会话）时也记一次。
- **为什么不只用 `last_seen_at`**：它只留最近一次访问。第 3 天回来过、第 10 天又来的人，`last_seen_at` 是第 10 天，已经看不出第 2–7 天来过没有；所以按天另记 `user_visits`（主键 `(user_id, day)`，`WITHOUT ROWID`，一人一天一行，几百人一年也就几万行）。`last_seen_at` 留着做"今天记过没有"的判断，也方便以后看"多久没来了"。
- **为什么不写在 `sessions`**：会话会整行删除（见上表），而且一个人可以同时有多个会话。
- **怎么算**（`server/admin.js` 的 `retention`，`GET /admin/overview` 的 `retention.cohorts`）：注册日 = `users.created_at` 的 UTC 日期；按注册日所在的周（周一开始）分组，取最近 4 周；`returned` = 在 `(注册日, 注册日 + 6 天]` 之间有 `user_visits` 行的人。`complete` 表示这一周最晚注册的人（周日）的第 7 天也过完了。
- **局限**：只按 UTC 日计（美东夏令时晚上 8 点、冬令时晚上 7 点以后已经是 UTC 的第二天）；注销的人连同访问记录一起删除，不再计入注册数；迁移 004 上线前的访问没有记录，没法补。

---

## v0 静态原型的示例数据（main 分支；上线版不加载）

所有文案字段均为双语对象 `{ "zh": "...", "en": "..." }`（下文记为 `Bi`）。日期为 `YYYY-MM-DD`。`id` 全局唯一。
枚举取值来自 `web/data/taxonomy.json`。

## 基础

### Region `regions.json`
`id, name: Bi, country, emoji`

### Taxonomy `taxonomy.json`
`schools, industries, offers, postCategories, lifeCategories, jobTypes, eventTypes, startupCategories, projectNeeds, stages, badges, circleTypes, departments, contactKinds, templateKinds` —— 每组是 `{ id, label: Bi, emoji?, desc?: Bi }[]`。

### User `users.json`
| 字段 | 说明 |
|---|---|
| `name: Bi`, `school`, `degree: Bi`, `classYear`, `region`, `industry`, `title: Bi`, `company: Bi` | 基本资料 |
| `offers[]` | 能提供：referral / mock / resume / coffee / mentor |
| `skills[]` | 创业匹配用，取值同 projectNeeds |
| `bio: Bi`, `points`, `badges[]`, `featured?` | 简介、贡献值、徽章、首页精选 |
| `acssy?: { role: member\|lead, department }` | 学联身份（真实版由审核写入） |

会话中的当前用户在 store 里以 `id: "me"` 合成。

## 社区内容

### Post `posts.json`
`authorId, category, title: Bi, summary: Bi, body: Bi, tags[], likes, commentsCount, createdAt`

### Job `jobs.json`
`company: Bi, title: Bi, type, region, location: Bi, industry, deadline, referrerId?, link, tags[], description: Bi, postedAt`

### Timeline `timelines.json`
`industry, title: Bi, intro: Bi, tip: Bi, maintainers[], steps[]: { when: Bi, months[], title: Bi, detail: Bi }`

### Group `groups.json`
`name: Bi, industry, description: Bi, members, leadId, cadence: Bi, nextMock?: { date, time, topic: Bi }`

### Event `events.json`
`title: Bi, type, region, date, time, venue: Bi, hostId?, hostOrg: Bi, description: Bi, capacity, going, tags[], circleId?, campaignId?`

### Circle `circles.json`
`type: interest|region|industry, region|"all", emoji, name: Bi, description: Bi, members, leadId`

### Resource `resources.json`
`kind: startup|life, category, region|"all", name: Bi, summary: Bi, tips?: Bi, link, verified, helpful?, contributorId`

### Project `projects.json`（创业项目）
`name: Bi, stage, founderId, region, pitch: Bi, needs[], createdAt`

## 学联后台

### Playbook `playbooks.json`（活动 SOP）
| 字段 | 说明 |
|---|---|
| `category`（eventTypes）, `emoji`, `title: Bi`, `scale: Bi`, `leadTime: Bi`, `summary: Bi` | 概要 |
| `keyPoints: Bi[]` | 关键重点，给接手的人看 |
| `phases[]: { id, name: Bi, timing: Bi, tasks[]: { title: Bi, role(department), days } }` | 阶段与任务；`days` 是相对活动日的偏移量，用于生成截止日期 |
| `materials[]: { name: Bi, kind: doc\|sheet\|design\|form, link }` | 材料与模板文件 |
| `templateIds[]`, `contactIds[]` | 关联沟通模板与联系人 |
| `history[]: { year, name: Bi, attendance, notes: Bi }` | 历史记录 / 复盘 |
| `maintainerId` | 维护人 |

### Campaign `campaigns.json`（活动项目）
| 字段 | 说明 |
|---|---|
| `name: Bi, eventId?, playbookId, leadId, department, status: planning\|active\|done, date, memberIds[]` | 项目 |
| `tasks[]: { id, phase, title: Bi, role, assigneeId?, due, status: todo\|doing\|done, updates[]: { at, by, text: Bi } }` | 任务与进度反馈 |
| `volunteerRoles[]: { id, role: Bi, count, filled, shift: Bi }` | 志愿者岗位 |
| `notices[]: { at, by, text: Bi }` | 项目通知 |

### Contact `contacts.json`
`name: Bi, org: Bi, kind, tags[], channel: Bi, ownerId, lastContact, rating(1–5), notes: Bi, usedIn[]`

### Template `templates.json`
`kind, name: Bi, scenario: Bi, body: Bi, tips?: Bi, maintainerId`

## Coffee Chat 内测活动

规则与表结构的讨论见 [RFC 0001](rfcs/0001-coffee-chat-beta.md)；字段校验以 `web/js/domain/coffee.js` 为准（校验脚本直接调用它）。

### CoffeeEvent `coffeeEvents.json`
`id, name: Bi, timezone（IANA，如 America/New_York）, startDate, endDate, dayStart "10:00", dayEnd "21:00", slotMinutes, gapMinutes, cutoffHours, maxPending`。
时段 id = `"YYYY-MM-DDTHH:MM"`（活动时区的墙上时间）。

### CoffeeProfile `coffeeProfiles.json`（id = 用户 id）
| 字段 | 说明 |
|---|---|
| `email` | 取自登录；示例数据一律 `@example.com` |
| `name`, `identity: student\|alumni` | 示例数据的姓名取自 users.json |
| `stage: undergrad\|master\|phd`, `program`, `gradYear` | 仅在校生 |
| `job`, `location` | 仅校友 |
| `interests`, `goals[]: academic\|industry\|friends` | 兴趣与诉求 |
| `meetMode: offline\|online`, `meetPlace` | 见面地点；线上须为 https 链接，接受后才对对方可见 |
| `contact` | 首选联系方式，接受后才对对方可见 |
| `slots[]` | 空闲时段 id |

### CoffeeBooking `coffeeBookings.json`
`eventId, requesterId, hostId, slot, note, status: pending|accepted|declined, createdAt, updatedAt, history[]: { at, by, action, from, to }`。
`expired`（到开始时间仍未确认）不存库，读取时计算。真实版唯一索引 `(eventId, hostId, slot)`。

### CoffeeNotice `coffeeNotices.json`
`userId, kind: booking_new|booking_accepted|booking_declined, bookingId, actorId, slot, createdAt, readAt`。真实版写入时同时发邮件。

### CoffeeFeedback `coffeeFeedback.json`
`userId, kind: bug|idea|other, text, createdAt`。

## 用户状态（localStorage `yl.state`，真实版为关系表）

`rsvp[eventId]`, `joined[groupId]`, `likes[postId]`, `helpful[resourceId]`, `savedJobs[jobId]`, `greeted[userId]`, `interested[projectId]`, `circle[circleId]`, `knows[contactId]`, `volunteer[campaignId:roleId]`

## 真实版补充实体

- `Notification { userId, kind, refId, readAt }`
- `Comment { postId, authorId, body, createdAt }`
- `RoleRequest { userId, department, status, reviewedBy }`（学联身份审核）
- `AuditLog { actor, op, target, ok, code, at }`：所有写操作与管理员查看；原型中由 `core/api.js` 写入 `YL.audit`（localStorage `yl.audit`），真实版只追加、不可删除
