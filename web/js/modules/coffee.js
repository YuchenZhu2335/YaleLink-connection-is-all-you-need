/* 约咖啡（Coffee Chat）界面
   Coffee chat UI — the heart of Yalelux.

   路由 / routes
     #/coffee                                   本轮横幅 + 我的进度 + 为你推荐
     #/coffee/browse?identity&goal&interest&field   找人（按标签筛选池子）
     #/coffee/p/:id                             个人详情（公开答案 + 共同空闲时间）
     #/coffee/times                             选空闲时间（纽约时间，旁边显示北京时间）
     #/coffee/inbox                             收件箱：想认识你的人 / 我发出的
     #/coffee/matches                           匹配：联系方式、一键约时间、见到了吗

   数据只走 YL.api（契约见 docs/api.md）；时间表与截止判断用 YL.domain.coffee（只做显示）。
   界面不自己判断权限：按钮由接口返回的 relation / canSchedule / canReport 决定。 */
(function () {
  "use strict";
  const { t, L, esc, icon, avatar } = YL.ui;
  const D = YL.domain.coffee;
  const isReady = () => YL.auth.isReady();

  // 本次会话内记住的小状态（不持久化）
  let backPath = "coffee/browse"; // 详情页"返回"回到哪个列表
  let filtersOpen = null;          // 找人页筛选区是否展开（null = 按屏幕宽度决定）
  let pendingFocus = null;         // 改筛选会重新渲染页面，渲染完把焦点还给刚点的那个标签
  let maxOpen = D.DEFAULT_ROUND.maxOpenInvites; // 本轮最多几个等待回复的邀请（拿到 /coffee/state 后更新）

  /* ---------- 显示用的格式化 ---------- */
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const locale = () => (YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US");
  const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
  const dateOf = (slot) => String(slot).slice(0, 10);
  const timeOf = (slot) => String(slot).slice(11, 16);
  const md = (date) => { const p = String(date).split("-"); return Number(p[1]) + "/" + Number(p[2]); };
  function weekday(date) {
    try { return new Intl.DateTimeFormat(locale(), { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")); } catch (e) { return ""; }
  }
  const rangeText = (r) => md(r.startDate) + "–" + md(r.endDate);
  const dayLabel = (date) => t("coffee.day", { wd: weekday(date), md: md(date) });
  const whenText = (slot) => t("coffee.when", { wd: weekday(dateOf(slot)), md: md(dateOf(slot)), time: timeOf(slot) });
  const tzName = (tz) => (tz === "America/New_York" ? t("coffee.tz.ny") : tz);
  let bjFormat = null;
  // 时段（活动时区的墙上时间）→ 北京时间的日期与钟点
  function beijing(tz, slot) {
    bjFormat = bjFormat || new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const p = {};
    bjFormat.formatToParts(new Date(D.slotStart({ timezone: tz }, slot))).forEach((x) => (p[x.type] = x.value));
    return { date: p.year + "-" + p.month + "-" + p.day, time: pad(Number(p.hour) % 24) + ":" + p.minute };
  }
  // 格子下面的小字：同一天只写钟点，第二天写"次日"，其他情况写日期
  function bjShort(tz, slot) {
    const b = beijing(tz, slot), d = dateOf(slot);
    if (b.date === d) return t("coffee.bj", { time: b.time });
    if (b.date === D.addDays(d, 1)) return t("coffee.bjNext", { time: b.time });
    return t("coffee.bjDate", { md: md(b.date), time: b.time });
  }
  const bjFull = (tz, slot) => { const b = beijing(tz, slot); return t("coffee.bjDate", { md: md(b.date), time: b.time }); };
  const nowIso = () => new Date().toISOString();
  // 还没过截止的已选时间（已约定的始终算）
  const openPicks = (round, slots, locked) => list(slots).filter((s) => list(locked).indexOf(s) >= 0 || !D.isClosed(round, s, nowIso()));

  /* ---------- 问卷标签 ---------- */
  const question = (id) => YL.auth.questions().find((q) => q.id === id);
  function optLabel(qid, value) {
    const q = question(qid), o = q && (q.options || []).find((x) => x.id === value);
    return o ? L(o.label) : String(value); // 自己加的兴趣标签原样显示
  }
  // "兴趣爱好（选 1–5 个，也可以自己加）" → "兴趣爱好"
  const shortLabel = (q) => L(q.label).replace(/\s*[（(][^（()）]*[)）]\s*$/, "");
  const myInterests = () => { const me = YL.auth.user(); return list(me && me.answers && me.answers.interests); };

  /* ---------- 人物卡 ---------- */
  function whoLine(p) {
    if (p.identity === "student") {
      const parts = [];
      if (D.STAGES.indexOf(p.stage) >= 0) parts.push(t("coffee.stage." + p.stage));
      if (p.gradYear) parts.push(t("coffee.person.class", { year: p.gradYear }));
      return parts.join(" · ") || t("coffee.identity.student");
    }
    return [p.job, p.city].filter(Boolean).join(" · ") || t("coffee.identity.alumni");
  }
  function metaHtml(p) {
    const field = list(p.answers && p.answers.field)[0];
    return `<p class="person__meta"><span>${esc(whoLine(p))}</span>${field ? `<span>${esc(optLabel("field", field))}</span>` : ""}</p>`;
  }
  const sharedTag = (label) => `<span class="tag tag--shared">${icon("heart", { size: 12 })}${esc(label)}<span class="sr-only">${esc(t("coffee.person.sharedSr"))}</span></span>`;
  function interestTags(values) {
    const mine = myInterests(), isShared = (x) => (mine.indexOf(x) >= 0 ? 1 : 0);
    return list(values).slice().sort((x, y) => isShared(y) - isShared(x))
      .map((x) => (isShared(x) ? sharedTag(optLabel("interests", x)) : `<span class="tag">${esc(optLabel("interests", x))}</span>`));
  }
  function tagsHtml(p) {
    const a = p.answers || {};
    const all = list(a.goals).map((g) => `<span class="tag tag--goal">${esc(optLabel("goals", g))}</span>`).concat(interestTags(a.interests));
    return all.length ? `<div class="tags">${all.join("")}</div>` : "";
  }
  function overlapHtml(n) {
    return n > 0
      ? `<span class="person__overlap">${icon("clock")}${esc(n === 1 ? t("coffee.person.overlapOne") : t("coffee.person.overlap", { n }))}</span>`
      : `<span class="person__overlap person__overlap--none">${icon("clock")}${esc(t("coffee.person.noOverlap"))}</span>`;
  }
  // relation.state → 右下角的按钮或状态（见 docs/design/components.md）
  function relationHtml(p) {
    const r = p.relation || { state: "none" }, id = esc(p.id);
    if (r.state === "invited") return `<span class="pill pill--waiting">${icon("check")}${esc(t("coffee.rel.invited"))}</span>`;
    if (r.state === "incoming") return `<button type="button" class="btn btn--accent btn--sm" data-act="accept" data-id="${id}">${icon("heart")}${esc(t("coffee.rel.incoming"))}</button>`;
    if (r.state === "matched") return `<a class="pill pill--matched" href="#/coffee/matches">${icon("sparkle")}${esc(t("coffee.rel.matched"))}</a>`;
    if (r.state === "no_reply") return `<span class="pill">${esc(t("coffee.rel.noReply"))}</span>`;
    return `<button type="button" class="btn btn--accent btn--sm" data-act="invite" data-id="${id}">${esc(t("coffee.rel.invite"))}</button>`;
  }
  /* o = { rec, reasons, overlap（数字）, foot（左下角 html）, note, link（名字是否链到详情）, actions（覆盖右下角）, dismiss } */
  function personHtml(p, o) {
    o = o || {};
    const intro = typeof (p.answers && p.answers.intro) === "string" ? p.answers.intro.trim() : "";
    const name = o.link === false
      ? `<p class="person__name">${esc(p.name)}</p>`
      : `<a class="person__name" href="#/coffee/p/${esc(encodeURIComponent(p.id))}">${esc(p.name)}</a>`;
    const reasons = (o.reasons || []).length
      ? `<ul class="person__reasons">${o.reasons.map((r) => `<li class="reason">${icon("sparkle")}<span>${esc(L(r))}</span></li>`).join("")}</ul>` : "";
    const dismiss = o.dismiss && (!p.relation || p.relation.state === "none")
      ? `<button type="button" class="btn btn--ghost btn--sm" data-act="dismiss" data-id="${esc(p.id)}">${esc(t("coffee.rec.dismiss"))}</button>` : "";
    return `<article class="person${o.rec ? " person--rec" : ""}" data-person="${esc(p.id)}">
      <div class="person__head">${avatar(p.name)}<div class="person__who">${name}${metaHtml(p)}</div></div>
      ${reasons}${tagsHtml(p)}
      ${intro ? `<p class="person__intro">${esc(intro)}</p>` : ""}
      ${o.note ? `<p class="person__note">${esc(o.note)}</p>` : ""}
      <div class="person__foot">${o.overlap != null ? overlapHtml(o.overlap) : o.foot || ""}<div class="person__actions">${dismiss}${o.actions != null ? o.actions : relationHtml(p)}</div></div>
    </article>`;
  }

  /* ---------- 通用块 ---------- */
  function mount(root, cls) {
    root.innerHTML = `<section class="page${cls ? " " + cls : ""}"></section>`;
    return root.firstElementChild;
  }
  const retryBtn = (act) => `<button type="button" class="btn btn--primary" data-act="${act || "retry"}">${esc(t("common.retry"))}</button>`;
  const errorBlock = (error, act) => YL.ui.emptyState("info", YL.ui.errorText(error, "coffee"), retryBtn(act));
  const noticeHtml = (kind, iconName, bodyHtml) => `<div class="notice notice--${kind}">${icon(iconName)}<div class="notice__body">${bodyHtml}</div></div>`;
  function joinCard() {
    return `<section class="card stack" data-role="join">
      <div class="stack stack--s">
        <h2 class="card__title">${esc(t("coffee.join.title"))}</h2>
        <p class="muted">${esc(t("coffee.join.body"))}</p>
      </div>
      <div><a class="btn btn--primary" href="#/coffee/times">${icon("clock")}${esc(t("coffee.join.cta"))}</a></div>
    </section>`;
  }
  const noRound = () => YL.ui.emptyState("coffee", t("coffee.home.noRound"));
  async function badges() {
    const r = await YL.api.get("/coffee/state");
    if (r.ok) YL.registry.setBadge("inbox", (r.data && r.data.incoming) || 0);
  }
  const refreshBadge = () => { badges().catch(() => {}); };

  /* ---------- 想认识 / 接受 / 跳过 / 不感兴趣（推荐、找人、详情、收件箱共用） ----------
     env = { ctx, page, people: Map(id → card), source: "rec" | "browse", draw(p) → html, onAccepted?(p), onRemoved?(id), reload?() } */
  const cardEl = (env, id) => env.page.querySelector(`[data-person="${CSS.escape(id)}"]`);
  function redraw(env, p) {
    const old = cardEl(env, p.id);
    if (!old) return;
    old.outerHTML = env.draw(p);
    const fresh = cardEl(env, p.id);
    const target = fresh && fresh.querySelector(".person__actions button, .person__actions a, a.person__name, [data-focus]");
    if (target) target.focus();
  }
  function removeCard(env, id) {
    const el = cardEl(env, id);
    env.people.delete(id);
    if (!el) return;
    const next = [el.nextElementSibling, el.previousElementSibling].find((x) => x && x.matches("[data-person]"));
    el.remove();
    const target = next && next.querySelector(".person__actions button, a.person__name");
    if (target) target.focus();
    if (env.onRemoved) env.onRemoved(id);
  }
  function personAction(btn, env) {
    const p = env.people.get(btn.dataset.id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === "invite") openInvite(p, env);
    else if (act === "accept") accept(btn, p, env);
    else if (act === "skip") skip(btn, p, env);
    else if (act === "dismiss") dismiss(btn, p, env);
  }
  function showMatched(name) {
    YL.ui.modal(`<h2 class="modal__title" tabindex="-1" data-role="title">${esc(t("coffee.matched.title", { name }))}</h2>
      <div class="stack">
        ${noticeHtml("success", "heart", `<p>${esc(t("coffee.matched.body"))}</p>`)}
        <div class="cluster cluster--end">
          <button type="button" class="btn btn--ghost" data-close>${esc(t("coffee.matched.later"))}</button>
          <a class="btn btn--primary" href="#/coffee/matches">${esc(t("coffee.matched.go"))}${icon("arrowRight")}</a>
        </div>
      </div>`, {
      label: t("coffee.matched.title", { name }),
      onMount(panel, close) {
        panel.querySelector('[data-role="title"]').focus();
        panel.addEventListener("click", (e) => {
          if (e.target.closest("a[href]")) YL.ui.closeModal();
          else if (e.target.closest("[data-close]")) close();
        });
      }
    });
  }
  function openInvite(p, env) {
    const max = D.LIMITS.note, ctx = env.ctx;
    YL.ui.modal(`<h2 class="modal__title" tabindex="-1" data-role="title">${esc(t("coffee.invite.title", { name: p.name }))}</h2>
      <form class="form" novalidate>
        <div class="field" data-field="note">
          <label class="field__label" for="coffee-note">${esc(t("coffee.invite.noteLabel"))} <span class="faint">${esc(t("common.optional"))}</span></label>
          <textarea class="textarea" id="coffee-note" name="note" rows="3" maxlength="${max}" aria-describedby="coffee-note-count" placeholder="${esc(t("coffee.invite.notePh"))}"></textarea>
          <p class="field__count" id="coffee-note-count">0/${max}</p>
        </div>
        ${noticeHtml("info", "lock", `<p>${esc(t("coffee.invite.ruleContact"))}</p><p>${esc(t("coffee.invite.ruleSkip"))}</p><p>${esc(t("coffee.invite.ruleExpire", { n: maxOpen }))}</p>`)}
        <div data-role="err" aria-live="assertive"></div>
        <button type="submit" class="btn btn--accent btn--block">${icon("heart")}${esc(t("coffee.invite.send"))}</button>
      </form>`, {
      label: t("coffee.invite.title", { name: p.name }),
      onMount(panel) {
        const form = panel.querySelector("form"), note = form.elements.note, count = panel.querySelector("#coffee-note-count"), errBox = panel.querySelector('[data-role="err"]');
        panel.querySelector('[data-role="title"]').focus(); // 不自动聚焦输入框：手机上不要一打开就弹键盘
        note.addEventListener("input", () => { count.textContent = note.value.length + "/" + max; });
        panel.addEventListener("click", (e) => { if (e.target.closest("a[href]")) YL.ui.closeModal(); });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const btn = form.querySelector('[type="submit"]');
          YL.ui.clearFieldErrors(form);
          errBox.innerHTML = "";
          YL.ui.busy(btn, true);
          const r = await YL.api.post("/coffee/invites", { toId: p.id, note: note.value.trim(), source: env.source });
          YL.ui.busy(btn, false);
          if (r.ok) refreshBadge();
          if (!ctx.isActive()) { YL.ui.closeModal(); return; }
          if (r.ok) {
            YL.ui.closeModal();
            p.relation = { state: r.data.matched ? "matched" : "invited", inviteId: r.data.id };
            redraw(env, p);
            if (r.data.matched) showMatched(p.name);
            else YL.ui.toast(t("coffee.invite.sent"), "success");
            return;
          }
          const reason = r.error && r.error.reason;
          if (r.error && r.error.fields) { YL.ui.showFieldErrors(form, r.error.fields, "coffee"); return; }
          if (reason === "already_invited" || reason === "already_matched") {
            YL.ui.closeModal();
            p.relation = { state: reason === "already_invited" ? "invited" : "matched" };
            redraw(env, p);
            YL.ui.toast(YL.ui.errorText(r.error, "coffee"));
            return;
          }
          const more = reason === "too_many_open" ? `<p><a href="#/coffee/inbox">${esc(t("coffee.invite.seeSent"))}</a></p>` : "";
          errBox.innerHTML = noticeHtml("danger", "info", `<p>${esc(YL.ui.errorText(r.error, "coffee"))}</p>${more}`);
        });
      }
    });
  }
  async function accept(btn, p, env) {
    const inviteId = p.inviteId || (p.relation && p.relation.inviteId);
    YL.ui.busy(btn, true);
    const r = await YL.api.post(`/coffee/invites/${encodeURIComponent(inviteId)}/accept`);
    refreshBadge(); // 角标在外壳里，不受页面切换影响
    if (!env.ctx.isActive()) return;
    if (!r.ok) {
      YL.ui.busy(btn, false);
      YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error");
      if (env.reload && r.error.code === "conflict") env.reload();
      return;
    }
    p.relation = { state: "matched", inviteId };
    if (env.onAccepted) env.onAccepted(p); else redraw(env, p);
    showMatched(p.name);
  }
  async function skip(btn, p, env) {
    YL.ui.busy(btn, true);
    const r = await YL.api.post(`/coffee/invites/${encodeURIComponent(p.inviteId)}/skip`);
    refreshBadge();
    if (!env.ctx.isActive()) return;
    if (!r.ok) {
      YL.ui.busy(btn, false);
      YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error");
      if (env.reload && r.error.code === "conflict") env.reload();
      return;
    }
    removeCard(env, p.id);
    YL.ui.toast(t("coffee.inbox.skipped"));
  }
  async function dismiss(btn, p, env) {
    YL.ui.busy(btn, true);
    const r = await YL.api.post(`/coffee/recommendations/${encodeURIComponent(p.id)}/dismiss`);
    if (!env.ctx.isActive()) return;
    if (!r.ok) { YL.ui.busy(btn, false); YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error"); return; }
    removeCard(env, p.id);
    YL.ui.toast(t("coffee.rec.dismissed"));
  }
  const bindRetry = (page) => page.addEventListener("click", (e) => { if (e.target.closest('[data-act="retry"]')) YL.router.render(); });
  function bindPeople(page, env, extra) {
    page.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || !page.contains(btn) || btn.disabled) return;
      if (btn.dataset.act === "retry") { YL.router.render(); return; }
      if (extra && extra(btn, e) === true) return;
      personAction(btn, env);
    });
  }

  /* ================= #/coffee 首页 ================= */
  async function viewHome(root, ctx) {
    backPath = "coffee";
    const page = mount(root);
    page.innerHTML = YL.ui.spinner();
    const env = {
      ctx, page, people: new Map(), source: "rec",
      draw: (p) => personHtml(p, { rec: true, reasons: p.reasons, overlap: list(p.overlap).length, dismiss: true }),
      onRemoved: () => { if (!env.people.size) { const box = page.querySelector('[data-role="recs-body"]'); if (box) box.innerHTML = recsEmpty(); } }
    };
    bindPeople(page, env, (btn) => { if (btn.dataset.act === "retry-recs") { loadRecs(env); return true; } return false; });

    const s = await YL.api.get("/coffee/state");
    if (!ctx.isActive()) return;
    if (!s.ok) { page.innerHTML = errorBlock(s.error); return; }
    const st = s.data;
    YL.registry.setBadge("inbox", st.incoming || 0);
    if (!st.round) { page.innerHTML = noRound(); return; }
    maxOpen = st.round.maxOpenInvites || maxOpen;
    page.innerHTML = homeHtml(st);
    if (st.joined) loadRecs(env);
  }
  function homeHtml(st) {
    const r = st.round, ev = r.kind === "event", name = YL.auth.displayName();
    const upcoming = D.localDate(nowIso(), r.timezone) < r.startDate;
    const eyebrow = ev ? t("coffee.home.eyebrowEvent") : upcoming ? t("coffee.home.eyebrowSoon") : t("coffee.home.eyebrowWeek");
    const free = openPicks(r, st.slots, st.locked).length;
    const themes = list(r.themeTags).map((x) => {
      const q = ["interests", "goals"].map(question).find((qq) => qq && (qq.options || []).some((o) => o.id === x));
      return `<span class="tag tag--theme">${esc(q ? optLabel(q.id, x) : x)}</span>`;
    }).join("");
    const actions = (st.joined ? `<a class="btn btn--secondary btn--sm" href="#/coffee/times">${icon("clock")}${esc(t("coffee.home.editTimes"))}</a>` : "")
      + (ev ? `<a class="btn btn--secondary btn--sm" href="#/events/${esc(encodeURIComponent(r.id))}">${esc(t("coffee.home.eventLink"))}${icon("arrowRight")}</a>` : "");
    const steps = [["clock", t("coffee.how.s1"), t("coffee.how.s1d")], ["heart", t("coffee.how.s2"), t("coffee.how.s2d")], ["coffee", t("coffee.how.s3"), t("coffee.how.s3d")]];
    return `<div class="split">
      <div class="stack stack--l">
        <section class="banner${ev ? " banner--event" : ""}">
          <p class="banner__eyebrow">${esc(eyebrow)}</p>
          <h1 class="banner__title">${esc(L(r.title))}</h1>
          <p>${esc(st.joined ? t("coffee.home.helloJoined", { name }) : t("coffee.home.hello", { name }))}</p>
          ${themes ? `<div class="tags">${themes}</div>` : ""}
          <div class="banner__meta">
            <span>${icon("calendar")}${esc(rangeText(r))}</span>
            <span>${icon("people")}${esc(t("coffee.home.participants", { n: st.participants || 0 }))}</span>
          </div>
          ${actions ? `<div class="banner__actions">${actions}</div>` : ""}
        </section>
        <nav class="statusbar" aria-label="${esc(t("coffee.status.label"))}">
          <a class="statusbar__item" href="#/coffee/times"><strong>${free}</strong><span>${esc(t("coffee.status.times"))}</span></a>
          <a class="statusbar__item" href="#/coffee/inbox"><strong>${st.incoming || 0}</strong><span>${esc(t("coffee.status.incoming"))}</span></a>
          <a class="statusbar__item" href="#/coffee/matches"><strong>${st.matches || 0}</strong><span>${esc(t("coffee.status.matches"))}</span></a>
        </nav>
        ${st.joined ? `<section class="stack" aria-label="${esc(t("coffee.rec.title"))}">
            ${YL.ui.sectionTitle(t("coffee.rec.title"), "", t("coffee.rec.sub"))}
            <div class="stack" data-role="recs-body">${YL.ui.spinner()}</div>
          </section>` : joinCard()}
      </div>
      <aside class="stack">
        ${st.incoming ? noticeHtml("accent", "heart", `<p><strong>${esc(st.incoming === 1 ? t("coffee.home.incomingOne") : t("coffee.home.incoming", { n: st.incoming }))}</strong></p><p><a href="#/coffee/inbox">${esc(t("coffee.home.incomingCta"))}</a></p>`) : ""}
        ${st.matches ? noticeHtml("success", "sparkle", `<p><strong>${esc(st.matches === 1 ? t("coffee.home.matchesOne") : t("coffee.home.matches", { n: st.matches }))}</strong></p><p><a href="#/coffee/matches">${esc(t("coffee.home.matchesCta"))}</a></p>`) : ""}
        <section class="card card--quiet">
          <h2 class="card__title">${esc(t("coffee.how.title"))}</h2>
          <ol class="list">${steps.map((s) => `<li class="list__item">${icon(s[0])}<div class="list__main"><p class="list__title">${esc(s[1])}</p><p class="list__sub">${esc(s[2])}</p></div></li>`).join("")}</ol>
        </section>
      </aside>
    </div>`;
  }
  const recsEmpty = () => YL.ui.emptyState("sparkle", t("coffee.rec.empty"), `<a class="btn btn--primary" href="#/coffee/browse">${esc(t("coffee.rec.browse"))}</a>`);
  async function loadRecs(env) {
    const box = env.page.querySelector('[data-role="recs-body"]');
    if (!box) return;
    box.innerHTML = YL.ui.spinner();
    const r = await YL.api.get("/coffee/recommendations");
    if (!env.ctx.isActive()) return;
    if (!r.ok) {
      if (r.error.reason === "not_joined") { box.closest("section").outerHTML = joinCard(); return; }
      box.innerHTML = errorBlock(r.error, "retry-recs");
      return;
    }
    const d = r.data;
    if (!d.enabled) {
      box.innerHTML = noticeHtml("info", "people", `<p><strong>${esc(t("coffee.rec.lockedTitle"))}</strong></p>
        <p>${esc(t("coffee.rec.locked", { threshold: d.threshold, n: d.participants }))}</p>
        <div><a class="btn btn--primary btn--sm" href="#/coffee/browse">${esc(t("coffee.rec.browse"))}</a></div>`);
      return;
    }
    env.people = new Map(list(d.items).map((p) => [p.id, p]));
    if (!env.people.size) { box.innerHTML = recsEmpty(); return; }
    box.innerHTML = d.items.map(env.draw).join("")
      + (d.engine === "deepseek" ? `<p class="cluster xsmall faint">${icon("sparkle", { size: 14 })}<span>${esc(t("coffee.rec.engineAi"))}</span></p>` : "")
      + `<a class="btn btn--secondary btn--block" href="#/coffee/browse">${icon("people")}${esc(t("coffee.rec.more"))}</a>`;
  }

  /* ================= #/coffee/browse 找人 ================= */
  const FILTERS = ["identity", "goal", "interest", "field"];
  const FILTER_Q = { goal: "goals", interest: "interests", field: "field" };
  function filterItems(key) {
    const all = [{ id: "", label: t("coffee.filter.all") }];
    if (key === "identity") return all.concat([{ id: "student", label: t("coffee.identity.student") }, { id: "alumni", label: t("coffee.identity.alumni") }]);
    const q = question(FILTER_Q[key]);
    return all.concat(((q && q.options) || []).map((o) => ({ id: o.id, label: o.label })));
  }
  function browsePath(f) {
    const p = new URLSearchParams();
    FILTERS.forEach((k) => { if (f[k]) p.set(k, f[k]); });
    const s = p.toString();
    return "coffee/browse" + (s ? "?" + s : "");
  }
  async function viewBrowse(root, ctx) {
    const f = {};
    FILTERS.forEach((k) => (f[k] = String(ctx.query[k] || "")));
    const active = FILTERS.filter((k) => f[k]).length;
    backPath = browsePath(f);
    const open = filtersOpen != null ? filtersOpen : active > 0 || window.matchMedia("(min-width: 900px)").matches;
    const page = mount(root);
    const env = { ctx, page, people: new Map(), source: "browse", draw: (p) => personHtml(p, { overlap: p.overlapCount || 0 }) };
    page.innerHTML = `<header class="page-head"><div class="page-head__text">
        <p class="eyebrow">${esc(t("coffee.browse.eyebrow"))}</p>
        <h1 class="page-title">${esc(t("coffee.browse.title"))}</h1>
        <p class="page-sub">${esc(t("coffee.browse.sub"))}</p>
      </div></header>
      <div class="stack" data-role="tools">
        <div class="cluster cluster--between">
          <p class="small muted" data-role="count" aria-live="polite"></p>
          <div class="cluster">
            ${active ? `<button type="button" class="btn btn--ghost btn--sm" data-act="clear">${esc(t("coffee.browse.clear"))}</button>` : ""}
            <button type="button" class="btn btn--secondary btn--sm" data-act="toggle" aria-expanded="${open}" aria-controls="coffee-filters">${icon("sliders")}${esc(t("coffee.browse.filters"))}${active ? `<span class="count">${active}</span>` : ""}</button>
          </div>
        </div>
        <div class="filters" id="coffee-filters"${open ? "" : " hidden"}>
          ${FILTERS.map((k) => `<div class="filter-row" role="group" aria-labelledby="coffee-f-${k}" data-filter="${k}">
            <span class="filter-row__label" id="coffee-f-${k}">${esc(t("coffee.filter." + k))}</span>
            ${YL.ui.chips(filterItems(k), f[k], k, "chips--scroll")}
          </div>`).join("")}
        </div>
      </div>
      <div data-role="results">${YL.ui.spinner()}</div>`;

    // 让每行选中的标签滚到看得见的位置；刚点过的标签拿回焦点
    if (open) page.querySelectorAll(".filter-row .chip.is-active").forEach((c) => {
      const sc = c.parentElement;
      sc.scrollLeft = Math.max(0, c.offsetLeft - sc.offsetLeft - (sc.clientWidth - c.offsetWidth) / 2);
    });
    if (pendingFocus) {
      const pf = pendingFocus;
      pendingFocus = null;
      const el = page.querySelector(`[data-filter="${pf.k}"] [data-${pf.k}="${CSS.escape(pf.v)}"]`);
      if (el) el.focus({ preventScroll: true });
    }

    bindPeople(page, env, (btn) => {
      const act = btn.dataset.act;
      if (act === "toggle") {
        const box = page.querySelector("#coffee-filters");
        box.hidden = !box.hidden;
        filtersOpen = !box.hidden;
        btn.setAttribute("aria-expanded", String(filtersOpen));
        return true;
      }
      if (act === "clear") { pendingFocus = null; YL.router.navigate("coffee/browse"); return true; }
      return false;
    });
    page.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      const row = chip && chip.closest("[data-filter]");
      if (!row) return;
      const k = row.dataset.filter, v = chip.getAttribute("data-" + k) || "";
      const next = Object.assign({}, f);
      next[k] = f[k] === v ? "" : v; // 再点一次已选的标签 = 取消
      pendingFocus = { k, v: next[k] };
      YL.router.navigate(browsePath(next));
    });

    const r = await YL.api.get("/coffee/pool", f);
    if (!ctx.isActive()) return;
    const box = page.querySelector('[data-role="results"]');
    if (!r.ok) {
      const reason = r.error && r.error.reason;
      if (reason === "not_joined" || reason === "browse_closed") page.querySelector('[data-role="tools"]').hidden = true;
      if (reason === "not_joined") box.innerHTML = joinCard();
      else if (reason === "browse_closed") box.innerHTML = YL.ui.emptyState("lock", t("coffee.err.browse_closed"), `<a class="btn btn--primary" href="#/coffee">${esc(t("coffee.backHome"))}</a>`);
      else box.innerHTML = errorBlock(r.error);
      return;
    }
    const items = list(r.data);
    env.people = new Map(items.map((p) => [p.id, p]));
    page.querySelector('[data-role="count"]').textContent = items.length === 1 ? t("coffee.browse.countOne") : t("coffee.browse.count", { n: items.length });
    box.innerHTML = items.length
      ? `<div class="grid-cards">${items.map(env.draw).join("")}</div>`
      : YL.ui.emptyState("search", active ? t("coffee.browse.emptyFiltered") : t("coffee.browse.empty"),
        active ? `<button type="button" class="btn btn--primary" data-act="clear">${esc(t("coffee.browse.clear"))}</button>` : "");
  }

  /* ================= #/coffee/p/:id 个人详情 ================= */
  async function viewPerson(root, ctx) {
    const page = mount(root, "page--medium");
    const back = `<div><a class="btn btn--ghost btn--sm" href="#/${esc(backPath)}">${icon("chevronLeft")}${esc(t("common.back"))}</a></div>`;
    const notFound = () => back + YL.ui.emptyState("user", t("coffee.person.notFound"), `<a class="btn btn--primary" href="#/coffee/browse">${esc(t("coffee.rec.browse"))}</a>`);
    if (!ctx.id) { page.innerHTML = notFound(); return; }
    page.innerHTML = back + YL.ui.spinner();
    const env = { ctx, page, people: new Map(), source: backPath === "coffee" ? "rec" : "browse", draw: null };
    bindPeople(page, env);
    const [r, s] = await Promise.all([YL.api.get("/coffee/people/" + encodeURIComponent(ctx.id)), YL.api.get("/coffee/state")]);
    if (!ctx.isActive()) return;
    if (!r.ok) {
      const reason = r.error && r.error.reason;
      page.innerHTML = reason === "not_joined" ? back + joinCard() : r.error.code === "not_found" ? notFound() : back + errorBlock(r.error);
      return;
    }
    const tz = (s.ok && s.data.round && s.data.round.timezone) || D.DEFAULT_ROUND.timezone;
    const p = r.data;
    env.people.set(p.id, p);
    env.draw = (x) => detailHtml(x, tz);
    page.innerHTML = back + detailHtml(p, tz);
  }
  function detailHtml(p, tz) {
    const a = p.answers || {};
    const blocks = YL.auth.questions().filter((q) => list(a[q.id]).some((v) => String(v).trim())).map((q) => {
      let body;
      if (q.type === "text") body = `<p>${esc(String(a[q.id]).trim())}</p>`;
      else if (q.id === "interests") body = `<div class="tags">${interestTags(a[q.id]).join("")}</div>`;
      else body = `<div class="tags">${list(a[q.id]).map((v) => `<span class="tag${q.id === "goals" ? " tag--goal" : ""}">${esc(optLabel(q.id, v))}</span>`).join("")}</div>`;
      return `<div class="stack stack--s"><h2 class="eyebrow">${esc(shortLabel(q))}</h2>${body}</div>`;
    }).join("");
    const overlap = list(p.overlap);
    return `<article class="person" data-person="${esc(p.id)}">
      <div class="person__head">${avatar(p.name, "lg")}<div class="person__who"><h1 class="person__name" tabindex="-1" data-focus>${esc(p.name)}</h1>${metaHtml(p)}</div></div>
      ${blocks}
      <div class="stack stack--s">
        <h2 class="eyebrow">${esc(t("coffee.person.timesTitle"))}</h2>
        ${overlap.length
          ? `<div class="times" role="list">${overlap.map((s) => `<span class="time" role="listitem">${esc(whenText(s))}<small>${esc(bjFull(tz, s))}</small></span>`).join("")}</div>
             <p class="small faint">${esc(t("coffee.person.timesHint", { tz: tzName(tz) }))}</p>`
          : `<p class="small muted">${esc(t("coffee.person.timesNone"))}</p>`}
      </div>
      <div class="person__foot">${overlapHtml(overlap.length)}<div class="person__actions">${relationHtml(p)}</div></div>
    </article>`;
  }

  /* ================= #/coffee/times 选空闲时间 ================= */
  async function viewTimes(root, ctx) {
    const page = mount(root, "page--medium");
    page.innerHTML = YL.ui.spinner();
    const s = await YL.api.get("/coffee/state");
    if (!ctx.isActive()) return;
    if (!s.ok) { page.innerHTML = errorBlock(s.error); bindRetry(page); return; }
    const st = s.data;
    if (!st.round) { page.innerHTML = noRound(); return; }
    const round = st.round, tz = round.timezone, dates = D.roundDates(round), times = D.slotTimes(round);
    const at = nowIso();
    const closed = new Set(D.slotIds(round).filter((x) => D.isClosed(round, x, at)));
    let locked = new Set(list(st.locked));
    let saved = list(st.slots).slice().sort();
    const picked = new Set(saved);
    let joined = !!st.joined;
    const openIn = (d) => times.map((tm) => d + "T" + tm).filter((x) => !closed.has(x) && !locked.has(x));
    let day = dates.find((d) => openIn(d).length) || dates[0];
    const anyOpen = dates.some((d) => openIn(d).length);

    page.innerHTML = `<header class="page-head"><div class="page-head__text">
        <p class="eyebrow">${esc(L(round.title))} · ${esc(rangeText(round))}</p>
        <h1 class="page-title">${esc(t("coffee.times.title"))}</h1>
        <p class="page-sub">${esc(t("coffee.times.sub"))}</p>
      </div></header>
      ${!joined && anyOpen ? noticeHtml("accent", "sparkle", `<p>${esc(t("coffee.times.joinHint"))}</p>`) : ""}
      ${anyOpen ? "" : noticeHtml("warn", "info", `<p>${esc(t("coffee.times.allClosed"))}</p>`)}
      <div class="slots">
        <p class="slots__tz"><span>${esc(t("coffee.times.tz", { tz: tzName(tz) }))}</span><span>${esc(t("coffee.times.rules", { min: round.slotMinutes, h: round.cutoffHours }))}</span></p>
        <div class="slots__days" role="group" aria-label="${esc(t("coffee.times.days"))}">
          ${dates.map((d) => `<button type="button" class="day" data-act="day" data-date="${esc(d)}"${openIn(d).length || times.some((tm) => locked.has(d + "T" + tm)) ? "" : " disabled"}>
            <span class="day__wd">${esc(weekday(d))}</span><span class="day__d">${esc(md(d))}</span><span class="day__n"></span></button>`).join("")}
        </div>
        <div class="cluster cluster--between">
          <h2 class="section-title" id="coffee-day-title" data-role="day-title"></h2>
          <div class="cluster">
            <button type="button" class="btn btn--secondary btn--sm" data-act="day-all">${esc(t("coffee.times.dayAll"))}</button>
            <button type="button" class="btn btn--ghost btn--sm" data-act="day-clear">${esc(t("coffee.times.dayClear"))}</button>
          </div>
        </div>
        <div class="slots__grid" role="group" aria-labelledby="coffee-day-title" data-role="grid"></div>
        <div class="slot-legend">
          <span><i></i>${esc(t("coffee.times.legendOpen"))}</span>
          <span><i class="is-selected"></i>${esc(t("coffee.times.legendPicked"))}</span>
          <span><i class="is-locked"></i>${esc(t("coffee.times.legendLocked"))}</span>
          <span><i class="is-closed"></i>${esc(t("coffee.times.legendClosed"))}</span>
        </div>
      </div>
      <div class="savebar">
        <span data-role="count" aria-live="polite"></span>
        <button type="button" class="btn btn--primary btn--sm" data-act="save">${esc(t("common.save"))}</button>
      </div>`;

    const grid = page.querySelector('[data-role="grid"]');
    const dirty = () => { const now = Array.from(picked).sort(); return now.length !== saved.length || now.some((x, i) => x !== saved[i]); };
    function slotHtml(id) {
      const tm = timeOf(id), bj = `<small>${esc(bjShort(tz, id))}</small>`;
      if (locked.has(id)) return `<button type="button" class="slot is-locked" disabled aria-pressed="true">${esc(tm)}${bj}<span class="sr-only">${esc(t("coffee.times.legendLocked"))}</span></button>`;
      if (closed.has(id)) return `<button type="button" class="slot is-closed" disabled>${esc(tm)}${bj}<span class="sr-only">${esc(t("coffee.times.legendClosed"))}</span></button>`;
      return `<button type="button" class="slot" data-act="slot" data-slot="${esc(id)}" aria-pressed="${picked.has(id)}">${esc(tm)}${bj}</button>`;
    }
    function drawDays() {
      page.querySelectorAll(".day").forEach((b) => {
        const d = b.dataset.date, n = times.filter((tm) => picked.has(d + "T" + tm) || locked.has(d + "T" + tm)).length, on = d === day;
        b.classList.toggle("is-active", on);
        b.classList.toggle("has-picks", n > 0);
        b.setAttribute("aria-pressed", String(on));
        b.querySelector(".day__n").textContent = n ? t("coffee.times.dayPicked", { n }) : "";
      });
      const open = openIn(day);
      page.querySelector('[data-act="day-all"]').disabled = !open.length || open.every((x) => picked.has(x));
      page.querySelector('[data-act="day-clear"]').disabled = !open.some((x) => picked.has(x));
    }
    function drawCount() {
      const n = openPicks(round, Array.from(new Set(Array.from(picked).concat(Array.from(locked)))), Array.from(locked)).length;
      const d = dirty();
      page.querySelector('[data-role="count"]').textContent = (n === 1 ? t("coffee.times.countOne") : t("coffee.times.count", { n })) + (d ? " · " + t("coffee.times.unsaved") : "");
    }
    function drawGrid() {
      page.querySelector('[data-role="day-title"]').textContent = dayLabel(day);
      grid.innerHTML = times.map((tm) => slotHtml(day + "T" + tm)).join("");
    }
    const drawAll = () => { drawGrid(); drawDays(); drawCount(); };
    drawAll();

    page.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || !page.contains(btn) || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === "slot") {
        const id = btn.dataset.slot;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        btn.setAttribute("aria-pressed", String(picked.has(id)));
        drawDays(); drawCount();
      } else if (act === "day") {
        day = btn.dataset.date;
        drawGrid(); drawDays();
      } else if (act === "day-all" || act === "day-clear") {
        openIn(day).forEach((x) => { if (act === "day-all") picked.add(x); else picked.delete(x); });
        drawGrid(); drawDays(); drawCount();
        btn.focus();
      } else if (act === "save") {
        if (!joined && !Array.from(picked).some((x) => !closed.has(x))) { YL.ui.toast(t("coffee.times.pickOne"), "error"); return; }
        YL.ui.busy(btn, true);
        const r = await YL.api.post("/coffee/availability", { slots: Array.from(picked) });
        if (!ctx.isActive()) return;
        YL.ui.busy(btn, false);
        if (!r.ok) { YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error"); drawCount(); return; }
        saved = list(r.data.slots).slice().sort();
        picked.clear(); saved.forEach((x) => picked.add(x));
        locked = new Set(list(r.data.locked));
        YL.ui.toast(t("coffee.times.saved"), "success");
        if (!joined) { joined = true; YL.router.navigate("coffee"); return; }
        drawAll();
      }
    });
  }

  /* ================= #/coffee/inbox 收件箱 ================= */
  async function viewInbox(root, ctx) {
    backPath = "coffee/inbox";
    const page = mount(root, "page--medium");
    page.innerHTML = YL.ui.spinner();
    let roundId = null;
    const linkable = (p) => !!roundId && p.roundId === roundId; // 详情页只能看本轮的人
    const env = {
      ctx, page, people: new Map(), source: "browse",
      draw: (p) => personHtml(p, {
        link: linkable(p), note: p.note,
        foot: `<span class="person__overlap">${icon("mail")}${esc(t("coffee.inbox.sentAt", { date: YL.ui.formatDate(p.createdAt) }))}</span>`,
        actions: `<button type="button" class="btn btn--ghost btn--sm" data-act="skip" data-id="${esc(p.id)}">${esc(t("coffee.inbox.skip"))}</button>
          <button type="button" class="btn btn--accent btn--sm" data-act="accept" data-id="${esc(p.id)}">${icon("heart")}${esc(t("coffee.inbox.accept"))}</button>`
      }),
      onAccepted: (p) => removeCard(env, p.id),
      onRemoved: () => {
        const listEl = page.querySelector('[data-role="incoming"]');
        if (listEl && !listEl.querySelector("[data-person]")) listEl.outerHTML = incomingEmpty();
      },
      reload: () => load()
    };
    const outHtml = (p) => personHtml(p, {
      link: linkable(p),
      foot: `<span class="person__overlap">${icon("mail")}${esc(t("coffee.inbox.sentAt", { date: YL.ui.formatDate(p.createdAt) }))}</span>`,
      actions: `<span class="pill pill--waiting">${icon("clock")}${esc(t("coffee.inbox.waiting"))}</span>`
    });
    const incomingEmpty = () => `<div data-role="incoming-empty">${YL.ui.emptyState("inbox", t("coffee.inbox.incomingEmpty"), `<a class="btn btn--secondary" href="#/coffee/times">${esc(t("coffee.home.editTimes"))}</a>`)}</div>`;
    bindPeople(page, env);

    async function load() {
      const [r, s] = await Promise.all([YL.api.get("/coffee/inbox"), YL.api.get("/coffee/state")]);
      if (!ctx.isActive()) return;
      if (!r.ok) { page.innerHTML = errorBlock(r.error); return; }
      const round = s.ok ? s.data.round : null;
      roundId = round ? round.id : null;
      if (s.ok) YL.registry.setBadge("inbox", s.data.incoming || 0);
      const max = (round && round.maxOpenInvites) || maxOpen;
      maxOpen = max;
      const inc = list(r.data.incoming), out = list(r.data.outgoing);
      env.people = new Map(inc.map((p) => [p.id, p]));
      page.innerHTML = `<header class="page-head"><div class="page-head__text">
          <p class="eyebrow">${esc(t("coffee.inbox.eyebrow"))}</p>
          <h1 class="page-title">${esc(t("coffee.inbox.title"))}</h1>
          <p class="page-sub">${esc(t("coffee.inbox.sub"))}</p>
        </div></header>
        ${noticeHtml("info", "info", `<p>${esc(t("coffee.inbox.ruleSkip"))}</p><p>${esc(t("coffee.inbox.ruleExpire"))}</p><p>${esc(t("coffee.inbox.ruleMax", { n: max }))}</p>`)}
        <section class="stack" aria-label="${esc(t("coffee.inbox.incoming"))}">
          ${YL.ui.sectionTitle(t("coffee.inbox.incoming"), "", t("coffee.inbox.incomingSub"))}
          ${inc.length ? `<div class="grid-cards" data-role="incoming">${inc.map(env.draw).join("")}</div>` : incomingEmpty()}
        </section>
        <section class="stack" aria-label="${esc(t("coffee.inbox.outgoing"))}">
          ${YL.ui.sectionTitle(t("coffee.inbox.outgoing"), "", t("coffee.inbox.outgoingSub", { n: out.length, max }))}
          ${out.length ? `<div class="grid-cards">${out.map(outHtml).join("")}</div>`
            : YL.ui.emptyState("message", t("coffee.inbox.outgoingEmpty"), `<a class="btn btn--secondary" href="#/coffee">${esc(t("coffee.inbox.toRecs"))}</a>`)}
        </section>`;
    }
    await load();
  }

  /* ================= #/coffee/matches 匹配 ================= */
  async function viewMatches(root, ctx) {
    const page = mount(root, "page--medium");
    page.innerHTML = `<header class="page-head"><div class="page-head__text">
        <p class="eyebrow">${esc(t("coffee.matches.eyebrow"))}</p>
        <h1 class="page-title">${esc(t("coffee.matches.title"))}</h1>
        <p class="page-sub">${esc(t("coffee.matches.sub"))}</p>
      </div></header>
      <div data-role="list">${YL.ui.spinner()}</div>`;
    const box = page.querySelector('[data-role="list"]');
    const expanded = new Set(); // 正在"改时间"的匹配
    let items = [];

    async function load(focusId) {
      const r = await YL.api.get("/coffee/matches");
      if (!ctx.isActive()) return;
      if (!r.ok) { box.innerHTML = errorBlock(r.error); return; }
      items = list(r.data);
      box.innerHTML = items.length
        ? `<div class="stack">${items.map((m) => matchHtml(m, expanded.has(m.matchId))).join("")}</div>`
        : YL.ui.emptyState("sparkle", t("coffee.matches.empty"), `<div class="cluster">
            <a class="btn btn--primary" href="#/coffee">${esc(t("coffee.inbox.toRecs"))}</a>
            <a class="btn btn--secondary" href="#/coffee/browse">${esc(t("coffee.rec.browse"))}</a></div>`);
      if (focusId) {
        const el = box.querySelector(`[data-match="${CSS.escape(focusId)}"] [data-role="title"]`);
        if (el) el.focus();
      }
    }

    page.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || !page.contains(btn) || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === "retry") { box.innerHTML = YL.ui.spinner(); load(); return; }
      const card = btn.closest("[data-match]"), id = card && card.dataset.match;
      const m = items.find((x) => x.matchId === id);
      if (!m) return;
      if (act === "copy") { YL.ui.copy(m.contactMethod || ""); return; }
      if (act === "change") {
        const panel = card.querySelector('[data-role="change"]');
        panel.hidden = !panel.hidden;
        if (panel.hidden) expanded.delete(id); else expanded.add(id);
        btn.setAttribute("aria-expanded", String(!panel.hidden));
        return;
      }
      if (card.dataset.busy) return;
      let r;
      if (act === "schedule") {
        if (btn.dataset.slot === m.slot) return;
        card.dataset.busy = "1"; YL.ui.busy(btn, true);
        r = await YL.api.post(`/coffee/matches/${encodeURIComponent(id)}/schedule`, { slot: btn.dataset.slot });
        if (!ctx.isActive()) return;
        if (r.ok) { expanded.delete(id); YL.ui.toast(t("coffee.matches.scheduledToast"), "success"); }
      } else if (act === "unschedule") {
        const ok = await YL.ui.confirm(t("coffee.matches.cancelConfirm"), { danger: true, ok: t("coffee.matches.cancelOk"), cancel: t("coffee.matches.keep") });
        if (!ctx.isActive()) return;
        if (!ok) { btn.focus(); return; }
        card.dataset.busy = "1"; YL.ui.busy(btn, true);
        r = await YL.api.post(`/coffee/matches/${encodeURIComponent(id)}/schedule`, { slot: null });
        if (!ctx.isActive()) return;
        if (r.ok) { expanded.delete(id); YL.ui.toast(t("coffee.matches.canceledToast")); }
      } else if (act === "outcome") {
        card.dataset.busy = "1"; YL.ui.busy(btn, true);
        r = await YL.api.post(`/coffee/matches/${encodeURIComponent(id)}/outcome`, { met: btn.dataset.met === "1" });
        if (!ctx.isActive()) return;
        if (r.ok) YL.ui.toast(t("coffee.outcome.thanks"), "success");
      } else return;
      if (!r.ok) {
        YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error");
        const reason = r.error && r.error.reason;
        if (reason !== "slot_unavailable" && reason !== "already_started" && r.error.code !== "conflict") { delete card.dataset.busy; YL.ui.busy(btn, false); return; }
      }
      await load(id); // 成功或时间被占用 / 已开始：刷新列表
    });

    await load();
  }
  function matchHtml(m, expanded) {
    const tz = m.timezone || D.DEFAULT_ROUND.timezone, mid = esc(m.matchId);
    const timeBtn = (s, sel) => `<button type="button" class="time${sel ? " is-selected" : ""}" data-act="schedule" data-slot="${esc(s)}" aria-pressed="${!!sel}">${esc(whenText(s))}<small>${esc(bjFull(tz, s))}</small></button>`;
    const avail = list(m.available);
    let when;
    if (m.slot) {
      const who = m.scheduledBy === "me" ? t("coffee.matches.byMe") : m.scheduledBy === "them" ? t("coffee.matches.byThem") : "";
      when = `<div class="cluster"><span class="pill pill--success">${icon("check")}${esc(t("coffee.matches.scheduled", { when: whenText(m.slot), tz: tzName(tz) }))}</span></div>
        <p class="small muted">${esc(bjFull(tz, m.slot))}${who ? " · " + esc(who) : ""}</p>`;
      if (m.canSchedule) {
        when += `<div class="cluster">
            <button type="button" class="btn btn--secondary btn--sm" data-act="change" aria-expanded="${!!expanded}" aria-controls="coffee-chg-${mid}">${icon("edit")}${esc(t("coffee.matches.change"))}</button>
            <button type="button" class="btn btn--danger-ghost btn--sm" data-act="unschedule">${esc(t("coffee.matches.cancel"))}</button>
          </div>
          <div class="stack stack--s" id="coffee-chg-${mid}" data-role="change"${expanded ? "" : " hidden"}>
            ${avail.length ? `<p class="small muted">${esc(t("coffee.matches.pickHint"))}</p><div class="times">${[m.slot].concat(avail).sort().map((s) => timeBtn(s, s === m.slot)).join("")}</div>`
              : `<p class="small muted">${esc(t("coffee.matches.noOther"))}</p>`}
          </div>`;
      }
    } else if (avail.length) {
      when = `<p class="small">${esc(t("coffee.matches.pickHint"))}</p><div class="times">${avail.map((s) => timeBtn(s, false)).join("")}</div>`;
    } else if (m.canSchedule) {
      when = noticeHtml("info", "message", `<p>${esc(t("coffee.matches.noCommon"))}</p>`);
    } else {
      when = `<p class="small faint">${esc(t("coffee.matches.roundOver"))}</p>`;
    }
    let outcome = "";
    if (m.myOutcome) {
      const met = m.myOutcome === "met";
      outcome = `<div class="person__foot"><span class="pill${met ? " pill--success" : ""}">${met ? icon("check") : ""}${esc(met ? t("coffee.outcome.met") : t("coffee.outcome.missed"))}</span><span class="small faint">${esc(t("coffee.outcome.recorded"))}</span></div>`;
    } else if (m.canReport) {
      outcome = `<div class="person__foot"><span class="small">${esc(m.slot ? t("coffee.outcome.ask") : t("coffee.outcome.askEarly"))}</span>
        <div class="person__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-act="outcome" data-met="0">${esc(t("coffee.outcome.no"))}</button>
          <button type="button" class="btn btn--secondary btn--sm" data-act="outcome" data-met="1">${icon("check")}${esc(t("coffee.outcome.yes"))}</button>
        </div></div>`;
    }
    return `<article class="person" data-match="${mid}">
      <div class="person__head">${avatar(m.name)}<div class="person__who"><h2 class="person__name" tabindex="-1" data-role="title">${esc(m.name)}</h2>${metaHtml(m)}</div></div>
      <p class="small muted">${esc(t("coffee.matches.both", { round: L(m.roundTitle) }))}</p>
      <div class="contact">
        <div><p class="contact__label">${esc(t("coffee.matches.contact"))}</p><p class="contact__value">${esc(m.contactMethod || "—")}</p></div>
        ${m.contactMethod ? `<button type="button" class="btn btn--secondary btn--sm" data-act="copy">${icon("copy")}${esc(t("common.copy"))}</button>` : ""}
      </div>
      <div class="stack stack--s">
        <h3 class="eyebrow">${esc(t("coffee.matches.timeTitle"))}</h3>
        ${when}
      </div>
      ${outcome}
    </article>`;
  }

  /* ---------- 注册 ---------- */
  registerModule({
    id: "coffee",
    requiresAuth: true,
    requiresReady: true,
    nav: [
      { path: "coffee", icon: "coffee", labelKey: "nav.coffee", order: 10, mobile: true, when: isReady },
      { path: "coffee/browse", icon: "people", labelKey: "nav.browse", order: 20, mobile: true, when: isReady },
      { path: "coffee/inbox", icon: "inbox", labelKey: "nav.inbox", order: 30, mobile: true, when: isReady, badge: "inbox" },
      { path: "coffee/matches", icon: "sparkle", labelKey: "nav.matches", order: 40, mobile: true, when: isReady }
    ],
    badges,
    render(root, ctx) {
      switch (ctx.sub) {
        case "": return viewHome(root, ctx);
        case "browse": return viewBrowse(root, ctx);
        case "p": return viewPerson(root, ctx);
        case "times": return viewTimes(root, ctx);
        case "inbox": return viewInbox(root, ctx);
        case "matches": return viewMatches(root, ctx);
        default:
          root.innerHTML = YL.ui.emptyState("info", t("router.notFound"), `<a class="btn btn--primary" href="#/coffee">${esc(t("coffee.backHome"))}</a>`);
      }
    }
  });
})();
