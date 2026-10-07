/* 约咖啡 · 业务规则 —— 纯函数：不碰 DOM / 存储 / 网络；"现在时间"、id、配置都由调用方传入
   Coffee-chat domain rules, shared by the browser, the data validator and the Node server (server/).

   一、轮次（round）
     每周自动一轮（周一到周日）；运营可以另开"活动轮"（Coffee Chat 周 / 月），活动轮进行期间优先于每周轮。
     参加某一轮 = 在这一轮里开放自己的空闲时间。时间表：每天 dayStart–dayEnd（活动时区，默认美东），
     每格 slotMinutes 分钟、格间留 gapMinutes 分钟；时段 id = "YYYY-MM-DDTHH:MM"（活动时区的墙上时间）。

   二、邀请与匹配（同一轮内）
     想认识（推荐页或池子里点）→ 邀请 pending
       ├─ 对方点"想认识" → accepted = 匹配成功：双方看到联系方式和重叠时间
       ├─ 对方点"跳过"   → skipped（不通知发起人）
       └─ 轮次结束仍未回复 → expired（读取时计算）
     如果对方已经邀请过你，你再点"想认识"就直接匹配。
     匹配后任一方选一个重叠时间即约定（双方本来都标了有空）；时间过后各自回答"见到了吗"。

   三、推荐（规则打分，可选用大模型重排序）
     候选：这一轮的参与者，排除自己、以前匹配过的人、本轮已有邀请往来的人、已跳过推荐的人；必须有重叠时间。
     打分：按 web/data/matchQuestions.json 里每道题的权重（相同加分 / 互补加分）+ 活动主题；
     本轮已收到较多邀请的人降权，避免热门的人被淹没。参与人数达到 poolThreshold 才开放推荐。

   改规则 = 改这里或问卷配置 + 改 tests/unit/coffee.test.js。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.YL = root.YL || {}; root.YL.domain = root.YL.domain || {}; root.YL.domain.coffee = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const IDENTITIES = Object.freeze(["student", "alumni"]);
  const STAGES = Object.freeze(["undergrad", "master", "phd"]);
  const QUESTION_TYPES = Object.freeze(["single", "multi", "tags", "text"]);
  const INVITE_STATUSES = Object.freeze(["pending", "accepted", "skipped", "expired"]);
  const EMAIL_KINDS = Object.freeze(["match", "invite_digest", "reminder", "weekly", "event"]);
  const REQUIRED_EMAILS = Object.freeze(["match"]); // 匹配成功的邮件不能关闭
  const DEFAULT_ROUND = Object.freeze({
    timezone: "America/New_York", dayStart: "10:00", dayEnd: "21:00", slotMinutes: 15, gapMinutes: 20,
    cutoffHours: 12, recCount: 3, maxOpenInvites: 5, poolThreshold: 20, openBrowse: true
  });
  const LIMITS = Object.freeze({
    name: 40, job: 80, city: 60, contactMethod: 80, note: 200, tagCustom: 12, feedbackMin: 5, feedbackMax: 1000, gradYearsAhead: 7
  });
  const DAY = 86400000, HOUR = 3600000;

  const ms = (t) => (typeof t === "number" ? t : t instanceof Date ? t.getTime() : Date.parse(t));
  const iso = (t) => new Date(ms(t)).toISOString();
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  // 单行字段（姓名、职位、城市、联系方式）：控制字符（换行、NUL…）和双向文字控制符换成空格，连续空白并成一个，再去掉首尾空白。
  // 防止名字里的换行混进邮件标题 / 正文，或用 RLO 之类把页面上整句话倒过来
  const line = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim() : "");
  const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  const deny = (code, reason, fields) => Object.assign({ ok: false, code }, reason ? { reason } : {}, fields ? { fields } : {});
  const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);

  /* ---------- 时间与轮次 ---------- */
  const toMin = (hhmm) => { const p = String(hhmm).split(":"); return Number(p[0]) * 60 + Number(p[1]); };
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const fromMin = (n) => pad(Math.floor(n / 60)) + ":" + pad(n % 60);
  const addDays = (date, n) => { const p = date.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * DAY).toISOString().slice(0, 10); };

  function slotTimes(r) {
    const out = [], step = r.slotMinutes + r.gapMinutes;
    for (let t = toMin(r.dayStart); t + r.slotMinutes <= toMin(r.dayEnd) && step > 0; t += step) out.push(fromMin(t));
    return out;
  }
  function roundDates(r) {
    const out = [];
    for (let d = r.startDate; d <= r.endDate && out.length < 62; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function slotIds(r) {
    const times = slotTimes(r);
    return roundDates(r).reduce((all, d) => all.concat(times.map((t) => d + "T" + t)), []);
  }
  function isValidSlot(r, slot) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(slot || ""));
    return !!m && m[1] >= r.startDate && m[1] <= r.endDate && slotTimes(r).indexOf(m[2]) >= 0;
  }
  // 活动时区的墙上时间 ↔ UTC（Intl 处理夏令时）
  const formatters = {};
  function wallClock(utcMs, tz) {
    const f = formatters[tz] || (formatters[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
    const p = {};
    f.formatToParts(new Date(utcMs)).forEach((x) => (p[x.type] = x.value));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  }
  function zonedToUtc(date, time, tz) {
    const d = date.split("-").map(Number), t = time.split(":").map(Number);
    const guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
    const first = guess - (wallClock(guess, tz) - guess);
    return guess - (wallClock(first, tz) - first);
  }
  const slotStart = (r, slot) => { const p = String(slot).split("T"); return zonedToUtc(p[0], p[1], r.timezone); };
  // 某个时刻在活动时区是哪一天
  const localDate = (now, tz) => new Date(wallClock(ms(now), tz)).toISOString().slice(0, 10);
  const roundStartMs = (r) => zonedToUtc(r.startDate, "00:00", r.timezone);
  const roundEndMs = (r) => zonedToUtc(addDays(r.endDate, 1), "00:00", r.timezone);
  const isRoundOpen = (r, now) => !!r && ms(now) >= roundStartMs(r) && ms(now) < roundEndMs(r);
  const isRoundOver = (r, now) => !r || ms(now) >= roundEndMs(r);
  const weekdayOf = (date) => (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7; // 周一 = 0
  const weekStarting = (start, b) => Object.assign({}, b, { id: "week-" + start, kind: "weekly", startDate: start, endDate: addDays(start, 6), status: "published", themeTags: [] });
  // now 所在那一周（周一到周日）的每周轮
  function weeklyRound(now, base) {
    const b = Object.assign({}, DEFAULT_ROUND, base || {}), today = localDate(now, b.timezone);
    return weekStarting(addDays(today, -weekdayOf(today)), b);
  }
  // 正在报名的每周轮：周一到周五是本周；周六、周日开放下一周
  // （时段要提前 12 小时截止，到周末本周已经约不到什么时间了）
  const SIGNUP_NEXT_WEEK_FROM = 5; // 周六
  function signupWeek(now, base) {
    const b = Object.assign({}, DEFAULT_ROUND, base || {}), today = localDate(now, b.timezone), wd = weekdayOf(today);
    return weekStarting(wd >= SIGNUP_NEXT_WEEK_FROM ? addDays(today, 7 - wd) : addDays(today, -wd), b);
  }
  // 当前轮：进行中的活动轮优先，否则正在报名的每周轮
  function currentRound(rounds, now) {
    const pub = (rounds || []).filter((r) => r.status === "published");
    const week = signupWeek(now).id;
    return pub.find((r) => r.kind === "event" && isRoundOpen(r, now)) || pub.find((r) => r.kind === "weekly" && r.id === week) || null;
  }
  function validateRound(r) {
    const f = {};
    if (!r || !text(r.title && (r.title.zh || r.title))) f.title = "required";
    if (!/^\d{4}-\d{2}-\d{2}$/.test((r && r.startDate) || "")) f.startDate = "invalid";
    if (!/^\d{4}-\d{2}-\d{2}$/.test((r && r.endDate) || "") || (r && r.endDate < r.startDate)) f.endDate = "invalid";
    else if (r && roundDates(r).length > 31) f.endDate = "too_long";
    return { ok: !Object.keys(f).length, fields: f };
  }

  /* ---------- 问卷配置与资料 ---------- */
  function validateQuestions(cfg) {
    const errors = [], ids = {};
    if (!cfg || !Array.isArray(cfg.questions)) return ["questions must be an array"];
    cfg.questions.forEach((q, i) => {
      const at = "questions[" + i + "]" + (q && q.id ? " " + q.id : "");
      if (!q || !/^[a-z][a-zA-Z0-9_]*$/.test(q.id || "")) errors.push(at + ": id must be lowerCamel");
      else if (ids[q.id]) errors.push(at + ": duplicate id"); else ids[q.id] = true;
      if (QUESTION_TYPES.indexOf(q.type) < 0) errors.push(at + ": type must be " + QUESTION_TYPES.join("|"));
      if (!q.label || !text(q.label.zh) || !text(q.label.en)) errors.push(at + ": label needs zh and en");
      if (q.type !== "text") {
        const opts = q.options || [], oid = opts.map((o) => o.id);
        if (!opts.length) errors.push(at + ": options required");
        if (uniq(oid).length !== oid.length) errors.push(at + ": duplicate option id");
        opts.forEach((o) => { if (!o.label || !text(o.label.zh) || !text(o.label.en)) errors.push(at + ": option " + o.id + " needs zh and en"); });
        (q.complements || []).forEach((p) => { if (!Array.isArray(p) || p.length !== 2 || p.some((x) => oid.indexOf(x) < 0)) errors.push(at + ": complement " + JSON.stringify(p) + " must name two options"); });
        if (q.reasons && q.overlapWeight && !(q.reasons.overlap && q.reasons.overlap.zh && q.reasons.overlap.en)) errors.push(at + ": reasons.overlap needs zh and en");
        if (q.complements && q.complements.length && !(q.reasons && q.reasons.complement && q.reasons.complement.zh)) errors.push(at + ": reasons.complement needs zh and en");
      }
    });
    return errors;
  }
  // 问卷答案校验 → 字段错误（键为 q_<题目 id>）
  function validateAnswers(questions, answers) {
    const a = answers || {}, f = {};
    questions.forEach((q) => {
      const key = "q_" + q.id, ids = (q.options || []).map((o) => o.id);
      if (q.type === "text") {
        const v = text(a[q.id]);
        if (q.required && !v) f[key] = "required";
        else if (v.length > (q.max || 200)) f[key] = "too_long";
        return;
      }
      const v = q.type === "single" ? list(a[q.id]).slice(0, 1) : list(a[q.id]);
      if (q.required && !v.length) { f[key] = "required"; return; }
      if (q.type === "single" && list(a[q.id]).length > 1) { f[key] = "invalid"; return; }
      if (q.type === "tags") {
        if (v.length > (q.max || 5)) { f[key] = "too_many"; return; }
        if (v.some((x) => ids.indexOf(x) < 0 && !(q.allowCustom && typeof x === "string" && text(x).length > 0 && text(x).length <= LIMITS.tagCustom))) f[key] = "invalid";
        return;
      }
      if (v.some((x) => ids.indexOf(x) < 0)) f[key] = "invalid";
    });
    return f;
  }
  function cleanAnswers(questions, answers) {
    const a = answers || {}, out = {};
    questions.forEach((q) => {
      if (q.type === "text") { out[q.id] = text(a[q.id]); return; }
      const v = uniq(list(a[q.id]).map((x) => (typeof x === "string" ? x.trim() : x)).filter(Boolean));
      out[q.id] = q.type === "single" ? (v[0] || "") : v;
    });
    return out;
  }
  // year = 当前年份（在校生的毕业年份须在 year … year + gradYearsAhead）
  function validateProfile(p, questions, year) {
    p = p || {};
    const f = {};
    const need = (key, max) => { const v = line(p[key]); if (!v) f[key] = "required"; else if (v.length > max) f[key] = "too_long"; };
    need("name", LIMITS.name);
    if (IDENTITIES.indexOf(p.identity) < 0) f.identity = "invalid";
    if (p.identity === "student") {
      if (STAGES.indexOf(p.stage) < 0) f.stage = "invalid";
      const gy = Number(p.gradYear);
      if (!Number.isInteger(gy) || gy < year || gy > year + LIMITS.gradYearsAhead) f.gradYear = "invalid";
    }
    if (p.identity === "alumni") { need("job", LIMITS.job); need("city", LIMITS.city); }
    need("contactMethod", LIMITS.contactMethod);
    Object.assign(f, validateAnswers(questions, p.answers));
    return { ok: !Object.keys(f).length, fields: f };
  }
  // 只保留规定字段；另一身份的字段清空
  function cleanProfile(p, questions) {
    const student = p.identity === "student";
    return {
      name: line(p.name), identity: p.identity,
      stage: student ? p.stage : "", gradYear: student ? Number(p.gradYear) : null,
      job: student ? "" : line(p.job), city: student ? "" : line(p.city),
      contactMethod: line(p.contactMethod),
      answers: cleanAnswers(questions, p.answers)
    };
  }
  // 资料卡上公开的答案（public: true 的题目）
  function publicAnswers(questions, answers) {
    const out = {};
    questions.forEach((q) => { if (q.public && answers && answers[q.id] != null) out[q.id] = answers[q.id]; });
    return out;
  }

  /* ---------- 空闲时间 ---------- */
  const isClosed = (r, slot, now) => ms(now) > slotStart(r, slot) - r.cutoffHours * HOUR;
  function validateSlots(r, slots) {
    if (!Array.isArray(slots) || slots.some((s) => !isValidSlot(r, s))) return deny("invalid", null, { slots: "invalid" });
    return { ok: true, slots: slotIds(r).filter((s) => slots.indexOf(s) >= 0) };
  }
  // 两人都有空、都还没被别的约占用、也没过截止时间的时段
  function overlap(r, aSlots, bSlots, busy, now) {
    const b = {}, taken = busy || [];
    (bSlots || []).forEach((s) => (b[s] = true));
    return (aSlots || []).filter((s) => b[s] && taken.indexOf(s) < 0 && isValidSlot(r, s) && !isClosed(r, s, now)).sort();
  }

  /* ---------- 邀请与匹配 ---------- */
  function inviteStatus(inv, r, now) {
    return inv.status === "pending" && r && ms(now) >= roundEndMs(r) ? "expired" : inv.status;
  }
  const between = (inv, x, y) => (inv.fromId === x && inv.toId === y) || (inv.fromId === y && inv.toId === x);
  // c = { round（当前轮）, fromId, toId, fromJoined, toJoined, invites, now }
  // invites = 所有还没结束的轮里的邀请；每条可带自己的 round（周末时上一周和下一周同时有效），没带就当作当前轮
  function checkInvite(c) {
    if (isRoundOver(c.round, c.now)) return deny("conflict", "round_closed");
    if (!c.fromJoined) return deny("forbidden", "not_joined");
    if (!c.toId || !c.toJoined) return deny("not_found");
    if (c.toId === c.fromId) return deny("forbidden", "self");
    const live = (c.invites || []).filter((i) => !isRoundOver(i.round || c.round, c.now));
    const here = live.filter((i) => between(i, c.fromId, c.toId));
    if (here.some((i) => i.status === "accepted")) return deny("conflict", "already_matched");
    const reverse = here.find((i) => i.fromId === c.toId && inviteStatus(i, i.round || c.round, c.now) === "pending");
    if (reverse) return { ok: true, autoAccept: reverse.id }; // 对方已经邀请过你：直接匹配
    if (here.some((i) => i.fromId === c.fromId)) return deny("conflict", "already_invited");
    // 名额：被跳过的邀请在发起人这边仍然算"等待回复"，直到它所在的轮结束（否则名额突然空出来就暴露了"对方跳过"）
    const open = live.filter((i) => i.fromId === c.fromId && (i.status === "pending" || i.status === "skipped")).length;
    if (open >= c.round.maxOpenInvites) return deny("rate_limited", "too_many_open");
    return { ok: true };
  }
  function createInvite(input, fromId, roundId, now, id) {
    return {
      id, roundId, fromId, toId: text(input.toId), note: text(input.note).slice(0, LIMITS.note),
      source: input.source === "rec" ? "rec" : "browse", status: "pending", createdAt: iso(now), respondedAt: null,
      slot: null, scheduledBy: null, scheduledAt: null, outcomes: {}
    };
  }
  function validateInviteInput(input) {
    const f = {};
    if (text(input && input.note).length > LIMITS.note) f.note = "too_long";
    return { ok: !Object.keys(f).length, fields: f };
  }
  function roleOf(inv, userId) {
    return !inv || !userId ? null : inv.fromId === userId ? "from" : inv.toId === userId ? "to" : null;
  }
  // 被邀请人回复：accept 想认识 / skip 跳过
  function respond(inv, action, userId, r, now) {
    if (action !== "accept" && action !== "skip") return deny("invalid", "unknown_action");
    const role = roleOf(inv, userId);
    if (!role) return deny("not_found");
    if (role !== "to") return deny("forbidden", "wrong_role");
    const st = inviteStatus(inv, r, now);
    if (st !== "pending") return deny("conflict", st === "expired" ? "expired" : "already_answered");
    return { ok: true, next: Object.assign({}, inv, { status: action === "accept" ? "accepted" : "skipped", respondedAt: iso(now) }) };
  }
  const canSeeContact = (inv, userId) => !!roleOf(inv, userId) && inv.status === "accepted";
  // 已匹配的双方任一方都可以选一个重叠时间（也可以改，只要还没开始）
  function schedule(inv, slot, userId, r, available, now) {
    if (!roleOf(inv, userId)) return deny("not_found");
    if (inv.status !== "accepted") return deny("conflict", "not_matched");
    if (inv.slot && ms(now) >= slotStart(r, inv.slot)) return deny("conflict", "already_started");
    if (slot === null) return { ok: true, unchanged: !inv.slot, next: Object.assign({}, inv, { slot: null, scheduledBy: null, scheduledAt: null }) };
    if (slot === inv.slot) return { ok: true, unchanged: true, next: inv }; // 重复提交同一个时间：什么都不变，也不重复发邮件
    if ((available || []).indexOf(slot) < 0) return deny("conflict", "slot_unavailable");
    // 约了新时间：之前（没约时间时）的"见到了吗"回答不算这次见面的，清掉
    return { ok: true, next: Object.assign({}, inv, { slot, scheduledBy: userId, scheduledAt: iso(now), outcomes: {} }) };
  }
  // "见到了吗"：约定时间开始之后（没约定时间则匹配后任何时候）。
  // met = null：撤回自己的回答（只在没约时间时，"其实还没聊"——还没聊不等于没见到）
  function recordOutcome(inv, met, userId, r, now) {
    if (!roleOf(inv, userId)) return deny("not_found");
    if (inv.status !== "accepted") return deny("conflict", "not_matched");
    if (inv.slot && ms(now) < slotStart(r, inv.slot)) return deny("conflict", "too_early");
    if (typeof met !== "boolean" && !(met === null && !inv.slot)) return deny("invalid", null, { met: "invalid" });
    const outcomes = Object.assign({}, inv.outcomes);
    if (met === null) delete outcomes[userId];
    else outcomes[userId] = met ? "met" : "missed";
    return { ok: true, next: Object.assign({}, inv, { outcomes }) };
  }

  /* ---------- 推荐 ---------- */
  const optLabel = (q, id) => { const o = (q.options || []).find((x) => x.id === id); return o ? o.label : { zh: String(id), en: String(id) }; };
  const fill = (tpl, items) => ({ zh: tpl.zh.replace("{items}", items.map((x) => x.zh).join("、")), en: tpl.en.replace("{items}", items.map((x) => x.en).join(", ")) });
  // 两份答案按问卷配置打分，返回分数与理由
  function scorePair(questions, a, b) {
    let score = 0;
    const reasons = [];
    questions.forEach((q) => {
      if (q.type === "text") return;
      const ignore = q.ignoreForOverlap || [];
      const x = list(a && a[q.id]).filter((v) => ignore.indexOf(v) < 0), y = list(b && b[q.id]).filter((v) => ignore.indexOf(v) < 0);
      if (q.overlapWeight) {
        const shared = x.filter((v) => y.indexOf(v) >= 0 && (q.options || []).some((o) => o.id === v)).slice(0, q.overlapCap || 3);
        if (shared.length) {
          score += shared.length * q.overlapWeight;
          if (q.reasons && q.reasons.overlap) reasons.push({ weight: shared.length * q.overlapWeight, text: fill(q.reasons.overlap, shared.map((v) => optLabel(q, v))) });
        }
      }
      if (q.complements && q.complementWeight) {
        const hit = q.complements.filter((p) => (x.indexOf(p[0]) >= 0 && y.indexOf(p[1]) >= 0) || (x.indexOf(p[1]) >= 0 && y.indexOf(p[0]) >= 0));
        if (hit.length) {
          score += q.complementWeight;
          if (q.reasons && q.reasons.complement) reasons.push({ weight: q.complementWeight, text: fill(q.reasons.complement, [optLabel(q, hit[0][0])]) });
        }
      }
    });
    reasons.sort((p, q) => q.weight - p.weight);
    return { score, reasons: reasons.map((r) => r.text) };
  }
  // 稳定的伪随机（同一轮内同样的输入得到同样的顺序）
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  /* c = { round, me: { id, answers, slots }, people: [{ id, answers, slots, identity }], questions,
           invites（本轮）, everMatched（pairKey 集合）, dismissed（我跳过的推荐 id）, busy: { userId: [slot] }, now, k } */
  function recommend(c) {
    const r = c.round, me = c.me, everMatched = c.everMatched || {}, dismissed = c.dismissed || [], busy = c.busy || {};
    const incoming = {};
    (c.invites || []).forEach((i) => { if (inviteStatus(i, i.round || r, c.now) === "pending") incoming[i.toId] = (incoming[i.toId] || 0) + 1; });
    const theme = r.themeTags || [];
    const scored = [];
    (c.people || []).forEach((p) => {
      if (p.id === me.id || everMatched[pairKey(me.id, p.id)] || dismissed.indexOf(p.id) >= 0) return;
      if ((c.invites || []).some((i) => between(i, me.id, p.id))) return;
      const common = overlap(r, me.slots, p.slots, (busy[me.id] || []).concat(busy[p.id] || []), c.now);
      if (!common.length) return;
      const s = scorePair(c.questions, me.answers, p.answers);
      let score = s.score + 1; // 有重叠时间的基础分
      const reasons = s.reasons.slice();
      const themeHit = theme.filter((t) => list(p.answers && p.answers.interests).indexOf(t) >= 0 || list(p.answers && p.answers.goals).indexOf(t) >= 0);
      if (themeHit.length) { score += 2; reasons.push({ zh: "符合本期活动主题", en: "Fits this round's theme" }); }
      score -= Math.max(0, (incoming[p.id] || 0) - 2) * 0.5; // 本轮已收到很多邀请的人降权
      score += hash(r.id + me.id + p.id) * 0.01; // 同分时稳定打散
      if (!reasons.length) reasons.push({ zh: "你们这周有共同的空闲时间", en: "You're both free at the same time this week" });
      scored.push({ id: p.id, score: Math.round(score * 1000) / 1000, reasons: reasons.slice(0, 2), overlapCount: common.length });
    });
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, c.k == null ? r.recCount : c.k);
  }
  const recsEnabled = (r, participantCount) => participantCount >= r.poolThreshold;

  /* ---------- 大模型重排序（只在服务端调用；这里只负责拼提示和校验输出） ----------
     只发匿名编号与问卷答案，绝不发姓名、邮箱、联系方式；输出只接受候选名单里的编号，否则退回规则排序。 */
  const PROFILE_FIELDS_FOR_LLM = ["identity", "stage", "gradYear"];
  function anonymize(person, questions, lang) {
    const out = {};
    PROFILE_FIELDS_FOR_LLM.forEach((k) => { if (person[k]) out[k] = person[k]; });
    questions.forEach((q) => {
      const v = person.answers && person.answers[q.id];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
      out[q.id] = q.type === "text" ? String(v).slice(0, q.max || 200) : list(v).map((x) => optLabel(q, x)[lang] || x);
    });
    return out;
  }
  function buildRerankMessages(me, candidates, questions, k, lang) {
    lang = lang === "en" ? "en" : "zh";
    const data = { me: anonymize(me, questions, lang), candidates: candidates.map((c, i) => Object.assign({ id: "C" + (i + 1) }, anonymize(c, questions, lang), { ruleReasons: (c.reasons || []).map((x) => x[lang]) })) };
    return [
      { role: "system", content: "你是一个校友社群 coffee chat 的推荐助手。从候选人里选出最适合和“me”聊天的人，按合适程度排序。只能使用给出的信息，不要编造事实。" +
        "只输出 JSON：{\"picks\":[{\"id\":\"C1\",\"reason\":\"…\"}]}，最多 " + k + " 个；reason 用" + (lang === "zh" ? "中文，不超过 40 字" : " English, under 25 words") + "，说明为什么你们值得聊。" },
      { role: "user", content: JSON.stringify(data) }
    ];
  }
  function parseRerank(textOut, candidates, k) {
    let parsed;
    try { parsed = JSON.parse(String(textOut).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (e) { return null; }
    if (!parsed || !Array.isArray(parsed.picks)) return null;
    const seen = {}, out = [];
    for (const p of parsed.picks) {
      const idx = /^C(\d+)$/.exec(p && p.id) ? Number(p.id.slice(1)) - 1 : -1;
      if (idx < 0 || idx >= candidates.length || seen[idx]) continue;
      seen[idx] = true;
      const reason = typeof p.reason === "string" ? p.reason.trim().slice(0, 80) : "";
      out.push({ id: candidates[idx].id, reason });
      if (out.length >= k) break;
    }
    return out.length ? out : null;
  }

  /* ---------- 通知偏好与意见箱 ---------- */
  function cleanPrefs(p) {
    const out = {};
    EMAIL_KINDS.forEach((k) => (out[k] = REQUIRED_EMAILS.indexOf(k) >= 0 ? true : !(p && p[k] === false)));
    return out;
  }
  // 意见箱类型：问题 / 建议 / 举报（写清对方名字、哪一轮、发生了什么）/ 其他
  const FEEDBACK_KINDS = ["bug", "idea", "report", "other"];
  function validateFeedback(input) {
    const i = input || {}, f = {}, t = text(i.text);
    if (FEEDBACK_KINDS.indexOf(i.kind) < 0) f.kind = "invalid";
    if (t.length < LIMITS.feedbackMin) f.text = "too_short"; else if (t.length > LIMITS.feedbackMax) f.text = "too_long";
    return { ok: !Object.keys(f).length, fields: f };
  }

  return {
    IDENTITIES, STAGES, QUESTION_TYPES, INVITE_STATUSES, EMAIL_KINDS, REQUIRED_EMAILS, DEFAULT_ROUND, LIMITS,
    slotTimes, roundDates, slotIds, isValidSlot, slotStart, localDate, addDays, isRoundOpen, isRoundOver, roundEndMs, weeklyRound, signupWeek, currentRound, validateRound,
    validateQuestions, validateAnswers, cleanAnswers, validateProfile, cleanProfile, publicAnswers,
    isClosed, validateSlots, overlap,
    inviteStatus, checkInvite, createInvite, validateInviteInput, roleOf, respond, canSeeContact, schedule, recordOutcome, pairKey,
    scorePair, recommend, recsEnabled, buildRerankMessages, parseRerank, anonymize,
    cleanPrefs, validateFeedback, FEEDBACK_KINDS
  };
});
