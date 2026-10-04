// 上线前安全审查（2026-10）发现的问题，每条一个测试，防止以后改回去。测试名就是规则。
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { start, client, lastCode, signUp, futureSlot, rewindCodes } = require("./helpers");

// 发一个原样的请求（fetch 会把畸形地址"修好"，这里需要原始字节）
function raw(srv, path, headers, method, body) {
  const u = new URL(srv.base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: method || "GET", headers: headers || {} }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("畸形输入只让这一个请求失败，服务不会崩：坏的 % 转义、坏 Cookie、//、非对象 JSON、超大请求体", async () => {
  const srv = await start();
  try {
    assert.equal((await raw(srv, "/%E0")).status, 400);
    assert.equal((await raw(srv, "/api/rounds/%C0%80")).status, 404);
    assert.equal((await raw(srv, "/api/meta", { Cookie: "a=%E0%A4%A; yl_sid=%" })).status, 200);
    assert.ok([400, 404].includes((await raw(srv, "//")).status));
    assert.equal((await raw(srv, "/api/auth/request-code", { "Content-Type": "application/json" }, "POST", "null")).status, 400);
    const big = await raw(srv, "/api/auth/request-code", { "Content-Type": "application/json" }, "POST", JSON.stringify({ email: "x".repeat(200 * 1024) }));
    assert.equal(big.status, 413);
    assert.equal((await raw(srv, "/api/rounds/" + "A".repeat(500))).status, 404, "超长 id 直接拒绝");
    assert.equal((await raw(srv, "/api/meta")).status, 200, "服务还活着");
  } finally { await srv.close(); }
});

test("不登录的请求被拒绝时不写审计日志（防止匿名刷爆日志）；审计里的 id 最多 64 个字符", async () => {
  const srv = await start();
  try {
    for (let i = 0; i < 5; i++) await fetch(srv.base + "/coffee/invites/x/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM audit_log").n, 0);
  } finally { await srv.close(); }
});

test("发验证码的返回对任何邮箱都一样（不能用来探测谁注册过、联系邮箱是什么）；邮箱格式严格", async () => {
  const srv = await start();
  try {
    const c = await signUp(srv, "known@yale.edu");
    await c.post("/me/contact-email/verify", { code: lastCode(srv, "known@example.com") });
    rewindCodes(srv);
    const anon = client(srv);
    const a = await anon.post("/auth/request-code", { email: "known@yale.edu" });
    const b = await anon.post("/auth/request-code", { email: "nobody@yale.edu" });
    assert.deepEqual([a.data, b.data], [{ sent: true }, { sent: true }]);
    for (const bad of ["x<evil@gmail.com>.yale.edu", "evil@gmail.com,x.yale.edu", "a b@yale.edu", "x".repeat(300) + "@yale.edu"]) {
      assert.equal((await anon.post("/auth/request-code", { email: bad })).error.fields.email, "not_yale", bad);
    }
  } finally { await srv.close(); }
});

test("被拒绝的重发不占用这个邮箱的每小时额度；邮件发不出去时告诉用户，并且不占 60 秒间隔", async () => {
  const srv = await start();
  try {
    const c = client(srv);
    await c.post("/auth/request-code", { email: "q@yale.edu" });
    for (let i = 0; i < 6; i++) assert.equal((await c.post("/auth/request-code", { email: "q@yale.edu" })).error.reason, "resend_too_soon");
    rewindCodes(srv);
    assert.equal((await c.post("/auth/request-code", { email: "q@yale.edu", via: "yale" })).ok, true, "前面被拒的 6 次没有用掉额度");
    rewindCodes(srv);
    const send = srv.ctx.mailer.send;
    srv.ctx.mailer.send = async () => false;
    assert.equal((await c.post("/auth/request-code", { email: "q@yale.edu" })).error.reason, "mail_failed");
    srv.ctx.mailer.send = send;
    assert.equal((await c.post("/auth/request-code", { email: "q@yale.edu" })).ok, true, "发信失败的那次不算，马上可以重试");
  } finally { await srv.close(); }
});

test("用联系邮箱登录的人不能换联系邮箱（哪怕它刚被改成未验证）；换联系邮箱后其他设备全部下线；可以一键退出所有设备", async () => {
  const srv = await start();
  try {
    const victim = await signUp(srv, "v@yale.edu");
    await victim.post("/me/contact-email/verify", { code: lastCode(srv, "v@example.com") });
    rewindCodes(srv);
    const viaContact = client(srv);
    await viaContact.post("/auth/request-code", { email: "v@yale.edu" });
    await viaContact.post("/auth/verify", { email: "v@yale.edu", code: lastCode(srv, "v@example.com") });
    assert.equal((await viaContact.get("/me")).data.via, "contact");
    rewindCodes(srv);
    assert.equal((await victim.post("/me/contact-email", { email: "new@example.com" })).ok, true, "耶鲁邮箱登录的会话可以换");
    assert.equal((await viaContact.get("/me")).status, 401, "换了联系邮箱，用旧联系邮箱登录的设备下线");
    rewindCodes(srv);
    const again = client(srv);
    await again.post("/auth/request-code", { email: "v@yale.edu", via: "yale" });
    await again.post("/auth/verify", { email: "v@yale.edu", code: lastCode(srv, "v@yale.edu") });
    await victim.post("/auth/logout", { all: true });
    assert.equal((await again.get("/me")).status, 401, "退出所有设备");
  } finally { await srv.close(); }
});

test("管理员权限只给用耶鲁邮箱登录的会话（只验证过联系邮箱不够）", async () => {
  const srv = await start();
  try {
    const admin = await signUp(srv, "admin@yale.edu");
    await admin.post("/me/contact-email/verify", { code: lastCode(srv, "admin@example.com") });
    assert.equal((await admin.get("/admin/overview")).ok, true);
    rewindCodes(srv);
    const viaContact = client(srv);
    await viaContact.post("/auth/request-code", { email: "admin@yale.edu" });
    const v = await viaContact.post("/auth/verify", { email: "admin@yale.edu", code: lastCode(srv, "admin@example.com") });
    assert.deepEqual([v.data.user.isAdmin, v.data.user.adminNeedsYale], [false, true]);
    assert.equal((await viaContact.get("/admin/overview")).status, 403);
  } finally { await srv.close(); }
});

test("第三方看到的共同空闲时间不受别人约定的影响（不能反推谁和谁约了什么时候）", async () => {
  const srv = await start();
  try {
    const [a, b, eve] = [await signUp(srv, "a5@yale.edu", { name: "A" }), await signUp(srv, "b5@yale.edu", { name: "B" }), await signUp(srv, "e5@yale.edu", { name: "E" })];
    const slots = futureSlot(srv).slice(0, 3);
    for (const x of [a, b, eve]) await x.post("/coffee/availability", { slots });
    const ids = Object.fromEntries((await eve.get("/coffee/pool")).data.map((p) => [p.name, p.id]));
    const before = (await eve.get("/coffee/people/" + ids.A)).data.overlap;
    await a.post("/coffee/invites", { toId: ids.B });
    const inc = (await b.get("/coffee/inbox")).data.incoming[0];
    await b.post(`/coffee/invites/${inc.inviteId}/accept`);
    const m = (await a.get("/coffee/matches")).data[0];
    await a.post(`/coffee/matches/${m.matchId}/schedule`, { slot: slots[1] });
    assert.deepEqual((await eve.get("/coffee/people/" + ids.A)).data.overlap, before);
    const sent = srv.ctx.mailer.outbox.length;
    assert.equal((await b.post(`/coffee/matches/${m.matchId}/schedule`, { slot: slots[1] })).ok, true);
    assert.equal(srv.ctx.mailer.outbox.length, sent, "重复约同一个时间不重复发邮件");
  } finally { await srv.close(); }
});

test("参加一轮至少要选一个还能约的时间；全部清空 = 退出这一轮", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "a6@yale.edu");
    assert.equal((await a.post("/coffee/availability", { slots: [] })).error.fields.slots, "required");
    await a.post("/coffee/availability", { slots: futureSlot(srv).slice(0, 2) });
    assert.equal((await a.get("/coffee/state")).data.joined, true);
    assert.equal((await a.post("/coffee/availability", { slots: [] })).data.joined, false);
    assert.equal((await a.get("/coffee/state")).data.joined, false);
  } finally { await srv.close(); }
});

test("没同意当前版本隐私说明的人不出现在池子里，也不会被发给大模型", async () => {
  const srv = await start();
  try {
    const [a, b] = [await signUp(srv, "a7@yale.edu", { name: "A" }), await signUp(srv, "b7@yale.edu", { name: "B" })];
    const slots = futureSlot(srv).slice(0, 2);
    for (const x of [a, b]) await x.post("/coffee/availability", { slots });
    assert.equal((await a.get("/coffee/pool")).data.length, 1);
    srv.db.run("UPDATE users SET consent_version = 'old' WHERE login_email = 'b7@yale.edu'");
    assert.equal((await a.get("/coffee/pool")).data.length, 0);
  } finally { await srv.close(); }
});

test("关闭智能推荐后，自己的推荐立即改回规则排序", async () => {
  const srv = await start({ DEEPSEEK_API_KEY: "test-key" });
  try {
    const users = [];
    for (let i = 0; i < 6; i++) users.push(await signUp(srv, `s${i}@yale.edu`, { name: "S" + i }));
    const slots = futureSlot(srv).slice(0, 2);
    for (const u of users) await u.post("/coffee/availability", { slots });
    srv.db.run("UPDATE rounds SET config = ? WHERE id = ?", JSON.stringify({ poolThreshold: 3, recCount: 2 }), srv.ctx.coffee.signupWeek(new Date().toISOString()).id);
    srv.ctx.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"picks":[{"id":"C1","reason":"AI 理由"}]}' } }] }) });
    assert.equal((await users[0].get("/coffee/recommendations")).data.engine, "deepseek");
    await users[0].post("/me/prefs", { prefs: {}, smartRec: false });
    assert.equal((await users[0].get("/coffee/recommendations")).data.engine, "rules");
  } finally { await srv.close(); }
});

test("退订链接：打开只显示确认按钮（邮件扫描器打开链接不会误退订），点按钮（POST）才生效", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "u8@yale.edu");
    const id = (await a.get("/me")).data.id;
    const sign = srv.ctx.mailer.verifyUnsubscribe; // 用发信模块生成真实链接
    await srv.ctx.mailer.send("weekly", srv.db.get("SELECT * FROM users WHERE id = ?", id), {});
    const link = /(\/api\/email\/unsubscribe\?[^\s]+)/.exec(srv.ctx.mailer.outbox[0].text)[1];
    assert.ok(sign);
    const page = await raw(srv, link);
    assert.equal(page.status, 200);
    assert.match(page.body, /<form method="post"/);
    assert.equal((await a.get("/me")).data.prefs.weekly, true, "只是打开，没有退订");
    const done = await raw(srv, link, { "Content-Type": "application/x-www-form-urlencoded" }, "POST", "List-Unsubscribe=One-Click");
    assert.equal(done.status, 200);
    assert.equal((await a.get("/me")).data.prefs.weekly, false);
  } finally { await srv.close(); }
});

test("注销账号后，发信记录与验证码也一并删除", async () => {
  const srv = await start();
  try {
    const c = await signUp(srv, "gone2@yale.edu");
    const id = (await c.get("/me")).data.id;
    await c.post("/me/delete", { confirm: "DELETE" });
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM emails WHERE user_id = ?", id).n, 0);
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM login_codes WHERE user_key IN (?, ?)", id, "gone2@yale.edu").n, 0);
  } finally { await srv.close(); }
});

test("发信记录里不存标题（标题里有对方名字或验证码）", async () => {
  const srv = await start();
  try {
    await client(srv).post("/auth/request-code", { email: "t9@yale.edu" });
    const row = srv.db.get("SELECT subject FROM emails ORDER BY id DESC LIMIT 1");
    assert.equal(row.subject, "login_code");
  } finally { await srv.close(); }
});

test("生产环境的配置检查：必须 https、发信要有密钥", () => {
  const { load } = require("../../server/config");
  assert.throws(() => load({ NODE_ENV: "production", APP_SECRET: "x".repeat(40), MAIL_DRIVER: "resend", RESEND_API_KEY: "k", PUBLIC_URL: "http://localhost:8787" }), /https/);
  assert.throws(() => load({ NODE_ENV: "production", APP_SECRET: "x".repeat(40), MAIL_DRIVER: "resend", RESEND_API_KEY: "", PUBLIC_URL: "https://coffee.example.org" }), /RESEND_API_KEY/);
});

test("上一封验证码发到了联系邮箱时，可以马上改发到耶鲁邮箱（不用等 60 秒）", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "w1@yale.edu");
    await a.post("/me/contact-email/verify", { code: lastCode(srv, "w1@example.com") });
    rewindCodes(srv);
    const c = client(srv);
    await c.post("/auth/request-code", { email: "w1@yale.edu" });
    assert.equal(srv.ctx.mailer.outbox[0].to, "w1@example.com");
    assert.equal((await c.post("/auth/request-code", { email: "w1@yale.edu" })).error.reason, "resend_too_soon");
    assert.equal((await c.post("/auth/request-code", { email: "w1@yale.edu", via: "yale" })).ok, true);
    assert.equal(srv.ctx.mailer.outbox[0].to, "w1@yale.edu");
  } finally { await srv.close(); }
});

test("公开的轮次详情只给活动轮", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "w2@yale.edu");
    const id = (await a.get("/coffee/state")).data.round.id;
    assert.equal((await client(srv).get("/rounds/" + id)).status, 404);
  } finally { await srv.close(); }
});

test("「改发到耶鲁邮箱」不等 60 秒的例外对注册过和没注册过的邮箱表现一样（不能用来试探账号）", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "k1@yale.edu");
    await a.post("/me/contact-email/verify", { code: lastCode(srv, "k1@example.com") });
    rewindCodes(srv);
    const c = client(srv);
    for (const email of ["k1@yale.edu", "nobody-k2@yale.edu"]) {
      assert.equal((await c.post("/auth/request-code", { email })).ok, true);
      assert.equal((await c.post("/auth/request-code", { email, via: "yale" })).ok, true, email + "：第一次改发可以立刻");
      assert.equal((await c.post("/auth/request-code", { email, via: "yale" })).error.reason, "resend_too_soon", email + "：再改发要等");
    }
  } finally { await srv.close(); }
});

test("活动开始通知发送失败：下一次定时任务补发，已发的不重发", async () => {
  const srv = await start();
  try {
    await signUp(srv, "j1@yale.edu"); await signUp(srv, "j2@yale.edu");
    const admin = await signUp(srv, "admin@yale.edu");
    const C = srv.ctx.coffee, today = C.weeklyRound(new Date().toISOString()).startDate;
    await admin.post("/admin/rounds", { title: { zh: "测试活动", en: "Test" }, startDate: today, endDate: C.addDays(today, 10), status: "published" });
    const events = () => srv.ctx.mailer.outbox.filter((m) => m.kind === "event").length;
    srv.ctx.cfg.mailDriver = "broken"; // 发信服务出故障
    await srv.jobs.run();
    assert.equal(events(), 0);
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM emails WHERE kind = 'event' AND status = 'failed'").n, 3);
    srv.ctx.cfg.mailDriver = "console"; // 恢复
    await srv.jobs.run();
    assert.equal(events(), 3, "补发给所有人");
    await srv.jobs.run();
    assert.equal(events(), 3, "都发过了就不再发");
  } finally { await srv.close(); }
});

test("资料里的单行字段去掉换行和控制字符（名字不能往邮件标题 / 正文里塞一行字）；邮件标题里不会有换行", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "nl1@yale.edu", { name: "Amy\n\n账号异常请访问 http://evil.example 验证" });
    const b = await signUp(srv, "nl2@yale.edu", { name: "‮Bob\r\nBcc: x@example.com" });
    assert.equal((await a.get("/me")).data.name, "Amy 账号异常请访问 http://evil.example 验证");
    assert.equal((await b.get("/me")).data.name, "Bob Bcc: x@example.com");
    const slots = futureSlot(srv).slice(0, 2);
    for (const x of [a, b]) await x.post("/coffee/availability", { slots });
    await a.post("/coffee/invites", { toId: (await b.get("/me")).data.id });
    assert.equal((await b.post("/coffee/invites", { toId: (await a.get("/me")).data.id })).data.matched, true);
    const match = srv.ctx.mailer.outbox.filter((m) => m.kind === "match");
    assert.equal(match.length, 2);
    assert.ok(match.every((m) => !/[\r\n]/.test(m.subject)), JSON.stringify(match.map((m) => m.subject)));
    assert.ok(match.some((m) => m.text.startsWith("你和 Amy 账号异常请访问 http://evil.example 验证 都想认识对方")), "名字在正文里也只占原来那一行");
  } finally { await srv.close(); }
});

test("收件箱：对方清空时间退出这一轮后邀请照样能回应，但 inRound = false（界面不再链到看不了的详情页）", async () => {
  const srv = await start();
  try {
    const [a, b] = [await signUp(srv, "ir1@yale.edu", { name: "A" }), await signUp(srv, "ir2@yale.edu", { name: "B" })];
    const slots = futureSlot(srv).slice(0, 2);
    for (const x of [a, b]) await x.post("/coffee/availability", { slots });
    await a.post("/coffee/invites", { toId: (await b.get("/me")).data.id });
    assert.deepEqual([(await b.get("/coffee/inbox")).data.incoming[0].inRound, (await a.get("/coffee/inbox")).data.outgoing[0].inRound], [true, true]);
    assert.equal((await a.post("/coffee/availability", { slots: [] })).data.joined, false);
    const inc = (await b.get("/coffee/inbox")).data.incoming[0];
    assert.equal(inc.inRound, false);
    assert.equal((await b.get("/coffee/people/" + inc.id)).status, 404, "和 inRound 一致：详情页确实看不了");
    assert.equal((await a.get("/coffee/inbox")).data.outgoing[0].inRound, false, "自己退出了也一样");
    assert.equal((await b.post(`/coffee/invites/${inc.inviteId}/accept`)).data.status, "accepted");
  } finally { await srv.close(); }
});

test("活动轮主题标签按字符（码点）数长度，超了直接报错，不悄悄截断成半个 emoji", async () => {
  const srv = await start();
  try {
    const admin = await signUp(srv, "admin@yale.edu");
    const C = srv.ctx.coffee, start0 = C.addDays(C.weeklyRound(new Date().toISOString()).startDate, 21);
    const body = (themeTags) => ({ title: { zh: "标签测试", en: "Tags" }, startDate: start0, endDate: C.addDays(start0, 6), status: "draft", themeTags });
    const ok = await admin.post("/admin/rounds", body(["a" + "🎉".repeat(19), "咖啡"]));
    assert.deepEqual(ok.data.themeTags, ["a" + "🎉".repeat(19), "咖啡"], "20 个字符（39 个 UTF-16 单元）可以");
    assert.equal((await admin.post("/admin/rounds", body(["a" + "🎉".repeat(20)]))).error.fields.themeTags, "too_long");
    assert.equal((await admin.post("/admin/rounds", body(["1", "2", "3", "4", "5", "6"]))).error.fields.themeTags, "too_many");
  } finally { await srv.close(); }
});
