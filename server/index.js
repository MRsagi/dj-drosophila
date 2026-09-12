/**
 * DJ Drosophila — 24/7 SHARED live radio server (read-only for visitors).
 *
 * Public clients may ONLY:
 *   - GET /hls/*          shared AAC/HLS (everyone hears the same show)
 *   - GET /api/live/state JSON or SSE (HUD sync)
 *   - GET /api/live/health|/api/live/config
 *
 * There is NO anonymous POST /api/control, skip, or track-change API.
 * Optional /api/admin/* requires ADMIN_TOKEN (never wired into the public UI).
 *
 * Env:
 *   PORT              default 8787 (Docker: 8080)
 *   HOST              default 0.0.0.0
 *   SERVE_DIST        default 1
 *   ENABLE_LAB        default false in production / Docker — hides #lab
 *   PUBLIC_URL        public https URL (Cloudflare Tunnel hostname)
 *   SHOW_SEED         rotation seed
 *   SHOW_START_MS     optional fixed show epoch
 *   ADMIN_TOKEN       optional secret for /api/admin/* (X-Admin-Token header only)
 *   MAX_SSE_CLIENTS   max concurrent SSE connections (default 200)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSchedule } from './schedule.js';
import { createHlsProducer, assertFfmpeg, HLS_DIR } from './ffmpegStream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const SERVE_DIST = process.env.SERVE_DIST !== '0';
const ENABLE_LAB = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ENABLE_LAB || 'false').toLowerCase(),
);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_SSE_CLIENTS = Math.max(1, Number(process.env.MAX_SSE_CLIENTS || 200) || 200);
const SSE_HEARTBEAT_MS = 15_000;
const IS_PROD = process.env.NODE_ENV === 'production' || SERVE_DIST;

function publicConfig() {
  return {
    sharedOnly: true,
    enableLab: ENABLE_LAB,
    publicUrl: PUBLIC_URL || null,
    streamUrl: '/hls/live.m3u8',
    stateUrl: '/api/live/state',
    readOnly: true,
    note: 'Visitors hear the same HLS stream. Clients cannot change the radio.',
  };
}

function adminTokensEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — reject safely first
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    sendJson(res, 404, { error: 'admin API disabled' });
    return false;
  }
  // Header only — never accept ?token= from the query string (leaks via logs/Referer).
  const hdr = req.headers['x-admin-token'];
  const provided = Array.isArray(hdr) ? hdr[0] : hdr;
  if (!adminTokensEqual(provided || '', ADMIN_TOKEN)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, {
    'Content-Length': buf.length,
    ...headers,
  });
  res.end(buf);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
}

function safeJoin(root, reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(reqPath || '').split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  // Relative under root only (strip leading separators; do not strip "..").
  const cleaned = path.normalize(decoded).replace(/^([/\\])+/, '');
  if (!cleaned || cleaned === '.') return null;

  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, cleaned);
  // path.sep prefix check: /root must not match /root-evil/...
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

function tryFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  const cache =
    ext === '.m3u8' || ext === '.ts'
      ? 'no-store, no-cache, must-revalidate'
      : ext === '.mp3'
        ? 'public, max-age=86400'
        : 'public, max-age=300';
  send(res, 200, data, {
    'Content-Type': mime,
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*',
  });
  return true;
}

async function main() {
  await assertFfmpeg();

  const schedule = createSchedule();
  const producer = createHlsProducer(schedule);
  await producer.start();

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();

  const sseTimer = setInterval(() => {
    const state = schedule.getState();
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  }, 500);

  // Keep-alive comments so proxies/browsers do not idle-drop SSE sockets.
  const sseHeartbeat = setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        sseClients.delete(res);
      }
    }
  }, SSE_HEARTBEAT_MS);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      });
      res.end();
      return;
    }

    // Reject anonymous control / writes. Lab UI must never hit these.
    const isAdminPath = pathname.startsWith('/api/admin/');
    const isControlPath =
      pathname.startsWith('/api/control') ||
      pathname.startsWith('/api/skip') ||
      pathname.startsWith('/api/live/control') ||
      pathname.startsWith('/api/live/skip') ||
      pathname.startsWith('/api/live/next');
    const isApiWrite =
      pathname.startsWith('/api/') &&
      req.method !== 'GET' &&
      req.method !== 'OPTIONS' &&
      req.method !== 'HEAD';
    if ((isControlPath || isApiWrite) && !isAdminPath) {
      sendJson(res, 403, {
        error: 'read-only',
        message: 'Shared live radio cannot be controlled by clients. Everyone hears the same stream.',
      });
      return;
    }

    if (pathname === '/api/live/config') {
      sendJson(res, 200, publicConfig());
      return;
    }

    // Optional operator-only status (token required). No track control in MVP.
    if (pathname === '/api/admin/status') {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, {
        ...publicConfig(),
        showStart: schedule.showStartMs,
        seed: schedule.seed,
        tracks: schedule.fileTracks.length,
        state: schedule.getState(),
        sseClients: sseClients.size,
      });
      return;
    }

    // --- Live API (read-only) ---
    if (pathname === '/api/live/state') {
      if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
        // SSE — cap concurrent clients to limit DoS / FD exhaustion
        if (sseClients.size >= MAX_SSE_CLIENTS) {
          sendJson(res, 503, {
            error: 'sse capacity full',
            max: MAX_SSE_CLIENTS,
            message: 'Too many live HUD listeners; retry later or use JSON polling.',
          });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ ...schedule.getState(), enableLab: ENABLE_LAB, sharedOnly: true, readOnly: true })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      sendJson(res, 200, { ...schedule.getState(), enableLab: ENABLE_LAB, sharedOnly: true, readOnly: true });
      return;
    }

    if (pathname === '/api/live/health') {
      sendJson(res, 200, {
        ok: true,
        ffmpeg: true,
        hls: producer.ready,
        showStart: schedule.showStartMs,
        seed: schedule.seed,
        tracks: schedule.fileTracks.length,
        clients: sseClients.size,
        maxSseClients: MAX_SSE_CLIENTS,
        enableLab: ENABLE_LAB,
        publicUrl: PUBLIC_URL || null,
        readOnly: true,
        sharedOnly: true,
      });
      return;
    }

    // --- HLS ---
    if (pathname.startsWith('/hls/')) {
      const file = safeJoin(HLS_DIR, pathname.slice('/hls/'.length));
      if (tryFile(res, file)) return;
      send(res, 404, 'HLS segment not found\n', { 'Content-Type': 'text/plain' });
      return;
    }

    // Alias used by some players
    if (pathname === '/live.m3u8') {
      if (tryFile(res, path.join(HLS_DIR, 'live.m3u8'))) return;
      send(res, 404, 'not ready\n', { 'Content-Type': 'text/plain' });
      return;
    }

    // --- Static: dist (built app) then public (crate mp3s etc.) ---
    if (SERVE_DIST && fs.existsSync(DIST)) {
      if (pathname === '/' || pathname === '') {
        if (tryFile(res, path.join(DIST, 'index.html'))) return;
      }
      const distFile = safeJoin(DIST, pathname);
      if (tryFile(res, distFile)) return;
    }

    // public/crate and other assets (dev / fallback)
    if (pathname.startsWith('/crate/') || pathname.startsWith('/models/')) {
      const pubFile = safeJoin(PUBLIC, pathname);
      if (tryFile(res, pubFile)) return;
    }

    // SPA fallback for hash routes when serving dist
    if (SERVE_DIST && fs.existsSync(path.join(DIST, 'index.html')) && !pathname.startsWith('/api/')) {
      if (tryFile(res, path.join(DIST, 'index.html'))) return;
    }

    sendJson(res, 404, { error: 'not found', path: pathname });
  });

  server.on('error', (err) => {
    console.error('[live] server error', err);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const st = schedule.getState();
    console.info(`[live] DJ Drosophila shared radio on http://${HOST}:${PORT}`);
    console.info(`[live] showStart=${new Date(schedule.showStartMs).toISOString()} seed=${schedule.seed}`);
    console.info(`[live] tracks=${schedule.fileTracks.length} cycle≈${schedule.cycleSec.toFixed(0)}s`);
    console.info(`[live] now: ${st.statusLine} · ${st.trackA?.title} / ${st.trackB?.title}`);
    console.info(`[live] HLS /hls/live.m3u8 · SSE /api/live/state (max ${MAX_SSE_CLIENTS}) · health /api/live/health`);
    console.info(`[live] Club UI: http://127.0.0.1:${PORT}/#club`);
    console.info(`[live] ENABLE_LAB=${ENABLE_LAB} PUBLIC_URL=${PUBLIC_URL || '(unset)'} readOnly=true`);
    if (ADMIN_TOKEN) console.info('[live] /api/admin/status available with ADMIN_TOKEN');
  });

  function shutdown() {
    console.info('[live] shutting down…');
    clearInterval(sseTimer);
    clearInterval(sseHeartbeat);
    producer.stop();
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[live] fatal', err);
  process.exit(1);
});
