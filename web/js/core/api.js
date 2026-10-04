/* 接口层 — 前端读写业务数据的唯一通道（模块里不许直接 fetch，见 scripts/check-architecture.mjs A3）
   API layer — the single door between feature modules and the backend (server/).

     const r = await YL.api.get("/coffee/state");
     const r = await YL.api.post("/coffee/invites", { toId: "u-…", note: "…" });
     // r = { ok: true, status, data } | { ok: false, status, error: { code, reason?, fields? } }

   - 接口清单与入参出参见 docs/api.md；实现在 server/*.js。
   - 错误码 ↔ HTTP 状态码与后端（server/http.js）共用这张表；界面用 YL.ui.errorText(error, "模块") 显示提示。
   - 会话是后端发的 httpOnly Cookie，前端读不到也不保存任何凭证。
   - 收到 401（会话过期 / 被注销）时广播 yl:unauthorized，由 YL.auth 清掉本地的登录状态。 */
window.YL = window.YL || {};
YL.api = (function () {
  const STATUS = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, too_large: 413, rate_limited: 429, internal: 500, network: 0 };
  const error = (code, extra) => ({ ok: false, status: STATUS[code], error: Object.assign({}, extra, { code }) });
  const codeOfStatus = (s) => Object.keys(STATUS).find((k) => STATUS[k] === s) || (s >= 500 ? "internal" : "invalid");
  const base = () => String(YL_CONFIG.apiBase || "/api").replace(/\/$/, "");

  async function request(method, path, body) {
    method = String(method).toUpperCase();
    let res;
    try {
      const r = await fetch(base() + path, {
        method,
        credentials: "same-origin",
        headers: method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body || {})
      });
      const json = await r.json().catch(() => null);
      if (json && typeof json.ok === "boolean") res = Object.assign({ status: r.status }, json);
      else res = r.ok ? { ok: true, status: r.status, data: json } : error(codeOfStatus(r.status));
    } catch (e) {
      res = error("network");
    }
    if (!res.ok && res.status === 401) window.dispatchEvent(new CustomEvent("yl:unauthorized"));
    return res;
  }
  function qs(query) {
    const p = new URLSearchParams();
    Object.keys(query || {}).forEach((k) => { if (query[k] != null && query[k] !== "") p.set(k, query[k]); });
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const get = (path, query) => request("GET", path + qs(query));
  const post = (path, body) => request("POST", path, body || {});

  return { request, get, post, STATUS };
})();
