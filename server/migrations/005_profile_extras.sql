-- 005 资料补全（RFC 0003）：原始报名表的字段、自由留言、简历、导师标记、嘉宾邮箱。
-- 只加列和新表，老数据库直接升级：已有用户的新列为空，简历默认只给"我邀请的人"看，角色默认普通成员。
ALTER TABLE users ADD COLUMN preferred_name TEXT;                                -- 英文名 / 常用称呼（选填）
ALTER TABLE users ADD COLUMN program TEXT;                                       -- 项目 / 研究方向（在读才有）
ALTER TABLE users ADD COLUMN meet_mode TEXT;                                     -- online | newhaven | either（公开在卡片上）
ALTER TABLE users ADD COLUMN meet_place TEXT;                                    -- 具体地点（选填，匹配后才给对方看）
ALTER TABLE users ADD COLUMN free_text TEXT;                                     -- 还有什么想说的（选填，可换行）
ALTER TABLE users ADD COLUMN resume_file TEXT;                                   -- DATA_DIR/resumes/ 里的随机文件名；没有简历为 NULL
ALTER TABLE users ADD COLUMN resume_size INTEGER;
ALTER TABLE users ADD COLUMN resume_at TEXT;
ALTER TABLE users ADD COLUMN resume_visibility TEXT NOT NULL DEFAULT 'invited';  -- invited | all
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';                -- member | mentor（管理员在后台标记）

-- 嘉宾邮箱：管理员登记的非耶鲁邮箱，可以像耶鲁邮箱一样收验证码登录。删除登记后不能再建立新会话（已有账号保留）
CREATE TABLE guest_emails (
  email      TEXT PRIMARY KEY,                   -- 小写
  note       TEXT,                               -- 如"创新学者"
  added_by   TEXT,                               -- 登记的管理员的用户 id
  created_at TEXT NOT NULL
);
