# 数据模型 / Data model

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
