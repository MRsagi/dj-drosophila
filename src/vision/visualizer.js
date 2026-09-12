/**
 * Dual-eye canvas: left = A, right = B.
 * Bass = thick slow bars. Hi = thin fast needles. Kick = strobe.
 * Center stripe = crossfader. ~30–60 FPS.
 *
 * Facet count is a budget (see eyeMap.js). Not 1771 ommatidia.
 */

function hexPath(r) {
  const p = new Path2D();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

function packEye(cx, cy, rx, ry, hexR) {
  const pts = [];
  const w = hexR * Math.sqrt(3);
  const h = hexR * 1.5;
  const rows = Math.ceil((ry * 2) / h) + 2;
  const cols = Math.ceil((rx * 2) / w) + 2;
  for (let row = -rows; row <= rows; row++) {
    const ox = (row & 1) * (w * 0.5);
    for (let col = -cols; col <= cols; col++) {
      const x = cx + col * w + ox;
      const y = cy + row * h;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        pts.push({ x, y, u: (x - cx) / rx, v: (y - cy) / ry });
      }
    }
  }
  return pts;
}

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function createVisualizer(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let facetsL = [];
  let facetsR = [];
  let hex = hexPath(6);
  let hexR = 6;
  let layout = null;
  let strobe = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.floor(rect.width || canvas.clientWidth || 0);
    if (cssW < 40) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cssW;
    const h = Math.max(120, Math.round(w * 0.5));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cxL = w * 0.28;
    const cxR = w * 0.72;
    const cy = h * 0.52;
    const rx = w * 0.2;
    const ry = h * 0.38;
    hexR = Math.max(5.2, Math.min(8.2, rx / 22));
    hex = hexPath(hexR * 0.96);
    facetsL = packEye(cxL, cy, rx, ry, hexR);
    facetsR = packEye(cxR, cy, rx, ry, hexR);
    layout = { w, h, cxL, cxR, cy, rx, ry };
  }

  function drawBars(side, eye, feat, color) {
    const { w, h, cxL, cxR, rx } = layout;
    const cx = side === 'L' ? cxL : cxR;
    const nBass = 14;
    const nHi = 36;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < nBass; i++) {
      const u = i / (nBass - 1);
      const idx = Math.floor(u * (eye.n - 1));
      const amp = eye.bassField[idx];
      const bw = (rx * 2) / nBass * 0.72;
      const x = cx - rx + u * rx * 2;
      const bh = amp * h * 0.42;
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.1 + amp * 0.28})`;
      ctx.fillRect(x - bw / 2, h * 0.82 - bh, bw, bh);
    }

    for (let i = 0; i < nHi; i++) {
      const u = i / (nHi - 1);
      const idx = Math.floor(u * (eye.n - 1));
      const amp = eye.hiField[idx];
      const x = cx - rx + u * rx * 2;
      const bh = amp * h * 0.34;
      ctx.fillStyle = `rgba(255,245,220,${0.08 + amp * 0.45})`;
      ctx.fillRect(x - 0.7, h * 0.8 - bh, 1.4, bh);
    }
    ctx.restore();
  }

  function drawFacets(facets, eye, base, kick) {
    const n = eye.n;
    const pupU = (eye.centroid - 0.5) * 0.7;
    const pupV = -0.08;
    for (let i = 0; i < facets.length; i++) {
      const f = facets[i];
      const col = Math.max(0, Math.min(n - 1, Math.floor(((f.u + 1) * 0.5) * (n - 1))));
      const lum = eye.r16[col];
      const chroma = eye.r8[col];
      const warm = lerpColor(base, [255, 230, 140], chroma);
      const c = lerpColor([18, 14, 20], warm, Math.min(1, 0.2 + lum * 0.85));
      const dPup = Math.hypot(f.u - pupU, f.v - pupV);
      const pup = Math.max(0, 1 - dPup / 0.42);
      const k = Math.min(1, kick + strobe);
      const r = Math.min(255, c[0] * (1 - pup * 0.55) + 255 * k * 0.35);
      const g = Math.min(255, c[1] * (1 - pup * 0.55) + 230 * k * 0.28);
      const b = Math.min(255, c[2] * (1 - pup * 0.4) + 180 * k * 0.2);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fill(hex);
      ctx.restore();
    }
  }

  function drawXfade(xfader) {
    const { w, h } = layout;
    const x = w * 0.5 + xfader * w * 0.08;
    const grd = ctx.createLinearGradient(w * 0.5 - 18, 0, w * 0.5 + 18, 0);
    grd.addColorStop(0, 'rgba(255,77,141,0.55)');
    grd.addColorStop(0.5, 'rgba(224,180,74,0.9)');
    grd.addColorStop(1, 'rgba(62,224,208,0.55)');
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fillRect(w * 0.5 - 16, 18, 32, h - 36);
    ctx.fillStyle = grd;
    ctx.fillRect(x - 4, 22, 8, h - 44);
    ctx.fillStyle = '#ece6d8';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('XF', w * 0.5, 16);
  }

  function frame({ left, right, featA, featB, xfader, running }) {
    if (!layout) resize();
    if (!layout) return;
    const { w, h, cxL, cxR, cy } = layout;
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b0d12');
    bg.addColorStop(1, '#07080b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    strobe = Math.max(featA.kick, featB.kick, strobe * 0.72);

    drawBars('L', left, featA, [255, 77, 141]);
    drawBars('R', right, featB, [62, 224, 208]);
    drawFacets(facetsL, left, [255, 77, 141], featA.kick);
    drawFacets(facetsR, right, [62, 224, 208], featB.kick);
    drawXfade(xfader);

    ctx.fillStyle = '#8d8678';
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEFT EYE · A  ·  R1–R6 lum / R8 color (approx)', cxL, 22);
    ctx.fillText('RIGHT EYE · B  ·  same caveat', cxR, 22);
    ctx.fillStyle = running ? '#7dff9a' : '#8d8678';
    ctx.fillText(running ? 'closed loop (toy)' : 'gated', w * 0.5, h - 10);

    // Soft vignette
    const vg = ctx.createRadialGradient(w / 2, cy, h * 0.2, w / 2, cy, w * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }

  return {
    resize,
    frame,
    facetCounts() {
      return { left: facetsL.length, right: facetsR.length };
    },
  };
}
