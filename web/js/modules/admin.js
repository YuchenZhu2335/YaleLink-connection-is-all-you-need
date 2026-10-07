/* 管理后台（给 2–3 位 ACSSY 组织者用）
   Admin console for the handful of ACSSY organizers.

   路由 / routes
     #/admin（= #/admin/overview）  概览：本轮、用户、累计、近 7 天邮件、意见数
     #/admin/rounds                 轮次列表（每周轮 + 活动轮）
     #/admin/rounds/new             新建活动轮
     #/admin/rounds/:id             编辑活动轮（每周轮自动生成，不能改）
     #/admin/members                成员：嘉宾邮箱登记、导师标记（RFC 0003 §5）
     #/admin/feedback               意见箱
     #/admin/emails                 发信记录
     #/admin/audit                  审计日志

   按设计只看汇总：接口不返回任何人的联系方式（server/admin.js）。数据只走 YL.api，契约见 docs/api.md「管理」。
   日期校验用前后端共用的 YL.domain.coffee.validateRound，最终以接口返回为准。
   门禁在本模块里做（不用路由的 adminOnly）：在管理员名单里、但这次用联系邮箱登录的人（adminNeedsYale）
   会看到"用耶鲁邮箱重新登录"，见文件末尾的 renderGate。 */
(function () {
  "use strict";
  const { t, L, esc, icon } = YL.ui;
  const D = YL.domain.coffee;

  const TABS = [
    { id: "overview", labelKey: "admin.tab.overview" },
    { id: "rounds", labelKey: "admin.tab.rounds" },
    { id: "members", labelKey: "admin.tab.members" },
    { id: "feedback", labelKey: "admin.tab.feedback" },
    { id: "emails", labelKey: "admin.tab.emails" },
    { id: "audit", labelKey: "admin.tab.audit" }
  ];
  // 与 server/admin.js 的截断长度一致（tagLen 是前端自己的上限：标签是不换行的胶囊，太长会把表格和活动页撑宽）
  const MAX = { titleZh: 60, titleEn: 80, postTitle: 80, body: 4000, wechat: 2000, tags: 5, tagLen: 20, days: 31, recMin: 1, recMax: 10, recDefault: 5 };
  const ROUND_KINDS = ["weekly", "event"];
  const ROUND_STATUSES = ["draft", "published"];
  const MAIL_KINDS = ["login_code", "contact_code", "match", "scheduled", "invite_digest", "reminder", "weekly", "event"];
  const MAIL_STATUSES = ["sent", "failed", "skipped"];
  const FB_KINDS = ["bug", "idea", "report", "other"]; // report = 举报（PRD 4.8：24 小时内处理或转交）
  const DASH = "—";

  // 保存活动轮后回到列表时显示一次的提示 { id, title, status }
  let flash = null;
  // 活动轮表单里还没保存的内容，按轮次 id（新建为 "new"）暂存在内存里：
  // 切换语言（路由会重绘）、点标签页或返回再回来时自动填回，并提示可以放弃。保存成功后清掉。
  const drafts = {};
  // 当前打开的表单：{ key, form }，只用于关页面 / 刷新前提醒
  let openForm = null;
  window.addEventListener("beforeunload", (e) => {
    if (openForm && openForm.form.isConnected && drafts[openForm.key]) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- 格式化 ---------- */
  const num = (n) => YL.ui.num(n);
  // 活动名称：英文名是选填的（后端存 ""），L() 会原样返回空串，这里退回到另一种语言
  const roundName = (f) => (f && typeof f === "object" ? L(f) || f.zh || f.en || "" : L(f));
  // 不换行的标签：显示时截短，避免把表格撑宽（完整文字放在编辑页里）
  const clip = (s, n) => { const a = Array.from(String(s == null ? "" : s)); return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
  // 邮件服务商的报错可能带收件地址：显示前把像邮箱的部分遮掉（这里承诺看不到任何人的联系方式）
  const maskEmails = (s) => String(s == null ? "" : s).replace(/[^\s<>()"',;:@]+@[^\s<>()"',;:@]+/g, "***@***");
  const enc = (s) => esc(encodeURIComponent(String(s == null ? "" : s)));
  // 派生比例的说明文字：分母为 0 时没有意义，不显示（返回 ""）
  const rate = (a, b, text) => (Number(b) > 0 ? text(Math.round(((Number(a) || 0) / Number(b)) * 100) + "%") : "");
  const when = (iso) => (iso ? YL.ui.formatDateTime(iso) || DASH : DASH);
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dayCount = (s, e) => Math.round((Date.parse(e + "T00:00:00Z") - Date.parse(s + "T00:00:00Z")) / 86400000) + 1;
  function range(r) {
    if (!isDate(r.startDate) || !isDate(r.endDate)) return DASH;
    const long = { year: "numeric", month: "short", day: "numeric" };
    const sameYear = r.startDate.slice(0, 4) === r.endDate.slice(0, 4);
    return YL.ui.formatDate(r.startDate, long) + " – " + YL.ui.formatDate(r.endDate, sameYear ? undefined : long);
  }
  // 轮次所处阶段（只做显示）
  function phase(r) {
    if (!isDate(r.startDate) || !isDate(r.endDate)) return "";
    const now = new Date().toISOString();
    try { return D.isRoundOver(r, now) ? "over" : D.isRoundOpen(r, now) ? "open" : "upcoming"; } catch (e) { return ""; }
  }
  const phaseLabel = (p) => (p === "over" ? t("admin.phase.over") : p === "open" ? t("admin.phase.open") : p === "upcoming" ? t("admin.phase.upcoming") : "");
  const kindLabel = (k) => (ROUND_KINDS.indexOf(k) >= 0 ? t("admin.kind." + k) : String(k || DASH));
  const statusLabel = (s) => (ROUND_STATUSES.indexOf(s) >= 0 ? t("admin.status." + s) : String(s || DASH));
  const mailKindLabel = (k) => (MAIL_KINDS.indexOf(k) >= 0 ? t("admin.mailKind." + k) : String(k || DASH));
  const mailStatusLabel = (s) => (MAIL_STATUSES.indexOf(s) >= 0 ? t("admin.mailStatus." + s) : String(s || DASH));
  const fbKindLabel = (k) => (FB_KINDS.indexOf(k) >= 0 ? t("admin.fbKind." + k) : String(k || DASH));

  /* ---------- 小部件 ---------- */
  const pill = (text, cls, iconName) => `<span class="pill${cls ? " " + cls : ""}">${iconName ? icon(iconName) : ""}${esc(text)}</span>`;
  const roundStatusPill = (s) => pill(statusLabel(s), s === "published" ? "pill--success" : "");
  const MAIL_PILL = { sent: "pill--success", failed: "pill--warn", skipped: "" };
  const FB_PILL = { bug: "pill--warn", idea: "pill--incoming", report: "pill--danger", other: "" };
  // 统计卡（§5.19）：名称在上（CSS 调换顺序）、Newsreader 大数字、数字下方 14px 的派生比例
  const stat = (value, label, note) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span>${note ? `<p>${esc(note)}</p>` : ""}</div>`;
  const moreLink = (href, text) => `<a class="btn btn--ghost btn--sm" href="${href}">${esc(text)}${icon("arrowRight")}</a>`;
  // 提示条（§5.7）：图标跟着变体走；不带变体的中性提示条用传入的图标
  const NOTICE_ICON = { "notice--info": "info", "notice--accent": "arch", "notice--success": "check", "notice--warn": "alert", "notice--danger": "alertCircle" };
  const noticeHtml = (cls, iconName, inner, extra) => `<div class="notice${cls ? " " + cls : ""}"${extra || ""}>${icon(NOTICE_ICON[cls] || iconName)}<div class="notice__body">${inner}</div></div>`;
  // 空状态（§5.11）：标题 + 可选正文 + 最多一个操作
  const empty = (ic, title, body, action) => `<div class="empty"><div class="empty__icon">${icon(ic, { size: 28 })}</div><p class="empty__title">${esc(title)}</p>${body ? `<p>${esc(body)}</p>` : ""}${action || ""}</div>`;
  const errorBox = (error) => empty("alertCircle", YL.ui.errorText(error, "admin"), "", `<button type="button" class="btn btn--primary" data-act="retry">${icon("refresh")}<span>${esc(t("common.retry"))}</span></button>`);
  // 表格里不放 .sr-only（绝对定位的元素会跑出 .table-wrap 的滚动区，在手机上把整页撑宽），用 aria-label。
  // 单元格里也不用 .stack：它的子元素 min-width: 0，表格算列宽时这一列会缩成几乎为 0，内容压到旁边的列上；用 .cluster（flex）
  // numCols：数字列的下标（表头和单元格都加 .num：右对齐、等宽数字）
  function table(caption, heads, rows, numCols) {
    const numCls = (i) => ((numCols || []).indexOf(i) >= 0 ? ' class="num"' : "");
    return `<div class="table-wrap"><table class="table" aria-label="${esc(caption)}">
      <thead><tr>${heads.map((h, i) => `<th scope="col"${numCls(i)}>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>`;
  }

  // 给 HTML 片段的第一个元素加上 data-list（列表区，筛选时整块替换）
  const asList = (html) => String(html).replace(/^\s*<([a-z]+)/, "<$1 data-list");

  // 每个管理页的页头：标题、标签页、"只看汇总"的说明（opts.note 换成这一页自己的说明）
  function head(active, opts) {
    const o = opts || {};
    return `<header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">${esc(t("admin.eyebrow"))}</p>
          <h1 class="page-title">${esc(t("admin.title"))}</h1>
        </div>
        ${o.refresh ? `<button type="button" class="btn btn--secondary btn--sm" data-act="refresh">${icon("refresh")}<span>${esc(t("admin.refresh"))}</span></button>` : ""}
      </header>
      ${YL.ui.tabs(TABS, active, "#/admin")}
      ${noticeHtml("notice--info", "", `<p>${esc(o.note || t("admin.privacy"))}</p>`)}`;
  }
  // 页面内容直接接在页头后面、作为 .page 的子元素：.table-wrap 必须是网格的直接子元素，
  // 手机上表格才会在框里横向滚动，而不是把整页撑宽（中间多一层网格就会被表格的最小宽度撑开）。
  function mount(root, active, opts) {
    const top = head(active, opts);
    root.innerHTML = `<section class="page" data-admin tabindex="-1" aria-busy="true">${top}${YL.ui.spinner()}</section>`;
    const page = root.firstElementChild;
    return {
      page,
      paint(html) { page.innerHTML = top + html; page.removeAttribute("aria-busy"); },
      busy(on) { if (on) page.setAttribute("aria-busy", "true"); else page.removeAttribute("aria-busy"); }
    };
  }

  /* ---------- 概览 ---------- */
  function overviewHtml(d) {
    const u = d.users || {}, a = d.allTime || {}, r = d.round;
    const mails = (Array.isArray(d.emails7d) ? d.emails7d : []).slice().sort((x, y) =>
      (MAIL_KINDS.indexOf(x.kind) - MAIL_KINDS.indexOf(y.kind)) || (MAIL_STATUSES.indexOf(x.status) - MAIL_STATUSES.indexOf(y.status)));
    const failed = mails.filter((m) => m.status === "failed").reduce((s, m) => s + (Number(m.n) || 0), 0);
    const unreported = Math.max(0, (a.matches || 0) - (a.met || 0) - (a.missed || 0));

    const warn = failed ? noticeHtml("notice--warn", "", `<p>${esc(t("admin.ov.mailFailed", { n: num(failed) }))} <a href="#/admin/emails">${esc(t("admin.ov.seeEmails"))}</a></p>`) : "";

    const users = `<section class="stack">
      ${YL.ui.sectionTitle(t("admin.ov.users"))}
      <div class="stats">
        ${stat(num(u.total), t("admin.ov.total"))}
        ${stat(num(u.profileDone), t("admin.ov.profileDone"), rate(u.profileDone, u.total, (pct) => t("admin.ov.ofUsers", { pct })))}
        ${stat(num(u.contactVerified), t("admin.ov.contactVerified"), rate(u.contactVerified, u.total, (pct) => t("admin.ov.ofUsers", { pct })))}
        ${stat(num(u.smartRecOff), t("admin.ov.smartRecOff"), rate(u.smartRecOff, u.total, (pct) => t("admin.ov.ofUsers", { pct })))}
      </div>
    </section>`;

    const allTime = `<section class="stack">
      ${YL.ui.sectionTitle(t("admin.ov.allTime"), "", t("admin.ov.allTimeSub"))}
      <div class="stats">
        ${stat(num(a.matches), t("admin.ov.matches"))}
        ${stat(num(a.met), t("admin.ov.met"), rate(a.met, a.matches, (pct) => t("admin.ov.ofMatches", { pct })))}
        ${stat(num(a.missed), t("admin.ov.missed"), rate(a.missed, a.matches, (pct) => t("admin.ov.ofMatches", { pct })))}
        ${stat(num(unreported), t("admin.ov.unreported"), rate(unreported, a.matches, (pct) => t("admin.ov.ofMatches", { pct })))}
      </div>
    </section>`;

    const mailRows = mails.map((m) => `<tr><td>${esc(mailKindLabel(m.kind))}</td><td>${pill(mailStatusLabel(m.status), MAIL_PILL[m.status] || "")}</td><td class="num">${esc(num(m.n))}</td></tr>`);
    const emails = `<section class="stack">
      ${YL.ui.sectionTitle(t("admin.ov.emails"), moreLink("#/admin/emails", t("admin.ov.allEmails")))}
      ${mails.length
        ? table(t("admin.ov.emails"), [esc(t("admin.col.kind")), esc(t("admin.col.status")), esc(t("admin.col.count"))], mailRows, [2])
        : `<div class="card card--quiet">${empty("mail", t("admin.ov.noEmails"))}</div>`}
    </section>`;

    const feedback = `<section class="stack">
      ${YL.ui.sectionTitle(t("admin.ov.feedback"), moreLink("#/admin/feedback", t("admin.ov.readFeedback")))}
      <div class="stats">${stat(num(d.feedback), t("admin.ov.feedbackCount"))}</div>
    </section>`;

    return `${warn}
      <section class="stack">
        ${YL.ui.sectionTitle(t("admin.ov.round"), moreLink("#/admin/rounds", t("admin.ov.allRounds")))}
        ${roundCard(r)}
      </section>
      ${users}
      ${allTime}
      <div class="admin-grid">${emails}${feedback}</div>`;
  }

  function roundCard(r) {
    if (!r) return `<div class="card">${empty("calendar", t("admin.ov.noRound"), t("admin.ov.noRoundBody"), `<a class="btn btn--secondary btn--sm" href="#/admin/rounds/new">${icon("plus")}<span>${esc(t("admin.rounds.new"))}</span></a>`)}</div>`;
    const engines = Object.keys(r.engines || {}).filter((k) => Number(r.engines[k]) > 0)
      .map((k) => k + " " + num(r.engines[k])).join(" · ");
    return `<div class="card"><div class="stack">
      <div class="cluster cluster--between">
        <div class="stack stack--s">
          <div class="cluster">${YL.ui.tag(kindLabel(r.kind), r.kind === "event" ? "tag--theme" : "")}</div>
          <h3>${esc(roundName(r.title) || DASH)}</h3>
        </div>
        ${r.kind === "event" ? moreLink(`#/events/${enc(r.id)}`, t("admin.rounds.view")) : ""}
      </div>
      <div class="stats">
        ${stat(num(r.participants), t("admin.ov.participants"))}
        ${stat(num(r.invites), t("admin.ov.invites"), r.participants > 0 ? t("admin.ov.perPerson", { n: (r.invites / r.participants).toFixed(1) }) : "")}
        ${stat(num(r.matches), t("admin.ov.matches"), rate(r.matches, r.invites, (pct) => t("admin.ov.matchRate", { pct })))}
        ${stat(num(r.scheduled), t("admin.ov.scheduled"), rate(r.scheduled, r.matches, (pct) => t("admin.ov.ofMatches", { pct })))}
      </div>
      <div class="stats">
        ${stat(num(r.pending), t("admin.ov.pending"), rate(r.pending, r.invites, (pct) => t("admin.ov.ofInvites", { pct })))}
        ${stat(num(r.skipped), t("admin.ov.skipped"), rate(r.skipped, r.invites, (pct) => t("admin.ov.ofInvites", { pct })))}
        ${stat(num(r.fromRecs), t("admin.ov.fromRecs"), rate(r.fromRecs, r.invites, (pct) => t("admin.ov.ofInvites", { pct })))}
      </div>
      <p class="cluster small muted">${icon("sliders")}<span>${esc(engines ? t("admin.ov.engines", { list: engines }) : t("admin.ov.noEngines"))}</span></p>
    </div></div>`;
  }

  /* ---------- 轮次列表 ---------- */
  function flashHtml(f) {
    const title = roundName(f.title);
    if (f.status === "published") {
      return noticeHtml("notice--success", "check", `<p>${esc(t("admin.rounds.savedPublished", { title }))}</p><p><a href="#/events/${enc(f.id)}">${esc(t("admin.rounds.preview"))}</a></p>`, ' role="status"');
    }
    return noticeHtml("notice--success", "check", `<p>${esc(t("admin.rounds.savedDraft", { title }))}</p><p><a href="#/admin/rounds/${enc(f.id)}">${esc(t("admin.rounds.continue"))}</a></p>`, ' role="status"');
  }
  function roundRow(r) {
    const ph = phase(r), title = roundName(r.title), actions = [];
    if (r.kind === "event") {
      actions.push(`<a class="btn btn--secondary btn--sm" href="#/admin/rounds/${enc(r.id)}" aria-label="${esc(t("admin.rounds.edit") + " " + title)}">${icon("edit")}<span>${esc(t("admin.rounds.edit"))}</span></a>`);
      if (r.status === "published") actions.push(`<a class="btn btn--ghost btn--sm" href="#/events/${enc(r.id)}" aria-label="${esc(t("admin.rounds.view") + " " + title)}"><span>${esc(t("admin.rounds.view"))}</span>${icon("arrowRight")}</a>`);
    }
    const opts = tagOptions();
    const tags = (r.themeTags || []).length ? `<div class="tags">${YL.ui.tags(r.themeTags.map((x) => clip(tagLabel(x, opts), MAX.tagLen)), "tag--theme")}</div>` : "";
    return `<tr>
      <td><div class="cluster"><strong class="nowrap">${esc(title || DASH)}</strong>${tags}</div></td>
      <td>${YL.ui.tag(kindLabel(r.kind), r.kind === "event" ? "tag--theme" : "")}</td>
      <td class="nowrap">${esc(range(r))}${ph ? `<p class="xsmall faint">${esc(phaseLabel(ph))}</p>` : ""}</td>
      <td>${roundStatusPill(r.status)}</td>
      <td><div class="cluster">${actions.join("") || `<span class="xsmall faint nowrap">${esc(t("admin.rounds.auto"))}</span>`}</div></td>
    </tr>`;
  }
  const ROUNDS = {
    path: "/admin/rounds",
    head() {
      const f = flash; flash = null;
      return `${f ? flashHtml(f) : ""}
        ${YL.ui.sectionTitle(t("admin.rounds.title"), `<a class="btn btn--primary btn--sm" href="#/admin/rounds/new">${icon("plus")}<span>${esc(t("admin.rounds.new"))}</span></a>`, t("admin.rounds.sub"))}`;
    },
    filters(items) {
      const n = (k) => items.filter((r) => r.kind === k).length;
      return [
        { id: "all", label: t("admin.filter.all") + " · " + items.length },
        { id: "event", label: kindLabel("event") + " · " + n("event") },
        { id: "weekly", label: kindLabel("weekly") + " · " + n("weekly") }
      ];
    },
    match: (r, f) => f === "all" || r.kind === f,
    rows: (list) => table(t("admin.rounds.title"), [esc(t("admin.col.title")), esc(t("admin.col.kind")), esc(t("admin.col.dates")), esc(t("admin.col.status")), esc(t("admin.col.actions"))], list.map(roundRow)),
    empty: () => empty("calendar", t("admin.rounds.empty"), t("admin.rounds.emptyBody"))
  };

  /* ---------- 意见箱 ---------- */
  const FEEDBACK = {
    path: "/admin/feedback",
    head: () => YL.ui.sectionTitle(t("admin.fb.title"), "", t("admin.fb.sub")),
    filters(items) {
      return [{ id: "all", label: t("admin.filter.all") + " · " + items.length }]
        .concat(FB_KINDS.map((k) => ({ id: k, label: fbKindLabel(k) + " · " + items.filter((x) => x.kind === k).length })));
    },
    match: (x, f) => f === "all" || x.kind === f,
    rows: (list) => `<div class="admin-grid">${list.map((x) => `<article class="card card--tight"><div class="stack stack--s">
        <div class="cluster cluster--between">
          <div class="cluster">${pill(fbKindLabel(x.kind), FB_PILL[x.kind] || "")}<span class="small muted">${esc(x.name || t("admin.fb.anon"))}</span></div>
          <time class="xsmall faint" datetime="${esc(x.created_at || "")}">${esc(when(x.created_at))}</time>
        </div>
        <p class="prose">${esc(x.text)}</p>
      </div></article>`).join("")}</div>`,
    empty: () => empty("message", t("admin.fb.empty"))
  };

  /* ---------- 发信记录 ---------- */
  const EMAILS = {
    path: "/admin/emails",
    head: () => `${YL.ui.sectionTitle(t("admin.mail.title"), "", t("admin.mail.sub"))}
      ${noticeHtml("", "info", `<p>${esc(t("admin.mail.skippedHint"))}</p>`)}`,
    filters(items) {
      return [{ id: "all", label: t("admin.filter.all") + " · " + items.length }]
        .concat(["failed", "skipped", "sent"].map((s) => ({ id: s, label: mailStatusLabel(s) + " · " + items.filter((x) => x.status === s).length })));
    },
    match: (x, f) => f === "all" || x.status === f,
    rows: (list) => table(t("admin.mail.title"), [esc(t("admin.col.time")), esc(t("admin.col.kind")), esc(t("admin.col.status")), esc(t("admin.col.error"))],
      list.map((x) => `<tr>
        <td class="nowrap">${esc(when(x.created_at))}</td>
        <td class="nowrap">${esc(mailKindLabel(x.kind))}</td>
        <td>${pill(mailStatusLabel(x.status), MAIL_PILL[x.status] || "")}</td>
        <td>${x.error ? esc(maskEmails(x.error)) : `<span class="faint">${DASH}</span>`}</td>
      </tr>`)),
    empty: () => empty("mail", t("admin.mail.empty"))
  };

  /* ---------- 审计日志 ---------- */
  const AUDIT = {
    path: "/admin/audit",
    head: () => `${YL.ui.sectionTitle(t("admin.audit.title"), "", t("admin.audit.sub"))}
      ${noticeHtml("", "info", `<p>${esc(t("admin.audit.note"))}</p>`)}`,
    filters(items) {
      return [
        { id: "all", label: t("admin.filter.all") + " · " + items.length },
        { id: "failed", label: t("admin.audit.fail") + " · " + items.filter((x) => !x.ok).length }
      ];
    },
    match: (x, f) => f === "all" || !x.ok,
    rows(list) {
      const me = (YL.auth.user() || {}).id;
      return table(t("admin.audit.title"), [esc(t("admin.col.time")), esc(t("admin.col.actor")), esc(t("admin.col.op")), esc(t("admin.col.target")), esc(t("admin.col.result")), esc(t("admin.col.code"))],
        list.map((x) => `<tr>
          <td class="nowrap">${esc(when(x.at))}</td>
          <td class="nowrap">${x.actor && x.actor === me ? `<strong>${esc(t("admin.audit.me"))}</strong>` : x.actor ? `<code>${esc(x.actor)}</code>` : `<span class="faint">${DASH}</span>`}</td>
          <td class="nowrap"><code>${esc(x.op)}</code></td>
          <td class="nowrap">${x.target ? `<code>${esc(x.target)}</code>` : `<span class="faint">${DASH}</span>`}</td>
          <td>${x.ok ? pill(t("admin.audit.ok"), "pill--success", "check") : pill(t("admin.audit.fail"), "pill--warn", "x")}</td>
          <td class="nowrap">${x.code ? `<code>${esc(x.code)}</code>` : `<span class="faint">${DASH}</span>`}</td>
        </tr>`));
    },
    empty: () => empty("shield", t("admin.audit.empty"))
  };

  /* ---------- 成员：嘉宾邮箱、导师（RFC 0003 §5）----------
     嘉宾邮箱：登记一个非耶鲁邮箱（可带备注），这个邮箱就能收验证码登录；删除登记后不能再登录新会话（已有账号和数据保留）。
     导师：按登录邮箱标记或取消，资料卡上显示"导师"，找人可以只看导师；没有其他特权。 */
  const GUEST_NOTE_MAX = 60;
  function membersHtml(d) {
    const guests = Array.isArray(d.guests) ? d.guests : [];
    const mentors = Array.isArray(d.mentors) ? d.mentors : [];
    // 列表而不是表格：邮箱很长，手机上表格会被压成一个字一行，删除按钮也要横向滚动才看得到
    const guestRows = guests.map((g) => `<li class="list__item">
        <div class="list__main">
          <span class="list__title break-all">${esc(g.email)}</span>
          <span class="list__sub">${esc([g.note, t("admin.members.addedAt", { when: when(g.createdAt) })].filter(Boolean).join(" · "))}</span>
          <span class="cluster">${g.registered ? pill(t("admin.members.registered"), "pill--success", "check") + (g.name ? `<span class="small muted">${esc(g.name)}</span>` : "") : pill(t("admin.members.notRegistered"))}</span>
        </div>
        <button type="button" class="btn btn--danger-ghost btn--sm" data-act="guest-del" data-email="${esc(g.email)}" aria-label="${esc(t("admin.members.removeGuestLabel", { email: g.email }))}">${icon("trash")}<span>${esc(t("admin.members.remove"))}</span></button>
      </li>`);
    const mentorRows = mentors.map((x) => `<li class="list__item">
        <div class="list__main">
          <span class="cluster"><span class="list__title">${esc(x.name || DASH)}</span>${pill(t("admin.members.mentor"), "pill--mentor", "cap")}</span>
          <span class="list__sub break-all">${esc(x.loginEmail || "")}</span>
        </div>
        <button type="button" class="btn btn--secondary btn--sm" data-act="mentor-off" data-email="${esc(x.loginEmail || "")}" aria-label="${esc(t("admin.members.unmarkLabel", { name: x.name || x.loginEmail || "" }))}"><span>${esc(t("admin.members.unmark"))}</span></button>
      </li>`);
    const emailInput = (id, label, ph) => `<div class="field" data-field="email">
        <label class="field__label" for="${id}">${esc(label)}<span class="req" aria-hidden="true">*</span></label>
        <input class="input" type="email" id="${id}" name="email" maxlength="120" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(ph)}">
      </div>`;
    const formError = `<div class="notice notice--danger" role="alert" data-form-error hidden>${icon("alertCircle")}<div class="notice__body"><p data-form-error-text></p></div></div>`;
    return `<section class="stack" aria-labelledby="am-guests">
        <div class="section-head"><div><h2 class="section-title" id="am-guests" tabindex="-1">${esc(t("admin.members.guestsTitle"))}</h2><p class="section-sub">${esc(t("admin.members.guestsSub"))}</p></div></div>
        <form class="card" data-members-form="guest" novalidate><div class="stack">
          <div class="grid-cards">
            ${emailInput("am-guest-email", t("admin.members.guestEmail"), "name@example.com")}
            <div class="field" data-field="note">
              <label class="field__label" for="am-guest-note">${esc(t("admin.members.note"))} <span class="faint">${esc(t("common.optional"))}</span></label>
              <input class="input" id="am-guest-note" name="note" maxlength="${GUEST_NOTE_MAX}" autocomplete="off" placeholder="${esc(t("admin.members.notePh"))}">
            </div>
          </div>
          ${formError}
          <div class="cluster cluster--end"><button type="submit" class="btn btn--primary btn--sm">${icon("plus")}<span>${esc(t("admin.members.addGuest"))}</span></button></div>
        </div></form>
        ${guests.length
          ? `<div class="card"><ul class="list" aria-label="${esc(t("admin.members.guestsTitle"))}">${guestRows.join("")}</ul></div>`
          : `<div class="card card--quiet">${empty("mail", t("admin.members.noGuests"), t("admin.members.noGuestsBody"))}</div>`}
      </section>
      <section class="stack" aria-labelledby="am-mentors">
        <div class="section-head"><div><h2 class="section-title" id="am-mentors" tabindex="-1">${esc(t("admin.members.mentorsTitle"))}</h2><p class="section-sub">${esc(t("admin.members.mentorsSub"))}</p></div></div>
        <form class="card" data-members-form="mentor" novalidate><div class="stack">
          ${emailInput("am-mentor-email", t("admin.members.mentorEmail"), "name@yale.edu")}
          ${formError}
          <div class="cluster cluster--end"><button type="submit" class="btn btn--primary btn--sm">${icon("cap")}<span>${esc(t("admin.members.markMentor"))}</span></button></div>
        </div></form>
        ${mentors.length
          ? `<div class="card"><ul class="list" aria-label="${esc(t("admin.members.mentorsTitle"))}">${mentorRows.join("")}</ul></div>`
          : `<div class="card card--quiet">${empty("user", t("admin.members.noMentors"), t("admin.members.noMentorsBody"))}</div>`}
      </section>`;
  }
  function renderMembers(root, ctx) {
    const m = mount(root, "members", { refresh: true, note: t("admin.members.privacy") });
    const refreshBtn = () => m.page.querySelector('[data-act="refresh"]');
    let seq = 0, loaded = false;
    // 重新加载列表时，表单里还没提交的内容留着（keep = false：刚提交成功，清空）
    function formValues() {
      const v = {};
      m.page.querySelectorAll("[data-members-form] input").forEach((i) => { v[i.id] = i.value; });
      return v;
    }
    async function load(opts) {
      const o = opts || {};
      const mine = ++seq;
      const keep = o.keep === false ? {} : formValues();
      const hadFocus = document.activeElement === refreshBtn();
      if (!loaded) m.paint(YL.ui.spinner());
      m.busy(true);
      YL.ui.busy(refreshBtn(), true);
      const r = await YL.api.get("/admin/members");
      if (!ctx.isActive() || mine !== seq) return;
      loaded = !!r.ok;
      m.paint(r.ok ? membersHtml(r.data || {}) : errorBox(r.error));
      Object.keys(keep).forEach((id) => { const i = m.page.querySelector("#" + CSS.escape(id)); if (i) i.value = keep[id]; });
      if (hadFocus) refreshBtn().focus();
      else if (o.focus === "page") m.page.focus();
      else if (o.focus) { const f = m.page.querySelector(o.focus); if (f) f.focus(); }
    }
    function showFormError(form, text) {
      const box = form.querySelector("[data-form-error]");
      box.querySelector("[data-form-error-text]").textContent = text;
      box.hidden = false;
    }
    m.page.addEventListener("submit", async (e) => {
      const form = e.target.closest("[data-members-form]");
      if (!form) return;
      e.preventDefault();
      const kind = form.dataset.membersForm;
      const btn = form.querySelector('button[type="submit"]');
      if (btn.disabled) return;
      YL.ui.clearFieldErrors(form);
      form.querySelector("[data-form-error]").hidden = true;
      const email = form.elements.email.value.trim();
      if (!email) { YL.ui.showFieldErrors(form, { email: "required" }, "admin"); return; }
      YL.ui.busy(btn, true);
      const r = kind === "guest"
        ? await YL.api.post("/admin/guests", { email, note: form.elements.note.value.trim() })
        : await YL.api.post("/admin/mentors", { email, mentor: true });
      if (!ctx.isActive()) return;
      YL.ui.busy(btn, false);
      if (!r.ok) {
        const er = r.error || {};
        if (er.fields && Object.keys(er.fields).length) YL.ui.showFieldErrors(form, er.fields, "admin");
        else if (er.code === "not_found") YL.ui.showFieldErrors(form, { email: "not_found" }, "admin");
        else showFormError(form, YL.ui.errorText(er, "admin"));
        return;
      }
      YL.ui.toast(kind === "guest" ? t("admin.members.guestAdded", { email }) : t("admin.members.mentorMarked", { email }), "success");
      load({ keep: false, focus: kind === "guest" ? "#am-guest-email" : "#am-mentor-email" });
    });
    m.page.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === "refresh") { load(); return; }
      if (act === "retry") { load({ focus: "page" }); return; }
      if (act !== "guest-del" && act !== "mentor-off") return;
      const email = b.dataset.email;
      if (act === "guest-del") {
        const ok = await YL.ui.confirm(t("admin.members.removeGuestConfirm", { email }), { danger: true, ok: t("admin.members.remove") });
        if (!ctx.isActive()) return;
        if (!ok) { if (b.isConnected) b.focus(); return; }
      }
      YL.ui.busy(b, true);
      const r = act === "guest-del"
        ? await YL.api.post("/admin/guests/delete", { email })
        : await YL.api.post("/admin/mentors", { email, mentor: false });
      if (!ctx.isActive()) return;
      if (!r.ok) {
        if (b.isConnected) { YL.ui.busy(b, false); b.focus(); }
        YL.ui.toast(YL.ui.errorText(r.error, "admin"), "error");
        return;
      }
      YL.ui.toast(act === "guest-del" ? t("admin.members.guestRemoved", { email }) : t("admin.members.mentorUnmarked", { email }));
      load({ focus: act === "guest-del" ? "#am-guests" : "#am-mentors" });
    });
    return load();
  }

  const VIEWS = {
    overview: { path: "/admin/overview", overview: true },
    rounds: ROUNDS,
    feedback: FEEDBACK,
    emails: EMAILS,
    audit: AUDIT
  };

  /* ---------- 列表页：读接口 → 筛选标签 → 列表 ---------- */
  function renderView(root, ctx, id, view) {
    const m = mount(root, id, { refresh: true });
    const state = { filter: "all", items: [], ok: false };
    const refreshBtn = () => m.page.querySelector('[data-act="refresh"]');
    let seq = 0;

    function listPart() {
      const shown = state.items.filter((x) => view.match(x, state.filter));
      return { n: shown.length, html: asList(shown.length ? view.rows(shown) : empty("filter", t("admin.filter.none"))) };
    }
    function bodyHtml(data) {
      if (view.overview) return overviewHtml(data || {});
      state.items = Array.isArray(data) ? data : [];
      if (!state.items.length) return view.head(state.items) + view.empty();
      const l = listPart();
      return view.head(state.items)
        + YL.ui.chips(view.filters(state.items), state.filter, "filter", "chips--scroll")
        + `<p class="sr-only" data-shown aria-live="polite">${esc(t("admin.shown", { n: l.n }))}</p>`
        + l.html;
    }
    async function load(focusAfter) {
      const mine = ++seq;
      const hadFocus = document.activeElement === refreshBtn();
      if (!state.ok) m.paint(YL.ui.spinner());
      m.busy(true);
      YL.ui.busy(refreshBtn(), true);
      const r = await YL.api.get(view.path);
      if (!ctx.isActive() || mine !== seq) return;
      state.ok = !!r.ok;
      m.paint(r.ok ? bodyHtml(r.data) : errorBox(r.error));
      if (hadFocus) refreshBtn().focus();
      else if (focusAfter) m.page.focus();
    }

    m.page.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act && act.dataset.act === "refresh") { load(false); return; }
      if (act && act.dataset.act === "retry") { load(true); return; }
      const chip = e.target.closest("[data-filter]");
      if (!chip || view.overview) return;
      state.filter = chip.dataset.filter;
      m.page.querySelectorAll("[data-filter]").forEach((c) => {
        const on = c === chip;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", String(on));
      });
      const l = listPart(), old = m.page.querySelector("[data-list]"), shown = m.page.querySelector("[data-shown]");
      if (old) old.outerHTML = l.html;
      if (shown) shown.textContent = t("admin.shown", { n: l.n });
    });
    return load(false);
  }

  /* ---------- 新建 / 编辑活动轮 ---------- */
  const parseTags = (s) => String(s || "").split(/[,，、;；\n]/).map((x) => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
  // 主题标签可以写问卷选项的 id（如 hiking），约咖啡和活动页会按语言显示成"徒步 / Hiking"；其他文字原样显示
  function tagOptions() {
    return ["goals", "interests"].map((id) => YL.auth.questions().find((q) => q.id === id)).filter(Boolean)
      .reduce((all, q) => all.concat((q.options || []).map((o) => ({ id: o.id, label: o.label }))), []);
  }
  const tagLabel = (id, opts) => { const o = (opts || tagOptions()).find((x) => x.id === id); return o ? L(o.label) : String(id); };

  function textField(o) {
    const hintId = o.id + "-hint", countId = o.id + "-count";
    const describedBy = (o.hint ? hintId + " " : "") + countId + (o.describedBy ? " " + o.describedBy : "");
    const common = `class="${o.area ? "textarea" : "input"}" id="${o.id}" name="${o.name}" maxlength="${o.max}" aria-describedby="${describedBy}"${o.required ? " required" : ""}${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ""}`;
    const control = o.area ? `<textarea ${common} rows="${o.rows || 6}">${esc(o.value)}</textarea>` : `<input ${common} value="${esc(o.value)}" autocomplete="off">`;
    return `<div class="field" data-field="${o.field}">
      <label class="field__label" for="${o.id}">${esc(o.label)}${o.required ? '<span class="req" aria-hidden="true">*</span>' : ""}</label>
      ${o.hint ? `<p class="field__hint" id="${hintId}">${esc(o.hint)}</p>` : ""}
      ${control}
      <p class="field__count" id="${countId}" data-count="${o.name}">${String(o.value || "").length}/${o.max}</p>
    </div>`;
  }

  function formHtml(r) {
    const editing = !!r, published = editing && r.status === "published";
    const title = (r && r.title) || {}, post = (r && r.post) || {};
    const start = (r && r.startDate) || "", end = (r && r.endDate) || "";
    const tags = (r && r.themeTags) || [];
    const quick = tagOptions();
    const rec = r && Number(r.recCount) ? r.recCount : MAX.recDefault;
    const browse = r ? r.openBrowse !== false : true;
    const ph = r ? phase(r) : "";
    const status = editing ? `<div class="cluster">${roundStatusPill(r.status)}${ph ? `<span class="xsmall faint">${esc(phaseLabel(ph))}</span>` : ""}</div>` : "";
    // 文章标题没填时，后端第一次保存会把中文名称写进去；编辑时把这种"默认值"显示成空，名称改了标题才会跟着变
    const headline = post.title && post.title !== title.zh ? post.title : "";

    return `<div class="stack stack--s">
        <div><a class="btn btn--ghost btn--sm" href="#/admin/rounds">${icon("chevronLeft")}<span>${esc(t("admin.form.back"))}</span></a></div>
        ${YL.ui.sectionTitle(editing ? t("admin.form.editTitle") : t("admin.form.newTitle"), status)}
      </div>
      <div class="split">
        <form class="form" novalidate data-form>
          <div class="notice notice--info" role="status" data-restored hidden>${icon("info")}<div class="notice__body"><p>${esc(t("admin.form.restored"))}</p><p><button type="button" class="btn btn--ghost btn--sm" data-act="discard">${icon("refresh")}<span>${esc(t("admin.form.discard"))}</span></button></p></div></div>
          <div class="card"><div class="stack">
            <h3>${esc(t("admin.form.basics"))}</h3>
            <div class="stack stack--s">
              <div class="grid-cards">
                ${textField({ field: "title", id: "ar-title-zh", name: "titleZh", label: t("admin.form.titleZh"), max: MAX.titleZh, value: title.zh || "", required: true, placeholder: t("admin.form.titleZhPh") })}
                ${textField({ field: "titleEn", id: "ar-title-en", name: "titleEn", label: t("admin.form.titleEn"), max: MAX.titleEn, value: title.en || "", placeholder: t("admin.form.titleEnPh"), describedBy: "ar-title-en-why" })}
              </div>
              <p class="field__hint" id="ar-title-en-why">${esc(t("admin.form.titleEnHint"))}</p>
            </div>
            <div class="stack stack--s">
              <div class="grid-cards">
                <div class="field" data-field="startDate">
                  <label class="field__label" for="ar-start">${esc(t("admin.form.start"))}<span class="req" aria-hidden="true">*</span></label>
                  <input class="input" type="date" id="ar-start" name="startDate" value="${esc(start)}" required aria-describedby="ar-days">
                </div>
                <div class="field" data-field="endDate">
                  <label class="field__label" for="ar-end">${esc(t("admin.form.end"))}<span class="req" aria-hidden="true">*</span></label>
                  <input class="input" type="date" id="ar-end" name="endDate" value="${esc(end)}"${start ? ` min="${esc(start)}"` : ""} required aria-describedby="ar-days">
                </div>
              </div>
              <p class="field__hint" id="ar-days" data-days aria-live="polite"></p>
            </div>
          </div></div>

          <div class="card"><div class="stack">
            <h3>${esc(t("admin.form.matching"))}</h3>
            <div class="field" data-field="themeTags">
              <label class="field__label" for="ar-tags">${esc(t("admin.form.tags"))}</label>
              <p class="field__hint" id="ar-tags-hint">${esc(t("admin.form.tagsHint"))}</p>
              <input class="input" id="ar-tags" name="themeTags" value="${esc(tags.join(", "))}" placeholder="${esc(t("admin.form.tagsPh"))}" autocomplete="off" aria-describedby="ar-tags-hint ar-tags-count">
              <div class="cluster cluster--between">
                <div class="tags" data-tag-preview></div>
                <p class="field__count" id="ar-tags-count" data-tag-count></p>
              </div>
              ${quick.length ? `<div class="stack stack--s">
                <div><button type="button" class="btn btn--ghost btn--sm" data-act="quick" aria-expanded="false" aria-controls="ar-tags-quick">${icon("plus")}<span>${esc(t("admin.form.tagsQuick"))}</span></button></div>
                <div class="chips" role="group" id="ar-tags-quick" aria-label="${esc(t("admin.form.tagsQuick"))}" hidden>${quick.map((o) => `<button type="button" class="chip" data-add-tag="${esc(o.id)}" aria-pressed="${tags.indexOf(o.id) >= 0}">${esc(L(o.label))}</button>`).join("")}</div>
              </div>` : ""}
            </div>
            <div class="field" data-field="recCount">
              <label class="field__label" for="ar-rec">${esc(t("admin.form.recCount"))}</label>
              <p class="field__hint" id="ar-rec-hint">${esc(t("admin.form.recHint"))}</p>
              <input class="input" type="number" id="ar-rec" name="recCount" min="${MAX.recMin}" max="${MAX.recMax}" step="1" inputmode="numeric" value="${esc(rec)}" aria-describedby="ar-rec-hint">
            </div>
            <label class="switch">
              <span class="switch__text"><span>${esc(t("admin.form.browse"))}</span><small>${esc(t("admin.form.browseHint"))}</small></span>
              <input type="checkbox" role="switch" name="openBrowse"${browse ? " checked" : ""}>
              <span class="switch__track"></span>
            </label>
          </div></div>

          <div class="card"><div class="stack">
            <h3>${esc(t("admin.form.post"))}</h3>
            ${textField({ field: "postTitle", id: "ar-post-title", name: "postTitle", label: t("admin.form.postTitle"), hint: t("admin.form.postTitleHint"), max: MAX.postTitle, value: headline })}
            ${textField({ field: "postBody", id: "ar-body", name: "body", label: t("admin.form.body"), hint: t("admin.form.bodyHint"), max: MAX.body, value: post.body || "", area: true, rows: 12 })}
            ${textField({ field: "postWechat", id: "ar-wechat", name: "wechat", label: t("admin.form.wechat"), hint: t("admin.form.wechatHint"), max: MAX.wechat, value: post.wechat || "", area: true, rows: 8 })}
          </div></div>

          <div class="notice notice--danger" role="alert" tabindex="-1" data-form-error hidden>${icon("alertCircle")}<div class="notice__body"><p data-form-error-text></p></div></div>
          <div class="cluster cluster--end">
            <button type="button" class="btn btn--secondary" data-status="draft">${esc(published ? t("admin.form.unpublish") : t("admin.form.saveDraft"))}</button>
            <button type="button" class="btn btn--primary" data-status="published">${esc(published ? t("admin.form.saveChanges") : t("admin.form.publish"))}</button>
          </div>
        </form>

        <aside class="stack">
          <div class="card card--quiet"><div class="stack stack--s">
            <h3>${esc(t("admin.form.tipsTitle"))}</h3>
            <ul class="list">
              <li class="list__item"><p class="small muted">${esc(t("admin.form.tip1"))}</p></li>
              <li class="list__item"><p class="small muted">${esc(t("admin.form.tip2"))}</p></li>
              <li class="list__item"><p class="small muted">${esc(t("admin.form.tip3"))}</p></li>
              <li class="list__item"><p class="small muted">${esc(t("admin.form.tip4"))}</p></li>
            </ul>
          </div></div>
          ${published ? `<a class="btn btn--secondary btn--block" href="#/events/${enc(r.id)}">${esc(t("admin.form.previewLink"))}${icon("arrowRight")}</a>` : ""}
        </aside>
      </div>`;
  }

  function bindForm(page, ctx, round) {
    const form = page.querySelector("[data-form]");
    const el = form.elements;
    const wasPublished = !!round && round.status === "published";
    const running = wasPublished && phase(round) === "open";
    const errBox = form.querySelector("[data-form-error]");
    const restoredBox = form.querySelector("[data-restored]");
    const key = round ? round.id : "new";
    const FIELDS = ["titleZh", "titleEn", "startDate", "endDate", "themeTags", "recCount", "postTitle", "body", "wechat"];
    let saving = false;

    function updateCount(input) {
      const c = form.querySelector(`[data-count="${input.name}"]`);
      if (c) c.textContent = input.value.length + "/" + input.maxLength;
    }
    function updateDays() {
      const s = el.startDate.value, e = el.endDate.value;
      el.endDate.min = s || "";
      const box = form.querySelector("[data-days]");
      if (isDate(s) && isDate(e) && e >= s) {
        const n = dayCount(s, e);
        box.textContent = n > MAX.days ? t("admin.form.daysTooLong", { n }) : t("admin.form.days", { n });
      } else box.textContent = t("admin.form.daysHint");
    }
    const opts = tagOptions();
    function updateTags() {
      const list = parseTags(el.themeTags.value);
      form.querySelector("[data-tag-preview]").innerHTML = YL.ui.tags(list.slice(0, MAX.tags).map((x) => clip(tagLabel(x, opts), MAX.tagLen + 1)), "tag--theme");
      form.querySelector("[data-tag-count]").textContent = list.length + "/" + MAX.tags;
      form.querySelectorAll("[data-add-tag]").forEach((c) => c.setAttribute("aria-pressed", String(list.indexOf(c.dataset.addTag) >= 0)));
    }
    function updateAll() {
      FIELDS.forEach((n) => { if (el[n].maxLength > 0) updateCount(el[n]); });
      updateDays();
      updateTags();
    }

    // 没保存的内容：和刚打开时不一样就暂存，改回原样就清掉
    const snapshot = () => FIELDS.reduce((o, n) => { o[n] = String(el[n].value || ""); return o; }, { openBrowse: !!el.openBrowse.checked });
    function apply(values) {
      FIELDS.forEach((n) => { if (values[n] != null) el[n].value = values[n]; });
      el.openBrowse.checked = !!values.openBrowse;
      updateAll();
    }
    const initial = snapshot(), initialJson = JSON.stringify(initial);
    function track() {
      if (saving) return;
      const now = snapshot();
      if (JSON.stringify(now) === initialJson) delete drafts[key]; else drafts[key] = now;
    }
    if (drafts[key]) { apply(drafts[key]); restoredBox.hidden = false; }
    openForm = { key, form };

    // 点选问卷里的标签：再点一次取消
    function toggleTag(id) {
      const list = parseTags(el.themeTags.value), i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else if (list.length >= MAX.tags) { YL.ui.showFieldErrors(form, { themeTags: "too_many" }, "admin"); return; }
      else list.push(id);
      YL.ui.clearFieldErrors(form);
      el.themeTags.value = list.join(", ");
      updateTags();
      track();
    }
    function showError(text) {
      form.querySelector("[data-form-error-text]").textContent = text;
      errBox.hidden = false;
      errBox.focus();
    }
    function read() {
      const v = (n) => String(el[n].value || "");
      return {
        title: { zh: v("titleZh").trim(), en: v("titleEn").trim() },
        startDate: v("startDate"), endDate: v("endDate"),
        themeTags: parseTags(v("themeTags")),
        recCount: v("recCount").trim(),
        openBrowse: !!el.openBrowse.checked,
        post: { title: v("postTitle").trim(), body: v("body").trim(), wechat: v("wechat").trim() }
      };
    }
    // 提交前先用共用规则查一遍（最终以接口为准）
    function check(v) {
      const f = Object.assign({}, D.validateRound(v).fields);
      if (v.themeTags.length > MAX.tags) f.themeTags = "too_many";
      else if (v.themeTags.some((x) => Array.from(x).length > MAX.tagLen)) f.themeTags = "too_long";
      const n = Number(v.recCount);
      if (!/^\d+$/.test(v.recCount) || n < MAX.recMin || n > MAX.recMax) f.recCount = "invalid";
      return f;
    }
    // 发布 / 撤回 / 改动进行中的活动轮之前要确认的话；不需要确认返回 null
    function confirmFor(status, v) {
      if (status === "draft" && wasPublished) {
        return { text: running ? t("admin.form.confirmUnpublishRunning") : t("admin.form.confirmUnpublish"), ok: t("admin.form.unpublish"), danger: true };
      }
      if (status === "published" && !wasPublished) {
        return { text: t("admin.form.confirmPublish") + (v.title.en ? "" : " " + t("admin.form.confirmNoEn")), ok: t("admin.form.publish") };
      }
      // 正在进行的活动轮，新日期不再包含今天：约咖啡会马上切回每周轮
      if (status === "published" && running && phase(v) !== "open") {
        return { text: t("admin.form.confirmEndRunning"), ok: t("admin.form.saveChanges"), danger: true };
      }
      return null;
    }

    async function save(btn) {
      if (saving) return;
      const status = btn.dataset.status === "published" ? "published" : "draft";
      const v = read();
      YL.ui.clearFieldErrors(form);
      errBox.hidden = true;
      const fields = check(v);
      if (Object.keys(fields).length) { YL.ui.showFieldErrors(form, fields, "admin"); return; }

      const ask = confirmFor(status, v);
      if (ask) {
        const ok = await YL.ui.confirm(ask.text, { ok: ask.ok, danger: ask.danger });
        if (!ctx.isActive()) return;
        if (!ok) { btn.focus(); return; }
      }

      const buttons = Array.from(form.querySelectorAll("[data-status]"));
      buttons.forEach((b) => (b.disabled = true));
      YL.ui.busy(btn, true);
      saving = true;
      const r = await YL.api.post("/admin/rounds", {
        id: round ? round.id : undefined,
        title: v.title, startDate: v.startDate, endDate: v.endDate,
        themeTags: v.themeTags, recCount: Number(v.recCount), openBrowse: v.openBrowse,
        status, post: v.post
      });
      saving = false;
      // 已经存好了：不管页面还在不在，都别再把这份内容当成"没保存的修改"
      if (r.ok) delete drafts[key];
      if (!ctx.isActive()) return;
      YL.ui.busy(btn, false);
      buttons.forEach((b) => (b.disabled = false));
      if (!r.ok) {
        if (r.error && r.error.fields && Object.keys(r.error.fields).length) YL.ui.showFieldErrors(form, r.error.fields, "admin");
        else showError(YL.ui.errorText(r.error, "admin"));
        return;
      }
      const saved = r.data || {};
      openForm = null;
      flash = { id: saved.id, title: saved.title || v.title, status: saved.status || status };
      YL.ui.toast(flash.status === "published" ? t("admin.form.publishedToast") : t("admin.form.draftToast"), "success");
      YL.router.navigate("admin/rounds");
    }

    form.addEventListener("input", (e) => {
      const x = e.target;
      if (x.name === "themeTags") updateTags();
      else if (x.name === "startDate" || x.name === "endDate") updateDays();
      else if (x.maxLength > 0 && form.querySelector(`[data-count="${x.name}"]`)) updateCount(x);
      track();
    });
    form.addEventListener("change", (e) => {
      if (e.target.name === "startDate" || e.target.name === "endDate") updateDays();
      track();
    });
    form.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add-tag]");
      if (add) { toggleTag(add.dataset.addTag); return; }
      const quick = e.target.closest('[data-act="quick"]');
      if (quick) {
        const open = quick.getAttribute("aria-expanded") !== "true";
        quick.setAttribute("aria-expanded", String(open));
        form.querySelector("#ar-tags-quick").hidden = !open;
        return;
      }
      if (e.target.closest('[data-act="discard"]')) {
        delete drafts[key];
        apply(initial);
        YL.ui.clearFieldErrors(form);
        errBox.hidden = true;
        restoredBox.hidden = true;
        el.titleZh.focus();
        YL.ui.toast(t("admin.form.discarded"));
        return;
      }
      const b = e.target.closest("[data-status]");
      if (b) save(b);
    });
    // 两个按钮都不是 submit：在输入框里按回车不会发布、撤回或存草稿
    form.addEventListener("submit", (e) => e.preventDefault());

    updateAll();
  }

  function renderForm(root, ctx, id) {
    const m = mount(root, "rounds");
    const back = `<a class="btn btn--secondary" href="#/admin/rounds">${icon("chevronLeft")}<span>${esc(t("admin.form.back"))}</span></a>`;

    async function load(focusAfter) {
      let round = null;
      if (id) {
        m.paint(YL.ui.spinner());
        m.busy(true);
        const r = await YL.api.get("/admin/rounds");
        if (!ctx.isActive()) return;
        if (!r.ok) { m.paint(errorBox(r.error)); if (focusAfter) m.page.focus(); return; }
        round = (Array.isArray(r.data) ? r.data : []).find((x) => x.id === id) || null;
        if (!round) { m.paint(empty("calendar", t("admin.form.notFound"), "", back)); return; }
        if (round.kind !== "event") { m.paint(empty("lock", t("admin.form.weekly"), "", back)); return; }
      }
      m.paint(formHtml(round));
      bindForm(m.page, ctx, round);
      if (focusAfter) m.page.focus();
    }
    m.page.addEventListener("click", (e) => { if (e.target.closest('[data-act="retry"]')) load(true); });
    return load(false);
  }

  /* ---------- 门禁 ----------
     后端只给"这次用耶鲁邮箱登录"的管理员会话开后台（server/app.js isAdmin）。老用户的验证码默认发到联系邮箱，
     这时 isAdmin = false、adminNeedsYale = true：说明原因，并提供"退出后用耶鲁邮箱重新登录"（回来还是这一页）。
     所以这里不用路由的 adminOnly（它只会显示"没有权限"），自己判断；接口那边照样拒绝非管理员。 */
  const needsYale = () => { const u = YL.auth.user(); return !!u && !!u.adminNeedsYale && !YL.auth.isAdmin(); };
  function renderGate(root, ctx) {
    if (!needsYale()) {
      root.innerHTML = empty("lock", t("router.forbidden"), "", `<a class="btn btn--primary" href="#/home">${esc(t("router.goHome"))}</a>`);
      return;
    }
    root.innerHTML = `<section class="page page--narrow" data-admin-gate>
        <header class="page-head">
          <div class="page-head__text">
            <p class="eyebrow">${esc(t("admin.eyebrow"))}</p>
            <h1 class="page-title">${esc(t("admin.title"))}</h1>
          </div>
        </header>
        <div class="card"><div class="stack">
          ${noticeHtml("notice--warn", "", `<p><strong>${esc(t("admin.needsYale.title"))}</strong></p><p>${esc(t("admin.needsYale.body"))}</p>`)}
          <button type="button" class="btn btn--primary btn--block" data-act="relogin">${icon("cap")}<span>${esc(t("admin.needsYale.cta"))}</span></button>
          <p class="xsmall faint">${esc(t("admin.needsYale.note"))}</p>
        </div></div>
      </section>`;
    const page = root.firstElementChild;
    page.addEventListener("click", async (e) => {
      const btn = e.target.closest('[data-act="relogin"]');
      if (!btn) return;
      const prev = YL.auth.user();
      YL.ui.busy(btn, true);
      const r = await YL.auth.logout();
      // 退出没成功（断网等）时后端会话还在：恢复本地状态并提示；401 说明本来就退出了
      if (!r.ok && !(r.error && r.error.code === "unauthorized")) {
        YL.auth.set(prev);
        if (ctx.isActive()) { YL.ui.busy(btn, false); btn.focus(); }
        YL.ui.toast(t("admin.needsYale.failed"), "error");
        return;
      }
      if (!ctx.isActive()) return;
      YL.router.navigate("login?next=" + encodeURIComponent(ctx.path || "admin") + "&via=yale");
    });
  }

  registerModule({
    id: "admin",
    requiresAuth: true,
    requiresReady: true,
    // 管理员，或者在管理员名单里、但这次是用联系邮箱登录的（点进来会看到"用耶鲁邮箱重新登录"）
    nav: [{ path: "admin", icon: "chart", labelKey: "nav.admin", order: 90, mobile: false, when: () => YL.auth.isAdmin() || needsYale() }],
    render(root, ctx) {
      if (!YL.auth.isAdmin()) return renderGate(root, ctx);
      const sub = ctx.sub || "overview";
      if (sub === "rounds" && ctx.id) return renderForm(root, ctx, ctx.id === "new" ? null : ctx.id);
      if (sub === "members") return renderMembers(root, ctx);
      const view = VIEWS[sub];
      if (!view) {
        mount(root, null).paint(empty("info", t("admin.notFound"), "", `<a class="btn btn--primary" href="#/admin">${esc(t("admin.backToOverview"))}</a>`));
        return;
      }
      return renderView(root, ctx, sub, view);
    }
  });
})();
