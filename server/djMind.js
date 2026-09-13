/**
 * Server-side DJ mind — decides WHEN to leave and HOW to blend.
 *
 * Pure / deterministic from (seed, absIndex, tick, track metadata, candidates)
 * so every listener shares the same timeline when decisions are logged.
 *
 * Mirrors club policy intent (src/policy): phrase gate, energy arc, novelty,
 * skip aggression — without browser audio analysers (metadata + synthetic arc).
 */

export const MIN_PLAY_SEC = 30;
export const MIN_FADE_SEC = 8;
export const MAX_FADE_SEC = 32;
/** How often the mind re-scores during PLAYING (seconds). */
export const MIND_TICK_SEC = 2;

/** @typedef {'stadium-hype' | 'psy-peak' | 'bass-blender'} StyleId */

const STYLES = {
  'stadium-hype': {
    id: 'stadium-hype',
    energyArc: 0.85,
    blendSpeed: 0.38,
    skipAggression: 0.28,
    phraseBars: 8,
    gateBeats: 1.0,
    crashBoost: 0.35,
    leaveThresh: 0.34,
  },
  'psy-peak': {
    id: 'psy-peak',
    energyArc: 0.55,
    blendSpeed: 0.16,
    skipAggression: 0.08,
    phraseBars: 16,
    gateBeats: 0.75,
    crashBoost: 0.75,
    leaveThresh: 0.4,
  },
  'bass-blender': {
    id: 'bass-blender',
    energyArc: 0.4,
    blendSpeed: 0.55,
    skipAggression: 0.78,
    phraseBars: 8,
    gateBeats: 1.75,
    crashBoost: 0.55,
    leaveThresh: 0.28,
  },
};

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getStyle(styleId) {
  return STYLES[styleId] || STYLES['psy-peak'];
}

/**
 * Synthetic energy arc for a file track (no analyser): rise early, plateau, soft crash late.
 * @param {number} playedSec
 * @param {number} fileDur
 * @param {number} trackEnergy 0..1
 */
export function syntheticEnergy(playedSec, fileDur, trackEnergy = 0.6) {
  const dur = Math.max(1, fileDur || 120);
  const u = clamp(playedSec / dur, 0, 1);
  // Smooth bump peaking ~0.35–0.55 of the file, then decline
  const bump = Math.sin(Math.PI * Math.min(1, u * 1.15));
  const crash = u > 0.72 ? (u - 0.72) / 0.28 : 0;
  const level = clamp(trackEnergy * 0.55 + bump * 0.45 - crash * 0.5, 0.05, 1);
  const prevU = clamp((playedSec - MIND_TICK_SEC) / dur, 0, 1);
  const prevBump = Math.sin(Math.PI * Math.min(1, prevU * 1.15));
  const prevCrash = prevU > 0.72 ? (prevU - 0.72) / 0.28 : 0;
  const prev = clamp(trackEnergy * 0.55 + prevBump * 0.45 - prevCrash * 0.5, 0.05, 1);
  return { level, slope: (level - prev) / MIND_TICK_SEC };
}

/**
 * Phrase phase 0..1 and proximity to boundary (0..1).
 */
export function phraseInfo(playedSec, bpm, phraseBars, gateBeats) {
  const beatsPerSec = (bpm || 124) / 60;
  const phraseBeats = (phraseBars || 8) * 4;
  const beats = playedSec * beatsPerSec;
  const phase = (beats % phraseBeats) / phraseBeats;
  const distBeats = Math.min(phase, 1 - phase) * phraseBeats;
  const gateAllow = distBeats <= (gateBeats || 1);
  const proximity = clamp(1 - distBeats / Math.max(gateBeats || 1, 0.5), 0, 1);
  return { phase, distBeats, gateAllow, proximity, barsPlayed: beats / 4 };
}

/**
 * Max fade that still leaves MIN_PLAY (or shorter for tiny files) before EOF.
 */
export function maxFadeForTrack(fileDur) {
  const dur = fileDur || 120;
  const minPlay = minPlayForTrack(dur);
  return clamp(dur - minPlay - 1, MIN_FADE_SEC, MAX_FADE_SEC);
}

export function minPlayForTrack(fileDur) {
  const dur = fileDur || 120;
  // Short beds: allow earlier leave so we can still fade
  if (dur < MIN_PLAY_SEC + MIN_FADE_SEC + 1) {
    return clamp(dur * 0.4, 12, Math.max(12, dur - MIN_FADE_SEC - 1));
  }
  return MIN_PLAY_SEC;
}

/**
 * Must-leave deadline: last moment PLAYING can end and still feed acrossfade.
 */
export function mustLeaveBy(fileDur, fadeSec) {
  const dur = fileDur || 120;
  const fade = clamp(fadeSec, MIN_FADE_SEC, maxFadeForTrack(dur));
  return Math.max(minPlayForTrack(dur), dur - fade - 1);
}

/**
 * Choose crossfade length (policy, not a constant).
 */

/**
 * Leave-quality reward for mind shaping (not a separate RL loop — folded into leaveScore).
 * Positive: phrase-aligned leave with fadeSec in sweet spot and room before EOF.
 * Negative: too early (< min+cushion), too late (must-leave / near EOF without planning fade),
 *           or "reward" of playing to 100% of file (explicitly penalized).
 *
 * @returns {{ reward: number, notes: string[] }}
 */
export function leaveQualityReward({
  playedSec,
  fileDur,
  fadeSec,
  minPlay,
  deadline,
  phrase,
  style,
}) {
  const notes = [];
  let reward = 0;
  const dur = fileDur || 120;
  const fade = fadeSec ?? 16;
  const minP = minPlay ?? minPlayForTrack(dur);
  const dl = deadline ?? mustLeaveBy(dur, fade);
  const cushion = minP + 18;

  // --- Penalties ---
  if (playedSec < minP) {
    reward -= 0.55;
    notes.push('too-early(<min)');
  } else if (playedSec < cushion) {
    reward -= 0.22;
    notes.push('too-early(<cushion)');
  }

  // Playing to ~100% of file is never rewarded
  if (playedSec >= dur - 1) {
    reward -= 0.7;
    notes.push('played-to-eof');
  } else if (playedSec >= dur - fade) {
    // Left so late the fade would overrun EOF without clamp
    reward -= 0.35;
    notes.push('fade-overruns-eof');
  }

  // Must-leave panic: at/past deadline without having planned earlier
  if (playedSec >= dl) {
    reward -= 0.4;
    notes.push('must-leave-late');
  } else if (playedSec >= dl - 4) {
    reward -= 0.12;
    notes.push('near-must-leave');
  }

  // --- Rewards ---
  // Sweet-spot fade length (12–28s)
  if (fade >= 12 && fade <= 28) {
    reward += 0.28;
    notes.push('fade-sweet');
  } else if (fade >= MIN_FADE_SEC && fade <= MAX_FADE_SEC) {
    reward += 0.08;
    notes.push('fade-ok');
  }

  // Room before EOF: leaveAt ≤ duration - fadeSec - 1
  const room = dur - playedSec - fade;
  if (room >= 1) {
    reward += 0.25;
    notes.push('eof-room');
  } else if (room >= 0) {
    reward += 0.05;
    notes.push('eof-tight');
  }

  // Phrase alignment
  if (phrase?.gateAllow) {
    reward += 0.2 + (phrase.proximity || 0) * 0.15;
    notes.push('phrase-aligned');
  }

  // Patience: left after cushion but well before deadline (good DJ timing)
  if (playedSec >= cushion && playedSec < dl - 8) {
    reward += 0.15;
    notes.push('patient-leave');
  }

  void style;
  return { reward: clamp(reward, -1, 1), notes };
}

export function chooseFadeSec({ style, track, next, fileDur, rng }) {
  const st = style || getStyle('psy-peak');
  const maxF = maxFadeForTrack(fileDur);
  const energyGap = Math.abs((track?.energy ?? 0.6) - (next?.energy ?? 0.6));
  const bpmGap = Math.abs((track?.bpm || 124) - (next?.bpm || 124));

  // Base: slow styles → longer blends; aggressive → shorter (chosen, not a constant)
  let fade = 10 + (1 - st.blendSpeed) * 14; // ~10–24
  // Compatible pair → linger in the blend
  fade += (1 - clamp(energyGap * 2, 0, 1)) * 4;
  fade += (1 - clamp(bpmGap / 20, 0, 1)) * 2;
  // Aggression / stadium cuts shorten
  fade -= st.skipAggression * 5;
  // Small deterministic jitter so fades aren't identical every time
  fade += (rng() - 0.5) * 5;

  return Math.round(clamp(fade, MIN_FADE_SEC, maxF) * 10) / 10;
}

/**
 * Score a candidate as the next track.
 */
export function scoreCandidate(track, cand, style, recentIds, rng) {
  const st = style || getStyle('psy-peak');
  const bpmGap = Math.abs((track.bpm || 124) - (cand.bpm || 124));
  const energyDelta = (cand.energy ?? 0.6) - (track.energy ?? 0.6);
  let score = 0.5;
  // BPM proximity
  score += (1 - clamp(bpmGap / 24, 0, 1)) * 0.35;
  // Energy arc preference
  if (st.energyArc > 0.5) {
    score += clamp(energyDelta, -0.3, 0.3) * st.energyArc;
  } else {
    score += (1 - Math.abs(energyDelta)) * 0.15;
  }
  // Novelty vs recent plays
  const recent = recentIds || [];
  if (recent.includes(cand.id)) score -= 0.45;
  if (recent.slice(-2).includes(cand.id)) score -= 0.25;
  // Tiny deterministic salt
  score += (hashStr(cand.id) / 0xffffffff) * 0.02;
  score += (rng() - 0.5) * 0.05;
  return score;
}

/**
 * Pick next track id from candidates.
 */
export function pickNext(track, candidates, style, recentIds, seed, absIndex, tick) {
  const rng = mulberry32(hashStr(`${seed}:pick:${absIndex}:${tick}`));
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.id === track.id && candidates.length > 1) continue;
    const s = scoreCandidate(track, c, style, recentIds, rng);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return { next: best, score: bestScore };
}

/**
 * One mind tick during PLAYING.
 *
 * @param {object} opts
 * @param {string} opts.seed
 * @param {string} [opts.styleId]
 * @param {object} opts.track  current (needs id,bpm,energy,durationSec)
 * @param {object[]} opts.candidates
 * @param {number} opts.playedSec
 * @param {string[]} [opts.recentIds]
 * @param {number} opts.absIndex
 * @returns {{ shouldTransition: boolean, fadeSec: number, nextTrack: object|null, reason: string, leaveScore: number, gateAllow: boolean }}
 */
export function mindTick(opts) {
  const seed = opts.seed || 'dj-drosophila';
  const style = getStyle(opts.styleId || process.env.DJ_STYLE || 'psy-peak');
  const track = opts.track;
  const fileDur = track.durationSec ?? track.durationHint ?? 120;
  const playedSec = opts.playedSec || 0;
  const tick = Math.floor(playedSec / MIND_TICK_SEC);
  const rng = mulberry32(hashStr(`${seed}:mind:${opts.absIndex}:${tick}`));

  const minPlay = minPlayForTrack(fileDur);
  const { next, score: nextScore } = pickNext(
    track,
    opts.candidates || [],
    style,
    opts.recentIds || [],
    seed,
    opts.absIndex ?? 0,
    tick,
  );

  // Provisional fade (refined once we know we leave)
  let fadeSec = chooseFadeSec({ style, track, next, fileDur, rng });
  const deadline = mustLeaveBy(fileDur, fadeSec);

  const { level, slope } = syntheticEnergy(playedSec, fileDur, track.energy ?? 0.6);
  const phrase = phraseInfo(playedSec, track.bpm, style.phraseBars, style.gateBeats);
  const crashing = slope < -0.008;
  const rising = slope > 0.004;
  const energyGap = Math.abs((next?.energy ?? 0.6) - (track.energy ?? 0.6));

  // --- Leave score (policy-like) ---
  let leaveScore = 0;
  leaveScore += style.skipAggression * 0.3;
  leaveScore += clamp((playedSec - minPlay) / 90, 0, 1) * 0.35; // patience wears thin
  leaveScore += phrase.proximity * 0.35;
  if (crashing) leaveScore += style.crashBoost * 0.8;
  if (rising && style.energyArc > 0.5 && energyGap > 0.08) leaveScore += 0.2;
  // Late in file → urgency
  leaveScore += clamp((playedSec - deadline + 20) / 20, 0, 1) * 0.5;
  // Novelty of next
  leaveScore += clamp(nextScore - 0.3, 0, 0.4);

  // Leave-quality shaping: prefer phrase + sweet fade + EOF room; punish early/late/EOF
  const quality = leaveQualityReward({
    playedSec,
    fileDur,
    fadeSec,
    minPlay,
    deadline,
    phrase,
    style,
  });
  leaveScore += quality.reward * 0.35;

  // Hard constraints
  if (playedSec < minPlay) {
    const barsLeft = Math.max(1, Math.ceil((minPlay - playedSec) / (4 * 60 / (track.bpm || 124))));
    return {
      shouldTransition: false,
      fadeSec,
      nextTrack: next,
      reason: `hold · ${playedSec.toFixed(0)}/${minPlay.toFixed(0)}s (~${barsLeft} bars)`,
      leaveScore,
      gateAllow: phrase.gateAllow,
    };
  }

  if (playedSec >= deadline) {
    fadeSec = chooseFadeSec({ style, track, next, fileDur, rng: mulberry32(hashStr(`${seed}:fadeEOF:${opts.absIndex}`)) });
    fadeSec = Math.min(fadeSec, Math.max(MIN_FADE_SEC, fileDur - playedSec - 0.5));
    fadeSec = clamp(fadeSec, MIN_FADE_SEC, maxFadeForTrack(fileDur));
    const qLate = leaveQualityReward({
      playedSec,
      fileDur,
      fadeSec,
      minPlay,
      deadline,
      phrase,
      style,
    });
    return {
      shouldTransition: true,
      fadeSec,
      nextTrack: next,
      reason: `must leave · ${fadeSec.toFixed(0)}s blend`,
      // Cap: must-leave still forces transition, but score is not a "reward" for EOF play
      leaveScore: clamp(0.55 + qLate.reward * 0.2, 0.35, 0.85),
      gateAllow: true,
      qualityNotes: qLate.notes,
    };
  }

  // Soft leave only after a cushion past min play (avoid thrash at exactly 30s).
  const pastCushion = playedSec >= minPlay + 18;
  const wantLeave =
    phrase.gateAllow &&
    pastCushion &&
    (leaveScore >= style.leaveThresh ||
      (crashing && style.crashBoost > 0.4 && phrase.proximity > 0.35) ||
      (playedSec >= minPlay + 50 && leaveScore >= style.leaveThresh * 0.72));

  if (wantLeave) {
    fadeSec = chooseFadeSec({
      style,
      track,
      next,
      fileDur,
      rng: mulberry32(hashStr(`${seed}:fade:${opts.absIndex}:${tick}`)),
    });
    // Re-score quality with the chosen fade; require eof room when possible
    const qGo = leaveQualityReward({
      playedSec,
      fileDur,
      fadeSec,
      minPlay,
      deadline: mustLeaveBy(fileDur, fadeSec),
      phrase,
      style,
    });
    leaveScore += qGo.reward * 0.15;
    // If fade would overrun, shrink toward sweet spot that still fits
    if (fileDur - playedSec - fadeSec < 1) {
      fadeSec = clamp(fileDur - playedSec - 1, MIN_FADE_SEC, maxFadeForTrack(fileDur));
    }
    const bars = Math.max(1, Math.round(fadeSec / (4 * 60 / (track.bpm || 124))));
    let reason;
    if (crashing) {
      reason = `crash · ~${bars} bars`;
    } else if (rising && energyGap > 0.08) {
      reason = `novelty · ${fadeSec.toFixed(0)}s fade`;
    } else if (phrase.proximity > 0.5) {
      reason = `phrase · ${fadeSec.toFixed(0)}s → ${next?.title || 'next'}`;
    } else if (leaveScore >= style.leaveThresh) {
      reason = `GF · ${fadeSec.toFixed(0)}s blend`;
    } else {
      reason = `patience · ${fadeSec.toFixed(0)}s → ${next?.title || 'next'}`;
    }
    return {
      shouldTransition: true,
      fadeSec,
      nextTrack: next,
      reason,
      leaveScore,
      gateAllow: phrase.gateAllow,
    };
  }

  if (!phrase.gateAllow) {
    return {
      shouldTransition: false,
      fadeSec,
      nextTrack: next,
      reason: `phrase gate · Δ${phrase.distBeats.toFixed(1)} beats`,
      leaveScore,
      gateAllow: phrase.gateAllow,
    };
  }
  if (!pastCushion) {
    return {
      shouldTransition: false,
      fadeSec,
      nextTrack: next,
      reason: `edge · ${playedSec.toFixed(0)}s`,
      leaveScore,
      gateAllow: phrase.gateAllow,
    };
  }
  return {
    shouldTransition: false,
    fadeSec,
    nextTrack: next,
    reason: `hold · ${playedSec.toFixed(0)}s · ${leaveScore.toFixed(2)}/${style.leaveThresh}`,
    leaveScore,
    gateAllow: phrase.gateAllow,
  };
}

/**
 * Simulate one PLAYING→TRANSITION decision for building the show log.
 * Advances playedSec in MIND_TICK_SEC steps until leave.
 */
export function decideLeave(opts) {
  const fileDur = opts.track.durationSec ?? opts.track.durationHint ?? 120;
  const minPlay = minPlayForTrack(fileDur);
  let played = minPlay; // skip ticks before min play for speed
  // Still allow early must-leave on tiny files
  played = Math.min(played, mustLeaveBy(fileDur, MIN_FADE_SEC));

  let last = null;
  const maxIter = Math.ceil(fileDur / MIND_TICK_SEC) + 5;
  for (let i = 0; i < maxIter; i++) {
    last = mindTick({ ...opts, playedSec: played });
    if (last.shouldTransition) {
      return {
        playedSec: played,
        fadeSec: last.fadeSec,
        nextTrack: last.nextTrack,
        reason: last.reason,
        leaveScore: last.leaveScore,
      };
    }
    played += MIND_TICK_SEC;
    if (played > fileDur) {
      // Safety
      const fadeSec = Math.min(MAX_FADE_SEC, Math.max(MIN_FADE_SEC, fileDur * 0.2));
      return {
        playedSec: Math.max(minPlay, fileDur - fadeSec - 1),
        fadeSec,
        nextTrack: last?.nextTrack || opts.candidates?.[0],
        reason: `eof · ${fadeSec.toFixed(0)}s blend`,
        leaveScore: 1,
      };
    }
  }
  const fadeSec = last?.fadeSec || 16;
  return {
    playedSec: Math.max(minPlay, fileDur - fadeSec - 1),
    fadeSec,
    nextTrack: last?.nextTrack || opts.candidates?.[0],
    reason: last?.reason || 'eof blend',
    leaveScore: 1,
  };
}
