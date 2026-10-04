/* 管理后台（给 2–3 位 ACSSY 组织者用）
   Admin console for the handful of ACSSY organizers.

   路由 / routes
     #/admin（= #/admin/overview）  概览：本轮、用户、累计、近 7 天邮件、意见数
     #/admin/rounds                 轮次列表（每周轮 + 活动轮）
     #/admin/rounds/new             新建活动轮
     #/admin/rounds/:id             编辑活动轮（每周轮自动生成，不能改）
     #/admin/feedback               意见箱
     #/admin/emails                 发信记录
     #/admin/audit                  审计日志

   按设计只看汇总：接口不返回任何人的联系方式（server/admin.js）。数据只走 YL.api，契约见 docs/api.md「管理」。
   日期校验用前后端共用的 YL.domain.coffee.validateRound，最终以接口返回为准。 */
(function () {
  "use strict";
  const { t, L, esc, icon } = YL.ui;
  const D = YL.domain.coffee;

  const TABS = [
    { id: "overview", labelKey: "admin.tab.overview" },
    { id: "rounds", labelKey: "admin.tab.rounds" },
    { id: "feedback", labelKey: "admin.tab.feedback" },
    { id: "emails", labelKey: "admin.tab.emails" },
    { id: "audit", labelKey: "admin.tab.audit" }
  ];
  // 与 server/admin.js 的截断长度一致
  const MAX = { titleZh: 60, titleEn: 80, postTitle: 80, body: 4000, wechat: 2000, tags: 5, days: 31, recMin: 1, recMax: 10, recDefault: 5 };
  const ROUND_KINDS = ["weekly", "event"];
  const ROUND_STATUSES = ["draft", "published"];
  const MAIL_KINDS = ["login_code", "contact_code", "match", "scheduled", "invite_digest", "reminder", "weekly", "event"];
  const MAIL_STATUSES = ["sent", "failed", "skipped"];
  const FB_KINDS = ["bug", "idea", "other"];
  const DASH = "—";

  // 保存活动轮后回到列表时显示一次的提示 { id, title, status }
  let flash = null;

  /* ---------- 格式化 ---------- */
  const num = (n) => YL.ui.num(n);
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
  const FB_PILL = { bug: "pill--warn", idea: "pill--incoming", other: "" };
  // 统计卡：数字 + 名称 + 可选的派生比例
  const stat = (value, label, note) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span>${note ? `<p class="xsmall faint">${esc(note)}</p>` : ""}</div>`;
  const moreLink = (href, text) => `<a class="btn btn--ghost btn--sm" href="${href}">${esc(text)}${icon("arrowRight")}</a>`;
  const noticeHtml = (cls, iconName, inner, extra) => `<div class="notice ${cls}"${extra || ""}>${icon(iconName)}<div class="notice__body">${inner}</div></div>`;
  const errorBox = (error) => YL.ui.emptyState("info", YL.ui.errorText(error, "admin"), `<button type="button" class="btn btn--primary" data-act="retry">${icon("refresh")}<span>${esc(t("common.retry"))}</span></button>`);
  // 表格里不放 .sr-only（绝对定位的元素会跑出 .table-wrap 的滚动区，在手机上把整页撑宽），用 aria-label
  function table(caption, heads, rows) {
    return `<div class="table-wrap"><table class="table" aria-label="${esc(caption)}">
      <thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>`;
  }

  // 给 HTML 片段的第一个元素加上 data-list（列表区，筛选时整块替换）
  const asList = (html) => String(html).replace(/^\s*<([a-z]+)/, "<$1 data-list");

  // 每个管理页的页头：标题、标签页、"只看汇总"的说明
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
      ${noticeHtml("notice--info", "shield", `<p>${esc(t("admin.privacy"))}</p>`)}`;
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

    const warn = failed ? noticeHtml("notice--warn", "mail", `<p>${esc(t("admin.ov.mailFailed", { n: num(failed) }))} <a href="#/admin/emails">${esc(t("admin.ov.seeEmails"))}</a></p>`) : "";

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

    const mailRows = mails.map((m) => `<tr><td>${esc(mailKindLabel(m.kind))}</td><td>${pill(mailStatusLabel(m.status), MAIL_PILL[m.status] || "")}</td><td>${esc(num(m.n))}</td></tr>`);
    const emails = `<section class="stack">
      ${YL.ui.sectionTitle(t("admin.ov.emails"), moreLink("#/admin/emails", t("admin.ov.allEmails")))}
      ${mails.length
        ? table(t("admin.ov.emails"), [esc(t("admin.col.kind")), esc(t("admin.col.status")), esc(t("admin.col.count"))], mailRows)
        : `<div class="card card--quiet"><p class="small muted">${esc(t("admin.ov.noEmails"))}</p></div>`}
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
    if (!r) return `<div class="card">${YL.ui.emptyState("calendar", t("admin.ov.noRound"), `<a class="btn btn--secondary btn--sm" href="#/admin/rounds/new">${icon("plus")}<span>${esc(t("admin.rounds.new"))}</span></a>`)}</div>`;
    const engines = Object.keys(r.engines || {}).filter((k) => Number(r.engines[k]) > 0)
      .map((k) => k + " " + num(r.engines[k])).join(" · ");
    return `<div class="card"><div class="stack">
      <div class="cluster cluster--between">
        <div class="stack stack--s">
          <div class="cluster">${YL.ui.tag(kindLabel(r.kind), r.kind === "event" ? "tag--theme" : "")}</div>
          <h3>${esc(L(r.title))}</h3>
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
      <p class="cluster small muted">${icon("sparkle")}<span>${esc(engines ? t("admin.ov.engines", { list: engines }) : t("admin.ov.noEngines"))}</span></p>
    </div></div>`;
  }

  /* ---------- 轮次列表 ---------- */
  function flashHtml(f) {
    const title = L(f.title);
    if (f.status === "published") {
      return noticeHtml("notice--success", "check", `<p>${esc(t("admin.rounds.savedPublished", { title }))}</p><p><a href="#/events/${enc(f.id)}">${esc(t("admin.rounds.preview"))}</a></p>`, ' role="status"');
    }
    return noticeHtml("notice--success", "check", `<p>${esc(t("admin.rounds.savedDraft", { title }))}</p><p><a href="#/admin/rounds/${enc(f.id)}">${esc(t("admin.rounds.continue"))}</a></p>`, ' role="status"');
  }
  function roundRow(r) {
    const ph = phase(r), title = L(r.title), actions = [];
    if (r.kind === "event") {
      actions.push(`<a class="btn btn--secondary btn--sm" href="#/admin/rounds/${enc(r.id)}" aria-label="${esc(t("admin.rounds.edit") + " " + title)}">${icon("edit")}<span>${esc(t("admin.rounds.edit"))}</span></a>`);
      if (r.status === "published") actions.push(`<a class="btn btn--ghost btn--sm" href="#/events/${enc(r.id)}" aria-label="${esc(t("admin.rounds.view") + " " + title)}"><span>${esc(t("admin.rounds.view"))}</span>${icon("arrowRight")}</a>`);
    }
    const opts = tagOptions();
    const tags = (r.themeTags || []).length ? `<div class="tags">${YL.ui.tags(r.themeTags.map((x) => tagLabel(x, opts)), "tag--theme")}</div>` : "";
    return `<tr>
      <td><div class="stack stack--s"><strong class="nowrap">${esc(title || DASH)}</strong>${tags}</div></td>
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
    empty: () => YL.ui.emptyState("calendar", t("admin.rounds.empty"))
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
    empty: () => YL.ui.emptyState("message", t("admin.fb.empty"))
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
        <td>${x.error ? esc(x.error) : `<span class="faint">${DASH}</span>`}</td>
      </tr>`)),
    empty: () => YL.ui.emptyState("mail", t("admin.mail.empty"))
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
    empty: () => YL.ui.emptyState("shield", t("admin.audit.empty"))
  };

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
      return { n: shown.length, html: asList(shown.length ? view.rows(shown) : YL.ui.emptyState("filter", t("admin.filter.none"))) };
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
    const describedBy = (o.hint ? hintId + " " : "") + countId;
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

    return `<div class="stack stack--s">
        <div><a class="btn btn--ghost btn--sm" href="#/admin/rounds">${icon("chevronLeft")}<span>${esc(t("admin.form.back"))}</span></a></div>
        ${YL.ui.sectionTitle(editing ? t("admin.form.editTitle") : t("admin.form.newTitle"), status)}
      </div>
      <div class="split">
        <form class="form" novalidate data-form>
          <div class="card"><div class="stack">
            <h3>${esc(t("admin.form.basics"))}</h3>
            <div class="grid-cards">
              ${textField({ field: "title", id: "ar-title-zh", name: "titleZh", label: t("admin.form.titleZh"), max: MAX.titleZh, value: title.zh || "", required: true, placeholder: t("admin.form.titleZhPh") })}
              ${textField({ field: "titleEn", id: "ar-title-en", name: "titleEn", label: t("admin.form.titleEn"), max: MAX.titleEn, value: title.en || "", placeholder: t("admin.form.titleEnPh") })}
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
            ${textField({ field: "postTitle", id: "ar-post-title", name: "postTitle", label: t("admin.form.postTitle"), hint: t("admin.form.postTitleHint"), max: MAX.postTitle, value: post.title || "" })}
            ${textField({ field: "postBody", id: "ar-body", name: "body", label: t("admin.form.body"), hint: t("admin.form.bodyHint"), max: MAX.body, value: post.body || "", area: true, rows: 12 })}
            ${textField({ field: "postWechat", id: "ar-wechat", name: "wechat", label: t("admin.form.wechat"), hint: t("admin.form.wechatHint"), max: MAX.wechat, value: post.wechat || "", area: true, rows: 8 })}
          </div></div>

          <div class="notice notice--danger" role="alert" tabindex="-1" data-form-error hidden>${icon("info")}<div class="notice__body"><p data-form-error-text></p></div></div>
          <div class="cluster cluster--end">
            <button type="submit" class="btn btn--secondary" data-status="draft">${esc(published ? t("admin.form.unpublish") : t("admin.form.saveDraft"))}</button>
            <button type="submit" class="btn btn--primary" data-status="published">${esc(published ? t("admin.form.saveChanges") : t("admin.form.publish"))}</button>
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
    const errBox = form.querySelector("[data-form-error]");
    let lastClicked = null;

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
      form.querySelector("[data-tag-preview]").innerHTML = YL.ui.tags(list.slice(0, MAX.tags).map((x) => tagLabel(x, opts)), "tag--theme");
      form.querySelector("[data-tag-count]").textContent = list.length + "/" + MAX.tags;
      form.querySelectorAll("[data-add-tag]").forEach((c) => c.setAttribute("aria-pressed", String(list.indexOf(c.dataset.addTag) >= 0)));
    }
    // 点选问卷里的标签：再点一次取消
    function toggleTag(id) {
      const list = parseTags(el.themeTags.value), i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else if (list.length >= MAX.tags) { YL.ui.showFieldErrors(form, { themeTags: "too_many" }, "admin"); return; }
      else list.push(id);
      YL.ui.clearFieldErrors(form);
      el.themeTags.value = list.join(", ");
      updateTags();
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
      const n = Number(v.recCount);
      if (!/^\d+$/.test(v.recCount) || n < MAX.recMin || n > MAX.recMax) f.recCount = "invalid";
      return f;
    }

    form.addEventListener("input", (e) => {
      const x = e.target;
      if (x.name === "themeTags") updateTags();
      else if (x.name === "startDate" || x.name === "endDate") updateDays();
      else if (x.maxLength > 0 && form.querySelector(`[data-count="${x.name}"]`)) updateCount(x);
    });
    form.addEventListener("change", (e) => { if (e.target.name === "startDate" || e.target.name === "endDate") updateDays(); });
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
      const b = e.target.closest("[data-status]");
      if (b) lastClicked = b;
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const sub = e.submitter && e.submitter.dataset && e.submitter.dataset.status ? e.submitter : lastClicked;
      const btn = sub || form.querySelector('[data-status="draft"]');
      lastClicked = null;
      const status = btn.dataset.status === "published" ? "published" : "draft";
      const v = read();
      YL.ui.clearFieldErrors(form);
      errBox.hidden = true;
      const fields = check(v);
      if (Object.keys(fields).length) { YL.ui.showFieldErrors(form, fields, "admin"); return; }

      if (status === "published" && !wasPublished) {
        const ok = await YL.ui.confirm(t("admin.form.confirmPublish"), { ok: t("admin.form.publish") });
        if (!ctx.isActive()) return;
        if (!ok) { btn.focus(); return; }
      } else if (status === "draft" && wasPublished) {
        const ok = await YL.ui.confirm(t("admin.form.confirmUnpublish"), { ok: t("admin.form.unpublish"), danger: true });
        if (!ctx.isActive()) return;
        if (!ok) { btn.focus(); return; }
      }

      const buttons = Array.from(form.querySelectorAll("[data-status]"));
      buttons.forEach((b) => (b.disabled = true));
      YL.ui.busy(btn, true);
      const r = await YL.api.post("/admin/rounds", {
        id: round ? round.id : undefined,
        title: v.title, startDate: v.startDate, endDate: v.endDate,
        themeTags: v.themeTags, recCount: Number(v.recCount), openBrowse: v.openBrowse,
        status, post: v.post
      });
      if (!ctx.isActive()) return;
      YL.ui.busy(btn, false);
      buttons.forEach((b) => (b.disabled = false));
      if (!r.ok) {
        if (r.error && r.error.fields && Object.keys(r.error.fields).length) YL.ui.showFieldErrors(form, r.error.fields, "admin");
        else showError(YL.ui.errorText(r.error, "admin"));
        return;
      }
      const saved = r.data || {};
      flash = { id: saved.id, title: saved.title || v.title, status: saved.status || status };
      YL.ui.toast(flash.status === "published" ? t("admin.form.publishedToast") : t("admin.form.draftToast"), "success");
      YL.router.navigate("admin/rounds");
    });

    updateDays();
    updateTags();
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
        if (!round) { m.paint(YL.ui.emptyState("calendar", t("admin.form.notFound"), back)); return; }
        if (round.kind !== "event") { m.paint(YL.ui.emptyState("lock", t("admin.form.weekly"), back)); return; }
      }
      m.paint(formHtml(round));
      bindForm(m.page, ctx, round);
      if (focusAfter) m.page.focus();
    }
    m.page.addEventListener("click", (e) => { if (e.target.closest('[data-act="retry"]')) load(true); });
    return load(false);
  }

  registerModule({
    id: "admin",
    requiresAuth: true,
    requiresReady: true,
    adminOnly: true,
    nav: [{ path: "admin", icon: "chart", labelKey: "nav.admin", order: 90, mobile: false, when: () => YL.auth.isAdmin() }],
    render(root, ctx) {
      const sub = ctx.sub || "overview";
      if (sub === "rounds" && ctx.id) return renderForm(root, ctx, ctx.id === "new" ? null : ctx.id);
      const view = VIEWS[sub];
      if (!view) {
        mount(root, null).paint(YL.ui.emptyState("info", t("admin.notFound"), `<a class="btn btn--primary" href="#/admin">${esc(t("admin.backToOverview"))}</a>`));
        return;
      }
      return renderView(root, ctx, sub, view);
    }
  });
})();
