// 上线前修改清单（PRD 附录 B.4）和 §7.4 里"还没有自动测试"的规则。测试名就是规则。
const test = require("node:test");
const assert = require("node:assert/strict");
const { start, client, lastCode, PROFILE, signUp, futureSlot, rewindCodes } = require("./helpers");

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const mondayOf = (C, day) => C.addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
// 同一个人用联系邮箱收码登录（前提：联系邮箱已验证、一年内用耶鲁邮箱验证过）
async function loginViaContact(srv, email) {
  rewindCodes(srv);
  const c = client(srv);
  await c.post("/auth/request-code", { email });
  const v = await c.post("/auth/verify", { email, code: lastCode(srv, email.replace(/@.*/, "@example.com")) });
  assert.equal(v.data.user.via, "contact");
  return c;
}
// 只登录、不做首次填写
async function loginOnly(srv, email) {
  const c = client(srv);
  await c.post("/auth/request-code", { email });
  assert.equal((await c.post("/auth/verify", { email, code: lastCode(srv, email) })).ok, true);
  return c;
}
// 管理员发布一个此刻进行中的活动轮（从本周一开始，10 天）
async function publishOpenEvent(srv, admin) {
  const C = srv.ctx.coffee, start0 = C.weeklyRound(new Date().toISOString()).startDate;
  const r = await admin.post("/admin/rounds", { title: { zh: "测试活动", en: "Test event" }, startDate: start0, endDate: C.addDays(start0, 10), status: "published" });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
}
const openSlots = (srv, round) => { const C = srv.ctx.coffee, t = new Date().toISOString(); return C.slotIds(round).filter((s) => !C.isClosed(round, s, t)); };

/* ---------- B.4 第 1 条：先同意隐私说明 ---------- */

test("没同意当前版本的隐私说明之前，资料、联系邮箱、邮件开关、意见箱都写不进去（forbidden / needs_consent）；同意、退出、注销不受限", async () => {
  const srv = await start();
  try {
    const c = await loginOnly(srv, "nc1@yale.edu");
    const writes = [
      ["/me/profile", PROFILE], ["/me/contact-email", { email: "nc1@example.com" }], ["/me/contact-email/verify", { code: "123456" }],
      ["/me/prefs", { prefs: { weekly: false }, smartRec: false }], ["/feedback", { kind: "idea", text: "希望多办线下活动" }]
    ];
    for (const [p, b] of writes) {
      const r = await c.post(p, b);
      assert.deepEqual([r.status, r.error.code, r.error.reason], [403, "forbidden", "needs_consent"], p);
    }
    const u = srv.db.get("SELECT * FROM users WHERE login_email = 'nc1@yale.edu'");
    assert.deepEqual([u.name, u.contact_email, u.smart_rec, u.prefs.includes('"weekly":true')], [null, null, 1, true], "什么都没写进去");
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM feedback").n, 0);
    assert.equal(srv.ctx.mailer.outbox.filter((m) => m.kind === "contact_code").length, 0, "也没有发联系邮箱验证码");

    assert.equal((await c.post("/me/consent", { version: srv.cfg.consentVersion })).data.needsConsent, false);
    assert.equal((await c.post("/feedback", { kind: "idea", text: "希望多办线下活动" })).ok, true);
    assert.equal((await c.post("/me/prefs", { prefs: { weekly: false }, smartRec: false })).data.prefs.weekly, false);
    srv.db.run("UPDATE users SET consent_version = '2000-01'"); // 隐私说明升版：旧的同意不算
    assert.equal((await c.post("/me/profile", PROFILE)).error.reason, "needs_consent");
    assert.equal((await c.post("/auth/logout")).ok, true, "退出不受限");

    const d = await loginOnly(srv, "nc2@yale.edu");
    assert.equal((await d.post("/me/delete", { confirm: "DELETE" })).data.deleted, true, "没同意也能注销");
  } finally { await srv.close(); }
});

/* ---------- B.4 第 2 条：改联系方式、注销要用耶鲁邮箱登录 ---------- */

test("用联系邮箱登录的人不能改资料里的「联系方式」、也不能注销账号（forbidden / reverify_yale）；第一次填写、联系方式不变时改别的资料不受限", async () => {
  const srv = await start();
  try {
    const yale = await signUp(srv, "cm1@yale.edu"); // 联系方式 "微信 test"
    await yale.post("/me/contact-email/verify", { code: lastCode(srv, "cm1@example.com") });
    const c = await loginViaContact(srv, "cm1@yale.edu");
    const contact = () => srv.db.get("SELECT contact_method FROM users WHERE login_email = 'cm1@yale.edu'").contact_method;

    const changed = await c.post("/me/profile", Object.assign({}, PROFILE, { contactMethod: "微信 someone-else" }));
    assert.deepEqual([changed.status, changed.error.code, changed.error.reason], [403, "forbidden", "reverify_yale"]);
    assert.equal(contact(), "微信 test", "没有改动");
    const same = await c.post("/me/profile", Object.assign({}, PROFILE, { name: "新名字", contactMethod: "  微信 test " }));
    assert.deepEqual([same.data.name, same.data.contactMethod], ["新名字", "微信 test"], "联系方式没变（前后空格不算）就能保存别的资料");

    const del = await c.post("/me/delete", { confirm: "DELETE" });
    assert.deepEqual([del.status, del.error.reason], [403, "reverify_yale"]);
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM users WHERE login_email = 'cm1@yale.edu'").n, 1, "账号还在");

    assert.equal((await yale.post("/me/profile", Object.assign({}, PROFILE, { contactMethod: "微信 new-id" }))).data.contactMethod, "微信 new-id", "耶鲁邮箱登录的会话可以改");
    assert.equal((await yale.post("/me/delete", { confirm: "DELETE" })).data.deleted, true, "也可以注销");

    // 第一次填写资料时还没有联系方式：用联系邮箱登录也可以填
    const n = await loginOnly(srv, "cm2@yale.edu");
    await n.post("/me/consent", { version: srv.cfg.consentVersion });
    await n.post("/me/contact-email", { email: "cm2@example.com" });
    await n.post("/me/contact-email/verify", { code: lastCode(srv, "cm2@example.com") });
    const first = await (await loginViaContact(srv, "cm2@yale.edu")).post("/me/profile", PROFILE);
    assert.equal(first.data.contactMethod, "微信 test");
  } finally { await srv.close(); }
});

/* ---------- B.4 第 3 条：记访问、7 日回访 ---------- */

test("带登录状态的请求记一次访问：每人每个 UTC 日最多写一次库（users.last_seen_at + user_visits），会话删掉也不丢；注销时一起删除", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "ls1@yale.edu");
    const id = (await a.get("/me")).data.id;
    const seen = () => srv.db.get("SELECT last_seen_at FROM users WHERE id = ?", id).last_seen_at;
    const days = () => srv.db.all("SELECT day FROM user_visits WHERE user_id = ? ORDER BY day", id).map((r) => r.day);
    const first = seen();
    assert.equal(first.slice(0, 10), today());
    await a.get("/auth/me"); await a.get("/me");
    assert.equal(seen(), first, "同一天的后续请求不再写库");
    assert.deepEqual(days(), [today()]);

    const yesterday = new Date(Date.now() - DAY).toISOString();
    srv.db.run("UPDATE users SET last_seen_at = ? WHERE id = ?", yesterday, id);
    srv.db.run("UPDATE user_visits SET day = ? WHERE user_id = ?", yesterday.slice(0, 10), id);
    await a.get("/auth/me"); // 打开网站时网页会先调这个
    assert.equal(seen().slice(0, 10), today(), "新的一天：更新最近访问时间");
    assert.deepEqual(days(), [yesterday.slice(0, 10), today()]);

    await a.post("/auth/logout", { all: true }); // 会话整行删掉，访问记录还在
    assert.equal(days().length, 2);
    await client(srv).get("/auth/me"); // 没登录的请求不记
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM user_visits").n, 2);

    rewindCodes(srv);
    const again = await loginOnly(srv, "ls1@yale.edu");
    await again.post("/me/delete", { confirm: "DELETE" });
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM user_visits WHERE user_id = ?", id).n, 0, "注销时删除访问记录");
  } finally { await srv.close(); }
});

test("后台概览的 7 日回访：按注册那天所在的周分组（最近 4 周），只算注册后第 2–7 天又来过的人，注册当天和第 8 天不算", async () => {
  const srv = await start();
  try {
    const admin = await signUp(srv, "admin@yale.edu");
    const C = srv.ctx.coffee, monday = mondayOf(C, today()), week = C.addDays(monday, -14); // 两周前那一周：数字已经定了
    const add = (id, regDay, visitDays) => {
      srv.db.run("INSERT INTO users (id, login_email, yale_verified_at, prefs, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)", id, id + "@yale.edu", regDay + "T15:00:00.000Z", regDay + "T15:00:00.000Z", regDay + "T15:00:00.000Z");
      visitDays.forEach((d) => srv.db.run("INSERT INTO user_visits (user_id, day) VALUES (?, ?)", id, d));
    };
    add("r-day1", week, [week]);                                   // 只在注册当天来过：不算
    add("r-day2", week, [week, C.addDays(week, 1)]);               // 第 2 天：算
    add("r-day7", C.addDays(week, 2), [C.addDays(week, 8)]);       // 周三注册、第 7 天回来：算（回访日期落在下一周也照算）
    add("r-day8", week, [C.addDays(week, 7)]);                     // 第 8 天：不算
    add("r-sun", C.addDays(week, 6), [C.addDays(week, 12)]);       // 周日注册、第 7 天回来：算
    add("r-old", C.addDays(week, -7), [C.addDays(week, -6)]);      // 三周前那一周
    add("r-older", C.addDays(monday, -28), [C.addDays(monday, -27)]); // 第 5 周前：不在最近 4 周里

    const cohorts = (await admin.get("/admin/overview")).data.retention.cohorts;
    assert.deepEqual(cohorts.map((x) => x.week), [0, 7, 14, 21].map((n) => C.addDays(monday, -n)), "最近 4 周，新的在前，按周一标记");
    const pick = (w) => { const x = cohorts.find((c) => c.week === w); return [x.registered, x.returned, x.complete]; };
    assert.deepEqual(pick(week), [5, 3, true]);
    assert.deepEqual(pick(C.addDays(week, -7)), [1, 1, true]);
    assert.deepEqual(pick(monday), [1, 0, false], "这一周（管理员今天注册）还没满 7 天");
  } finally { await srv.close(); }
});

/* ---------- B.4 第 4 条：参与人数同一个口径 ---------- */

test("参与人数同一个口径：后台概览、活动页、约咖啡首页都只算资料完整并同意了当前版本隐私说明的人", async () => {
  const srv = await start();
  try {
    const admin = await signUp(srv, "admin@yale.edu");
    const ev = await publishOpenEvent(srv, admin);
    const [a, b] = [await signUp(srv, "pc1@yale.edu"), await signUp(srv, "pc2@yale.edu")];
    const slots = openSlots(srv, ev).slice(0, 2);
    for (const x of [a, b]) assert.equal((await x.post("/coffee/availability", { slots })).data.id, ev.id);
    const counts = async () => [
      (await admin.get("/admin/overview")).data.round.participants,
      (await client(srv).get("/rounds/" + ev.id)).data.participants,
      (await client(srv).get("/rounds/events")).data[0].participants,
      (await a.get("/coffee/state")).data.participants
    ];
    assert.deepEqual(await counts(), [2, 2, 2, 2]);
    srv.db.run("UPDATE users SET consent_version = '2000-01' WHERE login_email = 'pc2@yale.edu'"); // 隐私说明升版后还没重新同意
    assert.deepEqual(await counts(), [1, 1, 1, 1]);
  } finally { await srv.close(); }
});

/* ---------- B.4 第 5 条：举报 ---------- */

test("意见箱可以选「举报」类型；类型只能是问题 / 建议 / 举报 / 其他", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "fb1@yale.edu");
    assert.equal((await a.post("/feedback", { kind: "report", text: "第 3 周的某某反复发骚扰消息" })).ok, true);
    assert.equal((await a.post("/feedback", { kind: "spam", text: "第 3 周的某某反复发骚扰消息" })).error.fields.kind, "invalid");
    const admin = await signUp(srv, "admin@yale.edu");
    assert.deepEqual((await admin.get("/admin/feedback")).data.map((f) => f.kind), ["report"]);
  } finally { await srv.close(); }
});

/* ---------- B.4 第 6 条：见到了吗可以改 ---------- */

test("没约时间时「其实还没聊」撤回回答（met: null，不记成没见到）；约了新时间会清空之前的回答；约了时间之后不能撤回", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "oc1@yale.edu", { name: "甲" });
    const b = await signUp(srv, "oc2@yale.edu", { name: "乙", contactMethod: "微信 yi" });
    const slots = futureSlot(srv).slice(0, 3);
    await a.post("/coffee/availability", { slots }); await b.post("/coffee/availability", { slots });
    await a.post("/coffee/invites", { toId: (await a.get("/coffee/pool")).data[0].id });
    await b.post(`/coffee/invites/${(await b.get("/coffee/inbox")).data.incoming[0].inviteId}/accept`);
    let m = (await a.get("/coffee/matches")).data[0];
    const outcome = (met) => a.post(`/coffee/matches/${m.matchId}/outcome`, { met });
    const stored = () => JSON.parse(srv.db.get("SELECT outcomes FROM invites").outcomes);

    assert.equal((await outcome(true)).data.outcome, "met");
    assert.equal((await outcome(null)).data.outcome, null, "其实还没聊：撤回");
    assert.deepEqual(stored(), {}, "没有留下 missed");
    await outcome(true); // 再说一次聊过了，然后对方约了一个新时间
    const slot = m.available[0];
    assert.equal((await b.post(`/coffee/matches/${m.matchId}/schedule`, { slot })).ok, true);
    m = (await a.get("/coffee/matches")).data[0];
    assert.deepEqual([m.slot, m.myOutcome, m.canReport], [slot, null, false], "约了新时间：之前的回答不算这次见面");
    assert.deepEqual(stored(), {});
    assert.equal((await outcome(null)).error.reason, "too_early", "约了时间：开始前不能回答，也不能撤回");
    const admin = await signUp(srv, "admin@yale.edu");
    assert.equal((await admin.get("/admin/overview")).data.allTime.missed, 0, "后台统计里没有多出没见到");
  } finally { await srv.close(); }
});

/* ---------- B.4 第 11 条：演示数据 ---------- */

test("演示数据可以重复运行：已有的演示用户也会加入当前这一轮（进行中的活动轮优先），不重复建人", async () => {
  const srv = await start();
  try {
    const { seed } = require("../../server/seed");
    const C = srv.ctx.coffee, r1 = seed(srv);
    assert.deepEqual([r1.created, r1.joined, r1.round.kind, r1.participants], [24, 24, "weekly", 24]);
    const r2 = seed(srv);
    assert.deepEqual([r2.created, r2.joined, r2.participants], [0, 0, 24], "再跑一次什么都不变");

    // 周六切到下一周之后再跑：演示用户加入新的报名周
    const week = C.signupWeek(new Date().toISOString()), nextSat = C.addDays(week.startDate, 12) + "T16:00:00.000Z";
    const r3 = seed(srv, nextSat);
    assert.deepEqual([r3.round.id, r3.created, r3.joined, r3.participants], ["week-" + C.addDays(week.startDate, 14), 0, 24, 24]);

    // 活动轮进行中：加入活动轮
    const ev = await publishOpenEvent(srv, await signUp(srv, "admin@yale.edu"));
    const r4 = seed(srv);
    assert.deepEqual([r4.round.id, r4.created, r4.joined, r4.participants], [ev.id, 0, 24, 24]);
    const slots = srv.db.all("SELECT slots FROM participations WHERE round_id = ?", ev.id).map((r) => JSON.parse(r.slots));
    assert.ok(slots.every((s) => s.length >= 8 && s.every((x) => !C.isClosed(ev, x, new Date().toISOString()))), "选的都是还能约的时间");
    assert.equal(srv.db.get("SELECT COUNT(*) n FROM users WHERE login_email LIKE 'demo%@demo.yale.edu'").n, 24);
  } finally { await srv.close(); }
});

/* ---------- §7.4 "还没有自动测试"的规则 ---------- */

test("每 365 天要用耶鲁邮箱重新验证一次：超过 365 天，登录验证码只发到耶鲁邮箱；验证后重新计时", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "y1@yale.edu");
    await a.post("/me/contact-email/verify", { code: lastCode(srv, "y1@example.com") });
    srv.db.run("UPDATE users SET yale_verified_at = ? WHERE login_email = 'y1@yale.edu'", iso(Date.now() - 366 * DAY));
    rewindCodes(srv);
    const c = client(srv);
    await c.post("/auth/request-code", { email: "y1@yale.edu" });
    assert.equal(srv.ctx.mailer.outbox[0].to, "y1@yale.edu", "超过 365 天：不发联系邮箱");
    assert.equal((await c.post("/auth/verify", { email: "y1@yale.edu", code: lastCode(srv, "y1@yale.edu") })).data.user.via, "yale");
    rewindCodes(srv);
    await client(srv).post("/auth/request-code", { email: "y1@yale.edu" });
    assert.equal(srv.ctx.mailer.outbox[0].to, "y1@example.com", "重新计时：又发到联系邮箱");
  } finally { await srv.close(); }
});

test("每周邮件只发给同意了当前版本的人；系统第一次启动的那一周不发；重复跑定时任务不重发；活动邮件同样只发给同意了当前版本的人", async () => {
  const srv = await start();
  try {
    await signUp(srv, "wk1@yale.edu"); await signUp(srv, "wk2@yale.edu");
    srv.db.run("UPDATE users SET consent_version = '2000-01' WHERE login_email = 'wk2@yale.edu'");
    const C = srv.ctx.coffee, weekly = () => srv.ctx.mailer.outbox.filter((m) => m.kind === "weekly").map((m) => m.to);
    const w1 = C.signupWeek(new Date().toISOString());
    const monNoon = (w) => iso(C.slotStart(w, w.startDate + "T12:00"));

    await srv.jobs.run(monNoon(w1)); // 系统在这一周中途才第一次启动（这一轮是现在才建的）
    assert.deepEqual(weekly(), []);
    assert.ok(srv.db.get("SELECT announced_at FROM rounds WHERE id = ?", w1.id).announced_at, "这一周就算处理完了");

    const w2 = C.weeklyRound(iso(C.slotStart(w1, w1.startDate + "T12:00") + 7 * DAY));
    srv.coffee.currentRound(iso(C.slotStart(w1, C.addDays(w1.startDate, 5) + "T12:00"))); // 周六开放下一周报名：下一周的轮提前建好
    await srv.jobs.run(monNoon(w2));
    assert.deepEqual(weekly(), ["wk1@yale.edu"], "没重新同意的 wk2 收不到（wk1 的联系邮箱没验证，所以发到耶鲁邮箱）");
    await srv.jobs.run(monNoon(w2));
    await srv.jobs.run(iso(C.slotStart(w2, w2.startDate + "T18:00")));
    assert.equal(weekly().length, 1, "重复跑不重发");

    const admin = await signUp(srv, "admin@yale.edu");
    await publishOpenEvent(srv, admin);
    await srv.jobs.run();
    assert.deepEqual(srv.ctx.mailer.outbox.filter((m) => m.kind === "event").map((m) => m.to).sort(), ["admin@yale.edu", "wk1@yale.edu"]);
  } finally { await srv.close(); }
});

test("活动轮：和另一个已发布的活动轮日期重叠就不能发布（存草稿可以）；最长 31 天", async () => {
  const srv = await start();
  try {
    const admin = await signUp(srv, "admin@yale.edu");
    const C = srv.ctx.coffee, d0 = C.addDays(C.weeklyRound(new Date().toISOString()).startDate, 28);
    const save = (startDate, days, status, id) => admin.post("/admin/rounds", { id, title: { zh: "活动", en: "Event" }, startDate, endDate: C.addDays(startDate, days - 1), status });
    assert.equal((await save(d0, 7, "published")).ok, true);
    assert.equal((await save(C.addDays(d0, 6), 5, "published")).error.reason, "overlaps_event", "最后一天重叠也不行");
    const draft = await save(C.addDays(d0, 6), 5, "draft");
    assert.equal(draft.ok, true, "草稿可以");
    assert.equal((await save(C.addDays(d0, 6), 5, "published", draft.data.id)).error.reason, "overlaps_event", "草稿发布时同样检查");
    assert.equal((await save(C.addDays(d0, 7), 5, "published", draft.data.id)).ok, true, "紧挨着不算重叠");
    assert.equal((await save(C.addDays(d0, 40), 31, "draft")).ok, true, "31 天可以");
    assert.equal((await save(C.addDays(d0, 80), 32, "draft")).error.fields.endDate, "too_long");
  } finally { await srv.close(); }
});

test("限频：联系邮箱验证码每人每小时最多 5 次；全站每小时最多 600 封验证码，超过时提示稍后再试并在服务器日志记一条警报", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "rl1@yale.edu"); // 首次填写时已经发过 1 次
    for (let i = 0; i < 4; i++) { rewindCodes(srv); assert.equal((await a.post("/me/contact-email", { email: `rl1-${i}@example.com` })).ok, true, "第 " + (i + 2) + " 次"); }
    rewindCodes(srv);
    assert.equal((await a.post("/me/contact-email", { email: "rl1-x@example.com" })).error.reason, "too_many_requests", "第 6 次");

    const t = new Date().toISOString(), have = srv.db.get("SELECT COUNT(*) n FROM login_codes").n;
    for (let i = have; i < 600; i++) srv.db.run("INSERT INTO login_codes (purpose, user_key, target, code_hash, created_at, expires_at) VALUES ('login', ?, 'yale', 'x', ?, ?)", "fill" + i + "@yale.edu", t, t);
    const logged = [], err = console.error;
    console.error = (...m) => logged.push(m.join(" "));
    try {
      const r = await client(srv).post("/auth/request-code", { email: "rl2@yale.edu" });
      assert.deepEqual([r.status, r.error.reason], [429, "busy"]);
    } finally { console.error = err; }
    assert.ok(logged.some((m) => m.includes("ALERT")), "服务器日志里有警报");
  } finally { await srv.close(); }
});

test("同一网络地址每小时最多验证 60 次（不是耶鲁邮箱的请求不算）；IPv6 按 /64 算同一个地址", async () => {
  const srv = await start();
  try {
    const c = client(srv);
    for (let i = 0; i < 5; i++) assert.equal((await c.post("/auth/verify", { email: "x@gmail.com", code: "000000" })).error.fields.email, "not_yale");
    for (let i = 0; i < 60; i++) assert.equal((await c.post("/auth/verify", { email: "v" + i + "@yale.edu", code: "000000" })).status, 400);
    const r = await c.post("/auth/verify", { email: "v60@yale.edu", code: "000000" });
    assert.deepEqual([r.status, r.error.reason], [429, "too_many_requests"]);

    const { ipKey } = require("../../server/auth");
    assert.equal(ipKey("2001:db8:1:2::1"), ipKey("2001:DB8:1:2:ffff:ffff:ffff:ffff"), "同一个 /64");
    assert.notEqual(ipKey("2001:db8:1:2::1"), ipKey("2001:db8:1:3::1"), "不同的 /64");
    assert.equal(ipKey("::ffff:1.2.3.4"), "1.2.3.4", "IPv4 映射地址按 IPv4 算");
  } finally { await srv.close(); }
});

test("验证联系邮箱之后：通知改发到联系邮箱，这个人其他设备上的登录全部下线（当前这台保留）", async () => {
  const srv = await start();
  try {
    const a = await signUp(srv, "cv1@yale.edu");
    rewindCodes(srv);
    const other = await loginOnly(srv, "cv1@yale.edu"); // 另一台设备
    const user = () => srv.db.get("SELECT * FROM users WHERE login_email = 'cv1@yale.edu'");
    await srv.ctx.mailer.send("weekly", user(), {});
    assert.equal(srv.ctx.mailer.outbox[0].to, "cv1@yale.edu", "验证之前发到耶鲁邮箱");
    assert.equal((await a.post("/me/contact-email/verify", { code: lastCode(srv, "cv1@example.com") })).data.contactVerified, true);
    assert.equal((await other.get("/me")).status, 401, "其他设备下线");
    assert.equal((await a.get("/me")).ok, true, "当前这台保留");
    await srv.ctx.mailer.send("weekly", user(), {});
    assert.equal(srv.ctx.mailer.outbox[0].to, "cv1@example.com", "验证之后发到联系邮箱");
  } finally { await srv.close(); }
});
