/* ============================================================
   YaleLink 站点配置（唯一需要按部署环境修改的文件）
   Site config — the only file you should need to touch per deployment.
   ============================================================ */
window.YL_CONFIG = {
  siteName: "YaleLink",
  version: "0.1.0",

  // 信任边界：只有这些邮箱域名可以登录。yale.edu 的子域（如 som.yale.edu）默认也允许。
  // Trust boundary: only these email domains may sign in. Subdomains of yale.edu are allowed too.
  allowedEmailDomains: ["yale.edu", "aya.yale.edu"],
  allowSubdomains: true,

  // 静态原型没有后端，验证码固定为演示码。接入真实后端后删除此项。
  // The static prototype has no backend; the verification code is a fixed demo code.
  demoVerificationCode: "000000",

  // 接口地址：留空 = 浏览器内的本地 mock 后端（演示数据存在本机）；
  // 填真实后端地址（如 "https://api.example.cn"）后，所有 YL.api 调用改为 HTTP 请求，模块代码不用改。
  // API base: empty = in-browser mock backend; set a backend URL to send every YL.api call over HTTP.
  apiBase: "",

  defaultLang: "zh",               // "zh" | "en"
  github: "https://github.com/YuchenZhu2335/YaleLink",
  acssy: "https://acssy.org",

  // 学联身份：演示中由用户自行勾选；真实版由学联管理员审核后写入
  // ACSSY identity: self-declared in the demo; in production an ACSSY admin approves it.
  acssyDepartments: ["career", "events", "media", "outreach", "secretariat"],

  // 数据文件清单：新增一个模块的数据 = 在这里加一个名字 + 在 data/ 放同名 JSON
  // Data manifest: add a name here + a JSON file in data/ to expose a new collection.
  dataFiles: ["regions", "taxonomy", "users", "posts", "jobs", "timelines", "groups", "events", "resources", "projects", "circles", "playbooks", "campaigns", "contacts", "templates"]
};
