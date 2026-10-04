// 端到端测试用的后端：临时数据库 + 演示数据（24 位虚构同学）+ 管理员 admin@yale.edu；邮件不发出，验证码在 /api/dev/outbox
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const port = process.argv[2] || "8790";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yalelux-e2e-"));
Object.assign(process.env, { DATA_DIR: dir, PORT: port, PUBLIC_URL: `http://localhost:${port}`, ADMIN_EMAILS: "admin@yale.edu", MAIL_DRIVER: "console", DISABLE_JOBS: "1", NODE_ENV: "test" });
execFileSync(process.execPath, [path.join(__dirname, "..", "server", "seed.js")], { env: process.env, stdio: "inherit" });
require("../server/index.js");
