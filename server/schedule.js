/**
 * Wall-clock live show schedule driven by the DJ mind.
 *
 * Mind decides WHEN to leave and HOW long to crossfade; decisions are appended
 * to an append-only show log so every listener shares the same timeline.
 * getState / snapshot read the log (never “play to EOF then fake blend”).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  decideLeave,
  mindTick,
  MIN_FADE_SEC,
  MAX_FADE_SEC,
  MIND_TICK_SEC,
  minPlayForTrack,
} from './djMind.js';
import { publicSnapshot, encoderView } from './showClock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'src/crate/manifest.json');
const CRATE_DIR = path.join(ROOT, 'public/crate');
const SHOW_LOG_PATH = path.join(__dirname, 'cache', 'show-log.json');

/** Fallback only — real fades come from the mind (8–32s). */
export const TRANSITION_SEC = 20;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function easeInOut(t) {
  const p = clamp(t, 0, 1);
  return p * p * (3 - 2 * p);
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Probe real media duration (seconds) via ffprobe. Returns null on failure.
 * @param {string} filePath
 */
export function probeDurationSec(filePath) {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    const n = Number(String(out).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * @deprecated fixed play lengths removed — mind decides. Kept for any imports.
 */
export function plannedPlayLength(track) {
  const dur = track?.durationSec ?? track?.durationHint;
  if (typeof dur === 'number' && dur > 0) {
    return clamp(dur * 0.55, minPlayForTrack(dur), Math.max(45, dur - TRANSITION_SEC - 1));
  }
  return 90;
}

export function resolveTrackPath(track) {
  const rel = (track.file || '').replace(/^\//, '');
  return path.join(ROOT, 'public', rel);
}

/**
 * Load CC0 file tracks; probe durationSec at load time.
 */
export function loadFileTracks() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const tracks = (raw.tracks || []).filter(
    (t) => t.source === 'file' && t.file && !t.slot && (t.license || 'CC0').toUpperCase().startsWith('CC0'),
  );
  const existing = [];
  for (const t of tracks) {
    const p = resolveTrackPath(t);
    if (fs.existsSync(p)) {
      const probed = probeDurationSec(p);
      const durationSec =
        probed ?? (typeof t.durationHint === 'number' && t.durationHint > 0 ? t.durationHint : null);
      if (probed == null) {
        console.warn(`[live] ffprobe failed for ${p} — using durationHint=${t.durationHint ?? '?'}`);
      }
      existing.push({
        id: t.id,
        title: t.title,
        artist: t.artist,
        bpm: t.bpm,
        energy: t.energy,
        key: t.key,
        license: t.license || 'CC0',
        file: t.file,
        path: p,
        durationHint: t.durationHint,
        durationSec,
      });
      console.info(
        `[live] track ${t.id}: dur=${durationSec != null ? durationSec.toFixed(1) : '?'}s (mind-driven play)`,
      );
    } else {
      console.warn(`[live] missing crate file, skip: ${p}`);
    }
  }
  if (!existing.length) {
    throw new Error(`No CC0 mp3s found under ${CRATE_DIR}`);
  }
  return existing;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.showStartMs]
 * @param {string} [opts.seed]
 * @param {string} [opts.styleId]
 */
export function createSchedule(opts = {}) {
  const seed = opts.seed || process.env.SHOW_SEED || 'dj-drosophila';
  const styleId = opts.styleId || process.env.DJ_STYLE || 'psy-peak';
  const showStartMs =
    opts.showStartMs ??
    (process.env.SHOW_START_MS ? Number(process.env.SHOW_START_MS) : Date.now());

  const fileTracks = loadFileTracks();
  const byId = new Map(fileTracks.map((t) => [t.id, t]));
  const rand = mulberry32(hashSeed(seed));
  const rotation = shuffle(fileTracks, rand);

  /**
   * Show log entry:
   * { absIndex, trackId, nextId, playStartSec, leaveAtSec, fadeSec, reason, leaveScore }
   * PLAYING = [playStartSec, leaveAtSec), TRANSITION = [leaveAtSec, leaveAtSec+fadeSec)
   */
  /** @type {object[]} */
  const showLog = [];
  let persistTimer = null;

  function persistLog() {
    try {
      fs.mkdirSync(path.dirname(SHOW_LOG_PATH), { recursive: true });
      fs.writeFileSync(
        SHOW_LOG_PATH,
        JSON.stringify(
          {
            seed,
            styleId,
            showStartMs,
            updatedAt: Date.now(),
            entries: showLog,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.warn('[live] show log persist failed', err.message);
    }
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistLog();
    }, 500);
  }

  function recentIds(uptoIndex) {
    const ids = [];
    for (let i = Math.max(0, uptoIndex - 5); i < uptoIndex && i < showLog.length; i++) {
      ids.push(showLog[i].trackId);
    }
    return ids;
  }

  function candidatesFor(absIndex) {
    // Prefer upcoming rotation order, but mind scores freely across crate
    const rot = rotation.map((t, i) => rotation[(absIndex + 1 + i) % rotation.length]);
    // Unique by id
    const seen = new Set();
    const out = [];
    for (const t of rot) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }

  /**
   * Extend show log with one more mind decision (deterministic).
   */
  function extendLog() {
    const absIndex = showLog.length;
    let track;
    let playStartSec;
    if (absIndex === 0) {
      track = rotation[0];
      playStartSec = 0;
    } else {
      const prev = showLog[absIndex - 1];
      track = byId.get(prev.nextId) || rotation[absIndex % rotation.length];
      playStartSec = prev.leaveAtSec + prev.fadeSec;
    }

    const cands = candidatesFor(absIndex);
    const decision = decideLeave({
      seed,
      styleId,
      track,
      candidates: cands,
      recentIds: recentIds(absIndex),
      absIndex,
    });

    const next = decision.nextTrack || cands[0] || rotation[(absIndex + 1) % rotation.length];
    const fadeSec = clamp(decision.fadeSec, MIN_FADE_SEC, MAX_FADE_SEC);
    const leaveAtSec = playStartSec + decision.playedSec;

    const entry = {
      absIndex,
      trackId: track.id,
      nextId: next.id,
      playStartSec,
      leaveAtSec,
      fadeSec,
      plannedPlaySec: decision.playedSec,
      reason: decision.reason,
      leaveScore: decision.leaveScore,
    };
    showLog.push(entry);
    schedulePersist();
    console.info(
      `[live/mind] #${absIndex} ${track.title} play ${decision.playedSec.toFixed(0)}s → ${next.title} xf ${fadeSec.toFixed(0)}s · ${decision.reason}`,
    );
    return entry;
  }

  function ensureLogUntil(elapsedSec, horizonSec = 600) {
    const needUntil = elapsedSec + horizonSec;
    let guard = 0;
    while (guard++ < 500) {
      if (!showLog.length) {
        extendLog();
        continue;
      }
      const last = showLog[showLog.length - 1];
      const lastEnd = last.leaveAtSec + last.fadeSec;
      if (lastEnd >= needUntil) break;
      extendLog();
    }
  }

  // Bootstrap a few slots so HLS can plan ahead
  ensureLogUntil(0, 900);
  persistLog();

  function publicTrack(t) {
    if (!t) return null;
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      bpm: t.bpm,
      energy: t.energy,
      key: t.key,
      license: t.license,
      file: t.file,
      durationHint: t.durationHint,
      durationSec: t.durationSec ?? t.durationHint ?? null,
    };
  }

  function locate(elapsedSec) {
    if (elapsedSec < 0) elapsedSec = 0;
    ensureLogUntil(elapsedSec, 300);
    for (let i = 0; i < showLog.length; i++) {
      const e = showLog[i];
      if (elapsedSec < e.leaveAtSec) {
        const playedSec = elapsedSec - e.playStartSec;
        return {
          absIndex: e.absIndex,
          phase: 'PLAYING',
          playedSec,
          plannedSec: e.plannedPlaySec,
          transitionProgress: null,
          transitionSec: e.fadeSec,
          track: byId.get(e.trackId),
          next: byId.get(e.nextId),
          remainingPlay: e.leaveAtSec - elapsedSec,
          remainingTransition: e.fadeSec,
          mindReason: e.reason,
          entry: e,
        };
      }
      const transEnd = e.leaveAtSec + e.fadeSec;
      if (elapsedSec < transEnd) {
        const into = elapsedSec - e.leaveAtSec;
        const prog = into / e.fadeSec;
        return {
          absIndex: e.absIndex,
          phase: 'TRANSITION',
          playedSec: e.plannedPlaySec,
          plannedSec: e.plannedPlaySec,
          transitionProgress: prog,
          transitionSec: e.fadeSec,
          track: byId.get(e.trackId),
          next: byId.get(e.nextId),
          remainingPlay: 0,
          remainingTransition: transEnd - elapsedSec,
          mindReason: e.reason,
          entry: e,
        };
      }
    }
    // Past log end — extend and retry
    extendLog();
    return locate(elapsedSec);
  }

  /**
   * Live mind reason while PLAYING (updates each tick without rewriting log leave).
   */
  function liveMindReason(loc, elapsedSec) {
    if (loc.phase !== 'PLAYING' || !loc.track) return loc.mindReason;
    const tick = mindTick({
      seed,
      styleId,
      track: loc.track,
      candidates: candidatesFor(loc.absIndex),
      playedSec: loc.playedSec,
      recentIds: recentIds(loc.absIndex),
      absIndex: loc.absIndex,
    });
    return tick.reason;
  }

  function getState(nowMs = Date.now()) {
    const serverTime = nowMs;
    const elapsedSec = (serverTime - showStartMs) / 1000;
    const loc = locate(elapsedSec);

    const activeDeck = loc.absIndex % 2 === 0 ? 'A' : 'B';
    const quietDeck = activeDeck === 'A' ? 'B' : 'A';

    const trackActive = loc.track;
    const trackNext = loc.next;

    const trackA = activeDeck === 'A' ? trackActive : trackNext;
    const trackB = activeDeck === 'B' ? trackActive : trackNext;

    let xfaderEdge;
    let transitionProgress = null;
    if (loc.phase === 'PLAYING') {
      xfaderEdge = activeDeck === 'A' ? -1 : 1;
    } else {
      transitionProgress = loc.transitionProgress;
      const from = activeDeck === 'A' ? -1 : 1;
      const to = -from;
      xfaderEdge = from + (to - from) * easeInOut(transitionProgress);
    }

    const playMin = Math.floor(loc.playedSec / 60);
    const playSec = Math.floor(loc.playedSec % 60);
    const planMin = Math.floor(loc.plannedSec / 60);
    const planSec = Math.floor(loc.plannedSec % 60);
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${playMin}:${pad(playSec)} / ${planMin}:${pad(planSec)}`;

    const mindReason = liveMindReason(loc, elapsedSec);

    let statusLine;
    if (loc.phase === 'TRANSITION') {
      statusLine = `TRANSITION ${Math.round((transitionProgress || 0) * 100)}% · ${activeDeck}→${quietDeck}`;
    } else {
      statusLine = `PLAYING ${activeDeck} · ${timeStr}`;
    }

    const edgeLabel =
      xfaderEdge <= -0.5 ? 'EDGE A (−1)' : xfaderEdge >= 0.5 ? 'EDGE B (+1)' : 'blend';

    return {
      serverTime,
      showStart: showStartMs,
      seed,
      styleId,
      state: loc.phase,
      activeDeck,
      quietDeck,
      trackA: publicTrack(trackA),
      trackB: publicTrack(trackB),
      xfaderEdge,
      playedSec: loc.playedSec,
      plannedSec: loc.plannedSec,
      nextTrack: publicTrack(trackNext),
      transitionProgress,
      transitionSec: loc.transitionSec,
      mindReason,
      statusLine,
      timeStr,
      edgeLabel,
      streamUrl: '/hls/live.m3u8',
      _absIndex: loc.absIndex,
      _remainingPlay: loc.remainingPlay,
      _remainingTransition: loc.remainingTransition,
      _trackPath: loc.track?.path,
      _nextPath: loc.next?.path,
      _trackDurationSec: loc.track?.durationSec ?? loc.track?.durationHint ?? null,
      _nextDurationSec: loc.next?.durationSec ?? loc.next?.durationHint ?? null,
      _playStartSec: loc.entry?.playStartSec ?? 0,
      _leaveAtSec: loc.entry?.leaveAtSec ?? 0,
      _elapsedSec: elapsedSec,
    };
  }

  function upcomingSegments(fromMs, horizonSec = 3600) {
    const out = [];
    let t = fromMs;
    const end = fromMs + horizonSec * 1000;
    let guard = 0;
    while (t < end && guard++ < 5000) {
      const st = getState(t);
      if (st.state === 'PLAYING') {
        const dur = st._remainingPlay;
        out.push({
          kind: 'PLAYING',
          startMs: t,
          durationSec: dur,
          track: st.activeDeck === 'A' ? st.trackA : st.trackB,
          path: st._trackPath,
          // File position = how far into this play window (started at 0)
          seekSec: st.playedSec,
          absIndex: st._absIndex,
          activeDeck: st.activeDeck,
        });
        t += dur * 1000;
      } else {
        const dur = st._remainingTransition;
        const fadeSec = st.transitionSec;
        const progress = st.transitionProgress || 0;
        const fileDur = st._trackDurationSec;
        // Play-end in file = planned play length (we always start tracks at 0).
        // Clamp so fadeSec of outgoing audio remains for acrossfade.
        let playEnd = st.plannedSec;
        if (typeof fileDur === 'number' && fileDur > 0) {
          playEnd = Math.min(playEnd, Math.max(0, fileDur - fadeSec));
        }
        out.push({
          kind: 'TRANSITION',
          startMs: t,
          durationSec: dur,
          fromPath: st._trackPath,
          toPath: st._nextPath,
          fromSeekSec: Math.max(0, playEnd + progress * fadeSec),
          toSeekSec: progress * fadeSec,
          fadeSec,
          progressAtStart: progress,
          fromDurationSec: fileDur,
          toDurationSec: st._nextDurationSec,
          absIndex: st._absIndex,
          activeDeck: st.activeDeck,
          fromTrack: st.activeDeck === 'A' ? st.trackA : st.trackB,
          toTrack: st.nextTrack,
          mindReason: st.mindReason,
        });
        t += dur * 1000;
      }
      t += 1;
    }
    return out;
  }

  // Approximate cycle length for health logs
  const cycleSec = showLog.reduce((s, e) => s + e.plannedPlaySec + e.fadeSec, 0);

  return {
    showStartMs,
    seed,
    styleId,
    rotation,
    cycle: showLog,
    cycleSec,
    getState,
    snapshot(nowMs) {
      return publicSnapshot(getState(nowMs));
    },
    encoderView(nowMs) {
      return encoderView(getState(nowMs));
    },
    fileTracks,
    showLog,
    ensureLogUntil,
  };
}

export { MIN_FADE_SEC, MAX_FADE_SEC, MIND_TICK_SEC };
