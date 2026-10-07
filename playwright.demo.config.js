// @ts-check
// 演示版（纯静态、假后端在浏览器里）的端到端测试：先构建 dist/yalelux-demo，再用零依赖静态服务器
// 挂在一个子目录下（模拟 GitHub Pages 的 /<仓库>/yalelux/），跑 tests/demo.spec.js。
// 用法：npm run test:demo（= npx playwright test -c playwright.demo.config.js）
const PORT = 8797;
const PREFIX = "/yalelux-demo-test/yalelux/";
module.exports = {
  testDir: "tests",
  testMatch: "demo.spec.js",
  timeout: 60000,
  reporter: "list",
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}${PREFIX}`, locale: "zh-CN", timezoneId: "Asia/Shanghai" },
  webServer: {
    command: `node scripts/build-demo.mjs && node scripts/serve-static.mjs dist/yalelux-demo ${PORT} ${PREFIX}`,
    url: `http://localhost:${PORT}${PREFIX}`,
    reuseExistingServer: false,
    timeout: 60000
  }
};
