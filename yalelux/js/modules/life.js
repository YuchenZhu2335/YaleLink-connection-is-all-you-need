/* 生活指南：衣食住行 × 地区，经验帖 */
registerModule({
  id: "life",
  nav: { icon: "🧭", labelKey: "nav.life", order: 50, mobile: false },
  descriptionKey: "about.module.life",
  render(root, ctx) {
    const { t, esc, L, $, $$, avatar, chips, sectionTitle } = YL.ui;
    const requireLogin = YL.auth.requireLogin;
    const cats = [{ id: "all", label: { zh: "全部", en: "All" }, emoji: "🗂️" }].concat(YL.store.terms("lifeCategories"));
    const regions = [{ id: "all", name: { zh: "全部地区", en: "All regions" }, emoji: "🌏" }].concat(YL.store.get("regions"));
    const me = YL.auth.isLoggedIn() && YL.auth.user().profile;
    let cat = ctx.query.cat || "all", region = ctx.query.region || "all", q = "";
    const draw = () => {
      const kw = q.trim().toLowerCase();
      const list = YL.store.get("resources").filter((r) => r.kind === "life" && (cat === "all" || r.category === cat) && (region === "all" || r.region === region || r.region === "all") && (!kw || JSON.stringify([r.name, r.summary, r.tips]).toLowerCase().includes(kw)));
      const posts = YL.store.get("posts").filter((p) => p.category === "life").slice(0, 4);
      root.innerHTML = `<div class="page-head"><div class="row row--between"><div><h1>${t("life.title")}</h1><p>${t("life.intro")}</p></div><button class="btn btn--primary" id="btn-new">＋ ${t("life.contribute")}</button></div></div>
        <div class="search"><input class="input" id="q" placeholder="${t("life.searchPh")}" value="${esc(q)}"></div>
        ${chips(cats.map((c) => ({ id: c.id, label: { zh: (c.emoji || "") + " " + L(c.label), en: (c.emoji || "") + " " + c.label.en } })), cat, "cat").replace('class="chips"', 'class="chips chips--scroll"')}
        ${chips(regions.map((r) => ({ id: r.id, label: { zh: r.emoji + " " + L(r.name), en: r.emoji + " " + r.name.en } })), region, "region").replace('class="chips"', 'class="chips chips--scroll"')}
        <div class="two-col"><div>
          <div class="stack">${list.length ? list.map((r) => { const c = YL.store.user(r.contributorId); const rg = YL.store.region(r.region); const helpful = YL.store.getState("helpful", r.id); return `<div class="card">
            <div class="row" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("lifeCategories", r.category).label)}<span class="muted small">${r.region === "all" ? "🌏 " + t("life.everywhere") : rg.emoji + " " + esc(L(rg.name))}</span><span class="spacer"></span>${r.verified ? `<span class="badge badge--green">✓ ${t("common.verified")}</span>` : ""}</div>
            <div class="card__title">${esc(L(r.name))}</div><div class="card__body">${esc(L(r.summary))}</div>
            ${r.tips ? `<div class="callout callout--info" style="margin-top:10px">💡 ${esc(L(r.tips))}</div>` : ""}
            <div class="card__foot"><span class="row small muted">${c ? `${avatar(c.name, "xs")} ${esc(L(c.name))}` : ""}</span><div class="row">${YL.ui.safeUrl(r.link) ? `<a class="btn btn--ghost btn--sm" href="${YL.ui.safeUrl(r.link)}" target="_blank" rel="noopener">${t("common.visit")} ↗</a>` : ""}<button class="icon-btn ${helpful ? "is-on" : ""}" data-help="${r.id}">👍 ${(r.helpful || 0) + (helpful ? 1 : 0)}</button></div></div></div>`; }).join("") : YL.ui.emptyState("🧭", t("common.noResults"))}</div>
        </div><div class="stack">
          <div class="card"><div class="card__title">${t("life.experience")}</div><p class="muted small">${t("life.experienceSub")}</p><div class="stack" style="margin-top:8px">${posts.map((p) => { const a = YL.store.user(p.authorId); return `<a class="list-row card--hover" href="#/careers/post/${p.id}" style="padding:10px 12px">${a ? avatar(a.name, "sm") : ""}<div class="list-row__main"><div class="list-row__title clamp-2 small">${esc(L(p.title))}</div><div class="list-row__sub">${a ? esc(L(a.name)) : ""} · 👍 ${p.likes}</div></div></a>`; }).join("")}</div></div>
          ${me && me.region && region === "all" ? `<div class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">📍 ${t("life.yourRegion", { region: esc(L(YL.store.region(me.region).name)) })}</div><button class="btn btn--ghost btn--sm" style="margin-top:8px" id="btn-myregion">${t("events.filterMine")}</button></div>` : ""}
        </div></div>`;
      $$("[data-cat]").forEach((b) => (b.onclick = () => { cat = b.dataset.cat; draw(); }));
      $$("[data-region]").forEach((b) => (b.onclick = () => { region = b.dataset.region; draw(); }));
      $$("[data-help]").forEach((b) => (b.onclick = () => { if (!requireLogin()) return; YL.store.toggleState("helpful", b.dataset.help); draw(); }));
      const mr = $("#btn-myregion"); if (mr) mr.onclick = () => { region = me.region; draw(); };
      const qi = $("#q"); qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
      $("#btn-new").onclick = () => { if (!requireLogin()) return;
        YL.ui.modal(`<h2>${t("life.contribute")}</h2><form id="f-life">
          <div class="field"><label>${t("life.itemName")}</label><input class="input" name="name" required placeholder="${t("life.itemNamePh")}"></div>
          <div class="form-row"><div class="field"><label>${t("life.category")}</label><select class="select" name="category">${YL.store.terms("lifeCategories").map((c) => `<option value="${c.id}">${c.emoji} ${esc(L(c.label))}</option>`).join("")}</select></div><div class="field"><label>${t("profile.region")}</label><select class="select" name="region"><option value="all">🌏 ${t("life.everywhere")}</option>${YL.store.get("regions").map((r) => `<option value="${r.id}" ${me && me.region === r.id ? "selected" : ""}>${r.emoji} ${esc(L(r.name))}</option>`).join("")}</select></div></div>
          <div class="field"><label>${t("life.summary")}</label><textarea class="textarea" name="summary" required></textarea></div>
          <div class="field"><label>${t("life.tip")}</label><input class="input" name="tips"></div>
          <div class="field"><label>${t("careers.link")}</label><input class="input" name="link" type="url" placeholder="https://"></div>
          <button class="btn btn--primary btn--block">${t("post.publish")}</button></form>`, { onMount(panel) { $("#f-life", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.store.add("resources", { kind: "life", category: v.category, region: v.region, name: v.name, summary: v.summary, tips: v.tips, link: v.link, verified: false, helpful: 0, contributorId: "me" }); YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); draw(); }; } });
      };
    };
    draw();
  }
});
