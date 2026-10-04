#!/usr/bin/env node
/* 备份数据库：用 SQLite 的 VACUUM INTO 生成一份一致的副本（服务运行中也可以执行），只保留最近 30 份。
   用法：npm run backup（服务器上用 cron 每天跑一次，再把 server/data/backups/ 同步到别处） */
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const DB = require("./db");

const cfg = config.load({ DISABLE_JOBS: "1" });
const src = path.join(cfg.dataDir, "yalelux.sqlite");
if (!fs.existsSync(src)) { console.error("没有找到数据库：" + src); process.exit(1); }
const dir = path.join(cfg.dataDir, "backups");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "yalelux-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".sqlite");
const db = DB.open(src);
db.raw.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
db.close();
const old = fs.readdirSync(dir).filter((f) => /^yalelux-.*\.sqlite$/.test(f)).sort().slice(0, -30);
old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
console.log("备份完成：" + file + (old.length ? `（清理了 ${old.length} 份旧备份）` : ""));
