# 组件用法（web/css/components.css）

页面只用这些 class 拼装，**模块里不写样式**（`style="…"` 只允许头像以外的极少数动态值，原则上不用）。
图标一律 `YL.ui.icon(name)`（线性 SVG，名字见 `web/js/core/ui.js` 的 `ICONS`），不用 emoji。
所有动态文本先 `esc()`；可见文案走 `t(key)`；数据里的双语字段用 `L(field)`。
样式规则（颜色、圆角、状态）见 [system.md](system.md) §4–§6；这里只写"用哪个 class"。

## 页面骨架

```html
<section class="page">                         <!-- 竖向排列，块间距 32（桌面 48，§4.4）；页头和第一块之间自动收紧到 24 / 40；窄页面加 page--narrow（560）/ page--medium（760） -->
  <header class="page-head">
    <div class="page-head__text">
      <p class="eyebrow">本周 Coffee Chat</p>  <!-- 琥珀色眉题；英文自动全大写 -->
      <h1 class="page-title">为你推荐</h1>     <!-- 英文模式自动换 Newsreader -->
      <p class="page-sub">每周 3 位，和你的兴趣与诉求最合拍。</p>
    </div>
    <a class="btn btn--secondary btn--sm" href="#/coffee/browse">去找人</a>
  </header>
  …
</section>
```

- 布局：`stack`（竖排 16px，`stack--s` 8px / `stack--l` 24px）、`cluster`（横排换行，`cluster--between` / `cluster--end`）、`grid-cards`（手机单列，≥600 自动多列、最小 320）、`split`（桌面左主右侧栏 320px，`split--wide-aside` 384px；手机上下排）
- 区块标题：`YL.ui.sectionTitle(title, actionHtml, sub)`（行尾的 `btn--ghost` 链接自动和标题垂直居中、文字和下面卡片的右边对齐）
- 返回：页面第一个子元素 `<div><a class="btn btn--ghost btn--sm" href="…">${icon("chevronLeft")}返回</a></div>`——chevron 的笔画自动和正文左边对齐，和下面标题的间距自动收紧
- 文字：`muted`、`faint`、`small`、`xsmall`（13px，最小的段落字号）、`center`、`nowrap`、`break-all`（长邮箱 / 微信号）
- 卡片：`card`（surface + 1px 细线 + 16 圆角，**不加阴影**）、`card--quiet`（下沉的 surface-2）、`card--tight`、`card__title`
- 荧光笔 `<span class="lit">相遇</span>`（灯色平涂色带，每屏最多一处）；灯点 `<span class="lamp"></span>`（6px，"亮着"的记号）

## 按钮

`btn` + 变体，12px 圆角矩形（不是胶囊）：

| 变体 | 用在 |
|---|---|
| `btn--primary` | 每屏最主要的操作（保存、继续、想认识、见到了） |
| `btn--accent` | **只用于**"TA 想认识你 · 匹配"和"参加 Coffee Chat 周 / 月"，别处不用 |
| `btn--secondary` / `btn--ghost` | 次要 / 第三层操作 |
| `btn--danger` / `btn--danger-ghost` | 确认弹窗里的破坏性操作 / 列表里的"删除"入口 |
| `btn--matched` | 关系状态"已匹配"（苔绿实底，`check` 在前、`chevronRight` 在后，是链接） |
| `btn--invited` | 关系状态"已邀请"（透明底虚线，`clock` 图标，加 `aria-disabled="true"`） |

尺寸 `btn--sm`（44）/ 默认（48）/ `btn--lg`（56）；`btn--block` 占满宽度。
需要解释为什么不能点的（已达上限等）用 `aria-disabled="true"` + `aria-describedby`，不用 `disabled`。
处理中：`YL.ui.busy(btn, true)`（按钮上加 `data-busy-label="处理中…"` 时，减弱动效下显示这段文字代替转圈）。
只有图标的按钮：`<button class="icon-btn" aria-label="…">${icon("x")}</button>`。句子里的操作：`link-btn`。

## 标签、计数

- 只读标签：`YL.ui.tag(label, "tag--goal")`；容器 `tags`。修饰：`tag--goal`（诉求）、`tag--shared`（共同兴趣：字前自动画 6px 灯点，不用再放图标）、`tag--theme`（活动主题，描边）
- 计数：`<span class="count">3</span>` 灯色（等你处理的事：收件箱）；`count--neutral` 中性（结果数、筛选数、表格页签；放在按钮里的 `.count` 自动是中性的）。必须带数字
- 状态小标签 `pill`（高 24、圆角 6）：默认（"未回应"）、`pill--success`、`pill--warn`、`pill--danger`、`pill--incoming`、`pill--waiting`（虚线）

## 筛选与问卷选项

- 可点的筛选：`YL.ui.chips(items, activeId, "attr", "chips--scroll")` → `<button class="chip is-active" aria-pressed="true">`；选中 = 海军蓝 + 自动画的勾。`chips--scroll` 手机上横向滚动，桌面换行
- 表单里的多选 / 单选（问卷）：选中 = 灯色系（accent-soft + 描边 + 勾），表示"关于你的答案"。`.form` 里的 `.chip.is-active` 也按这个样子显示

```html
<div class="chips" role="group" aria-labelledby="q-goals">
  <label class="choice"><input type="checkbox" class="sr-only" name="goals" value="industry" checked><span class="chip">业界求职</span></label>
</div>
```

- 达到上限的选项：input 加 `aria-disabled="true"`；"+ 自定义"按钮：`chip chip--add`

## 表单

```html
<form class="form" novalidate>
  <div class="field" data-field="name">                    <!-- data-field = 接口 fields 的键，showFieldErrors 用它 -->
    <label class="field__label" for="f-name">名字<span class="req">*</span></label>
    <input class="input" id="f-name" name="name" maxlength="40" autocomplete="name">
    <p class="field__hint">别人会看到这个名字</p>
  </div>
  <div class="field" data-field="identity">
    <span class="field__label" id="l-identity">身份</span>
    <div class="radio-cards" role="radiogroup" aria-labelledby="l-identity">
      <label class="radio-card"><input type="radio" name="identity" value="student"><span class="radio-card__box"><strong>在读</strong><span>本科 / 硕士 / 博士</span></span></label>
    </div>
  </div>
  <label class="check-row"><input type="checkbox" name="agree"><span>我已阅读并同意 <a href="#/about/privacy">隐私说明</a></span></label>
  <label class="switch"><span class="switch__text"><span>智能推荐</span><small>用 DeepSeek 帮忙排序</small></span><input type="checkbox" role="switch"><span class="switch__track"></span></label>
  <button class="btn btn--primary btn--block">继续</button>
</form>
```

- 控件：`input`、`textarea`、`select`；验证码 `input input--code`（一个 input：`inputmode="numeric" autocomplete="one-time-code" maxlength="6"`，Newsreader 等宽数字，按 6 格排开；格距 48，视口 <400 / <360 自动缩到 42 / 36，320 宽也放得下，填满 6 位不会横向滚动）；输入框 + 按钮同一行 `input-row`
- `.form` 和 `.field` 都是单列 `minmax(0, 1fr)` 网格：里面再宽的东西也不会把卡片撑出屏幕
- 报错：`YL.ui.showFieldErrors(form, error.fields, "模块名")`（错误文字前自动画圆形叹号）；清除：`clearFieldErrors(form)`；字数 `field__count`（超出加 `is-over`）
- 首次填写进度（圆圈里的数字 / 勾由 CSS 画）：`<ol class="steps"><li class="steps__item is-done">同意说明</li><li class="steps__item is-current" aria-current="step">联系邮箱</li><li class="steps__item">资料</li></ol>`

## 人物卡

```html
<article class="person person--rec">                         <!-- 推荐卡加 person--rec（顶部一条细横线） -->
  <div class="person__head">
    ${avatar(name)}                                            <!-- 拱形 56×64 -->
    <div class="person__who">
      <a class="person__name" href="#/coffee/p/ID">林可欣</a>
      <p class="person__meta"><span>硕士 · 2027 届</span><span>科技互联网</span></p>   <!-- span 之间自动加"·" -->
    </div>
    <button class="icon-btn" aria-label="不感兴趣：林可欣">${icon("x")}</button>      <!-- 可选：右上角 -->
  </div>
  <ul class="person__reasons"><li class="reason"><span>你们都喜欢徒步、咖啡</span></li></ul>   <!-- 灯点由 CSS 画；旧代码里的图标会被隐藏 -->
  <div class="tags">…</div>
  <p class="person__intro">一句话介绍</p>                      <!-- 列表里最多 2 行 -->
  <p class="person__note">邀请留言</p>
  <div class="person__foot">                                  <!-- 手机：说明一行、按钮另起一行占满 48；≥600 并排 -->
    <span class="person__overlap">${icon("clock")} 3 个共同空闲时间</span>
    <div class="person__actions"><button class="btn btn--primary btn--sm">${icon("plus")}想认识</button></div>
  </div>
</article>
```

底部布局：单列列表里放得下就"说明 + 按钮"并排；在 `grid-cards` 网格里（找人、收件箱）永远是说明一行、按钮一整行（两个按钮各占一半），同一行卡片的分隔线和按钮对齐。

关系状态（`relation.state`）→ 右下角（§5.4）：
`none` → `btn btn--primary btn--sm`「想认识」（`plus`）；
`invited` → `<span class="btn btn--invited btn--sm" aria-disabled="true">${icon("clock")}已邀请</span>`；
`incoming` → `btn btn--accent btn--sm`「TA 想认识你 · 匹配」（`arch`）；
`matched` → `<a class="btn btn--matched btn--sm" href="#/coffee/matches">${icon("check")}已匹配${icon("chevronRight")}</a>`；
`no_reply` → `<span class="pill">未回应</span>`。
（旧写法 `pill pill--waiting` / `a.pill--matched` 放在 `person__actions` 里也会按同样的状态按钮显示。）
没有共同空闲时间时 `person__overlap person__overlap--none`。

匹配后的联系方式：`<div class="contact"><div><p class="contact__label">微信</p><p class="contact__value">demo-123</p></div><button class="btn btn--secondary btn--sm">复制</button></div>`

头像：`avatar(name)` 默认 56×64；`avatar(name, "sm")` 36×42（顶栏、列表）；`"lg"` 72×84（匹配页头、详情）；`"xs"` 24×28。全部是拱形（`avatar--s` / `avatar--l` 是同样尺寸的别名）。

## 约咖啡专用

- 本轮横幅：`<section class="banner">`（纸色卡片）内含 `banner__eyebrow`（前面自动画灯点）、`banner__title`、`banner__meta`（`<span>${icon("calendar")}10/5–10/11</span>`）、`banner__actions`；大数字用 `<strong class="banner__stat">37</strong>`；人数不足时进度条 `<div class="progress"><span style="width:70%"></span></div>`
- 活动轮横幅 `banner banner--event`：**夜色块**（自带 `.inverse` 的配色，不用再加；这一屏只能有这一块），右上角自动画夜色版图形标；里面的按钮用 `btn--accent`「参加 Coffee Chat 月」
- 我的进度：`<nav class="statusbar"><a class="statusbar__item" href="#/coffee/times"><strong>8</strong><span>空闲时间</span></a>…</nav>`（数字用 Newsreader）
- 空闲时间：
  - 时区说明 `slots__tz`
  - 日期条 `slots__days`（手机上横向滚动、伸到屏幕边；8 天以上每格 52 宽；桌面 ≥900 和用鼠标的平板改成换行网格，全部日期一次看见）里放 `<button class="day is-active has-picks" aria-pressed="true"><span class="day__wd">周二</span><span class="day__d">10/6</span><span class="day__dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr-only">已选 3 个</span></button>`（最多 3 个点）。旧写法 `day__n`（文字）只显示 1 个点、文字留给读屏
  - 格子 `slots__grid` 里放 `<button class="slot" aria-pressed="true">19:20<small>北京 次日 07:20</small></button>`（已选 = 亮灯 + 勾）
    - 已约定 `slot is-locked`（右上角锁），已截止 `slot is-closed`（斜纹）。两者都用 `aria-disabled="true"` 留在 Tab 顺序里（`disabled` 也能显示对）
  - 图例 `slot-legend`（`<span><i class="is-selected"></i>已选</span>`）
  - 吸底保存条 `<div class="savebar"><span>已选 <strong>8</strong> 个</span><button class="btn btn--primary btn--sm">保存</button></div>`（`strong` 是 Newsreader 22）。放在 `.page` 的最后：手机上 sticky 在标签栏上方、滚到底落在页脚细线上；桌面 ≥900 固定在距底 16、和 `page--medium` 同宽。
    页面有保存条时模块在 `<body>` 上加 `has-savebar`（离开页面时去掉）：toast 抬到条上方、页脚留出条的高度。支持 `:has()` 的浏览器不加也对，老内核（Chrome <105 的 WebView）要靠这个类
- 匹配成功页头（夜色块，自带 `.inverse` 配色；新匹配第一次打开加 `is-new` 播放拱线 + 灯点动画）：

  ```html
  <header class="match-hero is-new">
    <div class="match-hero__pair">                                   <!-- 两人头顶之间的拱线和灯点由 CSS 画 -->
      <div class="match-hero__person">${avatar(me, "lg")}<span>陈思远</span></div>
      <div class="match-hero__person">${avatar(them, "lg")}<span>林可欣</span></div>
    </div>
    <h2 class="match-hero__title">你们匹配上了</h2>
    <p class="match-hero__sub">林可欣也想认识你</p>
  </header>
  ```
- 共同空闲时间（匹配页一键约定）：`<div class="times"><button class="time">10/7 周三 19:20<small>北京 10/8 07:20</small></button></div>`，已约定 `time is-selected`（海军蓝 + 锁）；只读展示用 `<span class="time">`

## 其他

- 页内标签页：`YL.ui.tabs([{ id, labelKey, badge }], activeId, "#/admin")`；分段控件：`segmented` + `segmented__item`（`is-active` / `aria-current` / `aria-selected`）
- 筛选区：`filters` > `filter-row` > `filter-row__label` + chips
- 提示条：`<div class="notice notice--info">${icon("info")}<div class="notice__body"><p><strong>标题</strong></p><p>…</p></div></div>`，变体 `notice--accent`（`arch`）/ `--warn`（`alert`）/ `--success`（`check`）/ `--danger`（`alertCircle`）；标题的 `strong` 自动用变体色
- 列表：`list` > `list__item`（`list__main` > `list__title` + `list__sub`）；统计 `stats` > `YL.ui.stat(value, label)`（名称在上、Newsreader 大数字在下；放在 `card` 里自动变成下沉色块）；表格 `table-wrap` > `table`（数字列 `td.num`）；键值 `dl.kv`
- 空状态 `YL.ui.emptyState(iconName, text, actionHtml)`（拱形图标框；第一段文字当标题）；加载 `YL.ui.spinner()`；骨架 `skeleton`（静止色块）
- 弹窗 `YL.ui.modal(html, { label, onMount(panel, close) })`，标题用 `modal__title`（手机是底部弹层，桌面居中）；确认 `await YL.ui.confirm(text, { danger: true })`（手机上按钮竖排、主操作在上）
- toast：`YL.ui.toast(text, "success" | "error")`，夜色浮层，`success` 前面自动画勾、`error` 画圆形叹号；有吸底保存条时自动抬高
- 首页：`hero`（`hero__eyebrow`、`hero__title` 里 `<em>` = `.lit` 荧光笔、`hero__lead`、`hero__cta`）、三步 `how` > `how__step`（序号 1 2 3 由 CSS 计数器画，Newsreader）
- 活动文章：`article` > `article__hero`（`article__title`、`article__meta`；拱 + 地平线 + 升起的灯由 CSS 画）+ `prose`（长文，保留换行）+ `copybox`（`copybox__head`、`copybox__text`）
- 后台：`admin-grid`、`stats`、`table-wrap`
- 页脚品牌（§9 第 2 种组合，竖排左对齐）：`<div class="footer__brand"><span class="wordmark">yale<i>lux</i></span><span>中文 tagline</span><span lang="en">English tagline</span></div>`（第二行 14/500 ink-2，第三行 13/400 ink-3）
- 外壳（`web/js/app.js`，样式在 base.css）：顶栏 `topbar` > `brand`（`brand__mark` + `wordmark brand__word`）、`topnav__item`（当前项 = 下沿 2px 横线）、`lang-toggle`、`topbar__me`；手机底部 `tabbar__item`（当前项 = 变色 + 600 + 图标上方灯点，`aria-current="page"`；收件箱带 `.count`）；字标活字 `<span class="wordmark">yale<i>lux</i></span>`
