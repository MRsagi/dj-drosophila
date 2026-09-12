/**
 * Owned DJ policy head — heuristics first, optional trained + unsupervised blend.
 *
 * Club set-engine role (primary):
 *   • WHEN to request a transition (after min play — enforced by setEngine)
 *   • WHICH next-track bias (via crate pick + unsup cluster)
 *   • FX intensity during long PLAYING
 *   • NOT continuous crossfader position (xfader is edge-locked in PLAYING)
 *
 * Lab / legacy: xfaderTarget still returned for optional continuous blend when
 * set-engine is gated off. MaleCNS / LIF stay sensors + residual actuators.
 */

import { getStyle } from './styles.js';
import { phraseGate, phraseProximity } from './phraseGate.js';
import { loadWeights } from './train.js';
import {
  loadUnsupervisedModel,
  inferUnsupervised,
  unsupervisedBlendWeight,
} from './unsupervised.js';

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-clamp(x, -20, 20)));
}

function applyTrained(features, styleId) {
  const w = loadWeights();
  if (!w || !w.skip || !w.xfader) return { skipLogit: null, xfResidual: null };
  const styleBoost = w.style?.[styleId] ?? 0;

  const skipVec = [
    1,
    features.energySlope,
    features.energyA - features.energyB,
    features.kickDensity,
    features.coincidentKick,
    features.phrasePhase,
    features.bass,
    features.dnLRate / 30,
    features.dnRRate / 30,
    styleBoost,
  ];
  const xfVec = [
    1,
    features.energyB - features.energyA,
    features.eyeAsym,
    features.energySlope,
    features.bass,
    (features.dnRRate - features.dnLRate) / 30,
  ];

  let skipLogit = 0;
  const sw = w.skip;
  for (let i = 0; i < skipVec.length && i < sw.length; i++) skipLogit += sw[i] * skipVec[i];

  let xfResidual = 0;
  const xw = w.xfader;
  for (let i = 0; i < xfVec.length && i < xw.length; i++) xfResidual += xw[i] * xfVec[i];

  return { skipLogit, xfResidual: clamp(xfResidual, -0.5, 0.5) };
}

/**
 * @param {object} features  from features.extract()
 * @param {string} styleId
 * @param {object} [opts]
 * @param {boolean} [opts.humanOverride]
 * @param {boolean} [opts.gfFired]
 * @param {object|null} [opts.unsupModel]
 * @param {number} [opts.playedSec]  set-engine clock (optional hint)
 * @param {number} [opts.minPlaySec]
 * @returns {object}
 */
export function decide(features, styleId, opts = {}) {
  const style = getStyle(styleId);
  const humanOverride = !!opts.humanOverride;
  const gfFired = !!opts.gfFired;

  const gate = phraseGate({
    phrasePhase: features.phrasePhase,
    gateBeats: style.gateBeats,
    phraseBars: style.phraseBars,
    humanOverride,
  });
  const prox = phraseProximity({
    phrasePhase: features.phrasePhase,
    gateBeats: style.gateBeats,
    phraseBars: style.phraseBars,
  });

  const louderIsB = features.energyB >= features.energyA;
  const energyGap = Math.abs(features.energyB - features.energyA);
  const rising = features.energySlope > 0.002;
  const crashing = features.energySlope < -0.012;

  let preference = louderIsB ? 1 : -1;
  if (style.energyArc > 0.5 && rising) {
    preference = features.energyB - features.energyA >= 0 ? 1 : -1;
  }

  const nearDrop = prox > 0.45;

  // Legacy continuous xfader target (lab only — club setEngine ignores this).
  // Park near edges when preference is clear so lab isn't mid-blend forever either.
  let xfaderTarget = preference * style.xfSwing * 0.85;
  if (nearDrop) {
    const swing =
      style.xfSwing * (0.55 + energyGap * 0.4) * (0.5 + style.energyArc * 0.35);
    xfaderTarget = clamp(preference * swing, -1, 1);
  } else {
    // Soft hold near edge rather than mid cruise
    xfaderTarget = clamp(preference * style.xfSwing * 0.7, -1, 1);
  }

  const [bpmLo, bpmHi] = style.bpmRange;
  const bpmOk = features.bpm >= bpmLo && features.bpm <= bpmHi;
  if (!bpmOk) xfaderTarget *= 0.7;

  const trained = applyTrained(features, style.id);
  if (trained.xfResidual != null) {
    xfaderTarget = clamp(xfaderTarget + trained.xfResidual * 0.35, -1, 1);
  }

  const blend = style.blendSpeed;

  // --- Transition / skip scores ---
  let skipScore = 0;
  skipScore += style.skipAggression * 0.35;
  skipScore += energyGap * 0.45 * style.skipAggression;
  skipScore += features.coincidentKick * 0.35 * style.skipAggression;
  skipScore += (1 - (bpmOk ? 1 : 0.4)) * 0.1;
  if (crashing) skipScore += style.crashSkipBoost;
  if (style.id === 'stadium-hype') {
    skipScore *= nearDrop && energyGap > 0.12 ? 0.85 : 0.35;
  } else if (style.id === 'psy-peak') {
    skipScore *= crashing ? 1.1 : 0.15;
  } else if (style.id === 'bass-blender') {
    skipScore += features.kickDensity * 0.12;
    if (features.coincidentKick) skipScore += 0.2;
  }
  skipScore *= 0.45 + prox * 0.55;

  if (trained.skipLogit != null) {
    skipScore = 0.55 * skipScore + 0.45 * sigmoid(trained.skipLogit);
  }

  const unsupModel = opts.unsupModel !== undefined ? opts.unsupModel : loadUnsupervisedModel();
  let novelty = null;
  let unsupCluster = null;
  let unsupReason = null;
  let unsupSkip = 0;
  if (unsupModel) {
    const u = inferUnsupervised(features, unsupModel, style);
    novelty = u.novelty;
    unsupCluster = u.cluster;
    unsupReason = u.reason;
    const uw = unsupervisedBlendWeight(style.id);
    // Unsup may bias FX + transition desire — NOT continuous xfader in club.
    // Keep a soft lab xfader blend at low weight.
    const uwXf = uw * 0.2;
    xfaderTarget = clamp((1 - uwXf) * xfaderTarget + uwXf * u.xfaderTarget, -1, 1);
    skipScore = (1 - uw) * skipScore + uw * u.skipScore;
    unsupSkip = u.skipScore;
  }

  // FX intensity during PLAYING (filter/EQ/wet) — LIF rates + novelty bias
  let fxIntensity = 0.28;
  fxIntensity += Math.min(0.35, Math.abs(features.energySlope) * 40);
  fxIntensity += (features.kickDensity || 0) * 0.15;
  if (novelty != null) fxIntensity += novelty * 0.35;
  fxIntensity += ((features.dnLRate || 0) + (features.dnRRate || 0)) / 120;
  fxIntensity *= 0.7 + style.blendSpeed * 0.6;
  fxIntensity = clamp(fxIntensity, 0.12, 0.95);

  const threshold = style.id === 'bass-blender' ? 0.42 : style.id === 'psy-peak' ? 0.72 : 0.55;

  // Transition request: phrase-gated desire to leave the track (setEngine enforces min time)
  let transitionRequest = false;
  const transThresh = style.id === 'psy-peak' ? 0.38 : style.id === 'bass-blender' ? 0.28 : 0.32;
  if (!humanOverride && gate.allow && nearDrop) {
    if (skipScore >= transThresh || unsupSkip >= transThresh * 0.9) {
      transitionRequest = true;
    }
    if (crashing && style.crashSkipBoost > 0.4) transitionRequest = true;
    if (rising && energyGap > 0.15 && style.energyArc > 0.5) transitionRequest = true;
  }
  // Played long enough hint from setEngine (optional)
  if (
    opts.playedSec != null &&
    opts.minPlaySec != null &&
    opts.playedSec >= opts.minPlaySec &&
    gate.allow &&
    (skipScore >= transThresh * 0.7 || nearDrop)
  ) {
    transitionRequest = true;
  }

  // Emergency mid-track skip — rare. Default is long play + planned transition.
  let skipRequest = false;
  let reasonParts = [];

  if (humanOverride) {
    skipRequest = gfFired;
    reasonParts.push('human override');
  } else if (!gate.allow) {
    skipRequest = false;
    reasonParts.push(`phrase gate closed (Δ${gate.distBeats.toFixed(2)} beats)`);
  } else if (gfFired && skipScore >= threshold * 0.95) {
    // Stricter than before — emergency only
    skipRequest = true;
    reasonParts.push('GF+policy emergency cut');
  } else if (skipScore >= threshold * 1.15 && nearDrop && style.id === 'bass-blender') {
    skipRequest = true;
    reasonParts.push('bass-blender emergency @ phrase');
  } else if (gfFired) {
    reasonParts.push('GF denied (prefer planned transition)');
  }

  if (transitionRequest) {
    reasonParts.push(`transitionReq →${louderIsB ? 'B' : 'A'}`);
  } else {
    reasonParts.push(`hold edge · fx ${fxIntensity.toFixed(2)}`);
  }
  if (unsupReason) reasonParts.push(unsupReason);
  reasonParts.push(style.label);
  if (!bpmOk) reasonParts.push(`BPM ${features.bpm.toFixed(0)} outside ${bpmLo}–${bpmHi}`);

  return {
    xfaderTarget: clamp(xfaderTarget, -1, 1),
    skipRequest,
    transitionRequest,
    fxIntensity,
    blend,
    reason: reasonParts.join(' · '),
    gateAllow: gate.allow,
    skipScore,
    styleId: style.id,
    xfSmooth: style.xfSmooth,
    maxXfDelta: style.maxXfDelta ?? 0.04,
    novelty,
    unsupCluster,
    preferredSide: louderIsB ? 'B' : 'A',
  };
}

/**
 * Blend LIF-mapped xfader with policy target.
 * final = (1−α)·lif + α·policy
 * (Lab legacy — club set-engine does not use this for xfader.)
 */
export function blendXfader(lifXfader, policyTarget, alpha) {
  const a = clamp(alpha, 0, 1);
  return (1 - a) * lifXfader + a * policyTarget;
}
