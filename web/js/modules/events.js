/* 活动：按地区/类型筛选、详情、RSVP、发起活动 */
registerModule({
  id: "events",
  nav: { icon: "📅", labelKey: "nav.events", order: 30, mobile: true },
  descriptionKey: "about.module.events",
  render(root, ctx) {
    const { t, esc, L, $, $$, avatar, tags, formatDate, chips } = YL.ui;
    const today = new Date().toISOString().slice(0, 10);
    const requireLogin = YL.auth.requireLogin;

    if (ctx.sub === "e") {
      const e = YL.store.find("events", ctx.id);
      if (!e) { root.innerHTML = YL.ui.emptyState("📅", t("common.noResults"), `<a class="btn" href="#/events">${t("common.back")}</a>`); return; }
      const draw = () => {
        const r = YL.store.region(e.region); const host = YL.store.user(e.hostId); const going = YL.store.getState("rsvp", e.id);
        const type = YL.store.term("eventTypes", e.type); const total = e.going + (going ? 1 : 0);
        const pct = e.capacity ? Math.min(100, Math.round((total / e.capacity) * 100)) : 0;
        root.innerHTML = `<a class="muted small" href="#/events">← ${t("common.back")}</a>
          <div class="two-col" style="margin-top:12px"><article class="card">
            <div class="row" style="margin-bottom:8px">${YL.ui.tag(type.label, "tag--accent")}${tags(e.tags || [], "tag--muted")}</div>
            <h1 style="font-size:1.4rem;margin-bottom:12px">${esc(L(e.title))}</h1>
            <dl class="kv"><dt>🗓️</dt><dd><strong>${formatDate(e.date, { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</strong> · ${esc(e.time)}</dd><dt>📍</dt><dd>${r.emoji} ${esc(L(r.name))} · ${esc(L(e.venue))}</dd><dt>🏛️</dt><dd>${esc(L(e.hostOrg))}${host ? ` · ${esc(L(host.name))}` : ""}</dd>${e.circleId && YL.store.find("circles", e.circleId) ? `<dt>🫂</dt><dd><a href="#/circles/c/${e.circleId}">${YL.store.find("circles", e.circleId).emoji} ${esc(L(YL.store.find("circles", e.circleId).name))}</a></dd>` : ""}${e.campaignId && YL.auth.isAcssy() ? `<dt>📋</dt><dd><a href="#/acssy/board/${e.campaignId}">${t("events.openBoard")}</a></dd>` : ""}</dl>
            <div class="divider"></div>
            <div class="prose">${esc(L(e.description)).split(/\n{2,}/).map((x) => `<p>${x}</p>`).join("")}</div>
          </article>
          <div class="stack"><div class="card">
            <div class="row row--between"><strong>${t("events.attending", { n: total })}</strong>${e.capacity ? `<span class="muted small">${t("events.capacity", { n: e.capacity })}</span>` : ""}</div>
            ${e.capacity ? `<div class="progress" style="margin:10px 0"><i style="width:${pct}%"></i></div>` : ""}
            <button class="btn btn--block ${going ? "is-on" : "btn--primary"}" id="btn-rsvp" ${e.date < today ? "disabled" : ""}>${e.date < today ? t("events.past") : going ? "✓ " + t("events.going") : t("events.rsvp")}</button>
            ${going ? `<p class="small muted" style="margin-top:10px;text-align:center">${t("events.rsvpNote")}</p>` : ""}
          </div>
          ${host ? `<div class="card"><div class="muted small" style="margin-bottom:8px">${t("events.host")}</div><a class="person" href="#/directory/u/${host.id}" style="color:inherit">${avatar(host.name)}<div><div class="person__name">${esc(L(host.name))}</div><div class="person__sub">${esc(L(host.title))}</div></div></a></div>` : ""}
          <div class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">${t("events.regionNote", { region: esc(L(r.name)) })}</div><a class="btn btn--ghost btn--sm" style="margin-top:8px" href="#/events?region=${e.region}">${t("events.moreInRegion")}</a></div>
          </div></div>`;
        $("#btn-rsvp").onclick = () => { if (!requireLogin()) return; const on = YL.store.toggleState("rsvp", e.id); YL.ui.toast(on ? t("events.rsvpOk") : t("events.rsvpCancel"), on ? "success" : ""); draw(); };
      };
      draw();
      return;
    }

    const regions = [{ id: "all", name: { zh: "全部地区", en: "All regions" }, emoji: "🌏" }].concat(YL.store.get("regions"));
    const types = [{ id: "all", label: { zh: "全部", en: "All" } }].concat(YL.store.terms("eventTypes"));
    const me = YL.auth.isLoggedIn() && YL.auth.user().profile;
    let region = ctx.query.region || "all", type = "all", showPast = false;
    const draw = () => {
      let list = YL.store.get("events").filter((e) => (region === "all" || e.region === region) && (type === "all" || e.type === type) && (showPast || e.date >= today));
      list.sort((a, b) => a.date.localeCompare(b.date));
      const mine = list.filter((e) => YL.store.getState("rsvp", e.id));
      root.innerHTML = `<div class="page-head"><div class="row row--between"><div><h1>${t("events.title")}</h1><p>${t("events.intro")}</p></div><button class="btn btn--primary" id="btn-new">🎉 ${t("wizard.cta")}</button></div></div>
        ${me && me.region && region === "all" ? `<div class="callout callout--info" style="margin-bottom:12px">📍 ${t("events.yourRegion", { region: esc(L(YL.store.region(me.region).name)) })} <a href="#/events?region=${me.region}" data-region-link="${me.region}">${t("events.filterMine")}</a></div>` : ""}
        ${chips(regions.map((r) => ({ id: r.id, label: { zh: r.emoji + " " + L(r.name), en: r.emoji + " " + r.name.en } })), region, "region").replace('class="chips"', 'class="chips chips--scroll"')}
        <div class="row" style="margin-bottom:16px">${chips(types, type, "type").replace('class="chips"', 'class="chips" style="margin:0"')}<span class="spacer"></span><label class="check"><input type="checkbox" id="chk-past" ${showPast ? "checked" : ""}> ${t("events.showPast")}</label></div>
        ${mine.length ? `<p class="small muted">✓ ${t("events.youAreGoing", { n: mine.length })}</p>` : ""}
        <div class="grid grid-2">${list.length ? list.map((e) => { const r = YL.store.region(e.region); const going = YL.store.getState("rsvp", e.id); const d = new Date(e.date + "T00:00:00"); return `
          <a class="card card--hover" href="#/events/e/${e.id}"><div class="row" style="align-items:flex-start">
            <div class="date-box"><strong>${d.getDate()}</strong><span>${d.toLocaleDateString(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US", { month: "short" })}</span></div>
            <div style="flex:1;min-width:0"><div class="row" style="margin-bottom:4px">${YL.ui.tag(YL.store.term("eventTypes", e.type).label, "tag--accent")}${going ? `<span class="badge badge--green">✓ ${t("events.going")}</span>` : ""}${e.date < today ? `<span class="badge badge--muted">${t("events.past")}</span>` : ""}${e.campaignId ? `<span class="badge">ACSSY</span>` : ""}</div>
            <div class="card__title">${esc(L(e.title))}</div><div class="card__meta"><span>${r.emoji} ${esc(L(r.name))}</span><span>🕒 ${esc(e.time)}</span><span>👥 ${e.going + (going ? 1 : 0)}</span></div><div class="card__body clamp-2">${esc(L(e.description))}</div></div></div></a>`; }).join("") : YL.ui.emptyState("📅", t("events.none"), `<button class="btn btn--primary" id="btn-new2">🎉 ${t("wizard.cta")}</button>`)}</div>`;
      $$("[data-region]").forEach((b) => (b.onclick = () => { region = b.dataset.region; draw(); }));
      $$("[data-type]").forEach((b) => (b.onclick = () => { type = b.dataset.type; draw(); }));
      const rl = $("[data-region-link]"); if (rl) rl.onclick = (ev) => { ev.preventDefault(); region = rl.dataset.regionLink; draw(); };
      $("#chk-past").onchange = (ev) => { showPast = ev.target.checked; draw(); };
      const form = () => YL.acssy.openWizard({ region: region !== "all" ? region : "" });
      $("#btn-new").onclick = form; const b2 = $("#btn-new2"); if (b2) b2.onclick = form;
    };
    draw();
  }
});
