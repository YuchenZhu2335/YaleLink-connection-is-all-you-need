#!/usr/bin/env node
/* 极简静态文件服务（零依赖），用来在本地看演示版、跑演示版的端到端测试。
   Tiny zero-dependency static server for the demo build.
   用法：node scripts/serve-static.mjs [目录=dist/yalelux-demo] [端口=8797] [路径前缀=/]
   例：node scripts/serve-static.mjs dist/yalelux-demo 8797 /yalelux-demo/yalelux/   —— 模拟 GitHub Pages 的子目录 */
import { createServer } from "node:http";
import { createReadStream, statSync, realpathSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";

const dir = realpathSync(resolve(process.argv[2] || "dist/yalelux-demo"));
const port = Number(process.argv[3] || 8797);
const prefix = ("/" + String(process.argv[4] || "/").replace(/^\/+|\/+$/g, "") + "/").replace(/^\/\/$/, "/");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };

createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://local").pathname); } catch (e) { res.writeHead(400); return res.end("Bad request"); }
  if (p === prefix.slice(0, -1)) { res.writeHead(301, { Location: prefix }); return res.end(); } // /x/yalelux → /x/yalelux/
  if (!p.startsWith(prefix) || p.includes("\0")) { res.writeHead(404); return res.end("Not found"); }
  let rel = p.slice(prefix.length);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = resolve(join(dir, rel));
  let ok = file.startsWith(dir + sep);
  try { ok = ok && statSync(file).isFile() && realpathSync(file).startsWith(dir + sep); } catch (e) { ok = false; }
  if (!ok) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}).listen(port, () => console.log(`serve-static: http://localhost:${port}${prefix} → ${dir}`));
