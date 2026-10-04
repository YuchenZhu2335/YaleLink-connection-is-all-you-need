-- 004 记访问（PRD 1.3 的 7 日回访）。不写在 sessions 上：会话在退出、退出所有设备、换 / 验证联系邮箱、过期时整行删除。
-- users.last_seen_at：最近一次带登录状态的请求（ISO 时间）；也用来判断"今天记过了没有"，同一天的后续请求不再写库。
-- user_visits：每人每个 UTC 日一行（有访问就有这一行）。只存最近一次访问算不出"注册后第 2–7 天回来过没有"，
--              所以按天另记一张表；注销时随用户一起删除。
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
CREATE TABLE user_visits (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,                         -- YYYY-MM-DD（UTC）
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
