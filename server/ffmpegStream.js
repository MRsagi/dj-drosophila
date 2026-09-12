/**
 * Continuous HLS producer driven by the wall-clock / mind schedule.
 *
 * PLAYING: ffmpeg -re reads current mp3 from seek for remaining play time.
 *          Loops ONLY when the file is shorter than the play window.
 * TRANSITION: equal-power amix fade (primary) or acrossfade — full fadeSec blend.
 *             fromSeek at play-end (fadeSec of audio left); toSeek at next start.
 *
 * Requires ffmpeg on PATH.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITION_SEC, MIN_FADE_SEC } from './schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HLS_DIR = path.join(__dirname, 'hls');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function clearHls() {
  ensureDir(HLS_DIR);
  for (const f of fs.readdirSync(HLS_DIR)) {
    if (f.endsWith('.ts') || f.endsWith('.m3u8') || f.endsWith('.m4s') || f.endsWith('.tmp')) {
      try {
        fs.unlinkSync(path.join(HLS_DIR, f));
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Highest seg_NNNNN.ts index on disk, or -1 if none.
 * CRITICAL: do NOT use file count — delete_segments keeps ~list_size files,
 * so count !== next start number.
 */
function maxSegmentNumber() {
  if (!fs.existsSync(HLS_DIR)) return -1;
  let max = -1;
  for (const f of fs.readdirSync(HLS_DIR)) {
    const m = /^seg_(\d+)\.ts$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * @param {string[]} args
 * @param {{ label?: string, allowFail?: boolean }} [opts]
 */
function runFfmpeg(args, opts = {}) {
  const label = opts.label || 'ffmpeg';
  return new Promise((resolve, reject) => {
    console.info(`[live/ffmpeg] ${label}: ffmpeg ${args.join(' ')}`);
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (buf) => {
      const s = buf.toString();
      stderr += s;
      const lines = s.trim().split('\n');
      for (const line of lines) {
        if (line && !line.includes('frame=') && !line.includes('size=')) {
          console.info(`[ffmpeg] ${line}`);
        }
      }
    });
    child.on('error', (err) => {
      reject(new Error(`${label} spawn failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0 || code === 255 || opts.allowFail) {
        resolve({ code, stderr });
      } else {
        reject(new Error(`${label} exited ${code}: ${stderr.slice(-800)}`));
      }
    });
  });
}

/**
 * @param {ReturnType<import('./schedule.js').createSchedule>} schedule
 */
export function createHlsProducer(schedule) {
  let running = false;
  let aborted = false;
  let nextStartNumber = 0;
  let playlistReady = false;
  /** @type {import('node:child_process').ChildProcess|null} */
  let currentChild = null;
  /** Absolute index of last fully encoded schedule slot (kind+absIndex). */
  let lastEncodedKey = null;

  function hlsOutputArgs() {
    const flags = playlistReady
      ? 'delete_segments+append_list+omit_endlist+program_date_time'
      : 'delete_segments+omit_endlist+program_date_time';
    return [
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '20',
      '-hls_flags',
      flags,
      '-start_number',
      String(nextStartNumber),
      '-hls_segment_filename',
      path.join(HLS_DIR, 'seg_%05d.ts'),
      path.join(HLS_DIR, 'live.m3u8'),
    ];
  }

  function bumpStartNumber() {
    nextStartNumber = Math.max(nextStartNumber, maxSegmentNumber() + 1);
  }

  function spawnTracked(args, label) {
    return new Promise((resolve, reject) => {
      console.info(`[live/ffmpeg] ${label} (start_number=${nextStartNumber})`);
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      currentChild = child;
      let stderr = '';
      child.stderr.on('data', (buf) => {
        stderr += buf.toString();
      });
      child.on('error', (err) => {
        currentChild = null;
        reject(err);
      });
      child.on('close', (code) => {
        currentChild = null;
        bumpStartNumber();
        playlistReady = fs.existsSync(path.join(HLS_DIR, 'live.m3u8'));
        if (aborted || code === 0 || code === 255 || code === null) {
          resolve({ code, stderr });
        } else {
          console.warn(`[live/ffmpeg] ${label} exit ${code}: ${stderr.slice(-400)}`);
          resolve({ code, stderr });
        }
      });
    });
  }

  /**
   * PLAYING: encode from seek for durationSec once when file is long enough.
   * Loop only if the file is shorter than the remaining play window.
   */
  async function encodePlaying(seg) {
    const dur = Math.max(0.5, seg.durationSec);
    let seek = Math.max(0, seg.seekSec || 0);
    const fileDur = seg.track?.durationSec ?? seg.track?.durationHint;

    const args = ['-hide_banner', '-loglevel', 'error', '-re'];

    if (typeof fileDur === 'number' && fileDur > 1) {
      seek = seek % fileDur;
      const remainingInFile = fileDur - seek;
      // Loop only when this play window needs more audio than the file has left
      if (remainingInFile < dur - 0.25) {
        args.push('-stream_loop', '-1');
      }
    } else {
      // Unknown duration — loop as safety for short beds
      args.push('-stream_loop', '-1');
    }

    // -ss after -i: accurate decode seek into mp3
    args.push('-i', seg.path, '-ss', String(seek), '-t', String(dur), ...hlsOutputArgs());

    await spawnTracked(
      args,
      `PLAYING ${seg.track?.title || '?'} ${dur.toFixed(1)}s @${seek.toFixed(1)}${args.includes('-stream_loop') ? ' (loop)' : ''}`,
    );
  }

  /**
   * TRANSITION: undeniable equal-power amix fade for full remaining window.
   * acrossfade as secondary fallback only when amix produces no new segments.
   */
  async function encodeTransition(seg) {
    const fadeTotal = seg.fadeSec || TRANSITION_SEC;
    const remaining = Math.max(0.5, seg.durationSec);
    const progress = seg.progressAtStart || 0;
    const fileDur = seg.fromDurationSec ?? seg.fromTrack?.durationSec ?? seg.fromTrack?.durationHint;

    let fromSeek = Math.max(0, seg.fromSeekSec ?? 0);
    let toSeek = Math.max(0, seg.toSeekSec ?? 0);

    // Guarantee remaining of outgoing samples — never start at EOF
    if (typeof fileDur === 'number' && fileDur > 0) {
      const maxSeek = Math.max(0, fileDur - remaining);
      if (fromSeek > maxSeek) {
        console.warn(
          `[live/ffmpeg] fromSeek ${fromSeek.toFixed(1)} past safe max ${maxSeek.toFixed(1)} — clamping`,
        );
        fromSeek = maxSeek;
      }
    }

    // Exact remaining on both inputs → blend length matches schedule (no overrun).
    const need = remaining;

    // Equal-power-ish curves (qsin) + normalize=0 so both decks stay audible in the middle.
    const amixFilter =
      `[0:a]afade=t=out:st=0:d=${need}:curve=qsin[a0];` +
      `[1:a]afade=t=in:st=0:d=${need}:curve=qsin[a1];` +
      `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;

    const acrossfadeFilter = `[0:a][1:a]acrossfade=d=${need}:c1=tri:c2=tri[aout]`;

    function dualInputArgs(filter) {
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-re',
        '-ss',
        String(fromSeek),
        '-t',
        String(need),
        '-i',
        seg.fromPath,
        '-ss',
        String(toSeek),
        '-t',
        String(need),
        '-i',
        seg.toPath,
        '-filter_complex',
        filter,
        '-map',
        '[aout]',
        ...hlsOutputArgs(),
      ];
    }

    const beforeNum = maxSegmentNumber();
    await spawnTracked(
      dualInputArgs(amixFilter),
      `TRANSITION amix-eq ${remaining.toFixed(1)}s/${fadeTotal.toFixed(0)}s (${seg.fromTrack?.title} → ${seg.toTrack?.title}) from@${fromSeek.toFixed(1)} to@${toSeek.toFixed(1)} p0=${progress.toFixed(2)}`,
    );

    if (maxSegmentNumber() <= beforeNum && !aborted) {
      console.warn('[live/ffmpeg] amix produced no new segments — trying acrossfade');
      await spawnTracked(
        dualInputArgs(acrossfadeFilter),
        `TRANSITION acrossfade-fallback ${remaining.toFixed(1)}s`,
      );
    }

    if (maxSegmentNumber() <= beforeNum && !aborted) {
      console.error(
        '[live/ffmpeg] TRANSITION produced no segments — audio may hard-cut; check paths/seeks',
      );
    }

    void MIN_FADE_SEC;
  }

  async function loop() {
    while (!aborted) {
      try {
        const now = Date.now();
        const segs = schedule.upcomingSegments(now, 120);
        const seg = segs[0];
        if (!seg) {
          await sleep(500);
          continue;
        }

        // Deduplicate: if we already encoded this exact remaining slice key, wait for next.
        const key = `${seg.kind}:${seg.absIndex}:${Math.floor(seg.startMs / 1000)}`;
        if (key === lastEncodedKey) {
          await sleep(200);
          continue;
        }

        const waitMs = seg.startMs - Date.now();
        if (waitMs > 50) {
          await sleep(Math.min(waitMs, 2000));
          continue;
        }

        // If we are late into a segment, upcomingSegments already returns remaining duration.
        // Log lag so we can see producer/SSE skew.
        if (waitMs < -1500) {
          console.warn(
            `[live/ffmpeg] producer lag ${(-waitMs / 1000).toFixed(1)}s into ${seg.kind} #${seg.absIndex} — encoding remaining ${seg.durationSec.toFixed(1)}s`,
          );
        }

        if (seg.kind === 'PLAYING') {
          await encodePlaying(seg);
        } else {
          await encodeTransition(seg);
        }
        lastEncodedKey = key;
      } catch (err) {
        console.error('[live/ffmpeg] loop error', err);
        await sleep(1000);
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  return {
    async start() {
      if (running) return;
      running = true;
      aborted = false;
      clearHls();
      nextStartNumber = 0;
      playlistReady = false;
      lastEncodedKey = null;
      fs.writeFileSync(
        path.join(HLS_DIR, 'live.m3u8'),
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n',
      );
      console.info(`[live] HLS producer starting → ${HLS_DIR}/live.m3u8`);
      loop().catch((e) => console.error('[live] producer died', e));
    },
    stop() {
      aborted = true;
      running = false;
      if (currentChild) {
        try {
          currentChild.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    },
    get ready() {
      return playlistReady || fs.existsSync(path.join(HLS_DIR, 'live.m3u8'));
    },
  };
}

/** Quick PATH check. */
export function assertFfmpeg() {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => reject(new Error('ffmpeg not found on PATH — install ffmpeg')));
    child.on('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error('ffmpeg -version failed'));
    });
  });
}

void runFfmpeg;
