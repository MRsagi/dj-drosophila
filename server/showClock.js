/**
 * Show clock — public snapshot of where we are on the show log.
 * Encoder-private fields (paths, seeks, remaining play) stay off this object.
 */

const PUBLIC_KEYS = [
  'serverTime',
  'showStart',
  'seed',
  'styleId',
  'state',
  'activeDeck',
  'quietDeck',
  'trackA',
  'trackB',
  'xfaderEdge',
  'playedSec',
  'plannedSec',
  'nextTrack',
  'transitionProgress',
  'transitionSec',
  'mindReason',
  'statusLine',
  'timeStr',
  'edgeLabel',
  'streamUrl',
  'motif',
];

/**
 * @param {Record<string, unknown>} st schedule.getState()
 */
export function publicSnapshot(st) {
  const out = {};
  for (const k of PUBLIC_KEYS) {
    if (st[k] !== undefined) out[k] = st[k];
  }
  return out;
}

/**
 * Encoder-only view. Not for SSE / HUD.
 * @param {Record<string, unknown>} st
 */
export function encoderView(st) {
  return {
    state: st.state,
    remainingPlay: st._remainingPlay,
    remainingTransition: st._remainingTransition,
  };
}
