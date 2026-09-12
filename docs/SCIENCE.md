# What is real, what is ours

DJ Drosophila is **scientific comedy**. It borrows names and a public dataset credit. It does not analyze MaleCNS, does not simulate the fly, and does **not** claim the fly learns.

## Real (credit this)

- The **Male CNS connectome** is a finished wiring diagram of an adult male *Drosophila* central nervous system (brain + optic lobes + ventral nerve cord). Data acquired and analyzed by the **FlyEM Project Team at HHMI Janelia**, the **Cambridge Connectomics Group / MRC LMB**, and **Google Research**. Licensed **CC BY**.
- Public entry points: [Janelia Male CNS](https://www.janelia.org/project-team/flyem/male-cns-connectome), [neuPrint](https://neuprint.janelia.org) dataset **`male-cns:v1.0`**, [male-cns.janelia.org](https://male-cns.janelia.org/download/).
- **Photoreceptors R1–R8** are real cells in each ommatidium. **R1–R6** are broadband luminance / motion workhorses. **R7** is UV. **R8** comes in color subtypes (pale/yellow). We do not reconstruct opsins or the true lattice.
- **Descending neurons (DNs)** are a real class that send brain signals into the VNC. **DNa02** appears in the literature as a turning / walking-related DN. That is *not* a statement that our `DN-L` / `DN-R` units *are* DNa02.
- The **Giant Fiber (GF)** is a real escape-related descending neuron (often aligned with **DNp01** in some datasets). Verify the type string in MaleCNS before quoting it.
- **T4/T5** are real optic-lobe motion detectors (ON/OFF). They are a `TODO` gag target here, not a wired circuit.
- **PAM** neurons are real dopaminergic cells in the mushroom body. **PAM11** as a “reward the mix” joke is unwired and unlabeled as fact.

## Ours (approximate, invented, or toy)

- The dual-eye **visualizer** (hex facets, bass/hi bars, kick strobe, crossfader stripe).
- **Column count** (~200–400, `TODO` ~1771). Not an ommatidium census.
- **R1–R6 / R8 fields** derived from an FFT. Not intracellular recordings.
- **LIF neurons** (`src/brain/lif.js`): classroom Euler toys. Time constants and thresholds are design choices.
- **DN-L / DN-R**: *proxies* for DNa02 L/R **or** for left/right eye asymmetry. **Do not claim identity without data.**
- **Giant Fiber / escape proxy**: fires on audio onsets / coincident kicks, then *proposes* a deck dump. The **owned policy + phrase gate** must co-sign (unless you override). That is a joke about escape, not the jump-and-fly motor program.
- **Mapping weights** in `src/brain/mapping.js`. None are synaptic counts.
- **Owned DJ policy** (`src/policy/*`): user-controlled style presets + heuristics + **unsupervised structure learning from your unlabeled mix stream** + optional supervised/weak fit. Sits **above** LIF mapping:
  `features → policy.decide() → biases/overrides xfader / skip`, then `final = (1−α)·LIF + α·policy`.
- Style ids `stadium-hype`, `psy-peak`, `bass-blender` are **genre-lane heuristics**, not named after real DJs, not clones of copyrighted sets, not shipped artist weights.
- **Demo synths**, the comic filter sweep, the fake caption *“closed-loop DJ policy on MaleCNS v1.0”*.
- Manual override. Flies do not have range sliders. This fly does not have hands. This fly does not exist on the page.

## Unsupervised method (honest)

`src/policy/unsupervised.js` fits on logged feature vectors (RMS, bass, energy slope, kick density, phrase phase, DN rates, eye asymmetry, BPM, deck A/B energies):

1. **Normalize** with running mean/std (z-score).
2. **Online / batch k-means** (k ≈ 6–8) → centroids + **Markov transition counts**.
3. **Novelty** = distance to nearest centroid.
4. **Energy affinity** → soft xfader from observed (energyA−energyB) distribution (percentile / piecewise map).
5. **Self-supervised skip labels**: auto-mark 1 when novelty (or rare transition / large A–B mismatch) hits a phrase boundary in the historical buffer; fit a tiny logistic on those stream-generated labels — **not human skip labels**.
6. Persist `{ version, means, stds, centroids, transitions, skipWeights, xfaderMap, samples, trainedAt, … }` in `localStorage`.

`policy.decide()` blends unsupervised xfader/skip with style heuristics (~0.5/0.5, style-dependent). Seed: synthetic demo-shaped features on first load; optional auto-refit every ~200 samples; one refit after ~30s of live demo.

**Limitations:** this discovers *structure in your stream* and maps it to mixer actions with clear rules. It does **not** magically become a world-class DJ. World-class still needs crates + taste data. It improves over pure hand heuristics using the project's own data. It is **not** MaleCNS plasticity and **not** artist cloning.

## Policy vs MaleCNS (read twice)

| Claim | Truth |
| --- | --- |
| The fly learned to DJ | **No.** LIF stub does not train. |
| MaleCNS plasticity | **No.** We never touch the connectome. |
| Closed-loop policy on the animal | **No.** The caption is fake comedy. |
| Owned policy head | **Yes** — your heuristics, your α, your logs, unsupervised structure, optional fit. |
| Unsupervised = human labels | **No.** Labels for the skip logistic are self-generated from novelty@phrase in the stream. |
| Artist cloning / named DJ models | **No.** Internal ids only; UI says heuristic+trainable. |
| Real artist weights without your data | **Impossible here.** Unsupervised uses *your* mix features only. |

## What not to claim

- **No consciousness.** A LIF stub is not a mind. MaleCNS is a map of one animal, not a person in a USB stick.
- **No upload.** We did not instantiate the connectome. We did not load ~166k neurons. We loaded three toy cells and a canvas.
- **No “the fly understands music.”** Photoreceptors are being shown a spectrogram. That is our mash-up, not a result.
- **No “the fly learned DJ decisions.”** Unsupervised / supervised training updates *your* policy artifacts in `localStorage`, not the connectome and not a biological learner.
- **No identified cell** unless you fetched it from neuPrint and matched `bodyId` / `type`. Our labels say *proxy* on purpose.
- **No cutting flies** for a nightclub, an art piece, or a demo. This project is software. Leave the animals to people with protocols and approval.
- **No sexed behavior claims.** MaleCNS enables comparison with female datasets. We do not.
- **No artist imitation.** Do not rename presets after living DJs or claim the weights match a copyrighted set.

## If you extend this

1. Keep the joke, keep the caveat in the same viewport.
2. Any real neuPrint query belongs in `docs/NEUPRINT.md` and should be marked **verify-in-explorer** until you have run it.
3. Prefer `bodyId` over a remembered type string. Type names move between datasets (hemibrain, MANC, BANC, MaleCNS).
4. Do not silently drop “approx” from the UI.
5. If you replace training with heavier ML, keep the ownership story: **your data, your stream, your weights** — and say clearly whether labels were human or self-supervised.
