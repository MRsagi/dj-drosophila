/**
 * Liquidsoap HLS producer — one long-lived daemon, mind-driven annotated M3U.
 *
 * Writes server/cache/radio.m3u from the show log, spawns
 * `liquidsoap server/radio.liq`, and keeps the playlist extended ahead of
 * playback. Conforms to the ffmpeg producer interface: { start, stop, ready }.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HLS_DIR } from './ffmpegStream.js';
import {
  RADIO_M3U_PATH,
  buildRadioM3u,
  remainingShowLog,
  toPosixPath,
  writeRadioM3u,
} from './liquidsoapPlaylist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'radio.liq');
const CACHE_DIR = path.join(__dirname, 'cache');
const SYNC_MS = 15_000;
const LOG_HORIZON_SEC = 1800;
const RESTART_MIN_MS = 2_000;
const RESTART_MAX_MS = 30_000;
/** Don't rewrite the M3U this close to a blend — reload would drop the prefetch buffer. */
const RELOAD_GUARD_SEC = 40;

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<boolean>}
 */
export function binaryOnPath(cmd, args) {
  const argv = args || (cmd === 'ffmpeg' || cmd === 'ffprobe' ? ['-version'] : ['--version']);
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export function assertLiquidsoap() {
  return binaryOnPath('liquidsoap', ['--version']).then((ok) => {
    if (!ok) {
      throw new Error(
        'liquidsoap not found on PATH — install liquidsoap, or run via Docker (STREAM_ENGINE=liquidsoap)',
      );
    }
    return true;
  });
}

/**
 * Resolve STREAM_ENGINE: liquidsoap (default when present / in Docker),
 * else ffmpeg fallback with a clear notice.
 * @returns {Promise<'liquidsoap'|'ffmpeg'>}
 */
export async function resolveStreamEngine() {
  const raw = String(process.env.STREAM_ENGINE || 'auto').toLowerCase().trim();
  const hasLiq = await binaryOnPath('liquidsoap', ['--version']);
  const hasFf = await binaryOnPath('ffmpeg', ['-version']);

  const fallbackNotice = () => {
    console.warn('[live] liquidsoap is not on PATH.');
    console.warn('[live] For production 24/7 radio: docker compose up  (STREAM_ENGINE=liquidsoap)');
    console.warn('[live] Or install locally: apt-get install liquidsoap   (Debian/Ubuntu)');
  };

  if (raw === 'ffmpeg') {
    if (!hasFf) throw new Error('STREAM_ENGINE=ffmpeg but ffmpeg is not on PATH');
    return 'ffmpeg';
  }

  if (raw === 'liquidsoap') {
    if (hasLiq) return 'liquidsoap';
    console.warn('[live] STREAM_ENGINE=liquidsoap but the liquidsoap binary was not found.');
    fallbackNotice();
    if (hasFf) {
      console.warn('[live] Falling back to the ffmpeg HLS producer.');
      return 'ffmpeg';
    }
    throw new Error('liquidsoap not found and ffmpeg fallback is unavailable');
  }

  if (hasLiq) return 'liquidsoap';
  if (hasFf) {
    fallbackNotice();
    console.warn('[live] Using ffmpeg HLS producer (dev fallback).');
    return 'ffmpeg';
  }
  throw new Error('Neither liquidsoap nor ffmpeg found on PATH');
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function clearHls() {
  ensureDir(HLS_DIR);
  for (const f of fs.readdirSync(HLS_DIR)) {
    if (/\.(ts|m3u8|m4s|tmp|config)$/.test(f) || f === 'hls-state.config') {
      try {
        fs.unlinkSync(path.join(HLS_DIR, f));
      } catch {
        /* ignore */
      }
    }
  }
}

function tracksById(schedule) {
  const m = new Map();
  for (const t of schedule.fileTracks) {
    m.set(t.id, { ...t, path: toPosixPath(t.path) });
  }
  return m;
}

function tooCloseToTransition(schedule) {
  const st = schedule.getState();
  if (st.state === 'TRANSITION') return true;
  if (typeof st._remainingPlay === 'number' && st._remainingPlay < RELOAD_GUARD_SEC) return true;
  return false;
}

/**
 * @param {ReturnType<import('./schedule.js').createSchedule>} schedule
 */
export function createLiquidsoapProducer(schedule) {
  let running = false;
  let child = null;
  let syncTimer = null;
  let restartTimer = null;
  let restartDelay = RESTART_MIN_MS;
  let lastM3u = '';
  let startedAt = 0;

  function syncM3u({ includeCurrent, force } = {}) {
    const elapsed = (Date.now() - schedule.showStartMs) / 1000;
    schedule.ensureLogUntil(elapsed, LOG_HORIZON_SEC);
    const wantCurrent = includeCurrent === true;
    let entries = remainingShowLog(schedule.showLog, elapsed, { includeCurrent: wantCurrent });
    if (!entries.length) {
      entries = remainingShowLog(schedule.showLog, elapsed, { includeCurrent: true });
    }
    if (!entries.length) {
      console.warn('[live/liquidsoap] no remaining show-log entries for radio.m3u');
      return;
    }
    const first = entries[0];
    let initialFadeInSec = 0;
    if (first && (first.absIndex ?? 0) > 0) {
      const prev = schedule.showLog[first.absIndex - 1];
      initialFadeInSec = Number(prev?.fadeSec) || 0;
    }
    const m3u = buildRadioM3u(entries, tracksById(schedule), { initialFadeInSec });
    if (!force && m3u === lastM3u) return;
    if (!force && !wantCurrent && tooCloseToTransition(schedule)) return;
    writeRadioM3u(RADIO_M3U_PATH, m3u);
    lastM3u = m3u;
    console.info(
      `[live/liquidsoap] radio.m3u ← ${entries.length} tracks (from #${first.absIndex ?? 0}, elapsed ${elapsed.toFixed(0)}s)`,
    );
  }

  function spawnDaemon() {
    const env = {
      ...process.env,
      RADIO_M3U: RADIO_M3U_PATH,
      HLS_DIR,
      ICECAST_HOST: process.env.ICECAST_HOST || '',
      ICECAST_PORT: process.env.ICECAST_PORT || '8000',
      ICECAST_PASSWORD: process.env.ICECAST_PASSWORD || '',
      ICECAST_MOUNT: process.env.ICECAST_MOUNT || '/drosophila',
      ICECAST_USER: process.env.ICECAST_USER || 'source',
    };
    console.info(`[live/liquidsoap] starting ${SCRIPT}`);
    const proc = spawn('liquidsoap', [SCRIPT], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;
    const logChunk = (buf) => {
      const s = buf.toString();
      for (const line of s.split(/\r?\n/)) {
        if (line.trim()) console.info(`[liquidsoap] ${line}`);
      }
    };
    proc.stdout.on('data', logChunk);
    proc.stderr.on('data', logChunk);
    proc.on('error', (err) => {
      console.error('[live/liquidsoap] spawn failed', err.message);
    });
    proc.on('close', (code, signal) => {
      if (child === proc) child = null;
      if (!running) return;
      console.warn(
        `[live/liquidsoap] exited code=${code} signal=${signal || '-'} — restarting in ${restartDelay}ms`,
      );
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!running) return;
        try {
          syncM3u({ includeCurrent: true, force: true });
        } catch (err) {
          console.error('[live/liquidsoap] resync before restart failed', err);
        }
        spawnDaemon();
      }, restartDelay);
      restartDelay = Math.min(RESTART_MAX_MS, Math.round(restartDelay * 1.6));
    });
  }

  return {
    engine: 'liquidsoap',
    async start() {
      if (running) return;
      running = true;
      startedAt = Date.now();
      restartDelay = RESTART_MIN_MS;
      ensureDir(CACHE_DIR);
      clearHls();
      syncM3u({ includeCurrent: true, force: true });
      spawnDaemon();
      syncTimer = setInterval(() => {
        try {
          const liveLongEnough = Date.now() - startedAt > 8_000;
          syncM3u({ includeCurrent: !liveLongEnough, force: false });
        } catch (err) {
          console.error('[live/liquidsoap] playlist sync failed', err);
        }
      }, SYNC_MS);
    },
    stop() {
      running = false;
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (child) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        child = null;
      }
    },
    get ready() {
      return fs.existsSync(path.join(HLS_DIR, 'live.m3u8'));
    },
  };
}
