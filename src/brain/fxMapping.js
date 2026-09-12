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

  // Filter: DNa02-like L/R → HP vs LP. Bass-heavy mix leans LP.
  let filter = diff * 0.88 + (bass - hi) * 0.32 + (fxI - 0.42) * 0.38;
  filter = clamp(filter, -1, 1);

  // Echo: sine-song analog — persistent wing tone during TRANSITION; GF residual.
  let echo = 0;
  if (trans) echo = 0.2 + 0.55 * Math.sin(tp * Math.PI);
  echo += clamp(gfRate / 26, 0, 0.32);
  echo += hi * 0.14;
  echo = clamp(echo, 0, 1);

  // Pitch: bilateral DN vigor → walking speed analog (±~4%).
  const pitch = clamp(1 + Math.tanh((mean - 9) / 14) * 0.045, 0.92, 1.08);

  // Loop: pulse-song analog — a short repeating syllable, not a whole track.
  let loop = false;
  let loopBeats = 1;
  let loopHold = 0;
  const beat = 60 / bpm;
  if (s.gfFired) {
    loop = true;
    loopBeats = kick > 0.45 ? 0.25 : 0.5;
    loopHold = beat * loopBeats * 3.2;
  } else if (trans && tp > 0.22 && tp < 0.82 && kick > 0.18) {
    loop = true;
    loopBeats = 1;
    loopHold = beat * 2.2;
  }

  const fLabel = Math.abs(filter) < 0.05 ? 'open' : filter < 0 ? 'HP' : 'LP';
  const reason = `FLY · DNΔ ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} → ${fLabel} · vigor ${mean.toFixed(0)} Hz`;

  return { filter, echo, pitch, loop, loopBeats, loopHold, mean, diff, reason };
}
