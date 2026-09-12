/**
 * Phrase gate — hard cuts only near bar 8 / 16 boundaries.
 * World-class DJ rule of thumb #1: don't dump mid-phrase unless you mean it.
 * Aggressive styles get a wider window; still not a free-for-all.
 */

/**
 * @param {object} opts
 * @param {number} opts.phrasePhase  0..1 within the phrase (bars * 4 beats)
 * @param {number} opts.gateBeats    half-width in beats
 * @param {number} opts.phraseBars   8 or 16
 * @param {boolean} [opts.humanOverride]
 * @returns {{ allow: boolean, distBeats: number, nearBoundary: boolean }}
 */
export function phraseGate({ phrasePhase, gateBeats, phraseBars, humanOverride = false }) {
  if (humanOverride) {
    return { allow: true, distBeats: 0, nearBoundary: true };
  }

  const beatsInPhrase = Math.max(1, phraseBars) * 4;
  const beatPos = ((phrasePhase % 1) + 1) % 1; // 0..1
  // Distance to nearest phrase boundary (0 or 1 wrap).
  const distNorm = Math.min(beatPos, 1 - beatPos);
  const distBeats = distNorm * beatsInPhrase;
  const nearBoundary = distBeats <= gateBeats;

  return { allow: nearBoundary, distBeats, nearBoundary };
}

/**
 * Soft score in [0,1]: 1 at boundary, 0 outside gate.
 */
export function phraseProximity({ phrasePhase, gateBeats, phraseBars }) {
  const { distBeats, nearBoundary } = phraseGate({ phrasePhase, gateBeats, phraseBars });
  if (!nearBoundary || gateBeats <= 0) return nearBoundary ? 1 : 0;
  return Math.max(0, 1 - distBeats / gateBeats);
}
