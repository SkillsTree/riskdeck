/** Static HTML export: inject a snapshot payload into the viewer template. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot } from './store.mjs';

export function renderToHtml(dir, { title } = {}) {
  const template = fs.readFileSync(templatePath(), 'utf8');
  const snap = snapshot(dir);
  const payload = {
    board: snap.board,
    docsRoot: '.',
    title: title || snap.board.title || 'RiskDeck',
    renderedAt: new Date().toISOString().slice(0, 10),
  };
  return template.replace('__RISKDECK_DATA__', () => JSON.stringify(payload).replace(/<\//g, '<\\/'));
}

export function renderToFile(dir, out, opts) {
  const html = renderToHtml(dir, opts);
  fs.writeFileSync(out, html);
  return html.length;
}

export function templatePath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer', 'template.html');
}
