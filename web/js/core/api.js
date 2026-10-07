/* 接口层 — 前端读写业务数据的唯一通道（模块里不许直接 fetch，见 scripts/check-architecture.mjs A3）
   API layer — the single door between feature modules and the backend (server/).

     const r = await YL.api.get("/coffee/state");
     const r = await YL.api.post("/coffee/invites", { toId: "u-…", note: "…" });
     const r = await YL.api.upload("/me/resume", file, "application/pdf", (f) => …); // f = 0–1 上传进度
     // r = { ok: true, status, data } | { ok: false, status, error: { code, reason?, fields? } }
     <a href="${esc(YL.api.url("/me/resume"))}">   // 浏览器直接打开的接口地址（下载简历）

   - 接口清单与入参出参见 docs/api.md；实现在 server/*.js。
   - 错误码 ↔ HTTP 状态码与后端（server/http.js）共用这张表；界面用 YL.ui.errorText(error, "模块") 显示提示。
   - 会话是后端发的 httpOnly Cookie，前端读不到也不保存任何凭证。
   - 收到 401（会话过期 / 被注销）时广播 yl:unauthorized，由 YL.auth 清掉本地的登录状态。
   - upload（RFC 0003）：请求体就是文件本身（不是 JSON），用 XMLHttpRequest 发，才能报告上传进度。 */
window.YL = window.YL || {};
YL.api = (function () {
  const STATUS = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, too_large: 413, rate_limited: 429, internal: 500, network: 0 };
  const error = (code, extra) => ({ ok: false, status: STATUS[code], error: Object.assign({}, extra, { code }) });
  const codeOfStatus = (s) => Object.keys(STATUS).find((k) => STATUS[k] === s) || (s >= 500 ? "internal" : "invalid");
  const base = () => String(YL_CONFIG.apiBase || "/api").replace(/\/$/, "");
  const url = (path) => base() + path;

  // 响应 → 统一信封；401 时广播 yl:unauthorized
  function settle(status, json) {
    let res;
    if (!status) res = error("network");
    else if (json && typeof json.ok === "boolean") res = Object.assign({ status }, json);
    else res = status >= 200 && status < 300 ? { ok: true, status, data: json } : error(codeOfStatus(status));
    if (!res.ok && res.status === 401) window.dispatchEvent(new CustomEvent("yl:unauthorized"));
    return res;
  }

  async function request(method, path, body) {
    method = String(method).toUpperCase();
    let r;
    try {
      r = await fetch(url(path), {
        method,
        credentials: "same-origin",
        headers: method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body || {})
      });
    } catch (e) {
      return settle(0);
    }
    return settle(r.status, await r.json().catch(() => null));
  }
  function qs(query) {
    const p = new URLSearchParams();
    Object.keys(query || {}).forEach((k) => { if (query[k] != null && query[k] !== "") p.set(k, query[k]); });
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const get = (path, query) => request("GET", path + qs(query));
  const post = (path, body) => request("POST", path, body || {});

  // 上传一个文件（POST，请求体 = blob）。onProgress(fraction) 可选：浏览器知道总大小时报告 0–1 的进度
  function upload(path, blob, contentType, onProgress) {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url(path));
        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("Content-Type", contentType || (blob && blob.type) || "application/octet-stream");
        if (onProgress && xhr.upload) xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(Math.min(1, e.loaded / e.total)); };
        xhr.onload = () => { let json = null; try { json = JSON.parse(xhr.responseText); } catch (e) { json = null; } resolve(settle(xhr.status, json)); };
        xhr.onerror = xhr.onabort = xhr.ontimeout = () => resolve(settle(0));
        xhr.send(blob);
      } catch (e) {
        resolve(settle(0));
      }
    });
  }

  return { request, get, post, upload, url, STATUS };
})();
