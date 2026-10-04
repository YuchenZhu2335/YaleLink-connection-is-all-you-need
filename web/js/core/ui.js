/* UI 工具：转义、渲染小部件、toast、modal、日期 */
window.YL = window.YL || {};
YL.ui = (function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 数据里的外部链接只放行 http(s) / mailto，挡住 javascript: 等协议注入；返回值已转义，可直接放进 href。不合法时返回 ""
  const safeUrl = (u) => { const s = String(u == null ? "" : u).trim(); return /^(https?:\/\/|mailto:)/i.test(s) ? esc(s) : ""; };
  const t = (k, v) => YL.i18n.t(k, v);
  const L = (f) => YL.i18n.L(f);
  // 接口错误 → 提示文案：先找模块自己的 <ns>.err.<reason>，没有就用通用的 api.err.<code>（返回纯文本，插入 HTML 时仍需 esc）
  function errorText(error, ns) {
    const e = error || {};
    if (ns && e.reason) { const key = ns + ".err." + e.reason; const s = t(key); if (s !== key) return s; }
    return t("api.err." + (e.code || "internal"));
  }
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const AVATAR_COLORS = ["#00356B", "#286DC0", "#63AAFF", "#5F712D", "#BD5319", "#978D85", "#4A4A4A", "#7B3F9E"];
  function avatar(name, size) {
    const n = L(name) || "?";
    let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const bg = AVATAR_COLORS[h % AVATAR_COLORS.length];
    const initials = /^[一-龥]/.test(n) ? n.slice(-2) : n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return `<span class="avatar ${size ? "avatar--" + size : ""}" style="background:${bg}" aria-hidden="true">${esc(initials)}</span>`;
  }
  function tag(label, cls) { return `<span class="tag ${cls || ""}">${esc(L(label))}</span>`; }
  function tags(list, cls) { return (list || []).map((x) => tag(x, cls)).join(""); }
  function emptyState(icon, text, actionHtml) {
    return `<div class="empty"><div class="empty__icon">${icon || "🗂️"}</div><p>${esc(text)}</p>${actionHtml || ""}</div>`;
  }
  function sectionTitle(title, actionHtml, sub) {
    return `<div class="section-head"><div><h2 class="section-title">${esc(title)}</h2>${sub ? `<p class="section-sub">${esc(sub)}</p>` : ""}</div>${actionHtml || ""}</div>`;
  }
  // cls：额外的容器 class，如 "chips--scroll"
  function chips(items, activeId, attr, cls) {
    return `<div class="chips${cls ? " " + esc(cls) : ""}">${items.map((it) => `<button class="chip ${it.id === activeId ? "is-active" : ""}" data-${attr || "chip"}="${esc(it.id)}">${esc(L(it.label || it.name))}</button>`).join("")}</div>`;
  }
  // it.badge：可选的角标数字（如未读数）
  function tabs(items, activeId, baseHref) {
    return `<nav class="tabs" role="tablist">${items.map((it) => `<a role="tab" class="tab ${it.id === activeId ? "is-active" : ""}" href="${baseHref}/${it.id}">${it.icon ? it.icon + " " : ""}${esc(t(it.labelKey))}${it.badge ? ` <span class="badge badge--warn">${esc(it.badge)}</span>` : ""}</a>`).join("")}</nav>`;
  }
  function stat(value, label) { return `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`; }

  function formatDate(iso, opts) {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d)) return iso;
    const lang = YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US";
    return d.toLocaleDateString(lang, opts || { year: "numeric", month: "short", day: "numeric" });
  }
  function daysUntil(iso) {
    const d = new Date(iso + "T00:00:00"); const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }
  function deadlineBadge(iso) {
    const n = daysUntil(iso);
    if (n < 0) return `<span class="badge badge--muted">${t("common.closed")}</span>`;
    if (n <= 7) return `<span class="badge badge--warn">${t("common.daysLeft", { n })}</span>`;
    return `<span class="badge">${t("common.daysLeft", { n })}</span>`;
  }

  let toastTimer;
  function toast(msg, kind) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.className = "toast is-visible " + (kind ? "toast--" + kind : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
  }
  function modal(html, opts) {
    closeModal();
    const wrap = document.createElement("div");
    wrap.className = "modal"; wrap.id = "modal";
    wrap.innerHTML = `<div class="modal__backdrop"></div><div class="modal__panel" role="dialog" aria-modal="true">
      <button class="modal__close" aria-label="close">✕</button>${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("has-modal");
    wrap.querySelector(".modal__backdrop").onclick = closeModal;
    wrap.querySelector(".modal__close").onclick = closeModal;
    if (opts && opts.onMount) opts.onMount(wrap.querySelector(".modal__panel"));
    return wrap;
  }
  function closeModal() { const m = $("#modal"); if (m) m.remove(); document.body.classList.remove("has-modal"); }
  function formValues(form) { const o = {}; new FormData(form).forEach((v, k) => { if (o[k] != null) { o[k] = [].concat(o[k], v); } else o[k] = v; }); return o; }
  function userLink(u) { return u ? `<a class="user-link" href="#/directory/u/${esc(u.id)}">${avatar(u.name, "xs")} ${esc(L(u.name))}</a>` : ""; }
  function num(n) { return new Intl.NumberFormat(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US").format(n || 0); }

  return { esc, safeUrl, t, L, errorText, $, $$, avatar, tag, tags, emptyState, sectionTitle, chips, tabs, stat, formatDate, daysUntil, deadlineBadge, toast, modal, closeModal, formValues, userLink, num };
})();
