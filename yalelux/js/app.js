/* 启动：词典 → 登录状态（GET /auth/me、/meta）→ 外壳（顶栏、手机底部标签栏、页脚）→ 路由 */
(async function () {
  const { t, esc, icon, avatar } = YL.ui;
  const $ = (id) => document.getElementById(id);

  function navLink(n, cls) {
    const count = n.badge ? YL.registry.badge(n.badge) : 0;
    return `<a class="${cls}" data-nav-path="${esc(n.path)}" href="#/${esc(n.path)}">${icon(n.icon)}<span class="${cls}__label">${esc(t(n.labelKey))}</span>${n.badge ? `<span class="count" data-badge="${esc(n.badge)}"${count ? "" : " hidden"}>${count}</span>` : ""}</a>`;
  }

  function renderShell() {
    const me = YL.auth.user();
    const lang = YL.i18n.getLang();
    const all = YL.registry.navItems();
    const mobile = YL.registry.navItems({ mobile: true });
    // 电脑顶部导航：准备好之后只放约咖啡的几个入口（"我的 / 活动 / 管理"在头像菜单里）；没登录时放公开页面（活动）
    const ready = !!(me && me.ready);
    const items = ready ? mobile.filter((n) => n.path !== "profile") : all.filter((n) => !n.mobile);

    $("topbar").innerHTML = `
      <div class="topbar__inner">
        <a class="brand" href="#/${me && me.ready ? "coffee" : "home"}" aria-label="${esc(YL_CONFIG.siteName)}">
          <img class="brand__mark" src="assets/logo.svg" alt="" width="28" height="28">
          <span class="wordmark brand__word" aria-hidden="true">yale<i>lux</i></span>
        </a>
        <nav class="topnav" aria-label="${esc(t("nav.primary"))}">${items.map((n) => navLink(n, "topnav__item")).join("")}</nav>
        <div class="topbar__actions">
          <button type="button" class="lang-toggle" id="lang-toggle" lang="${lang === "zh" ? "en" : "zh-CN"}" aria-label="${esc(lang === "zh" ? "Switch to English" : "切换到中文")}">${lang === "zh" ? "EN" : "中文"}</button>
          ${me ? `<details class="menu" id="me-menu">
              <summary class="topbar__me" aria-label="${esc(t("nav.me"))}">${avatar(YL.auth.displayName(), "sm")}<span class="topbar__name">${esc(YL.auth.displayName())}</span>${icon("chevronDown", { size: 16 })}</summary>
              <div class="menu__panel">
                <a class="menu__item" href="#/profile">${icon("user")}${esc(t("nav.me"))}</a>
                <a class="menu__item" href="#/events">${icon("flag")}${esc(t("nav.events"))}</a>
                ${YL.auth.isAdmin() ? `<a class="menu__item" href="#/admin">${icon("chart")}${esc(t("nav.admin"))}</a>` : ""}
                <a class="menu__item" href="#/about/feedback">${icon("message")}${esc(t("nav.feedback"))}</a>
                <button type="button" class="menu__item" id="menu-logout">${icon("logout")}${esc(t("nav.logout"))}</button>
              </div>
            </details>`
            : `<a class="btn btn--primary btn--sm topbar__login" href="#/login">${esc(t("nav.login"))}</a>`}
        </div>
      </div>`;
    $("lang-toggle").onclick = () => YL.i18n.toggle();
    if ($("menu-logout")) $("menu-logout").onclick = async () => {
      const r = await YL.auth.logout();
      if (!r.ok && r.status !== 401) { YL.ui.toast(YL.ui.errorText(r.error), "error"); return; }
      YL.router.navigate("home");
    };

    $("tabbar").innerHTML = mobile.map((n) => navLink(n, "tabbar__item")).join("");
    $("tabbar").hidden = !mobile.length;
    document.body.classList.toggle("has-tabbar", mobile.length > 0);

    $("footer").innerHTML = `
      <div class="footer__inner">
        <div class="footer__brand"><span class="wordmark" aria-label="Yalelux">yale<i>lux</i></span><span>${esc(t("brand.tagline"))}</span>${lang === "zh" ? `<span class="faint" lang="en">Where Yale's light connects resources and ideas</span>` : ""}</div>
        <nav class="footer__links" aria-label="${esc(t("nav.footer"))}">
          <a href="#/events">${esc(t("nav.events"))}</a>
          <a href="#/about">${esc(t("nav.about"))}</a>
          <a href="#/about/privacy">${esc(t("nav.privacy"))}</a>
          <a href="#/about/feedback">${esc(t("nav.feedback"))}</a>
          <a href="${YL.ui.safeUrl(YL_CONFIG.github)}" target="_blank" rel="noopener">GitHub</a>
        </nav>
        <p class="footer__note">${esc(t("brand.unofficial"))} · ${esc(t("brand.openSource"))}</p>
      </div>`;
    markActive();
  }

  function markActive() {
    const ctx = YL.router.currentCtx();
    const active = ctx ? YL.registry.activeNav(ctx.path || ctx.module) : null;
    YL.ui.$$("[data-nav-path]").forEach((a) => {
      const on = !!active && a.dataset.navPath === active.path;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  function updateBadges() {
    YL.ui.$$("[data-badge]").forEach((el) => {
      const n = YL.registry.badge(el.dataset.badge);
      el.textContent = n > 99 ? "99+" : String(n);
      el.hidden = !n;
    });
  }
  // 模块可以提供 badges()：登录后拉一次角标（例如收件箱数量），不用等用户点进去
  function refreshBadges() {
    if (!YL.auth.isReady()) return;
    YL.registry.all().forEach((m) => { if (typeof m.badges === "function") Promise.resolve(m.badges()).catch(() => {}); });
  }

  try {
    await YL.i18n.load();
  } catch (e) {
    $("main").innerHTML = `<div class="empty"><p>Failed to load. Please run <code>npm start</code> and open the address it prints.</p></div>`;
    return;
  }
  const booted = await YL.auth.boot();
  if (!booted.ok && booted.error && booted.error.code === "network") {
    $("main").innerHTML = YL.ui.emptyState("globe", t("api.err.network"), `<button type="button" class="btn btn--primary" id="retry">${esc(t("common.retry"))}</button>`);
    $("retry").onclick = () => location.reload();
    return;
  }
  document.title = `${YL_CONFIG.siteName} · ${t("brand.tagline")}`;
  renderShell();
  window.addEventListener("yl:route", (e) => {
    document.body.dataset.route = e.detail.module; // 登录页不显示右上角的"登录"按钮等
    const menu = $("me-menu"); if (menu) menu.open = false;
    setTimeout(markActive);
  });
  document.addEventListener("click", (e) => { const menu = $("me-menu"); if (menu && menu.open && !menu.contains(e.target)) menu.open = false; });
  YL.router.start();
  markActive();
  refreshBadges();
  window.addEventListener("yl:badges", updateBadges);
  window.addEventListener("yl:langchange", () => { document.title = `${YL_CONFIG.siteName} · ${t("brand.tagline")}`; renderShell(); YL.router.render(); });
  window.addEventListener("yl:authchange", () => { renderShell(); refreshBadges(); });
  document.getElementById("app").classList.add("is-ready");
})();
