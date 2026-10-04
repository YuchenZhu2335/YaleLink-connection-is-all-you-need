/* 定时任务（进程内每 10 分钟跑一次；重复执行是安全的）：
   1. 每周一给打开了"每周提醒"的人发一封邮件（有活动轮进行时不发，避免重复）；周六起已经可以报名下一周
   2. 活动轮开始时发活动邮件（每人一次）
   3. "有人想认识你"：每人每天最多一封汇总，只在美东 9:00–21:00 发
   4. 约定时间的前一天提醒双方（每人一次）
   发送记录在 emails 表里按 ref（这件事的标识）去重：中途重启会接着发没发完的人，发送失败的下一轮会重试（最多 3 次）。 */
function create(ctx, coffee) {
  const C = ctx.coffee, db = ctx.db;
  const readyUsers = () => db.all("SELECT * FROM users WHERE profile_done_at IS NOT NULL AND consent_version = ?", ctx.cfg.consentVersion);

  async function run(at) {
    const t = at || new Date().toISOString();
    const round = coffee.currentRound(t); // 顺带创建正在报名的每周轮

    // 1) 每周一：本周这一轮在开始之前就已经存在（不是系统第一次启动时才建的），而且没有活动轮在进行
    const weekRow = db.get("SELECT * FROM rounds WHERE id = ?", C.weeklyRound(t).id);
    if (weekRow && !weekRow.announced_at) {
      const week = coffee.toRound(weekRow);
      const createdAfterStart = Date.parse(weekRow.created_at) > C.slotStart(week, week.startDate + "T00:00"); // 系统在这周中途才第一次启动
      if (!createdAfterStart && round && round.kind === "weekly") {
        for (const u of readyUsers()) await ctx.mailer.sendOnce("weekly", u, {}, "weekly:" + week.id);
      }
      db.run("UPDATE rounds SET announced_at = ? WHERE id = ?", t, week.id);
    }

    // 2) 活动开始
    for (const r of db.all("SELECT * FROM rounds WHERE kind = 'event' AND status = 'published' AND announced_at IS NULL").map(coffee.toRound)) {
      if (!C.isRoundOpen(r, t)) continue;
      for (const u of readyUsers()) await ctx.mailer.sendOnce("event", u, { title: r.title }, "event:" + r.id);
      db.run("UPDATE rounds SET announced_at = ? WHERE id = ?", t, r.id);
    }

    // 3) 每天一封的邀请汇总
    const hour = Number(new Date(Date.parse(t)).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }));
    if (hour >= 9 && hour < 21) {
      const pending = coffee.activeInvites(t).filter((i) => C.inviteStatus(i, i.round, t) === "pending");
      const byUser = {};
      pending.forEach((i) => (byUser[i.toId] = byUser[i.toId] || []).push(i));
      for (const [uid, list] of Object.entries(byUser)) {
        const u = db.get("SELECT * FROM users WHERE id = ?", uid);
        if (!u || (u.last_digest_at && Date.parse(t) - Date.parse(u.last_digest_at) < 24 * 3600000)) continue;
        const fresh = list.filter((i) => !u.last_digest_at || i.createdAt > u.last_digest_at);
        if (!fresh.length) continue;
        const names = fresh.map((i) => (db.get("SELECT name FROM users WHERE id = ?", i.fromId) || {}).name).filter(Boolean);
        const ok = await ctx.mailer.send("invite_digest", u, { n: fresh.length, names: names.slice(0, 3).join("、") + (names.length > 3 ? " 等" : "") });
        if (ok || ctx.json(u.prefs, {}).invite_digest === false) db.run("UPDATE users SET last_digest_at = ? WHERE id = ?", t, uid);
      }
    }

    // 4) 前一天提醒（每人每场一次；两人都发到了才标记完成）
    for (const row of db.all("SELECT * FROM invites WHERE status = 'accepted' AND slot IS NOT NULL AND reminded_at IS NULL")) {
      const r = coffee.roundById(row.round_id);
      if (!r) continue;
      const start = C.slotStart(r, row.slot), left = start - Date.parse(t);
      if (left <= 0 || left > 24 * 3600000) continue;
      const a = db.get("SELECT * FROM users WHERE id = ?", row.from_id), b = db.get("SELECT * FROM users WHERE id = ?", row.to_id);
      if (!a || !b) continue;
      const when = ctx.mailer.when(r, row.slot), ref = "reminder:" + row.id + ":" + row.slot;
      const okA = await ctx.mailer.sendOnce("reminder", a, { name: b.name, when }, ref);
      const okB = await ctx.mailer.sendOnce("reminder", b, { name: a.name, when }, ref);
      if (okA && okB) db.run("UPDATE invites SET reminded_at = ? WHERE id = ?", t, row.id);
    }

    // 5) 清理过期的验证码和会话
    db.run("DELETE FROM login_codes WHERE expires_at < ?", new Date(Date.parse(t) - 86400000).toISOString());
    db.run("DELETE FROM sessions WHERE expires_at < ?", t);
  }
  return { run };
}

module.exports = { create };
