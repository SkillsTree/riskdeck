/**
 * Ingest operations — every mutation goes through here (CLI and HTTP API share it),
 * so entity updates and their history events are always written together.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadEntities, saveEntities, appendEvent, addNode, setNodeStatus, attachDoc,
  upsertMilestone, upsertDependency, upsertRisk, upsertAsset, findNode, setGoal, BoardError,
} from './store.mjs';
import { parseNote } from './parser.mjs';

export function ingestStatus(dir, { node, design, impl, note, ref, date }) {
  const entities = loadEntities(dir);
  const n = findNode(entities, node);
  if (!n) throw new BoardError(`node not found: ${node}`);
  if (!design && !impl) throw new BoardError('nothing to change: pass --design and/or --impl');
  const { before, after } = setNodeStatus(entities, node, { design, impl });
  saveEntities(dir, entities);
  const out = [];
  if (design && before.design !== after.design) {
    out.push(appendEvent(dir, { type: 'design', node, from: before.design, to: after.design, note: note || `设计状态 ${before.design ?? '—'} → ${after.design}`, ref, date }));
  }
  if (impl && before.impl !== after.impl) {
    out.push(appendEvent(dir, { type: 'impl', node, from: before.impl, to: after.impl, note: note || `实施状态 ${before.impl ?? '—'} → ${after.impl}`, ref, date }));
  }
  if (!out.length && note) out.push(appendEvent(dir, { type: 'note', node, note, ref, date }));
  return { node: n, events: out };
}

export function ingestEvent(dir, evt, opts) {
  const entities = loadEntities(dir);
  if (evt.node && !findNode(entities, evt.node)) {
    const ms = (entities.milestones || []).some(m => m.id === evt.node);
    const reg = evt.type === 'risk' ? (entities.risks || []) : evt.type === 'asset' ? (entities.assets || []) : [];
    const inReg = reg.some(x => x.id === evt.node);
    if (!ms && !inReg) throw new BoardError(`node not found: ${evt.node}`);
  }
  return appendEvent(dir, evt, opts);
}

export function ingestNodeAdd(dir, spec) {
  const entities = loadEntities(dir);
  const node = addNode(entities, spec);
  saveEntities(dir, entities);
  appendEvent(dir, { type: 'note', node: node.id, note: `新建 ${node.kind}「${node.name}」${spec.parent ? `（挂在 ${spec.parent} 下）` : '（顶层项目）'}` });
  return node;
}

export function ingestMilestone(dir, m, note) {
  const entities = loadEntities(dir);
  const { before, after } = upsertMilestone(entities, m);
  saveEntities(dir, entities);
  const evt = before
    ? { type: 'milestone', node: m.node, note: note || `里程碑「${m.name}」更新：${before.status} → ${after.status}（目标 ${after.date}）`, ref: m.evidence }
    : { type: 'milestone', node: m.node, note: note || `新增里程碑「${m.name}」目标 ${after.date}` };
  return appendEvent(dir, evt);
}

export function ingestDependency(dir, d) {
  const entities = loadEntities(dir);
  const { after } = upsertDependency(entities, d);
  saveEntities(dir, entities);
  return appendEvent(dir, { type: 'dependency', node: d.from, note: `新增依赖 ${d.from} → ${d.to}（${after.kind}${after.note ? '：' + after.note : ''}）` });
}

export function ingestDoc(dir, { node, docPath, label, note }) {
  const entities = loadEntities(dir);
  attachDoc(entities, node, docPath, label);
  saveEntities(dir, entities);
  return appendEvent(dir, { type: 'design', node, note: note || `关联设计文档 ${docPath}` });
}

export function ingestNoteFile(dir, file) {
  const raw = fs.readFileSync(file, 'utf8');
  const evt = parseNote(raw, { file: path.basename(file) });
  const entities = loadEntities(dir);
  if (evt.node && !findNode(entities, evt.node)) {
    const isMs = (entities.milestones || []).some(m => m.id === evt.node);
    if (!isMs) throw new BoardError(`${file}: node not found: ${evt.node}`);
  }
  return { evt, rec: appendEvent(dir, evt, { source: 'note:' + path.basename(file) }) };
}

/** HTTP event ingest: optionally sync entity status when type is design/impl with a `to`. */
export function ingestApiEvent(dir, body) {
  const type = String(body.type || 'note');
  if (!['design', 'impl', 'milestone', 'dependency', 'note', 'risk', 'asset', 'gate', 'fte'].includes(type)) {
    throw new BoardError(`unsupported event type: ${type}`);
  }
  if (body.sync && (type === 'design' || type === 'impl') && body.node && body.to) {
    const patch = type === 'design' ? { design: body.to } : { impl: body.to };
    return ingestStatus(dir, { node: body.node, ...patch, note: body.note, ref: body.ref, date: body.date });
  }
  if (body.sync && type === 'risk' && body.node && body.to) {
    return ingestRisk(dir, { id: body.node, status: body.to, title: body.title, category: body.category, note: body.note, date: body.date });
  }
  if (body.sync && type === 'asset' && body.node && body.to) {
    return ingestAsset(dir, { id: body.node, status: body.to, title: body.title, type: body.assetType, note: body.note, date: body.date });
  }
  return { events: [ingestEvent(dir, body, { source: body.source || 'api' })] };
}

/** Upsert a risk + append its lifecycle event (stock in entities, flow in events). */
export function ingestRisk(dir, r) {
  const entities = loadEntities(dir);
  const existing = (entities.risks || []).find(x => x.id === r.id);
  const { before, after } = upsertRisk(entities, {
    ...r,
    status: r.status || existing?.status,
    openedAt: r.date || existing?.openedAt,
  });
  if (before && r.status && before.status === r.status && !r.note) return { risk: after, events: [] };
  saveEntities(dir, entities);
  const evt = {
    type: 'risk', node: after.id, to: after.status,
    note: r.note || (before
      ? `风险「${after.title}」 ${before.status} → ${after.status}`
      : `登记风险「${after.title}」（${after.category}，p×i=${(after.p * after.i).toFixed(1)}）`),
    ...(r.ref ? { ref: r.ref } : {}),
    ...(r.date ? { date: r.date } : {}),
  };
  return { risk: after, events: [appendEvent(dir, evt)] };
}

/** Upsert an asset + append its lifecycle event. Reuse counts ride on `reused`. */
export function ingestAsset(dir, a) {
  const entities = loadEntities(dir);
  const { before, after } = upsertAsset(entities, a);
  if (before && a.status && before.status === a.status && a.reused == null && !a.note) return { asset: after, events: [] };
  saveEntities(dir, entities);
  const reuse = a.reused != null && before && a.reused > (before.reused || 0);
  const evt = {
    type: 'asset', node: after.id, to: after.status,
    note: a.note || (reuse
      ? `资产「${after.title}」复用 +${a.reused - (before.reused || 0)}（累计 ${after.reused} 次）`
      : before
        ? `资产「${after.title}」 ${before.status} → ${after.status}`
        : `沉淀资产「${after.title}」（${after.type}${after.metric ? `，指标 ${after.metric}` : ''}）`),
    ...(a.evidence ? { ref: a.evidence } : {}),
    ...(a.date ? { date: a.date } : {}),
  };
  return { asset: after, events: [appendEvent(dir, evt)] };
}

/** Set goal contract / estimate hours on a node (ceremony scales with granularity: goals only on top levels). */
export function ingestGoal(dir, { node, metric, gate, due, fteBudget, hours, pct, note }) {
  const entities = loadEntities(dir);
  const n = findNode(entities, node);
  if (!n) throw new BoardError(`node not found: ${node}`);
  const before = { ...n.goal };
  setGoal(entities, node, { metric, gate, due, fteBudget, hours, pct });
  saveEntities(dir, entities);
  const parts = [];
  if (metric) parts.push(`指标 ${metric}`);
  if (gate) parts.push(`门禁 ${gate}`);
  if (due) parts.push(`契约 ${due}`);
  if (fteBudget != null && fteBudget !== '') parts.push(`FTE 预算 ${fteBudget}`);
  if (hours != null && hours !== '') parts.push(`估算 ${hours}h`);
  if (pct != null && pct !== '') {
    const leaves = countLeaves(n);
    const derived = leaves ? Math.round(rollupDone(n) / leaves * 100) : 0;
    const eff = Math.max(derived - 20, Math.min(derived + 20, Number(pct)));
    parts.push(`达成度人工修正 ${Number(pct)}%（推导 ${derived}%，生效 ${eff}%，限 ±20pp）`);
  }
  if (parts.length) appendEvent(dir, { type: 'gate', node, note: note || `目标契约更新：${parts.join('，')}` });
  return { node: n, before };
}

function countLeaves(node) {
  const kids = node.children || [];
  if (!kids.length) return 1;
  return kids.reduce((s, k) => s + countLeaves(k), 0);
}
function rollupDone(node) {
  const kids = node.children || [];
  if (!kids.length) {
    const st = (node.impl && node.impl.status && node.impl.status !== 'na') ? node.impl.status : 'todo';
    return ({ todo: 0, wip: 0.5, done: 1, verified: 1 }[st] ?? 0);
  }
  return kids.reduce((s, k) => s + rollupDone(k), 0);
}
