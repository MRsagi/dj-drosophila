# TRAINING_REPORT — unsupervised v1

## Honesty

This model was fit **offline on synthetic multi-regime feature streams**
(stadium-hype / psy-peak / bass-blender BPM·energy arcs, phrase phases,
A/B imbalances, kicks, novelty bursts) plus a small demo-shaped block.
**Not artist cloning. Not MaleCNS plasticity. Not a fly that learned to DJ.**

## Stats

| Field | Value |
|-------|-------|
| samples (n) | 12600 |
| k (clusters) | 8 |
| self-labeled skips | 675 |
| inertia | 67028.03 |
| noveltyThreshold | 2.7190 |
| trainedAt / fittedAt | 2026-09-12T09:45:45.018Z |
| supervised skip n | 12600 |
| supervised xf n | 12600 |
| supervised fittedAt | 2026-09-12T09:45:45.207Z |

## Artifacts

- `models/unsupervised-v1.json` — full unsupervised model
- `models/policy-weights-v1.json` — supervised/weak weights (secondary)
- `public/models/unsupervised-v1.json` — Vite-served copy (auto-load)
- `src/models/unsupervised-v1.json` — importable bundle copy
- `/workspace/dj-drosophila-trained-model.json` — delivery wrapper

## How the app loads it

1. On startup, `main.js` imports the bundled JSON from `src/models/unsupervised-v1.json`.
2. If `localStorage['dj-drosophila.policy.unsup.v1']` is empty **or** the
   prefer-bundled flag is on, the bundled model is written into that key via
   `saveUnsupervisedModel` / `installBundledUnsupervised`.
3. HUD shows something like: **Bundled pretrained unsup v1 · 12600 samples**.
4. User does **not** need to press Train unsupervised.

Desktop / packaged builds: copy `public/models/` (or the whole `dist/` after
`npm run build`) so `/models/unsupervised-v1.json` is available; the import
path already embeds the model in the JS bundle.

## Reproduce

```bash
npm run train:offline
```
