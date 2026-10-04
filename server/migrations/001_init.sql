-- 001 初始表结构。上线后只加新的迁移文件，不改旧文件。
-- 时间一律存 ISO 8601 UTC 字符串；JSON 字段存文本。

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  login_email         TEXT NOT NULL UNIQUE,      -- 耶鲁邮箱：身份与登录
  contact_email       TEXT,                      -- 常用联系邮箱：收通知
  contact_verified_at TEXT,                      -- 验证前通知发到耶鲁邮箱
  yale_verified_at    TEXT NOT NULL,             -- 最近一次通过耶鲁邮箱验证
  consent_version     TEXT,
  consent_at          TEXT,
  name                TEXT,
  identity            TEXT,                      -- student | alumni
  stage               TEXT,
  grad_year           INTEGER,
  job                 TEXT,
  city                TEXT,
  contact_method      TEXT,                      -- 匹配后才给对方看
  answers             TEXT NOT NULL DEFAULT '{}',
  prefs               TEXT NOT NULL DEFAULT '{}',
  smart_rec           INTEGER NOT NULL DEFAULT 1, -- 0 = 不参与智能推荐（不把资料发给大模型）
  profile_done_at     TEXT,
  last_digest_at      TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE login_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose    TEXT NOT NULL,                      -- login | contact
  user_key   TEXT NOT NULL,                      -- login: 耶鲁邮箱；contact: 用户 id
  target     TEXT NOT NULL,                      -- 验证码发到的地址
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  ip         TEXT
);
CREATE INDEX login_codes_key ON login_codes (purpose, user_key, created_at);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                 -- 会话令牌的 SHA-256，令牌本身只在 Cookie 里
  user_id      TEXT NOT NULL,
  via          TEXT NOT NULL,                    -- yale | contact：这次登录的验证码发到了哪里
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL,
  actor  TEXT,
  op     TEXT NOT NULL,
  target TEXT,
  ok     INTEGER NOT NULL,
  code   TEXT
);

CREATE TABLE rounds (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                    -- weekly | event
  status       TEXT NOT NULL,                    -- draft | published
  title        TEXT NOT NULL DEFAULT '{}',       -- {zh, en}
  theme_tags   TEXT NOT NULL DEFAULT '[]',
  config       TEXT NOT NULL DEFAULT '{}',       -- 时区、每天时段、推荐数等
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  post         TEXT NOT NULL DEFAULT '{}',       -- 活动页帖子 {title, body, wechat}
  announced_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE participations (
  round_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  slots      TEXT NOT NULL DEFAULT '[]',
  joined_at  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (round_id, user_id)
);

CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  round_id     TEXT NOT NULL,
  from_id      TEXT NOT NULL,
  to_id        TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL,                    -- rec | browse
  status       TEXT NOT NULL,                    -- pending | accepted | skipped（expired 读取时计算）
  created_at   TEXT NOT NULL,
  responded_at TEXT,
  slot         TEXT,
  scheduled_by TEXT,
  scheduled_at TEXT,
  outcomes     TEXT NOT NULL DEFAULT '{}',
  reminded_at  TEXT,
  UNIQUE (round_id, from_id, to_id)
);

CREATE TABLE recommendations (
  round_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  engine     TEXT NOT NULL,                      -- rules | deepseek | rules_fallback
  items      TEXT NOT NULL,                      -- [{id, reasons}]
  candidates TEXT NOT NULL,                      -- 规则阶段的候选，便于审计
  dismissed  TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY (round_id, user_id)
);

CREATE TABLE emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  to_addr    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL,                      -- sent | failed | skipped
  error      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
