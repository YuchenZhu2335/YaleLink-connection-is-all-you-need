/* 活动：Coffee Chat 周 / 月这类活动轮的介绍页（不登录也能看，方便转发到微信群和公众号）
   Event rounds — public pages, shareable without signing in.

   #/events       所有已发布的活动轮：进行中 / 即将开始在前，往期在后
   #/events/:id   活动文章：标题、日期、人数、主题、正文、微信推文（一键复制）、参加按钮

   数据：GET /rounds/events、GET /rounds/:id（docs/api.md「公开信息」）。
   post.title / body / wechat 是管理员写的纯文本（不是双语），一律 esc() 后放进 .prose（保留换行）。 */
(function () {
  "use strict";
  const { t, L, esc, icon } = YL.ui;
  const D = YL.domain.coffee;

  /* ---------- 显示用的小工具 ---------- */
  const tzOf = (r) => r.timezone || D.DEFAULT_ROUND.timezone;
  const statusOf = (r) => (r.open ? "open" : r.upcoming ? "upcoming" : "ended");
  const md = (date) => { const p = String(date).split("-"); return Number(p[1]) + "/" + Number(p[2]); };
  const hrefOf = (r) => "#/events/" + esc(encodeURIComponent(r.id));
  function day(date, withYear) {
    return YL.ui.formatDate(date, withYear ? { year: "numeric", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
  }
  function rangeText(r) {
    const thisYear = String(new Date().getFullYear());
    const withYear = r.startDate.slice(0, 4) !== thisYear || r.endDate.slice(0, 4) !== thisYear;
    return r.startDate === r.endDate ? day(r.startDate, withYear) : day(r.startDate, withYear) + " – " + day(r.endDate, withYear);
  }
  // 还有几天开始（按活动时区的"今天"算）
  function daysUntil(r) {
    try {
      const today = D.localDate(new Date().toISOString(), tzOf(r));
      return Math.round((Date.parse(r.startDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    } catch (e) { return null; }
  }
  // 人数 / 倒计时一行
  function countText(r) {
    const s = statusOf(r);
    if (s === "open") return t("events.joined", { n: YL.ui.num(r.participants) });
    if (s === "ended") return t("events.joinedPast", { n: YL.ui.num(r.participants) });
    const n = daysUntil(r);
    if (n === 1) return t("events.startsTomorrow");
    return n > 1 ? t("events.startsIn", { n }) : "";
  }
  function statusPill(r) {
    const s = statusOf(r);
    const cls = s === "open" ? " pill--success" : s === "upcoming" ? " pill--incoming" : "";
    const ic = s === "open" ? icon("sun") : s === "upcoming" ? icon("clock") : "";
    return `<span class="pill${cls}">${ic}${esc(t("events.status." + s))}</span>`;
  }
  // 活动从开始日（活动时区）0:00 起，旁边写北京时间
  function tzNote(r) {
    try {
      const tz = tzOf(r);
      const start = D.slotStart({ timezone: tz }, r.startDate + "T00:00");
      const bj = new Intl.DateTimeFormat(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(start));
      return t("events.tzNote", { tz: tz === "America/New_York" ? t("events.tz.ny") : tz, start: md(r.startDate), bj });
    } catch (e) { return ""; }
  }
  // 正文摘要（列表卡片用）：第一段的前 80 个字
  function excerpt(r) {
    const body = String((r.post && r.post.body) || "").trim();
    if (!body) return "";
    const first = body.split(/\n\s*\n|\n/)[0].trim();
    return first.length > 80 ? first.slice(0, 80) + "…" : first;
  }
  // 主题标签存的是问卷选项 id（推荐时命中加分），显示成选项的名字；兴趣、想聊的优先，找不到就原样显示
  function themeLabel(id) {
    const qs = YL.auth.questions().slice().sort((a, b) => rank(a) - rank(b));
    for (const q of qs) { const o = (q.options || []).find((x) => x.id === id); if (o) return L(o.label); }
    return String(id);
  }
  const rank = (q) => { const i = ["interests", "goals"].indexOf(q.id); return i < 0 ? 9 : i; };
  const themeTags = (r) => ((r.themeTags || []).length ? `<div class="tags">${YL.ui.tags(r.themeTags.map(themeLabel), "tag--theme")}</div>` : "");
  // 参加按钮：完成首次填写 → 去约咖啡；登录了没填完 → 去填；没登录 → 登录
  function joinLink(cls) {
    if (YL.auth.isReady()) return `<a class="btn btn--primary${cls || ""}" href="#/coffee">${icon("coffee")}${esc(t("events.cta.go"))}</a>`;
    if (YL.auth.isLoggedIn()) return `<a class="btn btn--primary${cls || ""}" href="#/profile/setup?next=coffee">${icon("user")}${esc(t("events.cta.finish"))}</a>`;
    return `<a class="btn btn--primary${cls || ""}" href="#/login?next=coffee">${icon("mail")}${esc(t("events.cta.login"))}</a>`;
  }
  const errorBox = (error) => YL.ui.emptyState("info", YL.ui.errorText(error, "events"), `<button type="button" class="btn btn--primary" data-act="retry">${icon("refresh")}${esc(t("common.retry"))}</button>`);

  /* ---------- #/events ---------- */
  function card(r) {
    const count = countText(r), ex = excerpt(r);
    return `
      <article class="card stack stack--s">
        <div class="cluster cluster--between">${statusPill(r)}<span class="small muted">${esc(rangeText(r))}</span></div>
        <h3 class="card__title"><a class="list__link" href="${hrefOf(r)}">${esc(L(r.title))}</a></h3>
        ${themeTags(r)}
        ${ex ? `<p class="small muted">${esc(ex)}</p>` : ""}
        <div class="cluster cluster--between">
          <span class="small muted">${count ? esc(count) : ""}</span>
          <a class="btn btn--secondary btn--sm" href="${hrefOf(r)}" tabindex="-1" aria-hidden="true">${esc(t("events.view"))}${icon("chevronRight")}</a>
        </div>
      </article>`;
  }
  function listHtml(items) {
    if (!items.length) {
      return YL.ui.emptyState("flag", t("events.empty"), joinLink());
    }
    const current = items.filter((r) => r.open).concat(items.filter((r) => !r.open && r.upcoming).sort((a, b) => (a.startDate < b.startDate ? -1 : 1)));
    const past = items.filter((r) => !r.open && !r.upcoming);
    const now = current.length
      ? `<div class="grid-cards">${current.map(card).join("")}</div>`
      : `<div class="notice notice--info">${icon("info")}<div class="notice__body"><p>${esc(t("events.noCurrent"))}</p><div>${joinLink(" btn--sm")}</div></div></div>`;
    return `
      <section class="stack" aria-labelledby="ev-now">
        <h2 class="section-title" id="ev-now">${esc(t("events.section.current"))}</h2>
        ${now}
      </section>
      ${past.length ? `
      <section class="stack" aria-labelledby="ev-past">
        <h2 class="section-title" id="ev-past">${esc(t("events.section.past"))}</h2>
        <div class="grid-cards">${past.map(card).join("")}</div>
      </section>` : ""}`;
  }
  async function viewList(root, ctx) {
    root.innerHTML = `
      <section class="page" data-ev-root>
        <header class="page-head">
          <div class="page-head__text">
            <p class="eyebrow">${esc(t("events.eyebrow"))}</p>
            <h1 class="page-title">${esc(t("events.title"))}</h1>
            <p class="page-sub">${esc(t("events.sub"))}</p>
          </div>
        </header>
        <div class="stack stack--l" data-ev-list tabindex="-1" aria-live="polite" aria-busy="true">${YL.ui.spinner()}</div>
      </section>`;
    const page = root.querySelector("[data-ev-root]");
    const box = page.querySelector("[data-ev-list]");
    page.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="retry"]')) load(true);
    });
    // refocus：点"重试"后按钮会被替换掉，把焦点放回列表，键盘和读屏用户不至于迷路
    async function load(refocus) {
      box.setAttribute("aria-busy", "true");
      box.innerHTML = YL.ui.spinner();
      const r = await YL.api.get("/rounds/events");
      if (!ctx.isActive()) return;
      box.removeAttribute("aria-busy");
      box.innerHTML = r.ok ? listHtml(Array.isArray(r.data) ? r.data : []) : errorBox(r.error);
      if (refocus) box.focus();
    }
    await load();
  }

  /* ---------- #/events/:id ---------- */
  function statusNote(r) {
    const s = statusOf(r);
    if (s === "open") return `<div class="notice notice--success">${icon("sun")}<div class="notice__body"><p>${esc(t("events.openNote"))}</p></div></div>`;
    if (s === "upcoming") return `<div class="notice notice--accent">${icon("clock")}<div class="notice__body"><p>${esc(t("events.upcomingNote", { start: day(r.startDate) }))}</p></div></div>`;
    return `<div class="notice">${icon("info")}<div class="notice__body"><p>${esc(t("events.endedNote"))}</p></div></div>`;
  }
  function articleHtml(r) {
    const post = r.post || {};
    const title = L(r.title);
    const body = String(post.body || "").trim();
    const wechat = String(post.wechat || "").trim();
    const postTitle = String(post.title || "").trim();
    const showPostTitle = postTitle && postTitle !== (r.title && r.title.zh) && postTitle !== (r.title && r.title.en);
    const count = countText(r), tz = tzNote(r);
    return `
      <article class="article" aria-labelledby="ev-title">
        <div><a class="btn btn--ghost btn--sm" href="#/events">${icon("chevronLeft")}${esc(t("events.back"))}</a></div>
        <header class="article__hero">
          <div class="cluster">${statusPill(r)}</div>
          <h1 class="article__title" id="ev-title" tabindex="-1">${esc(title)}</h1>
          <div class="article__meta">
            <span>${icon("calendar")}${esc(rangeText(r))}</span>
            ${count ? `<span>${icon(statusOf(r) === "upcoming" ? "clock" : "people")}${esc(count)}</span>` : ""}
            ${tz ? `<span>${icon("globe")}${esc(tz)}</span>` : ""}
          </div>
        </header>
        ${themeTags(r)}
        ${statusNote(r)}
        <div class="cluster">
          ${joinLink()}
          <button type="button" class="btn btn--secondary" data-act="copy-link">${icon("copy")}${esc(t("events.copyLink"))}</button>
        </div>
        ${showPostTitle ? `<h2>${esc(postTitle)}</h2>` : ""}
        ${body ? `<div class="prose">${esc(body)}</div>` : `<p class="muted">${esc(t("events.noBody"))}</p>`}
        ${wechat ? `
        <section class="copybox" aria-labelledby="ev-wechat">
          <div class="copybox__head">
            <h2 class="section-title" id="ev-wechat">${esc(t("events.wechat.title"))}</h2>
            <button type="button" class="btn btn--secondary btn--sm" data-act="copy-wechat">${icon("copy")}${esc(t("events.wechat.copy"))}</button>
          </div>
          <p class="section-sub">${esc(t("events.wechat.sub"))}</p>
          <div class="copybox__text" tabindex="0" role="region" aria-labelledby="ev-wechat">${esc(wechat)}</div>
        </section>` : ""}
        <section class="card card--quiet stack" aria-labelledby="ev-ready">
          <div class="stack stack--s">
            <h2 class="section-title" id="ev-ready">${esc(t("events.closing.title"))}</h2>
            <p class="muted">${esc(t("events.closing.text"))}</p>
          </div>
          <div class="cluster">${joinLink()}<a class="btn btn--ghost" href="#/about">${esc(t("events.closing.about"))}</a></div>
        </section>
      </article>`;
  }
  async function viewOne(root, ctx) {
    root.innerHTML = `<section class="page" data-ev-root><div data-ev-body aria-live="polite" aria-busy="true">${YL.ui.spinner()}</div></section>`;
    const page = root.querySelector("[data-ev-root]");
    const box = page.querySelector("[data-ev-body]");
    let round = null;
    page.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "retry") load(true);
      else if (act === "copy-link") YL.ui.copy(location.href);
      else if (act === "copy-wechat" && round) YL.ui.copy(String((round.post && round.post.wechat) || "").trim());
    });
    async function load(refocus) {
      box.setAttribute("aria-busy", "true");
      box.innerHTML = YL.ui.spinner();
      const r = await YL.api.get("/rounds/" + encodeURIComponent(ctx.sub));
      if (!ctx.isActive()) return;
      box.removeAttribute("aria-busy");
      if (!r.ok) {
        box.innerHTML = r.error && r.error.code === "not_found"
          ? YL.ui.emptyState("flag", t("events.err.not_found"), `<a class="btn btn--primary" href="#/events">${esc(t("events.back"))}</a>`)
          : errorBox(r.error);
        return;
      }
      round = r.data || {};
      box.innerHTML = articleHtml(round);
      if (refocus) box.querySelector("#ev-title").focus();
    }
    await load();
  }

  registerModule({
    id: "events",
    nav: [{ path: "events", icon: "flag", labelKey: "nav.events", order: 60, mobile: false }],
    render(root, ctx) {
      if (ctx.sub) return viewOne(root, ctx);
      return viewList(root, ctx);
    }
  });
})();
