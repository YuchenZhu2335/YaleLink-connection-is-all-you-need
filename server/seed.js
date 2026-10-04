#!/usr/bin/env node
/* 本地演示数据：24 位虚构用户（邮箱 @demo.yale.edu，联系邮箱 @example.com），都参加当前这一轮
   （进行中的活动轮优先，否则正在报名的每周轮——和约咖啡首页同一个"当前轮"）。人数超过推荐门槛（20），登录后就能看到推荐。
   可以重复运行：已有的演示用户不重建，只把还不在当前轮里的人加进去。周六切到下一周、或者发布了活动轮之后，再跑一次就行。
   生产环境拒绝运行。用法：npm run seed */
const { build } = require("./app");

const NAMES = ["陈思远", "林可欣", "王子涵", "赵一鸣", "孙悦然", "周嘉怡", "吴昊天", "郑雨桐", "钱晓晨", "冯一帆", "褚佳宁", "卫子墨", "蒋欣然", "沈博文", "韩若曦", "杨天佑", "朱雅琪", "秦浩然", "许诺", "何以宁", "吕知夏", "施嘉禾", "张书言", "曹亦凡"];
const JOBS = ["Analyst @ 某投行", "Software Engineer @ 某科技公司", "Consultant @ 某咨询公司", "PhD Student → Postdoc", "Product Manager", "Data Scientist", "Associate @ 某律所", "Founder @ 早期创业公司"];
const CITIES = ["New York", "Boston", "Bay Area", "Shanghai", "Beijing", "New Haven"];

// app = build() 的返回值；at = 当前时间（测试可以传入）。返回 { created, joined, round, participants }
function seed(app, at) {
  const { cfg, ctx, db, coffee } = app;
  if (cfg.production) throw new Error("seed 不能在生产环境运行");
  const C = ctx.coffee, Q = ctx.questions;
  let seedN = 7;
  const rand = () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const pickSome = (a, n) => a.slice().sort(() => rand() - 0.5).slice(0, n);

  const now = at || new Date().toISOString();
  const round = coffee.currentRound(now); // 顺带创建正在报名的每周轮
  // 只从还没截止的、最近 7 天里的时段里挑（活动轮可能长达 31 天，时段太分散就几乎没有共同空闲）
  const open = round ? C.slotIds(round).filter((s) => !C.isClosed(round, s, now)) : [];
  const soon = open.length ? open.filter((s) => s.slice(0, 10) < C.addDays(open[0].slice(0, 10), 7)) : [];

  let created = 0, joined = 0;
  NAMES.forEach((name, i) => {
    const n = String(i + 1).padStart(2, "0"), email = `demo${n}@demo.yale.edu`;
    let user = db.get("SELECT id FROM users WHERE login_email = ?", email);
    if (!user) {
      const student = i % 2 === 0, id = "u-demo" + n;
      const answers = {
        goals: student ? pickSome(["industry", "academic", "friends"], 1 + Math.floor(rand() * 2)) : pickSome(["share", "friends"], 1 + Math.floor(rand() * 2)),
        interests: pickSome(Q.find((q) => q.id === "interests").options.map((o) => o.id), 2 + Math.floor(rand() * 3)),
        field: pick(Q.find((q) => q.id === "field").options.map((o) => o.id)),
        intro: student ? "在读，想多认识学长学姐，聊聊求职和生活。" : "毕业几年了，很乐意分享经验。"
      };
      db.run(`INSERT INTO users (id, login_email, contact_email, contact_verified_at, yale_verified_at, consent_version, consent_at, name, identity, stage, grad_year, job, city, contact_method, answers, prefs, profile_done_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, email, `demo${i + 1}@example.com`, now, now, cfg.consentVersion, now, name, student ? "student" : "alumni",
        student ? pick(["undergrad", "master", "phd"]) : "", student ? 2027 + (i % 3) : null, student ? "" : pick(JOBS), student ? "" : pick(CITIES),
        `微信 demo-${i + 1}（示例）`, JSON.stringify(answers), JSON.stringify(C.cleanPrefs({})), now, now, now);
      user = { id };
      created++;
    }
    if (!soon.length) return; // 这一轮已经没有还能约的时间（比如活动最后一天晚上）：加进去也约不了
    const slots = pickSome(soon, 8 + Math.floor(rand() * 12)).sort();
    const r = db.run("INSERT OR IGNORE INTO participations (round_id, user_id, slots, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)", round.id, user.id, JSON.stringify(slots), now, now);
    joined += Number(r.changes);
  });
  return { created, joined, round, participants: round ? coffee.participantCount(round) : 0 };
}

if (require.main === module) {
  const app = build({ DISABLE_JOBS: "1" });
  if (app.cfg.production) { console.error("seed 不能在生产环境运行"); process.exit(1); }
  const r = seed(app);
  console.log(r.round
    ? `seed: 新建 ${r.created} 位演示用户，新加入当前轮 ${r.joined} 人；当前轮 ${r.round.id}（${r.round.kind === "event" ? "活动轮" : "每周轮"}），参与人数 ${r.participants}`
    : `seed: 新建 ${r.created} 位演示用户；现在没有当前轮`);
  app.db.close();
}

module.exports = { seed };
