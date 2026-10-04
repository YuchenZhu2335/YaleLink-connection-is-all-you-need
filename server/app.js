/* 装配：配置 → 数据库 → 规则 → 发信 → 路由。测试和启动入口都从这里拿一个完整的 app。 */
const path = require("node:path");
const fs = require("node:fs");
const config = require("./config");
const DB = require("./db");
const { createApp } = require("./http");
const { createMailer } = require("./mailer");

function build(overrides) {
  const cfg = config.load(overrides);
  const db = DB.open(overrides && overrides.DB_FILE ? overrides.DB_FILE : path.join(cfg.dataDir, "yalelink.sqlite"));
  const coffee = require("../web/js/domain/coffee.js");
  const qcfg = JSON.parse(fs.readFileSync(path.join(cfg.webDir, "data", "matchQuestions.json"), "utf8"));
  const qErrors = coffee.validateQuestions(qcfg);
  if (qErrors.length) throw new Error("matchQuestions.json invalid: " + qErrors.join("; "));

  const ctx = { cfg, db, coffee, json: DB.json, questions: qcfg.questions, quiet: overrides && overrides.QUIET === "1" };
  ctx.isAdmin = (u) => !!u && cfg.adminEmails.includes(u.login_email);
  ctx.isReady = (u) => !!u && u.consent_version === cfg.consentVersion && !!u.profile_done_at && !!u.contact_email;
  // 返回给本人看的资料（含本人的私密字段）
  ctx.meDTO = (u, via) => ({
    id: u.id, loginEmail: u.login_email, contactEmail: u.contact_email, contactVerified: !!u.contact_verified_at,
    via, needsConsent: u.consent_version !== cfg.consentVersion, needsContact: !u.contact_email, needsProfile: !u.profile_done_at,
    ready: ctx.isReady(u), isAdmin: ctx.isAdmin(u),
    name: u.name, identity: u.identity, stage: u.stage, gradYear: u.grad_year, job: u.job, city: u.city,
    contactMethod: u.contact_method, answers: DB.json(u.answers, {}), prefs: coffee.cleanPrefs(DB.json(u.prefs, {})), smartRec: u.smart_rec === 1
  });
  ctx.mailer = createMailer(ctx);

  const app = createApp(ctx);
  // 前端需要的少量公开信息
  app.route("GET", "/meta", () => ({ consentVersion: cfg.consentVersion, dev: !cfg.production && cfg.mailDriver === "console", smartRecAvailable: !!cfg.deepseekKey }), { auth: "none" });
  require("./auth").install(app, ctx);
  const coffeeApi = require("./coffee").install(app, ctx);
  require("./admin").install(app, ctx, coffeeApi);
  // 本地开发：查看"发出"的邮件（里面有验证码）。生产环境不存在这条路由
  if (!cfg.production && cfg.mailDriver === "console") {
    app.route("GET", "/dev/outbox", () => ctx.mailer.outbox.slice(0, 20), { auth: "none", audit: false });
  }
  const jobs = require("./jobs").create(ctx, coffeeApi);
  return { cfg, ctx, app, jobs, db };
}

module.exports = { build };
