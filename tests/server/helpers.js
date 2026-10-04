// 后端测试的公共工具：起一个真服务（临时 SQLite、console 发信），模拟带 Cookie 的浏览器
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { build } = require("../../server/app");

function start(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yl-"));
  const app = build(Object.assign({ DB_FILE: path.join(dir, "t.sqlite"), QUIET: "1", DISABLE_JOBS: "1", ADMIN_EMAILS: "admin@yale.edu", MAIL_DRIVER: "console", NODE_ENV: "test" }, extra));
  const server = http.createServer((req, res) => app.app.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    resolve(Object.assign(app, { base, close: () => new Promise((r) => server.close(() => { app.db.close(); r(); })) }));
  }));
}
// 一个"浏览器"：自己保存 Cookie
function client(srv) {
  let cookie = "";
  async function call(method, p, body) {
    const r = await fetch(srv.base + p, { method, headers: Object.assign({ cookie }, method === "GET" ? {} : { "Content-Type": "application/json" }), body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return Object.assign(await r.json(), { status: r.status });
  }
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b) };
}
const lastCode = (srv, to) => { const m = srv.ctx.mailer.outbox.find((x) => !to || x.to === to); return m && /(\d{6})/.exec(m.subject)[1]; };
const PROFILE = { name: "测试同学", identity: "student", stage: "master", gradYear: new Date().getFullYear() + 1, contactMethod: "微信 test", answers: { goals: ["industry"], interests: ["hiking", "coffee"], field: "tech" } };
async function signUp(srv, email, profile) {
  const c = client(srv);
  await c.post("/auth/request-code", { email });
  const v = await c.post("/auth/verify", { email, code: lastCode(srv, email) });
  assert.equal(v.ok, true, JSON.stringify(v));
  await c.post("/me/consent", { version: srv.cfg.consentVersion });
  await c.post("/me/contact-email", { email: email.replace(/@.*/, "@example.com") });
  const p = await c.post("/me/profile", Object.assign({}, PROFILE, profile));
  assert.equal(p.ok, true, JSON.stringify(p));
  return c;
}
// 选一个所有人都还没过截止的未来时段
const futureSlot = (srv, n) => { const C = srv.ctx.coffee, r = C.signupWeek(new Date().toISOString()); return C.slotIds(r).filter((s) => !C.isClosed(r, s, new Date().toISOString())).slice(n || 0); };
// 跳过"60 秒内不能重发"：把上一封验证码的时间往前拨
const rewindCodes = (srv) => srv.db.run("UPDATE login_codes SET created_at = ?", new Date(Date.now() - 120000).toISOString());


module.exports = { start, client, lastCode, PROFILE, signUp, futureSlot, rewindCodes };
