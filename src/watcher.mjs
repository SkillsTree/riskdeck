/**
 * Directory watcher: markdown notes dropped into the watched dir are parsed and
 * ingested as events. Dedupe by content hash so editing/saving the same file
 * twice does not double-count.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseNote } from './parser.mjs';
import { appendEvent } from './store.mjs';

const STATE_FILE = '.ingest-state.json';

export function startWatcher(boardDirPath, watchDir, { onIngest, onError } = {}) {
  const abs = path.resolve(watchDir);
  fs.mkdirSync(abs, { recursive: true });
  const statePath = path.join(boardDirPath, STATE_FILE);
  const seen = loadState(statePath);

  const ingestFile = (file) => {
    if (!file.endsWith('.md')) return;
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
    if (seen[file] === hash) return;
    try {
      const evt = parseNote(raw, { file: path.basename(file) });
      const rec = appendEvent(boardDirPath, evt, { source: 'watch:' + path.basename(file) });
      seen[file] = hash;
      saveState(statePath, seen);
      onIngest?.(rec, file);
    } catch (e) {
      onError?.(e, file);
    }
  };

  const scan = () => { for (const f of fs.readdirSync(abs)) ingestFile(path.join(abs, f)); };
  scan(); // catch files dropped while server was down

  let timer = null;
  const watcher = fs.watch(abs, { persistent: false }, (_event, file) => {
    if (!file || !file.endsWith('.md')) return;
    clearTimeout(timer);
    timer = setTimeout(() => ingestFile(path.join(abs, file)), 250); // debounce saves
  });

  return {
    close() { clearTimeout(timer); watcher.close(); },
    rescan: scan,
  };
}

function loadState(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveState(p, s) { try { fs.writeFileSync(p, JSON.stringify(s, null, 2)); } catch { /* best effort */ } }
