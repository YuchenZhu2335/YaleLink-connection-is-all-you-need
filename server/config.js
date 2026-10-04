/* 服务端配置：全部来自环境变量（本地开发读 server/.env）。密钥只放环境变量，不进仓库。
   Server config from environment variables; see server/.env.example. */
const fs = require("node:fs");
const path = require("node:path");

// 极简 .env 读取：KEY=VALUE，# 开头为注释；已有的环境变量优先
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function load(overrides) {
  loadEnvFile(path.join(__dirname, ".env"));
  const env = Object.assign({}, process.env, overrides || {});
  const list = (v, d) => String(v || d).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const production = env.NODE_ENV === "production";
  const cfg = {
    production,
    port: Number(env.PORT || 8787),
    publicUrl: String(env.PUBLIC_URL || "http://localhost:" + (env.PORT || 8787)).replace(/\/$/, ""),
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, "data")),
    webDir: path.resolve(__dirname, "..", "web"),
    secret: env.APP_SECRET || (production ? "" : "dev-only-secret-change-me"),
    allowedDomains: list(env.ALLOWED_EMAIL_DOMAINS, "yale.edu,aya.yale.edu"),
    adminEmails: list(env.ADMIN_EMAILS, ""),
    mailDriver: env.MAIL_DRIVER || "console",
    mailFrom: env.MAIL_FROM || "Yalelux <noreply@localhost>",
    resendKey: env.RESEND_API_KEY || "",
    deepseekKey: env.DEEPSEEK_API_KEY || "",
    deepseekBase: String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    deepseekModel: env.DEEPSEEK_MODEL || "deepseek-chat",
    consentVersion: env.CONSENT_VERSION || "2026-10",
    jobsIntervalMs: Number(env.JOBS_INTERVAL_MS || 10 * 60 * 1000),
    disableJobs: env.DISABLE_JOBS === "1",
    // 放在 Caddy / Nginx 后面时设为 1：用代理传来的 X-Forwarded-For 识别真实 IP（否则所有人都是 127.0.0.1，按 IP 限流会误伤）
    trustProxy: env.TRUST_PROXY === "1"
  };
  if (production && (!cfg.secret || cfg.secret.length < 32)) throw new Error("APP_SECRET must be set (32+ chars) in production");
  if (production && cfg.mailDriver === "console") throw new Error("MAIL_DRIVER=console is not allowed in production");
  return cfg;
}

module.exports = { load };
