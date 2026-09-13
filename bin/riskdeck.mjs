#!/usr/bin/env node
/**
 * riskdeck — continuously-ingested project tracking board.
 *
 * Data: a board directory holds entities.json (current truth) + events.jsonl (append-only history).
 *
 * Commands:
 *   init [dir] [--title T]                     create a board
 *   serve [dir] [--port N] [--host H] [--watch DIR]
 *                                              local UI + ingest API (+ markdown dir watcher)
 *   status <node> [--design S] [--impl S] [--note N] [--ref R] [--date D]
 *                                              update node status + record history
 *   event <type> [--node N] [--from S] [--to S] --note N [--ref R] [--date D]
 *                                              append a raw history event
 *   node add <kind> <id> --name N [--parent P] [--summary S] [--owner O]
 *                                              kind: project|module|feature|interface
 *   milestone upsert --id ID --node N --name T --date D --status S [--criteria a,b] [--evidence E]
 *   dep add --from A --to B [--kind K] [--note N]
 *   doc attach <node> <path> [--label L]
 *   backlog add --title T [--status S] [--node N] [--note N]
 *   import-board <legacy.json> [dir]           seed a board from an old-style board.json
 *   import-note <file.md> [dir]                ingest one markdown note
 *   validate [dir]                             structural + reference + cycle checks
 *   render [dir] [-o out.html]                 static HTML export
 *   events [dir] [--last N]                    print recent history
 */
import path from 'node:path';
import fs from 'node:fs';
import * as store from '../src/store.mjs';
import * as ingest from '../src/ingest.mjs';
import { renderToFile } from '../src/render.mjs';
import { renderReportToFile } from '../src/report.mjs';
import { startServer } from '../src/server.mjs';
import { startWatcher } from '../src/watcher.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];

function parseArgs(args) {
  const pos = []; const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-') && a !== '-') {
      const key = a.replace(/^-+/, '');
      const eq = key.indexOf('=');
      if (eq > 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else { flags[key] = args[i + 1] && !args[i + 1].startsWith('-') ? (++i, args[i]) : true; }
    } else pos.push(a);
  }
  return { pos, flags };
}
function fail(msg) { console.error(`riskdeck: ${msg}`); process.exit(1); }
function out(...lines) { console.log(lines.join('\n')); }
function dirArg(flags, pos, idx = 0) {
  if (flags.dir || flags.d) return flags.dir || flags.d;
  const cand = pos[idx];
  if (cand && store.boardExists(cand)) return cand;
  return '.';
}
const dataDir = flags => flags.dir || flags.d || '.';

try {
  switch (cmd) {
    case undefined || 'help': {
      if (cmd === undefined) { out([{ usage: 'riskdeck <command> [...]' }, 'run "riskdeck help" for the command list'].join('  ')); break; }
      out(`riskdeck — 持续摄取的项目计划/文档/动态追踪看板

  init [dir] --title T                       建板
  serve [dir] [--port 7466] [--host H] [--watch notes/]
                                             本地 UI + 摄取 API（+ markdown 目录监听）
  status <node> [--design S] [--impl S] --note N [--ref R]
                                             改节点状态并记录历史（最高频命令）
  event <type> [--node N] [--from S] [--to S] --note N
                                             追加原始事件
  node add <kind> <id> --name N [--parent P]  加结构节点
  milestone upsert --id .. --node .. --name .. --date .. --status planned|at-risk|hit|missed
  dep add --from A --to B [--kind K]          加依赖
  doc attach <node> <path> [--label L]        关联设计文档
  backlog add --title T [--status uncommitted|planned|cancelled] [--node N]
  risk upsert --id .. --title .. --category schedule|resource|problem|quality
              [--p 0.5] [--i 10] [--status open|mitigating|resolved|accepted]
              [--owner O] [--node N] [--review D] [--mitigation M]
  asset upsert --id .. --title .. --type process|tool|knowledge|template|data
               [--status proposed|deposited|adopted|retired] [--metric M] [--baseline B]
               [--value V] [--evidence E] [--reused N]
  goal set <node> [--metric M] [--gate G] [--due D] [--fte N] [--hours H]
  report [dir] [--from D] [--to D] [--md f.md] [--html f.html]
                                              阶段汇报投影（默认最近 30 天，md+html）
  import-board <board.json> [dir]            从旧版 board.json 播种
  import-note <file.md> [dir]                摄取一条 markdown 记录
  validate [dir] / render [dir] [-o f.html] / events [dir] [--last N]

  markdown 约定：frontmatter 里 type/node/from/to/date/ref，正文即 note。`);
      break;
    }

    case 'init': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = pos[0] || '.';
      store.initBoard(dir, { title: flags.title || '未命名看板' });
      out(`board created at ${path.resolve(dir)}`, `下一步: riskdeck node add project <id> --name 名称`);
      break;
    }

    case 'serve': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dirArg(flags, pos);
      if (!store.boardExists(dir)) fail(`no board at ${path.resolve(dir)}; run "riskdeck init" first`);
      const { url } = await startServer(dir, {
        port: Number(flags.port) || 7466,
        host: flags.host || '127.0.0.1',
        watch: flags.watch || null,
        startWatcher,
      });
      console.log('  Ctrl+C 退出');
      const open = flags.open;
      if (open) { const { exec } = await import('node:child_process'); exec(`open ${url}`).unref(); }
      const ping = setInterval(() => {}, 1 << 30);
      ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { clearInterval(ping); process.exit(0); }));
      break;
    }

    case 'status': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      const r = ingest.ingestStatus(dir, {
        node: pos[0] || flags.node, design: flags.design, impl: flags.impl,
        note: flags.note || flags.m, ref: flags.ref, date: flags.date,
      });
      out(`✓ ${r.node.name} 状态已更新，记录 ${r.events.length} 条历史`);
      break;
    }

    case 'event': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      const rec = ingest.ingestEvent(dir, {
        type: pos[0], node: flags.node, from: flags.from, to: flags.to,
        note: flags.note || flags.m, ref: flags.ref, date: flags.date,
      });
      out(`✓ event ${rec.id} (${rec.type}) @ ${rec.date}`);
      break;
    }

    case 'node': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'add') fail('usage: node add <kind> <id> --name N [--parent P]');
      const n = ingest.ingestNodeAdd(dir, {
        kind: pos[1], id: pos[2], name: flags.name,
        parent: flags.parent, summary: flags.summary, owner: flags.owner,
        tags: flags.tags ? String(flags.tags).split(',') : undefined,
      });
      out(`✓ ${n.kind} 「${n.name}」 (${n.id})`);
      break;
    }

    case 'milestone': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'upsert') fail('usage: milestone upsert --id .. --node .. --name .. --date .. --status ..');
      ingest.ingestMilestone(dir, {
        id: flags.id, node: flags.node, name: flags.name, date: flags.date, status: flags.status,
        criteria: flags.criteria ? String(flags.criteria).split(',') : undefined,
        evidence: flags.evidence,
      }, flags.note);
      out('✓ milestone saved');
      break;
    }

    case 'dep': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'add') fail('usage: dep add --from A --to B [--kind K]');
      ingest.ingestDependency(dir, { from: flags.from, to: flags.to, kind: flags.kind, note: flags.note });
      out('✓ dependency saved');
      break;
    }

    case 'doc': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'attach') fail('usage: doc attach <node> <path> [--label L]');
      ingest.ingestDoc(dir, { node: pos[1], docPath: pos[2], label: flags.label, note: flags.note });
      out('✓ doc attached');
      break;
    }

    case 'backlog': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'add') fail('usage: backlog add --title T [--status S] [--node N]');
      const entities = store.loadEntities(dir);
      entities.backlog = entities.backlog || [];
      const item = { title: flags.title, status: flags.status || 'uncommitted', ...(flags.node ? { node: flags.node } : {}), ...(flags.note ? { note: flags.note } : {}), date: store.today() };
      entities.backlog.push(item);
      store.saveEntities(dir, entities);
      out(`✓ backlog: ${item.title} (${item.status})`);
      break;
    }

    case 'import-board': {
      const { pos } = parseArgs(argv.slice(1));
      const file = pos[0]; if (!file) fail('usage: import-board <board.json> [dir]');
      const legacy = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      const dir = pos[1] || '.';
      store.importBoard(dir, legacy);
      const errs = store.validateBoard(store.loadEntities(dir));
      out(`✓ imported into ${path.resolve(dir)}${errs.length ? ` （警告：${errs.length} 个校验问题，运行 validate 查看）` : '，校验通过'}`);
      break;
    }

    case 'import-note': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      const { rec } = ingest.ingestNoteFile(dir, pos[0]);
      out(`✓ event ${rec.id} (${rec.type}) @ ${rec.date}`);
      break;
    }

    case 'validate': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dirArg(flags, pos);
      const { errors } = store.validateBoardDir(dir);
      if (errors.length) { errors.forEach(e => console.error('ERROR: ' + e)); fail(`${errors.length} 个问题`); }
      out('✓ board OK');
      break;
    }

    case 'render': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dirArg(flags, pos);
      const outFile = flags.o || flags.out || 'riskdeck.html';
      const size = renderToFile(dir, outFile, { title: flags.title });
      out(`✓ ${outFile} (${(size / 1024).toFixed(1)} KiB)`);
      break;
    }

    case 'report': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dirArg(flags, pos);
      if (!store.boardExists(dir)) fail(`no board at ${path.resolve(dir)}; run "riskdeck init" first`);
      const { rep, mdPath, htmlPath } = renderReportToFile(dir, {
        from: flags.from, to: flags.to, md: flags.md, html: flags.html,
      });
      const s = rep.summary;
      out(`✓ 报告窗口 ${rep.meta.from} ~ ${rep.meta.to}（${rep.meta.winLen} 天）`);
      out(`  风险暴露 ${s.exposure}（上期 ${s.exposurePrev}）｜高危 ${s.highCount}｜需决策 ${s.decisions}｜无证据达成 ${s.unverified}`);
      out(`  ${mdPath}`);
      out(`  ${htmlPath}`);
      break;
    }

    case 'risk': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'upsert') fail('usage: risk upsert --id ID --title T --category schedule|resource|problem|quality [--p 0.5] [--i 10] [--status open|mitigating|resolved|accepted] [--owner O] [--node N] [--review D] [--mitigation M] [--note N]');
      const { risk, events: evts } = ingest.ingestRisk(dir, {
        id: flags.id, title: flags.title, category: flags.category,
        p: flags.p, i: flags.i, status: flags.status, owner: flags.owner, node: flags.node,
        review: flags.review, mitigation: flags.mitigation, note: flags.note || flags.m, date: flags.date,
      });
      out(`✓ risk ${risk.id}「${risk.title}」 ${risk.status}（p×i=${(risk.p * risk.i).toFixed(1)}，记录 ${evts.length} 条历史）`);
      break;
    }

    case 'asset': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'upsert') fail('usage: asset upsert --id ID --title T --type process|tool|knowledge|template|data [--status proposed|deposited|adopted|retired] [--scope S] [--metric M] [--baseline B] [--value V] [--unit U] [--evidence E] [--reused N] [--node N] [--note N]');
      const { asset, events: evts } = ingest.ingestAsset(dir, {
        id: flags.id, title: flags.title, type: flags.type, status: flags.status, scope: flags.scope,
        node: flags.node, metric: flags.metric, baseline: flags.baseline, value: flags.value, unit: flags.unit,
        evidence: flags.evidence, reused: flags.reused, note: flags.note || flags.m, date: flags.date,
      });
      out(`✓ asset ${asset.id}「${asset.title}」 ${asset.status}${asset.reused != null ? `（复用 ${asset.reused}）` : ''}，记录 ${evts.length} 条历史`);
      break;
    }

    case 'goal': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dataDir(flags);
      if (pos[0] !== 'set') fail('usage: goal set <node> [--metric M] [--gate G] [--due D] [--fte N] [--hours H] [--pct P] [--note N]');
      const node = pos[1] || flags.node;
      ingest.ingestGoal(dir, {
        node, metric: flags.metric, gate: flags.gate, due: flags.due,
        fteBudget: flags.fte, hours: flags.hours, pct: flags.pct, note: flags.note || flags.m,
      });
      out(`✓ goal/estimate saved on ${node}`);
      break;
    }

    case 'events': {
      const { pos, flags } = parseArgs(argv.slice(1));
      const dir = dirArg(flags, pos);
      const all = store.readEvents(dir);
      const last = Number(flags.last) || 20;
      for (const e of all.slice(-last)) {
        out(`${e.date}  [${e.type}]${e.node ? ' ' + e.node : ''}  ${e.note}${e.ref ? '  (' + e.ref + ')' : ''}`);
      }
      out(`—— 共 ${all.length} 条，显示最近 ${Math.min(last, all.length)} 条 ——`);
      break;
    }

    default:
      fail(`unknown command "${cmd}"; try "riskdeck help"`);
  }
} catch (e) {
  fail(e.message);
}
