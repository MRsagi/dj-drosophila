/**
 * Set engine — club DJ behavior as a state machine.
 *
 * INTRO → PLAYING → TRANSITION → PLAYING → …
 *
 * PLAYING: crossfader locked to an EDGE (±1). FX/EQ may ride; LIF/policy do NOT
 * continuously blend the xfader. TRANSITION: phrase-aligned slew edge→edge over
 * ~8–16 bars, then flip the active deck.
 *
 * Policy decides WHEN to request a transition (after min play) and FX intensity —
 * not continuous xfader position.
 */

import { getStyle } from '../policy/styles.js';

export const STATES = Object.freeze({
  INTRO: 'INTRO',
  PLAYING: 'PLAYING',
  TRANSITION: 'TRANSITION',
});

/**
 * Planned play length.
 * File tracks: use AudioBuffer duration (set by cratePlayer on load).
 * Procedural beds (no known duration): ~45–180s from BPM / energy / style.
 */
export function plannedPlayLength(track, style) {
  const dur = track?.duration ?? track?.durationHint;
  if (typeof dur === 'number' && dur > 0) {
    // Play most of the file before seeking a transition (loop covers short beds).
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
  const sid = style?.id;
  if (sid === 'psy-peak') base *= 1.3;
  else if (sid === 'bass-blender') base *= 0.72;
  else if (sid === 'stadium-hype') base *= 0.9;
  return Math.max(45, Math.min(180, base));
}

/**
 * Min seconds on the active deck before a transition is allowed.
 * Known duration → max(30, min(180, dur * 0.55)); else planned-length floor.
 */
export function minPlayBeforeTransition(track, plannedSec) {
  const dur = track?.duration;
  if (typeof dur === 'number' && dur > 0) {
    return Math.max(30, Math.min(180, dur * 0.55));
  }
  return Math.max(30, Math.min(180, (plannedSec || 90) * 0.55));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function easeInOut(t) {
  const p = clamp(t, 0, 1);
  return p * p * (3 - 2 * p);
}

/**
 * @returns {ReturnType<typeof buildApi>}
 */
export function createSetEngine() {
  let state = STATES.INTRO;
  /** @type {'A'|'B'} */
  let activeSide = 'A';
  let playStartAt = 0;
  let playedSec = 0;
  let plannedSec = 90;
  let minPlaySec = 30;
  let transitionStartAt = 0;
  let transitionDurSec = 24;
  let transitionFrom = -1;
  let transitionTo = 1;
  let transitionProgress = 0;
  /** @type {string|null} */
  let nextTitle = null;
  let preloadStarted = false;
  let introSnapped = false;
  /** Quiet-deck preload lead before allowed transition (seconds). */
  const PRELOAD_LEAD = 15;
  /** @type {((side: 'A'|'B') => void)|null} */
  let preloadCb = null;

  function activeEdge() {
    return activeSide === 'A' ? -1 : 1;
  }

  function quietSide() {
    return activeSide === 'A' ? 'B' : 'A';
  }

  function activeTrack(crate) {
    return activeSide === 'A' ? crate?.trackA : crate?.trackB;
  }

  function resetPlayClock(now, track, style) {
    playStartAt = now;
    playedSec = 0;
    plannedSec = plannedPlayLength(track, style);
    minPlaySec = minPlayBeforeTransition(track, plannedSec);
    preloadStarted = false;
    transitionProgress = 0;
  }

  function transitionDurationSec(style, bpm) {
    let bars = 12;
    if (style?.id === 'psy-peak' || style?.phraseBars === 16) bars = 16;
    else if (style?.id === 'bass-blender') bars = 8;
    else if (style?.phraseBars === 8) bars = 10;
    const b = bpm || 124;
    // bars * 4 beats * (60/bpm) seconds
    const sec = (bars * 4 * 60) / b;
    return clamp(sec, 15, 32);
  }

  /**
   * Call once when the mix starts (or after crate reset).
   * @param {number} now
   * @param {object} [crate]
   * @param {object} [style]
   * @param {'A'|'B'} [prefer='A']
   */
  function begin(now, crate, style, prefer = 'A') {
    state = STATES.INTRO;
    activeSide = prefer === 'B' ? 'B' : 'A';
    introSnapped = false;
    nextTitle = null;
    resetPlayClock(now, activeTrack(crate), style || getStyle());
  }

  function setNextTitle(title) {
    nextTitle = title || null;
  }

  function onPreload(cb) {
    preloadCb = cb;
  }

  /**
   * Emergency skip / GF cut: park on destination edge and restart PLAYING clock.
   * @param {'A'|'B'} toSide
   * @param {number} now
   * @param {object} [crate]
   * @param {object} [style]
   */
  function forceSkipTo(toSide, now, crate, style) {
    activeSide = toSide === 'B' ? 'B' : 'A';
    state = STATES.PLAYING;
    introSnapped = true;
    nextTitle = null;
    resetPlayClock(now, activeTrack(crate), style);
  }

  /**
   * Per-frame step. Club mode must honor lockXfader and ignore LIF/policy xfader.
   *
   * @param {object} ctx
   * @param {number} ctx.now
   * @param {number} ctx.dt
   * @param {object|null} ctx.decision  policy.decide() result
   * @param {object} ctx.style
   * @param {object|null} ctx.crate
   * @param {object|null} ctx.mixer
   * @returns {object} drive + HUD snapshot
   */
  function tick(ctx) {
    const { now, decision, style, crate, mixer } = ctx;
    const st = style || getStyle();

    if (state === STATES.INTRO) {
      const edge = activeEdge();
      if (mixer && !introSnapped) {
        mixer.setCrossfader(edge, 0.12);
        introSnapped = true;
      }
      resetPlayClock(now, activeTrack(crate), st);
      state = STATES.PLAYING;
      return snapshot(edge, decision, st);
    }

    if (state === STATES.PLAYING) {
      playedSec = Math.max(0, now - playStartAt);
      const edge = activeEdge();

      // Keep xfader parked on the edge (~90%+ of session time).
      if (mixer) {
        const drift = Math.abs(mixer.xfader - edge);
        if (drift > 0.04) mixer.setCrossfader(edge, 0.2);
        else mixer.setCrossfader(edge, 0.35);
      }

      // Preload next bed on the quiet deck ~10–20s before we may leave.
      if (
        !preloadStarted &&
        playedSec >= Math.max(8, minPlaySec - PRELOAD_LEAD) &&
        typeof preloadCb === 'function'
      ) {
        preloadStarted = true;
        try {
          preloadCb(quietSide());
        } catch {
          /* async errors handled by caller */
        }
      }

      const enough = playedSec >= minPlaySec;
      const overdue = playedSec >= plannedSec;
      const policyWants = !!(decision && decision.transitionRequest);
      const gateOk = !decision || decision.gateAllow;

      if (enough && gateOk && (policyWants || overdue)) {
        state = STATES.TRANSITION;
        transitionFrom = edge;
        transitionTo = -edge;
        const bpm =
          (activeSide === 'A' ? crate?.bpmA : crate?.bpmB) ||
          activeTrack(crate)?.bpm ||
          124;
        transitionDurSec = transitionDurationSec(st, bpm);
        transitionStartAt = now;
        transitionProgress = 0;
      }

      return snapshot(edge, decision, st);
    }

    // TRANSITION — both decks audible; slew edge → edge
    if (state === STATES.TRANSITION) {
      const raw = (now - transitionStartAt) / Math.max(0.5, transitionDurSec);
      transitionProgress = clamp(raw, 0, 1);
      const eased = easeInOut(transitionProgress);
      const xf = transitionFrom + (transitionTo - transitionFrom) * eased;

      if (mixer) {
        mixer.setCrossfader(xf, 0.08);
      }

      if (transitionProgress >= 1) {
        activeSide = quietSide(); // flip: former quiet is now active
        state = STATES.PLAYING;
        nextTitle = null;
        resetPlayClock(now, activeTrack(crate), st);
        const edge = activeEdge();
        if (mixer) mixer.setCrossfader(edge, 0.15);
        return snapshot(edge, decision, st);
      }

      return snapshot(xf, decision, st);
    }

    return snapshot(activeEdge(), decision, st);
  }

  function snapshot(xfaderTarget, decision, style) {
    const edge = activeEdge();
    const locked = state === STATES.PLAYING || state === STATES.INTRO;
    const fxIntensity =
      decision?.fxIntensity != null
        ? decision.fxIntensity
        : 0.3 + (style?.blendSpeed || 0.2) * 0.3;

    const playMin = Math.floor(playedSec / 60);
    const playSec = Math.floor(playedSec % 60);
    const planMin = Math.floor(plannedSec / 60);
    const planSec = Math.floor(plannedSec % 60);
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${playMin}:${pad(playSec)} / ${planMin}:${pad(planSec)}`;

    let statusLine;
    if (state === STATES.TRANSITION) {
      statusLine = `TRANSITION ${Math.round(transitionProgress * 100)}% · ${activeSide}→${quietSide()}`;
    } else if (state === STATES.INTRO) {
      statusLine = `INTRO · deck ${activeSide}`;
    } else {
      statusLine = `PLAYING ${activeSide} · ${timeStr}`;
    }

    const edgeLabel = edge <= -0.5 ? 'EDGE A (−1)' : edge >= 0.5 ? 'EDGE B (+1)' : 'blend';

    return {
      state,
      activeSide,
      quietSide: quietSide(),
      activeEdge: edge,
      xfaderTarget: locked ? edge : xfaderTarget,
      lockXfader: locked,
      playedSec,
      plannedSec,
      minPlaySec,
      transitionProgress: state === STATES.TRANSITION ? transitionProgress : null,
      transitionDurSec,
      nextTitle,
      fxIntensity,
      statusLine,
      timeStr,
      edgeLabel,
      canTransition: playedSec >= minPlaySec,
    };
  }

  function getHud() {
    return snapshot(activeEdge(), null, getStyle());
  }

  return {
    begin,
    tick,
    forceSkipTo,
    setNextTitle,
    onPreload,
    getHud,
    get state() {
      return state;
    },
    get activeSide() {
      return activeSide;
    },
    get playedSec() {
      return playedSec;
    },
    get plannedSec() {
      return plannedSec;
    },
    STATES,
  };
}
