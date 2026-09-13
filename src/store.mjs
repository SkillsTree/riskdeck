/**
 * riskdeck data layer.
 *
 * A board is a directory holding:
 *   entities.json  — current structural truth (projects/dependencies/milestones/backlog)
 *   events.jsonl   — append-only history stream; one JSON object per line
 *
 * The store is file-backed and synchronous by design (single user, local first).
 * Storage behind these functions can be swapped (sqlite/server) without touching callers.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const KIND_RANK = { project: 0, module: 1, feature: 2, interface: 3 };
export const DESIGN_STATUS = ['draft', 'reviewed', 'approved', 'deprecated'];
export const IMPL_STATUS = ['todo', 'wip', 'done', 'verified', 'na'];
export const MILESTONE_STATUS = ['planned', 'at-risk', 'hit', 'missed'];
export const DEP_KINDS = ['depends', 'calls', 'imports', 'data', 'deploy', 'uses'];
export const EVENT_TYPES = ['design', 'impl', 'milestone', 'dependency', 'note', 'risk', 'asset', 'gate', 'fte'];
export const RISK_CATEGORIES = ['schedule', 'resource', 'problem', 'quality'];
export const RISK_STATUS = ['open', 'mitigating', 'resolved', 'accepted'];
export const ASSET_TYPES = ['process', 'tool', 'knowledge', 'template', 'data'];
export const ASSET_STATUS = ['proposed', 'deposited', 'adopted', 'retired'];
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class BoardError extends Error {}

/* ---------------- board lifecycle ---------------- */

export function boardDir(dir) { return path.resolve(dir); }
export function entitiesPath(dir) { return path.join(boardDir(dir), 'entities.json'); }
export function eventsPath(dir) { return path.join(boardDir(dir), 'events.jsonl'); }

export function initBoard(dir, { title = '未命名看板' } = {}) {
  fs.mkdirSync(boardDir(dir), { recursive: true });
  if (fs.existsSync(entitiesPath(dir))) throw new BoardError(`board already exists at ${dir}`);
  const entities = {
    schemaVersion: 2,
    title,
    generatedAt: today(),
    projects: [],
    dependencies: [],
    milestones: [],
    backlog: [],
    risks: [],
    assets: [],
    meta: { createdAt: new Date().toISOString(), version: 0 },
  };
  fs.writeFileSync(entitiesPath(dir), JSON.stringify(entities, null, 2) + '\n');
  fs.writeFileSync(eventsPath(dir), '');
  return entities;
}

export function boardExists(dir) { return fs.existsSync(entitiesPath(dir)); }

export function loadEntities(dir) {
  try {
    return JSON.parse(fs.readFileSync(entitiesPath(dir), 'utf8'));
  } catch (e) {
    throw new BoardError(`cannot read entities.json in ${dir}: ${e.message}`);
  }
}

export function saveEntities(dir, entities) {
  entities.meta = { ...(entities.meta || {}), version: ((entities.meta?.version) || 0) + 1, updatedAt: new Date().toISOString() };
  atomicWrite(entitiesPath(dir), JSON.stringify(entities, null, 2) + '\n');
}

export function readEvents(dir) {
  const text = fs.readFileSync(eventsPath(dir), 'utf8');
  const out = [];
  for (const [i, line] of text.split('\n').entries()) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); }
    catch { throw new BoardError(`events.jsonl line ${i + 1} is not valid JSON`); }
  }
  return out;
}

/** Append one event. Append-only: callers must never rewrite the file. */
export function appendEvent(dir, evt, { source = 'cli' } = {}) {
  const rec = {
    id: crypto.randomBytes(6).toString('hex'),
    ts: new Date().toISOString(),
    date: evt.date || today(),
    type: evt.type,
    node: evt.node || undefined,
    from: evt.from || undefined,
    to: evt.to || undefined,
    note: evt.note,
    ref: evt.ref || undefined,
    source,
  };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  if (!DATE_RE.test(rec.date)) throw new BoardError(`event date must be YYYY-MM-DD: ${rec.date}`);
  if (!EVENT_TYPES.includes(rec.type)) throw new BoardError(`event type must be one of ${EVENT_TYPES.join('|')}`);
  if (!rec.note) throw new BoardError('event note is required (history must stay self-explanatory)');
  fs.appendFileSync(eventsPath(dir), JSON.stringify(rec) + '\n');
  return rec;
}

/* ---------------- node helpers ---------------- */

export function collectNodes(entities) {
  const byId = new Map(); const parentOf = new Map(); const depthOf = new Map();
  const visit = (list, depth, parent) => {
    for (const n of list) {
      if (byId.has(n.id)) throw new BoardError(`duplicate node id: ${n.id}`);
      byId.set(n.id, n); parentOf.set(n.id, parent); depthOf.set(n.id, depth);
      if (n.children) visit(n.children, depth + 1, n.id);
    }
  };
  visit(entities.projects || [], 0, null);
  return { byId, parentOf, depthOf };
}

export function findNode(entities, id) {
  return collectNodes(entities).byId.get(id) || null;
}

/** Add a node under a parent (omit parent for a new project). */
export function addNode(entities, { kind, id, name, parent, summary, owner, tags }) {
  if (!(kind in KIND_RANK)) throw new BoardError(`unknown kind: ${kind}`);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id || '')) throw new BoardError(`bad id "${id}" (kebab-case)`);
  if (!name) throw new BoardError('name is required');
  if (findNode(entities, id)) throw new BoardError(`id already exists: ${id}`);
  const node = { id, name, kind, children: KIND_RANK[kind] < 3 ? [] : undefined };
  if (summary) node.summary = summary;
  if (owner) node.owner = owner;
  if (tags) node.tags = tags;
  delete node.children;
  if (!parent) {
    if (kind !== 'project') throw new BoardError('only kind=project can be top-level; pass --parent');
    node.children = [];
    entities.projects.push(node);
  } else {
    const p = findNode(entities, parent);
    if (!p) throw new BoardError(`parent not found: ${parent}`);
    if (KIND_RANK[kind] <= KIND_RANK[p.kind]) throw new BoardError(`kind "${kind}" cannot nest under "${p.kind}"`);
    p.children = p.children || [];
    p.children.push(node);
  }
  return node;
}

/** Set design/impl status on a node; returns {before, after} for event recording. */
export function setNodeStatus(entities, id, { design, impl }) {
  const n = findNode(entities, id);
  if (!n) throw new BoardError(`node not found: ${id}`);
  const before = { design: n.design?.status, impl: n.impl?.status };
  if (design) {
    if (!DESIGN_STATUS.includes(design)) throw new BoardError(`design status must be ${DESIGN_STATUS.join('|')}`);
    n.design = { ...(n.design || {}), status: design };
  }
  if (impl) {
    if (!IMPL_STATUS.includes(impl)) throw new BoardError(`impl status must be ${IMPL_STATUS.join('|')}`);
    n.impl = { ...(n.impl || {}), status: impl };
  }
  return { before, after: { design: n.design?.status, impl: n.impl?.status } };
}

/** Set goal contract fields and/or estimate hours on a node (v2). */
export function setGoal(entities, id, { metric, gate, due, fteBudget, hours, pct }) {
  const n = findNode(entities, id);
  if (!n) throw new BoardError(`node not found: ${id}`);
  if (metric) n.goal = { ...(n.goal || {}), metric };
  if (gate) n.goal = { ...(n.goal || {}), gate };
  if (due) {
    if (!DATE_RE.test(due)) throw new BoardError(`goal due must be YYYY-MM-DD: ${due}`);
    n.goal = { ...(n.goal || {}), due };
  }
  if (fteBudget != null && fteBudget !== '') n.goal = { ...(n.goal || {}), fteBudget: Number(fteBudget) };
  if (hours != null && hours !== '') {
    if (!(Number(hours) >= 0)) throw new BoardError('estimate hours must be >= 0');
    n.estimateHours = Number(hours);
  }
  if (pct != null && pct !== '') {
    const v = Number(pct);
    if (!(v >= 0 && v <= 100)) throw new BoardError('progress override must be 0..100');
    n.progressOverride = v;
  }
  return n;
}

export function attachDoc(entities, id, docPath, label) {
  const n = findNode(entities, id);
  if (!n) throw new BoardError(`node not found: ${id}`);
  n.design = n.design || {};
  n.design.docs = n.design.docs || [];
  if (n.design.docs.some(d => d.path === docPath)) throw new BoardError(`doc already attached: ${docPath}`);
  n.design.docs.push({ path: docPath, ...(label ? { label } : {}) });
  return n.design.docs;
}

export function upsertMilestone(entities, m) {
  if (!m.id || !m.node || !m.name || !m.date || !m.status) throw new BoardError('milestone needs id/node/name/date/status');
  if (!DATE_RE.test(m.date)) throw new BoardError(`milestone date must be YYYY-MM-DD: ${m.date}`);
  if (!MILESTONE_STATUS.includes(m.status)) throw new BoardError(`milestone status must be ${MILESTONE_STATUS.join('|')}`);
  if (!findNode(entities, m.node)) throw new BoardError(`milestone node not found: ${m.node}`);
  const list = entities.milestones || (entities.milestones = []);
  const i = list.findIndex(x => x.id === m.id);
  const clean = {
    id: m.id, node: m.node, name: m.name, date: m.date, status: m.status,
    ...(m.criteria ? { criteria: m.criteria } : {}),
    ...(m.evidence ? { evidence: m.evidence } : {}),
  };
  if (i >= 0) { const old = list[i]; list[i] = clean; return { before: old, after: clean }; }
  list.push(clean); return { before: null, after: clean };
}

export function upsertDependency(entities, d) {
  if (!d.from || !d.to) throw new BoardError('dependency needs from/to');
  if (d.kind && !DEP_KINDS.includes(d.kind)) throw new BoardError(`dependency kind must be ${DEP_KINDS.join('|')}`);
  const list = entities.dependencies || (entities.dependencies = []);
  const i = list.findIndex(x => x.from === d.from && x.to === d.to);
  const clean = { from: d.from, to: d.to, kind: d.kind || 'depends', ...(d.note ? { note: d.note } : {}) };
  if (i >= 0) { const old = list[i]; list[i] = clean; return { before: old, after: clean }; }
  list.push(clean); return { before: null, after: clean };
}

/* ---------------- risks & assets registries (schema v2, additive) ---------------- */

/** Upsert a risk. p=probability 0..1, i=impact (arbitrary scale, e.g. 1-100). */
export function upsertRisk(entities, r) {
  if (!r.id || !r.title || !r.category) throw new BoardError('risk needs id/title/category');
  if (!RISK_CATEGORIES.includes(r.category)) throw new BoardError(`risk category must be ${RISK_CATEGORIES.join('|')}`);
  if (r.status && !RISK_STATUS.includes(r.status)) throw new BoardError(`risk status must be ${RISK_STATUS.join('|')}`);
  const p = Number(r.p ?? 0.5), i = Number(r.i ?? 10);
  if (!(p >= 0 && p <= 1)) throw new BoardError('risk p must be within 0..1');
  if (!(i > 0)) throw new BoardError('risk i must be > 0');
  if (r.review && !DATE_RE.test(r.review)) throw new BoardError(`risk review must be YYYY-MM-DD: ${r.review}`);
  if (r.node && !findNode(entities, r.node)) throw new BoardError(`risk node not found: ${r.node}`);
  const list = entities.risks || (entities.risks = []);
  const idx = list.findIndex(x => x.id === r.id);
  const clean = {
    id: r.id, title: r.title, category: r.category,
    p, i,
    status: r.status || 'open',
    ...(r.owner ? { owner: r.owner } : {}),
    ...(r.node ? { node: r.node } : {}),
    ...(r.review ? { review: r.review } : {}),
    ...(r.mitigation ? { mitigation: r.mitigation } : {}),
    ...(r.note ? { note: r.note } : {}),
    openedAt: (idx >= 0 && list[idx].openedAt) || r.openedAt || today(),
    ...(r.resolvedAt ? { resolvedAt: r.resolvedAt } : {}),
  };
  if (idx >= 0) { const old = list[idx]; list[idx] = clean; return { before: old, after: clean }; }
  list.push(clean); return { before: null, after: clean };
}

/** Upsert an asset (accumulable output). Benefit is only counted when status=adopted. */
export function upsertAsset(entities, a) {
  if (!a.id || !a.title || !a.type) throw new BoardError('asset needs id/title/type');
  if (!ASSET_TYPES.includes(a.type)) throw new BoardError(`asset type must be ${ASSET_TYPES.join('|')}`);
  if (a.status && !ASSET_STATUS.includes(a.status)) throw new BoardError(`asset status must be ${ASSET_STATUS.join('|')}`);
  if (a.node && !findNode(entities, a.node)) throw new BoardError(`asset node not found: ${a.node}`);
  if (a.reused != null && !(Number(a.reused) >= 0)) throw new BoardError('asset reused must be >= 0');
  const list = entities.assets || (entities.assets = []);
  const idx = list.findIndex(x => x.id === a.id);
  const clean = {
    id: a.id, title: a.title, type: a.type,
    status: a.status || 'proposed',
    ...(a.scope ? { scope: a.scope } : {}),
    ...(a.node ? { node: a.node } : {}),
    ...(a.metric ? { metric: a.metric } : {}),
    ...(a.baseline ? { baseline: a.baseline } : {}),
    ...(a.value != null && a.value !== '' ? { value: a.value } : {}),
    ...(a.unit ? { unit: a.unit } : {}),
    ...(a.evidence ? { evidence: a.evidence } : {}),
    ...(a.reused != null && a.reused !== '' ? { reused: Number(a.reused) } : {}),
    ...(a.note ? { note: a.note } : {}),
    createdAt: (idx >= 0 && list[idx].createdAt) || a.createdAt || today(),
  };
  if (idx >= 0) { const old = list[idx]; list[idx] = clean; return { before: old, after: clean }; }
  list.push(clean); return { before: null, after: clean };
}

/* ---------------- validation ---------------- */

export function validateBoard(entities) {
  const errors = [];
  if (entities.schemaVersion !== 1 && entities.schemaVersion !== 2) errors.push('schemaVersion must be 1 or 2');
  if (!Array.isArray(entities.projects)) errors.push('projects must be an array');

  const byId = new Map();
  const visit = (list, depth, parent) => {
    for (const n of list) {
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(n.id ?? '')) errors.push(`bad node id: ${JSON.stringify(n.id)}`);
      if (byId.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
      byId.set(n.id, n);
      if (!(n.kind in KIND_RANK)) errors.push(`${n.id}: unknown kind ${JSON.stringify(n.kind)}`);
      if (parent && KIND_RANK[n.kind] <= KIND_RANK[parent.kind]) errors.push(`${n.id}: kind "${n.kind}" cannot nest under "${parent.kind}"`);
      if (depth === 0 && n.kind !== 'project') errors.push(`${n.id}: top-level nodes must be kind=project`);
      if (n.design?.status && !DESIGN_STATUS.includes(n.design.status)) errors.push(`${n.id}: bad design.status`);
      if (n.impl?.status && !IMPL_STATUS.includes(n.impl.status)) errors.push(`${n.id}: bad impl.status`);
      if (n.estimateHours != null && !(Number(n.estimateHours) >= 0)) errors.push(`${n.id}: estimateHours must be >= 0`);
      if (n.progressOverride != null && !(Number(n.progressOverride) >= 0 && Number(n.progressOverride) <= 100)) errors.push(`${n.id}: progressOverride must be 0..100`);
      if (n.goal) {
        if (n.goal.due && !DATE_RE.test(n.goal.due)) errors.push(`${n.id}: goal.due must be YYYY-MM-DD`);
        if (n.goal.fteBudget != null && !(Number(n.goal.fteBudget) >= 0)) errors.push(`${n.id}: goal.fteBudget must be >= 0`);
      }
      if (n.children) visit(n.children, depth + 1, n);
    }
  };
  visit(entities.projects || [], 0, null);

  const adj = new Map();
  for (const d of entities.dependencies || []) {
    for (const end of ['from', 'to']) {
      if (!byId.has(d[end])) errors.push(`dependency ${d.from} -> ${d.to}: unknown ${end} "${d[end]}"`);
    }
    if (byId.has(d.from) && byId.has(d.to)) {
      if (!adj.has(d.from)) adj.set(d.from, []);
      adj.get(d.from).push(d.to);
    }
  }
  const color = new Map(); const stack = [];
  const dfs = (id) => {
    color.set(id, 1); stack.push(id);
    for (const nxt of adj.get(id) || []) {
      const c = color.get(nxt) || 0;
      if (c === 1) errors.push(`dependency cycle: ${[...stack.slice(stack.indexOf(nxt)), nxt].join(' -> ')}`);
      else if (c === 0) dfs(nxt);
    }
    stack.pop(); color.set(id, 2);
  };
  for (const id of byId.keys()) if (!(color.get(id) || 0)) dfs(id);

  const msIds = new Set();
  for (const m of entities.milestones || []) {
    msIds.add(m.id);
    if (!byId.has(m.node)) errors.push(`milestone ${m.id}: unknown node "${m.node}"`);
    if (!MILESTONE_STATUS.includes(m.status)) errors.push(`milestone ${m.id}: bad status`);
    if (!DATE_RE.test(m.date || '')) errors.push(`milestone ${m.id}: bad date`);
  }
  for (const b of entities.backlog || []) {
    if (b.node && !byId.has(b.node)) errors.push(`backlog "${b.title}": unknown node "${b.node}"`);
  }
  const riskIds = new Set(); const assetIds = new Set();
  for (const r of entities.risks || []) {
    riskIds.add(r.id);
    if (!RISK_CATEGORIES.includes(r.category)) errors.push(`risk ${r.id}: bad category`);
    if (!RISK_STATUS.includes(r.status)) errors.push(`risk ${r.id}: bad status`);
    if (r.node && !byId.has(r.node)) errors.push(`risk ${r.id}: unknown node "${r.node}"`);
    if (r.review && !DATE_RE.test(r.review)) errors.push(`risk ${r.id}: bad review date`);
  }
  for (const a of entities.assets || []) {
    assetIds.add(a.id);
    if (!ASSET_TYPES.includes(a.type)) errors.push(`asset ${a.id}: bad type`);
    if (!ASSET_STATUS.includes(a.status)) errors.push(`asset ${a.id}: bad status`);
    if (a.node && !byId.has(a.node)) errors.push(`asset ${a.id}: unknown node "${a.node}"`);
  }
  for (const e of readEventsSafe(entities.__dir)) {
    const okRef = (e.node && byId.has(e.node)) || (e.node && msIds.has(e.node))
      || (e.type === 'risk' && e.node && riskIds.has(e.node))
      || (e.type === 'asset' && e.node && assetIds.has(e.node));
    if (e.node && !okRef) errors.push(`event ${e.id}: unknown node "${e.node}"`);
  }
  return errors;
}

function readEventsSafe(dir) {
  try { return dir ? readEvents(dir) : []; } catch { return []; }
}

/** Validate with an events dir bound (server/CLI pass dir explicitly). */
export function validateBoardDir(dir) {
  const entities = loadEntities(dir);
  entities.__dir = boardDir(dir);
  return { entities, errors: validateBoard(entities) };
}

/* ---------------- rollups (single source shared by CLI & UI) ---------------- */

export function rollup(node) {
  const kids = node.children || [];
  if (!kids.length) {
    const st = (node.impl && node.impl.status && node.impl.status !== 'na') ? node.impl.status : 'todo';
    const w = { todo: 0, wip: 0.5, done: 1, verified: 1 }[st] ?? 0;
    return { leaves: 1, done: w, counts: { [st]: 1 }, design: node.design ? node.design.status : null };
  }
  const a = { leaves: 0, done: 0, counts: {}, design: null };
  const DO = { draft: 0, reviewed: 1, approved: 2, deprecated: 3 };
  for (const k of kids) {
    const r = rollup(k); a.leaves += r.leaves; a.done += r.done;
    for (const s in r.counts) a.counts[s] = (a.counts[s] || 0) + r.counts[s];
    if (r.design && (a.design === null || DO[r.design] < DO[a.design])) a.design = r.design;
  }
  return a;
}

/* ---------------- import legacy board.json ---------------- */

export function importBoard(dir, legacy) {
  if (!boardExists(dir)) initBoard(dir, { title: legacy.title });
  const entities = loadEntities(dir);
  entities.title = entities.title === '未命名看板' ? (legacy.title || entities.title) : entities.title;
  if (legacy.description) entities.meta.description = legacy.description;
  entities.projects = legacy.projects || [];
  entities.dependencies = legacy.dependencies || [];
  entities.milestones = legacy.milestones || [];
  entities.backlog = legacy.backlog || [];
  entities.generatedAt = legacy.generatedAt || today();
  saveEntities(dir, entities);
  return entities;
}

/* ---------------- misc ---------------- */

export function snapshot(dir, { eventsLimit } = {}) {
  const entities = loadEntities(dir);
  const events = readEvents(dir);
  const board = { ...entities };
  delete board.meta;
  return {
    board,
    meta: entities.meta || {},
    events: eventsLimit ? events.slice(-eventsLimit) : events,
    hash: crypto.createHash('sha1').update(JSON.stringify({ v: entities.meta?.version, n: events.length, t: events.at(-1)?.ts })).digest('hex').slice(0, 10),
  };
}

export function today() { return new Date().toISOString().slice(0, 10); }

function atomicWrite(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
