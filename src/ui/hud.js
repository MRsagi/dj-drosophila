/**
 * Club / Brain / Hands-on-deck / Policy readouts.
 * Phosphor traces are voltages of the stub, not recorded cells.
 * Set-engine HUD: PLAYING A · 1:12 / 2:40 · TRANSITION 40% · edge indicator.
 */

import { listStyles } from '../policy/styles.js';

function drawTrace(canvas, hist, color) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#070a0e';
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  const n = hist.length;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - 4 - Math.max(0, Math.min(1.2, hist[i])) / 1.2 * (h - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(125,255,154,0.25)';
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(w, 6);
  ctx.stroke();
}

function fmt(n, d = 1) {
  return n.toFixed(d);
}

function setText(el, text) {
  if (el) el.textContent = text;
}

export function createHud() {
  const els = {
    fps: document.getElementById('fps'),
    club: document.getElementById('club-status'),
    livePill: document.getElementById('club-live-pill'),
    xfBar: document.getElementById('xf-bar'),
    xfRead: document.getElementById('xf-read'),
    volBar: document.getElementById('vol-bar'),
    volRead: document.getElementById('vol-read'),
    skip: document.getElementById('skip-read'),
    rateL: document.getElementById('rate-dnl'),
    rateR: document.getElementById('rate-dnr'),
    rateGf: document.getElementById('rate-gf'),
    mean: document.getElementById('mean-rate'),
    nameA: document.getElementById('name-a'),
    nameB: document.getElementById('name-b'),
    infoA: document.getElementById('info-a'),
    infoB: document.getElementById('info-b'),
    nameALab: document.getElementById('name-a-lab'),
    nameBLab: document.getElementById('name-b-lab'),
    infoALab: document.getElementById('info-a-lab'),
    infoBLab: document.getElementById('info-b-lab'),
    traceL: document.getElementById('trace-dnl'),
    traceR: document.getElementById('trace-dnr'),
    traceGf: document.getElementById('trace-gf'),
    styleSelect: document.getElementById('policy-style'),
    styleBlurb: document.getElementById('policy-blurb'),
    alpha: document.getElementById('policy-alpha'),
    alphaRead: document.getElementById('policy-alpha-read'),
    reason: document.getElementById('policy-reason'),
    clubReason: document.getElementById('club-policy-reason'),
    btnExport: document.getElementById('btn-export-log'),
    btnFit: document.getElementById('btn-fit-policy'),
    btnUnsup: document.getElementById('btn-train-unsup'),
    autoUnsup: document.getElementById('auto-refit-unsup'),
    trainStatus: document.getElementById('policy-train-status'),
    weightsStatus: document.getElementById('policy-weights-status'),
    unsupStatus: document.getElementById('policy-unsup-status'),
    logCount: document.getElementById('policy-log-count'),
    bpmRead: document.getElementById('policy-bpm'),
    gateRead: document.getElementById('policy-gate'),
    setStatus: document.getElementById('set-status'),
    nextTrack: document.getElementById('set-next'),
  };

  /** @type {(id: string) => void} */
  let styleCb = () => {};
  /** @type {(a: number) => void} */
  let alphaCb = () => {};
  let exportCb = () => {};
  let fitCb = () => {};
  let unsupCb = () => {};
  /** @type {(on: boolean) => void} */
  let autoUnsupCb = () => {};

  if (els.styleSelect) {
    if (!els.styleSelect.options.length) {
      for (const s of listStyles()) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label;
        els.styleSelect.appendChild(opt);
      }
    }
    els.styleSelect.addEventListener('change', () => styleCb(els.styleSelect.value));
  }
  if (els.alpha) {
    els.alpha.addEventListener('input', () => {
      const a = Number(els.alpha.value);
      if (els.alphaRead) els.alphaRead.textContent = a.toFixed(2);
      alphaCb(a);
    });
  }
  if (els.btnExport) els.btnExport.addEventListener('click', () => exportCb());
  if (els.btnFit) els.btnFit.addEventListener('click', () => fitCb());
  if (els.btnUnsup) els.btnUnsup.addEventListener('click', () => unsupCb());
  if (els.autoUnsup) {
    els.autoUnsup.addEventListener('change', () => autoUnsupCb(!!els.autoUnsup.checked));
  }

  return {
    els,
    onStyleChange(cb) { styleCb = cb; },
    onAlphaChange(cb) { alphaCb = cb; },
    onExportLog(cb) { exportCb = cb; },
    onFitPolicy(cb) { fitCb = cb; },
    onTrainUnsupervised(cb) { unsupCb = cb; },
    onAutoRefitUnsup(cb) { autoUnsupCb = cb; },
    setStyleBlurb(text) {
      setText(els.styleBlurb, text);
    },
    setTrainStatus(text) {
      setText(els.trainStatus, text);
    },
    setWeightsStatus(w) {
      if (!els.weightsStatus) return;
      if (!w) {
        els.weightsStatus.textContent = 'Supervised weights: heuristics only (optional secondary fit)';
      } else {
        els.weightsStatus.textContent = `Supervised: fitted ${w.fittedAt ?? '?'} · skip n=${w.nSkip ?? 0} · xf n=${w.nXfader ?? 0}`;
      }
    },
    setUnsupStatus(text) {
      setText(els.unsupStatus, text);
    },
    isAutoRefitUnsup() {
      return !!(els.autoUnsup && els.autoUnsup.checked);
    },
    initPolicyUi({ styleId, alpha, weights, logCount, unsupLine, autoRefit }) {
      if (els.styleSelect) els.styleSelect.value = styleId;
      if (els.alpha) {
        els.alpha.value = String(alpha);
        if (els.alphaRead) els.alphaRead.textContent = Number(alpha).toFixed(2);
      }
      const styles = listStyles();
      const cur = styles.find((s) => s.id === styleId) || styles[0];
      if (cur) this.setStyleBlurb(cur.blurb);
      this.setWeightsStatus(weights);
      if (unsupLine) this.setUnsupStatus(unsupLine);
      if (els.logCount) els.logCount.textContent = `${logCount} logged`;
      if (els.autoUnsup && autoRefit != null) els.autoUnsup.checked = !!autoRefit;
    },
    setDeckLabel(side, name, info) {
      if (side === 'A') {
        setText(els.nameA, name);
        setText(els.infoA, info);
        setText(els.nameALab, name);
        setText(els.infoALab, info);
      } else {
        setText(els.nameB, name);
        setText(els.infoB, info);
        setText(els.nameBLab, name);
        setText(els.infoBLab, info);
      }
    },
    update({
      fps,
      running,
      xfader,
      volume,
      usedFallback,
      dnL,
      dnR,
      gf,
      meanRate,
      skipEvent,
      now,
      lastSkipAt,
      lastSkipFrom,
      facets: _facets,
      policyReason,
      policyAlpha,
      styleId,
      skipScore,
      gateAllow,
      bpm,
      logCount,
      unsupLine,
      novelty,
      setState,
      setStatus,
      setTimeStr,
      setEdgeLabel,
      nextTitle,
      transitionProgress,
      fxIntensity,
      clubMode,
      sharedLive,
    }) {
      setText(els.fps, `${Math.round(fps)} FPS`);

      const edgeParked = Math.abs(Math.abs(xfader) - 1) < 0.08;
      const side = xfader < -0.85 ? 'EDGE A' : xfader > 0.85 ? 'EDGE B' : xfader < -0.15 ? 'A heavy' : xfader > 0.15 ? 'B heavy' : 'blend';

      let status;
      if (!running) {
        status = 'Eyes dark. Circuit gated. Enter the club.';
      } else if (policyReason) {
        status = policyReason;
      } else if (sharedLive) {
        status = 'Shared live — the fly’s set.';
      } else {
        status = `Live mix · ${side}`;
      }
      setText(els.club, status);

      if (els.setStatus) {
        setText(
          els.setStatus,
          running
            ? `${setStatus || setState || '—'} · ${setEdgeLabel || side}`
            : 'set engine idle',
        );
      }
      if (els.nextTrack) {
        if (setState === 'TRANSITION') {
          setText(
            els.nextTrack,
            `Blending ${Math.round((transitionProgress || 0) * 100)}%${nextTitle ? ` → ${nextTitle}` : ''}`,
          );
        } else {
          setText(els.nextTrack, nextTitle ? `Next: ${nextTitle}` : 'Next: —');
        }
      }

      if (els.livePill) {
        let pill;
        if (sharedLive) {
          pill = !running
            ? 'LIVE · SHARED STREAM'
            : setState === 'TRANSITION'
              ? 'LIVE · TRANSITION'
              : 'LIVE · SHARED STREAM';
        } else if (!running) {
          pill = 'circuit gated';
        } else if (setState === 'TRANSITION') {
          pill = 'TRANSITION';
        } else if (setState === 'PLAYING') {
          pill = 'PLAYING · edge-lock';
        } else {
          pill = 'LOCAL LAB MIX';
        }
        els.livePill.textContent = pill;
        els.livePill.classList.toggle('on', !!running || !!sharedLive);
        els.livePill.classList.toggle('shared', !!sharedLive);
      }

      if (els.xfBar) {
        const xPct = ((xfader + 1) * 0.5) * 86;
        els.xfBar.style.left = `${xPct}%`;
      }

      const fxStr = fxIntensity != null ? ` · fx ${fmt(fxIntensity, 2)}` : '';
      if (clubMode || setState) {
        setText(
          els.xfRead,
          edgeParked
            ? `xf ${fmt(xfader, 2)} · ${setEdgeLabel || side} locked${fxStr}`
            : `xf ${fmt(xfader, 2)} · ${setState === 'TRANSITION' ? `TRANSITION ${Math.round((transitionProgress || 0) * 100)}%` : side}${fxStr}`,
        );
      } else {
        const aStr = policyAlpha != null ? ` · α ${fmt(policyAlpha, 2)}` : '';
        setText(
          els.xfRead,
          usedFallback
            ? `xf ${fmt(xfader, 2)} · eye-asymmetry fallback${aStr}`
            : `xf ${fmt(xfader, 2)} · set-engine / policy${aStr}`,
        );
      }

      if (els.volBar) {
        els.volBar.style.width = `${Math.round(volume * 100)}%`;
        els.volBar.style.left = '0';
      }
      setText(els.volRead, `${fmt(volume * 100, 0)}% · mean DN ${fmt(meanRate)} Hz`);

      const firedAgo = now - lastSkipAt;
      if (skipEvent || firedAgo < 0.8) {
        setText(els.skip, `SKIP · dumped ${lastSkipFrom} · comic sweep`);
        document.body.classList.add('skip-flash');
      } else {
        const novStr = novelty != null ? ` · nov ${fmt(novelty, 2)}` : '';
        if (setState === 'PLAYING') {
          setText(
            els.skip,
            `long play · ${setTimeStr || '—'} · gate ${gateAllow ? 'OPEN' : 'shut'} · score ${fmt(skipScore ?? 0, 2)}${novStr}`,
          );
        } else {
          setText(
            els.skip,
            gateAllow
              ? `GF idle · gate open · score ${fmt(skipScore ?? 0, 2)}${novStr}`
              : `GF idle · gate closed · score ${fmt(skipScore ?? 0, 2)}${novStr}`,
          );
        }
        document.body.classList.remove('skip-flash');
      }

      setText(els.rateL, `${fmt(dnL.rate)} Hz`);
      setText(els.rateR, `${fmt(dnR.rate)} Hz`);
      setText(els.rateGf, `${fmt(gf.rate)} Hz`);
      setText(els.mean, `${fmt(meanRate)} Hz`);

      setText(els.reason, policyReason || '—');
      if (els.clubReason) {
        // Club lede already shows the mind reason — this line is the motor readout.
        const loc = `DN-L ${fmt(dnL?.rate ?? 0)} Hz · DN-R ${fmt(dnR?.rate ?? 0)} Hz · GF ${fmt(gf?.rate ?? 0)} Hz · toy CPG`;
        setText(els.clubReason, loc);
      }
      if (els.bpmRead && bpm != null) els.bpmRead.textContent = `${fmt(bpm, 0)} BPM`;
      if (els.gateRead) {
        els.gateRead.textContent = gateAllow ? 'phrase gate OPEN' : 'phrase gate shut';
      }
      if (els.logCount && logCount != null) els.logCount.textContent = `${logCount} logged`;
      if (unsupLine && els.unsupStatus) els.unsupStatus.textContent = unsupLine;
      void styleId;
    },
    traces(history) {
      drawTrace(els.traceL, history.dnL, '#ff4d8d');
      drawTrace(els.traceR, history.dnR, '#3ee0d0');
      drawTrace(els.traceGf, history.gf, '#e0b44a');
    },
  };
}
