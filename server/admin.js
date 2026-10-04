/* 管理员接口（管理员名单 = 环境变量 ADMIN_EMAILS）。查看本身也记审计。
   能看：汇总统计、活动轮、意见箱、发信记录、审计日志；看不到：任何人的联系方式。 */
const crypto = require("node:crypto");
const { fail } = require("./http");

function install(app, ctx, coffee) {
  const C = ctx.coffee, db = ctx.db, J = ctx.json;
  const now = () => new Date().toISOString();
  const n = (sql, ...a) => db.get(sql, ...a).n;
  const DAY = 86400000;
  const mondayOf = (day) => C.addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));

  // 7 日回访（PRD 1.3）：按注册那天（UTC 日期）所在的周（周一开始）分组，最近 4 周、新的在前。
  // returned = 注册后第 2–7 天（注册日之后的 1–6 个 UTC 日）里有访问记录（user_visits）的人；
  // complete = 这一周最晚注册的人的第 7 天也过完了，数字不会再变。已注销的人不在 users 里，不计入
  function retention(t) {
    const today = t.slice(0, 10), weeks = [0, 1, 2, 3].map((i) => C.addDays(mondayOf(today), -7 * i));
    const rows = db.all(`SELECT substr(u.created_at, 1, 10) AS day,
        EXISTS (SELECT 1 FROM user_visits v WHERE v.user_id = u.id AND v.day > substr(u.created_at, 1, 10) AND v.day <= date(substr(u.created_at, 1, 10), '+6 days')) AS returned
      FROM users u WHERE u.created_at >= ?`, weeks[3]);
    return {
      cohorts: weeks.map((week) => {
        const mine = rows.filter((r) => mondayOf(r.day) === week);
        return { week, registered: mine.length, returned: mine.filter((r) => r.returned).length, complete: today > C.addDays(week, 12) };
      })
    };
  }

  app.route("GET", "/admin/overview", () => {
    const round = coffee.currentRound();
    const inv = round ? coffee.roundInvites(round.id) : [];
    const t = now();
    const accepted = db.all("SELECT outcomes FROM invites WHERE status = 'accepted'").map((r) => Object.values(J(r.outcomes, {})));
    return {
      users: { total: n("SELECT COUNT(*) n FROM users"), profileDone: n("SELECT COUNT(*) n FROM users WHERE profile_done_at IS NOT NULL"), contactVerified: n("SELECT COUNT(*) n FROM users WHERE contact_verified_at IS NOT NULL"), smartRecOff: n("SELECT COUNT(*) n FROM users WHERE smart_rec = 0") },
      round: round && {
        id: round.id, kind: round.kind, title: round.title,
        participants: coffee.participantCount(round), // 和约咖啡首页、活动页同一个口径（资料完整 + 同意当前版本）
        invites: inv.length,
        pending: inv.filter((i) => C.inviteStatus(i, round, t) === "pending").length,
        matches: inv.filter((i) => i.status === "accepted").length,
        skipped: inv.filter((i) => i.status === "skipped").length,
        scheduled: inv.filter((i) => i.status === "accepted" && i.slot).length,
        fromRecs: inv.filter((i) => i.source === "rec").length,
        engines: Object.fromEntries(db.all("SELECT engine, COUNT(*) n FROM recommendations WHERE round_id = ? GROUP BY engine", round.id).map((r) => [r.engine, r.n]))
      },
      allTime: { matches: accepted.length, met: accepted.filter((o) => o.includes("met")).length, missed: accepted.filter((o) => o.includes("missed") && !o.includes("met")).length },
      emails7d: db.all("SELECT kind, status, COUNT(*) n FROM emails WHERE created_at >= ? GROUP BY kind, status", new Date(Date.now() - 7 * DAY).toISOString()),
      feedback: n("SELECT COUNT(*) n FROM feedback"),
      retention: retention(t)
    };
  }, { auth: "admin", audit: true });

  app.route("GET", "/admin/rounds", () => db.all("SELECT * FROM rounds ORDER BY start_date DESC LIMIT 60").map(coffee.toRound), { auth: "admin" });

  // 新建 / 修改活动轮。b = { id?, title: {zh, en}, startDate, endDate, themeTags, recCount, openBrowse, status, post: { title, body, wechat } }
  app.route("POST", "/admin/rounds", (req) => {
    const b = req.body || {}, t = now();
    const title = { zh: String((b.title && b.title.zh) || "").trim().slice(0, 60), en: String((b.title && b.title.en) || "").trim().slice(0, 80) };
    const v = C.validateRound({ title, startDate: b.startDate, endDate: b.endDate });
    if (!v.ok) throw fail("invalid", { fields: v.fields });
    // 和前端（admin.js check）一样按字符（码点）计长度；超了就报错，不悄悄截断（截断会留下半个 emoji）
    const themeTags = [].concat(b.themeTags || []).map((x) => String(x).trim()).filter(Boolean);
    if (themeTags.length > 5) throw fail("invalid", { fields: { themeTags: "too_many" } });
    if (themeTags.some((x) => Array.from(x).length > 20)) throw fail("invalid", { fields: { themeTags: "too_long" } });
    const status = b.status === "published" ? "published" : "draft";
    const id = b.id ? String(b.id) : "ev-" + crypto.randomBytes(4).toString("hex");
    const existing = db.get("SELECT * FROM rounds WHERE id = ?", id);
    if (b.id && (!existing || existing.kind !== "event")) throw fail("not_found");
    if (status === "published") {
      const clash = db.get("SELECT id FROM rounds WHERE kind = 'event' AND status = 'published' AND id != ? AND start_date <= ? AND end_date >= ?", id, b.endDate, b.startDate);
      if (clash) throw fail("conflict", { reason: "overlaps_event" });
    }
    const config = { recCount: Math.min(10, Math.max(1, Number(b.recCount) || 5)), openBrowse: b.openBrowse !== false };
    const post = { title: String((b.post && b.post.title) || title.zh).slice(0, 80), body: String((b.post && b.post.body) || "").slice(0, 4000), wechat: String((b.post && b.post.wechat) || "").slice(0, 2000) };
    if (existing) db.run("UPDATE rounds SET status = ?, title = ?, theme_tags = ?, config = ?, start_date = ?, end_date = ?, post = ?, updated_at = ? WHERE id = ?", status, JSON.stringify(title), JSON.stringify(themeTags), JSON.stringify(config), b.startDate, b.endDate, JSON.stringify(post), t, id);
    else db.run("INSERT INTO rounds (id, kind, status, title, theme_tags, config, start_date, end_date, post, created_at, updated_at) VALUES (?, 'event', ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, status, JSON.stringify(title), JSON.stringify(themeTags), JSON.stringify(config), b.startDate, b.endDate, JSON.stringify(post), t, t);
    return coffee.roundById(id);
  }, { auth: "admin" });

  app.route("GET", "/admin/feedback", () => db.all("SELECT f.id, f.kind, f.text, f.created_at, u.name FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 200"), { auth: "admin", audit: true });
  app.route("GET", "/admin/emails", () => db.all("SELECT id, kind, status, error, created_at FROM emails ORDER BY id DESC LIMIT 200"), { auth: "admin" });
  app.route("GET", "/admin/audit", () => db.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200"), { auth: "admin" });
}

module.exports = { install };
