// 后端集成测试：真的起服务、真的写 SQLite（临时文件）、邮件走 console 驱动。测试名就是验收标准。
const test = require("node:test");
const assert = require("node:assert/strict");
const { start, client, lastCode, PROFILE, signUp, futureSlot, rewindCodes } = require("./helpers");

test("注册：只接受耶鲁邮箱；验证码 6 位、发到耶鲁邮箱；验证后建立会话", async () => {
  const srv = await start();
  try {
    const c = client(srv);
    assert.equal((await c.post("/auth/request-code", { email: "x@gmail.com" })).error.fields.email, "not_yale");
    const r = await c.post("/auth/request-code", { email: "Amy.Li@Yale.edu" });
    assert.deepEqual(r.data, { sent: true }, "返回里不透露账号是否存在、发到了哪里");
    assert.equal(srv.ctx.mailer.outbox[0].to, "amy.li@yale.edu");
    assert.equal((await c.post("/auth/verify", { email: "amy.li@yale.edu", code: "000000" })).error.fields.code, "wrong");
    const v = await c.post("/auth/verify", { email: "amy.li@yale.edu", code: lastCode(srv) });
    assert.deepEqual([v.data.user.loginEmail, v.data.user.needsConsent, v.data.user.needsProfile, v.data.user.ready], ["amy.li@yale.edu", true, true, false]);
    assert.equal((await c.get("/auth/me")).data.user.id, v.data.user.id, "会话保持");
    assert.equal((await c.get("/coffee/state")).error.reason, "profile_incomplete", "没完成资料不能进约咖啡");
    await c.post("/auth/logout");
    assert.equal((await c.get("/auth/me")).data.user, null);
  } finally { await srv.close(); }
});

test("验证码：60 秒内不能重发；输错 5 次作废", async () => {
  const srv = await start();
  try {
    const c = client(srv);
    await c.post("/auth/request-code", { email: "b@yale.edu" });
    assert.equal((await c.post("/auth/request-code", { email: "b@yale.edu" })).error.reason, "resend_too_soon");
    for (let i = 0; i < 4; i++) await c.post("/auth/verify", { email: "b@yale.edu", code: "111111" });
    assert.equal((await c.post("/auth/verify", { email: "b@yale.edu", code: "111111" })).error.fields.code, "too_many_attempts");
    assert.equal((await c.post("/auth/verify", { email: "b@yale.edu", code: lastCode(srv) })).error.fields.code, "too_many_attempts", "正确的码也不再接受");
  } finally { await srv.close(); }
});

test("联系邮箱：验证后通知改发到这里，之后登录验证码也发到这里；换已验证的联系邮箱要耶鲁邮箱登录", async () => {
  const srv = await start();
  try {
    const c = await signUp(srv, "c@yale.edu");
    assert.equal((await c.get("/me")).data.contactVerified, false);
    const code = lastCode(srv, "c@example.com");
    assert.equal((await c.post("/me/contact-email/verify", { code })).data.contactVerified, true);
    const c2 = client(srv);
    rewindCodes(srv);
    const r = await c2.post("/auth/request-code", { email: "c@yale.edu" });
    assert.deepEqual([r.data, srv.ctx.mailer.outbox[0].to], [{ sent: true }, "c@example.com"]);
    await c2.post("/auth/verify", { email: "c@yale.edu", code: lastCode(srv, "c@example.com") });
    assert.equal((await c2.post("/me/contact-email", { email: "new@example.com" })).error.reason, "reverify_yale");
  } finally { await srv.close(); }
});

test("资料：按问卷配置校验，另一身份的字段不保存", async () => {
  const srv = await start();
  try {
    const c = client(srv);
    await c.post("/auth/request-code", { email: "d@yale.edu" });
    await c.post("/auth/verify", { email: "d@yale.edu", code: lastCode(srv) });
    const bad = await c.post("/me/profile", { identity: "alumni", answers: { goals: ["x"] } });
    assert.deepEqual(Object.keys(bad.error.fields).sort(), ["city", "contactMethod", "job", "name", "q_field", "q_goals", "q_interests"].sort());
    const ok = await c.post("/me/profile", Object.assign({}, PROFILE, { identity: "alumni", job: "PM", city: "NYC" }));
    assert.deepEqual([ok.data.identity, ok.data.stage, ok.data.gradYear], ["alumni", "", null]);
  } finally { await srv.close(); }
});

test("约咖啡全流程：参加本轮 → 池子里想认识 → 对方想认识 → 匹配，双方收到邮件并看到联系方式 → 选重叠时间 → 提醒", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "a1@yale.edu", { name: "甲" });
    const b = await signUp(srv, "b1@yale.edu", { name: "乙", identity: "alumni", job: "PM", city: "NYC", contactMethod: "微信 yi-123", answers: { goals: ["share"], interests: ["hiking"], field: "tech" } });
    const slots = futureSlot(srv).slice(0, 3);
    assert.equal((await a.get("/coffee/pool")).error.reason, "not_joined", "先开放时间才能看池子");
    await a.post("/coffee/availability", { slots });
    await b.post("/coffee/availability", { slots: slots.slice(1) });
    const pool = (await a.get("/coffee/pool")).data;
    assert.deepEqual(pool.map((p) => [p.name, p.overlapCount, p.relation.state]), [["乙", 2, "none"]]);
    assert.equal("contactMethod" in pool[0], false, "池子里看不到联系方式");
    const inv = await a.post("/coffee/invites", { toId: pool[0].id, note: "想聊聊产品", source: "browse" });
    assert.equal(inv.data.matched, false);
    assert.equal((await a.post("/coffee/invites", { toId: pool[0].id })).error.reason, "already_invited");
    const inbox = (await b.get("/coffee/inbox")).data;
    assert.deepEqual([inbox.incoming.length, inbox.incoming[0].name, inbox.incoming[0].note], [1, "甲", "想聊聊产品"]);
    const sentBefore = srv.ctx.mailer.outbox.length;
    assert.equal((await b.post(`/coffee/invites/${inbox.incoming[0].inviteId}/accept`)).data.status, "accepted");
    assert.deepEqual(srv.ctx.mailer.outbox.slice(0, srv.ctx.mailer.outbox.length - sentBefore).map((m) => m.kind), ["match", "match"]);
    const m = (await a.get("/coffee/matches")).data[0];
    assert.deepEqual([m.name, m.contactMethod, m.available.length], ["乙", "微信 yi-123", 2]);
    assert.equal((await a.post(`/coffee/matches/${m.matchId}/schedule`, { slot: slots[0] })).error.reason, "slot_unavailable", "只能选两人都有空的时间");
    assert.equal((await a.post(`/coffee/matches/${m.matchId}/schedule`, { slot: slots[1] })).data.slot, slots[1]);
    assert.equal(srv.ctx.mailer.outbox[0].kind, "scheduled");
    assert.equal((await b.get("/coffee/matches")).data[0].scheduledBy, "them");
    // 前一天提醒：把时间拨到开始前 2 小时
    const r = srv.ctx.coffee.signupWeek(new Date().toISOString());
    await srv.jobs.run(new Date(srv.ctx.coffee.slotStart(r, slots[1]) - 2 * 3600000).toISOString());
    assert.ok(srv.ctx.mailer.outbox.slice(0, 2).every((x) => x.kind === "reminder"));
  } finally { await srv.close(); }
});

test("对方已邀请你时，你点想认识直接匹配；被跳过的邀请对发起人显示为等待回复", async () => {
  const srv = await start();
  try {
    const [a, b, c] = [await signUp(srv, "a2@yale.edu", { name: "A" }), await signUp(srv, "b2@yale.edu", { name: "B" }), await signUp(srv, "c2@yale.edu", { name: "C" })];
    const slots = futureSlot(srv).slice(0, 2);
    for (const x of [a, b, c]) await x.post("/coffee/availability", { slots });
    const ids = Object.fromEntries((await a.get("/coffee/pool")).data.map((p) => [p.name, p.id]));
    const me = (await a.get("/me")).data.id;
    await a.post("/coffee/invites", { toId: ids.B });
    assert.equal((await b.post("/coffee/invites", { toId: me })).data.matched, true);
    await a.post("/coffee/invites", { toId: ids.C });
    const inc = (await c.get("/coffee/inbox")).data.incoming[0];
    await c.post(`/coffee/invites/${inc.inviteId}/skip`);
    assert.deepEqual((await a.get("/coffee/inbox")).data.outgoing.map((o) => [o.name, o.state]), [["C", "waiting"]]);
  } finally { await srv.close(); }
});

test("每天最多一封「有人想认识你」汇总邮件", async () => {
  const srv = await start();
  try {
    const [a, b, c] = [await signUp(srv, "a3@yale.edu", { name: "A" }), await signUp(srv, "b3@yale.edu", { name: "B" }), await signUp(srv, "c3@yale.edu", { name: "C" })];
    const slots = futureSlot(srv).slice(0, 2);
    for (const x of [a, b, c]) await x.post("/coffee/availability", { slots });
    const cId = (await c.get("/me")).data.id;
    await a.post("/coffee/invites", { toId: cId });
    await b.post("/coffee/invites", { toId: cId });
    // 发信窗口是美东 9:00–21:00：取"今天或明天的美东中午"里第一个还没过去的
    const noon = new Date(); noon.setUTCHours(16, 0, 0, 0);
    const at = new Date(noon.getTime() > Date.now() ? noon.getTime() : noon.getTime() + 86400000).toISOString();
    await srv.jobs.run(at);
    const digests = () => srv.ctx.mailer.outbox.filter((m) => m.kind === "invite_digest");
    assert.equal(digests().length, 1);
    assert.match(digests()[0].subject, /2 位/);
    await srv.jobs.run(at);
    assert.equal(digests().length, 1, "同一天不再发");
  } finally { await srv.close(); }
});

test("推荐：参与人数到门槛才开放；推荐理由来自问卷；DeepSeek 失败时退回规则排序", async () => {
  const srv = await start({ DEEPSEEK_API_KEY: "test-key" });
  try {
    const users = [];
    for (let i = 0; i < 6; i++) users.push(await signUp(srv, `r${i}@yale.edu`, { name: "R" + i, answers: { goals: [i % 2 ? "share" : "industry"], interests: ["hiking", "coffee"], field: "tech" } }));
    const slots = futureSlot(srv).slice(0, 2);
    for (const u of users) await u.post("/coffee/availability", { slots });
    assert.equal((await users[0].get("/coffee/recommendations")).data.enabled, false, "6 人不到门槛 20");
    const rid = srv.ctx.coffee.signupWeek(new Date().toISOString()).id;
    srv.db.run("UPDATE rounds SET config = ? WHERE id = ?", JSON.stringify({ poolThreshold: 3, recCount: 2 }), rid);
    srv.ctx.fetch = async () => ({ ok: false, status: 503 });
    const rec = (await users[0].get("/coffee/recommendations")).data;
    assert.deepEqual([rec.enabled, rec.engine, rec.items.length], [true, "rules_fallback", 2]);
    assert.ok(rec.items[0].reasons.some((x) => x.zh.includes("分享经验")), "诉求互补的人排在前面");
    srv.ctx.fetch = async (url, init) => {
      assert.ok(!init.body.includes("R1") && !init.body.includes("微信"), "发给大模型的内容里没有姓名和联系方式");
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"picks":[{"id":"C2","reason":"都爱徒步，可以聊转行"}]}' } }] }) };
    };
    await users[1].post("/coffee/availability", { slots }); // 更新时间会让推荐重新计算
    const rec2 = (await users[1].get("/coffee/recommendations")).data;
    assert.deepEqual([rec2.engine, rec2.items.length, rec2.items[0].reasons[0].zh], ["deepseek", 2, "都爱徒步，可以聊转行"]);
  } finally { await srv.close(); }
});

test("管理员：只有名单里的人能看；能发布活动轮，活动页不登录也能看到", async () => {
  const srv = await start();
  try {
    const u = await signUp(srv, "someone@yale.edu");
    assert.equal((await u.get("/admin/overview")).status, 403);
    const admin = await signUp(srv, "admin@yale.edu");
    const C = srv.ctx.coffee, today = C.weeklyRound(new Date().toISOString()).startDate, later = C.addDays(today, 13); // 从本周一开始，保证此刻在活动期内
    const r = await admin.post("/admin/rounds", { title: { zh: "Coffee Chat 月", en: "Coffee Chat Month" }, startDate: today, endDate: later, status: "published", post: { body: "介绍文" } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await client(srv).get("/rounds/events")).data[0].title.zh, "Coffee Chat 月");
    assert.equal((await u.get("/coffee/state")).data.round.kind, "event", "活动轮进行中时优先");
    assert.equal((await admin.get("/admin/overview")).data.users.total, 2);
    const audit = (await admin.get("/admin/audit")).data;
    assert.ok(audit.some((x) => x.op === "GET /admin/overview" && x.ok === 1) && audit.some((x) => x.op === "GET /admin/overview" && x.ok === 0), "管理员查看和被拒绝的查看都留痕");
  } finally { await srv.close(); }
});

test("安全：写请求必须是 JSON；跨站来源被拒绝；注销会删除个人数据", async () => {
  const srv = await start();
  try {
    const r1 = await fetch(srv.base + "/auth/request-code", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=a@yale.edu" });
    assert.equal(r1.status, 400);
    const r2 = await fetch(srv.base + "/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
    assert.equal(r2.status, 403);
    const c = await signUp(srv, "gone@yale.edu");
    assert.equal((await c.post("/me/delete", { confirm: "DELETE" })).data.deleted, true);
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM users WHERE login_email = 'gone@yale.edu'").n, 0);
  } finally { await srv.close(); }
});

test("放在反向代理后面（TRUST_PROXY=1）时按真实 IP 限流；没开启时不采信 X-Forwarded-For", async () => {
  const send = (srv, ip, i) => fetch(srv.base + "/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify({ email: `p${i}-${ip.replace(/\./g, "")}@yale.edu` }) }).then((r) => r.status);
  const behind = await start({ TRUST_PROXY: "1" });
  try {
    for (let i = 0; i < 20; i++) assert.equal(await send(behind, "1.1.1.1", i), 200);
    assert.equal(await send(behind, "1.1.1.1", 20), 429, "同一个真实 IP 每小时 20 次");
    assert.equal(await send(behind, "2.2.2.2", 0), 200, "别的同学不受影响");
  } finally { await behind.close(); }
  const direct = await start();
  try {
    for (let i = 0; i < 20; i++) await send(direct, "3.3.3." + i, i);
    assert.equal(await send(direct, "4.4.4.4", 0), 429, "没开启时伪造的 X-Forwarded-For 无效");
  } finally { await direct.close(); }
});
