/* Coffee Chat 内测活动：报名 → 选出空闲时段 → 浏览参与者、约 TA 的一个时段 → 对方确认 → 互相看到联系方式
   这是"三层拆分"的参考实现（docs/engineering.md）：
     web/js/domain/coffee.js   业务规则：时间表、预约状态机、时段规则、资料校验 —— 纯函数，有单测
     web/js/api/coffee.js      接口：原型版后端，12 条 route = 后端契约
     web/js/modules/coffee.js  界面（本文件）：只渲染与交互，数据全部来自 YL.api；
                               能点哪些按钮由接口返回的 actions / 时段 state 决定，界面不自己判断权限 */
(function () {
  const R = YL.domain.coffee;
  const { t, esc, L } = YL.ui;
  const STATUS_BADGE = { pending: "badge--warn", accepted: "badge--green", declined: "badge--muted", expired: "badge--muted" };
  const SLOT_STATES = ["free", "yours", "busy", "taken", "closed"];
  const FIELD_MAX = { name: R.LIMITS.name, program: R.LIMITS.program, job: R.LIMITS.job, location: R.LIMITS.location, interests: R.LIMITS.interests, meetPlace: R.LIMITS.place, contact: R.LIMITS.contact, note: R.LIMITS.note, text: R.LIMITS.feedbackMax };

  /* ---------- 小工具 ---------- */
  const loading = () => `<div class="empty"><p>${t("common.loading")}</p></div>`;
  const failed = (error) => YL.ui.emptyState("⚠️", YL.ui.errorText(error, "coffee"));
  // "2026-11-03" → "11月3日周二" / "Tue, Nov 3"（按日期本身算星期，不受浏览器时区影响）
  const dayLabel = (date) => new Date(date + "T12:00:00Z").toLocaleDateString(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
  function tzName(ev, slot) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: ev.timezone, timeZoneName: "short" }).formatToParts(new Date(R.slotStart(ev, slot)));
      return (parts.find((p) => p.type === "timeZoneName") || {}).value || "";
    } catch (e) { return ""; }
  }
  const slotLabel = (ev, slot) => `${dayLabel(slot.slice(0, 10))} ${slot.slice(11)} ${tzName(ev, slot)}`.trim();
  // 不在活动时区的人（比如在国内的校友）顺便看到本地时间
  function localHint(ev, slot) {
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!here || here === ev.timezone) return "";
    const local = new Date(R.slotStart(ev, slot)).toLocaleString(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
    return t("coffee.localTime", { time: local });
  }
  // 在校生：学段 · 项目 · 毕业年份；校友：工作 · 所在地（纯文本，插入 HTML 时再 esc）
  const background = (x) => (x.identity === "student"
    ? [x.stage ? t("coffee.stage." + x.stage) : "", x.program, x.gradYear ? t("coffee.classOf", { y: x.gradYear }) : ""]
    : [x.job, x.location]).filter(Boolean).join(" · ");
  // 接口返回的字段错误显示在表单对应位置；其他错误用 toast
  function showError(box, error) {
    const fields = (error && error.fields) || {};
    let shown = 0;
    YL.ui.$$("[data-err]", box).forEach((el) => {
      const code = fields[el.dataset.err];
      el.textContent = code ? t("coffee.fieldErr." + code, { max: FIELD_MAX[el.dataset.err] || "", min: R.LIMITS.feedbackMin }) : "";
      if (code) shown++;
    });
    if (!shown) YL.ui.toast(YL.ui.errorText(error, "coffee"), "error");
  }
  async function submitting(btn, work) {
    btn.disabled = true;
    try { return await work(); } finally { btn.disabled = false; }
  }

  /* ---------- 页头与标签：报名前只有"活动介绍 / 报名 / 意见箱" ---------- */
  function head(me, active) {
    const ev = me.event, dates = R.eventDates(ev), items = [];
    if (me.profile) {
      items.push({ id: "people", icon: "🫂", labelKey: "coffee.tab.people" });
      items.push({ id: "bookings", icon: "📅", labelKey: "coffee.tab.bookings", badge: me.unread || "" });
      items.push({ id: "schedule", icon: "🕒", labelKey: "coffee.tab.schedule" });
      items.push({ id: "join", icon: "📝", labelKey: "coffee.tab.profile" });
    } else {
      items.push({ id: "intro", icon: "☕", labelKey: "coffee.tab.intro" });
      items.push({ id: "join", icon: "📝", labelKey: "coffee.tab.join" });
    }
    items.push({ id: "feedback", icon: "💡", labelKey: "coffee.tab.feedback" });
    if (me.isAdmin) items.push({ id: "admin", icon: "📊", labelKey: "coffee.tab.admin" });
    const sub = t("coffee.subtitle", { from: dayLabel(dates[0]), to: dayLabel(dates[dates.length - 1]), min: ev.slotMinutes });
    return `<div class="page-head"><h1>☕ ${esc(L(ev.name))}</h1><p>${esc(sub)}</p></div>${YL.ui.tabs(items, active, "#/coffee")}`;
  }
  function rulesCard(ev) {
    const vars = { h: ev.cutoffHours, n: ev.maxPending, min: ev.slotMinutes };
    return `<section class="card card--primary"><div class="card__title">⚠️ ${t("coffee.rulesTitle")}</div>
      <ul class="card__body">${[1, 2, 3, 4, 5].map((i) => `<li>${esc(t("coffee.rule." + i, vars))}</li>`).join("")}</ul></section>`;
  }

  /* ---------- 活动介绍（未报名） ---------- */
  function intro(root, ctx, me) {
    root.innerHTML = head(me, "intro") + `<div class="two-col">
      <section class="card"><h2>${t("coffee.introTitle")}</h2>
        <ol class="prose muted">${[1, 2, 3, 4].map((i) => `<li>${t("coffee.step." + i)}</li>`).join("")}</ol>
        <a class="btn btn--primary" href="#/coffee/join">📝 ${t("coffee.joinCta")}</a></section>
      <div class="stack">${rulesCard(me.event)}</div></div>`;
  }

  /* ---------- 报名 / 我的资料 ---------- */
  function join(root, ctx, me) {
    const p = me.profile || {}, sp = (YL.auth.user() || {}).profile || {};
    const year = new Date().getFullYear(), years = [];
    for (let y = year; y <= year + R.LIMITS.gradYearsAhead; y++) years.push(y);
    const field = (name, label, control, hint) => `<div class="field"><label for="cf-${name}">${label}</label>${control}${hint ? `<span class="field__hint">${hint}</span>` : ""}<span class="field__error" data-err="${name}"></span></div>`;
    const input = (name, value, ph, max) => `<input class="input" id="cf-${name}" name="${name}" value="${esc(value || "")}" maxlength="${max}" placeholder="${esc(ph || "")}">`;
    const choice = (type, name, value, on, label) => `<label class="check"><input type="${type}" name="${name}" value="${esc(value)}" ${on ? "checked" : ""}> ${esc(label)}</label>`;
    const group = (name, label, html) => `<div class="field"><label>${label}</label><div class="checks">${html}</div><span class="field__error" data-err="${name}"></span></div>`;
    const identity = p.identity || me.kind || "student";
    root.innerHTML = head(me, "join") + `<form id="f-join" class="card" novalidate>
      ${me.profile ? "" : `<p class="muted">${t("coffee.joinIntro")}</p>`}
      ${field("name", t("coffee.f.name"), input("name", p.name || sp.name || YL.auth.displayName(), "", R.LIMITS.name))}
      <div class="field"><label>${t("coffee.f.email")}</label><div class="muted">${esc(me.email)} · <span class="small">${t("coffee.f.emailHint")}</span></div></div>
      ${group("identity", t("coffee.f.identity"), R.IDENTITIES.map((x) => choice("radio", "identity", x, x === identity, t("coffee.identity." + x))).join(""))}
      <div data-when="student">
        <div class="form-row">
          ${field("stage", t("coffee.f.stage"), `<select class="select" id="cf-stage" name="stage">${R.STAGES.map((s) => `<option value="${s}" ${p.stage === s ? "selected" : ""}>${esc(t("coffee.stage." + s))}</option>`).join("")}</select>`)}
          ${field("gradYear", t("coffee.f.gradYear"), `<select class="select" id="cf-gradYear" name="gradYear">${years.map((y) => `<option value="${y}" ${Number(p.gradYear || sp.classYear) === y ? "selected" : ""}>${y}</option>`).join("")}</select>`)}
        </div>
        ${field("program", t("coffee.f.program"), input("program", p.program, t("coffee.f.programPh"), R.LIMITS.program))}
      </div>
      <div data-when="alumni"><div class="form-row">
        ${field("job", t("coffee.f.job"), input("job", p.job, t("coffee.f.jobPh"), R.LIMITS.job))}
        ${field("location", t("coffee.f.location"), input("location", p.location, t("coffee.f.locationPh"), R.LIMITS.location))}
      </div></div>
      ${field("interests", t("coffee.f.interests"), input("interests", p.interests, t("coffee.f.interestsPh"), R.LIMITS.interests))}
      ${group("goals", t("coffee.f.goals"), R.GOALS.map((g) => choice("checkbox", "goals", g, (p.goals || []).indexOf(g) >= 0, t("coffee.goal." + g))).join(""))}
      ${group("meetMode", t("coffee.f.meet"), R.MEET_MODES.map((m) => choice("radio", "meetMode", m, m === (p.meetMode || "online"), t("coffee.meet." + m))).join(""))}
      ${field("meetPlace", t("coffee.f.place"), input("meetPlace", p.meetPlace, "", R.LIMITS.place), t("coffee.f.placeHint"))}
      ${field("contact", t("coffee.f.contact"), input("contact", p.contact, t("coffee.f.contactPh"), R.LIMITS.contact), t("coffee.f.contactHint"))}
      <div class="field"><div class="callout callout--info">🔒 ${t("coffee.privacy")}</div></div>
      <button class="btn btn--primary btn--block" type="submit">${me.profile ? t("coffee.save") : t("coffee.joinSubmit")}</button>
    </form>`;
    const form = YL.ui.$("#f-join", root);
    const sync = () => {
      const id = (form.querySelector('input[name="identity"]:checked') || {}).value;
      YL.ui.$$("[data-when]", form).forEach((el) => (el.hidden = el.dataset.when !== id));
      const mode = (form.querySelector('input[name="meetMode"]:checked') || {}).value;
      YL.ui.$("#cf-meetPlace", form).placeholder = mode === "online" ? t("coffee.f.placeOnline") : t("coffee.f.placeOffline");
    };
    form.onchange = sync;
    sync();
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = YL.ui.formValues(form);
      v.goals = [].concat(v.goals || []);
      submitting(YL.ui.$("button[type=submit]", form), async () => {
        const r = await YL.api.post("/coffee/profile", v);
        if (!r.ok) return showError(form, r.error);
        YL.ui.toast(r.data.created ? t("coffee.joined") : t("coffee.saved"), "success");
        YL.router.navigate(r.data.created ? "coffee/schedule" : "coffee/join");
      });
    };
  }

  /* ---------- 我的空闲时段：点选 / 拖选（鼠标），手机上逐个点；点日期或时间可整列 / 整行切换 ---------- */
  function schedule(root, ctx, me) {
    const ev = me.event, dates = R.eventDates(ev), times = R.slotTimes(ev);
    const selected = new Set(me.profile.slots), locked = new Set(me.locked);
    const labels = {};
    dates.forEach((d) => (labels[d] = dayLabel(d)));
    const cell = (id) => `<td><button type="button" class="slot${selected.has(id) ? " is-on" : ""}${locked.has(id) ? " is-locked" : ""}" data-slot="${id}" aria-pressed="${selected.has(id)}" aria-label="${esc(labels[id.slice(0, 10)] + " " + id.slice(11))}" ${locked.has(id) ? "disabled" : ""}></button></td>`;
    root.innerHTML = head(me, "schedule") + `
      <p class="muted">${esc(t("coffee.scheduleIntro", { min: ev.slotMinutes, gap: ev.gapMinutes, from: ev.dayStart, to: ev.dayEnd }))}</p>
      <div class="callout callout--info">🕒 ${esc(t("coffee.tzNote", { tz: ev.timezone }))}</div>
      <div class="slot-grid-wrap"><table class="slot-grid" id="slot-grid">
        <thead><tr><th></th>${dates.map((d) => `<th><button type="button" class="slot-grid__head" data-day="${d}">${esc(labels[d])}</button></th>`).join("")}</tr></thead>
        <tbody>${times.map((tm) => `<tr><th><button type="button" class="slot-grid__head" data-time="${tm}">${tm}</button></th>${dates.map((d) => cell(d + "T" + tm)).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <div class="row row--between"><span class="muted small" id="slot-count"></span><button class="btn btn--primary" id="btn-save-slots">${t("coffee.saveSlots")}</button></div>
      <p class="small muted">${t("coffee.scheduleTip")}</p>`;
    const grid = YL.ui.$("#slot-grid", root), counter = YL.ui.$("#slot-count", root);
    const count = () => (counter.textContent = t("coffee.slotsSelected", { n: selected.size }));
    const set = (b, on) => {
      if (b.disabled) return;
      if (on) selected.add(b.dataset.slot); else selected.delete(b.dataset.slot);
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
      count();
    };
    let dragOn = null, skipClick = false;
    grid.addEventListener("pointerdown", (e) => {
      skipClick = false;
      const b = e.target.closest("[data-slot]");
      if (!b || b.disabled || e.pointerType === "touch") return; // 触屏不拖选，避免和滚动冲突
      e.preventDefault();
      dragOn = !selected.has(b.dataset.slot);
      set(b, dragOn);
      skipClick = true;
    });
    grid.addEventListener("pointerover", (e) => { const b = dragOn === null ? null : e.target.closest("[data-slot]"); if (b) set(b, dragOn); });
    grid.addEventListener("pointerup", () => (dragOn = null));
    grid.addEventListener("pointerleave", () => (dragOn = null));
    grid.addEventListener("click", (e) => {
      const skip = skipClick && e.detail !== 0; // 键盘触发的 click（detail = 0）永远生效
      skipClick = false;
      if (skip) return;
      const b = e.target.closest("[data-slot]");
      if (b) return set(b, !selected.has(b.dataset.slot));
      const h = e.target.closest("[data-day],[data-time]");
      if (!h) return;
      const cells = YL.ui.$$(h.dataset.day ? `[data-slot^="${h.dataset.day}T"]` : `[data-slot$="T${h.dataset.time}"]`, grid).filter((x) => !x.disabled);
      const on = cells.some((x) => !selected.has(x.dataset.slot));
      cells.forEach((x) => set(x, on));
    });
    YL.ui.$("#btn-save-slots", root).onclick = (e) => submitting(e.currentTarget, async () => {
      const r = await YL.api.post("/coffee/availability", { slots: Array.from(selected) });
      if (!r.ok) return YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error");
      YL.ui.toast(t("coffee.slotsSaved", { n: r.data.slots.length }), "success");
      YL.router.render();
    });
    count();
  }

  /* ---------- 参与者总览：只按身份、诉求筛选 ---------- */
  function personCard(x) {
    return `<a class="card card--hover" href="#/coffee/p/${encodeURIComponent(x.id)}" data-person="${esc(x.id)}">
      <div class="person">${YL.ui.avatar(x.name, "lg")}<div class="grow">
        <div class="person__name">${esc(L(x.name))} <span class="badge">${esc(t("coffee.identity." + x.identity))}</span></div>
        <div class="person__sub">${esc(background(x))}</div>
      </div></div>
      ${x.interests ? `<div class="card__body">🎯 ${esc(x.interests)}</div>` : ""}
      <div class="card__meta">${(x.goals || []).map((g) => YL.ui.tag(t("coffee.goal." + g), "tag--green")).join("")}</div>
      <div class="card__foot"><span class="small muted">${x.meetMode === "offline" ? "📍 " + esc(x.meetPlace) : "💻 " + t("coffee.meet.online")}</span>
        <span class="badge ${x.freeSlots ? "badge--green" : "badge--muted"}">${esc(t("coffee.freeSlots", { n: x.freeSlots }))}</span></div>
    </a>`;
  }
  async function people(root, ctx, me) {
    const all = { id: "all", label: t("coffee.all") };
    const identities = [all].concat(R.IDENTITIES.map((x) => ({ id: x, label: t("coffee.identity." + x) })));
    const goals = [all].concat(R.GOALS.map((g) => ({ id: g, label: t("coffee.goal." + g) })));
    let identity = ctx.query.identity || "all", goal = ctx.query.goal || "all", seq = 0;
    root.innerHTML = head(me, "people") + loading();
    const load = async () => {
      const mine = ++seq;
      const r = await YL.api.get("/coffee/people", { identity: identity === "all" ? "" : identity, goal: goal === "all" ? "" : goal });
      if (!ctx.isActive() || mine !== seq) return;
      if (!r.ok) { root.innerHTML = head(me, "people") + failed(r.error); return; }
      root.innerHTML = head(me, "people")
        + YL.ui.chips(identities, identity, "identity", "chips--scroll")
        + YL.ui.chips(goals, goal, "goal", "chips--scroll")
        + `<p class="small muted">${esc(t("coffee.peopleCount", { n: r.data.length }))}</p>`
        + (r.data.length ? `<div class="grid grid-2">${r.data.map(personCard).join("")}</div>` : YL.ui.emptyState("🫂", t("common.noResults")))
        + `<p class="notice">${t("coffee.seedNote")}</p>`;
      YL.ui.$$("[data-identity]", root).forEach((b) => (b.onclick = () => { identity = b.dataset.identity; load(); }));
      YL.ui.$$("[data-goal]", root).forEach((b) => (b.onclick = () => { goal = b.dataset.goal; load(); }));
    };
    await load();
  }

  /* ---------- 某个人：资料 + 按天列出 TA 的时段，点空闲时段预约 ---------- */
  function openBooking(ev, x, slot, onDone) {
    const hint = localHint(ev, slot);
    YL.ui.modal(`<h2>☕ ${t("coffee.bookTitle", { name: esc(L(x.name)) })}</h2>
      <dl class="kv"><dt>🗓</dt><dd><strong>${esc(slotLabel(ev, slot))}</strong>${hint ? `<div class="small muted">${esc(hint)}</div>` : ""}</dd>
        <dt>📍</dt><dd>${esc(x.meetMode === "offline" ? x.meetPlace : t("coffee.onlineAfterAccept"))}</dd></dl>
      <div class="divider"></div>
      <form id="f-book" novalidate>
        <div class="field"><label for="cf-note">${t("coffee.f.note")}</label><textarea class="textarea" id="cf-note" name="note" maxlength="${R.LIMITS.note}" placeholder="${esc(t("coffee.f.notePh"))}"></textarea><span class="field__error" data-err="note"></span></div>
        <div class="field"><div class="callout">⚠️ ${t("coffee.disclaimer")}</div>
          <label class="check check--block"><input type="checkbox" name="agree" value="yes"> ${t("coffee.agree")}</label>
          <span class="field__error" data-err="agree"></span></div>
        <button class="btn btn--primary btn--block" type="submit">${t("coffee.bookSubmit")}</button>
      </form>`, { onMount(panel) {
      const form = YL.ui.$("#f-book", panel);
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = YL.ui.formValues(form);
        submitting(YL.ui.$("button[type=submit]", form), async () => {
          const r = await YL.api.post("/coffee/bookings", { hostId: x.id, slot, note: v.note, agree: v.agree === "yes" });
          if (!r.ok) return showError(panel, r.error);
          YL.ui.closeModal();
          YL.ui.toast(t("coffee.booked", { name: L(x.name) }), "success");
          onDone();
        });
      };
    } });
  }
  async function person(root, ctx, me) {
    const ev = me.event, back = `<a class="muted small" href="#/coffee/people">← ${t("common.back")}</a>`;
    root.innerHTML = head(me, "people") + loading();
    const r = await YL.api.get("/coffee/people/" + encodeURIComponent(ctx.id));
    if (!ctx.isActive()) return;
    if (!r.ok) {
      root.innerHTML = head(me, "people") + (r.error.code === "not_found" ? YL.ui.emptyState("☕", t("coffee.notParticipant"), `<a class="btn btn--primary" href="#/coffee/people">${t("coffee.tab.people")}</a>`) : failed(r.error));
      return;
    }
    const x = r.data.person, days = {};
    r.data.slots.forEach((s) => (days[s.slot.slice(0, 10)] = days[s.slot.slice(0, 10)] || []).push(s));
    const chip = (s) => {
      const st = SLOT_STATES.indexOf(s.state) >= 0 ? s.state : "closed";
      return `<button type="button" class="slot-chip slot-chip--${st}" data-book="${esc(s.slot)}" ${st === "free" ? "" : "disabled"}>${esc(s.slot.slice(11))}${st === "free" ? "" : " · " + esc(t("coffee.slot." + st))}</button>`;
    };
    root.innerHTML = head(me, "people") + `<div class="stack">${back}<div class="two-col"><div class="stack">
      <section class="card"><div class="person">${YL.ui.avatar(x.name, "xl")}<div class="grow">
        <h2>${esc(L(x.name))} <span class="badge">${esc(t("coffee.identity." + x.identity))}</span></h2>
        <div class="muted">${esc(background(x))}</div>
        ${x.interests ? `<p class="card__body">🎯 ${esc(x.interests)}</p>` : ""}
        <div>${(x.goals || []).map((g) => YL.ui.tag(t("coffee.goal." + g), "tag--green")).join("")}</div>
        <div class="small muted">${x.meetMode === "offline" ? "📍 " + esc(x.meetPlace) : "💻 " + t("coffee.onlineAfterAccept")} · ${t("coffee.hostPlaceRule")}</div>
      </div></div></section>
      <section class="card"><h2>${t("coffee.pickTitle")}</h2><p class="small muted">${esc(t("coffee.tzNote", { tz: ev.timezone }))}</p>
        ${Object.keys(days).sort().map((d) => `<div class="slot-day"><div class="slot-day__label">${esc(dayLabel(d))}</div><div class="row">${days[d].map(chip).join("")}</div></div>`).join("") || `<p class="muted">${t("coffee.noSlots")}</p>`}
      </section>
    </div><div class="stack">${rulesCard(ev)}</div></div></div>`;
    YL.ui.$$("[data-book]:not([disabled])", root).forEach((b) => (b.onclick = () => openBooking(ev, x, b.dataset.book, () => YL.router.render())));
  }

  /* ---------- 我的预约 + 通知 ---------- */
  function bookingCard(ev, b) {
    const st = STATUS_BADGE[b.status] ? b.status : "expired";
    const acts = (b.actions || []).filter((a) => R.ACTIONS.indexOf(a) >= 0);
    const who = b.role === "host" ? t("coffee.fromLabel", { name: L(b.other.name) }) : t("coffee.withLabel", { name: L(b.other.name) });
    const hint = localHint(ev, b.slot);
    const place = b.meetMode === "offline" ? `<span>📍 ${esc(b.meetPlace)}</span>`
      : b.meetPlace ? `<a href="${YL.ui.safeUrl(b.meetPlace)}" target="_blank" rel="noopener">💻 ${t("coffee.joinCall")}</a>`
      : `<span>💻 ${t("coffee.onlineAfterAccept")}</span>`;
    return `<article class="card" data-booking="${esc(b.id)}">
      <div class="row row--between"><strong>🗓 ${esc(slotLabel(ev, b.slot))}</strong><span class="badge ${STATUS_BADGE[st]}">${esc(t("coffee.status." + st))}</span></div>
      ${hint ? `<div class="small muted">${esc(hint)}</div>` : ""}
      <div class="person">${YL.ui.avatar(b.other.name, "sm")}<div class="grow"><div class="person__name">${esc(who)}</div><div class="person__sub">${esc(background(b.other))}</div></div></div>
      ${b.note ? `<p class="card__body">💬 ${esc(b.note)}</p>` : ""}
      <div class="card__meta">${place}</div>
      ${b.contact ? `<div class="callout callout--green">🔓 ${t("coffee.revealTitle")}<br>📧 ${esc(b.contact.email || "")}${b.contact.contact ? " · " + esc(b.contact.contact) : ""}</div>` : ""}
      ${st === "pending" && b.role === "requester" ? `<p class="small muted">⏳ ${t("coffee.waitingHint")}</p>` : ""}
      ${st === "expired" ? `<p class="small muted">${t("coffee.expiredHint")}</p>` : ""}
      ${acts.length ? `<div class="card__foot"><span class="small muted">${t("coffee.answerHint")}</span><div class="row">${acts.map((a) => `<button class="btn btn--sm ${a === "accept" ? "btn--primary" : "btn--ghost"}" data-act="${a}" data-id="${esc(b.id)}">${esc(t("coffee.action." + a))}</button>`).join("")}</div></div>` : ""}
    </article>`;
  }
  function noticeRow(ev, n) {
    const vars = { name: L(n.actor), time: slotLabel(ev, n.slot) };
    const text = n.kind === "booking_new" ? t("coffee.notice.new", vars) : n.kind === "booking_accepted" ? t("coffee.notice.accepted", vars) : t("coffee.notice.declined", vars);
    return `<div class="small${n.read ? " muted" : ""}">${n.read ? "" : "🔵 "}${esc(text)}<div class="muted">${esc(YL.ui.formatDate(n.createdAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</div></div>`;
  }
  function openAnswer(ev, b, action) {
    const vars = { name: esc(L(b.other.name)), time: esc(slotLabel(ev, b.slot)) };
    YL.ui.modal(`<h2>${esc(t("coffee.action." + action))}</h2>
      <p class="muted">${action === "accept" ? t("coffee.confirmAccept", vars) : t("coffee.confirmDecline", vars)}</p>
      <button class="btn btn--primary btn--block" id="btn-answer">${esc(t("coffee.action." + action))}</button>`, { onMount(panel) {
      const btn = YL.ui.$("#btn-answer", panel);
      btn.onclick = () => submitting(btn, async () => {
        const r = await YL.api.post(`/coffee/bookings/${encodeURIComponent(b.id)}/${action}`);
        if (!r.ok) return YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error");
        YL.ui.closeModal();
        YL.ui.toast(action === "accept" ? t("coffee.acceptedToast") : t("coffee.declinedToast"), "success");
        YL.router.render();
      });
    } });
  }
  async function bookings(root, ctx, me) {
    const ev = me.event;
    root.innerHTML = head(me, "bookings") + loading();
    const r = await YL.api.get("/coffee/bookings");
    if (!ctx.isActive()) return;
    if (!r.ok) { root.innerHTML = head(me, "bookings") + failed(r.error); return; }
    const items = r.data.items, notices = r.data.notices;
    const todo = items.filter((b) => (b.actions || []).length), rest = items.filter((b) => !(b.actions || []).length);
    const unread = notices.filter((n) => !n.read).length;
    root.innerHTML = head(me, "bookings") + `<div class="two-col"><div class="stack">
        ${todo.length ? `<section>${YL.ui.sectionTitle(t("coffee.todoTitle", { n: todo.length }), "", t("coffee.todoSub"))}<div class="stack">${todo.map((b) => bookingCard(ev, b)).join("")}</div></section>` : ""}
        <section>${YL.ui.sectionTitle(t("coffee.allTitle"))}${rest.length ? `<div class="stack">${rest.map((b) => bookingCard(ev, b)).join("")}</div>`
          : YL.ui.emptyState("📅", t("coffee.noBookings"), `<a class="btn btn--primary" href="#/coffee/people">${t("coffee.tab.people")}</a>`)}</section>
      </div><div class="stack">
        <section class="card" id="notices"><div class="row row--between"><div class="card__title">🔔 ${t("coffee.noticesTitle")}</div>${unread ? `<button class="btn btn--ghost btn--sm" id="btn-read">${t("coffee.markRead")}</button>` : ""}</div>
          ${notices.length ? `<div class="stack">${notices.map((n) => noticeRow(ev, n)).join("")}</div>` : `<p class="muted small">${t("coffee.noNotices")}</p>`}
          <p class="small muted">📧 ${esc(t("coffee.emailNote", { email: me.email }))}</p></section>
        <section class="card card--flat"><div class="card__title">🧪 ${t("coffee.demoTitle")}</div><p class="small muted">${t("coffee.demoBody")}</p>
          <button class="btn btn--ghost btn--sm" id="btn-demo">${t("coffee.demoIncoming")}</button></section>
      </div></div>`;
    YL.ui.$$("[data-act]", root).forEach((b) => (b.onclick = () => openAnswer(ev, items.find((x) => x.id === b.dataset.id), b.dataset.act)));
    const readBtn = YL.ui.$("#btn-read", root);
    if (readBtn) readBtn.onclick = () => submitting(readBtn, async () => { await YL.api.post("/coffee/notices/read"); YL.router.render(); });
    const demoBtn = YL.ui.$("#btn-demo", root);
    demoBtn.onclick = () => submitting(demoBtn, async () => {
      const d = await YL.api.post("/coffee/_demo/incoming");
      if (!d.ok) return YL.ui.toast(YL.ui.errorText(d.error, "coffee"), "error");
      YL.ui.toast(t("coffee.demoDone"), "success");
      YL.router.render();
    });
  }

  /* ---------- 意见箱（登录即可，不必报名） ---------- */
  function feedback(root, ctx, me) {
    root.innerHTML = head(me, "feedback") + `<form id="f-fb" class="card" novalidate>
      <p class="muted">${t("coffee.feedbackIntro")}</p>
      <div class="field"><label>${t("coffee.f.kind")}</label><div class="checks">${R.FEEDBACK_KINDS.map((k, i) => `<label class="check"><input type="radio" name="kind" value="${k}" ${i === 0 ? "checked" : ""}> ${esc(t("coffee.fb." + k))}</label>`).join("")}</div><span class="field__error" data-err="kind"></span></div>
      <div class="field"><label for="cf-text">${t("coffee.f.text")}</label><textarea class="textarea" id="cf-text" name="text" maxlength="${R.LIMITS.feedbackMax}" placeholder="${esc(t("coffee.f.textPh"))}"></textarea><span class="field__error" data-err="text"></span></div>
      <button class="btn btn--primary btn--block" type="submit">${t("coffee.feedbackSubmit")}</button>
    </form>`;
    const form = YL.ui.$("#f-fb", root);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = YL.ui.formValues(form);
      submitting(YL.ui.$("button[type=submit]", form), async () => {
        const r = await YL.api.post("/coffee/feedback", v);
        if (!r.ok) return showError(form, r.error);
        form.reset();
        YL.ui.$$("[data-err]", form).forEach((el) => (el.textContent = ""));
        YL.ui.toast(t("coffee.feedbackThanks"), "success");
      });
    };
  }

  /* ---------- 管理员：统计与意见箱（只看汇总，不浏览私人联系方式） ---------- */
  async function admin(root, ctx, me) {
    root.innerHTML = head(me, "admin") + loading();
    const r = await YL.api.get("/coffee/admin");
    if (!ctx.isActive()) return;
    if (!r.ok) { root.innerHTML = head(me, "admin") + failed(r.error); return; }
    const s = r.data.stats, num = YL.ui.num, stat = YL.ui.stat;
    root.innerHTML = head(me, "admin") + `<p class="muted small">${t("coffee.adminIntro")}</p>
      <div class="stats section" id="admin-stats">
        ${stat(num(s.participants), t("coffee.st.participants"))}${stat(num(s.students) + " / " + num(s.alumni), t("coffee.st.split"))}
        ${stat(num(s.slotsOffered), t("coffee.st.slots"))}${stat(num(s.bookings.total), t("coffee.st.bookings"))}
        ${stat(num(s.bookings.accepted), t("coffee.st.accepted"))}${stat(s.acceptRate == null ? "—" : s.acceptRate + "%", t("coffee.st.rate"))}
      </div>
      <div class="two-col">
        <section class="card"><div class="card__title">${t("coffee.st.byStatus")}</div>
          <dl class="kv">${R.STATUSES.map((k) => `<dt>${esc(t("coffee.status." + k))}</dt><dd>${num(s.bookings[k])}</dd>`).join("")}</dl>
          <div class="divider"></div><div class="card__title">${t("coffee.st.goals")}</div>
          <dl class="kv">${R.GOALS.map((g) => `<dt>${esc(t("coffee.goal." + g))}</dt><dd>${num(s.goals[g])}</dd>`).join("")}</dl>
          <p class="small muted">${esc(t("coffee.st.withSlots", { n: s.withSlots }))}</p></section>
        <section class="card"><div class="card__title">💡 ${t("coffee.tab.feedback")} · ${num(s.feedback)}</div>
          <div class="stack">${r.data.feedback.map((f) => `<div class="small"><div class="row">${YL.ui.tag(t("coffee.fb." + f.kind), f.kind === "bug" ? "tag--accent" : "")}<span class="muted">${esc(L(f.from))} · ${esc(YL.ui.formatDate(f.createdAt))}</span></div>${esc(f.text)}</div>`).join("") || `<p class="muted small">—</p>`}</div></section>
      </div>
      <p class="notice">${t("coffee.adminPrivacy")}</p>`;
  }

  const VIEWS = { intro, join, schedule, people, p: person, bookings, feedback, admin };
  registerModule({
    id: "coffee",
    nav: { icon: "☕", labelKey: "nav.coffee", order: 15, mobile: true },
    requiresAuth: true,
    descriptionKey: "about.module.coffee",
    async render(root, ctx) {
      root.innerHTML = loading();
      const r = await YL.api.get("/coffee/me");
      if (!ctx.isActive()) return;
      if (!r.ok) { root.innerHTML = failed(r.error); return; }
      const me = r.data;
      let sub = ctx.sub || (me.profile ? "people" : "intro");
      // 报名之后才能浏览与预约（接口同样会拒绝未报名的请求）
      if (!me.profile && ["people", "p", "bookings", "schedule"].indexOf(sub) >= 0) sub = "intro";
      if (sub === "admin" && !me.isAdmin) sub = me.profile ? "people" : "intro";
      if (sub === "intro" && me.profile) sub = "people";
      if (!VIEWS[sub]) { YL.router.navigate("coffee"); return; }
      return VIEWS[sub](root, ctx, me);
    }
  });
})();
