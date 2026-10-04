/* HTTP 层：极简路由 + 静态文件 + 会话 + 统一返回格式 + 审计。零依赖。
   返回格式与前端 YL.api 一致：{ ok: true, data } | { ok: false, error: { code, reason?, fields? } } */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STATUS = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, too_large: 413, rate_limited: 429, internal: 500 };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
const COOKIE = "yl_sid";
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const SESSION_DAYS = 30;

class ApiError extends Error {
  constructor(code, extra) { super(code); this.code = STATUS[code] ? code : "internal"; this.extra = extra || null; }
}
const fail = (code, extra) => new ApiError(code, extra);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function createApp(ctx) {
  const routes = [];
  // 真实 IP：只有开启 TRUST_PROXY 且请求来自本机代理时，才采信 X-Forwarded-For 的最后一跳
  function clientIp(req) {
    const direct = req.socket.remoteAddress || "";
    if (!ctx.cfg.trustProxy || !LOOPBACK.test(direct)) return direct;
    const hops = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    return hops.length ? hops[hops.length - 1] : direct;
  }
  function route(method, pattern, handler, meta) {
    const keys = [];
    const re = new RegExp("^" + pattern.split("/").map((seg) => (seg[0] === ":" ? (keys.push(seg.slice(1)), "([^/]+)") : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "/?$");
    routes.push(Object.assign({ auth: "user", audit: method !== "GET" }, meta, { method, pattern, handler, re, keys }));
  }

  /* ---------- 会话 ---------- */
  function readCookies(req) {
    const out = {};
    String(req.headers.cookie || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
    return out;
  }
  function sessionFrom(req) {
    const token = readCookies(req)[COOKIE];
    if (!token) return null;
    const s = ctx.db.get("SELECT * FROM sessions WHERE id = ?", sha256(token));
    if (!s || s.expires_at <= new Date().toISOString()) return null;
    const user = ctx.db.get("SELECT * FROM users WHERE id = ?", s.user_id);
    return user ? { session: s, user } : null;
  }
  function startSession(res, userId, via) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    ctx.db.run("INSERT INTO sessions (id, user_id, via, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(token), userId, via, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString());
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${ctx.cfg.publicUrl.startsWith("https") ? "; Secure" : ""}`);
  }
  function endSession(req, res) {
    const token = readCookies(req)[COOKIE];
    if (token) ctx.db.run("DELETE FROM sessions WHERE id = ?", sha256(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  /* ---------- 工具 ---------- */
  function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, SECURITY_HEADERS, headers));
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > 100 * 1024) { reject(fail("too_large")); req.destroy(); } else chunks.push(c); });
      req.on("end", () => {
        if (!size) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(fail("invalid", { reason: "bad_json" })); }
      });
      req.on("error", reject);
    });
  }
  function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(ctx.cfg.webDir, rel));
    if (!file.startsWith(ctx.cfg.webDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    res.writeHead(200, Object.assign({ "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }, SECURITY_HEADERS));
    fs.createReadStream(file).pipe(res);
  }
  function audit(actor, op, target, ok, code) {
    ctx.db.run("INSERT INTO audit_log (at, actor, op, target, ok, code) VALUES (?, ?, ?, ?, ?, ?)", new Date().toISOString(), actor || null, op, target || null, ok ? 1 : 0, code || null);
  }

  /* ---------- 处理一个请求 ---------- */
  async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "Content-Type": "text/plain" });
      return serveStatic(req, res, url.pathname);
    }
    const p = url.pathname.slice(4);
    const params = {};
    const r = routes.find((x) => { if (x.method !== req.method) return false; const m = p.match(x.re); if (m) x.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); return !!m; });
    const who = sessionFrom(req);
    let result, user = who && who.user, actor = user && user.id;
    try {
      if (!r) throw fail("not_found");
      // 防跨站提交：写请求必须是 JSON，且来源（如有）必须是本站
      if (req.method !== "GET") {
        if (!/^application\/json/.test(req.headers["content-type"] || "")) throw fail("invalid", { reason: "json_required" });
        const origin = req.headers.origin;
        if (origin && origin !== ctx.cfg.publicUrl && origin !== "http://" + req.headers.host && origin !== "https://" + req.headers.host) throw fail("forbidden", { reason: "bad_origin" });
      }
      if (r.auth !== "none" && !user) throw fail("unauthorized");
      if (r.auth === "admin" && !ctx.isAdmin(user)) throw fail("forbidden");
      if (r.auth === "ready" && !ctx.isReady(user)) throw fail("forbidden", { reason: "profile_incomplete" });
      const body = req.method === "GET" ? {} : await readBody(req);
      const query = Object.fromEntries(url.searchParams.entries());
      const setActor = (id) => (actor = id); // 登录接口在请求开始时还没有用户，登录成功后记下是谁
      const data = await r.handler({ params, query, body, user, session: who && who.session, req, res, ip: clientIp(req), startSession, endSession, setActor });
      result = { status: 200, body: { ok: true, data: data === undefined ? null : data } };
    } catch (e) {
      if (!(e instanceof ApiError)) { console.error(e); e = fail("internal"); }
      result = { status: STATUS[e.code], body: { ok: false, error: Object.assign({}, e.extra, { code: e.code }) } };
    }
    if (r && r.audit) audit(actor, req.method + " " + r.pattern, params.id || (result.body.data && result.body.data.id) || null, result.body.ok, result.body.ok ? null : result.body.error.code);
    if (r && r.html) { // 邮件里点开的链接：返回一个简单网页
      const ok = result.body.ok, msg = ok ? r.html(result.body.data) : "链接无效或已过期。/ This link is invalid or has expired.";
      return send(res, result.status, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Yalelux</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6"><p>${msg}</p><p><a href="/">Yalelux</a></p>`, { "Content-Type": "text/html; charset=utf-8" });
    }
    send(res, result.status, result.body);
  }

  return { route, handle, routes: () => routes.map((r) => ({ method: r.method, pattern: r.pattern, auth: r.auth })) };
}

module.exports = { createApp, fail, ApiError, sha256 };
