/**
 * DJ Drosophila — club wiring.
 * Shared HLS → club frame (eyes · LIF · fly · booth readout).
 */

import { createEye, TARGET_COLUMNS } from './vision/eyeMap.js';
import { createVisualizer } from './vision/visualizer.js';
import { createCircuit } from './brain/circuit.js';
import { createHud } from './ui/hud.js';
import { mountCaptions } from './ui/captions.js';
import { mountRouter } from './ui/router.js';
import { createClubFrame } from './club/frame.js';
import { probeLiveServer, createLiveClient } from './live/liveClient.js';
import { attributionLines } from './crate/attribution.js';

const left = createEye('L', TARGET_COLUMNS);
const right = createEye('R', TARGET_COLUMNS);
const circuit = createCircuit();
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
const btnLiveMute = document.getElementById('btn-live-mute');
const btnLiveMuteGate = document.getElementById('btn-live-mute-gate');
const attrLines = document.getElementById('attr-lines');

let liveClient = null;
let clubFrame = null;
let running = false;
let currentRoute = 'club';

function syncMuteButtons(muted) {
  for (const btn of [btnLiveMute, btnLiveMuteGate]) {
    if (!btn) continue;
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const icon = btn.querySelector('.mute-icon');
    const label = btn.querySelector('.mute-label');
    if (icon) icon.textContent = muted ? '🔇' : '🔊';
    if (label) label.textContent = muted ? 'Unmute' : 'Mute';
    btn.title = muted ? 'Unmute' : 'Mute';
  }
}

function wireMuteButtons() {
  const handler = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (liveClient) {
      syncMuteButtons(liveClient.toggleMute());
      return;
    }
    let muted = false;
    try {
      muted = localStorage.getItem('dj-drosophila:liveMuted') === '1';
    } catch {
      muted = false;
    }
    muted = !muted;
    try {
      localStorage.setItem('dj-drosophila:liveMuted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    syncMuteButtons(muted);
  };
  for (const btn of [btnLiveMute, btnLiveMuteGate]) {
    if (btn && !btn.dataset.muteWired) {
      btn.dataset.muteWired = '1';
      btn.addEventListener('click', handler);
    }
  }
  let muted = false;
  try {
    muted = localStorage.getItem('dj-drosophila:liveMuted') === '1';
  } catch {
    muted = false;
  }
  syncMuteButtons(muted);
}

wireMuteButtons();

if (attrLines) {
  try {
    attrLines.textContent = attributionLines().join(' · ') || 'CC0 crate · see LICENSES.md';
  } catch {
    attrLines.textContent = 'CC0 crate · see LICENSES.md';
  }
}

function attachLiveClient() {
  if (liveClient) return liveClient;
  liveClient = createLiveClient({
    onState(s) {
      if (!s) return;
      if (s.trackA) {
        hud.setDeckLabel('A', s.trackA.title, `${s.trackA.artist} · ${s.trackA.bpm} BPM · LIVE`);
      }
      if (s.trackB) {
        hud.setDeckLabel('B', s.trackB.title, `${s.trackB.artist} · ${s.trackB.bpm} BPM · LIVE`);
      }
      if (attrLines && s.trackA && s.trackB) {
        attrLines.textContent = [
          `${s.trackA.title} — ${s.trackA.artist} (CC0)`,
          `${s.trackB.title} — ${s.trackB.artist} (CC0)`,
          'same stream for everyone',
        ].join(' · ');
      }
    },
    onMuteChange(m) {
      syncMuteButtons(m);
    },
  });
  try {
    const preferMute = localStorage.getItem('dj-drosophila:liveMuted') === '1';
    liveClient.setMuted(preferMute);
    syncMuteButtons(preferMute);
  } catch {
    syncMuteButtons(!!liveClient.muted);
  }
  clubFrame = createClubFrame({
    circuit,
    viz,
    left,
    right,
    hud,
    getFly: () => flyDJ,
    liveClient,
  });
  return liveClient;
}

async function initSharedLive() {
  const probed = await probeLiveServer(2500);
  if (!probed) {
    console.warn('[live] /api/live/state unreachable');
    return false;
  }
  attachLiveClient();
  console.info('[live] shared stream ready — clients are read-only');
  return true;
}

engage.addEventListener('click', async () => {
  gate.classList.add('hidden');
  if (currentRoute !== 'story') location.hash = '#club';
  await ensureFlyDJ();
  viz.resize();
  const ok = await initSharedLive();
  if (!ok) {
    const status = document.getElementById('club-status');
    if (status) {
      status.textContent =
        'Radio offline.';
    }
    return;
  }
  running = true;
  await liveClient.start();
});

initSharedLive();

mountRouter((route) => {
  currentRoute = route;
  if (route === 'club') {
    initSharedLive();
    ensureFlyDJ().then((f) => f && f.resize());
    viz.resize();
  } else if (flyDJ) {
    flyDJ.resize();
  }
});

window.addEventListener('resize', () => {
  if (flyDJ) flyDJ.resize();
  viz.resize();
});

function loop(ts) {
  if (running && liveClient && currentRoute === 'club') {
    clubFrame?.tick(ts, { running: true });
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

console.info('[dj-drosophila] club');
