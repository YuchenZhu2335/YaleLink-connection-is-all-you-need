// @ts-check
// 端到端测试：tests/*.spec.js。webServer 会起一个临时数据库的后端（tests/e2e-server.js），测试结束自动关闭。
// tests/unit、tests/server 由 node --test 运行。
const PORT = 8790;
module.exports = {
  testDir: "tests",
  testMatch: "**/*.spec.js",
  timeout: 60000,
  reporter: "list",
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, locale: "zh-CN", timezoneId: "Asia/Shanghai" },
  webServer: { command: `node tests/e2e-server.js ${PORT}`, url: `http://localhost:${PORT}/api/meta`, reuseExistingServer: false, timeout: 30000 }
};
