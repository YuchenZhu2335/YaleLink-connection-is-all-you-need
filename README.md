<p align="center">
  <img src="web/assets/logo.svg" width="72" alt="YaleLink">
</p>

<h1 align="center">YaleLink</h1>

<p align="center">
  耶鲁校友社群开源基础平台 · 以 <code>@yale.edu</code> 邮箱为信任基础的内部社区<br>
  <em>An open-source community platform for Yale students and alumni, built on the trust of a yale.edu inbox.</em>
</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="docs/vision.md">愿景</a> ·
  <a href="docs/modules.md">模块</a> ·
  <a href="docs/architecture.md">架构</a> ·
  <a href="docs/engineering.md">开发规则</a> ·
  <a href="CONTRIBUTING.md">共创指南</a> ·
  <a href="docs/deploy-china.md">国内部署</a>
</p>

---

## 这是什么

微信群是我们的默认社群，但它有三个天然缺陷：**圈子封闭、经验不沉淀、活动难组织**。
学长学姐在学习、生活、求职上踩过的坑，每年都在群聊里重新讲一遍；校招信息、内推机会、
创业资源散落在几十个群里；学联办一场活动的流程全靠交接时口口相传。

YaleLink 想做的是一个**属于耶鲁人自己的 APP**：

- **第一层信任**：只有 `@yale.edu`（在校）与 `@aya.yale.edu`（校友）邮箱可以登录；
- **经验沉淀**：内部论坛式的发帖与指南，把求职、生活、创业经验留下来；
- **走到哪都有组织**：按地区、兴趣、行业的子社群，随时发起或参加校友活动；
- **职业发展先行**：校招信息、内推、求职时间线、简历工坊、行业求职小组与 mock interview；
- **学联稳健运营**：ACSSY 成员专属后台，活动 SOP、联系人、沟通模板、志愿者招募、
  活动项目看板与任务分配，让接手的同学能快速上手。

它是一个**开源基底**：模块化、零依赖、数据即文件。任何人都可以提功能、加模块、补内容。

## 这个仓库放什么、不放什么

这里只放 **理念与框架**：产品愿景、模块化基底、界面原型、数据模型、部署方案，以及虚构的示例数据。

| 放在这里（公开） | 不放在这里（私有云） |
|---|---|
| 平台代码、模块框架、设计令牌 | 真实校友资料、目录、发帖、报名记录 |
| 数据模型与 API 契约（`docs/data-model.md`） | 学联真实 SOP 中的报价、赞助条款、联系人 |
| 虚构示例数据（人物、公司、活动均为编造） | 任何密钥、邮件服务凭证、云账号配置 |
| 愿景、路线图、部署与合规文档 | 用户上传的文件与照片 |

"只有 yale.edu 邮箱能进"是**产品**的边界，由私有云上的后端与数据库保证；代码本身开源，任何人都可以读、fork、复用。
真实数据的存储与访问控制方案见 [docs/architecture.md](docs/architecture.md) 与 [docs/deploy-china.md](docs/deploy-china.md)。

**欢迎大家一起提案**：功能模块（二手市场、拼车、导师配对、读书会……）、延展思路（其他高校学联复用、小程序壳、校友企业目录），
都可以通过 [功能提案](../../issues/new?template=feature_proposal.yml) 发起讨论。想法池见 [docs/roadmap.md](docs/roadmap.md)。

## 治理

- `main` 分支受保护：所有改动走 Pull Request，需要维护者（[@YuchenZhu2335](https://github.com/YuchenZhu2335)）审核通过后才能合并，见 [CODEOWNERS](.github/CODEOWNERS)。
- 外部贡献者 fork 后提 PR；CI 会自动跑数据校验与页面冒烟测试。
- 功能方向上的分歧在 Issue 里讨论，维护者做最终决定。

## 在线 Demo

> 仓库开启 GitHub Pages 后（Settings → Pages → Source 选 **GitHub Actions**），
> 地址为 `https://yuchenzhu2335.github.io/YaleLink-connection-is-all-you-need/`。
> 国内访问建议按 [docs/deploy-china.md](docs/deploy-china.md) 部署到腾讯云 COS / 阿里云 OSS。

**演示登录**：任意 `@yale.edu` / `@aya.yale.edu` 邮箱，验证码 `000000`。
在资料页把「学联身份」选为部员或负责人，即可看到学联后台。所有数据均为虚构示例。

## 两张面孔

| | 对外：校友社群平台 | 对内：ACSSY 学联后台 |
|---|---|---|
| 用户 | 所有通过邮箱验证的在校生与校友 | 声明了学联身份的成员（真实版由管理员审核） |
| 内容 | 职业发展、活动、子社群、创业、生活指南、校友目录 | 活动项目看板、SOP 库、联系人沉淀、沟通模板、志愿者招募 |
| 入口 | 首页各模块 | 侧栏「学联后台」（仅学联成员可见） |

两者通过「**我想办活动**」工作流连接：社群活动走轻量流程直接发布；学联官方活动选一份 SOP，
系统自动生成整套任务与截止日期，负责人分配、部员认领并定期反馈进度，活动页同步对外招募志愿者。

## 模块一览

| 模块 | 路由 | 说明 |
|---|---|---|
| 登录 | `#/login` | 邮箱域名白名单 → 验证码 → 首次完善资料（含学联身份） |
| 约咖啡 · 内测 | `#/coffee` | 报名、选空闲时段（美东 15 分钟一格）、按身份 / 诉求找人、预约与确认、接受后交换联系方式、意见箱、管理统计 —— 三层拆分的参考实现，见 [RFC 0001](docs/rfcs/0001-coffee-chat-beta.md) |
| 首页 | `#/home` | 学联推送（公告 / 志愿者招募 / 我的任务）、快捷入口、最新帖子、近期活动、精选校友 |
| 职业发展 | `#/careers` | 机会 & 内推 · 求职时间线 · 简历工坊 · 求职小组 & Mock · 行业研究（含贡献值榜） |
| 活动 | `#/events` | 按地区 / 类型筛选、RSVP、活动详情、「我想办活动」向导 |
| 社群 | `#/circles` | 兴趣 / 地区 / 行业子社群，加入、查看社群活动、在社群里办活动 |
| 创业 | `#/startup` | 校内资源指南（Tsai CITY 等）· 项目 & 找合伙人 · 「我需要 / 我能提供」匹配 |
| 生活指南 | `#/life` | 衣食住行 × 地区，经验帖，贡献条目 |
| 校友目录 | `#/directory` | 按行业 / 地区 / 可提供帮助筛选，个人主页，打招呼 |
| 学联后台 | `#/acssy` | 看板 · SOP · 联系人 · 模板 · 志愿者（仅学联成员） |
| 个人主页 | `#/profile` | 资料、我的帖子 / 活动 / 小组、贡献值与徽章 |
| 关于 & 共创 | `#/about` | 愿景、模块列表（自动生成）、路线图、参与方式 |

详细说明与每个模块的扩展点见 [docs/modules.md](docs/modules.md)。

## 快速开始

```bash
git clone https://github.com/YuchenZhu2335/YaleLink-connection-is-all-you-need.git
cd YaleLink-connection-is-all-you-need/web
python3 -m http.server 8000      # 或 npx serve .
# 浏览器打开 http://localhost:8000
```

零构建、零依赖：纯 HTML / CSS / JavaScript，数据在 `web/data/*.json`。
校验数据与词典：

```bash
npm run check      # 数据与词典校验 + 架构规则 + 单测（零依赖，Node ≥ 22）
```

## 目录结构

```
web/                 可部署的静态原型（部署根目录）
  index.html         单页壳；新增模块在这里加一行 <script>
  config.js          邮箱白名单、演示验证码、数据文件清单、学联部门
  css/               tokens（耶鲁蓝设计令牌）/ base（布局）/ components（组件）
  js/core/           i18n · router · store · auth · registry · ui —— 平台基底
  js/domain/         业务规则：纯函数，浏览器与将来的 Node 后端共用，配单测
  js/api/            接口实现：原型版"后端"，每条 YL.api.route 就是一份后端契约
  js/modules/        每个功能一个文件，registerModule() 注册即出现在导航
  data/              示例数据（JSON，双语字段 {zh, en}）
  i18n/              界面词典 zh.json / en.json
docs/                愿景 · 模块 · 架构 · 开发规则 · 数据模型 · 路线图 · 国内部署 · RFC
scripts/             数据校验脚本
tests/               Playwright 冒烟测试
.github/             Issue / PR 模板，CI 与 Pages 部署
```

## 如何共创

1. **提功能**：用 [功能提案](../../issues/new?template=feature_proposal.yml) 模板开 Issue，说清楚问题、目标用户和方案；
2. **加模块**：先写一页 [RFC](docs/rfcs/README.md)；新建 `web/js/modules/xxx.js`，调用 `registerModule()`，补词典与数据 —— 五步流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，有写操作的模块按 [开发规则](docs/engineering.md) 拆成 domain / api / 界面三层；
3. **补内容**：岗位、活动、指南、SOP、模板都只是 JSON，直接改 `web/data/` 提 PR；
4. **改文档**：愿景、路线图、部署方案欢迎讨论。

所有 PR 会自动跑数据校验与页面冒烟测试。

## 路线图

- **v0.1 静态原型**（当前）：全部模块可点击，localStorage 模拟写入，双语。
- **v0.2 真实后端**：邮箱验证码登录、Postgres、内容审核、学联身份审核。
- **v0.3 国内可用**：微信登录绑定、小程序壳、国内对象存储 + CDN、ICP 备案。
- **v0.4 社区治理**：贡献值体系、版主机制、活动模板市场。

详见 [docs/roadmap.md](docs/roadmap.md)。

## 许可证

[MIT](LICENSE)。示例数据中的人物、公司、联系人均为虚构。
