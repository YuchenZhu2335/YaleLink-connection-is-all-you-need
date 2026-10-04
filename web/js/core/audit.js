/* 审计日志 — 记录"谁、何时、对哪条数据、做了什么、是否被允许"
   Audit log — who did what to which record, when, and whether it was allowed.

   - 原型：由 YL.api 的本地实现自动写入（模块不直接调用），存 localStorage，只保留最近 MAX 条；
   - 真实版：由服务端写入只追加（append-only）的 audit_log 表；前端只读、不可伪造。
   - 隐私最小化：只记 id 与动作，不记正文（留言、回复等内容不进日志）。

   entry = { id, at, actor, op, target, ok, code }
     actor  操作者 user id（未登录为 null）
     op     "POST /coffee/requests/:id/accept"（路由模板，而不是具体路径）
     target 被操作记录的 id
     ok     是否成功；被拒绝的尝试同样记录，code 为错误码（如 "forbidden"） */
window.YL = window.YL || {};
YL.audit = (function () {
  const KEY = "yl.audit";
  const MAX = 200;
  let entries = read();

  function read() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) { /* 存储已满或被禁用时不影响业务 */ }
  }
  // 时间与 id 由日志自己生成，调用方不能指定（防止伪造时间）
  function record(entry) {
    const e = Object.assign({ actor: null, op: "", target: null, ok: true, code: null }, entry, {
      id: "au-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString()
    });
    entries.unshift(e);
    if (entries.length > MAX) entries.length = MAX;
    save();
    return Object.assign({}, e);
  }
  // list({ actor, match, limit }) —— 新的在前；match 是 op 里包含的片段，如 "/coffee/"
  function list(filter) {
    const f = filter || {};
    return entries
      .filter((e) => (f.actor == null || e.actor === f.actor) && (!f.match || e.op.indexOf(f.match) >= 0))
      .slice(0, f.limit || MAX)
      .map((e) => Object.assign({}, e));
  }
  // 只用于"清空演示数据"。真实版的审计日志不可删除。
  function clear() { entries = []; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  return { record, list, clear, MAX };
})();
