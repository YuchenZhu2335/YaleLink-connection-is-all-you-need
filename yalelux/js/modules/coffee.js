/* 约咖啡（Coffee Chat）界面
   Coffee chat UI — the heart of Yalelux.

   路由 / routes
     #/coffee                                   本轮横幅 + 我的进度 + 为你推荐
     #/coffee/browse?identity&goal&interest&field   找人（按标签筛选池子）
     #/coffee/p/:id                             个人详情（公开答案 + 共同空闲时间）
     #/coffee/times                             选空闲时间（纽约时间，旁边显示北京时间）
     #/coffee/inbox?tab=sent                    收件箱：想认识你的人 / 我发出的（分段控件）
     #/coffee/matches                           匹配：成功页头、联系方式、一键约时间、见到了吗

   数据只走 YL.api（契约见 docs/api.md）；时间表与截止判断用 YL.domain.coffee（只做显示）。
   界面不自己判断权限：按钮由接口返回的 relation / canSchedule / canReport 决定。
   样式见 docs/design/components.md（关系状态四级阶梯、时段格、横幅、匹配页头），模块里不写样式。 */
(function () {
  "use strict";
  const { t, L, esc, icon, avatar } = YL.ui;
  const D = YL.domain.coffee;
  const isReady = () => YL.auth.isReady();

  // 本次会话内记住的小状态（只在内存里，不持久化）
  let backPath = "coffee/browse"; // 详情页"返回"回到哪个列表
  let filtersOpen = null;          // 找人页筛选区是否展开（null = 按屏幕宽度决定）
  let pendingFocus = null;         // 改筛选会重新渲染页面，渲染完把焦点还给刚点的那个标签
  let maxOpen = D.DEFAULT_ROUND.maxOpenInvites; // 本轮最多几个等待回复的邀请（拿到 /coffee/state 后更新）
  let slotMin = D.DEFAULT_ROUND.slotMinutes;     // 每次聊多久（同上）
  let draft = null;                // 选时间页还没保存的选择 { roundId, base, picks }：切语言、切页面回来还在
  let timesOpen = false;           // 当前（或刚才）显示的是选时间页
  let ownModal = null;             // 本模块打开的弹窗：换页时关掉，不让它浮在别的页面上
  let showBj = true;               // 选时间页"显示北京时间"开关（本次会话内记住）
  let limitHit = false;            // 这一页上发邀请被拒（too_many_open）：其余"想认识"显示"已达上限"。每次渲染重置
  const seenMatches = new Set();   // 本次会话里已经在匹配页头展示过的匹配：第一次展示才播放拱线动画

  // 只注册一次（不随每次渲染重复添加）
  window.addEventListener("yl:route", (e) => {
    const to = (e.detail && e.detail.path) || "";
    if (ownModal && ownModal.isConnected) YL.ui.closeModal();
    ownModal = null;
    if (to !== "coffee/times") document.body.classList.remove("has-savebar"); // 吸底保存条只在选时间页
    if (timesOpen && to !== "coffee/times") {
      timesOpen = false;
      if (draft) YL.ui.toast(t("coffee.times.draftKept"));
    }
  });
  window.addEventListener("beforeunload", (e) => { if (timesOpen && draft) { e.preventDefault(); e.returnValue = ""; } });
  function ownConfirm(text, opts) { const p = YL.ui.confirm(text, opts); ownModal = document.getElementById("modal"); return p; }

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
  // 每周轮的标题由后端固定写成"本周…"，周末报名的其实是下一周：每周轮用中性的名字，活动轮用后台填的标题
  const roundTitle = (r) => (r.kind === "weekly" ? t("coffee.round.weekly") : L(r.title));
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
  // 文案里的数字单独包一层（Newsreader 大数字）：t(key, { n: NUM }) 按占位符切开，各段 esc()
  const NUM = "\u0001";
  const numIn = (text, n, cls) => String(text).split(NUM).map(esc).join(`<strong class="${cls}">${esc(YL.ui.num(n))}</strong>`);

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
  // 共同兴趣：灯点由 CSS 画（tag--shared），不放图标
  const sharedTag = (label) => `<span class="tag tag--shared">${esc(label)}<span class="sr-only">${esc(t("coffee.person.sharedSr"))}</span></span>`;
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
  /* relation.state → 右下角的状态按钮（§5.4 四级明暗阶梯，见 docs/design/components.md）：
     none 想认识（海军蓝 + plus）→ invited 已邀请（透明虚线 + clock）→ incoming TA 想认识你 · 匹配（灯色 + arch）
     → matched 已匹配（苔绿链接，check … chevronRight）；no_reply 未回应（只读标签）；
     本页发邀请被拒（too_many_open）后，none 显示"已达上限"（aria-disabled，点击出 toast，原因见页面上的 #coffee-limit） */
  function relationHtml(p) {
    const r = p.relation || { state: "none" }, id = esc(p.id);
    if (r.state === "invited") return `<span class="btn btn--invited btn--sm" aria-disabled="true">${icon("clock")}${esc(t("coffee.rel.invited"))}<span class="sr-only">${esc(t("coffee.rel.invitedSr"))}</span></span>`;
    if (r.state === "incoming") return `<button type="button" class="btn btn--accent btn--sm" data-act="accept" data-id="${id}">${icon("arch")}${esc(t("coffee.rel.incoming"))}</button>`;
    if (r.state === "matched") return `<a class="btn btn--matched btn--sm" href="#/coffee/matches">${icon("check")}${esc(t("coffee.rel.matched"))}${icon("chevronRight")}</a>`;
    if (r.state === "no_reply") return `<span class="pill">${esc(t("coffee.rel.noReply"))}</span>`;
    if (limitHit) return `<button type="button" class="btn btn--primary btn--sm" data-act="limit" data-id="${id}" aria-disabled="true" aria-describedby="coffee-limit">${icon("info")}${esc(t("coffee.rel.limit", { n: maxOpen }))}</button>`;
    return `<button type="button" class="btn btn--primary btn--sm" data-act="invite" data-id="${id}">${icon("plus")}${esc(t("coffee.rel.invite"))}</button>`;
  }
  /* o = { rec, reasons, overlap（数字）, foot（左下角 html）, note, link（名字是否链到详情）, actions（覆盖右下角）, dismiss, after（卡片底部再加一行） } */
  function personHtml(p, o) {
    o = o || {};
    const intro = typeof (p.answers && p.answers.intro) === "string" ? p.answers.intro.trim() : "";
    const name = o.link === false
      ? `<p class="person__name">${esc(p.name)}</p>`
      : `<a class="person__name" href="#/coffee/p/${esc(encodeURIComponent(p.id))}">${esc(p.name)}</a>`;
    // 推荐理由前的灯点由 CSS 画（.reason::before），不放图标
    const reasons = (o.reasons || []).length
      ? `<ul class="person__reasons">${o.reasons.map((r) => `<li class="reason"><span>${esc(L(r))}</span></li>`).join("")}</ul>` : "";
    // 不感兴趣：右上角的 ×（icon-btn）
    const dismiss = o.dismiss && (!p.relation || p.relation.state === "none")
      ? `<button type="button" class="icon-btn" data-act="dismiss" data-id="${esc(p.id)}" aria-label="${esc(t("coffee.rec.dismissLabel", { name: p.name }))}">${icon("x")}</button>` : "";
    return `<article class="person${o.rec ? " person--rec" : ""}" data-person="${esc(p.id)}">
      <div class="person__head">${avatar(p.name)}<div class="person__who">${name}${metaHtml(p)}</div>${dismiss}</div>
      ${reasons}${tagsHtml(p)}
      ${intro ? `<p class="person__intro">${esc(intro)}</p>` : ""}
      ${o.note ? `<p class="person__note">${esc(o.note)}</p>` : ""}
      <div class="person__foot">${o.overlap != null ? overlapHtml(o.overlap) : o.foot || ""}<div class="person__actions">${o.actions != null ? o.actions : relationHtml(p)}</div></div>
      ${o.after || ""}
    </article>`;
  }

  /* ---------- 通用块 ---------- */
  function mount(root, cls) {
    root.innerHTML = `<section class="page${cls ? " " + cls : ""}"></section>`;
    return root.firstElementChild;
  }
  // 空状态（§5.11）：拱形图标框 + 标题 + 一句正文 + 最多一个操作
  function emptyBlock(iconName, title, body, actionHtml) {
    return `<div class="empty"><div class="empty__icon">${icon(iconName, { size: 28 })}</div>
      <p class="empty__title">${esc(title)}</p>${body ? `<p>${esc(body)}</p>` : ""}${actionHtml || ""}</div>`;
  }
  const retryBtn = (act) => `<button type="button" class="btn btn--primary" data-act="${act || "retry"}">${esc(t("common.retry"))}</button>`;
  const backHomeBtn = () => `<a class="btn btn--primary" href="#/coffee">${esc(t("coffee.backHome"))}</a>`;
  const browseBtn = () => `<a class="btn btn--primary" href="#/coffee/browse">${esc(t("coffee.rec.browse"))}</a>`;
  const timesBtn = (cls) => `<a class="btn btn--primary${cls ? " " + cls : ""}" href="#/coffee/times">${icon("clock")}${esc(t("coffee.join.cta"))}</a>`;
  // 出错时给一条走得通的路：资料不完整 → 去补资料；没有进行中的轮 → 回约咖啡首页；其他 → 重试
  function errorBlock(error, act) {
    const reason = error && error.reason;
    if (reason === "profile_incomplete") {
      YL.auth.refresh().catch(() => {}); // 让外壳的导航也知道要先补资料
      return emptyBlock("user", t("coffee.err.profile_incomplete"), "", `<a class="btn btn--primary" href="#/profile/setup?next=coffee">${esc(t("coffee.finishProfile"))}</a>`);
    }
    if (reason === "round_closed") return emptyBlock("coffee", t("coffee.err.round_closed"), "", act === "retry-recs" ? retryBtn("retry") : backHomeBtn());
    return emptyBlock("info", YL.ui.errorText(error, "coffee"), "", retryBtn(act));
  }
  const noticeHtml = (kind, iconName, bodyHtml, role) => `<div class="notice notice--${kind}"${role ? ` data-role="${esc(role)}"` : ""}>${icon(iconName)}<div class="notice__body">${bodyHtml}</div></div>`;
  // 还没参加这一轮（§10.3"先亮出自己，才能看到别人"）。cta = false：同一屏上面已经有"选空闲时间"了
  function joinBlock(cta) {
    return `<div data-role="join">${emptyBlock("clock", t("coffee.join.title"), t("coffee.join.body", { min: slotMin }), cta === false ? "" : timesBtn())}</div>`;
  }
  const noRound = (link) => emptyBlock("coffee", t("coffee.home.noRound"), t("coffee.home.noRoundBody"), link ? backHomeBtn() : "");
  // "已达上限"的说明（按钮 aria-describedby 指向它）：先放一个隐藏的空位，被拒时填上
  const limitSlot = () => `<div data-role="limit" id="coffee-limit" hidden></div>`;
  // 拿到 /coffee/state 后记下本轮的几个数字（弹窗、加入卡片里用）
  function rememberRound(round) {
    if (!round) return;
    maxOpen = round.maxOpenInvites || maxOpen;
    slotMin = round.slotMinutes || slotMin;
  }
  async function badges() {
    const r = await YL.api.get("/coffee/state");
    if (r.ok) YL.registry.setBadge("inbox", (r.data && r.data.incoming) || 0);
  }
  const refreshBadge = () => { badges().catch(() => {}); };

  /* ---------- 想认识 / 接受 / 跳过 / 不感兴趣（推荐、找人、详情、收件箱共用） ----------
     env = { ctx, page, people: Map(id → card), source: "rec" | "browse", draw(p) → html,
             onAccepted?(p), onRemoved?(id), onChanged?()（想认识你 / 匹配的数量可能变了）, reload?() } */
  const cardEl = (env, id) => env.page.querySelector(`[data-person="${CSS.escape(id)}"]`);
  // 一张卡上同时只处理一个操作：处理"想认识"时"跳过"也不能点（慢网络下误触会把已答应的邀请跳过）
  function setCardBusy(env, id, btn, on) {
    const card = cardEl(env, id);
    if (card) {
      if (on) card.dataset.busy = "1"; else delete card.dataset.busy;
      card.querySelectorAll("button[data-act]").forEach((b) => { b.disabled = !!on; });
    }
    YL.ui.busy(btn, on);
  }
  // 数量变了：首页刷新进度条和提示；其他页面只刷新角标（角标在外壳里，不受页面切换影响）
  const changed = (env) => { if (env.ctx.isActive() && env.onChanged) env.onChanged(); else refreshBadge(); };
  // 操作被拒（邀请过期、已回复、已匹配…）：向后端要这个人现在的关系，按钮跟着变，不留一个点了也没用的按钮
  async function syncRelation(env, p, reason) {
    const r = await YL.api.get("/coffee/people/" + encodeURIComponent(p.id));
    if (!env.ctx.isActive()) return;
    p.relation = r.ok && r.data && r.data.relation ? r.data.relation : { state: reason === "already_matched" ? "matched" : "none" };
    redraw(env, p);
  }
  function redraw(env, p, focus) {
    const old = cardEl(env, p.id);
    if (!old) return;
    old.outerHTML = env.draw(p);
    if (focus === false) return;
    const fresh = cardEl(env, p.id);
    const target = fresh && fresh.querySelector(".person__actions button, .person__actions a, a.person__name, [data-focus]");
    if (target) target.focus();
  }
  // 发邀请被拒（等待回复的邀请到上限）：页面上给一条 notice--warn，其余"想认识"都换成"已达上限"
  function applyLimit(env) {
    limitHit = true;
    const box = env.page.querySelector('[data-role="limit"]');
    if (box && box.hidden) {
      box.innerHTML = noticeHtml("warn", "alert", `<p><strong>${esc(t("coffee.limit.title", { n: maxOpen }))}</strong></p>
        <p>${esc(t("coffee.limit.body"))}</p>
        <div><a class="btn btn--secondary btn--sm" href="#/coffee/inbox?tab=sent">${esc(t("coffee.invite.seeSent"))}</a></div>`);
      box.hidden = false;
    }
    env.people.forEach((x) => { if (!x.relation || x.relation.state === "none") redraw(env, x, false); });
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
    else if (act === "limit") YL.ui.toast(t("coffee.rel.limitToast", { n: maxOpen })); // aria-disabled：留在 Tab 顺序里，点了说明原因
  }
  // 弹窗底部按钮（§5.13）：手机竖排、主操作在上；桌面横排靠右（沿用 confirm__actions）
  const modalActions = (cancelHtml, mainHtml) => `<div class="confirm__actions">${cancelHtml}${mainHtml}</div>`;
  function showMatched(name) {
    ownModal = YL.ui.modal(`<h2 class="modal__title" tabindex="-1" data-role="title">${esc(t("coffee.matched.title", { name }))}</h2>
      <div class="stack">
        ${noticeHtml("success", "check", `<p>${esc(t("coffee.matched.body"))}</p>`)}
        ${modalActions(`<button type="button" class="btn btn--ghost" data-close>${esc(t("coffee.matched.later"))}</button>`,
          `<a class="btn btn--primary" href="#/coffee/matches">${esc(t("coffee.matched.go"))}${icon("arrowRight")}</a>`)}
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
    ownModal = YL.ui.modal(`<h2 class="modal__title" tabindex="-1" data-role="title">${esc(t("coffee.invite.title", { name: p.name }))}</h2>
      <form class="form" novalidate>
        <div class="field" data-field="note">
          <label class="field__label" for="coffee-note">${esc(t("coffee.invite.noteLabel"))} <span class="faint">${esc(t("common.optional"))}</span></label>
          <textarea class="textarea" id="coffee-note" name="note" rows="3" maxlength="${max}" aria-describedby="coffee-note-count" placeholder="${esc(t("coffee.invite.notePh"))}"></textarea>
          <p class="field__count" id="coffee-note-count">0/${max}</p>
        </div>
        ${noticeHtml("info", "info", `<p>${esc(t("coffee.invite.ruleContact"))}</p><p>${esc(t("coffee.invite.ruleSkip"))}</p><p>${esc(t("coffee.invite.ruleExpire", { n: maxOpen }))}</p>`)}
        <div data-role="err" aria-live="assertive" hidden></div>
        ${modalActions(`<button type="button" class="btn btn--ghost" data-close>${esc(t("common.cancel"))}</button>`,
          `<button type="submit" class="btn btn--primary">${icon("plus")}${esc(t("coffee.invite.send"))}</button>`)}
      </form>`, {
      label: t("coffee.invite.title", { name: p.name }),
      onMount(panel, close) {
        const form = panel.querySelector("form"), note = form.elements.note, count = panel.querySelector("#coffee-note-count"), errBox = panel.querySelector('[data-role="err"]');
        panel.querySelector('[data-role="title"]').focus(); // 不自动聚焦输入框：手机上不要一打开就弹键盘
        note.addEventListener("input", () => { count.textContent = note.value.length + "/" + max; });
        panel.addEventListener("click", (e) => {
          if (e.target.closest("a[href]")) YL.ui.closeModal();
          else if (e.target.closest("[data-close]")) close();
        });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const btn = form.querySelector('[type="submit"]');
          YL.ui.clearFieldErrors(form);
          errBox.innerHTML = ""; errBox.hidden = true;
          YL.ui.busy(btn, true);
          const r = await YL.api.post("/coffee/invites", { toId: p.id, note: note.value.trim(), source: env.source });
          YL.ui.busy(btn, false);
          if (!ctx.isActive()) { YL.ui.closeModal(); if (r.ok && r.data.matched) refreshBadge(); return; }
          if (r.ok) {
            YL.ui.closeModal();
            p.relation = { state: r.data.matched ? "matched" : "invited", inviteId: r.data.id };
            redraw(env, p);
            if (r.data.matched) { changed(env); showMatched(p.name); } // 对方之前邀请过你：直接匹配，数量变了
            else YL.ui.toast(t("coffee.invite.sent", { name: p.name }), "success");
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
          if (reason === "too_many_open") {
            // 等待回复的邀请到上限：关掉弹层，这一页的"想认识"都换成"已达上限"，焦点留在这张卡的按钮上
            YL.ui.closeModal();
            applyLimit(env);
            const lb = cardEl(env, p.id) && cardEl(env, p.id).querySelector('[data-act="limit"]');
            if (lb) lb.focus();
            YL.ui.toast(t("coffee.rel.limitToast", { n: maxOpen }), "error");
            return;
          }
          errBox.innerHTML = noticeHtml("danger", "alertCircle", `<p>${esc(YL.ui.errorText(r.error, "coffee"))}</p>`);
          errBox.hidden = false;
        });
      }
    });
  }
  // 接受 / 跳过失败后的收尾：冲突（过期、已回复、已匹配）时按后端现在的状态重画，不留死按钮
  function afterRefused(btn, p, env, r) {
    setCardBusy(env, p.id, btn, false);
    YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error");
    if (r.error && r.error.code === "conflict") {
      if (env.reload) { env.reload(); return; } // 收件箱：整页重新加载（同时刷新角标）
      syncRelation(env, p, r.error.reason);
    }
    changed(env);
  }
  async function accept(btn, p, env) {
    const inviteId = p.inviteId || (p.relation && p.relation.inviteId);
    setCardBusy(env, p.id, btn, true);
    const r = await YL.api.post(`/coffee/invites/${encodeURIComponent(inviteId)}/accept`);
    if (!env.ctx.isActive()) { refreshBadge(); return; }
    if (!r.ok) { afterRefused(btn, p, env, r); return; }
    p.relation = { state: "matched", inviteId };
    if (env.onAccepted) env.onAccepted(p); else redraw(env, p);
    changed(env);
    showMatched(p.name);
  }
  async function skip(btn, p, env) {
    setCardBusy(env, p.id, btn, true);
    const r = await YL.api.post(`/coffee/invites/${encodeURIComponent(p.inviteId)}/skip`);
    if (!env.ctx.isActive()) { refreshBadge(); return; }
    if (!r.ok) { afterRefused(btn, p, env, r); return; }
    removeCard(env, p.id);
    changed(env);
    YL.ui.toast(t("coffee.inbox.skipped"));
  }
  async function dismiss(btn, p, env) {
    setCardBusy(env, p.id, btn, true);
    const r = await YL.api.post(`/coffee/recommendations/${encodeURIComponent(p.id)}/dismiss`);
    if (!env.ctx.isActive()) return;
    if (!r.ok) { setCardBusy(env, p.id, btn, false); YL.ui.toast(YL.ui.errorText(r.error, "coffee"), "error"); return; }
    removeCard(env, p.id);
    YL.ui.toast(t("coffee.rec.dismissed", { name: p.name }));
  }
  const bindRetry = (page) => page.addEventListener("click", (e) => { if (e.target.closest('[data-act="retry"]')) YL.router.render(); });
  function bindPeople(page, env, extra) {
    page.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || !page.contains(btn) || btn.disabled) return;
      if (btn.dataset.act === "retry") { YL.router.render(); return; }
      if (extra && extra(btn, e) === true) return;
      const card = btn.closest("[data-person]");
      if (card && card.dataset.busy) return;
      personAction(btn, env);
    });
  }

  /* ================= #/coffee 首页 ================= */
  async function viewHome(root, ctx) {
    backPath = "coffee";
    const page = mount(root);
    page.innerHTML = YL.ui.spinner();
    let st = null, seq = 0;
    // 接受 / 直接匹配之后：重新拿 /coffee/state，只换进度条和右侧提示（推荐列表保持不动）
    async function refreshStatus() {
      const n = ++seq;
      const s = await YL.api.get("/coffee/state");
      if (!s.ok || n !== seq) return;
      YL.registry.setBadge("inbox", s.data.incoming || 0); // 外壳里的角标，换页了也要更新
      if (!ctx.isActive() || !st || !s.data.round || s.data.round.id !== st.round.id) return;
      st = s.data;
      const bar = page.querySelector('[data-role="status"]');
      if (bar) bar.outerHTML = statusHtml(st);
      const aside = page.querySelector('[data-role="aside"]');
      if (aside) {
        aside.querySelectorAll('[data-role="notice-incoming"], [data-role="notice-matches"]').forEach((x) => x.remove());
        aside.insertAdjacentHTML("afterbegin", homeNotices(st));
      }
    }
    const env = {
      ctx, page, people: new Map(), source: "rec",
      draw: (p) => personHtml(p, { rec: true, reasons: p.reasons, overlap: list(p.overlap).length, dismiss: true }),
      onRemoved: () => { if (!env.people.size) { const box = page.querySelector('[data-role="recs-body"]'); if (box) box.innerHTML = recsEmpty(); } },
      onChanged: () => { refreshStatus().catch(() => {}); }
    };
    bindPeople(page, env, (btn) => { if (btn.dataset.act === "retry-recs") { loadRecs(env); return true; } return false; });

    const s = await YL.api.get("/coffee/state");
    if (!ctx.isActive()) return;
    if (!s.ok) { page.innerHTML = errorBlock(s.error); return; }
    st = s.data;
    YL.registry.setBadge("inbox", st.incoming || 0);
    if (!st.round) { page.innerHTML = noRound(); return; }
    rememberRound(st.round);
    page.innerHTML = homeHtml(st);
    fillProgress(page);
    if (st.joined) loadRecs(env);
  }
  const freeCount = (st) => openPicks(st.round, st.slots, st.locked).length;
  // 活动轮还没参加：横幅里已经有灯色的"参加"按钮，别处不再重复放"选空闲时间"
  const joinInBanner = (st) => st.round.kind === "event" && !st.joined;
  // 我的进度（§5.6）：三个数字；空闲时间为 0 时整条换成 notice--accent + "选空闲时间"
  function statusHtml(st) {
    const free = freeCount(st);
    if (!free) {
      return noticeHtml("accent", "arch", `<p>${esc(st.joined && list(st.slots).length ? t("coffee.status.noneOpen") : t("coffee.status.none"))}</p>
        ${joinInBanner(st) ? "" : `<div>${timesBtn("btn--sm")}</div>`}`, "status");
    }
    return `<nav class="statusbar" data-role="status" aria-label="${esc(t("coffee.status.label"))}">
      <a class="statusbar__item" href="#/coffee/times"><strong>${esc(YL.ui.num(free))}</strong><span>${esc(t("coffee.status.times"))}</span></a>
      <a class="statusbar__item" href="#/coffee/inbox"><strong>${esc(YL.ui.num(st.incoming))}</strong><span>${esc(t("coffee.status.incoming"))}</span></a>
      <a class="statusbar__item" href="#/coffee/matches"><strong>${esc(YL.ui.num(st.matches))}</strong><span>${esc(t("coffee.status.matches"))}</span></a>
    </nav>`;
  }
  function homeNotices(st) {
    return (st.incoming ? noticeHtml("accent", "arch", `<p><strong>${esc(st.incoming === 1 ? t("coffee.home.incomingOne") : t("coffee.home.incoming", { n: st.incoming }))}</strong></p>
        <div><a class="btn btn--secondary btn--sm" href="#/coffee/inbox">${esc(t("coffee.home.incomingCta"))}</a></div>`, "notice-incoming") : "")
      + (st.matches ? noticeHtml("success", "check", `<p><strong>${esc(st.matches === 1 ? t("coffee.home.matchesOne") : t("coffee.home.matches", { n: st.matches }))}</strong></p>
        <div><a class="btn btn--secondary btn--sm" href="#/coffee/matches">${esc(t("coffee.home.matchesCta"))}</a></div>`, "notice-matches") : "");
  }
  // 进度条的宽度是动态值：渲染后用 CSSOM 设置（模块的 HTML 里不写 style 属性）
  function fillProgress(scope) {
    scope.querySelectorAll(".progress > [data-pct]").forEach((el) => { el.style.width = el.dataset.pct + "%"; });
  }
  function homeHtml(st) {
    const r = st.round, ev = r.kind === "event", name = YL.auth.displayName();
    const upcoming = D.localDate(nowIso(), r.timezone) < r.startDate;
    // 下一周还没开始：已经参加的人只说"即将开始"，不再叫 TA "现在报名"
    const eyebrow = ev ? t("coffee.home.eyebrowEvent") : upcoming ? (st.joined ? t("coffee.home.eyebrowSoonJoined") : t("coffee.home.eyebrowSoon")) : t("coffee.home.eyebrowWeek");
    const hello = !st.joined ? t("coffee.home.hello", { name }) : st.recsEnabled === false ? t("coffee.home.helloLocked", { name }) : t("coffee.home.helloJoined", { name });
    const n = st.participants || 0, threshold = Number(r.poolThreshold) || 0;
    const themes = list(r.themeTags).map((x) => {
      const q = ["interests", "goals"].map(question).find((qq) => qq && (qq.options || []).some((o) => o.id === x));
      return `<span class="tag tag--theme">${esc(q ? optLabel(q.id, x) : x)}</span>`;
    }).join("");
    // 横幅按钮：活动轮还没参加 → 灯色"参加这次 Coffee Chat"（btn--accent 的两种用法之一）；已参加且有空闲时间 → 改时间
    const actions = (joinInBanner(st) ? `<a class="btn btn--accent" href="#/coffee/times">${esc(t("coffee.home.joinEvent"))}</a>` : "")
      + (st.joined && freeCount(st) ? `<a class="btn btn--secondary btn--sm" href="#/coffee/times">${icon("clock")}${esc(t("coffee.home.editTimes"))}</a>` : "")
      + (ev ? `<a class="btn btn--secondary btn--sm" href="#/events/${esc(encodeURIComponent(r.id))}">${esc(t("coffee.home.eventLink"))}${icon("arrowRight")}</a>` : "");
    // 人数不足、推荐还没开放：4px 进度条 + "14/20 人，满 20 人开放推荐"
    const warming = st.recsEnabled === false && threshold > 0 && n < threshold;
    const progress = warming ? `<div class="stack stack--s">
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(threshold)}" aria-valuenow="${esc(n)}" aria-label="${esc(t("coffee.home.warmLabel"))}"><span data-pct="${esc(Math.round((n / threshold) * 100))}"></span></div>
        <p class="xsmall muted">${esc(t("coffee.home.warm", { n, threshold }))}</p>
      </div>` : "";
    const steps = [["clock", t("coffee.how.s1"), t("coffee.how.s1d", { min: r.slotMinutes || slotMin, tz: tzName(r.timezone) })], ["plus", t("coffee.how.s2"), t("coffee.how.s2d")], ["coffee", t("coffee.how.s3"), t("coffee.how.s3d")]];
    return `<div class="split">
      <div class="stack stack--l">
        <section class="banner${ev ? " banner--event" : ""}">
          <p class="banner__eyebrow">${esc(eyebrow)}</p>
          <h1 class="banner__title">${esc(roundTitle(r))}</h1>
          <p>${esc(hello)}</p>
          ${themes ? `<div class="tags">${themes}</div>` : ""}
          <div class="banner__meta">
            <span>${icon("calendar")}${esc(rangeText(r))}</span>
            <span>${numIn(n === 1 ? t("coffee.home.participantsOne", { n: NUM }) : t("coffee.home.participants", { n: NUM }), n, "banner__stat")}</span>
          </div>
          ${progress}
          ${actions ? `<div class="banner__actions">${actions}</div>` : ""}
        </section>
        ${statusHtml(st)}
        <section class="stack" aria-label="${esc(t("coffee.rec.title"))}">
          ${YL.ui.sectionTitle(t("coffee.rec.title"), "", st.joined ? t("coffee.rec.sub") : "")}
          ${st.joined ? `${limitSlot()}<div class="stack" data-role="recs-body">${YL.ui.spinner()}</div>` : joinBlock(false)}
        </section>
      </div>
      <aside class="stack" data-role="aside">
        ${homeNotices(st)}
        <section class="card card--quiet">
          <h2 class="card__title">${esc(t("coffee.how.title"))}</h2>
          <ol class="list">${steps.map((s) => `<li class="list__item">${icon(s[0])}<div class="list__main"><p class="list__title">${esc(s[1])}</p><p class="list__sub">${esc(s[2])}</p></div></li>`).join("")}</ol>
        </section>
      </aside>
    </div>`;
  }
  const recsEmpty = () => emptyBlock("coffee", t("coffee.rec.empty"), t("coffee.rec.emptyBody"), browseBtn());
  async function loadRecs(env) {
    const box = env.page.querySelector('[data-role="recs-body"]');
    if (!box) return;
    box.innerHTML = YL.ui.spinner();
    const r = await YL.api.get("/coffee/recommendations");
    if (!env.ctx.isActive()) return;
    if (!r.ok) {
      if (r.error.reason === "not_joined") { box.outerHTML = joinBlock(); return; }
      box.innerHTML = errorBlock(r.error, "retry-recs");
      return;
    }
    const d = r.data;
    if (!d.enabled) {
      box.innerHTML = emptyBlock("people", t("coffee.rec.lockedTitle"), t("coffee.rec.locked", { threshold: d.threshold, n: d.participants }), browseBtn());
      return;
    }
    env.people = new Map(list(d.items).map((p) => [p.id, p]));
    if (!env.people.size) { box.innerHTML = recsEmpty(); return; }
    box.innerHTML = d.items.map(env.draw).join("")
      + (d.engine === "deepseek" ? `<p class="cluster xsmall faint">${icon("info", { size: 14 })}<span>${esc(t("coffee.rec.engineAi"))}</span></p>` : "")
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
      ${limitSlot()}
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
      if (reason === "not_joined") box.innerHTML = joinBlock();
      else if (reason === "browse_closed") box.innerHTML = emptyBlock("lock", t("coffee.err.browse_closed"), "", backHomeBtn());
      else box.innerHTML = errorBlock(r.error);
      return;
    }
    const items = list(r.data);
    env.people = new Map(items.map((p) => [p.id, p]));
    page.querySelector('[data-role="count"]').textContent = items.length === 1 ? t("coffee.browse.countOne") : t("coffee.browse.count", { n: items.length });
    box.innerHTML = items.length
      ? `<div class="grid-cards">${items.map(env.draw).join("")}</div>`
      : active
        ? emptyBlock("search", t("coffee.browse.emptyFiltered"), t("coffee.browse.emptyFilteredBody"), `<button type="button" class="btn btn--primary" data-act="clear">${esc(t("coffee.browse.clear"))}</button>`)
        : emptyBlock("people", t("coffee.browse.empty"), t("coffee.browse.emptyBody"), "");
  }

  /* ================= #/coffee/p/:id 个人详情 ================= */
  async function viewPerson(root, ctx) {
    const page = mount(root, "page--medium");
    const back = `<div><a class="btn btn--ghost btn--sm" href="#/${esc(backPath)}">${icon("chevronLeft")}${esc(t("common.back"))}</a></div>`;
    const notFound = () => back + emptyBlock("user", t("coffee.person.notFound"), t("coffee.person.notFoundBody"), browseBtn());
    if (!ctx.id) { page.innerHTML = notFound(); return; }
    page.innerHTML = back + YL.ui.spinner();
    const env = { ctx, page, people: new Map(), source: backPath === "coffee" ? "rec" : "browse", draw: null };
    bindPeople(page, env);
    const [r, s] = await Promise.all([YL.api.get("/coffee/people/" + encodeURIComponent(ctx.id)), YL.api.get("/coffee/state")]);
    if (!ctx.isActive()) return;
    if (!r.ok) {
      const reason = r.error && r.error.reason;
      page.innerHTML = reason === "not_joined" ? back + joinBlock() : r.error.code === "not_found" ? notFound() : back + errorBlock(r.error);
      return;
    }
    if (s.ok) rememberRound(s.data.round);
    const tz = (s.ok && s.data.round && s.data.round.timezone) || D.DEFAULT_ROUND.timezone;
    const p = r.data;
    env.people.set(p.id, p);
    env.draw = (x) => detailHtml(x, tz);
    page.innerHTML = back + limitSlot() + detailHtml(p, tz);
  }
  // 详情页的小标题用中性的 field__label（琥珀色眉题只留给"亮着"的东西，§1.3-1）
  function detailHtml(p, tz) {
    const a = p.answers || {};
    const blocks = YL.auth.questions().filter((q) => list(a[q.id]).some((v) => String(v).trim())).map((q) => {
      let body;
      if (q.type === "text") body = `<p>${esc(String(a[q.id]).trim())}</p>`;
      else if (q.id === "interests") body = `<div class="tags">${interestTags(a[q.id]).join("")}</div>`;
      else body = `<div class="tags">${list(a[q.id]).map((v) => `<span class="tag${q.id === "goals" ? " tag--goal" : ""}">${esc(optLabel(q.id, v))}</span>`).join("")}</div>`;
      return `<div class="stack stack--s"><h2 class="field__label">${esc(shortLabel(q))}</h2>${body}</div>`;
    }).join("");
    const overlap = list(p.overlap);
    return `<article class="person" data-person="${esc(p.id)}">
      <div class="person__head">${avatar(p.name, "lg")}<div class="person__who"><h1 class="person__name" tabindex="-1" data-focus>${esc(p.name)}</h1>${metaHtml(p)}</div></div>
      ${blocks}
      <div class="stack stack--s">
        <h2 class="field__label">${esc(t("coffee.person.timesTitle"))}</h2>
        ${overlap.length
          ? `<div class="times">${overlap.map((s) => `<span class="time">${esc(whenText(s))}<small>${esc(bjFull(tz, s))}</small></span>`).join("")}</div>
             <p class="small faint">${esc(t("coffee.person.timesHint", { tz: tzName(tz) }))}</p>`
          : `<p class="small muted">${esc(t("coffee.person.timesNone"))}</p>`}
      </div>
      <div class="person__foot">${overlapHtml(overlap.length)}<div class="person__actions">${relationHtml(p)}</div></div>
    </article>`;
  }

  /* ================= #/coffee/times 选空闲时间 ================= */
  async function viewTimes(root, ctx) {
    timesOpen = true;
    document.body.classList.remove("has-savebar");
    const page = mount(root, "page--medium");
    page.innerHTML = YL.ui.spinner();
    const s = await YL.api.get("/coffee/state");
    if (!ctx.isActive()) return;
    if (!s.ok) { page.innerHTML = errorBlock(s.error); bindRetry(page); return; }
    const st = s.data;
    if (!st.round) { page.innerHTML = noRound(true); return; }
    rememberRound(st.round);
    const round = st.round, tz = round.timezone, dates = D.roundDates(round), times = D.slotTimes(round), allIds = D.slotIds(round);
    const closedNow = () => { const at = nowIso(); return new Set(allIds.filter((x) => D.isClosed(round, x, at))); };
    const today = D.localDate(nowIso(), tz);
    let closed = closedNow();
    let locked = new Set(list(st.locked));
    let saved = list(st.slots).slice().sort();
    let joined = !!st.joined, left = false;
    let flashTimer = null; // 保存后按钮上显示"已保存"的 2 秒
    const picked = new Set(saved);
    // 切语言 / 切到别的页面再回来：接着显示还没保存的选择（服务器上的已保存时间没变才接着用）
    if (draft && draft.roundId === round.id && draft.base === saved.join(",")) {
      picked.clear();
      draft.picks.filter((x) => allIds.indexOf(x) >= 0).forEach((x) => picked.add(x));
    } else draft = null;
    const openIn = (d) => times.map((tm) => d + "T" + tm).filter((x) => !closed.has(x) && !locked.has(x));
    const anyOpen = () => dates.some((d) => openIn(d).length);
    let day = dates.find((d) => openIn(d).length) || dates[0];

    // §5.5 顺序：时区说明（一行 + 显示北京时间开关）→ 图例 → 日期条 → 格子 → 吸底保存条
    page.innerHTML = `<header class="page-head"><div class="page-head__text">
        <p class="eyebrow">${esc(roundTitle(round))} · ${esc(rangeText(round))}</p>
        <h1 class="page-title">${esc(t("coffee.times.title"))}</h1>
        <p class="page-sub">${esc(t("coffee.times.sub", { min: round.slotMinutes || slotMin, h: round.cutoffHours }))}</p>
      </div></header>
      ${noticeHtml("accent", "arch", `<p data-role="hint-text"></p>`, "hint")}
      ${noticeHtml("warn", "alert", `<p>${esc(t("coffee.times.allClosed"))}</p>`, "all-closed")}
      <div class="slots">
        <div class="slots__tz cluster--between">
          <span>${esc(t("coffee.times.tz", { tz: tzName(tz) }))}</span>
          <label class="switch"><span class="switch__text"><span>${esc(t("coffee.times.showBj"))}</span></span><input type="checkbox" role="switch" data-role="bj"${showBj ? " checked" : ""}><span class="switch__track"></span></label>
        </div>
        <div class="slot-legend">
          <span><i></i>${esc(t("coffee.times.legendOpen"))}</span>
          <span><i class="is-selected"></i>${esc(t("coffee.times.legendPicked"))}</span>
          <span><i class="is-locked"></i>${esc(t("coffee.times.legendLocked"))}</span>
          <span><i class="is-closed"></i>${esc(t("coffee.times.legendClosed"))}</span>
        </div>
        <div class="slots__days" role="group" aria-label="${esc(t("coffee.times.days"))}">
          ${dates.map((d) => `<button type="button" class="day" data-act="day" data-date="${esc(d)}">
            <span class="day__wd">${esc(d === today ? t("coffee.times.today") : weekday(d))}</span><span class="day__d">${esc(md(d))}</span><span class="day__dots" aria-hidden="true"></span><span class="sr-only" data-role="day-sr"></span></button>`).join("")}
        </div>
        <div class="cluster cluster--between">
          <h2 class="section-title" id="coffee-day-title" data-role="day-title"></h2>
          <div class="cluster">
            <button type="button" class="btn btn--secondary btn--sm" data-act="day-all">${esc(t("coffee.times.dayAll"))}</button>
            <button type="button" class="btn btn--ghost btn--sm" data-act="day-clear">${esc(t("coffee.times.dayClear"))}</button>
          </div>
        </div>
        <div class="slots__grid" role="group" aria-labelledby="coffee-day-title" data-role="grid"></div>
      </div>
      <div class="savebar">
        <div class="savebar__count"><p data-role="count" aria-live="polite"></p><p class="xsmall faint" data-role="unsaved" hidden>${esc(t("coffee.times.unsaved"))}</p></div>
        <button type="button" class="btn btn--primary btn--sm" data-act="save" disabled>${esc(t("common.save"))}</button>
      </div>`;
    document.body.classList.add("has-savebar"); // 老内核不支持 :has()：toast 靠这个 class 让开保存条

    const grid = page.querySelector('[data-role="grid"]');
    const saveBtn = page.querySelector('[data-act="save"]');
    const dirty = () => { const now = Array.from(picked).sort(); return now.length !== saved.length || now.some((x, i) => x !== saved[i]); };
    // 记下没保存的选择（模块级变量，只在本次会话内存里）
    const syncDraft = () => { draft = dirty() ? { roundId: round.id, base: saved.join(","), picks: Array.from(picked) } : null; };
    // 已约定 / 已截止：aria-disabled 留在 Tab 顺序里，点了用 toast 说明（§5.5）；已截止的第二行写"已截止"
    function slotHtml(id) {
      const tm = timeOf(id), bj = showBj ? `<small>${esc(bjShort(tz, id))}</small>` : "";
      if (locked.has(id)) return `<button type="button" class="slot is-locked" data-act="slot" data-slot="${esc(id)}" aria-disabled="true" aria-pressed="true">${esc(tm)}${bj}<span class="sr-only"> ${esc(t("coffee.times.legendLocked"))}</span></button>`;
      if (closed.has(id)) return `<button type="button" class="slot is-closed" data-act="slot" data-slot="${esc(id)}" aria-disabled="true">${esc(tm)}<small>${esc(t("coffee.times.legendClosed"))}</small></button>`;
      return `<button type="button" class="slot" data-act="slot" data-slot="${esc(id)}" aria-pressed="${picked.has(id)}">${esc(tm)}${bj}</button>`;
    }
    // 顶部提示：还没加入 → 怎么加入；刚退出 → 怎么回来；时间全截止 → 下一轮再来
    function drawHints() {
      const open = anyOpen();
      const hint = page.querySelector('[data-role="hint"]');
      hint.hidden = joined || !open;
      page.querySelector('[data-role="hint-text"]').textContent = left ? t("coffee.times.leftHint") : t("coffee.times.joinHint");
      page.querySelector('[data-role="all-closed"]').hidden = open;
    }
    // 日期条：日期下方最多 3 个小点表示这天选了几个，读屏读"已选 3 个"
    function drawDays() {
      page.querySelectorAll(".day").forEach((b) => {
        const d = b.dataset.date, n = times.filter((tm) => picked.has(d + "T" + tm) || locked.has(d + "T" + tm)).length, on = d === day;
        b.disabled = !on && !openIn(d).length && !times.some((tm) => locked.has(d + "T" + tm));
        b.classList.toggle("is-active", on);
        b.classList.toggle("has-picks", n > 0);
        b.setAttribute("aria-pressed", String(on));
        b.querySelector(".day__dots").innerHTML = "<i></i>".repeat(Math.min(3, n));
        b.querySelector('[data-role="day-sr"]').textContent = n ? " " + t("coffee.times.dayPicked", { n }) : "";
      });
      const open = openIn(day);
      page.querySelector('[data-act="day-all"]').disabled = !open.length || open.every((x) => picked.has(x));
      page.querySelector('[data-act="day-clear"]').disabled = !open.some((x) => picked.has(x));
    }
    const openCount = () => openPicks(round, Array.from(new Set(Array.from(picked).concat(Array.from(locked)))), Array.from(locked)).length;
    // 保存条：已选 N 个（Newsreader 数字）；有改动时第二行"有改动，还没保存"；没有改动时"保存"不可点
    function drawCount() {
      const n = openCount(), d = dirty();
      page.querySelector('[data-role="count"]').innerHTML = numIn(n === 1 ? t("coffee.times.countOne", { n: NUM }) : t("coffee.times.count", { n: NUM }), n, "savebar__num");
      page.querySelector('[data-role="unsaved"]').hidden = !d;
      if (saveBtn.classList.contains("is-busy")) return;
      if (d && flashTimer) { clearTimeout(flashTimer); flashTimer = null; saveBtn.textContent = t("common.save"); }
      saveBtn.disabled = !d;
    }
    function drawGrid() {
      page.querySelector('[data-role="day-title"]').textContent = dayLabel(day);
      grid.innerHTML = times.map((tm) => slotHtml(day + "T" + tm)).join("");
    }
    const drawAll = () => { drawHints(); drawGrid(); drawDays(); drawCount(); };
    drawAll();

    // 保存成功：按钮 2 秒内显示勾和"已保存"
    function flashSaved() {
      clearTimeout(flashTimer);
      saveBtn.innerHTML = icon("check") + esc(t("common.saved"));
      flashTimer = setTimeout(() => { flashTimer = null; if (saveBtn.isConnected && !dirty()) saveBtn.textContent = t("common.save"); }, 2000);
    }
    async function save(btn) {
      closed = closedNow(); // 页面开着的时候可能又过了几个截止时间
      if (!joined && !Array.from(picked).some((x) => !closed.has(x))) { drawAll(); YL.ui.toast(t("coffee.times.pickOne"), "error"); return; }
      // 全部清空、又没有已约定的时间 = 退出这一轮：先确认
      if (joined && !picked.size && !locked.size) {
        const ok = await ownConfirm(t("coffee.times.leaveConfirm"), { danger: true, ok: t("coffee.times.leaveOk"), cancel: t("coffee.times.leaveKeep") });
        if (!ctx.isActive()) return;
        if (!ok) { btn.focus(); return; }
      }
      YL.ui.busy(btn, true);
      const r = await YL.api.post("/coffee/availability", { slots: Array.from(picked) });
      if (!ctx.isActive()) return;
      YL.ui.busy(btn, false);
      if (!r.ok) {
        const f = r.error && r.error.fields && r.error.fields.slots;
        if (f === "invalid") { draft = null; YL.ui.toast(t("coffee.times.stale"), "error"); YL.router.render(); return; } // 轮次换了：重新载入
        YL.ui.toast(f === "required" ? t("coffee.times.pickOne") : YL.ui.errorText(r.error, "coffee"), "error");
        drawAll();
        return;
      }
      const was = joined;
      saved = list(r.data.slots).slice().sort();
      picked.clear(); saved.forEach((x) => picked.add(x));
      locked = new Set(list(r.data.locked));
      draft = null;
      joined = r.data.joined !== false;
      if (!joined) { left = was; drawAll(); YL.ui.toast(t("coffee.times.left")); return; }
      const n = openCount();
      YL.ui.toast(n === 1 ? t("coffee.times.savedOne", { n }) : t("coffee.times.saved", { n }), "success");
      if (!was) { YL.router.navigate("coffee"); return; } // 刚加入：回首页看推荐
      drawAll();
      flashSaved();
    }

    page.addEventListener("change", (e) => {
      if (!e.target.matches('[data-role="bj"]')) return;
      showBj = e.target.checked; // 只在本次会话内记住
      drawGrid();
    });
    page.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || !page.contains(btn) || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === "slot") {
        if (btn.getAttribute("aria-disabled") === "true") {
          YL.ui.toast(btn.classList.contains("is-locked") ? t("coffee.times.lockedToast") : t("coffee.times.closedToast", { h: round.cutoffHours }));
          return;
        }
        const id = btn.dataset.slot;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        btn.setAttribute("aria-pressed", String(picked.has(id)));
        syncDraft(); drawDays(); drawCount();
      } else if (act === "day") {
        day = btn.dataset.date;
        drawGrid(); drawDays();
      } else if (act === "day-all" || act === "day-clear") {
        openIn(day).forEach((x) => { if (act === "day-all") picked.add(x); else picked.delete(x); });
        syncDraft(); drawGrid(); drawDays(); drawCount();
        // 刚点的按钮会变成不可用：焦点交给旁边那个，或者这天的第一个格子
        const other = page.querySelector(`[data-act="${act === "day-all" ? "day-clear" : "day-all"}"]`);
        const target = [btn, other].find((b) => b && !b.disabled) || grid.querySelector('.slot:not([aria-disabled="true"])');
        if (target) target.focus();
      } else if (act === "save") {
        save(btn).catch((err) => { console.error(err); YL.ui.busy(btn, false); drawCount(); });
      }
    });
  }

  /* ================= #/coffee/inbox 收件箱 ================= */
  // 分段控件（§5.8）：想认识你的人 / 我发出的（英文 Incoming / Sent），用链接切换，前进后退都能用
  async function viewInbox(root, ctx) {
    const tab = ctx.query.tab === "sent" ? "sent" : "incoming";
    backPath = "coffee/inbox" + (tab === "sent" ? "?tab=sent" : "");
    const page = mount(root, "page--medium");
    page.innerHTML = YL.ui.spinner();
    let roundId = null;
    const linkable = (p) => !!roundId && p.roundId === roundId && p.inRound !== false; // 详情页只能看本轮、并且还在这一轮里的人
    const sentAt = (p) => `<span class="person__overlap">${icon("mail")}${esc(t("coffee.inbox.sentAt", { date: YL.ui.formatDate(p.createdAt) }))}</span>`;
    // 想认识你的人：两个一样宽的按钮（想认识 / 跳过），下面一行"跳过不会通知对方"（§5.4）
    const env = {
      ctx, page, people: new Map(), source: "browse",
      draw: (p) => personHtml(p, {
        link: linkable(p), note: p.note, foot: sentAt(p),
        actions: `<button type="button" class="btn btn--primary btn--sm" data-act="accept" data-id="${esc(p.id)}">${icon("plus")}${esc(t("coffee.inbox.accept"))}</button>
          <button type="button" class="btn btn--secondary btn--sm" data-act="skip" data-id="${esc(p.id)}">${esc(t("coffee.inbox.skip"))}</button>`,
        after: `<p class="xsmall faint">${esc(t("coffee.inbox.ruleSkip"))}</p>`
      }),
      onAccepted: (p) => removeCard(env, p.id),
      onRemoved: () => {
        const n = env.people.size, badge = page.querySelector('[data-role="inc-count"]');
        if (badge) { if (n) badge.textContent = YL.ui.num(n); else badge.remove(); }
        const listEl = page.querySelector('[data-role="incoming"]');
        if (listEl && !listEl.querySelector("[data-person]")) listEl.outerHTML = incomingEmpty();
      },
      reload: () => load()
    };
    // 我发出的：状态是"已邀请"那一级（透明虚线 + 时钟），写"等待回复"
    const outHtml = (p) => personHtml(p, {
      link: linkable(p), foot: sentAt(p),
      actions: `<span class="btn btn--invited btn--sm" aria-disabled="true">${icon("clock")}${esc(t("coffee.inbox.waiting"))}</span>`
    });
    const incomingEmpty = () => `<div data-role="incoming-empty">${emptyBlock("inbox", t("coffee.inbox.incomingEmpty"), t("coffee.inbox.incomingEmptyBody"), timesBtn())}</div>`;
    const segItem = (id, href, label, badge) => `<a class="segmented__item${tab === id ? " is-active" : ""}"${tab === id ? ' aria-current="page"' : ""} href="${href}">${esc(label)}${badge}</a>`;
    bindPeople(page, env);

    async function load() {
      const [r, s] = await Promise.all([YL.api.get("/coffee/inbox"), YL.api.get("/coffee/state")]);
      if (!ctx.isActive()) return;
      if (!r.ok) { page.innerHTML = errorBlock(r.error); return; }
      const round = s.ok ? s.data.round : null;
      roundId = round ? round.id : null;
      if (s.ok) YL.registry.setBadge("inbox", s.data.incoming || 0);
      rememberRound(round);
      const max = maxOpen;
      const inc = list(r.data.incoming), out = list(r.data.outgoing);
      env.people = new Map(inc.map((p) => [p.id, p]));
      const panel = tab === "incoming"
        ? `<section class="stack" aria-label="${esc(t("coffee.inbox.incoming"))}">
            <p class="small muted">${esc(t("coffee.inbox.incomingSub"))}</p>
            ${inc.length ? `<div class="grid-cards" data-role="incoming">${inc.map(env.draw).join("")}</div>` : incomingEmpty()}
          </section>`
        : `<section class="stack" aria-label="${esc(t("coffee.inbox.outgoing"))}">
            <p class="small muted">${esc(t("coffee.inbox.outgoingSub", { n: out.length, max }))}</p>
            ${out.length ? `<div class="grid-cards">${out.map(outHtml).join("")}</div>`
              : emptyBlock("message", t("coffee.inbox.outgoingEmpty"), t("coffee.inbox.outgoingEmptyBody"), browseBtn())}
          </section>`;
      page.innerHTML = `<header class="page-head"><div class="page-head__text">
          <p class="eyebrow">${esc(t("coffee.inbox.eyebrow"))}</p>
          <h1 class="page-title">${esc(t("coffee.inbox.title"))}</h1>
          <p class="page-sub">${esc(t("coffee.inbox.sub"))}</p>
        </div></header>
        <div class="stack">
          <nav class="segmented" aria-label="${esc(t("coffee.inbox.title"))}">
            ${segItem("incoming", "#/coffee/inbox", t("coffee.inbox.tabIncoming"), inc.length ? `<span class="count" data-role="inc-count">${esc(YL.ui.num(inc.length))}</span>` : "")}
            ${segItem("sent", "#/coffee/inbox?tab=sent", t("coffee.inbox.tabSent"), out.length ? `<span class="count count--neutral">${esc(YL.ui.num(out.length))}</span>` : "")}
          </nav>
          ${panel}
        </div>`;
    }
    await load();
  }

  /* ================= #/coffee/matches 匹配 ================= */
  async function viewMatches(root, ctx) {
    const page = mount(root, "page--medium");
    // 有匹配时页头换成 §5.17 的夜色页头（最新的一个匹配）；没有时用普通页头 + 空状态
    const headHtml = () => `<header class="page-head"><div class="page-head__text">
        <p class="eyebrow">${esc(t("coffee.matches.eyebrow"))}</p>
        <h1 class="page-title">${esc(t("coffee.matches.title"))}</h1>
        <p class="page-sub">${esc(t("coffee.matches.sub"))}</p>
      </div></header>`;
    page.innerHTML = `<div class="stack stack--l" data-role="list"><h1 class="sr-only">${esc(t("coffee.matches.title"))}</h1>${YL.ui.spinner()}</div>`;
    const box = page.querySelector('[data-role="list"]');
    const expanded = new Set(); // 正在"改时间"的匹配
    let items = [];

    async function load(focusId) {
      const r = await YL.api.get("/coffee/matches");
      if (!ctx.isActive()) return;
      if (!r.ok) { box.innerHTML = headHtml() + errorBlock(r.error); return; }
      items = list(r.data); // 后端按匹配时间倒序：第一个是最新的
      box.innerHTML = items.length
        ? `<h1 class="sr-only">${esc(t("coffee.matches.title"))}</h1>${heroHtml(items[0], items.length)}
           <div class="stack">${items.map((m) => matchHtml(m, expanded.has(m.matchId))).join("")}</div>`
        : headHtml() + emptyBlock("arch", t("coffee.matches.empty"), t("coffee.matches.emptyBody"), browseBtn());
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
        const ok = await ownConfirm(t("coffee.matches.cancelConfirm"), { danger: true, ok: t("coffee.matches.cancelOk"), cancel: t("coffee.matches.keep") });
        if (!ctx.isActive()) return;
        if (!ok) { btn.focus(); return; }
        card.dataset.busy = "1"; YL.ui.busy(btn, true);
        r = await YL.api.post(`/coffee/matches/${encodeURIComponent(id)}/schedule`, { slot: null });
        if (!ctx.isActive()) return;
        if (r.ok) { expanded.delete(id); YL.ui.toast(t("coffee.matches.canceledToast")); }
      } else if (act === "outcome") {
        card.dataset.busy = "1"; YL.ui.busy(btn, true);
        r = await YL.api.post(`/coffee/matches/${encodeURIComponent(id)}/outcome`, { met: btn.dataset.met === "clear" ? null : btn.dataset.met === "1" });
        if (!ctx.isActive()) return;
        if (r.ok) YL.ui.toast(myAnswer(m) ? t("coffee.outcome.updated") : t("coffee.outcome.thanks"), "success");
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
  /* §5.17 匹配成功页头：夜色块，两个一样大的拱形头像（我 + 最新匹配的人），中间的拱线和灯点由 CSS 画。
     本次会话里第一次展示这个匹配时加 is-new（拱线画出来、灯亮起；减弱动效时直接是最终状态） */
  function heroHtml(m, total) {
    const me = YL.auth.displayName(), fresh = !seenMatches.has(m.matchId);
    seenMatches.add(m.matchId);
    return `<header class="match-hero${fresh ? " is-new" : ""}">
      <div class="match-hero__pair">
        <div class="match-hero__person">${avatar(me, "lg")}<span title="${esc(me)}">${esc(me)}</span></div>
        <div class="match-hero__person">${avatar(m.name, "lg")}<span title="${esc(m.name)}">${esc(m.name)}</span></div>
      </div>
      <h2 class="match-hero__title">${esc(t("coffee.matches.heroTitle"))}</h2>
      <p class="match-hero__sub">${esc(total > 1 ? t("coffee.matches.heroSubMore", { name: m.name, n: total }) : t("coffee.matches.heroSub", { name: m.name }))}</p>
    </header>`;
  }
  // 每周轮的 id 是 "week-<周一日期>"（见 domain 的 weekStarting）：用日期称呼，不用后端写死的"本周…"
  function matchRound(m) {
    const wk = /^week-(\d{4}-\d{2}-\d{2})$/.exec(String(m.roundId || ""));
    return wk ? t("coffee.round.weeklyOf", { range: md(wk[1]) + "–" + md(D.addDays(wk[1], 6)) }) : L(m.roundTitle);
  }
  // 我对"见到了吗"的回答。没约时间的匹配网页上不说"没见到"（§4.4.6 第 8 条）："其实还没聊"会撤回回答（met: null）；
  // 万一有没约时间却记成 missed 的（直接调接口），也按还没回答显示，可以再点"我们聊过了"
  const myAnswer = (m) => (m.myOutcome === "missed" && !m.slot ? null : m.myOutcome || null);
  function matchHtml(m, expanded) {
    const tz = m.timezone || D.DEFAULT_ROUND.timezone, mid = esc(m.matchId);
    const timeBtn = (s, sel) => `<button type="button" class="time${sel ? " is-selected" : ""}" data-act="schedule" data-slot="${esc(s)}" aria-pressed="${!!sel}">${esc(whenText(s))}<small>${esc(bjFull(tz, s))}</small></button>`;
    const avail = list(m.available);
    const metAlready = m.myOutcome === "met"; // 已经说见过了：不再提供约时间
    let when;
    if (m.slot) {
      const who = m.scheduledBy === "me" ? t("coffee.matches.byMe") : m.scheduledBy === "them" ? t("coffee.matches.byThem") : "";
      // 约好的时间：已约定样式（海军蓝 + 锁），只读
      when = `<div class="times"><span class="time is-selected">${esc(t("coffee.matches.scheduled", { when: whenText(m.slot), tz: tzName(tz) }))}<small>${esc(bjFull(tz, m.slot))}</small></span></div>
        ${who ? `<p class="small muted">${esc(who)}</p>` : ""}`;
      if (m.canSchedule && !metAlready) {
        when += `<div class="cluster">
            <button type="button" class="btn btn--secondary btn--sm" data-act="change" aria-expanded="${!!expanded}" aria-controls="coffee-chg-${mid}">${icon("edit")}${esc(t("coffee.matches.change"))}</button>
            <button type="button" class="btn btn--danger-ghost btn--sm" data-act="unschedule">${esc(t("coffee.matches.cancel"))}</button>
          </div>
          <div class="stack stack--s" id="coffee-chg-${mid}" data-role="change"${expanded ? "" : " hidden"}>
            ${avail.length ? `<p class="small muted">${esc(t("coffee.matches.pickHint"))}</p><div class="times">${[m.slot].concat(avail).sort().map((s) => timeBtn(s, s === m.slot)).join("")}</div>`
              : `<p class="small muted">${esc(t("coffee.matches.noOther"))}</p>`}
          </div>`;
      }
    } else if (metAlready) {
      when = "";
    } else if (avail.length) {
      when = `<p class="small">${esc(t("coffee.matches.pickHint"))}</p><div class="times">${avail.map((s) => timeBtn(s, false)).join("")}</div>`;
    } else if (m.canSchedule) {
      when = noticeHtml("info", "info", `<p><strong>${esc(t("coffee.matches.noCommon"))}</strong></p><p>${esc(t("coffee.matches.noCommonBody"))}</p>
        <div><a class="btn btn--secondary btn--sm" href="#/coffee/times">${icon("clock")}${esc(t("coffee.home.editTimes"))}</a></div>`);
    } else {
      when = `<p class="small faint">${esc(t("coffee.matches.roundOver"))}</p>`;
    }
    let outcome = "";
    if (myAnswer(m)) {
      // 答过之后（§5.17）：见到了 → notice--success；没见到 → 中性的 notice--info。
      // 后端允许改答案（recordOutcome 覆盖）：还能回答时（canReport）给一个小按钮，直接改成另一个答案
      const change = !m.canReport ? ""
        : !m.slot ? ["clear", t("coffee.outcome.notYet")] // 撤回回答（met: null），不记成"没见到"
        : metAlready ? ["0", t("coffee.outcome.changeToNo")] : ["1", t("coffee.outcome.changeToYes")];
      outcome = noticeHtml(metAlready ? "success" : "info", metAlready ? "check" : "info",
        `<p><strong>${esc(metAlready ? t("coffee.outcome.met") : t("coffee.outcome.missed"))}</strong></p><p>${esc(t("coffee.outcome.recorded"))}</p>
        ${change ? `<p><button type="button" class="link-btn" data-act="outcome" data-met="${change[0]}">${esc(change[1])}</button></p>` : ""}`);
    } else if (m.canReport && m.slot) {
      // 约定的时间已经开始：问见到了没有（见到了 = primary，没见到 = secondary）
      outcome = `<div class="person__foot"><span class="small">${esc(t("coffee.outcome.ask"))}</span>
        <div class="person__actions">
          <button type="button" class="btn btn--primary btn--sm" data-act="outcome" data-met="1">${icon("check")}${esc(t("coffee.outcome.yes"))}</button>
          <button type="button" class="btn btn--secondary btn--sm" data-act="outcome" data-met="0">${esc(t("coffee.outcome.no"))}</button>
        </div></div>`;
    } else if (m.canReport) {
      // 还没约时间（可能私下约了）：只给一个低调的"我们聊过了"，不问"没见到"——刚匹配时"还没"不等于"没见到"
      outcome = `<div class="person__foot"><span class="small faint">${esc(t("coffee.outcome.askEarly"))}</span>
        <div class="person__actions"><button type="button" class="btn btn--ghost btn--sm" data-act="outcome" data-met="1">${icon("check")}${esc(t("coffee.outcome.already"))}</button></div></div>`;
    }
    return `<article class="person" data-match="${mid}">
      <div class="person__head">${avatar(m.name)}<div class="person__who"><h2 class="person__name" tabindex="-1" data-role="title">${esc(m.name)}</h2>${metaHtml(m)}</div></div>
      <p class="small muted">${esc(t("coffee.matches.both", { round: matchRound(m) }))}</p>
      <div class="contact">
        <div><p class="contact__label">${esc(t("coffee.matches.contact"))}</p><p class="contact__value">${esc(m.contactMethod || "—")}</p></div>
        ${m.contactMethod ? `<button type="button" class="btn btn--secondary btn--sm" data-act="copy">${icon("copy")}${esc(t("common.copy"))}</button>` : ""}
      </div>
      ${when ? `<div class="stack stack--s">
        <h3 class="field__label">${esc(t("coffee.matches.timeTitle"))}</h3>
        ${when}
      </div>` : ""}
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
      { path: "coffee/matches", icon: "arch", labelKey: "nav.matches", order: 40, mobile: true, when: isReady }
    ],
    badges,
    render(root, ctx) {
      limitHit = false; // "已达上限"只在被拒的那一页上显示；换页后下一次邀请再由后端判断
      switch (ctx.sub) {
        case "": return viewHome(root, ctx);
        case "browse": return viewBrowse(root, ctx);
        case "p": return viewPerson(root, ctx);
        case "times": return viewTimes(root, ctx);
        case "inbox": return viewInbox(root, ctx);
        case "matches": return viewMatches(root, ctx);
        default:
          root.innerHTML = emptyBlock("info", t("router.notFound"), "", backHomeBtn());
      }
    }
  });
})();
