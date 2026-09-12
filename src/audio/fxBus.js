/**
 * FX / EQ automation during PLAYING (and soft reset in TRANSITION).
 *
 * Policy / LIF / unsupervised may bias intensity — they do NOT ride the crossfader.
 * Slow filter + EQ sweeps over the long play; optional wet/delay when novelty high.
 * Mid-track skip is NOT this module's job (setEngine + rare emergency cut).
 */

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Attach a simple feedback delay send off the mixer mix bus if exposed;
 * otherwise deck EQ/filter alone is enough.
 *
 * @param {AudioContext} ctx
 * @param {ReturnType<import('./mixer.js').createMixer>} mixer
 */
export function createFxBus(ctx, mixer) {
  /** @type {DelayNode|null} */
  let delay = null;
  /** @type {GainNode|null} */
  let delayWet = null;
  let delayWired = false;

  function ensureDelay() {
    if (delayWired || !mixer?.mix) return;
    try {
      delay = ctx.createDelay(0.9);
      delay.delayTime.value = 0.19;
      const fb = ctx.createGain();
      fb.gain.value = 0.22;
      delayWet = ctx.createGain();
      delayWet.gain.value = 0;
      // mix → delay → wet → skipFilter path (mixer.skipFilter is post-mix)
      mixer.mix.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(mixer.skipFilter);
      delayWired = true;
    } catch {
      delay = null;
      delayWet = null;
    }
  }

  ensureDelay();

  /**
   * @param {object} opts
   * @param {object} opts.set  setEngine tick snapshot
   * @param {object|null} [opts.decision]
   * @param {number} [opts.now]
   * @param {number} [opts.dt]
   */
  function apply({ set, decision, now }) {
    if (!mixer?.deckA?.filter) return;
    const t = now ?? ctx.currentTime;
    const intensity = clamp(set?.fxIntensity ?? decision?.fxIntensity ?? 0.35, 0.05, 1);
    const played = set?.playedSec ?? 0;
    const planned = Math.max(30, set?.plannedSec ?? 90);
    const phase = (played / planned) % 1;
    const state = set?.state || 'PLAYING';
    const novelty = decision?.novelty;

    // Slow sweep over the track (not a constant twitch)
    const sweep = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * 0.4 + played * 0.015);
    const filterHz = clamp(1400 + sweep * (12000 + intensity * 4000), 600, 18000);
    const lowGain = (sweep - 0.5) * 7 * intensity;
    const highGain = (0.5 - sweep) * 5 * intensity;

    const decks = [mixer.deckA, mixer.deckB];
    for (const deck of decks) {
      if (!deck?.filter) continue;
      if (state === 'TRANSITION') {
        // Open up so both decks read clearly during the blend
        deck.filter.frequency.setTargetAtTime(16000, t, 0.25);
        deck.filter.Q.setTargetAtTime(0.7, t, 0.25);
        deck.eqLow?.gain.setTargetAtTime(0, t, 0.3);
        deck.eqHigh?.gain.setTargetAtTime(0, t, 0.3);
      } else {
        deck.filter.type = 'lowpass';
        deck.filter.frequency.setTargetAtTime(filterHz, t, 0.45);
        deck.filter.Q.setTargetAtTime(0.6 + intensity * 0.8, t, 0.4);
        deck.eqLow?.gain.setTargetAtTime(lowGain, t, 0.5);
        deck.eqHigh?.gain.setTargetAtTime(highGain, t, 0.5);
      }
    }

    // Optional wet / “hat filter” stub when novelty or GF pressure high
    if (delayWet) {
      let wet = 0.015 * intensity;
      if (novelty != null && novelty > 0.5) {
        wet = clamp((novelty - 0.45) * 0.35 * intensity, 0, 0.22);
      }
      if (decision?.skipScore > 0.55 && state === 'PLAYING') {
        wet = Math.max(wet, 0.08 * intensity);
      }
      delayWet.gain.setTargetAtTime(wet, t, 0.55);
      if (delay && novelty != null && novelty > 0.65) {
        // Slightly shorter delay = “hatty” flutter stub
        delay.delayTime.setTargetAtTime(0.12 + (1 - novelty) * 0.1, t, 0.4);
      }
    }
  }

  function reset() {
    const t = ctx.currentTime;
    for (const deck of [mixer.deckA, mixer.deckB]) {
      if (!deck?.filter) continue;
      deck.filter.frequency.setTargetAtTime(18000, t, 0.1);
      deck.eqLow?.gain.setTargetAtTime(0, t, 0.1);
      deck.eqHigh?.gain.setTargetAtTime(0, t, 0.1);
    }
    if (delayWet) delayWet.gain.setTargetAtTime(0, t, 0.1);
  }

  return { apply, reset, ensureDelay };
}
