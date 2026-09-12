/**
 * Mind show-log → Liquidsoap annotated M3U.
 *
 * Each entry becomes one request with cue/fade metadata so Liquidsoap
 * leaves when the fly decided (not at EOF) and overlaps with fade.in / fade.out.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RADIO_M3U_PATH = path.join(__dirname, 'cache', 'radio.m3u');

/**
 * Liquidsoap annotate URIs need a POSIX path after the last colon.
 * Native Windows `C:\foo` would be parsed as a drive-letter colon.
 * @param {string} filePath
 */
export function toPosixPath(filePath) {
  const s = String(filePath ?? '');
  if (!s) return s;
  let posix = s.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):/.exec(posix);
  if (drive) {
    posix = `/${drive[1].toLowerCase()}${posix.slice(2)}`;
  }
  return posix;
}

/**
 * @param {string} value
 */
export function annotateEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

/**
 * @param {Record<string, string|number>} meta
 * @param {string} filePath POSIX absolute path (no annotate colon ambiguity)
 */
export function annotateRequest(meta, filePath) {
  const posix = toPosixPath(filePath);
  if (!posix || posix.includes('\0')) {
    throw new Error('invalid audio path');
  }
  const parts = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === '') continue;
    parts.push(`${k}="${annotateEscape(String(v))}"`);
  }
  return `annotate:${parts.join(',')}:${posix}`;
}

/**
 * @param {object} entry show-log row
 * @param {object} track file track with path + duration
 * @param {{ fadeInSec: number, isFirst: boolean }} opts
 */
export function entryToRequest(entry, track, opts) {
  const fadeOut = Number(entry.fadeSec) || 12;
  const fadeIn = opts.isFirst ? 0 : Number(opts.fadeInSec) || 0;
  const planned = Number(entry.plannedPlaySec) || 0;
  const fileDur = track.durationSec ?? track.durationHint ?? null;

  let cueOut = planned + fadeOut;
  if (typeof fileDur === 'number' && fileDur > 1) {
    cueOut = Math.min(cueOut, Math.max(fadeOut + 1, fileDur - 0.25));
  }
  const cueIn = 0;
  const cross = Math.max(fadeOut, fadeIn, 0.5);

  return annotateRequest(
    {
      title: track.title || track.id,
      artist: track.artist || 'DJ Drosophila',
      liq_cue_in: cueIn.toFixed(3),
      liq_cue_out: cueOut.toFixed(3),
      liq_fade_in: fadeIn.toFixed(3),
      liq_fade_out: fadeOut.toFixed(3),
      liq_cross_duration: cross.toFixed(3),
      liq_fade_in_type: 'sin',
      liq_fade_out_type: 'sin',
      drosophila_id: track.id,
      drosophila_next: entry.nextId,
    },
    track.path,
  );
}

/**
 * Show-log rows still needed by Liquidsoap.
 * Finished entries are dropped. After the daemon is running, the current
 * track is also dropped so a playlist reload does not replay it.
 *
 * @param {object[]} showLog
 * @param {number} elapsedSec
 * @param {{ includeCurrent?: boolean }} [opts]
 */
export function remainingShowLog(showLog, elapsedSec, opts = {}) {
  const includeCurrent = opts.includeCurrent !== false;
  const t = Number(elapsedSec) || 0;
  const out = [];
  for (const e of showLog) {
    const end = Number(e.leaveAtSec) + Number(e.fadeSec || 0);
    if (end <= t) continue;
    const started = Number(e.playStartSec) <= t;
    if (started && !includeCurrent) continue;
    out.push(e);
  }
  return out;
}

/**
 * @param {object[]} showLog
 * @param {Map<string, object>|Record<string, object>} tracksById
 * @param {{ initialFadeInSec?: number }} [opts]
 * @returns {string}
 */
export function buildRadioM3u(showLog, tracksById, opts = {}) {
  const get = typeof tracksById.get === 'function' ? (id) => tracksById.get(id) : (id) => tracksById[id];
  const lines = ['#EXTM3U', '# DJ Drosophila — generated from fly mind show log; do not edit'];
  let prevFade = Number(opts.initialFadeInSec);
  if (!Number.isFinite(prevFade)) prevFade = 0;
  for (let i = 0; i < showLog.length; i++) {
    const e = showLog[i];
    const track = get(e.trackId);
    if (!track?.path) {
      throw new Error(`missing track path for ${e.trackId}`);
    }
    const isFirst = i === 0 && (e.absIndex ?? 0) === 0 && prevFade === 0;
    const req = entryToRequest(e, track, { isFirst, fadeInSec: prevFade });
    const inf = Math.max(1, Math.round((e.plannedPlaySec || 0) + (e.fadeSec || 0)));
    lines.push(`#EXTINF:${inf},${annotateEscape(track.title || track.id)}`);
    lines.push(req);
    prevFade = e.fadeSec || 0;
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Write radio.m3u. First create is rename-atomic. Later updates keep the
 * same inode so Liquidsoap `reload_mode="watch"` (inotify) still fires.
 *
 * @param {string} filePath
 * @param {string} content
 */
export function writeRadioM3u(filePath, content) {
  const dest = filePath || RADIO_M3U_PATH;
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const data = Buffer.from(content, 'utf8');
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  if (!fs.existsSync(dest)) {
    fs.renameSync(tmp, dest);
    return dest;
  }
  try {
    const fd = fs.openSync(dest, 'r+');
    try {
      fs.writeSync(fd, data, 0, data.length, 0);
      fs.ftruncateSync(fd, data.length);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.unlinkSync(tmp);
  } catch {
    fs.renameSync(tmp, dest);
  }
  return dest;
}
