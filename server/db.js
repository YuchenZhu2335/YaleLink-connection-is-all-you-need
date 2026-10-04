/* 数据库：Node 自带的 SQLite（node:sqlite），一个文件，零依赖。
   规模到几千人都够用；以后换 PostgreSQL 只改这个文件和迁移脚本。 */
const fs = require("node:fs");
const path = require("node:path");
process.removeAllListeners("warning"); // 屏蔽 node:sqlite 的"实验特性"提示，其他警告照常
process.on("warning", (w) => { if (!(w.name === "ExperimentalWarning" && /SQLite/.test(w.message))) console.warn(w); });
const { DatabaseSync } = require("node:sqlite");

function open(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return wrap(db);
}

// 按文件名顺序执行 migrations/*.sql，每个只执行一次
function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
  const dir = path.join(__dirname, "migrations");
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(fs.readFileSync(path.join(dir, name), "utf8"));
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
}

function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => { if (!cache.has(sql)) cache.set(sql, db.prepare(sql)); return cache.get(sql); };
  return {
    raw: db,
    get: (sql, ...args) => stmt(sql).get(...args),
    all: (sql, ...args) => stmt(sql).all(...args),
    run: (sql, ...args) => stmt(sql).run(...args),
    tx(fn) { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } },
    close: () => db.close()
  };
}

const json = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

module.exports = { open, json };
