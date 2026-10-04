-- 002 发信记录加 ref：同一件事（某次活动通知、某场约定的提醒）每人只发一次，失败可重试
ALTER TABLE emails ADD COLUMN ref TEXT;
CREATE INDEX emails_ref ON emails (user_id, kind, ref);
CREATE INDEX participations_round ON participations (round_id, updated_at);
CREATE INDEX invites_round ON invites (round_id);
