/* 注册登录与个人资料（规则见 docs/prd/coffee-chat-launch.md §3.1）
   - 身份：耶鲁邮箱（@yale.edu / *.yale.edu / @aya.yale.edu）+ 6 位验证码，服务端校验白名单
   - 第一次必须通过耶鲁邮箱验证；之后验证码可发到已验证的联系邮箱；每 365 天要用耶鲁邮箱重新验证一次
   - 更换已验证的联系邮箱，要求本次登录是通过耶鲁邮箱验证的
   - 验证码：10 分钟有效、输错 5 次作废、60 秒内不能重发；同一邮箱每小时 5 封、同一 IP 每小时 20 次 */
const crypto = require("node:crypto");
const { fail, sha256 } = require("./http");

const CODE_TTL = 10 * 60000, RESEND_GAP = 60000, MAX_ATTEMPTS = 5, YALE_REVERIFY_DAYS = 365;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function install(app, ctx) {
  const C = ctx.coffee, db = ctx.db;
  const hits = new Map(); // 内存限频：key → 时间戳数组
  function limit(key, max, windowMs) {
    const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) throw fail("rate_limited", { reason: "too_many_requests" });
    arr.push(now); hits.set(key, arr);
  }
  const norm = (e) => String(e || "").trim().toLowerCase();
  const isYale = (email) => {
    if (!EMAIL_RE.test(email)) return false;
    const d = email.slice(email.lastIndexOf("@") + 1);
    return ctx.cfg.allowedDomains.some((a) => d === a || d.endsWith("." + a));
  };
  const mask = (e) => e.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + "*".repeat(Math.min(b.length, 6)) + c);
  const hashCode = (code) => sha256(ctx.cfg.secret + ":" + code);
  const now = () => new Date().toISOString();

  function issueCode(purpose, userKey, target, ip) {
    const last = db.get("SELECT created_at FROM login_codes WHERE purpose = ? AND user_key = ? ORDER BY id DESC LIMIT 1", purpose, userKey);
    if (last && Date.now() - Date.parse(last.created_at) < RESEND_GAP) throw fail("rate_limited", { reason: "resend_too_soon" });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    db.run("UPDATE login_codes SET used_at = ? WHERE purpose = ? AND user_key = ? AND used_at IS NULL", now(), purpose, userKey); // 旧码作废
    db.run("INSERT INTO login_codes (purpose, user_key, target, code_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?)", purpose, userKey, target, hashCode(code), now(), new Date(Date.now() + CODE_TTL).toISOString(), ip || null);
    return code;
  }
  function checkCode(purpose, userKey, code) {
    const row = db.get("SELECT * FROM login_codes WHERE purpose = ? AND user_key = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1", purpose, userKey);
    if (!row || row.expires_at <= now()) throw fail("invalid", { fields: { code: "expired" } });
    if (row.attempts >= MAX_ATTEMPTS) throw fail("invalid", { fields: { code: "too_many_attempts" } });
    const ok = crypto.timingSafeEqual(Buffer.from(hashCode(String(code || "").trim())), Buffer.from(row.code_hash));
    if (!ok) {
      db.run("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
      throw fail("invalid", { fields: { code: row.attempts + 1 >= MAX_ATTEMPTS ? "too_many_attempts" : "wrong" } });
    }
    db.run("UPDATE login_codes SET used_at = ? WHERE id = ?", now(), row.id);
    return row;
  }
  // 验证码发到哪里：老用户、联系邮箱已验证、一年内验证过耶鲁邮箱 → 联系邮箱（除非用户指定发耶鲁邮箱）
  function codeTarget(user, email, via) {
    const yaleFresh = user && Date.now() - Date.parse(user.yale_verified_at) < YALE_REVERIFY_DAYS * 86400000;
    if (user && via !== "yale" && yaleFresh && user.contact_email && user.contact_verified_at) return { to: user.contact_email, via: "contact" };
    return { to: email, via: "yale" };
  }

  app.route("POST", "/auth/request-code", async (req) => {
    const email = norm(req.body.email);
    if (!isYale(email)) throw fail("invalid", { fields: { email: "not_yale" } });
    limit("ip:" + req.ip, 20, 3600000);
    limit("email:" + email, 5, 3600000);
    const user = db.get("SELECT * FROM users WHERE login_email = ?", email);
    const t = codeTarget(user, email, req.body.via);
    const code = issueCode("login", email, t.via, req.ip);
    await ctx.mailer.send("login_code", user || { id: null, prefs: "{}" }, { code }, t.to);
    return { sentTo: mask(t.to), via: t.via, canUseYale: t.via === "contact" };
  }, { auth: "none", audit: false });

  app.route("POST", "/auth/verify", (req) => {
    const email = norm(req.body.email);
    if (!isYale(email)) throw fail("invalid", { fields: { email: "not_yale" } });
    limit("verify-ip:" + req.ip, 60, 3600000);
    const row = checkCode("login", email, req.body.code);
    const via = row.target === "contact" ? "contact" : "yale";
    let user = db.get("SELECT * FROM users WHERE login_email = ?", email);
    if (!user) {
      if (via !== "yale") throw fail("forbidden");
      db.run("INSERT INTO users (id, login_email, yale_verified_at, prefs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "u-" + crypto.randomBytes(8).toString("hex"), email, now(), JSON.stringify(C.cleanPrefs({})), now(), now());
      user = db.get("SELECT * FROM users WHERE login_email = ?", email);
    } else if (via === "yale") {
      db.run("UPDATE users SET yale_verified_at = ?, updated_at = ? WHERE id = ?", now(), now(), user.id);
    }
    req.startSession(req.res, user.id, via);
    req.setActor(user.id);
    return { user: ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", user.id), via) };
  }, { auth: "none" });

  app.route("GET", "/auth/me", (req) => ({ user: req.user ? ctx.meDTO(req.user, req.session.via) : null }), { auth: "none" });
  app.route("POST", "/auth/logout", (req) => { req.endSession(req.req, req.res); return { ok: true }; });

  app.route("POST", "/me/consent", (req) => {
    if (req.body.version !== ctx.cfg.consentVersion) throw fail("invalid", { fields: { consent: "version" } });
    db.run("UPDATE users SET consent_version = ?, consent_at = ?, updated_at = ? WHERE id = ?", req.body.version, now(), now(), req.user.id);
    return ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", req.user.id), req.session.via);
  });

  app.route("POST", "/me/contact-email", async (req) => {
    const email = norm(req.body.email);
    if (!EMAIL_RE.test(email) || email.length > 120) throw fail("invalid", { fields: { contactEmail: "invalid" } });
    const u = req.user;
    if (u.contact_verified_at && email !== u.contact_email && req.session.via !== "yale") throw fail("forbidden", { reason: "reverify_yale" });
    limit("contact:" + u.id, 5, 3600000);
    db.run("UPDATE users SET contact_email = ?, contact_verified_at = ?, updated_at = ? WHERE id = ?", email, email === u.contact_email ? u.contact_verified_at : null, now(), u.id);
    if (email === u.contact_email && u.contact_verified_at) return ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", u.id), req.session.via);
    const code = issueCode("contact", u.id, email, req.ip);
    await ctx.mailer.send("contact_code", u, { code }, email);
    return Object.assign(ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", u.id), req.session.via), { sentTo: mask(email) });
  });

  app.route("POST", "/me/contact-email/verify", (req) => {
    const u = req.user;
    const row = checkCode("contact", u.id, req.body.code);
    if (row.target !== u.contact_email) throw fail("conflict", { reason: "email_changed" });
    db.run("UPDATE users SET contact_verified_at = ?, updated_at = ? WHERE id = ?", now(), now(), u.id);
    return ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", u.id), req.session.via);
  });

  app.route("GET", "/me", (req) => ctx.meDTO(req.user, req.session.via));

  app.route("POST", "/me/profile", (req) => {
    const year = Number(new Date().toISOString().slice(0, 4));
    const v = C.validateProfile(req.body, ctx.questions, year);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    const p = C.cleanProfile(req.body, ctx.questions);
    db.run("UPDATE users SET name = ?, identity = ?, stage = ?, grad_year = ?, job = ?, city = ?, contact_method = ?, answers = ?, profile_done_at = COALESCE(profile_done_at, ?), updated_at = ? WHERE id = ?",
      p.name, p.identity, p.stage, p.gradYear, p.job, p.city, p.contactMethod, JSON.stringify(p.answers), now(), now(), req.user.id);
    return ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", req.user.id), req.session.via);
  });

  app.route("POST", "/me/prefs", (req) => {
    const prefs = C.cleanPrefs(req.body.prefs || {});
    db.run("UPDATE users SET prefs = ?, smart_rec = ?, updated_at = ? WHERE id = ?", JSON.stringify(prefs), req.body.smartRec === false ? 0 : 1, now(), req.user.id);
    return ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", req.user.id), req.session.via);
  });

  // 注销：删除本人的资料、参与记录、邀请与推荐；审计日志保留（只有 id）
  app.route("POST", "/me/delete", (req) => {
    if (req.body.confirm !== "DELETE") throw fail("invalid", { fields: { confirm: "required" } });
    const id = req.user.id;
    db.tx(() => {
      db.run("DELETE FROM participations WHERE user_id = ?", id);
      db.run("DELETE FROM invites WHERE from_id = ? OR to_id = ?", id, id);
      db.run("DELETE FROM recommendations WHERE user_id = ?", id);
      db.run("DELETE FROM sessions WHERE user_id = ?", id);
      db.run("DELETE FROM login_codes WHERE user_key = ?", id);
      db.run("DELETE FROM users WHERE id = ?", id);
    });
    req.endSession(req.req, req.res);
    return { deleted: true };
  });

  // 邮件里的退订链接（不需要登录，用签名校验）
  app.route("GET", "/email/unsubscribe", (req) => {
    const { u, k, s } = req.query;
    const user = db.get("SELECT * FROM users WHERE id = ?", String(u || ""));
    if (!user || !ctx.mailer.verifyUnsubscribe(user.id, k, s)) throw fail("invalid");
    const prefs = Object.assign(ctx.json(user.prefs, {}), { [k]: false });
    db.run("UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?", JSON.stringify(C.cleanPrefs(prefs)), now(), user.id);
    return { unsubscribed: k };
  }, { auth: "none", audit: true, html: () => "已退订这类邮件，可以随时在网站「我的」里重新打开。<br>You've been unsubscribed. You can turn it back on under “Me” anytime." });
}

module.exports = { install };
