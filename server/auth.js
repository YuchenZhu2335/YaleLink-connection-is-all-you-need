/* 注册登录与个人资料（需求见 docs/prd/yalelux-mvp.md）
   - 身份：耶鲁邮箱（@yale.edu / *.yale.edu / @aya.yale.edu）+ 6 位验证码，服务端校验白名单
   - 第一次必须通过耶鲁邮箱验证；之后验证码默认发到已验证的联系邮箱；每 365 天要用耶鲁邮箱重新验证一次
   - 换联系邮箱（已经填过之后）要求本次登录是通过耶鲁邮箱验证的；换了之后其他设备的登录全部失效
   - 管理员权限只给"本次通过耶鲁邮箱登录"的会话（见 app.js isAdmin）
   - 验证码：10 分钟有效、输错 5 次作废、60 秒内不能重发；同一邮箱每小时 5 封、同一 IP（IPv6 按 /64）每小时 20 次、全站每小时上限
   - 不泄露账号是否存在：发验证码的返回对任何邮箱都一样 */
const crypto = require("node:crypto");
const { fail, sha256 } = require("./http");

const CODE_TTL = 10 * 60000, RESEND_GAP = 60000, MAX_ATTEMPTS = 5, YALE_REVERIFY_DAYS = 365;
const PER_EMAIL_HOURLY = 5, PER_IP_HOURLY = 20, VERIFY_IP_HOURLY = 60, GLOBAL_HOURLY = 600;
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/; // 小写化之后再校验；不接受显示名、逗号、尖括号
const HOUR = 3600000;

// 限频用的 IP：IPv4-mapped 转回 IPv4；IPv6 只取前 64 位（一个家庭 / 一台 VPS 通常拥有整个 /64）
function ipKey(ip) {
  const s = String(ip || "");
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (m) return m[1];
  if (s.indexOf(":") < 0) return s;
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [], t = tail != null ? (tail ? tail.split(":") : []) : [];
  const full = tail != null ? h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill("0"), t) : h;
  return full.slice(0, 4).map((x) => x.toLowerCase()).join(":") + "::/64";
}

function install(app, ctx) {
  const C = ctx.coffee, db = ctx.db;
  // 内存限频（IP 维度）：key → 时间戳数组；每 1000 次调用清理一次过期的 key，防止无限增长
  const hits = new Map();
  let calls = 0;
  function limit(key, max, windowMs) {
    const now = Date.now();
    if (++calls % 1000 === 0 || hits.size > 50000) {
      for (const [k, arr] of hits) { const keep = arr.filter((t) => now - t < HOUR); if (keep.length) hits.set(k, keep); else hits.delete(k); }
      if (hits.size > 50000) hits.clear();
    }
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) throw fail("rate_limited", { reason: "too_many_requests" });
    arr.push(now); hits.set(key, arr);
  }
  const norm = (e) => String(e || "").trim().toLowerCase();
  const validEmail = (e) => e.length <= 254 && EMAIL_RE.test(e);
  const isYale = (email) => {
    if (!validEmail(email)) return false;
    const d = email.slice(email.lastIndexOf("@") + 1);
    return ctx.cfg.allowedDomains.some((a) => d === a || d.endsWith("." + a));
  };
  const mask = (e) => e.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + "*".repeat(Math.max(1, Math.min(b.length, 6))) + c);
  const hashCode = (code) => sha256(ctx.cfg.secret + ":" + code);
  const now = () => new Date().toISOString();
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const me = (req) => ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", req.user.id), req.session.via);

  // 发码前的检查（被拒绝的请求不消耗这个邮箱的额度）：60 秒间隔、每小时上限、全站上限
  // wantYale：上一封发到了联系邮箱、这次用户要求改发耶鲁邮箱时，不受 60 秒间隔限制（每小时上限照算）
  function checkQuota(purpose, userKey, wantYale) {
    const last = db.get("SELECT created_at, target FROM login_codes WHERE purpose = ? AND user_key = ? ORDER BY id DESC LIMIT 1", purpose, userKey);
    if (last && Date.now() - Date.parse(last.created_at) < RESEND_GAP && !(wantYale && last.target === "contact")) throw fail("rate_limited", { reason: "resend_too_soon" });
    if (db.get("SELECT COUNT(*) n FROM login_codes WHERE purpose = ? AND user_key = ? AND created_at > ?", purpose, userKey, ago(HOUR)).n >= PER_EMAIL_HOURLY) throw fail("rate_limited", { reason: "too_many_requests" });
    if (db.get("SELECT COUNT(*) n FROM login_codes WHERE created_at > ?", ago(HOUR)).n >= GLOBAL_HOURLY) {
      console.error("ALERT: login code global hourly ceiling reached");
      throw fail("rate_limited", { reason: "busy" });
    }
  }
  function issueCode(purpose, userKey, target, ip, wantYale) {
    checkQuota(purpose, userKey, wantYale);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    db.run("UPDATE login_codes SET used_at = ? WHERE purpose = ? AND user_key = ? AND used_at IS NULL", now(), purpose, userKey); // 旧码作废
    const r = db.run("INSERT INTO login_codes (purpose, user_key, target, code_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?)", purpose, userKey, target, hashCode(code), now(), new Date(Date.now() + CODE_TTL).toISOString(), ip || null);
    return { code, id: r.lastInsertRowid };
  }
  // 邮件没发出去：作废这个码（不占 60 秒间隔），告诉用户稍后重试
  async function mailCode(kind, user, issued, to) {
    const ok = await ctx.mailer.send(kind, user, { code: issued.code }, to);
    if (!ok) {
      db.run("DELETE FROM login_codes WHERE id = ?", issued.id);
      throw fail("internal", { reason: "mail_failed" });
    }
  }
  function checkCode(purpose, userKey, code) {
    const row = db.get("SELECT * FROM login_codes WHERE purpose = ? AND user_key = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1", purpose, userKey);
    if (!row || row.expires_at <= now()) throw fail("invalid", { fields: { code: "expired" } });
    if (row.attempts >= MAX_ATTEMPTS) throw fail("invalid", { fields: { code: "too_many_attempts" } });
    const ok = crypto.timingSafeEqual(Buffer.from(hashCode(String(code || "").trim().slice(0, 12))), Buffer.from(row.code_hash));
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
  // 让这个人别的设备上的登录全部失效（保留当前这个）
  const revokeOthers = (userId, keepId) => db.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", userId, keepId || "");

  app.route("POST", "/auth/request-code", async (req) => {
    const email = norm(req.body.email);
    if (!isYale(email)) throw fail("invalid", { fields: { email: "not_yale" } });
    limit("ip:" + ipKey(req.ip), PER_IP_HOURLY, HOUR);
    const user = db.get("SELECT * FROM users WHERE login_email = ?", email);
    const t = codeTarget(user, email, req.body.via === "yale" ? "yale" : undefined);
    const issued = issueCode("login", email, t.via, req.ip, req.body.via === "yale");
    await mailCode("login_code", user || { id: null, prefs: "{}" }, issued, t.to);
    return { sent: true }; // 不论邮箱是否注册过、发到了哪里，返回都一样
  }, { auth: "none", audit: false });

  app.route("POST", "/auth/verify", (req) => {
    const email = norm(req.body.email);
    if (!isYale(email)) throw fail("invalid", { fields: { email: "not_yale" } });
    limit("verify-ip:" + ipKey(req.ip), VERIFY_IP_HOURLY, HOUR);
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
  // 退出登录；{ all: true } = 所有设备都退出
  app.route("POST", "/auth/logout", (req) => {
    if (req.body.all === true) db.run("DELETE FROM sessions WHERE user_id = ?", req.user.id);
    req.endSession(req.req, req.res);
    return { ok: true };
  });

  app.route("POST", "/me/consent", (req) => {
    if (req.body.version !== ctx.cfg.consentVersion) throw fail("invalid", { fields: { consent: "version" } });
    db.run("UPDATE users SET consent_version = ?, consent_at = ?, updated_at = ? WHERE id = ?", req.body.version, now(), now(), req.user.id);
    return me(req);
  });

  app.route("POST", "/me/contact-email", async (req) => {
    const email = norm(req.body.email);
    if (!validEmail(email)) throw fail("invalid", { fields: { contactEmail: "invalid" } });
    const u = req.user;
    const changing = email !== u.contact_email;
    // 已经填过联系邮箱之后再换，必须是用耶鲁邮箱登录的（用联系邮箱登录的人不能把它换掉）
    if (u.contact_email && changing && req.session.via !== "yale") throw fail("forbidden", { reason: "reverify_yale" });
    if (!changing && u.contact_verified_at) return me(req);
    limit("contact:" + u.id, 5, HOUR);
    const issued = issueCode("contact", u.id, email, req.ip); // 先检查间隔与额度，再改资料
    db.tx(() => {
      db.run("UPDATE users SET contact_email = ?, contact_verified_at = NULL, updated_at = ? WHERE id = ?", email, now(), u.id);
      if (changing && u.contact_email) {
        revokeOthers(u.id, req.session.id);
        db.run("UPDATE login_codes SET used_at = ? WHERE purpose = 'login' AND user_key = ? AND target = 'contact' AND used_at IS NULL", now(), u.login_email);
      }
    });
    await mailCode("contact_code", u, issued, email);
    return Object.assign(me(req), { sentTo: mask(email) });
  });

  app.route("POST", "/me/contact-email/verify", (req) => {
    const u = req.user;
    const row = checkCode("contact", u.id, req.body.code);
    if (row.target !== u.contact_email) throw fail("conflict", { reason: "email_changed" });
    db.tx(() => {
      db.run("UPDATE users SET contact_verified_at = ?, updated_at = ? WHERE id = ?", now(), now(), u.id);
      revokeOthers(u.id, req.session.id);
    });
    return me(req);
  });

  app.route("GET", "/me", (req) => ctx.meDTO(req.user, req.session.via));

  app.route("POST", "/me/profile", (req) => {
    const year = Number(new Date().toISOString().slice(0, 4));
    const v = C.validateProfile(req.body, ctx.questions, year);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    const p = C.cleanProfile(req.body, ctx.questions);
    db.run("UPDATE users SET name = ?, identity = ?, stage = ?, grad_year = ?, job = ?, city = ?, contact_method = ?, answers = ?, profile_done_at = COALESCE(profile_done_at, ?), updated_at = ? WHERE id = ?",
      p.name, p.identity, p.stage, p.gradYear, p.job, p.city, p.contactMethod, JSON.stringify(p.answers), now(), now(), req.user.id);
    db.run("UPDATE recommendations SET created_at = '' WHERE user_id = ?", req.user.id); // 资料变了，推荐重新算
    return me(req);
  });

  app.route("POST", "/me/prefs", (req) => {
    const prefs = C.cleanPrefs(req.body.prefs || {});
    const smart = req.body.smartRec === false ? 0 : 1;
    db.run("UPDATE users SET prefs = ?, smart_rec = ?, updated_at = ? WHERE id = ?", JSON.stringify(prefs), smart, now(), req.user.id);
    // 开关智能推荐后，自己的推荐立即按新设置重算（保留"不感兴趣"）
    if (smart !== req.user.smart_rec) db.run("UPDATE recommendations SET created_at = '' WHERE user_id = ?", req.user.id);
    return me(req);
  });

  // 注销：删除本人的资料、参与记录、邀请、推荐、会话、验证码、发信记录；审计日志保留（只有 id）
  app.route("POST", "/me/delete", (req) => {
    if (req.body.confirm !== "DELETE") throw fail("invalid", { fields: { confirm: "required" } });
    const id = req.user.id, email = req.user.login_email;
    db.tx(() => {
      db.run("DELETE FROM participations WHERE user_id = ?", id);
      db.run("DELETE FROM invites WHERE from_id = ? OR to_id = ?", id, id);
      db.run("DELETE FROM recommendations WHERE user_id = ?", id);
      db.run("DELETE FROM sessions WHERE user_id = ?", id);
      db.run("DELETE FROM login_codes WHERE user_key IN (?, ?)", id, email);
      db.run("DELETE FROM emails WHERE user_id = ?", id);
      db.run("DELETE FROM feedback WHERE user_id = ?", id);
      db.run("DELETE FROM users WHERE id = ?", id);
    });
    req.endSession(req.req, req.res);
    return { deleted: true };
  });

  // 邮件里的退订链接（不需要登录，用签名校验）。GET 只显示确认按钮（邮件安全扫描器会自动打开链接）；
  // 真正退订用 POST：网页上的按钮，或邮箱客户端的一键退订（RFC 8058，List-Unsubscribe-Post）
  const KIND_LABEL = { invite_digest: "有人想认识你（每天汇总）/ People who want to meet you", reminder: "约定前一天提醒 / Day-before reminders", weekly: "每周一提醒 / Monday weekly note", event: "活动通知 / Event announcements" };
  function unsubTarget(q) {
    const u = String(q.u || ""), k = String(q.k || ""), s = String(q.s || "");
    const user = u.length <= 64 && db.get("SELECT * FROM users WHERE id = ?", u);
    if (!user || !ctx.mailer.verifyUnsubscribe(user.id, k, s)) throw fail("invalid");
    return { user, k, s };
  }
  app.route("GET", "/email/unsubscribe", (req) => {
    const t = unsubTarget(req.query);
    return { u: t.user.id, k: t.k, s: t.s };
  }, { auth: "none", audit: false, html: (d, h) => `<p>不再接收这类邮件：<strong>${h.escHtml(KIND_LABEL[d.k] || d.k)}</strong>？<br>Stop receiving these emails?</p>
    <form method="post" action="/api/email/unsubscribe?u=${encodeURIComponent(d.u)}&amp;k=${encodeURIComponent(d.k)}&amp;s=${encodeURIComponent(d.s)}"><button type="submit" style="font:inherit;padding:.6em 1.2em;border-radius:999px;border:0;background:#0B2545;color:#fff;cursor:pointer">确认退订 / Unsubscribe</button></form>` });
  app.route("POST", "/email/unsubscribe", (req) => {
    const t = unsubTarget(Object.assign({}, req.body, req.query));
    const prefs = Object.assign(ctx.json(t.user.prefs, {}), { [t.k]: false });
    db.run("UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?", JSON.stringify(C.cleanPrefs(prefs)), now(), t.user.id);
    req.setActor(t.user.id);
    return { unsubscribed: t.k };
  }, { auth: "none", form: true, html: () => "<p>已退订这类邮件，可以随时在网站「我的」里重新打开。<br>You've been unsubscribed. You can turn it back on under “Me” anytime.</p>" });
}

module.exports = { install, ipKey };
