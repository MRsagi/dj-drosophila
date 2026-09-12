/**
 * Per-deck and master FFT / time-domain features.
 * Bass = thick slow energy. Hi = thin fast energy. Kick = bass onset.
 *
 * TODO: T4/T5 kick — real T4/T5 are ON/OFF motion detectors in the optic lobe,
 * not kick drums. A future gag could route onset direction (A vs B) through a
 * T4/T5-shaped delay, but that is not this stub and is not a claim of identity.
 */

export function createAnalyser(ctx, { fftSize = 1024, smoothing = 0.55 } = {}) {
  const node = ctx.createAnalyser();
  node.fftSize = fftSize;
  node.smoothingTimeConstant = smoothing;
  const freq = new Uint8Array(node.frequencyBinCount);
  const time = new Uint8Array(node.fftSize);

  let prevBass = 0;
  let kickHold = 0;
  let lastKickAt = -1;

  function band(fromHz, toHz) {
    const nyquist = ctx.sampleRate / 2;
    const binHz = nyquist / freq.length;
    const i0 = Math.max(0, Math.floor(fromHz / binHz));
    const i1 = Math.min(freq.length - 1, Math.ceil(toHz / binHz));
    let sum = 0;
    let n = 0;
    for (let i = i0; i <= i1; i++) {
      sum += freq[i];
      n++;
    }
    return n ? sum / n / 255 : 0;
  }

  function rmsTime() {
    let acc = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      acc += v * v;
    }
    return Math.sqrt(acc / time.length);
  }

  return {
    node,
    freq,
    time,
    read(now = ctx.currentTime) {
      node.getByteFrequencyData(freq);
      node.getByteTimeDomainData(time);

      const bass = band(20, 140);
      const lowMid = band(140, 420);
      const mid = band(420, 2000);
      const hi = band(2000, 9000);
      const rms = rmsTime();
      const flux = Math.max(0, bass - prevBass);
      prevBass = bass;

      // Kick: bass onset with a short refractory. Not a fly cell.
      const threshold = 0.07;
      let kick = 0;
      if (flux > threshold && now - lastKickAt > 0.16) {
        kick = Math.min(1, flux * 4.5);
        lastKickAt = now;
        kickHold = kick;
      } else {
        kickHold *= 0.82;
        kick = kickHold;
      }

      return {
        bass,
        lowMid,
        mid,
        hi,
        rms,
        flux,
        kick,
        spectralCentroid: centroid(),
        freq,
        time,
      };
    },
  };

  function centroid() {
    let num = 0;
    let den = 0;
    for (let i = 0; i < freq.length; i++) {
      num += i * freq[i];
      den += freq[i];
    }
    return den ? num / den / freq.length : 0.3;
  }
}
