/* 约咖啡接口。规则全部在 web/js/domain/coffee.js（单测覆盖），这里只做：读数据库 → 调规则 → 写数据库 → 发邮件。
   隐私：
   - 列表与详情只返回公开字段；联系方式只在匹配成功后给双方；
   - 被跳过的邀请对发起人显示为"等待回复"，也不提前释放名额；轮次结束后统一显示"未回应"；
   - 给第三方看的"共同空闲时间"只扣掉查看者自己已约定的时段（扣掉对方的会暴露对方和谁约了什么时候）；
   - 只有同意了当前版本隐私说明的人才会出现在池子、推荐和大模型请求里。
   周末时上一周（还能回复邀请、约时间）和下一周（正在报名）同时有效，所以"已约定的时段""两人之间的邀请""邀请名额"都跨轮次计算。 */
const crypto = require("node:crypto");
const { fail } = require("./http");
const recommend = require("./recommend");

const SAVES_PER_DAY = 40; // 每人每天最多保存空闲时间的次数（防止逐格试探别人的完整日程）

function install(app, ctx) {
  const C = ctx.coffee, db = ctx.db, J = ctx.json;
  const now = () => new Date().toISOString();
  const newId = (p) => p + "-" + crypto.randomBytes(6).toString("hex");
  const saves = new Map();
  function limitSaves(userId) {
    const t = Date.now(), arr = (saves.get(userId) || []).filter((x) => t - x < 86400000);
    if (arr.length >= SAVES_PER_DAY) throw fail("rate_limited", { reason: "too_many_saves" });
    arr.push(t); saves.set(userId, arr);
    if (saves.size > 20000) saves.clear();
  }

  /* ---------- 读数据 ---------- */
  function toRound(row) {
    return Object.assign({}, C.DEFAULT_ROUND, J(row.config, {}), {
      id: row.id, kind: row.kind, status: row.status, title: J(row.title, {}), themeTags: J(row.theme_tags, []),
      startDate: row.start_date, endDate: row.end_date, post: J(row.post, {})
    });
  }
  // 当前轮；正在报名的每周轮不存在就创建（不需要定时任务也能用）
  function currentRound(at) {
    const t = at || now();
    const week = C.signupWeek(t);
    if (!db.get("SELECT id FROM rounds WHERE id = ?", week.id)) {
      db.run("INSERT OR IGNORE INTO rounds (id, kind, status, title, theme_tags, config, start_date, end_date, post, created_at, updated_at) VALUES (?, 'weekly', 'published', ?, '[]', '{}', ?, ?, '{}', ?, ?)",
        week.id, JSON.stringify({ zh: "每周 Coffee Chat", en: "Weekly coffee chats" }), week.startDate, week.endDate, t, t);
    }
    return C.currentRound(recentRounds(t), t);
  }
  // 还没结束的轮
  const recentRounds = (t) => db.all("SELECT * FROM rounds WHERE status = 'published' AND end_date >= ?", C.addDays(t.slice(0, 10), -1)).map(toRound);
  const activeRounds = (t) => recentRounds(t).filter((r) => !C.isRoundOver(r, t));
  // 所有还没结束的轮里的邀请，每条带上自己的 round
  const activeInvites = (t) => activeRounds(t).reduce((all, r) => all.concat(roundInvites(r.id).map((i) => Object.assign(i, { round: r }))), []);
  const roundById = (id) => { const r = db.get("SELECT * FROM rounds WHERE id = ?", id); return r ? toRound(r) : null; };
  const toInvite = (r) => ({ id: r.id, roundId: r.round_id, fromId: r.from_id, toId: r.to_id, note: r.note, source: r.source, status: r.status, createdAt: r.created_at, respondedAt: r.responded_at, slot: r.slot, scheduledBy: r.scheduled_by, scheduledAt: r.scheduled_at, outcomes: J(r.outcomes, {}) });
  const roundInvites = (roundId) => db.all("SELECT * FROM invites WHERE round_id = ?", roundId).map(toInvite);
  const participation = (roundId, userId) => db.get("SELECT * FROM participations WHERE round_id = ? AND user_id = ?", roundId, userId);
  // 本轮参与者：资料已完成、并且同意了当前版本的隐私说明
  function participants(round) {
    return db.all("SELECT u.*, p.slots AS p_slots, p.updated_at AS p_updated FROM participations p JOIN users u ON u.id = p.user_id WHERE p.round_id = ? AND u.profile_done_at IS NOT NULL AND u.consent_version = ?", round.id, ctx.cfg.consentVersion)
      .map((u) => ({ id: u.id, identity: u.identity, stage: u.stage, gradYear: u.grad_year, answers: J(u.answers, {}), slots: J(u.p_slots, []), updatedAt: u.p_updated, row: u }));
  }
  // 参与人数：和 participants() 同一个条件。约咖啡首页、推荐门槛、活动页、网站首页活动卡、后台概览都用这一个数
  const participantCount = (round) => db.get("SELECT COUNT(*) n FROM participations p JOIN users u ON u.id = p.user_id WHERE p.round_id = ? AND u.profile_done_at IS NOT NULL AND u.consent_version = ?", round.id, ctx.cfg.consentVersion).n;
  // 以前匹配过的人（任意一轮）
  function everMatched(userId) {
    const out = {};
    db.all("SELECT from_id, to_id FROM invites WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)", userId, userId).forEach((r) => (out[C.pairKey(r.from_id, r.to_id)] = true));
    return out;
  }
  // 每个人已被约定占用的时段（传入的邀请里）。所有轮用同一套时段格子，时段 id 可以直接比较
  function busyMap(invites) {
    const out = {};
    invites.filter((i) => i.status === "accepted" && i.slot).forEach((i) => { (out[i.fromId] = out[i.fromId] || []).push(i.slot); (out[i.toId] = out[i.toId] || []).push(i.slot); });
    return out;
  }
  // 公开资料卡（不含邮箱、联系方式）
  function card(u) {
    return { id: u.id, name: u.name, identity: u.identity, stage: u.stage, gradYear: u.grad_year, job: u.job, city: u.city, answers: C.publicAnswers(ctx.questions, J(u.answers, {})) };
  }
  const roundDTO = (r) => r && { id: r.id, kind: r.kind, title: r.title, themeTags: r.themeTags, startDate: r.startDate, endDate: r.endDate, timezone: r.timezone, dayStart: r.dayStart, dayEnd: r.dayEnd, slotMinutes: r.slotMinutes, gapMinutes: r.gapMinutes, cutoffHours: r.cutoffHours, recCount: r.recCount, maxOpenInvites: r.maxOpenInvites, openBrowse: r.openBrowse, poolThreshold: r.poolThreshold, post: r.post };
  // 两人之间的关系（跨所有还没结束的轮），给界面决定显示哪个按钮
  function relation(invites, me, other, t) {
    const pair = invites.filter((i) => (i.fromId === me && i.toId === other) || (i.fromId === other && i.toId === me));
    const matched = pair.find((i) => i.status === "accepted");
    if (matched) return { state: "matched", inviteId: matched.id };
    const inc = pair.find((i) => i.fromId === other && C.inviteStatus(i, i.round, t) === "pending");
    if (inc) return { state: "incoming", inviteId: inc.id };
    const out = pair.find((i) => i.fromId === me);
    if (out) return { state: C.isRoundOver(out.round, t) ? "no_reply" : "invited", inviteId: out.id }; // 被跳过的也显示"已邀请"
    return { state: "none" };
  }
  function requireJoined(round, userId) {
    if (!round) throw fail("conflict", { reason: "round_closed" });
    const p = participation(round.id, userId);
    if (!p) throw fail("forbidden", { reason: "not_joined" });
    return p;
  }
  // 给"我"看的共同空闲时间：只扣掉我自己已经约定的时段
  const overlapForViewer = (round, me, other, busy, t) => C.overlap(round, me.slots, other.slots, busy[me.id] || [], t);

  /* ---------- 匹配成功：两边各发一封邮件 ---------- */
  async function notifyMatch(inv) {
    const a = db.get("SELECT * FROM users WHERE id = ?", inv.fromId), b = db.get("SELECT * FROM users WHERE id = ?", inv.toId);
    if (a && b) { await ctx.mailer.send("match", a, { name: b.name }); await ctx.mailer.send("match", b, { name: a.name }); }
  }

  /* ---------- 路由 ---------- */
  app.route("GET", "/coffee/state", (req) => {
    const t = now(), round = currentRound(t);
    if (!round) return { round: null };
    const p = participation(round.id, req.user.id);
    const count = participantCount(round);
    const all = activeInvites(t), me = req.user.id, ids = new Set(C.slotIds(round));
    return {
      round: roundDTO(round), joined: !!p, slots: p ? J(p.slots, []) : [], participants: count, recsEnabled: C.recsEnabled(round, count),
      locked: (busyMap(all)[me] || []).filter((s) => ids.has(s)),
      incoming: all.filter((i) => i.toId === me && C.inviteStatus(i, i.round, t) === "pending").length,
      matches: all.filter((i) => i.status === "accepted" && (i.fromId === me || i.toId === me)).length
    };
  }, { auth: "ready" });

  // 保存空闲时间 = 参加这一轮。第一次至少要选一个还能约的时间；全部清空（且没有已约定的）= 退出这一轮
  app.route("POST", "/coffee/availability", (req) => {
    const t = now(), round = currentRound(t), me = req.user.id;
    if (!round) throw fail("conflict", { reason: "round_closed" });
    const v = C.validateSlots(round, req.body.slots);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    const existing = participation(round.id, me);
    const locked = busyMap(roundInvites(round.id))[me] || [];
    const slots = C.slotIds(round).filter((s) => v.slots.indexOf(s) >= 0 || locked.indexOf(s) >= 0); // 已约定的时段不能撤回
    const anyOpen = slots.some((s) => !C.isClosed(round, s, t));
    if (!existing && !anyOpen) throw fail("invalid", { fields: { slots: "required" } });
    if (existing && JSON.stringify(slots) === existing.slots) return { id: round.id, slots, locked, joined: true }; // 没变：不刷新推荐
    limitSaves(me);
    if (existing && !slots.length) {
      db.run("DELETE FROM participations WHERE round_id = ? AND user_id = ?", round.id, me);
      return { id: round.id, slots: [], locked: [], joined: false };
    }
    db.run("INSERT INTO participations (round_id, user_id, slots, joined_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (round_id, user_id) DO UPDATE SET slots = excluded.slots, updated_at = excluded.updated_at", round.id, me, JSON.stringify(slots), t, t);
    return { id: round.id, slots, locked, joined: true };
  }, { auth: "ready" });

  app.route("GET", "/coffee/recommendations", async (req) => {
    const t = now(), round = currentRound(t);
    requireJoined(round, req.user.id);
    const people = participants(round);
    if (!C.recsEnabled(round, people.length)) return { enabled: false, threshold: round.poolThreshold, participants: people.length, items: [] };
    const all = activeInvites(t), busy = busyMap(all), meId = req.user.id;
    const rec = await recommend.forUser(ctx, round, { id: meId }, people, all, everMatched(meId), { [meId]: busy[meId] || [] });
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const me = byId[meId];
    if (!me) return { enabled: true, engine: rec.engine, items: [] };
    const items = rec.items
      .filter((x) => byId[x.id] && rec.dismissed.indexOf(x.id) < 0)
      .map((x) => Object.assign(card(byId[x.id].row), { reasons: x.reasons, overlap: overlapForViewer(round, me, byId[x.id], busy, t), relation: relation(all, meId, x.id, t) }));
    return { enabled: true, engine: rec.engine, items };
  }, { auth: "ready" });

  // 不感兴趣：只接受推荐结果或候选里出现过的人，最多记 200 个
  app.route("POST", "/coffee/recommendations/:id/dismiss", (req) => {
    const round = currentRound();
    requireJoined(round, req.user.id);
    const row = db.get("SELECT items, candidates, dismissed FROM recommendations WHERE round_id = ? AND user_id = ?", round.id, req.user.id);
    if (!row) throw fail("not_found");
    const known = J(row.items, []).concat(J(row.candidates, [])).some((x) => x.id === req.params.id);
    if (!known) throw fail("not_found");
    const d = J(row.dismissed, []);
    if (d.indexOf(req.params.id) < 0 && d.length < 200) d.push(req.params.id);
    db.run("UPDATE recommendations SET dismissed = ? WHERE round_id = ? AND user_id = ?", JSON.stringify(d), round.id, req.user.id);
    return { id: req.params.id };
  }, { auth: "ready" });

  app.route("GET", "/coffee/pool", (req) => {
    const t = now(), round = currentRound(t);
    requireJoined(round, req.user.id);
    if (!round.openBrowse) throw fail("forbidden", { reason: "browse_closed" });
    const q = (k) => (typeof req.query[k] === "string" ? req.query[k].slice(0, 40) : "");
    const identity = q("identity"), goal = q("goal"), interest = q("interest"), field = q("field");
    const all = activeInvites(t), busy = busyMap(all);
    const people = participants(round), me = people.find((p) => p.id === req.user.id);
    if (!me) throw fail("forbidden", { reason: "not_joined" });
    // 只能按公开的题目筛选
    const pub = (k) => (ctx.questions.find((x) => x.id === k) || {}).public;
    const has = (a, k, v) => !v || (pub(k) && [].concat(a[k] || []).indexOf(v) >= 0);
    return people
      .filter((p) => p.id !== me.id && (!identity || p.identity === identity) && has(p.answers, "goals", goal) && has(p.answers, "interests", interest) && has(p.answers, "field", field))
      .map((p) => Object.assign(card(p.row), { overlapCount: overlapForViewer(round, me, p, busy, t).length, relation: relation(all, me.id, p.id, t) }))
      .sort((a, b) => b.overlapCount - a.overlapCount);
  }, { auth: "ready" });

  app.route("GET", "/coffee/people/:id", (req) => {
    const t = now(), round = currentRound(t);
    requireJoined(round, req.user.id);
    const people = participants(round);
    const other = people.find((p) => p.id === req.params.id), me = people.find((p) => p.id === req.user.id);
    if (!other || !me || other.id === me.id) throw fail("not_found");
    const all = activeInvites(t), busy = busyMap(all);
    return Object.assign(card(other.row), { overlap: overlapForViewer(round, me, other, busy, t), relation: relation(all, me.id, other.id, t) });
  }, { auth: "ready" });

  app.route("POST", "/coffee/invites", async (req) => {
    const t = now(), round = currentRound(t), b = req.body;
    const v = C.validateInviteInput(b);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    const toId = typeof b.toId === "string" ? b.toId.slice(0, 64) : "";
    const to = db.get("SELECT * FROM users WHERE id = ? AND profile_done_at IS NOT NULL AND consent_version = ?", toId, ctx.cfg.consentVersion);
    const all = activeInvites(t);
    const check = C.checkInvite({ round, fromId: req.user.id, toId, fromJoined: !!(round && participation(round.id, req.user.id)), toJoined: !!(to && round && participation(round.id, toId)), invites: all, now: t });
    if (!check.ok) throw fail(check.code, check.reason ? { reason: check.reason } : null);
    if (check.autoAccept) { // 对方已经邀请过我（可能是上一周的邀请）：直接匹配
      const inv = all.find((i) => i.id === check.autoAccept);
      const r = C.respond(inv, "accept", req.user.id, inv.round, t);
      if (!r.ok) throw fail(r.code, r.reason ? { reason: r.reason } : null);
      db.run("UPDATE invites SET status = ?, responded_at = ? WHERE id = ?", r.next.status, r.next.respondedAt, inv.id);
      await notifyMatch(r.next);
      return { id: inv.id, matched: true };
    }
    const inv = C.createInvite({ toId, note: b.note, source: b.source }, req.user.id, round.id, t, newId("inv"));
    db.run("INSERT INTO invites (id, round_id, from_id, to_id, note, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)", inv.id, inv.roundId, inv.fromId, inv.toId, inv.note, inv.source, inv.createdAt);
    return { id: inv.id, matched: false }; // 被邀请人收到的是每天一封的汇总邮件（jobs.js），不是立即通知
  }, { auth: "ready" });

  app.route("GET", "/coffee/inbox", (req) => {
    const t = now(), me = req.user.id, invites = activeInvites(t);
    const users = (ids) => Object.fromEntries(ids.length ? db.all(`SELECT * FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids).map((u) => [u.id, u]) : []);
    const inc = invites.filter((i) => i.toId === me && C.inviteStatus(i, i.round, t) === "pending");
    const out = invites.filter((i) => i.fromId === me && i.status !== "accepted");
    const u = users([...new Set(inc.map((i) => i.fromId).concat(out.map((i) => i.toId)))]);
    // inRound：两人现在都在当前这一轮里（和 /coffee/people/:id 同一个条件），界面据此决定名字能不能点进详情页。
    // 邀请本身在轮次结束前一直有效（对方清空了时间也还能回应），只是对方不在这一轮时看不了详情
    const cur = currentRound(t), inCur = new Set(cur ? participants(cur).map((p) => p.id) : []);
    const inRound = (otherId) => inCur.has(me) && inCur.has(otherId);
    return {
      incoming: inc.filter((i) => u[i.fromId]).map((i) => Object.assign(card(u[i.fromId]), { inviteId: i.id, note: i.note, createdAt: i.createdAt, roundId: i.roundId, inRound: inRound(i.fromId) })),
      // 被跳过的邀请对发起人不可见：轮次结束前一律显示"等待回复"
      outgoing: out.filter((i) => u[i.toId]).map((i) => Object.assign(card(u[i.toId]), { inviteId: i.id, createdAt: i.createdAt, roundId: i.roundId, inRound: inRound(i.toId), state: "waiting" }))
    };
  }, { auth: "ready" });

  app.route("POST", "/coffee/invites/:id/:action", async (req) => {
    const t = now(), row = db.get("SELECT * FROM invites WHERE id = ?", req.params.id);
    if (!row) throw fail("not_found");
    const inv = toInvite(row), round = roundById(inv.roundId);
    const r = C.respond(inv, req.params.action, req.user.id, round, t);
    if (!r.ok) throw fail(r.code, r.reason ? { reason: r.reason } : null);
    // 两人在别的（还没结束的）轮里已经匹配过，就不再重复匹配
    if (r.next.status === "accepted" && activeInvites(t).some((i) => i.id !== inv.id && i.status === "accepted" && ((i.fromId === inv.fromId && i.toId === inv.toId) || (i.fromId === inv.toId && i.toId === inv.fromId)))) throw fail("conflict", { reason: "already_matched" });
    db.run("UPDATE invites SET status = ?, responded_at = ? WHERE id = ?", r.next.status, r.next.respondedAt, inv.id);
    if (r.next.status === "accepted") await notifyMatch(r.next);
    return { id: inv.id, status: r.next.status };
  }, { auth: "ready" });

  app.route("GET", "/coffee/matches", (req) => {
    const t = now(), me = req.user.id;
    const rows = db.all("SELECT * FROM invites WHERE status = 'accepted' AND (from_id = ? OR to_id = ?) ORDER BY responded_at DESC LIMIT 100", me, me).map(toInvite);
    const busy = busyMap(activeInvites(t)), rounds = {};
    return rows.map((m) => {
      const round = rounds[m.roundId] || (rounds[m.roundId] = roundById(m.roundId));
      const otherId = m.fromId === me ? m.toId : m.fromId, other = db.get("SELECT * FROM users WHERE id = ?", otherId);
      if (!other || !round) return null;
      const open = !C.isRoundOver(round, t);
      let available = [];
      if (open) {
        const mine = participation(round.id, me), theirs = participation(round.id, otherId);
        available = C.overlap(round, J(mine && mine.slots, []), J(theirs && theirs.slots, []), (busy[me] || []).concat(busy[otherId] || []), t);
      }
      return Object.assign(card(other), {
        matchId: m.id, roundId: m.roundId, roundTitle: round.title, timezone: round.timezone,
        contactMethod: other.contact_method, // 匹配后才给
        slot: m.slot, scheduledBy: m.scheduledBy === me ? "me" : m.scheduledBy ? "them" : null, available,
        canSchedule: open && (!m.slot || Date.parse(t) < C.slotStart(round, m.slot)),
        myOutcome: m.outcomes[me] || null, canReport: !m.slot || Date.parse(t) >= C.slotStart(round, m.slot)
      });
    }).filter(Boolean);
  }, { auth: "ready" });

  app.route("POST", "/coffee/matches/:id/schedule", async (req) => {
    const t = now(), row = db.get("SELECT * FROM invites WHERE id = ?", req.params.id);
    if (!row) throw fail("not_found");
    const inv = toInvite(row), round = roundById(inv.roundId), me = req.user.id;
    if (!C.roleOf(inv, me)) throw fail("not_found");
    const otherId = inv.fromId === me ? inv.toId : inv.fromId;
    const busy = busyMap(activeInvites(t).filter((i) => i.id !== inv.id)); // 两人在所有进行中的轮里已约定的时段都不能再用
    const mine = participation(round.id, me), theirs = participation(round.id, otherId);
    const available = C.overlap(round, J(mine && mine.slots, []), J(theirs && theirs.slots, []), (busy[me] || []).concat(busy[otherId] || []), t);
    const slot = req.body.slot === null ? null : typeof req.body.slot === "string" ? req.body.slot : "";
    const r = C.schedule(inv, slot, me, round, available, t);
    if (!r.ok) throw fail(r.code, r.reason ? { reason: r.reason } : null);
    if (r.unchanged) return { id: inv.id, slot: inv.slot }; // 重复提交：不改、不重复发邮件
    db.run("UPDATE invites SET slot = ?, scheduled_by = ?, scheduled_at = ?, reminded_at = NULL WHERE id = ?", r.next.slot, r.next.scheduledBy, r.next.scheduledAt, inv.id);
    if (r.next.slot) {
      const other = db.get("SELECT * FROM users WHERE id = ?", otherId);
      if (other) await ctx.mailer.send("scheduled", other, { name: req.user.name, when: ctx.mailer.when(round, r.next.slot) });
    }
    return { id: inv.id, slot: r.next.slot };
  }, { auth: "ready" });

  app.route("POST", "/coffee/matches/:id/outcome", (req) => {
    const t = now(), row = db.get("SELECT * FROM invites WHERE id = ?", req.params.id);
    if (!row) throw fail("not_found");
    const inv = toInvite(row), round = roundById(inv.roundId);
    const r = C.recordOutcome(inv, req.body.met, req.user.id, round, t);
    if (!r.ok) throw fail(r.code, Object.assign({}, r.reason ? { reason: r.reason } : {}, r.fields ? { fields: r.fields } : {}));
    db.run("UPDATE invites SET outcomes = ? WHERE id = ?", JSON.stringify(r.next.outcomes), inv.id);
    return { id: inv.id, outcome: r.next.outcomes[req.user.id] };
  }, { auth: "ready" });

  const feedbackHits = new Map();
  app.route("POST", "/feedback", (req) => {
    const v = C.validateFeedback(req.body);
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    const t = Date.now(), arr = (feedbackHits.get(req.user.id) || []).filter((x) => t - x < 3600000);
    if (arr.length >= 10) throw fail("rate_limited", { reason: "too_many_requests" });
    arr.push(t); feedbackHits.set(req.user.id, arr);
    const r = db.run("INSERT INTO feedback (user_id, kind, text, created_at) VALUES (?, ?, ?, ?)", req.user.id, req.body.kind, String(req.body.text).trim(), now());
    return { id: String(r.lastInsertRowid) };
  }, { auth: "consented" }); // 不需要完成资料，但要先同意当前版本的隐私说明

  /* ---------- 活动页（不需要登录，方便转发推广） ---------- */
  const publicRound = (r, t) => Object.assign(roundDTO(r), { open: C.isRoundOpen(r, t), upcoming: !C.isRoundOpen(r, t) && !C.isRoundOver(r, t), participants: participantCount(r) });
  app.route("GET", "/rounds/events", () => {
    const t = now();
    return db.all("SELECT * FROM rounds WHERE kind = 'event' AND status = 'published' ORDER BY start_date DESC LIMIT 50").map(toRound).map((r) => publicRound(r, t));
  }, { auth: "none" });
  app.route("GET", "/rounds/:id", (req) => {
    const r = roundById(req.params.id);
    if (!r || r.status !== "published" || r.kind !== "event") throw fail("not_found");
    return publicRound(r, now());
  }, { auth: "none" });

  return { currentRound, activeRounds, activeInvites, toRound, roundInvites, participants, participantCount, busyMap, roundById };
}

module.exports = { install };
