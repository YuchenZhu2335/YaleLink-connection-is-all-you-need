-- 003 验证码记录"这次是不是用户主动要求发到耶鲁邮箱"：
-- "改发到耶鲁邮箱"可以不等 60 秒，但只看上一次是不是默认请求，不看它实际发到了哪里（否则能用来试探某个邮箱有没有注册）
ALTER TABLE login_codes ADD COLUMN forced_yale INTEGER NOT NULL DEFAULT 0;
