/**
 * DJ Drosophila — public club + lab wiring.
 * Song visualizer → fly eyes → LIF stub → owned DJ policy → setEngine → mixer → Web Audio + 3D Fly DJ.
 *
 * Public #club: setEngine is primary — long plays, edge-locked xfader, FX during PLAYING,
 * phrase-aligned TRANSITION. Continuous LIF/policy xfader blend is KILLED in club mode.
 */

import { createMixer } from './audio/mixer.js';
import { createFxBus } from './audio/fxBus.js';
import { createDemoSynths, decodeFile, playBuffer } from './demo/synthTracks.js';
import { createEye, updateEye, TARGET_COLUMNS, TODO_COLUMNS } from './vision/eyeMap.js';
import { createVisualizer } from './vision/visualizer.js';
import { createCircuit } from './brain/circuit.js';
import { sensorCurrents, ratesToMixer } from './brain/mapping.js';
import { createHud } from './ui/hud.js';
import { mountCaptions } from './ui/captions.js';
import { mountRouter, setLabEnabled, isLabEnabled } from './ui/router.js';
import { createFeatureTracker } from './policy/features.js';
import { decide } from './policy/policy.js';
import { getStyle, DEFAULT_STYLE_ID } from './policy/styles.js';
import { logDecision, downloadJSONL, logCount, getLog } from './policy/logger.js';
import {
  fitFromLocalStorage,
  loadWeights,
  saveWeights,
  trainUnsupervised,
  loadUnsupervisedModel,
  seedUnsupervisedIfEmpty,
  unsupervisedStatus,
  installBundledUnsupervised,
} from './policy/train.js';
import bundledUnsup from './models/unsupervised-v1.json';
import bundledWeights from './models/policy-weights-v1.json';
import {
  createCrateEngine,
  activeTracks,
  preferredTracks,
  attributionLines,
} from './crate/cratePlayer.js';
import { createSetEngine } from './dj/setEngine.js';
import {
  liveQueryFlag,
  probeLiveServer,
  createLiveClient,
} from './live/liveClient.js';

const left = createEye('L', TARGET_COLUMNS);
const right = createEye('R', TARGET_COLUMNS);
const circuit = createCircuit();
const features = createFeatureTracker();
const setEngine = createSetEngine();

const hud = createHud();
mountCaptions(document.getElementById('caption-bar'));

const canvas = document.getElementById('eyes');
const viz = createVisualizer(canvas);

const flyCanvas = document.getElementById('fly-dj');
/** @type {Awaited<ReturnType<typeof import('./scene/FlyDJ.js').createFlyDJ>>|null} */
let flyDJ = null;
async function ensureFlyDJ() {
  if (flyDJ || !flyCanvas) return flyDJ;
  const { createFlyDJ } = await import('./scene/FlyDJ.js');
  flyDJ = createFlyDJ(flyCanvas);
  flyDJ.resize();
  return flyDJ;
}

const gate = document.getElementById('gate');
const engage = document.getElementById('engage');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnDemo = document.getElementById('btn-demo');
const btnSkip = document.getElementById('btn-skip');
const override = document.getElementById('override');
const manualBox = document.getElementById('manual-box');
const manualXf = document.getElementById('manual-xf');
const manualVol = document.getElementById('manual-vol');
const fileA = document.getElementById('file-a');
const fileB = document.getElementById('file-b');
const attrLines = document.getElementById('attr-lines');

let ctx = null;
let mixer = null;
/** @type {ReturnType<typeof createFxBus>|null} */
let fxBus = null;
let synths = null;
/** @type {ReturnType<typeof createCrateEngine>|null} */
let crate = null;
let running = false;
let fileSrcA = null;
let fileSrcB = null;
let lastEnergy = 0;
let lastSkipEvent = null;
let frames = 0;
let fps = 0;
let fpsT = performance.now();
let lastTs = performance.now();
let simCarry = 0;

let styleId = DEFAULT_STYLE_ID;
/** Lab-only continuous blend alpha (club ignores — setEngine owns xfader). */
let policyAlpha = 0.38;
let lastDecision = null;
let lastLogAt = 0;
let usingFiles = false;
let usingCrate = true;
let advancingSkip = false;
let lastSet = null;

/** @type {object|null} */
let unsupModel = null;
let lastNovelty = null;
let autoRefitUnsup = false;
let lastAutoFitCount = 0;
let autoFitTimer = null;
let demoAutoTrainArmed = true;
let mixStartedAt = null;
let currentRoute = 'club';

/** Shared HLS live radio (all clients same stream). Lab never uses this. */
let sharedLive = false;
/** @type {ReturnType<typeof createLiveClient>|null} */
let liveClient = null;
let liveBadge = false;

const AUTO_REFIT_EVERY = 200;

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

function refreshAttribution() {
  if (!attrLines) return;
  attrLines.textContent = attributionLines().join(' · ');
}

function syncFeatureBpm() {
  if (usingCrate && crate && !usingFiles) {
    features.setDemoBpms(crate.bpmA, crate.bpmB);
    features.setUseDemoBpm(true);
  } else if (synths && !usingFiles) {
    features.setDemoBpms(synths.bpmA, synths.bpmB);
    features.setUseDemoBpm(true);
  } else {
    features.setUseDemoBpm(false);
  }
}

function refreshUnsupHud(extraMsg) {
  const st = unsupervisedStatus(unsupModel, lastNovelty);
  let line = st.line;
  if (extraMsg) line = `${extraMsg} · ${line}`;
  hud.setUnsupStatus(line);
  return st;
}

function runUnsupervisedTrain(sourceRows, label) {
  const prev = unsupModel;
  const result = trainUnsupervised(sourceRows ?? getLog(), { prevModel: prev });
  if (result.ok) {
    unsupModel = result.model;
    lastAutoFitCount = logCount();
  }
  hud.setTrainStatus(result.message + (label ? ` (${label})` : ''));
  refreshUnsupHud();
  return result;
}

function scheduleAutoRefit() {
  if (!autoRefitUnsup) return;
  if (autoFitTimer) clearTimeout(autoFitTimer);
  autoFitTimer = setTimeout(() => {
    autoFitTimer = null;
    if (!autoRefitUnsup) return;
    const n = logCount();
    if (n - lastAutoFitCount < AUTO_REFIT_EVERY) return;
    if (n < 24) return;
    runUnsupervisedTrain(getLog(), 'auto-refit');
  }, 400);
}

/** Club (and default lab) use set-engine; only manual override bypasses it. */
function useSetEngineMode() {
  if (override?.checked) return false;
  // Ruthless: club always. Lab also uses setEngine unless user forces continuous via data attr later.
  return true;
}

function crateFeatBag() {
  return {
    bpm: features.lastBpm ?? crate?.bpmA ?? 124,
    energyMaster: lastEnergy,
    rms: lastEnergy,
    unsupCluster: lastDecision?.unsupCluster,
  };
}

async function preloadQuietDeck(quietSide) {
  if (!crate || !mixer || !usingCrate || usingFiles || advancingSkip) return;
  advancingSkip = true;
  try {
    const result = await crate.advanceAfterSkip(quietSide, mixer, crateFeatBag(), unsupModel);
    if (result) {
      setEngine.setNextTitle(result.track.title);
      hud.setDeckLabel(
        quietSide,
        result.track.title,
        `${result.meta} · preload · ${result.track.bpm} BPM`,
      );
      syncFeatureBpm();
      refreshAttribution();
      console.info(
        `[set] preload ${quietSide} → ${result.track.title} (${result.track.id})`,
      );
    }
  } finally {
    advancingSkip = false;
  }
}

setEngine.onPreload((side) => {
  preloadQuietDeck(side);
});

async function boot() {
  if (ctx) return;
  ctx = new AudioContext();
  mixer = createMixer(ctx);
  fxBus = createFxBus(ctx, mixer);
  crate = createCrateEngine(ctx);
  synths = createDemoSynths(ctx);

  const tracks = preferredTracks();
  const tA = tracks[0] || null;
  const tB = tracks[1] || tracks[0] || null;
  if (tA) {
    const r = await crate.loadTrack('A', tA, mixer.deckA, (d, n) => mixer.attachSource(d, n));
    if (r) hud.setDeckLabel('A', r.track.title, r.meta);
  }
  if (tB) {
    const r = await crate.loadTrack('B', tB, mixer.deckB, (d, n) => mixer.attachSource(d, n));
    if (r) hud.setDeckLabel('B', r.track.title, r.meta);
  }
  usingCrate = true;
  usingFiles = false;
  syncFeatureBpm();
  features.resetPhrase(ctx.currentTime);
  refreshAttribution();
  setEngine.begin(ctx.currentTime, crate, getStyle(styleId), 'A');
  console.info(
    `[crate] boot A=${crate.trackA?.title} (${crate.trackA?.id}) · B=${crate.trackB?.title} (${crate.trackB?.id})`,
  );
}

function startMix() {
  if (!ctx || !mixer) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (usingCrate && crate && !usingFiles) {
    crate.start();
    if (synths?.running) synths.stop();
  } else if (!fileSrcA && !fileSrcB) {
    if (usingCrate && crate) {
      crate.start();
    } else if (!synths.running) {
      synths.start();
    }
  } else {
    if (synths.running) synths.stop();
    if (crate) crate.stop();
  }
  if ((fileSrcA && !fileSrcB) || (!fileSrcA && fileSrcB)) {
    if (usingCrate && crate) crate.start();
    else if (!synths.running) synths.start();
  }
  running = true;
  mixStartedAt = ctx.currentTime;
  demoAutoTrainArmed = true;
  setEngine.begin(ctx.currentTime, crate, getStyle(styleId), 'A');
  if (btnStart) btnStart.disabled = true;
}

function stopMix() {
  running = false;
  if (crate) crate.stop();
  if (synths) synths.stop();
  if (fxBus) fxBus.reset();
  if (liveClient && sharedLive) liveClient.stop();
  if (btnStart) btnStart.disabled = false;
}

async function resetCrateOrDemo() {
  if (fileSrcA) {
    try { fileSrcA.stop(); } catch { /* ended */ }
    fileSrcA = null;
  }
  if (fileSrcB) {
    try { fileSrcB.stop(); } catch { /* ended */ }
    fileSrcB = null;
  }
  usingFiles = false;
  usingCrate = true;
  if (!mixer || !ctx) return;
  if (!crate) crate = createCrateEngine(ctx);
  const tracks = preferredTracks();
  const tA = tracks[0];
  const tB = tracks[1] || tracks[0];
  if (tA) {
    const r = await crate.loadTrack('A', tA, mixer.deckA, (d, n) => mixer.attachSource(d, n));
    if (r) hud.setDeckLabel('A', r.track.title, r.meta);
  }
  if (tB) {
    const r = await crate.loadTrack('B', tB, mixer.deckB, (d, n) => mixer.attachSource(d, n));
    if (r) hud.setDeckLabel('B', r.track.title, r.meta);
  }
  syncFeatureBpm();
  features.resetPhrase(ctx.currentTime);
  refreshAttribution();
  setEngine.begin(ctx.currentTime, crate, getStyle(styleId), 'A');
  if (running) crate.start();
}

async function loadDeck(side, file) {
  if (!ctx || !mixer) await boot();
  const buffer = await decodeFile(ctx, file);
  const src = playBuffer(ctx, buffer);
  usingFiles = true;
  usingCrate = false;
  if (crate) crate.stop();
  features.setUseDemoBpm(false);
  if (side === 'A') {
    if (fileSrcA) { try { fileSrcA.stop(); } catch { /* ended */ } }
    fileSrcA = src;
    mixer.attachSource(mixer.deckA, src);
    hud.setDeckLabel('A', file.name, `${(buffer.duration / 60).toFixed(1)} min · looped · lab override`);
  } else {
    if (fileSrcB) { try { fileSrcB.stop(); } catch { /* ended */ } }
    fileSrcB = src;
    mixer.attachSource(mixer.deckB, src);
    hud.setDeckLabel('B', file.name, `${(buffer.duration / 60).toFixed(1)} min · looped · lab override`);
  }
  if (running && fileSrcA && fileSrcB && synths?.running) synths.stop();
}

async function handleSkipAdvance(fromSide) {
  if (!crate || !mixer || !usingCrate || usingFiles || advancingSkip) return;
  advancingSkip = true;
  try {
    const result = await crate.advanceAfterSkip(fromSide, mixer, crateFeatBag(), unsupModel);
    if (result) {
      hud.setDeckLabel(
        fromSide,
        result.track.title,
        `${result.meta} · crate pick · ${result.track.bpm} BPM`,
      );
      syncFeatureBpm();
      refreshAttribution();
      console.info(
        `[crate] advanced ${fromSide} → ${result.track.title} (${result.track.id}) · A=${crate.trackA?.title} · B=${crate.trackB?.title}`,
      );
    }
  } finally {
    advancingSkip = false;
  }
}

engage.addEventListener('click', async () => {
  gate.classList.add('hidden');
  if (location.hash !== '#lab' && location.hash !== '#story') {
    location.hash = '#club';
  }
  await ensureFlyDJ();

  // Re-probe in case server came up after page load
  if (currentRoute !== 'lab') {
    await initSharedLiveMode();
  }

  if (isSharedLiveClub()) {
    // Shared live: HLS audio only — no local crate/setEngine mix
    running = true;
    mixStartedAt = performance.now() / 1000;
    if (btnStart) btnStart.disabled = true;
    await liveClient.start();
    console.info('[live] engaged shared stream (read-only — cannot override radio)');
    return;
  }

  // Public shared-only deploy: never fall back to a per-tab mix that looks like "the club"
  if (!isLabEnabled() && currentRoute !== 'lab') {
    const status = document.getElementById('club-status');
    if (status) {
      status.textContent =
        'Shared live server unreachable. This public club is read-only shared radio — no local override.';
    }
    console.error('[live] refusing local club mix (ENABLE_LAB=false / sharedOnly)');
    return;
  }

  // Local lab / dev only
  await boot();
  startMix();
});

btnStart?.addEventListener('click', async () => {
  await boot();
  startMix();
});
btnStop?.addEventListener('click', stopMix);
btnDemo?.addEventListener('click', async () => {
  await boot();
  await resetCrateOrDemo();
});
btnSkip?.addEventListener('click', () => {
  if (mixer) {
    const ev = mixer.skip();
    if (ev) {
      lastSkipEvent = ev;
      setEngine.forceSkipTo(ev.to, ctx?.currentTime ?? 0, crate, getStyle(styleId));
      handleSkipAdvance(ev.from);
    }
  }
  if (lastDecision) {
    logDecision({
      features: lastDecision._features,
      decision: { ...lastDecision, skipRequest: true },
      humanOverride: true,
      forcedSkip: true,
      styleId,
      policyAlpha,
      manualXfader: Number(manualXf.value),
    });
  }
});
override?.addEventListener('change', () => {
  manualBox?.classList.toggle('open', override.checked);
});
fileA?.addEventListener('change', () => {
  if (fileA.files[0]) loadDeck('A', fileA.files[0]);
});
fileB?.addEventListener('change', () => {
  if (fileB.files[0]) loadDeck('B', fileB.files[0]);
});

hud.onStyleChange((id) => {
  styleId = id;
  const style = getStyle(id);
  features.resetPhrase(ctx ? ctx.currentTime : 0);
  hud.setStyleBlurb(style.blurb);
});
hud.onAlphaChange((a) => {
  policyAlpha = a;
});
hud.onExportLog(() => {
  downloadJSONL(`dj-drosophila-policy-${Date.now()}.jsonl`);
  hud.setTrainStatus(`Exported ${logCount()} rows. Your data, your stream.`);
});
hud.onFitPolicy(() => {
  const result = fitFromLocalStorage();
  hud.setTrainStatus(result.message);
  hud.setWeightsStatus(loadWeights());
});
hud.onTrainUnsupervised(() => {
  runUnsupervisedTrain(getLog(), 'manual');
});
hud.onAutoRefitUnsup((on) => {
  autoRefitUnsup = on;
  hud.setTrainStatus(
    on
      ? `Auto-refit unsupervised ON — refits every ~${AUTO_REFIT_EVERY} logged samples (debounced).`
      : 'Auto-refit unsupervised OFF.',
  );
});

const PREFER_BUNDLED = true;
if (bundledUnsup && bundledUnsup.centroids) {
  unsupModel = installBundledUnsupervised(bundledUnsup, { force: PREFER_BUNDLED });
  hud.setTrainStatus(
    `Bundled pretrained unsup v1 · ${unsupModel.samples} samples · k=${unsupModel.k} — ready (no Train needed). Synthetic multi-regime fit, not artist cloning.`,
  );
} else {
  const seedResult = seedUnsupervisedIfEmpty();
  unsupModel = seedResult.model || loadUnsupervisedModel();
  if (seedResult.seeded) {
    hud.setTrainStatus(seedResult.message);
  }
}
try {
  if (bundledWeights && bundledWeights.skip && !loadWeights()) {
    saveWeights(bundledWeights);
  }
} catch {
  /* ignore */
}
hud.setWeightsStatus(loadWeights());
lastAutoFitCount = logCount();

hud.initPolicyUi({
  styleId,
  alpha: policyAlpha,
  weights: loadWeights(),
  logCount: logCount(),
  unsupLine: unsupervisedStatus(unsupModel, null).line,
  autoRefit: autoRefitUnsup,
});


async function fetchLiveConfig() {
  try {
    const r = await fetch('/api/live/config', { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Public / Docker: ENABLE_LAB=false → hide lab, force shared HLS.
 * Local vite without live server: lab stays available, club uses local mix.
 * Lab NEVER sends commands to the live radio (no control API exists for clients).
 */
async function initSharedLiveMode() {
  const cfg = await fetchLiveConfig();
  const labOn = cfg ? !!cfg.enableLab : liveQueryFlag() === null && import.meta.env.DEV;
  // If we reached a live server, honor its ENABLE_LAB. If no server (static/lab-only), allow lab in dev.
  if (cfg) {
    setLabEnabled(!!cfg.enableLab);
  } else if (!import.meta.env.DEV) {
    // Static production build without live API — still hide lab by default
    setLabEnabled(false);
  } else {
    setLabEnabled(true);
  }

  if (currentRoute === 'lab' && isLabEnabled()) {
    sharedLive = false;
    return false;
  }

  const flag = liveQueryFlag();
  if (flag === false && !(cfg && cfg.sharedOnly && !cfg.enableLab)) {
    // Explicit ?live=0 only honored when lab is enabled (local/dev)
    sharedLive = false;
    return false;
  }

  // Production shared-only: always require live server
  const mustShared = !!(cfg && cfg.sharedOnly && !cfg.enableLab);
  const probed = cfg
    ? await probeLiveServer(mustShared ? 4000 : 1500)
    : flag === true
      ? await probeLiveServer(3000)
      : await probeLiveServer(1200);

  if (!probed) {
    if (mustShared || flag === true) {
      console.warn('[live] shared live required but /api/live/state unreachable');
    }
    sharedLive = false;
    return false;
  }

  sharedLive = true;
  liveBadge = true;
  if (!liveClient) {
    liveClient = createLiveClient({
      onState(s) {
        if (!s) return;
        if (s.trackA) {
          hud.setDeckLabel(
            'A',
            s.trackA.title,
            `${s.trackA.artist} · ${s.trackA.bpm} BPM · LIVE`,
          );
        }
        if (s.trackB) {
          hud.setDeckLabel(
            'B',
            s.trackB.title,
            `${s.trackB.artist} · ${s.trackB.bpm} BPM · LIVE`,
          );
        }
        if (attrLines && s.trackA && s.trackB) {
          attrLines.textContent = [
            `${s.trackA.title} — ${s.trackA.artist} (CC0)`,
            `${s.trackB.title} — ${s.trackB.artist} (CC0)`,
            'SHARED LIVE STREAM · read-only · all visitors hear the same show',
          ].join(' · ');
        }
      },
    });
  }
  console.info(
    '[live] shared stream ready — clients are read-only (no skip/control of the radio)',
  );
  return true;
}

function isSharedLiveClub() {
  return sharedLive && liveClient && currentRoute !== 'lab';
}

refreshAttribution();

// Auto-detect shared live when not on lab
initSharedLiveMode();

mountRouter((route) => {
  currentRoute = route;
  if (route === 'lab' && sharedLive && liveClient) {
    // Lab is private local mix — stop shared audio if it was playing
    liveClient.stop();
    sharedLive = false;
    liveBadge = false;
  }
  if (route === 'club') {
    initSharedLiveMode();
  }
  if (route === 'club' || route === 'lab') {
    ensureFlyDJ().then((f) => f && f.resize());
  } else if (flyDJ) {
    flyDJ.resize();
  }
});

window.addEventListener('resize', () => {
  if (flyDJ) flyDJ.resize();
});

function loop(ts) {
  frames += 1;
  if (ts - fpsT > 500) {
    fps = (frames * 1000) / (ts - fpsT);
    frames = 0;
    fpsT = ts;
  }

  // ---- Shared live club: drive HUD/FlyDJ from SSE; HLS is the audio ----
  if (isSharedLiveClub() && running) {
    const snap = liveClient.setSnapshot();
    lastSet = snap;
    const xf = snap?.xfaderTarget ?? 0;
    const vol = 0.72;
    const now = ts / 1000;
    const empty = emptyFeat();
    // Light eye motion from xfader / transition for comedy viz
    const pulse = snap?.state === 'TRANSITION' ? 0.55 + 0.4 * (snap.transitionProgress || 0) : 0.35;
    empty.bass = pulse * 0.6;
    empty.rms = pulse * 0.5;
    empty.kick = snap?.state === 'TRANSITION' ? 0.4 : 0.15;
    updateEye(left, empty);
    updateEye(right, empty);
    viz.frame({ left, right, featA: empty, featB: empty, xfader: xf, running: true });
    if (flyDJ) {
      flyDJ.update({
        xfader: xf,
        volume: vol,
        bass: empty.bass,
        kick: empty.kick,
        skipEvent: null,
        now,
        running: true,
        setState: snap?.state,
        activeEdge: snap?.activeEdge,
      });
      if (currentRoute === 'club' || currentRoute === 'lab') flyDJ.render();
    }
    hud.update({
      fps,
      running: true,
      xfader: xf,
      volume: vol,
      usedFallback: false,
      dnL: circuit.dnL,
      dnR: circuit.dnR,
      gf: circuit.gf,
      meanRate: 8,
      skipEvent: null,
      now,
      lastSkipAt: -10,
      lastSkipFrom: 'A',
      facets: viz.facetCounts(),
      policyReason: 'SHARED LIVE · server schedule (no local policy mix)',
      policyAlpha,
      styleId,
      skipScore: 0,
      gateAllow: true,
      bpm: liveClient.state?.trackA?.bpm || liveClient.state?.trackB?.bpm || 124,
      logCount: logCount(),
      unsupLine: 'live shared stream',
      novelty: null,
      setState: snap?.state,
      setStatus: snap?.statusLine,
      setTimeStr: snap?.timeStr,
      setEdgeLabel: snap?.edgeLabel,
      nextTitle: snap?.nextTitle,
      transitionProgress: snap?.transitionProgress,
      fxIntensity: snap?.fxIntensity,
      clubMode: true,
      sharedLive: true,
    });
    hud.traces(circuit.history);
    requestAnimationFrame(loop);
    return;
  }

  if (running) {
    if (usingCrate && crate && !usingFiles) crate.tick();
    else if (synths) synths.tick();
  }

  const featA = mixer && running ? mixer.deckA.analyser.read(ctx.currentTime) : emptyFeat();
  const featB = mixer && running ? mixer.deckB.analyser.read(ctx.currentTime) : emptyFeat();
  const featM = mixer && running ? mixer.masterAnalyser.read(ctx.currentTime) : emptyFeat();

  updateEye(left, featA);
  updateEye(right, featB);

  const now = ctx ? ctx.currentTime : ts / 1000;
  const currents = sensorCurrents({ left, right, featA, featB, featM }, now, lastEnergy);
  lastEnergy = currents.energy;

  const dt = 0.001;
  const frameDt = Math.min(0.05, Math.max(0.008, (ts - lastTs) / 1000));
  lastTs = ts;
  let snapshot = {
    dnL: circuit.dnL,
    dnR: circuit.dnR,
    gf: circuit.gf,
    meanRate: 0.5 * (circuit.dnL.rate + circuit.dnR.rate),
    gfFired: false,
  };
  let gfFiredThisFrame = false;
  simCarry += frameDt;
  while (simCarry >= dt) {
    snapshot = circuit.step(dt, currents);
    simCarry -= dt;
    if (snapshot.gfFired) gfFiredThisFrame = true;
  }

  const mapped = ratesToMixer({
    dnL: circuit.dnL,
    dnR: circuit.dnR,
    meanRate: snapshot.meanRate,
    left,
    right,
  });

  const style = getStyle(styleId);
  const featBag = features.extract({
    now,
    featA,
    featB,
    featM,
    left,
    right,
    dnL: circuit.dnL,
    dnR: circuit.dnR,
    gf: circuit.gf,
    xfader: mixer ? mixer.xfader : mapped.xfader,
    stylePhraseBars: style.phraseBars,
  });

  if (!unsupModel) unsupModel = loadUnsupervisedModel();

  const seHud = setEngine.getHud();
  const decision = decide(featBag, styleId, {
    humanOverride: override?.checked,
    gfFired: gfFiredThisFrame,
    unsupModel,
    playedSec: seHud.playedSec,
    minPlaySec: seHud.minPlaySec,
  });
  decision._features = featBag;
  lastDecision = decision;
  if (decision.novelty != null) lastNovelty = decision.novelty;

  // Rare emergency cut during PLAYING (not the default path)
  if (mixer && running && !override?.checked && decision.skipRequest) {
    const ev = mixer.skip();
    if (ev) {
      lastSkipEvent = ev;
      setEngine.forceSkipTo(ev.to, now, crate, style);
      handleSkipAdvance(ev.from);
    }
  }

  if (mixer && running) {
    if (override?.checked) {
      mixer.setCrossfader(Number(manualXf.value), 0.08);
      mixer.setMaster(Number(manualVol.value));
    } else if (useSetEngineMode()) {
      // --- Club / set-engine path: NO continuous LIF↔policy xfader blend ---
      const setSnap = setEngine.tick({
        now,
        dt: frameDt,
        decision,
        style,
        crate,
        mixer,
      });
      lastSet = setSnap;

      // setEngine already wrote xfader (edge lock or transition slew)
      // Master: damp mean-rate heavily (keep club loudness stable)
      const dampVol = 0.58 + 0.12 * Math.tanh(snapshot.meanRate / 22);
      mixer.setMaster(dampVol);

      if (fxBus) {
        fxBus.apply({ set: setSnap, decision, now, dt: frameDt });
      }

      if (manualXf) manualXf.value = String(mixer.xfader.toFixed(2));
      if (manualVol) manualVol.value = String(dampVol.toFixed(2));
    } else {
      // Fallback (should not run for club): still avoid continuous blend
      mixer.setCrossfader(mixer.xfader <= 0 ? -1 : 1, 0.3);
      mixer.setMaster(0.58 + 0.12 * Math.tanh(snapshot.meanRate / 22));
    }
  }

  if (running && now - lastLogAt > 0.25) {
    lastLogAt = now;
    logDecision({
      features: featBag,
      decision: {
        xfaderTarget: decision.xfaderTarget,
        skipRequest: decision.skipRequest,
        transitionRequest: decision.transitionRequest,
        fxIntensity: decision.fxIntensity,
        blend: decision.blend,
        reason: decision.reason,
        gateAllow: decision.gateAllow,
        skipScore: decision.skipScore,
        novelty: decision.novelty,
        unsupCluster: decision.unsupCluster,
        setState: lastSet?.state,
      },
      humanOverride: !!override?.checked,
      styleId,
      policyAlpha,
      lifXfader: mapped.xfader,
      manualXfader: override?.checked ? Number(manualXf.value) : undefined,
    });

    const n = logCount();
    if (autoRefitUnsup && n - lastAutoFitCount >= AUTO_REFIT_EVERY) {
      scheduleAutoRefit();
    }

    if (
      demoAutoTrainArmed &&
      mixStartedAt != null &&
      now - mixStartedAt > 30 &&
      n >= 80
    ) {
      demoAutoTrainArmed = false;
      runUnsupervisedTrain(getLog(), 'post-demo ~30s');
    }
  }

  const xf = mixer ? mixer.xfader : mapped.xfader;
  const vol = mixer ? mixer.getMasterGain() : mapped.volume;

  viz.frame({
    left,
    right,
    featA,
    featB,
    xfader: xf,
    running,
  });

  if (flyDJ) {
    flyDJ.update({
      xfader: xf,
      volume: vol,
      bass: featM.bass || 0,
      kick: featM.kick || 0,
      skipEvent: lastSkipEvent,
      now,
      running,
      setState: lastSet?.state,
      activeEdge: lastSet?.activeEdge,
    });
    if (currentRoute === 'club' || currentRoute === 'lab') {
      flyDJ.render();
    }
  }

  const unsupLine = unsupervisedStatus(unsupModel, lastNovelty).line;

  hud.update({
    fps,
    running,
    xfader: xf,
    volume: vol,
    usedFallback: mapped.usedFallback,
    dnL: circuit.dnL,
    dnR: circuit.dnR,
    gf: circuit.gf,
    meanRate: snapshot.meanRate,
    skipEvent: lastSkipEvent,
    now,
    lastSkipAt: mixer ? mixer.lastSkipAt : -10,
    lastSkipFrom: mixer ? mixer.lastSkipFrom : 'A',
    facets: viz.facetCounts(),
    policyReason: decision.reason,
    policyAlpha,
    styleId,
    skipScore: decision.skipScore,
    gateAllow: decision.gateAllow,
    bpm: featBag.bpm,
    logCount: logCount(),
    unsupLine,
    novelty: lastNovelty,
    setState: lastSet?.state,
    setStatus: lastSet?.statusLine,
    setTimeStr: lastSet?.timeStr,
    setEdgeLabel: lastSet?.edgeLabel,
    nextTitle: lastSet?.nextTitle,
    transitionProgress: lastSet?.transitionProgress,
    fxIntensity: decision.fxIntensity,
    clubMode: currentRoute === 'club',
    sharedLive: false,
  });
  hud.traces(circuit.history);

  if (lastSkipEvent && now - lastSkipEvent.at > 0.9) lastSkipEvent = null;

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

console.info(
  `[DJ Drosophila] public club · setEngine edge-lock · eye columns ${TARGET_COLUMNS} / TODO ${TODO_COLUMNS}. ` +
    'Shared live = read-only HLS for everyone · #lab local-dev only · see docs/LIVE.md.',
);
