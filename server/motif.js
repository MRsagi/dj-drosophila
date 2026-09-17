const ALPHA = 0.2;
const RATE_SCALE = 40;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function externalCurrents(show) {
  const I = { dnL: 0, dnR: 0, gf: 0 };
  const planned = Math.max(1, Number(show.plannedSec) || 1);
  const frac = clamp((Number(show.playedSec) || 0) / planned, 0.2, 1);
  const xf = Number(show.xfaderEdge);
  const x = Number.isFinite(xf) ? xf : -1;
  if (show.state === 'PLAYING') {
    if (x < 0) I.dnL = frac;
    else I.dnR = frac;
  } else if (show.state === 'TRANSITION') {
    I.dnL = 0.5 * (1 - x);
    I.dnR = 0.5 * (1 + x);
    const p = clamp(Number(show.transitionProgress) || 0, 0, 1);
    I.gf = Math.sin(Math.PI * p);
  }
  return I;
}

export function createMotif(graph) {
  if (!graph || !Array.isArray(graph.cells) || graph.cells.length === 0) {
    const empty = { dataset: graph?.dataset || 'male-cns:v1.0', status: 'none', cells: [] };
    return { step() { return empty; }, snapshot() { return empty; } };
  }
  const cells = graph.cells.map((c) => ({ ...c, v: 0, rate: 0 }));
  const byId = new Map(cells.map((c) => [c.bodyId, c]));
  const maxW = Math.max(1, ...((graph.edges || []).map((e) => Number(e.w) || 0)));
  const edges = (graph.edges || []).map((e) => ({
    pre: e.pre,
    post: e.post,
    wn: (Number(e.w) || 0) / maxW,
  }));
  const status = Array.isArray(graph.misses) && graph.misses.length ? 'partial' : 'ok';
  const dataset = graph.dataset || 'male-cns:v1.0';

  function publicCells() {
    return cells.map((c) => ({
      bodyId: c.bodyId,
      type: c.type,
      instance: c.instance || '',
      role: c.role,
      rate: c.rate,
    }));
  }

  function step(show) {
    const Iext = externalCurrents(show);
    const syn = new Map(cells.map((c) => [c.bodyId, 0]));
    for (const e of edges) {
      const pre = byId.get(e.pre);
      if (!pre) continue;
      syn.set(e.post, (syn.get(e.post) || 0) + e.wn * (pre.v || 0));
    }
    for (const c of cells) {
      const ext = Iext[c.role] || 0;
      const isyn = syn.get(c.bodyId) || 0;
      c.v = (1 - ALPHA) * c.v + ALPHA * (isyn + ext);
      c.rate = RATE_SCALE * Math.max(0, c.v);
    }
    return { dataset, status, cells: publicCells() };
  }

  return {
    step,
    snapshot() {
      return { dataset, status, cells: publicCells() };
    },
  };
}
