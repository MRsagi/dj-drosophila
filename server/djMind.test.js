import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mustLeaveBy,
  minPlayForTrack,
  maxFadeForTrack,
  leaveQualityReward,
  chooseFadeSec,
  MIN_PLAY_SEC,
  MIN_FADE_SEC,
} from './djMind.js';

describe('leave mind', () => {
  it('mustLeaveBy leaves room for the fade before EOF', () => {
    const fade = 16;
    const deadline = mustLeaveBy(120, fade);
    assert.ok(deadline <= 120 - fade - 1);
    assert.ok(deadline >= minPlayForTrack(120));
  });

  it('short files still get a min play and a fade', () => {
    const dur = 40;
    assert.ok(minPlayForTrack(dur) < dur);
    assert.ok(maxFadeForTrack(dur) >= MIN_FADE_SEC);
    assert.ok(mustLeaveBy(dur, MIN_FADE_SEC) < dur);
  });

  it('penalizes playing to EOF and rewards phrase-aligned leave', () => {
    const eof = leaveQualityReward({
      playedSec: 119,
      fileDur: 120,
      fadeSec: 16,
      phrase: { gateAllow: false, proximity: 0 },
    });
    const good = leaveQualityReward({
      playedSec: 55,
      fileDur: 120,
      fadeSec: 16,
      phrase: { gateAllow: true, proximity: 1 },
    });
    assert.ok(eof.reward < 0);
    assert.ok(good.reward > eof.reward);
    assert.ok(good.notes.includes('phrase-aligned'));
  });

  it('chooseFadeSec stays in 8–32s and respects file room', () => {
    const fade = chooseFadeSec({
      style: { blendSpeed: 0.4, skipAggression: 0.2 },
      track: { energy: 0.7, bpm: 128 },
      next: { energy: 0.6, bpm: 124 },
      fileDur: 90,
      rng: () => 0.5,
    });
    assert.ok(fade >= MIN_FADE_SEC);
    assert.ok(fade <= maxFadeForTrack(90));
    void MIN_PLAY_SEC;
  });
});
