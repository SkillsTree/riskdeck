/**
 * riskdeck serve — local web UI + ingest API.
 *
 *   GET  /                  live board UI (snapshot injected, no-store)
 *   GET  /api/snapshot      full JSON snapshot (board + events + hash)
 *   GET  /api/version       {hash} for cheap change polling
 *   POST /api/events        ingest one event  {type,node,from,to,note,ref,date[,sync]}
 *   POST /api/notes         ingest raw markdown note (frontmatter convention)
 *   POST /webhooks/github   generic webhook intake (v0.1: recorded as note events)
 *
 * Binds 127.0.0.1 by default (single user). Pass --host 0.0.0.0 to expose on LAN.
 * Set RISKDECK_WEBHOOK_SECRET and matching header x-riskdeck-secret to lock webhooks.
 */
import http from 'node:http';
import path from 'node:path';
import { snapshot, loadEntities, saveEntities, appendEvent, validateBoard, BoardError } from './store.mjs';
import { ingestApiEvent, ingestNoteFile } from './ingest.mjs';
import { parseNote } from './parser.mjs';
import { templatePath } from './render.mjs';
import fs from 'node:fs';

export function startServer(dir, { port = 7466, host = '127.0.0.1', watch = null, startWatcher } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, dir);
    } catch (e) {
      const status = e instanceof BoardError ? 400 : 500;
      json(res, status, { error: e.message });
    }
  });

  let watcher = null;
  if (watch) {
    watcher = startWatcher(dir, watch, {
      onIngest: (rec, file) => console.log(`[watch] ingested ${path.basename(file)} → event ${rec.id} (${rec.type})`),
      onError: (e, file) => console.error(`[watch] FAILED ${path.basename(file)}: ${e.message}`),
    });
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`riskdeck serving ${path.resolve(dir)}`);
      console.log(`  UI      http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
      console.log(`  API     POST /api/events · POST /api/notes · GET /api/snapshot`);
      if (watcher) console.log(`  watch   ${path.resolve(watch)}/*.md`);
      resolve({ server, watcher, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function route(req, res, dir) {
  const u = new URL(req.url, 'http://x');

  if (req.method === 'GET' && u.pathname === '/') {
    const snap = snapshot(dir);
    const template = fs.readFileSync(templatePath(), 'utf8');
    const payload = {
      board: snap.board,
      docsRoot: '.',
      title: snap.board.title || 'RiskDeck',
      renderedAt: new Date().toISOString().slice(0, 10),
      live: { hash: snap.hash, version: snap.meta?.version || 0 },
    };
    const html = template
      .replace('__RISKDECK_DATA__', () => JSON.stringify(payload).replace(/<\//g, '<\\/'))
      .replace('</body>', LIVE_SNIPPET + '\n</body>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && u.pathname === '/api/version') {
    json(res, 200, { hash: snapshot(dir).hash });
    return;
  }

  if (req.method === 'GET' && u.pathname === '/api/snapshot') {
    json(res, 200, snapshot(dir, { eventsLimit: numberOr(u.searchParams.get('events'), 0) || undefined }));
    return;
  }

  if (req.method === 'POST' && u.pathname === '/api/events') {
    const body = await readJson(req);
    const out = ingestApiEvent(dir, body);
    json(res, 201, { ok: true, events: out.events });
    return;
  }

  if (req.method === 'POST' && u.pathname === '/api/notes') {
    const raw = await readBody(req);
    const evt = parseNote(raw, { file: 'api-note' });
    const rec = appendEvent(dir, evt, { source: 'api-note' });
    json(res, 201, { ok: true, event: rec });
    return;
  }

  if (req.method === 'POST' && u.pathname === '/webhooks/github') {
    const secret = process.env.RISKDECK_WEBHOOK_SECRET;
    if (secret && req.headers['x-riskdeck-secret'] !== secret) {
      json(res, 401, { error: 'bad webhook secret' });
      return;
    }
    const body = await readJson(req).catch(() => ({}));
    const kind = body.action ? `${body.issue ? 'issue' : body.pull_request ? 'pr' : 'event'}.${body.action}` : 'github';
    const title = body.issue?.title || body.pull_request?.title || body.ref || '(no title)';
    const url = body.issue?.html_url || body.pull_request?.html_url || '';
    const rec = appendEvent(dir, {
      type: 'note',
      note: `GitHub ${kind}：${title}`,
      ref: url || undefined,
    }, { source: 'webhook:github' });
    json(res, 201, { ok: true, event: rec, hint: 'v0.1 记录为 note 事件；issue/PR → 节点状态的自动映射在二期' });
    return;
  }

  json(res, 404, { error: `no route: ${req.method} ${u.pathname}` });
}

const LIVE_SNIPPET = `<script>
(function(){
  const cur = (window.__TB_LIVE = document.getElementById('riskdeck-data') ? null : null);
  setInterval(async () => {
    try {
      const r = await fetch('/api/version');
      const j = await r.json();
      const tag = document.getElementById('liveHash');
      if (tag && j.hash !== tag.dataset.h) { location.reload(); }
    } catch (e) { /* server down; keep showing last snapshot */ }
  }, 15000);
})();
</script>`;

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}

function readBody(req, cap = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > cap) { reject(new BoardError('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return JSON.parse(raw || '{}'); }
  catch { throw new BoardError('request body is not valid JSON'); }
}

function numberOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
