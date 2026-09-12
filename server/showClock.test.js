import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { publicSnapshot, encoderView } from './showClock.js';

const raw = {
  serverTime: 1,
  showStart: 0,
  seed: 'x',
  styleId: 'psy-peak',
  state: 'PLAYING',
  activeDeck: 'A',
  quietDeck: 'B',
  trackA: { title: 'Drive' },
  trackB: { title: 'Takeover' },
  xfaderEdge: -1,
  playedSec: 12,
  plannedSec: 60,
  nextTrack: { title: 'Takeover' },
  transitionProgress: null,
  transitionSec: 16,
  mindReason: 'phrase boundary',
  statusLine: 'PLAYING A · 0:12 / 1:00',
  timeStr: '0:12 / 1:00',
  edgeLabel: 'EDGE A (−1)',
  streamUrl: '/hls/live.m3u8',
  _remainingPlay: 48,
  _trackPath: '/crate/secret.mp3',
  _leaveAtSec: 60,
};

describe('show clock', () => {
  it('exposes HUD fields and strips encoder paths', () => {
    const pub = publicSnapshot(raw);
    assert.equal(pub.state, 'PLAYING');
    assert.equal(pub.xfaderEdge, -1);
    assert.equal(pub.trackA.title, 'Drive');
    assert.equal(pub._trackPath, undefined);
    assert.equal(pub._remainingPlay, undefined);
    assert.equal(pub._leaveAtSec, undefined);
  });

  it('keeps remaining play on the encoder view only', () => {
    const enc = encoderView(raw);
    assert.equal(enc.remainingPlay, 48);
    assert.equal(enc.state, 'PLAYING');
    assert.equal(enc._trackPath, undefined);
  });
});
