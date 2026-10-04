// @ts-check
// 只收端到端测试 *.spec.js；tests/unit/*.test.js 由 node --test 运行
module.exports = { testDir: "tests", testMatch: "**/*.spec.js", timeout: 60000, use: { locale: "zh-CN" }, reporter: "list" };
