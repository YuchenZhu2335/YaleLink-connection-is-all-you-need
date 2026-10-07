/* 子社群：按兴趣 / 地区 / 行业分类，加入、查看活动、在社群里办活动 */
registerModule({
  id: "circles",
  nav: { icon: "🫂", labelKey: "nav.circles", order: 35, mobile: false },
  descriptionKey: "about.module.circles",
  render(root, ctx) {
    const { t, esc, L, $, $$, avatar, chips, sectionTitle, formatDate } = YL.ui;
    const requireLogin = YL.auth.requireLogin;
    const today = new Date().toISOString().slice(0, 10);

    if (ctx.sub === "c") {
      const c = YL.store.find("circles", ctx.id);
      if (!c) { root.innerHTML = YL.ui.emptyState("🫂", t("common.noResults"), `<a class="btn" href="#/circles">${t("common.back")}</a>`); return; }
      const draw = () => {
        const joined = YL.store.getState("circle", c.id);
        const lead = YL.store.user(c.leadId);
        const events = YL.store.get("events").filter((e) => e.circleId === c.id).sort((a, b) => a.date.localeCompare(b.date));
        const upcoming = events.filter((e) => e.date >= today), past = events.filter((e) => e.date < today);
        const members = YL.store.get("users").filter((u) => c.type === "region" ? u.region === c.region : c.type === "industry" ? (c.id === "ci-tech" && u.industry === "tech") || (c.id === "ci-finance" && ["finance", "quant"].includes(u.industry)) || (c.id === "ci-founders" && u.industry === "startup") || (c.id === "ci-phd" && u.industry === "academia") : false).slice(0, 6);
        root.innerHTML = `<a class="muted small" href="#/circles">← ${t("common.back")}</a>
          <div class="two-col" style="margin-top:12px"><div class="stack">
            <div class="card"><div class="row" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("circleTypes", c.type).label)}${c.region && c.region !== "all" ? `<span class="muted small">${YL.store.region(c.region).emoji} ${esc(L(YL.store.region(c.region).name))}</span>` : `<span class="muted small">🌏 ${t("life.everywhere")}</span>`}</div>
              <h1 style="font-size:1.5rem">${c.emoji} ${esc(L(c.name))}</h1><p class="muted" style="margin-top:6px">${esc(L(c.description))}</p>
              <div class="row" style="margin-top:12px"><button class="btn ${joined ? "is-on" : "btn--primary"}" id="btn-join">${joined ? "✓ " + t("circles.joined") : t("circles.join")}</button><button class="btn btn--ghost" id="btn-host">🎉 ${t("circles.hostHere")}</button><span class="muted small">👥 ${c.members + (joined ? 1 : 0)}</span></div></div>
            <section>${sectionTitle(t("circles.upcoming"))}<div class="list">${upcoming.length ? upcoming.map((e) => `<a class="list-row card--hover" href="#/events/e/${e.id}"><div class="date-box"><strong>${new Date(e.date + "T00:00:00").getDate()}</strong><span>${new Date(e.date + "T00:00:00").toLocaleDateString(YL.i18n.getLang() === "zh" ? "zh-CN" : "en-US", { month: "short" })}</span></div><div class="list-row__main"><div class="list-row__title">${esc(L(e.title))}</div><div class="list-row__sub">${esc(e.time)} · ${esc(L(e.venue))} · 👥 ${e.going}</div></div></a>`).join("") : YL.ui.emptyState("📅", t("circles.noEvents"), `<button class="btn btn--primary btn--sm" id="btn-host2">🎉 ${t("circles.hostHere")}</button>`)}</div></section>
            ${past.length ? `<section>${sectionTitle(t("circles.past"))}<div class="list">${past.map((e) => `<a class="list-row card--hover" href="#/events/e/${e.id}"><div class="list-row__main"><div class="list-row__title">${esc(L(e.title))}</div><div class="list-row__sub">${formatDate(e.date)}</div></div></a>`).join("")}</div></section>` : ""}
          </div><div class="stack">
            ${lead ? `<div class="card"><div class="muted small" style="margin-bottom:8px">${t("circles.lead")}</div><a class="person" href="#/directory/u/${lead.id}" style="color:inherit">${avatar(lead.name)}<div><div class="person__name">${esc(L(lead.name))}</div><div class="person__sub">${esc(L(lead.title))}</div></div></a></div>` : ""}
            ${members.length ? `<div class="card"><div class="muted small" style="margin-bottom:8px">${t("circles.members")}</div><div class="stack">${members.map((u) => `<a class="person" href="#/directory/u/${u.id}" style="color:inherit">${avatar(u.name, "sm")}<div><div class="small"><strong>${esc(L(u.name))}</strong></div><div class="person__sub">${esc(L(u.title))}</div></div></a>`).join("")}</div></div>` : ""}
            <div class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">${t("circles.pushNote")}</div></div>
          </div></div>`;
        $("#btn-join").onclick = () => { if (!requireLogin()) return; const on = YL.store.toggleState("circle", c.id); YL.ui.toast(on ? t("circles.joinedToast") : t("circles.leftToast"), on ? "success" : ""); draw(); };
        const host = () => YL.acssy.openWizard({ circleId: c.id, scope: "community" });
        $("#btn-host").onclick = host; const h2 = $("#btn-host2"); if (h2) h2.onclick = host;
      };
      draw(); return;
    }

    const types = [{ id: "all", label: { zh: "全部", en: "All" }, emoji: "🫂" }].concat(YL.store.terms("circleTypes"));
    let type = ctx.query.type || "all";
    const draw = () => {
      const list = YL.store.get("circles").filter((c) => type === "all" || c.type === type);
      const mine = YL.store.get("circles").filter((c) => YL.store.getState("circle", c.id));
      root.innerHTML = `<div class="page-head"><div class="row row--between"><div><h1>${t("circles.title")}</h1><p>${t("circles.intro")}</p></div><button class="btn btn--primary" id="btn-new">＋ ${t("circles.create")}</button></div></div>
        ${mine.length ? `<div class="callout callout--green" style="margin-bottom:12px">✓ ${t("circles.mine", { n: mine.length })}: ${mine.map((c) => `<a href="#/circles/c/${c.id}">${c.emoji} ${esc(L(c.name))}</a>`).join(" · ")}</div>` : ""}
        ${chips(types.map((x) => ({ id: x.id, label: { zh: x.emoji + " " + L(x.label), en: x.emoji + " " + x.label.en } })), type, "type")}
        <div class="grid grid-3">${list.map((c) => { const joined = YL.store.getState("circle", c.id); const n = YL.store.get("events").filter((e) => e.circleId === c.id && e.date >= today).length; return `<a class="card card--hover" href="#/circles/c/${c.id}"><div class="row row--between"><span style="font-size:1.8rem">${c.emoji}</span>${joined ? `<span class="badge badge--green">✓</span>` : ""}</div><div class="card__title" style="margin-top:6px">${esc(L(c.name))}</div><div class="card__body clamp-2">${esc(L(c.description))}</div><div class="card__foot"><span class="muted small">👥 ${c.members + (joined ? 1 : 0)}</span><span class="muted small">${n ? "📅 " + t("circles.nUpcoming", { n }) : ""}</span></div></a>`; }).join("")}</div>`;
      $$("[data-type]").forEach((b) => (b.onclick = () => { type = b.dataset.type; draw(); }));
      $("#btn-new").onclick = () => { if (!requireLogin()) return;
        YL.ui.modal(`<h2>${t("circles.create")}</h2><form id="f-c"><div class="form-row"><div class="field"><label>${t("circles.name")}</label><input class="input" name="name" required></div><div class="field"><label>${t("circles.emoji")}</label><input class="input" name="emoji" maxlength="2" value="✨"></div></div><div class="form-row"><div class="field"><label>${t("circles.type")}</label><select class="select" name="type">${YL.store.terms("circleTypes").map((x) => `<option value="${x.id}">${x.emoji} ${esc(L(x.label))}</option>`).join("")}</select></div><div class="field"><label>${t("profile.region")}</label><select class="select" name="region"><option value="all">🌏 ${t("life.everywhere")}</option>${YL.store.get("regions").map((r) => `<option value="${r.id}">${r.emoji} ${esc(L(r.name))}</option>`).join("")}</select></div></div><div class="field"><label>${t("post.body")}</label><textarea class="textarea" name="description" required></textarea></div><button class="btn btn--primary btn--block">${t("common.create")}</button></form>`, { onMount(panel) { $("#f-c", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); const c = YL.store.add("circles", { name: v.name, emoji: v.emoji || "✨", type: v.type, region: v.region, description: v.description, members: 0, leadId: "me" }); YL.store.setState("circle", c.id, true); YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); YL.router.navigate("circles/c/" + c.id); }; } });
      };
    };
    draw();
  }
});
