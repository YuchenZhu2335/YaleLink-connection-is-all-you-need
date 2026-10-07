/* 简历（RFC 0003 §4）
   - 只收 PDF：请求体就是文件本身（Content-Type: application/pdf），最大 5 MB，开头必须是 %PDF-；
   - 存在 DATA_DIR/resumes/，文件名随机（crypto.randomBytes）；原文件名不保存，下载时一律叫 resume.pdf；
     数据库只记文件名、大小、上传时间、谁能看（users.resume_*）；
   - 谁能看由 web/js/domain/coffee.js 的 canViewResume 判断（事实由 coffee.js 的 canSeeResume 查好），看不了一律 not_found，
     不透露有没有简历；管理员在后台看不到任何人的简历；不发给大模型；
   - 替换、删除、注销账号时立即删掉文件；每日备份（server/backup.js）一并备份这个文件夹。 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fail, reply } = require("./http");

const NAME = /^[a-f0-9]{32}\.pdf$/; // 只认自己生成的文件名：数据库里的值哪怕被改坏，也拼不出别的路径
const UPLOADS_PER_DAY = 20;
// 下载时的响应头：按 PDF 显示、不让浏览器猜类型、不缓存、沙箱里打开（PDF 里的脚本 / 表单碰不到本站）
const PDF_HEADERS = Object.freeze({
  "Content-Type": "application/pdf",
  "Content-Disposition": 'inline; filename="resume.pdf"',
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "sandbox"
});

function createStore(dir) {
  const fileOf = (name) => (NAME.test(String(name || "")) ? path.join(dir, name) : null);
  return {
    dir,
    // 写入一个新文件，返回随机文件名（wx：万一重名就报错，绝不覆盖别人的文件）
    save(buf) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const name = crypto.randomBytes(16).toString("hex") + ".pdf";
      fs.writeFileSync(path.join(dir, name), buf, { flag: "wx", mode: 0o600 });
      return name;
    },
    read(name) {
      const f = fileOf(name);
      if (!f) return null;
      try { return fs.readFileSync(f); } catch (e) { return null; }
    },
    remove(name) {
      const f = fileOf(name);
      if (!f) return;
      try { fs.unlinkSync(f); } catch (e) { if (e.code !== "ENOENT") console.error("resume delete failed:", e.message); }
    },
    exists: (name) => { const f = fileOf(name); return !!f && fs.existsSync(f); }
  };
}

function install(app, ctx, coffee) {
  const C = ctx.coffee, db = ctx.db, store = ctx.resumes;
  const now = () => new Date().toISOString();
  const me = (req) => ctx.meDTO(db.get("SELECT * FROM users WHERE id = ?", req.user.id), req.session.via);
  // 每人每天最多上传 20 次（不论成功与否；内存计数，重启清零）
  const uploads = new Map();
  function limitUploads(userId) {
    const t = Date.now(), arr = (uploads.get(userId) || []).filter((x) => t - x < 86400000);
    if (arr.length >= UPLOADS_PER_DAY) throw fail("rate_limited", { reason: "too_many_uploads" });
    arr.push(t); uploads.set(userId, arr);
    if (uploads.size > 20000) uploads.clear();
  }
  const download = (name) => {
    const buf = store.read(name);
    if (!buf) throw fail("not_found");
    return reply(buf, PDF_HEADERS);
  };

  // 上传 / 替换简历：请求体就是 PDF 文件本身。替换时删掉旧文件
  app.route("POST", "/me/resume", (req) => {
    limitUploads(req.user.id);
    const buf = req.body;
    if (!buf.length) throw fail("invalid", { fields: { resume: "empty" } });
    if (buf.length > C.LIMITS.resumeBytes) throw fail("too_large", { fields: { resume: "too_large" } });
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw fail("invalid", { fields: { resume: "not_pdf" } });
    // 旧文件名在写库前重新读（req.user 是读请求体之前取的，同时上传两次时以这里为准）
    const old = db.get("SELECT resume_file FROM users WHERE id = ?", req.user.id).resume_file;
    const name = store.save(buf);
    try {
      db.run("UPDATE users SET resume_file = ?, resume_size = ?, resume_at = ?, updated_at = ? WHERE id = ?", name, buf.length, now(), now(), req.user.id);
    } catch (e) { store.remove(name); throw e; }
    if (old && old !== name) store.remove(old);
    return me(req);
  }, { auth: "consented", raw: { type: "application/pdf", max: C.LIMITS.resumeBytes, field: "resume", badType: "not_pdf" } });

  // 谁能看：invited（只给我邀请的人和匹配过的人）| all（同一轮的参与者也能看）。没有简历时也可以先设好
  app.route("POST", "/me/resume/settings", (req) => {
    const v = req.body.visibility;
    if (C.RESUME_VISIBILITY.indexOf(v) < 0) throw fail("invalid", { fields: { visibility: "invalid" } });
    db.run("UPDATE users SET resume_visibility = ?, updated_at = ? WHERE id = ?", v, now(), req.user.id);
    return me(req);
  }, { auth: "consented" });

  // 删除简历：立即删文件。删自己的数据不要求先同意隐私说明（和注销一样）
  app.route("POST", "/me/resume/delete", (req) => {
    const old = db.get("SELECT resume_file FROM users WHERE id = ?", req.user.id).resume_file;
    db.run("UPDATE users SET resume_file = NULL, resume_size = NULL, resume_at = NULL, updated_at = ? WHERE id = ?", now(), req.user.id);
    if (old) store.remove(old);
    return me(req);
  });

  // 本人下载自己的简历
  app.route("GET", "/me/resume", (req) => {
    const row = db.get("SELECT resume_file FROM users WHERE id = ?", req.user.id);
    if (!row.resume_file) throw fail("not_found");
    return download(row.resume_file);
  });

  // 看别人的简历：canViewResume 不允许、没有简历、文件不见了，一律 not_found。查看留审计（谁看了谁的，不记内容）
  app.route("GET", "/coffee/people/:id/resume", (req) => {
    const owner = db.get("SELECT * FROM users WHERE id = ?", req.params.id);
    if (!owner || !coffee.canSeeResume(req.user.id, owner)) throw fail("not_found");
    return download(owner.resume_file);
  }, { auth: "ready", audit: true });
}

module.exports = { createStore, install, PDF_HEADERS, NAME };
