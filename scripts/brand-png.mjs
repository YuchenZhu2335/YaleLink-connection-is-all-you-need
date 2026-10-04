#!/usr/bin/env node
/* 品牌位图：用 Playwright 自带的 chromium 把 web/assets/brand/ 里的 SVG 渲染成 PNG（设计规范 docs/design/system.md §8.4、§8.6）
   Brand bitmaps rendered from the SVG sources with Playwright's bundled chromium (dev dependency only; nothing new at runtime).

     node scripts/brand-png.mjs                                   # 全部重新生成
     node scripts/brand-png.mjs --event "Coffee Chat 周" --dates "10/15–10/25"   # 公众号封面两侧的活动信息
     node scripts/brand-png.mjs --event "" --dates ""             # 不带活动信息的封面

   输出（web/assets/brand/）：
     tile-180.png              180×180 手机"添加到主屏幕"图标（apple-touch-icon）：不透明、直角——iOS 自己切圆角，透明的角会变黑
     share-300.png / -600.png  分享缩略图 1:1（og:image 用 600）：tile.svg 的位图，不放字；同样不透明、直角
     cover.png / cover@2x.png  公众号封面 2.35:1（900×383，另出两倍图）：纸色底，正中 383×383 是 1:1 安全区（竖排组合），
                               两侧放活动信息，右下角非官方声明（两行，整段落在右侧可裁区里，裁成 1:1 时不会留下半截字）

   颜色和字体栈从 web/css/tokens.css 读；西文用站点自带的 Newsreader（web/assets/fonts，内联成 data URL），不加载任何外部字体。
   中文没有自带字体，用的是运行这个脚本的电脑上的系统字体（字体栈同网站）：在装有苹方 / 思源黑体的电脑上生成效果最好。 */
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const brand = resolve(web, "assets/brand");
const read = (p) => readFileSync(p, "utf8");

const { values: opt } = parseArgs({
  options: {
    event: { type: "string", default: "Coffee Chat 周" },        // PRD §8 首轮建议（待确认，§9 第 13 条）
    dates: { type: "string", default: "10/15–10/25" },
    unofficial: { type: "string", default: "ACSSY 志愿者开发|非耶鲁大学官方产品" } // 设计规范 §8.7 短版，"|" 处换行
  }
});

/* ---------- 设计 token（只取浅色主题，:root 里第一次出现的值）---------- */
const tokens = read(resolve(web, "css/tokens.css"));
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens);
  if (!m) throw new Error(`tokens.css: --${name} not found`);
  return m[1].trim();
};
const C = { paper: token("c-bg"), ink: token("c-ink"), ink2: token("c-ink-2"), ink3: token("c-ink-3") };
const fontBody = token("font-body");
const fontFace = (file, style, range) => `@font-face { font-family: "YL Newsreader"; font-weight: 500; font-style: ${style}; unicode-range: ${range};
  src: url(data:font/woff2;base64,${readFileSync(resolve(web, "assets/fonts", file)).toString("base64")}) format("woff2"); }`;
// unicode-range 和 tokens.css 的 @font-face 保持一致
const faces = [...tokens.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => {
  const block = m[1];
  const file = /url\("\.\.\/assets\/fonts\/([^"]+)"\)/.exec(block)[1];
  return fontFace(file, /font-style:\s*italic/.test(block) ? "italic" : "normal", /unicode-range:\s*([^;]+);/.exec(block)[1]);
}).join("\n");

/* ---------- SVG 源文件 ---------- */
const tileSvg = read(resolve(brand, "tile.svg"));
const squareTile = tileSvg.replace(/<rect([^>]*?)\srx="[^"]*"/, "<rect$1"); // 直角版：iOS / 分享图由平台自己切角
if (squareTile === tileSvg) throw new Error("tile.svg: expected a rounded <rect rx=…>");
const wordmarkSvg = read(resolve(brand, "wordmark.svg"));
const wmBox = /viewBox="([-\d.\s]+)"/.exec(wordmarkSvg)[1].trim().split(/\s+/).map(Number);
const sized = (svg, w, h) => svg.replace(/<svg\b/, `<svg width="${w}" height="${h}" aria-hidden="true"`).replace(/\srole="img"|\saria-label="[^"]*"/g, "");
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page0 = (w, h, body, css) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${faces}
* { margin: 0; box-sizing: border-box; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
body { font-family: ${fontBody}; color: ${C.ink}; -webkit-font-smoothing: antialiased; }
svg { display: block; }
${css || ""}
</style></head><body>${body}</body></html>`;

// 方块图标：整张画布就是方块（不透明、直角）
const tilePage = (size) => page0(size, size, sized(squareTile, size, size));

/* 公众号封面（§8.6）：900×383，纸色底。
   正中 383×383 安全区：竖排组合（§9 第 3 种）——方块 120 → 0.4F → 字标 F=40 → 0.5F → 中文 tagline 20（500，ink-2）
   两侧：左活动名、右日期（Newsreader 500）；右下角：非官方声明 16px ink-3 */
function coverPage() {
  const W = 900, H = 383, SAFE = 383, F = 40, side = (W - SAFE) / 2;
  const wmW = Math.round((F * wmBox[2]) / wmBox[3] * 100) / 100;
  const lines = String(opt.unofficial).split("|").map(escHtml).join("<br>");
  const body = `
    <main class="safe">
      ${sized(tileSvg, 120, 120)}
      <div class="wm">${sized(wordmarkSvg, wmW, F)}</div>
      <p class="tagline">耶鲁灯下，资源与想法相遇</p>
    </main>
    ${opt.event ? `<p class="side side--l">${escHtml(opt.event)}</p>` : ""}
    ${opt.dates ? `<p class="side side--r">${escHtml(opt.dates)}</p>` : ""}
    <p class="unofficial">${lines}</p>`;
  const css = `
    body { background: ${C.paper}; position: relative; }
    .safe { position: absolute; left: ${side}px; top: 0; width: ${SAFE}px; height: ${SAFE}px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .wm { margin-top: ${0.4 * F}px; color: ${C.ink}; }
    .tagline { margin-top: ${0.5 * F}px; font-size: 20px; line-height: 1.4; font-weight: 500; color: ${C.ink2}; letter-spacing: .02em; }
    .side { position: absolute; top: 0; height: ${H}px; width: ${side}px; display: flex; align-items: center; justify-content: center;
      padding: 0 16px; text-align: center; font-family: "YL Newsreader", ${fontBody}; font-weight: 500; font-size: 26px; line-height: 1.25;
      color: ${C.ink}; font-variant-numeric: lining-nums; }
    .side--l { left: 0; }
    .side--r { right: 0; }
    .unofficial { position: absolute; right: 16px; bottom: 14px; max-width: ${side - 32}px; text-align: right;
      font-size: 16px; line-height: 1.35; color: ${C.ink3}; }`;
  return { W, H, html: page0(W, H, body, css) };
}

/* ---------- 渲染 ---------- */
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("需要开发依赖 Playwright：先运行 npm ci（只在生成位图时用，网站本身不依赖它）"); process.exit(1); }

const browser = await chromium.launch();
async function render(file, html, w, h, scale) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale || 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "error").length);
  if (missing) throw new Error(`${file}: a self-hosted font failed to load`);
  const out = resolve(brand, file);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: false });
  await ctx.close();
  console.log(`${file.padEnd(16)} ${String(w * (scale || 1))}×${String(h * (scale || 1))}  ${(statSync(out).size / 1024).toFixed(1)} KB`);
}
try {
  await render("tile-180.png", tilePage(180), 180, 180);
  await render("share-300.png", tilePage(300), 300, 300);
  await render("share-600.png", tilePage(600), 600, 600);
  const cover = coverPage();
  await render("cover.png", cover.html, cover.W, cover.H, 1);
  await render("cover@2x.png", cover.html, cover.W, cover.H, 2);
} finally {
  await browser.close();
}
