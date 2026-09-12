/**
 * Style presets — genre-lane heuristics, not artist clones.
 * Internal ids only. UI labels live in the HUD.
 *
 * These are user-owned policy knobs: energy arc, blend speed, skip aggression,
 * preferred BPM windows, crossfade smoothness. No labeled artist weights ship here.
 *
 * xfSmooth is seconds-scale slew toward target (tau ~0.8–1.5). Fast numbers
 * here made the fader twitchy; keep them slow even for bass-blender.
 */

/** @typedef {'stadium-hype' | 'psy-peak' | 'bass-blender'} StyleId */

/**
 * @typedef {object} StylePreset
 * @property {StyleId} id
 * @property {string} label
 * @property {string} blurb
 * @property {number} energyArc        // preference for rising energy (−1..+1 bias weight)
 * @property {number} blendSpeed       // how fast xfader may move (0..1) — policy aggressiveness
 * @property {number} skipAggression   // skip willingness (0..1)
 * @property {[number, number]} bpmRange
 * @property {number} xfSmooth         // slew tau seconds toward target (applied in main/mixer)
 * @property {number} phraseBars       // 8 or 16
 * @property {number} gateBeats        // half-width around phrase boundary
 * @property {number} xfSwing          // max |xfader| push toward louder deck
 * @property {number} crashSkipBoost   // extra skip score on energy crash
 * @property {number} maxXfDelta       // max |Δxfader| per ~16ms frame (slew cap)
 */

/** @type {Record<StyleId, StylePreset>} */
export const STYLES = {
  'stadium-hype': {
    id: 'stadium-hype',
    label: 'Stadium hype',
    blurb: 'Big drops, hyped cuts, energy-up preference. Heuristic lane — not an imitation of any artist.',
    energyArc: 0.85,
    blendSpeed: 0.38,
    skipAggression: 0.28,
    bpmRange: [118, 132],
    xfSmooth: 1.0,
    phraseBars: 8,
    gateBeats: 1.0,
    xfSwing: 0.75,
    crashSkipBoost: 0.35,
    maxXfDelta: 0.04,
  },
  'psy-peak': {
    id: 'psy-peak',
    label: 'Psy peak',
    blurb: 'Long blends, high-BPM comfort, rolling energy. Psytrance lane heuristics — your dials, not a set clone.',
    energyArc: 0.55,
    blendSpeed: 0.16,
    skipAggression: 0.08,
    bpmRange: [138, 150],
    xfSmooth: 1.45,
    phraseBars: 16,
    gateBeats: 0.75,
    xfSwing: 0.5,
    crashSkipBoost: 0.75,
    maxXfDelta: 0.025,
  },
  'bass-blender': {
    id: 'bass-blender',
    label: 'Bass blender',
    blurb: 'Aggressive switches, bass-forward, syncopated skips. Bass/dubstep lane — trainable, not copyrighted.',
    energyArc: 0.4,
    blendSpeed: 0.55,
    skipAggression: 0.78,
    bpmRange: [128, 150],
    xfSmooth: 0.85,
    phraseBars: 8,
    gateBeats: 1.75,
    xfSwing: 0.8,
    crashSkipBoost: 0.55,
    maxXfDelta: 0.07,
  },
};

/** Public club default: slow psy-like blends (override in lab via HUD). */
/** @type {StyleId} */
export const DEFAULT_STYLE_ID = 'psy-peak';

export function getStyle(styleId) {
  return STYLES[styleId] || STYLES[DEFAULT_STYLE_ID];
}

export function listStyles() {
  return Object.values(STYLES);
}
