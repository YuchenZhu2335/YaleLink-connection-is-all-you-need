/* i18n — t(key) 取界面词典；L(field) 取数据里的 {zh, en} 双语字段 */
window.YL = window.YL || {};
YL.i18n = (function () {
  const KEY = "yl.lang";
  const LANGS = ["zh", "en"];
  let lang = localStorage.getItem(KEY) || YL_CONFIG.defaultLang;
  if (!LANGS.includes(lang)) lang = "zh";
  let dict = { zh: {}, en: {} };

  async function load() {
    const res = await Promise.all(LANGS.map((l) => fetch(`i18n/${l}.json`).then((r) => r.json())));
    LANGS.forEach((l, i) => (dict[l] = res[i]));
    applyHtmlLang();
  }
  function applyHtmlLang() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }
  function t(key, vars) {
    let s = dict[lang][key];
    if (s == null) s = dict.en[key];
    if (s == null) s = key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }
  function L(field) {
    if (field == null) return "";
    if (typeof field !== "object") return String(field);
    // 当前语言没填（或是空字符串）就用另一种语言
    const pick = (v) => (v != null && String(v).trim() !== "" ? v : null);
    return pick(field[lang]) || pick(field.zh) || pick(field.en) || "";
  }
  function setLang(l) {
    if (!LANGS.includes(l) || l === lang) return;
    lang = l;
    localStorage.setItem(KEY, l);
    applyHtmlLang();
    window.dispatchEvent(new CustomEvent("yl:langchange", { detail: { lang } }));
  }
  function toggle() { setLang(lang === "zh" ? "en" : "zh"); }
  function getLang() { return lang; }
  function keys(prefix) { return Object.keys(dict.zh).filter((k) => k.startsWith(prefix)); }
  return { load, t, L, setLang, toggle, getLang, keys, LANGS };
})();
