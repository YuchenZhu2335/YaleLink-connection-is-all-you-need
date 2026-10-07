#!/usr/bin/env node
/* 本地演示数据：24 位虚构用户（邮箱 @demo.yale.edu，联系邮箱 @example.com），都参加当前这一轮
   （进行中的活动轮优先，否则正在报名的每周轮——和约咖啡首页同一个"当前轮"）。人数超过推荐门槛（20），登录后就能看到推荐。
   RFC 0003 的字段也都有示例：英文名、项目、见面方式和地点、自由留言；demo02、demo11 是导师；
   demo01、demo02、demo05 有一份一页的示例简历（PDF，谁能看各不相同）；登记了一个嘉宾邮箱 guest.scholar@example.com。
   可以重复运行：已有的演示用户不重建，只把还不在当前轮里的人加进去（早先的演示用户缺新字段的会补上，简历文件丢了会补写）。
   周六切到下一周、或者发布了活动轮之后，再跑一次就行。生产环境拒绝运行。用法：npm run seed */
const { build } = require("./app");

const NAMES = ["陈思远", "林可欣", "王子涵", "赵一鸣", "孙悦然", "周嘉怡", "吴昊天", "郑雨桐", "钱晓晨", "冯一帆", "褚佳宁", "卫子墨", "蒋欣然", "沈博文", "韩若曦", "杨天佑", "朱雅琪", "秦浩然", "许诺", "何以宁", "吕知夏", "施嘉禾", "张书言", "曹亦凡"];
const JOBS = ["Analyst @ 某投行", "Software Engineer @ 某科技公司", "Consultant @ 某咨询公司", "PhD Student → Postdoc", "Product Manager", "Data Scientist", "Associate @ 某律所", "Founder @ 早期创业公司"];
const CITIES = ["New York", "Boston", "Bay Area", "Shanghai", "Beijing", "New Haven"];
// RFC 0003 的新字段：都按序号 i 决定（不动随机数序列，已有的演示数据保持不变）
const PREFERRED = ["Simon", "Zoe", "Hank", "Iris", "Leo", "Nina", "Max", "Ivy"];
const PROGRAMS = ["Statistics and Data Science", "Master of Business Administration", "Environmental Management", "Computer Science", "Economics", "Public Health",
  "Global Affairs", "Molecular Biophysics and Biochemistry", "Architecture", "Chemistry", "History of Art", "Master of Laws"];
const MEET_PLACES = {
  online: ["Zoom", "Zoom 或腾讯会议都可以"],
  newhaven: ["Bluebook Café（虚构的示例咖啡馆），New Haven", "Elm Lantern Coffee（虚构示例），市中心"],
  either: ["", "线上用 Zoom；线下在 Bluebook Café（虚构示例）"]
};
const FREE_TEXTS = [
  "最近在准备暑期实习，想听听大家投简历的经验。\n\n周末也常去东岩公园徒步，欢迎同行。",
  "毕业后在湾区做了几年产品，现在考虑回国发展。\n很乐意聊职业选择，也想认识做研究的同学。",
  "刚到纽黑文，对这里还不熟，想多认识一些朋友。",
  "可以帮忙改简历、模拟面试（示例文字）。"
];
const MENTORS = ["demo02@demo.yale.edu", "demo11@demo.yale.edu"];
const RESUMES = { "demo01@demo.yale.edu": "all", "demo02@demo.yale.edu": "invited", "demo05@demo.yale.edu": "invited" };
const GUEST = { email: "guest.scholar@example.com", note: "创新学者（示例）" };

function extras(i, email, student) {
  const meetMode = ["online", "newhaven", "either"][i % 3];
  return {
    preferredName: i % 3 === 0 ? PREFERRED[(i / 3) % PREFERRED.length] : "",
    program: student ? PROGRAMS[Math.floor(i / 2) % PROGRAMS.length] : "",
    meetMode, meetPlace: MEET_PLACES[meetMode][Math.floor(i / 3) % 2],
    freeText: i % 4 === 1 || i % 7 === 0 ? FREE_TEXTS[i % FREE_TEXTS.length] : "",
    role: MENTORS.includes(email) ? "mentor" : "member"
  };
}

// 一个最小的一页 PDF（Helvetica、只用 ASCII 文字），给"查看简历"演示用；xref 的字节偏移按实际内容算，阅读器能正常打开
function samplePdf(lines) {
  const esc = (x) => String(x).replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, (c) => "\\" + c);
  const text = lines.map((l, i) => `BT /F1 ${i ? 12 : 22} Tf 72 ${720 - i * 30} Td (${esc(l)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = Buffer.byteLength(out, "latin1"); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

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

  let created = 0, joined = 0, resumes = 0;
  db.run("INSERT OR IGNORE INTO guest_emails (email, note, added_by, created_at) VALUES (?, ?, NULL, ?)", GUEST.email, GUEST.note, now);
  NAMES.forEach((name, i) => {
    const n = String(i + 1).padStart(2, "0"), email = `demo${n}@demo.yale.edu`;
    let user = db.get("SELECT id, identity, meet_mode FROM users WHERE login_email = ?", email);
    if (user && !user.meet_mode) { // 早先的演示用户：补上 RFC 0003 的新字段（只补一次，之后在网站里改过的不覆盖）
      const x = extras(i, email, user.identity === "student");
      db.run("UPDATE users SET preferred_name = ?, program = ?, meet_mode = ?, meet_place = ?, free_text = ?, role = ? WHERE id = ? AND meet_mode IS NULL", x.preferredName, x.program, x.meetMode, x.meetPlace, x.freeText, x.role, user.id);
    }
    if (!user) {
      const student = i % 2 === 0, id = "u-demo" + n, x = extras(i, email, student);
      const answers = {
        goals: student ? pickSome(["industry", "academic", "friends"], 1 + Math.floor(rand() * 2)) : pickSome(["share", "friends"], 1 + Math.floor(rand() * 2)),
        interests: pickSome(Q.find((q) => q.id === "interests").options.map((o) => o.id), 2 + Math.floor(rand() * 3)),
        field: pick(Q.find((q) => q.id === "field").options.map((o) => o.id)),
        intro: student ? "在读，想多认识学长学姐，聊聊求职和生活。" : "毕业几年了，很乐意分享经验。"
      };
      // 学段照旧随机挑（保持随机数序列不变），demo21 改成博士后（不要求毕业年份）
      let stage = student ? pick(["undergrad", "master", "phd"]) : "", gradYear = student ? 2027 + (i % 3) : null;
      if (i === 20) { stage = "postdoc"; gradYear = null; }
      db.run(`INSERT INTO users (id, login_email, contact_email, contact_verified_at, yale_verified_at, consent_version, consent_at, name, preferred_name, identity, stage, grad_year, program, job, city,
                meet_mode, meet_place, free_text, role, contact_method, answers, prefs, profile_done_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, email, `demo${i + 1}@example.com`, now, now, cfg.consentVersion, now, name, x.preferredName, student ? "student" : "alumni",
        stage, gradYear, x.program, student ? "" : pick(JOBS), student ? "" : pick(CITIES),
        x.meetMode, x.meetPlace, x.freeText, x.role, `微信 demo-${i + 1}（示例）`, JSON.stringify(answers), JSON.stringify(C.cleanPrefs({})), now, now, now);
      user = { id };
      created++;
    }
    // 示例简历：没有、或者文件丢了（比如数据库是从别处拷来的）就写一份
    if (RESUMES[email]) {
      const r = db.get("SELECT resume_file FROM users WHERE id = ?", user.id);
      if (!r.resume_file || !ctx.resumes.exists(r.resume_file)) {
        const pdf = samplePdf(["Sample resume", `Fictional demo profile ${email.replace(/@.*/, "")} - not a real person`, "Contact: see the Yalelux match page"]);
        const file = ctx.resumes.save(pdf);
        db.run("UPDATE users SET resume_file = ?, resume_size = ?, resume_at = ?, resume_visibility = ? WHERE id = ?", file, pdf.length, now, RESUMES[email], user.id);
        resumes++;
      }
    }
    if (!soon.length) return; // 这一轮已经没有还能约的时间（比如活动最后一天晚上）：加进去也约不了
    const slots = pickSome(soon, 8 + Math.floor(rand() * 12)).sort();
    const r = db.run("INSERT OR IGNORE INTO participations (round_id, user_id, slots, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)", round.id, user.id, JSON.stringify(slots), now, now);
    joined += Number(r.changes);
  });
  return { created, joined, resumes, round, participants: round ? coffee.participantCount(round) : 0 };
}

if (require.main === module) {
  const app = build({ DISABLE_JOBS: "1" });
  if (app.cfg.production) { console.error("seed 不能在生产环境运行"); process.exit(1); }
  const r = seed(app);
  console.log(r.round
    ? `seed: 新建 ${r.created} 位演示用户，新加入当前轮 ${r.joined} 人，写入示例简历 ${r.resumes} 份；当前轮 ${r.round.id}（${r.round.kind === "event" ? "活动轮" : "每周轮"}），参与人数 ${r.participants}；嘉宾邮箱示例 ${GUEST.email}`
    : `seed: 新建 ${r.created} 位演示用户，写入示例简历 ${r.resumes} 份；现在没有当前轮`);
  app.db.close();
}

module.exports = { seed, samplePdf };
