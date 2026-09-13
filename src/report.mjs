/**
 * report — periodic projection over the board ("报告是查询，不是考古").
 *
 * A report is a read-only projection of entities + events over a date window:
 *   - 项目行: 里程碑/目标达成/四类风险存量+流量/资产/FTE 占位
 *   - 风险:   台账 + 存量流量 + 高危触发器（暴露值/关键问题/复审逾期/无主/老化）
 *   - 资产:   沉淀/投产/复用，收益仅在 adopted 且带基线时计入量化汇总
 *
 * Numbers are computed here and never hand-written downstream (authorship discipline:
 * 数字由投影层计算，散文由 AI 起草，判断由人添加).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEntities, readEvents, collectNodes, rollup, today } from './store.mjs';

export const RISK_LABELS = {
  schedule: '进度', resource: '资源', problem: '关键问题', quality: '质量',
};
export const RISK_STATUS_LABELS = {
  open: '未决', mitigating: '缓解中', resolved: '已解决', accepted: '已接受',
};
export const ASSET_LABELS = {
  process: '流程规范', tool: '工具', knowledge: '经验', template: '模板', data: '数据',
};
export const ASSET_STATUS_LABELS = {
  proposed: '提出', deposited: '已沉淀', adopted: '已投产', retired: '退役',
};
export const HIGH_EXPOSURE_DEFAULT = 20;
export const STALE_DAYS_DEFAULT = 14;

const IMPL_DONE = new Set(['done', 'verified']);

/* ---------------- date helpers ---------------- */

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/* ---------------- projection ---------------- */

export function buildReport(dir, { from, to, highExposure = HIGH_EXPOSURE_DEFAULT, staleDays = STALE_DAYS_DEFAULT } = {}) {
  const entities = loadEntities(dir);
  const events = readEvents(dir);
  to = to || events.at(-1)?.date || today();
  from = from || addDays(to, -29);
  const winLen = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -winLen);
  const prevTo = addDays(from, -1);
  const now = today();

  const inWin = (e) => e.date >= from && e.date <= to;
  const inPrev = (e) => e.date >= prevFrom && e.date <= prevTo;
  const { byId, parentOf } = collectNodes(entities);

  const subtreeIds = (rootId) => {
    const ids = new Set([rootId]);
    for (const [id, parent] of parentOf) {
      if (ids.has(parent)) ids.add(id); // parentOf is depth-ordered by visit order
    }
    // parentOf built in DFS order guarantees ancestors seen before children
    return ids;
  };

  /* ---- risks: registry + lifecycle flow from events ---- */
  const risks = (entities.risks || []).map(r => ({ ...r }));
  const riskById = new Map(risks.map(r => [r.id, r]));
  const riskFlow = { opened: 0, resolved: 0 };
  const riskFlowPrev = { opened: 0, resolved: 0 };
  const lastRiskEvent = new Map();
  for (const e of events) {
    if (e.type !== 'risk' || !e.node) continue;
    const prev = lastRiskEvent.get(e.node);
    if (!prev || e.date >= prev.date) lastRiskEvent.set(e.node, e);
    if (e.to === 'open' || e.to === 'mitigating') {
      if (!prev || prev.to === 'resolved' || prev.to === 'accepted') {
        if (inWin(e)) riskFlow.opened++;
        else if (inPrev(e)) riskFlowPrev.opened++;
      }
    }
    if (e.to === 'resolved' || e.to === 'accepted') {
      if (inWin(e)) riskFlow.resolved++;
      else if (inPrev(e)) riskFlowPrev.resolved++;
    }
  }
  const stockByCat = { schedule: 0, resource: 0, problem: 0, quality: 0 };
  const stockByCatPrev = extrapolateStock(risks, events, prevTo);
  let exposure = 0;
  const openRisks = [];
  for (const r of risks) {
    if (r.status === 'open' || r.status === 'mitigating') {
      stockByCat[r.category]++;
      exposure += (r.p || 0) * (r.i || 0);
      openRisks.push(r);
    }
  }
  const highRisks = openRisks.map((r) => {
    const triggers = [];
    if ((r.p || 0) * (r.i || 0) >= highExposure) triggers.push(`暴露值≥${highExposure}`);
    if (r.category === 'problem') triggers.push('关键问题类');
    if (r.review && r.review < now) triggers.push(`复审逾期（${r.review}）`);
    if (!r.owner) triggers.push('无责任人');
    const last = lastRiskEvent.get(r.id);
    if (last && daysBetween(last.date, now) > staleDays) triggers.push(`已 ${daysBetween(last.date, now)} 天无缓解进展`);
    return { ...r, exposure: (r.p || 0) * (r.i || 0), triggers, lastEvent: last?.date || r.openedAt };
  }).filter(r => r.triggers.length).sort((a, b) => b.exposure - a.exposure);

  /* ---- assets ---- */
  const assets = (entities.assets || []).map(a => ({ ...a }));
  const adopted = assets.filter(a => a.status === 'adopted');
  const quantified = adopted.filter(a => a.metric && a.baseline && a.value);
  const assetNewInWin = assets.filter(a => inWin({ date: a.createdAt }));

  /* ---- per-project rows ---- */
  const PCT_BAND = 20; // 人工修正限幅（±20pp），与原型评审决策一致
  /** rollup with override-awareness: leaf progressOverride propagates upward (clamped against own derived). */
  const rollupEff = (node) => {
    const kids = node.children || [];
    if (!kids.length) {
      if (node.progressOverride != null) {
        const own = ({ todo: 0, wip: 50, done: 100, verified: 100, na: 0 })[node.impl?.status || 'todo'] ?? 0;
        const ov = Number(node.progressOverride);
        return { leaves: 1, done: Math.max(own - PCT_BAND, Math.min(own + PCT_BAND, ov)) / 100 };
      }
      const st = (node.impl && node.impl.status && node.impl.status !== 'na') ? node.impl.status : 'todo';
      return { leaves: 1, done: ({ todo: 0, wip: 0.5, done: 1, verified: 1 }[st] ?? 0) };
    }
    let leaves = 0, done = 0;
    for (const k of kids) { const r = rollupEff(k); leaves += r.leaves; done += r.done; }
    return { leaves, done };
  };
  const msProgress = (nodeId) => {
    const n = byId.get(nodeId);
    if (!n) return { done: 0, total: 0 };
    const r = rollup(n);
    return { done: Math.round(r.done), total: r.leaves };
  };
  const laneOf = (c) => {
    const ids = subtreeIds(c.id);
    const r = rollupEff(c);
    const derived = r.leaves ? Math.round((r.done / r.leaves) * 100) : 0;
    const ov = c.progressOverride != null ? Number(c.progressOverride) : null;
    const eff = ov != null ? Math.max(derived - PCT_BAND, Math.min(derived + PCT_BAND, ov)) : derived;
    const leavesDone = [...ids].filter(id => { const n = byId.get(id); return n && !(n.children && n.children.length) && IMPL_DONE.has(n.impl?.status); }).length;
    return {
      id: c.id, name: c.name, kind: c.kind,
      goal: c.goal ? { metric: c.goal.metric || null, gate: c.goal.gate || null, due: c.goal.due || null } : null,
      hasChildren: !!(c.children && c.children.length),
      leavesTotal: r.leaves, leavesDone,
      pctDerived: derived, pctOverride: ov, pct: eff, pctBand: PCT_BAND,
      estimateHours: [...ids].reduce((s, id) => s + (byId.get(id)?.estimateHours || 0), 0),
      riskCount: openRisks.filter(rk => rk.node && ids.has(rk.node)).length,
      riskExposure: openRisks.filter(rk => rk.node && ids.has(rk.node)).reduce((s, rk) => s + (rk.p || 0) * (rk.i || 0), 0),
      milestones: (entities.milestones || []).filter(m => ids.has(m.node)).map(m => ({ id: m.id, name: m.name, date: m.date, status: m.status, ...msProgress(m.node) })),
      nodeId: c.id,
    };
  };
  const projects = (entities.projects || []).map((p) => {
    const ids = subtreeIds(p.id);
    const r = rollup(p);
    const goalNodes = [...ids].map(id => byId.get(id)).filter(n => n && n.goal);
    const goals = goalNodes.map((n) => {
      const done = IMPL_DONE.has(n.impl?.status);
      const evidenced = done && !!n.impl?.evidence;
      return { id: n.id, name: n.name, goal: n.goal, status: n.impl?.status || 'todo', done, evidenced };
    });
    const isLeaf = (id) => { const n = byId.get(id); return n && !(n.children && n.children.length); };
    const goalDone = goals.filter(g => g.done).length;
    const goalDoneWin = events.filter(e => e.type === 'impl' && IMPL_DONE.has(e.to) && ids.has(e.node) && byId.get(e.node)?.goal && inWin(e)).length;
    const taskDone = (r.counts.done || 0) + (r.counts.verified || 0);
    const taskDoneWin = events.filter(e => e.type === 'impl' && IMPL_DONE.has(e.to) && ids.has(e.node) && isLeaf(e.node) && inWin(e)).length;
    const goalDonePrev = events.filter(e => e.type === 'impl' && IMPL_DONE.has(e.to) && ids.has(e.node) && inPrev(e)).length;
    const unverified = goals.filter(g => g.done && !g.evidenced).length;
    const msIn = (entities.milestones || []).filter(m => ids.has(m.node));
    const msCount = { total: msIn.length, hit: 0, missed: 0, atRisk: 0, planned: 0 };
    for (const m of msIn) {
      if (m.status === 'hit') msCount.hit++;
      else if (m.status === 'missed') msCount.missed++;
      else if (m.status === 'at-risk') msCount.atRisk++;
      else msCount.planned++;
    }
    const msSlippedWin = events.filter(e => e.type === 'milestone' && e.to === 'missed' && ids.has(e.node) && inWin(e)).length;
    const catStock = { schedule: 0, resource: 0, problem: 0, quality: 0 };
    let projExposure = 0;
    for (const rk of openRisks) {
      if (rk.node && ids.has(rk.node)) { catStock[rk.category]++; projExposure += (rk.p || 0) * (rk.i || 0); }
    }
    // per-project risk flow: risk id -> its linked node's subtree
    const flow = { opened: 0, resolved: 0 };
    const flowPrev = { opened: 0, resolved: 0 };
    for (const e of events) {
      if (e.type !== 'risk' || !e.node) continue;
      const linked = riskById.get(e.node)?.node;
      if (!linked || !ids.has(linked)) continue;
      if ((e.to === 'open' || e.to === 'mitigating') && inWin(e)) flow.opened++;
      if ((e.to === 'resolved' || e.to === 'accepted') && inWin(e)) flow.resolved++;
      if ((e.to === 'open' || e.to === 'mitigating') && inPrev(e)) flowPrev.opened++;
      if ((e.to === 'resolved' || e.to === 'accepted') && inPrev(e)) flowPrev.resolved++;
    }
    const assetRows = assets.filter(a => (a.node && ids.has(a.node)) || !a.node);
    const estimateHours = [...ids].reduce((s, id) => s + (byId.get(id)?.estimateHours || 0), 0);
    const todoLeaves = countStatus(p, 'todo');
    const wipLeaves = countStatus(p, 'wip');
    const lanes = (p.children || []).map(laneOf);
    const rings = lanes.filter(l => l.goal).map(l => ({ id: l.id, name: l.name, gate: l.goal.gate, due: l.goal.due, pct: l.pct, pctDerived: l.pctDerived, overridden: l.pctOverride != null }));
    const node2lane = {};
    for (const l of lanes) for (const id of subtreeIds(l.id)) node2lane[id] = l.id;
    return {
      id: p.id, name: p.name, rag: computeRag({ msCount, unverified, projExposure, highRisks: highRisks.filter(h => h.node && ids.has(h.node)) }),
      leaves: r.leaves, doneWeight: r.leaves ? r.done / r.leaves : 0,
      msCount, msSlippedWin,
      goalTotal: goals.length, goalDone, goalDoneWin, goalDonePrev, unverified,
      taskDone, taskDoneWin,
      riskStock: catStock, riskFlow: flow, riskFlowPrev: flowPrev, exposure: projExposure,
      assets: { total: assetRows.length, adopted: assetRows.filter(a => a.status === 'adopted').length, reused: assetRows.reduce((s, a) => s + (a.reused || 0), 0) },
      estimateHours, todoLeaves, wipLeaves,
      lanes, rings, node2lane,
    };
  });

  /* ---- window events (appendix) ---- */
  const windowEvents = events.filter(inWin);
  const weekly = burnup(events, from, to, countLeaves(entities));

  /* ---- client-side window recompute support ---- */
  const subtree = {};
  for (const p of entities.projects || []) subtree[p.id] = [...subtreeIds(p.id)];
  const goalIds = [...byId.values()].filter(n => n.goal).map(n => n.id);
  const leafIds = [...byId.values()].filter(n => !(n.children && n.children.length)).map(n => n.id);

  const decisions = [];
  const highIds = new Set(highRisks.map(h => h.id));
  for (const h of highRisks) {
    decisions.push({
      what: h.owner ? `复审风险「${h.title}」` : `指派责任人并复审风险「${h.title}」`,
      why: h.triggers.join('；'),
      risk: h.id, due: h.review || null,
    });
  }
  for (const r of risks) {
    if ((r.status === 'open' || r.status === 'mitigating') && !r.owner && !highIds.has(r.id)) {
      decisions.push({ what: `指派风险「${r.title}」责任人`, why: '无主风险', risk: r.id, due: null });
    }
  }

  return {
    meta: { title: entities.title, from, to, prevFrom, prevTo, generatedAt: now, winLen, schemaVersion: entities.schemaVersion },
    summary: {
      exposure: Math.round(exposure * 10) / 10,
      exposurePrev: Math.round(stockByCatPrev.exposure * 10) / 10,
      riskStock: stockByCat, riskStockPrev: stockByCatPrev.stock, riskFlow, riskFlowPrev,
      highCount: highRisks.length,
      decisions: decisions.length,
      assets: { total: assets.length, adopted: adopted.length, reused: assets.reduce((s, a) => s + (a.reused || 0), 0), quantified: quantified.length },
      unverified: projects.reduce((s, p) => s + p.unverified, 0),
    },
    projects,
    risks: risks.map(r => ({ ...r, exposure: (r.p || 0) * (r.i || 0), labels: { category: RISK_LABELS[r.category], status: RISK_STATUS_LABELS[r.status] } })),
    highRisks,
    assets: assets.map(a => ({ ...a, labels: { type: ASSET_LABELS[a.type], status: ASSET_STATUS_LABELS[a.status] } })),
    milestones: entities.milestones || [],
    backlog: (entities.backlog || []).filter(b => b.status === 'planned'),
    decisions,
    weekly,
    windowEvents,
    events,
    subtree,
    goalIds,
    leafIds,
    config: { highExposure, staleDays },
  };
}

function countLeaves(entities) {
  let n = 0;
  const visit = (list) => { for (const nd of list) (nd.children?.length ? visit(nd.children) : n++); };
  visit(entities.projects || []);
  return n;
}
function countStatus(node, st) {
  const kids = node.children || [];
  if (!kids.length) return (node.impl?.status || 'todo') === st && st !== 'na' ? 1 : 0;
  return kids.reduce((s, k) => s + countStatus(k, st), 0);
}
/** Approximate previous-window-end stock by reverting window events (good-enough for trend chips). */
function extrapolateStock(risks, events, prevTo) {
  const state = new Map(risks.map(r => [r.id, { ...r }]));
  for (const e of events) {
    if (e.type !== 'risk' || !e.node || e.date <= prevTo) continue;
    const s = state.get(e.node);
    if (s && e.from) s.status = e.from;
  }
  const stock = { schedule: 0, resource: 0, problem: 0, quality: 0 };
  let exposure = 0;
  for (const s of state.values()) {
    if (s.status === 'open' || s.status === 'mitigating') { stock[s.category]++; exposure += (s.p || 0) * (s.i || 0); }
  }
  return { stock, exposure };
}
function computeRag({ msCount, unverified, projExposure, highRisks }) {
  if (msCount.missed > 0 || highRisks.some(h => h.category === 'problem') || unverified >= 3) return 'red';
  if (msCount.atRisk > 0 || unverified > 0 || projExposure >= HIGH_EXPOSURE_DEFAULT || highRisks.length > 0) return 'yellow';
  return 'green';
}
function burnup(events, from, to, totalLeaves) {
  const buckets = [];
  const len = daysBetween(from, to) + 1;
  const nb = Math.min(6, Math.max(1, Math.ceil(len / 7)));
  for (let i = 0; i < nb; i++) {
    const start = addDays(from, Math.floor(i * len / nb));
    const end = i === nb - 1 ? to : addDays(from, Math.floor((i + 1) * len / nb) - 1);
    buckets.push({ start, end, done: 0 });
  }
  for (const e of events) {
    if (e.type !== 'impl' || !IMPL_DONE.has(e.to)) continue;
    const b = buckets.find(x => e.date >= x.start && e.date <= x.end);
    if (b) b.done++;
  }
  let acc = 0;
  for (const b of buckets) { acc += b.done; b.cum = acc; }
  return { buckets, totalLeaves };
}

/* ---------------- html renderer (self-contained, interactive detail controls) ---------------- */

export function renderReportHtml(rep) {
  const template = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer', 'report-template.html'), 'utf8');
  return template
    .replace(/__RISKDECK_TITLE__/g, () => rep.meta.title)
    .replace('__RISKDECK_REPORT__', () => JSON.stringify(rep).replace(/<\//g, '<\\/'));
}
export function renderReportToFile(dir, { from, to, md, html } = {}) {
  const rep = buildReport(dir, { from, to });
  let out = { mdPath: null, htmlPath: null, bytes: 0 };
  if (md !== false) {
    const f = md || `report-${rep.meta.to}.md`;
    fs.writeFileSync(f, renderMarkdown(rep)); out.mdPath = f;
  }
  if (html !== false) {
    const f = html || `report-${rep.meta.to}.html`;
    const h = renderReportHtml(rep);
    fs.writeFileSync(f, h); out.htmlPath = f; out.bytes = h.length;
  }
  return { rep, ...out };
}

/* ---------------- markdown renderer ---------------- */

const CATS = ['schedule', 'resource', 'problem', 'quality'];

export function renderMarkdown(rep) {
  const L = [];
  const { meta: m, summary: s } = rep;
  L.push(`# ${m.title} · 阶段汇报`);
  L.push('');
  L.push(`> 窗口 **${m.from} ~ ${m.to}**（${m.winLen} 天）｜上期 ${m.prevFrom} ~ ${m.prevTo}｜生成于 ${m.generatedAt}（riskdeck report 投影，数字均出自事件流）`);
  L.push('');
  L.push('## 结论区');
  L.push('');
  L.push(`- 风险暴露值 **${s.exposure}**（上期 ${s.exposurePrev}，${s.exposure > s.exposurePrev ? '↑ 恶化' : s.exposure < s.exposurePrev ? '↓ 收敛' : '→ 持平'}）；高危风险 **${s.highCount}** 项`);
  L.push(`- 本期风险流动：新增 ${s.riskFlow.opened} / 解决 ${s.riskFlow.resolved}（上期新增 ${s.riskFlowPrev.opened} / 解决 ${s.riskFlowPrev.resolved}）`);
  L.push(`- 资产：累计 ${s.assets.total}（已投产 ${s.assets.adopted}，累计复用 ${s.assets.reused} 次，带基线量化收益 ${s.assets.quantified} 项）`);
  L.push(`- 无证据达成 **${s.unverified}** 项（impl done 但缺 evidence ref）`);
  L.push('');
  if (rep.decisions.length) {
    L.push('**需决策清单**');
    L.push('');
    for (const d of rep.decisions) L.push(`- [${d.risk}] ${d.what}（${d.why}${d.due ? `，截止 ${d.due}` : ''}）`);
    L.push('');
  }
  L.push('## 顶层项目视图');
  L.push('');
  L.push('| 项目 | RAG | 完成度 | 里程碑 | 目标(契约) | 任务达成 | 风险存量(+新增/−解决) | 暴露值 | 资产 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const p of rep.projects) {
    const stock = CATS.map(c => `${RISK_LABELS[c]}${p.riskStock[c]}`).join(' ');
    L.push(`| ${p.name} | ${p.rag} | ${(p.doneWeight * 100).toFixed(0)}% | ${p.msCount.hit}/${p.msCount.total}${p.msCount.atRisk ? ` ⚠${p.msCount.atRisk}` : ''}${p.msCount.missed ? ` ✗${p.msCount.missed}` : ''} | ${p.goalDone}/${p.goalTotal} | ${p.taskDone}/${p.leaves}（+${p.taskDoneWin}） | ${stock} | ${p.exposure.toFixed(1)} | ${p.assets.adopted}/${p.assets.total}·复用${p.assets.reused} |`);
  }
  L.push('');
  L.push('## 高危风险视图');
  L.push('');
  if (!rep.highRisks.length) L.push('（无触发高危条件的风险）');
  for (const h of rep.highRisks) {
    L.push(`- **[${h.id}] ${h.title}**（${RISK_LABELS[h.category]}｜p×i=${h.exposure.toFixed(1)}｜${RISK_STATUS_LABELS[h.status]}）`);
    L.push(`  - 触发：${h.triggers.join('；')}${h.node ? `；关联 ${h.node}` : ''}`);
    if (h.mitigation) L.push(`  - 缓解：${h.mitigation}`);
  }
  L.push('');
  L.push('## 风险台账（存量 + 流量）');
  L.push('');
  L.push('| 类别 | 期末存量 | 上期存量 | 本期新增 | 本期解决/接受 |');
  L.push('|---|---|---|---|---|');
  for (const c of CATS) {
    const opened = rep.windowEvents.filter(e => e.type === 'risk' && (e.to === 'open' || e.to === 'mitigating') && catOf(rep, e.node) === c).length;
    const resolved = rep.windowEvents.filter(e => e.type === 'risk' && (e.to === 'resolved' || e.to === 'accepted') && catOf(rep, e.node) === c).length;
    L.push(`| ${RISK_LABELS[c]} | ${s.riskStock[c]} | ${s.riskStockPrev[c]} | ${opened} | ${resolved} |`);
  }
  L.push('');
  L.push('## 资产产出');
  L.push('');
  if (!rep.assets.length) L.push('（本期无资产登记）');
  for (const a of rep.assets) {
    const benefit = a.status === 'adopted'
      ? (a.metric && a.baseline && a.value ? `收益：${a.metric} ${a.value}${a.unit || ''}（基线 ${a.baseline}，证据 ${a.evidence || '缺失⚠'}）` : '收益：未量化（缺指标/基线）')
      : `状态：${ASSET_STATUS_LABELS[a.status]}（未投产不计收益）`;
    L.push(`- **${a.title}**（${ASSET_LABELS[a.type]}｜复用 ${a.reused || 0} 次）— ${benefit}`);
  }
  L.push('');
  L.push('## 里程碑');
  L.push('');
  for (const ms of rep.milestones) {
    L.push(`- ◆ ${ms.name}（${ms.node}）— ${ms.date}｜${ms.status}${ms.criteria?.length ? `｜验收：${ms.criteria.join('、')}` : ''}`);
  }
  L.push('');
  L.push('## 下期计划（backlog: planned）');
  L.push('');
  if (!rep.backlog.length) L.push('（无已承诺计划项）');
  for (const b of rep.backlog) L.push(`- ${b.title}${b.node ? `（${b.node}）` : ''}`);
  L.push('');
  L.push(`<details><summary>附录：窗口事件流（${rep.windowEvents.length} 条）</summary>`);
  L.push('');
  for (const e of rep.windowEvents.slice(-100)) {
    L.push(`- ${e.date} [${e.type}]${e.node ? ` ${e.node}` : ''} ${e.note}${e.ref ? `（${e.ref}）` : ''}`);
  }
  L.push('');
  L.push('</details>');
  L.push('');
  L.push('---');
  L.push('');
  L.push('*FTE 实投/容量对账：待工时系统 API 接入后启用（schema 已预留 goal.fteBudget / estimateHours）。*');
  return L.join('\n');

  function catOf(rep2, riskId) { return rep2.risks.find(r => r.id === riskId)?.category; }
}
