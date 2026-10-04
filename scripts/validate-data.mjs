#!/usr/bin/env node
/* 零依赖数据校验：JSON 可解析、id 唯一、双语字段齐全、词典 key 一致、引用完整
   Zero-dependency validator for web/data/*.json and web/i18n/*.json. Run: node scripts/validate-data.mjs */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");
const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// 1. 数据文件清单来自 config.js
const config = readFileSync(resolve(root, "config.js"), "utf8");
const m = config.match(/dataFiles:\s*\[([^\]]*)\]/);
if (!m) { err("config.js: dataFiles not found"); }
const files = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
const data = {};
for (const name of files) {
  const p = resolve(root, "data", name + ".json");
  if (!existsSync(p)) { err(`data/${name}.json missing (listed in config.js)`); continue; }
  try { data[name] = readJson(p); } catch (e) { err(`data/${name}.json: invalid JSON — ${e.message}`); }
}

// 2. 双语字段与 id 唯一
const isBi = (v) => v && typeof v === "object" && !Array.isArray(v) && ("zh" in v || "en" in v);
function checkBi(v, path) {
  if (isBi(v)) {
    if (typeof v.zh !== "string" || !v.zh.trim()) err(`${path}.zh missing`);
    if (typeof v.en !== "string" || !v.en.trim()) err(`${path}.en missing`);
    return;
  }
  if (Array.isArray(v)) v.forEach((x, i) => checkBi(x, `${path}[${i}]`));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => checkBi(x, `${path}.${k}`));
}
for (const [name, arr] of Object.entries(data)) {
  if (name === "taxonomy") {
    for (const [group, list] of Object.entries(arr)) {
      if (group.startsWith("_")) continue;
      if (!Array.isArray(list)) { err(`taxonomy.${group} must be an array`); continue; }
      const ids = new Set();
      list.forEach((x, i) => { if (!x.id) err(`taxonomy.${group}[${i}].id missing`); if (ids.has(x.id)) err(`taxonomy.${group} duplicate id ${x.id}`); ids.add(x.id); checkBi(x, `taxonomy.${group}.${x.id}`); });
    }
    continue;
  }
  if (!Array.isArray(arr)) { err(`data/${name}.json must be an array`); continue; }
  const ids = new Set();
  arr.forEach((x, i) => {
    if (!x.id) err(`${name}[${i}].id missing`);
    if (ids.has(x.id)) err(`${name} duplicate id ${x.id}`);
    ids.add(x.id);
    checkBi(x, `${name}.${x.id || i}`);
  });
}

// 3. 引用完整性
const idsOf = (name) => new Set((data[name] || []).map((x) => x.id));
const term = (group) => new Set(((data.taxonomy || {})[group] || []).map((x) => x.id));
const users = idsOf("users"), regions = idsOf("regions");
const ref = (val, set, path, allowNull) => { if (val == null) { if (!allowNull) err(`${path} missing`); return; } if (!set.has(val)) err(`${path} references unknown id "${val}"`); };
(data.users || []).forEach((u) => { ref(u.region, regions, `users.${u.id}.region`); ref(u.school, term("schools"), `users.${u.id}.school`); ref(u.industry, term("industries"), `users.${u.id}.industry`); (u.offers || []).forEach((o) => ref(o, term("offers"), `users.${u.id}.offers`)); (u.skills || []).forEach((s) => ref(s, term("projectNeeds"), `users.${u.id}.skills`)); (u.badges || []).forEach((b) => ref(b, term("badges"), `users.${u.id}.badges`)); });
(data.posts || []).forEach((p) => { ref(p.authorId, users, `posts.${p.id}.authorId`); ref(p.category, term("postCategories"), `posts.${p.id}.category`); });
(data.jobs || []).forEach((j) => { ref(j.region, regions, `jobs.${j.id}.region`); ref(j.industry, term("industries"), `jobs.${j.id}.industry`); ref(j.type, term("jobTypes"), `jobs.${j.id}.type`); ref(j.referrerId, users, `jobs.${j.id}.referrerId`, true); if (!/^\d{4}-\d{2}-\d{2}$/.test(j.deadline || "")) err(`jobs.${j.id}.deadline must be YYYY-MM-DD`); });
(data.events || []).forEach((e) => { ref(e.region, regions, `events.${e.id}.region`); ref(e.type, term("eventTypes"), `events.${e.id}.type`); ref(e.hostId, users, `events.${e.id}.hostId`, true); if (e.circleId) ref(e.circleId, idsOf("circles"), `events.${e.id}.circleId`); if (e.campaignId) ref(e.campaignId, idsOf("campaigns"), `events.${e.id}.campaignId`); if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) err(`events.${e.id}.date must be YYYY-MM-DD`); });
(data.groups || []).forEach((g) => { ref(g.industry, term("industries"), `groups.${g.id}.industry`); ref(g.leadId, users, `groups.${g.id}.leadId`); });
(data.resources || []).forEach((r) => { if (!["startup", "life"].includes(r.kind)) err(`resources.${r.id}.kind must be startup|life`); ref(r.category, term(r.kind === "life" ? "lifeCategories" : "startupCategories"), `resources.${r.id}.category`); if (r.region !== "all") ref(r.region, regions, `resources.${r.id}.region`); ref(r.contributorId, users, `resources.${r.id}.contributorId`, true); });
(data.projects || []).forEach((p) => { ref(p.founderId, users, `projects.${p.id}.founderId`); ref(p.stage, term("stages"), `projects.${p.id}.stage`); ref(p.region, regions, `projects.${p.id}.region`); (p.needs || []).forEach((n) => ref(n, term("projectNeeds"), `projects.${p.id}.needs`)); });
(data.timelines || []).forEach((t) => { ref(t.industry, term("industries"), `timelines.${t.id}.industry`); (t.maintainers || []).forEach((u) => ref(u, users, `timelines.${t.id}.maintainers`)); });
(data.circles || []).forEach((c) => { ref(c.type, term("circleTypes"), `circles.${c.id}.type`); ref(c.leadId, users, `circles.${c.id}.leadId`); if (c.region && c.region !== "all") ref(c.region, regions, `circles.${c.id}.region`); });
const depts = new Set([...config.matchAll(/acssyDepartments:\s*\[([^\]]*)\]/g)].flatMap((x) => [...x[1].matchAll(/"([^"]+)"/g)].map((y) => y[1])));
(data.playbooks || []).forEach((pb) => { ref(pb.category, term("eventTypes"), `playbooks.${pb.id}.category`); ref(pb.maintainerId, users, `playbooks.${pb.id}.maintainerId`); (pb.templateIds || []).forEach((t) => ref(t, idsOf("templates"), `playbooks.${pb.id}.templateIds`)); (pb.contactIds || []).forEach((k) => ref(k, idsOf("contacts"), `playbooks.${pb.id}.contactIds`)); (pb.phases || []).forEach((ph) => (ph.tasks || []).forEach((tk, i) => { ref(tk.role, depts, `playbooks.${pb.id}.${ph.id}.tasks[${i}].role`); if (typeof tk.days !== "number") err(`playbooks.${pb.id}.${ph.id}.tasks[${i}].days must be a number`); })); });
(data.campaigns || []).forEach((c) => { ref(c.leadId, users, `campaigns.${c.id}.leadId`); ref(c.playbookId, idsOf("playbooks"), `campaigns.${c.id}.playbookId`); ref(c.department, depts, `campaigns.${c.id}.department`); if (c.eventId) ref(c.eventId, idsOf("events"), `campaigns.${c.id}.eventId`); (c.memberIds || []).forEach((u) => ref(u, users, `campaigns.${c.id}.memberIds`)); const tids = new Set(); (c.tasks || []).forEach((tk) => { if (tids.has(tk.id)) err(`campaigns.${c.id} duplicate task id ${tk.id}`); tids.add(tk.id); ref(tk.assigneeId, users, `campaigns.${c.id}.tasks.${tk.id}.assigneeId`, true); ref(tk.role, depts, `campaigns.${c.id}.tasks.${tk.id}.role`); if (!["todo", "doing", "done"].includes(tk.status)) err(`campaigns.${c.id}.tasks.${tk.id}.status invalid`); }); });
(data.contacts || []).forEach((k) => { ref(k.kind, term("contactKinds"), `contacts.${k.id}.kind`); ref(k.ownerId, users, `contacts.${k.id}.ownerId`, true); });
(data.templates || []).forEach((t) => { ref(t.kind, term("templateKinds"), `templates.${t.id}.kind`); ref(t.maintainerId, users, `templates.${t.id}.maintainerId`, true); });

// 4. 词典一致 + 模块中使用的 key 都存在
const zh = readJson(resolve(root, "i18n/zh.json")), en = readJson(resolve(root, "i18n/en.json"));
for (const k of Object.keys(zh)) if (!(k in en)) err(`i18n: "${k}" in zh.json but not en.json`);
for (const k of Object.keys(en)) if (!(k in zh)) err(`i18n: "${k}" in en.json but not zh.json`);
import { readdirSync } from "node:fs";
const used = new Set(), prefixes = new Set();
for (const dir of ["js/core", "js/domain", "js/api", "js/modules", "js"]) if (existsSync(resolve(root, dir))) for (const f of readdirSync(resolve(root, dir))) if (f.endsWith(".js")) {
  const src = readFileSync(resolve(root, dir, f), "utf8");
  for (const x of src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\s*[,)]/g)) used.add(x[1]);
  for (const x of src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\s*\+/g)) prefixes.add(x[1]);
  for (const x of src.matchAll(/(?:labelKey|descriptionKey):\s*"([a-zA-Z0-9_.]+)"/g)) used.add(x[1]);
}
for (const k of used) if (!(k in zh)) err(`i18n: key "${k}" used in code but missing from zh.json`);
for (const p of prefixes) if (!Object.keys(zh).some((k) => k.startsWith(p))) err(`i18n: no key starts with dynamic prefix "${p}"`);
for (const k of Object.keys(zh)) { const inUse = used.has(k) || [...prefixes].some((p) => k.startsWith(p)) || /^home\.quick\./.test(k); if (!inUse) warn(`i18n: "${k}" defined but never used`); }

// 报告
const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v).length]));
console.log("collections:", JSON.stringify(counts));
console.log(`i18n keys: zh ${Object.keys(zh).length}, en ${Object.keys(en).length}, used in code ${used.size}`);
warnings.forEach((w) => console.log("warn:", w));
if (errors.length) { errors.forEach((e) => console.error("error:", e)); console.error(`\n${errors.length} error(s)`); process.exit(1); }
console.log("✔ data and dictionaries valid");
