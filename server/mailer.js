/* 发信：模板 + 发送 + 记录。
   MAIL_DRIVER=console：本地开发，邮件打印到终端，并可在 /api/dev/outbox 查看（验证码就在里面）；
   MAIL_DRIVER=resend：真实发送（Resend 的 HTTP 接口，零依赖）。以后加国内通道，只在 drivers 里加一个。
   收件人：通知类邮件发到已验证的联系邮箱，没验证就发到耶鲁邮箱。每封可关闭的邮件都带退订链接。 */
const crypto = require("node:crypto");

const OPTIONAL = ["invite_digest", "reminder", "weekly", "event"]; // 可在"我的"里关闭的类型

function createMailer(ctx) {
  const outbox = []; // 仅 console 驱动：最近 50 封
  const drivers = {
    async console(msg) {
      outbox.unshift(Object.assign({ at: new Date().toISOString() }, msg));
      outbox.length = Math.min(outbox.length, 50);
      if (!ctx.quiet) console.log(`\n📧 [${msg.kind}] → ${msg.to}\n   ${msg.subject}\n${msg.text.split("\n").map((l) => "   " + l).join("\n")}\n`);
    },
    async resend(msg) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + ctx.cfg.resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from: ctx.cfg.mailFrom, to: [msg.to], subject: msg.subject, text: msg.text, headers: msg.unsubscribe ? { "List-Unsubscribe": "<" + msg.unsubscribe + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined }),
        signal: AbortSignal.timeout(10000) // 发信服务卡住时最多等 10 秒
      });
      if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 200));
    }
  };

  const sign = (userId, kind) => crypto.createHmac("sha256", ctx.cfg.secret).update(userId + ":" + kind).digest("base64url").slice(0, 32);
  const unsubscribeUrl = (userId, kind) => `${ctx.cfg.publicUrl}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&k=${kind}&s=${sign(userId, kind)}`;
  const verifyUnsubscribe = (userId, kind, s) => OPTIONAL.includes(kind) && typeof s === "string" && /^[A-Za-z0-9_-]{32}$/.test(s) && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(userId, kind)));
  const link = (hash) => ctx.cfg.publicUrl + "/#/" + hash;
  const recipient = (u) => (u.contact_email && u.contact_verified_at ? u.contact_email : u.login_email);
  // 约定时间：纽约时间 + 北京时间（一半同学在国内）
  function when(round, slot) {
    const at = new Date(ctx.coffee.slotStart(round, slot));
    const f = (tz, loc) => at.toLocaleString(loc, { timeZone: tz, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return { zh: `${f(round.timezone, "zh-CN")}（纽约）/ 北京时间 ${f("Asia/Shanghai", "zh-CN")}`, en: `${f(round.timezone, "en-US")} New York / ${f("Asia/Shanghai", "en-US")} Beijing` };
  }

  // 模板：中文在前、英文在后；正文只放必要信息和一个链接，不放对方的联系方式
  const T = {
    login_code: (d) => ({ subject: `Yalelux 登录验证码 ${d.code} / Your sign-in code`, text: `你的验证码是 ${d.code}，10 分钟内有效。不是你本人操作请忽略。\n\nYour sign-in code is ${d.code}. It expires in 10 minutes.` }),
    contact_code: (d) => ({ subject: `确认你的联系邮箱 ${d.code} / Confirm your contact email`, text: `把这个验证码填回 Yalelux，以后的通知会发到这个邮箱：${d.code}（10 分钟内有效）\n\nEnter this code on Yalelux to receive notifications here: ${d.code}` }),
    match: (d) => ({ subject: `☕ 你和 ${d.name} 匹配成功 / It's a match`, text: `你和 ${d.name} 都想认识对方。打开网站查看 TA 的联系方式和你们共同的空闲时间：\n${link("coffee/matches")}\n\nYou and ${d.name} both want to meet. See their contact and your shared free times:\n${link("coffee/matches")}` }),
    scheduled: (d) => ({ subject: `🗓 ${d.name} 约了 ${d.when.zh} / Time set`, text: `${d.name} 选了你们都有空的时间：${d.when.zh}。\n${link("coffee/matches")}\n\n${d.name} picked a time you're both free: ${d.when.en}.` }),
    invite_digest: (d) => ({ subject: `👋 有 ${d.n} 位同学想认识你 / ${d.n} people want to meet you`, text: `${d.names} 想和你喝杯咖啡。点"想认识"就匹配成功，点"跳过"对方不会收到通知：\n${link("coffee/inbox")}\n\n${d.n} people would like to meet you. Accept to match; skipping is silent:\n${link("coffee/inbox")}` }),
    reminder: (d) => ({ subject: `⏰ 提醒：和 ${d.name} 的 coffee chat / Reminder`, text: `别忘了：${d.when.zh}，和 ${d.name} 的 coffee chat。\n${link("coffee/matches")}\n\nReminder: coffee chat with ${d.name} — ${d.when.en}.` }),
    weekly: () => ({ subject: "☕ 新一周的 coffee chat 开始了 / A new week of coffee chats", text: `勾几个这周有空的时间，看看系统给你推荐了谁：\n${link("coffee")}\n\nPick a few free times this week and see who we suggest:\n${link("coffee")}` }),
    event: (d) => ({ subject: `🎉 ${d.title.zh} / ${d.title.en}`, text: `${d.title.zh} 开始了！\n${link("coffee")}\n\n${d.title.en} has started!\n${link("coffee")}` })
  };

  // 发一封：检查偏好 → 渲染 → 发送 → 记录。发送失败不抛错，只记录并返回 false（调用方决定要不要重试）
  // ref：同一件事的标识（如 "event:<轮次 id>"），配合 sendOnce 防止重复发送
  async function send(kind, user, data, toOverride, ref) {
    const prefs = ctx.json(user && user.prefs, {});
    const to = toOverride || recipient(user);
    const tpl = (T[kind] || T[kind.replace(/_.*/, "")])(data || {});
    if (OPTIONAL.includes(kind) && prefs[kind] === false) {
      ctx.db.run("INSERT INTO emails (user_id, to_addr, kind, subject, status, ref, created_at) VALUES (?, ?, ?, ?, 'skipped', ?, ?)", user && user.id, to, kind, kind, ref || null, new Date().toISOString());
      return false;
    }
    const unsubscribe = OPTIONAL.includes(kind) && user ? unsubscribeUrl(user.id, kind) : null;
    const text = tpl.text + `\n\n——\nYalelux · Where Yale's light connects resources and ideas\n${ctx.cfg.publicUrl}` + (unsubscribe ? `\n不想再收这类邮件 / Unsubscribe: ${unsubscribe}` : "");
    let status = "sent", error = null;
    try { await drivers[ctx.cfg.mailDriver]({ kind, to, subject: tpl.subject, text, unsubscribe }); }
    catch (e) { status = "failed"; error = String(e.message || e).slice(0, 300); console.error("mail failed:", error); }
    // 记录里不存标题（标题里有对方名字或验证码），只存类型
    ctx.db.run("INSERT INTO emails (user_id, to_addr, kind, subject, status, error, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", user && user.id, to, kind, kind, status, error, ref || null, new Date().toISOString());
    return status === "sent";
  }
  // 同一件事只发一次：已经成功发过（或用户关闭了这类邮件）就跳过；失败的下次定时任务会重试，最多 3 次
  async function sendOnce(kind, user, data, ref) {
    const done = ctx.db.get("SELECT COUNT(*) n FROM emails WHERE user_id = ? AND kind = ? AND ref = ? AND status IN ('sent', 'skipped')", user.id, kind, ref).n;
    if (done) return true;
    if (ctx.db.get("SELECT COUNT(*) n FROM emails WHERE user_id = ? AND kind = ? AND ref = ? AND status = 'failed'", user.id, kind, ref).n >= 3) return true;
    const ok = await send(kind, user, data, null, ref);
    return ok || (OPTIONAL.includes(kind) && ctx.json(user.prefs, {})[kind] === false); // 用户关掉了这类邮件也算"处理完了"
  }

  if (!drivers[ctx.cfg.mailDriver]) throw new Error("unknown MAIL_DRIVER " + ctx.cfg.mailDriver);
  return { send, sendOnce, outbox, verifyUnsubscribe, recipient, when, OPTIONAL };
}

module.exports = { createMailer };
