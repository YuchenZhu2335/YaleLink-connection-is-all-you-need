// 端到端测试：真的起后端（tests/e2e-server.js：临时数据库 + 24 位虚构演示同学 + 管理员 admin@yale.edu），
// 在浏览器里走完上线版的几条主线。验证码从 /api/dev/outbox 读（本地发信驱动不真的发邮件）。测试名就是验收标准。
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

// 这个页面里不应出现任何脚本错误
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
// 最新一封发到 to 的邮件里的 6 位验证码
async function codeFor(request, to) {
  for (let i = 0; i < 20; i++) {
    const r = await (await request.get("/api/dev/outbox")).json();
    const m = r.data.find((x) => x.to === to);
    if (m) return /(\d{6})/.exec(m.subject)[1];
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error("no code for " + to);
}
async function signIn(page, email, codeTo) {
  await page.goto("/#/login");
  await page.fill("#login-email", email);
  await page.locator('[data-form="email"] button[type="submit"]').click();
  await expect(page.locator("#login-code")).toBeVisible();
  await page.fill("#login-code", await codeFor(page.request, codeTo || email)); // 填满 6 位自动提交
  await expect(page).not.toHaveURL(/#\/login/);
}
// 首次填写：同意 → 联系邮箱（验证）→ 资料。
// o.guest：嘉宾（登录邮箱就是 @example.com 的常用邮箱：联系邮箱和登录邮箱相同，不再发验证码；身份选"嘉宾"，填工作和城市）
// o.fill(page)：提交前再填点别的（RFC 0003 的选填项等）
async function onboard(page, email, name, o) {
  o = o || {};
  await expect(page).toHaveURL(/#\/profile\/setup/);
  const agree = page.locator('input[name="agree"]');
  await expect(agree).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(async () => { await agree.check(); await expect(agree).toBeChecked(); }).toPass();
  await page.locator('[data-step] button[type="submit"]').click();
  const contact = email.replace(/@.*/, "@example.com");
  await expect(page.locator("#cw-email")).toBeVisible();
  await page.fill("#cw-email", contact);
  await page.locator('[data-step] button[type="submit"]').first().click();
  if (contact !== email) {
    await expect(page.locator("#cw-code")).toBeVisible();
    await page.fill("#cw-code", await codeFor(page.request, contact)); // 填满 6 位自动提交
  }
  await expect(page.locator("[data-profile-form]")).toBeVisible();
  await page.fill("#pf-name", name);
  if (o.guest) {
    await page.locator('input[name="identity"][value="guest"]').check({ force: true });
    await page.fill("#pf-job", "Visiting scholar");
    await page.fill("#pf-city", "New Haven");
  } else {
    await page.locator('input[name="identity"][value="student"]').check({ force: true });
    await page.locator('input[name="stage"][value="master"]').check({ force: true });
    await page.selectOption("#pf-gradYear", { index: 2 });
    await page.fill("#pf-program", "Master of Environmental Management");
  }
  await page.locator('input[name="meetMode"][value="online"]').check({ force: true });
  await page.locator('input[name="q_goals"][value="industry"]').check({ force: true });
  await page.locator('input[name="q_interests"][value="hiking"]').check({ force: true });
  await page.locator('input[name="q_interests"][value="coffee"]').check({ force: true });
  await page.locator('input[name="q_field"][value="tech"]').check({ force: true });
  await page.fill("#pf-contactMethod", "微信 e2e-" + name);
  if (o.fill) await o.fill(page);
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/coffee/);
}
// 一个最小的 PDF（开头是 %PDF-，后端只认这个）
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const meOf = async (page) => (await (await page.request.get("/api/me")).json()).data;
// 选几个还能约的时间并保存（= 参加这一轮）
async function joinRound(page) {
  await page.goto("/#/coffee/times");
  const open = page.locator('[data-act="slot"]:not([disabled]):not([aria-disabled="true"])');
  await expect(open.first()).toBeVisible();
  for (let i = 0; i < 4; i++) await open.nth(i).click();
  await page.locator('[data-act="save"]').click();
  await expect(page.locator(".toast")).toBeVisible();
}

test("未登录：首页与活动页能看，语言能切换，没有脚本错误", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".hero")).toBeVisible();
  await expect(page.locator("#topbar .wordmark")).toBeVisible();
  await page.click("#lang-toggle");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.click("#lang-toggle");
  await page.goto("/#/events");
  await page.goto("/#/about/privacy");
  await expect(page.locator("main")).toContainText("DeepSeek");
  await page.goto("/#/coffee");
  await expect(page).toHaveURL(/#\/login\?next=coffee/, "没登录访问约咖啡会被带到登录页");
  expect(errors).toEqual([]);
});

test("登录：非耶鲁邮箱被拒；新同学走完首次填写，选时间后看到推荐", async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await page.goto("/#/login");
  await page.fill("#login-email", "someone@gmail.com");
  await page.locator('[data-form="email"] button[type="submit"]').click();
  await expect(page.locator(".field__error")).toBeVisible();
  // 普通请求之后，"重新发送"要等倒计时，"改发到耶鲁邮箱"可以马上点一次
  await page.fill("#login-email", "e2e.new@yale.edu");
  await page.locator('[data-form="email"] button[type="submit"]').click();
  await expect(page.locator('[data-act="resend"]')).toBeDisabled();
  await page.locator('[data-act="use-yale"]').click();
  await expect(page.locator(".notice--success")).toBeVisible();
  await expect(page.locator('[data-act="use-yale"]')).toHaveCount(0);
  await page.fill("#login-code", await codeFor(page.request, "e2e.new@yale.edu"));
  await expect(page).not.toHaveURL(/#\/login/);
  await onboard(page, "e2e.new@yale.edu", "新同学");
  await joinRound(page);
  await page.goto("/#/coffee");
  await expect(page.locator('[data-act="invite"]').first()).toBeVisible(); // 演示数据 24 人 > 门槛 20：有推荐
  await page.goto("/#/coffee/browse");
  await expect(page.locator(".person").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("双向确认：A 想认识 demo01 → demo01 在收件箱点想认识 → 双方看到联系方式，并约好时间", async ({ browser }) => {
  test.setTimeout(120000);
  const a = await browser.newPage();
  const errors = watchErrors(a);
  await signIn(a, "e2e.a@yale.edu");
  await onboard(a, "e2e.a@yale.edu", "甲同学");
  await joinRound(a);
  await a.goto("/#/coffee/browse");
  const card = a.locator('[data-person="u-demo01"]');
  await expect(card).toBeVisible();
  await card.locator('[data-act="invite"]').click();
  await a.fill("#coffee-note", "你好，想聊聊求职");
  await a.locator('#modal button[type="submit"]').click();
  await expect(a.locator("#modal")).toHaveCount(0);

  const b = await browser.newPage();
  watchErrors(b);
  await signIn(b, "demo01@demo.yale.edu", "demo1@example.com"); // 演示同学验证过联系邮箱：验证码发到那里
  await b.goto("/#/coffee/inbox");
  await expect(b.locator("main")).toContainText("你好，想聊聊求职");
  await b.locator('[data-act="accept"]').first().click();
  await b.goto("/#/coffee/matches");
  await expect(b.locator(".contact").first()).toContainText("微信 e2e-甲同学");
  const slot = b.locator('[data-act="schedule"]').first();
  if (await slot.count()) {
    await slot.click();
    await expect(b.locator(".toast")).toBeVisible();
  }
  await a.goto("/#/coffee/matches");
  await expect(a.locator(".contact").first()).toContainText("demo-1");
  expect(errors).toEqual([]);
});

test("资料：首次填写里的英文名、学段、项目、见面方式、地点和留言都保存下来，「我的」卡片上能看到", async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await signIn(page, "e2e.fields@yale.edu");
  await onboard(page, "e2e.fields@yale.edu", "王五", {
    async fill(p) {
      await p.fill("#pf-preferredName", "Wu");
      // 博士后不要求毕业年份：选了之后毕业年份藏起来，不提交
      await p.locator('input[name="stage"][value="postdoc"]').check({ force: true });
      await expect(p.locator("#pf-gradYear")).toBeHidden();
      await p.locator('input[name="meetMode"][value="newhaven"]').check({ force: true });
      await p.fill("#pf-meetPlace", "Bluebook Café（虚构示例）");
      await p.fill("#pf-freeText", "第一行\n\n第二行：想认识做气候的同学。");
      await expect(p.locator('[data-count-for="freeText"]')).toContainText("/ 500");
    }
  });
  const me = await meOf(page);
  expect(me).toMatchObject({ preferredName: "Wu", stage: "postdoc", gradYear: null, program: "Master of Environmental Management", meetMode: "newhaven", meetPlace: "Bluebook Café（虚构示例）", freeText: "第一行\n\n第二行：想认识做气候的同学。", role: "member", isGuest: false, resume: null });
  await page.goto("/#/profile");
  const card = page.locator("[data-me] article.person");
  await expect(card.locator(".person__name")).toContainText("王五 · Wu");
  await expect(card.locator(".person__meta")).toContainText("Master of Environmental Management");
  await expect(card.locator(".tag--meet")).toContainText("纽黑文线下");
  await expect(card.locator(".person__text")).toContainText("第二行：想认识做气候的同学。");
  await expect(card).toContainText("Bluebook Café（虚构示例）");
  await expect(card.locator(".pill--mentor")).toHaveCount(0);
  // 没填见面方式不能保存（必填）
  await page.goto("/#/profile/edit");
  await page.locator("[data-profile-form]").evaluate((f) => f.querySelectorAll('input[name="meetMode"]').forEach((x) => { x.checked = false; }));
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page.locator('[data-field="meetMode"] .field__error')).toBeVisible();
  expect(errors).toEqual([]);
});

test("简历：上传 PDF、选谁能看；被邀请的人能打开，同一轮的其他人要等改成「所有人」", async ({ browser }) => {
  test.setTimeout(120000);
  const a = await browser.newPage();
  const errors = watchErrors(a);
  await signIn(a, "e2e.cv@yale.edu");
  await onboard(a, "e2e.cv@yale.edu", "简历同学");
  await joinRound(a);
  const id = (await meOf(a)).id;
  await a.goto("/#/profile/edit?focus=resume");
  const box = a.locator("[data-resume]");
  // 不是 PDF：在浏览器里就拦下，说清楚
  await box.locator("[data-resume-file]").setInputFiles({ name: "cv.txt", mimeType: "text/plain", buffer: Buffer.from("not a pdf") });
  await expect(box.locator(".field__error")).toContainText("PDF");
  await box.locator("[data-resume-file]").setInputFiles({ name: "我的简历.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(box.locator(".filebox__name")).toHaveText("resume.pdf");
  await expect(box.locator('input[name="resumeVisibility"][value="invited"]')).toBeChecked(); // 默认只给我邀请的人
  expect((await a.request.get("/api/me/resume")).status()).toBe(200);
  // 邀请 demo08
  await a.goto("/#/coffee/p/u-demo08");
  await a.locator('[data-act="invite"]').first().click();
  await a.locator('#modal button[type="submit"]').click();
  await expect(a.locator("#modal")).toHaveCount(0);

  const b = await browser.newPage(); // 被邀请的人
  watchErrors(b);
  await signIn(b, "demo08@demo.yale.edu", "demo8@example.com");
  await b.goto("/#/coffee/inbox");
  await expect(b.locator(`[data-person="${id}"] a[href$="/coffee/people/${id}/resume"]`)).toBeVisible();
  const ok = await b.request.get(`/api/coffee/people/${id}/resume`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("application/pdf");

  const c = await browser.newPage(); // 同一轮、但没被邀请
  watchErrors(c);
  await signIn(c, "demo09@demo.yale.edu", "demo9@example.com");
  expect((await c.request.get(`/api/coffee/people/${id}/resume`)).status()).toBe(404);
  await c.goto(`/#/coffee/p/${id}`);
  await expect(c.locator("[data-person] h1")).toContainText("简历同学");
  await expect(c.locator('a[href$="/resume"]')).toHaveCount(0);

  // 改成"所有能看到我资料的人"
  await a.goto("/#/profile/edit?focus=resume");
  await a.locator('input[name="resumeVisibility"][value="all"]').check({ force: true });
  await expect.poll(async () => ((await meOf(a)).resume || {}).visibility).toBe("all");
  expect((await c.request.get(`/api/coffee/people/${id}/resume`)).status()).toBe(200);
  // 删除：确认后文件没了
  await a.locator('[data-resume-act="delete"]').click();
  await a.locator('#modal [data-act="yes"]').click();
  await expect(a.locator("[data-resume] .filebox--empty")).toBeVisible();
  expect((await b.request.get(`/api/coffee/people/${id}/resume`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("导师：卡片上有「导师」标记，找人可以只看导师", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, "demo10@demo.yale.edu", "demo10@example.com");
  await page.goto("/#/coffee/browse");
  await expect(page.locator(".person").first()).toBeVisible();
  await expect(page.locator('[data-person="u-demo02"] .pill--mentor')).toBeVisible(); // 演示数据：demo02、demo11 是导师
  await page.locator('[data-act="mentor"]').click();
  await expect(page).toHaveURL(/mentor=1/);
  await expect(page.locator('[data-act="mentor"]')).toHaveAttribute("aria-pressed", "true");
  const cards = page.locator("[data-person]");
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  await expect(page.locator("[data-person] .pill--mentor")).toHaveCount(n);
  await expect(page.locator('[data-person="u-demo11"]')).toBeVisible();
  await page.goto("/#/coffee/p/u-demo02");
  await expect(page.locator("[data-person] .person__title .pill--mentor")).toBeVisible();
  expect(errors).toEqual([]);
});

// 放在"管理员"之前：那条会发布一个今天开始的活动轮，之后演示同学就不在当前轮里了
test("见到了吗：回答之后还能改", async ({ browser }) => {
  test.setTimeout(120000);
  const a = await browser.newPage();
  await signIn(a, "demo05@demo.yale.edu", "demo5@example.com");
  await a.goto("/#/coffee/p/u-demo06");
  await a.locator('[data-act="invite"]').first().click();
  await a.locator('#modal button[type="submit"]').click();
  await expect(a.locator("#modal")).toHaveCount(0);
  const b = await browser.newPage();
  const errors = watchErrors(b);
  await signIn(b, "demo06@demo.yale.edu", "demo6@example.com");
  await b.goto("/#/coffee/inbox");
  await b.locator('[data-act="accept"]').first().click();
  await b.goto("/#/coffee/matches");
  const card = b.locator("[data-match]").first();
  await card.locator('[data-act="outcome"][data-met="1"]').click(); // 没约时间："我们聊过了"
  await expect(card.locator(".notice--success")).toContainText("见到了");
  await card.locator('.notice--success [data-act="outcome"]').click(); // "其实还没聊"
  await expect(card.locator(".notice--success")).toHaveCount(0);
  await expect(card.locator('.btn[data-act="outcome"][data-met="1"]')).toBeVisible();
  // 撤回之后再约时间：不能变成"没见到 · 已记录"（之前的回答已撤回，约新时间也会清空）
  const slot = card.locator('[data-act="schedule"]').first();
  if (await slot.count()) {
    await slot.click();
    // 约定后的"已约定"摘要（收起的"改时间"面板里也有一个选中的按钮，所以只认摘要这个 span）
    await expect(card.locator("span.time.is-selected")).toBeVisible();
    await expect(card.locator(".notice--info, .notice--success")).toHaveCount(0);
    await expect(card).not.toContainText("谢谢告诉我们");
  }
  expect(errors).toEqual([]);
});

// 管理员第一次登录（验证码发到耶鲁邮箱）的会话：后面"嘉宾"那条接着用（再登录的话验证码会发到联系邮箱，那样的会话进不了后台）
let adminState = null;
test("管理员：完成首次填写后进后台，发布活动轮，活动页不登录也能看到", async ({ page, browser }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await signIn(page, "admin@yale.edu");
  await onboard(page, "admin@yale.edu", "管理员");
  adminState = await page.context().storageState();
  await page.goto("/#/admin");
  await expect(page.locator(".stats").first()).toBeVisible();
  await page.goto("/#/admin/rounds/new");
  await page.fill("#ar-title-zh", "Coffee Chat 月");
  await page.fill("#ar-title-en", "Coffee Chat Month");
  const today = new Date(), later = new Date(Date.now() + 10 * 86400000);
  await page.fill("#ar-start", today.toISOString().slice(0, 10));
  await page.fill("#ar-end", later.toISOString().slice(0, 10));
  await page.fill("#ar-body", "一个月里，每周都能约到新朋友。");
  await page.fill("#ar-wechat", "【Coffee Chat 月】来认识同路的耶鲁人");
  await page.locator('[data-status="published"]').click();
  const ok = page.locator('#modal [data-act="yes"]');
  if (await ok.count()) await ok.click();
  await expect(page).toHaveURL(/#\/admin\/rounds/);
  const anon = await browser.newPage();
  await anon.goto("/#/events");
  await expect(anon.locator("main")).toContainText("Coffee Chat 月");
  expect(errors).toEqual([]);
});

test("嘉宾：组织者在后台登记邮箱后，嘉宾能用它登录并选「嘉宾」；导师也在后台标记", async ({ browser }) => {
  test.setTimeout(120000);
  expect(adminState, "需要先跑「管理员」那条（同一个文件里按顺序执行）").toBeTruthy();
  const adminCtx = await browser.newContext({ storageState: adminState });
  const admin = await adminCtx.newPage();
  const errors = watchErrors(admin);
  await admin.goto("/#/admin/members");
  await admin.fill("#am-guest-email", "guest.e2e@example.com");
  await admin.fill("#am-guest-note", "创新学者（示例）");
  await admin.locator('[data-members-form="guest"] button[type="submit"]').click();
  await expect(admin.locator('[data-act="guest-del"][data-email="guest.e2e@example.com"]')).toBeVisible();
  await admin.fill("#am-mentor-email", "demo12@demo.yale.edu");
  await admin.locator('[data-members-form="mentor"] button[type="submit"]').click();
  await expect(admin.locator('[data-act="mentor-off"][data-email="demo12@demo.yale.edu"]')).toBeVisible();

  const g = await browser.newPage();
  watchErrors(g);
  await g.goto("/#/login");
  await expect(g.locator("#login-email-guest")).toBeVisible(); // 登录页说明：受邀嘉宾用组织者登记过的邮箱
  await g.fill("#login-email", "guest.e2e@example.com");
  await g.locator('[data-form="email"] button[type="submit"]').click();
  await g.fill("#login-code", await codeFor(g.request, "guest.e2e@example.com"));
  await onboard(g, "guest.e2e@example.com", "访问学者", { guest: true });
  expect(await meOf(g)).toMatchObject({ identity: "guest", isGuest: true, contactVerified: true, contactEmail: "guest.e2e@example.com" });
  await g.goto("/#/profile");
  await expect(g.locator("[data-me] article.person .person__meta")).toContainText("Visiting scholar");

  // 删除登记（先确认）：之后这个邮箱不能再请求验证码
  await admin.reload();
  await admin.locator('[data-act="guest-del"][data-email="guest.e2e@example.com"]').click();
  await admin.locator('#modal [data-act="yes"]').click();
  await expect(admin.locator('[data-act="guest-del"][data-email="guest.e2e@example.com"]')).toHaveCount(0);
  const r = await g.request.post("/api/auth/request-code", { data: { email: "guest.e2e@example.com" } });
  expect(r.status()).toBe(400);
  expect(errors).toEqual([]);
  await adminCtx.close();
});

test("意见箱：新同学只需先同意隐私说明（不用填资料）就回到意见箱，可以提交举报", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/#/about/feedback");
  await page.locator('a[href="#/login?next=about/feedback"]').click();
  await page.fill("#login-email", "e2e.fb@yale.edu");
  await page.locator('[data-form="email"] button[type="submit"]').click();
  await page.fill("#login-code", await codeFor(page.request, "e2e.fb@yale.edu"));
  await expect(page).toHaveURL(/#\/profile\/setup\?only=consent&next=about%2Ffeedback/, "没同意当前版本的隐私说明：先去同意页");
  await expect(page.locator(".steps")).toHaveCount(0);
  await page.locator('input[name="agree"]').check();
  await page.locator('[data-consent] button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/about\/feedback$/, "同意后回到意见箱，不要求联系邮箱和资料");
  await page.locator('input[name="kind"][value="report"]').check({ force: true });
  await expect(page.locator("#fb-hint")).toContainText("对方的名字");
  await page.fill("#fb-text", "某一周匹配的同学多次发骚扰信息。可以用 wx-e2e 联系我。");
  await page.locator('[data-fb-form] button[type="submit"]').click();
  await expect(page.locator("[data-about] .notice--success")).toContainText("值班的同学");
  await page.goto("/#/coffee");
  await expect(page).toHaveURL(/#\/profile\/setup\?next=coffee/, "约咖啡照样要先补完联系邮箱和资料");
  expect(errors).toEqual([]);
});

test("用联系邮箱登录：改联系方式、注销要先用耶鲁邮箱重新登录", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, "demo07@demo.yale.edu", "demo7@example.com"); // 验证码发到联系邮箱 = 这次是联系邮箱登录
  await page.goto("/#/profile/edit");
  await expect(page.locator("#pf-contactMethod-yale")).toBeVisible();
  await page.fill("#pf-contactMethod", "微信 e2e-changed");
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page.locator('[data-profile-form] [data-act="relogin"]')).toBeVisible();
  await page.goto("/#/profile");
  await page.locator('[data-act="delete"]').click();
  await expect(page.locator('#modal [data-act="relogin"]')).toBeVisible();
  await expect(page.locator("#del-confirm")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("截图：手机与电脑", async ({ browser }) => {
  test.setTimeout(240000);
  for (const [name, viewport, isMobile, n] of [["mobile", { width: 390, height: 844 }, true, 2], ["desktop", { width: 1280, height: 860 }, false, 3]]) {
    const ctx = await browser.newContext({ viewport, isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.screenshot({ path: path.join(SHOTS, `${name}-home.png`), fullPage: true });
    await signIn(page, `demo0${n}@demo.yale.edu`, `demo${n}@example.com`);
    for (const r of ["coffee", "coffee/browse", "coffee/times", "coffee/inbox", "coffee/matches", "profile", "events"]) {
      await page.goto("/#/" + r);
      await page.waitForFunction(() => !document.querySelector("#main .loading"));
      await page.addStyleTag({ content: "#toast{display:none!important}*{transition:none!important}" });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${r.replace(/\//g, "-")}.png`), fullPage: true });
    }
    await ctx.close();
  }
});
