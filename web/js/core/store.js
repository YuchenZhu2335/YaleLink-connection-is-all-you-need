/* 数据层：seed = data/*.json（只读，Git 管理）；overlay = localStorage（演示中用户新建的内容与状态）
   Data layer: seed JSON (git-managed, read-only) + a localStorage overlay for demo-time writes.
   接入真实后端时只需替换本文件的 load/add/state 实现。 */
window.YL = window.YL || {};
YL.store = (function () {
  const OVERLAY_KEY = "yl.overlay";   // { collection: [ newItems ] }
  const STATE_KEY = "yl.state";       // { rsvp:{id:true}, joined:{}, likes:{}, greeted:{}, ... }
  const seed = {};
  let overlay = read(OVERLAY_KEY, {});
  let state = read(STATE_KEY, {});

  function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function write(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  async function load() {
    const names = YL_CONFIG.dataFiles;
    const res = await Promise.all(names.map((n) => fetch(`data/${n}.json`).then((r) => {
      if (!r.ok) throw new Error("Failed to load data/" + n + ".json");
      return r.json();
    })));
    names.forEach((n, i) => (seed[n] = res[i]));
  }
  function get(collection) {
    const base = Array.isArray(seed[collection]) ? seed[collection] : [];
    const extra = overlay[collection] || [];
    const patches = (overlay.__patches && overlay.__patches[collection]) || {};
    return extra.concat(base).map((x) => (patches[x.id] ? Object.assign({}, x, patches[x.id]) : x));
  }
  // 局部更新（演示中修改任务状态、进度等）；真实版对应 PATCH /collection/:id
  function patch(collection, id, changes) {
    overlay.__patches = overlay.__patches || {};
    overlay.__patches[collection] = overlay.__patches[collection] || {};
    overlay.__patches[collection][id] = Object.assign({}, overlay.__patches[collection][id] || {}, changes);
    write(OVERLAY_KEY, overlay);
    return find(collection, id);
  }
  function raw(collection) { return seed[collection]; }
  function find(collection, id) { return get(collection).find((x) => x.id === id); }
  function add(collection, item) {
    if (!item.id) item.id = collection.slice(0, 3) + "-" + Date.now().toString(36);
    item._local = true;
    overlay[collection] = [item].concat(overlay[collection] || []);
    write(OVERLAY_KEY, overlay);
    return item;
  }
  // 用户状态（报名/加入/点赞/打招呼）
  function getState(ns, id) { return !!(state[ns] && state[ns][id]); }
  function setState(ns, id, val) {
    state[ns] = state[ns] || {};
    if (val) state[ns][id] = true; else delete state[ns][id];
    write(STATE_KEY, state);
    return !!val;
  }
  function toggleState(ns, id) { return setState(ns, id, !getState(ns, id)); }
  function countState(ns) { return Object.keys(state[ns] || {}).length; }
  function resetDemo() { localStorage.removeItem(OVERLAY_KEY); localStorage.removeItem(STATE_KEY); overlay = {}; state = {}; if (YL.audit) YL.audit.clear(); }
  // 分类词条辅助：taxonomy.json 里的 {industries:[{id,label}], ...}
  function term(group, id) {
    const tax = seed.taxonomy || {};
    const list = tax[group] || [];
    return list.find((x) => x.id === id) || { id, label: { zh: id, en: id } };
  }
  function terms(group) { return ((seed.taxonomy || {})[group]) || []; }
  // 作者/用户解析：'me' 表示当前登录用户（演示中新建内容的作者）
  function user(id) {
    if (id === "me" && YL.auth && YL.auth.isLoggedIn()) {
      const s = YL.auth.user(); const p = s.profile || {};
      return { id: "me", name: p.name || s.email.split("@")[0], school: p.school || "yc", classYear: p.classYear || "", region: p.region || "", industry: p.industry || "", title: { zh: "社区成员", en: "Community member" }, company: "", offers: p.offers || [], skills: [], bio: "", points: 0, badges: [], isMe: true };
    }
    return get("users").find((u) => u.id === id);
  }
  function region(id) { return (seed.regions || []).find((r) => r.id === id) || { id, name: { zh: id, en: id }, emoji: "📍" }; }
  return { load, get, raw, find, add, patch, getState, setState, toggleState, countState, resetDemo, term, terms, region, user };
})();
