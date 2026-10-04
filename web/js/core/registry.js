/* 模块注册表 — 新功能只需 registerModule({...})，导航会自动出现
   Module registry — a new feature only needs registerModule({...}); navigation updates automatically.

   registerModule({
     id: "coffee",                    // 唯一 id = 文件名 = 路由第一段  #/coffee/...
     requiresAuth: true,              // 未登录访问时跳到登录页
     requiresReady: true,             // 还没完成首次填写（同意说明 / 联系邮箱 / 资料）时先去补完
     adminOnly: false,                // 只有管理员能进（后端同样会拦）
     // 导航入口，可以有多个（子页面也可以单独出现在底部标签栏）
     //   path: 链接地址；mobile: 是否放进手机底部标签栏；when(): 是否显示；badge: 角标的名字（见 setBadge）
     nav: [{ path: "coffee", icon: "coffee", labelKey: "nav.coffee", order: 10, mobile: true, when: () => YL.auth.isReady(), badge: "coffee" }],
     render(root, ctx) {}             // ctx = { segments, sub, id, query, path, isActive() }；可以是 async
   })

   角标：模块拿到数据后调用 YL.registry.setBadge("inbox", 3)，外壳会更新导航上的数字。 */
window.YL = window.YL || {};
YL.registry = (function () {
  const modules = [];
  const badges = {};
  function register(m) {
    if (!m || !m.id || typeof m.render !== "function") throw new Error("registerModule: id and render() are required");
    if (modules.some((x) => x.id === m.id)) throw new Error("registerModule: duplicate id " + m.id);
    modules.push(m);
    return m;
  }
  function get(id) { return modules.find((m) => m.id === id); }
  function all() { return modules.slice(); }
  // 所有导航入口（已按 order 排序），opts.mobile = 只要底部标签栏里的
  function navItems(opts) {
    const mobile = opts && opts.mobile;
    return modules
      .reduce((all, m) => all.concat([].concat(m.nav || []).map((n) => Object.assign({ module: m.id, path: m.id }, n))), [])
      .filter((n) => (!mobile || n.mobile) && (!n.when || n.when()))
      .sort((a, b) => (a.order || 999) - (b.order || 999));
  }
  // 当前路径对应哪个导航入口：取最长的前缀匹配（coffee/inbox 优先于 coffee）
  function activeNav(path, items) {
    const p = String(path || "");
    return (items || navItems()).filter((n) => p === n.path || p.indexOf(n.path + "/") === 0)
      .sort((a, b) => b.path.length - a.path.length)[0] || null;
  }
  function setBadge(name, n) {
    const v = Number(n) > 0 ? Number(n) : 0;
    if (badges[name] === v) return;
    badges[name] = v;
    window.dispatchEvent(new CustomEvent("yl:badges"));
  }
  const badge = (name) => badges[name] || 0;
  return { register, get, all, navItems, activeNav, setBadge, badge };
})();
window.registerModule = YL.registry.register;
