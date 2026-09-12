/**
 * Policy feature extractor.
 * Sensors (eyes / analysers / LIF rates) → flat state vector for decide().
 * BPM: demo metadata when present, else kick-interval estimate.
 */

const BPM_HISTORY = 8;

/**
 * Mutable feature tracker (kick intervals, energy slope).
 */
export function createFeatureTracker() {
  /** @type {number[]} */
  const kickTimes = [];
  let lastEnergy = 0;
  let energySlope = 0;
  let phraseOrigin = 0; // audio time at phase 0
  let lastBpm = 124;
  let demoBpmA = 124;
  let demoBpmB = 126;
  let useDemoBpm = true;
  let kickDensity = 0;
  let lastKickDensityT = 0;

  function setDemoBpms(a, b) {
    demoBpmA = a;
    demoBpmB = b;
    useDemoBpm = true;
  }

  function setUseDemoBpm(v) {
    useDemoBpm = !!v;
  }

  function noteKick(now) {
    kickTimes.push(now);
    while (kickTimes.length > BPM_HISTORY + 2) kickTimes.shift();
    while (kickTimes.length && now - kickTimes[0] > 4) kickTimes.shift();
  }

  function estimateBpm(now, activeDeck, featA, featB) {
    const feat = activeDeck === 'B' ? featB : featA;
    if (feat.kick > 0.45) noteKick(now);

    // Density: kicks in last 2s
    const recent = kickTimes.filter((t) => now - t < 2);
    if (now - lastKickDensityT > 0.05) {
      kickDensity += (recent.length / 2 - kickDensity) * 0.25;
      lastKickDensityT = now;
    }

    if (useDemoBpm) {
      lastBpm = activeDeck === 'B' ? demoBpmB : demoBpmA;
      return lastBpm;
    }

    if (kickTimes.length >= 3) {
      const intervals = [];
      for (let i = 1; i < kickTimes.length; i++) {
        const dt = kickTimes[i] - kickTimes[i - 1];
        if (dt > 0.22 && dt < 1.2) intervals.push(dt);
      }
      if (intervals.length) {
        intervals.sort((a, b) => a - b);
        const med = intervals[Math.floor(intervals.length / 2)];
        const bpm = 60 / med;
        // Snap to plausible dance range; prefer quarter-note feel.
        const candidates = [bpm, bpm * 2, bpm / 2].filter((x) => x >= 90 && x <= 160);
        if (candidates.length) {
          lastBpm = candidates.reduce((best, x) =>
            Math.abs(x - lastBpm) < Math.abs(best - lastBpm) ? x : best,
          );
        }
      }
    }
    return lastBpm;
  }

  /**
   * Phrase phase 0..1 within `bars` bars at `bpm`, locked to phraseOrigin.
   */
  function phrasePhase(now, bpm, bars) {
    const beatSec = 60 / Math.max(60, bpm);
    const phraseSec = beatSec * bars * 4;
    if (!phraseOrigin) phraseOrigin = now;
    let t = (now - phraseOrigin) % phraseSec;
    if (t < 0) t += phraseSec;
    return t / phraseSec;
  }

  function resetPhrase(now = 0) {
    phraseOrigin = now;
  }

  /**
   * @returns {object} flat feature bag for policy + logger
   */
  function extract({
    now,
    featA,
    featB,
    featM,
    left,
    right,
    dnL,
    dnR,
    gf,
    xfader,
    stylePhraseBars = 8,
  }) {
    const activeDeck = xfader <= 0 ? 'A' : 'B';
    const bpm = estimateBpm(now, activeDeck, featA, featB);

    const energy =
      featM.rms * 0.55 + featM.bass * 0.35 + featM.hi * 0.1;
    const dE = energy - lastEnergy;
    energySlope = energySlope * 0.85 + dE * 0.15;
    lastEnergy = energy;

    const energyA = featA.rms * 0.5 + featA.bass * 0.4 + featA.hi * 0.1;
    const energyB = featB.rms * 0.5 + featB.bass * 0.4 + featB.hi * 0.1;
    const eyeAsym = (right?.r16Mean ?? 0) - (left?.r16Mean ?? 0);
    const coincidentKick = featA.kick > 0.35 && featB.kick > 0.35 ? 1 : 0;

    return {
      t: now,
      bpm,
      bpmInDemo: useDemoBpm,
      rms: featM.rms,
      bass: featM.bass,
      hi: featM.hi,
      energy,
      energySlope,
      energyA,
      energyB,
      kickA: featA.kick,
      kickB: featB.kick,
      kickDensity,
      coincidentKick,
      phrasePhase: phrasePhase(now, bpm, stylePhraseBars),
      phraseBars: stylePhraseBars,
      dnLRate: dnL?.rate ?? 0,
      dnRRate: dnR?.rate ?? 0,
      gfRate: gf?.rate ?? 0,
      eyeAsym,
      activeDeck,
      xfader,
    };
  }

  return {
    extract,
    setDemoBpms,
    setUseDemoBpm,
    resetPhrase,
    get lastBpm() {
      return lastBpm;
    },
  };
}
