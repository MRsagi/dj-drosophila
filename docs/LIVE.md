# Shared 24/7 live radio

Everyone who opens the **Club** hears the **same** HLS stream at the same wall-clock time.  
Clients are **read-only**: there is no public API to skip, cue, or override the radio.

`#lab` is a **local private mix** for development only. In Docker / production it is **off** (`ENABLE_LAB=false`). A lab tab can never change what other visitors hear.

## Architecture

| Piece | Role |
|--------|------|
| `server/schedule.js` | Wall-clock PLAYING → TRANSITION schedule from CC0 files in `public/crate/` + `src/crate/manifest.json` |
| `server/ffmpegStream.js` | ffmpeg → `server/hls/live.m3u8` (+ `.ts` segments). Acrossfade on TRANSITION; amix fade fallback |
| `server/index.js` | Serves HLS, SSE `/api/live/state`, static `dist/`, read-only config/health |
| Frontend `?` / auto-detect | `<audio>` + **hls.js** plays shared stream; HUD / FlyDJ follow SSE (no local `setEngine` audio) |

### Public APIs (read-only)

- `GET /hls/live.m3u8` (+ segments) — shared audio
- `GET /api/live/state` — JSON snapshot **or** `Accept: text/event-stream` SSE
- `GET /api/live/config` — `{ sharedOnly, enableLab, readOnly, streamUrl, … }`
- `GET /api/live/health` — liveness for Docker / Tunnel

Any `POST /api/control`, `/api/skip`, etc. returns **403**.  
Optional `GET /api/admin/status` requires header `X-Admin-Token: $ADMIN_TOKEN` (not exposed in the UI).

## Requirements

- **Node 20+**
- **ffmpeg on PATH** (AAC encode + `acrossfade` / `amix`)
- CC0 mp3s under `public/crate/` (see `LICENSES.md`)

```bash
# Debian/Ubuntu
sudo apt-get install -y ffmpeg
ffmpeg -version
```

## Local run

```bash
npm install
npm run build          # static lab+club assets still build
npm run live           # starts shared radio on :8787 (serves dist/)
# or
npm run live:build     # build then live
```

Open **http://127.0.0.1:8787/#club** — engage the gate; both browser profiles hear the same titles/state.

Local **dev with lab** (private mix, does not affect any live server):

```bash
ENABLE_LAB=true npm run live   # lab nav visible; still no client→server control
# or plain Vite without live server:
npm run dev                    # #lab works; club is per-tab local mix
```

`npm run build` alone remains a static site (no shared audio until a live host serves it).

## Docker (Ponytail / Sagi’s machine)

```bash
cp .env.example .env
# edit PUBLIC_URL=https://your.domain
docker compose up -d --build
curl -s http://127.0.0.1:8080/api/live/health | jq
```

Defaults:

- `ENABLE_LAB=false` — `#lab` hidden; club is always shared live
- `PORT=8080` on the host (compose maps `${PORT:-8080}:8080`)
- Restart policy `unless-stopped` for 24/7

### Cloudflare Tunnel

1. Run the container so it listens on `127.0.0.1:8080` (or your `PORT`).
2. Point a Tunnel ingress at that origin, e.g. `http://127.0.0.1:8080`.
3. Set env to match the public hostname:

```env
PORT=8080
PUBLIC_URL=https://dj.yourdomain.com
ENABLE_LAB=false
SHOW_SEED=dj-drosophila
# ADMIN_TOKEN=  # optional; leave empty
```

4. Confirm:

```bash
curl -s https://dj.yourdomain.com/api/live/config
# enableLab:false, sharedOnly:true, readOnly:true
```

Visitors open `https://dj.yourdomain.com/#club` only. Hash `#lab` redirects to `#club`.

### Fly.io / Railway / VPS

Same image. Install/link **ffmpeg** in the image (already in `Dockerfile`).  
Keep a single always-on instance — shared live needs one continuous encoder + schedule.

| Env | Default | Notes |
|-----|---------|--------|
| `PORT` | `8080` (Docker) / `8787` (npm live) | HTTP listen |
| `HOST` | `0.0.0.0` | Bind address |
| `PUBLIC_URL` | empty | Public https URL (docs/health) |
| `ENABLE_LAB` | `false` | Must stay false on public deploy |
| `SHOW_SEED` | `dj-drosophila` | Deterministic track rotation |
| `SHOW_START_MS` | boot time | Optional fixed show epoch (ms) |
| `ADMIN_TOKEN` | empty | Enables `/api/admin/status` only |
| `SERVE_DIST` | `1` | Serve Vite `dist/` |

## ffmpeg assumptions

- `ffmpeg` + `ffprobe` on PATH inside the container/host
- Encoders: **libaac** / native `aac`, demux **mp3**
- Filters: `acrossfade` (preferred on TRANSITION), fallback `afade` + `amix`
- HLS: mux `hls` → MPEG-TS segments, sliding window (`delete_segments`), `omit_endlist`
- Realtime pacing: `-re` so wall-clock schedule and audio stay aligned

If acrossfade fails for a pair, the producer logs a warning and uses short fade-out/fade-in amix so the stream stays continuous.

## Verify “lab cannot override everyone”

1. Start live server (`docker compose up` or `npm run live`).
2. Open two browsers on `#club` → same `trackA` / `trackB` / `state` from SSE; same audible HLS.
3. With `ENABLE_LAB=false`, `#lab` is hidden and redirects to `#club`.
4. Even with `ENABLE_LAB=true` (dev): lab only runs **Web Audio in that tab**. It does not POST to the server; other visitors keep the shared HLS.
5. `curl -X POST http://127.0.0.1:8080/api/control` → **403 read-only**.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Static Vite build (lab+club assets) |
| `npm run live` | Always-on Node live server (needs ffmpeg) |
| `npm run live:build` | `build` then `live` |
