/**
 * High-quality-ish procedural CC0 beds for the public crate.
 * Distinct loops via Web Audio — not files, not Spotify, not artist clones.
 * License of the generators: treat as CC0 for this project (toy / demo).
 *
 * Rotation note: the six beds are intentionally far apart in BPM / key /
 * drum pattern / timbre so crate advancement is audible (not the same loop
 * with a new title).
 */

function midi(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

function noiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function kick(ctx, dest, t, { pitch = 148, decay = 0.22, gain = 0.88 } = {}) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.08);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.04);
}

function hat(ctx, dest, noise, t, { decay = 0.04, gain = 0.11, hp = 7500 } = {}) {
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

function clap(ctx, dest, noise, t, { gain = 0.2 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1350;
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + 0.2);
}

function snare(ctx, dest, noise, t, { gain = 0.22 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  const tone = ctx.createOscillator();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(180, t);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(gain * 0.35, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  tone.connect(tg);
  tg.connect(dest);
  src.start(t);
  src.stop(t + 0.15);
  tone.start(t);
  tone.stop(t + 0.1);
}

function bass(ctx, dest, t, freq, { dur = 0.2, gain = 0.24, cutoff = 480, type = 'sawtooth' } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 5.5;
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.22), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(f);
  f.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function pad(ctx, dest, t, freqs, { dur = 0.55, gain = 0.045, cutoff = 900, type = 'triangle' } = {}) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(cutoff * 0.45, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  f.connect(g);
  g.connect(dest);
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(f);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

function stab(ctx, dest, t, freqs, { dur = 0.28, gain = 0.065 } = {}) {
  pad(ctx, dest, t, freqs, { dur, gain, cutoff: 1600 });
}

function createScheduler(ctx, dest, { bpm, pattern }) {
  const lookAhead = 0.14;
  let nextStep = 0;
  let nextTime = 0;
  let running = false;
  const stepSec = 60 / bpm / 4;

  return {
    bpm,
    start(at) {
      running = true;
      nextStep = 0;
      nextTime = (at != null ? at : ctx.currentTime) + 0.05;
    },
    stop() {
      running = false;
    },
    tick() {
      if (!running) return;
      const horizon = ctx.currentTime + lookAhead;
      while (nextTime < horizon) {
        pattern(nextStep % 16, nextTime, Math.floor(nextStep / 16));
        nextStep += 1;
        nextTime += stepSec;
      }
    },
    get running() {
      return running;
    },
    get step() {
      return nextStep;
    },
  };
}

/**
 * Six clearly distinct beds — different BPM families, keys, drums, timbre.
 * @type {Record<string, (ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) => ReturnType<typeof createScheduler>>}
 */
const FACTORIES = {
  // Warm four-on-floor house — Cm stabs, open hats
  'house-pulse'(ctx, dest, noise) {
    const bassNotes = [36, 36, 39, 36, 31, 31, 34, 36].map(midi); // C minor
    const chord = [48, 51, 55, 58].map(midi);
    return createScheduler(ctx, dest, {
      bpm: 122,
      pattern(step, t) {
        if (step % 4 === 0) kick(ctx, dest, t, { pitch: 152, gain: 0.92 });
        if (step % 2 === 1) hat(ctx, dest, noise, t, { gain: 0.11, hp: 8200 });
        if (step === 4 || step === 12) hat(ctx, dest, noise, t, { gain: 0.18, hp: 9500, decay: 0.07 });
        if (step % 2 === 0) {
          bass(ctx, dest, t, bassNotes[(step / 2) % bassNotes.length], {
            dur: 0.22,
            gain: 0.26,
            cutoff: 560,
            type: 'sawtooth',
          });
        }
        if (step === 0) stab(ctx, dest, t, chord, { gain: 0.06, dur: 0.36 });
      },
    });
  },

  // Cold industrial techno — harder kick, offbeat hats, no warm pads
  'techno-lattice'(ctx, dest, noise) {
    const bassNotes = [41, 41, 36, 41, 39, 36, 34, 41].map(midi); // F root-ish
    return createScheduler(ctx, dest, {
      bpm: 130,
      pattern(step, t) {
        if (step % 4 === 0) kick(ctx, dest, t, { pitch: 118, decay: 0.12, gain: 0.9 });
        if (step === 4 || step === 12) clap(ctx, dest, noise, t, { gain: 0.26 });
        if (step % 2 === 0) hat(ctx, dest, noise, t, { gain: 0.055, hp: 5800, decay: 0.025 });
        if (step === 3 || step === 7 || step === 11 || step === 15) {
          hat(ctx, dest, noise, t, { gain: 0.16, hp: 12000, decay: 0.022 });
        }
        if (step % 2 === 0) {
          const note = bassNotes[(step / 2) % bassNotes.length];
          bass(ctx, dest, t, note * (step === 10 ? 2 : 1), {
            dur: step === 10 ? 0.09 : 0.14,
            gain: 0.22,
            cutoff: 320,
            type: 'square',
          });
        }
      },
    });
  },

  // Sub-heavy sparse groove — deep Fm, long kick, few hats
  'bass-tunnel'(ctx, dest, noise) {
    const bassNotes = [29, 29, 32, 29, 24, 27, 29, 32].map(midi); // F / Ab low
    return createScheduler(ctx, dest, {
      bpm: 118,
      pattern(step, t) {
        if (step % 4 === 0) kick(ctx, dest, t, { pitch: 95, decay: 0.38, gain: 0.98 });
        if (step === 8) snare(ctx, dest, noise, t, { gain: 0.14 });
        if (step === 6 || step === 14) hat(ctx, dest, noise, t, { gain: 0.05, hp: 4200, decay: 0.1 });
        if (step === 0 || step === 4 || step === 8 || step === 12) {
          bass(ctx, dest, t, bassNotes[(step / 4) % bassNotes.length], {
            dur: 0.42,
            gain: 0.34,
            cutoff: 240,
            type: 'sine',
          });
        }
        if (step === 0) {
          pad(ctx, dest, t, [41, 44, 48].map(midi), { dur: 1.1, gain: 0.035, cutoff: 520, type: 'sine' });
        }
      },
    });
  },

  // Fast psy — Am, rolling 16ths, gallop bass
  'psy-facet'(ctx, dest, noise) {
    const bassNotes = [33, 33, 33, 40, 33, 33, 36, 40].map(midi); // A minor gallop
    const lead = [57, 60, 64, 67, 64, 60, 57, 55].map(midi);
    return createScheduler(ctx, dest, {
      bpm: 142,
      pattern(step, t, bar) {
        if (step % 4 === 0) kick(ctx, dest, t, { pitch: 168, decay: 0.11, gain: 0.9 });
        if (step % 1 === 0 && step % 4 !== 0) {
          hat(ctx, dest, noise, t, { gain: 0.07, hp: 10000, decay: 0.022 });
        }
        if (step === 4 || step === 12) clap(ctx, dest, noise, t, { gain: 0.14 });
        // Gallop: every 16th with accents
        bass(ctx, dest, t, bassNotes[step % bassNotes.length], {
          dur: 0.09,
          gain: step % 4 === 0 ? 0.2 : 0.14,
          cutoff: 780,
          type: 'sawtooth',
        });
        if (step % 4 === 0) {
          const f = lead[(bar * 2 + step / 4) % lead.length];
          stab(ctx, dest, t, [f, f * 1.498], { dur: 0.14, gain: 0.048 });
        }
      },
    });
  },

  // Slow ambient — Em pads, almost no drums
  'ambient-r8'(ctx, dest, noise) {
    const chordA = [52, 55, 59, 62].map(midi); // E minor-ish
    const chordB = [50, 54, 57, 61].map(midi);
    const chordC = [48, 52, 55, 59].map(midi);
    return createScheduler(ctx, dest, {
      bpm: 92,
      pattern(step, t, bar) {
        if (step === 0 && bar % 4 === 0) kick(ctx, dest, t, { pitch: 78, decay: 0.55, gain: 0.32 });
        if (step === 8) hat(ctx, dest, noise, t, { gain: 0.03, hp: 3500, decay: 0.18 });
        if (step === 0) {
          const ch = [chordA, chordB, chordA, chordC][bar % 4];
          pad(ctx, dest, t, ch, { dur: 2.2, gain: 0.07, cutoff: 1400, type: 'triangle' });
        }
        if (step === 0 || step === 8) {
          bass(ctx, dest, t, midi(28 + (bar % 2) * 2), {
            dur: 0.9,
            gain: 0.1,
            cutoff: 180,
            type: 'sine',
          });
        }
      },
    });
  },

  // Fast breakbeat — Gm, syncopated kicks, snares
  'break-escape'(ctx, dest, noise) {
    const bassNotes = [31, 31, 34, 29, 31, 36, 34, 31].map(midi); // G minor
    return createScheduler(ctx, dest, {
      bpm: 168,
      pattern(step, t) {
        // Amen-ish skeleton (not a sample clone — just syncopation)
        if (step === 0 || step === 2 || step === 6 || step === 8 || step === 11 || step === 14) {
          kick(ctx, dest, t, { pitch: 145, decay: 0.09, gain: 0.82 });
        }
        if (step === 4 || step === 12) snare(ctx, dest, noise, t, { gain: 0.28 });
        if (step === 7 || step === 15) snare(ctx, dest, noise, t, { gain: 0.12 });
        if (step % 2 === 1) hat(ctx, dest, noise, t, { gain: 0.09, hp: 9000, decay: 0.03 });
        if (step % 2 === 0) {
          bass(ctx, dest, t, bassNotes[(step / 2) % bassNotes.length], {
            dur: 0.11,
            gain: 0.2,
            cutoff: 620,
            type: 'sawtooth',
          });
        }
      },
    });
  },
};

/**
 * Create a procedural track player for one manifest proceduralId.
 * @returns {{ out: GainNode, bpm: number, start: Function, stop: Function, tick: Function, running: boolean, id: string }}
 */
export function createProceduralTrack(ctx, proceduralId) {
  const factory = FACTORIES[proceduralId];
  if (!factory) {
    throw new Error(`Unknown proceduralId: ${proceduralId}`);
  }
  const noise = noiseBuffer(ctx);
  const out = ctx.createGain();
  out.gain.value = 0.88;
  const sched = factory(ctx, out, noise);
  return {
    id: proceduralId,
    out,
    bpm: sched.bpm,
    start(at) {
      sched.start(at);
    },
    stop() {
      sched.stop();
    },
    tick() {
      sched.tick();
    },
    get running() {
      return sched.running;
    },
    get step() {
      return sched.step;
    },
  };
}

export function listProceduralIds() {
  return Object.keys(FACTORIES);
}
