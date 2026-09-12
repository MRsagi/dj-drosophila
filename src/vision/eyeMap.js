/**
 * Photoreceptor stand-in: R1–R6 luminance, R8 "color", left / right eyes.
 *
 * Real Drosophila: each ommatidium has R1–R8. R1–R6 are broadband (motion);
 * R7 is UV; R8 is color (pale/yellow subtypes). We do not reconstruct the
 * real rhabdomere lattice or opsins.
 *
 * Column count is a visualizer budget, not a cell count.
 * TODO: ~1771 columns (verify against the dataset / dual-eye figure you want).
 */

export const TARGET_COLUMNS = 288; // in the required 200–400 band
export const TODO_COLUMNS = 1771;

export function createEye(side, n = TARGET_COLUMNS) {
  return {
    side, // 'L' | 'R'
    n,
    r16: new Float32Array(n),
    r8: new Float32Array(n),
    r16Mean: 0,
    r8Mean: 0,
    centroid: 0.45,
    bassField: new Float32Array(n),
    hiField: new Float32Array(n),
  };
}

function sampleBin(freq, i, n) {
  const x = (i / n) * freq.length;
  const i0 = Math.min(freq.length - 1, Math.floor(x));
  const i1 = Math.min(freq.length - 1, i0 + 1);
  const f = x - i0;
  return ((freq[i0] * (1 - f) + freq[i1] * f) / 255) ** 1.15;
}

export function updateEye(eye, feat, { smoothBass = 0.12, smoothHi = 0.55 } = {}) {
  const { freq, bass, hi, mid, spectralCentroid, kick } = feat;
  const n = eye.n;
  let s16 = 0;
  let s8 = 0;

  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    // Thick slow: low-frequency energy, spatially wide, temporally lagged.
    const thick = sampleBin(freq, Math.floor(x * n * 0.22), n) * 0.65 + bass * 0.55;
    eye.bassField[i] += (thick - eye.bassField[i]) * smoothBass;

    // Thin fast: high bins, less smoothing, narrower effective columns.
    const thin = sampleBin(freq, Math.floor(n * (0.45 + x * 0.55)), n) * 0.8 + hi * 0.35;
    eye.hiField[i] += (thin - eye.hiField[i]) * smoothHi;

    // R1–R6: luminance (bass-weighted + broadband).
    const lum = Math.min(1.4, eye.bassField[i] * 0.85 + mid * 0.25 + eye.hiField[i] * 0.15 + kick * 0.2);
    eye.r16[i] = lum;
    s16 += lum;

    // R8: fake "color" from spectral position + local hi/mid ratio. Not opsin data.
    const chroma = Math.min(1, 0.25 + spectralCentroid * 0.7 + eye.hiField[i] * 0.35 + mid * 0.2);
    eye.r8[i] = chroma;
    s8 += chroma;
  }

  eye.r16Mean = s16 / n;
  eye.r8Mean = s8 / n;
  eye.centroid = spectralCentroid;
}
