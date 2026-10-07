/* 装配：配置 → 数据库 → 规则 → 发信 → 路由。测试和启动入口都从这里拿一个完整的 app。 */
const path = require("node:path");
const fs = require("node:fs");
const config = require("./config");
const DB = require("./db");
const { createApp } = require("./http");
const { createMailer } = require("./mailer");
const resumes = require("./resumes");

const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/; // 小写化之后再校验；不接受显示名、逗号、尖括号

function build(overrides) {
  const cfg = config.load(overrides);
  const db = DB.open(overrides && overrides.DB_FILE ? overrides.DB_FILE : path.join(cfg.dataDir, "yalelux.sqlite"));
  const coffee = require("../web/js/domain/coffee.js");
  const qcfg = JSON.parse(fs.readFileSync(path.join(cfg.webDir, "data", "matchQuestions.json"), "utf8"));
  const qErrors = coffee.validateQuestions(qcfg);
  if (qErrors.length) throw new Error("matchQuestions.json invalid: " + qErrors.join("; "));

  const ctx = { cfg, db, coffee, json: DB.json, questions: qcfg.questions, quiet: overrides && overrides.QUIET === "1" };
  // 邮箱：先去空格、小写，再严格校验格式（登录、联系邮箱、后台登记嘉宾邮箱 / 标记导师都用这一套）
  ctx.normEmail = (e) => String(e || "").trim().toLowerCase();
  ctx.validEmail = (e) => typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e);
  ctx.isYale = (email) => {
    if (!ctx.validEmail(email)) return false;
    const d = email.slice(email.lastIndexOf("@") + 1);
    return cfg.allowedDomains.some((a) => d === a || d.endsWith("." + a));
  };
  // 嘉宾邮箱（RFC 0003 §5）：管理员登记过的邮箱可以像耶鲁邮箱一样收验证码登录；删除登记后不能再建立新会话
  ctx.isGuestEmail = (email) => ctx.validEmail(email) && !!db.get("SELECT 1 AS x FROM guest_emails WHERE email = ?", email);
  ctx.canLogin = (email) => ctx.isYale(email) || ctx.isGuestEmail(email);
  // 能不能选身份"嘉宾"：登录邮箱登记在嘉宾名单里，或者不是耶鲁邮箱（那只可能是登记过才登进来的；名单删掉以后已有会话照样能改资料）
  ctx.isGuest = (u) => !!u && (!ctx.isYale(u.login_email) || ctx.isGuestEmail(u.login_email));
  // 简历文件：DATA_DIR/resumes/，文件名随机
  ctx.resumes = resumes.createStore(path.join(cfg.dataDir, "resumes"));
  // 管理员：名单里的耶鲁邮箱，并且这次是用耶鲁邮箱登录的（只验证过联系邮箱的会话不给管理权限）
  ctx.isAdmin = (u, session) => !!u && cfg.adminEmails.includes(u.login_email) && !!session && session.via === "yale";
  // 同意了当前版本的隐私说明：写入个人信息（资料、联系邮箱、邮件开关、意见箱）之前必须满足（路由 auth: "consented"）
  ctx.isConsented = (u) => !!u && u.consent_version === cfg.consentVersion;
  ctx.isReady = (u) => ctx.isConsented(u) && !!u.profile_done_at && !!u.contact_email;
  // 返回给本人看的资料（含本人的私密字段）
  ctx.meDTO = (u, via) => ({
    id: u.id, loginEmail: u.login_email, contactEmail: u.contact_email, contactVerified: !!u.contact_verified_at,
    via, needsConsent: u.consent_version !== cfg.consentVersion, needsContact: !u.contact_email, needsProfile: !u.profile_done_at,
    ready: ctx.isReady(u), isAdmin: ctx.isAdmin(u, { via }), adminNeedsYale: cfg.adminEmails.includes(u.login_email) && via !== "yale",
    name: u.name, preferredName: u.preferred_name || "", identity: u.identity, stage: u.stage, gradYear: u.grad_year, program: u.program || "", job: u.job, city: u.city,
    meetMode: u.meet_mode || "", meetPlace: u.meet_place || "", freeText: u.free_text || "",
    contactMethod: u.contact_method, answers: DB.json(u.answers, {}), prefs: coffee.cleanPrefs(DB.json(u.prefs, {})), smartRec: u.smart_rec === 1,
    role: u.role === "mentor" ? "mentor" : "member", isGuest: ctx.isGuest(u),
    resume: u.resume_file ? { size: u.resume_size, uploadedAt: u.resume_at, visibility: u.resume_visibility === "all" ? "all" : "invited" } : null
  });
  ctx.mailer = createMailer(ctx);

  const app = createApp(ctx);
  // 前端需要的少量公开信息（问卷题目也从这里取：服务端是唯一来源，启动时已校验）
  app.route("GET", "/meta", () => ({ consentVersion: cfg.consentVersion, dev: !cfg.production && cfg.mailDriver === "console", smartRecAvailable: !!cfg.deepseekKey, questions: qcfg.questions }), { auth: "none", audit: false });
  require("./auth").install(app, ctx);
  const coffeeApi = require("./coffee").install(app, ctx);
  resumes.install(app, ctx, coffeeApi);
  require("./admin").install(app, ctx, coffeeApi);
  // 本地开发：查看"发出"的邮件（里面有验证码）
  // 只在非生产、console 发信时存在，并且只接受本机直接访问（不经过代理）
  if (!cfg.production && cfg.mailDriver === "console") {
    app.route("GET", "/dev/outbox", () => ctx.mailer.outbox.slice(0, 20), { auth: "none", audit: false, localOnly: true });
  }
  const jobs = require("./jobs").create(ctx, coffeeApi);
  return { cfg, ctx, app, jobs, db, coffee: coffeeApi };
}

module.exports = { build };
