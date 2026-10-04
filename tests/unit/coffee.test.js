// 约咖啡 · 业务规则单测 —— 测试名就是规则，改 web/js/domain/coffee.js 必须同步改这里
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../web/js/domain/coffee.js");
const QUESTIONS = require("../../web/data/matchQuestions.json").questions;

const NOW = "2026-10-06T16:00:00.000Z"; // 周二上午（美东）
const ROUND = R.weeklyRound(NOW);
const S1 = "2026-10-08T19:20", S2 = "2026-10-09T10:00", S3 = "2026-10-10T14:05";
const inv = (from, to, extra) => Object.assign(R.createInvite({ toId: to }, from, ROUND.id, NOW, from + ">" + to), extra);
const check = (over) => R.checkInvite(Object.assign({ round: ROUND, fromId: "a", toId: "b", fromJoined: true, toJoined: true, invites: [], now: NOW }, over));
const answers = (o) => Object.assign({ goals: ["friends"], interests: ["hiking"], field: "tech", intro: "" }, o);

test("问卷配置本身合法（题目 id、选项、双语、互补对、理由模板）", () => {
  assert.deepEqual(R.validateQuestions(require("../../web/data/matchQuestions.json")), []);
  assert.ok(R.validateQuestions({ questions: [{ id: "x", type: "multi", label: { zh: "a" }, options: [] }] }).length >= 2);
});

test("每周一轮：周一到周日，按美东日期算", () => {
  assert.equal(ROUND.id, "week-2026-10-05");
  assert.deepEqual([ROUND.startDate, ROUND.endDate], ["2026-10-05", "2026-10-11"]);
  assert.equal(R.weeklyRound("2026-10-12T03:00:00Z").startDate, "2026-10-05", "周一凌晨 3 点 UTC 在美东还是周日");
  assert.equal(R.isRoundOpen(ROUND, NOW), true);
  assert.equal(R.isRoundOpen(ROUND, "2026-10-12T05:00:00Z"), false);
});

test("活动轮进行中时优先于每周轮；草稿不算", () => {
  const ev = Object.assign({}, ROUND, { id: "ev", kind: "event" });
  assert.equal(R.currentRound([ROUND, ev], NOW).id, "ev");
  assert.equal(R.currentRound([ROUND, Object.assign({}, ev, { status: "draft" })], NOW).id, ROUND.id);
  assert.equal(R.currentRound([], NOW), null);
});

test("周六、周日开放下一周报名（本周剩下的时段都快过截止了）；本周轮到周日结束前仍可回复和约时间", () => {
  assert.equal(R.signupWeek(NOW).id, "week-2026-10-05", "周二：本周");
  assert.equal(R.signupWeek("2026-10-10T03:00:00Z").id, "week-2026-10-05", "周五晚 11 点（美东）：还是本周");
  assert.equal(R.signupWeek("2026-10-10T05:00:00Z").id, "week-2026-10-12", "周六凌晨 1 点（美东）：下一周");
  const next = R.signupWeek("2026-10-11T16:00:00Z");
  assert.equal(R.currentRound([ROUND, next], "2026-10-11T16:00:00Z").id, next.id);
  assert.equal(R.isRoundOver(ROUND, "2026-10-11T16:00:00Z"), false);
  assert.equal(check({ round: next, now: "2026-10-11T16:00:00Z" }).ok, true, "下一周还没开始也可以先发邀请");
  assert.equal(check({ now: "2026-10-12T05:00:00Z" }).reason, "round_closed");
});

test("时间表：每天 10:00–21:00，15 分钟一格、格间 20 分钟；时区含夏令时", () => {
  const t = R.slotTimes(ROUND);
  assert.equal(t.length, 19);
  assert.deepEqual([t[0], t[1], t[18]], ["10:00", "10:35", "20:30"]);
  assert.equal(new Date(R.slotStart(ROUND, "2026-10-08T10:00")).toISOString(), "2026-10-08T14:00:00.000Z");
  assert.equal(new Date(R.slotStart(ROUND, "2026-11-02T10:00")).toISOString(), "2026-11-02T15:00:00.000Z");
  assert.equal(R.validateSlots(ROUND, ["2026-10-08T10:05"]).ok, false);
  assert.deepEqual(R.validateSlots(ROUND, [S2, S1]).slots, [S1, S2], "按时间排序");
});

test("重叠时间：两人都有空、没被别的约占用、离开始超过 12 小时", () => {
  assert.deepEqual(R.overlap(ROUND, [S1, S2, S3], [S2, S3], [], NOW), [S2, S3]);
  assert.deepEqual(R.overlap(ROUND, [S1, S2, S3], [S2, S3], [S3], NOW), [S2]);
  assert.deepEqual(R.overlap(ROUND, [S1], [S1], [], "2026-10-08T12:00:00Z"), [], "开始前不足 12 小时");
});

test("资料：身份决定必填项；联系方式必填；问卷答案按配置校验", () => {
  const base = { name: "王同学", contactMethod: "微信 abc", answers: answers() };
  assert.deepEqual(R.validateProfile(Object.assign({ identity: "student", stage: "master", gradYear: "2027" }, base), QUESTIONS, 2026), { ok: true, fields: {} });
  assert.deepEqual(R.validateProfile(Object.assign({ identity: "alumni", job: "PM", city: "NYC" }, base), QUESTIONS, 2026).ok, true);
  const bad = R.validateProfile({ identity: "student", stage: "postdoc", gradYear: 2040, answers: { goals: ["gossip"], interests: ["a", "b", "c", "d", "e", "f"], field: ["tech", "law"] } }, QUESTIONS, 2026).fields;
  assert.deepEqual(bad, { name: "required", stage: "invalid", gradYear: "invalid", contactMethod: "required", q_goals: "invalid", q_interests: "too_many", q_field: "invalid" });
  assert.equal(R.validateAnswers(QUESTIONS, answers({ interests: ["自定义标签"] })).q_interests, undefined, "允许自定义标签");
  assert.equal(R.validateAnswers(QUESTIONS, answers({ interests: ["这是一个超过十二个字的自定义标签"] })).q_interests, "invalid");
});

test("清洗资料：另一身份的字段清空，多余字段丢弃，只公开 public 的题目", () => {
  const p = R.cleanProfile({ identity: "alumni", name: " A ", job: "PM", city: "NYC", stage: "phd", gradYear: 2027, contactMethod: "x", isAdmin: true, answers: answers({ hack: 1 }) }, QUESTIONS);
  assert.deepEqual([p.stage, p.gradYear, p.name, "isAdmin" in p, "hack" in p.answers], ["", null, "A", false, false]);
  assert.deepEqual(Object.keys(R.publicAnswers(QUESTIONS, p.answers)), ["goals", "interests", "field", "intro"]);
});

test("邀请：必须参加本轮、不能邀请自己、同一人本轮只能邀请一次", () => {
  assert.deepEqual(check(), { ok: true });
  assert.deepEqual(check({ fromJoined: false }), { ok: false, code: "forbidden", reason: "not_joined" });
  assert.deepEqual(check({ toJoined: false }), { ok: false, code: "not_found" });
  assert.deepEqual(check({ toId: "a" }), { ok: false, code: "forbidden", reason: "self" });
  assert.deepEqual(check({ invites: [inv("a", "b", { status: "skipped" })] }), { ok: false, code: "conflict", reason: "already_invited" }, "被跳过后本轮不能再邀请");
  assert.deepEqual(check({ round: null }), { ok: false, code: "conflict", reason: "round_closed" });
});

test("对方已经邀请过你，你再点想认识就直接匹配", () => {
  assert.deepEqual(check({ invites: [inv("b", "a")] }), { ok: true, autoAccept: "b>a" });
  assert.deepEqual(check({ invites: [inv("b", "a", { status: "accepted" })] }), { ok: false, code: "conflict", reason: "already_matched" });
});

test("同时最多 5 个未回复的邀请", () => {
  const five = ["c", "d", "e", "f", "g"].map((x) => inv("a", x));
  assert.deepEqual(check({ invites: five }), { ok: false, code: "rate_limited", reason: "too_many_open" });
  five[0].status = "accepted";
  assert.deepEqual(check({ invites: five }), { ok: true });
});

test("只有被邀请人能回复；跳过不通知、本轮结束未回复即过期", () => {
  const i = inv("a", "b");
  assert.deepEqual(R.respond(i, "accept", "a", ROUND, NOW), { ok: false, code: "forbidden", reason: "wrong_role" });
  assert.deepEqual(R.respond(i, "accept", "z", ROUND, NOW), { ok: false, code: "not_found" });
  assert.equal(R.respond(i, "accept", "b", ROUND, NOW).next.status, "accepted");
  assert.equal(R.respond(i, "skip", "b", ROUND, NOW).next.status, "skipped");
  const later = "2026-10-12T06:00:00Z";
  assert.equal(R.inviteStatus(i, ROUND, later), "expired");
  assert.deepEqual(R.respond(i, "accept", "b", ROUND, later), { ok: false, code: "conflict", reason: "expired" });
  assert.equal(JSON.stringify(i), JSON.stringify(inv("a", "b")), "不修改传入的对象");
});

test("联系方式只在匹配后、只给双方", () => {
  assert.equal(R.canSeeContact(inv("a", "b"), "a"), false);
  const m = inv("a", "b", { status: "accepted" });
  assert.equal(R.canSeeContact(m, "a"), true);
  assert.equal(R.canSeeContact(m, "b"), true);
  assert.equal(R.canSeeContact(m, "c"), false);
});

test("约定时间：匹配后任一方选重叠时间；开始后不能再改；见到了吗要在开始之后", () => {
  const m = inv("a", "b", { status: "accepted" });
  assert.deepEqual(R.schedule(inv("a", "b"), S2, "a", ROUND, [S2], NOW), { ok: false, code: "conflict", reason: "not_matched" });
  assert.deepEqual(R.schedule(m, S3, "a", ROUND, [S2], NOW), { ok: false, code: "conflict", reason: "slot_unavailable" });
  const s = R.schedule(m, S2, "b", ROUND, [S2], NOW).next;
  assert.deepEqual([s.slot, s.scheduledBy], [S2, "b"]);
  const started = new Date(R.slotStart(ROUND, S2) + 60000).toISOString();
  assert.deepEqual(R.schedule(s, S3, "a", ROUND, [S3], started), { ok: false, code: "conflict", reason: "already_started" });
  assert.deepEqual(R.recordOutcome(s, true, "a", ROUND, NOW), { ok: false, code: "conflict", reason: "too_early" });
  assert.deepEqual(R.recordOutcome(s, true, "a", ROUND, started).next.outcomes, { a: "met" });
});

test("打分：相同兴趣、相同领域、诉求互补都加分，并给出理由", () => {
  const s = R.scorePair(QUESTIONS, answers({ goals: ["industry"], interests: ["hiking", "coffee"] }), answers({ goals: ["share"], interests: ["hiking", "coffee", "music"] }));
  assert.equal(s.score, 3 + 4 + 2, "互补 3 + 两个共同兴趣 4 + 同领域 2");
  assert.equal(s.reasons[0].zh, "你们都喜欢徒步、咖啡");
  assert.ok(s.reasons.some((r) => r.zh.includes("愿意分享经验")));
  assert.equal(R.scorePair(QUESTIONS, answers({ field: "other" }), answers({ field: "other" })).reasons.some((r) => r.zh.includes("领域")), false, "\"其他\"不算同领域");
});

test("推荐：必须有重叠时间；排除自己、以前匹配过的、本轮有往来的、跳过的；热门的人降权", () => {
  const me = { id: "me", slots: [S2, S3], answers: answers({ interests: ["hiking", "coffee"] }) };
  const people = [
    { id: "best", slots: [S2], answers: answers({ interests: ["hiking", "coffee"] }) },
    { id: "ok", slots: [S3], answers: answers({ interests: ["music"] }) },
    { id: "noTime", slots: [S1], answers: answers({ interests: ["hiking", "coffee"] }) },
    { id: "metBefore", slots: [S2], answers: answers() },
    { id: "invited", slots: [S2], answers: answers() },
    { id: "dismissed", slots: [S2], answers: answers() },
    me
  ];
  const base = { round: ROUND, me, people, questions: QUESTIONS, invites: [inv("invited", "me")], everMatched: { [R.pairKey("me", "metBefore")]: true }, dismissed: ["dismissed"], now: NOW, k: 5 };
  const recs = R.recommend(base);
  assert.deepEqual(recs.map((x) => x.id), ["best", "ok"]);
  assert.ok(recs[0].reasons.length >= 1 && recs[0].overlapCount === 1);
  const popular = ["x1", "x2", "x3", "x4", "x5", "x6"].map((x) => inv(x, "best"));
  assert.ok(R.recommend(Object.assign({}, base, { invites: base.invites.concat(popular) }))[0].score < recs[0].score, "收到很多邀请的人降权");
  assert.equal(R.recsEnabled(ROUND, 19), false);
  assert.equal(R.recsEnabled(ROUND, 20), true);
});

test("大模型：只发匿名答案（不含姓名、邮箱、联系方式），输出只接受候选名单里的人", () => {
  const me = { id: "me", name: "王小明", email: "x@yale.edu", contactMethod: "wx-secret", identity: "student", answers: answers() };
  const cands = [{ id: "u1", name: "李雷", contactMethod: "wx-u1", answers: answers(), reasons: [{ zh: "你们都喜欢徒步", en: "x" }] }, { id: "u2", answers: answers() }];
  const msg = JSON.stringify(R.buildRerankMessages(me, cands, QUESTIONS, 2, "zh"));
  for (const secret of ["王小明", "x@yale.edu", "wx-secret", "李雷", "wx-u1", "\"u1\"", "\"me\""]) assert.ok(!msg.includes(secret), "不应包含 " + secret);
  assert.deepEqual(R.parseRerank('{"picks":[{"id":"C2","reason":"都爱徒步"},{"id":"C9"},{"id":"C2"}]}', cands, 2), [{ id: "u2", reason: "都爱徒步" }]);
  assert.equal(R.parseRerank("不是 JSON", cands, 2), null);
  assert.equal(R.parseRerank('{"picks":[{"id":"C7"}]}', cands, 2), null, "全是无效编号时退回规则排序");
});

test("通知偏好：匹配成功的邮件不能关；意见箱校验", () => {
  assert.deepEqual(R.cleanPrefs({ match: false, weekly: false }), { match: true, invite_digest: true, reminder: true, weekly: false, event: true });
  assert.equal(R.validateFeedback({ kind: "bug", text: "手机上拖选不灵" }).ok, true);
  assert.deepEqual(R.validateFeedback({ kind: "rant", text: "?" }).fields, { kind: "invalid", text: "too_short" });
});
