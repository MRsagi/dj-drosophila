import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMotif } from './motif.js';

const fixture = {
  dataset: 'male-cns:v1.0',
  fetchedAt: '2026-09-14T00:00:00Z',
  misses: [],
  cells: [
    { bodyId: 1, type: 'DNa02', instance: 'DNa02_L', role: 'dnL' },
    { bodyId: 2, type: 'DNa02', instance: 'DNa02_R', role: 'dnR' },
    { bodyId: 3, type: 'DNp01', instance: 'GF', role: 'gf' },
  ],
  edges: [
    { pre: 1, post: 3, w: 10 },
    { pre: 2, post: 3, w: 10 },
  ],
};

describe('motif step', () => {
  it('status none when graph is null', () => {
    const m = createMotif(null);
    const out = m.step({ state: 'PLAYING', xfaderEdge: -1, playedSec: 10, plannedSec: 40, transitionProgress: null });
    assert.equal(out.status, 'none');
    assert.equal(out.cells.length, 0);
  });

  it('PLAYING A drives dnL more than dnR', () => {
    const m = createMotif(fixture);
    let out;
    for (let i = 0; i < 8; i++) {
      out = m.step({ state: 'PLAYING', xfaderEdge: -1, playedSec: 20, plannedSec: 40, transitionProgress: null });
    }
    const dnL = out.cells.find((c) => c.role === 'dnL').rate;
    const dnR = out.cells.find((c) => c.role === 'dnR').rate;
    assert.ok(dnL > dnR + 2, `dnL ${dnL} dnR ${dnR}`);
    assert.equal(out.status, 'ok');
  });

  it('TRANSITION midpoint drives gf', () => {
    const m = createMotif(fixture);
    let out;
    for (let i = 0; i < 8; i++) {
      out = m.step({ state: 'TRANSITION', xfaderEdge: 0, playedSec: 0, plannedSec: 16, transitionProgress: 0.5 });
    }
    const gf = out.cells.find((c) => c.role === 'gf').rate;
    assert.ok(gf > 5, `gf ${gf}`);
  });

  it('partial when misses nonempty', () => {
    const m = createMotif({ ...fixture, misses: ['DNa02'] });
    const out = m.step({ state: 'PLAYING', xfaderEdge: -1, playedSec: 10, plannedSec: 40, transitionProgress: null });
    assert.equal(out.status, 'partial');
  });
});
