/* Coffee Chat 内测活动 · 业务规则 —— 纯函数：不碰 DOM / 存储 / 网络；"现在时间"、id、活动配置都由调用方传入
   Coffee-chat beta event: domain rules shared by the browser prototype, the data validator and a future Node backend.

   一、时间表（活动配置 event，见 web/data/coffeeEvents.json）
     活动期内每天 dayStart–dayEnd（活动时区，默认美东），每个时段 slotMinutes 分钟，时段之间留 gapMinutes 分钟。
     默认 10:00–21:00、15 分钟 + 间隔 20 分钟 → 每天 19 个时段：10:00, 10:35, 11:10 … 20:30。
     时段 id = "YYYY-MM-DDTHH:MM"（活动时区的墙上时间）；换算成绝对时间时处理夏令时。

   二、预约（CoffeeBooking）的生命周期
     pending ──accept（被约人）──▶ accepted     接受后双方互相看到邮箱、联系方式、线上链接
        └─────decline（被约人）──▶ declined
     到了约定时间还是 pending → expired："对方没确认 = 不见面"（读取时计算，后端不需要定时任务）

   三、时段规则
     - 一个时段只要被约过（之后无论接受还是婉拒）就不再开放 —— 不回收，简单可预期；
     - 距开始不足 cutoffHours（默认 12）小时的时段不能再约；
     - 同一时间一个人只能有一个进行中的约；两个人之间同时只能有一个进行中的约；
     - 一个人同时最多 maxPending 个"等对方确认"的预约（防刷）。

   改规则 = 改这里 + 改 tests/unit/coffee.test.js。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.YL = root.YL || {}; root.YL.domain = root.YL.domain || {}; root.YL.domain.coffee = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const IDENTITIES = Object.freeze(["student", "alumni"]);
  const STAGES = Object.freeze(["undergrad", "master", "phd"]);
  const GOALS = Object.freeze(["academic", "industry", "friends"]);
  const MEET_MODES = Object.freeze(["offline", "online"]);
  const FEEDBACK_KINDS = Object.freeze(["bug", "idea", "other"]);
  const STORED = Object.freeze(["pending", "accepted", "declined"]);
  const STATUSES = Object.freeze(STORED.concat(["expired"])); // expired 不存库，读取时计算
  const ACTIONS = Object.freeze(["accept", "decline"]);
  const TRANSITIONS = Object.freeze([
    { action: "accept", from: "pending", by: "host", to: "accepted" },
    { action: "decline", from: "pending", by: "host", to: "declined" }
  ].map(Object.freeze));
  const LIMITS = Object.freeze({
    name: 40, program: 60, job: 80, location: 60, interests: 120, place: 200, contact: 60,
    note: 300, feedbackMin: 5, feedbackMax: 1000, gradYearsAhead: 7
  });
  const DAY = 86400000, HOUR = 3600000;

  const ms = (t) => (typeof t === "number" ? t : t instanceof Date ? t.getTime() : Date.parse(t));
  const iso = (t) => new Date(ms(t)).toISOString();
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
  const deny = (code, reason, fields) => Object.assign({ ok: false, code }, reason ? { reason } : {}, fields ? { fields } : {});
  const between = (b, x, y) => (b.requesterId === x && b.hostId === y) || (b.requesterId === y && b.hostId === x);

  /* ---------- 时间表 ---------- */
  const toMin = (hhmm) => { const p = String(hhmm).split(":"); return Number(p[0]) * 60 + Number(p[1]); };
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const fromMin = (n) => pad(Math.floor(n / 60)) + ":" + pad(n % 60);

  // 每天的时段开始时间：["10:00", "10:35", …]
  function slotTimes(event) {
    const out = [], step = event.slotMinutes + event.gapMinutes;
    for (let t = toMin(event.dayStart); t + event.slotMinutes <= toMin(event.dayEnd) && step > 0; t += step) out.push(fromMin(t));
    return out;
  }
  // 活动的每一天（含首尾）：["2026-11-02", …]
  function eventDates(event) {
    const out = [], p = event.startDate.split("-").map(Number);
    for (let t = Date.UTC(p[0], p[1] - 1, p[2]); out.length < 62; t += DAY) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (d > event.endDate) break;
      out.push(d);
    }
    return out;
  }
  function slotIds(event) {
    const times = slotTimes(event);
    return eventDates(event).reduce((all, d) => all.concat(times.map((t) => d + "T" + t)), []);
  }
  function isValidSlot(event, slot) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(slot || ""));
    return !!m && eventDates(event).indexOf(m[1]) >= 0 && slotTimes(event).indexOf(m[2]) >= 0;
  }
  // 活动时区的墙上时间 → UTC 毫秒（Intl 负责夏令时）
  const formatters = {};
  function wallClock(utcMs, tz) {
    const f = formatters[tz] || (formatters[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
    const p = {};
    f.formatToParts(new Date(utcMs)).forEach((x) => (p[x.type] = x.value));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  }
  function slotStart(event, slot) {
    const parts = String(slot).split("T"), d = parts[0].split("-").map(Number), t = parts[1].split(":").map(Number);
    const guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
    const first = guess - (wallClock(guess, event.timezone) - guess);
    return guess - (wallClock(first, event.timezone) - first);
  }

  /* ---------- 预约 ---------- */
  function roleOf(b, userId) {
    if (!b || !userId) return null;
    return b.requesterId === userId ? "requester" : b.hostId === userId ? "host" : null;
  }
  function bookingStatus(b, event, now) {
    return b.status === "pending" && ms(now) >= slotStart(event, b.slot) ? "expired" : b.status;
  }
  const isOpen = (b, event, now) => { const s = bookingStatus(b, event, now); return s === "pending" || s === "accepted"; };
  // 这个人现在能对这条预约做什么 —— 界面按它显示按钮，接口按它放行
  function allowedActions(b, userId, event, now) {
    const role = roleOf(b, userId), status = bookingStatus(b, event, now);
    return ACTIONS.filter((a) => TRANSITIONS.some((t) => t.action === a && t.from === status && t.by === role));
  }
  // 预约被接受后，双方才看得到彼此的邮箱、联系方式与线上链接
  const canSeeContact = (b, userId, event, now) => !!roleOf(b, userId) && bookingStatus(b, event, now) === "accepted";

  // 某人在某时段是否已有进行中的约（无论是约人还是被约）
  function isBusy(userId, slot, bookings, event, now) {
    return bookings.some((b) => b.slot === slot && (b.requesterId === userId || b.hostId === userId) && isOpen(b, event, now));
  }
  // 从 viewer 的角度看 host 开放的某个时段："yours" 你约的 | "closed" 已截止 | "taken" 已被约 | "busy" 你那时有别的约 | "free" 可约
  function slotState(event, host, slot, bookings, viewerId, now) {
    const here = bookings.filter((b) => b.hostId === host.id && b.slot === slot);
    if (viewerId && here.some((b) => b.requesterId === viewerId)) return "yours";
    if (ms(now) > slotStart(event, slot) - event.cutoffHours * HOUR) return "closed";
    if (here.length || isBusy(host.id, slot, bookings, event, now)) return "taken";
    if (viewerId && isBusy(viewerId, slot, bookings, event, now)) return "busy";
    return "free";
  }

  function validateBooking(input) {
    const i = input || {}, fields = {};
    if (text(i.note).length > LIMITS.note) fields.note = "too_long";
    if (i.agree !== true) fields.agree = "required"; // 必须确认免责声明
    return { ok: !Object.keys(fields).length, fields };
  }
  // c = { event, requesterId, requester, host, slot, bookings, now }；requester / host 为报名资料（未报名为 null）
  function checkCanBook(c) {
    if (!c.requester) return deny("forbidden", "not_registered");
    if (!c.host) return deny("not_found");
    if (c.host.id === c.requesterId) return deny("forbidden", "self");
    if (!isValidSlot(c.event, c.slot) || (c.host.slots || []).indexOf(c.slot) < 0) return deny("invalid", "slot_not_offered");
    const state = slotState(c.event, c.host, c.slot, c.bookings, c.requesterId, c.now);
    if (state === "yours" || state === "taken") return deny("conflict", "slot_taken");
    if (state === "closed") return deny("conflict", "too_late");
    if (state === "busy") return deny("conflict", "you_busy");
    if (c.bookings.some((b) => between(b, c.requesterId, c.host.id) && isOpen(b, c.event, c.now))) return deny("conflict", "duplicate");
    const pending = c.bookings.filter((b) => b.requesterId === c.requesterId && bookingStatus(b, c.event, c.now) === "pending").length;
    if (pending >= c.event.maxPending) return deny("rate_limited", "too_many_pending");
    return { ok: true };
  }
  // 生成新预约（validateBooking 与 checkCanBook 都通过之后再调用）
  function createBooking(input, requesterId, eventId, now, id) {
    const at = iso(now);
    return {
      id, eventId, requesterId, hostId: text(input.hostId), slot: input.slot, note: text(input.note),
      status: "pending", createdAt: at, updatedAt: at,
      history: [{ at, by: requesterId, action: "create", from: null, to: "pending" }]
    };
  }
  // 执行动作 → { ok: true, next } | { ok: false, code, reason? }。不修改传入的 b；每一步追加进 history
  function transition(b, action, userId, event, now) {
    if (ACTIONS.indexOf(action) < 0) return deny("invalid", "unknown_action");
    const role = roleOf(b, userId);
    if (!role) return deny("not_found"); // 与你无关的预约：当作不存在，不泄露
    const status = bookingStatus(b, event, now);
    const rule = TRANSITIONS.find((t) => t.action === action && t.from === status && t.by === role);
    if (!rule) {
      if (TRANSITIONS.some((t) => t.action === action && t.from === status)) return deny("forbidden", "wrong_role");
      return deny("conflict", status === "expired" ? "expired" : "invalid_state");
    }
    const at = iso(now);
    return { ok: true, next: Object.assign({}, b, { status: rule.to, updatedAt: at, history: (b.history || []).concat([{ at, by: userId, action, from: status, to: rule.to }]) }) };
  }

  /* ---------- 报名资料与空闲时段 ---------- */
  function need(fields, key, value, max) {
    const v = text(value);
    if (!v) fields[key] = "required";
    else if (v.length > max) fields[key] = "too_long";
  }
  // year = 当前年份（在校生的毕业年份须在 year … year + gradYearsAhead）
  function validateProfile(p, year) {
    p = p || {};
    const f = {};
    need(f, "name", p.name, LIMITS.name);
    if (IDENTITIES.indexOf(p.identity) < 0) f.identity = "invalid";
    if (p.identity === "student") {
      if (STAGES.indexOf(p.stage) < 0) f.stage = "invalid";
      need(f, "program", p.program, LIMITS.program);
      const gy = Number(p.gradYear);
      if (!Number.isInteger(gy) || gy < year || gy > year + LIMITS.gradYearsAhead) f.gradYear = "invalid";
    }
    if (p.identity === "alumni") { need(f, "job", p.job, LIMITS.job); need(f, "location", p.location, LIMITS.location); }
    if (text(p.interests).length > LIMITS.interests) f.interests = "too_long";
    const goals = list(p.goals);
    if (!goals.length || goals.some((g) => GOALS.indexOf(g) < 0)) f.goals = "invalid";
    if (MEET_MODES.indexOf(p.meetMode) < 0) f.meetMode = "invalid";
    const place = text(p.meetPlace);
    if (place.length < 3) f.meetPlace = "required";
    else if (place.length > LIMITS.place) f.meetPlace = "too_long";
    else if (p.meetMode === "online" && !/^https:\/\/\S+$/i.test(place)) f.meetPlace = "link";
    if (text(p.contact).length > LIMITS.contact) f.contact = "too_long";
    return { ok: !Object.keys(f).length, fields: f };
  }
  // 只保留规定字段（丢弃多余字段），另一身份的字段清空；邮箱来自登录会话，不由表单提交
  function buildProfile(p, userId, email, existing, now) {
    const at = iso(now), student = p.identity === "student", goals = list(p.goals);
    return {
      id: userId, email: email, name: text(p.name), identity: p.identity,
      stage: student ? p.stage : "", program: student ? text(p.program) : "", gradYear: student ? Number(p.gradYear) : null,
      job: student ? "" : text(p.job), location: student ? "" : text(p.location),
      interests: text(p.interests), goals: GOALS.filter((g) => goals.indexOf(g) >= 0),
      meetMode: p.meetMode, meetPlace: text(p.meetPlace), contact: text(p.contact),
      slots: existing && existing.slots ? existing.slots.slice() : [],
      createdAt: existing ? existing.createdAt : at, updatedAt: at
    };
  }
  // 保存空闲时段：只收活动内的合法时段；已经被约过的时段不能撤回（自动保留）
  function applyAvailability(event, hostId, requested, bookings) {
    const all = slotIds(event), want = list(requested);
    if (!Array.isArray(requested) || want.some((s) => all.indexOf(s) < 0)) return deny("invalid", null, { slots: "invalid" });
    const locked = bookings.filter((b) => b.hostId === hostId).map((b) => b.slot);
    return { ok: true, slots: all.filter((s) => want.indexOf(s) >= 0 || locked.indexOf(s) >= 0), locked: all.filter((s) => locked.indexOf(s) >= 0) };
  }

  /* ---------- 意见箱与统计 ---------- */
  function validateFeedback(input) {
    const i = input || {}, f = {}, t = text(i.text);
    if (FEEDBACK_KINDS.indexOf(i.kind) < 0) f.kind = "invalid";
    if (t.length < LIMITS.feedbackMin) f.text = "too_short";
    else if (t.length > LIMITS.feedbackMax) f.text = "too_long";
    return { ok: !Object.keys(f).length, fields: f };
  }
  function computeStats(profiles, bookings, feedbackCount, event, now) {
    const by = { pending: 0, accepted: 0, declined: 0, expired: 0 };
    bookings.forEach((b) => { by[bookingStatus(b, event, now)]++; });
    const decided = by.accepted + by.declined + by.expired;
    const goals = {};
    GOALS.forEach((g) => (goals[g] = profiles.filter((p) => (p.goals || []).indexOf(g) >= 0).length));
    return {
      participants: profiles.length,
      students: profiles.filter((p) => p.identity === "student").length,
      alumni: profiles.filter((p) => p.identity === "alumni").length,
      withSlots: profiles.filter((p) => (p.slots || []).length > 0).length,
      slotsOffered: profiles.reduce((n, p) => n + (p.slots || []).length, 0),
      bookings: Object.assign({ total: bookings.length }, by),
      acceptRate: decided ? Math.round((by.accepted / decided) * 100) : null, // 已有结果的预约里被接受的比例（%）
      goals,
      feedback: feedbackCount
    };
  }

  return {
    IDENTITIES, STAGES, GOALS, MEET_MODES, FEEDBACK_KINDS, STORED, STATUSES, ACTIONS, TRANSITIONS, LIMITS,
    slotTimes, eventDates, slotIds, isValidSlot, slotStart,
    roleOf, bookingStatus, isOpen, allowedActions, canSeeContact, isBusy, slotState,
    validateBooking, checkCanBook, createBooking, transition,
    validateProfile, buildProfile, applyAvailability, validateFeedback, computeStats
  };
});
