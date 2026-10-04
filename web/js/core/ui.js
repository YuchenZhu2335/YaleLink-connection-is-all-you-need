/* 界面工具：转义、图标、小部件、表单错误、toast、弹窗、复制、日期
   UI helpers shared by every module. 插入 HTML 的动态内容一律先 esc()；数据里的链接用 safeUrl()。 */
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

  /* ---------- 图标：24×24 线性描边，颜色跟随文字（currentColor）---------- */
  const ICONS = {
    coffee: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/>',
    people: '<circle cx="9" cy="8" r="3.25"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 4.9a3.25 3.25 0 0 1 0 6.2M18 14.4c1.6.7 2.7 2.3 3 4.6"/>',
    inbox: '<path d="M4 13l2.2-7.1A1.5 1.5 0 0 1 7.6 5h8.8a1.5 1.5 0 0 1 1.4.9L20 13v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-5z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
    // 灯拱：拱门里一盏灯（logo 的线性版本）。用在"匹配"、"TA 想认识你"
    arch: '<path d="M6 20v-8a6 6 0 0 1 12 0v8"/><circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none"/>',
    alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4.5M12 17v.01"/>',
    alertCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V13M12 16.25v.01"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
    chevronDown: '<path d="M5 9l7 7 7-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.01"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
    logout: '<path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    shield: '<path d="M12 3.5l7 2.5v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6l7-2.5z"/>',
    mapPin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.25"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17"/>',
    cap: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14 2.5 9.5z"/><path d="M6.5 11.5v4c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4M21.5 9.5v5"/>',
    message: '<path d="M4.5 19.5V6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v9a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3z"/>',
    trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    edit: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4v5h-5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  // 兼容：sparkle 已弃用（看起来像 AI 标记），统一画成灯拱
  ICONS.sparkle = ICONS.arch;
  // iOS 上 :active 需要一个空的触摸监听才会生效
  document.addEventListener("touchstart", () => {}, { passive: true });
  // icon("coffee") / icon("check", { size: 16, label: "已完成" })；不认识的名字返回空串
  function icon(name, opts) {
    const o = opts || {}, body = ICONS[name];
    if (!body) return "";
    const size = o.size || 20;
    const a11y = o.label ? `role="img" aria-label="${esc(o.label)}"` : 'aria-hidden="true" focusable="false"';
    return `<svg class="icon${o.cls ? " " + esc(o.cls) : ""}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
  }

  /* ---------- 小部件 ---------- */
  // 头像：名字首字（中文取后两个字），颜色按名字固定分配（.avatar--c0 … c5，见 components.css）
  function avatar(name, size) {
    const n = L(name) || "?";
    let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const initials = /^[一-龥]/.test(n) ? n.slice(-2) : n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return `<span class="avatar avatar--c${h % 6}${size ? " avatar--" + esc(size) : ""}" aria-hidden="true">${esc(initials)}</span>`;
  }
  function tag(label, cls) { return `<span class="tag${cls ? " " + esc(cls) : ""}">${esc(L(label))}</span>`; }
  function tags(list, cls) { return (list || []).map((x) => tag(x, cls)).join(""); }
  function emptyState(iconName, text, actionHtml) {
    return `<div class="empty">${iconName ? `<div class="empty__icon">${icon(iconName, { size: 28 })}</div>` : ""}<p>${esc(text)}</p>${actionHtml || ""}</div>`;
  }
  function sectionTitle(title, actionHtml, sub) {
    return `<div class="section-head"><div><h2 class="section-title">${esc(title)}</h2>${sub ? `<p class="section-sub">${esc(sub)}</p>` : ""}</div>${actionHtml || ""}</div>`;
  }
  // 可选择的标签组：items = [{ id, label }]；cls 为额外 class（如 "chips--scroll"）
  function chips(items, activeId, attr, cls) {
    return `<div class="chips${cls ? " " + esc(cls) : ""}">${items.map((it) => `<button type="button" class="chip${it.id === activeId ? " is-active" : ""}" aria-pressed="${it.id === activeId}" data-${attr || "chip"}="${esc(it.id)}">${esc(L(it.label || it.name))}</button>`).join("")}</div>`;
  }
  // 页内标签页（链接形式，可前进后退）：items = [{ id, labelKey, badge? }]
  function tabs(items, activeId, baseHref) {
    return `<nav class="tabs" aria-label="tabs">${items.map((it) => `<a class="tab${it.id === activeId ? " is-active" : ""}"${it.id === activeId ? ' aria-current="page"' : ""} href="${baseHref}/${esc(it.id)}">${esc(t(it.labelKey))}${it.badge ? ` <span class="count">${esc(it.badge)}</span>` : ""}</a>`).join("")}</nav>`;
  }
  function stat(value, label) { return `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`; }
  function spinner() { return `<div class="loading" role="status" aria-live="polite"><span class="loading__dot"></span><span class="sr-only">${esc(t("common.loading"))}</span></div>`; }

  /* ---------- 表单 ---------- */
  // 把接口返回的 fields（{ name: "required" }）显示到表单对应的 [data-field="name"] 下面
  // 文案优先 <ns>.field.<name>.<code>，其次 <ns>.field.<code>，最后 common.field.<code>
  function showFieldErrors(form, fields, ns) {
    clearFieldErrors(form);
    let first = null;
    Object.keys(fields || {}).forEach((name) => {
      const code = fields[name];
      const box = form.querySelector(`[data-field="${CSS.escape(name)}"]`);
      const keys = [ns && `${ns}.field.${name}.${code}`, ns && `${ns}.field.${code}`, `common.field.${code}`].filter(Boolean);
      const key = keys.find((k) => t(k) !== k) || "common.field.invalid";
      if (!box) { toast(t(key), "error"); return; }
      box.classList.add("is-invalid");
      const msg = document.createElement("p");
      msg.className = "field__error";
      msg.textContent = t(key);
      box.appendChild(msg);
      const input = box.querySelector("input, textarea, select, button");
      if (input) input.setAttribute("aria-invalid", "true");
      if (!first) first = input || box;
    });
    if (first && first.focus) first.focus();
  }
  function clearFieldErrors(form) {
    $$(".field__error", form).forEach((x) => x.remove());
    $$(".is-invalid", form).forEach((x) => x.classList.remove("is-invalid"));
    $$("[aria-invalid]", form).forEach((x) => x.removeAttribute("aria-invalid"));
  }
  // 按钮"处理中"：防止重复提交
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle("is-busy", !!on);
    if (on) btn.setAttribute("aria-busy", "true"); else btn.removeAttribute("aria-busy");
  }
  function formValues(form) { const o = {}; new FormData(form).forEach((v, k) => { if (o[k] != null) { o[k] = [].concat(o[k], v); } else o[k] = v; }); return o; }

  /* ---------- 反馈 ---------- */
  let toastTimer;
  function toast(msg, kind) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
    el.textContent = msg;
    el.className = "toast is-visible" + (kind ? " toast--" + kind : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
  }
  // 弹窗（手机上从底部弹出）：html 由调用方保证已转义
  function modal(html, opts) {
    closeModal();
    const o = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "modal"; wrap.id = "modal";
    wrap.innerHTML = `<div class="modal__backdrop"></div><div class="modal__panel" role="dialog" aria-modal="true"${o.label ? ` aria-label="${esc(o.label)}"` : ""}>
      <button type="button" class="modal__close icon-btn" aria-label="${esc(t("common.close"))}">${icon("x")}</button>${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("has-modal");
    const back = document.activeElement;
    const close = () => { closeModal(); if (back && back.focus) back.focus(); };
    wrap.querySelector(".modal__backdrop").onclick = close;
    wrap.querySelector(".modal__close").onclick = close;
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    const panel = wrap.querySelector(".modal__panel");
    const focusable = panel.querySelector("input, textarea, select, button:not(.modal__close), a[href]");
    (focusable || panel.querySelector(".modal__close")).focus();
    if (o.onMount) o.onMount(panel, close);
    return wrap;
  }
  function closeModal() { const m = $("#modal"); if (m) m.remove(); document.body.classList.remove("has-modal"); }
  // 确认框：返回 Promise<boolean>
  function confirm(message, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; closeModal(); resolve(v); } };
      const w = modal(`<div class="confirm"><p class="confirm__text">${esc(message)}</p>
        <div class="confirm__actions"><button type="button" class="btn btn--secondary" data-act="no">${esc(o.cancel || t("common.cancel"))}</button>
        <button type="button" class="btn ${o.danger ? "btn--danger" : "btn--primary"}" data-act="yes">${esc(o.ok || t("common.ok"))}</button></div></div>`);
      w.querySelector('[data-act="yes"]').onclick = () => finish(true);
      w.querySelector('[data-act="no"]').onclick = () => finish(false);
      new MutationObserver((m, obs) => { if (!document.body.contains(w)) { obs.disconnect(); finish(false); } }).observe(document.body, { childList: true });
    });
  }
  // 复制到剪贴板（微信内置浏览器不一定支持 clipboard API，退回到选中文本的老办法）
  async function copy(text) {
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
    }
    toast(t(ok ? "common.copied" : "common.copyFailed"), ok ? "success" : "error");
    return ok;
  }

  /* ---------- 日期与数字 ---------- */
  const locale = () => (YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US");
  function formatDate(iso, opts) {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T12:00:00Z" : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(locale(), Object.assign({ timeZone: iso.length <= 10 ? "UTC" : undefined }, opts || { month: "short", day: "numeric" }));
  }
  function formatDateTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString(locale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function num(n) { return new Intl.NumberFormat(locale()).format(n || 0); }

  return { esc, safeUrl, t, L, errorText, $, $$, icon, ICONS, avatar, tag, tags, emptyState, sectionTitle, chips, tabs, stat, spinner,
    showFieldErrors, clearFieldErrors, busy, formValues, toast, modal, closeModal, confirm, copy, formatDate, formatDateTime, num };
})();
