/* 登录状态（信任边界在后端：server/auth.js）。前端只保存"后端说我是谁"，不保存任何凭证。
   Session state mirrored from the backend; the trust boundary lives in server/auth.js.

   登录流程：耶鲁邮箱 → 验证码 → 同意隐私说明 → 联系邮箱 → 资料问卷 → 可以使用约咖啡
     YL.auth.nextStep() 返回还差的那一步（"consent" | "contact" | "profile" | null），
     路由在进入 requiresReady 的模块前会把人带到 #/me/setup 补完。

   boot()    启动时调一次：GET /auth/me + GET /meta（问卷题目、隐私说明版本等公开信息）
   user()    后端返回的本人资料（含 ready / isAdmin / needs*），未登录为 null
   set(u)    接口返回了新的本人资料时调用（资料、联系邮箱、偏好更新后），会广播 yl:authchange */
window.YL = window.YL || {};
YL.auth = (function () {
  let me = null;
  let meta = { consentVersion: "", dev: false, smartRecAvailable: false, questions: [] };

  function set(user) {
    const before = JSON.stringify(me);
    me = user || null;
    if (JSON.stringify(me) !== before) window.dispatchEvent(new CustomEvent("yl:authchange"));
    return me;
  }
  async function boot() {
    const [u, m] = await Promise.all([YL.api.get("/auth/me"), YL.api.get("/meta")]);
    if (m.ok) meta = m.data;
    me = u.ok ? u.data.user : null;
    return { ok: u.ok && m.ok, error: (!u.ok && u.error) || (!m.ok && m.error) || null };
  }
  async function refresh() {
    const r = await YL.api.get("/auth/me");
    if (r.ok) set(r.data.user);
    return me;
  }

  // 发验证码：via = "yale" 时强制发到耶鲁邮箱（默认老用户发到已验证的联系邮箱）
  const requestCode = (email, via) => YL.api.post("/auth/request-code", { email: String(email || "").trim(), via: via || undefined });
  async function verify(email, code) {
    const r = await YL.api.post("/auth/verify", { email: String(email || "").trim(), code: String(code || "").trim() });
    if (r.ok) set(r.data.user);
    return r;
  }
  async function logout() {
    const r = await YL.api.post("/auth/logout");
    set(null);
    return r;
  }

  const user = () => me;
  const isLoggedIn = () => !!me;
  const isReady = () => !!me && !!me.ready;
  const isAdmin = () => !!me && !!me.isAdmin;
  const getMeta = () => meta;
  const questions = () => meta.questions || [];
  function nextStep() {
    if (!me) return "login";
    if (me.needsConsent) return "consent";
    if (me.needsContact) return "contact";
    if (me.needsProfile) return "profile";
    return null;
  }
  function displayName() {
    if (!me) return "";
    return me.name || String(me.loginEmail || "").split("@")[0];
  }
  // 需要登录的操作入口：未登录时提示并跳到登录页，登录后回到当前页。返回 true 表示可以继续。
  function requireLogin() {
    if (isLoggedIn()) return true;
    YL.ui.toast(YL.ui.t("common.loginFirst"), "error");
    YL.router.navigate("login?next=" + encodeURIComponent(location.hash.replace(/^#\/?/, "")));
    return false;
  }

  // 会话在后端过期或被注销：清掉本地状态，由路由决定去哪
  window.addEventListener("yl:unauthorized", () => { if (me) { set(null); YL.router.render(); } });

  return { boot, refresh, set, requestCode, verify, logout, user, isLoggedIn, isReady, isAdmin, meta: getMeta, questions, nextStep, displayName, requireLogin };
})();
