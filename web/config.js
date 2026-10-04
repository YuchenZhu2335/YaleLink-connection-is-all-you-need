/* ============================================================
   Yalelux 站点配置（前端唯一需要按部署环境修改的文件）
   Site config — the only front-end file you should need to touch per deployment.
   后端配置（管理员、发信、DeepSeek、密钥）在 server/.env，见 server/.env.example。
   ============================================================ */
window.YL_CONFIG = {
  siteName: "Yalelux",
  version: "0.2.0",

  // 接口地址：前后端同一个服务（npm start）时就是 "/api"
  // API base: "/api" when the Node server (npm start) serves both the site and the API.
  apiBase: "/api",

  defaultLang: "zh",               // "zh" | "en"
  github: "https://github.com/YuchenZhu2335/YaleLink-connection-is-all-you-need",
  acssy: "https://acssy.org"
};
