/* 登录：耶鲁邮箱 → 6 位验证码（同一页面两步，不刷新）
   Sign-in: Yale email → 6-digit code. 后端规则见 server/auth.js 与 docs/api.md「登录与账号」。

   #/login[?next=…]
   - 已登录：没完成首次填写 → #/profile/setup?next=…；否则回到 next（默认 coffee）
   - 老用户验证过联系邮箱时，验证码默认发到联系邮箱（via = "contact"），可以改发到耶鲁邮箱
   - 重发有 60 秒倒计时（后端同样限制）；切换语言时路由会重绘，进行中的步骤保存在模块内的 flow 里 */
(function () {
  const { t, esc, icon } = YL.ui;
  const RESEND_SECONDS = 60;
  const CODE_TTL_MS = 10 * 60000;

  // 表单逐项报错由 YL.ui.showFieldErrors(form, fields, "login") 显示，文案键为 t("login.field." + 字段 + "." + 错误码)
  // 进行中的登录：{ email, sentTo, via, forceYale, sentAt }；登录成功或"换一个邮箱"时清空
  let flow = null;
  let timer = null;

  // 把翻译好的句子转义后，再把 {占位符} 换成已转义的 HTML 片段
  const fill = (text, parts) => esc(text).replace(/\{(\w+)\}/g, (m, k) => (parts[k] != null ? parts[k] : m));
  const secondsLeft = () => (flow ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - flow.sentAt) / 1000)) : 0);

  function goOn(next) {
    if (!YL.auth.isReady()) YL.router.navigate("profile/setup?next=" + encodeURIComponent(next), { replace: true });
    else YL.router.navigate(next, { replace: true });
  }

  function render(root, ctx) {
    clearInterval(timer);
    const next = YL.router.safeNext(ctx.query.next, "coffee");
    if (YL.auth.isLoggedIn()) { goOn(next); return; }
    if (flow && Date.now() - flow.sentAt > CODE_TTL_MS) flow = null;

    const meta = YL.auth.meta();
    root.innerHTML = `
      <section class="page page--narrow" data-login>
        <header class="stack stack--s">
          <img src="assets/logo.svg" alt="" width="48" height="48">
          <h1 class="page-title">${esc(YL_CONFIG.siteName)}</h1>
          <p class="page-sub">${esc(t("brand.tagline"))}</p>
        </header>
        <div class="card" data-card></div>
        ${meta.dev ? `<div class="notice notice--warn">${icon("info")}<div class="notice__body"><strong>${esc(t("login.devTitle"))}</strong><span>${esc(t("login.devBody"))} <a href="/api/dev/outbox" target="_blank" rel="noopener">/api/dev/outbox</a></span></div></div>` : ""}
        <p class="xsmall faint">${fill(t("login.agree"), { link: `<a href="#/about/privacy">${esc(t("login.privacyLink"))}</a>` })}</p>
      </section>`;
    const el = root.querySelector("[data-login]");
    const card = el.querySelector("[data-card]");

    // 共用的小工具
    const msgBox = () => card.querySelector("[data-msg]");
    // 提示条：没有内容时隐藏（不占表单间距）；出现时用 role=alert / status 让读屏念出来
    function showMsg(text, kind) {
      const box = msgBox();
      if (!box) return;
      const ok = kind === "success";
      box.hidden = !text;
      box.innerHTML = text ? `<div class="notice notice--${ok ? "success" : "danger"}" role="${ok ? "status" : "alert"}">${icon(ok ? "check" : "info")}<div class="notice__body">${esc(text)}</div></div>` : "";
    }

    /* ---------- 第一步：邮箱 ---------- */
    function showEmail(focus) {
      clearInterval(timer);
      card.innerHTML = `
        <form class="form" data-form="email" novalidate>
          <div class="stack stack--s">
            <h2 class="card__title" tabindex="-1" data-focus>${esc(t("login.emailTitle"))}</h2>
            <p class="small muted">${esc(t("login.emailSub"))}</p>
          </div>
          <div class="field" data-field="email">
            <label class="field__label" for="login-email">${esc(t("login.emailLabel"))}</label>
            <input class="input" id="login-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required
              placeholder="${esc(t("login.emailPlaceholder"))}" aria-describedby="login-email-hint" value="${esc(flow ? flow.email : "")}">
            <p class="field__hint" id="login-email-hint">${esc(t("login.emailHint"))}</p>
          </div>
          <div data-msg hidden></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit">${esc(t("login.send"))}</button>
        </form>`;
      if (focus) card.querySelector("#login-email").focus();
    }

    async function sendCode(email, forceYale, btn) {
      const form = card.querySelector("form");
      YL.ui.clearFieldErrors(form);
      showMsg("");
      YL.ui.busy(btn, true);
      const r = await YL.auth.requestCode(email, forceYale ? "yale" : undefined);
      if (!ctx.isActive()) return;
      YL.ui.busy(btn, false);
      if (r.ok) {
        const resend = !!flow && flow.email === email;
        flow = { email, sentTo: r.data.sentTo, via: r.data.via, forceYale: !!forceYale, sentAt: Date.now() };
        showCode(true, resend ? t("login.resent") : "");
        return;
      }
      const e = r.error || {};
      if (e.fields) { YL.ui.showFieldErrors(form, e.fields, "login"); return; }
      // 60 秒内刚发过：验证码已经在路上了，直接去输入
      if (e.reason === "resend_too_soon" && (!flow || flow.email !== email)) {
        flow = { email, sentTo: "", via: "", forceYale: !!forceYale, sentAt: Date.now() };
        showCode(true);
        return;
      }
      showMsg(YL.ui.errorText(e, "login"));
    }

    /* ---------- 第二步：验证码 ---------- */
    function showCode(focus, notice) {
      const sent = flow.sentTo
        ? fill(t("login.sentTo"), { to: `<strong>${esc(flow.sentTo)}</strong>` })
        : esc(t("login.alreadySent"));
      card.innerHTML = `
        <form class="form" data-form="code" novalidate>
          <div class="stack stack--s">
            <h2 class="card__title" tabindex="-1" data-focus>${esc(t("login.codeTitle"))}</h2>
            <p class="muted" aria-live="polite">${sent}</p>
          </div>
          ${flow.via === "contact" ? `<div class="notice notice--info">${icon("mail")}<div class="notice__body"><span>${esc(t("login.viaContact"))}</span><span><button type="button" class="link-btn" data-act="use-yale">${esc(t("login.useYale"))}</button></span></div></div>` : ""}
          <div class="field" data-field="code">
            <label class="field__label" for="login-code">${esc(t("login.codeLabel"))}</label>
            <input class="input input--code" id="login-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-describedby="login-code-hint">
            <p class="field__hint" id="login-code-hint">${esc(t("login.codeHint"))}</p>
          </div>
          <div data-msg hidden></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" data-act="verify">${esc(t("login.verify"))}</button>
          <div class="cluster cluster--between">
            <button type="button" class="btn btn--ghost" data-act="resend">${esc(t("login.resend"))}</button>
            <button type="button" class="link-btn" data-act="change-email">${esc(t("login.changeEmail"))}</button>
          </div>
        </form>`;
      if (notice) showMsg(notice, "success");
      tick();
      clearInterval(timer);
      timer = setInterval(tick, 1000);
      if (focus) card.querySelector("#login-code").focus();
    }

    // 倒计时：重发 / 改发到耶鲁邮箱 都要等 60 秒（后端同一邮箱 60 秒内只发一次）
    function tick() {
      const resend = card.querySelector('[data-act="resend"]');
      if (!ctx.isActive() || !resend || !document.body.contains(resend)) { clearInterval(timer); return; }
      const s = secondsLeft();
      resend.disabled = s > 0;
      resend.textContent = s > 0 ? t("login.resendIn", { s }) : t("login.resend");
      const yale = card.querySelector('[data-act="use-yale"]');
      if (yale) { yale.disabled = s > 0; yale.textContent = s > 0 ? t("login.useYaleWait", { s }) : t("login.useYale"); }
      if (!s) clearInterval(timer);
    }

    let verifying = false;
    async function verify() {
      if (verifying) return;
      const form = card.querySelector('[data-form="code"]');
      const input = form.querySelector("#login-code");
      const btn = form.querySelector('[data-act="verify"]');
      const code = input.value.replace(/\D/g, "");
      showMsg("");
      if (!/^\d{6}$/.test(code)) { YL.ui.showFieldErrors(form, { code: "format" }, "login"); return; }
      YL.ui.clearFieldErrors(form);
      verifying = true;
      YL.ui.busy(btn, true);
      const r = await YL.auth.verify(flow.email, code);
      if (r.ok) {
        const u = r.data.user || {};
        flow = null;
        clearInterval(timer);
        YL.ui.toast(u.name ? t("login.welcomeBack", { name: u.name }) : t("login.welcome"), "success");
        if (ctx.isActive()) goOn(next);
        return;
      }
      if (!ctx.isActive()) return;
      verifying = false;
      YL.ui.busy(btn, false);
      const e = r.error || {};
      if (e.fields) {
        YL.ui.showFieldErrors(form, e.fields, "login");
        if (e.fields.code === "too_many_attempts" || e.fields.code === "expired") {
          input.value = "";
          const resend = form.querySelector('[data-act="resend"]');
          if (resend && !resend.disabled) resend.focus();
        } else input.select();
        return;
      }
      showMsg(YL.ui.errorText(e, "login"));
    }

    /* ---------- 事件（委托在本页根元素上）---------- */
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      if (form.dataset.form === "email") {
        const email = form.querySelector("#login-email").value.trim();
        if (!email) { YL.ui.showFieldErrors(form, { email: "required" }, "login"); return; }
        sendCode(email, false, form.querySelector('button[type="submit"]'));
      } else if (form.dataset.form === "code") verify();
    });
    el.addEventListener("input", (e) => {
      const field = e.target.closest(".field.is-invalid");
      if (field) { field.classList.remove("is-invalid"); YL.ui.$$(".field__error", field).forEach((x) => x.remove()); e.target.removeAttribute("aria-invalid"); }
      if (e.target.id !== "login-code") return;
      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
      if (digits !== e.target.value) e.target.value = digits;
      if (digits.length === 6) verify(); // 输满 6 位自动提交（也兼容短信 / 邮件的自动填充）
    });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || !el.contains(b)) return;
      const act = b.dataset.act;
      if (act === "resend") sendCode(flow.email, flow.forceYale, b);
      else if (act === "use-yale") sendCode(flow.email, true, b);
      else if (act === "change-email") { const keep = flow ? flow.email : ""; flow = null; showEmail(true); card.querySelector("#login-email").value = keep; card.querySelector("#login-email").select(); }
    });

    if (flow) showCode(false); else showEmail(false);
  }

  registerModule({ id: "login", render });
})();
