import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pitCount, pitSlot, pitPhase, pitPose, pitHudLine } from './pitPose.js';

describe('pitPose', () => {
  it('uses 16 on wide fine pointer and 8 on phone', () => {
    assert.equal(pitCount({ innerWidth: 1200, coarse: false }), 16);
    assert.equal(pitCount({ innerWidth: 390, coarse: true }), 8);
    assert.equal(pitCount({ innerWidth: 800, coarse: true }), 8);
  });

  it('places n flies in two rows, all in front of the booth (z > DJ)', () => {
    const n = 16;
    const slots = [...Array(n).keys()].map((i) => pitSlot(i, n));
    assert.equal(slots.length, n);
    for (const s of slots) {
      assert.ok(s.z > 0.6, `z ${s.z}`);
      assert.ok(Math.abs(s.x) < 3.2);
    }
  });

  it('phases are distinct in [0, 2π)', () => {
    const a = pitPhase(0);
    const b = pitPhase(1);
    assert.ok(a >= 0 && a < Math.PI * 2);
    assert.ok(Math.abs(a - b) > 0.2);
  });

  it('lean follows dnR - dnL; hop only when gfHop', () => {
    const left = pitPose({ phi: 0, bass: 0.2, kick: 0, dnL: 30, dnR: 2, gfHop: false });
    const right = pitPose({ phi: 0, bass: 0.2, kick: 0, dnL: 2, dnR: 30, gfHop: false });
    assert.ok(left.lean < 0);
    assert.ok(right.lean > 0);
    assert.equal(left.hop, 0);
    const hop = pitPose({ phi: 0, bass: 0.2, kick: 0, dnL: 10, dnR: 10, gfHop: true });
    assert.ok(hop.hop > 0.2);
  });

  it('bass raises stride; HUD line is dry', () => {
    const quiet = pitPose({ phi: 0, bass: 0, kick: 0, dnL: 0, dnR: 0, gfHop: false });
    const loud = pitPose({ phi: 0, bass: 1, kick: 0.5, dnL: 0, dnR: 0, gfHop: false });
    assert.ok(loud.strideScale > quiet.strideScale);
    assert.equal(pitHudLine({ n: 16, motifStatus: 'ok' }), 'pit 16 · motif ok');
    assert.equal(pitHudLine({ n: 8, motifStatus: 'none' }), 'pit 8 · motif: none');
  });
});
