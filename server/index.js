#!/usr/bin/env node
/* 启动：node server/index.js（或 npm start）。同一个端口同时提供网页（web/）和接口（/api/*）。 */
const http = require("node:http");
const { build } = require("./app");

const { cfg, app, jobs, db } = build();
const server = http.createServer((req, res) => app.handle(req, res));
server.listen(cfg.port, () => {
  console.log(`YaleLink running at ${cfg.publicUrl}  (mail: ${cfg.mailDriver}${cfg.deepseekKey ? ", deepseek on" : ""}${cfg.adminEmails.length ? ", admins: " + cfg.adminEmails.join(" ") : ""})`);
  if (cfg.mailDriver === "console") console.log(`本地开发：邮件（含验证码）打印在这个终端里，也可以打开 ${cfg.publicUrl}/api/dev/outbox 查看`);
});

let timer = null;
if (!cfg.disableJobs) {
  const tick = () => jobs.run().catch((e) => console.error("jobs failed:", e));
  tick();
  timer = setInterval(tick, cfg.jobsIntervalMs);
}
const stop = () => { clearInterval(timer); server.close(() => { db.close(); process.exit(0); }); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
