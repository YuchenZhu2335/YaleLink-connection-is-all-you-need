/* 推荐：规则打分取前若干名 → （可选）DeepSeek 在其中重排序并写推荐理由 → 校验 → 缓存到本轮。
   - 没配置 DEEPSEEK_API_KEY、用户关闭了智能推荐、超出每人每天的次数、调用失败或超时、输出不合规 → 一律用规则排序；
   - 关闭了智能推荐、或者没同意当前隐私说明的候选人，资料不会发给大模型（只参与规则排序）；
   - 发给大模型的只有匿名答案（规则见 web/js/domain/coffee.js 的 buildRerankMessages，单测保证不含姓名和联系方式）；
   - 缓存：自己的空闲时间或资料变了就重算；推荐不满（有人被划掉或当时人少）而池子里来了新人，也重算；
   - 每次推荐都存下候选、结果和用了哪种方式，管理页可统计。 */
const RULE_POOL = 12; // 规则阶段取前多少名交给大模型挑
const LLM_PER_DAY = 10; // 每人每天最多调用几次大模型
const llmCalls = new Map();

async function callDeepSeek(ctx, messages) {
  const r = await (ctx.fetch || fetch)(ctx.cfg.deepseekBase + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + ctx.cfg.deepseekKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: ctx.cfg.deepseekModel, messages, temperature: 0.2, max_tokens: 500, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error("deepseek " + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}
function llmBudget(userId) {
  const t = Date.now(), arr = (llmCalls.get(userId) || []).filter((x) => t - x < 86400000);
  if (arr.length >= LLM_PER_DAY) return false;
  arr.push(t); llmCalls.set(userId, arr);
  if (llmCalls.size > 20000) llmCalls.clear();
  return true;
}

// 计算（或读取缓存的）本轮推荐。返回 { engine, items: [{ id, reasons }], dismissed }
// busy 只含"我"自己已约定的时段（不扣别人的，避免从推荐里推断出别人的约定）
async function forUser(ctx, round, me, people, invites, everMatched, busy) {
  const C = ctx.coffee, db = ctx.db, now = new Date().toISOString();
  const part = people.find((p) => p.id === me.id);
  const cached = db.get("SELECT * FROM recommendations WHERE round_id = ? AND user_id = ?", round.id, me.id);
  const readDismissed = () => ctx.json((db.get("SELECT dismissed FROM recommendations WHERE round_id = ? AND user_id = ?", round.id, me.id) || {}).dismissed, []);
  const dismissed = cached ? ctx.json(cached.dismissed, []) : [];
  if (cached && part && cached.created_at && cached.created_at >= part.updatedAt) {
    const items = ctx.json(cached.items, []);
    const short = items.filter((x) => dismissed.indexOf(x.id) < 0).length < round.recCount;
    const newest = db.get("SELECT MAX(updated_at) t FROM participations WHERE round_id = ?", round.id).t || "";
    if (!short || newest <= cached.created_at) return { engine: cached.engine, items, dismissed };
  }
  if (!part) return { engine: "rules", items: [], dismissed };

  const ranked = C.recommend({ round, me: part, people, questions: ctx.questions, invites, everMatched, dismissed, busy, now, k: RULE_POOL });
  const k = round.recCount;
  let items = ranked.slice(0, k).map((x) => ({ id: x.id, reasons: x.reasons }));
  let engine = "rules";
  const smartIds = new Set(db.all("SELECT id FROM users WHERE smart_rec = 1 AND consent_version = ?", ctx.cfg.consentVersion).map((r) => r.id));
  if (ctx.cfg.deepseekKey && smartIds.has(me.id)) {
    const pool = ranked.filter((x) => smartIds.has(x.id)).slice(0, 10);
    if (pool.length > k && llmBudget(me.id)) {
      try {
        const byId = Object.fromEntries(people.map((p) => [p.id, p]));
        const cands = pool.map((x) => Object.assign({}, byId[x.id], { reasons: x.reasons }));
        const picks = C.parseRerank(await callDeepSeek(ctx, C.buildRerankMessages(part, cands, ctx.questions, k, "zh")), cands, k);
        if (!picks) throw new Error("invalid output");
        const chosen = picks.map((p) => ({ id: p.id, reasons: p.reason ? [{ zh: p.reason, en: p.reason }] : (ranked.find((x) => x.id === p.id) || {}).reasons }));
        for (const x of ranked) if (chosen.length < k && !chosen.some((c) => c.id === x.id)) chosen.push({ id: x.id, reasons: x.reasons });
        items = chosen; engine = "deepseek";
      } catch (e) {
        engine = "rules_fallback";
        console.warn("deepseek rerank failed, using rules:", e.message);
      }
    }
  }
  // 写缓存时不动 dismissed（等大模型的这几秒里用户可能刚划掉了某人）
  db.run(`INSERT INTO recommendations (round_id, user_id, engine, items, candidates, dismissed, created_at) VALUES (?, ?, ?, ?, ?, '[]', ?)
          ON CONFLICT (round_id, user_id) DO UPDATE SET engine = excluded.engine, items = excluded.items, candidates = excluded.candidates, created_at = excluded.created_at`,
    round.id, me.id, engine, JSON.stringify(items), JSON.stringify(ranked.map((x) => ({ id: x.id, score: x.score }))), now);
  return { engine, items, dismissed: readDismissed() };
}

module.exports = { forUser, callDeepSeek };
