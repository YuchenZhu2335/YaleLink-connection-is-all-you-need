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
// 首次填写：同意 → 联系邮箱（验证）→ 资料
async function onboard(page, email, name) {
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
  await expect(page.locator("#cw-code")).toBeVisible();
  await page.fill("#cw-code", await codeFor(page.request, contact)); // 填满 6 位自动提交
  await expect(page.locator("[data-profile-form]")).toBeVisible();
  await page.fill("#pf-name", name);
  await page.locator('input[name="identity"][value="student"]').check({ force: true });
  await page.locator('input[name="stage"][value="master"]').check({ force: true });
  await page.selectOption("#pf-gradYear", { index: 2 });
  await page.locator('input[name="q_goals"][value="industry"]').check({ force: true });
  await page.locator('input[name="q_interests"][value="hiking"]').check({ force: true });
  await page.locator('input[name="q_interests"][value="coffee"]').check({ force: true });
  await page.locator('input[name="q_field"][value="tech"]').check({ force: true });
  await page.fill("#pf-contactMethod", "微信 e2e-" + name);
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/coffee/);
}
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
    await expect(card.locator(".time.is-selected")).toBeVisible();
    await expect(card.locator(".notice--info, .notice--success")).toHaveCount(0);
    await expect(card).not.toContainText("谢谢告诉我们");
  }
  expect(errors).toEqual([]);
});

test("管理员：完成首次填写后进后台，发布活动轮，活动页不登录也能看到", async ({ page, browser }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await signIn(page, "admin@yale.edu");
  await onboard(page, "admin@yale.edu", "管理员");
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
