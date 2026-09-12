/**
 * Procedural A/B demo tracks so the MVP runs with zero files.
 * This is not music the fly wrote. This is a toy sequencer.
 *
 * TODO: hat-filter — hats are highpassed noise, not a proper body + decay.
 * TODO: PAM11 gag — a mushroom-body DAN "rewarding a clean mix" would be a
 * joke overlay, not a circuit we have wired, and not a claim.
 */

function midi(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 1;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function kick(ctx, dest, t, { pitch = 148, decay = 0.2, gain = 0.85 } = {}) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, t);
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.07);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.03);
}

function hat(ctx, dest, noise, t, { decay = 0.045, gain = 0.12, hp = 7200 } = {}) {
  // TODO: hat-filter — replace this burst with a resonant noise body.
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + decay + 0.02);
}

function clap(ctx, dest, noise, t, { gain = 0.22 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + 0.2);
}

function bass(ctx, dest, t, freq, { dur = 0.2, gain = 0.26, cutoff = 480 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 6;
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(120, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(f);
  f.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function stab(ctx, dest, t, freqs, { dur = 0.28, gain = 0.07 } = {}) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(420, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  f.connect(g);
  g.connect(dest);
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(f);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

function createScheduler(ctx, dest, { bpm, pattern }) {
  const lookAhead = 0.12;
  let nextStep = 0;
  let nextTime = 0;
  let running = false;
  const stepSec = 60 / bpm / 4; // 16th notes

  function tick() {
    if (!running) return;
    const horizon = ctx.currentTime + lookAhead;
    while (nextTime < horizon) {
      pattern(nextStep % 16, nextTime, Math.floor(nextStep / 16));
      nextStep += 1;
      nextTime += stepSec;
    }
  }

  return {
    dest,
    bpm,
    start() {
      running = true;
      nextStep = 0;
      nextTime = ctx.currentTime + 0.06;
    },
    stop() {
      running = false;
    },
    tick,
    get running() {
      return running;
    },
  };
}

export function createDemoSynths(ctx) {
  const noise = noiseBuffer(ctx);
  const outA = ctx.createGain();
  outA.gain.value = 0.85;
  const outB = ctx.createGain();
  outB.gain.value = 0.85;

  // Shared key family (C minor-ish) so the blend is a mix, not an accident.
  const A_BASS = [36, 36, 39, 36, 31, 31, 34, 36].map(midi);
  const B_BASS = [36, 43, 39, 36, 34, 39, 31, 36].map(midi);
  const STAB = [48, 51, 55, 58].map(midi);

  const a = createScheduler(ctx, outA, {
    bpm: 124,
    pattern(step, t) {
      if (step % 4 === 0) kick(ctx, outA, t, { pitch: 150, gain: 0.9 });
      if (step % 2 === 1) hat(ctx, outA, noise, t, { gain: 0.1, hp: 7800 });
      if (step === 4 || step === 12) hat(ctx, outA, noise, t, { gain: 0.16, hp: 9000, decay: 0.06 });
      if (step % 2 === 0) {
        const note = A_BASS[(step / 2) % A_BASS.length];
        bass(ctx, outA, t, note, { dur: 0.22, gain: 0.24, cutoff: 520 });
      }
      if (step === 0) stab(ctx, outA, t, STAB, { gain: 0.055, dur: 0.32 });
    },
  });

  const b = createScheduler(ctx, outB, {
    bpm: 126,
    pattern(step, t) {
      if (step % 4 === 0) kick(ctx, outB, t, { pitch: 132, decay: 0.16, gain: 0.82 });
      if (step === 4 || step === 12) clap(ctx, outB, noise, t, { gain: 0.2 });
      if (step % 2 === 0) hat(ctx, outB, noise, t, { gain: 0.07, hp: 6500 });
      if (step === 3 || step === 6 || step === 11 || step === 14) {
        hat(ctx, outB, noise, t, { gain: 0.14, hp: 10000, decay: 0.03 });
      }
      if (step % 2 === 0) {
        const note = B_BASS[(step / 2) % B_BASS.length];
        bass(ctx, outB, t, note * (step === 10 ? 2 : 1), {
          dur: step === 10 ? 0.12 : 0.18,
          gain: 0.22,
          cutoff: 400,
        });
      }
    },
  });

  return {
    outA,
    outB,
    bpmA: a.bpm,
    bpmB: b.bpm,
    start() {
      a.start();
      b.start();
    },
    stop() {
      a.stop();
      b.stop();
    },
    tick() {
      a.tick();
      b.tick();
    },
    get running() {
      return a.running || b.running;
    },
  };
}

export async function decodeFile(ctx, file) {
  const buf = await file.arrayBuffer();
  return ctx.decodeAudioData(buf.slice(0));
}

export function playBuffer(ctx, buffer, opts = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = opts.loop !== false; // default loop for set-length beds
  src.start();
  return src;
}
