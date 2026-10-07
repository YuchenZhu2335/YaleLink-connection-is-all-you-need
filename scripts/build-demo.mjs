#!/usr/bin/env node
/* 构建纯静态演示版（零依赖）：dist/yalelux-demo/ 可以直接放到 GitHub Pages（例如 /<仓库>/yalelux/ 下）。
   Build the static, in-browser demo. Run: npm run build:demo

   1. 复制 web/ → dist/yalelux-demo/
   2. 复制 demo/*.js、demo/*.css → dist/yalelux-demo/demo/
   3. 生成 demo/demo-data.js：把真实的 server/seed.js 跑进一个临时数据库，用 node:sqlite 读出演示同学的资料；
      连同问卷题目（web/data/matchQuestions.json）和隐私说明版本一起写成 window.YL_DEMO_DATA
   4. 改 index.html：加 demo.css、<meta name="robots" content="noindex">，
      在 <script src="js/app.js"></script> 前面插入 demo-data.js 和 mock-server.js（替换 fetch 的假后端）
   5. 写 .nojekyll（GitHub Pages 不要用 Jekyll 处理）
   所有路径都是相对路径，放在任何子目录下都能用。不改 web/ 和 server/。 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.argv[2] || "dist/yalelux-demo");
const require = createRequire(import.meta.url);

// 1) web/ → out
rmSync(out, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
cpSync(join(root, "web"), out, { recursive: true });

// 2) demo/*.js、*.css
const demoOut = join(out, "demo");
mkdirSync(demoOut, { recursive: true });
for (const f of readdirSync(join(root, "demo")).filter((x) => /\.(js|css)$/.test(x) && x !== "demo-data.js")) cpSync(join(root, "demo", f), join(demoOut, f));

// 3) 演示数据：跑真实的 seed（临时数据库），导出演示同学的资料
const tmp = mkdtempSync(join(tmpdir(), "yalelux-demo-build-"));
let users;
try {
  const env = Object.assign({}, process.env, { DATA_DIR: tmp, NODE_ENV: "development", MAIL_DRIVER: "console", DISABLE_JOBS: "1", DEEPSEEK_API_KEY: "", ADMIN_EMAILS: "" });
  execFileSync(process.execPath, [join(root, "server", "seed.js")], { env, stdio: ["ignore", "ignore", "inherit"] });
  process.removeAllListeners("warning"); // 和 server/db.js 一样屏蔽 node:sqlite 的"实验特性"提示
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(tmp, "yalelux.sqlite"));
  users = db.prepare("SELECT id, login_email, contact_email, name, identity, stage, grad_year, job, city, contact_method, answers FROM users WHERE login_email LIKE 'demo%@demo.yale.edu' ORDER BY login_email").all()
    .map((u) => Object.assign({}, u, { answers: JSON.parse(u.answers || "{}") }));
  db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (users.length !== 24) throw new Error(`build-demo: 期望 24 位演示同学，实际 ${users.length}`);
// 隐私说明版本：和后端默认配置一致（server/config.js）
const consentVersion = require(join(root, "server", "config.js")).load({ DATA_DIR: tmp }).consentVersion;
const questions = JSON.parse(readFileSync(join(root, "web", "data", "matchQuestions.json"), "utf8")).questions;
const data = { consentVersion, questions, users };
writeFileSync(join(demoOut, "demo-data.js"),
  "/* 自动生成（scripts/build-demo.mjs）：演示同学（全部虚构，来自 server/seed.js）、问卷题目、隐私说明版本。不要手改。 */\n" +
  "window.YL_DEMO_DATA = " + JSON.stringify(data, null, 1) + ";\n");

// 4) index.html
const indexFile = join(out, "index.html");
let html = readFileSync(indexFile, "utf8");
const APP = '<script src="js/app.js"></script>';
if (!html.includes(APP)) throw new Error("build-demo: index.html 里找不到 " + APP);
html = html
  .replace("<head>", '<head>\n  <meta name="robots" content="noindex">')
  .replace('<link rel="stylesheet" href="css/components.css">', '<link rel="stylesheet" href="css/components.css">\n  <link rel="stylesheet" href="demo/demo.css">')
  .replace(/<title>([^<]*)<\/title>/, "<title>$1 · 演示 Demo</title>")
  .replace(APP, '<!-- 演示版：假后端（替换 fetch，数据只在浏览器里） -->\n  <script src="demo/demo-data.js"></script><script src="demo/mock-server.js"></script>\n  ' + APP);
if (!html.includes("demo/demo.css")) throw new Error("build-demo: 没能插入 demo.css");
writeFileSync(indexFile, html);

// 5) GitHub Pages
writeFileSync(join(out, ".nojekyll"), "");
console.log(`build-demo: ${out.slice(root.length + 1)}（${users.length} 位演示同学，${questions.length} 道问卷题）`);
