/* 我的：首次填写（同意说明 → 联系邮箱 → 资料）、我的页面、修改资料
   Me: first-time onboarding wizard, the "Me" page (profile card, account, notifications, sign out, delete) and profile editing.
   接口见 docs/api.md「登录与账号」；资料校验规则与后端共用 YL.domain.coffee.validateProfile。

   #/profile/setup[?next=…]  首次填写；完成后回到 next（默认 coffee）。已完成则去 #/profile
   #/profile                  我的
   #/profile/edit             修改资料 */
(function () {
  const { t, esc, L, icon, avatar } = YL.ui;
  const PREF_KEYS = ["invite_digest", "reminder", "weekly", "event"];
  const STAGES = ["undergrad", "master", "phd"];
  const RESEND_SECONDS = 60;
  const CODE_TTL_MS = 10 * 60000;

  // 表单逐项报错由 YL.ui.showFieldErrors(form, fields, "profile") 显示，文案键为 t("profile.field." + 字段 + "." + 错误码)，没有就用 t("profile.field." + 错误码)
  // 联系邮箱验证码已发出、等待输入：{ userId, email, sentTo, sentAt }。模块级保存，切换语言（路由重绘）后能接着输
  let pending = null;
  // 首次填写时停在"联系邮箱"这一步（发了验证码、还没验证也没选"稍后"）：值为用户 id
  let contactStepOpen = null;
  let timer = null;
  let prefSeq = 0;

  /* ---------- 小工具 ---------- */
  // 翻译句子先转义，再把 {占位符} 换成已转义的 HTML 片段
  const fill = (text, parts) => esc(text).replace(/\{(\w+)\}/g, (m, k) => (parts[k] != null ? parts[k] : m));
  const limits = () => YL.domain.coffee.LIMITS;
  const thisYear = () => new Date().getFullYear();
  const notice = (kind, iconName, bodyHtml, role) => `<div class="notice${kind ? " notice--" + kind : ""}"${role ? ` role="${role}"` : ""}>${icon(iconName)}<div class="notice__body">${bodyHtml}</div></div>`;
  // 长邮箱在 @ 前允许换行
  const emailHtml = (e) => { const s = String(e || ""), i = s.lastIndexOf("@"); return i > 0 ? esc(s.slice(0, i)) + "<wbr>" + esc(s.slice(i)) : esc(s); };
  const withoutSentTo = (data) => { const m = Object.assign({}, data); delete m.sentTo; return m; };
  const pendingFor = (u) => (pending && u && pending.userId === u.id && !u.contactVerified && u.contactEmail === pending.email && Date.now() - pending.sentAt < CODE_TTL_MS ? pending : null);
  const secondsLeft = () => (pending ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - pending.sentAt) / 1000)) : 0);
  // 提示条：没有内容时隐藏（不占表单间距）；出现时用 role=alert / status 让读屏念出来
  function setMsg(scope, text, kind) {
    const box = scope.querySelector("[data-msg]");
    if (!box) return;
    const ok = kind === "success";
    box.hidden = !text;
    box.innerHTML = text ? notice(ok ? "success" : "danger", ok ? "check" : "info", esc(text), ok ? "status" : "alert") : "";
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
  function identityLine(u) {
    if (u.identity === "student") return [u.stage ? t("profile.stage." + u.stage) : "", u.gradYear ? t("profile.classOf", { year: u.gradYear }) : ""].filter(Boolean).join(" · ");
    if (u.identity === "alumni") return [u.job, u.city].filter(Boolean).join(" · ");
    return "";
  }

  /* ---------- 联系邮箱：填邮箱 → 发验证码 → 输验证码（首次填写与"我的"共用）----------
     opts = { mode: "enter" | "code", email, autoSend, onDone(me), onLater(), onCancel() } */
  function contactWidget(host, ctx, opts) {
    host.innerHTML = `<div class="stack" data-cw-root></div>`;
    const w = host.firstElementChild;
    let verifying = false;
    const alive = () => ctx.isActive() && document.body.contains(w);
    const cancelBtn = opts.onCancel ? `<button type="button" class="btn btn--ghost btn--block" data-cw="cancel">${esc(t("common.cancel"))}</button>` : "";

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
        </form>`;
      if (focus) w.querySelector("#cw-email").focus();
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
          ${opts.onLater ? notice("", "clock", `<span>${esc(t("profile.contact.laterBody"))}</span><span><button type="button" class="link-btn" data-cw="later">${esc(t("profile.contact.later"))}</button></span>`) : ""}
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

    function showReverify() {
      const box = w.querySelector("[data-msg]");
      if (box) box.hidden = false;
      if (box) box.innerHTML = notice("warn", "lock", `<span>${esc(t("profile.err.reverify_yale"))}</span><span><button type="button" class="btn btn--secondary" data-cw="relogin">${esc(t("profile.contact.relogin"))}</button></span>`, "alert");
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
        // 60 秒内刚给同一个（未验证的）邮箱发过：之前的验证码还有效，直接去输入
        if (e.reason === "resend_too_soon" && !me.contactVerified && String(me.contactEmail || "") === email.toLowerCase()) {
          pending = { userId: me.id, email: me.contactEmail, sentTo: "", sentAt: Date.now() };
          code(true);
          return;
        }
        if (e.fields) YL.ui.showFieldErrors(form, e.fields, "profile");
        else if (e.reason === "reverify_yale") showReverify();
        else setMsg(w, YL.ui.errorText(e, "profile"));
        return;
      }
      const sentTo = r.data.sentTo;
      YL.auth.set(withoutSentTo(r.data));
      if (!sentTo) { pending = null; opts.onDone(YL.auth.user()); return; } // 已经验证过的同一个邮箱
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
      else if (act === "later") { pending = null; clearInterval(timer); opts.onLater(); }
      else if (act === "cancel") { pending = null; clearInterval(timer); opts.onCancel(); }
      else if (act === "relogin") {
        YL.ui.busy(b, true);
        await YL.auth.logout();
        pending = null;
        YL.router.navigate("login?next=profile");
      }
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

  function profileFormHtml(u, submitLabel, cancelHref) {
    const qs = YL.auth.questions();
    const a = u.answers || {};
    const id = u.identity || "";
    const lim = limits();
    const years = [];
    for (let y = thisYear(); y <= thisYear() + lim.gradYearsAhead; y++) years.push(y);
    const input = (name, max, auto, hintKey, phKey) => `<div class="field" data-field="${name}">
        <label class="field__label" for="pf-${name}">${esc(t("profile.form." + name))}${req}</label>
        <input class="input" id="pf-${name}" name="${name}" maxlength="${max}"${auto ? ` autocomplete="${auto}"` : ""} value="${esc(u[name] || "")}"${phKey ? ` placeholder="${esc(t(phKey))}"` : ""}${hintKey ? ` aria-describedby="pf-${name}-hint"` : ""}>
        ${hintKey ? `<p class="field__hint" id="pf-${name}-hint">${esc(t(hintKey))}</p>` : ""}
      </div>`;
    return `
      <form class="form" data-profile-form novalidate>
        ${YL.ui.sectionTitle(t("profile.form.aboutTitle"))}
        ${input("name", lim.name, "name", "profile.form.nameHint", "")}
        <div class="field" data-field="identity">
          <span class="field__label" id="pf-identity-l">${esc(t("profile.form.identity"))}${req}</span>
          <div class="radio-cards" role="radiogroup" aria-labelledby="pf-identity-l">
            ${["student", "alumni"].map((v) => `<label class="radio-card"><input type="radio" name="identity" value="${v}"${id === v ? " checked" : ""}><span class="radio-card__box"><strong>${esc(t("profile.identity." + v))}</strong><span>${esc(t("profile.identity." + v + "Sub"))}</span></span></label>`).join("")}
          </div>
        </div>
        <div class="stack" data-when="student"${id === "student" ? "" : " hidden"}>
          <div class="field" data-field="stage">
            <span class="field__label" id="pf-stage-l">${esc(t("profile.form.stage"))}${req}</span>
            <div class="chips" role="radiogroup" aria-labelledby="pf-stage-l">
              ${STAGES.map((s) => `<label class="choice"><input type="radio" class="sr-only" name="stage" value="${s}"${u.stage === s ? " checked" : ""}><span class="chip">${esc(t("profile.stage." + s))}</span></label>`).join("")}
            </div>
          </div>
          <div class="field" data-field="gradYear">
            <label class="field__label" for="pf-gradYear">${esc(t("profile.form.gradYear"))}${req}</label>
            <select class="select" id="pf-gradYear" name="gradYear">
              <option value="">${esc(t("profile.form.choose"))}</option>
              ${years.map((y) => `<option value="${y}"${Number(u.gradYear) === y ? " selected" : ""}>${esc(t("profile.classOf", { year: y }))}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="stack" data-when="alumni"${id === "alumni" ? "" : " hidden"}>
          ${input("job", lim.job, "organization-title", "", "profile.form.jobPlaceholder")}
          ${input("city", lim.city, "address-level2", "", "profile.form.cityPlaceholder")}
        </div>

        ${YL.ui.sectionTitle(t("profile.form.chatTitle"), "", t("profile.form.chatSub"))}
        ${qs.map((q) => questionHtml(q, a)).join("")}

        ${YL.ui.sectionTitle(t("profile.form.contactTitle"))}
        <div class="field" data-field="contactMethod">
          <label class="field__label" for="pf-contactMethod">${esc(t("profile.form.contactMethod"))}${req}</label>
          <input class="input" id="pf-contactMethod" name="contactMethod" maxlength="${lim.contactMethod}" autocomplete="off" value="${esc(u.contactMethod || "")}" placeholder="${esc(t("profile.form.contactMethodPlaceholder"))}" aria-describedby="pf-contactMethod-hint">
          <p class="field__hint" id="pf-contactMethod-hint">${esc(t("profile.form.contactMethodHint"))}</p>
        </div>

        <div data-msg hidden></div>
        <div class="stack stack--s">
          <button type="submit" class="btn btn--primary btn--block btn--lg">${esc(submitLabel)}</button>
          ${cancelHref ? `<a class="btn btn--ghost btn--block" href="${cancelHref}">${esc(t("common.cancel"))}</a>` : ""}
        </div>
      </form>`;
  }

  function collectProfile(form) {
    const val = (n) => { const x = form.querySelector(`[name="${CSS.escape(n)}"]:not([type="radio"]):not([type="checkbox"])`); return x ? x.value.trim() : ""; };
    const checked = (n) => YL.ui.$$(`input[name="${CSS.escape(n)}"]:checked`, form).map((x) => x.value);
    const identity = checked("identity")[0] || "";
    const body = { name: val("name"), identity, contactMethod: val("contactMethod"), answers: {} };
    if (identity === "student") { body.stage = checked("stage")[0] || ""; body.gradYear = Number(val("gradYear")) || null; }
    if (identity === "alumni") { body.job = val("job"); body.city = val("city"); }
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

  // onSaved(me) 在保存成功后调用
  function bindProfileForm(form, ctx, onSaved) {
    YL.ui.$$("[data-tags]", form).forEach(updateTags);
    let saving = false;
    form.addEventListener("change", (e) => {
      const x = e.target;
      if (x.name === "identity") YL.ui.$$("[data-when]", form).forEach((s) => { s.hidden = s.dataset.when !== x.value; });
      const tagsField = x.closest("[data-tags]");
      if (tagsField && x.type === "checkbox") updateTags(tagsField);
      const field = x.closest("[data-field]");
      if (field && field.classList.contains("is-invalid") && x.type !== "text") clearOne(field);
    });
    form.addEventListener("input", (e) => {
      const x = e.target;
      if (!x.matches("[data-add-input]")) clearOnEdit(e);
      if (x.tagName === "TEXTAREA") {
        const c = form.querySelector(`[data-count-for="${CSS.escape(x.name)}"]`);
        if (c) c.textContent = `${x.value.length} / ${c.dataset.max}`;
      }
    });
    form.addEventListener("keydown", (e) => {
      // 自定义标签输入框里回车 = 添加（输入法选词时的回车不算）
      if (e.key === "Enter" && e.target.matches("[data-add-input]") && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        addTag(form, e.target.closest("[data-tags]"));
      }
    });
    form.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add-tag]");
      if (add) { addTag(form, add.closest("[data-tags]")); return; }
      const chip = e.target.closest("[data-custom-for]");
      if (chip) {
        const field = chip.closest("[data-tags]");
        chip.remove();
        updateTags(field);
        const input = field.querySelector("[data-add-input]");
        if (input) input.focus();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      setMsg(form, "");
      const body = collectProfile(form);
      const check = YL.domain.coffee.validateProfile(body, YL.auth.questions(), thisYear());
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
        if (er.fields) YL.ui.showFieldErrors(form, er.fields, "profile");
        else setMsg(form, YL.ui.errorText(er, "profile"));
        return;
      }
      YL.auth.set(r.data);
      onSaved(r.data);
    });
  }

  /* ---------- 读取本人资料（"我的"与"修改资料"都先拉一次最新的）---------- */
  async function loadMe(root, ctx, headHtml) {
    root.innerHTML = `<section class="page">${headHtml}${YL.ui.spinner()}</section>`;
    const r = await YL.api.get("/me");
    if (!ctx.isActive()) return null;
    if (!r.ok) {
      root.innerHTML = `<section class="page">${headHtml}${YL.ui.emptyState("info", YL.ui.errorText(r.error, "profile"), `<button type="button" class="btn btn--primary" data-retry>${icon("refresh")}${esc(t("common.retry"))}</button>`)}</section>`;
      root.querySelector("[data-retry]").addEventListener("click", () => YL.router.render());
      return null;
    }
    YL.auth.set(r.data);
    if (!r.data.ready) { YL.router.navigate("profile/setup?next=" + encodeURIComponent(ctx.path || "profile"), { replace: true }); return null; }
    if (!YL.auth.questions().length) {
      root.innerHTML = `<section class="page">${headHtml}${YL.ui.emptyState("info", t("profile.err.noQuestions"), `<button type="button" class="btn btn--primary" data-reload>${esc(t("common.retry"))}</button>`)}</section>`;
      root.querySelector("[data-reload]").addEventListener("click", () => location.reload());
      return null;
    }
    return r.data;
  }

  /* ---------- #/profile/setup 首次填写 ---------- */
  function renderSetup(root, ctx) {
    const next = YL.router.safeNext(ctx.query.next, "coffee");
    if (YL.auth.isReady()) { YL.router.navigate("profile", { replace: true }); return; }
    root.innerHTML = `
      <section class="page page--narrow" data-setup>
        <header class="page-head"><div class="page-head__text">
          <p class="eyebrow">${esc(t("profile.setup.eyebrow"))}</p>
          <h1 class="page-title">${esc(t("profile.setup.title"))}</h1>
          <p class="page-sub">${esc(t("profile.setup.sub"))}</p>
        </div></header>
        <ol class="steps" aria-label="${esc(t("profile.setup.progress"))}" data-steps></ol>
        <div data-step></div>
      </section>`;
    const el = root.querySelector("[data-setup]");
    const stepsEl = el.querySelector("[data-steps]");
    const body = el.querySelector("[data-step]");

    const stepOf = (u) => {
      if (u.needsConsent) return "consent";
      if (u.needsContact || contactStepOpen === u.id || pendingFor(u)) return "contact";
      if (u.needsProfile) return "profile";
      return null;
    };

    function draw(focus) {
      clearInterval(timer);
      const u = YL.auth.user();
      if (!u || !ctx.isActive()) return;
      if (u.ready && !pendingFor(u)) {
        contactStepOpen = null;
        YL.ui.toast(t("profile.setup.done"), "success");
        YL.router.navigate(next, { replace: true });
        return;
      }
      const cur = stepOf(u);
      const done = { consent: !u.needsConsent, contact: !u.needsContact && cur !== "contact", profile: !u.needsProfile };
      stepsEl.innerHTML = ["consent", "contact", "profile"].map((s) => {
        const state = s === cur ? " is-current" : done[s] ? " is-done" : "";
        return `<li class="steps__item${state}"${s === cur ? ' aria-current="step"' : ""}>${esc(t("profile.steps." + s))}${state === " is-done" ? `<span class="sr-only">${esc(t("profile.steps.done"))}</span>` : ""}</li>`;
      }).join("");
      if (cur === "consent") drawConsent();
      else if (cur === "contact") drawContact(u);
      else if (cur === "profile") drawProfile(u);
      else body.innerHTML = YL.ui.emptyState("info", t("router.error"), `<a class="btn btn--primary" href="#/profile">${esc(t("nav.me"))}</a>`);
      if (focus) focusHeading(body);
    }

    function drawConsent() {
      const items = [["shield", "collect"], ["user", "visible"], ["lock", "contact"], ["mail", "emails"], ["sparkle", "smart"], ["trash", "leave"]];
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
          ${notice("info", "mail", esc(t("profile.contact.untilVerified")))}
          <div data-cw-host></div>
        </section>`;
      const done = () => { contactStepOpen = null; draw(true); };
      contactWidget(body.querySelector("[data-cw-host]"), ctx, {
        mode: pendingFor(u) ? "code" : "enter",
        email: u.contactEmail || "",
        focus: false,
        onDone: done,
        onLater: done
      });
    }

    function drawProfile(u) {
      if (!YL.auth.questions().length) {
        body.innerHTML = YL.ui.emptyState("info", t("profile.err.noQuestions"), `<button type="button" class="btn btn--primary" data-reload>${esc(t("common.retry"))}</button>`);
        body.querySelector("[data-reload]").addEventListener("click", () => location.reload());
        return;
      }
      body.innerHTML = `
        <section class="card stack" aria-labelledby="setup-profile-title">
          <div class="stack stack--s">
            <h2 class="section-title" id="setup-profile-title" tabindex="-1" data-focus>${esc(t("profile.setup.profileTitle"))}</h2>
            <p class="small muted">${esc(t("profile.setup.profileSub"))}</p>
          </div>
          ${u.contactVerified ? "" : notice("warn", "mail", esc(t("profile.setup.contactUnverified")))}
          ${profileFormHtml(u, t("profile.setup.finish"), "")}
        </section>`;
      bindProfileForm(body.querySelector("[data-profile-form]"), ctx, () => draw(true));
    }

    draw(false);
  }

  /* ---------- #/profile 我的 ---------- */
  const meHead = () => `<header class="page-head"><div class="page-head__text"><h1 class="page-title">${esc(t("profile.me.title"))}</h1><p class="page-sub">${esc(t("profile.me.sub"))}</p></div></header>`;

  function personCard(u) {
    const qs = YL.auth.questions().filter((q) => q.public);
    const a = u.answers || {};
    const meta = [identityLine(u)];
    const tagHtml = [];
    const intros = [];
    qs.forEach((q) => {
      const v = a[q.id];
      if (q.type === "text") { if (v) intros.push(v); return; }
      if (q.type === "single") { if (v) meta.push(optionLabel(q, v)); return; }
      (Array.isArray(v) ? v : []).forEach((x) => tagHtml.push(YL.ui.tag(optionLabel(q, x), q.type === "multi" ? "tag--goal" : "")));
    });
    return `
      <article class="person" aria-labelledby="me-name">
        <div class="person__head">
          ${avatar(u.name || YL.auth.displayName(), "lg")}
          <div class="person__who">
            <p class="person__name" id="me-name">${esc(u.name || YL.auth.displayName())}</p>
            <p class="person__meta">${meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join("")}</p>
          </div>
        </div>
        ${tagHtml.length ? `<div class="tags">${tagHtml.join("")}</div>` : ""}
        ${intros.length ? intros.map((x) => `<p class="person__intro">${esc(x)}</p>`).join("") : `<p class="person__intro faint">${esc(t("profile.me.noIntro"))}</p>`}
        <div class="person__foot">
          <div class="stack stack--s">
            <span class="xsmall faint">${esc(t("profile.me.contactMethodLabel"))}</span>
            <span class="person__overlap">${icon("lock")}<span>${esc(u.contactMethod || "")}</span></span>
          </div>
          <div class="person__actions"><a class="btn btn--secondary" href="#/profile/edit">${icon("edit")}${esc(t("profile.me.edit"))}</a></div>
        </div>
      </article>`;
  }

  const switchHtml = (attrs, title, sub, checked, disabled) =>
    `<label class="switch"><span class="switch__text"><span>${esc(title)}</span><small>${esc(sub)}</small></span><input type="checkbox" role="switch" ${attrs}${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span class="switch__track"></span></label>`;
  const linkRow = (href, ic, title, sub) =>
    `<a class="list__item list__link" href="${href}">${icon(ic)}<span class="list__main"><span class="list__title">${esc(title)}</span><span class="list__sub">${esc(sub)}</span></span>${icon("chevronRight")}</a>`;

  async function renderMe(root, ctx) {
    const u = await loadMe(root, ctx, meHead());
    if (u) drawMe(root, ctx, "");
  }

  function drawMe(root, ctx, focusSel) {
    clearInterval(timer);
    const u = YL.auth.user();
    const meta = YL.auth.meta();
    const prefs = u.prefs || {};
    const pill = u.contactVerified
      ? `<span class="pill pill--matched">${icon("check")}${esc(t("profile.account.verified"))}</span>`
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

            <section class="card stack" aria-labelledby="me-account">
              <h2 class="card__title" id="me-account" tabindex="-1">${esc(t("profile.account.title"))}</h2>
              <ul class="list">
                <li class="list__item">
                  <span class="muted">${icon("cap")}</span>
                  <div class="list__main">
                    <span class="list__sub">${esc(t("profile.account.loginEmail"))}</span>
                    <span class="list__title">${emailHtml(u.loginEmail)}</span>
                    <span class="xsmall faint">${esc(t("profile.account.loginEmailHint"))}</span>
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
            <nav class="card card--tight" aria-label="${esc(t("profile.links.title"))}">
              <div class="list">
                ${YL.auth.isAdmin() ? linkRow("#/admin", "chart", t("profile.links.admin"), t("profile.links.adminSub")) : ""}
                ${linkRow("#/about/privacy", "shield", t("profile.links.privacy"), t("profile.links.privacySub"))}
                ${linkRow("#/about/feedback", "message", t("profile.links.feedback"), t("profile.links.feedbackSub"))}
              </div>
            </nav>
            <button type="button" class="btn btn--secondary btn--block" data-act="logout">${icon("logout")}${esc(t("profile.logout"))}</button>
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
          ${u.contactVerified ? "" : notice("warn", "info", esc(t("profile.account.unverifiedBody")))}
          <div class="cluster cluster--between">
            ${u.contactVerified ? "" : `<button type="button" class="btn btn--primary" data-act="verify-contact">${icon("mail")}${esc(t("profile.account.verifyNow"))}</button>`}
            <button type="button" class="link-btn" data-act="change-contact">${esc(t("profile.account.change"))}</button>
          </div>
        </div>`;
    }
    function openPanel(mode, email, autoSend) {
      contactWidget(panel, ctx, {
        mode, email, autoSend, focus: true,
        onDone: () => drawMe(root, ctx, "#me-account"),
        onCancel: () => { closedPanel(); const b = panel.querySelector("[data-act]"); if (b) b.focus(); }
      });
    }
    if (pendingFor(u)) openPanel("code", u.contactEmail, false); else closedPanel();

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
      else if (act === "change-contact") openPanel("enter", "", false);
      else if (act === "logout") {
        YL.ui.busy(b, true);
        await YL.auth.logout();
        pending = null;
        YL.ui.toast(t("profile.loggedOut"));
        YL.router.navigate("home");
      } else if (act === "delete") openDelete(ctx);
    });

    if (focusSel) { const f = el.querySelector(focusSel); if (f) f.focus(); }
  }

  function openDelete(ctx) {
    YL.ui.modal(`
      <h2 class="modal__title">${esc(t("profile.delete.confirmTitle"))}</h2>
      <form class="form" data-del novalidate>
        <p class="muted">${esc(t("profile.delete.body"))}</p>
        <div class="field" data-field="confirm">
          <label class="field__label" for="del-confirm">${fill(t("profile.delete.typeLabel"), { word: "<strong>DELETE</strong>" })}</label>
          <input class="input" id="del-confirm" name="confirm" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="DELETE">
        </div>
        <div data-msg hidden></div>
        <div class="confirm__actions">
          <button type="button" class="btn btn--secondary" data-close>${esc(t("common.cancel"))}</button>
          <button type="submit" class="btn btn--danger" disabled>${icon("trash")}${esc(t("profile.delete.submit"))}</button>
        </div>
      </form>`, {
      label: t("profile.delete.confirmTitle"),
      onMount(panel, close) {
        const form = panel.querySelector("[data-del]");
        const input = form.querySelector("#del-confirm");
        const submit = form.querySelector('button[type="submit"]');
        panel.querySelector("[data-close]").addEventListener("click", close);
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
            YL.ui.closeModal();
            YL.auth.set(null);
            YL.ui.toast(t("profile.delete.done"));
            YL.router.navigate("home");
            return;
          }
          if (!ctx.isActive() || !document.body.contains(form)) return;
          YL.ui.busy(submit, false);
          if (r.error && r.error.fields) YL.ui.showFieldErrors(form, r.error.fields, "profile");
          else setMsg(form, YL.ui.errorText(r.error, "profile"));
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
    root.innerHTML = `<section class="page page--medium" data-edit>${head}<div class="card">${profileFormHtml(u, t("common.save"), "#/profile")}</div></section>`;
    bindProfileForm(root.querySelector("[data-profile-form]"), ctx, () => {
      YL.ui.toast(t("common.saved"), "success");
      YL.router.navigate("profile");
    });
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
