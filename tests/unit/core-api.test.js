// 核心接口层与审计日志的单元测试（零依赖：node --test）
// Unit tests for web/js/core/api.js and audit.js, run in Node with tiny browser stubs.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// 每个测试一套全新的"浏览器"：重新执行 audit.js 与 api.js
function boot(opts) {
  const o = Object.assign({ loggedIn: true, apiBase: "" }, opts);
  global.window = global;
  global.localStorage = memoryStorage();
  global.YL_CONFIG = { apiBase: o.apiBase };
  global.YL = {
    auth: { isLoggedIn: () => o.loggedIn, user: () => ({ email: "demo@yale.edu", kind: "student" }), acssyRole: () => "" }
  };
  for (const f of ["audit", "api"]) {
    const p = path.join(__dirname, "..", "..", "web", "js", "core", f + ".js");
    delete require.cache[require.resolve(p)];
    require(p);
  }
  return global.YL;
}

test("routes match params and query; handler gets the current user", async () => {
  const YL = boot();
  YL.api.route("GET", "/things/:id", (req) => ({ id: req.params.id, q: req.query.q, who: req.user.id }));
  const r = await YL.api.get("/things/t%201", { q: "x", empty: "" });
  assert.deepEqual(r, { ok: true, status: 200, data: { id: "t 1", q: "x", who: "me" } });
});

test("unknown route → not_found; logged-out request → unauthorized unless auth:false", async () => {
  const YL = boot({ loggedIn: false });
  YL.api.route("GET", "/private", () => "secret");
  YL.api.route("GET", "/public", () => "hello", { auth: false });
  assert.equal((await YL.api.get("/nope")).error.code, "not_found");
  const denied = await YL.api.get("/private");
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 401);
  assert.equal(denied.error.code, "unauthorized");
  assert.equal((await YL.api.get("/public")).data, "hello");
});

test("fail(code, extra) becomes an error envelope; unexpected throws become internal", async () => {
  const YL = boot();
  YL.api.route("POST", "/a", () => { throw YL.api.fail("conflict", { reason: "duplicate" }); });
  YL.api.route("POST", "/b", () => { throw new Error("boom"); });
  assert.deepEqual(await YL.api.post("/a"), { ok: false, status: 409, error: { reason: "duplicate", code: "conflict" } });
  const quiet = console.error; console.error = () => {};
  try { assert.equal((await YL.api.post("/b")).error.code, "internal"); } finally { console.error = quiet; }
});

test("request and response are serialized: callers cannot reach internal objects", async () => {
  const YL = boot();
  const db = { item: { id: "x1", n: 1 } };
  YL.api.route("POST", "/items/:id", (req) => { req.body.n = 99; return db.item; });
  const body = { n: 2 };
  const r = await YL.api.post("/items/x1", body);
  r.data.n = 42;
  assert.equal(body.n, 2, "handler must not mutate the caller's body");
  assert.equal(db.item.n, 1, "caller must not mutate the store through the response");
});

test("every write is audited (including denied attempts); reads are not", async () => {
  const YL = boot();
  YL.api.route("GET", "/items", () => []);
  YL.api.route("POST", "/items", () => ({ id: "new-1" }));
  YL.api.route("POST", "/items/:id/approve", () => { throw YL.api.fail("forbidden"); });
  await YL.api.get("/items");
  await YL.api.post("/items", { title: "private text" });
  await YL.api.post("/items/abc/approve");
  const log = YL.audit.list();
  assert.equal(log.length, 2);
  assert.deepEqual(
    log.map(({ actor, op, target, ok, code }) => ({ actor, op, target, ok, code })),
    [
      { actor: "me", op: "POST /items/:id/approve", target: "abc", ok: false, code: "forbidden" },
      { actor: "me", op: "POST /items", target: "new-1", ok: true, code: null }
    ]
  );
  assert.ok(!JSON.stringify(log).includes("private text"), "audit log must not contain request bodies");
});

test("reads flagged audit:true are logged too (e.g. an admin viewing data); demo routes are marked", async () => {
  const YL = boot();
  YL.api.route("GET", "/admin/stats", () => ({ n: 1 }), { audit: true });
  YL.api.route("POST", "/_demo/seed", () => ({ id: "d1" }), { demo: true });
  await YL.api.get("/admin/stats");
  assert.equal(YL.audit.list()[0].op, "GET /admin/stats");
  assert.deepEqual(YL.api.routes().map((r) => [r.pattern, r.audit, r.demo]), [["/admin/stats", true, false], ["/_demo/seed", true, true]]);
});

test("audit.record sets its own id and timestamp, caps the log, and filters", () => {
  const YL = boot();
  const e = YL.audit.record({ actor: "me", op: "POST /x", at: "1999-01-01T00:00:00Z", id: "forged" });
  assert.notEqual(e.id, "forged");
  assert.notEqual(e.at, "1999-01-01T00:00:00Z");
  for (let i = 0; i < YL.audit.MAX + 5; i++) YL.audit.record({ actor: i % 2 ? "me" : "u01", op: i % 3 ? "POST /coffee/x" : "POST /other" });
  assert.equal(YL.audit.list().length, YL.audit.MAX);
  assert.ok(YL.audit.list({ actor: "u01" }).every((x) => x.actor === "u01"));
  assert.ok(YL.audit.list({ match: "/coffee/" }).every((x) => x.op.includes("/coffee/")));
  assert.equal(YL.audit.list({ limit: 3 }).length, 3);
  YL.audit.clear();
  assert.equal(YL.audit.list().length, 0);
});

test("duplicate route registration is rejected", () => {
  const YL = boot();
  YL.api.route("GET", "/dup", () => 1);
  assert.throws(() => YL.api.route("GET", "/dup", () => 2), /duplicate/);
});

test("with apiBase set, the same calls go over HTTP and keep the envelope", async () => {
  const YL = boot({ apiBase: "https://api.example.cn/" });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/down")) throw new Error("offline");
    if (url.endsWith("/plain")) return { status: 404, ok: false, json: async () => { throw new Error("not json"); } };
    return { status: 409, ok: false, json: async () => ({ ok: false, error: { code: "conflict" } }) };
  };
  try {
    const r = await YL.api.post("/coffee/requests", { hostId: "u01" });
    assert.deepEqual(r, { status: 409, ok: false, error: { code: "conflict" } });
    assert.equal(calls[0].url, "https://api.example.cn/coffee/requests");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(calls[0].init.body, JSON.stringify({ hostId: "u01" }));
    assert.equal((await YL.api.get("/plain")).error.code, "not_found");
    assert.equal((await YL.api.get("/down")).error.code, "network");
    assert.equal(YL.audit.list().length, 0, "the server writes the audit log in remote mode, not the browser");
  } finally {
    delete global.fetch;
  }
});
