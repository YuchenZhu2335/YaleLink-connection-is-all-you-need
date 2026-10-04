/* 首页：欢迎 / 快捷入口 / 最新帖子 / 近期活动 / 精选校友 */
registerModule({
  id: "home",
  nav: { icon: "🏠", labelKey: "nav.home", order: 10, mobile: true },
  descriptionKey: "about.module.home",
  render(root) {
    const { t, esc, L, avatar, tags, formatDate, userLink, sectionTitle, num } = YL.ui;
    const logged = YL.auth.isLoggedIn();
    const me = logged ? YL.auth.user().profile : null;
    const users = YL.store.get("users");
    const byId = (id) => users.find((u) => u.id === id);
    const posts = YL.store.get("posts").slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    const today = new Date().toISOString().slice(0, 10);
    let events = YL.store.get("events").filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const myRegion = me && me.region;
    if (myRegion) events = events.filter((e) => e.region === myRegion).concat(events.filter((e) => e.region !== myRegion));
    events = events.slice(0, 4);
    const featured = users.filter((u) => u.featured).slice(0, 4);
    const jobs = YL.store.get("jobs").filter((j) => j.deadline >= today).length;

    const quick = [
      { href: "#/coffee", icon: "☕", key: "home.quick.coffee" },
      { href: "#/careers/jobs", icon: "💼", key: "home.quick.jobs" },
      { href: "#/careers/groups", icon: "🎯", key: "home.quick.mock" },
      { href: "#/events", icon: "📍", key: "home.quick.events" },
      { href: "#/startup", icon: "🚀", key: "home.quick.startup" },
      { href: "#/life", icon: "🧭", key: "home.quick.life" },
      { href: "#/directory", icon: "🤝", key: "home.quick.directory" },
      { href: "#/circles", icon: "🫂", key: "home.quick.circles" },
      { href: "#/events", icon: "🎉", key: "home.quick.host" }
    ];
    const acssyPosts = YL.store.get("posts").filter((p) => p.category === "acssy").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
    const volunteerCalls = YL.store.get("campaigns").filter((c) => c.status !== "done" && (c.volunteerRoles || []).some((r) => r.filled < r.count));
    const myTasks = []; if (YL.auth.isAcssy()) YL.store.get("campaigns").forEach((c) => c.tasks.forEach((tk) => { if (tk.assigneeId === "me" && tk.status !== "done") myTasks.push({ c, tk }); }));

    root.innerHTML = `
      <section class="hero">
        <div class="hero__eyebrow">ACSSY · Yale Alumni Network</div>
        <h1>${logged ? t("home.helloName", { name: esc(YL.auth.displayName()) }) : t("home.hero")}</h1>
        <p>${t("home.heroSub")}</p>
        <div class="hero__actions">
          ${logged ? `<a class="btn btn--primary" href="#/careers">${t("home.ctaCareers")}</a><a class="btn btn--ghost" href="#/events">${t("home.ctaEvents")}</a>`
                   : `<a class="btn btn--primary" href="#/login">${t("home.ctaLogin")}</a><a class="btn btn--ghost" href="#/about">${t("home.ctaAbout")}</a>`}
        </div>
      </section>

      <div class="stats section">
        ${YL.ui.stat(num(users.length), t("home.stat.alumni"))}
        ${YL.ui.stat(num(jobs), t("home.stat.jobs"))}
        ${YL.ui.stat(num(YL.store.get("events").length), t("home.stat.events"))}
        ${YL.ui.stat(num(YL.store.get("regions").length), t("home.stat.regions"))}
      </div>

      <section class="section acssy-push">
        ${sectionTitle("📣 " + t("home.acssyPush"), YL.auth.isAcssy() ? `<a class="btn btn--ghost btn--sm" href="#/acssy">${t("nav.acssy")}</a>` : "", t("home.acssyPushSub"))}
        <div class="grid grid-2">
          ${acssyPosts.map((p) => `<a class="card card--hover" href="#/careers/post/${p.id}"><div class="row" style="margin-bottom:6px">${YL.ui.tag({ zh: "学联公告", en: "ACSSY notice" }, "tag--accent")}<span class="muted small">${formatDate(p.createdAt)}</span></div><div class="card__title">${esc(L(p.title))}</div><div class="card__body clamp-2">${esc(L(p.summary))}</div></a>`).join("")}
          ${volunteerCalls.map((c) => { const need = c.volunteerRoles.reduce((s, r) => s + Math.max(0, r.count - r.filled), 0); return `<a class="card card--hover" href="${YL.auth.isAcssy() ? "#/acssy/volunteers" : "#/login/profile?next=acssy/volunteers"}"><div class="row" style="margin-bottom:6px">${YL.ui.tag({ zh: "志愿者招募", en: "Volunteers wanted" }, "tag--green")}<span class="muted small">🗓️ ${formatDate(c.date)}</span></div><div class="card__title">${esc(L(c.name))}</div><div class="card__body">${t("home.volunteersNeeded", { n: need })}</div></a>`; }).join("")}
          ${myTasks.length ? `<a class="card card--hover card--primary" href="#/acssy/board"><div class="card__title">📋 ${t("home.myTasks", { n: myTasks.length })}</div><div class="card__body">${myTasks.slice(0, 3).map(({ tk }) => esc(L(tk.title))).join(" · ")}</div></a>` : ""}
        </div>
      </section>

      <section class="section">
        ${sectionTitle(t("home.quickTitle"))}
        <div class="grid grid-3">
          ${quick.map((q) => `<a class="card card--hover" href="${q.href}"><div style="font-size:1.6rem">${q.icon}</div><div class="card__title" style="margin-top:6px">${t(q.key)}</div><div class="card__meta">${t(q.key + "Sub")}</div></a>`).join("")}
        </div>
      </section>

      <div class="two-col">
        <section class="section">
          ${sectionTitle(t("home.latestPosts"), `<a class="btn btn--ghost btn--sm" href="#/careers/research">${t("common.viewAll")}</a>`)}
          <div class="stack">
            ${posts.map((p) => { const a = byId(p.authorId); const cat = YL.store.term("postCategories", p.category); return `
              <a class="card card--hover" href="#/careers/post/${p.id}">
                <div class="row" style="margin-bottom:6px">${YL.ui.tag(cat.label)}<span class="muted small">${formatDate(p.createdAt)}</span></div>
                <div class="card__title">${esc(L(p.title))}</div>
                <div class="card__body clamp-2">${esc(L(p.summary))}</div>
                <div class="card__foot"><span>${a ? `${avatar(a.name, "xs")} <span class="small">${esc(L(a.name))} · ${esc(L(a.title))}</span>` : ""}</span><span class="muted small">👍 ${p.likes} · 💬 ${p.commentsCount}</span></div>
              </a>`; }).join("")}
          </div>
        </section>
        <div>
          <section class="section">
            ${sectionTitle(t("home.upcoming"), `<a class="btn btn--ghost btn--sm" href="#/events">${t("common.viewAll")}</a>`)}
            <div class="list">
              ${events.map((e) => { const d = new Date(e.date + "T00:00:00"); const r = YL.store.region(e.region); return `
                <a class="list-row card--hover" href="#/events/e/${e.id}">
                  <div class="date-box"><strong>${d.getDate()}</strong><span>${d.toLocaleDateString(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US", { month: "short" })}</span></div>
                  <div class="list-row__main"><div class="list-row__title clamp-2">${esc(L(e.title))}</div><div class="list-row__sub">${r.emoji} ${esc(L(r.name))} · ${esc(e.time)}</div></div>
                </a>`; }).join("")}
            </div>
          </section>
          <section class="section">
            ${sectionTitle(t("home.featured"), `<a class="btn btn--ghost btn--sm" href="#/directory">${t("common.viewAll")}</a>`)}
            <div class="stack">
              ${featured.map((u) => `<a class="card card--hover" href="#/directory/u/${u.id}"><div class="person">${avatar(u.name)}<div><div class="person__name">${esc(L(u.name))} <span class="muted small">'${String(u.classYear).slice(-2)} ${esc(L(YL.store.term("schools", u.school).label))}</span></div><div class="person__sub">${esc(L(u.title))} · ${esc(L(u.company))}</div><div style="margin-top:6px">${tags(u.offers.map((o) => YL.store.term("offers", o).label), "tag--green")}</div></div></div></a>`).join("")}
            </div>
          </section>
        </div>
      </div>`;
  }
});
