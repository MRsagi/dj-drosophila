/**
 * Sensors → LIF currents, LIF rates → mixer.
 * Every number here is a design choice, not a measured synaptic weight.
 *
 * Crossfader: rate(DN-R) − rate(DN-L), fallback to eye luminance asymmetry.
 * Master: mean DN rate (soft-limited later in the audio graph).
 * Skip: GF spike (proposal only — policy phrase-gate must co-sign; see src/policy/).
 *
 * Policy blend (owned DJ head, not MaleCNS learning):
 *   finalXfader = (1 − α) * lifXfader + α * policyXfader
 * α comes from the HUD. LIF rates also feed policy features as residual state.
 */

export function sensorCurrents({ left, right, featA, featB, featM }, now, lastEnergy) {
  const energy = featM.rms + 0.65 * featM.bass;
  const dE = Math.max(0, energy - lastEnergy);

  // Photoreceptor-ish drive: R1–R6 luminance plus a little R8 "color" energy.
  const leftDrive = left.r16Mean * 1.15 + left.r8Mean * 0.25;
  const rightDrive = right.r16Mean * 1.15 + right.r8Mean * 0.25;

  const dnL =
    0.55 +
    leftDrive * 1.35 +
    featA.bass * 0.9 +
    featA.rms * 0.8 +
    featA.lowMid * 0.35;

  const dnR =
    0.55 +
    rightDrive * 1.35 +
    featB.bass * 0.9 +
    featB.rms * 0.8 +
    featB.lowMid * 0.35;

  // Escape proxy: sudden master energy, coincident kicks, very bright both eyes.
  const coincident = featA.kick > 0.35 && featB.kick > 0.35 ? 0.85 : 0;
  const gf =
    dE * 7.5 +
    featM.kick * 0.9 +
    coincident +
    Math.max(0, left.r16Mean + right.r16Mean - 1.25) * 0.6;

  return { dnL, dnR, gf, energy, now };
}

export function ratesToMixer({ dnL, dnR, meanRate, left, right }) {
  const diffRates = dnR.rate - dnL.rate;
  const rateSum = dnL.rate + dnR.rate;
  const eyeDiff = right.r16Mean - left.r16Mean;

  // Fallback when both DNs are quiet: eye asymmetry, still labeled as such.
  // Gain kept modest — final twitch control is slew in mixer/main, not here.
  const raw = rateSum < 2.5 ? eyeDiff * 1.1 : diffRates * 0.12;
  const xfader = Math.tanh(raw);

  // Mean rate → master. Floor so silence is not digital zero.
  const vol = 0.28 + 0.55 * Math.tanh(meanRate / 18);
  return {
    xfader,
    volume: Math.max(0.12, Math.min(0.95, vol)),
    usedFallback: rateSum < 2.5,
    diffRates,
    eyeDiff,
  };
}

/**
 * Blend LIF xfader with policy target.
 * final = (1 − alpha) * lif + alpha * policy
 */
export function blendPolicyXfader(lifXfader, policyXfader, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return (1 - a) * lifXfader + a * policyXfader;
}
