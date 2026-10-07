/* HTTP 层：极简路由 + 静态文件 + 会话 + 统一返回格式 + 审计。零依赖。
   返回格式与前端 YL.api 一致：{ ok: true, data } | { ok: false, error: { code, reason?, fields? } }
   原则：任何畸形输入（坏的 % 转义、坏 Cookie、超大请求体、非对象 JSON）都只影响这一个请求，绝不能让进程退出。 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STATUS = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, too_large: 413, rate_limited: 429, internal: 500 };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const PARAM = /^[A-Za-z0-9_-]{1,64}$/; // 路径里的 id / 动作：只收这些字符，挡住超长或奇怪的输入
const MAX_BODY = 100 * 1024;
const SESSION_DAYS = 30;

// 不走 JSON 信封的响应（如下载简历）：处理函数返回 reply(buffer, headers)，headers 覆盖默认的安全头
class RawReply { constructor(body, headers) { this.body = body; this.headers = headers || {}; } }
const reply = (body, headers) => new RawReply(body, headers);

class ApiError extends Error {
  constructor(code, extra) { super(code); this.code = STATUS[code] ? code : "internal"; this.extra = extra || null; }
}
const fail = (code, extra) => new ApiError(code, extra);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return null; } };
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function createApp(ctx) {
  const routes = [];
  const https = ctx.cfg.publicUrl.startsWith("https://");
  // https 下用 __Host- 前缀：浏览器保证它只能由本站、以 Secure、Path=/、不带 Domain 的方式设置（防兄弟子域名种 Cookie）
  const COOKIE = https ? "__Host-yl_sid" : "yl_sid";
  const SECURITY_HEADERS = Object.assign({}, BASE_HEADERS, https ? { "Strict-Transport-Security": "max-age=31536000" } : {});

  // 真实 IP：只有开启 TRUST_PROXY 且请求来自本机代理时，才采信 X-Forwarded-For 的最后一跳
  function clientIp(req) {
    const direct = req.socket.remoteAddress || "";
    if (!ctx.cfg.trustProxy || !LOOPBACK.test(direct)) return direct;
    const hops = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    return hops.length ? hops[hops.length - 1] : direct;
  }
  // meta: { auth, audit, html(data) 返回网页, form: 允许表单提交（只用于签名链接）, localOnly: 只允许本机访问,
  //         raw: { type, max, field, badType }：请求体就是一个文件（如简历 PDF）——只收这一种 Content-Type、单独的大小上限，
  //              处理函数拿到的 body 是 Buffer；类型不对 → invalid + fields[field] = badType，超过上限 → too_large + fields[field] = "too_large" }
  // auth: "user"（默认，登录即可）| "none" | "consented"（还要同意当前版本的隐私说明：会写入个人信息的接口）
  //       | "ready"（还要填好联系邮箱和资料：约咖啡）| "admin"
  function route(method, pattern, handler, meta) {
    const keys = [];
    const re = new RegExp("^" + pattern.split("/").map((seg) => (seg[0] === ":" ? (keys.push(seg.slice(1)), "([^/]+)") : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "/?$");
    routes.push(Object.assign({ auth: "user", audit: method !== "GET" }, meta, { method, pattern, handler, re, keys }));
  }

  /* ---------- 会话 ---------- */
  // 解析 Cookie：解不开的跳过；会话 Cookie 出现两次（有人从别处种了一个）就当没有会话
  function sessionToken(req) {
    const found = [];
    String(req.headers.cookie || "").split(";").forEach((p) => {
      const i = p.indexOf("=");
      if (i > 0 && p.slice(0, i).trim() === COOKIE) { const v = safeDecode(p.slice(i + 1).trim()); if (v) found.push(v); }
    });
    return found.length === 1 ? found[0] : null;
  }
  function sessionFrom(req) {
    const token = sessionToken(req);
    if (!token || token.length > 100) return null;
    const s = ctx.db.get("SELECT * FROM sessions WHERE id = ?", sha256(token));
    if (!s || s.expires_at <= new Date().toISOString()) return null;
    const user = ctx.db.get("SELECT * FROM users WHERE id = ?", s.user_id);
    return user ? { session: s, user } : null;
  }
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? "; Secure" : ""}`;
  function startSession(res, userId, via) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    ctx.db.run("INSERT INTO sessions (id, user_id, via, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(token), userId, via, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString());
    res.setHeader("Set-Cookie", cookie(token, SESSION_DAYS * 86400));
    touch({ id: userId });
    return sha256(token);
  }
  // 记访问（PRD 1.3 的 7 日回访）：每人每个 UTC 日最多写一次。
  // 拿已经读出来的 users.last_seen_at 比日期，同一天的后续请求不再写库；不写在 sessions 上（会话会被整行删除）
  function touch(user) {
    const t = new Date().toISOString(), day = t.slice(0, 10);
    if (user.last_seen_at && user.last_seen_at.slice(0, 10) === day) return;
    ctx.db.run("UPDATE users SET last_seen_at = ? WHERE id = ?", t, user.id);
    ctx.db.run("INSERT OR IGNORE INTO user_visits (user_id, day) VALUES (?, ?)", user.id, day);
  }
  function endSession(req, res) {
    const token = sessionToken(req);
    if (token) ctx.db.run("DELETE FROM sessions WHERE id = ?", sha256(token));
    res.setHeader("Set-Cookie", cookie("", 0));
  }

  /* ---------- 工具 ---------- */
  function send(res, status, body, headers) {
    if (res.headersSent) return;
    res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, SECURITY_HEADERS, headers));
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  // 读请求体：超过 100KB 停止收集并返回 413；JSON 必须是对象；form = 允许 application/x-www-form-urlencoded；
  // rawCfg = 文件上传路由的 meta.raw：按它的上限收集，原样返回 Buffer
  function readBody(req, form, rawCfg) {
    const max = rawCfg ? rawCfg.max : MAX_BODY;
    return new Promise((resolve, reject) => {
      let size = 0, over = false; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > max) { over = true; chunks.length = 0; } else chunks.push(c); });
      req.on("end", () => {
        if (over) return reject(fail("too_large", rawCfg ? { fields: { [rawCfg.field]: "too_large" } } : null));
        if (rawCfg) return resolve(Buffer.concat(chunks));
        const raw = Buffer.concat(chunks).toString("utf8");
        if (form) return resolve(Object.fromEntries(new URLSearchParams(raw)));
        if (!raw) return resolve({});
        let v;
        try { v = JSON.parse(raw); } catch (e) { return reject(fail("invalid", { reason: "bad_json" })); }
        if (v === null || typeof v !== "object" || Array.isArray(v)) return reject(fail("invalid", { reason: "bad_json" }));
        resolve(v);
      });
      req.on("error", reject);
    });
  }
  function serveStatic(req, res, urlPath) {
    let rel = safeDecode(urlPath);
    if (rel === null || rel.indexOf("\0") >= 0) return send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(ctx.cfg.webDir, rel));
    let ok = file.startsWith(ctx.cfg.webDir + path.sep);
    try { ok = ok && fs.statSync(file).isFile() && fs.realpathSync(file).startsWith(ctx.cfg.webDir + path.sep); } catch (e) { ok = false; }
    if (!ok) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    res.writeHead(200, Object.assign({ "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }, SECURITY_HEADERS));
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }
  function audit(actor, op, target, ok, code) {
    ctx.db.run("INSERT INTO audit_log (at, actor, op, target, ok, code) VALUES (?, ?, ?, ?, ?, ?)", new Date().toISOString(), actor || null, op, target ? String(target).slice(0, 64) : null, ok ? 1 : 0, code || null);
  }
  function htmlPage(status, msg) {
    return [status, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Yalelux</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6">${msg}<p><a href="/">Yalelux</a></p></body></html>`];
  }

  /* ---------- 处理一个请求（任何异常都只变成这个请求的错误响应） ---------- */
  async function handle(req, res) {
    try { await dispatch(req, res); }
    catch (e) { console.error(e); send(res, 500, { ok: false, error: { code: "internal" } }); }
  }
  async function dispatch(req, res) {
    let url;
    try { url = new URL(req.url, "http://local"); } catch (e) { return send(res, 400, { ok: false, error: { code: "invalid" } }); }
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "Content-Type": "text/plain" });
      return serveStatic(req, res, url.pathname);
    }
    const p = url.pathname.slice(4);
    const params = {};
    let r = null, user = null, who = null, actor = null, result;
    try {
      r = routes.find((x) => x.method === req.method && x.re.test(p)) || null;
      if (!r) throw fail("not_found");
      const m = p.match(r.re);
      r.keys.forEach((k, i) => (params[k] = safeDecode(m[i + 1])));
      if (Object.values(params).some((v) => v === null || !PARAM.test(v))) throw fail("not_found");
      if (r.localOnly && !LOOPBACK.test(req.socket.remoteAddress || "")) throw fail("not_found");
      who = sessionFrom(req);
      user = who && who.user; actor = user && user.id;
      // 防跨站提交：写请求必须是 JSON，且来源（如有）必须是本站。签名链接（如退订）例外，它们不依赖登录状态。
      // 文件上传路由只收它声明的那一种类型（如 application/pdf）：和 JSON 一样不是"简单请求"的类型，跨站页面发不出来（浏览器要先预检）
      if (req.method !== "GET" && !r.form) {
        const ctype = String(req.headers["content-type"] || "");
        if (r.raw) { if (ctype.split(";")[0].trim().toLowerCase() !== r.raw.type) throw fail("invalid", { fields: { [r.raw.field]: r.raw.badType } }); }
        else if (!/^application\/json/.test(ctype)) throw fail("invalid", { reason: "json_required" });
        const origin = req.headers.origin;
        if (origin && origin !== ctx.cfg.publicUrl && origin !== "http://" + req.headers.host && origin !== "https://" + req.headers.host) throw fail("forbidden", { reason: "bad_origin" });
      }
      if (user) touch(user);
      if (r.auth !== "none" && !user) throw fail("unauthorized");
      if (r.auth === "admin" && !ctx.isAdmin(user, who.session)) throw fail("forbidden");
      if (r.auth === "consented" && !ctx.isConsented(user)) throw fail("forbidden", { reason: "needs_consent" });
      if (r.auth === "ready" && !ctx.isReady(user)) throw fail("forbidden", { reason: "profile_incomplete" });
      const body = req.method === "GET" ? {} : await readBody(req, r.form, r.raw);
      const query = Object.fromEntries(url.searchParams.entries());
      const setActor = (id) => (actor = id); // 登录接口在请求开始时还没有用户，登录成功后记下是谁
      const data = await r.handler({ params, query, body, user, session: who && who.session, req, res, ip: clientIp(req), startSession, endSession, setActor });
      if (data instanceof RawReply) result = { status: 200, body: { ok: true, data: null }, raw: data };
      else result = { status: 200, body: { ok: true, data: data === undefined ? null : data } };
    } catch (e) {
      if (!(e instanceof ApiError)) { console.error(e); e = fail("internal"); }
      result = { status: STATUS[e.code], body: { ok: false, error: Object.assign({}, e.extra, { code: e.code }) } };
    }
    // 只审计"找到了接口"的请求。没有用户编号的失败一律不记（不是 JSON、跨站来源、请求体太大或不是对象、没登录、
    // 登录验证码错误、退订签名无效……），否则匿名请求能无限刷大日志；验证码的错误次数另有 login_codes.attempts 和按 IP 限频
    if (r && r.audit && (result.body.ok || actor)) {
      audit(actor, req.method + " " + r.pattern, params.id || (result.body.data && result.body.data.id) || null, result.body.ok, result.body.ok ? null : result.body.error.code);
    }
    if (r && r.html) { // 邮件里点开的链接：返回一个简单网页（r.html 负责转义自己拼的内容）
      const [status, page] = htmlPage(result.status, result.body.ok ? r.html(result.body.data, { query: Object.fromEntries(url.searchParams.entries()), escHtml }) : "<p>链接无效或已过期。<br>This link is invalid or has expired.</p>");
      return send(res, status, page, { "Content-Type": "text/html; charset=utf-8" });
    }
    if (result.raw) return send(res, 200, result.raw.body, result.raw.headers);
    send(res, result.status, result.body, result.body.error && result.body.error.code === "too_large" ? { Connection: "close" } : null);
  }

  return { route, handle, routes: () => routes.map((r) => ({ method: r.method, pattern: r.pattern, auth: r.auth })) };
}

module.exports = { createApp, fail, reply, ApiError, sha256, escHtml, LOOPBACK };
