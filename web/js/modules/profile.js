/* 我的：首次填写（同意说明 → 联系邮箱 → 资料）、我的页面、修改资料
   Me: first-time onboarding wizard, the "Me" page (profile card, account, notifications, sign out, delete) and profile editing.
   接口见 docs/api.md「登录与账号」；资料校验规则与后端共用 YL.domain.coffee.validateProfile。

   #/profile/setup[?next=…]  首次填写；完成后回到 next（默认 coffee）。已完成则去 #/profile
   #/profile/setup?only=consent&next=…  只同意隐私说明（意见箱用），同意后回到 next
   #/profile                  我的
   #/profile/edit[?focus=resume]  修改资料（focus=resume：打开后滚到简历那一块）

   资料字段与可见范围见 RFC 0003（docs/rfcs/0003-profile-fields-resume-mentors.md）：英文名、项目、学段（含博士后 / 其他）、
   嘉宾身份（只有组织者登记过的嘉宾邮箱能选）、见面方式和具体地点、还有什么想说的、简历（选好文件就上传，不跟表单一起提交）。 */
(function () {
  const { t, esc, L, icon, avatar } = YL.ui;
  const D = YL.domain.coffee;
  const PREF_KEYS = ["invite_digest", "reminder", "weekly", "event"];
  // 常量以共用规则（web/js/domain/coffee.js）为准；规则层还没更新到 RFC 0003 时用契约里的默认值
  const STAGES = () => D.STAGES;
  const GRAD_STAGES = () => D.STAGES_WITH_GRAD_YEAR || ["undergrad", "master", "phd"];
  const MEET_MODES = () => D.MEET_MODES || ["online", "newhaven", "either"];
  const RESUME_VIS = () => D.RESUME_VISIBILITY || ["invited", "all"];
  const IDENTITIES = (me) => ["student", "alumni"].concat(me && me.isGuest ? ["guest"] : []);
  const RESEND_SECONDS = 60;
  const CODE_TTL_MS = 10 * 60000;

  // 表单逐项报错由 YL.ui.showFieldErrors(form, fields, "profile") 显示，文案键为 t("profile.field." + 字段 + "." + 错误码)，没有就用 t("profile.field." + 错误码)
  // 联系邮箱验证码已发出、等待输入：{ userId, email, sentTo, sentAt }。模块级保存，切换语言（路由重绘）后能接着输
  let pending = null;
  // 首次填写时停在"联系邮箱"这一步（发了验证码、还没验证也没选"稍后"）：值为用户 id
  let contactStepOpen = null;
  // 首次填写时用户点过"稍后再验证"：值为用户 id。没点过的话，联系邮箱没验证就一直停在这一步（刷新后也是）
  let laterChosen = null;
  // 最近一次成功发出联系邮箱验证码：{ userId, at }。后端 60 秒内不让再发（换个邮箱也不行），"换一个邮箱"后照样倒计时
  let lastSent = null;
  let timer = null;
  let prefSeq = 0;
  // 用耶鲁邮箱重新登录回来后（#/profile?change=contact）自动打开"更换联系邮箱"：只用一次
  let openChangeOnce = false;
  // 简历正在上传：{ user, pct }。模块级，切换语言重绘后接着显示进度；传完更新页面上现在的那一块
  let uploading = null;
  // 上一次上传的错误 { user, field?, error? }：切换语言重绘后照样显示（再选文件、传成功、换页时清掉）
  let resumeErr = null;

  /* 切换语言时路由会在同一个地址上重绘：正在填的内容先记在 draft 里，重绘后填回去。
     draft = { user, path, profile（collectProfile 的结果）, adds（自定义标签输入框里没加进去的字）, contactOpen, contactEmail }
     去了别的页面（路由地址变了）、保存成功、取消时丢掉。
     例外：资料表单（修改资料、首次填写）里没保存的内容去了别的页面也留着（kept），回到同一个地址接着填，离开时提示一句
     （和选时间页一样）；按"取消"、保存成功、退出登录时才丢掉。刷新 / 关闭页面前浏览器会先问一下。 */
  const FORM_PATHS = ["profile/edit", "profile/setup"];
  let draft = null;
  let kept = null;
  let lastPath = null;
  window.addEventListener("yl:route", (e) => {
    const path = e.detail && e.detail.path;
    if (path === lastPath) return;
    if (draft && draft.profile && draft.path === lastPath && FORM_PATHS.indexOf(lastPath) >= 0) {
      kept = { user: draft.user, path: draft.path, profile: draft.profile, adds: draft.adds };
      if (YL.auth.isLoggedIn()) YL.ui.toast(t("profile.draftKept")); // 登录过期被带去登录页时不盖掉"登录已过期"的提示
    }
    draft = null;
    resumeErr = null;
    lastPath = path;
    if (kept && kept.path === path) { draft = kept; kept = null; }
  });
  window.addEventListener("beforeunload", (e) => {
    const d = getDraft();
    if (d && d.profile && FORM_PATHS.indexOf(d.path) >= 0 && document.querySelector("[data-profile-form]")) { e.preventDefault(); e.returnValue = ""; }
  });
  function getDraft() { const me = YL.auth.user(); return draft && me && draft.user === me.id && draft.path === lastPath ? draft : null; }
  function setDraft(patch) {
    const me = YL.auth.user();
    if (!me) return;
    if (!getDraft()) draft = { user: me.id, path: lastPath };
    Object.assign(draft, patch);
  }
  function clearDraft(keys) { if (!draft) return; if (!keys) draft = null; else keys.forEach((k) => delete draft[k]); }

  /* ---------- 小工具 ---------- */
  // 翻译句子先转义，再把 {占位符} 换成已转义的 HTML 片段
  const fill = (text, parts) => esc(text).replace(/\{(\w+)\}/g, (m, k) => (parts[k] != null ? parts[k] : m));
  const limits = () => YL.domain.coffee.LIMITS;
  const thisYear = () => new Date().getFullYear();
  // 提示条（§5.7）：图标跟着变体走（info / arch / check / alert / alertCircle）；不带变体的中性提示条用传入的图标
  const NOTICE_ICON = { info: "info", accent: "arch", success: "check", warn: "alert", danger: "alertCircle" };
  const notice = (kind, iconName, bodyHtml, role) => `<div class="notice${kind ? " notice--" + kind : ""}"${role ? ` role="${role}"` : ""}>${icon(NOTICE_ICON[kind] || iconName)}<div class="notice__body">${bodyHtml}</div></div>`;
  // 空状态（§5.11）：标题 + 正文 + 最多一个操作
  const empty = (ic, title, body, action) => `<div class="empty"><div class="empty__icon">${icon(ic, { size: 28 })}</div><p class="empty__title">${esc(title)}</p>${body ? `<p>${esc(body)}</p>` : ""}${action || ""}</div>`;
  // 长邮箱在 @ 前允许换行
  const emailHtml = (e) => { const s = String(e || ""), i = s.lastIndexOf("@"); return i > 0 ? esc(s.slice(0, i)) + "<wbr>" + esc(s.slice(i)) : esc(s); };
  const withoutSentTo = (data) => { const m = Object.assign({}, data); delete m.sentTo; return m; };
  const pendingFor = (u) => (pending && u && pending.userId === u.id && !u.contactVerified && u.contactEmail === pending.email && Date.now() - pending.sentAt < CODE_TTL_MS ? pending : null);
  const secondsLeft = () => (pending ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - pending.sentAt) / 1000)) : 0);
  const cooldownLeft = () => { const me = YL.auth.user(); return lastSent && me && lastSent.userId === me.id ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - lastSent.at) / 1000)) : 0; };
  // 提示条：没有内容时隐藏（不占表单间距）；出现时用 role=alert / status 让读屏念出来
  function setMsg(scope, text, kind) {
    const box = scope.querySelector("[data-msg]");
    if (!box) return;
    const ok = kind === "success";
    box.hidden = !text;
    box.innerHTML = text ? notice(ok ? "success" : "danger", "", `<p>${esc(text)}</p>`, ok ? "status" : "alert") : "";
  }
  // 用户改了某一项就把这一项的报错清掉
  function clearOne(field) {
    field.classList.remove("is-invalid");
    YL.ui.$$(".field__error", field).forEach((x) => x.remove());
    YL.ui.$$("[aria-invalid]", field).forEach((x) => x.removeAttribute("aria-invalid"));
  }
  function clearOnEdit(e) { const f = e.target.closest && e.target.closest(".field.is-invalid"); if (f) clearOne(f); }
  function focusHeading(scope) { const h = scope.querySelector("[data-focus]"); if (h) h.focus(); }
  function optionLabel(q, v) { const o = (q.options || []).find((x) => x.id === v); return o ? L(o.label) : String(v); }
  // 身份行的各段（资料卡上用"·"隔开）：在读 = 学段 · 届别 · 项目；校友和嘉宾 = 工作 · 城市
  function identityParts(u) {
    if (u.identity === "student") {
      const grad = GRAD_STAGES().indexOf(u.stage) >= 0;
      return [u.stage ? t("profile.stage." + u.stage) : "", grad && u.gradYear ? t("profile.classOf", { year: u.gradYear }) : "", u.program || ""].filter(Boolean);
    }
    if (u.identity === "alumni" || u.identity === "guest") return [u.job, u.city].filter(Boolean);
    return [];
  }
  const sizeText = (bytes) => { const b = Number(bytes) || 0; return b >= 1048576 ? t("profile.resume.mb", { n: (b / 1048576).toFixed(1) }) : t("profile.resume.kb", { n: Math.max(1, Math.round(b / 1024)) }); };
  const resumeMeta = (r) => t("profile.resume.meta", { size: sizeText(r.size), date: YL.ui.formatDate(r.uploadedAt) || "—" });
  // 本人下载自己的简历（GET /me/resume），新标签页打开
  const myResumeUrl = () => esc(YL.api.url("/me/resume"));
  const mentorPill = () => `<span class="pill pill--mentor">${icon("cap")}${esc(t("profile.mentor"))}</span>`;
  const aliasHtml = (u) => (u.preferredName ? ` <span class="person__alias">· ${esc(u.preferredName)}</span>` : "");

  /* ---------- 退出登录 ----------
     退出请求没成功（断网、服务器出错）时，后端的会话 Cookie 还有效：不能假装已经退出，恢复本地状态并提示。
     401 说明会话本来就没了，按已退出处理。all = true：退出所有设备。返回 true = 已退出
     keepDraft = true：马上用耶鲁邮箱重新登录（同一个人），资料表单里没保存的内容留着（草稿记着用户 id，换了别人登录也看不到） */
  async function signOut(btn, ctx, all, keepDraft) {
    const prev = YL.auth.user();
    YL.ui.busy(btn, true);
    const r = await YL.auth.logout(all);
    if (!r.ok && !(r.error && r.error.code === "unauthorized")) {
      YL.auth.set(prev);
      if (ctx.isActive() && document.body.contains(btn)) { YL.ui.busy(btn, false); btn.focus(); }
      YL.ui.toast(t("profile.logoutFailed"), "error");
      return false;
    }
    pending = null;
    contactStepOpen = null;
    laterChosen = null;
    lastSent = null;
    if (!keepDraft) { draft = null; kept = null; }
    return true;
  }
  // 换联系邮箱、改联系方式、注销、进管理后台都要求这次是用耶鲁邮箱登录的：退出后去登录页，并指定验证码发到耶鲁邮箱。
  // 登录回来接着做（next），资料表单里没保存的修改还在
  async function reloginWithYale(btn, ctx, next) {
    if (!(await signOut(btn, ctx, false, true))) return;
    YL.router.navigate("login?next=" + encodeURIComponent(next) + "&via=yale");
  }
  // 后端规则（server/auth.js /me/contact-email）：已经有联系邮箱、这次又不是用耶鲁邮箱登录的，不能换
  const changeNeedsYale = (u) => !!u && !!u.contactEmail && u.via !== "yale";
  // 后端规则（server/auth.js /me/profile）：已经填过联系方式、这次又不是用耶鲁邮箱登录的，联系方式不能改（其他资料可以）
  const contactMethodNeedsYale = (u) => !!u && !!u.contactMethod && u.via !== "yale";
  // 后端拒绝（forbidden / reverify_yale）时的提示：说明原因 + "用耶鲁邮箱重新登录"按钮，放进 scope 里的 [data-msg]。
  // 换联系邮箱、改联系方式、注销共用；按钮带 attr（如 data-cw="relogin"），由调用方的事件委托调 reloginWithYale
  function showReverify(scope, text, attr) {
    const box = scope.querySelector("[data-msg]");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = notice("warn", "", `<p>${esc(text)}</p><p><button type="button" class="btn btn--secondary btn--sm" ${attr}>${esc(t("profile.contact.relogin"))}</button></p>`, "alert");
  }
  /* 页面打开期间隐私说明升了版本：写入被拒绝（forbidden / needs_consent）。刷新登录状态后重绘当前页——
     首次填写回到"同意"这一步；"我的"、修改资料先去同意页，同意后回来（没保存的资料草稿留着）。
     提示放在重绘之后，不被"没保存的内容先留着"盖掉 */
  const isNeedsConsent = (e) => !!e && e.code === "forbidden" && e.reason === "needs_consent";
  async function reconsent(ctx) {
    await YL.auth.refresh();
    if (!ctx.isActive()) return;
    YL.router.render();
    YL.ui.toast(t("profile.err.needs_consent"), "error");
  }

  /* ---------- 联系邮箱：填邮箱 → 发验证码 → 输验证码（首次填写与"我的"共用）----------
     opts = { mode: "enter" | "code", email, autoSend, reloginNext, onDone(me), onLater(), onCancel() } */
  function contactWidget(host, ctx, opts) {
    host.innerHTML = `<div class="stack" data-cw-root></div>`;
    const w = host.firstElementChild;
    let verifying = false;
    const alive = () => ctx.isActive() && document.body.contains(w);
    const cancelBtn = opts.onCancel ? `<button type="button" class="btn btn--ghost btn--block" data-cw="cancel">${esc(t("common.cancel"))}</button>` : "";
    const laterHtml = () => (opts.onLater ? notice("", "clock", `<p>${esc(t("profile.contact.laterBody"))}</p><p><button type="button" class="link-btn" data-cw="later">${esc(t("profile.contact.later"))}</button></p>`) : "");
    // 填邮箱这一屏也能"稍后再验证"：只在已经存了一个没验证的联系邮箱时（比如发了验证码后刷新了页面）
    const savedUnverified = () => { const me = YL.auth.user(); return !!me && !!me.contactEmail && !me.contactVerified; };

    function enter(focus, email) {
      clearInterval(timer);
      w.innerHTML = `
        <form class="form" data-cw-email novalidate>
          <div class="field" data-field="contactEmail">
            <label class="field__label" for="cw-email">${esc(t("profile.contact.label"))}</label>
            <input class="input" id="cw-email" name="contactEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120"
              placeholder="${esc(t("profile.contact.placeholder"))}" value="${esc(email || "")}" aria-describedby="cw-email-hint">
            <p class="field__hint" id="cw-email-hint">${esc(t("profile.contact.hint"))}</p>
          </div>
          <div data-msg hidden></div>
          <div class="stack stack--s">
            <button type="submit" class="btn btn--primary btn--block">${esc(t("profile.contact.send"))}</button>
            ${cancelBtn}
          </div>
          ${savedUnverified() ? laterHtml() : ""}
        </form>`;
      cooldown();
      if (focus) w.querySelector("#cw-email").focus();
    }
    // 填邮箱这一屏的发送按钮：刚发过验证码（不管发给哪个邮箱）就倒计时，到 0 再能点
    function enterTick() {
      const b = w.querySelector('[data-cw-email] button[type="submit"]');
      if (!alive() || !b) { clearInterval(timer); return; }
      const s = cooldownLeft();
      b.disabled = s > 0;
      b.textContent = s > 0 ? t("profile.contact.resendIn", { s }) : t("profile.contact.send");
      if (!s) clearInterval(timer);
    }
    function cooldown() {
      clearInterval(timer);
      enterTick();
      if (cooldownLeft() > 0) timer = setInterval(enterTick, 1000);
    }

    function code(focus, note) {
      w.innerHTML = `
        <form class="form" data-cw-code novalidate>
          <p aria-live="polite">${pending.sentTo ? fill(t("profile.contact.sentTo"), { to: `<strong>${emailHtml(pending.sentTo)}</strong>` }) : esc(t("profile.contact.alreadySent"))}</p>
          <div class="field" data-field="code">
            <label class="field__label" for="cw-code">${esc(t("profile.contact.codeLabel"))}</label>
            <input class="input input--code" id="cw-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-describedby="cw-code-hint">
            <p class="field__hint" id="cw-code-hint">${esc(t("profile.contact.codeHint"))}</p>
          </div>
          <div data-msg hidden></div>
          <button type="submit" class="btn btn--primary btn--block" data-cw="verify">${esc(t("profile.contact.verify"))}</button>
          <div class="cluster cluster--between">
            <button type="button" class="btn btn--ghost" data-cw="resend">${esc(t("profile.contact.resend"))}</button>
            <button type="button" class="link-btn" data-cw="change">${esc(t("profile.contact.change"))}</button>
          </div>
          ${laterHtml()}
          ${cancelBtn}
        </form>`;
      if (note) setMsg(w, note, "success");
      tick();
      clearInterval(timer);
      timer = setInterval(tick, 1000);
      if (focus) w.querySelector("#cw-code").focus();
    }

    function tick() {
      const b = w.querySelector('[data-cw="resend"]');
      if (!alive() || !b || !pending) { clearInterval(timer); return; }
      const s = secondsLeft();
      b.disabled = s > 0;
      b.textContent = s > 0 ? t("profile.contact.resendIn", { s }) : t("profile.contact.resend");
      if (!s) clearInterval(timer);
    }

    async function send(email, btn) {
      const form = btn.closest("form");
      YL.ui.clearFieldErrors(form);
      setMsg(w, "");
      YL.ui.busy(btn, true);
      const r = await YL.api.post("/me/contact-email", { email });
      if (!alive()) return;
      YL.ui.busy(btn, false);
      if (!r.ok) {
        const e = r.error || {};
        const me = YL.auth.user() || {};
        // 后端说 60 秒内刚发过：不知道确切时间的话从现在开始算（宁可多等几秒）
        if (e.reason === "resend_too_soon" && me.id && !cooldownLeft()) lastSent = { userId: me.id, at: Date.now() };
        // 60 秒内刚给同一个（未验证的）邮箱发过：之前的验证码还有效，直接去输入
        if (e.reason === "resend_too_soon" && !me.contactVerified && String(me.contactEmail || "") === email.toLowerCase()) {
          pending = { userId: me.id, email: me.contactEmail, sentTo: "", sentAt: lastSent ? lastSent.at : Date.now() };
          code(true);
          return;
        }
        if (isNeedsConsent(e)) { reconsent(ctx); return; }
        if (e.fields) YL.ui.showFieldErrors(form, e.fields, "profile");
        else if (e.reason === "reverify_yale") showReverify(w, t("profile.err.reverify_yale"), 'data-cw="relogin"');
        else setMsg(w, YL.ui.errorText(e, "profile"));
        if (form.matches("[data-cw-email]")) cooldown(); // 换了个邮箱但还在 60 秒内：按钮倒计时，不让一直点（每次都算进每小时 5 次）
        return;
      }
      const sentTo = r.data.sentTo;
      if (sentTo) lastSent = { userId: r.data.id, at: Date.now() };
      YL.auth.set(withoutSentTo(r.data));
      if (!sentTo) { pending = null; clearDraft(["contactOpen", "contactEmail"]); opts.onDone(YL.auth.user()); return; } // 已经验证过的同一个邮箱
      const again = !!pending && pending.email === r.data.contactEmail;
      pending = { userId: r.data.id, email: r.data.contactEmail, sentTo, sentAt: Date.now() };
      code(true, again ? t("profile.contact.resent") : "");
    }

    async function verify() {
      if (verifying) return;
      const form = w.querySelector("[data-cw-code]");
      const input = form.querySelector("#cw-code");
      const btn = form.querySelector('[data-cw="verify"]');
      const c = input.value.replace(/\D/g, "");
      setMsg(w, "");
      if (!/^\d{6}$/.test(c)) { YL.ui.showFieldErrors(form, { code: "format" }, "profile"); return; }
      YL.ui.clearFieldErrors(form);
      verifying = true;
      YL.ui.busy(btn, true);
      const r = await YL.api.post("/me/contact-email/verify", { code: c });
      if (!alive()) return;
      verifying = false;
      YL.ui.busy(btn, false);
      if (r.ok) {
        pending = null;
        clearInterval(timer);
        clearDraft(["contactOpen", "contactEmail"]);
        YL.auth.set(r.data);
        YL.ui.toast(t("profile.contact.verified"), "success");
        opts.onDone(r.data);
        return;
      }
      const e = r.error || {};
      if (e.fields) {
        YL.ui.showFieldErrors(form, e.fields, "profile");
        if (e.fields.code === "wrong") input.select(); else input.value = "";
        return;
      }
      if (isNeedsConsent(e)) { reconsent(ctx); return; }
      setMsg(w, YL.ui.errorText(e, "profile"));
    }

    w.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.target.matches("[data-cw-email]")) {
        const email = e.target.querySelector("#cw-email").value.trim();
        if (!email) { YL.ui.showFieldErrors(e.target, { contactEmail: "required" }, "profile"); return; }
        send(email, e.target.querySelector('button[type="submit"]'));
      } else if (e.target.matches("[data-cw-code]")) verify();
    });
    w.addEventListener("input", (e) => {
      clearOnEdit(e);
      if (e.target.id === "cw-email") setDraft({ contactOpen: true, contactEmail: e.target.value });
      if (e.target.id !== "cw-code") return;
      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
      if (digits !== e.target.value) e.target.value = digits;
      if (digits.length === 6) verify();
    });
    w.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cw]");
      if (!b || !w.contains(b)) return;
      const act = b.dataset.cw;
      if (act === "resend" && pending) send(pending.email, b);
      else if (act === "change") { const keep = pending ? pending.email : ""; pending = null; enter(true, keep); w.querySelector("#cw-email").select(); }
      else if (act === "later") { pending = null; clearInterval(timer); clearDraft(["contactOpen", "contactEmail"]); opts.onLater(); }
      else if (act === "cancel") { pending = null; clearInterval(timer); clearDraft(["contactOpen", "contactEmail"]); opts.onCancel(); }
      else if (act === "relogin") reloginWithYale(b, ctx, opts.reloginNext || "profile?change=contact");
    });

    if (opts.mode === "code" && pending) code(false);
    else {
      enter(!opts.autoSend && opts.focus, opts.email);
      if (opts.autoSend && opts.email) send(opts.email, w.querySelector('button[type="submit"]'));
    }
  }

  /* ---------- 资料表单（首次填写第 3 步与"修改资料"共用）---------- */
  const req = `<span class="req" aria-hidden="true">*</span>`;
  const customChip = (qid, value) => `<button type="button" class="chip is-active" data-custom-for="${esc(qid)}" data-value="${esc(value)}" aria-label="${esc(t("profile.form.removeTag", { tag: value }))}">${esc(value)}<span class="chip__x">${icon("x", { size: 16 })}</span></button>`;

  function questionHtml(q, answers) {
    const qk = "q_" + q.id, k = esc(qk), v = answers[q.id];
    const label = esc(L(q.label)) + (q.required ? req : "");
    if (q.type === "text") {
      const max = Number(q.max) || 200, val = typeof v === "string" ? v : "";
      return `<div class="field" data-field="${k}">
          <label class="field__label" for="pf-${k}">${label}</label>
          <textarea class="textarea" id="pf-${k}" name="${k}" maxlength="${max}" rows="3" placeholder="${esc(L(q.placeholder))}" aria-describedby="pf-${k}-count"${q.required ? " required" : ""}>${esc(val)}</textarea>
          <p class="field__count" id="pf-${k}-count" data-count-for="${k}" data-max="${max}">${val.length} / ${max}</p>
        </div>`;
    }
    const ids = (q.options || []).map((o) => o.id);
    const chosen = q.type === "single" ? (v ? [v] : []) : Array.isArray(v) ? v : [];
    const type = q.type === "single" ? "radio" : "checkbox";
    const options = (q.options || []).map((o) => `<label class="choice"><input type="${type}" class="sr-only" name="${k}" value="${esc(o.id)}"${chosen.indexOf(o.id) >= 0 ? " checked" : ""}><span class="chip">${esc(L(o.label))}</span></label>`).join("");
    if (q.type !== "tags") {
      return `<div class="field" data-field="${k}">
          <span class="field__label" id="pf-${k}-l">${label}</span>
          <div class="chips" role="${q.type === "single" ? "radiogroup" : "group"}" aria-labelledby="pf-${k}-l">${options}</div>
        </div>`;
    }
    const custom = q.allowCustom ? chosen.filter((x) => ids.indexOf(x) < 0) : [];
    return `<div class="field" data-field="${k}" data-tags="${esc(q.id)}" data-max="${Number(q.max) || 5}">
        <span class="field__label" id="pf-${k}-l">${label}</span>
        <div class="chips" role="group" aria-labelledby="pf-${k}-l" data-chips>${options}${custom.map((x) => customChip(q.id, x)).join("")}</div>
        ${q.allowCustom ? `<div class="input-row">
          <label class="sr-only" for="pf-${k}-add">${esc(t("profile.form.addTagLabel"))}</label>
          <input class="input" id="pf-${k}-add" data-add-input maxlength="${limits().tagCustom}" placeholder="${esc(t("profile.form.addTagPlaceholder"))}" enterkeyhint="done" autocomplete="off">
          <button type="button" class="btn btn--secondary" data-add-tag>${icon("plus")}${esc(t("profile.form.addTag"))}</button>
        </div>` : ""}
        <p class="field__hint" data-tag-count tabindex="-1" aria-live="polite"></p>
      </div>`;
  }

  // lockedContact = true：这次是用联系邮箱登录的，联系方式旁边说明"改它需要用耶鲁邮箱登录"（contactMethodNeedsYale，按保存过的资料算，不按草稿）
  function profileFormHtml(u, submitLabel, cancelHref, lockedContact) {
    const me = YL.auth.user() || {};
    const qs = YL.auth.questions();
    const a = u.answers || {};
    const id = u.identity || "";
    const lim = limits();
    const years = [];
    for (let y = thisYear(); y <= thisYear() + lim.gradYearsAhead; y++) years.push(y);
    const optional = ` <span class="faint">${esc(t("common.optional"))}</span>`;
    // o = { auto, hint（文案 key）, ph（占位符 key）, optional }
    const input = (name, max, o) => `<div class="field" data-field="${name}">
        <label class="field__label" for="pf-${name}">${esc(t("profile.form." + name))}${o.optional ? optional : req}</label>
        <input class="input" id="pf-${name}" name="${name}" maxlength="${max}"${o.auto ? ` autocomplete="${o.auto}"` : ""} value="${esc(u[name] || "")}"${o.ph ? ` placeholder="${esc(t(o.ph))}"` : ""}${o.hint ? ` aria-describedby="pf-${name}-hint"` : ""}>
        ${o.hint ? `<p class="field__hint" id="pf-${name}-hint">${esc(t(o.hint))}</p>` : ""}
      </div>`;
    const shows = (when) => when.split(" ").indexOf(id) >= 0;
    // 博士后、其他（如访问学生）不要求毕业年份；还没选学段时先显示
    const showGrad = !u.stage || GRAD_STAGES().indexOf(u.stage) >= 0;
    const free = typeof u.freeText === "string" ? u.freeText : "";
    const freeMax = lim.freeText || 500;
    return `
      <form class="form" data-profile-form novalidate>
        ${YL.ui.sectionTitle(t("profile.form.aboutTitle"))}
        ${input("name", lim.name, { auto: "name", hint: "profile.form.nameHint" })}
        ${input("preferredName", lim.preferredName || 40, { auto: "nickname", hint: "profile.form.preferredNameHint", ph: "profile.form.preferredNamePlaceholder", optional: true })}
        <div class="field" data-field="identity">
          <span class="field__label" id="pf-identity-l">${esc(t("profile.form.identity"))}${req}</span>
          <div class="radio-cards" role="radiogroup" aria-labelledby="pf-identity-l">
            ${IDENTITIES(me).map((v) => `<label class="radio-card"><input type="radio" name="identity" value="${v}"${id === v ? " checked" : ""}><span class="radio-card__box"><strong>${esc(t("profile.identity." + v))}</strong><span>${esc(t("profile.identity." + v + "Sub"))}</span></span></label>`).join("")}
          </div>
        </div>
        <div class="stack" data-when="student"${shows("student") ? "" : " hidden"}>
          <div class="field" data-field="stage">
            <span class="field__label" id="pf-stage-l">${esc(t("profile.form.stage"))}${req}</span>
            <div class="chips" role="radiogroup" aria-labelledby="pf-stage-l">
              ${STAGES().map((s) => `<label class="choice"><input type="radio" class="sr-only" name="stage" value="${esc(s)}"${u.stage === s ? " checked" : ""}><span class="chip">${esc(t("profile.stage." + s))}</span></label>`).join("")}
            </div>
          </div>
          <div class="field" data-field="gradYear" data-grad${showGrad ? "" : " hidden"}>
            <label class="field__label" for="pf-gradYear">${esc(t("profile.form.gradYear"))}${req}</label>
            <select class="select" id="pf-gradYear" name="gradYear">
              <option value="">${esc(t("profile.form.choose"))}</option>
              ${years.map((y) => `<option value="${y}"${Number(u.gradYear) === y ? " selected" : ""}>${esc(t("profile.classOf", { year: y }))}</option>`).join("")}
            </select>
          </div>
          ${input("program", lim.program || 80, { auto: "off", hint: "profile.form.programHint", ph: "profile.form.programPlaceholder" })}
        </div>
        <div class="stack" data-when="alumni guest"${shows("alumni guest") ? "" : " hidden"}>
          ${input("job", lim.job, { auto: "organization-title", ph: "profile.form.jobPlaceholder" })}
          ${input("city", lim.city, { auto: "address-level2", ph: "profile.form.cityPlaceholder" })}
        </div>

        ${YL.ui.sectionTitle(t("profile.form.chatTitle"), "", t("profile.form.chatSub"))}
        ${qs.map((q) => questionHtml(q, a)).join("")}
        <div class="field" data-field="freeText">
          <label class="field__label" for="pf-freeText">${esc(t("profile.form.freeText"))}${optional}</label>
          <textarea class="textarea" id="pf-freeText" name="freeText" maxlength="${freeMax}" rows="4" placeholder="${esc(t("profile.form.freeTextPlaceholder"))}" aria-describedby="pf-freeText-hint pf-freeText-count">${esc(free)}</textarea>
          <p class="field__hint" id="pf-freeText-hint">${esc(t("profile.form.freeTextHint"))}</p>
          <p class="field__count" id="pf-freeText-count" data-count-for="freeText" data-max="${freeMax}">${free.length} / ${freeMax}</p>
        </div>

        ${YL.ui.sectionTitle(t("profile.form.meetTitle"), "", t("profile.form.meetSub"))}
        <div class="field" data-field="meetMode">
          <span class="field__label" id="pf-meetMode-l">${esc(t("profile.form.meetMode"))}${req}</span>
          <div class="chips" role="radiogroup" aria-labelledby="pf-meetMode-l" aria-describedby="pf-meetMode-hint">
            ${MEET_MODES().map((m) => `<label class="choice"><input type="radio" class="sr-only" name="meetMode" value="${esc(m)}"${u.meetMode === m ? " checked" : ""}><span class="chip">${esc(t("profile.meet." + m))}</span></label>`).join("")}
          </div>
          <p class="field__hint" id="pf-meetMode-hint">${esc(t("profile.form.meetModeHint"))}</p>
        </div>
        ${input("meetPlace", lim.meetPlace || 200, { auto: "off", hint: "profile.form.meetPlaceHint", ph: "profile.form.meetPlacePlaceholder", optional: true })}

        ${YL.ui.sectionTitle(t("profile.form.contactTitle"))}
        <div class="field" data-field="contactMethod">
          <label class="field__label" for="pf-contactMethod">${esc(t("profile.form.contactMethod"))}${req}</label>
          <input class="input" id="pf-contactMethod" name="contactMethod" maxlength="${lim.contactMethod}" autocomplete="off" value="${esc(u.contactMethod || "")}" placeholder="${esc(t("profile.form.contactMethodPlaceholder"))}" aria-describedby="pf-contactMethod-hint${lockedContact ? " pf-contactMethod-yale" : ""}">
          <p class="field__hint" id="pf-contactMethod-hint">${esc(t("profile.form.contactMethodHint"))}</p>
          ${lockedContact ? `<p class="field__hint" id="pf-contactMethod-yale">${esc(t("profile.form.contactMethodNeedsYale"))}</p>` : ""}
        </div>

        <section class="stack" id="pf-resume-section" aria-labelledby="pf-resume-title" tabindex="-1">
          <div class="section-head"><div><h2 class="section-title" id="pf-resume-title">${esc(t("profile.resume.title"))}</h2><p class="section-sub">${esc(t("profile.resume.sub"))}</p></div></div>
          <div class="stack" data-resume></div>
        </section>

        <div data-msg hidden></div>
        <div class="stack stack--s">
          <button type="submit" class="btn btn--primary btn--block btn--lg">${esc(submitLabel)}</button>
          ${cancelHref ? `<a class="btn btn--ghost btn--block" href="${cancelHref}" data-discard>${esc(t("common.cancel"))}</a>` : ""}
        </div>
      </form>`;
  }

  function collectProfile(form) {
    const val = (n) => { const x = form.querySelector(`[name="${CSS.escape(n)}"]:not([type="radio"]):not([type="checkbox"])`); return x ? x.value.trim() : ""; };
    const checked = (n) => YL.ui.$$(`input[name="${CSS.escape(n)}"]:checked`, form).map((x) => x.value);
    const identity = checked("identity")[0] || "";
    const body = {
      name: val("name"), preferredName: val("preferredName"), identity,
      meetMode: checked("meetMode")[0] || "", meetPlace: val("meetPlace"), freeText: val("freeText"),
      contactMethod: val("contactMethod"), answers: {}
    };
    if (identity === "student") {
      body.stage = checked("stage")[0] || "";
      body.program = val("program");
      // 博士后、其他不填毕业年份（选择框藏起来了，里面的旧值不提交）
      body.gradYear = GRAD_STAGES().indexOf(body.stage) >= 0 || !body.stage ? Number(val("gradYear")) || null : null;
    }
    if (identity === "alumni" || identity === "guest") { body.job = val("job"); body.city = val("city"); }
    YL.auth.questions().forEach((q) => {
      const n = "q_" + q.id;
      if (q.type === "text") body.answers[q.id] = val(n);
      else if (q.type === "single") body.answers[q.id] = checked(n)[0] || "";
      else {
        let v = checked(n);
        if (q.type === "tags") v = v.concat(YL.ui.$$("[data-custom-for]", form).filter((b) => b.dataset.customFor === q.id).map((b) => b.dataset.value));
        body.answers[q.id] = v;
      }
    });
    return body;
  }

  function updateTags(field) {
    const max = Number(field.dataset.max) || 5;
    const boxes = YL.ui.$$('input[type="checkbox"]', field);
    const n = boxes.filter((b) => b.checked).length + YL.ui.$$("[data-custom-for]", field).length;
    const full = n >= max;
    boxes.forEach((b) => { if (!b.checked) b.disabled = full; });
    const add = field.querySelector("[data-add-input]"), addBtn = field.querySelector("[data-add-tag]");
    if (add) { add.disabled = full; addBtn.disabled = full; }
    const count = field.querySelector("[data-tag-count]");
    if (count) count.textContent = full ? t("profile.form.tagsFull", { max }) : t("profile.form.tagsCount", { n, max });
    return full;
  }
  function addTag(form, field) {
    const q = YL.auth.questions().find((x) => x.id === field.dataset.tags);
    const input = field.querySelector("[data-add-input]");
    const raw = input.value.trim().replace(/\s+/g, " ");
    clearOne(field);
    if (!q || !raw) { input.focus(); return; }
    if (raw.length > limits().tagCustom) { YL.ui.showFieldErrors(form, { ["q_" + q.id]: "tag_too_long" }, "profile"); input.focus(); return; }
    const low = raw.toLowerCase();
    // 和现成选项同名（中文或英文）就直接勾上那个选项
    const opt = (q.options || []).find((o) => o.id.toLowerCase() === low || String(L(o.label)).toLowerCase() === low || String((o.label || {}).zh || "").toLowerCase() === low || String((o.label || {}).en || "").toLowerCase() === low);
    if (opt) {
      const box = YL.ui.$$('input[type="checkbox"]', field).find((b) => b.value === opt.id);
      if (box && !box.disabled) box.checked = true;
    } else if (!YL.ui.$$("[data-custom-for]", field).some((b) => b.dataset.value.toLowerCase() === low)) {
      field.querySelector("[data-chips]").insertAdjacentHTML("beforeend", customChip(q.id, raw));
    }
    input.value = "";
    if (updateTags(field)) field.querySelector("[data-tag-count]").focus(); else input.focus();
  }

  // 资料表单的草稿：u 是后端给的资料，有草稿就以草稿为准
  function withDraft(u) { const d = getDraft(); return d && d.profile ? Object.assign({}, u, d.profile) : u; }
  function rememberForm(form) {
    const adds = {};
    YL.ui.$$("[data-tags]", form).forEach((f) => { const i = f.querySelector("[data-add-input]"); if (i && i.value) adds[f.dataset.tags] = i.value; });
    setDraft({ profile: collectProfile(form), adds });
  }
  function restoreAdds(form) {
    const d = getDraft();
    if (!d || !d.adds) return;
    YL.ui.$$("[data-tags]", form).forEach((f) => { const i = f.querySelector("[data-add-input]"); if (i && !i.disabled && d.adds[f.dataset.tags]) i.value = d.adds[f.dataset.tags]; });
  }

  // onSaved(me) 在保存成功后调用
  // 简历那一块（[data-resume]）有自己的事件（bindResume），不算进资料草稿，也不随表单提交
  const inResume = (e) => !!(e.target.closest && e.target.closest("[data-resume]"));
  function bindProfileForm(form, ctx, onSaved) {
    YL.ui.$$("[data-tags]", form).forEach(updateTags);
    restoreAdds(form);
    const resumeBox = form.querySelector("[data-resume]");
    if (resumeBox) bindResume(resumeBox, ctx);
    let saving = false;
    form.addEventListener("change", (e) => {
      if (inResume(e)) return;
      const x = e.target;
      if (x.name === "identity") YL.ui.$$("[data-when]", form).forEach((s) => { s.hidden = s.dataset.when.split(" ").indexOf(x.value) < 0; });
      // 博士后、其他：不要求毕业年份，藏起来
      if (x.name === "stage") { const g = form.querySelector("[data-grad]"); if (g) { g.hidden = GRAD_STAGES().indexOf(x.value) < 0; if (g.hidden) clearOne(g); } }
      const tagsField = x.closest("[data-tags]");
      if (tagsField && x.type === "checkbox") updateTags(tagsField);
      const field = x.closest("[data-field]");
      if (field && field.classList.contains("is-invalid") && x.type !== "text") clearOne(field);
      rememberForm(form);
    });
    form.addEventListener("input", (e) => {
      if (inResume(e)) return;
      const x = e.target;
      if (!x.matches("[data-add-input]")) clearOnEdit(e);
      if (x.tagName === "TEXTAREA") {
        const c = form.querySelector(`[data-count-for="${CSS.escape(x.name)}"]`);
        if (c) c.textContent = `${x.value.length} / ${c.dataset.max}`;
      }
      rememberForm(form);
    });
    form.addEventListener("keydown", (e) => {
      // 自定义标签输入框里回车 = 添加（输入法选词时的回车不算）
      if (e.key === "Enter" && e.target.matches("[data-add-input]") && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        addTag(form, e.target.closest("[data-tags]"));
        rememberForm(form);
      }
    });
    form.addEventListener("click", (e) => {
      if (inResume(e)) return;
      if (e.target.closest("[data-discard]")) { clearDraft(); return; } // 取消 = 不要这些修改了（不再留草稿）
      // 改联系方式被拒（reverify_yale）：用耶鲁邮箱重新登录后回到这一页，没保存的修改还在
      const relogin = e.target.closest('[data-act="relogin"]');
      if (relogin) { rememberForm(form); reloginWithYale(relogin, ctx, location.hash.replace(/^#\/?/, "")); return; }
      const add = e.target.closest("[data-add-tag]");
      if (add) { addTag(form, add.closest("[data-tags]")); rememberForm(form); return; }
      const chip = e.target.closest("[data-custom-for]");
      if (chip) {
        const field = chip.closest("[data-tags]");
        chip.remove();
        updateTags(field);
        rememberForm(form);
        const input = field.querySelector("[data-add-input]");
        if (input) input.focus();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      setMsg(form, "");
      const body = collectProfile(form);
      const check = D.validateProfile(body, YL.auth.questions(), thisYear(), { isGuest: !!(YL.auth.user() || {}).isGuest });
      if (!check.ok) { YL.ui.showFieldErrors(form, check.fields, "profile"); return; }
      YL.ui.clearFieldErrors(form);
      const btn = form.querySelector('button[type="submit"]');
      saving = true;
      YL.ui.busy(btn, true);
      const r = await YL.api.post("/me/profile", body);
      if (!ctx.isActive()) return;
      saving = false;
      YL.ui.busy(btn, false);
      if (!r.ok) {
        const er = r.error || {};
        if (isNeedsConsent(er)) { rememberForm(form); reconsent(ctx); return; }
        if (er.fields) YL.ui.showFieldErrors(form, er.fields, "profile");
        else if (er.reason === "reverify_yale") showReverify(form, t("profile.reverify.contactMethod"), 'data-act="relogin"');
        else setMsg(form, YL.ui.errorText(er, "profile"));
        return;
      }
      clearDraft();
      YL.auth.set(r.data);
      onSaved(r.data);
    });
  }

  /* ---------- 简历（RFC 0003 §4）：选好文件就上传（POST /me/resume，请求体就是 PDF），不跟资料表单一起提交 ----------
     状态（uploading、resumeErr）在文件开头 */
  const resumeMax = () => limits().resumeBytes || 5 * 1024 * 1024;
  const resumeBox = () => document.querySelector("[data-resume]");
  function resumeHtml() {
    const me = YL.auth.user() || {};
    const r = me.resume;
    const busy = uploading && uploading.user === me.id;
    const fileInput = `<input type="file" class="sr-only" id="pf-resume-file" accept="application/pdf,.pdf" tabindex="-1" aria-hidden="true" data-resume-file>`;
    if (busy) {
      return `<div class="field" data-field="resume">
          <div class="filebox" aria-live="polite">
            <span class="filebox__icon">${icon("refresh")}</span>
            <div class="filebox__main">
              <p class="filebox__name">${esc(t("profile.resume.uploading", { pct: uploading.pct }))}</p>
              <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(uploading.pct)}" aria-label="${esc(t("profile.resume.progress"))}"><span data-pct="${esc(uploading.pct)}"></span></div>
            </div>
          </div>
        </div>`;
    }
    if (!r) {
      return `<div class="field" data-field="resume">
          <div class="filebox filebox--empty">
            <span class="filebox__icon">${icon("plus")}</span>
            <div class="filebox__main"><p class="filebox__name">${esc(t("profile.resume.none"))}</p><p class="filebox__meta">${esc(t("profile.resume.rules"))}</p></div>
            <button type="button" class="btn btn--secondary btn--sm" data-resume-act="pick">${esc(t("profile.resume.upload"))}</button>
          </div>
          ${fileInput}
        </div>`;
    }
    const vis = RESUME_VIS().indexOf(r.visibility) >= 0 ? r.visibility : "invited";
    return `<div class="field" data-field="resume">
        <div class="filebox">
          <span class="filebox__icon">${icon("check")}</span>
          <div class="filebox__main"><p class="filebox__name">resume.pdf</p><p class="filebox__meta">${esc(resumeMeta(r))}</p></div>
        </div>
        <div class="cluster">
          <a class="btn btn--secondary btn--sm" href="${myResumeUrl()}" target="_blank" rel="noopener">${icon("external")}${esc(t("profile.resume.view"))}</a>
          <button type="button" class="btn btn--secondary btn--sm" data-resume-act="pick">${icon("refresh")}${esc(t("profile.resume.replace"))}</button>
          <button type="button" class="btn btn--danger-ghost btn--sm" data-resume-act="delete">${icon("trash")}${esc(t("profile.resume.delete"))}</button>
        </div>
        ${fileInput}
      </div>
      <div class="field" data-field="resumeVisibility">
        <span class="field__label" id="pf-rv-l">${esc(t("profile.resume.visTitle"))}</span>
        <div class="radio-cards radio-cards--stack" role="radiogroup" aria-labelledby="pf-rv-l">
          ${RESUME_VIS().map((v) => `<label class="radio-card"><input type="radio" name="resumeVisibility" value="${esc(v)}"${vis === v ? " checked" : ""}><span class="radio-card__box"><strong>${esc(t("profile.resume.vis." + v))}</strong><span>${esc(t("profile.resume.vis." + v + "Sub"))}</span></span></label>`).join("")}
        </div>
      </div>`;
  }
  // 重画页面上现在的简历区；progress 只更新进度条（上传中不整块重画，读屏不会一直重念）
  function paintResume(box, focusSel) {
    if (!box || !box.isConnected) return;
    const me = YL.auth.user();
    box.innerHTML = resumeHtml();
    // 进度条宽度是动态值：渲染后用 CSSOM 设置（HTML 里不写 style 属性）
    YL.ui.$$(".progress > [data-pct]", box).forEach((el) => { el.style.width = el.dataset.pct + "%"; });
    const field = box.querySelector('[data-field="resume"]');
    if (field && resumeErr && me && resumeErr.user === me.id) {
      field.classList.add("is-invalid");
      field.insertAdjacentHTML("beforeend", `<p class="field__error" role="alert">${esc(resumeErrorText(resumeErr))}</p>`);
    }
    if (focusSel) { const f = box.querySelector(focusSel); if (f) f.focus(); }
  }
  // 字段错误（not_pdf / too_large / empty）用 profile.field.resume.<码>；其他（每天上传次数、网络……）用通用错误文案
  function resumeErrorText(err) {
    if (err.field) { const k = "profile.field.resume." + err.field; return t(k) !== k ? t(k) : t("profile.field.invalid"); }
    const e = err.error || {};
    if (e.code === "rate_limited") return t("profile.resume.err.rate_limited");
    if (e.code === "too_large") return t("profile.field.resume.too_large");
    return YL.ui.errorText(e, "profile");
  }
  function paintProgress() {
    const box = resumeBox();
    if (!box || !uploading) return;
    const bar = box.querySelector(".progress"), fill = box.querySelector(".progress > [data-pct]"), label = box.querySelector(".filebox__name");
    if (!bar || !fill) { paintResume(box); return; }
    bar.setAttribute("aria-valuenow", String(uploading.pct));
    fill.style.width = uploading.pct + "%";
    if (label) label.textContent = t("profile.resume.uploading", { pct: uploading.pct });
  }
  // 先在浏览器里查一遍（类型、大小、空文件、文件开头是不是 %PDF-），省得传了 5 MB 才被拒；最终以后端为准
  async function checkPdf(file) {
    if (!file.size) return "empty";
    if (file.size > resumeMax()) return "too_large";
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name || "")) return "not_pdf";
    try {
      const head = file.slice(0, 5);
      if (typeof head.text === "function" && (await head.text()) !== "%PDF-") return "not_pdf";
    } catch (e) { /* 读不了就交给后端判断 */ }
    return "";
  }
  async function startUpload(file, ctx) {
    const me = YL.auth.user();
    if (!me || uploading) return;
    resumeErr = null;
    const bad = await checkPdf(file);
    if (bad) { resumeErr = { user: me.id, field: bad }; paintResume(resumeBox(), "[data-resume-act=pick]"); return; }
    uploading = { user: me.id, pct: 0 };
    paintResume(resumeBox());
    const r = await YL.api.upload("/me/resume", file, "application/pdf", (f) => { if (uploading) { uploading.pct = Math.round(f * 100); paintProgress(); } });
    uploading = null;
    const now = YL.auth.user();
    if (!now || now.id !== me.id) return; // 中途退出登录了
    if (r.ok) {
      YL.auth.set(r.data);
      paintResume(resumeBox(), "[data-resume-act=pick]");
      YL.ui.toast(t("profile.resume.uploaded"), "success");
      return;
    }
    const e = r.error || {};
    if (isNeedsConsent(e)) { if (ctx.isActive()) reconsent(ctx); else YL.ui.toast(t("profile.err.needs_consent"), "error"); return; }
    resumeErr = e.fields && e.fields.resume ? { user: me.id, field: e.fields.resume } : { user: me.id, error: e };
    paintResume(resumeBox(), "[data-resume-act=pick]");
  }
  // 简历区的事件（只绑一次；里面的内容每次重画）
  function bindResume(box, ctx) {
    paintResume(box);
    let saving = false;
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-resume-act]");
      if (!b || b.disabled || uploading) return;
      const act = b.dataset.resumeAct;
      if (act === "pick") { const input = box.querySelector("[data-resume-file]"); if (input) input.click(); return; }
      if (act === "delete") {
        if (!(await YL.ui.confirm(t("profile.resume.deleteConfirm"), { danger: true, ok: t("profile.resume.delete") })) || !ctx.isActive()) { if (b.isConnected) b.focus(); return; }
        YL.ui.busy(b, true);
        const r = await YL.api.post("/me/resume/delete");
        if (!ctx.isActive()) return;
        YL.ui.busy(b, false);
        if (!r.ok) {
          if (isNeedsConsent(r.error)) { reconsent(ctx); return; }
          YL.ui.toast(YL.ui.errorText(r.error, "profile"), "error");
          return;
        }
        resumeErr = null;
        YL.auth.set(r.data);
        paintResume(box, "[data-resume-act=pick]");
        YL.ui.toast(t("profile.resume.deleted"));
      }
    });
    box.addEventListener("change", async (e) => {
      const x = e.target;
      if (x.matches("[data-resume-file]")) {
        const file = x.files && x.files[0];
        x.value = ""; // 同一个文件改过之后可以再选一次
        if (file) startUpload(file, ctx);
        return;
      }
      if (x.name !== "resumeVisibility" || saving) return;
      saving = true;
      const r = await YL.api.post("/me/resume/settings", { visibility: x.value });
      saving = false;
      if (!ctx.isActive()) return;
      if (!r.ok) {
        const me = YL.auth.user() || {};
        YL.ui.$$('input[name="resumeVisibility"]', box).forEach((i) => { i.checked = !!me.resume && i.value === me.resume.visibility; });
        if (isNeedsConsent(r.error)) { reconsent(ctx); return; }
        YL.ui.toast(YL.ui.errorText(r.error, "profile"), "error");
        return;
      }
      YL.auth.set(r.data);
      YL.ui.toast(t("profile.resume.visSaved." + (r.data.resume && r.data.resume.visibility === "all" ? "all" : "invited")), "success");
    });
  }

  /* ---------- 读取本人资料（"我的"与"修改资料"都先拉一次最新的）---------- */
  async function loadMe(root, ctx, headHtml) {
    root.innerHTML = `<section class="page">${headHtml}${YL.ui.spinner()}</section>`;
    const r = await YL.api.get("/me");
    if (!ctx.isActive()) return null;
    if (!r.ok) {
      root.innerHTML = `<section class="page">${headHtml}${empty("alertCircle", YL.ui.errorText(r.error, "profile"), "", `<button type="button" class="btn btn--primary" data-retry>${icon("refresh")}${esc(t("common.retry"))}</button>`)}</section>`;
      root.querySelector("[data-retry]").addEventListener("click", () => YL.router.render());
      return null;
    }
    YL.auth.set(r.data);
    if (!r.data.ready) { YL.router.navigate("profile/setup?next=" + encodeURIComponent(ctx.path || "profile"), { replace: true }); return null; }
    if (!YL.auth.questions().length) {
      root.innerHTML = `<section class="page">${headHtml}${empty("alertCircle", t("profile.err.noQuestionsTitle"), t("profile.err.noQuestions"), `<button type="button" class="btn btn--primary" data-reload>${icon("refresh")}${esc(t("common.retry"))}</button>`)}</section>`;
      root.querySelector("[data-reload]").addEventListener("click", () => location.reload());
      return null;
    }
    return r.data;
  }

  /* ---------- #/profile/setup 首次填写 ---------- */
  /* ?only=consent：只走"同意隐私说明"这一步，同意后回到 next。给不需要完成首次填写、但会保存个人信息的页面用（意见箱）：
     不为了提一条意见就要求填联系邮箱和资料；进约咖啡时路由照样会带人来补完 */
  function renderSetup(root, ctx) {
    const next = YL.router.safeNext(ctx.query.next, "coffee");
    const consentOnly = ctx.query.only === "consent";
    if (YL.auth.isReady()) { YL.router.navigate(ctx.query.next ? next : "profile", { replace: true }); return; }
    if (consentOnly && !YL.auth.user().needsConsent) { YL.router.navigate(next, { replace: true }); return; }
    root.innerHTML = `
      <section class="page page--narrow" data-setup>
        <header class="page-head"><div class="page-head__text">
          <p class="eyebrow">${esc(consentOnly ? t("nav.privacy") : t("profile.setup.eyebrow"))}</p>
          <h1 class="page-title">${esc(consentOnly ? t("profile.setup.consentOnlyTitle") : t("profile.setup.title"))}</h1>
          <p class="page-sub">${esc(consentOnly ? t("profile.setup.consentOnlySub") : t("profile.setup.sub"))}</p>
        </div></header>
        ${consentOnly ? "" : `<ol class="steps" aria-label="${esc(t("profile.setup.progress"))}" data-steps></ol>`}
        <div data-step></div>
      </section>`;
    const el = root.querySelector("[data-setup]");
    const stepsEl = el.querySelector("[data-steps]");
    const body = el.querySelector("[data-step]");

    const stepOf = (u) => {
      if (u.needsConsent) return "consent";
      // 联系邮箱填了还没验证、也没点过"稍后再验证"（比如发了验证码就刷新了页面）：还停在这一步，不当作已完成
      if (u.needsContact || contactStepOpen === u.id || pendingFor(u) || (u.needsProfile && u.contactEmail && !u.contactVerified && laterChosen !== u.id)) return "contact";
      if (u.needsProfile) return "profile";
      return null;
    };

    function draw(focus) {
      clearInterval(timer);
      const u = YL.auth.user();
      if (!u || !ctx.isActive()) return;
      if (consentOnly && !u.needsConsent) { YL.router.navigate(next, { replace: true }); return; }
      if (u.ready && !pendingFor(u)) {
        contactStepOpen = null;
        YL.ui.toast(t("profile.setup.done"), "success");
        YL.router.navigate(next, { replace: true });
        return;
      }
      const cur = stepOf(u);
      const done = { consent: !u.needsConsent, contact: !u.needsContact && cur !== "contact", profile: !u.needsProfile };
      if (stepsEl) stepsEl.innerHTML = ["consent", "contact", "profile"].map((s) => {
        const state = s === cur ? " is-current" : done[s] ? " is-done" : "";
        return `<li class="steps__item${state}"${s === cur ? ' aria-current="step"' : ""}>${esc(t("profile.steps." + s))}${state === " is-done" ? `<span class="sr-only">${esc(t("profile.steps.done"))}</span>` : ""}</li>`;
      }).join("");
      if (cur === "consent") drawConsent();
      else if (cur === "contact") drawContact(u);
      else if (cur === "profile") drawProfile(u);
      else body.innerHTML = empty("alertCircle", t("router.error"), "", `<a class="btn btn--primary" href="#/profile">${esc(t("nav.me"))}</a>`);
      if (focus) focusHeading(body);
    }

    function drawConsent() {
      const items = [["shield", "collect"], ["user", "visible"], ["lock", "contact"], ["mail", "emails"], ["sliders", "smart"], ["trash", "leave"]];
      body.innerHTML = `
        <form class="card stack" data-consent novalidate>
          <div class="stack stack--s">
            <h2 class="section-title" tabindex="-1" data-focus>${esc(t("profile.consent.title"))}</h2>
            <p class="small muted">${esc(t("profile.consent.sub"))}</p>
          </div>
          <ul class="list">
            ${items.map(([ic, k]) => `<li class="list__item"><span class="muted">${icon(ic)}</span><div class="list__main"><span class="list__title">${esc(t("profile.consent." + k + "Title"))}</span><span class="list__sub">${esc(t("profile.consent." + k))}</span></div></li>`).join("")}
          </ul>
          <div class="cluster"><a class="btn btn--secondary" href="#/about/privacy">${icon("shield")}${esc(t("profile.consent.full"))}</a></div>
          <div class="field" data-field="consent">
            <label class="check-row"><input type="checkbox" name="agree"><span>${esc(t("profile.consent.agree"))}</span></label>
          </div>
          <div data-msg hidden></div>
          <button type="submit" class="btn btn--primary btn--block btn--lg">${esc(t("profile.consent.submit"))}</button>
        </form>`;
      const form = body.querySelector("[data-consent]");
      form.addEventListener("change", () => YL.ui.clearFieldErrors(form));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!form.querySelector('[name="agree"]').checked) { YL.ui.showFieldErrors(form, { consent: "required" }, "profile"); return; }
        const btn = form.querySelector('button[type="submit"]');
        setMsg(form, "");
        YL.ui.busy(btn, true);
        const r = await YL.api.post("/me/consent", { version: YL.auth.meta().consentVersion });
        if (!ctx.isActive()) return;
        YL.ui.busy(btn, false);
        if (!r.ok) {
          const er = r.error || {};
          if (er.fields) YL.ui.showFieldErrors(form, er.fields, "profile");
          else setMsg(form, YL.ui.errorText(er, "profile"));
          return;
        }
        YL.auth.set(r.data);
        draw(true);
      });
    }

    function drawContact(u) {
      contactStepOpen = u.id;
      body.innerHTML = `
        <section class="card stack" aria-labelledby="setup-contact-title">
          <div class="stack stack--s">
            <h2 class="section-title" id="setup-contact-title" tabindex="-1" data-focus>${esc(t("profile.contact.setupTitle"))}</h2>
            <p class="small muted">${esc(t("profile.contact.why"))}</p>
          </div>
          ${notice("info", "", `<p>${esc(t("profile.contact.untilVerified"))}</p>`)}
          <div data-cw-host></div>
        </section>`;
      const done = () => { contactStepOpen = null; draw(true); };
      const d = getDraft();
      contactWidget(body.querySelector("[data-cw-host]"), ctx, {
        mode: pendingFor(u) ? "code" : "enter",
        // 嘉宾的登录邮箱通常就是常用邮箱：先填上（和登录邮箱相同时后端直接算已验证，不再发验证码）
        email: d && d.contactEmail != null ? d.contactEmail : u.contactEmail || (u.isGuest ? u.loginEmail || "" : ""),
        reloginNext: "profile/setup?next=" + encodeURIComponent(next),
        focus: false,
        onDone: done,
        onLater: () => { laterChosen = u.id; done(); }
      });
    }

    function drawProfile(u) {
      if (!YL.auth.questions().length) {
        body.innerHTML = empty("alertCircle", t("profile.err.noQuestionsTitle"), t("profile.err.noQuestions"), `<button type="button" class="btn btn--primary" data-reload>${icon("refresh")}${esc(t("common.retry"))}</button>`);
        body.querySelector("[data-reload]").addEventListener("click", () => location.reload());
        return;
      }
      body.innerHTML = `
        <section class="card stack" aria-labelledby="setup-profile-title">
          <div class="stack stack--s">
            <h2 class="section-title" id="setup-profile-title" tabindex="-1" data-focus>${esc(t("profile.setup.profileTitle"))}</h2>
            <p class="small muted">${esc(t("profile.setup.profileSub"))}</p>
          </div>
          ${u.contactVerified ? "" : notice("warn", "", `<p>${esc(t("profile.setup.contactUnverified"))}</p>`)}
          ${profileFormHtml(withDraft(u), t("profile.setup.finish"), "", contactMethodNeedsYale(u))}
        </section>`;
      bindProfileForm(body.querySelector("[data-profile-form]"), ctx, () => draw(true));
    }

    draw(false);
  }

  /* ---------- #/profile 我的 ---------- */
  const meHead = () => `<header class="page-head"><div class="page-head__text"><h1 class="page-title">${esc(t("profile.me.title"))}</h1><p class="page-sub">${esc(t("profile.me.sub"))}</p></div></header>`;

  const meetTag = (mode) => (MEET_MODES().indexOf(mode) >= 0 ? `<span class="tag tag--meet">${icon("mapPin")}${esc(t("profile.meet." + mode))}</span>` : "");
  function personCard(u) {
    const qs = YL.auth.questions().filter((q) => q.public);
    const a = u.answers || {};
    const meta = identityParts(u);
    const tagHtml = [meetTag(u.meetMode)].filter(Boolean);
    const intros = [];
    qs.forEach((q) => {
      const v = a[q.id];
      if (q.type === "text") { if (v) intros.push(v); return; }
      if (q.type === "single") { if (v) meta.push(optionLabel(q, v)); return; }
      (Array.isArray(v) ? v : []).forEach((x) => tagHtml.push(YL.ui.tag(optionLabel(q, x), q.type === "multi" ? "tag--goal" : "")));
    });
    const name = u.name || YL.auth.displayName();
    // 只有匹配的人能看到的两项：联系方式、具体地点
    const privateRow = (label, value) => `<div class="stack stack--s">
            <span class="xsmall faint">${esc(label)}</span>
            <span class="person__overlap">${icon("lock")}<span>${esc(value)}</span></span>
          </div>`;
    return `
      <article class="person" aria-labelledby="me-name">
        <div class="person__head">
          ${avatar(name, "lg")}
          <div class="person__who">
            <div class="person__title"><p class="person__name" id="me-name">${esc(name)}${aliasHtml(u)}</p>${u.role === "mentor" ? mentorPill() : ""}</div>
            <p class="person__meta">${meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join("")}</p>
          </div>
        </div>
        ${tagHtml.length ? `<div class="tags">${tagHtml.join("")}</div>` : ""}
        ${intros.length ? intros.map((x) => `<p class="person__intro">${esc(x)}</p>`).join("") : `<p class="person__intro faint">${esc(t("profile.me.noIntro"))}</p>`}
        ${u.freeText ? `<div class="stack stack--s"><span class="xsmall faint">${esc(t("profile.form.freeText"))}</span><p class="person__text">${esc(u.freeText)}</p></div>` : ""}
        <div class="person__foot">
          <div class="stack">
            ${privateRow(t("profile.me.contactMethodLabel"), u.contactMethod || "")}
            ${u.meetPlace ? privateRow(t("profile.me.meetPlaceLabel"), u.meetPlace) : ""}
          </div>
          <div class="person__actions"><a class="btn btn--secondary" href="#/profile/edit">${icon("edit")}${esc(t("profile.me.edit"))}</a></div>
        </div>
      </article>`;
  }
  // "我的"里的简历状态：有没有、多大、谁能看；上传 / 替换 / 删除在修改资料页（#/profile/edit?focus=resume）
  function resumeCard(u) {
    const r = u.resume;
    const vis = r && r.visibility === "all" ? "all" : "invited";
    return `<section class="card stack" aria-labelledby="me-resume">
        <div class="cluster cluster--between">
          <h2 class="card__title" id="me-resume">${esc(t("profile.resume.cardTitle"))}</h2>
          ${r ? `<span class="pill pill--success">${icon("check")}${esc(t("profile.resume.has"))}</span>` : `<span class="pill">${esc(t("profile.resume.hasNot"))}</span>`}
        </div>
        ${r ? `<ul class="list">
            <li class="list__item"><span class="muted">${icon("check")}</span><div class="list__main"><span class="list__title">resume.pdf</span><span class="list__sub">${esc(resumeMeta(r))}</span></div></li>
            <li class="list__item"><span class="muted">${icon("lock")}</span><div class="list__main"><span class="list__title">${esc(t("profile.resume.vis." + vis))}</span><span class="list__sub">${esc(t("profile.resume.vis." + vis + "Sub"))}</span></div></li>
          </ul>
          <div class="cluster">
            <a class="btn btn--secondary btn--sm" href="${myResumeUrl()}" target="_blank" rel="noopener">${icon("external")}${esc(t("profile.resume.view"))}</a>
            <a class="btn btn--ghost btn--sm" href="#/profile/edit?focus=resume">${icon("edit")}${esc(t("profile.resume.manage"))}</a>
          </div>`
        : `<p class="small muted">${esc(t("profile.resume.cardNone"))}</p>
          <div><a class="btn btn--secondary btn--sm" href="#/profile/edit?focus=resume">${icon("plus")}${esc(t("profile.resume.upload"))}</a></div>`}
      </section>`;
  }

  const switchHtml = (attrs, title, sub, checked, disabled) =>
    `<label class="switch"><span class="switch__text"><span>${esc(title)}</span><small>${esc(sub)}</small></span><input type="checkbox" role="switch" ${attrs}${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span class="switch__track"></span></label>`;
  const linkRow = (href, ic, title, sub) =>
    `<a class="list__item list__link" href="${href}">${icon(ic)}<span class="list__main"><span class="list__title">${esc(title)}</span><span class="list__sub">${esc(sub)}</span></span>${icon("chevronRight")}</a>`;

  async function renderMe(root, ctx) {
    // 从登录页回来时带着 ?change=contact：去掉参数（以后重绘不会再自动打开），这次打开"更换联系邮箱"
    if (ctx.query.change === "contact") { openChangeOnce = true; YL.router.navigate("profile", { replace: true }); return; }
    const u = await loadMe(root, ctx, meHead());
    if (u) drawMe(root, ctx, "");
  }

  function drawMe(root, ctx, focusSel) {
    clearInterval(timer);
    const u = YL.auth.user();
    const meta = YL.auth.meta();
    const prefs = u.prefs || {};
    const pill = u.contactVerified
      ? `<span class="pill pill--success">${icon("check")}${esc(t("profile.account.verified"))}</span>`
      : `<span class="pill pill--warn">${esc(t("profile.account.unverified"))}</span>`;
    root.innerHTML = `
      <section class="page" data-me>
        ${meHead()}
        <div class="split">
          <div class="stack stack--l">
            <section class="stack" aria-labelledby="me-card-title">
              <div class="section-head"><div><h2 class="section-title" id="me-card-title">${esc(t("profile.me.cardTitle"))}</h2><p class="section-sub">${esc(t("profile.me.cardSub"))}</p></div></div>
              ${personCard(u)}
            </section>

            ${resumeCard(u)}

            <section class="card stack" aria-labelledby="me-account">
              <h2 class="card__title" id="me-account" tabindex="-1">${esc(t("profile.account.title"))}</h2>
              <ul class="list">
                <li class="list__item">
                  <span class="muted">${icon("cap")}</span>
                  <div class="list__main">
                    <span class="list__sub">${esc(t("profile.account.loginEmail"))}</span>
                    <span class="list__title">${emailHtml(u.loginEmail)}</span>
                    <span class="xsmall faint">${esc(u.isGuest ? t("profile.account.loginEmailGuest") : t("profile.account.loginEmailHint"))}</span>
                  </div>
                </li>
                <li class="list__item">
                  <span class="muted">${icon("mail")}</span>
                  <div class="list__main">
                    <span class="list__sub">${esc(t("profile.account.contactEmail"))}</span>
                    <span class="list__title">${emailHtml(u.contactEmail)}</span>
                    <span class="cluster">${pill}</span>
                  </div>
                </li>
              </ul>
              <div data-contact-panel></div>
            </section>

            <section class="card stack" aria-labelledby="me-notify">
              <div class="stack stack--s">
                <h2 class="card__title" id="me-notify">${esc(t("profile.notify.title"))}</h2>
                <p class="small muted">${fill(t(u.contactVerified ? "profile.notify.sub" : "profile.notify.subUnverified"), { email: `<strong>${emailHtml(u.contactVerified ? u.contactEmail : u.loginEmail)}</strong>` })}</p>
              </div>
              <div class="stack stack--s" data-prefs>
                ${switchHtml("", t("profile.notify.match"), t("profile.notify.matchSub"), true, true)}
                ${PREF_KEYS.map((k) => `<hr class="divider">${switchHtml(`data-pref="${k}"`, t("profile.notify." + k), t("profile.notify." + k + "Sub"), prefs[k] !== false, false)}`).join("")}
              </div>
            </section>

            ${meta.smartRecAvailable ? `
            <section class="card stack" aria-labelledby="me-smart">
              <h2 class="card__title" id="me-smart">${esc(t("profile.smart.title"))}</h2>
              ${switchHtml("data-smart", t("profile.smart.label"), t("profile.smart.sub"), u.smartRec !== false, false)}
              <p class="xsmall faint">${esc(t("profile.smart.note"))}</p>
            </section>` : ""}
          </div>

          <aside class="stack stack--l">
            ${u.adminNeedsYale ? notice("warn", "", `<p>${esc(t("profile.links.adminNeedsYale"))}</p><p><button type="button" class="btn btn--secondary btn--sm" data-act="admin-relogin">${esc(t("profile.links.adminRelogin"))}</button></p>`) : ""}
            <nav class="card card--tight" aria-label="${esc(t("profile.links.title"))}">
              <div class="list">
                ${u.isAdmin ? linkRow("#/admin", "chart", t("profile.links.admin"), t("profile.links.adminSub")) : ""}
                ${linkRow("#/about/privacy", "shield", t("profile.links.privacy"), t("profile.links.privacySub"))}
                ${linkRow("#/about/feedback", "message", t("profile.links.feedback"), t("profile.links.feedbackSub"))}
              </div>
            </nav>
            <div class="stack stack--s">
              <button type="button" class="btn btn--secondary btn--block" data-act="logout">${icon("logout")}${esc(t("profile.logout"))}</button>
              <button type="button" class="btn btn--ghost btn--block" data-act="logoutAll">${esc(t("profile.logoutAll"))}</button>
            </div>
            <section class="card stack" aria-labelledby="me-danger">
              <div class="stack stack--s">
                <h2 class="card__title" id="me-danger">${esc(t("profile.delete.title"))}</h2>
                <p class="small muted">${esc(t("profile.delete.sub"))}</p>
              </div>
              <button type="button" class="btn btn--danger-ghost btn--block" data-act="delete">${icon("trash")}${esc(t("profile.delete.open"))}</button>
            </section>
          </aside>
        </div>
      </section>`;
    const el = root.querySelector("[data-me]");
    const panel = el.querySelector("[data-contact-panel]");

    // 联系邮箱区域：收起时显示操作按钮；展开时是填邮箱 / 输验证码
    function closedPanel() {
      clearInterval(timer);
      panel.innerHTML = `<div class="stack stack--s">
          ${u.contactVerified ? "" : notice("warn", "", `<p>${esc(t("profile.account.unverifiedBody"))}</p>`)}
          <div class="cluster">
            ${u.contactVerified ? "" : `<button type="button" class="btn btn--primary" data-act="verify-contact">${icon("mail")}${esc(t("profile.account.verifyNow"))}</button>`}
            <button type="button" class="btn btn--secondary" data-act="change-contact">${icon("edit")}${esc(t("profile.account.change"))}</button>
          </div>
        </div>`;
    }
    const backToClosed = () => { clearDraft(["contactOpen", "contactEmail"]); closedPanel(); const b = panel.querySelector('[data-act="change-contact"]'); if (b) b.focus(); };
    function openPanel(mode, email, autoSend, focus) {
      contactWidget(panel, ctx, {
        mode, email, autoSend, focus: focus !== false,
        onDone: () => drawMe(root, ctx, "#me-account"),
        onCancel: backToClosed
      });
    }
    // 换联系邮箱：这次是用联系邮箱登录的就换不了（后端会拒绝），直接说明并给出"用耶鲁邮箱重新登录"
    function openChange(email, focus) {
      setDraft({ contactOpen: true, contactEmail: email || "" });
      if (!changeNeedsYale(u)) { openPanel("enter", email || "", false, focus); return; }
      panel.innerHTML = `<div class="stack stack--s">
          ${notice("warn", "", `<p>${esc(t("profile.err.reverify_yale"))}</p>`)}
          <div class="cluster">
            <button type="button" class="btn btn--primary" data-act="relogin">${icon("logout")}${esc(t("profile.contact.relogin"))}</button>
            <button type="button" class="btn btn--ghost" data-act="close-change">${esc(t("common.cancel"))}</button>
          </div>
        </div>`;
      if (focus !== false) panel.querySelector('[data-act="relogin"]').focus();
    }
    const d = getDraft();
    if (pendingFor(u)) openPanel("code", u.contactEmail, false, false);
    else if (openChangeOnce) { openChangeOnce = false; openChange("", true); }
    else if (d && d.contactOpen) openChange(d.contactEmail || "", false);
    else closedPanel();

    async function savePrefs(changed) {
      const next = {};
      YL.ui.$$("[data-pref]", el).forEach((x) => (next[x.dataset.pref] = x.checked));
      next.match = true;
      const smartEl = el.querySelector("[data-smart]");
      const smartRec = smartEl ? smartEl.checked : YL.auth.user().smartRec !== false;
      const seq = ++prefSeq;
      const r = await YL.api.post("/me/prefs", { prefs: next, smartRec });
      if (!ctx.isActive() || !document.body.contains(changed)) return;
      if (!r.ok) {
        // 回滚到后端最后一次确认的状态
        const me = YL.auth.user() || {};
        YL.ui.$$("[data-pref]", el).forEach((x) => (x.checked = (me.prefs || {})[x.dataset.pref] !== false));
        if (smartEl) smartEl.checked = me.smartRec !== false;
        if (isNeedsConsent(r.error)) { reconsent(ctx); return; }
        YL.ui.toast(YL.ui.errorText(r.error, "profile"), "error");
        return;
      }
      if (seq === prefSeq) { YL.auth.set(r.data); YL.ui.toast(t("profile.notify.saved"), "success"); }
    }

    el.addEventListener("change", (e) => {
      if (e.target.matches("[data-pref], [data-smart]")) savePrefs(e.target);
    });
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || !el.contains(b)) return;
      const act = b.dataset.act;
      if (act === "verify-contact") openPanel("enter", u.contactEmail, true);
      else if (act === "change-contact") openChange("", true);
      else if (act === "close-change") backToClosed();
      else if (act === "relogin") reloginWithYale(b, ctx, "profile?change=contact");
      else if (act === "admin-relogin") reloginWithYale(b, ctx, "admin");
      else if (act === "logout") {
        if (!(await signOut(b, ctx))) return;
        YL.ui.toast(t("profile.loggedOut"));
        YL.router.navigate("home");
      } else if (act === "logoutAll") {
        if (!(await YL.ui.confirm(t("profile.logoutAllConfirm"), { ok: t("profile.logoutAll") })) || !ctx.isActive()) return;
        if (!(await signOut(b, ctx, true))) return;
        YL.ui.toast(t("profile.logoutAllDone"));
        YL.router.navigate("home");
      } else if (act === "delete") openDelete(ctx);
    });

    if (focusSel) { const f = el.querySelector(focusSel); if (f) f.focus(); }
  }

  // 注销要求这次是用耶鲁邮箱登录的（后端规则：server/auth.js /me/delete）。用联系邮箱登录的人点"注销"时直接说明原因、给出重新登录按钮
  // （和"换联系邮箱"一样）；后端拒绝时也显示同一条提示
  const deleteNeedsYale = (u) => !!u && u.via !== "yale";
  function openDelete(ctx) {
    const needsYale = deleteNeedsYale(YL.auth.user());
    YL.ui.modal(`
      <h2 class="modal__title">${esc(t("profile.delete.confirmTitle"))}</h2>
      <form class="form" data-del novalidate>
        <p class="muted">${esc(t("profile.delete.body"))}</p>
        ${needsYale ? "" : `<div class="field" data-field="confirm">
          <label class="field__label" for="del-confirm">${fill(t("profile.delete.typeLabel"), { word: "<strong>DELETE</strong>" })}</label>
          <input class="input" id="del-confirm" name="confirm" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="DELETE">
        </div>`}
        <div data-msg hidden></div>
        <div class="confirm__actions">
          <button type="button" class="btn btn--secondary" data-close>${esc(t("common.cancel"))}</button>
          ${needsYale ? "" : `<button type="submit" class="btn btn--danger" disabled>${icon("trash")}${esc(t("profile.delete.submit"))}</button>`}
        </div>
      </form>`, {
      label: t("profile.delete.confirmTitle"),
      onMount(panel, close) {
        const form = panel.querySelector("[data-del]");
        const input = form.querySelector("#del-confirm");
        const submit = form.querySelector('button[type="submit"]');
        const reverify = () => { showReverify(form, t("profile.reverify.delete"), 'data-act="relogin"'); form.querySelector('[data-act="relogin"]').focus(); };
        panel.querySelector("[data-close]").addEventListener("click", close);
        form.addEventListener("click", (e) => {
          const b = e.target.closest('[data-act="relogin"]');
          if (b) reloginWithYale(b, ctx, "profile");
        });
        if (needsYale) { reverify(); return; }
        input.addEventListener("input", () => { submit.disabled = input.value.trim() !== "DELETE"; });
        input.focus();
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (input.value.trim() !== "DELETE") return;
          setMsg(form, "");
          YL.ui.busy(submit, true);
          const r = await YL.api.post("/me/delete", { confirm: "DELETE" });
          if (r.ok) {
            // 账号已经删掉了：不管用户这时在哪个页面，都清掉登录状态回首页
            pending = null;
            contactStepOpen = null;
            draft = null;
            kept = null;
            YL.ui.closeModal();
            YL.auth.set(null);
            YL.ui.toast(t("profile.delete.done"));
            YL.router.navigate("home");
            return;
          }
          if (!ctx.isActive() || !document.body.contains(form)) return;
          YL.ui.busy(submit, false);
          const er = r.error || {};
          if (er.fields) YL.ui.showFieldErrors(form, er.fields, "profile");
          else if (er.reason === "reverify_yale") reverify();
          else setMsg(form, YL.ui.errorText(er, "profile"));
        });
      }
    });
  }

  /* ---------- #/profile/edit 修改资料 ---------- */
  async function renderEdit(root, ctx) {
    const head = `<div><a class="btn btn--ghost" href="#/profile">${icon("chevronLeft")}${esc(t("common.back"))}</a></div>
      <header class="page-head"><div class="page-head__text"><h1 class="page-title">${esc(t("profile.edit.title"))}</h1><p class="page-sub">${esc(t("profile.edit.sub"))}</p></div></header>`;
    const u = await loadMe(root, ctx, head);
    if (!u) return;
    root.innerHTML = `<section class="page page--medium" data-edit>${head}<div class="card">${profileFormHtml(withDraft(u), t("common.save"), "#/profile", contactMethodNeedsYale(u))}</div></section>`;
    bindProfileForm(root.querySelector("[data-profile-form]"), ctx, () => {
      YL.ui.toast(t("common.saved"), "success");
      YL.router.navigate("profile");
    });
    // 从"我的"里的简历卡片过来：直接滚到简历那一块
    if (ctx.query.focus === "resume") {
      const sec = root.querySelector("#pf-resume-section");
      if (sec) { sec.scrollIntoView({ block: "start" }); sec.focus({ preventScroll: true }); }
    }
  }

  registerModule({
    id: "profile",
    requiresAuth: true,
    nav: [{ path: "profile", icon: "user", labelKey: "nav.me", order: 50, mobile: true, when: () => YL.auth.isReady() }],
    render(root, ctx) {
      clearInterval(timer);
      if (ctx.sub === "setup") return renderSetup(root, ctx);
      if (!YL.auth.isReady()) { YL.router.navigate("profile/setup?next=" + encodeURIComponent(ctx.path || "profile"), { replace: true }); return; }
      if (ctx.sub === "edit") return renderEdit(root, ctx);
      if (ctx.sub) { YL.router.navigate("profile", { replace: true }); return; }
      return renderMe(root, ctx);
    }
  });
})();
