#!/usr/bin/env node
/* 本地演示数据：生成 24 位虚构用户（邮箱 @demo.yale.edu，联系邮箱 @example.com），都参加本周这一轮。
   人数超过推荐门槛（20），登录后就能看到推荐。生产环境拒绝运行。用法：npm run seed */
const { build } = require("./app");

const { cfg, ctx, db } = build({ DISABLE_JOBS: "1" });
if (cfg.production) { console.error("seed 不能在生产环境运行"); process.exit(1); }
const C = ctx.coffee, Q = ctx.questions;

const NAMES = ["陈思远", "林可欣", "王子涵", "赵一鸣", "孙悦然", "周嘉怡", "吴昊天", "郑雨桐", "钱晓晨", "冯一帆", "褚佳宁", "卫子墨", "蒋欣然", "沈博文", "韩若曦", "杨天佑", "朱雅琪", "秦浩然", "许诺", "何以宁", "吕知夏", "施嘉禾", "张书言", "曹亦凡"];
const JOBS = ["Analyst @ 某投行", "Software Engineer @ 某科技公司", "Consultant @ 某咨询公司", "PhD Student → Postdoc", "Product Manager", "Data Scientist", "Associate @ 某律所", "Founder @ 早期创业公司"];
const CITIES = ["New York", "Boston", "Bay Area", "Shanghai", "Beijing", "New Haven"];
let seedN = 7;
const rand = () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const pickSome = (a, n) => a.slice().sort(() => rand() - 0.5).slice(0, n);

const now = new Date().toISOString();
const week = C.signupWeek(now);
db.run("INSERT OR IGNORE INTO rounds (id, kind, status, title, theme_tags, config, start_date, end_date, post, created_at, updated_at) VALUES (?, 'weekly', 'published', ?, '[]', '{}', ?, ?, '{}', ?, ?)",
  week.id, JSON.stringify({ zh: "本周 Coffee Chat", en: "This week's coffee chats" }), week.startDate, week.endDate, now, now);
const futureSlots = C.slotIds(week).filter((s) => !C.isClosed(week, s, now));

let created = 0;
NAMES.forEach((name, i) => {
  const email = `demo${String(i + 1).padStart(2, "0")}@demo.yale.edu`;
  if (db.get("SELECT id FROM users WHERE login_email = ?", email)) return;
  const student = i % 2 === 0, id = "u-demo" + String(i + 1).padStart(2, "0");
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
  db.run("INSERT OR IGNORE INTO participations (round_id, user_id, slots, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)", week.id, id, JSON.stringify(pickSome(futureSlots, 8 + Math.floor(rand() * 12)).sort()), now, now);
  created++;
});
console.log(`seed: 新建 ${created} 位演示用户，本周轮 ${week.id}，参与人数 ${db.get("SELECT COUNT(*) n FROM participations WHERE round_id = ?", week.id).n}`);
db.close();
