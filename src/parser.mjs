/**
 * Markdown note parsing for ingest.
 *
 * Convention: a note file starts with YAML-ish frontmatter; the body is appended
 * to `note`. Recognized keys:
 *   type: design|impl|milestone|dependency|note   (required)
 *   node: <node-or-milestone-id>                  (optional)
 *   from: <status>  to: <status>                  (optional, for status changes)
 *   date: YYYY-MM-DD                              (optional, default today)
 *   ref: PR #123 / commit / doc link              (optional)
 *   status: planned|at-risk|hit|missed            (milestone only, maps into note prefix)
 */
export function parseNote(raw, { file = 'note.md' } = {}) {
  const text = String(raw);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm = {};
  let body = text;
  if (m) {
    body = m[2].trim();
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const type = (fm.type || '').toLowerCase();
  if (!type) throw new Error(`${file}: frontmatter 缺少 type（design|impl|milestone|dependency|note）`);
  const evt = {
    type,
    node: fm.node || undefined,
    from: fm.from || undefined,
    to: fm.to || undefined,
    date: fm.date || undefined,
    ref: fm.ref || undefined,
    note: '',
  };
  let prefix = '';
  if (type === 'milestone' && fm.status) prefix = `[${fm.status}] `;
  if (fm.title) prefix += fm.title + ' — ';
  evt.note = (prefix + (body || fm.note || '(无正文)')).trim();
  if (!evt.node && fm.milestone) evt.node = fm.milestone;
  return evt;
}
