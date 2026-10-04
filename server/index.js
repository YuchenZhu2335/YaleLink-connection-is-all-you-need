#!/usr/bin/env node
/* 启动：node server/index.js（或 npm start）。同一个端口同时提供网页（web/）和接口（/api/*）。 */
const http = require("node:http");
const { build } = require("./app");

const { cfg, app, jobs, db } = build();
// 兜底：任何没接住的异常只结束这一个请求，不让进程退出
const server = http.createServer((req, res) => {
  Promise.resolve(app.handle(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end();
  });
});
server.listen(cfg.port, () => {
  console.log(`Yalelux running at ${cfg.publicUrl}  (mail: ${cfg.mailDriver}${cfg.deepseekKey ? ", deepseek on" : ""}${cfg.adminEmails.length ? ", admins: " + cfg.adminEmails.join(" ") : ""})`);
  if (cfg.mailDriver === "console") console.log(`本地开发：邮件（含验证码）打印在这个终端里，也可以在本机打开 ${cfg.publicUrl}/api/dev/outbox 查看`);
});
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

// 定时任务：上一轮没跑完就跳过这一轮；退出时等正在发的邮件发完（最多 20 秒）
let timer = null, running = null;
if (!cfg.disableJobs) {
  const tick = () => {
    if (running) return;
    running = jobs.run().catch((e) => console.error("jobs failed:", e)).finally(() => { running = null; });
  };
  tick();
  timer = setInterval(tick, cfg.jobsIntervalMs);
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close();
  if (running) await Promise.race([running, new Promise((r) => setTimeout(r, 20000))]);
  db.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
