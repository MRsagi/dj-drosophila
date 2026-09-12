# DJ Drosophila

**Hey, I trained a fruit fly to DJ — this is its set.** Scientific comedy: **MaleCNS fruit-fly connectome wiring (approx)** drives sensors for a DJ mixer — plus a **DJ mind** on the shared live radio (when to leave / how long to blend) and an **owned policy** head you can steer, train **unsupervised** from your mix stream, and optionally fit with weak/supervised labels. Fine print: not a conscious animal.

Song visualizer → fly eyes → leaky-integrate-and-fire stub → **policy.decide()** → mixer + **3D fly DJ** → live Web Audio.

**Public site:** hash routes `#club` / `#story` / `#lab`, CC/procedural crate (Spotify out), bundled unsupervised model auto-loads.

The fly does **not** understand music. The fly is **not** conscious. The fly was **not** uploaded. The fly does **not** learn. Labels that look like neuron names are **proxies** unless you check them in neuPrint yourself. Style presets are **genre-lane heuristics**, not clones of any artist.

Credit: MaleCNS data from **FlyEM / HHMI Janelia**, the **Cambridge Connectomics Group / MRC LMB**, and **Google Research**, licensed **CC BY**. Dataset `male-cns:v1.0` at [neuprint.janelia.org](https://neuprint.janelia.org).


## Shared 24/7 live radio

Public deploy is an **always-on shared HLS stream** (everyone hears the same music).  
See **[docs/LIVE.md](docs/LIVE.md)** for Docker, Cloudflare Tunnel, `ENABLE_LAB=false`, and ffmpeg.

```bash
npm run live:build          # local shared radio
docker compose up -d --build
```

`#lab` is local-dev only and **cannot** control or override the live radio for other visitors.

## Run

```bash
cd /workspace/dj-drosophila
npm install
npm run dev
```

Open the printed localhost URL, then click **Engage the circuit** (browsers gate Web Audio on a gesture).

Zero files required: two procedural synth decks start immediately. You can still load audio files on A and B.

```bash
npm run build    # production bundle → dist/
npm run preview  # serve the build
```


## Public routes

| Hash | Page |
| --- | --- |
| `#club` | Live club — 3D fruit-fly DJ, dual-eye HUD, always-on CC/procedural mix |
| `#story` | How training works (honest) + gags + MaleCNS / music credits |
| `#lab` | Full lab controls (files, override, train/export) |

Click **Enter the club** once (Web Audio gesture). See `docs/PUBLIC.md` for the full publish plan.

## Deploy (static)

```bash
npm run build    # → dist/
```

Upload **`dist/`** to Cloudflare Pages, Netlify, Vercel, or any static host.

- Hash routing works with no server config.
- Optional: `vercel.json` + `public/_redirects` for SPA fallbacks.
- Music: CC0 OpenGameArt mp3s in `public/crate/` (club prefers files); procedural beds as fallback (see that folder's README + `LICENSES.md`). **No Spotify.**


## Club mix behavior (set engine)

Public `#club` uses `src/dj/setEngine.js` as the primary mixer brain:

1. **INTRO** — pick deck A (or B), snap xfader to that **EDGE** (−1 / +1).
2. **PLAYING** — park xfader on the edge for a **long** time (min ~30s; file tracks use AudioBuffer duration, procedural beds typically 45–180s). During play the DJ rides **FX/EQ/filter** (`src/audio/fxBus.js`), **not** the crossfader. ~90% of session time should be edge-locked.
3. **TRANSITION** — only after min play **and** phrase gate **and** policy `transitionRequest` (or planned length overdue): slew edge→edge over ~8–16 bars (~15–32s). Then flip active deck and return to PLAYING.
4. Policy/unsupervised decide **when** to leave, **which** next track (quiet-deck preload ~15s ahead), and **FX intensity** — they do **not** continuously blend the xfader in club mode.
5. Emergency GF/skip mid-track is still allowed but rare; default path is long play + planned blend.

### Verify

Engage the club, watch HUD `PLAYING A · m:ss / m:ss` and `xf … EDGE … locked`. Crossfader should sit at ±1 for minutes; then one smooth `TRANSITION` blend. 3D fly leans hard left/right while playing and only travels across during transition.

## Recent fixes (crate rotation + set engine)

- **Set engine:** edge-locked long plays; continuous LIF↔policy xfader blend **killed** for club.
- **Track rotation:** crate prefers CC0 file tracks when present; avoids recent ids / other deck; quiet deck preloads before transition. Procedural beds remain as fallback.
- **Crossfader:** club = edge park + phrase-aligned transition slew only. Lab manual override still available.

## What you get

1. **Two decks** — file inputs + demo synths (124 / 126 BPM-ish, same key family).
2. **Dual-eye visualizer** — left = A, right = B; bass = thick slow bars; hi = thin fast needles; kick strobe; center crossfader stripe; ~30–60 FPS; ~200–400 photoreceptor columns per eye (`TODO` ~1771).
3. **Photoreceptors (approx)** — R1–R6 luminance, R8 “color”, left/right eyes. Not a real rhabdomere lattice.
4. **Brain stub (LIF)** — DN-L / DN-R (proxy — do not claim identity without data), Giant Fiber / escape proxy, mean rate. GF *proposes* skips; policy must co-sign.
5. **Owned DJ policy** (`src/policy/`)
   - Style lanes: **Stadium hype** / **Psy peak** / **Bass blender**
   - Phrase gate (skips near bar 8/16 only; wider for bass-blender)
   - Club: setEngine owns xfader (edge-lock); policy requests **transitions** + **FX intensity** (α slider is lab legacy)
   - **Unsupervised training** from unlabeled feature streams (k-means clusters, novelty, A/B energy map, self-labeled skips) — **no human skip labels required**
   - Optional supervised / weak-label fit as secondary
   - Session JSONL log → export anytime
6. **Controls** — crossfader (setEngine edges / transitions), master (damped mean DN), skip (rare emergency or human force)
7. **Live Web Audio mix** — equal-power crossfade
8. **HUD** — Club / Brain / Hands on deck / Policy + fake caption + fine-print truth

### Unsupervised training (preferred)

**Unsupervised = structure from your mix stream, not human labels, not MaleCNS plasticity.**

1. Engage / start the mix (demo synths are fine). Features log ~4 Hz.
2. Click **Train unsupervised** — or enable **Auto-refit unsupervised every ~200 samples**.
3. On first load, a short **synthetic demo-shaped** fit seeds non-heuristic weights so you are not stuck on pure hand rules. After ~30s of live demo with enough samples, the app refits once on the real stream.
4. Watch status: samples used, k clusters, last novelty, self-labeled skips.

What it learns (honestly):

| Discovers | Maps to |
| --- | --- |
| Clustered mix states (energy / phrase / DN rates…) | Occupancy + Markov transitions |
| Novelty = distance to nearest centroid | Skip pressure when novel + phrase gate open |
| Rare cluster transitions | Extra skip signal |
| A vs B energy distribution | Soft xfader preference (percentile map) |
| Self-labeled skips (novelty@phrase boundary in buffer) | Tiny logistic — labels from the stream, not you |

What it does **not** do: become a named DJ, clone artists, or update the connectome. World-class DJ still needs crates + taste data; this is representation + novelty-driven decisions on **your** stream. It improves over pure hand heuristics using the project's own data.

### Supervised fit (secondary)

1. Optionally override / force-skip to inject human labels.
2. **Export session log** → JSONL.
3. **Fit supervised (secondary)** → logistic/linear residuals in `localStorage`.

**Limitation:** there are **no real artist weights**. Heuristics + unsupervised structure run until you bring crates, taste, and (if you want) labeled taste data.

## File map

```
src/main.js                 orchestrator (setEngine + LIF + policy)
src/dj/setEngine.js         INTRO / PLAYING / TRANSITION state machine
src/audio/mixer.js          decks, EQ, xfader, limiter, skip
src/audio/fxBus.js          EQ/filter/delay automation during PLAYING
src/audio/analyser.js       bass / mid / hi / kick
src/vision/visualizer.js    compound-eye canvas
src/vision/eyeMap.js        R1–R6 / R8 column fields
src/brain/lif.js            LIF Euler stub
src/brain/circuit.js        DN-L, DN-R, GF
src/brain/mapping.js        sensors ↔ mixer + α blend helper
src/policy/features.js      BPM, energy, phrasePhase, DN rates…
src/policy/phraseGate.js    skip only near phrase boundaries
src/policy/styles.js        three genre-lane presets
src/policy/policy.js        decide() heuristics + unsup + supervised residual
src/policy/logger.js        localStorage ring buffer + JSONL export
src/policy/unsupervised.js  k-means / novelty / self-labeled skip / xfader map
src/policy/train.js         supervised fit stub + re-exports unsupervised
src/ui/hud.js               readouts + policy controls
src/ui/captions.js          joke, then the truth
src/ui/router.js            #club | #story | #lab
src/scene/FlyDJ.js          Three.js low-poly fly DJ
src/crate/manifest.json     CC0 file crate + procedural fallback + one user slot
src/crate/proceduralCrate.js procedural CC0 beds
src/crate/cratePlayer.js    pick / load / advance tracks
src/demo/synthTracks.js     zero-file lab fallbacks
public/crate/               drop-in CC mp3s + license README
docs/SCIENCE.md             real vs ours; unsupervised honesty; what not to claim
docs/NEUPRINT.md            male-cns:v1.0 queries (verify in explorer)
docs/PUBLIC.md              publish plan, routes, crate policy
```

## TODOs (labeled in code, not shipped as facts)

- Hat-filter (hats are highpassed noise)
- T4/T5 kick (real T4/T5 are ON/OFF motion detectors — not kick drums)
- PAM11 gag (mushroom-body DAN “reward” joke, unwired)
- Real neuPrint fetch (this build is offline / local)
- ~1771 eye columns
- Bring your own crates + taste if you want world-class; unsupervised is not that

## What not to claim

Read `docs/SCIENCE.md`. Short version: no consciousness, no fly-learns-DJ, no identified DNa02/GF without data, no artist cloning, no cutting flies for a nightclub.

## License of *this* toy

The app code in this folder is a demo. The **connectome** is CC BY from the groups above. If you show screenshots, keep the credit line.
