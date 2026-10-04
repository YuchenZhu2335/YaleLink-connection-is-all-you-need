/* 鉴权（信任边界）— 静态原型版：邮箱域名白名单 + 演示验证码 + localStorage 会话
   Auth (the trust boundary) — prototype edition: domain allowlist + demo code + localStorage session.
   真实后端只需替换 requestCode / verify 两个函数为 API 调用。 */
window.YL = window.YL || {};
YL.auth = (function () {
  const KEY = "yl.session";
  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY)); } catch (e) { session = null; }

  function normalize(email) { return String(email || "").trim().toLowerCase(); }
  function domainOf(email) { const i = email.lastIndexOf("@"); return i < 0 ? "" : email.slice(i + 1); }
  function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
  function isAllowedEmail(email) {
    email = normalize(email);
    if (!isValidEmail(email)) return false;
    const d = domainOf(email);
    return YL_CONFIG.allowedEmailDomains.some((allowed) =>
      d === allowed || (YL_CONFIG.allowSubdomains && d.endsWith("." + allowed)));
  }
  function kindOf(email) {
    const d = domainOf(normalize(email));
    if (d === "aya.yale.edu") return "alumni";
    return "student";
  }
  function save() { if (session) localStorage.setItem(KEY, JSON.stringify(session)); else localStorage.removeItem(KEY); }

  // 演示版：立刻返回成功，真实版应调用后端发送邮件
  async function requestCode(email) {
    email = normalize(email);
    if (!isAllowedEmail(email)) return { ok: false, reason: "domain" };
    return { ok: true, email, hint: YL_CONFIG.demoVerificationCode };
  }
  async function verify(email, code) {
    email = normalize(email);
    if (!isAllowedEmail(email)) return { ok: false, reason: "domain" };
    if (String(code).trim() !== YL_CONFIG.demoVerificationCode) return { ok: false, reason: "code" };
    session = { email, kind: kindOf(email), profile: null, createdAt: new Date().toISOString() };
    save();
    window.dispatchEvent(new CustomEvent("yl:authchange"));
    return { ok: true };
  }
  function completeProfile(profile) {
    if (!session) return false;
    session.profile = Object.assign({}, session.profile || {}, profile);
    save();
    window.dispatchEvent(new CustomEvent("yl:authchange"));
    return true;
  }
  function logout() { session = null; save(); window.dispatchEvent(new CustomEvent("yl:authchange")); }
  function isLoggedIn() { return !!session; }
  function needsProfile() { return !!session && !session.profile; }
  function user() { return session; }
  // 学联身份：profile.acssyRole = "" | "member" | "lead"
  function acssyRole() { return (session && session.profile && session.profile.acssyRole) || ""; }
  function isAcssy() { return !!acssyRole(); }
  function isAcssyLead() { return acssyRole() === "lead"; }
  function displayName() {
    if (!session) return "";
    if (session.profile && session.profile.name) return session.profile.name;
    return session.email.split("@")[0];
  }
  // 需要登录的操作入口：未登录时提示并跳到登录页，登录后回到当前页。返回 true 表示可以继续。
  // Gate for actions that need a session; redirects to login and comes back afterwards.
  function requireLogin() {
    if (isLoggedIn()) return true;
    YL.ui.toast(YL.ui.t("common.loginFirst"), "error");
    YL.router.navigate("login?next=" + encodeURIComponent(location.hash.slice(2)));
    return false;
  }
  return { isAllowedEmail, isValidEmail, requestCode, verify, completeProfile, logout, isLoggedIn, needsProfile, user, displayName, kindOf, acssyRole, isAcssy, isAcssyLead, requireLogin };
})();
