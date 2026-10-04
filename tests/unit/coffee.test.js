// Coffee Chat 内测活动 · 业务规则单测 —— 改 web/js/domain/coffee.js 必须同步改这里
// Unit tests for the coffee-chat domain rules (node --test).
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../web/js/domain/coffee.js");

const EVENT = { id: "t", timezone: "America/New_York", startDate: "2026-11-02", endDate: "2026-11-15", dayStart: "10:00", dayEnd: "21:00", slotMinutes: 15, gapMinutes: 20, cutoffHours: 12, maxPending: 3 };
const BEFORE = "2026-10-20T12:00:00.000Z"; // 活动开始前
const S1 = "2026-11-03T19:20", S2 = "2026-11-03T19:55", S3 = "2026-11-04T10:00", S4 = "2026-11-04T10:35";
const person = (id, slots) => ({ id, slots: slots || [S1, S2, S3, S4] });
const book = (from, to, slot, extra) => Object.assign(R.createBooking({ hostId: to, slot, note: "hi" }, from, EVENT.id, BEFORE, `${from}-${to}-${slot}`), extra);
const can = (bookings, over) => R.checkCanBook(Object.assign({ event: EVENT, requesterId: "me", requester: person("me"), host: person("host"), slot: S1, bookings, now: BEFORE }, over));
const step = (b, action, by, now) => {
  const res = R.transition(b, action, by, EVENT, now || BEFORE);
  assert.equal(res.ok, true, `${action} by ${by}: ${JSON.stringify(res)}`);
  return res.next;
};

test("the daily template is 15-minute slots with 20-minute gaps between 10:00 and 21:00", () => {
  const times = R.slotTimes(EVENT);
  assert.equal(times.length, 19);
  assert.deepEqual(times.slice(0, 4), ["10:00", "10:35", "11:10", "11:45"]);
  assert.equal(times[times.length - 1], "20:30", "the last slot must end (20:45) before 21:00");
  const dates = R.eventDates(EVENT);
  assert.equal(dates.length, 14);
  assert.deepEqual([dates[0], dates[13]], ["2026-11-02", "2026-11-15"]);
  assert.equal(R.slotIds(EVENT).length, 19 * 14);
  assert.equal(R.isValidSlot(EVENT, "2026-11-02T10:35"), true);
  for (const bad of ["2026-11-02T10:05", "2026-11-16T10:00", "2026-11-01T10:00", "nonsense", null]) assert.equal(R.isValidSlot(EVENT, bad), false, String(bad));
});

test("slot ids are wall-clock times in the event time zone, daylight saving included", () => {
  assert.equal(new Date(R.slotStart(EVENT, "2026-11-02T10:00")).toISOString(), "2026-11-02T15:00:00.000Z", "EST = UTC-5");
  assert.equal(new Date(R.slotStart(EVENT, "2026-10-30T10:00")).toISOString(), "2026-10-30T14:00:00.000Z", "EDT = UTC-4");
  assert.equal(new Date(R.slotStart(EVENT, "2026-11-01T10:00")).toISOString(), "2026-11-01T15:00:00.000Z", "DST ended at 2am that day");
  assert.equal(new Date(R.slotStart({ timezone: "Asia/Shanghai" }, "2026-11-02T10:00")).toISOString(), "2026-11-02T02:00:00.000Z");
});

test("you can book a free slot that the host offered", () => {
  assert.deepEqual(can([]), { ok: true });
  assert.deepEqual(can([], { requester: null }), { ok: false, code: "forbidden", reason: "not_registered" });
  assert.deepEqual(can([], { host: null }), { ok: false, code: "not_found" });
  assert.deepEqual(can([], { host: person("me") }), { ok: false, code: "forbidden", reason: "self" });
  assert.deepEqual(can([], { slot: "2026-11-05T10:00" }), { ok: false, code: "invalid", reason: "slot_not_offered" });
  assert.deepEqual(can([], { slot: "2026-11-03T19:21" }), { ok: false, code: "invalid", reason: "slot_not_offered" });
});

test("a slot is never released once booked, whatever the answer", () => {
  for (const status of ["pending", "accepted", "declined"]) {
    const taken = [book("other", "host", S1, { status })];
    assert.deepEqual(can(taken), { ok: false, code: "conflict", reason: "slot_taken" }, status);
    assert.equal(R.slotState(EVENT, person("host"), S1, taken, "me", BEFORE), "taken");
  }
  assert.equal(R.slotState(EVENT, person("host"), S1, [book("me", "host", S1)], "me", BEFORE), "yours");
});

test("booking closes cutoffHours before the slot starts", () => {
  const start = R.slotStart(EVENT, S1);
  const at = (h) => new Date(start - h * 3600000).toISOString();
  assert.deepEqual(can([], { now: at(12) }), { ok: true }, "exactly 12h before is still open");
  assert.deepEqual(can([], { now: at(11.9) }), { ok: false, code: "conflict", reason: "too_late" });
  assert.equal(R.slotState(EVENT, person("host"), S1, [], "me", at(1)), "closed");
});

test("nobody can be in two chats at the same time", () => {
  const meBusy = [book("me", "x", S1)];
  assert.equal(R.slotState(EVENT, person("host"), S1, meBusy, "me", BEFORE), "busy");
  assert.deepEqual(can(meBusy), { ok: false, code: "conflict", reason: "you_busy" });
  const hostBusy = [book("host", "x", S1)];
  assert.equal(R.slotState(EVENT, person("host"), S1, hostBusy, "me", BEFORE), "taken", "the host booked someone else at that time");
  const declined = [book("me", "x", S1, { status: "declined" })];
  assert.deepEqual(can(declined), { ok: true }, "a declined booking frees the requester's time");
});

test("one open booking per pair, and at most maxPending awaiting an answer", () => {
  assert.deepEqual(can([book("me", "host", S3)]), { ok: false, code: "conflict", reason: "duplicate" });
  assert.deepEqual(can([book("host", "me", S3)]), { ok: false, code: "conflict", reason: "duplicate" }, "either direction");
  assert.deepEqual(can([book("me", "host", S3, { status: "declined" })]), { ok: true });
  const three = ["a", "b", "c"].map((h, i) => book("me", h, [S2, S3, S4][i]));
  assert.deepEqual(can(three), { ok: false, code: "rate_limited", reason: "too_many_pending" });
  three[0].status = "accepted";
  assert.deepEqual(can(three), { ok: true }, "an accepted booking frees a pending slot");
});

test("only the host answers; outsiders see nothing; terminal states are final", () => {
  const b = book("me", "host", S1);
  assert.deepEqual(R.allowedActions(b, "host", EVENT, BEFORE), ["accept", "decline"]);
  assert.deepEqual(R.allowedActions(b, "me", EVENT, BEFORE), []);
  assert.deepEqual(R.transition(b, "accept", "me", EVENT, BEFORE), { ok: false, code: "forbidden", reason: "wrong_role" });
  assert.deepEqual(R.transition(b, "accept", "stranger", EVENT, BEFORE), { ok: false, code: "not_found" });
  assert.deepEqual(R.transition(b, "cancel", "host", EVENT, BEFORE), { ok: false, code: "invalid", reason: "unknown_action" });
  const accepted = step(b, "accept", "host");
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(R.transition(accepted, "decline", "host", EVENT, BEFORE), { ok: false, code: "conflict", reason: "invalid_state" });
  assert.equal(step(book("me", "host", S2), "decline", "host").status, "declined");
});

test("no answer by the start time means no: pending becomes expired without a background job", () => {
  const b = book("me", "host", S1);
  const start = R.slotStart(EVENT, S1);
  assert.equal(R.bookingStatus(b, EVENT, start - 1), "pending");
  assert.equal(R.bookingStatus(b, EVENT, start), "expired");
  assert.deepEqual(R.transition(b, "accept", "host", EVENT, start + 1), { ok: false, code: "conflict", reason: "expired" });
  assert.equal(step(b, "accept", "host", start - 60000).status, "accepted", "the host may still accept late, before the start");
  assert.equal(R.isBusy("me", S1, [b], EVENT, start), false, "an expired booking no longer blocks anyone");
});

test("contacts are revealed only to the two people, only after acceptance", () => {
  const b = book("me", "host", S1);
  assert.equal(R.canSeeContact(b, "me", EVENT, BEFORE), false);
  const a = step(b, "accept", "host");
  assert.equal(R.canSeeContact(a, "me", EVENT, BEFORE), true);
  assert.equal(R.canSeeContact(a, "host", EVENT, BEFORE), true);
  assert.equal(R.canSeeContact(a, "stranger", EVENT, BEFORE), false);
});

test("transitions never mutate their input and leave an audit trail in history", () => {
  const b = book("me", "host", S1);
  const before = JSON.stringify(b);
  const a = step(b, "accept", "host", "2026-10-21T00:00:00.000Z");
  assert.equal(JSON.stringify(b), before);
  assert.deepEqual(a.history.map((h) => [h.action, h.by, h.from, h.to]), [["create", "me", null, "pending"], ["accept", "host", "pending", "accepted"]]);
  assert.equal(a.updatedAt, "2026-10-21T00:00:00.000Z");
});

test("booking input: the disclaimer must be acknowledged; the note is optional and bounded", () => {
  assert.deepEqual(R.validateBooking({ agree: true }), { ok: true, fields: {} });
  assert.deepEqual(R.validateBooking({ agree: "true", note: "x".repeat(301) }).fields, { note: "too_long", agree: "required" });
});

test("registration: identity decides which fields are required", () => {
  const base = { name: "测试同学", goals: ["industry"], meetMode: "offline", meetPlace: "Blue State Coffee, 276 York St" };
  const student = Object.assign({ identity: "student", stage: "master", program: "MS Statistics", gradYear: "2027" }, base);
  const alumni = Object.assign({ identity: "alumni", job: "Analyst @ Example Capital", location: "New York" }, base);
  assert.deepEqual(R.validateProfile(student, 2026), { ok: true, fields: {} });
  assert.deepEqual(R.validateProfile(alumni, 2026), { ok: true, fields: {} });
  assert.deepEqual(R.validateProfile(Object.assign({}, student, { stage: "postdoc", program: "", gradYear: "2040" }), 2026).fields, { stage: "invalid", program: "required", gradYear: "invalid" });
  assert.deepEqual(R.validateProfile(Object.assign({}, alumni, { job: " ", location: "" }), 2026).fields, { job: "required", location: "required" });
  assert.deepEqual(R.validateProfile({ identity: "visitor", goals: ["gossip"], meetMode: "phone", meetPlace: "" }, 2026).fields, { name: "required", identity: "invalid", goals: "invalid", meetMode: "invalid", meetPlace: "required" });
  assert.equal(R.validateProfile(Object.assign({}, alumni, { meetMode: "online", meetPlace: "zoom 123" }), 2026).fields.meetPlace, "link");
  assert.equal(R.validateProfile(Object.assign({}, alumni, { meetMode: "online", meetPlace: "https://zoom.example.com/j/1" }), 2026).ok, true);
});

test("buildProfile keeps only the allowed fields and preserves slots on edit", () => {
  const p = R.buildProfile({ identity: "alumni", name: " 王同学 ", job: "PM", location: "NYC", stage: "phd", program: "x", gradYear: 2027, goals: ["friends", "industry", "friends"], meetMode: "online", meetPlace: "https://zoom.example.com/j/1", isAdmin: true }, "me", "me@yale.edu", { slots: [S1], createdAt: "2026-10-01T00:00:00.000Z" }, BEFORE);
  assert.equal(p.name, "王同学");
  assert.equal(p.email, "me@yale.edu");
  assert.deepEqual([p.stage, p.program, p.gradYear], ["", "", null], "student-only fields are cleared for alumni");
  assert.deepEqual(p.goals, ["industry", "friends"]);
  assert.deepEqual(p.slots, [S1]);
  assert.equal(p.createdAt, "2026-10-01T00:00:00.000Z");
  assert.equal("isAdmin" in p, false, "unknown fields are dropped");
});

test("availability: only real slots; booked slots cannot be withdrawn", () => {
  assert.deepEqual(R.applyAvailability(EVENT, "host", ["2026-11-02T10:01"], []), { ok: false, code: "invalid", fields: { slots: "invalid" } });
  assert.equal(R.applyAvailability(EVENT, "host", "2026-11-02T10:00", []).ok, false, "must be an array");
  const res = R.applyAvailability(EVENT, "host", [S4, S3], [book("me", "host", S1, { status: "declined" })]);
  assert.deepEqual(res, { ok: true, slots: [S1, S3, S4], locked: [S1] });
});

test("feedback box validation and admin statistics", () => {
  assert.equal(R.validateFeedback({ kind: "bug", text: "手机上拖选不灵" }).ok, true);
  assert.deepEqual(R.validateFeedback({ kind: "rant", text: "?" }).fields, { kind: "invalid", text: "too_short" });
  const profiles = [{ id: "a", identity: "student", goals: ["industry"], slots: [S1, S2] }, { id: "b", identity: "alumni", goals: ["industry", "friends"], slots: [] }];
  const bookings = [book("a", "b", S1, { status: "accepted" }), book("b", "a", S2, { status: "declined" }), book("a", "c", S3)];
  const s = R.computeStats(profiles, bookings, 4, EVENT, BEFORE);
  assert.deepEqual(s, {
    participants: 2, students: 1, alumni: 1, withSlots: 1, slotsOffered: 2,
    bookings: { total: 3, pending: 1, accepted: 1, declined: 1, expired: 0 },
    acceptRate: 50, goals: { academic: 0, industry: 2, friends: 1 }, feedback: 4
  });
  assert.equal(R.computeStats([], [], 0, EVENT, BEFORE).acceptRate, null);
});
