/* ACSSY 学联后台：活动项目看板 / SOP 库 / 联系人 / 沟通模板 / 志愿者 + "我想办活动"工作流向导
   ACSSY console: campaign board / playbooks / contacts / templates / volunteers + the "host an event" wizard */
(function () {
  const TABS = [
    { id: "board", icon: "📋", labelKey: "acssy.tab.board" },
    { id: "sop", icon: "📚", labelKey: "acssy.tab.sop" },
    { id: "contacts", icon: "📇", labelKey: "acssy.tab.contacts" },
    { id: "templates", icon: "✉️", labelKey: "acssy.tab.templates" },
    { id: "volunteers", icon: "🙋", labelKey: "acssy.tab.volunteers" }
  ];
  const STATUS = ["todo", "doing", "done"];
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const acssyMembers = () => YL.store.get("users").filter((u) => u.acssy);
  const isMine = (id) => id === "me";
  function progress(c) { const n = c.tasks.length; const d = c.tasks.filter((t) => t.status === "done").length; return { n, d, pct: n ? Math.round((d / n) * 100) : 0 }; }
  function statusBadge(s) { const cls = s === "done" ? "badge--green" : s === "doing" ? "" : "badge--muted"; return `<span class="badge ${cls}">${YL.ui.t("task." + s)}</span>`; }

  /* ---------- "我想办活动" 向导 ---------- */
  function openWizard(opts) {
    opts = opts || {};
    const { t, esc, L, $, $$ } = YL.ui;
    if (!YL.auth.requireLogin()) return;
    const me = YL.auth.user().profile || {};
    const canAcssy = YL.auth.isAcssy();
    const state = { step: 1, scope: opts.scope || (canAcssy ? "acssy" : "community"), playbookId: opts.playbookId || "pb-gala", circleId: opts.circleId || "", region: opts.region || me.region || "" };
    const playbooks = YL.store.get("playbooks");
    const wrap = YL.ui.modal("");
    const panel = wrap.querySelector(".modal__panel");
    const steps = () => `<div class="steps">${[1, 2, 3].map((i) => `<span class="${i <= state.step ? "is-done" : ""}"></span>`).join("")}</div>`;
    const draw = () => {
      const closeBtn = `<button class="modal__close" aria-label="close">✕</button>`;
      if (state.step === 1) {
        panel.innerHTML = `${closeBtn}<h2>${t("wizard.title")}</h2>${steps()}<p class="muted small">${t("wizard.step1")}</p>
          <div class="stack">
            <button class="match-box ${state.scope === "community" ? "is-active" : ""}" data-scope="community" style="text-align:left;font:inherit;cursor:pointer"><div style="font-size:1.4rem">🍻</div><div class="card__title">${t("wizard.community")}</div><div class="muted small">${t("wizard.communitySub")}</div></button>
            <button class="match-box ${state.scope === "acssy" ? "is-active" : ""}" data-scope="acssy" style="text-align:left;font:inherit;cursor:pointer" ${canAcssy ? "" : "disabled"}><div style="font-size:1.4rem">🏛️</div><div class="card__title">${t("wizard.acssy")}</div><div class="muted small">${canAcssy ? t("wizard.acssySub") : t("wizard.acssyLocked")}</div></button>
          </div>
          <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn btn--primary" id="w-next">${t("common.next")} →</button></div>`;
        $$("[data-scope]", panel).forEach((b) => (b.onclick = () => { if (!b.disabled) { state.scope = b.dataset.scope; draw(); } }));
        $("#w-next", panel).onclick = () => { state.step = state.scope === "acssy" ? 2 : 3; draw(); };
      } else if (state.step === 2) {
        const pb = playbooks.find((p) => p.id === state.playbookId) || playbooks[0];
        const nTasks = pb.phases.reduce((s, ph) => s + ph.tasks.length, 0);
        panel.innerHTML = `${closeBtn}<h2>${t("wizard.title")}</h2>${steps()}<p class="muted small">${t("wizard.step2")}</p>
          <div class="chips">${playbooks.map((p) => `<button class="chip ${p.id === pb.id ? "is-active" : ""}" data-pb="${p.id}">${p.emoji} ${esc(L(p.title))}</button>`).join("")}</div>
          <div class="card card--flat"><div class="card__title">${pb.emoji} ${esc(L(pb.title))}</div><div class="card__meta"><span>${esc(L(pb.scale))}</span><span>⏱ ${esc(L(pb.leadTime))}</span><span>✅ ${t("wizard.tasksGenerated", { n: nTasks })}</span></div><div class="card__body">${esc(L(pb.summary))}</div>
            <ul class="small muted" style="margin:10px 0 0;padding-left:18px">${pb.keyPoints.slice(0, 3).map((k) => `<li>${esc(L(k))}</li>`).join("")}</ul></div>
          <div class="row" style="margin-top:16px;justify-content:space-between"><button class="btn btn--ghost" id="w-back">← ${t("common.back")}</button><button class="btn btn--primary" id="w-next">${t("common.next")} →</button></div>`;
        $$("[data-pb]", panel).forEach((b) => (b.onclick = () => { state.playbookId = b.dataset.pb; draw(); }));
        $("#w-back", panel).onclick = () => { state.step = 1; draw(); };
        $("#w-next", panel).onclick = () => { state.step = 3; draw(); };
      } else {
        const pb = state.scope === "acssy" ? playbooks.find((p) => p.id === state.playbookId) : null;
        const circles = YL.store.get("circles");
        panel.innerHTML = `${closeBtn}<h2>${t("wizard.title")}</h2>${steps()}<p class="muted small">${t("wizard.step3")}</p>
          ${pb ? `<div class="callout callout--info" style="margin-bottom:12px">📚 ${t("wizard.usingPlaybook", { name: esc(L(pb.title)) })}</div>` : `<div class="callout callout--green" style="margin-bottom:12px">🍻 ${t("wizard.lightweightNote")}</div>`}
          <form id="w-form">
            <div class="field"><label>${t("events.name")}</label><input class="input" name="title" required></div>
            <div class="form-row"><div class="field"><label>${t("events.date")}</label><input class="input" name="date" type="date" required min="${today()}"></div><div class="field"><label>${t("events.time")}</label><input class="input" name="time" placeholder="19:00 – 21:00" required></div></div>
            <div class="form-row"><div class="field"><label>${t("profile.region")}</label><select class="select" name="region">${YL.store.get("regions").map((r) => `<option value="${r.id}" ${state.region === r.id ? "selected" : ""}>${r.emoji} ${esc(L(r.name))}</option>`).join("")}</select></div><div class="field"><label>${t("events.type")}</label><select class="select" name="type">${YL.store.terms("eventTypes").map((x) => `<option value="${x.id}" ${(pb ? pb.category : "meetup") === x.id ? "selected" : ""}>${x.emoji} ${esc(L(x.label))}</option>`).join("")}</select></div></div>
            <div class="form-row"><div class="field"><label>${t("events.venue")}</label><input class="input" name="venue" required></div><div class="field"><label>${t("wizard.circle")}</label><select class="select" name="circleId"><option value="">${t("wizard.noCircle")}</option>${circles.map((c) => `<option value="${c.id}" ${state.circleId === c.id ? "selected" : ""}>${c.emoji} ${esc(L(c.name))}</option>`).join("")}</select></div></div>
            <div class="field"><label>${t("post.body")}</label><textarea class="textarea" name="description" required></textarea></div>
            <div class="field"><label>${t("events.capacityLabel")}</label><input class="input" name="capacity" type="number" min="1" placeholder="20"></div>
            <div class="row" style="justify-content:space-between"><button type="button" class="btn btn--ghost" id="w-back">← ${t("common.back")}</button><button class="btn btn--primary">${pb ? t("wizard.createProject") : t("events.publish")}</button></div>
          </form>`;
        $("#w-back", panel).onclick = () => { state.step = state.scope === "acssy" ? 2 : 1; draw(); };
        $("#w-form", panel).onsubmit = (ev) => {
          ev.preventDefault();
          const v = YL.ui.formValues(ev.target);
          const event = YL.store.add("events", { title: v.title, type: v.type, region: v.region, date: v.date, time: v.time, venue: v.venue, hostId: "me", hostOrg: pb ? { zh: "耶鲁中国学生学者联合会", en: "ACSSY" } : { zh: "校友自发", en: "Alumni-organized" }, description: v.description, capacity: Number(v.capacity) || 0, going: 0, tags: [], circleId: v.circleId || null });
          YL.store.setState("rsvp", event.id, true);
          if (pb) {
            let i = 0;
            const tasks = [];
            pb.phases.forEach((ph) => ph.tasks.forEach((tk) => tasks.push({ id: `${event.id}-${++i}`, phase: ph.id, title: tk.title, role: tk.role, assigneeId: null, due: addDays(v.date, tk.days), status: "todo", updates: [] })));
            const c = YL.store.add("campaigns", { name: v.title, eventId: event.id, playbookId: pb.id, leadId: "me", department: me.department || "events", status: "planning", date: v.date, memberIds: ["me"], tasks, volunteerRoles: [], notices: [{ at: today(), by: "me", text: t("wizard.firstNotice", { name: L(pb.title) }) }] });
            YL.store.patch("events", event.id, { campaignId: c.id });
            YL.ui.closeModal(); YL.ui.toast(t("wizard.projectCreated", { n: tasks.length }), "success");
            YL.router.navigate("acssy/board/" + c.id);
          } else {
            YL.ui.closeModal(); YL.ui.toast(t("events.created"), "success");
            YL.router.navigate("events/e/" + event.id);
          }
        };
      }
      panel.querySelector(".modal__close").onclick = YL.ui.closeModal;
    };
    draw();
  }

  /* ---------- 模块 ---------- */
  registerModule({
    id: "acssy",
    nav: { icon: "🏛️", labelKey: "nav.acssy", order: 65, mobile: false, when: () => YL.auth.isAcssy() },
    requiresAuth: true,
    descriptionKey: "about.module.acssy",
    render(root, ctx) {
      const { t, esc, L, $, $$, avatar, tags, chips, sectionTitle, formatDate } = YL.ui;
      if (!YL.auth.isAcssy()) {
        root.innerHTML = `<div class="auth"><div class="card" style="text-align:center"><div style="font-size:2.4rem">🏛️</div><h2 style="margin:8px 0">${t("acssy.gateTitle")}</h2><p class="muted">${t("acssy.gateBody")}</p><a class="btn btn--primary" href="#/login/profile?next=acssy">${t("acssy.gateAction")}</a><p class="notice">${t("acssy.gateNote")}</p></div></div>`;
        return;
      }
      const sub = ctx.sub || "board";
      const isLead = YL.auth.isAcssyLead();
      const me = YL.auth.user().profile;
      const head = `<div class="page-head"><div class="row row--between"><div><h1>${t("acssy.title")}</h1><p>${t("acssy.intro")}</p></div><button class="btn btn--primary" id="btn-wizard">＋ ${t("wizard.cta")}</button></div><div class="row" style="margin-top:8px"><span class="badge badge--green">${t("profile.acssy." + YL.auth.acssyRole())}</span><span class="badge">${t("dept." + (me.department || "events"))}</span></div></div>${YL.ui.tabs(TABS, sub, "#/acssy")}`;
      const bindWizard = () => { const b = $("#btn-wizard"); if (b) b.onclick = () => openWizard(); };

      /* ---- 看板：项目详情 ---- */
      if (sub === "board" && ctx.id) {
        const draw = () => {
          const c = YL.store.find("campaigns", ctx.id);
          if (!c) { root.innerHTML = YL.ui.emptyState("📋", t("common.noResults"), `<a class="btn" href="#/acssy/board">${t("common.back")}</a>`); return; }
          const pb = YL.store.find("playbooks", c.playbookId);
          const ev = c.eventId ? YL.store.find("events", c.eventId) : null;
          const lead = YL.store.user(c.leadId);
          const pr = progress(c);
          const phases = pb ? pb.phases : [{ id: "all", name: { zh: "任务", en: "Tasks" } }];
          const members = (c.memberIds || []).map((id) => YL.store.user(id)).filter(Boolean);
          const assignable = [YL.store.user("me")].concat(acssyMembers()).filter((u, i, a) => u && a.findIndex((x) => x.id === u.id) === i);
          const canManage = isLead || isMine(c.leadId);
          const tdy = today();
          const taskRow = (tk) => {
            const a = tk.assigneeId ? YL.store.user(tk.assigneeId) : null;
            const overdue = tk.status !== "done" && tk.due < tdy;
            return `<div class="list-row" style="align-items:flex-start;flex-wrap:wrap">
              <div class="list-row__main"><div class="row"><span class="list-row__title">${esc(L(tk.title))}</span>${statusBadge(tk.status)}${overdue ? `<span class="badge badge--warn">${t("task.overdue")}</span>` : ""}</div>
                <div class="list-row__sub row"><span>📅 ${formatDate(tk.due)}</span><span>${t("dept." + tk.role)}</span>${a ? `<span class="row">${avatar(a.name, "xs")} ${esc(L(a.name))}</span>` : `<span class="muted">${t("task.unassigned")}</span>`}${tk.updates && tk.updates.length ? `<span>💬 ${tk.updates.length}</span>` : ""}</div>
                ${tk.updates && tk.updates.length ? `<div class="small muted" style="margin-top:4px;border-left:2px solid var(--border);padding-left:8px">${esc(formatDate(tk.updates[tk.updates.length - 1].at))} · ${esc(L(tk.updates[tk.updates.length - 1].text))}</div>` : ""}</div>
              <div class="row" style="gap:6px">
                <select class="select" style="width:auto;padding:4px 8px;font-size:.8rem" data-status="${tk.id}">${STATUS.map((s) => `<option value="${s}" ${tk.status === s ? "selected" : ""}>${t("task." + s)}</option>`).join("")}</select>
                ${!tk.assigneeId ? `<button class="btn btn--sm btn--primary" data-claim="${tk.id}">${t("task.claim")}</button>` : ""}
                ${canManage ? `<select class="select" style="width:auto;padding:4px 8px;font-size:.8rem" data-assign="${tk.id}"><option value="">${t("task.assign")}</option>${assignable.map((u) => `<option value="${u.id}" ${tk.assigneeId === u.id ? "selected" : ""}>${esc(L(u.name))}</option>`).join("")}</select>` : ""}
                <button class="btn btn--sm btn--ghost" data-update="${tk.id}">${t("task.report")}</button>
              </div></div>`;
          };
          root.innerHTML = `<a class="muted small" href="#/acssy/board">← ${t("common.back")}</a>
            <div class="two-col" style="margin-top:12px"><div class="stack">
              <div class="card"><div class="row" style="margin-bottom:6px"><span class="badge ${c.status === "done" ? "badge--green" : c.status === "active" ? "" : "badge--warn"}">${t("campaign." + c.status)}</span><span class="badge badge--muted">${t("dept." + c.department)}</span>${pb ? `<a class="tag" href="#/acssy/sop/${pb.id}">📚 ${esc(L(pb.title))}</a>` : ""}</div>
                <h1 style="font-size:1.4rem">${esc(L(c.name))}</h1>
                <div class="card__meta" style="margin-top:6px"><span>🗓️ ${formatDate(c.date)}</span>${lead ? `<span class="row">${avatar(lead.name, "xs")} ${t("campaign.lead")}: <strong>${esc(L(lead.name))}</strong></span>` : ""}${ev ? `<a href="#/events/e/${ev.id}">🔗 ${t("campaign.eventPage")}</a>` : ""}</div>
                <div class="row row--between" style="margin-top:12px"><span class="small muted">${t("campaign.progress", { d: pr.d, n: pr.n })}</span><strong>${pr.pct}%</strong></div><div class="progress" style="margin-top:6px"><i style="width:${pr.pct}%"></i></div>
                <div class="row" style="margin-top:12px">${members.map((m) => `<span class="row small" title="${esc(L(m.name))}">${avatar(m.name, "sm")}</span>`).join("")}<span class="muted small">${t("campaign.members", { n: members.length })}</span></div></div>
              ${phases.map((ph) => { const list = c.tasks.filter((tk) => ph.id === "all" || tk.phase === ph.id); if (!list.length) return ""; return `<section>${sectionTitle(`${esc(L(ph.name))}`, `<span class="muted small">${ph.timing ? esc(L(ph.timing)) : ""} · ${list.filter((x) => x.status === "done").length}/${list.length}</span>`)}<div class="list">${list.map(taskRow).join("")}</div></section>`; }).join("")}
              ${canManage ? `<button class="btn btn--ghost" id="btn-addtask">＋ ${t("task.add")}</button>` : ""}
            </div><div class="stack">
              <div class="card"><div class="row row--between"><div class="card__title">📣 ${t("campaign.notices")}</div><button class="btn btn--sm btn--ghost" id="btn-notice">＋</button></div><div class="stack" style="margin-top:8px">${(c.notices || []).length ? c.notices.map((n) => { const by = YL.store.user(n.by); return `<div class="small"><div class="muted">${formatDate(n.at)}${by ? " · " + esc(L(by.name)) : ""}</div>${esc(L(n.text))}</div>`; }).join("") : `<span class="muted small">—</span>`}</div></div>
              <div class="card"><div class="card__title">🙋 ${t("acssy.tab.volunteers")}</div>${(c.volunteerRoles || []).length ? `<div class="stack" style="margin-top:8px">${c.volunteerRoles.map((r) => { const on = YL.store.getState("volunteer", c.id + ":" + r.id); return `<div class="row row--between small"><span><strong>${esc(L(r.role))}</strong> <span class="muted">${esc(L(r.shift))}</span></span><span class="badge ${r.filled + (on ? 1 : 0) >= r.count ? "badge--green" : "badge--warn"}">${r.filled + (on ? 1 : 0)}/${r.count}</span></div>`; }).join("")}</div><a class="btn btn--sm btn--ghost" style="margin-top:10px" href="#/acssy/volunteers">${t("common.view")}</a>` : `<p class="muted small" style="margin-top:6px">${t("campaign.noVolunteers")}</p>${canManage ? `<button class="btn btn--sm btn--ghost" id="btn-addrole">＋ ${t("campaign.addRole")}</button>` : ""}`}</div>
              ${pb ? `<div class="card card--primary"><div class="card__title">💡 ${t("acssy.keyPoints")}</div><ul class="small" style="padding-left:18px;margin:8px 0 0;opacity:.9">${pb.keyPoints.slice(0, 3).map((k) => `<li>${esc(L(k))}</li>`).join("")}</ul><a href="#/acssy/sop/${pb.id}" class="small">${t("common.viewAll")} →</a></div>` : ""}
            </div></div>`;
          const saveTasks = (tasks) => { YL.store.patch("campaigns", c.id, { tasks }); draw(); };
          $$("[data-status]").forEach((s) => (s.onchange = () => saveTasks(c.tasks.map((tk) => tk.id === s.dataset.status ? Object.assign({}, tk, { status: s.value }) : tk))));
          $$("[data-claim]").forEach((b) => (b.onclick = () => { saveTasks(c.tasks.map((tk) => tk.id === b.dataset.claim ? Object.assign({}, tk, { assigneeId: "me", status: tk.status === "todo" ? "doing" : tk.status }) : tk)); YL.ui.toast(t("task.claimed"), "success"); }));
          $$("[data-assign]").forEach((s) => (s.onchange = () => { if (!s.value) return; saveTasks(c.tasks.map((tk) => tk.id === s.dataset.assign ? Object.assign({}, tk, { assigneeId: s.value }) : tk)); }));
          $$("[data-update]").forEach((b) => (b.onclick = () => {
            const tk = c.tasks.find((x) => x.id === b.dataset.update);
            YL.ui.modal(`<h2>${t("task.report")}</h2><p class="muted small">${esc(L(tk.title))}</p>${(tk.updates || []).map((u) => { const by = YL.store.user(u.by); return `<div class="small" style="margin-bottom:8px"><div class="muted">${formatDate(u.at)}${by ? " · " + esc(L(by.name)) : ""}</div>${esc(L(u.text))}</div>`; }).join("")}<form id="f-up"><div class="field"><textarea class="textarea" name="text" required placeholder="${t("task.reportPh")}"></textarea></div><div class="row"><select class="select" name="status" style="width:auto">${STATUS.map((s) => `<option value="${s}" ${tk.status === s ? "selected" : ""}>${t("task." + s)}</option>`).join("")}</select><button class="btn btn--primary">${t("common.submit")}</button></div></form>`, { onMount(panel) { $("#f-up", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.ui.closeModal(); saveTasks(c.tasks.map((x) => x.id === tk.id ? Object.assign({}, x, { status: v.status, updates: (x.updates || []).concat([{ at: today(), by: "me", text: v.text }]) }) : x)); YL.ui.toast(t("task.reported"), "success"); }; } });
          }));
          const at = $("#btn-addtask"); if (at) at.onclick = () => YL.ui.modal(`<h2>${t("task.add")}</h2><form id="f-task"><div class="field"><label>${t("post.title")}</label><input class="input" name="title" required></div><div class="form-row"><div class="field"><label>${t("campaign.phase")}</label><select class="select" name="phase">${phases.map((p) => `<option value="${p.id}">${esc(L(p.name))}</option>`).join("")}</select></div><div class="field"><label>${t("events.date")}</label><input class="input" type="date" name="due" required value="${c.date}"></div></div><div class="field"><label>${t("profile.department")}</label><select class="select" name="role">${YL_CONFIG.acssyDepartments.map((d) => `<option value="${d}">${t("dept." + d)}</option>`).join("")}</select></div><button class="btn btn--primary btn--block">${t("common.create")}</button></form>`, { onMount(panel) { $("#f-task", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.ui.closeModal(); saveTasks(c.tasks.concat([{ id: c.id + "-" + Date.now().toString(36), phase: v.phase, title: v.title, role: v.role, assigneeId: null, due: v.due, status: "todo", updates: [] }])); }; } });
          $("#btn-notice").onclick = () => YL.ui.modal(`<h2>📣 ${t("campaign.notices")}</h2><form id="f-notice"><div class="field"><textarea class="textarea" name="text" required placeholder="${t("campaign.noticePh")}"></textarea></div><button class="btn btn--primary btn--block">${t("common.submit")}</button></form>`, { onMount(panel) { $("#f-notice", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.ui.closeModal(); YL.store.patch("campaigns", c.id, { notices: [{ at: today(), by: "me", text: v.text }].concat(c.notices || []) }); YL.ui.toast(t("campaign.noticeSent"), "success"); draw(); }; } });
          const ar = $("#btn-addrole"); if (ar) ar.onclick = () => YL.ui.modal(`<h2>${t("campaign.addRole")}</h2><form id="f-role"><div class="form-row"><div class="field"><label>${t("campaign.roleName")}</label><input class="input" name="role" required></div><div class="field"><label>${t("campaign.roleCount")}</label><input class="input" type="number" name="count" min="1" value="4" required></div></div><div class="field"><label>${t("campaign.roleShift")}</label><input class="input" name="shift" placeholder="18:00–21:00"></div><button class="btn btn--primary btn--block">${t("common.create")}</button></form>`, { onMount(panel) { $("#f-role", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.ui.closeModal(); YL.store.patch("campaigns", c.id, { volunteerRoles: (c.volunteerRoles || []).concat([{ id: "r" + Date.now().toString(36), role: v.role, count: Number(v.count), filled: 0, shift: v.shift }]) }); draw(); }; } });
        };
        draw(); return;
      }

      /* ---- 看板：列表 ---- */
      if (sub === "board") {
        const cs = YL.store.get("campaigns").slice().sort((a, b) => (a.status === "done") - (b.status === "done") || a.date.localeCompare(b.date));
        const myTasks = []; cs.forEach((c) => c.tasks.forEach((tk) => { if (tk.assigneeId === "me" && tk.status !== "done") myTasks.push({ c, tk }); }));
        const open = cs.filter((c) => c.status !== "done").reduce((s, c) => s + c.tasks.filter((tk) => !tk.assigneeId && tk.status !== "done").length, 0);
        root.innerHTML = head + `
          <div class="stats section">${YL.ui.stat(cs.filter((c) => c.status !== "done").length, t("acssy.stat.active"))}${YL.ui.stat(myTasks.length, t("acssy.stat.myTasks"))}${YL.ui.stat(open, t("acssy.stat.unassigned"))}${YL.ui.stat(YL.store.get("playbooks").length, t("acssy.stat.playbooks"))}</div>
          ${myTasks.length ? `<section class="section">${sectionTitle(t("acssy.myTasks"))}<div class="list">${myTasks.map(({ c, tk }) => `<a class="list-row card--hover" href="#/acssy/board/${c.id}"><div class="list-row__main"><div class="list-row__title">${esc(L(tk.title))}</div><div class="list-row__sub">${esc(L(c.name))} · 📅 ${formatDate(tk.due)}</div></div>${statusBadge(tk.status)}</a>`).join("")}</div></section>` : `<div class="callout callout--info" style="margin-bottom:20px">👋 ${t("acssy.noMyTasks")}</div>`}
          ${sectionTitle(t("acssy.campaigns"))}
          <div class="grid grid-2">${cs.map((c) => { const pr = progress(c); const lead = YL.store.user(c.leadId); const pb = YL.store.find("playbooks", c.playbookId); const unassigned = c.tasks.filter((tk) => !tk.assigneeId && tk.status !== "done").length; return `
            <a class="card card--hover" href="#/acssy/board/${c.id}"><div class="row row--between" style="margin-bottom:6px"><span class="badge ${c.status === "done" ? "badge--green" : c.status === "active" ? "" : "badge--warn"}">${t("campaign." + c.status)}</span><span class="muted small">🗓️ ${formatDate(c.date)}</span></div>
              <div class="card__title">${pb ? pb.emoji + " " : ""}${esc(L(c.name))}</div><div class="card__meta"><span>${t("dept." + c.department)}</span>${lead ? `<span class="row">${avatar(lead.name, "xs")} ${esc(L(lead.name))}</span>` : ""}<span>👥 ${(c.memberIds || []).length}</span></div>
              <div class="row row--between" style="margin-top:10px"><span class="small muted">${t("campaign.progress", { d: pr.d, n: pr.n })}${unassigned ? ` · <span style="color:var(--warn)">${t("campaign.unassignedN", { n: unassigned })}</span>` : ""}</span><strong class="small">${pr.pct}%</strong></div><div class="progress" style="margin-top:6px"><i style="width:${pr.pct}%"></i></div></a>`; }).join("")}</div>`;
        bindWizard(); return;
      }

      /* ---- SOP 详情 ---- */
      if (sub === "sop" && ctx.id) {
        const pb = YL.store.find("playbooks", ctx.id);
        if (!pb) { root.innerHTML = YL.ui.emptyState("📚", t("common.noResults"), `<a class="btn" href="#/acssy/sop">${t("common.back")}</a>`); return; }
        const m = YL.store.user(pb.maintainerId);
        const kindIcon = { doc: "📄", sheet: "📊", design: "🎨", form: "📝" };
        root.innerHTML = `<a class="muted small" href="#/acssy/sop">← ${t("common.back")}</a>
          <div class="two-col" style="margin-top:12px"><div class="stack">
            <div class="card"><div class="row" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("eventTypes", pb.category).label, "tag--accent")}<span class="muted small">${esc(L(pb.scale))} · ⏱ ${esc(L(pb.leadTime))}</span></div><h1 style="font-size:1.4rem">${pb.emoji} ${esc(L(pb.title))}</h1><p class="muted" style="margin-top:6px">${esc(L(pb.summary))}</p>
              <div class="row" style="margin-top:12px"><button class="btn btn--primary" id="btn-use">🚀 ${t("sop.useThis")}</button>${m ? `<span class="row small muted">${avatar(m.name, "xs")} ${t("sop.maintainer")}: ${esc(L(m.name))}</span>` : ""}</div></div>
            <div class="card card--primary"><div class="card__title">💡 ${t("acssy.keyPoints")}</div><ol style="padding-left:20px;margin:8px 0 0;opacity:.95">${pb.keyPoints.map((k) => `<li style="margin-bottom:6px">${esc(L(k))}</li>`).join("")}</ol></div>
            <section class="card"><h2 style="margin-bottom:12px">${t("sop.phases")}</h2><ol class="timeline">${pb.phases.map((ph) => `<li><div class="timeline__when">${esc(L(ph.timing))}</div><div class="timeline__title">${esc(L(ph.name))}</div><ul class="small muted" style="padding-left:18px;margin:4px 0 0">${ph.tasks.map((tk) => `<li>${esc(L(tk.title))} <span class="tag tag--muted" style="font-size:.68rem">${t("dept." + tk.role)}</span></li>`).join("")}</ul></li>`).join("")}</ol></section>
            ${pb.history.length ? `<section class="card"><h2 style="margin-bottom:12px">${t("sop.history")}</h2><div class="stack">${pb.history.map((h) => `<div class="list-row"><div class="date-box"><strong>${h.year}</strong><span>${h.attendance}👥</span></div><div class="list-row__main"><div class="list-row__title">${esc(L(h.name))}</div><div class="list-row__sub">${esc(L(h.notes))}</div></div></div>`).join("")}</div></section>` : ""}
          </div><div class="stack">
            <div class="card"><div class="card__title">📎 ${t("sop.materials")}</div>${pb.materials.length ? `<div class="stack" style="margin-top:8px">${pb.materials.map((x) => `<div class="row small">${kindIcon[x.kind] || "📎"} ${YL.ui.safeUrl(x.link) ? `<a href="${YL.ui.safeUrl(x.link)}" target="_blank" rel="noopener">${esc(L(x.name))}</a>` : `<span>${esc(L(x.name))}</span> <span class="badge badge--muted">${t("sop.linkPending")}</span>`}</div>`).join("")}</div>` : `<p class="muted small" style="margin-top:6px">—</p>`}</div>
            <div class="card"><div class="card__title">✉️ ${t("acssy.tab.templates")}</div><div class="stack" style="margin-top:8px">${pb.templateIds.map((id) => { const x = YL.store.find("templates", id); return x ? `<a class="small" href="#/acssy/templates?open=${x.id}">${YL.store.term("templateKinds", x.kind).emoji} ${esc(L(x.name))}</a>` : ""; }).join("")}</div></div>
            <div class="card"><div class="card__title">📇 ${t("acssy.tab.contacts")}</div><div class="stack" style="margin-top:8px">${pb.contactIds.map((id) => { const k = YL.store.find("contacts", id); return k ? `<a class="small" href="#/acssy/contacts?kind=${k.kind}">${YL.store.term("contactKinds", k.kind).emoji} ${esc(L(k.name))}</a>` : ""; }).join("")}</div></div>
            <div class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">${t("sop.editNote")}</div><a class="btn btn--ghost btn--sm" style="margin-top:8px" href="${YL_CONFIG.github}/blob/main/web/data/playbooks.json" target="_blank" rel="noopener">${t("common.suggestEdit")}</a></div>
          </div></div>`;
        $("#btn-use").onclick = () => openWizard({ scope: "acssy", playbookId: pb.id });
        return;
      }

      /* ---- SOP 列表 ---- */
      if (sub === "sop") {
        const pbs = YL.store.get("playbooks");
        root.innerHTML = head + `<p class="muted small">${t("sop.intro")}</p><div class="grid grid-2">${pbs.map((pb) => { const m = YL.store.user(pb.maintainerId); const n = pb.phases.reduce((s, ph) => s + ph.tasks.length, 0); return `<a class="card card--hover" href="#/acssy/sop/${pb.id}"><div class="row row--between" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("eventTypes", pb.category).label, "tag--accent")}<span class="muted small">${esc(L(pb.scale))}</span></div><div class="card__title">${pb.emoji} ${esc(L(pb.title))}</div><div class="card__body clamp-2">${esc(L(pb.summary))}</div><div class="card__foot"><span class="small muted">⏱ ${esc(L(pb.leadTime))} · ${t("sop.stats", { p: pb.phases.length, n })}</span>${m ? `<span class="row small">${avatar(m.name, "xs")} ${esc(L(m.name))}</span>` : ""}</div></a>`; }).join("")}</div>
          <div class="callout callout--info" style="margin-top:20px">${t("sop.addNote")}</div>`;
        bindWizard(); return;
      }

      /* ---- 联系人 ---- */
      if (sub === "contacts") {
        const kinds = [{ id: "all", label: { zh: "全部", en: "All" }, emoji: "📇" }].concat(YL.store.terms("contactKinds"));
        let kind = ctx.query.kind || "all", q = "";
        const draw = () => {
          const kw = q.trim().toLowerCase();
          const list = YL.store.get("contacts").filter((k) => (kind === "all" || k.kind === kind) && (!kw || JSON.stringify([k.name, k.org, k.tags, k.notes]).toLowerCase().includes(kw)));
          root.innerHTML = head + `<div class="row row--between" style="margin-bottom:12px"><p class="muted small" style="margin:0">${t("contacts.intro")}</p><button class="btn btn--primary btn--sm" id="btn-add">＋ ${t("contacts.add")}</button></div>
            <div class="search"><input class="input" id="q" placeholder="${t("contacts.searchPh")}" value="${esc(q)}"></div>
            ${chips(kinds.map((k) => ({ id: k.id, label: { zh: k.emoji + " " + L(k.label), en: k.emoji + " " + k.label.en } })), kind, "kind").replace('class="chips"', 'class="chips chips--scroll"')}
            <div class="grid grid-2">${list.length ? list.map((k) => { const o = YL.store.user(k.ownerId); const know = YL.store.getState("knows", k.id); return `<div class="card"><div class="row row--between" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("contactKinds", k.kind).label)}<span class="small" title="rating">${"★".repeat(k.rating || 0)}<span class="muted">${"★".repeat(5 - (k.rating || 0))}</span></span></div>
              <div class="card__title">${esc(L(k.name))}</div><div class="card__meta"><span>${esc(L(k.org))}</span><span>📨 ${esc(L(k.channel))}</span></div><div style="margin-top:8px">${tags(k.tags || [], "tag--muted")}</div>
              <div class="card__body">${esc(L(k.notes))}</div>
              <div class="card__foot"><span class="row small">${o ? `${avatar(o.name, "xs")} ${t("contacts.owner")}: <strong>${esc(L(o.name))}</strong>` : ""}<span class="muted">· ${t("contacts.lastContact")} ${formatDate(k.lastContact)}</span></span><button class="btn btn--sm ${know ? "is-on" : "btn--ghost"}" data-know="${k.id}">${know ? "✓ " + t("contacts.iKnowOn") : t("contacts.iKnow")}</button></div></div>`; }).join("") : YL.ui.emptyState("📇", t("common.noResults"))}</div>
            <p class="notice">${t("contacts.privacy")}</p>`;
          $$("[data-kind]").forEach((b) => (b.onclick = () => { kind = b.dataset.kind; draw(); }));
          $$("[data-know]").forEach((b) => (b.onclick = () => { YL.store.toggleState("knows", b.dataset.know); draw(); }));
          const qi = $("#q"); qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
          bindWizard();
          $("#btn-add").onclick = () => YL.ui.modal(`<h2>${t("contacts.add")}</h2><form id="f-k"><div class="form-row"><div class="field"><label>${t("contacts.name")}</label><input class="input" name="name" required></div><div class="field"><label>${t("contacts.org")}</label><input class="input" name="org"></div></div><div class="form-row"><div class="field"><label>${t("contacts.kind")}</label><select class="select" name="kind">${YL.store.terms("contactKinds").map((x) => `<option value="${x.id}">${x.emoji} ${esc(L(x.label))}</option>`).join("")}</select></div><div class="field"><label>${t("contacts.channel")}</label><input class="input" name="channel" placeholder="${t("contacts.channelPh")}"></div></div><div class="field"><label>${t("post.tags")}</label><input class="input" name="tags"></div><div class="field"><label>${t("contacts.notes")}</label><textarea class="textarea" name="notes" required placeholder="${t("contacts.notesPh")}"></textarea></div><button class="btn btn--primary btn--block">${t("common.create")}</button></form>`, { onMount(panel) { $("#f-k", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); YL.store.add("contacts", { name: v.name, org: v.org, kind: v.kind, channel: v.channel, tags: v.tags.split(/[,，\s]+/).filter(Boolean), notes: v.notes, ownerId: "me", lastContact: today(), rating: 3, usedIn: [] }); YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); draw(); }; } });
        };
        draw(); return;
      }

      /* ---- 沟通模板 ---- */
      if (sub === "templates") {
        const kinds = [{ id: "all", label: { zh: "全部", en: "All" }, emoji: "✉️" }].concat(YL.store.terms("templateKinds"));
        let kind = "all";
        const openTpl = (id) => { const x = YL.store.find("templates", id); if (!x) return; const m = YL.store.user(x.maintainerId);
          YL.ui.modal(`<h2>${YL.store.term("templateKinds", x.kind).emoji} ${esc(L(x.name))}</h2><p class="muted small">${esc(L(x.scenario))}</p><pre class="card card--flat" style="white-space:pre-wrap;font:inherit;font-size:.9rem;margin:0 0 12px;max-height:40vh;overflow:auto" id="tpl-body">${esc(L(x.body))}</pre>${x.tips ? `<div class="callout callout--info">💡 ${esc(L(x.tips))}</div>` : ""}<div class="row" style="margin-top:12px"><button class="btn btn--primary" id="btn-copy">📋 ${t("templates.copy")}</button>${m ? `<span class="row small muted">${avatar(m.name, "xs")} ${esc(L(m.name))}</span>` : ""}</div>`, { onMount(panel) { $("#btn-copy", panel).onclick = () => { const txt = L(x.body); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => YL.ui.toast(t("common.linkCopied"), "success")).catch(() => YL.ui.toast(t("templates.copyManual"))); }; } }); };
        const draw = () => {
          const list = YL.store.get("templates").filter((x) => kind === "all" || x.kind === kind);
          root.innerHTML = head + `<p class="muted small">${t("templates.intro")}</p>${chips(kinds.map((k) => ({ id: k.id, label: { zh: k.emoji + " " + L(k.label), en: k.emoji + " " + k.label.en } })), kind, "kind")}
            <div class="grid grid-2">${list.map((x) => `<div class="card card--hover" data-tpl="${x.id}"><div class="row" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("templateKinds", x.kind).label)}</div><div class="card__title">${esc(L(x.name))}</div><div class="card__meta">${esc(L(x.scenario))}</div><div class="card__body clamp-3" style="white-space:pre-line">${esc(L(x.body))}</div></div>`).join("")}</div>
            <div class="callout callout--info" style="margin-top:20px">${t("templates.addNote")} <a href="${YL_CONFIG.github}/blob/main/web/data/templates.json" target="_blank" rel="noopener">templates.json</a></div>`;
          $$("[data-kind]").forEach((b) => (b.onclick = () => { kind = b.dataset.kind; draw(); }));
          $$("[data-tpl]").forEach((c) => (c.onclick = () => openTpl(c.dataset.tpl)));
          bindWizard();
        };
        draw();
        if (ctx.query.open) openTpl(ctx.query.open);
        return;
      }

      /* ---- 志愿者 ---- */
      if (sub === "volunteers") {
        const draw = () => {
          const cs = YL.store.get("campaigns").filter((c) => c.status !== "done" && (c.volunteerRoles || []).length);
          root.innerHTML = head + `<p class="muted small">${t("volunteers.intro")}</p>
            <div class="stack">${cs.length ? cs.map((c) => { const ev = c.eventId ? YL.store.find("events", c.eventId) : null; return `<div class="card"><div class="row row--between" style="margin-bottom:8px"><div><div class="card__title">${esc(L(c.name))}</div><div class="card__meta"><span>🗓️ ${formatDate(c.date)}</span>${ev ? `<a href="#/events/e/${ev.id}">🔗 ${t("campaign.eventPage")}</a>` : ""}</div></div><a class="btn btn--ghost btn--sm" href="#/acssy/board/${c.id}">${t("common.view")}</a></div>
              <div class="list">${c.volunteerRoles.map((r) => { const key = c.id + ":" + r.id; const on = YL.store.getState("volunteer", key); const filled = r.filled + (on ? 1 : 0); const full = filled >= r.count; return `<div class="list-row"><div class="list-row__main"><div class="list-row__title">${esc(L(r.role))}</div><div class="list-row__sub">🕒 ${esc(L(r.shift))}</div></div><span class="badge ${full ? "badge--green" : "badge--warn"}">${filled}/${r.count}</span><button class="btn btn--sm ${on ? "is-on" : "btn--primary"}" data-vol="${key}" ${!on && full ? "disabled" : ""}>${on ? "✓ " + t("volunteers.signedUp") : full ? t("volunteers.full") : t("volunteers.signUp")}</button></div>`; }).join("")}</div></div>`; }).join("") : YL.ui.emptyState("🙋", t("volunteers.none"))}</div>
            <div class="callout callout--info" style="margin-top:20px">📣 ${t("volunteers.noticeTip")} <a href="#/acssy/templates?open=t03">${t("common.view")}</a></div>`;
          $$("[data-vol]").forEach((b) => (b.onclick = () => { const on = YL.store.toggleState("volunteer", b.dataset.vol); YL.ui.toast(on ? t("volunteers.thanks") : t("volunteers.cancelled"), on ? "success" : ""); draw(); }));
          bindWizard();
        };
        draw(); return;
      }
      YL.router.navigate("acssy/board");
    }
  });
  YL.acssy = { openWizard, progress };
})();
