/* 校友目录：搜索 + 行业/地区/可提供帮助筛选，个人页 */
registerModule({
  id: "directory",
  nav: { icon: "🤝", labelKey: "nav.directory", order: 60, mobile: true },
  requiresAuth: true,
  descriptionKey: "about.module.directory",
  render(root, ctx) {
    const { t, esc, L, $, $$, avatar, tags, chips, sectionTitle } = YL.ui;

    if (ctx.sub === "u") {
      const u = YL.store.user(ctx.id);
      if (!u) { root.innerHTML = YL.ui.emptyState("🤝", t("common.noResults"), `<a class="btn" href="#/directory">${t("common.back")}</a>`); return; }
      const posts = YL.store.get("posts").filter((p) => p.authorId === u.id);
      const events = YL.store.get("events").filter((e) => e.hostId === u.id);
      const draw = () => {
        const greeted = YL.store.getState("greeted", u.id);
        root.innerHTML = `<a class="muted small" href="#/directory">← ${t("common.back")}</a>
          <div class="two-col" style="margin-top:12px"><div class="stack">
            <div class="card"><div class="person">${avatar(u.name, "xl")}<div style="flex:1"><h1 style="font-size:1.4rem">${esc(L(u.name))}</h1>
              <div class="muted">${esc(L(u.title))}${u.company ? ` · ${esc(L(u.company))}` : ""}</div>
              <div class="row small muted" style="margin-top:6px"><span>🎓 ${esc(L(YL.store.term("schools", u.school).label))} '${String(u.classYear).slice(-2)}${u.degree ? " · " + esc(L(u.degree)) : ""}</span><span>📍 ${YL.store.region(u.region).emoji} ${esc(L(YL.store.region(u.region).name))}</span><span>🏢 ${esc(L(YL.store.term("industries", u.industry).label))}</span></div>
              <div style="margin-top:10px">${tags((u.offers || []).map((o) => { const x = YL.store.term("offers", o); return { zh: x.emoji + " " + L(x.label), en: x.emoji + " " + x.label.en }; }), "tag--green")}</div></div></div>
              ${u.bio ? `<div class="divider"></div><p class="muted">${esc(L(u.bio))}</p>` : ""}
              ${!u.isMe ? `<div class="row" style="margin-top:12px"><button class="btn ${greeted ? "is-on" : "btn--primary"}" id="btn-greet">${greeted ? "✓ " + t("directory.greeted") : "👋 " + t("directory.greet")}</button>${u.offers.includes("coffee") ? `<a class="btn btn--ghost" id="btn-coffee" href="#/coffee/p/${encodeURIComponent(u.id)}">☕ ${t("directory.coffee")}</a>` : ""}</div>` : `<a class="btn btn--ghost" style="margin-top:12px" href="#/profile">${t("profile.edit")}</a>`}
            </div>
            ${posts.length ? `<section>${sectionTitle(t("directory.posts", { n: posts.length }))}<div class="stack">${posts.map(YL.careers.postCard).join("")}</div></section>` : ""}
            ${events.length ? `<section>${sectionTitle(t("directory.hosted", { n: events.length }))}<div class="list">${events.map((e) => `<a class="list-row card--hover" href="#/events/e/${e.id}"><div class="list-row__main"><div class="list-row__title">${esc(L(e.title))}</div><div class="list-row__sub">${YL.ui.formatDate(e.date)} · ${YL.store.region(e.region).emoji} ${esc(L(YL.store.region(e.region).name))}</div></div></a>`).join("")}</div></section>` : ""}
          </div><div class="stack">
            <div class="card"><div class="row row--between"><span class="muted small">${t("profile.points")}</span><span class="badge">${u.points}</span></div><div class="divider"></div><div class="muted small" style="margin-bottom:6px">${t("profile.badges")}</div><div>${(u.badges || []).length ? u.badges.map((b) => { const x = YL.store.term("badges", b); return `<span class="tag tag--accent" title="${esc(L(x.desc))}">${x.emoji} ${esc(L(x.label))}</span>`; }).join("") : `<span class="muted small">—</span>`}</div></div>
            <div class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">${t("directory.privacyNote")}</div></div>
          </div></div>`;
        const g = $("#btn-greet"); if (g) g.onclick = () => { const on = YL.store.toggleState("greeted", u.id); if (on) YL.ui.toast(t("directory.greetSent", { name: L(u.name) }), "success"); draw(); };
      };
      draw(); return;
    }

    const industries = [{ id: "all", label: { zh: "全部行业", en: "All industries" } }].concat(YL.store.terms("industries"));
    const regions = [{ id: "all", name: { zh: "全部地区", en: "All regions" }, emoji: "🌏" }].concat(YL.store.get("regions"));
    const offers = [{ id: "all", label: { zh: "任何帮助", en: "Any help" }, emoji: "✨" }].concat(YL.store.terms("offers"));
    let ind = ctx.query.industry || "all", region = ctx.query.region || "all", offer = ctx.query.offer || "all", q = "";
    const draw = () => {
      const kw = q.trim().toLowerCase();
      const list = YL.store.get("users").filter((u) => (ind === "all" || u.industry === ind) && (region === "all" || u.region === region) && (offer === "all" || u.offers.includes(offer)) && (!kw || JSON.stringify([u.name, u.title, u.company, u.bio]).toLowerCase().includes(kw)));
      root.innerHTML = `<div class="page-head"><h1>${t("directory.title")}</h1><p>${t("directory.intro")}</p></div>
        <div class="search"><input class="input" id="q" placeholder="${t("directory.searchPh")}" value="${esc(q)}"></div>
        ${chips(offers.map((o) => ({ id: o.id, label: { zh: o.emoji + " " + L(o.label), en: o.emoji + " " + o.label.en } })), offer, "offer").replace('class="chips"', 'class="chips chips--scroll"')}
        ${chips(industries, ind, "ind").replace('class="chips"', 'class="chips chips--scroll"')}
        ${chips(regions.map((r) => ({ id: r.id, label: { zh: r.emoji + " " + L(r.name), en: r.emoji + " " + r.name.en } })), region, "region").replace('class="chips"', 'class="chips chips--scroll"')}
        <p class="small muted">${t("directory.count", { n: list.length })}</p>
        <div class="grid grid-2">${list.length ? list.map((u) => `<a class="card card--hover" href="#/directory/u/${u.id}"><div class="person">${avatar(u.name, "lg")}<div style="flex:1;min-width:0"><div class="person__name">${esc(L(u.name))} <span class="muted small" style="font-weight:500">${esc(L(YL.store.term("schools", u.school).label))} '${String(u.classYear).slice(-2)}</span></div><div class="person__sub">${esc(L(u.title))}${u.company ? " · " + esc(L(u.company)) : ""}</div><div class="person__sub">${YL.store.region(u.region).emoji} ${esc(L(YL.store.region(u.region).name))} · ${esc(L(YL.store.term("industries", u.industry).label))}</div><div style="margin-top:8px">${tags(u.offers.map((o) => { const x = YL.store.term("offers", o); return { zh: x.emoji + " " + L(x.label), en: x.emoji + " " + x.label.en }; }), "tag--green")}</div></div></div></a>`).join("") : YL.ui.emptyState("🤝", t("common.noResults"))}</div>
        <p class="notice">${t("directory.seedNote")}</p>`;
      $$("[data-ind]").forEach((b) => (b.onclick = () => { ind = b.dataset.ind; draw(); }));
      $$("[data-region]").forEach((b) => (b.onclick = () => { region = b.dataset.region; draw(); }));
      $$("[data-offer]").forEach((b) => (b.onclick = () => { offer = b.dataset.offer; draw(); }));
      const qi = $("#q"); qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
    };
    draw();
  }
});
