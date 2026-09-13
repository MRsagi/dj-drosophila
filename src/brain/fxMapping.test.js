import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flyFxFromCircuit } from './fxMapping.js';

describe('fly FX from toy DNs', () => {
  it('maps DN-R > DN-L toward lowpass (B-side / ipsilateral-right gag)', () => {
    const d = flyFxFromCircuit({ dnLRate: 4, dnRRate: 22, bass: 0.2, hi: 0.2 });
    assert.ok(d.filter > 0.3, `filter ${d.filter}`);
    assert.match(d.reason, /^FLY ·/);
  });

  it('maps DN-L > DN-R toward highpass', () => {
    const d = flyFxFromCircuit({ dnLRate: 22, dnRRate: 4, bass: 0.2, hi: 0.2 });
    assert.ok(d.filter < -0.3, `filter ${d.filter}`);
  });

  it('raises pitch when both DNs are hot (locomotor vigor analog)', () => {
    const quiet = flyFxFromCircuit({ dnLRate: 3, dnRRate: 3 });
    const hot = flyFxFromCircuit({ dnLRate: 28, dnRRate: 28 });
    assert.ok(hot.pitch > quiet.pitch);
    assert.ok(hot.pitch <= 1.08);
  });

  it('stutters a short loop on a strong GF fire, not on every blend kick', () => {
    const d = flyFxFromCircuit({ gfFired: true, kick: 0.7, bpm: 120 });
    assert.equal(d.loop, true);
    assert.equal(d.loopBeats, 0.5);
    assert.ok(d.loopHold > 0);
    const kickOnly = flyFxFromCircuit({
      setState: 'TRANSITION',
      transitionProgress: 0.5,
      kick: 0.3,
      gfFired: false,
    });
    assert.equal(kickOnly.loop, false);
  });

  it('smears echo during TRANSITION (sine-song analog)', () => {
    const play = flyFxFromCircuit({ setState: 'PLAYING', gfRate: 0, hi: 0 });
    const blend = flyFxFromCircuit({
      setState: 'TRANSITION',
      transitionProgress: 0.5,
      gfRate: 0,
      hi: 0,
    });
    assert.ok(blend.echo > play.echo + 0.3);
  });
});
