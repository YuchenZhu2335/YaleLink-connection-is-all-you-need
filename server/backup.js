#!/usr/bin/env node
/* 备份数据库：用 SQLite 的 VACUUM INTO 生成一份一致的副本（服务运行中也可以执行），只保留最近 30 份。
   简历文件（DATA_DIR/resumes/，RFC 0003）一并备份：每份数据库备份旁边一个同名的 -resumes 文件夹。
   简历文件写好之后不会再改（替换 = 新文件名），所以用硬链接"复制"——不多占磁盘；备份目录在别的磁盘上时退回真复制。
   删掉的简历在旧备份里最多留 30 份备份那么久，和数据库备份里已注销的资料一样。
   用法：npm run backup（服务器上用 cron 每天跑一次，再把 server/data/backups/ 同步到别处；rsync 用 -H 保留硬链接） */
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

// 简历：数据库副本做完之后再拍（这之间新上传的文件多出来不要紧；数据库里记着的文件都在）
const resumesSrc = path.join(cfg.dataDir, "resumes"), resumesDst = file.replace(/\.sqlite$/, "-resumes");
let copied = 0;
if (fs.existsSync(resumesSrc)) {
  fs.mkdirSync(resumesDst, { recursive: true, mode: 0o700 });
  for (const f of fs.readdirSync(resumesSrc)) {
    if (!/^[a-f0-9]{32}\.pdf$/.test(f)) continue;
    const from = path.join(resumesSrc, f), to = path.join(resumesDst, f);
    try { fs.linkSync(from, to); } catch (e) {
      if (e.code === "ENOENT") continue; // 刚好被删掉了
      fs.copyFileSync(from, to); // 跨磁盘等：真复制
    }
    copied++;
  }
}

const old = fs.readdirSync(dir).filter((f) => /^yalelux-.*\.sqlite$/.test(f)).sort().slice(0, -30);
old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
const oldResumes = fs.readdirSync(dir).filter((f) => /^yalelux-.*-resumes$/.test(f)).sort().slice(0, -30);
oldResumes.forEach((f) => fs.rmSync(path.join(dir, f), { recursive: true, force: true }));
console.log("备份完成：" + file + `（简历 ${copied} 份）` + (old.length || oldResumes.length ? `（清理了 ${old.length} 份旧备份）` : ""));
