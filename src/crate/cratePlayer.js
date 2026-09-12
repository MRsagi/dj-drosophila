/**
 * Public music crate: CC0 file tracks + procedural beds as fallback.
 * Club prefers real files when present. Policy picks next track with
 * energy/BPM heuristics + unsupervised cluster bias.
 * Spotify is intentionally unsupported.
 *
 * Rotation: avoid last 2 track ids + other deck; prefer different BPM family;
 * setEngine drives long plays using AudioBuffer duration when available.
 */

import manifest from './manifest.json';
import { createProceduralTrack } from './proceduralCrate.js';
import { decodeFile, playBuffer } from '../demo/synthTracks.js';

/** Bars on a deck before auto-prep of a fresh track (phrase-gated in main). */
export const AUTO_ADVANCE_BARS = 32;

export function getManifest() {
  return manifest;
}

export function activeTracks() {
  return (manifest.tracks || []).filter((t) => !t.slot);
}

/** File tracks that are ready (not placeholders). */
export function fileTracks() {
  return activeTracks().filter((t) => t.source === 'file' && t.file);
}

export function proceduralTracks() {
  return activeTracks().filter((t) => t.source === 'procedural');
}

/**
 * Club preference: use real CC0 files when any are listed; otherwise procedural.
 */
export function preferredTracks() {
  const files = fileTracks();
  return files.length ? files : activeTracks();
}

export function attributionLines() {
  const lines = [];
  const files = fileTracks();
  for (const t of files) {
    const lic = t.license || 'CC0';
    const url = t.attributionUrl ? ` · ${t.attributionUrl}` : '';
    lines.push(`${t.title} — ${t.artist} (${lic})${url}`);
  }
  if (files.length && proceduralTracks().length) {
    lines.push('Procedural CC0 beds available as fallback');
  } else if (!files.length) {
    for (const t of proceduralTracks()) {
      const lic = t.license || 'CC0';
      lines.push(`${t.title} — ${t.artist} (${lic}, procedural)`);
    }
  }
  if (!lines.length) {
    lines.push('Procedural CC0 beds (no external files loaded)');
  }
  return lines;
}

/** Coarse BPM family for audible rotation (not genre cloning). */
export function bpmFamily(bpm) {
  const b = bpm || 124;
  if (b < 110) return 'ambient';
  if (b < 123) return 'groove';
  if (b < 134) return 'drive';
  if (b < 150) return 'peak';
  return 'break';
}

/**
 * Score a candidate track given current mix features + optional unsup model.
 * Mild BPM match, but diversity bonus when avoiding same family / recent ids.
 * Club: bonus for file sources when the crate has real mp3s.
 */
export function scoreTrack(track, ctxFeat, unsupModel, opts = {}) {
  if (!track || track.slot) return -Infinity;
  let score = 0;
  const bpm = ctxFeat?.bpm || 124;
  const energy = ctxFeat?.energyMaster ?? ctxFeat?.rms ?? 0.5;
  const bpmDiff = Math.abs((track.bpm || 124) - bpm);
  // Soft BPM preference (was too sticky → same-family loops)
  score -= bpmDiff * 0.015;
  const te = track.energy ?? 0.6;
  score -= Math.abs(te - energy) * 0.7;
  score += Math.max(0, te - energy) * 0.2;

  const curFam = opts.currentFamily || bpmFamily(bpm);
  const candFam = bpmFamily(track.bpm);
  if (candFam !== curFam) score += 0.55;
  else score -= 0.25;

  if (opts.avoidIds?.has(track.id)) score -= 5;
  if (opts.otherDeckId && track.id === opts.otherDeckId) score -= 4;
  if (opts.otherFamily && candFam === opts.otherFamily) score -= 0.2;

  // Prefer real files in club when the crate ships mp3s
  if (opts.preferFiles) {
    if (track.source === 'file') score += 1.25;
    else score -= 0.85;
  }

  if (unsupModel?.centroids?.length) {
    const k = unsupModel.k || unsupModel.centroids.length;
    const bucket = Math.min(k - 1, Math.max(0, Math.floor(te * k)));
    const cluster = ctxFeat?.unsupCluster ?? bucket;
    score += cluster === bucket ? 0.25 : 0;
  }

  score += (Math.random() - 0.5) * 0.35;
  return score;
}

/**
 * @param {string|null} currentId
 * @param {object} ctxFeat
 * @param {object|null} unsupModel
 * @param {{ avoidIds?: string[], otherDeckId?: string|null }} [opts]
 */
export function pickNextTrack(currentId, ctxFeat, unsupModel, opts = {}) {
  const avoid = new Set([...(opts.avoidIds || []), currentId].filter(Boolean));
  const preferFiles = fileTracks().length > 0;
  // Club: draw from file pool first; fall back to full active set if exhausted
  const primary = preferFiles ? fileTracks() : activeTracks();
  const pool = primary.filter((t) => !avoid.has(t.id));
  const fallbackPool = primary.filter((t) => t.id !== currentId);
  let use = pool.length ? pool : fallbackPool.length ? fallbackPool : primary;
  // If file pool is empty after filters, allow procedural fallbacks
  if (!use.length) {
    use = activeTracks().filter((t) => t.id !== currentId);
    if (!use.length) use = activeTracks();
  }
  if (!use.length) return null;

  const other = opts.otherDeckId
    ? activeTracks().find((t) => t.id === opts.otherDeckId)
    : null;
  const scoreOpts = {
    avoidIds: avoid,
    otherDeckId: opts.otherDeckId || null,
    currentFamily: bpmFamily(ctxFeat?.bpm),
    otherFamily: other ? bpmFamily(other.bpm) : null,
    preferFiles,
  };

  let best = use[0];
  let bestScore = -Infinity;
  for (const t of use) {
    const s = scoreTrack(t, ctxFeat, unsupModel, scoreOpts);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  // Hard guarantee: never return the same id as current if alternatives exist
  if (best.id === currentId && fallbackPool.length) {
    return fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
  }
  return best;
}

/**
 * Dual-deck crate engine: keeps A/B fed from crate (file preferred, procedural fallback).
 */
export function createCrateEngine(ctx) {
  /** @type {Map<string, object>} */
  const procCache = new Map();
  let deckProcA = null;
  let deckProcB = null;
  let fileSrcA = null;
  let fileSrcB = null;
  let trackA = null;
  let trackB = null;
  let usingCrate = true;
  /** @type {string[]} last loaded track ids (max 2) — avoid immediate repeats */
  const recentIds = [];
  /** audio-time when each deck last got a new track */
  const loadedAt = { A: 0, B: 0 };

  function pushRecent(id) {
    if (!id) return;
    recentIds.push(id);
    while (recentIds.length > 2) recentIds.shift();
  }

  function stopProc(which) {
    const p = which === 'A' ? deckProcA : deckProcB;
    if (p) p.stop();
    if (which === 'A') deckProcA = null;
    else deckProcB = null;
  }

  function stopFile(which) {
    const s = which === 'A' ? fileSrcA : fileSrcB;
    if (s) {
      try {
        s.stop();
      } catch {
        /* ended */
      }
    }
    if (which === 'A') fileSrcA = null;
    else fileSrcB = null;
  }

  /**
   * Fetch + decode a crate mp3 into an AudioBuffer.
   * Paths are site-root absolute (`/crate/...`) served from public/.
   */
  async function tryLoadFile(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      return buf;
    } catch {
      return null;
    }
  }

  /**
   * Load a manifest track onto a deck. Falls back to procedural house if file missing.
   * File loads attach AudioBuffer duration onto the track for setEngine play length.
   * Always starts a fresh scheduler for that proceduralId+side (restart from step 0).
   * @param {'A'|'B'} side
   * @param {object} track
   * @param {object} mixerDeck — mixer.deckA / deckB
   * @param {(node: AudioNode) => void} attach — mixer.attachSource(deck, node)
   */
  async function loadTrack(side, track, mixerDeck, attach) {
    if (!track) return null;
    stopFile(side);
    stopProc(side);

    let node = null;
    let used = track;
    let meta = '';

    if (track.source === 'file' && track.file && !track.slot) {
      const buf = await tryLoadFile(track.file);
      if (buf) {
        // Loop so short beds cover setEngine planned length; duration drives transitions.
        const src = playBuffer(ctx, buf, { loop: true });
        if (side === 'A') fileSrcA = src;
        else fileSrcB = src;
        node = src;
        const dur = buf.duration;
        used = {
          ...track,
          duration: dur,
          durationHint: track.durationHint ?? Math.round(dur),
        };
        const mins = (dur / 60).toFixed(1);
        meta = `file · ${track.license} · ${track.bpm} BPM · ${mins} min`;
      }
    }

    if (!node) {
      let pid = track.proceduralId;
      if (!pid || track.source === 'file') {
        const procs = proceduralTracks();
        // Prefer stand-in with different id from recent / other deck
        const avoid = new Set(recentIds);
        if (side === 'A' && trackB?.id) avoid.add(trackB.id);
        if (side === 'B' && trackA?.id) avoid.add(trackA.id);
        const ranked = procs
          .slice()
          .sort((a, b) => {
            const aPen = avoid.has(a.id) ? 100 : 0;
            const bPen = avoid.has(b.id) ? 100 : 0;
            return (
              aPen +
              Math.abs(a.bpm - (track.bpm || 124)) -
              (bPen + Math.abs(b.bpm - (track.bpm || 124)))
            );
          });
        const standIn = ranked[0] || procs[0];
        if (standIn) {
          used = { ...standIn, title: `${standIn.title} (stand-in)`, _standInFor: track.id };
          pid = standIn.proceduralId;
          meta = `procedural stand-in · file missing · ${standIn.bpm} BPM`;
        }
      }
      if (pid) {
        const cacheKey = `${pid}::${side}`;
        let proc = procCache.get(cacheKey);
        if (!proc) {
          proc = createProceduralTrack(ctx, pid);
          procCache.set(cacheKey, proc);
        }
        // Always restart so a re-pick of the same id is a clean loop, not mid-phrase mush
        proc.stop();
        if (side === 'A') deckProcA = proc;
        else deckProcB = proc;
        node = proc.out;
        if (!meta) meta = `procedural · ${used.license || track.license || 'CC0'} · ${proc.bpm} BPM · ${bpmFamily(proc.bpm)}`;
        if (usingCrate) proc.start();
      }
    }

    if (node) attach(mixerDeck, node);
    if (side === 'A') {
      trackA = used;
      loadedAt.A = ctx.currentTime;
    } else {
      trackB = used;
      loadedAt.B = ctx.currentTime;
    }
    pushRecent(used?.id);
    return { track: used, meta };
  }

  function start() {
    usingCrate = true;
    if (deckProcA && !deckProcA.running) deckProcA.start();
    if (deckProcB && !deckProcB.running) deckProcB.start();
  }

  function stop() {
    usingCrate = false;
    if (deckProcA) deckProcA.stop();
    if (deckProcB) deckProcB.stop();
  }

  function tick() {
    if (!usingCrate) return;
    if (deckProcA) deckProcA.tick();
    if (deckProcB) deckProcB.tick();
  }

  function barsOnDeck(side) {
    const track = side === 'A' ? trackA : trackB;
    const bpm = track?.bpm || (side === 'A' ? deckProcA?.bpm : deckProcB?.bpm) || 124;
    const t0 = loadedAt[side] || 0;
    const elapsed = Math.max(0, ctx.currentTime - t0);
    return (elapsed * bpm) / 240; // 4/4 bars
  }

  function pickOpts(fromSide) {
    const other = fromSide === 'A' ? trackB : trackA;
    return {
      avoidIds: [...recentIds],
      otherDeckId: other?.id || null,
    };
  }

  /**
   * After a skip (or auto-advance), load a new track onto the dumped deck.
   * Guarantees a different crate id when possible (not a restart of the same bed).
   */
  async function advanceAfterSkip(fromSide, mixer, feat, unsupModel) {
    const current = fromSide === 'A' ? trackA : trackB;
    const next = pickNextTrack(current?.id, feat, unsupModel, pickOpts(fromSide));
    if (!next) return null;
    // Extra safety: if pick somehow returned same bed, force another
    let chosen = next;
    if (chosen.id === current?.id || (chosen.proceduralId && chosen.proceduralId === current?.proceduralId)) {
      const pool = preferredTracks();
      const alt = pool.find(
        (t) =>
          t.id !== current?.id &&
          t.proceduralId !== current?.proceduralId &&
          t.id !== (fromSide === 'A' ? trackB?.id : trackA?.id),
      );
      if (alt) chosen = alt;
    }
    const deck = fromSide === 'A' ? mixer.deckA : mixer.deckB;
    const result = await loadTrack(fromSide, chosen, deck, (d, n) => mixer.attachSource(d, n));
    return result;
  }

  /**
   * Auto-advance the quieter / prep deck when the active side has played long enough.
   * @returns {Promise<object|null>}
   */
  async function autoAdvanceQuietDeck(mixer, feat, unsupModel, xfader) {
    const activeSide = xfader <= 0 ? 'A' : 'B';
    const quietSide = activeSide === 'A' ? 'B' : 'A';
    if (barsOnDeck(activeSide) < AUTO_ADVANCE_BARS) return null;
    // Also require quiet deck aged a bit so we don't thrash both
    if (barsOnDeck(quietSide) < AUTO_ADVANCE_BARS * 0.5) return null;
    return advanceAfterSkip(quietSide, mixer, feat, unsupModel);
  }

  return {
    loadTrack,
    start,
    stop,
    tick,
    advanceAfterSkip,
    autoAdvanceQuietDeck,
    pickNextTrack,
    barsOnDeck,
    bpmFamily,
    get recentIds() {
      return recentIds.slice();
    },
    get trackA() {
      return trackA;
    },
    get trackB() {
      return trackB;
    },
    get bpmA() {
      return trackA?.bpm || deckProcA?.bpm || 124;
    },
    get bpmB() {
      return trackB?.bpm || deckProcB?.bpm || 126;
    },
    get running() {
      return (
        usingCrate &&
        ((deckProcA && deckProcA.running) ||
          (deckProcB && deckProcB.running) ||
          fileSrcA ||
          fileSrcB)
      );
    },
    stopFile,
    stopProc,
  };
}

export { decodeFile, playBuffer };
