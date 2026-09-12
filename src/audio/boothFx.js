/**
 * Client-side booth FX rack driven by the fly (never hits the shared encoder).
 *
 * Filter: DJ HP ↔ open ↔ LP
 * Echo: BPM-synced dotted-8th delay
 * Loop: delay-freeze beat repeater (fill one cycle, then recirculate)
 */

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function beatSec(bpm) {
  return 60 / Math.max(60, Math.min(220, bpm || 124));
}

/**
 * @param {AudioContext} ctx
 */
export function createBoothFx(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 18000;
  filter.Q.value = 0.7;

  const dry = ctx.createGain();
  dry.gain.value = 1;

  const echoDelay = ctx.createDelay(2);
  echoDelay.delayTime.value = 0.35;
  const echoFb = ctx.createGain();
  echoFb.gain.value = 0.28;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0;

  const loopDelay = ctx.createDelay(8);
  loopDelay.delayTime.value = 0.47;
  const loopSend = ctx.createGain();
  loopSend.gain.value = 0;
  const loopFb = ctx.createGain();
  loopFb.gain.value = 0;
  const loopWet = ctx.createGain();
  loopWet.gain.value = 0;

  input.connect(filter);
  filter.connect(dry);
  dry.connect(output);

  filter.connect(echoDelay);
  echoDelay.connect(echoFb);
  echoFb.connect(echoDelay);
  echoDelay.connect(echoWet);
  echoWet.connect(output);

  filter.connect(loopSend);
  loopSend.connect(loopDelay);
  loopDelay.connect(loopFb);
  loopFb.connect(loopDelay);
  loopDelay.connect(loopWet);
  loopWet.connect(output);

  let filterAmt = 0;
  let echoAmt = 0;
  let looping = false;
  let loopBeats = 1;
  let bpm = 124;

  function applyFilter(amt) {
    filterAmt = clamp(Number(amt) || 0, -1, 1);
    const t = ctx.currentTime;
    const a = Math.abs(filterAmt);
    if (a < 0.035) {
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(18000, t, 0.035);
      filter.Q.setTargetAtTime(0.7, t, 0.035);
      return;
    }
    if (filterAmt < 0) {
      filter.type = 'highpass';
      const hz = clamp(50 * 10 ** (a * 1.85), 50, 5000);
      filter.frequency.setTargetAtTime(hz, t, 0.035);
      filter.Q.setTargetAtTime(0.85 + a * 2.8, t, 0.035);
    } else {
      filter.type = 'lowpass';
      const hz = clamp(16000 / 10 ** (a * 1.7), 220, 16000);
      filter.frequency.setTargetAtTime(hz, t, 0.035);
      filter.Q.setTargetAtTime(0.9 + a * 3.6, t, 0.035);
    }
  }

  function applyEcho(amt) {
    echoAmt = clamp(Number(amt) || 0, 0, 1);
    const t = ctx.currentTime;
    echoWet.gain.setTargetAtTime(echoAmt * 0.58, t, 0.045);
    echoFb.gain.setTargetAtTime(0.16 + echoAmt * 0.48, t, 0.045);
    echoDelay.delayTime.setTargetAtTime(clamp(beatSec(bpm) * 0.75, 0.08, 1.8), t, 0.07);
  }

  function loopLenSec() {
    return clamp(loopBeats * beatSec(bpm), 0.08, 7.5);
  }

  function setLooping(on) {
    const t = ctx.currentTime;
    looping = !!on;
    loopSend.gain.cancelScheduledValues(t);
    loopFb.gain.cancelScheduledValues(t);
    loopWet.gain.cancelScheduledValues(t);
    dry.gain.cancelScheduledValues(t);
    if (looping) {
      const sec = loopLenSec();
      loopDelay.delayTime.setValueAtTime(sec, t);
      loopSend.gain.setValueAtTime(1, t);
      loopSend.gain.setValueAtTime(0.0001, t + sec);
      loopFb.gain.setValueAtTime(0.985, t);
      loopWet.gain.setTargetAtTime(1, t, 0.012);
      dry.gain.setValueAtTime(1, t);
      dry.gain.setTargetAtTime(0.0001, t + sec * 0.92, 0.02);
    } else {
      loopFb.gain.setTargetAtTime(0, t, 0.05);
      loopWet.gain.setTargetAtTime(0, t, 0.08);
      loopSend.gain.setTargetAtTime(0, t, 0.04);
      dry.gain.setTargetAtTime(1, t, 0.05);
    }
  }

  function setBpm(next) {
    const n = Number(next);
    if (Number.isFinite(n)) bpm = clamp(n, 70, 200);
    if (echoAmt > 0.01) applyEcho(echoAmt);
  }

  function setLoopBeats(beats) {
    const n = Number(beats);
    if (Number.isFinite(n) && n > 0) loopBeats = n;
  }

  function reset() {
    applyFilter(0);
    applyEcho(0);
    if (looping) setLooping(false);
  }

  return {
    input,
    output,
    applyFilter,
    applyEcho,
    setLooping,
    setLoopBeats,
    setBpm,
    reset,
    filterHz() {
      return filter.frequency.value;
    },
    get looping() {
      return looping;
    },
    get loopBeats() {
      return loopBeats;
    },
    get filterAmt() {
      return filterAmt;
    },
    get echoAmt() {
      return echoAmt;
    },
    get bpm() {
      return bpm;
    },
  };
}

export function formatFilterRead(amt, hz) {
  const a = Number(amt) || 0;
  if (Math.abs(a) < 0.035) return 'open';
  const n = Math.round(hz || 0);
  const label = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  return a < 0 ? `HP ${label}` : `LP ${label}`;
}
