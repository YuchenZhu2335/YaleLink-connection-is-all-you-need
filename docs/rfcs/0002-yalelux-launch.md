# 0002 Yalelux 上线版：真实后端 + 只开放 Coffee Chat

- **状态**：已接受（2026-10-04，项目负责人确认方向；实现见分支 `claude/upbeat-keller-i99xj3`）
- **取代**：[0001](0001-coffee-chat-beta.md) 里"按对方时段直接预约"的玩法；0001 的分层做法保留
- **相关**：[PRD](../prd/yalelux-mvp.md) · [接口契约](../api.md) · [设计规范](../design/system.md)

## 1. 要解决的问题

v0 是纯静态原型：没有后端、验证码固定、数据存在浏览器里，不能真的上线。第一期要"正儿八经能注册"，并且尽快办第一场 Coffee Chat，所以：

1. 加一个**真实后端**（`server/`），本地先跑起来，之后原样搬到服务器；
2. 前端改成**只调用真实接口**，并且只开放第一期需要的功能；
3. 改名 **Yalelux**（呼应校训 Lux et Veritas）：*Where Yale's light connects resources and ideas*。

## 2. 范围

**做**：登录（耶鲁邮箱验证码）→ 隐私说明 → 联系邮箱 → 资料问卷；约咖啡（每周一轮 + 活动轮、空闲时间、推荐、按标签浏览、"想认识"双向确认、匹配后看联系方式与共同空闲时间、一键约定、见到了吗）；活动页（文章 + 微信推文）；邮件通知；管理后台；关于 / 隐私 / 意见箱。

**不做（这一期）**：信息流、点赞关注、站内聊天；v0 的职业、社群、学联后台、创业、生活、目录等模块——它们在 main 分支的静态原型里，接后端时一个模块一个 RFC 地迁回来。

## 3. 架构决定

| 决定 | 理由 |
|---|---|
| 后端用 Node 22 自带的 `node:http` + `node:sqlite`，**零运行时依赖** | 本地 `npm start` 就能跑；没有依赖就没有供应链风险、没有升级负担；同学接手只需会 JS |
| 一个进程同时提供网页和 `/api` | 同源：Cookie 会话最简单、CSP 最严；部署一台小服务器即可 |
| 数据库 SQLite 单文件（`server/data/yalelux.sqlite`） | 第一期规模（几百人）绰绰有余；备份 = 复制一个文件；以后要换 PostgreSQL 只改 `server/db.js` |
| 业务规则仍然只写在 `web/js/domain/coffee.js`（纯函数），**前后端共用** | 规则只有一份、有单测；后端只做"读库 → 调规则 → 写库 → 发信" |
| 会话：httpOnly Cookie，库里只存 token 的 SHA-256 | 前端 JS 拿不到凭证；数据库泄露也不能直接登录 |
| 写请求只收 JSON 且校验来源；统一安全响应头（CSP 等） | 挡住跨站请求伪造和脚本注入 |
| 发信抽象成驱动：本地 `console`（打印到终端），线上 `resend` | 本地不需要任何账号；上线只改环境变量 |
| 推荐：规则打分为主，DeepSeek 只做可选重排，只发匿名答案 | 成本低、可解释、可关闭；跨境数据最少 |

## 4. 核心层改动（web/js/core）

- `api.js`：只剩 HTTP 客户端（`YL.api.get / post`），去掉浏览器内 mock 与本地接口注册；401 时广播 `yl:unauthorized`
- `auth.js`：不再自己判断验证码，改为镜像后端的登录状态（`boot / verify / logout / nextStep`）
- `router.js`：模块可声明 `requiresAuth`、`requiresReady`（必须完成首次填写）、`adminOnly`
- `registry.js`：一个模块可以有多个导航入口（子页面进手机底部标签栏）；`setBadge` 角标
- `ui.js`：线性 SVG 图标（不用 emoji）、表单逐项报错、确认框、复制（兼容微信内置浏览器）
- 停用 `store.js`、`audit.js`（审计改在后端）。它们和 v0 的 6 个模块登记在 `scripts/parked.mjs`："暂停"= 不加载、不检查、不删除

## 5. 规则机器化（scripts/check-architecture.mjs 新增）

- A11 暂停文件不被加载
- S1 后端零依赖；S2 SQL 一律用 `?` 占位符；S3 管理员接口必须声明 `auth: "admin"`；S4 仓库里不能出现密钥
- 后端接口集成测试 `tests/server/api.test.js`（真起服务、真写临时数据库），进 `npm run check` 和 CI

## 6. 隐私与安全

见 PRD §5。要点：池子与推荐只返回公开字段，联系方式只在双方都点"想认识"后给；跳过不通知；DeepSeek 只收匿名答案且可关闭；注销即删除个人数据（审计日志只留 id）；密钥只在环境变量。

## 7. 待决问题

见 PRD §9（商标、域名、发信服务、服务器、管理员名单、DeepSeek key 归属）。
