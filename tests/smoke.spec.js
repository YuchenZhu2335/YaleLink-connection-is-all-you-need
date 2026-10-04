// Playwright 冒烟测试：起本地静态服务，验证登录门槛、语言切换、全部路由、学联后台工作流
// Run: npx playwright test   (CI installs @playwright/test; locally: npm i)
const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}/`;
let server;
test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", path.join(__dirname, "..", "web")], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE); if (r.ok) return; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("server did not start");
});
test.afterAll(() => server && server.kill());

async function login(page, opts = {}) {
  await page.goto(BASE + "#/login");
  await page.fill("#email", opts.email || "demo@yale.edu");
  await page.click("#f-email button[type=submit]");
  await page.fill("#code", "000000");
  await page.click("#f-code button[type=submit]");
  await page.waitForSelector("#f-profile");
  await page.fill('input[name="name"]', opts.name || "测试同学");
  if (opts.acssyRole) await page.selectOption('select[name="acssyRole"]', opts.acssyRole);
  await page.click("#f-profile button[type=submit]");
  await page.waitForSelector(".hero");
}

test("loads without console errors and switches language", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await expect(page.locator(".hero h1")).toContainText("属于耶鲁人自己的社群");
  await page.click("#lang-toggle");
  await expect(page.locator(".hero h1")).toContainText("A community of our own");
  await page.reload();
  await expect(page.locator(".hero h1")).toContainText("A community of our own");
  await page.click("#lang-toggle");
  expect(errors).toEqual([]);
});

test("login rejects non-Yale email and accepts yale.edu with demo code", async ({ page }) => {
  await page.goto(BASE + "#/login");
  await page.fill("#email", "someone@gmail.com");
  await page.click("#f-email button[type=submit]");
  await expect(page.locator("#email-err")).toContainText("耶鲁邮箱");
  await login(page);
  await expect(page.locator(".topbar__user")).toBeVisible();
});

test("every public route renders content", async ({ page }) => {
  await login(page);
  for (const r of ["home", "careers/jobs", "careers/timeline", "careers/resume", "careers/groups", "careers/research", "careers/post/s01", "events", "events/e/e01", "circles", "circles/c/ci-nyc", "startup", "startup/projects", "startup/match", "life", "directory", "directory/u/u01", "profile", "about"]) {
    await page.goto(BASE + "#/" + r);
    await page.waitForFunction(() => document.querySelector("#main").children.length > 0);
    const text = await page.locator("#main").innerText();
    expect(text.trim().length, r).toBeGreaterThan(40);
  }
});

test("directory requires login", async ({ page }) => {
  await page.goto(BASE + "#/directory");
  await page.waitForSelector("#f-email");
  expect(page.url()).toContain("#/login");
});

test("ACSSY console: gate, board, claim task, wizard creates project", async ({ page }) => {
  await login(page, { acssyRole: "member" });
  await page.goto(BASE + "#/acssy");
  await expect(page.locator("h1")).toContainText("学联后台");
  await page.goto(BASE + "#/acssy/board/c01");
  await page.locator("[data-claim]").first().click();
  await expect(page.locator(".toast")).toContainText("已认领");
  await page.goto(BASE + "#/acssy/board");
  await expect(page.locator("#main")).toContainText("我的待办");
  await page.click("#btn-wizard");
  await page.click('[data-scope="acssy"]');
  await page.click("#w-next");
  await page.click('[data-pb="pb-panel"]');
  await page.click("#w-next");
  await page.fill('input[name="title"]', "测试分享会");
  await page.fill('input[name="date"]', "2026-12-01");
  await page.fill('input[name="time"]', "19:00");
  await page.fill('input[name="venue"]', "Evans Hall");
  await page.fill('textarea[name="description"]', "冒烟测试");
  await page.click("#w-form button.btn--primary");
  await page.waitForURL(/#\/acssy\/board\//);
  await expect(page.locator("#main")).toContainText("测试分享会");
  await expect(page.locator("[data-status]").first()).toBeVisible();
});

test("coffee chat beta: sign up → offer times → book → get booked → accept → contacts revealed, all audited", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-10T16:00:00Z")); // 活动（11/2–11/15）开始之前
  await login(page, { acssyRole: "lead" }); // 原型里学联负责人 = 管理员

  await page.goto(BASE + "#/coffee/people");
  await expect(page.locator(".tab.is-active")).toContainText("活动介绍"); // 没报名：看不到参与者

  // 报名：规则在 domain 里，错误按字段显示
  await page.goto(BASE + "#/coffee/join");
  await page.click("#f-join button[type=submit]");
  await expect(page.locator('[data-err="program"]')).toHaveText("这一项必填");
  await expect(page.locator('[data-err="goals"]')).not.toBeEmpty();
  await page.fill("#cf-program", "MS Statistics");
  await page.check('input[name="goals"][value="industry"]');
  await page.fill("#cf-meetPlace", "zoom 123");
  await page.click("#f-join button[type=submit]");
  await expect(page.locator('[data-err="meetPlace"]')).toContainText("https://");
  await page.fill("#cf-meetPlace", "https://zoom.example.com/j/me");
  await page.fill("#cf-contact", "微信 test-me");
  await page.click("#f-join button[type=submit]");
  await page.waitForURL(/#\/coffee\/schedule/);

  // 选时间：整行 19:20（14 天）+ 单格
  await page.click('[data-time="19:20"]');
  await page.click('[data-slot="2026-11-02T10:00"]');
  await expect(page.locator("#slot-count")).toContainText("15");
  await page.click("#btn-save-slots");
  await expect(page.locator(".toast")).toContainText("15");

  // 从校友目录点"约咖啡"进入 TA 的时间表；示例数据里 11/3 19:20 已被约走
  await page.goto(BASE + "#/directory/u/u01");
  await page.click("#btn-coffee");
  await expect(page.locator('[data-book="2026-11-03T19:20"]')).toBeDisabled();
  await page.click('[data-book="2026-11-03T19:55"]');
  await page.click("#f-book button[type=submit]"); // 没勾选免责声明
  await expect(page.locator('[data-err="agree"]')).not.toBeEmpty();
  await page.check('#f-book input[name="agree"]');
  await page.click("#f-book button[type=submit]");
  await expect(page.locator('[data-book="2026-11-03T19:55"]')).toContainText("你约的");

  // 被约：模拟一位参与者约我 → 接受 → 双方联系方式出现
  await page.goto(BASE + "#/coffee/bookings");
  await page.click("#btn-demo");
  const incoming = page.locator("[data-booking]").filter({ has: page.locator('[data-act="accept"]') });
  await expect(incoming).toHaveCount(1);
  await incoming.locator('[data-act="accept"]').click();
  await page.click("#btn-answer");
  await expect(page.locator(".callout--green").first()).toContainText("@example.com");
  await expect(page.locator(".tabs")).toContainText("我的预约 1"); // 未读通知

  // 意见箱与管理统计
  await page.goto(BASE + "#/coffee/feedback");
  await page.fill("#cf-text", "希望可以导出到日历");
  await page.click("#f-fb button[type=submit]");
  await expect(page.locator(".toast")).toContainText("谢谢");
  await page.goto(BASE + "#/coffee/admin");
  await expect(page.locator("#admin-stats .stat").first()).toContainText("11"); // 10 位示例参与者 + 我

  // 每个写操作（以及管理员查看）都留痕
  await page.goto(BASE + "#/profile");
  for (const op of ["GET /coffee/admin", "POST /coffee/bookings/:id/accept", "POST /coffee/bookings", "POST /coffee/availability"]) await expect(page.locator("#audit-log")).toContainText(op);

  // "关于"页自动列出后端契约（演示路由不算）
  await page.goto(BASE + "#/about");
  await expect(page.locator("#api-contract .list-row")).toHaveCount(12);
  expect(errors).toEqual([]);
});

test("screenshots at mobile and desktop widths", async ({ browser }) => {
  for (const [name, vp] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await login(page, { acssyRole: "lead" });
    for (const r of ["home", "coffee", "careers/jobs", "events", "acssy/board/c01"]) {
      await page.goto(BASE + "#/" + r);
      await page.waitForFunction(() => document.querySelector("#main").children.length > 0);
      await page.screenshot({ path: `tests/screenshots/${name}-${r.replace(/\//g, "_")}.png`, fullPage: true });
    }
    await ctx.close();
  }
});
