# 架构 / Architecture

## 原型架构（v0.1）

```
浏览器
 ├─ index.html          单页壳（顶栏 / 侧栏 / 主区 / 底栏）；脚本按分层顺序装载
 ├─ config.js           部署配置（邮箱白名单、演示码、apiBase、数据清单、学联部门）
 ├─ js/core             平台内核（维护者负责，改动需 RFC）
 │   ├─ i18n.js         词典加载、t()、L()、语言切换事件
 │   ├─ ui.js           转义 esc / safeUrl、组件片段、toast、modal、日期、errorText
 │   ├─ registry.js     模块注册表 → 导航自动生成
 │   ├─ audit.js        审计日志（谁、何时、对哪条、做了什么、是否被允许）
 │   ├─ store.js        seed JSON + localStorage overlay（存量模块直接用；新模块只读字典表）
 │   ├─ auth.js         邮箱域名白名单、验证码、会话、学联身份、requireLogin
 │   ├─ api.js          接口层：本地 mock 后端 / 真实后端二选一（apiBase）
 │   └─ router.js       hash 路由、鉴权守卫、首次资料守卫、异步渲染（ctx.isActive）
 ├─ js/domain/*.js      业务规则：纯函数，浏览器 / 校验脚本 / Node 后端共用
 ├─ js/api/*.js         接口实现：原型版"后端"，每条 YL.api.route 就是一份后端契约
 ├─ js/modules/*.js     界面：每个功能一个文件
 ├─ data/*.json         内容（双语字段 {zh, en}）
 └─ i18n/{zh,en}.json   界面词典
```

分层与依赖方向、每层能做什么不能做什么，见 [engineering.md](engineering.md)；其中能机器判断的部分由 `scripts/check-architecture.mjs` 在 CI 里检查。

### 关键机制

- **模块注册表**：模块自描述（路由、导航、是否需登录、可见性谓词、说明 key），壳层不需要知道任何模块。
- **接口层（新模块）**：模块只调用 `YL.api.get / post`。`config.apiBase` 为空时，请求在浏览器内路由到 `web/js/api/<模块>.js` 的本地实现（入参与返回值经过 JSON 序列化，写请求自动记审计）；填上后端地址后，同样的调用改为 HTTP 请求。
- **数据层（存量模块）**：`YL.store.get(collection)` 返回 seed + 本地新增（`add`）+ 本地修改（`patch`）合并后的数组；用户状态（报名、加入、点赞、认领志愿者等）用 `getState / toggleState(ns, id)`。演示中所有写入只在本机浏览器。
- **鉴权**：`auth.js` 是唯一信任边界。会话存 localStorage：`{ email, kind: student|alumni, profile }`。`profile.acssyRole` 决定学联后台可见性。
- **双语**：界面文案 `t(key, vars)`；数据字段 `L({zh, en})`；缺失回退到另一种语言；校验脚本保证两份词典 key 一致。
- **路由守卫**：`requiresAuth` → 跳登录并携带 `next`；已登录但未填资料 → 跳资料页。
- **国内可达**：无境外 CDN、无 Web 字体、无第三方脚本，纯静态。

## 演进路径（v0.2+）

```
前端（本仓库 web/，可原样保留）
   │  fetch /api/*
后端 API（Node.js 22 + Hono，单体；放在本仓库 server/，直接 require web/js/domain/*.js）
   ├─ /auth/request-code  发邮件验证码（域名白名单在服务端再校验一次）
   ├─ /auth/verify        签发 httpOnly 会话 Cookie
   ├─ /coffee/*           Coffee Chat 内测（12 条，契约见 docs/rfcs/0001-coffee-chat-beta.md）
   ├─ /users, /posts, /jobs, /events, /circles, /campaigns, /playbooks, /contacts, /templates（存量模块迁到 YL.api 后逐个上线）
   ├─ 权限：登录用户 / 学联成员 / 学联负责人 / 管理员
   └─ 通知：站内 + 邮件（+ 微信模板消息，见 deploy-china.md）
数据库：Postgres（国内可用阿里云 RDS / 腾讯云 TencentDB）
对象存储：图片、SOP 材料（OSS / COS）
```

**接后端时要换什么**（如实说明）：

1. `auth.js`：`requestCode / verify / completeProfile / logout` 改为调接口；
2. `config.apiBase` 填上后端地址：**已经走 `YL.api` 的模块（目前是 coffee）一行不用改**，后端照 `web/js/api/<模块>.js` 实现同样的路由，并直接 `require` 同一份 `web/js/domain/<模块>.js`；
3. **存量模块**（home、careers、events、circles、acssy、startup、life、directory、profile、login）同步地读写 `YL.store` 的全量数据，不能原样接后端——一是同步调用要改成异步，二是"把整张表发给浏览器"在有权限控制的真实系统里不成立。它们要先按 coffee 的样子迁到 `YL.api`，再接后端；待迁清单就是 `scripts/check-architecture.mjs` 里的 `LEGACY_STORE_MODULES`。

### 数据模型即 API 契约

`docs/data-model.md` 列出的实体与字段就是未来 API 的资源与 JSON 形状。`web/data/*.json` 是它们的示例实例，`scripts/validate-data.mjs` 是最简的 schema 校验（coffee 的种子数据直接用 domain 规则校验）。走 `YL.api` 的模块，接口清单由 `YL.api.routes()` 自动生成，显示在"关于"页。

### 权限矩阵（真实版）

| 资源 | 游客 | 已验证用户 | 学联成员 | 学联负责人 | 管理员 |
|---|---|---|---|---|---|
| 首页公开内容、关于 | 读 | 读 | 读 | 读 | 读 |
| 帖子 / 岗位 / 活动 / 社群 / 指南 | — | 读写自己的 | 同左 | 同左 | 全部 |
| 校友目录 | — | 读 | 读 | 读 | 全部 |
| 学联后台（看板 / SOP / 联系人 / 模板） | — | — | 读；认领与反馈任务 | 分配任务、发通知、编辑 SOP | 全部 |
| 学联身份审核 | — | 申请 | — | 审核本部门 | 全部 |

### 安全要点

- 服务端再次校验邮箱域名；验证码限频、5 分钟有效、一次性。
- 所有用户输入服务端转义 / 富文本白名单；前端已 `esc()`。
- 联系人库不入公开仓库；生产数据库加密备份；导出需负责人权限并留痕。
- 审计：所有写操作（以及管理员查看数据）记 `audit_log`：操作者、时间、接口、对象 id、是否成功；只记 id 与动作，不记正文。原型中由 `core/api.js` 自动写入 `YL.audit`，个人页可见。
- 隐私：目录可见性、联系方式交换需双方同意；提供注销与数据删除。
