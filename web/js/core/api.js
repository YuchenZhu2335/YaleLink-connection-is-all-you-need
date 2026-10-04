/* 接口层 — 模块读写业务数据的唯一通道（单一写路径）
   API layer — the single door between feature modules and business data.

   ── 模块里怎么调用 ──────────────────────────────────────────────
     const r = await YL.api.get("/coffee/requests", { box: "in" });
     const r = await YL.api.post("/coffee/requests", { hostId: "u01", topic: "career", ... });
     // r = { ok: true, status, data } | { ok: false, status, error: { code, fields? } }

   ── 接口怎么实现（web/js/api/<模块>.js）─────────────────────────
     YL.api.route("POST", "/coffee/requests/:id/accept", (req) => {
       // req = { params, query, body, user }；user 是当前登录者（未登录的请求到不了这里）
       // 出错：throw YL.api.fail("forbidden")
       return dto;                                  // 返回值就是 data
     }, { summary: { zh: "…", en: "…" } });

   ── 两种运行模式（config.js → apiBase）─────────────────────────
     ""（默认）  请求在浏览器内路由到本地实现，数据存 localStorage —— 原型 / mock 后端；
     "https://…" 同样的调用改为 fetch 发往真实后端，模块代码一行不用改。
   所以每条 route 就是一份后端契约：方法 + 路径 + 入参 + 返回 + 错误码，后端照着实现即可。

   本地模式额外做两件"服务端才会做"的事，让原型与真实版行为一致：
     1. 入参与返回值都经过 JSON 序列化 —— 模块拿不到内部数据的引用，改不了"数据库"；
     2. 所有写请求（非 GET）自动写审计日志，被拒绝的尝试也记录。 */
window.YL = window.YL || {};
YL.api = (function () {
  // 错误码 ↔ HTTP 状态码，前后端共用这张表
  const STATUS = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429, internal: 500, network: 0 };
  const routes = [];

  function compile(pattern) {
    const keys = [];
    const src = pattern.split("/").map((seg) => {
      if (seg.charAt(0) === ":") { keys.push(seg.slice(1)); return "([^/]+)"; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("/");
    return { re: new RegExp("^" + src + "/?$"), keys };
  }
  // 注册一条接口的本地实现。meta: { summary: {zh, en}, auth: false = 允许未登录访问（默认需要登录） }
  function route(method, pattern, handler, meta) {
    method = String(method).toUpperCase();
    if (typeof handler !== "function") throw new Error("YL.api.route: handler required for " + method + " " + pattern);
    if (routes.some((r) => r.method === method && r.pattern === pattern)) throw new Error("YL.api.route: duplicate " + method + " " + pattern);
    routes.push(Object.assign({ auth: true, summary: "" }, meta, { method, pattern, handler }, compile(pattern)));
  }
  // 接口实现里报错：throw YL.api.fail("forbidden") / fail("invalid", { fields: { note: "too_short" } })
  function fail(code, extra) {
    const e = new Error("api:" + code);
    e.apiCode = STATUS[code] != null ? code : "internal";
    e.apiExtra = extra || null;
    return e;
  }
  const error = (code, extra) => ({ ok: false, status: STATUS[code], error: Object.assign({}, extra, { code }) });
  const codeOfStatus = (s) => Object.keys(STATUS).find((k) => STATUS[k] === s) || (s >= 500 ? "internal" : "invalid");
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  function currentUser() {
    if (!YL.auth.isLoggedIn()) return null;
    const s = YL.auth.user();
    // 原型中当前用户 id 恒为 "me"（与 YL.store.user("me") 一致）；真实后端由会话解析出用户 id
    return { id: "me", email: s.email, kind: s.kind, acssyRole: YL.auth.acssyRole() };
  }

  async function local(method, path, body) {
    const qi = path.indexOf("?");
    const pathname = qi < 0 ? path : path.slice(0, qi);
    const query = {};
    if (qi >= 0) new URLSearchParams(path.slice(qi + 1)).forEach((v, k) => (query[k] = v));
    const params = {};
    const r = routes.find((x) => {
      if (x.method !== method) return false;
      const m = pathname.match(x.re);
      if (m) x.keys.forEach((k, i) => (params[k] = decode(m[i + 1])));
      return !!m;
    });
    const user = currentUser();
    let res;
    if (!r) res = error("not_found");
    else if (r.auth !== false && !user) res = error("unauthorized");
    else {
      try {
        const data = await r.handler({ params, query, body: clone(body), user });
        res = { ok: true, status: 200, data: clone(data) };
      } catch (e) {
        if (e && e.apiCode) res = error(e.apiCode, e.apiExtra);
        else { console.error(e); res = error("internal"); }
      }
    }
    if (method !== "GET") {
      YL.audit.record({
        actor: user ? user.id : null,
        op: method + " " + (r ? r.pattern : pathname),
        target: params.id || (res.ok && res.data && res.data.id) || null,
        ok: res.ok,
        code: res.ok ? null : res.error.code
      });
    }
    return res;
  }

  async function remote(method, path, body) {
    try {
      const res = await fetch(String(YL_CONFIG.apiBase).replace(/\/$/, "") + path, {
        method,
        credentials: "include",
        headers: method === "GET" ? {} : { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body || {})
      });
      const json = await res.json().catch(() => null);
      if (json && typeof json.ok === "boolean") return Object.assign({ status: res.status }, json);
      return res.ok ? { ok: true, status: res.status, data: json } : error(codeOfStatus(res.status));
    } catch (e) {
      return error("network");
    }
  }

  function request(method, path, body) {
    method = String(method).toUpperCase();
    return YL_CONFIG.apiBase ? remote(method, path, body) : local(method, path, body);
  }
  function qs(query) {
    const p = new URLSearchParams();
    Object.keys(query || {}).forEach((k) => { if (query[k] != null && query[k] !== "") p.set(k, query[k]); });
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const get = (path, query) => request("GET", path + qs(query));
  const post = (path, body) => request("POST", path, body || {});
  // 接口契约清单（"关于"页自动列出，后端照此实现）
  const list = () => routes.map((r) => ({ method: r.method, pattern: r.pattern, summary: r.summary, auth: r.auth !== false }));

  return { route, fail, request, get, post, routes: list, STATUS };
})();
