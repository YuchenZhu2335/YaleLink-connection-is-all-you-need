/* Hash 路由：#/coffee/browse?goal=share → module "coffee", sub "browse", query { goal: "share" }
   Hash router — no server rewrite rules needed.

   进入模块前的三道门（顺序固定）：
     requiresAuth  没登录 → #/login?next=…
     requiresReady 登录了但还没完成首次填写 → #/profile/setup?next=…
     adminOnly     不是管理员 → 显示"没有权限"（后端同样会拒绝） */
window.YL = window.YL || {};
YL.router = (function () {
  let current = null;
  function parse(hash) {
    let raw = (hash == null ? location.hash : hash).replace(/^#\/?/, "");
    const query = {};
    const qi = raw.indexOf("?");
    if (qi >= 0) {
      new URLSearchParams(raw.slice(qi + 1)).forEach((v, k) => (query[k] = v));
      raw = raw.slice(0, qi);
    }
    const segments = raw.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    return { path: segments.join("/"), segments, module: segments[0] || "home", sub: segments[1] || "", id: segments[2] || "", query };
  }
  function navigate(path, opts) {
    const target = "#/" + String(path).replace(/^#?\/?/, "");
    if (opts && opts.replace) { history.replaceState(null, "", target); render(); return; }
    if (location.hash === target) render(); else location.hash = target;
  }
  // 登录 / 填完资料后回到原来要去的页面（只接受站内路径）
  function safeNext(next, fallback) {
    const n = String(next || "");
    return /^[a-z][a-z0-9/_-]*(\?[^#]*)?$/i.test(n) && !/^login/.test(n) ? n : fallback || "coffee";
  }
  function render() {
    const ctx = parse();
    const root = document.getElementById("main");
    const mod = YL.registry.get(ctx.module);
    const here = encodeURIComponent(ctx.path + (location.hash.indexOf("?") >= 0 ? location.hash.slice(location.hash.indexOf("?")) : ""));
    if (!mod) {
      current = ctx;
      root.innerHTML = YL.ui.emptyState("info", YL.i18n.t("router.notFound"), `<a class="btn btn--primary" href="#/home">${YL.ui.esc(YL.i18n.t("router.goHome"))}</a>`);
      return;
    }
    if (mod.requiresAuth && !YL.auth.isLoggedIn()) return navigate("login?next=" + here, { replace: true });
    if (mod.requiresReady && !YL.auth.isReady()) return navigate("profile/setup?next=" + here, { replace: true });
    if (mod.adminOnly && !YL.auth.isAdmin()) {
      current = ctx;
      root.innerHTML = YL.ui.emptyState("lock", YL.i18n.t("router.forbidden"), `<a class="btn btn--primary" href="#/home">${YL.ui.esc(YL.i18n.t("router.goHome"))}</a>`);
      return;
    }
    current = ctx;
    // 异步渲染（await YL.api.*）之后先检查 ctx.isActive()：用户可能已经切到别的页面
    // Async renders must check ctx.isActive() after each await — the user may have navigated away.
    ctx.isActive = () => current === ctx;
    YL.ui.closeModal(); // 换页时关掉上一页留下的弹窗
    root.innerHTML = "";
    window.scrollTo({ top: 0 });
    window.dispatchEvent(new CustomEvent("yl:route", { detail: ctx }));
    const fail = (e) => { console.error(e); if (ctx.isActive()) root.innerHTML = YL.ui.emptyState("info", YL.i18n.t("router.error")); };
    try {
      const pending = mod.render(root, ctx);
      if (pending && typeof pending.then === "function") pending.catch(fail);
    } catch (e) { fail(e); }
  }
  function start() { window.addEventListener("hashchange", render); render(); }
  function currentCtx() { return current; }
  return { parse, navigate, safeNext, render, start, currentCtx };
})();
