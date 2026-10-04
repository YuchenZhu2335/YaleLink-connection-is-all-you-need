/* 职业发展（启动模块）：机会&内推 / 求职时间线 / 简历工坊 / 求职小组&Mock / 行业研究 / 帖子详情 */
(function () {
  const TABS = [
    { id: "jobs", icon: "💼", labelKey: "careers.tab.jobs" },
    { id: "timeline", icon: "🗓️", labelKey: "careers.tab.timeline" },
    { id: "resume", icon: "📄", labelKey: "careers.tab.resume" },
    { id: "groups", icon: "🎯", labelKey: "careers.tab.groups" },
    { id: "research", icon: "📊", labelKey: "careers.tab.research" }
  ];

  function postCard(p) {
    const { esc, L, avatar, formatDate } = YL.ui;
    const a = YL.store.user(p.authorId);
    const cat = YL.store.term("postCategories", p.category);
    const liked = YL.store.getState("likes", p.id);
    return `<a class="card card--hover" href="#/careers/post/${esc(p.id)}">
      <div class="row" style="margin-bottom:6px">${YL.ui.tag(cat.label)}${(p.tags || []).slice(0, 3).map((x) => YL.ui.tag(x, "tag--muted")).join("")}<span class="spacer"></span><span class="muted small">${formatDate(p.createdAt)}</span></div>
      <div class="card__title">${esc(L(p.title))}</div>
      <div class="card__body clamp-2">${esc(L(p.summary))}</div>
      <div class="card__foot"><span class="row">${a ? `${avatar(a.name, "xs")}<span class="small"><strong>${esc(L(a.name))}</strong> · ${esc(L(a.title))}${a.company ? " @ " + esc(L(a.company)) : ""}</span>` : ""}</span><span class="muted small">${liked ? "❤️" : "👍"} ${p.likes + (liked ? 1 : 0)} · 💬 ${p.commentsCount}</span></div></a>`;
  }

  function postForm(defaultCategory, onDone) {
    const { t, esc, L, $ } = YL.ui;
    const cats = YL.store.terms("postCategories");
    YL.ui.modal(`<h2>${t("post.newTitle")}</h2>
      <form id="f-post">
        <div class="field"><label>${t("post.category")}</label><select class="select" name="category">${cats.map((c) => `<option value="${c.id}" ${c.id === defaultCategory ? "selected" : ""}>${c.emoji} ${esc(L(c.label))}</option>`).join("")}</select></div>
        <div class="field"><label>${t("post.title")}</label><input class="input" name="title" required maxlength="80" placeholder="${t("post.titlePh")}"></div>
        <div class="field"><label>${t("post.body")}</label><textarea class="textarea" name="body" required placeholder="${t("post.bodyPh")}"></textarea></div>
        <div class="field"><label>${t("post.tags")}</label><input class="input" name="tags" placeholder="${t("post.tagsPh")}"></div>
        <button class="btn btn--primary btn--block" type="submit">${t("post.publish")}</button>
      </form>`, { onMount(panel) {
        $("#f-post", panel).onsubmit = (e) => {
          e.preventDefault();
          const v = YL.ui.formValues(e.target);
          const body = v.body.trim();
          YL.store.add("posts", { authorId: "me", category: v.category, title: v.title.trim(), summary: body.slice(0, 120), body, tags: v.tags.split(/[,，\s]+/).filter(Boolean).slice(0, 5), likes: 0, commentsCount: 0, createdAt: new Date().toISOString().slice(0, 10) });
          YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); onDone && onDone();
        };
      } });
  }

  const requireLogin = () => YL.auth.requireLogin();

  registerModule({
    id: "careers",
    nav: { icon: "💼", labelKey: "nav.careers", order: 20, mobile: true },
    descriptionKey: "about.module.careers",
    render(root, ctx) {
      const { t, esc, L, $, $$, avatar, tags, formatDate, sectionTitle, chips, deadlineBadge } = YL.ui;
      const sub = ctx.sub || "jobs";

      /* ---------- 帖子详情 ---------- */
      if (sub === "post") {
        const p = YL.store.find("posts", ctx.id);
        if (!p) { root.innerHTML = YL.ui.emptyState("🗂️", t("post.notFound"), `<a class="btn" href="#/careers/research">${t("common.back")}</a>`); return; }
        const a = YL.store.user(p.authorId);
        const cat = YL.store.term("postCategories", p.category);
        const related = YL.store.get("posts").filter((x) => x.id !== p.id && x.category === p.category).slice(0, 3);
        const draw = () => {
          const liked = YL.store.getState("likes", p.id);
          root.innerHTML = `<a class="muted small" href="#/careers/${p.category === "resume" ? "resume" : "research"}">← ${t("common.back")}</a>
            <article class="card" style="margin-top:12px">
              <div class="row" style="margin-bottom:8px">${YL.ui.tag(cat.label)}${tags(p.tags || [], "tag--muted")}</div>
              <h1 style="font-size:1.4rem;margin-bottom:10px">${esc(L(p.title))}</h1>
              <div class="row" style="margin-bottom:16px">${a ? YL.ui.userLink(a) : ""}<span class="muted small">· ${formatDate(p.createdAt)}</span></div>
              <div class="prose">${esc(L(p.body)).split(/\n{2,}/).map((x) => `<p>${x.replace(/\n/g, "<br>")}</p>`).join("")}</div>
              <div class="card__foot">
                <div class="row"><button class="btn ${liked ? "is-on" : "btn--ghost"} btn--sm" id="btn-like">${liked ? "❤️ " + t("post.liked") : "👍 " + t("post.like")} · ${p.likes + (liked ? 1 : 0)}</button><span class="muted small">💬 ${t("post.comments", { n: p.commentsCount })}</span></div>
                <button class="btn btn--sm btn--ghost" id="btn-share">🔗 ${t("common.share")}</button>
              </div>
            </article>
            ${a && !a.isMe ? `<div class="card" style="margin-top:16px"><div class="person">${avatar(a.name, "lg")}<div><div class="person__name">${esc(L(a.name))}</div><div class="person__sub">${esc(L(a.title))}${a.company ? " · " + esc(L(a.company)) : ""} · ${esc(L(YL.store.term("schools", a.school).label))} '${String(a.classYear).slice(-2)}</div><div style="margin-top:8px">${tags((a.offers || []).map((o) => YL.store.term("offers", o).label), "tag--green")}</div><a class="btn btn--sm btn--primary" style="margin-top:8px" href="#/directory/u/${a.id}">${t("directory.viewProfile")}</a></div></div></div>` : ""}
            ${related.length ? `<section class="section" style="margin-top:28px">${sectionTitle(t("post.related"))}<div class="stack">${related.map(postCard).join("")}</div></section>` : ""}`;
          $("#btn-like").onclick = () => { if (!requireLogin()) return; YL.store.toggleState("likes", p.id); draw(); };
          $("#btn-share").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.href).catch(() => {}); YL.ui.toast(t("common.linkCopied"), "success"); };
        };
        draw();
        return;
      }

      /* ---------- Tab 页 ---------- */
      const head = `<div class="page-head"><h1>${t("careers.title")}</h1><p>${t("careers.intro")}</p></div>${YL.ui.tabs(TABS, sub, "#/careers")}`;
      const today = new Date().toISOString().slice(0, 10);

      if (sub === "jobs") {
        const industries = [{ id: "all", label: { zh: "全部行业", en: "All industries" } }].concat(YL.store.terms("industries"));
        const types = [{ id: "all", label: { zh: "全部类型", en: "All types" } }].concat(YL.store.terms("jobTypes"));
        let ind = ctx.query.industry || "all", typ = ctx.query.type || "all", referralOnly = false;
        const draw = () => {
          let jobs = YL.store.get("jobs").filter((j) => (ind === "all" || j.industry === ind) && (typ === "all" || j.type === typ) && (!referralOnly || j.referrerId));
          jobs.sort((a, b) => (a.deadline < today) - (b.deadline < today) || a.deadline.localeCompare(b.deadline));
          root.innerHTML = head + `
            <div class="row row--between" style="margin-bottom:12px"><p class="muted small" style="margin:0">${t("careers.jobsIntro")}</p><button class="btn btn--primary btn--sm" id="btn-newjob">＋ ${t("careers.postJob")}</button></div>
            ${chips(industries, ind, "ind")}
            <div class="row" style="margin-bottom:16px">${chips(types, typ, "typ").replace('class="chips"', 'class="chips" style="margin:0"')}<button class="chip ${referralOnly ? "is-active" : ""}" id="chip-ref">🤝 ${t("careers.referralOnly")}</button></div>
            <div class="grid grid-2">${jobs.length ? jobs.map((j) => { const ref = YL.store.user(j.referrerId); const r = YL.store.region(j.region); return `
              <div class="card card--hover" data-job="${j.id}">
                <div class="row row--between" style="margin-bottom:6px">${YL.ui.tag(YL.store.term("jobTypes", j.type).label, "tag--accent")}${deadlineBadge(j.deadline)}</div>
                <div class="card__title">${esc(L(j.title))}</div>
                <div class="card__meta"><strong>${esc(L(j.company))}</strong><span>${r.emoji} ${esc(L(j.location))}</span></div>
                <div class="card__body clamp-2">${esc(L(j.description))}</div>
                <div class="card__foot">${ref ? `<span class="row small">${avatar(ref.name, "xs")} ${t("careers.referrer")}: <strong>${esc(L(ref.name))}</strong></span>` : `<span class="muted small">${t("careers.noReferrer")}</span>`}<span class="muted small">${t("careers.deadline")} ${YL.ui.formatDate(j.deadline)}</span></div>
              </div>`; }).join("") : YL.ui.emptyState("💼", t("common.noResults"))}</div>`;
          $$("[data-ind]").forEach((b) => (b.onclick = () => { ind = b.dataset.ind; draw(); }));
          $$("[data-typ]").forEach((b) => (b.onclick = () => { typ = b.dataset.typ; draw(); }));
          $("#chip-ref").onclick = () => { referralOnly = !referralOnly; draw(); };
          $("#btn-newjob").onclick = () => { if (!requireLogin()) return; jobForm(draw); };
          $$("[data-job]").forEach((c) => (c.onclick = () => jobDetail(c.dataset.job)));
        };
        const jobDetail = (id) => {
          const j = YL.store.find("jobs", id); const ref = YL.store.user(j.referrerId); const r = YL.store.region(j.region);
          YL.ui.modal(`<h2>${esc(L(j.title))}</h2>
            <dl class="kv"><dt>${t("careers.company")}</dt><dd><strong>${esc(L(j.company))}</strong></dd><dt>${t("careers.location")}</dt><dd>${r.emoji} ${esc(L(j.location))}</dd><dt>${t("careers.type")}</dt><dd>${esc(L(YL.store.term("jobTypes", j.type).label))}</dd><dt>${t("careers.deadline")}</dt><dd>${YL.ui.formatDate(j.deadline)} ${deadlineBadge(j.deadline)}</dd><dt>${t("careers.industry")}</dt><dd>${esc(L(YL.store.term("industries", j.industry).label))}</dd></dl>
            <div class="divider"></div><div class="prose"><p>${esc(L(j.description))}</p></div><div>${tags(j.tags || [], "tag--muted")}</div>
            ${ref ? `<div class="callout callout--green" style="margin-top:12px">🤝 ${t("careers.referralBy", { name: esc(L(ref.name)) })}</div>` : ""}
            <div class="row" style="margin-top:16px">${YL.ui.safeUrl(j.link) ? `<a class="btn btn--primary" href="${YL.ui.safeUrl(j.link)}" target="_blank" rel="noopener">${t("careers.apply")}</a>` : ""}${ref ? `<button class="btn btn--accent" id="btn-askref">${t("careers.askReferral")}</button>` : ""}<button class="btn btn--ghost" id="btn-save">${YL.store.getState("savedJobs", j.id) ? "★ " + t("common.saved") : "☆ " + t("common.save")}</button></div>`, { onMount(panel) {
              const s = $("#btn-save", panel); s.onclick = () => { if (!requireLogin()) return; const on = YL.store.toggleState("savedJobs", j.id); s.textContent = on ? "★ " + t("common.saved") : "☆ " + t("common.save"); };
              const a = $("#btn-askref", panel); if (a) a.onclick = () => { if (!requireLogin()) return; YL.ui.closeModal(); YL.ui.toast(t("careers.referralSent", { name: L(ref.name) }), "success"); };
            } });
        };
        const jobForm = (onDone) => {
          YL.ui.modal(`<h2>${t("careers.postJob")}</h2><form id="f-job">
            <div class="form-row"><div class="field"><label>${t("careers.company")}</label><input class="input" name="company" required></div><div class="field"><label>${t("careers.jobTitle")}</label><input class="input" name="title" required></div></div>
            <div class="form-row"><div class="field"><label>${t("careers.type")}</label><select class="select" name="type">${YL.store.terms("jobTypes").map((x) => `<option value="${x.id}">${esc(L(x.label))}</option>`).join("")}</select></div><div class="field"><label>${t("careers.industry")}</label><select class="select" name="industry">${YL.store.terms("industries").map((x) => `<option value="${x.id}">${esc(L(x.label))}</option>`).join("")}</select></div></div>
            <div class="form-row"><div class="field"><label>${t("careers.location")}</label><select class="select" name="region">${YL.store.get("regions").map((x) => `<option value="${x.id}">${x.emoji} ${esc(L(x.name))}</option>`).join("")}</select></div><div class="field"><label>${t("careers.deadline")}</label><input class="input" name="deadline" type="date" required></div></div>
            <div class="field"><label>${t("careers.link")}</label><input class="input" name="link" type="url" placeholder="https://"></div>
            <div class="field"><label>${t("post.body")}</label><textarea class="textarea" name="description" required></textarea></div>
            <label class="check"><input type="checkbox" name="referral" value="1" checked> ${t("careers.iCanRefer")}</label>
            <div style="height:12px"></div><button class="btn btn--primary btn--block">${t("post.publish")}</button></form>`, { onMount(panel) {
              $("#f-job", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); const r = YL.store.region(v.region);
                YL.store.add("jobs", { company: v.company, title: v.title, type: v.type, industry: v.industry, region: v.region, location: r.name, deadline: v.deadline, link: v.link, description: v.description, tags: [], referrerId: v.referral ? "me" : null, postedAt: today });
                YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); onDone(); };
            } });
        };
        draw();
        return;
      }

      if (sub === "timeline") {
        const tls = YL.store.get("timelines");
        let cur = ctx.query.t || tls[0].id;
        const monthNow = new Date().getMonth() + 1;
        const draw = () => {
          const tl = tls.find((x) => x.id === cur);
          root.innerHTML = head + `<p class="muted small">${t("careers.timelineIntro")}</p>
            ${chips(tls.map((x) => ({ id: x.id, label: x.title })), cur, "tl")}
            <div class="two-col"><div class="card">
              <h2 style="margin-bottom:4px">${esc(L(tl.title))}</h2><p class="muted small">${esc(L(tl.intro))}</p><div class="divider"></div>
              <ol class="timeline">${tl.steps.map((s) => `<li class="${s.months && s.months.includes(monthNow) ? "is-now" : ""}"><div class="timeline__when">${esc(L(s.when))}${s.months && s.months.includes(monthNow) ? ` · ${t("careers.now")}` : ""}</div><div class="timeline__title">${esc(L(s.title))}</div><div class="timeline__detail">${esc(L(s.detail))}</div></li>`).join("")}</ol>
            </div><div class="stack">
              <div class="card card--primary"><div class="card__title">💡 ${t("careers.timelineTipTitle")}</div><div class="card__body">${esc(L(tl.tip))}</div></div>
              <div class="card"><div class="card__title">${t("careers.timelineMaintainers")}</div><div class="stack" style="margin-top:8px">${(tl.maintainers || []).map((id) => { const u = YL.store.user(id); return u ? `<div class="person">${avatar(u.name, "sm")}<div><div class="small"><strong>${esc(L(u.name))}</strong></div><div class="person__sub">${esc(L(u.title))}</div></div></div>` : ""; }).join("")}</div><p class="muted small" style="margin-top:10px">${t("careers.timelineContribute")}</p><a class="btn btn--ghost btn--sm" href="${YL_CONFIG.github}/issues/new?template=content_contribution.yml" target="_blank" rel="noopener">${t("common.suggestEdit")}</a></div>
            </div></div>`;
          $$("[data-tl]").forEach((b) => (b.onclick = () => { cur = b.dataset.tl; draw(); }));
        };
        draw();
        return;
      }

      if (sub === "resume") {
        const draw = () => {
          const posts = YL.store.get("posts").filter((p) => p.category === "resume");
          const reviewers = YL.store.get("users").filter((u) => u.offers.includes("resume"));
          root.innerHTML = head + `<div class="two-col"><div>
            <div class="row row--between" style="margin-bottom:12px"><p class="muted small" style="margin:0">${t("careers.resumeIntro")}</p><button class="btn btn--primary btn--sm" id="btn-req">＋ ${t("careers.requestReview")}</button></div>
            <div class="stack">${posts.map(postCard).join("")}</div></div>
            <div class="stack">
              <div class="card"><div class="card__title">${t("careers.resumeChecklist")}</div><ul class="small muted" style="padding-left:18px;margin:8px 0 0">${[1, 2, 3, 4, 5].map((i) => `<li>${t("careers.checklist" + i)}</li>`).join("")}</ul></div>
              <div class="card"><div class="card__title">${t("careers.reviewers")}</div><p class="muted small">${t("careers.reviewersSub")}</p><div class="stack" style="margin-top:8px">${reviewers.slice(0, 5).map((u) => `<a class="person" href="#/directory/u/${u.id}" style="color:inherit">${avatar(u.name, "sm")}<div><div class="small"><strong>${esc(L(u.name))}</strong> · ${esc(L(YL.store.term("industries", u.industry).label))}</div><div class="person__sub">${esc(L(u.title))}${u.company ? " @ " + esc(L(u.company)) : ""}</div></div></a>`).join("")}</div></div>
            </div></div>`;
          $("#btn-req").onclick = () => { if (!requireLogin()) return; postForm("resume", draw); };
        };
        draw();
        return;
      }

      if (sub === "groups") {
        const draw = () => {
          const groups = YL.store.get("groups");
          root.innerHTML = head + `<div class="row row--between" style="margin-bottom:12px"><p class="muted small" style="margin:0">${t("careers.groupsIntro")}</p><button class="btn btn--primary btn--sm" id="btn-newgroup">＋ ${t("careers.newGroup")}</button></div>
            <div class="grid grid-2">${groups.map((g) => { const joined = YL.store.getState("joined", g.id); const lead = YL.store.user(g.leadId); const ind = YL.store.term("industries", g.industry); return `
              <div class="card">
                <div class="row row--between" style="margin-bottom:6px">${YL.ui.tag(ind.label)}<span class="muted small">👥 ${g.members + (joined ? 1 : 0)}</span></div>
                <div class="card__title">${esc(L(g.name))}</div>
                <div class="card__body">${esc(L(g.description))}</div>
                ${g.nextMock ? `<div class="callout callout--info" style="margin-top:10px">🎯 ${t("careers.nextMock")}: <strong>${YL.ui.formatDate(g.nextMock.date, { month: "short", day: "numeric", weekday: "short" })} ${esc(g.nextMock.time || "")}</strong> · ${esc(L(g.nextMock.topic))}</div>` : ""}
                <div class="card__foot"><span class="row small">${lead ? `${avatar(lead.name, "xs")} ${t("careers.groupLead")}: <strong>${esc(L(lead.name))}</strong>` : ""}</span><div class="row"><span class="muted small">${esc(L(g.cadence))}</span><button class="btn btn--sm ${joined ? "is-on" : "btn--primary"}" data-join="${g.id}">${joined ? "✓ " + t("careers.joined") : t("careers.join")}</button></div></div>
              </div>`; }).join("")}</div>`;
          $$("[data-join]").forEach((b) => (b.onclick = () => { if (!requireLogin()) return; const on = YL.store.toggleState("joined", b.dataset.join); YL.ui.toast(on ? t("careers.joinedToast") : t("careers.leftToast"), on ? "success" : ""); draw(); }));
          $("#btn-newgroup").onclick = () => { if (!requireLogin()) return;
            YL.ui.modal(`<h2>${t("careers.newGroup")}</h2><form id="f-group">
              <div class="field"><label>${t("careers.groupName")}</label><input class="input" name="name" required></div>
              <div class="field"><label>${t("careers.industry")}</label><select class="select" name="industry">${YL.store.terms("industries").map((x) => `<option value="${x.id}">${esc(L(x.label))}</option>`).join("")}</select></div>
              <div class="field"><label>${t("post.body")}</label><textarea class="textarea" name="description" required placeholder="${t("careers.groupPh")}"></textarea></div>
              <button class="btn btn--primary btn--block">${t("common.create")}</button></form>`, { onMount(panel) { $("#f-group", panel).onsubmit = (e) => { e.preventDefault(); const v = YL.ui.formValues(e.target); const g = YL.store.add("groups", { name: v.name, industry: v.industry, description: v.description, members: 1, leadId: "me", cadence: { zh: "待定", en: "TBD" } }); YL.store.setState("joined", g.id, true); YL.ui.closeModal(); YL.ui.toast(t("post.published"), "success"); draw(); }; } });
          };
        };
        draw();
        return;
      }

      if (sub === "research") {
        let cat = ctx.query.cat || "all";
        const cats = [{ id: "all", label: { zh: "全部", en: "All" } }].concat(YL.store.terms("postCategories"));
        const draw = () => {
          let posts = YL.store.get("posts").filter((p) => cat === "all" || p.category === cat).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const top = YL.store.get("users").slice().sort((a, b) => b.points - a.points).slice(0, 5);
          root.innerHTML = head + `<div class="two-col"><div>
            <div class="row row--between" style="margin-bottom:12px"><p class="muted small" style="margin:0">${t("careers.researchIntro")}</p><button class="btn btn--primary btn--sm" id="btn-post">＋ ${t("post.new")}</button></div>
            ${chips(cats, cat, "cat")}
            <div class="stack">${posts.length ? posts.map(postCard).join("") : YL.ui.emptyState("📝", t("common.noResults"))}</div></div>
            <div class="stack"><div class="card"><div class="card__title">🏆 ${t("careers.leaderboard")}</div><p class="muted small">${t("careers.leaderboardSub")}</p><div class="stack" style="margin-top:8px">${top.map((u, i) => `<a class="person" href="#/directory/u/${u.id}" style="color:inherit"><strong class="muted" style="width:18px">${i + 1}</strong>${avatar(u.name, "sm")}<div style="flex:1"><div class="small"><strong>${esc(L(u.name))}</strong></div><div class="person__sub">${esc(L(u.title))}</div></div><span class="badge">${u.points}</span></a>`).join("")}</div></div>
            <div class="card card--flat" style="background:var(--surface-2);border:0"><div class="small muted">${t("careers.pointsHow")}</div></div></div></div>`;
          $$("[data-cat]").forEach((b) => (b.onclick = () => { cat = b.dataset.cat; draw(); }));
          $("#btn-post").onclick = () => { if (!requireLogin()) return; postForm(cat === "all" ? "industry" : cat, draw); };
        };
        draw();
        return;
      }
      YL.router.navigate("careers/jobs");
    }
  });
  // 对外公开的组件。requireLogin 仅为兼容旧调用保留，新代码请用 YL.auth.requireLogin
  YL.careers = { postCard, postForm, requireLogin };
})();
