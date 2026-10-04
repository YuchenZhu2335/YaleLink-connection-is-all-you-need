/* 个人主页：资料、我的内容、贡献值、演示数据管理 */
registerModule({
  id: "profile",
  nav: { icon: "👤", labelKey: "nav.profile", order: 70, mobile: true },
  requiresAuth: true,
  descriptionKey: "about.module.profile",
  render(root) {
    const { t, esc, L, $, avatar, tags, sectionTitle } = YL.ui;
    const s = YL.auth.user(); const p = s.profile || {};
    const me = YL.store.user("me");
    const myPosts = YL.store.get("posts").filter((x) => x.authorId === "me");
    const rsvps = YL.store.get("events").filter((e) => YL.store.getState("rsvp", e.id));
    const joined = YL.store.get("groups").filter((g) => YL.store.getState("joined", g.id));
    const saved = YL.store.get("jobs").filter((j) => YL.store.getState("savedJobs", j.id));
    const audit = YL.audit.list({ actor: "me", limit: 8 });
    const points = 50 + myPosts.length * 20 + rsvps.length * 5 + joined.length * 10 + YL.store.countState("likes") * 1 + YL.store.countState("helpful") * 1;
    const badges = [];
    if (myPosts.length) badges.push("author"); if (joined.length) badges.push("teammate"); if (rsvps.length) badges.push("active");
    if (s.kind === "alumni") badges.push("alumni"); else badges.push("student");
    root.innerHTML = `<div class="two-col"><div class="stack">
      <div class="card"><div class="person">${avatar(me.name, "xl")}<div style="flex:1"><h1 style="font-size:1.4rem">${esc(me.name)}</h1><div class="muted">${esc(s.email)} · <span class="badge ${s.kind === "alumni" ? "badge--green" : ""}">${t("profile.kind." + s.kind)}</span></div>
        <div class="row small muted" style="margin-top:6px"><span>🎓 ${esc(L(YL.store.term("schools", p.school).label))} '${String(p.classYear || "").slice(-2)}</span><span>📍 ${YL.store.region(p.region).emoji} ${esc(L(YL.store.region(p.region).name))}</span><span>🏢 ${esc(L(YL.store.term("industries", p.industry).label))}</span></div>
        <div style="margin-top:10px">${(p.offers || []).length ? tags(p.offers.map((o) => { const x = YL.store.term("offers", o); return { zh: x.emoji + " " + L(x.label), en: x.emoji + " " + x.label.en }; }), "tag--green") : `<span class="muted small">${t("profile.noOffers")}</span>`}</div>
        <div class="row" style="margin-top:12px"><a class="btn btn--primary btn--sm" href="#/login/profile?next=profile">${t("profile.edit")}</a><button class="btn btn--ghost btn--sm" id="btn-logout">${t("profile.logout")}</button></div></div></div></div>
      <section>${sectionTitle(t("profile.myPosts", { n: myPosts.length }), `<a class="btn btn--ghost btn--sm" href="#/careers/research">＋ ${t("post.new")}</a>`)}<div class="stack">${myPosts.length ? myPosts.map(YL.careers.postCard).join("") : YL.ui.emptyState("📝", t("profile.noPosts"))}</div></section>
      <section>${sectionTitle(t("profile.myEvents", { n: rsvps.length }))}<div class="list">${rsvps.length ? rsvps.map((e) => `<a class="list-row card--hover" href="#/events/e/${e.id}"><div class="list-row__main"><div class="list-row__title">${esc(L(e.title))}</div><div class="list-row__sub">${YL.ui.formatDate(e.date)} · ${YL.store.region(e.region).emoji} ${esc(L(YL.store.region(e.region).name))}</div></div></a>`).join("") : YL.ui.emptyState("📅", t("profile.noEvents"), `<a class="btn btn--primary btn--sm" href="#/events">${t("home.ctaEvents")}</a>`)}</div></section>
      <section>${sectionTitle(t("profile.myGroups", { n: joined.length }))}<div class="list">${joined.length ? joined.map((g) => `<a class="list-row card--hover" href="#/careers/groups"><div class="list-row__main"><div class="list-row__title">${esc(L(g.name))}</div><div class="list-row__sub">${g.nextMock ? "🎯 " + YL.ui.formatDate(g.nextMock.date) + " · " + esc(L(g.nextMock.topic)) : esc(L(g.cadence))}</div></div></a>`).join("") : YL.ui.emptyState("🎯", t("profile.noGroups"), `<a class="btn btn--primary btn--sm" href="#/careers/groups">${t("home.quick.mock")}</a>`)}</div></section>
      ${saved.length ? `<section>${sectionTitle(t("profile.savedJobs", { n: saved.length }))}<div class="list">${saved.map((j) => `<a class="list-row card--hover" href="#/careers/jobs"><div class="list-row__main"><div class="list-row__title">${esc(L(j.title))} · ${esc(L(j.company))}</div><div class="list-row__sub">${t("careers.deadline")} ${YL.ui.formatDate(j.deadline)}</div></div>${YL.ui.deadlineBadge(j.deadline)}</a>`).join("")}</div></section>` : ""}
    </div><div class="stack">
      <div class="card"><div class="row row--between"><span class="muted small">${t("profile.points")}</span><span class="badge">${points}</span></div><p class="small muted" style="margin-top:8px">${t("profile.pointsHow")}</p><div class="divider"></div><div class="muted small" style="margin-bottom:6px">${t("profile.badges")}</div><div>${badges.map((b) => { const x = YL.store.term("badges", b); return `<span class="tag tag--accent" title="${esc(L(x.desc))}">${x.emoji} ${esc(L(x.label))}</span>`; }).join("")}</div></div>
      <div class="card" id="audit-log"><div class="card__title">🧾 ${t("profile.auditTitle")}</div><p class="muted small">${t("profile.auditSub")}</p>${audit.length ? `<div class="stack" style="margin-top:8px">${audit.map((e) => `<div class="small"><div class="row"><code>${esc(e.op)}</code>${e.ok ? `<span class="badge badge--green">✓</span>` : `<span class="badge badge--warn">${esc(e.code)}</span>`}</div><div class="muted">${esc(YL.ui.formatDate(e.at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}${e.target ? " · " + esc(e.target) : ""}</div></div>`).join("")}</div>` : `<p class="muted small">—</p>`}</div>
      <div class="card"><div class="card__title">${t("profile.demoData")}</div><p class="muted small">${t("profile.demoDataSub")}</p><button class="btn btn--danger btn--sm" id="btn-reset">${t("profile.reset")}</button></div>
    </div></div>`;
    $("#btn-logout").onclick = () => { YL.auth.logout(); YL.ui.toast(t("profile.loggedOut")); YL.router.navigate("home"); };
    $("#btn-reset").onclick = () => { if (confirm(t("profile.resetConfirm"))) { YL.store.resetDemo(); YL.ui.toast(t("profile.resetDone"), "success"); YL.router.render(); } };
  }
});
