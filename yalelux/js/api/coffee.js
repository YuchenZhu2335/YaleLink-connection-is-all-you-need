/* Coffee Chat 内测活动 · 接口（原型版"后端"）—— 下面 12 条 route 就是真实后端要实现的全部契约
   Coffee-chat beta API, implemented in the browser for the prototype; a real backend implements the same 12 routes.

   GET  /coffee/me                        活动配置 + 我的报名资料（未报名为 null）+ 待办 / 未读计数 + 是否管理员
   POST /coffee/profile                   报名 / 修改资料
   POST /coffee/availability              保存我的空闲时段 { slots: ["2026-11-02T10:00", …] }
   GET  /coffee/people?identity=&goal=    参与者总览（需已报名）
   GET  /coffee/people/:id                某人的资料 + 各时段状态（需已报名）
   POST /coffee/bookings                  约一个时段 { hostId, slot, note?, agree: true }
   GET  /coffee/bookings                  我的预约（约人的 + 被约的）与通知
   POST /coffee/bookings/:id/accept       接受（仅被约人）—— 之后双方看到彼此的邮箱与联系方式
   POST /coffee/bookings/:id/decline      婉拒（仅被约人）—— 这个时段也不再开放
   POST /coffee/notices/read              通知全部标为已读
   POST /coffee/feedback                  意见箱 { kind, text }（登录即可，不必报名）
   GET  /coffee/admin                     管理员：统计 + 意见箱（查看也记审计）

   通知：原型写进 coffeeNotices，在"我的预约"里显示；真实后端在同样三个时机（有人约你 / 被接受 / 被婉拒）发邮件。
   隐私：列表与详情只返回公开字段；邮箱、联系方式、线上会议链接只在预约被接受后、只给这两个人。
   并发：真实后端用唯一索引 (event_id, host_id, slot) 保证同一时段只能被约一次。 */
(function () {
  const R = YL.domain.coffee;
  const C = { events: "coffeeEvents", profiles: "coffeeProfiles", bookings: "coffeeBookings", notices: "coffeeNotices", feedback: "coffeeFeedback" };
  const now = () => new Date().toISOString();
  const newId = (prefix) => prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const deny = (res) => {
    const extra = {};
    if (res.reason) extra.reason = res.reason;
    if (res.fields) extra.fields = res.fields;
    return YL.api.fail(res.code, extra);
  };
  const currentEvent = () => YL.store.get(C.events)[0]; // 内测只有一期；多期时按 status / 日期选
  const profileOf = (id) => YL.store.find(C.profiles, id) || null;
  // 原型：学联负责人即管理员；真实版由服务端角色表决定
  const isAdmin = (user) => user.acssyRole === "lead";
  function requireProfile(user) {
    const p = profileOf(user.id);
    if (!p) throw YL.api.fail("forbidden", { reason: "not_registered" });
    return p;
  }

  // 所有参与者都能看到的字段（线下地点公开；线上链接、邮箱、联系方式不公开）
  function publicPerson(p) {
    const u = YL.store.user(p.id);
    return {
      id: p.id, name: p.name || (u && u.name) || p.id, identity: p.identity,
      stage: p.stage, program: p.program, gradYear: p.gradYear, job: p.job, location: p.location,
      interests: p.interests, goals: p.goals || [], meetMode: p.meetMode, meetPlace: p.meetMode === "offline" ? p.meetPlace : ""
    };
  }
  function bookingDTO(b, userId, ev, at) {
    const role = R.roleOf(b, userId);
    const other = profileOf(role === "host" ? b.requesterId : b.hostId), host = profileOf(b.hostId);
    const reveal = R.canSeeContact(b, userId, ev, at);
    return {
      id: b.id, slot: b.slot, note: b.note, createdAt: b.createdAt,
      status: R.bookingStatus(b, ev, at), role, actions: R.allowedActions(b, userId, ev, at),
      other: other ? publicPerson(other) : { id: "", name: { zh: "已退出的参与者", en: "Former participant" } },
      // 见面地点以被约人为准：线下地址一直可见，线上链接接受后可见
      meetMode: host ? host.meetMode : "",
      meetPlace: host && (host.meetMode === "offline" || reveal) ? host.meetPlace : "",
      contact: reveal && other ? { email: other.email, contact: other.contact } : null
    };
  }
  function noticeDTO(n) {
    const actor = profileOf(n.actorId);
    return { id: n.id, kind: n.kind, slot: n.slot, createdAt: n.createdAt, read: !!n.readAt, actor: actor ? publicPerson(actor).name : "" };
  }
  // 站内通知；真实后端在这里同时发邮件（收件人邮箱来自登录时验证过的地址）
  function notify(userId, kind, b) {
    YL.store.add(C.notices, { id: newId("cn"), userId, kind, bookingId: b.id, actorId: kind === "booking_new" ? b.requesterId : b.hostId, slot: b.slot, createdAt: now(), readAt: null });
  }

  YL.api.route("GET", "/coffee/me", (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id, p = profileOf(me);
    const bookings = YL.store.get(C.bookings);
    return {
      event: ev, email: req.user.email, kind: req.user.kind, isAdmin: isAdmin(req.user),
      profile: p ? Object.assign(publicPerson(p), { meetPlace: p.meetPlace, contact: p.contact, email: p.email, slots: p.slots || [] }) : null,
      locked: bookings.filter((b) => b.hostId === me).map((b) => b.slot),
      todo: bookings.filter((b) => b.hostId === me && R.bookingStatus(b, ev, at) === "pending").length,
      unread: YL.store.get(C.notices).filter((n) => n.userId === me && !n.readAt).length
    };
  }, { summary: { zh: "活动配置、我的报名资料、待确认与未读通知数", en: "Event settings, my registration, counts of pending answers and unread notices" } });

  YL.api.route("POST", "/coffee/profile", (req) => {
    const at = now(), me = req.user.id, body = req.body || {};
    const v = R.validateProfile(body, new Date(at).getUTCFullYear());
    if (!v.ok) throw YL.api.fail("invalid", { fields: v.fields });
    const existing = profileOf(me);
    const p = R.buildProfile(body, me, req.user.email, existing, at);
    if (existing) YL.store.patch(C.profiles, me, p);
    else YL.store.add(C.profiles, p);
    return Object.assign(publicPerson(p), { created: !existing });
  }, { summary: { zh: "报名 / 修改资料（邮箱取自登录，不由表单提交）", en: "Register or edit my profile (email comes from the login session)" } });

  YL.api.route("POST", "/coffee/availability", (req) => {
    const me = req.user.id;
    requireProfile(req.user);
    const res = R.applyAvailability(currentEvent(), me, (req.body || {}).slots, YL.store.get(C.bookings));
    if (!res.ok) throw deny(res);
    YL.store.patch(C.profiles, me, { slots: res.slots, updatedAt: now() });
    return { slots: res.slots, locked: res.locked };
  }, { summary: { zh: "保存我的空闲时段（已被约过的时段不能撤回）", en: "Save my free slots (booked slots cannot be withdrawn)" } });

  YL.api.route("GET", "/coffee/people", (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id, { identity, goal } = req.query;
    requireProfile(req.user);
    if ((identity && R.IDENTITIES.indexOf(identity) < 0) || (goal && R.GOALS.indexOf(goal) < 0)) throw YL.api.fail("invalid");
    const bookings = YL.store.get(C.bookings);
    return YL.store.get(C.profiles)
      .filter((p) => p.id !== me && (!identity || p.identity === identity) && (!goal || (p.goals || []).indexOf(goal) >= 0))
      .map((p) => Object.assign(publicPerson(p), { freeSlots: (p.slots || []).filter((s) => R.slotState(ev, p, s, bookings, me, at) === "free").length }))
      .sort((a, b) => (b.freeSlots > 0) - (a.freeSlots > 0));
  }, { summary: { zh: "参与者总览，可按身份 / 诉求筛选（需已报名）", en: "Participants, filterable by identity / goal (registration required)" } });

  YL.api.route("GET", "/coffee/people/:id", (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id;
    requireProfile(req.user);
    const p = profileOf(req.params.id);
    if (!p || p.id === me) throw YL.api.fail("not_found");
    const bookings = YL.store.get(C.bookings);
    return { person: publicPerson(p), slots: (p.slots || []).map((s) => ({ slot: s, state: R.slotState(ev, p, s, bookings, me, at) })) };
  }, { summary: { zh: "某位参与者的资料与时段状态", en: "One participant's profile and slot states" } });

  YL.api.route("POST", "/coffee/bookings", (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id, body = req.body || {};
    const mine = requireProfile(req.user);
    const v = R.validateBooking(body);
    if (!v.ok) throw YL.api.fail("invalid", { fields: v.fields });
    const check = R.checkCanBook({ event: ev, requesterId: me, requester: mine, host: profileOf(String(body.hostId || "")), slot: body.slot, bookings: YL.store.get(C.bookings), now: at });
    if (!check.ok) throw deny(check);
    const b = R.createBooking(body, me, ev.id, at, newId("cb"));
    YL.store.add(C.bookings, b);
    notify(b.hostId, "booking_new", b);
    return bookingDTO(b, me, ev, at);
  }, { summary: { zh: "约一个时段 { hostId, slot, note?, agree: true }；时段从此不再开放", en: "Book a slot { hostId, slot, note?, agree: true }; the slot closes for good" } });

  YL.api.route("GET", "/coffee/bookings", (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id;
    requireProfile(req.user);
    return {
      items: YL.store.get(C.bookings).filter((b) => R.roleOf(b, me)).sort((a, b) => a.slot.localeCompare(b.slot)).map((b) => bookingDTO(b, me, ev, at)),
      notices: YL.store.get(C.notices).filter((n) => n.userId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(noticeDTO)
    };
  }, { summary: { zh: "我的预约（按时间）与最近通知", en: "My bookings (by time) and recent notices" } });

  const SUMMARY = {
    accept: { zh: "接受（仅被约人）：双方互相可见邮箱、联系方式与线上链接", en: "Accept (host only): both sides now see emails, contacts and the call link" },
    decline: { zh: "婉拒（仅被约人）", en: "Decline (host only)" }
  };
  R.ACTIONS.forEach((action) => YL.api.route("POST", "/coffee/bookings/:id/" + action, (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id;
    const b = YL.store.find(C.bookings, req.params.id);
    if (!b) throw YL.api.fail("not_found");
    const res = R.transition(b, action, me, ev, at);
    if (!res.ok) throw deny(res);
    YL.store.patch(C.bookings, b.id, { status: res.next.status, updatedAt: res.next.updatedAt, history: res.next.history });
    notify(b.requesterId, action === "accept" ? "booking_accepted" : "booking_declined", res.next);
    return bookingDTO(res.next, me, ev, at);
  }, { summary: SUMMARY[action] }));

  YL.api.route("POST", "/coffee/notices/read", (req) => {
    const at = now(), me = req.user.id;
    const unread = YL.store.get(C.notices).filter((n) => n.userId === me && !n.readAt);
    unread.forEach((n) => YL.store.patch(C.notices, n.id, { readAt: at }));
    return { read: unread.length };
  }, { summary: { zh: "通知全部标为已读", en: "Mark all notices as read" } });

  YL.api.route("POST", "/coffee/feedback", (req) => {
    const body = req.body || {};
    const v = R.validateFeedback(body);
    if (!v.ok) throw YL.api.fail("invalid", { fields: v.fields });
    const f = { id: newId("cf"), userId: req.user.id, kind: body.kind, text: String(body.text).trim(), createdAt: now() };
    YL.store.add(C.feedback, f);
    return { id: f.id };
  }, { summary: { zh: "意见箱：反馈 bug 或建议 { kind, text }", en: "Feedback box: report a bug or idea { kind, text }" } });

  YL.api.route("GET", "/coffee/admin", (req) => {
    if (!isAdmin(req.user)) throw YL.api.fail("forbidden");
    const ev = currentEvent(), at = now();
    const feedback = YL.store.get(C.feedback).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => {
      const p = profileOf(f.userId), u = YL.store.user(f.userId);
      return { id: f.id, kind: f.kind, text: f.text, createdAt: f.createdAt, from: (p && p.name) || (u && u.name) || f.userId };
    });
    return { stats: R.computeStats(YL.store.get(C.profiles), YL.store.get(C.bookings), feedback.length, ev, at), feedback };
  }, { audit: true, summary: { zh: "管理员：报名与预约统计、意见箱（查看也留痕）", en: "Admin: registration & booking stats and the feedback box (access is logged)" } });

  // —— 仅原型演示：模拟一位参与者来约"我"，让演示者体验被约的一方。真实后端没有这条路由 ——
  YL.api.route("POST", "/coffee/_demo/incoming", (req) => {
    const ev = currentEvent(), at = now(), me = req.user.id, mine = requireProfile(req.user);
    const bookings = YL.store.get(C.bookings);
    for (const p of YL.store.get(C.profiles)) {
      if (p.id === me) continue;
      for (const slot of mine.slots || []) {
        if (!R.checkCanBook({ event: ev, requesterId: p.id, requester: p, host: mine, slot, bookings, now: at }).ok) continue;
        const b = R.createBooking({ hostId: me, slot, note: "Hi! 我也报名了这次内测，想听听你的经历，线上线下都可以 :)" }, p.id, ev.id, at, newId("cb"));
        YL.store.add(C.bookings, b);
        notify(me, "booking_new", b);
        return bookingDTO(b, me, ev, at);
      }
    }
    throw YL.api.fail("conflict", { reason: "no_free_slot" });
  }, { demo: true, summary: { zh: "（演示）模拟一位参与者来约我", en: "(demo) simulate someone booking me" } });
})();
