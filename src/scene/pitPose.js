export function pitCount({ innerWidth, coarse }) {
  const w = Number(innerWidth) || 0;
  if (coarse || w < 700) return 8;
  return 16;
}

export function pitSlot(i, n) {
  const cols = n <= 8 ? 4 : 8;
  const row = Math.floor(i / cols);
  const col = i % cols;
  const inRow = Math.min(cols, n - row * cols);
  const x = (col - (inRow - 1) / 2) * 0.55;
  const z = 1.15 + row * 0.55;
  return { x, z };
}

export function pitPhase(i) {
  return ((i * 2.399963) % (Math.PI * 2));
}

export function pitPose({ phi, bass, kick, dnL, dnR, gfHop }) {
  const b = Math.max(0, Number(bass) || 0);
  const k = Math.max(0, Number(kick) || 0);
  const lean = Math.tanh(((Number(dnR) || 0) - (Number(dnL) || 0)) / 12);
  const strideScale = 0.55 + b * 0.7 + k * 0.25;
  const wingAmp = 0.2 + b * 0.45 + k * 0.35;
  const hop = gfHop ? 0.35 + k * 0.15 : 0;
  void phi;
  return { strideScale, lean, wingAmp, hop };
}

export function pitHudLine({ n, motifStatus }) {
  const st = motifStatus === 'ok' || motifStatus === 'partial' ? 'motif ok' : 'motif: none';
  return `pit ${n} · ${st}`;
}
