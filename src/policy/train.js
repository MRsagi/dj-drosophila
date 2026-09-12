/**
 * Offline fit — pure JS, no Python.
 *
 * Two paths:
 *   1. Supervised / weak-label fit (this file): needs human overrides or
 *      decision self-distill labels. Secondary.
 *   2. Unsupervised (see unsupervised.js): learns from unlabeled feature
 *      streams — preferred "Train unsupervised" button. No human skip labels.
 *
 * How to replace supervised path with real ML later:
 *   1. Export JSONL from the HUD ("Export session log").
 *   2. Label rows: set labelSkip 0|1 and/or labelXfader ∈ [-1,1].
 *   3. Train anywhere; export weight JSON matching DEFAULT_WEIGHTS.
 *   4. Call saveWeights(obj) or paste into localStorage key dj-drosophila.policy.weights.v1.
 *
 * There are NO shipped artist weights. Unsupervised uses YOUR mix stream structure only.
 */

import { parseJSONL, getLog } from './logger.js';
export {
  trainUnsupervised,
  loadUnsupervisedModel,
  saveUnsupervisedModel,
  seedUnsupervisedIfEmpty,
  synthesizeDemoStream,
  unsupervisedStatus,
  installBundledUnsupervised,
  UNSUP_STORAGE_KEY,
} from './unsupervised.js';

const WEIGHTS_KEY = 'dj-drosophila.policy.weights.v1';

/** Default / empty weights — heuristics only until you fit. */
export const DEFAULT_WEIGHTS = {
  version: 1,
  fittedAt: null,
  nSkip: 0,
  nXfader: 0,
  // skip: [bias, energySlope, energyDiff, kickDensity, coincident, phrasePhase, bass, dnL, dnR, styleBoost]
  skip: [ -1.2, 8, 1.5, 0.8, 1.2, 0.5, 0.4, 0.1, 0.1, 0.3 ],
  // xfader residual: [bias, energyB-A, eyeAsym, energySlope, bass, dnDiff]
  xfader: [ 0, 0.35, 0.15, 0.2, 0.05, 0.25 ],
  style: {
    'stadium-hype': 0.1,
    'psy-peak': -0.4,
    'bass-blender': 0.55,
  },
  note: 'Heuristic prior. Fit from your logs to own the policy.',
};

export function loadWeights() {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveWeights(w) {
  localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w));
  return w;
}

export function clearWeights() {
  localStorage.removeItem(WEIGHTS_KEY);
}

function sigmoid(x) {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function skipFeatures(row) {
  const f = row.features || row;
  return [
    1,
    f.energySlope ?? 0,
    (f.energyA ?? 0) - (f.energyB ?? 0),
    f.kickDensity ?? 0,
    f.coincidentKick ?? 0,
    f.phrasePhase ?? 0,
    f.bass ?? 0,
    (f.dnLRate ?? 0) / 30,
    (f.dnRRate ?? 0) / 30,
    0,
  ];
}

function xfFeatures(row) {
  const f = row.features || row;
  return [
    1,
    (f.energyB ?? 0) - (f.energyA ?? 0),
    f.eyeAsym ?? 0,
    f.energySlope ?? 0,
    f.bass ?? 0,
    ((f.dnRRate ?? 0) - (f.dnLRate ?? 0)) / 30,
  ];
}

function fitLogistic(rows, dim, lr = 0.08, epochs = 40) {
  const w = new Array(dim).fill(0);
  w[0] = -0.5;
  for (let e = 0; e < epochs; e++) {
    for (const row of rows) {
      const x = skipFeatures(row);
      while (x.length < dim) x.push(0);
      const y = row.labelSkip;
      const p = sigmoid(dot(w, x));
      const err = p - y;
      for (let i = 0; i < dim; i++) w[i] -= lr * err * x[i];
    }
  }
  return w;
}

function fitLinear(rows, dim, lr = 0.05, epochs = 50) {
  const w = new Array(dim).fill(0);
  for (let e = 0; e < epochs; e++) {
    for (const row of rows) {
      const x = xfFeatures(row);
      while (x.length < dim) x.push(0);
      const y = row.labelXfader;
      const pred = dot(w, x);
      const err = pred - y;
      for (let i = 0; i < dim; i++) w[i] -= lr * err * x[i];
    }
  }
  return w;
}

/**
 * Infer weak labels from log rows when explicit labels are missing.
 * Supervised path only — unsupervised does not need these.
 */
function materializeLabels(rows) {
  return rows
    .map((row) => {
      const out = { ...row };
      if (out.labelSkip == null) {
        if (out.humanOverride && out.decision?.skipRequest) out.labelSkip = 1;
        else if (out.humanOverride && out.forcedSkip) out.labelSkip = 1;
        else if (out.decision?.skipRequest != null) out.labelSkip = out.decision.skipRequest ? 1 : 0;
      }
      if (out.labelXfader == null) {
        if (typeof out.manualXfader === 'number') out.labelXfader = out.manualXfader;
        else if (typeof out.decision?.xfaderTarget === 'number') {
          out.labelXfader = out.decision.xfaderTarget;
        }
      }
      return out;
    })
    .filter((r) => r.labelSkip != null || r.labelXfader != null);
}

/**
 * Supervised / weak-label fit from in-memory log and/or JSONL text.
 * Prefer trainUnsupervised() when you have no human skip labels.
 */
export function fitFromLogs(opts = {}) {
  const useMemory = opts.useMemory !== false;
  let rows = useMemory ? getLog() : [];
  if (opts.jsonl) rows = rows.concat(parseJSONL(opts.jsonl));

  const labeled = materializeLabels(rows);
  if (labeled.length < 8) {
    return {
      ok: false,
      message:
        `Supervised fit needs ≥8 labeled/decidable rows (have ${labeled.length}). ` +
        `Or use Train unsupervised — no human skip labels required.`,
    };
  }

  const skipRows = labeled.filter((r) => r.labelSkip != null);
  const xfRows = labeled.filter((r) => typeof r.labelXfader === 'number');

  const base = { ...DEFAULT_WEIGHTS, style: { ...DEFAULT_WEIGHTS.style } };
  if (skipRows.length >= 4) {
    base.skip = fitLogistic(skipRows, DEFAULT_WEIGHTS.skip.length);
    base.nSkip = skipRows.length;
  }
  if (xfRows.length >= 4) {
    base.xfader = fitLinear(xfRows, DEFAULT_WEIGHTS.xfader.length);
    base.nXfader = xfRows.length;
  }
  base.fittedAt = new Date().toISOString();
  base.note = `Supervised/weak fit from ${labeled.length} rows (skip=${base.nSkip}, xf=${base.nXfader}). Still your policy — not MaleCNS learning.`;

  saveWeights(base);
  return {
    ok: true,
    message: base.note,
    weights: base,
  };
}

export function fitFromLocalStorage() {
  return fitFromLogs({ useMemory: true });
}
