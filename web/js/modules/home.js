/* 首页（未登录）：主视觉、怎么玩、本期活动、三条原则、结尾号召
   Landing page for signed-out visitors.

   #/home（也是默认路由）
     - 已登录且完成首次填写 → #/coffee
     - 已登录但还没填完     → #/profile/setup
     - 未登录               → 落地页
   数据：GET /rounds/events（只用来显示本期活动；失败或没有活动就不显示，不打扰）。 */
(function () {
  "use strict";
  const { t, L, esc, icon, avatar, tag } = YL.ui;
  const D = YL.domain.coffee;

  /* ---------- 活动轮的显示 ---------- */
  // 首页只展示一个活动：进行中的优先，其次最快要开始的
  function pickEvent(list) {
    const items = Array.isArray(list) ? list : [];
    return items.find((r) => r && r.open) ||
      items.filter((r) => r && r.upcoming).sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))[0] || null;
  }
  function day(date, withYear) {
    return YL.ui.formatDate(date, withYear ? { year: "numeric", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
  }
  function rangeText(r) {
    const thisYear = String(new Date().getFullYear());
    const withYear = r.startDate.slice(0, 4) !== thisYear || r.endDate.slice(0, 4) !== thisYear;
    return day(r.startDate, withYear) + " – " + day(r.endDate, withYear);
  }
  // 还有几天开始（按活动时区的日期算）
  function daysUntil(r) {
    try {
      const today = D.localDate(new Date().toISOString(), r.timezone || D.DEFAULT_ROUND.timezone);
      return Math.round((Date.parse(r.startDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    } catch (e) { return null; }
  }
  function eventMeta(r) {
    if (r.open) return t("home.event.joined", { n: YL.ui.num(r.participants) });
    const n = daysUntil(r);
    if (n === 1) return t("home.event.startsTomorrow");
    return n > 1 ? t("home.event.startsIn", { n }) : "";
  }
  function eventBanner(r) {
    const meta = eventMeta(r);
    return `
      <section class="banner banner--event" aria-labelledby="home-ev-title">
        <p class="banner__eyebrow">${esc(r.open ? t("home.event.eyebrowOpen") : t("home.event.eyebrowUpcoming"))}</p>
        <h2 class="banner__title" id="home-ev-title">${esc(L(r.title))}</h2>
        <div class="banner__meta">
          <span>${icon("calendar")}${esc(rangeText(r))}</span>
          ${meta ? `<span>${icon(r.open ? "people" : "clock")}${esc(meta)}</span>` : ""}
        </div>
        <div class="banner__actions">
          <a class="btn btn--accent" href="#/events/${esc(encodeURIComponent(r.id))}">${esc(t("home.event.view"))}${icon("arrowRight")}</a>
        </div>
      </section>`;
  }

  /* ---------- 落地页的各个部分 ---------- */
  function heroHtml() {
    return `
      <div class="hero">
        <p class="hero__eyebrow">${icon("sun")}<span>${esc(t("home.hero.eyebrow"))}</span></p>
        <h1 class="hero__title">${esc(t("home.hero.title"))}<br><em>${esc(t("home.hero.titleEm"))}</em></h1>
        <p class="hero__lead">${esc(t("home.hero.lead"))}</p>
        <div class="hero__cta" data-cta>
          <a class="btn btn--primary btn--lg" href="#/login">${icon("mail")}${esc(t("home.hero.login"))}</a>
        </div>
        <p class="small faint">${esc(t("home.hero.who"))}</p>
      </div>`;
  }
  // 右侧（手机上在下面）一张示例推荐卡：让人一眼看懂"推荐"长什么样。人物是虚构的
  function sampleHtml() {
    const name = t("home.sample.name");
    return `
      <aside class="stack stack--s" aria-labelledby="home-sample">
        <p class="eyebrow" id="home-sample">${esc(t("home.sample.eyebrow"))}</p>
        <article class="person person--rec">
          <div class="person__head">
            ${avatar(name)}
            <div class="person__who">
              <p class="person__name">${esc(name)}</p>
              <p class="person__meta"><span>${esc(t("home.sample.meta1"))}</span><span>${esc(t("home.sample.meta2"))}</span></p>
            </div>
          </div>
          <ul class="person__reasons">
            <li class="reason"><span>${esc(t("home.sample.reason1"))}</span></li>
            <li class="reason"><span>${esc(t("home.sample.reason2"))}</span></li>
          </ul>
          <div class="tags">${tag(t("home.sample.tagGoal"), "tag--goal")}${tag(t("home.sample.tag1"), "tag--shared")}${tag(t("home.sample.tag2"), "tag--shared")}${tag(t("home.sample.tag3"))}</div>
          <div class="person__foot">
            <span class="person__overlap">${icon("clock")}${esc(t("home.sample.overlap"))}</span>
            <span class="pill pill--matched">${icon("check")}${esc(t("home.sample.mutual"))}</span>
          </div>
        </article>
        <p class="small muted">${esc(t("home.sample.note"))}</p>
      </aside>`;
  }
  function howHtml() {
    const steps = ["s1", "s2", "s3"].map((s) => `
      <div class="how__step"><h3>${esc(t("home.how." + s + ".title"))}</h3><p>${esc(t("home.how." + s + ".text"))}</p></div>`).join("");
    return `
      <section class="stack" aria-labelledby="home-how">
        <div class="section-head"><div><h2 class="section-title" id="home-how">${esc(t("home.how.title"))}</h2><p class="section-sub">${esc(t("home.how.sub"))}</p></div></div>
        <div class="how">${steps}</div>
      </section>`;
  }
  function principlesHtml() {
    const items = [["light", "clock"], ["respect", "people"], ["privacy", "lock"]].map(([id, ic]) => `
      <article class="card stack stack--s">
        <div class="tags"><span class="tag tag--theme">${icon(ic, { size: 14 })}${esc(t("home.p." + id + ".tag"))}</span></div>
        <h3>${esc(t("home.p." + id + ".title"))}</h3>
        <p class="small muted">${esc(t("home.p." + id + ".text"))}</p>
      </article>`).join("");
    return `
      <section class="stack" aria-labelledby="home-principles">
        <div class="section-head"><div><h2 class="section-title" id="home-principles">${esc(t("home.principles.title"))}</h2></div></div>
        <div class="grid-cards">${items}</div>
      </section>`;
  }
  function closingHtml() {
    return `
      <section class="banner" aria-labelledby="home-cta">
        <p class="banner__eyebrow">${esc(YL_CONFIG.siteName)}</p>
        <h2 class="banner__title" id="home-cta">${esc(t("home.cta.title"))}</h2>
        <p>${esc(t("home.cta.text"))}</p>
        <div class="banner__actions">
          <a class="btn btn--primary btn--lg" href="#/login">${esc(t("home.hero.login"))}</a>
          <a class="btn btn--secondary btn--lg" href="#/about">${esc(t("home.cta.about"))}</a>
        </div>
      </section>`;
  }

  async function renderLanding(root, ctx) {
    root.innerHTML = `
      <div class="page" data-home>
        <div class="split split--wide-aside">
          ${heroHtml()}
          ${sampleHtml()}
        </div>
        <div data-event hidden></div>
        ${howHtml()}
        ${principlesHtml()}
        ${closingHtml()}
      </div>`;

    // 本期活动：拿不到就安静地跳过
    const r = await YL.api.get("/rounds/events");
    if (!ctx.isActive()) return;
    const ev = r.ok ? pickEvent(r.data) : null;
    const page = root.querySelector("[data-home]");
    if (!ev || !page) return;
    const slot = page.querySelector("[data-event]");
    slot.innerHTML = eventBanner(ev);
    slot.hidden = false;
    const cta = page.querySelector("[data-cta]");
    if (cta) cta.insertAdjacentHTML("beforeend", `<a class="btn btn--secondary btn--lg" href="#/events/${esc(encodeURIComponent(ev.id))}">${icon("flag")}${esc(t("home.hero.events"))}</a>`);
  }

  registerModule({
    id: "home",
    render(root, ctx) {
      if (YL.auth.isLoggedIn()) {
        YL.router.navigate(YL.auth.isReady() ? "coffee" : "profile/setup", { replace: true });
        return;
      }
      return renderLanding(root, ctx);
    }
  });
})();
