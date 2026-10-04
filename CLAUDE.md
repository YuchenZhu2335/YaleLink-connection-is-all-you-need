# YaleLink — 给 AI 辅助贡献者的项目约定

## 项目是什么
耶鲁校友社群开源平台的**静态原型**：纯 HTML/CSS/原生 JS，零依赖、零构建，`web/` 即部署根目录。
对外是校友社群平台（约咖啡内测 / 职业 / 活动 / 社群 / 创业 / 生活 / 目录），对内是 ACSSY 学联后台（看板 / SOP / 联系人 / 模板 / 志愿者）。
开发规则全文见 `docs/engineering.md`，新功能先看 `docs/rfcs/`。

## 硬性约束
- `web/` 下不引入 npm 运行时依赖、打包器、框架；不引用境外 CDN（要在中国大陆可访问）。
- 分层，依赖只能往下：`modules`（界面）→ `api`（接口实现 = 后端契约）→ `domain`（纯函数业务规则）；`core` 谁都能用。
  - 新模块的业务数据只通过 `YL.api.get / post` 读写，不用 `YL.store` 读写（字典表 `term / terms / region / regions` 除外）；
  - 状态机、权限、校验写在 `web/js/domain/<id>.js`，不碰 DOM / 存储 / 网络 / 当前时间，配 `tests/unit/<id>.test.js`；
  - 界面不自己判断权限，按接口返回的 `actions` / `state` 显示按钮；`await` 之后先检查 `ctx.isActive()`；
  - 模块之间只用路由链接，或 `PUBLIC_MODULE_API` 白名单里的接口。
- 所有可见文案走 `YL.ui.t(key)`，数据中的文案字段是 `{zh, en}` 并用 `YL.ui.L()` 取值；两份词典 key 必须一致。
- 所有插入 HTML 的动态内容必须 `esc()`；数据里的链接用 `YL.ui.safeUrl()`；`t()` 的 key 含动态部分时结果也要 `esc()`。
- 数据文件在 `web/data/*.json`，每条有唯一 `id`；新增集合要在 `web/config.js` 的 `dataFiles` 登记。
- 一个功能 = 一个模块 id：只读模块一个 `web/js/modules/<id>.js`；有写操作的再加同名 `domain/` 与 `api/` 文件；`index.html` 按 core → domain → api → modules 的顺序各加一行 `<script>`。
- 新增模块、改核心层、改数据契约之前先写 RFC（`docs/rfcs/`）。

## 目录速查
- `web/js/core/`：i18n、ui、registry、audit（审计日志）、store（seed JSON + localStorage overlay）、auth（邮箱白名单、学联身份）、api（本地 mock / 真实后端二选一）、router（hash、异步渲染）。
- `web/js/domain/`、`web/js/api/`：coffee（参考实现）。
- `web/js/modules/`：login、home、coffee、careers、events、circles、acssy、startup、life、directory、profile、about。其中除 coffee、about 外都是直接用 `YL.store` 的存量模块（名单见 `scripts/check-architecture.mjs` 的 `LEGACY_STORE_MODULES`，只减不增）。
- `web/data/`：regions、taxonomy、users、posts、jobs、timelines、groups、events、resources、projects、circles、playbooks、campaigns、contacts、templates、coffeeEvents、coffeeProfiles、coffeeBookings、coffeeNotices、coffeeFeedback。
- `docs/`：vision、modules、architecture、engineering（开发规则）、data-model、roadmap、deploy-china、rfcs/。

## 验证
```bash
npm run check                           # = 数据与词典校验 + 架构守门（A1–A10）+ node --test 单测，全部零依赖
npm run test:e2e                        # Playwright：tests/smoke.spec.js（需要 npm ci）
cd web && python3 -m http.server 8000   # 本地预览
```

## 演示约定
- 登录：任意 `@yale.edu` / `@aya.yale.edu`，验证码见 `config.js`（默认 000000）。
- 用户在演示中创建的内容作者 id 为 `"me"`，`YL.store.user("me")` 会从会话合成；`YL.api` 的本地实现里当前用户 id 也是 `"me"`。
- Coffee Chat：原型中"学联负责人"即管理员；活动日期在 `web/data/coffeeEvents.json`，涉及时间的测试要固定时钟（`page.clock.setFixedTime`）。
- 示例数据全部虚构，不要加入真实联系人；示例邮箱一律 `@example.com`（校验脚本会检查）。
