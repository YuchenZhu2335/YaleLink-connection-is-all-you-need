# 组件用法（web/css/components.css）

页面只用这些 class 拼装，**模块里不写样式**（`style="…"` 只允许头像以外的极少数动态值，原则上不用）。
图标一律 `YL.ui.icon(name)`（线性 SVG，名字见 `web/js/core/ui.js` 的 `ICONS`），不用 emoji。
所有动态文本先 `esc()`；可见文案走 `t(key)`；数据里的双语字段用 `L(field)`。

## 页面骨架

```html
<section class="page">                         <!-- 竖向排列，块间距 24px；窄页面加 page--narrow（560）/ page--medium（760） -->
  <header class="page-head">
    <div class="page-head__text">
      <p class="eyebrow">本周 Coffee Chat</p>
      <h1 class="page-title">为你推荐</h1>
      <p class="page-sub">每周 3 位，和你的兴趣与诉求最合拍。</p>
    </div>
    <a class="btn btn--secondary btn--sm" href="#/coffee/browse">去池子里挑</a>
  </header>
  …
</section>
```

- 布局：`stack`（竖排 16px，`stack--s` 8px / `stack--l` 24px）、`cluster`（横排换行，`cluster--between` / `cluster--end`）、`grid-cards`（卡片自适应网格，单列→多列）、`split`（桌面左主右侧栏 320px，手机上下排）
- 区块标题：`YL.ui.sectionTitle(title, actionHtml, sub)`
- 文字：`muted`、`faint`、`small`、`xsmall`、`center`
- 卡片：`card`（白底描边）、`card--quiet`（浅灰底）、`card--tight`、`card__title`

## 按钮

`btn` + `btn--primary`（主操作，每屏一个）/ `btn--accent`（"光"色，用于"想认识"这类关键互动）/ `btn--secondary` / `btn--ghost` / `btn--danger` / `btn--danger-ghost`；尺寸 `btn--sm` / `btn--lg`；`btn--block` 占满宽度。
处理中：`YL.ui.busy(btn, true)`。只有图标的按钮：`<button class="icon-btn" aria-label="…">${icon("x")}</button>`。文字链接样式的按钮：`link-btn`。

## 标签

- 只读标签：`YL.ui.tag(label, "tag--goal")`；容器 `tags`。修饰：`tag--goal`（诉求）、`tag--shared`（和我相同的兴趣，高亮）、`tag--theme`（活动主题）
- 可点的筛选：`YL.ui.chips(items, activeId, "attr", "chips--scroll")` → `<button class="chip is-active" data-attr="id">`
- 表单里的多选 / 单选（问卷）：

```html
<div class="chips" role="group" aria-labelledby="q-goals">
  <label class="choice"><input type="checkbox" class="sr-only" name="goals" value="industry" checked><span class="chip">业界求职</span></label>
</div>
```

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

- 控件：`input`、`textarea`、`select`；验证码 `input input--code`（`inputmode="numeric" autocomplete="one-time-code" maxlength="6"`）；输入框 + 按钮同一行 `input-row`
- 报错：`YL.ui.showFieldErrors(form, error.fields, "模块名")`；清除：`clearFieldErrors(form)`；字数 `field__count`
- 首次填写进度：`<ol class="steps"><li class="steps__item is-done">同意说明</li><li class="steps__item is-current">联系邮箱</li><li class="steps__item">资料</li></ol>`

## 人物卡

```html
<article class="person person--rec">                         <!-- 推荐卡加 person--rec（光晕描边） -->
  <div class="person__head">
    ${avatar(name)}
    <div class="person__who">
      <a class="person__name" href="#/coffee/p/ID">林可欣</a>
      <p class="person__meta"><span>硕士 · 2027 届</span><span>科技互联网</span></p>
    </div>
  </div>
  <ul class="person__reasons"><li class="reason">${icon("sparkle")}<span>你们都喜欢徒步、咖啡</span></li></ul>
  <div class="tags">…</div>
  <p class="person__intro">一句话介绍</p>
  <p class="person__note">邀请留言</p>
  <div class="person__foot">
    <span class="person__overlap">${icon("clock")} 3 个共同空闲时间</span>
    <div class="person__actions"><button class="btn btn--accent btn--sm">想认识</button></div>
  </div>
</article>
```

关系状态（`relation.state`）→ 右下角显示：
`none` → `btn btn--accent btn--sm`「想认识」；`invited` → `<span class="pill pill--waiting">已邀请</span>`；`incoming` → `btn btn--accent btn--sm`「TA 想认识你 · 点我匹配」；`matched` → `<a class="pill pill--matched" href="#/coffee/matches">已匹配</a>`；`no_reply` → `<span class="pill">未回应</span>`。没有共同空闲时间时 `person__overlap person__overlap--none`。

匹配后的联系方式：`<div class="contact"><div><p class="contact__label">微信</p><p class="contact__value">demo-123</p></div><button class="btn btn--secondary btn--sm">复制</button></div>`

## 约咖啡专用

- 本轮横幅：`<section class="banner">`（活动轮 `banner--event`）内含 `banner__eyebrow`、`banner__title`、`banner__meta`（`<span>${icon("calendar")}10/5–10/11</span>`）、`banner__actions`
- 我的进度：`<div class="statusbar"><a class="statusbar__item" href="#/coffee/times"><strong>8</strong><span>空闲时间</span></a>…</div>`
- 空闲时间：
  - 时区说明 `slots__tz`
  - 日期条 `slots__days` 里放 `<button class="day is-active has-picks"><span class="day__wd">周二</span><span class="day__d">10/6</span><span class="day__n">已选 3</span></button>`
  - 格子 `slots__grid` 里放 `<button class="slot" aria-pressed="true">19:20<small>北京 07:20</small></button>`
    - 已约定 `slot is-locked`（disabled）
    - 过了截止 `slot is-closed`（disabled）
  - 图例 `slot-legend`
  - 吸底保存条 `savebar`
- 共同空闲时间（匹配卡里一键约定）：`<div class="times"><button class="time">10/7 周三 19:20<small>北京 10/8 07:20</small></button></div>`，已约定 `time is-selected`

## 其他

- 页内标签页：`YL.ui.tabs([{ id, labelKey, badge }], activeId, "#/coffee/inbox")`；分段控件：`segmented` + `segmented__item`
- 筛选区：`filters` > `filter-row` > `filter-row__label` + chips
- 提示条：`<div class="notice notice--info">${icon("info")}<div class="notice__body">…</div></div>`，变体 `notice--accent / --warn / --success / --danger`
- 列表：`list` > `list__item`（`list__main` > `list__title` + `list__sub`）；统计 `stats` > `YL.ui.stat(value, label)`；表格 `table-wrap` > `table`；键值 `dl.kv`
- 空状态 `YL.ui.emptyState(iconName, text, actionHtml)`；加载 `YL.ui.spinner()`；骨架 `skeleton`
- 弹窗 `YL.ui.modal(html, { label, onMount(panel, close) })`，标题用 `modal__title`；确认 `await YL.ui.confirm(text, { danger: true })`
- 首页：`hero`（`hero__eyebrow`、`hero__title` 里 `<em>` 高亮、`hero__lead`、`hero__cta`）、三步 `how` > `how__step`
- 活动文章：`article` > `article__hero`（`article__title`、`article__meta`）+ `prose`（正文，保留换行）+ `copybox`（`copybox__head`、`copybox__text`）
- 后台：`admin-grid`、`stats`、`table-wrap`
