/**
 * Wall-clock deterministic live show schedule.
 * Mirrors setEngine PLAYING → TRANSITION → PLAYING using CC0 file tracks only.
 * State is a pure function of (showStartMs, now, seed) so reconnecting clients catch up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'src/crate/manifest.json');
const CRATE_DIR = path.join(ROOT, 'public/crate');

/** Crossfade / TRANSITION window (seconds). Mid of setEngine's ~8–16s feel. */
export const TRANSITION_SEC = 12;

/**
 * Same formula as src/dj/setEngine.js plannedPlayLength for file tracks.
 * @param {{ durationHint?: number, bpm?: number, energy?: number }} track
 */
export function plannedPlayLength(track) {
  const dur = track?.durationHint;
  if (typeof dur === 'number' && dur > 0) {
    return Math.max(30, Math.min(360, dur * 0.95));
  }
  const bpm = track?.bpm || 124;
  const energy = track?.energy ?? 0.6;
  let base = 90;
  if (bpm < 110) base = 145;
  else if (bpm < 123) base = 115;
  else if (bpm < 134) base = 95;
  else if (bpm < 150) base = 75;
  else base = 55;
  base += (1 - energy) * 45;
  return Math.max(45, Math.min(180, base));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function easeInOut(t) {
  const p = clamp(t, 0, 1);
  return p * p * (3 - 2 * p);
}

/** Mulberry32 — deterministic shuffle from seed string. */
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
 * Resolve absolute path for a manifest file entry.
 * @param {{ file: string }} track
 */
export function resolveTrackPath(track) {
  const rel = (track.file || '').replace(/^\//, ''); // crate/...
  const abs = path.join(ROOT, 'public', rel);
  return abs;
}

/**
 * Load CC0 file tracks that exist on disk (no NCS, no procedural, no slots).
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
        plannedSec: plannedPlayLength(t),
      });
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
 */
export function createSchedule(opts = {}) {
  const seed = opts.seed || process.env.SHOW_SEED || 'dj-drosophila';
  const showStartMs =
    opts.showStartMs ??
    (process.env.SHOW_START_MS ? Number(process.env.SHOW_START_MS) : Date.now());

  const fileTracks = loadFileTracks();
  const rand = mulberry32(hashSeed(seed));
  const rotation = shuffle(fileTracks, rand);

  /** One cycle through the rotation (play + transition each). */
  const cycle = rotation.map((track, i) => {
    const next = rotation[(i + 1) % rotation.length];
    return {
      track,
      next,
      plannedSec: track.plannedSec,
      transitionSec: TRANSITION_SEC,
      slotSec: track.plannedSec + TRANSITION_SEC,
    };
  });

  const cycleSec = cycle.reduce((s, c) => s + c.slotSec, 0);

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
    };
  }

  /**
   * Locate absolute timeline slot for elapsed seconds since show start.
   */
  function locate(elapsedSec) {
    if (elapsedSec < 0) elapsedSec = 0;
    const cyclesDone = Math.floor(elapsedSec / cycleSec);
    let into = elapsedSec - cyclesDone * cycleSec;
    let absIndex = cyclesDone * cycle.length;
    for (let i = 0; i < cycle.length; i++) {
      const slot = cycle[i];
      if (into < slot.plannedSec) {
        return {
          absIndex: absIndex + i,
          slotIndex: i,
          phase: 'PLAYING',
          intoSlot: into,
          playedSec: into,
          plannedSec: slot.plannedSec,
          transitionProgress: null,
          transitionSec: slot.transitionSec,
          track: slot.track,
          next: slot.next,
          remainingPlay: slot.plannedSec - into,
          remainingTransition: slot.transitionSec,
        };
      }
      into -= slot.plannedSec;
      if (into < slot.transitionSec) {
        const prog = into / slot.transitionSec;
        return {
          absIndex: absIndex + i,
          slotIndex: i,
          phase: 'TRANSITION',
          intoSlot: slot.plannedSec + into,
          playedSec: slot.plannedSec,
          plannedSec: slot.plannedSec,
          transitionProgress: prog,
          transitionSec: slot.transitionSec,
          track: slot.track,
          next: slot.next,
          remainingPlay: 0,
          remainingTransition: slot.transitionSec - into,
        };
      }
      into -= slot.transitionSec;
    }
    // Should not reach — float edge: wrap to start of next cycle
    return locate(elapsedSec + 0.001);
  }

  /**
   * Full SSE / API state snapshot.
   * @param {number} [nowMs]
   */
  function getState(nowMs = Date.now()) {
    const serverTime = nowMs;
    const elapsedSec = (serverTime - showStartMs) / 1000;
    const loc = locate(elapsedSec);

    const activeDeck = loc.absIndex % 2 === 0 ? 'A' : 'B';
    const quietDeck = activeDeck === 'A' ? 'B' : 'A';

    // During PLAYING: active = current track, quiet = next (preloaded visually)
    // During TRANSITION: active still outgoing until flip; quiet = incoming
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
      statusLine,
      timeStr,
      edgeLabel,
      streamUrl: '/hls/live.m3u8',
      // Internal (also useful for ffmpeg producer)
      _absIndex: loc.absIndex,
      _remainingPlay: loc.remainingPlay,
      _remainingTransition: loc.remainingTransition,
      _trackPath: loc.track.path,
      _nextPath: loc.next.path,
      _elapsedSec: elapsedSec,
    };
  }

  /**
   * Enumerate upcoming segments from a given time (for ffmpeg planning).
   * @param {number} fromMs
   * @param {number} horizonSec
   */
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
          seekSec: st.playedSec,
          absIndex: st._absIndex,
          activeDeck: st.activeDeck,
        });
        t += dur * 1000;
      } else {
        const dur = st._remainingTransition;
        out.push({
          kind: 'TRANSITION',
          startMs: t,
          durationSec: dur,
          fromPath: st._trackPath,
          toPath: st._nextPath,
          // Seek into outgoing track near its planned end
          fromSeekSec: Math.max(0, st.plannedSec - st.transitionSec + (st.transitionProgress || 0) * st.transitionSec),
          toSeekSec: (st.transitionProgress || 0) * st.transitionSec,
          fadeSec: st.transitionSec,
          progressAtStart: st.transitionProgress || 0,
          absIndex: st._absIndex,
          activeDeck: st.activeDeck,
          fromTrack: st.activeDeck === 'A' ? st.trackA : st.trackB,
          toTrack: st.nextTrack,
        });
        t += dur * 1000;
      }
      // Nudge past boundary float noise
      t += 1;
    }
    return out;
  }

  return {
    showStartMs,
    seed,
    rotation,
    cycle,
    cycleSec,
    getState,
    upcomingSegments,
    fileTracks,
  };
}
