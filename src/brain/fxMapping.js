/**
 * Toy descending-neuron → booth FX map.
 *
 * MaleCNS reality (cartoon of the literature, not a neuPrint dump):
 *   eyes → optic lobe → central brain → ~DN bottleneck in the neck
 *   → VNC (leg neuromeres / wing tectulum / escape)
 *
 * Published motifs we *borrow names from*:
 *   DNa02 L/R  — steering: more ipsilateral DN shortens that side's stride
 *   DNa02 both — increases locomotor vigor (Cande / Rayshubskiy)
 *   GF / DNp01 — escape jump / takeoff
 *   pIP10 + VNC song CPG — pulse vs sine courtship song (repeating motor syllable)
 *
 * Our DN-L / DN-R / GF units are LIF toys driven by an FFT. They are not those cells.
 * Weights below are design choices, not synapse counts.
 */

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * @param {object} s
 * @returns {{ filter: number, echo: number, pitch: number, loop: boolean, loopBeats: number, loopHold: number, mean: number, diff: number, reason: string }}
 */
export function flyFxFromCircuit(s) {
  const dnL = Number(s.dnLRate) || 0;
  const dnR = Number(s.dnRRate) || 0;
  const gfRate = Number(s.gfRate) || 0;
  const bass = Number(s.bass) || 0;
  const hi = Number(s.hi) || 0;
  const kick = Number(s.kick) || 0;
  const fxI = Number(s.fxIntensity) || 0.3;
  const bpm = Number(s.bpm) || 124;
  const trans = s.setState === 'TRANSITION';
  const tp = clamp(Number(s.transitionProgress) || 0, 0, 1);

  const mean = 0.5 * (dnL + dnR);
  const diff = Math.tanh((dnR - dnL) / 9);

  // Filter: DNa02-like L/R → HP vs LP. Dead-zone so small DN flicker stays open.
  const steer = Math.abs(diff) < 0.18 ? 0 : diff;
  let filter = steer * 0.55 + (bass - hi) * 0.18 + (fxI - 0.42) * 0.2;
  filter = clamp(filter, -1, 1);

  // Echo: sine-song analog — smear during TRANSITION only (not every hi-hat).
  let echo = 0;
  if (trans) echo = 0.15 + 0.4 * Math.sin(tp * Math.PI);
  echo = clamp(echo, 0, 1);

  // Pitch: bilateral DN vigor → walking speed analog (±~3%).
  const pitch = clamp(1 + Math.tanh((mean - 9) / 18) * 0.03, 0.94, 1.06);

  // Loop: pulse-song analog — rare, one-shot. Not every kick in a blend.
  let loop = false;
  let loopBeats = 1;
  let loopHold = 0;
  const beat = 60 / bpm;
  if (s.gfFired && kick > 0.55) {
    loop = true;
    loopBeats = 0.5;
    loopHold = beat * 2;
  }

  const fLabel = Math.abs(filter) < 0.05 ? 'open' : filter < 0 ? 'HP' : 'LP';
  const reason = `FLY · DNΔ ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} → ${fLabel} · vigor ${mean.toFixed(0)} Hz`;

  return { filter, echo, pitch, loop, loopBeats, loopHold, mean, diff, reason };
}
