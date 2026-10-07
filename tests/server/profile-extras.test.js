// RFC 0003：原始报名表字段、自由留言、简历（谁能看）、导师与嘉宾邮箱。测试名就是规则。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { start, client, lastCode, PROFILE, signUp, futureSlot, rewindCodes } = require("./helpers");
const { samplePdf } = require("../../server/seed");

const PDF = samplePdf(["Sample resume", "Fictional test person"]);
const resumeFiles = (srv) => { try { return fs.readdirSync(path.join(srv.dir, "resumes")).sort(); } catch (e) { return []; } };
const idOf = async (c) => (await c.get("/me")).data.id;
// 下载：返回 { status, headers, body }
async function download(c, p) {
  const r = await c.raw("GET", p);
  return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
}
// 只登录（不做首次填写）
async function loginOnly(srv, email) {
  const c = client(srv);
  const r = await c.post("/auth/request-code", { email });
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = await c.post("/auth/verify", { email, code: lastCode(srv, email) });
  assert.equal(v.ok, true, JSON.stringify(v));
  return c;
}

test("资料新字段：英文名、项目、见面方式和地点、自由留言能保存并原样读回；卡片上有英文名、项目、见面方式、角色、自由留言，具体地点和联系方式只在匹配后给", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "pe1@yale.edu", { name: "王五", preferredName: " Wu ", program: "Statistics and Data Science", meetMode: "online", meetPlace: "Zoom（匹配后发链接）", freeText: "第一行\r\n\r\n\r\n\r\n第二行‮" });
    const me = (await a.get("/me")).data;
    assert.deepEqual([me.preferredName, me.program, me.meetMode, me.meetPlace, me.freeText, me.role, me.isGuest, me.resume], ["Wu", "Statistics and Data Science", "online", "Zoom（匹配后发链接）", "第一行\n\n第二行", "member", false, null]);

    const bad = await a.post("/me/profile", Object.assign({}, PROFILE, { meetMode: "moon", program: "", freeText: "字".repeat(501), preferredName: "W".repeat(41), meetPlace: "z".repeat(201) }));
    assert.deepEqual(bad.error.fields, { program: "required", meetMode: "invalid", freeText: "too_long", preferredName: "too_long", meetPlace: "too_long" });
    assert.equal((await a.post("/me/profile", Object.assign({}, PROFILE, { meetMode: undefined }))).error.fields.meetMode, "required");
    assert.equal((await a.get("/me")).data.program, "Statistics and Data Science", "被拒时整份资料都没有保存");

    // 博士后不要求毕业年份；切换成校友时清空在读的字段
    const pd = await a.post("/me/profile", Object.assign({}, PROFILE, { stage: "postdoc", gradYear: "", program: "Chemistry", meetMode: "online" }));
    assert.deepEqual([pd.data.stage, pd.data.gradYear, pd.data.program], ["postdoc", null, "Chemistry"]);
    const al = await a.post("/me/profile", Object.assign({}, PROFILE, { name: "王五", identity: "alumni", job: "PM", city: "New Haven", meetMode: "newhaven", meetPlace: "Bluebook Café（虚构）", preferredName: "Wu", freeText: "你好" }));
    assert.deepEqual([al.data.stage, al.data.gradYear, al.data.program, al.data.job], ["", null, "", "PM"]);

    const b = await signUp(srv, "pe2@yale.edu", { name: "乙", meetMode: "either", meetPlace: "乙的地点", contactMethod: "微信 yi" });
    const slots = futureSlot(srv).slice(0, 2);
    await a.post("/coffee/availability", { slots });
    await b.post("/coffee/availability", { slots });
    const card = (await b.get("/coffee/pool")).data[0];
    assert.deepEqual([card.name, card.preferredName, card.program, card.meetMode, card.role, card.freeText, card.identity], ["王五", "Wu", "", "newhaven", "member", "你好", "alumni"]);
    for (const k of ["meetPlace", "contactMethod", "contactEmail", "loginEmail", "hasResume"]) assert.equal(k in card, false, "池子卡片上没有 " + k);
    assert.equal("meetPlace" in (await b.get("/coffee/people/" + card.id)).data, false, "详情页也没有具体地点");
  } finally { await srv.close(); }
});

test("匹配页：每条带对方的具体地点、我的地点，以及这次匹配里谁是被邀请的一方（地点以被邀请人为准）", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "mp1@yale.edu", { name: "甲", meetPlace: "甲的咖啡馆（虚构）" });
    const b = await signUp(srv, "mp2@yale.edu", { name: "乙", meetMode: "online", meetPlace: "乙的 Zoom" });
    const slots = futureSlot(srv).slice(0, 2);
    await a.post("/coffee/availability", { slots });
    await b.post("/coffee/availability", { slots });
    await a.post("/coffee/invites", { toId: await idOf(b) });
    const inc = (await b.get("/coffee/inbox")).data.incoming[0];
    assert.equal((await b.post(`/coffee/invites/${inc.inviteId}/accept`)).ok, true);
    const ma = (await a.get("/coffee/matches")).data[0], mb = (await b.get("/coffee/matches")).data[0];
    assert.deepEqual([ma.meetPlace, ma.myMeetPlace, ma.invitee, ma.meetMode], ["乙的 Zoom", "甲的咖啡馆（虚构）", "them", "online"]);
    assert.deepEqual([mb.meetPlace, mb.myMeetPlace, mb.invitee], ["甲的咖啡馆（虚构）", "乙的 Zoom", "me"]);
  } finally { await srv.close(); }
});

test("身份「嘉宾」只有嘉宾能选：耶鲁邮箱的同学选了报 identity = invalid", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "gi1@yale.edu");
    const r = await a.post("/me/profile", Object.assign({}, PROFILE, { identity: "guest", job: "Visiting Scholar", city: "New Haven" }));
    assert.deepEqual(r.error.fields, { identity: "invalid" });
    assert.equal((await a.get("/me")).data.isGuest, false);
  } finally { await srv.close(); }
});

test("嘉宾邮箱：没登记的非耶鲁邮箱登录不了；登记后能收验证码登录、身份能选「嘉宾」、联系邮箱和登录邮箱相同直接算已验证；删除登记后不能再建立新会话，已有会话和数据保留", async () => {
  const srv = await start();
  try {
    const email = "guest.one@example.com";
    const g0 = client(srv);
    assert.equal((await g0.post("/auth/request-code", { email })).error.fields.email, "not_yale");
    const admin = await signUp(srv, "admin@yale.edu");
    const added = await admin.post("/admin/guests", { email: "  Guest.One@Example.com ", note: " 创新\n学者 " });
    assert.deepEqual(added.data.guests.map((x) => [x.email, x.note, x.registered, x.name]), [[email, "创新 学者", false, null]], "邮箱存小写，备注按单行清洗");

    const g = await loginOnly(srv, email);
    let me = (await g.get("/me")).data;
    assert.deepEqual([me.loginEmail, me.isGuest, me.via], [email, true, "yale"]);
    await g.post("/me/consent", { version: srv.cfg.consentVersion });
    rewindCodes(srv); // 60 秒内不能重发：把上一封验证码的时间拨回去
    const g2 = await loginOnly(srv, email); // 第二台设备
    const sentBefore = srv.ctx.mailer.outbox.length;
    const ce = await g.post("/me/contact-email", { email: "GUEST.ONE@example.com" });
    assert.deepEqual([ce.data.contactEmail, ce.data.contactVerified, "sentTo" in ce.data], [email, true, false], "和登录邮箱相同：不发验证码，直接算已验证");
    assert.equal(srv.ctx.mailer.outbox.length, sentBefore, "没有发信");
    assert.equal((await g2.get("/me")).status, 401, "和正常验证一样：其他设备下线");
    assert.equal((await g.get("/me")).status, 200, "当前这台保留");

    const p = await g.post("/me/profile", Object.assign({}, PROFILE, { identity: "guest", job: "Visiting Scholar", city: "New Haven", stage: "phd", program: "x" }));
    assert.deepEqual([p.data.identity, p.data.job, p.data.stage, p.data.program, p.data.ready], ["guest", "Visiting Scholar", "", "", true]);
    assert.deepEqual((await admin.get("/admin/members")).data.guests.map((x) => [x.registered, x.name]), [[true, "测试同学"]]);

    // 之后登录：验证码发到同一个邮箱，这次登录照样算登录邮箱（不会被当成"联系邮箱登录"而不能注销、改联系方式）
    rewindCodes(srv);
    const g3 = await loginOnly(srv, email);
    assert.equal((await g3.get("/me")).data.via, "yale");

    // 删除登记：手里还没用的验证码也建立不了新会话；已有会话和资料照旧
    rewindCodes(srv);
    const pending = client(srv);
    await pending.post("/auth/request-code", { email });
    const code = lastCode(srv, email);
    assert.equal((await admin.post("/admin/guests/delete", { email })).data.guests.length, 0);
    assert.equal((await pending.post("/auth/verify", { email, code })).error.fields.email, "not_yale");
    rewindCodes(srv);
    assert.equal((await client(srv).post("/auth/request-code", { email })).error.fields.email, "not_yale");
    assert.equal((await g.get("/me")).data.identity, "guest", "已有会话照旧");
    assert.equal((await g.post("/me/profile", Object.assign({}, PROFILE, { identity: "guest", job: "Scholar", city: "Boston" }))).data.job, "Scholar", "已有会话还能以嘉宾身份改资料");
    assert.equal((await admin.post("/admin/guests/delete", { email })).error.code, "not_found");
  } finally { await srv.close(); }
});

test("耶鲁同学把联系邮箱填成登录邮箱：同样直接算已验证，不发验证码", async () => {
  const srv = await start();
  try {
    const c = await loginOnly(srv, "same1@yale.edu");
    await c.post("/me/consent", { version: srv.cfg.consentVersion });
    const before = srv.ctx.mailer.outbox.length;
    const r = await c.post("/me/contact-email", { email: "same1@yale.edu" });
    assert.deepEqual([r.data.contactVerified, srv.ctx.mailer.outbox.length], [true, before]);
    // 换成别的邮箱：照旧发验证码
    const r2 = await c.post("/me/contact-email", { email: "same1@example.com" });
    assert.deepEqual([r2.data.contactVerified, r2.data.sentTo, srv.ctx.mailer.outbox[0].to], [false, "s****@example.com", "same1@example.com"]);
  } finally { await srv.close(); }
});

test("后台成员接口只给管理员：普通用户 forbidden、没登录 unauthorized；邮箱校验和登录一样严格；审计里不记嘉宾邮箱", async () => {
  const srv = await start();
  try {
    const u = await signUp(srv, "nm1@yale.edu");
    const anon = client(srv);
    for (const [m, p, b] of [["GET", "/admin/members"], ["POST", "/admin/guests", { email: "x@example.com" }], ["POST", "/admin/guests/delete", { email: "x@example.com" }], ["POST", "/admin/mentors", { email: "nm1@yale.edu", mentor: true }]]) {
      const r1 = m === "GET" ? await u.get(p) : await u.post(p, b);
      const r2 = m === "GET" ? await anon.get(p) : await anon.post(p, b);
      assert.deepEqual([r1.status, r2.status], [403, 401], p);
    }
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM guest_emails").n, 0);
    assert.equal(srv.db.get("SELECT role FROM users WHERE login_email = 'nm1@yale.edu'").role, "member");

    const admin = await signUp(srv, "admin@yale.edu");
    for (const email of ["", "not-an-email", "a@b", "Name <x@example.com>", "x@example.com, y@example.com"]) {
      assert.equal((await admin.post("/admin/guests", { email })).error.fields.email, "invalid", JSON.stringify(email));
    }
    assert.equal((await admin.post("/admin/guests", { email: "g@example.com", note: "长".repeat(61) })).error.fields.note, "too_long");
    assert.equal((await admin.post("/admin/guests", { email: "g@example.com", note: "第一次" })).ok, true);
    const again = await admin.post("/admin/guests", { email: "g@example.com", note: "改备注" });
    assert.deepEqual(again.data.guests.map((x) => x.note), ["改备注"], "重复登记 = 改备注");
    assert.equal((await admin.post("/admin/mentors", { email: "nobody@yale.edu", mentor: true })).error.code, "not_found");
    assert.equal((await admin.post("/admin/mentors", { email: "nm1@yale.edu", mentor: "yes" })).error.fields.mentor, "invalid");
    const m = await admin.post("/admin/mentors", { email: " NM1@yale.edu ", mentor: true });
    assert.deepEqual(m.data.mentors.map((x) => [x.name, x.loginEmail]), [["测试同学", "nm1@yale.edu"]]);
    assert.equal((await u.get("/me")).data.role, "mentor");
    assert.equal((await admin.post("/admin/mentors", { email: "nm1@yale.edu", mentor: false })).data.mentors.length, 0);

    const ops = srv.db.all("SELECT op, target, ok FROM audit_log WHERE actor = (SELECT id FROM users WHERE login_email = 'admin@yale.edu') AND op LIKE '%/admin/%'");
    assert.ok(ops.some((o) => o.op === "POST /admin/mentors" && o.target === srv.db.get("SELECT id FROM users WHERE login_email = 'nm1@yale.edu'").id && o.ok === 1), "标记导师记下是谁");
    assert.ok(ops.some((o) => o.op === "POST /admin/guests" && o.ok === 1));
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM audit_log WHERE target LIKE '%@%'").n, 0, "审计里没有邮箱");
    await admin.get("/admin/members");
    assert.equal(srv.db.get("SELECT op FROM audit_log ORDER BY id DESC LIMIT 1").op, "GET /admin/members", "管理员查看成员名单也留痕");
  } finally { await srv.close(); }
});

test("导师：卡片上有导师标记；「找人」加 mentor=1 只看导师", async () => {
  const srv = await start();
  try {
    const [a, b, c] = [await signUp(srv, "mt1@yale.edu", { name: "A" }), await signUp(srv, "mt2@yale.edu", { name: "B" }), await signUp(srv, "mt3@yale.edu", { name: "C" })];
    const admin = await signUp(srv, "admin@yale.edu");
    assert.equal((await admin.post("/admin/mentors", { email: "mt2@yale.edu", mentor: true })).ok, true);
    const slots = futureSlot(srv).slice(0, 2);
    for (const x of [a, b, c]) await x.post("/coffee/availability", { slots });
    const all = (await a.get("/coffee/pool")).data;
    assert.deepEqual(all.map((p) => [p.name, p.role]).sort(), [["B", "mentor"], ["C", "member"]]);
    assert.deepEqual((await a.get("/coffee/pool?mentor=1")).data.map((p) => p.name), ["B"]);
    assert.equal((await a.get("/coffee/pool?mentor=0")).data.length, 2, "mentor 不是 1 就不筛");
  } finally { await srv.close(); }
});

test("上传简历：只收 PDF（类型和文件开头都要对）、不能是空的、最大 5 MB；文件名随机、原文件名不保存；替换时删掉旧文件；来源校验照旧；其他接口的请求体上限不变", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "rs1@yale.edu");
    assert.deepEqual((await a.upload("/me/resume", Buffer.from("hello, not a pdf"))).error, { code: "invalid", fields: { resume: "not_pdf" } });
    assert.deepEqual((await a.upload("/me/resume", PDF, "application/json")).error, { code: "invalid", fields: { resume: "not_pdf" } }, "Content-Type 不是 application/pdf");
    assert.deepEqual((await a.upload("/me/resume", Buffer.alloc(0))).error, { code: "invalid", fields: { resume: "empty" } });
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 1 - PDF.length, 32)]);
    const tooBig = await a.upload("/me/resume", big);
    assert.deepEqual([tooBig.status, tooBig.error.code, tooBig.error.fields.resume], [413, "too_large", "too_large"]);
    assert.equal((await a.upload("/me/resume", PDF, "application/pdf", { Origin: "https://evil.example" })).error.reason, "bad_origin");
    assert.equal((await client(srv).upload("/me/resume", PDF)).status, 401);
    assert.deepEqual(resumeFiles(srv), [], "被拒的都没有写文件");

    const exact = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 - PDF.length, 32)]);
    const ok = await a.upload("/me/resume", exact);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.data.resume.size, 5 * 1024 * 1024, "正好 5 MB 可以");
    assert.equal(ok.data.resume.visibility, "invited", "默认只给我邀请的人看");
    const first = resumeFiles(srv);
    assert.equal(first.length, 1);
    assert.match(first[0], /^[a-f0-9]{32}\.pdf$/);

    const again = await a.upload("/me/resume", PDF);
    assert.equal(again.data.resume.size, PDF.length);
    const second = resumeFiles(srv);
    assert.equal(second.length, 1, "替换时删掉旧文件");
    assert.notEqual(second[0], first[0]);
    assert.deepEqual(fs.readFileSync(path.join(srv.dir, "resumes", second[0])), PDF);

    // 其他接口还是 100KB 上限
    const json = await a.raw("POST", "/me/profile", JSON.stringify(Object.assign({}, PROFILE, { freeText: "x".repeat(150 * 1024) })), { "Content-Type": "application/json" });
    assert.equal(json.status, 413);
    assert.equal(srv.db.get("SELECT op FROM audit_log WHERE op = 'POST /me/resume' AND ok = 1 LIMIT 1").op, "POST /me/resume", "上传写审计");
  } finally { await srv.close(); }
});

test("上传简历每人每天最多 20 次（被拒的也算）", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "rl1@yale.edu");
    for (let i = 0; i < 19; i++) assert.equal((await a.upload("/me/resume", PDF)).ok, true, "第 " + (i + 1) + " 次");
    assert.equal((await a.upload("/me/resume", Buffer.from("nope"))).error.fields.resume, "not_pdf");
    const r = await a.upload("/me/resume", PDF);
    assert.deepEqual([r.status, r.error.code, r.error.reason], [429, "rate_limited", "too_many_uploads"]);
    assert.equal(resumeFiles(srv).length, 1);
  } finally { await srv.close(); }
});

test("简历谁能看：本人、匹配过的人、我邀请过的人能看；同一轮的陌生人只有设成「所有人」才能看；邀请过我的人不算；不在这一轮又没往来的人看不了；看不了一律 not_found", async () => {
  const srv = await start();
  try {
    const [o, m, inv, s, y] = [await signUp(srv, "vo@yale.edu", { name: "O" }), await signUp(srv, "vm@yale.edu", { name: "M" }), await signUp(srv, "vi@yale.edu", { name: "I" }), await signUp(srv, "vs@yale.edu", { name: "S" }), await signUp(srv, "vy@yale.edu", { name: "Y" })];
    const x = await signUp(srv, "vx@yale.edu", { name: "X" }); // 不参加这一轮
    const slots = futureSlot(srv).slice(0, 2);
    for (const c of [o, m, inv, s, y]) await c.post("/coffee/availability", { slots });
    const oId = await idOf(o), [mId, iId] = [await idOf(m), await idOf(inv)];
    const url = `/coffee/people/${oId}/resume`;
    const see = async (c) => (await download(c, url)).status;

    // 还没有简历：谁都 not_found，卡片上也没有 hasResume
    assert.deepEqual([await see(o), await see(m)], [404, 404]);
    assert.equal((await o.upload("/me/resume", PDF)).ok, true);

    await o.post("/coffee/invites", { toId: mId });
    const incM = (await m.get("/coffee/inbox")).data.incoming[0];
    assert.equal(incM.hasResume, true, "收件箱里邀请我的人的卡片：能看就带 hasResume");
    await m.post(`/coffee/invites/${incM.inviteId}/accept`);
    await o.post("/coffee/invites", { toId: iId });
    await y.post("/coffee/invites", { toId: oId }); // Y 邀请了 O：O 没邀请 Y

    const nf = await download(s, url);
    assert.deepEqual([nf.status, JSON.parse(nf.body.toString()).error.code], [404, "not_found"]);
    assert.deepEqual([await see(o), await see(m), await see(inv), await see(s), await see(y), await see(x)], [200, 200, 200, 404, 404, 404], "invited");
    assert.equal((await download(o, "/me/resume")).status, 200, "本人从「我的」下载");
    assert.equal((await m.get("/coffee/matches")).data[0].hasResume, true);
    assert.equal((await inv.get("/coffee/inbox")).data.incoming[0].hasResume, true);
    const cardFor = async (c) => (await c.get("/coffee/people/" + oId)).data;
    assert.equal("hasResume" in await cardFor(s), false, "看不了就不带 hasResume（不透露有没有简历）");
    assert.equal("hasResume" in (await y.get("/coffee/pool")).data.find((p) => p.id === oId), false);
    assert.equal((await cardFor(inv)).hasResume, true);

    assert.equal((await o.post("/me/resume/settings", { visibility: "public" })).error.fields.visibility, "invalid");
    assert.equal((await o.post("/me/resume/settings", { visibility: "all" })).data.resume.visibility, "all");
    assert.deepEqual([await see(s), await see(y), await see(x)], [200, 200, 404], "all：同一轮的人能看，不在这一轮的人还是不行");
    assert.equal((await cardFor(s)).hasResume, true);
    assert.equal((await s.get("/coffee/pool")).data.find((p) => p.id === oId).hasResume, true);

    // S 退出这一轮之后就不是同一轮了
    await s.post("/coffee/availability", { slots: [] });
    assert.equal(await see(s), 404);

    // 轮次结束：O 对 I 的邀请不再算数；O 和 M 匹配过（哪怕那一轮结束了）照样能看
    await o.post("/me/resume/settings", { visibility: "invited" });
    srv.db.run("INSERT INTO rounds (id, kind, status, title, theme_tags, config, start_date, end_date, post, created_at, updated_at) VALUES ('week-2020-01-06', 'weekly', 'published', '{}', '[]', '{}', '2020-01-06', '2020-01-12', '{}', ?, ?)", new Date().toISOString(), new Date().toISOString());
    srv.db.run("UPDATE invites SET round_id = 'week-2020-01-06' WHERE from_id = ?", oId);
    assert.deepEqual([await see(m), await see(inv), await see(o)], [200, 404, 200]);

    const d = await download(m, url);
    assert.deepEqual(d.body, PDF);
    assert.deepEqual(["content-type", "content-disposition", "x-content-type-options", "cache-control", "content-security-policy"].map((h) => d.headers.get(h)),
      ["application/pdf", 'inline; filename="resume.pdf"', "nosniff", "private, no-store", "sandbox"]);
    assert.ok(srv.db.get("SELECT COUNT(*) n FROM audit_log WHERE op = 'GET /coffee/people/:id/resume' AND target = ? AND actor = ?", oId, mId).n >= 1, "看别人的简历留审计（谁看了谁的）");
  } finally { await srv.close(); }
});

test("删除简历、注销账号都立即删掉文件；删除简历不要求先同意隐私说明", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "rd1@yale.edu"), b = await signUp(srv, "rd2@yale.edu");
    await a.upload("/me/resume", PDF);
    await b.upload("/me/resume", PDF);
    assert.equal(resumeFiles(srv).length, 2);
    srv.db.run("UPDATE users SET consent_version = '2000-01' WHERE login_email = 'rd1@yale.edu'");
    const del = await a.post("/me/resume/delete");
    assert.deepEqual([del.ok, del.data.resume], [true, null]);
    assert.equal(resumeFiles(srv).length, 1);
    assert.equal((await download(a, "/me/resume")).status, 404);
    assert.equal((await a.upload("/me/resume", PDF)).error.reason, "needs_consent", "上传要先同意当前版本");

    assert.equal((await b.post("/me/delete", { confirm: "DELETE" })).data.deleted, true);
    assert.deepEqual(resumeFiles(srv), [], "注销后文件也没了");
  } finally { await srv.close(); }
});

test("演示数据：新字段都有示例；demo02、demo11 是导师；3 份示例简历（谁能看各不相同）；登记了一个嘉宾邮箱；重复运行不重复写，老的演示用户会补上新字段", async () => {
  const srv = await start();
  try {
    const { seed } = require("../../server/seed");
    const r1 = seed(srv);
    assert.equal(r1.resumes, 3);
    const users = srv.db.all("SELECT login_email, identity, stage, grad_year, program, meet_mode, meet_place, preferred_name, free_text, role, resume_file, resume_visibility FROM users WHERE login_email LIKE 'demo%' ORDER BY login_email");
    assert.equal(users.length, 24);
    assert.deepEqual([...new Set(users.map((u) => u.meet_mode))].sort(), ["either", "newhaven", "online"]);
    assert.ok(users.filter((u) => u.identity === "student").every((u) => u.program), "在读的都有项目");
    assert.ok(users.some((u) => u.preferred_name) && users.some((u) => u.free_text && u.free_text.includes("\n")) && users.some((u) => u.meet_place));
    assert.ok(users.some((u) => u.stage === "postdoc" && u.grad_year === null));
    assert.deepEqual(users.filter((u) => u.role === "mentor").map((u) => u.login_email), ["demo02@demo.yale.edu", "demo11@demo.yale.edu"]);
    assert.deepEqual(users.filter((u) => u.resume_file).map((u) => u.resume_visibility).sort(), ["all", "invited", "invited"]);
    assert.equal(resumeFiles(srv).length, 3);
    for (const u of users) {
      const v = srv.ctx.coffee.validateProfile({ name: "x", identity: u.identity, stage: u.stage, gradYear: u.grad_year, program: u.program, job: "j", city: "c", meetMode: u.meet_mode, meetPlace: u.meet_place, preferredName: u.preferred_name, freeText: u.free_text, contactMethod: "x", answers: { goals: ["friends"], interests: ["hiking"], field: "tech" } }, srv.ctx.questions, new Date().getFullYear() - 1);
      assert.equal(v.ok, true, u.login_email + " " + JSON.stringify(v.fields));
    }
    assert.deepEqual({ ...srv.db.get("SELECT email, note FROM guest_emails") }, { email: "guest.scholar@example.com", note: "创新学者（示例）" });

    srv.db.run("UPDATE users SET meet_mode = NULL, program = NULL WHERE login_email = 'demo03@demo.yale.edu'");
    const r2 = seed(srv);
    assert.deepEqual([r2.created, r2.joined, r2.resumes], [0, 0, 0], "再跑一次什么都不重复写");
    assert.equal(resumeFiles(srv).length, 3);
    const d3 = srv.db.get("SELECT meet_mode, program FROM users WHERE login_email = 'demo03@demo.yale.edu'");
    assert.ok(d3.meet_mode && d3.program, "老的演示用户补上新字段");
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM guest_emails").n, 1);
  } finally { await srv.close(); }
});

test("老数据库升级：迁移 004 的库直接加上新列和嘉宾表，已有用户默认简历只给邀请的人看、角色是普通成员", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yl-old-")), file = path.join(dir, "old.sqlite");
  const migrations = path.join(__dirname, "..", "..", "server", "migrations");
  const raw = new DatabaseSync(file);
  raw.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const name of ["001_init.sql", "002_email_ref.sql", "003_code_forced_yale.sql", "004_last_seen.sql"]) {
    raw.exec(fs.readFileSync(path.join(migrations, name), "utf8"));
    raw.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, "2026-09-01T00:00:00.000Z");
  }
  raw.prepare("INSERT INTO users (id, login_email, yale_verified_at, name, identity, stage, grad_year, created_at, updated_at) VALUES ('u-old', 'old@yale.edu', ?, '老同学', 'student', 'phd', 2028, ?, ?)").run("2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  raw.close();

  const srv = await start({ DB_FILE: file, DATA_DIR: dir });
  try {
    const cols = srv.db.all("PRAGMA table_info(users)").map((c) => c.name);
    for (const c of ["preferred_name", "program", "meet_mode", "meet_place", "free_text", "resume_file", "resume_size", "resume_at", "resume_visibility", "role"]) assert.ok(cols.includes(c), c);
    assert.ok(srv.db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'guest_emails'"));
    const u = srv.db.get("SELECT * FROM users WHERE id = 'u-old'");
    assert.deepEqual([u.name, u.resume_visibility, u.role, u.meet_mode], ["老同学", "invited", "member", null]);
    const me = srv.ctx.meDTO(u, "yale");
    assert.deepEqual([me.meetMode, me.program, me.preferredName, me.freeText, me.role, me.isGuest, me.resume], ["", "", "", "", "member", false, null]);
    assert.ok(srv.db.get("SELECT 1 AS x FROM schema_migrations WHERE name = '005_profile_extras.sql'"));
  } finally { await srv.close(); }
});
