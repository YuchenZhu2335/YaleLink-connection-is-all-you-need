// @ts-check
// 端到端测试：tests/*.spec.js。webServer 会起一个临时数据库的后端（tests/e2e-server.js），测试结束自动关闭。
// tests/unit、tests/server 由 node --test 运行；tests/demo.spec.js 是演示版的，见 playwright.demo.config.js。
const PORT = Number(process.env.E2E_PORT) || 8790; // 同一台机器上并行跑多套端到端测试时用 E2E_PORT 错开
module.exports = {
  testDir: "tests",
  testMatch: "**/*.spec.js",
  testIgnore: "**/demo.spec.js", // 演示版（静态 + 浏览器内假后端）单独跑：npm run test:demo
  timeout: 60000,
  reporter: "list",
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, locale: "zh-CN", timezoneId: "Asia/Shanghai" },
  webServer: { command: `node tests/e2e-server.js ${PORT}`, url: `http://localhost:${PORT}/api/meta`, reuseExistingServer: false, timeout: 30000 }
};
