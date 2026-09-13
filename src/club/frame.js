/**
 * Club frame — one tick: eyes, LIF toys, fly body, booth FX readout.
 * Audio is the shared HLS tap. The encoder stays dry.
 */

import { formatFilterRead } from '../audio/boothFx.js';
import { flyFxFromCircuit } from '../brain/fxMapping.js';
import { updateEye } from '../vision/eyeMap.js';
import { sensorCurrents } from '../brain/mapping.js';

function emptyFeat() {
  return {
    bass: 0,
    lowMid: 0,
    mid: 0,
    hi: 0,
    rms: 0,
    flux: 0,
    kick: 0,
    spectralCentroid: 0.35,
    freq: new Uint8Array(512),
    time: new Uint8Array(1024),
  };
}

function scaleFeat(feat, gain) {
  const g = Math.max(0, gain);
  return {
    ...feat,
    bass: feat.bass * g,
    lowMid: feat.lowMid * g,
    mid: feat.mid * g,
    hi: feat.hi * g,
    rms: feat.rms * g,
    flux: feat.flux * g,
    kick: feat.kick * g,
  };
}

function mountBoothReadout() {
  const flyReason = document.getElementById('fx-fly-reason');
  const filterRead = document.getElementById('fx-filter-read');
  const echoRead = document.getElementById('fx-echo-read');
  const pitchRead = document.getElementById('fx-pitch-read');
  const loopRead = document.getElementById('fx-loop-read');
  const filterBar = document.getElementById('fx-filter-bar');
  const echoBar = document.getElementById('fx-echo-bar');
  const pitchBar = document.getElementById('fx-pitch-bar');
  const loopBar = document.getElementById('fx-loop-bar');
  const root = document.getElementById('booth-fx');
  if (!root) return { applyFly() {} };

  let flyLoopUntil = 0;
  let loopCooldownUntil = 0;
  let lastLoopBeats = 1;
  let slew = { filter: 0, echo: 0, pitch: 1 };
  let lastSentPitch = 1;
  const SLEW = 0.045;
  const PITCH_DEADBAND = 0.005;
  const LOOP_COOLDOWN_SEC = 16;

  function setBar(el, t01, widthPct) {
    if (!el) return;
    const x = Math.max(0, Math.min(1, t01));
    const w = widthPct ?? 14;
    el.style.width = `${w}%`;
    el.style.left = `${x * (100 - w)}%`;
  }

  function loopLabel(beats, on) {
    if (!on) return 'off';
    if (beats === 0.25) return '¼ beat';
    if (beats === 0.5) return '½ beat';
    if (beats === 1) return '1 beat';
    if (beats === 2) return '2 beats';
    if (beats === 4) return '1 bar';
    return `${beats} beats`;
  }

  function paint(drive, looping, bpm, booth) {
    const filter = drive?.filter ?? 0;
    const echo = drive?.echo ?? 0;
    const pitch = drive?.pitch ?? 1;
    if (filterRead) filterRead.textContent = formatFilterRead(filter, booth?.filterHz());
    if (echoRead) echoRead.textContent = echo < 0.02 ? 'dry' : `${Math.round(echo * 100)}%`;
    if (pitchRead) {
      const shown = Math.round((bpm || 124) * pitch);
      const pct = ((pitch - 1) * 100).toFixed(1);
      const sign = pitch >= 1 ? '+' : '';
      pitchRead.textContent = `${shown} BPM ${sign}${pct}%`;
    }
    if (loopRead) loopRead.textContent = loopLabel(lastLoopBeats, looping);
    setBar(filterBar, (filter + 1) * 0.5);
    setBar(echoBar, echo, 12);
    setBar(pitchBar, (pitch - 0.92) / 0.16);
    setBar(loopBar, looping ? 1 : 0, looping ? 18 : 10);
    root.classList.toggle('looping', !!looping);
  }

  function applyFly(drive, now, { bpm, booth, setPitch }) {
    if (!drive) {
      paint(null, false, bpm, booth);
      return;
    }
    slew.filter += (drive.filter - slew.filter) * SLEW;
    slew.echo += (drive.echo - slew.echo) * SLEW;
    slew.pitch += (drive.pitch - slew.pitch) * SLEW;

    const wasLooping = now < flyLoopUntil;
    if (drive.loop && !wasLooping && now >= loopCooldownUntil) {
      flyLoopUntil = now + Math.max(0.2, drive.loopHold || 0);
      lastLoopBeats = drive.loopBeats || lastLoopBeats;
    }
    const wantLoop = now < flyLoopUntil;
    if (wasLooping && !wantLoop) {
      loopCooldownUntil = now + LOOP_COOLDOWN_SEC;
    }

    const smoothed = { ...drive, filter: slew.filter, echo: slew.echo, pitch: slew.pitch };
    if (booth) {
      booth.setBpm(bpm);
      booth.applyFilter(smoothed.filter);
      booth.applyEcho(smoothed.echo);
      if (wantLoop) {
        if (!booth.looping) {
          booth.setLoopBeats(lastLoopBeats);
          booth.setLooping(true);
        }
      } else if (booth.looping) {
        booth.setLooping(false);
      }
    }
    if (Math.abs(slew.pitch - lastSentPitch) >= PITCH_DEADBAND) {
      setPitch?.(slew.pitch);
      lastSentPitch = slew.pitch;
    }
    if (flyReason) flyReason.textContent = `${drive.reason}${wantLoop ? ' · LOOP' : ''}`;
    paint(smoothed, wantLoop, bpm, booth);
  }

  paint(null, false, 124, null);
  return { applyFly };
}

/**
 * @param {{
 *   circuit: ReturnType<import('../brain/circuit.js').createCircuit>,
 *   viz: ReturnType<import('../vision/visualizer.js').createVisualizer>,
 *   left: object,
 *   right: object,
 *   hud: ReturnType<import('../ui/hud.js').createHud>,
 *   getFly: () => object|null,
 *   liveClient: object,
 * }} opts
 */
export function createClubFrame(opts) {
  const { circuit, viz, left, right, hud, getFly, liveClient } = opts;
  const boothHud = mountBoothReadout();
  let lastEnergy = 0;
  let simCarry = 0;
  let lastTs = 0;
  let frames = 0;
  let fpsT = 0;
  let fps = 0;

  function tick(ts, { running }) {
    frames += 1;
    if (ts - fpsT > 500) {
      fps = (frames * 1000) / (ts - fpsT);
      frames = 0;
      fpsT = ts;
    }
    const now = ts / 1000;
    const frameDt = Math.min(0.05, Math.max(0.008, lastTs ? (ts - lastTs) / 1000 : 1 / 60));
    lastTs = ts;

    const snap = liveClient.setSnapshot();
    const xf = snap?.xfader ?? snap?.xfaderEdge ?? 0;
    const featM = liveClient.readFeat() || emptyFeat();
    const bpmNow = liveClient.state?.trackA?.bpm || liveClient.state?.trackB?.bpm || 124;
    liveClient.booth?.setBpm(bpmNow);

    const wA = xf <= 0 ? 1 : Math.max(0.22, 1 - xf);
    const wB = xf >= 0 ? 1 : Math.max(0.22, 1 + xf);
    const featA = scaleFeat(featM, wA);
    const featB = scaleFeat(featM, wB);
    updateEye(left, featA);
    updateEye(right, featB);

    const currents = sensorCurrents({ left, right, featA, featB, featM }, now, lastEnergy);
    lastEnergy = currents.energy;
    const dt = 0.001;
    let lifSnap = {
      dnL: circuit.dnL,
      dnR: circuit.dnR,
      gf: circuit.gf,
      meanRate: 0.5 * (circuit.dnL.rate + circuit.dnR.rate),
      gfFired: false,
    };
    let gfFiredThisFrame = false;
    simCarry += frameDt;
    while (simCarry >= dt) {
      lifSnap = circuit.step(dt, currents);
      simCarry -= dt;
      if (lifSnap.gfFired) gfFiredThisFrame = true;
    }

    viz.frame({ left, right, featA, featB, xfader: xf, running: true });
    const fly = getFly?.();
    if (fly) {
      fly.update({
        xfader: xf,
        volume: 0.72,
        bass: featM.bass,
        mid: featM.mid,
        hi: featM.hi,
        kick: featM.kick,
        skipEvent: null,
        now,
        dt: frameDt,
        running: true,
        setState: snap?.state,
        activeEdge: snap?.activeEdge,
        dnLRate: circuit.dnL.rate,
        dnRRate: circuit.dnR.rate,
        gfRate: circuit.gf.rate,
        gfFired: gfFiredThisFrame,
        bpm: bpmNow,
      });
      fly.render();
    }

    boothHud.applyFly(
      flyFxFromCircuit({
        dnLRate: circuit.dnL.rate,
        dnRRate: circuit.dnR.rate,
        gfRate: circuit.gf.rate,
        gfFired: gfFiredThisFrame,
        bass: featM.bass,
        hi: featM.hi,
        kick: featM.kick,
        setState: snap?.state,
        transitionProgress: snap?.transitionProgress,
        bpm: bpmNow,
      }),
      now,
      {
        bpm: bpmNow,
        booth: liveClient.booth,
        setPitch: (p) => liveClient.setPitch?.(p),
      },
    );

    hud.update({
      fps,
      running: true,
      xfader: xf,
      volume: 0.72,
      usedFallback: false,
      dnL: circuit.dnL,
      dnR: circuit.dnR,
      gf: circuit.gf,
      meanRate: lifSnap.meanRate,
      skipEvent: null,
      now,
      lastSkipAt: -10,
      lastSkipFrom: 'A',
      facets: viz.facetCounts(),
      policyReason: snap?.mindReason || 'Live.',
      policyAlpha: 1,
      styleId: 'psy-peak',
      skipScore: 0,
      gateAllow: true,
      bpm: bpmNow,
      logCount: 0,
      unsupLine: '',
      novelty: null,
      setState: snap?.state,
      setStatus: snap?.statusLine,
      setTimeStr: snap?.timeStr,
      setEdgeLabel: snap?.edgeLabel,
      nextTitle: snap?.nextTitle,
      transitionProgress: snap?.transitionProgress,
      clubMode: true,
      sharedLive: true,
    });
    hud.traces(circuit.history);
    void running;
  }

  return { tick };
}
