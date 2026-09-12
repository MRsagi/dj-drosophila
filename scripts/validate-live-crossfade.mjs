#!/usr/bin/env node
/**
 * Validate live crossfades on DJ Drosophila.
 * Polls /api/live/state, captures TRANSITION windows, analyzes HLS audio.
 *
 * Env:
 *   LIVE_URL      default https://dj.sagirosenthal.com
 *   DURATION_SEC  default 600
 *   POLL_MS       default 1000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE_URL = (process.env.LIVE_URL || 'https://dj.sagirosenthal.com').replace(/\/$/, '');
const DURATION_SEC = Number(process.env.DURATION_SEC || 600);
const POLL_MS = Number(process.env.POLL_MS || 1000);
const OUT_DIR = path.join(ROOT, 'scripts', 'out');
const SEG_DIR = path.join(OUT_DIR, 'segments');
const JSONL_PATH = path.join(OUT_DIR, `crossfade-validation-${Date.now()}.jsonl`);
const REPORT_PATH = path.join(ROOT, 'docs', 'CROSSFADE_VALIDATION.md');

fs.mkdirSync(SEG_DIR, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'server', 'cache'), { recursive: true });

const logStream = fs.createWriteStream(JSONL_PATH, { flags: 'a' });

function log(obj) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
  logStream.write(line + '\n');
  console.log(line);
}

async function fetchState() {
  const res = await fetch(`${LIVE_URL}/api/live/state`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`state ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function parseM3u8(text) {
  const lines = text.split(/\r?\n/);
  const segs = [];
  let dur = null;
  let pdt = null;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      dur = parseFloat(line.slice(8));
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      pdt = line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim();
    } else if (line && !line.startsWith('#')) {
      segs.push({ name: line.trim(), duration: dur, pdt });
      dur = null;
      pdt = null;
    }
  }
  return segs;
}

/** Decode TS segment to PCM s16le mono 22050 via ffmpeg, return Int16Array */
function decodeSegmentPcm(tsPath) {
  const wavPath = tsPath.replace(/\.ts$/, '.s16');
  try {
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        tsPath,
        '-ac',
        '1',
        '-ar',
        '22050',
        '-f',
        's16le',
        wavPath,
      ],
      { timeout: 30000 },
    );
    const buf = fs.readFileSync(wavPath);
    return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  } catch (err) {
    console.warn('decode failed', tsPath, err.message);
    return null;
  }
}

function rmsBlocks(pcm, blockSize = 2205) {
  // ~100ms blocks at 22050
  const out = [];
  for (let i = 0; i + blockSize <= pcm.length; i += blockSize) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      const s = pcm[i + j] / 32768;
      sum += s * s;
    }
    out.push(Math.sqrt(sum / blockSize));
  }
  return out;
}

function spectralFluxApprox(pcm, frame = 1024, hop = 512) {
  const fluxes = [];
  let prev = null;
  for (let i = 0; i + frame <= pcm.length; i += hop) {
    // Simple magnitude spectrum via folded abs DFT-ish energy bands (8 bands)
    const bands = new Float64Array(8);
    for (let k = 0; k < frame; k++) {
      const s = Math.abs(pcm[i + k] / 32768);
      bands[Math.min(7, Math.floor((k / frame) * 8))] += s;
    }
    if (prev) {
      let flux = 0;
      for (let b = 0; b < 8; b++) {
        const d = bands[b] - prev[b];
        if (d > 0) flux += d;
      }
      fluxes.push(flux / frame);
    }
    prev = bands;
  }
  return fluxes;
}

function analyzeWindow(rmsArr, fluxArr) {
  if (!rmsArr.length) {
    return { ok: false, reason: 'no audio samples' };
  }
  const n = rmsArr.length;
  const third = Math.max(1, Math.floor(n / 3));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const early = mean(rmsArr.slice(0, third));
  const mid = mean(rmsArr.slice(third, 2 * third));
  const late = mean(rmsArr.slice(2 * third));
  // Hard cut heuristic: flat early, sudden jump late, little mid variation
  const diffs = [];
  for (let i = 1; i < rmsArr.length; i++) diffs.push(Math.abs(rmsArr[i] - rmsArr[i - 1]));
  const maxJump = Math.max(...diffs, 0);
  const meanJump = mean(diffs);
  const jumpIdx = diffs.indexOf(maxJump);
  const jumpFrac = jumpIdx / Math.max(1, diffs.length - 1);

  // Blend: mid energy between early/late OR gradual change (maxJump not dominating at end)
  const midBetween =
    mid > Math.min(early, late) * 0.7 && mid < Math.max(early, late) * 1.4;
  const gradual =
    maxJump < meanJump * 8 || (jumpFrac > 0.15 && jumpFrac < 0.85);
  // Also: coefficient of variation in middle half suggests evolving mix
  const midHalf = rmsArr.slice(Math.floor(n * 0.25), Math.floor(n * 0.75));
  const midMean = mean(midHalf);
  const midStd = Math.sqrt(mean(midHalf.map((x) => (x - midMean) ** 2)));
  const midCv = midMean > 1e-6 ? midStd / midMean : 0;

  const fluxMean = fluxArr?.length ? mean(fluxArr) : 0;
  const hardCutLikely =
    maxJump > meanJump * 12 && (jumpFrac < 0.08 || jumpFrac > 0.92) && midCv < 0.08;

  const blendLikely = !hardCutLikely && (gradual || midBetween || midCv > 0.05);

  return {
    ok: blendLikely,
    hardCutLikely,
    earlyRms: early,
    midRms: mid,
    lateRms: late,
    maxJump,
    meanJump,
    jumpFrac,
    midCv,
    fluxMean,
    nBlocks: n,
    reason: hardCutLikely
      ? 'hard-cut-like RMS profile (sudden jump at boundary, flat mid)'
      : blendLikely
        ? 'gradual/overlapping energy consistent with blend'
        : 'ambiguous energy profile',
  };
}

function stateKey(s) {
  return [
    s.state,
    s._absIndex,
    s.activeDeck,
    s.trackA?.id,
    s.trackB?.id,
    s.nextTrack?.id,
    s.transitionSec,
  ].join('|');
}

/** Capture HLS segments during a window into a concat wav analysis */
async function captureAndAnalyze(label, windowId) {
  const base = `${LIVE_URL}/hls`;
  const playlistUrl = `${base}/live.m3u8`;
  const seen = new Set();
  const downloaded = [];
  const deadline = Date.now() + 8000; // burst download current window
  while (Date.now() < deadline) {
    try {
      const text = await fetchText(playlistUrl);
      const segs = parseM3u8(text);
      for (const seg of segs.slice(-12)) {
        if (seen.has(seg.name)) continue;
        seen.add(seg.name);
        const dest = path.join(SEG_DIR, `${windowId}_${seg.name}`);
        try {
          await downloadFile(`${base}/${seg.name}`, dest);
          downloaded.push({ ...seg, path: dest });
        } catch (e) {
          console.warn('seg dl fail', seg.name, e.message);
        }
      }
    } catch (e) {
      console.warn('playlist fail', e.message);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Concatenate PCMs in order
  const pcms = [];
  for (const seg of downloaded.sort((a, b) => a.name.localeCompare(b.name))) {
    const pcm = decodeSegmentPcm(seg.path);
    if (pcm) pcms.push(pcm);
  }
  if (!pcms.length) {
    return { ok: false, reason: 'no segments decoded', downloaded: downloaded.length };
  }
  const totalLen = pcms.reduce((s, p) => s + p.length, 0);
  const merged = new Int16Array(totalLen);
  let off = 0;
  for (const p of pcms) {
    merged.set(p, off);
    off += p.length;
  }
  const rms = rmsBlocks(merged);
  const flux = spectralFluxApprox(merged);
  const analysis = analyzeWindow(rms, flux);
  // Persist RMS series for report
  const seriesPath = path.join(OUT_DIR, `${windowId}-rms.json`);
  fs.writeFileSync(
    seriesPath,
    JSON.stringify({ label, rms, flux: flux.slice(0, 200), analysis, segs: downloaded.map((d) => d.name) }, null, 2),
  );
  return { ...analysis, segments: downloaded.length, seriesPath, label };
}

const transitions = [];
/** @type {object|null} */
let currentTransition = null;
let lastKey = null;
let lastState = null;
const xfaderSamples = [];
const stateChanges = [];
const capturedAround = new Set();

const startMs = Date.now();
const endMs = startMs + DURATION_SEC * 1000;

log({
  event: 'start',
  liveUrl: LIVE_URL,
  durationSec: DURATION_SEC,
  pollMs: POLL_MS,
});

console.error(`Validating ${LIVE_URL} for ${DURATION_SEC}s → ${JSONL_PATH}`);

while (Date.now() < endMs) {
  let state;
  try {
    state = await fetchState();
  } catch (err) {
    log({ event: 'poll_error', error: String(err.message || err) });
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }

  const key = stateKey(state);
  const elapsed = (Date.now() - startMs) / 1000;

  // Always sample xfader during TRANSITION or near it
  const nearTransition =
    state.state === 'TRANSITION' ||
    (typeof state._remainingPlay === 'number' && state._remainingPlay <= 5);

  if (nearTransition || state.state === 'TRANSITION') {
    xfaderSamples.push({
      t: elapsed,
      state: state.state,
      xfaderEdge: state.xfaderEdge,
      transitionProgress: state.transitionProgress,
      absIndex: state._absIndex,
    });
  }

  if (key !== lastKey) {
    const change = {
      event: 'state_change',
      elapsed,
      from: lastState
        ? {
            state: lastState.state,
            absIndex: lastState._absIndex,
            xfaderEdge: lastState.xfaderEdge,
            progress: lastState.transitionProgress,
            track: lastState.activeDeck === 'A' ? lastState.trackA?.title : lastState.trackB?.title,
          }
        : null,
      to: {
        state: state.state,
        absIndex: state._absIndex,
        xfaderEdge: state.xfaderEdge,
        progress: state.transitionProgress,
        track: state.activeDeck === 'A' ? state.trackA?.title : state.trackB?.title,
        next: state.nextTrack?.title,
        fadeSec: state.transitionSec,
        mindReason: state.mindReason,
        playedSec: state.playedSec,
        plannedSec: state.plannedSec,
        trackDur: state._trackDurationSec,
        leaveAt: state._leaveAtSec,
        playStart: state._playStartSec,
      },
    };
    stateChanges.push(change);
    log(change);
    lastKey = key;
  }

  // Enter TRANSITION
  if (state.state === 'TRANSITION' && (!currentTransition || currentTransition.absIndex !== state._absIndex)) {
    if (currentTransition && !currentTransition.endElapsed) {
      currentTransition.endElapsed = elapsed;
      currentTransition.endProgress = lastState?.transitionProgress;
      currentTransition.endXfader = lastState?.xfaderEdge;
    }
    currentTransition = {
      absIndex: state._absIndex,
      startElapsed: elapsed,
      fadeSec: state.transitionSec,
      mindReason: state.mindReason,
      fromTrack: state.activeDeck === 'A' ? state.trackA?.title : state.trackB?.title,
      toTrack: state.nextTrack?.title,
      fromId: state.activeDeck === 'A' ? state.trackA?.id : state.trackB?.id,
      toId: state.nextTrack?.id,
      plannedSec: state.plannedSec,
      trackDur: state._trackDurationSec,
      leaveAt: state._leaveAtSec,
      playStart: state._playStartSec,
      xfaderSamples: [],
      startXfader: state.xfaderEdge,
      startProgress: state.transitionProgress,
    };
    transitions.push(currentTransition);
    log({ event: 'transition_start', ...currentTransition });

    // Kick audio capture (± around transition)
    const wid = `t${state._absIndex}_${Date.now()}`;
    if (!capturedAround.has(state._absIndex)) {
      capturedAround.add(state._absIndex);
      captureAndAnalyze(`transition-${state._absIndex}`, wid)
        .then((analysis) => {
          currentTransition.audioAnalysis = analysis;
          log({ event: 'audio_analysis', absIndex: state._absIndex, analysis });
        })
        .catch((e) => log({ event: 'audio_analysis_error', error: String(e.message || e) }));
    }
  }

  if (currentTransition && state.state === 'TRANSITION' && state._absIndex === currentTransition.absIndex) {
    currentTransition.xfaderSamples.push({
      t: elapsed,
      xfaderEdge: state.xfaderEdge,
      progress: state.transitionProgress,
    });
  }

  // Leave TRANSITION
  if (currentTransition && state.state === 'PLAYING' && lastState?.state === 'TRANSITION') {
    currentTransition.endElapsed = elapsed;
    currentTransition.endProgress = lastState.transitionProgress;
    currentTransition.endXfader = lastState.xfaderEdge;
    currentTransition.finalXfader = state.xfaderEdge;
    // Evaluate metadata xfader travel
    const xs = currentTransition.xfaderSamples;
    if (xs.length >= 3) {
      const edges = xs.map((x) => x.xfaderEdge);
      const progs = xs.map((x) => x.progress);
      const startE = edges[0];
      const endE = edges[edges.length - 1];
      const travel = Math.abs(endE - startE);
      // Check gradual: not stuck then jump
      const mid = edges[Math.floor(edges.length / 2)];
      const stuckThenJump =
        Math.abs(mid - startE) < 0.08 && travel > 0.5 && (progs[progs.length - 1] || 0) > 0.9;
      const gradualTravel = travel > 1.2 && Math.abs(mid - startE) > 0.25;
      currentTransition.metaEval = {
        travel,
        startE,
        midE: mid,
        endE,
        stuckThenJump,
        gradualTravel,
        sampleCount: xs.length,
        pass: gradualTravel && !stuckThenJump,
      };
    }
    // Leave timing
    const leavePlayed = currentTransition.plannedSec;
    const fileDur = currentTransition.trackDur;
    const fadeSec = currentTransition.fadeSec;
    const leaveOk =
      typeof fileDur === 'number' &&
      typeof leavePlayed === 'number' &&
      leavePlayed + fadeSec + 1 <= fileDur + 0.5 &&
      leavePlayed < fileDur * 0.98;
    currentTransition.leaveEval = {
      leavePlayed,
      fileDur,
      fadeSec,
      roomBeforeEof: typeof fileDur === 'number' ? fileDur - leavePlayed - fadeSec : null,
      pass: leaveOk,
      playedToEof: typeof fileDur === 'number' && leavePlayed >= fileDur - 1,
    };
    log({
      event: 'transition_end',
      absIndex: currentTransition.absIndex,
      metaEval: currentTransition.metaEval,
      leaveEval: currentTransition.leaveEval,
      durationObserved: currentTransition.endElapsed - currentTransition.startElapsed,
    });
  }

  // Pre-transition capture (±5s): when remaining play <= 5
  if (
    state.state === 'PLAYING' &&
    typeof state._remainingPlay === 'number' &&
    state._remainingPlay <= 5 &&
    !capturedAround.has(`pre-${state._absIndex}`)
  ) {
    capturedAround.add(`pre-${state._absIndex}`);
    const wid = `pre${state._absIndex}_${Date.now()}`;
    captureAndAnalyze(`pre-transition-${state._absIndex}`, wid)
      .then((a) => log({ event: 'pre_audio_capture', absIndex: state._absIndex, analysis: a }))
      .catch(() => {});
  }

  lastState = state;
  await new Promise((r) => setTimeout(r, POLL_MS));
}

// Finalize open transition
if (currentTransition && !currentTransition.endElapsed) {
  currentTransition.endElapsed = (Date.now() - startMs) / 1000;
  log({ event: 'transition_open_at_end', absIndex: currentTransition.absIndex });
}

// Wait briefly for in-flight audio analysis
await new Promise((r) => setTimeout(r, 12000));

// Build report
const metaPasses = transitions.filter((t) => t.metaEval?.pass);
const metaFails = transitions.filter((t) => t.metaEval && !t.metaEval.pass);
const audioPasses = transitions.filter((t) => t.audioAnalysis?.ok);
const audioFails = transitions.filter((t) => t.audioAnalysis && !t.audioAnalysis.ok);
const leavePasses = transitions.filter((t) => t.leaveEval?.pass);
const leaveFails = transitions.filter((t) => t.leaveEval && !t.leaveEval.pass);

const overallPass =
  transitions.length > 0 &&
  metaFails.length === 0 &&
  audioFails.length === 0 &&
  leaveFails.length === 0 &&
  metaPasses.length + (transitions.filter((t) => !t.metaEval).length === 0 ? 0 : 0) >= 0 &&
  (metaPasses.length > 0 || transitions.every((t) => t.metaEval?.pass !== false)) &&
  audioPasses.length >= Math.min(1, transitions.filter((t) => t.audioAnalysis).length);

const summary = {
  liveUrl: LIVE_URL,
  durationSec: DURATION_SEC,
  transitionsObserved: transitions.length,
  stateChanges: stateChanges.length,
  metaPass: metaPasses.length,
  metaFail: metaFails.length,
  audioPass: audioPasses.length,
  audioFail: audioFails.length,
  leavePass: leavePasses.length,
  leaveFail: leaveFails.length,
  overallPass: transitions.length === 0 ? null : metaFails.length === 0 && leaveFails.length === 0 && audioFails.length === 0,
};

log({ event: 'summary', ...summary });

function fmtTrans(t) {
  return [
    `### Transition #${t.absIndex}: ${t.fromTrack} → ${t.toTrack}`,
    ``,
    `- **fadeSec:** ${t.fadeSec}`,
    `- **mindReason:** ${t.mindReason || '—'}`,
    `- **window:** t=${t.startElapsed?.toFixed?.(1)}s → ${t.endElapsed?.toFixed?.(1) ?? '?'}s`,
    `- **leave:** played ${t.plannedSec}s / file ${t.trackDur}s (room before EOF after fade: ${t.leaveEval?.roomBeforeEof?.toFixed?.(1) ?? '?'}s)`,
    `- **metadata xfader:** ${t.metaEval ? (t.metaEval.pass ? 'PASS' : 'FAIL') : 'n/a'} — travel=${t.metaEval?.travel?.toFixed?.(3)} start=${t.metaEval?.startE?.toFixed?.(3)} mid=${t.metaEval?.midE?.toFixed?.(3)} end=${t.metaEval?.endE?.toFixed?.(3)} stuckThenJump=${t.metaEval?.stuckThenJump}`,
    `- **leave timing:** ${t.leaveEval ? (t.leaveEval.pass ? 'PASS' : 'FAIL') : 'n/a'} playedToEof=${t.leaveEval?.playedToEof}`,
    `- **audio:** ${t.audioAnalysis ? (t.audioAnalysis.ok ? 'PASS' : 'FAIL') : 'n/a'} — ${t.audioAnalysis?.reason || ''} (early/mid/late RMS ${t.audioAnalysis?.earlyRms?.toFixed?.(4)}/${t.audioAnalysis?.midRms?.toFixed?.(4)}/${t.audioAnalysis?.lateRms?.toFixed?.(4)}, maxJump=${t.audioAnalysis?.maxJump?.toFixed?.(4)}, midCv=${t.audioAnalysis?.midCv?.toFixed?.(3)}, segs=${t.audioAnalysis?.segments})`,
    ``,
  ].join('\n');
}

const md = [
  `# Crossfade validation report`,
  ``,
  `- **When:** ${new Date().toISOString()}`,
  `- **Live URL:** ${LIVE_URL}`,
  `- **Duration:** ${DURATION_SEC}s`,
  `- **JSONL log:** \`${path.relative(ROOT, JSONL_PATH)}\``,
  ``,
  `## Summary`,
  ``,
  `| Metric | Value |`,
  `|--------|-------|`,
  `| Transitions observed | ${transitions.length} |`,
  `| Metadata xfader pass/fail | ${metaPasses.length}/${metaFails.length} |`,
  `| Audio blend pass/fail | ${audioPasses.length}/${audioFails.length} |`,
  `| Leave-timing pass/fail | ${leavePasses.length}/${leaveFails.length} |`,
  `| **Overall** | **${summary.overallPass === null ? 'NO TRANSITION IN WINDOW' : summary.overallPass ? 'PASS' : 'FAIL'}** |`,
  ``,
  `## Pass/fail criteria`,
  ``,
  `1. **Metadata:** during TRANSITION, \`xfaderEdge\` travels gradually from near ±1 toward the other side (not stuck then jump at 100%).`,
  `2. **Audio:** during labeled TRANSITION, RMS/energy shows overlap/blend (not flat single-track then sudden change only at boundary).`,
  `3. **Leave timing:** not only at EOF; mind leaves with \`fadeSec\` room before duration (\`leaveAt ≤ duration - fadeSec - 1\`).`,
  ``,
  `## Transitions`,
  ``,
  transitions.length ? transitions.map(fmtTrans).join('\n') : '_No TRANSITION observed in this window._',
  ``,
  `## Notes`,
  ``,
  `- Poll interval ~${POLL_MS}ms.`,
  `- HLS segments downloaded from \`${LIVE_URL}/hls/live.m3u8\` during TRANSITION (± capture burst).`,
  `- Audio metric: mono 22.05 kHz RMS in ~100ms blocks + coarse spectral flux.`,
  ``,
].join('\n');

fs.writeFileSync(REPORT_PATH, md);
// Also copy jsonl pointer into server/cache
fs.copyFileSync(JSONL_PATH, path.join(ROOT, 'server', 'cache', path.basename(JSONL_PATH)));
fs.writeFileSync(path.join(OUT_DIR, 'latest-summary.json'), JSON.stringify(summary, null, 2));

console.error('\n=== VALIDATION SUMMARY ===');
console.error(JSON.stringify(summary, null, 2));
console.error(`Report: ${REPORT_PATH}`);

logStream.end();
process.exit(summary.overallPass === false ? 2 : 0);
