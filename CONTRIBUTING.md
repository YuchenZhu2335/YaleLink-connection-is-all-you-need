# 共创指南 / Contributing

YaleLink 是一个基底，目标是让"往上加东西"尽可能简单。这里说明怎么提案、怎么加模块、怎么补内容、怎么提 PR。
*(English summary at the bottom.)*

## 1. 提功能提案

开一个 Issue，选 **功能提案** 模板，写清楚：

- **问题**：现在哪件事在微信群 / 现有流程里做不好？
- **目标用户**：在校生、校友、学联成员，还是某个地区 / 行业？
- **方案**：一句话描述功能；如果有界面草图更好；
- **数据**：需要新的数据文件吗？字段大致是什么？
- **你愿不愿意自己实现**。

维护者会在 Issue 里讨论并打上 `accepted` 标签，之后任何人都可以认领。

## 2. 五步加一个模块

以"二手市场"为例：

1. **写模块文件** `web/js/modules/market.js`：
   ```js
   registerModule({
     id: "market",                                             // 路由 #/market
     nav: { icon: "🛒", labelKey: "nav.market", order: 55, mobile: false },
     requiresAuth: true,                                       // 需要登录
     descriptionKey: "about.module.market",                    // "关于"页模块列表用
     render(root, ctx) {                                       // ctx.sub / ctx.id / ctx.query
       const { t, esc, L } = YL.ui;
       const items = YL.store.get("market");
       root.innerHTML = `<h1>${t("market.title")}</h1>` + items.map((i) => `<div class="card">${esc(L(i.name))}</div>`).join("");
     }
   });
   ```
2. **加数据** `web/data/market.json`（数组，每条有唯一 `id`，文案字段用 `{ "zh": "...", "en": "..." }`），并在 `web/config.js` 的 `dataFiles` 里加上 `"market"`。
3. **加词典**：在 `web/i18n/zh.json` 与 `en.json` 里加 `nav.market`、`market.title`、`about.module.market` 等 key（两边必须一致，校验脚本会检查）。
4. **挂脚本**：在 `web/index.html` 的功能模块区加 `<script src="js/modules/market.js"></script>`。
5. **校验**：`npm run check`（数据与词典、架构规则、单测），本地跑一遍页面，提 PR。

导航、底栏、"关于"页的模块列表都会自动出现，不用改别的文件。

### 有写操作或状态流转的模块：拆成三层

上面的写法适合只读的模块。只要有"提交 / 接受 / 认领"这类写操作，就按 [docs/engineering.md](docs/engineering.md) §3 拆成三个同名文件，参考实现是 Coffee Chat：

| 文件 | 写什么 |
|---|---|
| `web/js/domain/market.js` | 业务规则（状态机、权限、校验、限额），纯函数；单测放 `tests/unit/market.test.js` |
| `web/js/api/market.js` | 每个动作一条 `YL.api.route("POST", "/market/items/:id/reserve", handler)`，就是将来的后端契约 |
| `web/js/modules/market.js` | 界面：只调用 `await YL.api.get / post`，按接口返回的 `actions` 显示按钮 |

动手前先写一页 RFC（[docs/rfcs/](docs/rfcs/README.md)），会上或 Issue 里讨论通过再开工。

### 你能复用的东西

| 需要 | 用 | 位置 |
|---|---|---|
| 界面文案 | `YL.ui.t("key", {n: 3})` | `web/js/core/i18n.js` |
| 数据双语字段 | `YL.ui.L(obj)` | 同上 |
| 读写业务数据（新模块） | `await YL.api.get(path, query)` / `YL.api.post(path, body)` | `web/js/core/api.js` |
| 实现接口（原型版后端） | `YL.api.route(method, path, handler, meta)`、`throw YL.api.fail(code)` | 同上 |
| 接口错误 → 提示文案 | `YL.ui.errorText(error, "模块id")` | `web/js/core/ui.js` |
| 审计日志（只读） | `YL.audit.list({ actor, match, limit })` | `web/js/core/audit.js` |
| 分类词表 / 地区 | `YL.store.term("industries", id)`、`terms("offers")`、`region(id)`、`regions()` | `web/data/taxonomy.json`、`regions.json` |
| 读写数据（仅存量模块） | `YL.store.get / find / add / patch`、`getState / toggleState(ns, id)` | `web/js/core/store.js` |
| 当前用户 / 学联身份 / 要求登录 | `YL.auth.user() / isAcssy() / isAcssyLead() / requireLogin()` | `web/js/core/auth.js` |
| 转义 / 外链 | `YL.ui.esc(s)`、`YL.ui.safeUrl(url)` | `web/js/core/ui.js` |
| 卡片 / 标签 / 筛选 chips / Tab / 空状态 / toast / modal | `YL.ui.*` + `css/components.css` | `web/js/core/ui.js` |
| 办活动向导 | `YL.acssy.openWizard({ scope, playbookId, circleId })` | `web/js/modules/acssy.js` |

## 3. 补内容（不写代码）

岗位、活动、生活指南、创业资源、SOP、沟通模板、联系人都是 `web/data/` 下的 JSON。
直接编辑、保证 `zh` / `en` 都填、`id` 不重复，提 PR 即可；也可以用 **内容贡献** Issue 模板让别人帮你加。

- 涉及真实联系人或内部信息的内容，**不要**提交到公开仓库，放到真实部署的数据库里。
- 标为 `"verified": false` 的条目表示待校友核实。

## 4. 代码规范

完整规则见 [docs/engineering.md](docs/engineering.md)，要点：

- 纯 HTML / CSS / 原生 JS，`web/` 下**不引入构建工具与运行时依赖**；不使用境外 CDN（国内可访问性）。
- 分层依赖只能往下：界面 → 接口 → 业务规则；新模块的业务数据只走 `YL.api`；模块之间只用路由链接或白名单里的公开接口。
- 所有可见文案走词典；所有动态内容经 `esc()` 转义后再插入 HTML，数据里的链接用 `safeUrl()`。
- 样式优先复用 `components.css`，新增类名用 BEM（`.card__title`），新模块不写内联样式。
- 提交信息用中文或英文都可以，说明"为什么"。

这些规则里能机器判断的部分由 `npm run lint:arch` 检查，CI 不通过的 PR 不会被合并。

## 5. PR 流程与审核

1. Fork → 新分支 → 修改 → `npm run check` 通过（数据与词典、架构规则、单测）；
2. 本地打开页面，确认新增 / 修改的路由能渲染，中英切换正常；改了界面跑 `npm run test:e2e`；
3. 提 PR，填模板；CI 会跑数据校验与 Playwright 冒烟；
4. **所有改动都需要维护者 @YuchenZhu2335 审核通过才能合并**（`main` 受保护，CODEOWNERS 自动请求审核）。没有人可以直接推送到 `main`。

## 6. 什么不能进这个仓库

这里只放理念与框架。真实校友数据、学联内部 SOP 细节（报价、赞助条款、联系人）、密钥与云配置一律不进公开仓库，它们属于私有云上的部署。示例数据必须是虚构的。

---

## English summary

- **Propose** with the feature-proposal issue template: problem, audience, approach, data, whether you'll build it.
- **Add a module in five steps**: create `web/js/modules/<id>.js` calling `registerModule()`, add `web/data/<id>.json` and list it in `config.js`, add i18n keys to both dictionaries, add one `<script>` line to `index.html`, run `npm run check`. Modules that write data are split into `domain/<id>.js` (pure, unit-tested rules), `api/<id>.js` (`YL.api.route` handlers = the backend contract) and `modules/<id>.js` (UI); see `docs/engineering.md` and the Coffee Chat reference implementation. Write a one-page RFC in `docs/rfcs/` first.
- **Content** is plain JSON under `web/data/` with `{zh, en}` fields and unique ids. Never commit real personal contacts to the public repo.
- **Rules**: vanilla HTML/CSS/JS, no build step, no overseas CDNs, all text through the dictionary, escape user input, new modules touch business data only through `YL.api`. Machine-checkable rules run in CI (`scripts/check-architecture.mjs`).
