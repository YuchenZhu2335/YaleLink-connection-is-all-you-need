/* 关于 Yalelux、隐私说明、意见箱（页脚链接进来，不在导航里）
   About, privacy notice and feedback box — linked from the footer.

   #/about            Yalelux 是什么、谁在做、第一期做什么 / 故意不做什么、怎么匹配、怎么联系我们
   #/about/privacy    完整的隐私说明（版本号 = GET /meta 的 consentVersion）
   #/about/feedback   意见箱：只需登录（接口只要求登录）→ POST /feedback { kind, text } → 感谢

   文案都在词典里（about.*）；隐私说明改了内容要同时升后端的 CONSENT_VERSION，让大家重新确认。 */
(function () {
  "use strict";
  const { t, esc, icon } = YL.ui;
  const D = YL.domain.coffee;
  const KINDS = [["bug", "alertCircle"], ["idea", "sun"], ["other", "message"]];

  // 表单逐项报错由 YL.ui.showFieldErrors(form, fields, "about") 显示，用到的文案：
  //   t("about.field.kind.invalid")、t("about.field.text.too_short")、t("about.field.text.too_long")
  // 意见箱草稿：切换语言会重绘页面，写到一半的内容不能丢（只在内存里，不持久化）。
  // 草稿记着是谁写的：退出登录不刷新页面，同一个标签页里换人登录时不能看到上一个人没发出的内容。
  const uid = () => { const u = YL.auth.user(); return u ? u.id : ""; };
  const blankDraft = (owner) => ({ uid: owner || "", kind: "", text: "" });
  let draft = blankDraft();
  const myDraft = () => { if (draft.uid !== uid()) draft = blankDraft(uid()); return draft; };
  // 正在发送 / 刚发出去但页面已经重绘（比如中途切了语言）：新页面接着显示结果，不让人重复发
  let sending = null;   // { uid, promise }
  let sentFor = "";     // 发送成功、但当时的页面已经不在了：下次打开意见箱先显示"收到了"
  function send(input) {
    const owner = uid();
    const promise = YL.api.post("/feedback", input);
    sending = { uid: owner, promise };
    promise.then((r) => {
      if (sending && sending.promise === promise) sending = null;
      if (r.ok) { if (draft.uid === owner) draft = blankDraft(owner); sentFor = owner; }
    });
    return promise;
  }

  const notice = (kind, iconName, bodyHtml, role) => `<div class="notice${kind ? " notice--" + kind : ""}"${role ? ` role="${role}"` : ""}>${icon(iconName)}<div class="notice__body">${bodyHtml}</div></div>`;
  function head(eyebrow, title, sub, extra) {
    return `
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">${esc(eyebrow)}</p>
          <h1 class="page-title">${esc(title)}</h1>
          ${sub ? `<p class="page-sub">${esc(sub)}</p>` : ""}
          ${extra || ""}
        </div>
      </header>`;
  }
  const section = (id, title, inner, cls) => `
      <section class="${cls || "stack stack--s"}" aria-labelledby="${id}">
        <h2 class="section-title" id="${id}">${esc(title)}</h2>
        ${inner}
      </section>`;
  // 短列表（每条前面的灯点由 CSS 画）
  const bullets = (items) => `<ul class="person__reasons">${items.map((text) => `<li class="reason"><span>${esc(text)}</span></li>`).join("")}</ul>`;
  // 不用登录也能找到我们：对外联系邮箱（YL_CONFIG.contactEmail，PRD §9 第 6 条）；还没配置时退回学联官网
  function reachHtml() {
    const email = String(YL_CONFIG.contactEmail || "").trim();
    const mail = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? YL.ui.safeUrl("mailto:" + email) : "";
    if (mail) {
      return `<p class="muted">${esc(t("about.reach.email"))}</p>
          <div><a class="btn btn--secondary" href="${mail}">${icon("mail")}<span class="break-all">${esc(email)}</span></a></div>`;
    }
    const site = YL.ui.safeUrl(YL_CONFIG.acssy);
    if (!site) return "";
    return `<p class="muted">${esc(t("about.reach.site"))}</p>
          <div><a class="btn btn--secondary" href="${site}" target="_blank" rel="noopener">${icon("external")}${esc(t("about.reach.siteLink"))}</a></div>`;
  }
  // 竖排中英 tagline 组合（设计规范 §9 第 3 种，居中）：图形标 → 字标 → 中文 tagline → 英文 tagline。
  // 两行 tagline 不随界面语言变，所以用 about.lockup.zh / about.lockup.en 两个固定的键。
  // 图形标放在行内的 .brand 里（img 在 base.css 里是块级，只有放进行内盒子才能被 .center 居中）
  const lockupHtml = () => `
          <div class="card card--quiet stack stack--s center" data-lockup>
            <div><span class="brand"><img src="assets/brand/mark.svg" alt="" width="44" height="44"></span></div>
            <p><span class="wordmark">yale<i>lux</i></span></p>
            <p class="muted" lang="zh-CN">${esc(t("about.lockup.zh"))}</p>
            <p class="small faint" lang="en">${esc(t("about.lockup.en"))}</p>
          </div>`;
  // 标题 + 说明 的列表：items = [[标题, 说明]]
  const rows = (items) => `<ul class="list">${items.map(([title, sub]) => `
        <li class="list__item"><div class="list__main"><p class="list__title">${esc(title)}</p><p class="list__sub">${esc(sub)}</p></div></li>`).join("")}</ul>`;

  /* ---------- #/about ---------- */
  function viewAbout(root) {
    const gh = YL.ui.safeUrl(YL_CONFIG.github);
    const notHere = [["feed", "x"], ["likes", "x"], ["chat", "x"]].map(([id, ic]) => `
        <li class="list__item">${icon(ic)}<div class="list__main"><p class="list__title">${esc(t("about.not." + id + ".title"))}</p><p class="list__sub">${esc(t("about.not." + id + ".sub"))}</p></div></li>`).join("");
    root.innerHTML = `
      <section class="page page--medium" data-about>
        ${head(t("about.eyebrow"), t("about.title"), t("about.sub"))}
        <section class="card stack" aria-labelledby="ab-name">
          <h2 class="section-title" id="ab-name">${esc(t("about.name.title"))}</h2>
          <p>${esc(t("about.name.text"))}</p>
          ${lockupHtml()}
        </section>
        ${section("ab-team", t("about.team.title"), `
          <p>${esc(t("about.team.text"))}</p>
          <p class="small muted" data-unofficial>${esc(t("brand.unofficialFull"))}</p>
          <p class="muted">${esc(t("about.team.oss"))}</p>
          ${gh ? `<div><a class="btn btn--secondary btn--sm" href="${gh}" target="_blank" rel="noopener">${icon("external")}${esc(t("about.team.github"))}</a></div>` : ""}`)}
        ${section("ab-now", t("about.now.title"), `<p>${esc(t("about.now.text"))}</p>`)}
        ${section("ab-how", t("about.how.title"), bullets([t("about.how.s1"), t("about.how.s2"), t("about.how.s3"), t("about.how.s4")]))}
        ${section("ab-not", t("about.not.title"), `<p class="muted">${esc(t("about.not.intro"))}</p><ul class="list">${notHere}</ul>`)}
        <section class="card card--quiet stack" aria-labelledby="ab-contact">
          <div class="stack stack--s">
            <h2 class="section-title" id="ab-contact">${esc(t("about.contact.title"))}</h2>
            <p class="muted">${esc(t("about.contact.text"))}</p>
          </div>
          <div class="cluster">
            <a class="btn btn--primary" href="#/about/feedback">${icon("message")}${esc(t("about.contact.feedback"))}</a>
            <a class="btn btn--ghost" href="#/about/privacy">${icon("shield")}${esc(t("nav.privacy"))}</a>
          </div>
          ${reachHtml()}
        </section>
      </section>`;
  }

  /* ---------- #/about/privacy ---------- */
  const COLLECT = ["loginEmail", "contactEmail", "profile", "slots", "invites", "settings", "feedback", "logs"];
  const SEE = ["others", "invited", "mutual", "admin", "server", "nobody"];
  const EMAILS = ["code", "match", "scheduled", "digest", "reminder", "weekly", "event"];
  const LEFT = ["audit", "firstCode", "recs", "backup", "sent"];   // 注销后还会留下的（对照 server/auth.js 的 POST /me/delete）
  // 智能推荐现在的状态：服务开没开（GET /meta 的 smartRecAvailable），登录了再说你自己的开关
  function aiNow() {
    if (!(YL.auth.meta() || {}).smartRecAvailable) return t("about.privacy.ai.now.off");
    const u = YL.auth.user();
    if (!u) return t("about.privacy.ai.now.on");
    return u.smartRec === false ? t("about.privacy.ai.now.mineOff") : t("about.privacy.ai.now.mineOn");
  }
  function viewPrivacy(root) {
    const v = (YL.auth.meta() || {}).consentVersion;
    const manage = YL.auth.isReady() ? `<p><a href="#/profile">${esc(t("about.privacy.manage"))}</a></p>` : "";
    const table = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">${esc(t("about.privacy.see.who"))}</th><th scope="col">${esc(t("about.privacy.see.what"))}</th></tr></thead>
            <tbody>${SEE.map((id) => `<tr><td><strong>${esc(t("about.privacy.see." + id + ".who"))}</strong></td><td>${esc(t("about.privacy.see." + id + ".what"))}</td></tr>`).join("")}</tbody>
          </table>
        </div>`;
    root.innerHTML = `
      <section class="page page--medium" data-about>
        ${head(t("about.privacy.eyebrow"), t("about.privacy.title"), t("about.privacy.intro"),
          v ? `<p class="cluster"><span class="pill">${icon("shield")}${esc(t("about.privacy.version", { v }))}</span></p>` : "")}
        ${notice("info", "info", `<p><strong>${esc(t("about.privacy.summaryTitle"))}</strong></p><p>${esc(t("about.privacy.summary"))}</p>${manage}`)}
        ${section("pv-collect", t("about.privacy.collect.title"), `<p class="muted">${esc(t("about.privacy.collect.intro"))}</p>${rows(COLLECT.map((id) => [t("about.privacy.collect." + id + ".title"), t("about.privacy.collect." + id + ".sub")]))}`)}
        ${section("pv-see", t("about.privacy.see.title"), `<p class="muted">${esc(t("about.privacy.see.intro"))}</p>${table}`)}
        ${section("pv-email", t("about.privacy.email.title"), `<p class="muted">${esc(t("about.privacy.email.intro"))}</p>${rows(EMAILS.map((id) => [t("about.privacy.email." + id + ".title"), t("about.privacy.email." + id + ".sub")]))}<p>${esc(t("about.privacy.email.unsub"))}</p>`)}
        ${section("pv-ai", t("about.privacy.ai.title"), `<p>${esc(t("about.privacy.ai.p1"))}</p><p>${esc(t("about.privacy.ai.p2"))}</p><p>${esc(t("about.privacy.ai.p3"))}</p>${notice("info", "info", `<p>${esc(aiNow())}</p>`)}`)}
        ${section("pv-delete", t("about.privacy.delete.title"), `<p>${esc(t("about.privacy.delete.keep"))}</p><p>${esc(t("about.privacy.delete.p1"))}</p><p>${esc(t("about.privacy.delete.left"))}</p>${bullets(LEFT.map((id) => t("about.privacy.delete.left." + id)))}`)}
        ${section("pv-security", t("about.privacy.security.title"), bullets([t("about.privacy.security.cookie"), t("about.privacy.security.audit"), t("about.privacy.security.secrets")]))}
        ${section("pv-changes", t("about.privacy.changes.title"), `<p>${esc(t("about.privacy.changes.text"))}</p>`)}
        <section class="card card--quiet stack" aria-labelledby="pv-contact">
          <div class="stack stack--s">
            <h2 class="section-title" id="pv-contact">${esc(t("about.privacy.contact.title"))}</h2>
            <p class="muted">${esc(t("about.privacy.contact.text"))}</p>
          </div>
          <div><a class="btn btn--primary" href="#/about/feedback">${icon("message")}${esc(t("about.contact.feedback"))}</a></div>
          ${reachHtml()}
        </section>
      </section>`;
  }

  /* ---------- #/about/feedback ---------- */
  const textLen = (s) => String(s || "").trim().length;
  function clearOne(field) {
    field.classList.remove("is-invalid");
    YL.ui.$$(".field__error", field).forEach((x) => x.remove());
    YL.ui.$$("[aria-invalid]", field).forEach((x) => x.removeAttribute("aria-invalid"));
  }
  function formHtml() {
    const draft = myDraft();
    const max = D.LIMITS.feedbackMax;
    const chips = KINDS.map(([k, ic]) => `
          <label class="choice"><input type="radio" class="sr-only" name="kind" value="${k}"${draft.kind === k ? " checked" : ""}><span class="chip">${icon(ic)}${esc(t("about.feedback.kind." + k))}</span></label>`).join("");
    return `
      <form class="form card" novalidate data-fb-form>
        <div class="field" data-field="kind">
          <span class="field__label" id="fb-kind">${esc(t("about.feedback.kind"))}<span class="req" aria-hidden="true">*</span></span>
          <div class="chips" role="radiogroup" aria-labelledby="fb-kind" aria-required="true">${chips}</div>
        </div>
        <div class="field" data-field="text">
          <label class="field__label" for="fb-text">${esc(t("about.feedback.text"))}<span class="req" aria-hidden="true">*</span></label>
          <textarea class="textarea" id="fb-text" name="text" rows="6" maxlength="${max}" required aria-describedby="fb-hint fb-count" placeholder="${esc(t("about.feedback.placeholder"))}">${esc(draft.text)}</textarea>
          <p class="field__hint" id="fb-hint">${esc(t("about.feedback.hint"))}</p>
          <p class="field__count" id="fb-count">${esc(t("about.feedback.count", { n: textLen(draft.text), max }))}</p>
        </div>
        <div data-msg hidden></div>
        <button type="submit" class="btn btn--primary btn--block btn--lg" data-busy-label="${esc(t("about.feedback.sending"))}">${esc(t("about.feedback.submit"))}</button>
      </form>`;
  }
  function doneHtml() {
    return `
      <div class="card stack">
        ${notice("success", "check", `<h2 class="section-title" tabindex="-1" data-focus>${esc(t("about.feedback.thanksTitle"))}</h2><p>${esc(t("about.feedback.thanksText"))}</p>`, "status")}
        <div class="cluster">
          <button type="button" class="btn btn--secondary" data-act="again">${icon("edit")}${esc(t("about.feedback.again"))}</button>
          ${YL.auth.isReady()
            ? `<a class="btn btn--ghost" href="#/coffee">${icon("coffee")}${esc(t("about.feedback.toCoffee"))}</a>`
            : `<a class="btn btn--ghost" href="#/home">${esc(t("router.goHome"))}</a>`}
        </div>
      </div>`;
  }
  function viewFeedback(root, ctx) {
    const top = head(t("about.feedback.eyebrow"), t("about.feedback.title"), t("about.feedback.sub"));
    if (!YL.auth.isLoggedIn()) {
      root.innerHTML = `
        <section class="page page--narrow" data-about>
          ${top}
          <div class="card stack">
            ${notice("info", "info", `<p><strong>${esc(t("about.feedback.loginTitle"))}</strong></p><p>${esc(t("about.feedback.loginText"))}</p>`)}
            <a class="btn btn--primary btn--block btn--lg" href="#/login?next=about/feedback">${icon("mail")}${esc(t("about.feedback.login"))}</a>
            ${reachHtml()}
          </div>
        </section>`;
      return;
    }
    // 上一次发送在页面重绘前已经成功了：直接显示"收到了"
    const showDone = sentFor && sentFor === uid();
    if (showDone) sentFor = "";
    root.innerHTML = `<section class="page page--narrow" data-about>${top}<div data-fb-body>${showDone ? doneHtml() : formHtml()}</div></section>`;
    const page = root.querySelector("[data-about]");
    const body = page.querySelector("[data-fb-body]");

    // 发送完成后更新这一页（成功 → 感谢；失败 → 表单里报错）
    function settle(form, btn, r) {
      YL.ui.busy(btn, false);
      if (!r.ok) {
        if (r.error && r.error.fields) { YL.ui.showFieldErrors(form, r.error.fields, "about"); return; }
        const msg = form.querySelector("[data-msg]");
        msg.innerHTML = notice("danger", "alertCircle", `<p>${esc(YL.ui.errorText(r.error, "about"))}</p>`, "alert");
        msg.hidden = false;
        return;
      }
      sentFor = "";
      body.innerHTML = doneHtml();
      const h = body.querySelector("[data-focus]");
      if (h) h.focus();
    }
    // 重绘前发出的那一次还没回来：按钮保持"发送中"，回来后接着显示结果
    if (!showDone && sending && sending.uid === uid()) {
      const form = body.querySelector("[data-fb-form]");
      const btn = form.querySelector('button[type="submit"]');
      YL.ui.busy(btn, true);
      sending.promise.then((r) => { if (ctx.isActive() && body.contains(form)) settle(form, btn, r); });
    }

    page.addEventListener("input", (e) => {
      const form = e.target.closest("[data-fb-form]");
      if (!form) return;
      if (e.target.name === "text") {
        const d = myDraft();
        d.text = e.target.value;
        const c = form.querySelector("#fb-count");
        if (c) c.textContent = t("about.feedback.count", { n: textLen(d.text), max: D.LIMITS.feedbackMax });
      }
      const f = e.target.closest(".field.is-invalid");
      if (f) clearOne(f);
    });
    page.addEventListener("change", (e) => {
      if (e.target.name !== "kind") return;
      myDraft().kind = e.target.value;
      const f = e.target.closest(".field.is-invalid");
      if (f) clearOne(f);
    });
    page.addEventListener("click", (e) => {
      if (!e.target.closest('[data-act="again"]')) return;
      body.innerHTML = formHtml();
      const first = body.querySelector('input[name="kind"]');
      if (first) first.focus();
    });
    page.addEventListener("submit", async (e) => {
      const form = e.target.closest("[data-fb-form]");
      if (!form) return;
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn.disabled || sending) return;
      const msg = form.querySelector("[data-msg]");
      msg.hidden = true; msg.innerHTML = "";
      const checked = form.querySelector('input[name="kind"]:checked');
      const input = { kind: checked ? checked.value : "", text: String(form.elements.text.value || "").trim() };
      // 和后端同一套规则先查一遍，省一次来回
      const v = D.validateFeedback(input);
      if (!v.ok) { YL.ui.showFieldErrors(form, v.fields, "about"); return; }
      YL.ui.clearFieldErrors(form);
      YL.ui.busy(btn, true);
      // 草稿的清空和"已发送"的记录在 send() 里做，不受下面 isActive() 的影响
      const r = await send(input);
      if (!ctx.isActive() || !body.contains(form)) return;
      settle(form, btn, r);
    });
  }

  registerModule({
    id: "about",
    render(root, ctx) {
      switch (ctx.sub) {
        case "": return viewAbout(root, ctx);
        case "privacy": return viewPrivacy(root, ctx);
        case "feedback": return viewFeedback(root, ctx);
        default: YL.router.navigate("about", { replace: true });
      }
    }
  });
})();
