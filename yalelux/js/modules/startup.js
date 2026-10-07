/* 创业：校内资源指南 / 项目 & 找合伙人 / 匹配 */
registerModule({
  id: "startup",
  nav: { icon: "🚀", labelKey: "nav.startup", order: 40, mobile: false },
  descriptionKey: "about.module.startup",
  render(root, ctx) {
    const { t, esc, L, $, $$, avatar, tags, chips, sectionTitle } = YL.ui;
    const requireLogin = YL.auth.requireLogin;
    const TABS = [{ id: "resources", icon: "🏛️", labelKey: "startup.tab.resources" }, { id: "projects", icon: "🧪", labelKey: "startup.tab.projects" }, { id: "match", icon: "🔗", labelKey: "startup.tab.match" }];
    const sub = ctx.sub || "resources";
    const head = `<div class="page-head"><h1>${t("startup.title")}</h1><p>${t("startup.intro")}</p></div>${YL.ui.tabs(TABS, sub, "#/startup")}`;

    if (sub === "resources") {
      const cats = [{ id: "all", label: { zh: "全部", en: "All" } }].concat(YL.store.terms("startupCategories"));
      let cat = "all";
      const draw = () => {
        const list = YL.store.get("resources").filter((r) => r.kind === "startup" && (cat === "all" || r.category === cat));
        root.innerHTML = head + `<p class="muted small">${t("startup.resourcesIntro")}</p>${chips(cats, cat, "cat")}
          <div class="grid grid-2">${list.map((r) => { const c = YL.store.user(r.contributorId); return `<div class="card">
            <div class="row row--between" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("startupCategories", r.category).label)}${r.verified ? `<span class="badge badge--green">✓ ${t("common.verified")}</span>` : `<span class="badge badge--warn">${t("common.unverified")}</span>`}</div>
            <div class="card__title">${esc(L(r.name))}</div><div class="card__body">${esc(L(r.summary))}</div>
            ${r.tips ? `<div class="callout callout--info" style="margin-top:10px">💡 ${esc(L(r.tips))}</div>` : ""}
            <div class="card__foot"><span class="row small muted">${c ? `${avatar(c.name, "xs")} ${esc(L(c.name))}` : ""}</span>${YL.ui.safeUrl(r.link) ? `<a class="btn btn--ghost btn--sm" href="${YL.ui.safeUrl(r.link)}" target="_blank" rel="noopener">${t("common.visit")} ↗</a>` : ""}</div></div>`; }).join("")}</div>
          <p class="notice">${t("startup.verifyNote")} <a href="${YL_CONFIG.github}/issues/new?template=content_contribution.yml" target="_blank" rel="noopener">${t("common.suggestEdit")}</a></p>`;
        $$("[data-cat]").forEach((b) => (b.onclick = () => { cat = b.dataset.cat; draw(); }));
      };
      draw(); return;
    }

    if (sub === "projects") {
      const draw = () => {
        const list = YL.store.get("projects");
        root.innerHTML = head + `<div class="row row--between" style="margin-bottom:12px"><p class="muted small" style="margin:0">${t("startup.projectsIntro")}</p><button class="btn btn--primary btn--sm" id="btn-new">＋ ${t("startup.postProject")}</button></div>
          <div class="grid grid-2">${list.map((p) => { const f = YL.store.user(p.founderId); const r = YL.store.region(p.region); const interested = YL.store.getState("interested", p.id); return `<div class="card">
            <div class="row row--between" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("stages", p.stage).label, "tag--accent")}<span class="muted small">${r.emoji} ${esc(L(r.name))}</span></div>
            <div class="card__title">${esc(L(p.name))}</div><div class="card__body">${esc(L(p.pitch))}</div>
            <div style="margin-top:10px"><span class="small muted">${t("startup.needs")}:</span> ${tags(p.needs.map((n) => YL.store.term("projectNeeds", n).label), "tag--green")}</div>
            <div class="card__foot"><span class="row small">${f ? `${avatar(f.name, "xs")} <strong>${esc(L(f.name))}</strong> · ${esc(L(f.title))}` : ""}</span><button class="btn btn--sm ${interested ? "is-on" : "btn--primary"}" data-int="${p.id}">${interested ? "✓ " + t("startup.interested") : t("startup.imInterested")}</button></div></div>`; }).join("")}</div>`;
        $$("[data-int]").forEach((b) => (b.onclick = () => { if (!requireLogin()) return; const on = YL.store.toggleState("interested", b.dataset.int); if (on) YL.ui.toast(t("startup.interestSent"), "success"); draw(); }));
        $("#btn-new").onclick = () => { if (!requireLogin()) return;
          YL.ui.modal(`<h2>${t("startup.postProject")}</h2><form id="f-proj">
            <div class="field"><label>${t("startup.projectName")}</label><input class="input" name="name" required></div>
            <div class="form-row"><div class="field"><label>${t("startup.stage")}</label><select class="select" name="stage">${YL.store.terms("stages").map((x) => `<option value="${x.id}">${esc(L(x.label))}</option>`).join("")}</select></div><div class="field"><label>${t("profile.region")}</label><select class="select" name="region">${YL.store.get("regions").map((r) => `<option value="${r.id}">${r.emoji} ${esc(L(r.name))}</option>`).join("")}</select></div></div>
            <div class="field"><label>${t("startup.pitch")}</label><textarea class="textarea" name="pitch" required></textarea></div>
            <div class="field"><label>${t("startup.needs")}</label><div class="checks">${YL.store.terms("projectNeeds").map((n) => `<label class="check"><input type="checkbox" name="needs" value="${n.id}"> ${esc(L(n.label))}</label>`).join("")}</div></div>
            <button class="btn btn--primary btn--block">${t("post.publish")}</button></form>`, { onMount(panel) { $("#f-proj", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.store.add("projects", { name: v.name, stage: v.stage, region: v.region, pitch: v.pitch, needs: [].concat(v.needs || []), founderId: "me", createdAt: new Date().toISOString().slice(0, 10) }); YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); draw(); }; } });
        };
      };
      draw(); return;
    }

    if (sub === "match") {
      const needs = YL.store.terms("projectNeeds");
      let mode = "offer", pick = needs[0].id;
      const draw = () => {
        const projects = YL.store.get("projects").filter((p) => p.needs.includes(pick));
        const people = YL.store.get("users").filter((u) => (u.skills || []).includes(pick));
        root.innerHTML = head + `<p class="muted small">${t("startup.matchIntro")}</p>
          <div class="grid grid-2" style="margin-bottom:20px">
            <button class="match-box ${mode === "offer" ? "is-active" : ""}" id="m-offer" style="text-align:left;cursor:pointer;font:inherit"><div style="font-size:1.4rem">🙋</div><div class="card__title">${t("startup.iOffer")}</div><div class="muted small">${t("startup.iOfferSub")}</div></button>
            <button class="match-box ${mode === "need" ? "is-active" : ""}" id="m-need" style="text-align:left;cursor:pointer;font:inherit"><div style="font-size:1.4rem">🔍</div><div class="card__title">${t("startup.iNeed")}</div><div class="muted small">${t("startup.iNeedSub")}</div></button>
          </div>
          ${chips(needs, pick, "pick")}
          ${mode === "offer"
            ? `${sectionTitle(t("startup.projectsNeed", { n: projects.length }))}<div class="grid grid-2">${projects.length ? projects.map((p) => { const f = YL.store.user(p.founderId); return `<div class="card"><div class="card__title">${esc(L(p.name))}</div><div class="card__body clamp-3">${esc(L(p.pitch))}</div><div class="card__foot"><span class="row small">${f ? `${avatar(f.name, "xs")} ${esc(L(f.name))}` : ""}</span><a class="btn btn--sm btn--primary" href="#/startup/projects">${t("common.view")}</a></div></div>`; }).join("") : YL.ui.emptyState("🧪", t("common.noResults"))}</div>`
            : `${sectionTitle(t("startup.peopleOffer", { n: people.length }))}<div class="grid grid-2">${people.length ? people.map((u) => `<a class="card card--hover" href="#/directory/u/${u.id}"><div class="person">${avatar(u.name)}<div><div class="person__name">${esc(L(u.name))}</div><div class="person__sub">${esc(L(u.title))}${u.company ? " · " + esc(L(u.company)) : ""}</div><div style="margin-top:6px">${tags((u.skills || []).map((s) => YL.store.term("projectNeeds", s).label), "tag--green")}</div></div></div></a>`).join("") : YL.ui.emptyState("🤝", t("common.noResults"))}</div>`}`;
        $("#m-offer").onclick = () => { mode = "offer"; draw(); };
        $("#m-need").onclick = () => { mode = "need"; draw(); };
        $$("[data-pick]").forEach((b) => (b.onclick = () => { pick = b.dataset.pick; draw(); }));
      };
      draw(); return;
    }
    YL.router.navigate("startup/resources");
  }
});
