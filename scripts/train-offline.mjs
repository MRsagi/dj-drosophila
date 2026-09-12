/**
 * Offline unsupervised (+ weak supervised) trainer for DJ Drosophila.
 * Node ESM — stubs localStorage, imports browser policy modules.
 *
 * Honest: synthetic multi-regime streams (stadium-hype / psy-peak / bass-blender)
 * + demo-shaped noise. NOT artist cloning. NOT MaleCNS plasticity.
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Minimal localStorage stub so browser modules import cleanly in Node. */
function stubLocalStorage() {
  const store = new Map();
  const ls = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
    get length() {
      return store.size;
    },
  };
  globalThis.localStorage = ls;
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = { localStorage: ls };
  } else if (!globalThis.window.localStorage) {
    globalThis.window.localStorage = ls;
  }
}

stubLocalStorage();

const {
  trainUnsupervised,
  synthesizeDemoStream,
} = await import('../src/policy/unsupervised.js');
const { fitFromLogs, DEFAULT_WEIGHTS } = await import('../src/policy/train.js');

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Large multi-style synthetic feature stream.
 * Covers stadium-hype / psy-peak / bass-blender BPM & energy regimes.
 */
function synthesizeMultiStyleStream(total = 12000) {
  const regimes = [
    {
      id: 'stadium-hype',
      bpmLo: 118,
      bpmHi: 132,
      phraseBars: 8,
      phaseStep: 0.02,
      energyArc: 0.85,
      kickBase: 1.4,
      blendSpeed: 0.72,
      skipBias: 0.22,
      weight: 0.34,
    },
    {
      id: 'psy-peak',
      bpmLo: 138,
      bpmHi: 145,
      phraseBars: 16,
      phaseStep: 0.011,
      energyArc: 0.55,
      kickBase: 1.1,
      blendSpeed: 0.22,
      skipBias: 0.06,
      weight: 0.33,
    },
    {
      id: 'bass-blender',
      bpmLo: 128,
      bpmHi: 145,
      phraseBars: 8,
      phaseStep: 0.024,
      energyArc: 0.4,
      kickBase: 1.7,
      blendSpeed: 0.88,
      skipBias: 0.55,
      weight: 0.33,
    },
  ];

  /** @type {object[]} */
  const rows = [];
  let globalI = 0;

  for (const reg of regimes) {
    const n = Math.max(800, Math.floor(total * reg.weight));
    let phase = Math.random();
    let energyA = 0.35;
    let energyB = 0.3;
    let slope = 0;
    let bpm =
      reg.bpmLo + Math.random() * (reg.bpmHi - reg.bpmLo);

    for (let i = 0; i < n; i++) {
      // Occasional BPM drift / jump within regime
      if (i % 97 === 0) {
        bpm = clamp(
          bpm + (Math.random() - 0.5) * 4,
          reg.bpmLo,
          reg.bpmHi,
        );
      }
      if (i % 211 === 0) {
        bpm = reg.bpmLo + Math.random() * (reg.bpmHi - reg.bpmLo);
      }

      phase = (phase + reg.phaseStep * (0.85 + Math.random() * 0.3)) % 1;

      // Energy arcs: A climbs then B, plus longer sine envelopes
      const arc = Math.sin(i / (22 + reg.energyArc * 18));
      const slow = Math.sin(i / 90) * 0.5 + 0.5;
      const burst = i % 160 > 145 ? 0.25 * Math.random() : 0; // novelty bursts
      const imbalance = Math.sin(i / 55) * 0.12; // A/B imbalance

      energyA = clamp(
        0.28 +
          0.2 * Math.max(0, arc) * reg.energyArc +
          0.12 * slow +
          imbalance +
          burst +
          (Math.random() - 0.5) * 0.05,
        0.04,
        0.98,
      );
      energyB = clamp(
        0.26 +
          0.22 * Math.max(0, -arc) * (0.7 + reg.energyArc * 0.3) +
          0.1 * (1 - slow) -
          imbalance +
          (burst > 0 ? Math.random() * 0.15 : 0) +
          (Math.random() - 0.5) * 0.05,
        0.04,
        0.98,
      );

      const energy = 0.55 * ((energyA + energyB) / 2) + 0.18;
      const prevE = rows.length ? rows[rows.length - 1].features.energy : energy;
      const dE = energy - prevE;
      slope = slope * 0.82 + dE * 0.18;

      const kickDensity =
        reg.kickBase +
        0.9 * Math.sin(i / (5 + (reg.id === 'bass-blender' ? 2 : 6))) +
        Math.random() * 0.45 +
        (burst > 0 ? 0.8 : 0);

      const prox = Math.max(1 - Math.min(phase, 1 - phase) * 16, 0);
      const atBoundary = prox > 0.35;
      const absGap = Math.abs(energyA - energyB);

      let xfader = clamp(
        -(energyA - energyB) * (1.4 + reg.blendSpeed) +
          (Math.random() - 0.5) * 0.12,
        -1,
        1,
      );

      // Phrase-gated skip self-labels (weak)
      const noveltyBurst = burst > 0.1 || kickDensity > reg.kickBase + 1.4;
      const skipRequest =
        atBoundary &&
        (Math.random() < reg.skipBias * (0.4 + absGap) ||
          (noveltyBurst && Math.random() < 0.55 + reg.skipBias * 0.3));

      rows.push({
        ts: Date.now() - (total - globalI) * 200,
        styleId: reg.id,
        features: {
          t: globalI * 0.2,
          rms: energy * 0.92,
          bass:
            energy * (reg.id === 'bass-blender' ? 0.85 : 0.68) +
            Math.random() * 0.06,
          energy,
          energySlope: slope,
          energyA,
          energyB,
          kickDensity,
          kickA: Math.random() > 0.68 ? 0.65 : 0.08,
          kickB: Math.random() > 0.72 ? 0.6 : 0.08,
          coincidentKick: Math.random() > 0.92 ? 0.5 : 0,
          phrasePhase: phase,
          phraseBars: reg.phraseBars,
          dnLRate: 7 + energyA * 22 + Math.random() * 3,
          dnRRate: 7 + energyB * 22 + Math.random() * 3,
          gfRate: Math.random() * 2.5,
          eyeAsym: (energyB - energyA) * 0.35,
          bpm,
          xfader,
          activeDeck: xfader <= 0 ? 'A' : 'B',
        },
        decision: {
          xfaderTarget: xfader,
          skipRequest,
        },
        labelSkip: skipRequest ? 1 : 0,
        labelXfader: xfader,
        synthetic: true,
        regime: reg.id,
      });
      globalI += 1;
    }
  }

  // Mix in a short demo-shaped block for continuity with in-app seed shape
  const demoExtra = synthesizeDemoStream(Math.min(600, Math.floor(total * 0.05)));
  for (const r of demoExtra) {
    r.regime = 'demo-shaped';
    r.styleId = 'stadium-hype';
    if (r.decision?.skipRequest != null) {
      r.labelSkip = r.decision.skipRequest ? 1 : 0;
    } else {
      r.labelSkip = 0;
    }
    if (typeof r.decision?.xfaderTarget === 'number') {
      r.labelXfader = r.decision.xfaderTarget;
    }
    rows.push(r);
  }

  // Shuffle lightly by blocks so k-means sees mixed regimes but transitions exist
  // Keep mostly sequential within regimes (already sequential); optional micro-shuffle of tails:
  return rows;
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

async function main() {
  const TARGET_N = 12000;
  console.log(`[train-offline] synthesizing multi-style stream (~${TARGET_N})…`);
  const rows = synthesizeMultiStyleStream(TARGET_N);
  console.log(`[train-offline] rows=${rows.length}`);

  const K = 8;
  console.log(`[train-offline] unsupervised train k=${K}…`);
  const t0 = Date.now();
  const result = trainUnsupervised(rows, {
    k: K,
    prevModel: null,
    persist: false,
  });
  if (!result.ok) {
    console.error('[train-offline] FAILED:', result.message);
    process.exit(1);
  }
  const model = result.model;
  model.source = 'bundled-pretrained-v1';
  model.trainingNote =
    'Unsupervised on synthetic multi-regime streams (stadium-hype / psy-peak / bass-blender) + demo-shaped data. NOT artist cloning. NOT MaleCNS plasticity.';
  model.regimes = ['stadium-hype', 'psy-peak', 'bass-blender', 'demo-shaped'];
  console.log(
    `[train-offline] unsup done in ${Date.now() - t0}ms · samples=${model.samples} · k=${model.k} · self-labeled skips=${model.selfLabeledSkips}`,
  );

  // Supervised / weak-label fit on the same self-labeled stream
  console.log('[train-offline] supervised weak fit…');
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  const fit = fitFromLogs({ useMemory: false, jsonl });
  let weights = null;
  if (fit.ok) {
    weights = fit.weights;
    weights.source = 'offline-synthetic-v1';
    weights.note =
      (weights.note || '') +
      ' Offline synthetic self-labels — not artist weights.';
    console.log(`[train-offline] supervised: ${fit.message}`);
  } else {
    console.warn('[train-offline] supervised skipped:', fit.message);
    weights = {
      ...DEFAULT_WEIGHTS,
      fittedAt: new Date().toISOString(),
      source: 'offline-fallback-heuristics',
      note: 'Supervised fit failed; shipping heuristic prior.',
    };
  }

  const modelsDir = join(ROOT, 'models');
  const publicDir = join(ROOT, 'public', 'models');
  const srcModelsDir = join(ROOT, 'src', 'models');
  mkdirSync(modelsDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(srcModelsDir, { recursive: true });

  const unsupPath = join(modelsDir, 'unsupervised-v1.json');
  const weightsPath = join(modelsDir, 'policy-weights-v1.json');
  const reportPath = join(modelsDir, 'TRAINING_REPORT.md');

  writeJson(unsupPath, model);
  writeJson(weightsPath, weights);

  // Vite public + importable copy under src/
  copyFileSync(unsupPath, join(publicDir, 'unsupervised-v1.json'));
  copyFileSync(unsupPath, join(srcModelsDir, 'unsupervised-v1.json'));
  if (weights) {
    copyFileSync(weightsPath, join(publicDir, 'policy-weights-v1.json'));
    copyFileSync(weightsPath, join(srcModelsDir, 'policy-weights-v1.json'));
  }

  const report = `# TRAINING_REPORT — unsupervised v1

## Honesty

This model was fit **offline on synthetic multi-regime feature streams**
(stadium-hype / psy-peak / bass-blender BPM·energy arcs, phrase phases,
A/B imbalances, kicks, novelty bursts) plus a small demo-shaped block.
**Not artist cloning. Not MaleCNS plasticity. Not a fly that learned to DJ.**

## Stats

| Field | Value |
|-------|-------|
| samples (n) | ${model.samples} |
| k (clusters) | ${model.k} |
| self-labeled skips | ${model.selfLabeledSkips ?? 0} |
| inertia | ${typeof model.inertia === 'number' ? model.inertia.toFixed(2) : model.inertia} |
| noveltyThreshold | ${typeof model.noveltyThreshold === 'number' ? model.noveltyThreshold.toFixed(4) : model.noveltyThreshold} |
| trainedAt / fittedAt | ${model.trainedAt} |
| supervised skip n | ${weights?.nSkip ?? 0} |
| supervised xf n | ${weights?.nXfader ?? 0} |
| supervised fittedAt | ${weights?.fittedAt ?? 'n/a'} |

## Artifacts

- \`models/unsupervised-v1.json\` — full unsupervised model
- \`models/policy-weights-v1.json\` — supervised/weak weights (secondary)
- \`public/models/unsupervised-v1.json\` — Vite-served copy (auto-load)
- \`src/models/unsupervised-v1.json\` — importable bundle copy
- \`/workspace/dj-drosophila-trained-model.json\` — delivery wrapper

## How the app loads it

1. On startup, \`main.js\` imports the bundled JSON from \`src/models/unsupervised-v1.json\`.
2. If \`localStorage['dj-drosophila.policy.unsup.v1']\` is empty **or** the
   prefer-bundled flag is on, the bundled model is written into that key via
   \`saveUnsupervisedModel\` / \`installBundledUnsupervised\`.
3. HUD shows something like: **Bundled pretrained unsup v1 · ${model.samples} samples**.
4. User does **not** need to press Train unsupervised.

Desktop / packaged builds: copy \`public/models/\` (or the whole \`dist/\` after
\`npm run build\`) so \`/models/unsupervised-v1.json\` is available; the import
path already embeds the model in the JS bundle.

## Reproduce

\`\`\`bash
npm run train:offline
\`\`\`
`;

  writeFileSync(reportPath, report);

  const delivery = {
    unsupervised: model,
    weights,
    meta: {
      kind: 'dj-drosophila-trained-model',
      version: 1,
      samples: model.samples,
      k: model.k,
      selfLabeledSkips: model.selfLabeledSkips,
      fittedAt: model.trainedAt,
      honest:
        'Unsupervised on synthetic multi-regime streams + demo-shaped data. Not artist cloning.',
    },
  };
  const deliveryPath = join(ROOT, '..', 'dj-drosophila-trained-model.json');
  writeJson(deliveryPath, delivery);

  console.log('[train-offline] wrote:');
  console.log(' ', unsupPath);
  console.log(' ', weightsPath);
  console.log(' ', reportPath);
  console.log(' ', join(publicDir, 'unsupervised-v1.json'));
  console.log(' ', deliveryPath);
  console.log('[train-offline] OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
