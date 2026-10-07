/* 演示版假后端 —— 整个 Yalelux 后端在浏览器里跑一份，供 GitHub Pages 这类纯静态托管演示用。
   Demo-only in-browser backend for static hosting (GitHub Pages).

   原理：在 js/app.js 启动之前替换 window.fetch。请求地址落在 YL_CONFIG.apiBase（默认 /api）下的，
   由这里按 server/*.js 的同样规则作答（同样的 HTTP 状态、{ ok, data } / { ok: false, error } 信封、错误码）；
   其他请求（词典、图片……）照常交给真正的 fetch。业务规则直接调用 YL.domain.coffee（和后端共用的那份纯函数）。

   和真实后端的差别（只为演示）：
   - 数据只存在这个浏览器的 localStorage "yl.demo.v1"；YLDemo.reset() 清空并重新生成演示数据。
   - 验证码永远是 000000（登录、联系邮箱都是）；不限 60 秒重发、不按 IP 限频；邮件只记录在管理后台「邮件」里。
   - admin@yale.edu 是管理员；演示里管理员的登录码总是"发到耶鲁邮箱"，免得第二次登录变成联系邮箱登录、进不了后台。
   - 推荐只用规则（没有 DeepSeek）；没有定时任务（每周提醒、邀请汇总、前一天提醒不会自动发）。
   - 让演示"活"起来：新同学第一次参加某一轮时，两位演示同学会给 TA 发邀请；
     邀请演示同学后，id 哈希为偶数的同学约 3 秒后接受（匹配 + 邮件记录），其余的不回应。

   演示数据在运行时按"现在"生成（任何日期都能用）：24 位虚构同学（demo/demo-data.js，由 scripts/build-demo.mjs
   跑真实的 server/seed.js 导出）、正在报名的每周轮、上一周几场已完成的 coffee chat、一个已发布的活动轮。 */
(function () {
  "use strict";
  var DATA = window.YL_DEMO_DATA || { users: [], questions: [], consentVersion: "2026-10" };
  var C = window.YL && YL.domain && YL.domain.coffee;
  if (!C) { console.error("demo: YL.domain.coffee 没有加载，演示后端无法启动"); return; }

  var KEY = "yl.demo.v1";
  var VERSION = 1;
  var CV = DATA.consentVersion || "2026-10";
  var Q = DATA.questions || [];
  var ADMIN_EMAILS = ["admin@yale.edu"];
  var ALLOWED_DOMAINS = ["yale.edu", "aya.yale.edu"];
  var STATUS = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, too_large: 413, rate_limited: 429, internal: 500 };
  var PARAM = /^[A-Za-z0-9_-]{1,64}$/;
  var MAX_BODY = 100 * 1024;
  var DAY = 86400000, HOUR = 3600000;
  var CODE = "000000", CODE_TTL = 10 * 60000, MAX_ATTEMPTS = 5;
  var EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
  var OPTIONAL_MAIL = ["invite_digest", "reminder", "weekly", "event"];
  var ACCEPT_DELAY = 3000;

  /* ---------- 小工具 ---------- */
  function ApiError(code, extra) { this.code = STATUS[code] ? code : "internal"; this.extra = extra || null; }
  var fail = function (code, extra) { return new ApiError(code, extra); };
  var nowIso = function () { return new Date().toISOString(); };
  var ago = function (ms) { return new Date(Date.now() - ms).toISOString(); };
  var norm = function (e) { return String(e || "").trim().toLowerCase(); };
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
  // 稳定的哈希（FNV-1a）：演示同学的空闲时间、谁会接受邀请，都由它决定
  function fnv(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var unit = function (s) { return fnv(s) / 4294967296; };
  function randHex(n) {
    var out = "", a = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < n; j++) out += (a[j] < 16 ? "0" : "") + a[j].toString(16);
    return out;
  }
  var newId = function (p) { return p + "-" + randHex(6); };
  var validEmail = function (e) { return e.length <= 254 && EMAIL_RE.test(e); };
  function isYale(email) {
    if (!validEmail(email)) return false;
    var d = email.slice(email.lastIndexOf("@") + 1);
    return ALLOWED_DOMAINS.some(function (a) { return d === a || d.endsWith("." + a); });
  }
  var mask = function (e) { return e.replace(/^(.)(.*)(@.*)$/, function (m, a, b, c) { return a + "*".repeat(Math.max(1, Math.min(b.length, 6))) + c; }); };
  // 哪些演示同学会接受邀请：id 哈希为偶数
  var willAccept = function (id) { return (fnv(id) & 1) === 0; };

  /* ---------- 状态（相当于数据库） ---------- */
  var S = null;
  function readStore() {
    try { var raw = localStorage.getItem(KEY); if (raw) { var s = JSON.parse(raw); if (s && s.v === VERSION && Array.isArray(s.users)) return s; } } catch (e) { /* 隐私模式等：只用内存 */ }
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 存不下就只留在内存里 */ } }
  // 每个请求开始时重新读一次（多个标签页共用一份数据）
  function load() {
    var s = readStore();
    if (s) { S = s; return; }
    if (!S) seed();
    save();
  }

  var userById = function (id) { return S.users.find(function (u) { return u.id === id; }) || null; };
  var userByEmail = function (email) { return S.users.find(function (u) { return u.login_email === email; }) || null; };
  var isConsented = function (u) { return !!u && u.consent_version === CV; };
  var isReady = function (u) { return isConsented(u) && !!u.profile_done_at && !!u.contact_email; };
  var isAdmin = function (u, session) { return !!u && ADMIN_EMAILS.indexOf(u.login_email) >= 0 && !!session && session.via === "yale"; };
  function meDTO(u, via) {
    return {
      id: u.id, loginEmail: u.login_email, contactEmail: u.contact_email || null, contactVerified: !!u.contact_verified_at,
      via: via, needsConsent: u.consent_version !== CV, needsContact: !u.contact_email, needsProfile: !u.profile_done_at,
      ready: isReady(u), isAdmin: isAdmin(u, { via: via }), adminNeedsYale: ADMIN_EMAILS.indexOf(u.login_email) >= 0 && via !== "yale",
      name: u.name || null, identity: u.identity || null, stage: u.stage || null, gradYear: u.grad_year == null ? null : u.grad_year, job: u.job || null, city: u.city || null,
      contactMethod: u.contact_method || null, answers: u.answers || {}, prefs: C.cleanPrefs(u.prefs || {}), smartRec: u.smart_rec === 1
    };
  }
  function newUserRow(id, email, t) {
    return { id: id, login_email: email, contact_email: null, contact_verified_at: null, yale_verified_at: t, consent_version: null, consent_at: null,
      name: null, identity: null, stage: null, grad_year: null, job: null, city: null, contact_method: null, answers: {}, prefs: C.cleanPrefs({}),
      smart_rec: 1, profile_done_at: null, last_digest_at: null, last_seen_at: null, created_at: t, updated_at: t, demo: false };
  }

  /* ---------- 发信（只记录，不发出） ---------- */
  var recipient = function (u) { return u && u.contact_email && u.contact_verified_at ? u.contact_email : u && u.login_email; };
  function sendMail(kind, user, toOverride, at) {
    var to = toOverride || recipient(user) || "";
    var prefs = (user && user.prefs) || {};
    var status = OPTIONAL_MAIL.indexOf(kind) >= 0 && prefs[kind] === false ? "skipped" : "sent";
    S.emails.push({ id: ++S.seq.email, user_id: user ? user.id : null, to_addr: to, kind: kind, status: status, error: null, created_at: at || nowIso() });
    if (S.emails.length > 600) S.emails.splice(0, S.emails.length - 600);
    return status === "sent";
  }
  function audit(actor, op, target, ok, code, at) {
    S.audit.push({ id: ++S.seq.audit, at: at || nowIso(), actor: actor || null, op: op, target: target ? String(target).slice(0, 64) : null, ok: ok ? 1 : 0, code: code || null });
    if (S.audit.length > 400) S.audit.splice(0, S.audit.length - 400);
  }
  // 记访问（后台 7 日回访用）：每人每个 UTC 日一条
  function touch(user) {
    var t = nowIso(), day = t.slice(0, 10);
    if (user.last_seen_at && user.last_seen_at.slice(0, 10) === day) return;
    user.last_seen_at = t;
    var v = S.visits[user.id] || (S.visits[user.id] = []);
    if (v.indexOf(day) < 0) v.push(day);
  }

  /* ---------- 轮次 ---------- */
  function toRound(row) {
    return Object.assign({}, C.DEFAULT_ROUND, row.config || {}, {
      id: row.id, kind: row.kind, status: row.status, title: row.title || {}, themeTags: row.theme_tags || [],
      startDate: row.start_date, endDate: row.end_date, post: row.post || {}
    });
  }
  var roundRow = function (id) { return S.rounds.find(function (r) { return r.id === id; }) || null; };
  var roundById = function (id) { var r = roundRow(id); return r ? toRound(r) : null; };
  function insertWeekly(week, t) {
    if (roundRow(week.id)) return;
    S.rounds.push({ id: week.id, kind: "weekly", status: "published", title: { zh: "每周 Coffee Chat", en: "Weekly coffee chats" }, theme_tags: [], config: {},
      start_date: week.startDate, end_date: week.endDate, post: {}, announced_at: null, created_at: t, updated_at: t });
  }
  var recentRounds = function (t) {
    var from = C.addDays(t.slice(0, 10), -1);
    return S.rounds.filter(function (r) { return r.status === "published" && r.end_date >= from; }).map(toRound);
  };
  var activeRounds = function (t) { return recentRounds(t).filter(function (r) { return !C.isRoundOver(r, t); }); };
  // 当前轮；正在报名的每周轮不存在就创建；演示同学还没加入就加进去（相当于每次都"跑一遍 seed"）
  function currentRound(at) {
    var t = at || nowIso();
    insertWeekly(C.signupWeek(t), t);
    var round = C.currentRound(recentRounds(t), t);
    if (round && !S.demoJoined[round.id]) joinDemoUsers(round, t);
    return round;
  }
  var roundInvites = function (roundId) { return S.invites.filter(function (i) { return i.roundId === roundId; }); };
  function activeInvites(t) {
    return activeRounds(t).reduce(function (all, r) {
      return all.concat(roundInvites(r.id).map(function (i) { return Object.assign({}, i, { round: r }); }));
    }, []);
  }
  var invById = function (id) { return S.invites.find(function (i) { return i.id === id; }) || null; };
  var participation = function (roundId, userId) { return S.participations.find(function (p) { return p.round_id === roundId && p.user_id === userId; }) || null; };
  // 本轮参与者：资料已完成、并且同意了当前版本的隐私说明
  function participants(round) {
    return S.participations.filter(function (p) { return p.round_id === round.id; }).map(function (p) {
      var u = userById(p.user_id);
      if (!u || !u.profile_done_at || u.consent_version !== CV) return null;
      return { id: u.id, identity: u.identity, stage: u.stage, gradYear: u.grad_year, answers: u.answers || {}, slots: p.slots.slice(), updatedAt: p.updated_at, row: u };
    }).filter(Boolean);
  }
  var participantCount = function (round) { return participants(round).length; };
  function everMatched(userId) {
    var out = {};
    S.invites.forEach(function (i) { if (i.status === "accepted" && (i.fromId === userId || i.toId === userId)) out[C.pairKey(i.fromId, i.toId)] = true; });
    return out;
  }
  function busyMap(invites) {
    var out = {};
    invites.filter(function (i) { return i.status === "accepted" && i.slot; }).forEach(function (i) {
      (out[i.fromId] = out[i.fromId] || []).push(i.slot); (out[i.toId] = out[i.toId] || []).push(i.slot);
    });
    return out;
  }
  // 公开资料卡（不含邮箱、联系方式）
  function card(u) {
    return { id: u.id, name: u.name, identity: u.identity, stage: u.stage, gradYear: u.grad_year, job: u.job, city: u.city, answers: C.publicAnswers(Q, u.answers || {}) };
  }
  function roundDTO(r) {
    return r && { id: r.id, kind: r.kind, title: r.title, themeTags: r.themeTags, startDate: r.startDate, endDate: r.endDate, timezone: r.timezone, dayStart: r.dayStart, dayEnd: r.dayEnd,
      slotMinutes: r.slotMinutes, gapMinutes: r.gapMinutes, cutoffHours: r.cutoffHours, recCount: r.recCount, maxOpenInvites: r.maxOpenInvites, openBrowse: r.openBrowse, poolThreshold: r.poolThreshold, post: r.post };
  }
  function relation(invites, me, other, t) {
    var pair = invites.filter(function (i) { return (i.fromId === me && i.toId === other) || (i.fromId === other && i.toId === me); });
    var matched = pair.find(function (i) { return i.status === "accepted"; });
    if (matched) return { state: "matched", inviteId: matched.id };
    var inc = pair.find(function (i) { return i.fromId === other && C.inviteStatus(i, i.round, t) === "pending"; });
    if (inc) return { state: "incoming", inviteId: inc.id };
    var out = pair.find(function (i) { return i.fromId === me; });
    if (out) return { state: C.isRoundOver(out.round, t) ? "no_reply" : "invited", inviteId: out.id };
    return { state: "none" };
  }
  function requireJoined(round, userId) {
    if (!round) throw fail("conflict", { reason: "round_closed" });
    var p = participation(round.id, userId);
    if (!p) throw fail("forbidden", { reason: "not_joined" });
    return p;
  }
  var overlapForViewer = function (round, me, other, busy, t) { return C.overlap(round, me.slots, other.slots, busy[me.id] || [], t); };
  function notifyMatch(inv, at) {
    var a = userById(inv.fromId), b = userById(inv.toId);
    if (a && b) { sendMail("match", a, null, at); sendMail("match", b, null, at); }
  }
  function updateInvite(next) {
    var row = invById(next.id), o = Object.assign({}, next);
    delete o.round;
    if (row) Object.assign(row, o);
    return row;
  }

  /* ---------- 演示同学：空闲时间 ---------- */
  // 只从还没截止的、最近 7 天里的时段里挑（和 server/seed.js 一样）；每人大约三分之一，新同学随便选几个时间都有共同空闲
  function demoSlots(round, userId, t) {
    var open = C.slotIds(round).filter(function (s) { return !C.isClosed(round, s, t); });
    if (!open.length) return [];
    var limit = C.addDays(open[0].slice(0, 10), 7);
    var soon = open.filter(function (s) { return s.slice(0, 10) < limit; });
    var picked = soon.filter(function (s) { return unit(userId + "|" + s) < 0.34; });
    for (var i = 0; picked.length < Math.min(8, soon.length) && i < soon.length; i++) if (picked.indexOf(soon[i]) < 0) picked.push(soon[i]);
    return C.slotIds(round).filter(function (s) { return picked.indexOf(s) >= 0; });
  }
  function joinDemoUsers(round, t) {
    S.demoJoined[round.id] = true;
    S.users.filter(function (u) { return u.demo; }).forEach(function (u) {
      if (participation(round.id, u.id)) return;
      var slots = demoSlots(round, u.id, t);
      if (slots.length) S.participations.push({ round_id: round.id, user_id: u.id, slots: slots, joined_at: t, updated_at: t });
    });
  }

  /* ---------- 推荐（规则；缓存逻辑和 server/recommend.js 一致，没有大模型） ---------- */
  var RULE_POOL = 12;
  function recsFor(round, meId, people, invites, everM, busy) {
    var t = nowIso(), key = round.id + "|" + meId, cached = S.recs[key];
    var part = people.find(function (p) { return p.id === meId; });
    var dismissed = cached ? cached.dismissed : [];
    if (cached && part && cached.created_at && cached.created_at >= part.updatedAt) {
      var short = cached.items.filter(function (x) { return dismissed.indexOf(x.id) < 0; }).length < round.recCount;
      var newest = S.participations.filter(function (p) { return p.round_id === round.id; }).reduce(function (m, p) { return p.updated_at > m ? p.updated_at : m; }, "");
      if (!short || newest <= cached.created_at) return { engine: cached.engine, items: cached.items, dismissed: dismissed };
    }
    if (!part) return { engine: "rules", items: [], dismissed: dismissed };
    var ranked = C.recommend({ round: round, me: part, people: people, questions: Q, invites: invites, everMatched: everM, dismissed: dismissed, busy: busy, now: t, k: RULE_POOL });
    var items = ranked.slice(0, round.recCount).map(function (x) { return { id: x.id, reasons: x.reasons }; });
    S.recs[key] = { engine: "rules", items: items, candidates: ranked.map(function (x) { return { id: x.id, score: x.score }; }), dismissed: dismissed.slice(), created_at: t };
    return { engine: "rules", items: items, dismissed: S.recs[key].dismissed };
  }
  function resetRecs(userId) { Object.keys(S.recs).forEach(function (k) { if (k.split("|")[1] === userId) S.recs[k].created_at = ""; }); }

  /* ---------- 让演示"活"起来 ---------- */
  var WELCOME_NOTES = [
    "你好！看到我们有不少共同兴趣，想约杯咖啡聊聊～",
    "Hi! 我们这周有共同的空闲时间，想认识一下，聊聊求职和生活。",
    "你好呀，刚好也在找同方向的朋友，有空一起喝杯咖啡吗？"
  ];
  // 新同学第一次参加某一轮：两位有共同空闲的演示同学给 TA 发邀请
  function welcomeInvites(round, me, t) {
    if (S.lively.welcomed[me.id]) return;
    S.lively.welcomed[me.id] = true;
    var all = activeInvites(t), em = everMatched(me.id), myP = participation(round.id, me.id);
    var cands = participants(round).filter(function (p) {
      return p.row.demo && p.id !== me.id && !em[C.pairKey(me.id, p.id)] &&
        !all.some(function (i) { return (i.fromId === p.id && i.toId === me.id) || (i.fromId === me.id && i.toId === p.id); }) &&
        C.overlap(round, myP.slots, p.slots, [], t).length > 0;
    }).sort(function (a, b) { return unit(me.id + a.id) - unit(me.id + b.id); }).slice(0, 2);
    cands.forEach(function (p, k) {
      var inv = C.createInvite({ toId: me.id, note: WELCOME_NOTES[(fnv(p.id) + k) % WELCOME_NOTES.length], source: "rec" }, p.id, round.id, new Date(Date.now() - (k + 1) * 1000).toISOString(), newId("inv"));
      S.invites.push(inv);
      audit(p.id, "POST /coffee/invites", inv.id, true, null);
    });
  }
  // 到时间的"演示同学接受邀请"
  function processDue() {
    var t = nowIso(), done = [];
    S.lively.accepts = S.lively.accepts.filter(function (a) {
      if (a.due > Date.now()) return true;
      var row = invById(a.inviteId);
      if (!row || row.status !== "pending") return false;
      var round = roundById(row.roundId);
      var r = C.respond(row, "accept", row.toId, round, t);
      if (!r.ok) return false;
      var dup = activeInvites(t).some(function (i) { return i.id !== row.id && i.status === "accepted" && ((i.fromId === row.fromId && i.toId === row.toId) || (i.fromId === row.toId && i.toId === row.fromId)); });
      if (dup) return false;
      updateInvite(r.next);
      notifyMatch(r.next, t);
      audit(row.toId, "POST /coffee/invites/:id/:action", row.id, true, null, t);
      done.push(row);
      return false;
    });
    return done;
  }
  var timer = null;
  function scheduleTick() {
    if (timer || !S.lively.accepts.length) return;
    var next = Math.min.apply(null, S.lively.accepts.map(function (a) { return a.due; }));
    timer = setTimeout(function () {
      timer = null;
      load();
      var done = processDue();
      save();
      var meId = S.session && S.session.userId, en = lang() === "en";
      done.filter(function (i) { return i.fromId === meId; }).forEach(function (i) {
        var other = userById(i.toId);
        if (other && YL.ui && YL.ui.toast) YL.ui.toast(en ? other.name + " accepted your invite. It's a match! See Matches." : other.name + " 接受了你的邀请，匹配成功！去「匹配」看看。", "success");
      });
      scheduleTick();
    }, Math.max(50, next - Date.now() + 50));
  }

  /* ---------- 验证码（永远是 000000） ---------- */
  function issueCode(purpose, key, target, forcedYale) {
    S.codes[purpose + "|" + key] = { target: target, forced_yale: forcedYale ? 1 : 0, created_at: nowIso(), expires_at: new Date(Date.now() + CODE_TTL).toISOString(), attempts: 0, used: false };
  }
  function checkCode(purpose, key, code) {
    var row = S.codes[purpose + "|" + key];
    if (!row || row.used || row.expires_at <= nowIso()) throw fail("invalid", { fields: { code: "expired" } });
    if (row.attempts >= MAX_ATTEMPTS) throw fail("invalid", { fields: { code: "too_many_attempts" } });
    if (String(code || "").trim().slice(0, 12) !== CODE) {
      row.attempts++;
      throw fail("invalid", { fields: { code: row.attempts >= MAX_ATTEMPTS ? "too_many_attempts" : "wrong" } });
    }
    row.used = true;
    return row;
  }
  // 验证码发到哪里：老用户、联系邮箱已验证 → 联系邮箱（除非指定发耶鲁邮箱）。演示：管理员总是耶鲁邮箱
  function codeTarget(user, email, via) {
    if (ADMIN_EMAILS.indexOf(email) >= 0) return { to: email, via: "yale" };
    var yaleFresh = user && Date.now() - Date.parse(user.yale_verified_at) < 365 * DAY;
    if (user && via !== "yale" && yaleFresh && user.contact_email && user.contact_verified_at) return { to: user.contact_email, via: "contact" };
    return { to: email, via: "yale" };
  }
  var requireYale = function (req) { if (req.session.via !== "yale") throw fail("forbidden", { reason: "reverify_yale" }); };
  var hits = {};
  function limit(key, max, windowMs, reason) {
    var t = Date.now(), arr = (hits[key] || []).filter(function (x) { return t - x < windowMs; });
    if (arr.length >= max) throw fail("rate_limited", { reason: reason || "too_many_requests" });
    arr.push(t); hits[key] = arr;
  }

  /* ---------- 路由表（和 server/http.js 一样的写法与鉴权级别） ---------- */
  var routes = [];
  function route(method, pattern, handler, meta) {
    var keys = [];
    var re = new RegExp("^" + pattern.split("/").map(function (seg) { return seg[0] === ":" ? (keys.push(seg.slice(1)), "([^/]+)") : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("/") + "/?$");
    routes.push(Object.assign({ auth: "user", audit: method !== "GET" }, meta, { method: method, pattern: pattern, handler: handler, re: re, keys: keys }));
  }
  var me = function (req) { return meDTO(userById(req.user.id), req.session.via); };

  route("GET", "/meta", function () { return { consentVersion: CV, dev: false, smartRecAvailable: false, questions: Q }; }, { auth: "none", audit: false });

  /* 登录与账号（server/auth.js） */
  route("POST", "/auth/request-code", function (req) {
    var email = norm(req.body.email);
    if (!isYale(email)) throw fail("invalid", { fields: { email: "not_yale" } });
    var user = userByEmail(email);
    var tg = codeTarget(user, email, req.body.via === "yale" ? "yale" : undefined);
    issueCode("login", email, tg.via, req.body.via === "yale");
    sendMail("login_code", user, tg.to);
    return { sent: true };
  }, { auth: "none", audit: false });

  route("POST", "/auth/verify", function (req) {
    var email = norm(req.body.email);
    if (!isYale(email)) throw fail("invalid", { fields: { email: "not_yale" } });
    var row = checkCode("login", email, req.body.code);
    var via = row.target === "contact" ? "contact" : "yale";
    var user = userByEmail(email), t = nowIso();
    if (!user) {
      if (via !== "yale") throw fail("forbidden");
      user = newUserRow("u-" + randHex(8), email, t);
      S.users.push(user);
    } else if (via === "yale") { user.yale_verified_at = t; user.updated_at = t; }
    req.startSession(user.id, via);
    req.setActor(user.id);
    return { user: meDTO(user, via) };
  }, { auth: "none" });

  route("GET", "/auth/me", function (req) { return { user: req.user ? meDTO(req.user, req.session.via) : null }; }, { auth: "none" });
  route("POST", "/auth/logout", function (req) { req.endSession(); return { ok: true }; });

  route("POST", "/me/consent", function (req) {
    if (req.body.version !== CV) throw fail("invalid", { fields: { consent: "version" } });
    var t = nowIso();
    Object.assign(req.user, { consent_version: req.body.version, consent_at: t, updated_at: t });
    return me(req);
  });

  route("POST", "/me/contact-email", function (req) {
    var email = norm(req.body.email), u = req.user;
    if (!validEmail(email)) throw fail("invalid", { fields: { contactEmail: "invalid" } });
    var changing = email !== u.contact_email;
    if (u.contact_email && changing) requireYale(req);
    if (!changing && u.contact_verified_at) return me(req);
    limit("contact:" + u.id, 5, HOUR);
    issueCode("contact", u.id, email);
    Object.assign(u, { contact_email: email, contact_verified_at: null, updated_at: nowIso() });
    sendMail("contact_code", u, email);
    return Object.assign(me(req), { sentTo: mask(email) });
  }, { auth: "consented" });

  route("POST", "/me/contact-email/verify", function (req) {
    var u = req.user, row = checkCode("contact", u.id, req.body.code);
    if (row.target !== u.contact_email) throw fail("conflict", { reason: "email_changed" });
    var t = nowIso();
    Object.assign(u, { contact_verified_at: t, updated_at: t });
    return me(req);
  }, { auth: "consented" });

  route("GET", "/me", function (req) { return meDTO(req.user, req.session.via); });

  route("POST", "/me/profile", function (req) {
    var year = Number(nowIso().slice(0, 4));
    var v = C.validateProfile(req.body, Q, year);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    var p = C.cleanProfile(req.body, Q), u = req.user, t = nowIso();
    if (u.contact_method && p.contactMethod !== u.contact_method) requireYale(req);
    Object.assign(u, { name: p.name, identity: p.identity, stage: p.stage, grad_year: p.gradYear, job: p.job, city: p.city, contact_method: p.contactMethod,
      answers: p.answers, profile_done_at: u.profile_done_at || t, updated_at: t });
    resetRecs(u.id);
    return me(req);
  }, { auth: "consented" });

  route("POST", "/me/prefs", function (req) {
    var u = req.user, smart = req.body.smartRec === false ? 0 : 1;
    if (smart !== u.smart_rec) resetRecs(u.id);
    Object.assign(u, { prefs: C.cleanPrefs(req.body.prefs || {}), smart_rec: smart, updated_at: nowIso() });
    return me(req);
  }, { auth: "consented" });

  route("POST", "/me/delete", function (req) {
    if (req.body.confirm !== "DELETE") throw fail("invalid", { fields: { confirm: "required" } });
    requireYale(req);
    var id = req.user.id, email = req.user.login_email;
    S.participations = S.participations.filter(function (p) { return p.user_id !== id; });
    S.invites = S.invites.filter(function (i) { return i.fromId !== id && i.toId !== id; });
    Object.keys(S.recs).forEach(function (k) { if (k.split("|")[1] === id) delete S.recs[k]; });
    Object.keys(S.codes).forEach(function (k) { var key = k.slice(k.indexOf("|") + 1); if (key === id || key === email) delete S.codes[k]; });
    S.emails = S.emails.filter(function (e) { return e.user_id !== id; });
    S.feedback = S.feedback.filter(function (f) { return f.user_id !== id; });
    delete S.visits[id];
    S.users = S.users.filter(function (u) { return u.id !== id; });
    req.endSession();
    return { deleted: true };
  });

  /* 约咖啡（server/coffee.js） */
  route("GET", "/coffee/state", function (req) {
    var t = nowIso(), round = currentRound(t);
    if (!round) return { round: null };
    var p = participation(round.id, req.user.id), count = participantCount(round);
    var all = activeInvites(t), meId = req.user.id, ids = C.slotIds(round);
    return {
      round: roundDTO(round), joined: !!p, slots: p ? p.slots.slice() : [], participants: count, recsEnabled: C.recsEnabled(round, count),
      locked: (busyMap(all)[meId] || []).filter(function (s) { return ids.indexOf(s) >= 0; }),
      incoming: all.filter(function (i) { return i.toId === meId && C.inviteStatus(i, i.round, t) === "pending"; }).length,
      matches: all.filter(function (i) { return i.status === "accepted" && (i.fromId === meId || i.toId === meId); }).length
    };
  }, { auth: "ready" });

  // 保存空闲时间 = 参加这一轮。第一次至少要选一个还能约的时间；全部清空（且没有已约定的）= 退出这一轮
  route("POST", "/coffee/availability", function (req) {
    var t = nowIso(), round = currentRound(t), meId = req.user.id;
    if (!round) throw fail("conflict", { reason: "round_closed" });
    var v = C.validateSlots(round, req.body.slots);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    var existing = participation(round.id, meId);
    var locked = busyMap(roundInvites(round.id))[meId] || [];
    var slots = C.slotIds(round).filter(function (s) { return v.slots.indexOf(s) >= 0 || locked.indexOf(s) >= 0; });
    var anyOpen = slots.some(function (s) { return !C.isClosed(round, s, t); });
    if (!existing && !anyOpen) throw fail("invalid", { fields: { slots: "required" } });
    if (existing && JSON.stringify(slots) === JSON.stringify(existing.slots)) return { id: round.id, slots: slots, locked: locked, joined: true };
    limit("saves:" + meId, 40, DAY, "too_many_saves");
    if (existing && !slots.length) {
      S.participations = S.participations.filter(function (p) { return p !== existing; });
      return { id: round.id, slots: [], locked: [], joined: false };
    }
    if (existing) { existing.slots = slots; existing.updated_at = t; }
    else {
      S.participations.push({ round_id: round.id, user_id: meId, slots: slots, joined_at: t, updated_at: t });
      if (!req.user.demo) welcomeInvites(round, req.user, t);
    }
    return { id: round.id, slots: slots, locked: locked, joined: true };
  }, { auth: "ready" });

  route("GET", "/coffee/recommendations", function (req) {
    var t = nowIso(), round = currentRound(t);
    requireJoined(round, req.user.id);
    var people = participants(round);
    if (!C.recsEnabled(round, people.length)) return { enabled: false, threshold: round.poolThreshold, participants: people.length, items: [] };
    var all = activeInvites(t), busy = busyMap(all), meId = req.user.id, mine = {};
    mine[meId] = busy[meId] || [];
    var rec = recsFor(round, meId, people, all, everMatched(meId), mine);
    var byId = {};
    people.forEach(function (p) { byId[p.id] = p; });
    var meP = byId[meId];
    if (!meP) return { enabled: true, engine: rec.engine, items: [] };
    var items = rec.items.filter(function (x) { return byId[x.id] && rec.dismissed.indexOf(x.id) < 0; }).map(function (x) {
      return Object.assign(card(byId[x.id].row), { reasons: x.reasons, overlap: overlapForViewer(round, meP, byId[x.id], busy, t), relation: relation(all, meId, x.id, t) });
    });
    return { enabled: true, engine: rec.engine, items: items };
  }, { auth: "ready" });

  route("POST", "/coffee/recommendations/:id/dismiss", function (req) {
    var round = currentRound();
    requireJoined(round, req.user.id);
    var row = S.recs[round.id + "|" + req.user.id];
    if (!row) throw fail("not_found");
    var known = row.items.concat(row.candidates).some(function (x) { return x.id === req.params.id; });
    if (!known) throw fail("not_found");
    if (row.dismissed.indexOf(req.params.id) < 0 && row.dismissed.length < 200) row.dismissed.push(req.params.id);
    return { id: req.params.id };
  }, { auth: "ready" });

  route("GET", "/coffee/pool", function (req) {
    var t = nowIso(), round = currentRound(t);
    requireJoined(round, req.user.id);
    if (!round.openBrowse) throw fail("forbidden", { reason: "browse_closed" });
    var q = function (k) { return typeof req.query[k] === "string" ? req.query[k].slice(0, 40) : ""; };
    var identity = q("identity"), goal = q("goal"), interest = q("interest"), field = q("field");
    var all = activeInvites(t), busy = busyMap(all), people = participants(round);
    var meP = people.find(function (p) { return p.id === req.user.id; });
    if (!meP) throw fail("forbidden", { reason: "not_joined" });
    var pub = function (k) { return (Q.find(function (x) { return x.id === k; }) || {}).public; };
    var has = function (a, k, v) { return !v || (pub(k) && [].concat(a[k] || []).indexOf(v) >= 0); };
    return people
      .filter(function (p) { return p.id !== meP.id && (!identity || p.identity === identity) && has(p.answers, "goals", goal) && has(p.answers, "interests", interest) && has(p.answers, "field", field); })
      .map(function (p) { return Object.assign(card(p.row), { overlapCount: overlapForViewer(round, meP, p, busy, t).length, relation: relation(all, meP.id, p.id, t) }); })
      .sort(function (a, b) { return b.overlapCount - a.overlapCount; });
  }, { auth: "ready" });

  route("GET", "/coffee/people/:id", function (req) {
    var t = nowIso(), round = currentRound(t);
    requireJoined(round, req.user.id);
    var people = participants(round);
    var other = people.find(function (p) { return p.id === req.params.id; }), meP = people.find(function (p) { return p.id === req.user.id; });
    if (!other || !meP || other.id === meP.id) throw fail("not_found");
    var all = activeInvites(t), busy = busyMap(all);
    return Object.assign(card(other.row), { overlap: overlapForViewer(round, meP, other, busy, t), relation: relation(all, meP.id, other.id, t) });
  }, { auth: "ready" });

  route("POST", "/coffee/invites", function (req) {
    var t = nowIso(), round = currentRound(t), b = req.body;
    var v = C.validateInviteInput(b);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    var toId = typeof b.toId === "string" ? b.toId.slice(0, 64) : "";
    var to = userById(toId);
    if (to && (!to.profile_done_at || to.consent_version !== CV)) to = null;
    var all = activeInvites(t);
    var check = C.checkInvite({ round: round, fromId: req.user.id, toId: toId, fromJoined: !!(round && participation(round.id, req.user.id)), toJoined: !!(to && round && participation(round.id, toId)), invites: all, now: t });
    if (!check.ok) throw fail(check.code, check.reason ? { reason: check.reason } : null);
    if (check.autoAccept) { // 对方已经邀请过我：直接匹配
      var inv0 = all.find(function (i) { return i.id === check.autoAccept; });
      var r = C.respond(inv0, "accept", req.user.id, inv0.round, t);
      if (!r.ok) throw fail(r.code, r.reason ? { reason: r.reason } : null);
      updateInvite(r.next);
      notifyMatch(r.next, t);
      return { id: inv0.id, matched: true };
    }
    var inv = C.createInvite({ toId: toId, note: b.note, source: b.source }, req.user.id, round.id, t, newId("inv"));
    S.invites.push(inv);
    if (to.demo && willAccept(to.id)) S.lively.accepts.push({ inviteId: inv.id, due: Date.now() + ACCEPT_DELAY });
    return { id: inv.id, matched: false };
  }, { auth: "ready" });

  route("GET", "/coffee/inbox", function (req) {
    var t = nowIso(), meId = req.user.id, invites = activeInvites(t);
    var inc = invites.filter(function (i) { return i.toId === meId && C.inviteStatus(i, i.round, t) === "pending"; });
    var out = invites.filter(function (i) { return i.fromId === meId && i.status !== "accepted"; });
    var cur = currentRound(t), inCur = {};
    if (cur) participants(cur).forEach(function (p) { inCur[p.id] = true; });
    var inRound = function (otherId) { return !!inCur[meId] && !!inCur[otherId]; };
    return {
      incoming: inc.filter(function (i) { return userById(i.fromId); }).map(function (i) { return Object.assign(card(userById(i.fromId)), { inviteId: i.id, note: i.note, createdAt: i.createdAt, roundId: i.roundId, inRound: inRound(i.fromId) }); }),
      outgoing: out.filter(function (i) { return userById(i.toId); }).map(function (i) { return Object.assign(card(userById(i.toId)), { inviteId: i.id, createdAt: i.createdAt, roundId: i.roundId, inRound: inRound(i.toId), state: "waiting" }); })
    };
  }, { auth: "ready" });

  route("POST", "/coffee/invites/:id/:action", function (req) {
    var t = nowIso(), row = invById(req.params.id);
    if (!row) throw fail("not_found");
    var round = roundById(row.roundId);
    var r = C.respond(row, req.params.action, req.user.id, round, t);
    if (!r.ok) throw fail(r.code, r.reason ? { reason: r.reason } : null);
    if (r.next.status === "accepted" && activeInvites(t).some(function (i) { return i.id !== row.id && i.status === "accepted" && ((i.fromId === row.fromId && i.toId === row.toId) || (i.fromId === row.toId && i.toId === row.fromId)); })) throw fail("conflict", { reason: "already_matched" });
    updateInvite(r.next);
    if (r.next.status === "accepted") notifyMatch(r.next, t);
    return { id: row.id, status: r.next.status };
  }, { auth: "ready" });

  route("GET", "/coffee/matches", function (req) {
    var t = nowIso(), meId = req.user.id;
    var rows = S.invites.filter(function (i) { return i.status === "accepted" && (i.fromId === meId || i.toId === meId); })
      .sort(function (a, b) { return String(b.respondedAt).localeCompare(String(a.respondedAt)); }).slice(0, 100);
    var busy = busyMap(activeInvites(t));
    return rows.map(function (m) {
      var round = roundById(m.roundId), otherId = m.fromId === meId ? m.toId : m.fromId, other = userById(otherId);
      if (!other || !round) return null;
      var open = !C.isRoundOver(round, t), available = [];
      if (open) {
        var mine = participation(round.id, meId), theirs = participation(round.id, otherId);
        available = C.overlap(round, mine ? mine.slots : [], theirs ? theirs.slots : [], (busy[meId] || []).concat(busy[otherId] || []), t);
      }
      return Object.assign(card(other), {
        matchId: m.id, roundId: m.roundId, roundTitle: round.title, timezone: round.timezone,
        contactMethod: other.contact_method, // 匹配后才给
        slot: m.slot, scheduledBy: m.scheduledBy === meId ? "me" : m.scheduledBy ? "them" : null, available: available,
        canSchedule: open && (!m.slot || Date.parse(t) < C.slotStart(round, m.slot)),
        myOutcome: (m.outcomes || {})[meId] || null, canReport: !m.slot || Date.parse(t) >= C.slotStart(round, m.slot)
      });
    }).filter(Boolean);
  }, { auth: "ready" });

  route("POST", "/coffee/matches/:id/schedule", function (req) {
    var t = nowIso(), row = invById(req.params.id);
    if (!row) throw fail("not_found");
    var round = roundById(row.roundId), meId = req.user.id;
    if (!C.roleOf(row, meId)) throw fail("not_found");
    var otherId = row.fromId === meId ? row.toId : row.fromId;
    var busy = busyMap(activeInvites(t).filter(function (i) { return i.id !== row.id; }));
    var mine = participation(round.id, meId), theirs = participation(round.id, otherId);
    var available = C.overlap(round, mine ? mine.slots : [], theirs ? theirs.slots : [], (busy[meId] || []).concat(busy[otherId] || []), t);
    var slot = req.body.slot === null ? null : typeof req.body.slot === "string" ? req.body.slot : "";
    var r = C.schedule(row, slot, meId, round, available, t);
    if (!r.ok) throw fail(r.code, r.reason ? { reason: r.reason } : null);
    if (r.unchanged) return { id: row.id, slot: row.slot };
    updateInvite(Object.assign({}, r.next, { outcomes: r.next.outcomes || {}, remindedAt: null }));
    if (r.next.slot) { var other = userById(otherId); if (other) sendMail("scheduled", other, null, t); }
    return { id: row.id, slot: r.next.slot };
  }, { auth: "ready" });

  route("POST", "/coffee/matches/:id/outcome", function (req) {
    var t = nowIso(), row = invById(req.params.id);
    if (!row) throw fail("not_found");
    var round = roundById(row.roundId);
    var r = C.recordOutcome(row, req.body.met, req.user.id, round, t);
    if (!r.ok) throw fail(r.code, Object.assign({}, r.reason ? { reason: r.reason } : {}, r.fields ? { fields: r.fields } : {}));
    row.outcomes = r.next.outcomes;
    return { id: row.id, outcome: r.next.outcomes[req.user.id] || null };
  }, { auth: "ready" });

  route("POST", "/feedback", function (req) {
    var v = C.validateFeedback(req.body);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    limit("feedback:" + req.user.id, 10, HOUR);
    var id = ++S.seq.feedback;
    S.feedback.push({ id: id, user_id: req.user.id, kind: req.body.kind, text: String(req.body.text).trim(), created_at: nowIso() });
    return { id: String(id) };
  }, { auth: "consented" });

  /* 活动页（不需要登录） */
  function publicRound(r, t) { return Object.assign(roundDTO(r), { open: C.isRoundOpen(r, t), upcoming: !C.isRoundOpen(r, t) && !C.isRoundOver(r, t), participants: participantCount(r) }); }
  route("GET", "/rounds/events", function () {
    var t = nowIso();
    currentRound(t);
    return S.rounds.filter(function (r) { return r.kind === "event" && r.status === "published"; })
      .sort(function (a, b) { return b.start_date.localeCompare(a.start_date); }).slice(0, 50).map(toRound).map(function (r) { return publicRound(r, t); });
  }, { auth: "none" });
  route("GET", "/rounds/:id", function (req) {
    var t = nowIso();
    currentRound(t);
    var r = roundById(req.params.id);
    if (!r || r.status !== "published" || r.kind !== "event") throw fail("not_found");
    return publicRound(r, t);
  }, { auth: "none" });

  /* 管理（server/admin.js） */
  var mondayOf = function (day) { return C.addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7)); };
  function retention(t) {
    var today = t.slice(0, 10), weeks = [0, 1, 2, 3].map(function (i) { return C.addDays(mondayOf(today), -7 * i); });
    var rows = S.users.filter(function (u) { return u.created_at >= weeks[3]; }).map(function (u) {
      var d = u.created_at.slice(0, 10), end = C.addDays(d, 6);
      return { day: d, returned: (S.visits[u.id] || []).some(function (v) { return v > d && v <= end; }) };
    });
    return { cohorts: weeks.map(function (week) {
      var mine = rows.filter(function (r) { return mondayOf(r.day) === week; });
      return { week: week, registered: mine.length, returned: mine.filter(function (r) { return r.returned; }).length, complete: today > C.addDays(week, 12) };
    }) };
  }
  route("GET", "/admin/overview", function () {
    var t = nowIso(), round = currentRound(t), inv = round ? roundInvites(round.id) : [];
    var accepted = S.invites.filter(function (i) { return i.status === "accepted"; }).map(function (i) { return Object.values(i.outcomes || {}); });
    var cnt = function (f) { return S.users.filter(f).length; };
    var weekAgo = ago(7 * DAY), groups = {};
    S.emails.filter(function (e) { return e.created_at >= weekAgo; }).forEach(function (e) { var k = e.kind + "|" + e.status; groups[k] = (groups[k] || 0) + 1; });
    var engines = {};
    if (round) Object.keys(S.recs).forEach(function (k) { if (k.split("|")[0] === round.id) engines[S.recs[k].engine] = (engines[S.recs[k].engine] || 0) + 1; });
    return {
      users: { total: S.users.length, profileDone: cnt(function (u) { return !!u.profile_done_at; }), contactVerified: cnt(function (u) { return !!u.contact_verified_at; }), smartRecOff: cnt(function (u) { return u.smart_rec === 0; }) },
      round: round && {
        id: round.id, kind: round.kind, title: round.title, participants: participantCount(round), invites: inv.length,
        pending: inv.filter(function (i) { return C.inviteStatus(i, round, t) === "pending"; }).length,
        matches: inv.filter(function (i) { return i.status === "accepted"; }).length,
        skipped: inv.filter(function (i) { return i.status === "skipped"; }).length,
        scheduled: inv.filter(function (i) { return i.status === "accepted" && i.slot; }).length,
        fromRecs: inv.filter(function (i) { return i.source === "rec"; }).length,
        engines: engines
      },
      allTime: { matches: accepted.length, met: accepted.filter(function (o) { return o.indexOf("met") >= 0; }).length, missed: accepted.filter(function (o) { return o.indexOf("missed") >= 0 && o.indexOf("met") < 0; }).length },
      emails7d: Object.keys(groups).map(function (k) { var p = k.split("|"); return { kind: p[0], status: p[1], n: groups[k] }; }),
      feedback: S.feedback.length,
      retention: retention(t)
    };
  }, { auth: "admin", audit: true });

  route("GET", "/admin/rounds", function () {
    currentRound();
    return S.rounds.slice().sort(function (a, b) { return b.start_date.localeCompare(a.start_date); }).slice(0, 60).map(toRound);
  }, { auth: "admin" });

  // 新建 / 修改活动轮
  route("POST", "/admin/rounds", function (req) {
    var b = req.body || {}, t = nowIso();
    var title = { zh: String((b.title && b.title.zh) || "").trim().slice(0, 60), en: String((b.title && b.title.en) || "").trim().slice(0, 80) };
    var v = C.validateRound({ title: title, startDate: b.startDate, endDate: b.endDate });
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    var themeTags = [].concat(b.themeTags || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (themeTags.length > 5) throw fail("invalid", { fields: { themeTags: "too_many" } });
    if (themeTags.some(function (x) { return Array.from(x).length > 20; })) throw fail("invalid", { fields: { themeTags: "too_long" } });
    var status = b.status === "published" ? "published" : "draft";
    var id = b.id ? String(b.id) : "ev-" + randHex(4);
    var existing = roundRow(id);
    if (b.id && (!existing || existing.kind !== "event")) throw fail("not_found");
    if (status === "published") {
      var clash = S.rounds.some(function (r) { return r.kind === "event" && r.status === "published" && r.id !== id && r.start_date <= b.endDate && r.end_date >= b.startDate; });
      if (clash) throw fail("conflict", { reason: "overlaps_event" });
    }
    var config = { recCount: Math.min(10, Math.max(1, Number(b.recCount) || 5)), openBrowse: b.openBrowse !== false };
    var post = { title: String((b.post && b.post.title) || title.zh).slice(0, 80), body: String((b.post && b.post.body) || "").slice(0, 4000), wechat: String((b.post && b.post.wechat) || "").slice(0, 2000) };
    var fields = { status: status, title: title, theme_tags: themeTags, config: config, start_date: b.startDate, end_date: b.endDate, post: post, updated_at: t };
    if (existing) Object.assign(existing, fields);
    else S.rounds.push(Object.assign({ id: id, kind: "event", announced_at: null, created_at: t }, fields));
    return roundById(id);
  }, { auth: "admin" });

  route("GET", "/admin/feedback", function () {
    return S.feedback.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 200).map(function (f) {
      var u = userById(f.user_id);
      return { id: f.id, kind: f.kind, text: f.text, created_at: f.created_at, name: u ? u.name : null };
    });
  }, { auth: "admin", audit: true });
  route("GET", "/admin/emails", function () {
    return S.emails.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 200).map(function (e) { return { id: e.id, kind: e.kind, status: e.status, error: e.error, created_at: e.created_at }; });
  }, { auth: "admin" });
  route("GET", "/admin/audit", function () { return S.audit.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 200); }, { auth: "admin" });

  /* ---------- 处理一个请求（和 server/http.js 的 dispatch 同样的顺序） ---------- */
  var safeDecode = function (s) { try { return decodeURIComponent(s); } catch (e) { return null; } };
  function dispatch(method, url, bodyText, contentType) {
    load();
    processDue();
    var p = url.pathname.slice(basePath().length), params = {}, r = null, user = null, session = null, actor = null, result;
    try {
      r = routes.find(function (x) { return x.method === method && x.re.test(p); }) || null;
      if (!r) throw fail("not_found");
      var m = p.match(r.re);
      r.keys.forEach(function (k, i) { params[k] = safeDecode(m[i + 1]); });
      if (Object.keys(params).some(function (k) { return params[k] === null || !PARAM.test(params[k]); })) throw fail("not_found");
      if (S.session) { user = userById(S.session.userId); session = user ? S.session : null; if (!user) S.session = null; }
      actor = user && user.id;
      if (method !== "GET" && !/^application\/json/.test(contentType || "")) throw fail("invalid", { reason: "json_required" });
      if (user) touch(user);
      if (r.auth !== "none" && !user) throw fail("unauthorized");
      if (r.auth === "admin" && !isAdmin(user, session)) throw fail("forbidden");
      if (r.auth === "consented" && !isConsented(user)) throw fail("forbidden", { reason: "needs_consent" });
      if (r.auth === "ready" && !isReady(user)) throw fail("forbidden", { reason: "profile_incomplete" });
      var body = {};
      if (method !== "GET" && bodyText) {
        if (bodyText.length > MAX_BODY) throw fail("too_large");
        try { body = JSON.parse(bodyText); } catch (e) { throw fail("invalid", { reason: "bad_json" }); }
        if (body === null || typeof body !== "object" || Array.isArray(body)) throw fail("invalid", { reason: "bad_json" });
      }
      var query = {};
      url.searchParams.forEach(function (v, k) { query[k] = v; });
      var data = r.handler({
        params: params, query: query, body: body, user: user, session: session,
        startSession: function (userId, via) { S.session = { userId: userId, via: via, created_at: nowIso() }; touch(userById(userId)); },
        endSession: function () { S.session = null; },
        setActor: function (id) { actor = id; }
      });
      result = { status: 200, body: { ok: true, data: data === undefined ? null : data } };
    } catch (e) {
      if (!(e instanceof ApiError)) { console.error(e); e = fail("internal"); }
      result = { status: STATUS[e.code], body: { ok: false, error: Object.assign({}, e.extra, { code: e.code }) } };
    }
    // 只审计"找到了接口"的请求；没有用户编号的失败不记（同 server/http.js）
    if (r && r.audit && (result.body.ok || actor)) {
      audit(actor, method + " " + r.pattern, params.id || (result.body.data && result.body.data.id) || null, result.body.ok, result.body.ok ? null : result.body.error.code);
    }
    save();
    scheduleTick();
    return result;
  }

  /* ---------- 替换 fetch ---------- */
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function basePath() { return new URL(String((window.YL_CONFIG && YL_CONFIG.apiBase) || "/api").replace(/\/$/, ""), location.href).pathname; }
  function isApi(u) { var b = basePath(); return u.origin === location.origin && (u.pathname === b || u.pathname.indexOf(b + "/") === 0); }
  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === "string" ? input : input && input.url ? input.url : String(input), location.href); } catch (e) { url = null; }
    if (!url || !isApi(url)) return realFetch(input, init);
    init = init || {};
    var method = String(init.method || (input && input.method) || "GET").toUpperCase();
    var headers = new Headers(init.headers || (input && input.headers) || {});
    var bodyText = typeof init.body === "string" ? init.body : "";
    return new Promise(function (resolve) {
      // 一点点延迟，让加载状态和真实后端一样出现
      setTimeout(function () {
        var res;
        try { res = dispatch(method, url, bodyText, headers.get("Content-Type")); }
        catch (e) { console.error(e); res = { status: 500, body: { ok: false, error: { code: "internal" } } }; }
        resolve(new Response(JSON.stringify(res.body), { status: res.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }));
      }, 40 + Math.floor(Math.random() * 80));
    });
  };

  /* ---------- 演示数据（运行时按"现在"生成） ---------- */
  // 首发活动：2026-10-15 到 10-25；已经过了就从下一个周四开始，共 11 天
  function launchEventDates(t) {
    var start = "2026-10-15", end = "2026-10-25";
    var today = C.localDate(t, C.DEFAULT_ROUND.timezone);
    if (today > end) {
      var wd = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; // 周一 = 0，周四 = 3
      start = C.addDays(today, ((3 - wd + 7) % 7) || 7);
      end = C.addDays(start, 10);
    }
    return { start: start, end: end };
  }
  function seed() {
    var t = nowIso(), now = Date.now();
    S = { v: VERSION, seededAt: t, users: [], rounds: [], participations: [], invites: [], recs: {}, emails: [], feedback: [], audit: [], visits: {},
      codes: {}, session: null, demoJoined: {}, seq: { email: 0, audit: 0, feedback: 0 }, lively: { welcomed: {}, accepts: [] } };
    var at = function (msAgo) { return new Date(now - msAgo).toISOString(); };

    // 1) 24 位虚构同学：注册时间分散在最近 4 周（后台的 7 日回访有数可看）
    DATA.users.forEach(function (d, i) {
      var created = at(((i % 4) * 7 + (i % 3)) * DAY + (i + 1) * HOUR);
      var u = Object.assign(newUserRow(d.id, d.login_email, created), {
        contact_email: d.contact_email, contact_verified_at: created, consent_version: CV, consent_at: created,
        name: d.name, identity: d.identity, stage: d.stage || "", grad_year: d.grad_year == null ? null : d.grad_year, job: d.job || "", city: d.city || "",
        contact_method: d.contact_method, answers: d.answers || {}, smart_rec: i % 9 === 4 ? 0 : 1, profile_done_at: created, demo: true
      });
      S.users.push(u);
      var cd = created.slice(0, 10), days = [cd];
      if (i % 3 !== 2) days.push(C.addDays(cd, 1 + (i % 5)));
      S.visits[u.id] = days.filter(function (x) { return x <= t.slice(0, 10); });
    });
    var demo = S.users.slice();
    var uid = function (n) { return demo[n - 1] && demo[n - 1].id; };

    // 2) 活动轮"Coffee Chat 周 · 首发"（先放进去：如果它正在进行，它就是当前轮）
    var ev = launchEventDates(t);
    S.rounds.push({ id: "ev-launch", kind: "event", status: "published", title: { zh: "Coffee Chat 周 · 首发", en: "Coffee Chat Week · Launch" },
      theme_tags: ["industry", "coffee"], config: { recCount: 5, openBrowse: true }, start_date: ev.start, end_date: ev.end,
      post: { title: "Coffee Chat 周 · 首发：认识同路的耶鲁人", body: "Yalelux 的第一次 Coffee Chat 周。\n\n选几个你有空的时间，看看系统给你推荐了谁；对方也想认识你，就能看到彼此的联系方式和共同的空闲时间。\n\n在校生、校友都欢迎。",
        wechat: "【Coffee Chat 周 · 首发】耶鲁邮箱登录，选空闲时间，认识同路的耶鲁人。" }, announced_at: null, created_at: at(3 * DAY), updated_at: at(3 * DAY) });

    // 3) 上一周：几场已经完成的 coffee chat（后台"累计见面"有数）
    var last = C.weeklyRound(new Date(now - 7 * DAY).toISOString());
    insertWeekly(last, at(10 * DAY));
    roundRow(last.id).announced_at = at(9 * DAY);
    var times = C.slotTimes(last);
    [[3, 4, "met", "met"], [7, 10, "met", null], [11, 16, "missed", "missed"], [2, 9, "met", "met"], [13, 20, null, null]].forEach(function (x, k) {
      var a = uid(x[0]), b = uid(x[1]);
      if (!a || !b) return;
      var day = C.addDays(last.startDate, 1 + k), slot = day + "T" + times[(5 + k * 3) % times.length], created = new Date(Date.parse(day + "T00:00:00Z") - DAY).toISOString();
      var outcomes = {};
      if (x[2]) outcomes[a] = x[2];
      if (x[3]) outcomes[b] = x[3];
      S.invites.push({ id: "inv-demo-past" + k, roundId: last.id, fromId: a, toId: b, note: "", source: k % 2 ? "browse" : "rec", status: "accepted", createdAt: created,
        respondedAt: created, slot: slot, scheduledBy: a, scheduledAt: created, outcomes: outcomes, remindedAt: created });
      sendMail("match", userById(a), null, created); sendMail("match", userById(b), null, created);
    });

    // 4) 当前轮（顺带建好正在报名的每周轮，并让演示同学都加入）+ 几条演示同学之间的邀请与匹配
    var round = currentRound(t);
    if (round) {
      var people = participants(round), byId = {};
      people.forEach(function (p) { byId[p.id] = p; });
      var mk = function (from, to, status, note, k, scheduled) {
        var a = byId[uid(from)], b = byId[uid(to)];
        if (!a || !b) return;
        var common = C.overlap(round, a.slots, b.slots, [], t), created = at((k + 2) * HOUR);
        var inv = C.createInvite({ toId: b.id, note: note, source: k % 2 ? "browse" : "rec" }, a.id, round.id, created, "inv-demo" + k);
        if (status !== "pending") { inv.status = status; inv.respondedAt = at((k + 1) * HOUR); }
        if (scheduled && status === "accepted" && common.length) { inv.slot = common[0]; inv.scheduledBy = b.id; inv.scheduledAt = inv.respondedAt; }
        S.invites.push(inv);
        if (status === "accepted") notifyMatch(inv, inv.respondedAt);
      };
      mk(5, 8, "accepted", "想听听你在咨询行业的经验～", 1, true);
      mk(9, 12, "accepted", "", 2, false);
      mk(14, 17, "accepted", "一起去 Atticus 喝杯咖啡？", 3, true);
      mk(13, 15, "pending", "你好，也在准备转行做数据，想交流一下。", 4);
      mk(18, 19, "skipped", "", 5);
      mk(20, 21, "pending", "", 6);
      mk(22, 23, "pending", "Hi! 看到你也喜欢徒步。", 7);
      // 几位同学已经看过推荐（后台"推荐方式"有数）
      for (var n = 1; n <= 8; n++) {
        var meP = byId[uid(n)];
        if (!meP) continue;
        var all = activeInvites(t), busy = busyMap(all), mine = {};
        mine[meP.id] = busy[meP.id] || [];
        recsFor(round, meP.id, people, all, everMatched(meP.id), mine);
      }
    }

    // 5) 发信记录、意见箱、审计日志（后台各页都有内容）
    var monday = C.weeklyRound(t).startDate;
    demo.forEach(function (u, i) {
      if (Date.parse(monday + "T14:00:00Z") <= now) sendMail("weekly", u, null, monday + "T14:00:00.000Z");
      if (i % 5 === 1) sendMail("invite_digest", u, null, at((i + 3) * HOUR));
    });
    var quiet = demo[6];
    if (quiet) { quiet.prefs = Object.assign({}, quiet.prefs, { invite_digest: false }); sendMail("invite_digest", quiet, null, at(5 * HOUR)); }
    [[uid(4), "idea", "希望能按城市筛选，校友在不同城市，线下见面更方便。", 2 * DAY], [uid(11), "bug", "手机上选时间的时候，横向滑动有点不灵敏。", 30 * HOUR], [uid(17), "other", "这周认识了两位学姐，很有收获，谢谢志愿者们！", 6 * HOUR]].forEach(function (f) {
      if (f[0]) S.feedback.push({ id: ++S.seq.feedback, user_id: f[0], kind: f[1], text: f[2], created_at: at(f[3]) });
    });
    S.invites.forEach(function (i) {
      audit(i.fromId, "POST /coffee/invites", i.id, true, null, i.createdAt);
      if (i.respondedAt) audit(i.toId, "POST /coffee/invites/:id/:action", i.id, true, null, i.respondedAt);
    });
    S.audit.sort(function (a, b) { return a.at.localeCompare(b.at); }).forEach(function (a, k) { a.id = k + 1; });
    S.seq.audit = S.audit.length;
    S.emails.sort(function (a, b) { return a.created_at.localeCompare(b.created_at); }).forEach(function (e, k) { e.id = k + 1; });
    S.seq.email = S.emails.length;
    return S;
  }

  /* ---------- 对外：重置，以及给测试 / 讲解用的小工具 ---------- */
  window.YLDemo = {
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      S = null; seed(); save();
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ }
      location.reload();
    },
    willAccept: willAccept,
    code: CODE,
    state: function () { load(); return clone(S); }
  };

  /* ---------- 顶部演示提示条（静态，在吸顶顶栏之上） ---------- */
  var TEXT = {
    zh: { msg: "演示版 · 数据只在你的浏览器里 · 任意 @yale.edu 邮箱登录，验证码 000000 · 管理员 admin@yale.edu", reset: "重置" },
    en: { msg: "Demo · data stays in your browser · sign in with any @yale.edu email, code 000000 · admin: admin@yale.edu", reset: "Reset" }
  };
  function lang() { try { return YL.i18n.getLang() === "en" ? "en" : "zh"; } catch (e) { return "zh"; } }
  function paintBanner() {
    var el = document.getElementById("demo-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-banner";
      el.className = "demo-banner";
      el.setAttribute("role", "note");
      el.innerHTML = '<p class="demo-banner__inner"><span class="demo-banner__msg"></span><button type="button" class="demo-banner__reset" data-demo-reset></button></p>';
      document.body.insertBefore(el, document.body.firstChild);
      el.querySelector("[data-demo-reset]").addEventListener("click", function () { window.YLDemo.reset(); });
    }
    var tx = TEXT[lang()];
    el.lang = lang() === "en" ? "en" : "zh-CN";
    el.querySelector(".demo-banner__msg").textContent = tx.msg;
    el.querySelector("[data-demo-reset]").textContent = tx.reset;
  }
  if (document.body) paintBanner(); else document.addEventListener("DOMContentLoaded", paintBanner);
  window.addEventListener("yl:langchange", paintBanner);

  load();
  scheduleTick();
})();
