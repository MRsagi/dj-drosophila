/**
 * Dual-deck Web Audio mixer.
 * Crossfader, dump gains, per-deck EQ/filter (set-engine FX), comic skip filter,
 * tanh soft clip + compressor.
 *
 * Club set-engine parks xfader on an EDGE most of the time; LIF/policy must not
 * continuously ride it (see src/dj/setEngine.js).
 */

import { createAnalyser } from './analyser.js';

function tanhCurve(drive = 2) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

function makeDeck(ctx, id) {
  const input = ctx.createGain();
  input.gain.value = 1;
  const dump = ctx.createGain();
  dump.gain.value = 1;

  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 180;
  eqLow.gain.value = 0;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 4500;
  eqHigh.gain.value = 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 18000;
  filter.Q.value = 0.7;

  const xfade = ctx.createGain();
  xfade.gain.value = 0.707;
  const analyser = createAnalyser(ctx, { smoothing: id === 'A' ? 0.5 : 0.52 });

  // input → dump → EQ → filter → xfade
  // analyser taps pre-FX so eyes still see deck energy
  input.connect(dump);
  dump.connect(eqLow);
  eqLow.connect(eqHigh);
  eqHigh.connect(filter);
  filter.connect(xfade);
  dump.connect(analyser.node);

  return { id, input, dump, eqLow, eqHigh, filter, xfade, analyser, source: null };
}

export function createMixer(ctx) {
  const deckA = makeDeck(ctx, 'A');
  const deckB = makeDeck(ctx, 'B');

  const mix = ctx.createGain();
  const skipFilter = ctx.createBiquadFilter();
  skipFilter.type = 'lowpass';
  skipFilter.frequency.value = 18000;
  skipFilter.Q.value = 0.7;

  const shaper = ctx.createWaveShaper();
  shaper.curve = tanhCurve(2.1);
  shaper.oversample = '2x';

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  const master = ctx.createGain();
  master.gain.value = 0.68;

  const masterAnalyser = createAnalyser(ctx, { smoothing: 0.4, fftSize: 1024 });

  deckA.xfade.connect(mix);
  deckB.xfade.connect(mix);
  mix.connect(skipFilter);
  skipFilter.connect(shaper);
  shaper.connect(limiter);
  limiter.connect(master);
  master.connect(masterAnalyser.node);
  master.connect(ctx.destination);

  let xfader = 0; // -1 = A, +1 = B
  let xfaderTarget = 0;
  let lastSkipAt = -10;
  let lastSkipFrom = 'A';

  function equalPower(x) {
    const t = (x + 1) * 0.5; // 0..1
    const a = Math.cos(t * Math.PI * 0.5);
    const b = Math.sin(t * Math.PI * 0.5);
    return { a, b };
  }

  function applyGains(x, rampSec) {
    const { a, b } = equalPower(x);
    const t = ctx.currentTime;
    const tc = Math.max(0.02, rampSec / 3);
    deckA.xfade.gain.setTargetAtTime(a, t, tc);
    deckB.xfade.gain.setTargetAtTime(b, t, tc);
  }

  /**
   * Set crossfader. Prefer setCrossfaderSlewed from the render loop when blending.
   * @param {number} x  -1..+1
   * @param {number} [ramp=0.2]
   */
  function setCrossfader(x, ramp = 0.2) {
    xfaderTarget = Math.max(-1, Math.min(1, x));
    xfader = xfaderTarget;
    applyGains(xfader, ramp);
  }

  /**
   * Low-pass + slew-rate limit toward target (TRANSITION blends).
   * @param {number} target  -1..+1
   * @param {number} dt
   * @param {{ tau?: number, maxDelta?: number }} [opts]
   */
  function setCrossfaderSlewed(target, dt, opts = {}) {
    const tau = Math.max(0.25, opts.tau ?? 1.0);
    const maxDelta = Math.max(0.005, opts.maxDelta ?? 0.04);
    xfaderTarget = Math.max(-1, Math.min(1, target));
    const alpha = 1 - Math.exp(-Math.max(0.001, dt) / tau);
    let next = xfader + (xfaderTarget - xfader) * alpha;
    const step = Math.max(-maxDelta, Math.min(maxDelta, next - xfader));
    xfader = Math.max(-1, Math.min(1, xfader + step));
    applyGains(xfader, Math.max(0.12, tau * 0.35));
    return xfader;
  }

  function setMaster(v, ramp = 0.08) {
    const g = Math.max(0.0001, Math.min(1, v));
    master.gain.setTargetAtTime(g, ctx.currentTime, ramp / 3);
  }

  function attachSource(deck, node) {
    if (deck.source) {
      try {
        deck.source.disconnect();
      } catch {
        /* already gone */
      }
    }
    deck.source = node;
    if (node) node.connect(deck.input);
  }

  /**
   * GF-triggered emergency skip: dump active deck, slam xfader to opposite edge.
   * Rare in club PLAYING; default path is long play + planned TRANSITION.
   */
  function skip(forceFrom) {
    const now = ctx.currentTime;
    if (now - lastSkipAt < 0.85) return false;
    lastSkipAt = now;

    const from = forceFrom || (xfader <= 0 ? 'A' : 'B');
    const to = from === 'A' ? 'B' : 'A';
    const dead = from === 'A' ? deckA : deckB;
    lastSkipFrom = from;

    dead.dump.gain.cancelScheduledValues(now);
    dead.dump.gain.setValueAtTime(Math.max(0.0001, dead.dump.gain.value), now);
    dead.dump.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    dead.dump.gain.exponentialRampToValueAtTime(1, now + 0.85);

    skipFilter.frequency.cancelScheduledValues(now);
    skipFilter.Q.cancelScheduledValues(now);
    skipFilter.Q.setValueAtTime(9, now);
    skipFilter.frequency.setValueAtTime(220, now);
    skipFilter.frequency.exponentialRampToValueAtTime(7200, now + 0.16);
    skipFilter.frequency.exponentialRampToValueAtTime(18000, now + 0.62);
    skipFilter.Q.linearRampToValueAtTime(0.7, now + 0.62);

    // Park hard on destination EDGE (not mid)
    setCrossfader(to === 'B' ? 1 : -1, 0.08);
    return { from, to, at: now };
  }

  setCrossfader(-1, 0.01); // default edge A for club intro

  return {
    ctx,
    deckA,
    deckB,
    mix,
    master,
    masterAnalyser,
    skipFilter,
    get xfader() {
      return xfader;
    },
    get xfaderTarget() {
      return xfaderTarget;
    },
    get lastSkipAt() {
      return lastSkipAt;
    },
    get lastSkipFrom() {
      return lastSkipFrom;
    },
    setCrossfader,
    setCrossfaderSlewed,
    setMaster,
    attachSource,
    skip,
    getMasterGain() {
      return master.gain.value;
    },
  };
}
