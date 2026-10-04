#!/usr/bin/env node
/* 架构守门：把 docs/engineering.md 里"能机器判断"的规则变成 CI 检查（零依赖）
   Architecture guard — the machine-checkable half of docs/engineering.md. Run: node scripts/check-architecture.mjs

   A1 domain 层是纯函数：不碰 DOM / 存储 / 网络 / 其他 YL.*，不自己取"现在时间"和随机数，可被 Node require
   A2 api 层没有界面：不碰 document / innerHTML / YL.ui / YL.router，不直接发请求或读写 localStorage
   A3 模块不直接碰存储与网络（localStorage / sessionStorage / indexedDB / fetch / XMLHttpRequest）
   A4 新模块的业务数据只走 YL.api；YL.store 只许读字典表（term / terms / region / regions）。存量模块见 LEGACY_STORE_MODULES
   A5 模块之间只能用 PUBLIC_MODULE_API 白名单里的公开接口
   A6 modules/<id>.js 恰好注册一个模块，且 id 与文件名一致
   A7 index.html 按 config → core → domain → api → modules → app 的顺序引入 web/js 下每个文件，各一次
   A8 国内可达：index.html 与 CSS 不引用外部域名的脚本、样式、字体
   A9 安全：禁止 eval / new Function / document.write；数据里的链接用 YL.ui.safeUrl() 输出
   A10 每个 domain 文件都有单元测试 tests/unit/<id>*.test.js；domain / api 文件与某个模块同名
   A11 暂停的 v0 文件（PARKED）不被 index.html 加载

   后端（server/）：
   S1 零依赖：只 require node: 内置模块、server/ 里的文件和 web/js/domain/ 的规则；package.json 没有 dependencies
   S2 SQL 一律用 ? 占位符：db.run/get/all 的 SQL 里不拼接变量（唯一例外：IN (?, ?, …) 占位符列表）
   S3 管理员接口（server/admin.js）每一条都声明 auth: "admin"
   S4 仓库里不出现密钥（DeepSeek / Resend / 私钥等）——密钥只放环境变量 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PARKED } from "./parked.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const errors = [], warnings = [];
const err = (rule, file, msg) => errors.push(`${rule}  ${file}: ${msg}`);
const warn = (rule, file, msg) => warnings.push(`${rule}  ${file}: ${msg}`);

// 暂停的 v0 静态原型文件见 scripts/parked.mjs：不加载、不检查
// 存量模块：直接用 YL.store 读写（上线版没有了；保留这个机制给以后迁回的模块）
const LEGACY_STORE_MODULES = new Set([]);
// 模块对外公开的接口：跨模块调用只许用这些（新增需在 PR 里说明并更新 docs/modules.md）
const PUBLIC_MODULE_API = new Set([]);
// 模块可以使用的平台命名空间
const PLATFORM_NS = new Set(["i18n", "ui", "registry", "auth", "api", "router", "domain"]);
const STORE_READONLY = new Set(["term", "terms", "region", "regions"]);

const LAYERS = ["core", "domain", "api", "modules"];
const read = (p) => readFileSync(p, "utf8");
const jsFiles = (layer) => {
  const dir = resolve(web, "js", layer);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".js") && !PARKED.has(`${layer}/${f}`)).sort() : [];
};
// 去掉注释再检查，避免注释里的词误报（不去掉 "https://" 这类字符串里的 //）
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
function forbid(rule, file, src, list) {
  for (const [re, what] of list) if (re.test(src)) err(rule, file, `不允许 ${what}`);
}
const STORAGE = [/\b(localStorage|sessionStorage|indexedDB)\b/, "直接读写浏览器存储（业务数据用 YL.api，偏好用 core）"];
const NETWORK = [/\bfetch\s*\(|\bXMLHttpRequest\b/, "直接发网络请求（统一由 core/api.js 发出）"];

const files = Object.fromEntries(LAYERS.map((l) => [l, jsFiles(l)]));
const moduleIds = new Set(files.modules.map((f) => f.replace(/\.js$/, "")));

// A1 domain
for (const f of files.domain) {
  const rel = `web/js/domain/${f}`, raw = read(resolve(web, "js/domain", f)), src = strip(raw);
  forbid("A1", rel, src, [
    [/\bdocument\b|\bwindow\b/, "访问 window / document"],
    STORAGE, NETWORK,
    [/\bYL\.(?!domain\b)[A-Za-z_]+/, "依赖其他 YL.* —— domain 只依赖参数"],
    [/\bYL_CONFIG\b/, "读取 YL_CONFIG —— 配置通过参数传入"],
    [/\bDate\.now\s*\(|\bnew Date\(\s*\)/, "取当前时间 —— now 作为参数传入，测试才可复现"],
    [/\bMath\.random\b/, "随机数 —— id 作为参数传入"]
  ]);
  if (!/module\.exports/.test(src)) err("A1", rel, "需要 UMD 包装（module.exports），后端与单测才能 require");
}

// A2 api
for (const f of files.api) {
  const rel = `web/js/api/${f}`, src = strip(read(resolve(web, "js/api", f)));
  forbid("A2", rel, src, [
    [/\bdocument\b|\binnerHTML\b/, "操作 DOM —— 接口层没有界面"],
    [/\bYL\.(ui|router)\b/, "使用 YL.ui / YL.router —— 接口层只返回数据与错误码"],
    STORAGE, NETWORK
  ]);
  if (!/YL\.api\.route\s*\(/.test(src)) err("A2", rel, "接口文件应通过 YL.api.route() 注册接口");
}

// A3–A6 modules
for (const f of files.modules) {
  const id = f.replace(/\.js$/, ""), rel = `web/js/modules/${f}`, src = strip(read(resolve(web, "js/modules", f)));
  forbid("A3", rel, src, [STORAGE, NETWORK]);

  const storeCalls = [...src.matchAll(/\bYL\.store\.([A-Za-z_]+)/g)].map((m) => m[1]);
  const businessStore = [...new Set(storeCalls.filter((x) => !STORE_READONLY.has(x)))];
  if (!LEGACY_STORE_MODULES.has(id) && businessStore.length) {
    err("A4", rel, `新模块的业务数据要走 YL.api，不能用 YL.store.${businessStore.join(" / YL.store.")}（只允许 term / terms / region / regions）`);
  }
  if (LEGACY_STORE_MODULES.has(id) && !businessStore.length) {
    warn("A4", rel, "已不再直接使用 YL.store 读写业务数据，可以从 LEGACY_STORE_MODULES 名单里移除");
  }

  for (const m of src.matchAll(/\bYL\.([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/g)) {
    const ns = m[1];
    if (PLATFORM_NS.has(ns) || ns === id) continue;
    const full = `YL.${ns}${m[2] ? "." + m[2] : ""}`;
    if (!PUBLIC_MODULE_API.has(full)) err("A5", rel, `${full} 不是公开接口 —— 跨模块只能用 ${[...PUBLIC_MODULE_API].join("、")}，或者用路由链接跳转`);
  }

  const regs = [...src.matchAll(/registerModule\s*\(\s*\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (regs.length !== 1 || (src.match(/registerModule\s*\(/g) || []).length !== 1) err("A6", rel, `应恰好调用一次 registerModule({ id: "${id}", ... })`);
  else if (regs[0] !== id) err("A6", rel, `注册的 id "${regs[0]}" 与文件名 "${id}" 不一致`);
}
for (const id of LEGACY_STORE_MODULES) if (!moduleIds.has(id)) warn("A4", "scripts/check-architecture.mjs", `LEGACY_STORE_MODULES 里的 "${id}" 已不存在，请从名单移除`);

// A7 index.html 装载顺序
const html = read(resolve(web, "index.html"));
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const layerOf = (src) => (src === "config.js" ? 0 : src === "js/app.js" ? 5 : LAYERS.findIndex((l) => src.startsWith(`js/${l}/`)) + 1);
let last = 0, lastSrc = "", orderReported = false;
for (const s of scripts) {
  const li = layerOf(s);
  if (li <= 0 && s !== "config.js") { err("A7", "web/index.html", `无法识别的脚本 ${s}`); continue; }
  if (li < last && !orderReported) {
    err("A7", "web/index.html", `${s} 出现在 ${lastSrc} 之后 —— 顺序应为 config → core → domain → api → modules → app`);
    orderReported = true;
  }
  if (li >= last) { last = li; lastSrc = s; }
}
if (scripts[0] !== "config.js") err("A7", "web/index.html", "第一个脚本应是 config.js");
if (scripts[scripts.length - 1] !== "js/app.js") err("A7", "web/index.html", "最后一个脚本应是 js/app.js");
for (const l of LAYERS) for (const f of files[l]) {
  const n = scripts.filter((s) => s === `js/${l}/${f}`).length;
  if (n !== 1) err("A7", "web/index.html", `js/${l}/${f} 应被引入恰好一次（现在 ${n} 次）`);
}
for (const s of scripts) if (!existsSync(resolve(web, s))) err("A7", "web/index.html", `引用的 ${s} 不存在`);

// A8 国内可达：不加载境外（任何外部域名的）脚本、样式、字体
const external = /^(https?:)?\/\//i;
for (const m of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) if (external.test(m[1])) err("A8", "web/index.html", `外部资源 ${m[1]} —— 资源须随站点部署（国内可访问）`);
for (const f of readdirSync(resolve(web, "css")).filter((x) => x.endsWith(".css"))) {
  const css = read(resolve(web, "css", f));
  for (const m of css.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)|url\(\s*["']?([^"')]+)/g)) {
    const u = m[1] || m[2];
    if (external.test(u)) err("A8", `web/css/${f}`, `外部资源 ${u}`);
  }
}

// A9 危险 API 与链接输出
for (const l of LAYERS) for (const f of files[l]) {
  const rel = `web/js/${l}/${f}`, src = strip(read(resolve(web, "js", l, f)));
  forbid("A9", rel, src, [[/\beval\s*\(|\bnew Function\s*\(|\bdocument\.write\s*\(/, "eval / new Function / document.write"]]);
  if (/\b(?:href|src)="\$\{esc\(/.test(src)) err("A9", rel, '数据里的链接用 YL.ui.safeUrl(x) 输出，esc() 挡不住 "javascript:" 链接');
}

// A10 domain 有单测；domain / api 按模块 id 命名
const unitDir = resolve(root, "tests", "unit");
const unitTests = existsSync(unitDir) ? readdirSync(unitDir) : [];
for (const f of files.domain) {
  const id = f.replace(/\.js$/, "");
  if (!unitTests.some((t) => t.startsWith(id) && t.endsWith(".test.js"))) err("A10", `web/js/domain/${f}`, `缺少单元测试 tests/unit/${id}*.test.js —— 业务规则必须有测试`);
}
for (const l of ["domain", "api"]) for (const f of files[l]) {
  if (!moduleIds.has(f.replace(/\.js$/, ""))) err("A10", `web/js/${l}/${f}`, `没有同名模块 web/js/modules/${f} —— ${l} 文件按模块 id 命名`);
}

// A11 暂停文件不加载
for (const p of PARKED) if (scripts.includes(`js/${p}`)) err("A11", "web/index.html", `js/${p} 已暂停（PARKED），上线版不加载`);

// S1–S4 后端
const serverDir = resolve(root, "server");
const serverFiles = existsSync(serverDir) ? readdirSync(serverDir).filter((f) => f.endsWith(".js")).sort() : [];
for (const f of serverFiles) {
  const rel = `server/${f}`, src = strip(read(resolve(serverDir, f)));
  for (const m of src.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    const dep = m[1];
    if (!(dep.startsWith("node:") || /^\.\/[\w.-]+$/.test(dep) || /^\.\.\/web\/js\/domain\/[\w-]+\.js$/.test(dep))) err("S1", rel, `require("${dep}") —— 后端零依赖：只用 node: 内置模块、server/ 文件与 web/js/domain 规则`);
  }
  for (const m of src.matchAll(/\bdb\.(?:run|get|all)\(\s*`([^`]*)`/g)) {
    const sql = m[1].replace(/\$\{\w+\.map\(\(\) => "\?"\)\.join\(","\)\}/g, "");
    if (/\$\{/.test(sql)) err("S2", rel, `SQL 里拼接了变量：${m[1].slice(0, 80)}… —— 用 ? 占位符传参`);
  }
}
const pkg = JSON.parse(read(resolve(root, "package.json")));
if (pkg.dependencies && Object.keys(pkg.dependencies).length) err("S1", "package.json", `不允许运行时依赖：${Object.keys(pkg.dependencies).join(", ")}`);
if (existsSync(resolve(serverDir, "admin.js"))) {
  const admin = strip(read(resolve(serverDir, "admin.js")));
  for (const m of admin.matchAll(/app\.route\(\s*"(\w+)",\s*"([^"]+)"[\s\S]*?\}\s*,\s*\{([^{}]*)\}\s*\);/g)) {
    if (!/auth:\s*"admin"/.test(m[3])) err("S3", "server/admin.js", `${m[1]} ${m[2]} 没有声明 auth: "admin"`);
  }
  const declared = (admin.match(/app\.route\(/g) || []).length, checked = [...admin.matchAll(/auth:\s*"admin"/g)].length;
  if (declared !== checked) err("S3", "server/admin.js", `共 ${declared} 条接口，只有 ${checked} 条声明了 auth: "admin"`);
}
const SECRET = /\b(sk-[A-Za-z0-9]{24,}|re_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const scan = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = resolve(dir, d.name);
  if (d.isDirectory()) return ["node_modules", ".git", "data", "test-results", "playwright-report"].includes(d.name) ? [] : scan(p);
  return /\.(js|mjs|json|md|html|css|sql|yml|example)$/.test(d.name) ? [p] : [];
}) : [];
for (const p of scan(root)) if (SECRET.test(read(p))) err("S4", p.slice(root.length + 1), "疑似密钥写进了仓库 —— 密钥只放 server/.env（不进仓库）");

// 报告
console.log(`layers: ${LAYERS.map((l) => `${l} ${files[l].length}`).join(", ")}`);
const legacyCount = [...LEGACY_STORE_MODULES].filter((x) => moduleIds.has(x)).length;
console.log(`modules: ${files.modules.length}${legacyCount ? ` (legacy, still on YL.store: ${legacyCount})` : ""}; parked v0 files: ${PARKED.size}; server files: ${serverFiles.length}`);
warnings.forEach((w) => console.log("warn:", w));
if (errors.length) {
  errors.forEach((e) => console.error("error:", e));
  console.error(`\n${errors.length} architecture rule violation(s) — see docs/engineering.md`);
  process.exit(1);
}
console.log("✔ architecture rules hold");
