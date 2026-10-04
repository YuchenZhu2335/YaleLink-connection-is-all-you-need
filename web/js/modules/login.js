/* 登录：耶鲁邮箱 → 6 位验证码（同一页面两步，不刷新）
   Sign-in: Yale email → 6-digit code. 后端规则见 server/auth.js 与 docs/api.md「登录与账号」。

   #/login[?next=…][&via=yale]
   - 已登录：没完成首次填写 → #/profile/setup?next=…；否则回到 next（默认 coffee）
   - 老用户验证过联系邮箱时，验证码默认发到联系邮箱。发码接口对任何邮箱都只回 { sent: true }（不透露发到了哪里），
     所以第二步总是说明两种情况，并一直提供"改发到耶鲁邮箱"（via = "yale"）
   - via=yale：这次直接发到耶鲁邮箱（"我的"里换联系邮箱、进管理后台需要用耶鲁邮箱登录的会话）
   - 重发有 60 秒倒计时（后端同一邮箱 60 秒内只发一次，不论发到哪里）；切换语言时路由会重绘，进行中的步骤保存在模块内的 flow 里 */
(function () {
  const { t, esc, icon } = YL.ui;
  const RESEND_SECONDS = 60;
  const CODE_TTL_MS = 10 * 60000;

  // 表单逐项报错由 YL.ui.showFieldErrors(form, fields, "login") 显示，文案键为 t("login.field." + 字段 + "." + 错误码)
  // 进行中的登录：{ email, forceYale, yale（确定发到了耶鲁邮箱）, already（60 秒内刚发过，这次没有新发）, sentAt, dead（验证码作废时的原因）}
  // 登录成功或"换一个邮箱"时清空
  let flow = null;
  let timer = null;

  // 把翻译好的句子转义后，再把 {占位符} 换成已转义的 HTML 片段
  const fill = (text, parts) => esc(text).replace(/\{(\w+)\}/g, (m, k) => (parts[k] != null ? parts[k] : m));
  const secondsLeft = () => (flow ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - flow.sentAt) / 1000)) : 0);

  function goOn(next) {
    // next 本身就是首次填写页（带着自己的 next）：不要再套一层
    if (/^profile\/setup(\?|$)/.test(next)) {
      if (!YL.auth.isReady()) { YL.router.navigate(next, { replace: true }); return; }
      next = YL.router.safeNext(new URLSearchParams(next.split("?")[1] || "").get("next"), "coffee");
    }
    // 要去的页面不需要完成首次填写（如意见箱、活动页）就直接去
    const target = YL.registry.get(next.split(/[/?]/)[0]);
    if (!YL.auth.isReady() && (!target || target.requiresReady)) YL.router.navigate("profile/setup?next=" + encodeURIComponent(next), { replace: true });
    else YL.router.navigate(next, { replace: true });
  }

  function render(root, ctx) {
    clearInterval(timer);
    const next = YL.router.safeNext(ctx.query.next, "coffee");
    const viaYale = ctx.query.via === "yale";
    if (YL.auth.isLoggedIn()) { goOn(next); return; }
    if (flow && Date.now() - flow.sentAt > CODE_TTL_MS) flow = null;

    const meta = YL.auth.meta();
    root.innerHTML = `
      <section class="page page--narrow" data-login>
        <header class="stack stack--s">
          <img src="assets/brand/mark.svg" alt="" width="48" height="48">
          <h1 class="page-title">${esc(YL_CONFIG.siteName)}</h1>
          <p class="page-sub">${esc(t("brand.tagline"))}</p>
        </header>
        <div class="card" data-card></div>
        ${meta.dev ? `<div class="notice notice--warn">${icon("alert")}<div class="notice__body"><p><strong>${esc(t("login.devTitle"))}</strong></p><p>${esc(t("login.devBody"))} <a class="break-all" href="/api/dev/outbox" target="_blank" rel="noopener">/api/dev/outbox</a></p></div></div>` : ""}
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
      box.innerHTML = text ? `<div class="notice notice--${ok ? "success" : "danger"}" role="${ok ? "status" : "alert"}">${icon(ok ? "check" : "alertCircle")}<div class="notice__body"><p>${esc(text)}</p></div></div>` : "";
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
          ${viaYale ? `<div class="notice notice--info">${icon("info")}<div class="notice__body"><p>${esc(t("login.yaleOnly"))}</p></div></div>` : ""}
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

    // 后端只回 { sent: true }：不知道发到了哪个邮箱，界面按"我们要求发到哪里"来说明
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
        flow = { email, forceYale: !!forceYale, yale: !!forceYale, already: false, sentAt: Date.now(), dead: "" };
        showCode(true, !resend ? "" : forceYale ? t("login.resentYale") : t("login.resent"));
        return;
      }
      const e = r.error || {};
      if (e.fields) { YL.ui.showFieldErrors(form, e.fields, "login"); return; }
      // 60 秒内刚发过：验证码已经在路上了，直接去输入
      if (e.reason === "resend_too_soon" && (!flow || flow.email !== email)) {
        flow = { email, forceYale: !!forceYale, yale: false, already: true, sentAt: Date.now(), dead: "" };
        showCode(true);
        return;
      }
      showMsg(YL.ui.errorText(e, "login"));
    }

    /* ---------- 第二步：验证码 ---------- */
    function showCode(focus, notice) {
      const who = { email: `<strong>${esc(flow.email)}</strong>` };
      const sent = fill(flow.already ? t("login.alreadySent") : flow.yale ? t("login.sentYale") : t("login.sentGeneric"), who);
      const dead = !!flow.dead;
      card.innerHTML = `
        <form class="form" data-form="code" novalidate>
          <div class="stack stack--s">
            <h2 class="card__title" tabindex="-1" data-focus>${esc(t("login.codeTitle"))}</h2>
            <p class="muted" aria-live="polite">${sent}</p>
          </div>
          ${flow.yale ? "" : `<div class="notice notice--info">${icon("info")}<div class="notice__body"><p>${esc(t("login.whereCode"))}</p><p><button type="button" class="btn btn--secondary btn--sm" data-act="use-yale">${esc(t("login.useYale"))}</button></p></div></div>`}
          <div class="field" data-field="code">
            <label class="field__label" for="login-code">${esc(t("login.codeLabel"))}</label>
            <input class="input input--code" id="login-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-describedby="login-code-hint"${dead ? " disabled" : ""}>
            <p class="field__hint" id="login-code-hint">${esc(t("login.codeHint"))}</p>
          </div>
          <div data-msg hidden></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" data-act="verify"${dead ? " disabled" : ""}>${esc(t("login.verify"))}</button>
          <div class="cluster cluster--between">
            <button type="button" class="btn btn--ghost" data-act="resend">${esc(t("login.resend"))}</button>
            <button type="button" class="btn btn--ghost" data-act="change-email">${esc(t("login.changeEmail"))}</button>
          </div>
        </form>`;
      if (notice) showMsg(notice, "success");
      if (dead) YL.ui.showFieldErrors(card.querySelector('[data-form="code"]'), { code: flow.dead }, "login");
      tick();
      clearInterval(timer);
      timer = setInterval(tick, 1000);
      if (focus && !dead) card.querySelector("#login-code").focus();
      else if (focus) focusHeading();
    }
    function focusHeading() { const h = card.querySelector("[data-focus]"); if (h) h.focus(); }

    // 倒计时：重发要等 60 秒（后端同一邮箱 60 秒内只发一次）。
    // "改发到耶鲁邮箱"紧跟在普通请求之后可以马上点一次（后端只看上一次是不是主动改发，不泄露发到了哪里）；
    // 这次没有新发（already：60 秒内别处刚请求过，不知道那次是不是改发）时也要等
    function tick() {
      const resend = card.querySelector('[data-act="resend"]');
      if (!ctx.isActive() || !resend || !document.body.contains(resend)) { clearInterval(timer); return; }
      const s = secondsLeft();
      resend.disabled = s > 0;
      resend.textContent = s > 0 ? t("login.resendIn", { s }) : t("login.resend");
      const yale = card.querySelector('[data-act="use-yale"]');
      const wait = flow && flow.already ? s : 0;
      if (yale) { yale.disabled = wait > 0; yale.textContent = wait > 0 ? t("login.useYaleWait", { s: wait }) : t("login.useYale"); }
      if (!s) {
        clearInterval(timer);
        // 验证码已经作废、焦点又没地方放（输入框被禁用了）：倒计时结束时把焦点放到"重新发送"上
        const a = document.activeElement;
        if (flow && flow.dead && (!a || a === document.body || !card.contains(a) || a.disabled)) resend.focus();
      }
    }

    let verifying = false;
    async function verify() {
      if (verifying) return;
      const form = card.querySelector('[data-form="code"]');
      const input = form.querySelector("#login-code");
      const btn = form.querySelector('[data-act="verify"]');
      const code = input.value.replace(/\D/g, "");
      showMsg("");
      if (flow.dead || input.disabled) return;
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
          // 这个验证码已经作废：再输也只会失败（还占用每小时的验证次数），先禁用，重新发码后恢复
          flow.dead = e.fields.code;
          input.value = "";
          input.disabled = true;
          btn.disabled = true;
          const resend = form.querySelector('[data-act="resend"]');
          if (resend && !resend.disabled) resend.focus(); else focusHeading();
        } else input.select();
        return;
      }
      // 验证这一步的限频（同一网络每小时的尝试次数）和发码的限频是两回事
      showMsg(e.code === "rate_limited" ? t("login.err.verify_too_many") : YL.ui.errorText(e, "login"));
    }

    /* ---------- 事件（委托在本页根元素上）---------- */
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      if (form.dataset.form === "email") {
        const email = form.querySelector("#login-email").value.trim();
        if (!email) { YL.ui.showFieldErrors(form, { email: "required" }, "login"); return; }
        sendCode(email, viaYale, form.querySelector('button[type="submit"]'));
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
