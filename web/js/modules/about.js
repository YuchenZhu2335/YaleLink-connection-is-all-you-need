/* 关于 & 共创：愿景、模块列表（自动）、路线图、参与方式 */
registerModule({
  id: "about",
  nav: { icon: "💙", labelKey: "nav.about", order: 90, mobile: false },
  descriptionKey: "about.module.about",
  render(root) {
    const { t, esc } = YL.ui;
    const mods = YL.registry.all().filter((m) => m.descriptionKey);
    const roadmap = ["v01", "v02", "v03", "v04"];
    root.innerHTML = `<section class="hero"><div class="hero__eyebrow">Open source · ${t("brand.prototype")}</div><h1>${t("about.title")}</h1><p>${t("about.intro")}</p>
      <div class="hero__actions"><a class="btn btn--primary" href="${YL_CONFIG.github}" target="_blank" rel="noopener">⭐ GitHub</a><a class="btn btn--ghost" href="${YL_CONFIG.github}/issues/new?template=feature_proposal.yml" target="_blank" rel="noopener">💡 ${t("about.propose")}</a></div></section>
      <div class="two-col"><div class="stack">
        <section class="card"><h2 style="margin-bottom:8px">${t("about.whyTitle")}</h2><div class="prose muted">${[1, 2, 3].map((i) => `<p>${t("about.why" + i)}</p>`).join("")}</div></section>
        <section class="card"><h2 style="margin-bottom:12px">${t("about.modulesTitle")}</h2><p class="muted small">${t("about.modulesSub")}</p><div class="module-list" style="margin-top:10px">${mods.map((m) => `<a class="list-row card--hover" href="#/${m.id}"><span class="ico">${m.nav ? m.nav.icon : "🔐"}</span><div class="list-row__main"><div class="list-row__title">${t(m.nav ? m.nav.labelKey : "nav.login")} <code class="small">js/modules/${m.id}.js</code></div><div class="list-row__sub">${t(m.descriptionKey)}</div></div></a>`).join("")}</div></section>
        <section class="card" id="api-contract"><h2 style="margin-bottom:8px">${t("about.apiTitle")}</h2><p class="muted small">${t("about.apiSub")}</p><div class="list" style="margin-top:10px">${YL.api.routes().filter((r) => !r.demo).map((r) => `<div class="list-row"><code>${esc(r.method)}</code><div class="list-row__main"><div class="list-row__title"><code>${esc(r.pattern)}</code></div><div class="list-row__sub">${esc(YL.ui.L(r.summary))}</div></div></div>`).join("")}</div></section>
        <section class="card"><h2 style="margin-bottom:12px">${t("about.howTitle")}</h2><ol class="prose muted" style="padding-left:20px">${[1, 2, 3, 4].map((i) => `<li style="margin-bottom:6px">${t("about.how" + i)}</li>`).join("")}</ol><a class="btn btn--ghost btn--sm" href="${YL_CONFIG.github}/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">📖 CONTRIBUTING.md</a></section>
      </div><div class="stack">
        <section class="card"><h2 style="margin-bottom:12px">${t("about.roadmapTitle")}</h2><ol class="timeline">${roadmap.map((v, i) => `<li class="${i === 0 ? "is-now" : ""}"><div class="timeline__when">${t("about.roadmap." + v + ".when")}</div><div class="timeline__title">${t("about.roadmap." + v + ".title")}</div><div class="timeline__detail">${t("about.roadmap." + v + ".detail")}</div></li>`).join("")}</ol></section>
        <section class="card card--primary"><div class="card__title">${t("about.trustTitle")}</div><div class="card__body">${t("about.trustBody", { domains: YL_CONFIG.allowedEmailDomains.map((d) => "@" + d).join(" / ") })}</div></section>
        <section class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">${t("about.disclaimer")}</div></section>
      </div></div>`;
  }
});
