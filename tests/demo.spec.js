// 演示版端到端测试：纯静态站点 + 浏览器里的假后端（demo/mock-server.js），挂在子目录下（模拟 GitHub Pages）。
// 运行：npm run test:demo（先构建 dist/yalelux-demo，再起 scripts/serve-static.mjs）。验证码永远是 000000。
// 每个测试是一个新的浏览器上下文 = 一份新的演示数据（localStorage 是空的）。截图写到 dist/shots/。
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.join(__dirname, "..", "dist", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const CODE = "000000";

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
const go = (page, hash) => page.goto("./" + (hash ? "#/" + hash : ""));
async function signIn(page, email) {
  await go(page, "login");
  await page.fill("#login-email", email);
  await page.locator('[data-form="email"] button[type="submit"]').click();
  await expect(page.locator("#login-code")).toBeVisible();
  await page.fill("#login-code", CODE); // 填满 6 位自动提交
  await expect(page).not.toHaveURL(/#\/login/);
}
// 首次填写：同意 → 联系邮箱（验证码 000000）→ 资料问卷
async function onboard(page, email, name) {
  await expect(page).toHaveURL(/#\/profile\/setup/);
  const agree = page.locator('input[name="agree"]');
  await expect(agree).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(async () => { await agree.check(); await expect(agree).toBeChecked(); }).toPass();
  await page.locator('[data-step] button[type="submit"]').click();
  await expect(page.locator("#cw-email")).toBeVisible();
  await page.fill("#cw-email", email.replace(/@.*/, "@example.com"));
  await page.locator('[data-step] button[type="submit"]').first().click();
  await expect(page.locator("#cw-code")).toBeVisible();
  await page.fill("#cw-code", CODE);
  await expect(page.locator("[data-profile-form]")).toBeVisible();
  await page.fill("#pf-name", name);
  await page.locator('input[name="identity"][value="student"]').check({ force: true });
  await page.locator('input[name="stage"][value="master"]').check({ force: true });
  await page.selectOption("#pf-gradYear", { index: 2 });
  await page.locator('input[name="q_goals"][value="industry"]').check({ force: true });
  await page.locator('input[name="q_interests"][value="hiking"]').check({ force: true });
  await page.locator('input[name="q_interests"][value="coffee"]').check({ force: true });
  await page.locator('input[name="q_field"][value="tech"]').check({ force: true });
  await page.fill("#pf-contactMethod", "微信 demo-" + name);
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/coffee/);
}
// 选 6 个还能约的时间并保存（= 参加这一轮）。时间表按天分页：今天晚了可能只剩一两个，就接着翻后面几天
async function joinRound(page) {
  await go(page, "coffee/times");
  const days = page.locator('[data-act="day"]:not([disabled])');
  await expect(days.first()).toBeVisible();
  const free = page.locator('[data-act="slot"][aria-pressed="false"]:not([disabled]):not([aria-disabled="true"])');
  let picked = 0;
  for (let d = 0, n = await days.count(); d < n && picked < 6; d++) {
    await days.nth(d).click();
    while (picked < 6 && (await free.count())) { await free.first().click(); picked++; }
  }
  expect(picked).toBeGreaterThan(0);
  await page.locator('[data-act="save"]').click();
  await expect(page).toHaveURL(/#\/coffee$/); // 第一次保存 = 参加本轮，自动回到约咖啡首页看推荐
}
async function newUser(page, email, name) {
  await signIn(page, email);
  await onboard(page, email, name);
  await joinRound(page);
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, `${label}: 页面不应横向滚动（scrollWidth ${o.sw} > ${o.cw}）`).toBeLessThanOrEqual(o.cw + 1);
}

test("未登录：首页、活动页、隐私说明能看；提示条在顶栏之上；没有脚本错误", async ({ page }) => {
  const errors = watchErrors(page);
  await go(page, "");
  await expect(page.locator(".hero")).toBeVisible();
  const banner = page.locator("#demo-banner");
  await expect(banner).toContainText("000000");
  await expect(banner).toContainText("admin@yale.edu");
  const [b, top] = await Promise.all([banner.boundingBox(), page.locator("#topbar").boundingBox()]);
  expect(b.y + b.height).toBeLessThanOrEqual(top.y + 1);
  await go(page, "events");
  await expect(page.locator("main")).toContainText("Coffee Chat 周 · 首发");
  await page.locator('main a[href^="#/events/"]').first().click();
  await expect(page.locator("main")).toContainText("Coffee Chat 周 · 首发");
  await go(page, "about/privacy");
  await expect(page.locator("main")).toContainText("DeepSeek");
  await go(page, "coffee");
  await expect(page).toHaveURL(/#\/login\?next=coffee/);
  await go(page, "login");
  await page.fill("#login-email", "someone@gmail.com");
  await page.locator('[data-form="email"] button[type="submit"]').click();
  await expect(page.locator(".field__error")).toBeVisible();
  expect(errors).toEqual([]);
});

test("新同学：000000 登录 → 同意 → 联系邮箱 → 问卷 → 选时间 → 看到推荐；邀请会接受的演示同学 → 匹配看到联系方式并约时间；接受收到的邀请", async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await newUser(page, "new.student@yale.edu", "新同学");

  // 推荐：演示同学 24 人 ≥ 门槛 20
  await go(page, "coffee");
  await expect(page.locator('[data-act="invite"]').first()).toBeVisible();

  // 第一次参加：两位演示同学发来了邀请
  const state = await page.evaluate(() => YLDemo.state());
  const meId = state.session.userId;
  const incomingFrom = state.invites.filter((i) => i.toId === meId).map((i) => i.fromId);
  expect(incomingFrom.length).toBe(2);

  // 在"找人"里挑一位会接受的演示同学
  await go(page, "coffee/browse");
  await expect(page.locator("[data-person]").first()).toBeVisible();
  const ids = await page.locator("[data-person]").evaluateAll((els) => els.map((e) => e.dataset.person));
  const target = await page.evaluate(([list, skip]) => list.find((id) => YLDemo.willAccept(id) && skip.indexOf(id) < 0), [ids, incomingFrom]);
  expect(target, "找人列表里应该有会接受邀请的演示同学").toBeTruthy();
  const name = state.users.find((u) => u.id === target).name;
  await page.locator(`[data-person="${target}"] [data-act="invite"]`).click();
  await page.fill("#coffee-note", "你好，想聊聊求职");
  await page.locator('#modal button[type="submit"]').click();
  await expect(page.locator("#modal")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText(name + " 接受了你的邀请", { timeout: 8000 }); // 约 3 秒后对方接受

  // 匹配：看到对方的联系方式，约一个共同空闲时间
  await go(page, "coffee/matches");
  const card = page.locator("[data-match]").first();
  await expect(card.locator(".contact")).toContainText("demo-");
  await expect(card).toContainText(name);
  await card.locator('[data-act="schedule"]').first().click();
  await expect(card.locator("span.time.is-selected")).toBeVisible();

  // 收件箱：接受一位演示同学的邀请
  await go(page, "coffee/inbox");
  await expect(page.locator('[data-act="accept"]').first()).toBeVisible();
  await page.locator('[data-act="accept"]').first().click();
  const myMatches = () => page.evaluate(() => { const s = YLDemo.state(), me = s.session.userId; return s.invites.filter((i) => i.status === "accepted" && (i.fromId === me || i.toId === me)).length; });
  await expect.poll(myMatches).toBe(2);
  await go(page, "coffee/matches");
  await expect(page.locator("[data-match]")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("管理员 admin@yale.edu：完成首次填写后看到非零的概览，发布活动轮，活动页能看到；邮件记录有内容", async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await signIn(page, "admin@yale.edu");
  await onboard(page, "admin@yale.edu", "管理员");
  await go(page, "admin");
  const first = page.locator(".stats .stat strong").first();
  await expect(first).toBeVisible();
  expect(Number((await first.innerText()).replace(/\D/g, ""))).toBeGreaterThan(20);
  await expect(page.locator("main")).toContainText("每周 Coffee Chat");

  await go(page, "admin/rounds/new");
  await page.fill("#ar-title-zh", "Coffee Chat 月");
  await page.fill("#ar-title-en", "Coffee Chat Month");
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await page.fill("#ar-start", d(60)); // 不和首发活动重叠
  await page.fill("#ar-end", d(70));
  await page.fill("#ar-body", "一个月里，每周都能约到新朋友。");
  await page.fill("#ar-wechat", "【Coffee Chat 月】来认识同路的耶鲁人");
  await page.locator('[data-status="published"]').click();
  const ok = page.locator('#modal [data-act="yes"]');
  if (await ok.count()) await ok.click();
  await expect(page).toHaveURL(/#\/admin\/rounds/);
  await expect(page.locator("main")).toContainText("Coffee Chat 月");

  await go(page, "admin/emails");
  await expect(page.locator("main table").first()).toBeVisible();
  await go(page, "events");
  await expect(page.locator("main")).toContainText("Coffee Chat 月");
  await expect(page.locator("main")).toContainText("Coffee Chat 周 · 首发");
  expect(errors).toEqual([]);
});

test("语言切换：界面和演示提示条都换成英文，再切回中文", async ({ page }) => {
  const errors = watchErrors(page);
  await go(page, "");
  await page.click("#lang-toggle");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#demo-banner")).toContainText("Demo");
  await expect(page.locator("[data-demo-reset]")).toHaveText("Reset");
  await page.click("#lang-toggle");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("[data-demo-reset]")).toHaveText("重置");
  expect(errors).toEqual([]);
});

test("重置：清空本地数据、退出登录、重新生成演示数据", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, "demo05@demo.yale.edu"); // 演示同学：资料已完整
  await expect(page).toHaveURL(/#\/coffee/);
  await page.evaluate(() => fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "idea", text: "重置之前写的一条意见" }) }));
  expect((await page.evaluate(() => YLDemo.state())).feedback.length).toBe(4);
  await Promise.all([page.waitForEvent("load"), page.click("[data-demo-reset]")]);
  await expect(page.locator(".topbar__login")).toBeVisible();
  const s = await page.evaluate(() => YLDemo.state());
  expect(s.session).toBeNull();
  expect(s.feedback.length).toBe(3);
  expect(s.users.length).toBe(24);
  expect(errors).toEqual([]);
});

test("手机 390×844 与电脑 1280×860：不横向滚动，并截图", async ({ browser }) => {
  test.setTimeout(180000);
  for (const [name, viewport, isMobile] of [["390", { width: 390, height: 844 }, true], ["1280", { width: 1280, height: 860 }, false]]) {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await go(page, "");
    await expect(page.locator(".hero")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await noOverflow(page, name + " home");
    await page.screenshot({ path: path.join(SHOTS, `${name}-home.png`), fullPage: true });
    for (const r of ["events", "login", "about"]) { await go(page, r); await page.waitForLoadState("networkidle"); await noOverflow(page, name + " " + r); }

    await signIn(page, "demo05@demo.yale.edu"); // 已参加本轮、有一场已约好时间的匹配
    for (const r of ["coffee", "coffee/browse", "coffee/times", "coffee/inbox", "coffee/matches", "profile", "events"]) {
      await go(page, r);
      await expect(page.locator("main .page, main [data-page], main > *").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(250);
      await noOverflow(page, name + " " + r);
      if (r === "coffee") await page.screenshot({ path: path.join(SHOTS, `${name}-coffee.png`), fullPage: true });
      if (r === "coffee/matches") {
        await expect(page.locator("[data-match]").first()).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `${name}-matches.png`), fullPage: true });
      }
    }
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
