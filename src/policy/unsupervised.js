/**
 * Unsupervised DJ policy learner — pure browser JS.
 *
 * Learns structure from unlabeled feature streams (demo or files):
 *   energy arcs, novelty/anomaly, A/B balance norms, phrase-phase occupancy.
 * Maps that structure → mixer actions with explicit rules.
 *
 * Honest limits: not MaleCNS plasticity, not "the fly learned DJ",
 * not cloning any artist. Improves over pure hand heuristics using
 * THIS project's own mix stream. World-class DJ still needs crates + taste.
 */

import { getLog } from './logger.js';

const MODEL_KEY = 'dj-drosophila.policy.unsup.v1';
const MODEL_VERSION = 1;
const K_DEFAULT = 7;
const FEATURE_DIM = 12;
const MIN_SAMPLES = 24;
const NOVELTY_PERCENTILE = 0.85;

/** Ordered feature keys for the unsupervised vector. */
export const UNSUP_FEATURE_KEYS = [
  'rms',
  'bass',
  'energySlope',
  'kickDensity',
  'phrasePhase',
  'dnLRate',
  'dnRRate',
  'eyeAsym',
  'bpm',
  'energyA',
  'energyB',
  'energyDiff', // energyA - energyB (derived)
];

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
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

function dist2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

/**
 * Pull a flat numeric vector from a log row or live features object.
 * @param {object} row
 * @returns {number[] | null}
 */
export function vectorFromRow(row) {
  const f = row.features || row;
  if (f.rms == null && f.energy == null && f.energyA == null) return null;
  const energyA = f.energyA ?? 0;
  const energyB = f.energyB ?? 0;
  return [
    f.rms ?? f.energy ?? 0,
    f.bass ?? 0,
    f.energySlope ?? 0,
    f.kickDensity ?? 0,
    f.phrasePhase ?? 0,
    (f.dnLRate ?? 0) / 30,
    (f.dnRRate ?? 0) / 30,
    f.eyeAsym ?? 0,
    ((f.bpm ?? 124) - 120) / 40,
    energyA,
    energyB,
    energyA - energyB,
  ];
}

function runningStats(vectors) {
  const d = FEATURE_DIM;
  const means = new Array(d).fill(0);
  const m2 = new Array(d).fill(0);
  const n = vectors.length;
  for (let i = 0; i < n; i++) {
    const v = vectors[i];
    for (let j = 0; j < d; j++) {
      const x = v[j];
      const delta = x - means[j];
      means[j] += delta / (i + 1);
      m2[j] += delta * (x - means[j]);
    }
  }
  const stds = m2.map((s) => {
    const v = n > 1 ? Math.sqrt(s / (n - 1)) : 1;
    return v < 1e-6 ? 1 : v;
  });
  return { means, stds };
}

function zScore(v, means, stds) {
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = (v[i] - means[i]) / stds[i];
  }
  return out;
}

/**
 * Mini-batch / Lloyd k-means on z-scored vectors.
 * @returns {{ centroids: number[][], assignments: number[], inertia: number }}
 */
function kMeans(zs, k, maxIter = 25) {
  const n = zs.length;
  const d = zs[0].length;
  k = Math.max(2, Math.min(k, Math.floor(n / 3)));

  // Seed: spread picks along shuffled indices
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  /** @type {number[][]} */
  const centroids = [];
  for (let c = 0; c < k; c++) {
    centroids.push(zs[idx[c % n]].slice());
  }

  /** @type {number[]} */
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = dist2(zs[i], centroids[c]);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved += 1;
      }
    }

    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c] += 1;
      for (let j = 0; j < d; j++) sums[c][j] += zs[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // Re-seed empty cluster from a random point
        centroids[c] = zs[Math.floor(Math.random() * n)].slice();
      } else {
        for (let j = 0; j < d; j++) centroids[c][j] = sums[c][j] / counts[c];
      }
    }
    if (moved === 0 && iter > 2) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) {
    inertia += dist2(zs[i], centroids[assignments[i]]);
  }
  return { centroids, assignments, inertia };
}

/**
 * Online-ish update: one Lloyd pass seeded from previous centroids when possible.
 */
function onlineKMeansUpdate(zs, prevCentroids, k, maxIter = 12) {
  if (!prevCentroids || prevCentroids.length !== k || !prevCentroids[0]) {
    return kMeans(zs, k, maxIter);
  }
  const n = zs.length;
  const d = zs[0].length;
  const centroids = prevCentroids.map((c) => c.slice());
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = dist2(zs[i], centroids[c]);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      assignments[i] = best;
    }
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c] += 1;
      for (let j = 0; j < d; j++) sums[c][j] += zs[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        centroids[c] = zs[Math.floor(Math.random() * n)].slice();
      } else {
        // Blend toward new mean (online flavor)
        for (let j = 0; j < d; j++) {
          const m = sums[c][j] / counts[c];
          centroids[c][j] = centroids[c][j] * 0.35 + m * 0.65;
        }
      }
    }
  }
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    inertia += dist2(zs[i], centroids[assignments[i]]);
  }
  return { centroids, assignments, inertia };
}

function nearestCentroid(z, centroids) {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const dd = dist2(z, centroids[c]);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return { cluster: best, dist: Math.sqrt(bestD) };
}

function buildTransitions(assignments, k) {
  const transitions = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 1; i < assignments.length; i++) {
    transitions[assignments[i - 1]][assignments[i]] += 1;
  }
  return transitions;
}

function transitionRarity(from, to, transitions) {
  const row = transitions[from];
  if (!row) return 1;
  let sum = 0;
  for (let j = 0; j < row.length; j++) sum += row[j];
  if (sum < 1) return 1;
  const p = row[to] / sum;
  // Rare = high score when p is small
  return clamp(1 - p, 0, 1);
}

/**
 * Percentile map: energyDiff → preferred xfader ∈ [-1,1] from observed co-occurrence.
 * Collects (energyDiff, observed xfader) pairs and builds a soft lookup.
 */
function fitXfaderMap(rows, vectors) {
  /** @type {{ diff: number, xf: number }[]} */
  const pairs = [];
  for (let i = 0; i < rows.length; i++) {
    const f = rows[i].features || rows[i];
    const diff = vectors[i][11]; // energyA - energyB
    let xf = f.xfader;
    if (typeof xf !== 'number') {
      xf = rows[i].decision?.xfaderTarget;
    }
    if (typeof xf !== 'number') {
      // Soft prior: louder deck gets the fader
      xf = clamp(-diff * 2.2, -1, 1);
    }
    pairs.push({ diff, xf });
  }
  pairs.sort((a, b) => a.diff - b.diff);

  // Quantile bins
  const bins = 9;
  const map = [];
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor((b / bins) * pairs.length);
    const hi = Math.floor(((b + 1) / bins) * pairs.length);
    const slice = pairs.slice(lo, Math.max(lo + 1, hi));
    let md = 0;
    let mx = 0;
    for (const p of slice) {
      md += p.diff;
      mx += p.xf;
    }
    map.push({
      energyDiff: md / slice.length,
      xfader: clamp(mx / slice.length, -1, 1),
    });
  }
  return map;
}

function lookupXfader(energyDiff, xfaderMap) {
  if (!xfaderMap || !xfaderMap.length) {
    return clamp(-energyDiff * 2, -1, 1);
  }
  // Piecewise linear in energyDiff
  if (energyDiff <= xfaderMap[0].energyDiff) return xfaderMap[0].xfader;
  const last = xfaderMap[xfaderMap.length - 1];
  if (energyDiff >= last.energyDiff) return last.xfader;
  for (let i = 1; i < xfaderMap.length; i++) {
    const a = xfaderMap[i - 1];
    const b = xfaderMap[i];
    if (energyDiff <= b.energyDiff) {
      const t = (energyDiff - a.energyDiff) / (b.energyDiff - a.energyDiff + 1e-9);
      return a.xfader + t * (b.xfader - a.xfader);
    }
  }
  return 0;
}

/**
 * Self-supervised skip labels from the stream:
 *   1 when novelty high at phrase boundary, else 0.
 * Fit a tiny logistic on [bias, novelty, rarity, |energyDiff|, phraseProx, kickDensity].
 */
function fitSkipLogistic(zs, assignments, centroids, transitions, rows, noveltyThreshold) {
  const dim = 6;
  const w = new Array(dim).fill(0);
  w[0] = -1.0;

  /** @type {{ x: number[], y: number }[]} */
  const samples = [];
  let pos = 0;

  for (let i = 0; i < zs.length; i++) {
    const { cluster, dist } = nearestCentroid(zs[i], centroids);
    const f = rows[i].features || rows[i];
    const phase = f.phrasePhase ?? 0;
    // Phrase proximity: near 0 or 1
    const prox = Math.max(1 - Math.min(phase, 1 - phase) * 16, 0);
    const atBoundary = prox > 0.35;
    const prev = i > 0 ? assignments[i - 1] : cluster;
    const rarity = transitionRarity(prev, cluster, transitions);
    const energyDiff = Math.abs(zs[i][11] * (1)); // already z-scored-ish; use raw from vector
    const raw = vectorFromRow(rows[i]);
    const absGap = raw ? Math.abs(raw[11]) : 0;
    const kick = f.kickDensity ?? 0;

    const novelty = dist;
    const y =
      atBoundary && (novelty > noveltyThreshold || rarity > 0.72 || absGap > 0.18) ? 1 : 0;
    if (y) pos += 1;

    samples.push({
      x: [1, novelty, rarity, absGap, prox, kick],
      y,
    });
  }

  // Balance a bit: if too few positives, lower threshold effect already baked; still train
  const lr = 0.12;
  const epochs = 55;
  for (let e = 0; e < epochs; e++) {
    for (const s of samples) {
      const p = sigmoid(dot(w, s.x));
      const err = p - s.y;
      for (let i = 0; i < dim; i++) w[i] -= lr * err * s.x[i];
    }
  }

  return { skipWeights: w, selfLabeledSkips: pos };
}

function noveltyPercentile(zs, centroids, p) {
  const dists = zs.map((z) => nearestCentroid(z, centroids).dist);
  dists.sort((a, b) => a - b);
  const i = clamp(Math.floor(p * (dists.length - 1)), 0, dists.length - 1);
  return dists[i] || 0.5;
}

/**
 * Synthetic feature stream shaped like demo mixes — used for first-load seed.
 * Not artist data. Just energetic A/B arcs + phrase cycling + noise.
 */
export function synthesizeDemoStream(n = 180) {
  /** @type {object[]} */
  const rows = [];
  let phase = 0;
  let energyA = 0.35;
  let energyB = 0.3;
  let slope = 0;
  for (let i = 0; i < n; i++) {
    phase = (phase + 0.018) % 1;
    // Arc: A climbs then B climbs
    const arc = Math.sin(i / 28);
    energyA = clamp(0.32 + 0.18 * Math.max(0, arc) + (Math.random() - 0.5) * 0.04, 0.05, 0.95);
    energyB = clamp(0.28 + 0.2 * Math.max(0, -arc) + (Math.random() - 0.5) * 0.04, 0.05, 0.95);
    const energy = 0.55 * ((energyA + energyB) / 2) + 0.2;
    const dE = energy - (rows[i - 1]?.features?.energy ?? energy);
    slope = slope * 0.85 + dE * 0.15;
    const kickDensity = 1.2 + 0.8 * Math.sin(i / 7) + Math.random() * 0.3;
    const bpm = 124 + (i % 40 > 20 ? 2 : 0) + (Math.random() - 0.5);
    const xfader = clamp(-(energyA - energyB) * 1.8 + (Math.random() - 0.5) * 0.1, -1, 1);

    rows.push({
      ts: Date.now() - (n - i) * 250,
      features: {
        t: i * 0.25,
        rms: energy * 0.9,
        bass: energy * 0.7 + Math.random() * 0.05,
        energy,
        energySlope: slope,
        energyA,
        energyB,
        kickDensity,
        kickA: Math.random() > 0.7 ? 0.6 : 0.1,
        kickB: Math.random() > 0.75 ? 0.55 : 0.1,
        coincidentKick: 0,
        phrasePhase: phase,
        phraseBars: 8,
        dnLRate: 8 + energyA * 20 + Math.random() * 2,
        dnRRate: 8 + energyB * 20 + Math.random() * 2,
        gfRate: Math.random() * 2,
        eyeAsym: (energyB - energyA) * 0.3,
        bpm,
        xfader,
        activeDeck: xfader <= 0 ? 'A' : 'B',
      },
      decision: {
        xfaderTarget: xfader,
        skipRequest: false,
      },
      synthetic: true,
    });
  }
  return rows;
}

/**
 * Fit unsupervised model from log entries (or synthetic).
 * @param {object[]} [logEntries]
 * @param {object} [opts]
 * @param {number} [opts.k]
 * @param {object|null} [opts.prevModel]  for online warm-start
 * @returns {{ ok: boolean, message: string, model?: object }}
 */
export function trainUnsupervised(logEntries, opts = {}) {
  let rows = Array.isArray(logEntries) ? logEntries : getLog();
  if (!rows.length) {
    return { ok: false, message: 'No feature rows yet. Mix a bit, then train unsupervised.' };
  }

  /** @type {number[][]} */
  const vectors = [];
  /** @type {object[]} */
  const kept = [];
  for (const row of rows) {
    const v = vectorFromRow(row);
    if (!v) continue;
    vectors.push(v);
    kept.push(row);
  }

  if (vectors.length < MIN_SAMPLES) {
    return {
      ok: false,
      message: `Need ≥${MIN_SAMPLES} feature rows for unsupervised fit (have ${vectors.length}). Keep mixing.`,
    };
  }

  const k = opts.k ?? K_DEFAULT;
  const { means, stds } = runningStats(vectors);
  const zs = vectors.map((v) => zScore(v, means, stds));

  // Explicit null prevModel skips localStorage warm-start (offline train).
  const prev =
    opts.prevModel !== undefined ? opts.prevModel : loadUnsupervisedModel();
  const km =
    prev && prev.centroids && prev.centroids.length === k
      ? onlineKMeansUpdate(zs, prev.centroids, k)
      : kMeans(zs, k);

  const transitions = buildTransitions(km.assignments, km.centroids.length);
  const novThresh = noveltyPercentile(zs, km.centroids, NOVELTY_PERCENTILE);
  const { skipWeights, selfLabeledSkips } = fitSkipLogistic(
    zs,
    km.assignments,
    km.centroids,
    transitions,
    kept,
    novThresh,
  );
  const xfaderMap = fitXfaderMap(kept, vectors);

  const model = {
    version: MODEL_VERSION,
    means,
    stds,
    centroids: km.centroids,
    transitions,
    skipWeights,
    xfaderMap,
    noveltyThreshold: novThresh,
    k: km.centroids.length,
    samples: vectors.length,
    selfLabeledSkips,
    inertia: km.inertia,
    trainedAt: new Date().toISOString(),
    note:
      'Unsupervised = structure from your mix stream (k-means + novelty + self-labeled skips). ' +
      'Not human skip labels. Not MaleCNS plasticity. Not an artist clone.',
  };

  if (opts.persist !== false) {
    saveUnsupervisedModel(model);
  }
  return {
    ok: true,
    message:
      `Unsupervised fit: ${model.samples} samples · k=${model.k} · ` +
      `self-labeled skips=${selfLabeledSkips} · noveltyθ=${novThresh.toFixed(2)}. ` +
      `Structure from your stream — still not a fly DJ.`,
    model,
  };
}

export const UNSUP_STORAGE_KEY = MODEL_KEY;

/**
 * Install a pretrained / bundled model into localStorage and return it.
 * @param {object} model
 * @param {{ force?: boolean }} [opts]  force=true overwrites existing store
 */
export function installBundledUnsupervised(model, opts = {}) {
  if (!model || !model.centroids) return null;
  const existing = loadUnsupervisedModel();
  if (existing && !opts.force) {
    // Prefer larger bundled pretrained over tiny in-browser seed
    const bundledBetter =
      model.source === 'bundled-pretrained-v1' &&
      (existing.samples || 0) < (model.samples || 0) * 0.5;
    if (!bundledBetter && existing.source === 'bundled-pretrained-v1') {
      return existing;
    }
    if (!bundledBetter && existing.samples >= (model.samples || 0)) {
      return existing;
    }
  }
  const stamped = {
    ...model,
    source: model.source || 'bundled-pretrained-v1',
  };
  saveUnsupervisedModel(stamped);
  return stamped;
}

export function loadUnsupervisedModel() {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m || m.version !== MODEL_VERSION || !m.centroids) return null;
    return m;
  } catch {
    return null;
  }
}

export function saveUnsupervisedModel(model) {
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(model));
  } catch {
    /* quota / private mode */
  }
  return model;
}

export function clearUnsupervisedModel() {
  try {
    localStorage.removeItem(MODEL_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Seed a model from synthetic demo-shaped noise if none exists.
 * @returns {{ ok: boolean, message: string, model?: object, seeded?: boolean }}
 */
export function seedUnsupervisedIfEmpty() {
  const existing = loadUnsupervisedModel();
  if (existing) {
    return { ok: true, message: 'Unsupervised model already present.', model: existing, seeded: false };
  }
  const rows = synthesizeDemoStream(200);
  const result = trainUnsupervised(rows, { k: K_DEFAULT, prevModel: null });
  if (result.ok) {
    result.message =
      `Seeded unsupervised model on synthetic demo-shaped features (${result.model.samples} pts, k=${result.model.k}). ` +
      `Replace by mixing + Train unsupervised. Not artist data.`;
    result.seeded = true;
  }
  return result;
}

/**
 * Infer mixer hints from unsupervised model.
 * @param {object} features  live feature bag
 * @param {object} model
 * @param {object} [style]   style preset (for blend aggressiveness)
 * @returns {{
 *   xfaderTarget: number,
 *   skipRequest: boolean,
 *   skipScore: number,
 *   novelty: number,
 *   cluster: number,
 *   rarity: number,
 *   reason: string,
 * }}
 */
export function inferUnsupervised(features, model, style = null) {
  if (!model || !model.centroids || !model.means) {
    return {
      xfaderTarget: 0,
      skipRequest: false,
      skipScore: 0,
      novelty: 0,
      cluster: -1,
      rarity: 0,
      reason: 'no unsup model',
    };
  }

  const raw = vectorFromRow(features);
  if (!raw) {
    return {
      xfaderTarget: 0,
      skipRequest: false,
      skipScore: 0,
      novelty: 0,
      cluster: -1,
      rarity: 0,
      reason: 'bad features',
    };
  }

  const z = zScore(raw, model.means, model.stds);
  const { cluster, dist: novelty } = nearestCentroid(z, model.centroids);

  // Track last cluster in model for transition rarity (soft state on model object)
  const prevCluster =
    typeof model._lastCluster === 'number' ? model._lastCluster : cluster;
  const rarity = transitionRarity(prevCluster, cluster, model.transitions);
  model._lastCluster = cluster;

  const energyDiff = raw[11]; // energyA - energyB
  // Soft map: do not slam xfader from instantaneous energyDiff every frame
  let xfaderTarget = lookupXfader(energyDiff, model.xfaderMap) * 0.35;
  xfaderTarget = clamp(xfaderTarget - energyDiff * 0.15, -1, 1);

  // Style can damp or amplify swing (kept modest)
  const swing = style?.xfSwing ?? 0.85;
  xfaderTarget = clamp(xfaderTarget * (0.4 + swing * 0.25), -1, 1);

  const phase = features.phrasePhase ?? 0;
  const prox = Math.max(1 - Math.min(phase, 1 - phase) * 16, 0);
  const atBoundary = prox > 0.35;
  const absGap = Math.abs(energyDiff);
  const kick = features.kickDensity ?? 0;

  const xSkip = [1, novelty, rarity, absGap, prox, kick];
  const sw = model.skipWeights || [-1, 0.5, 0.5, 1, 0.5, 0.2];
  let skipScore = sigmoid(dot(sw, xSkip));

  // Rule overlay (still explicit): novelty / rare transition / A-B mismatch at gate
  const novHigh = novelty > (model.noveltyThreshold ?? 0.8);
  const ruleBoost =
    (novHigh ? 0.22 : 0) + (rarity > 0.7 ? 0.18 : 0) + (absGap > 0.2 ? 0.12 : 0);
  skipScore = clamp(skipScore * 0.7 + ruleBoost + prox * 0.15, 0, 1);

  if (style) {
    skipScore *= 0.55 + style.skipAggression * 0.7;
  }

  const threshold = style?.id === 'bass-blender' ? 0.4 : style?.id === 'psy-peak' ? 0.7 : 0.52;
  const skipRequest = atBoundary && skipScore >= threshold;

  const reason = [
    `unsup c${cluster}`,
    `nov ${novelty.toFixed(2)}`,
    rarity > 0.55 ? `rareΔ ${rarity.toFixed(2)}` : null,
    `xf ${xfaderTarget.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    xfaderTarget,
    skipRequest,
    skipScore,
    novelty,
    cluster,
    rarity,
    reason,
  };
}

/**
 * Blend weight for unsupervised vs heuristics — style-dependent.
 */
export function unsupervisedBlendWeight(styleId) {
  if (styleId === 'bass-blender') return 0.55;
  if (styleId === 'psy-peak') return 0.4;
  return 0.5; // stadium-hype default 0.5/0.5
}

/** Status snippet for HUD */
export function unsupervisedStatus(model, lastNovelty = null) {
  if (!model) {
    return {
      line: 'Unsupervised: none yet — Train unsupervised or wait for auto-seed',
      samples: 0,
      k: 0,
      selfLabeled: 0,
      novelty: lastNovelty,
    };
  }
  const bundled =
    model.source === 'bundled-pretrained-v1' || model.bundled === true;
  const head = bundled
    ? `Bundled pretrained unsup v1 · ${model.samples} samples`
    : `Unsup: ${model.samples} samples · k=${model.k}`;
  const tail = bundled
    ? ` · k=${model.k} · self-labeled skips: ${model.selfLabeledSkips ?? 0}` +
      (lastNovelty != null ? ` · novelty ${lastNovelty.toFixed(2)}` : '')
    : ` · self-labeled skips: ${model.selfLabeledSkips ?? 0}` +
      (lastNovelty != null ? ` · novelty ${lastNovelty.toFixed(2)}` : '') +
      ` · ${model.trainedAt ? model.trainedAt.slice(0, 19) : '?'}`;
  return {
    line: head + tail,
    samples: model.samples,
    k: model.k,
    selfLabeled: model.selfLabeledSkips ?? 0,
    novelty: lastNovelty,
    bundled,
  };
}
