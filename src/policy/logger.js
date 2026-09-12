/**
 * Session decision logger — localStorage ring buffer + JSONL export.
 * Logs features, policy decisions, and optional human overrides.
 * Your data. Your labels. No artist weights hide in here.
 */

const STORAGE_KEY = 'dj-drosophila.policy.log.v1';
const MAX_ENTRIES = 2500;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode — keep going silently; export still works from memory if needed.
  }
}

/** @type {object[]} */
let mem = readAll();

/**
 * Append one decision row.
 * @param {object} row
 */
export function logDecision(row) {
  const entry = {
    ts: Date.now(),
    ...row,
  };
  mem.push(entry);
  if (mem.length > MAX_ENTRIES) mem = mem.slice(mem.length - MAX_ENTRIES);
  writeAll(mem);
  return entry;
}

export function getLog() {
  return mem.slice();
}

export function clearLog() {
  mem = [];
  writeAll(mem);
}

export function logCount() {
  return mem.length;
}

/** JSON Lines string for download / train.js */
export function toJSONL(entries = mem) {
  return entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
}

/**
 * Trigger a browser download of the session log.
 */
export function downloadJSONL(filename = 'dj-drosophila-policy.jsonl') {
  const blob = new Blob([toJSONL()], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse JSONL text (file import or pasted).
 * @param {string} text
 */
export function parseJSONL(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip bad line */
    }
  }
  return out;
}
