/* 暂停的 v0 静态原型文件（相对 web/js/）：上线版（Yalelux）不加载、不做架构与词典检查。
   它们依赖已停用的 YL.store / 本地 mock 后端；某个模块接上后端时按 RFC 改写成 YL.api 版本，再从这里移出（只减不增）。
   完整可运行的 v0 原型在 main 分支。 */
export const PARKED = new Set([
  "core/store.js", "core/audit.js", "api/coffee.js",
  "modules/careers.js", "modules/circles.js", "modules/acssy.js", "modules/startup.js", "modules/life.js", "modules/directory.js"
]);
