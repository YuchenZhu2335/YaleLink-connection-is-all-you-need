// 前端接口层 web/js/core/api.js 的单元测试（零依赖：node --test，用假的 fetch 代替网络）
// Unit tests for the browser API client, run in Node with tiny browser stubs.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// 每个测试一套全新的"浏览器"：假 fetch 记录请求并返回预设的响应
function boot(reply) {
  const calls = [], events = [];
  global.window = global;
  global.YL_CONFIG = { apiBase: "/api" };
  global.YL = {};
  global.CustomEvent = class { constructor(type) { this.type = type; } };
  global.dispatchEvent = (e) => events.push(e.type);
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = typeof reply === "function" ? reply(url, init) : reply;
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error("not json"); return r.body; } };
  };
  const p = path.join(__dirname, "..", "..", "web", "js", "core", "api.js");
  delete require.cache[require.resolve(p)];
  require(p);
  return { api: global.YL.api, calls, events };
}

test("GET 把查询参数拼进地址（空值不带），带上 Cookie，不发请求体", async () => {
  const { api, calls } = boot({ status: 200, body: { ok: true, data: [1] } });
  const r = await api.get("/coffee/pool", { goal: "share", interest: "", field: null });
  assert.deepEqual(r, { status: 200, ok: true, data: [1] });
  assert.equal(calls[0].url, "/api/coffee/pool?goal=share");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.body, undefined);
});

test("POST 发 JSON（后端只收 JSON，挡跨站提交）", async () => {
  const { api, calls } = boot({ status: 200, body: { ok: true, data: { id: "x" } } });
  await api.post("/coffee/invites", { toId: "u-1", note: "hi" });
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { toId: "u-1", note: "hi" });
});

test("后端的错误信封原样交给界面（含 reason 与 fields）", async () => {
  const { api } = boot({ status: 409, body: { ok: false, error: { code: "conflict", reason: "already_invited" } } });
  assert.deepEqual(await api.post("/coffee/invites", {}), { status: 409, ok: false, error: { code: "conflict", reason: "already_invited" } });
});

test("不是 JSON 的错误响应按状态码换成错误码；网络失败是 network", async () => {
  assert.equal((await boot({ status: 502 }).api.get("/meta")).error.code, "internal");
  assert.equal((await boot({ status: 429 }).api.get("/meta")).error.code, "rate_limited");
  assert.equal((await boot(new TypeError("Failed to fetch")).api.get("/meta")).error.code, "network");
});

test("401（会话过期）时广播 yl:unauthorized，让登录状态清掉", async () => {
  const { api, events } = boot({ status: 401, body: { ok: false, error: { code: "unauthorized" } } });
  await api.get("/me");
  assert.deepEqual(events, ["yl:unauthorized"]);
});
