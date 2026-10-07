# 0003 资料补全：原始报名表字段、自由留言、简历、导师与嘉宾

- **状态**：已接受（2026-10-07，项目负责人提出需求；本文是实现契约）
- **相关**：[PRD](../prd/yalelux-mvp.md) · [接口契约](../api.md) · [数据模型](../data-model.md) · [0002](0002-yalelux-launch.md)

## 1. 要解决的问题

1. 提出 Coffee Chat 的同学最早用一份报名表（10 项）收集信息。要把其中**符合现在产品逻辑**的输入放进数据库和资料页。
2. 有人希望加一个**选填的自由文本框**（想说什么都可以），和一个**选填的简历上传**。简历由本人选择只给"我邀请的人"看，还是给"所有人"看。
3. 群里讨论的两个问题：
   - 要请一些同学或嘉宾**作为 mentor（导师）**在网站上建资料。结论是让他们**自己注册**：他们要自己填、自己改空闲时间，邀请也都要通过网站。所以需要一个"导师"标记，而不是由组织者代填资料。
   - **没有耶鲁邮箱的人**（例如受邀的创新学者）登录不了，需要组织者**手动开通邮箱**。

## 2. 原始报名表怎么对应

| # | 原始报名表 | 现在怎么做 | 说明 |
|---|---|---|---|
| 1 | 中文全名和 preferred name（例：王五 Wu） | `name`（名字，必填）+ **新增** `preferredName`（英文名 / 常用称呼，选填，≤ 40 字） | 卡片上显示"王五 · Wu" |
| 2 | 常用邮箱（通知都发这里） | 已有：联系邮箱（要验证） | 不变 |
| 3 | 其他便捷联系方式（微信等，预约成功后才给对方看） | 已有：`contactMethod`，匹配后才给对方看 | 不变 |
| 4 | 身份：在校生 / 校友 | 已有 `identity`；**新增** `guest`（嘉宾 / 访问学者），只有组织者开通过的嘉宾邮箱能选 | 见第 5 节 |
| 5a | 在校生学段（本科、硕士、博士、博士后等） | `stage` **新增** `postdoc`（博士后）、`other`（其他，如访问学生） | 博士后、其他不要求毕业年份 |
| 5b | 项目和 / 或研究方向（不要缩写） | **新增** `program`（在读必填，≤ 80 字） | 卡片上显示 |
| 5c | 毕业年份 | 已有 `gradYear` | 本科 / 硕士 / 博士必填 |
| 6 | 校友：目前的工作、所在地区 | 已有 `job`、`city`（嘉宾也填这两项） | 不变 |
| 7 | 兴趣爱好 | 已有：问卷"兴趣"（标签，可自填） | 不变 |
| 8 | 诉求（多选）：交友、业界求职、学界求职 | 已有：问卷"这次想聊什么"（多了"分享经验、带学弟学妹"） | 不变 |
| 9 | Coffee Chat 地点（Zoom 链接，或纽黑文店名和地址）；**地点以被邀请人为准** | **新增** `meetMode`（见面方式，必填：线上 / 纽黑文线下 / 都可以，公开在卡片上）+ `meetPlace`（具体地点，选填，≤ 200 字，**匹配后才给对方看**）。匹配页写明"地点以被邀请的一方为准"，并突出显示被邀请一方填的地点 | 被邀请的一方 = 匹配那条邀请的接收人 |
| 10 | 时间表（美东时间，三周可选区间） | 已有：每轮选空闲时间（每周一轮；活动轮最长 31 天），并排显示北京时间 | 不变 |

和原始报名表**刻意不同**的地方（不改）：原表写"被邀请人同意或拒绝时，发起人都会收到邮件"。现在**跳过是静默的**（PRD 4.4.5 第 7 条：不让人知道自己被拒），只有匹配成功才发邮件。

## 3. 自由留言

- `freeText`："还有什么想说的（选填）"，≤ 500 字，**可以换行**（保存时去掉控制字符和改变文字方向的字符，连续 3 个以上换行并成 2 个）。
- 谁能看：和资料卡一样（同一轮的参与者、邀请过你或和你匹配过的人）。在个人页和收件箱的邀请卡上显示，推荐卡和池子卡片上不显示（太长）。
- **不发给 DeepSeek**。

## 4. 简历

- 只收 **PDF**，最大 **5 MB**。上传时检查文件开头是 `%PDF-`；文件名不保存，下载时一律叫 `resume.pdf`。
- 存在服务器的 `DATA_DIR/resumes/` 里，文件名是随机的；数据库只记文件名、大小、上传时间、谁能看。每日备份要一并备份这个文件夹。
- **谁能看**（`resumeVisibility`，本人随时可改，默认 `invited`）：
  - `invited`：**只给我邀请的人**——我对 TA 点过"想认识"的人（邀请在还没结束的轮里，不管 TA 回没回），以及和我匹配过的人；
  - `all`：**所有能看到我资料的人**——同一轮的参与者，加上上面那些人。
  - 本人自己永远能看。管理员在后台**看不到**任何人的简历。
- 能看的时候，资料卡上带 `hasResume: true`，界面显示"查看简历"；看不了就不带这个字段（不透露有没有简历）。
- 注销账号、删除简历时立即删掉文件。
- 不发给 DeepSeek。
- 隐私说明里加一段：存在哪里、谁能看、怎么删。

## 5. 导师与嘉宾

- **导师**（`role = "mentor"`）：由管理员在后台按登录邮箱标记或取消。导师照常自己注册、选时间、收发邀请；资料卡上有"导师"标记；"找人"可以只看导师。没有其他特权。
- **嘉宾邮箱**：管理员在后台登记一个非耶鲁邮箱（可附一个备注，如"创新学者"），这个邮箱就能像耶鲁邮箱一样收验证码登录。嘉宾的身份可以选"嘉宾 / 访问学者"，要填工作和所在地区。删除登记后不能再登录新会话（已有账号和数据保留，需要的话再手动注销）。
- 登录页对没登记的非耶鲁邮箱仍然直接提示"请用耶鲁邮箱"。这样会透露"某个非耶鲁邮箱有没有被登记为嘉宾"，但嘉宾名单不敏感，而且给打错邮箱的人即时提示更重要。
- 联系邮箱和登录邮箱相同时（嘉宾通常如此），不再发验证码：刚刚登录时已经证明过这个邮箱是本人的，直接算已验证。

## 6. 接口与数据（契约）

**迁移 `005_profile_extras.sql`**

- `users` 加列：`preferred_name TEXT`、`program TEXT`、`meet_mode TEXT`、`meet_place TEXT`、`free_text TEXT`、`resume_file TEXT`、`resume_size INTEGER`、`resume_at TEXT`、`resume_visibility TEXT NOT NULL DEFAULT 'invited'`、`role TEXT NOT NULL DEFAULT 'member'`。
- 新表 `guest_emails(email TEXT PRIMARY KEY, note TEXT, added_by TEXT, created_at TEXT NOT NULL)`。

**规则层 `web/js/domain/coffee.js`**（纯函数，配单测）

- `IDENTITIES = ["student", "alumni", "guest"]`；`STAGES = ["undergrad", "master", "phd", "postdoc", "other"]`；`STAGES_WITH_GRAD_YEAR = ["undergrad", "master", "phd"]`；`MEET_MODES = ["online", "newhaven", "either"]`；`RESUME_VISIBILITY = ["invited", "all"]`；`ROLES = ["member", "mentor"]`。
- `LIMITS` 加：`preferredName: 40, program: 80, meetPlace: 200, freeText: 500, resumeBytes: 5 * 1024 * 1024`。
- `validateProfile(p, questions, year, opts)`：`opts.isGuest` 为真时才接受 `identity: "guest"`（否则 `fields.identity = "invalid"`）；在读要 `stage`、`program`，`stage` 在 `STAGES_WITH_GRAD_YEAR` 里时要 `gradYear`；校友和嘉宾要 `job`、`city`；`meetMode` 必填；`preferredName`、`meetPlace`、`freeText` 选填，超长报 `too_long`。
- `cleanProfile` 输出新字段：单行字段用 `line()`，`freeText` 用新的 `para()`（保留换行）；切换身份时清空另一种身份的字段（在读才有 `stage / gradYear / program`，校友和嘉宾才有 `job / city`）。
- `canViewResume({ owner, viewerId, matched, invitedByOwner, sameRound })` → 布尔：没有简历 → false；本人 → true；`matched || invitedByOwner` → true；`owner.resumeVisibility === "all" && sameRound` → true；其他 → false。

**接口**（`docs/api.md` 同步）

- `Me` 加：`preferredName, program, meetMode, meetPlace, freeText, role, isGuest, resume: { size, uploadedAt, visibility } | null`。
- `POST /me/profile` 收新字段（规则同上）。改 `contactMethod` 要耶鲁会话的规则不变；`meetPlace` 不要求。
- `POST /me/resume`：请求体就是 PDF 文件本身，`Content-Type: application/pdf`，最大 5 MB（这一个接口单独放宽请求体上限，仍然校验来源防跨站）；鉴权 `consented`；每人每天最多 20 次。返回 `Me`。错误：`fields.resume = "not_pdf" | "too_large" | "empty"`、`rate_limited`。替换时删掉旧文件。
- `POST /me/resume/settings` `{ visibility }` → `Me`；`POST /me/resume/delete` → `Me`。
- `GET /me/resume`：本人下载自己的简历。
- `GET /coffee/people/:id/resume`：按 `canViewResume` 判断，看不了一律 `not_found`。响应头：`Content-Type: application/pdf`、`Content-Disposition: inline; filename="resume.pdf"`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`、`Content-Security-Policy: sandbox`。
- `Card` 加：`preferredName, program, meetMode, role, freeText`；能看简历时加 `hasResume: true`。
- `GET /coffee/matches` 每条加：`meetPlace`（对方的）、`myMeetPlace`、`invitee: "me" | "them"`（这次匹配里被邀请的一方）。
- `GET /coffee/pool` 加筛选 `mentor=1`。
- 管理：`GET /admin/members` → `{ guests: [{ email, note, createdAt, registered, name }], mentors: [{ id, name, loginEmail }] }`；`POST /admin/guests` `{ email, note }`；`POST /admin/guests/delete` `{ email }`；`POST /admin/mentors` `{ email, mentor: true | false }`（用户不存在 → `not_found`）。都要 `auth: "admin"`，都审计。
- 登录：`isYale(email) || 在 guest_emails 里` 才能请求验证码和验证；其余不变。
- 注销账号：删简历文件；`guest_emails` 不动（那是组织者的登记）。

**网页**

- 资料表单（首次填写和修改资料）：英文名、项目 / 研究方向（在读）、学段多了博士后和其他、身份多了嘉宾（仅嘉宾可见）、见面方式（必填）、具体地点（选填，提示"匹配后才给对方看"）、还有什么想说的（选填）、简历（选填：上传 / 替换 / 查看 / 删除，谁能看的两个选项）。简历选好文件就上传，不跟表单一起提交。
- 资料卡和个人页：英文名、项目、导师标记、见面方式；个人页和收件箱显示自由留言；能看简历时有"查看简历"。
- 匹配页：地点规则一句话 + 被邀请一方的地点（突出）+ 另一方的地点；双方简历入口。
- 找人：多一个"只看导师"筛选。
- 后台多一个"成员"页：嘉宾邮箱登记、导师标记。
- 登录页：说明"受邀嘉宾用组织者登记过的邮箱登录"。
- `web/js/core/api.js` 加 `YL.api.upload(path, blob, contentType)`（核心层改动，本文即 RFC）。
