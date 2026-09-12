# Shared 24/7 live radio

Everyone who opens the **Club** hears the **same** HLS stream at the same wall-clock time.  
Clients are **read-only**: there is no public API to skip, cue, or override the radio.

`#lab` is a **local private mix** for development only. In Docker / production it is **off** (`ENABLE_LAB=false`). A lab tab can never change what other visitors hear.

## Architecture

| Piece | Role |
|--------|------|
| `server/djMind.js` | **Fly DJ mind** — decides *when* to leave and *how long* to blend (≈8–32s), with sci-comedy reasons |
| `server/schedule.js` | Show log of mind decisions → wall-clock PLAYING → TRANSITION; ffprobe durations; shared timeline |
| `server/liquidsoapPlaylist.js` | Show log → annotated `radio.m3u` (`liq_cue_in` / `liq_cue_out` / `liq_cross_duration`) |
| `server/radio.liq` + `liquidsoapStream.js` | **Default engine** — one Liquidsoap daemon, cue_cut-at-request, `crossfade`, HLS + optional Icecast |
| `server/ffmpegStream.js` | Dev fallback if `liquidsoap` is not on PATH — ffmpeg → `server/hls/live.m3u8` |
| `server/index.js` | Selects `STREAM_ENGINE`, serves HLS, SSE `/api/live/state`, static `dist/`, read-only config/health |
| Frontend `?` / auto-detect | `<audio>` + **hls.js**; HUD / FlyDJ follow SSE (`xfaderEdge`, `mindReason`) |

Web clients are unchanged: they still fetch `/hls/live.m3u8` and `/api/live/state`. Liquidsoap writes MPEG-TS segments into `server/hls/` (media playlist `live.m3u8`, master `index.m3u8`).

```
Mind / schedule  →  radio.m3u  →  Liquidsoap playlist (watch)
                                 →  cue in/out from annotate
                                 →  crossfade (fade.in / fade.out / smooth_add)
                                 →  fallback (quiet sine bed)
                                 →  output.file.hls  →  /hls/live.m3u8
                                 →  output.icecast   (only if ICECAST_HOST is set)
```

### Public APIs (read-only)

- `GET /hls/live.m3u8` (+ segments) — shared audio
- `GET /api/live/state` — JSON snapshot **or** `Accept: text/event-stream` SSE
- `GET /api/live/config` — `{ sharedOnly, enableLab, readOnly, streamUrl, … }`
- `GET /api/live/health` — liveness for Docker / Tunnel (`streamEngine: "liquidsoap" | "ffmpeg"`, `hls`, `icecast`)

Any `POST /api/control`, `/api/skip`, etc. returns **403**.  
Optional `GET /api/admin/status` requires header `X-Admin-Token: $ADMIN_TOKEN` (not exposed in the UI).
Query-string tokens are **rejected**; comparison uses `crypto.timingSafeEqual`.

### SSE limits (DoS guard)

- Max concurrent SSE clients: **`MAX_SSE_CLIENTS`** (default **200**). When full, new `Accept: text/event-stream` requests get **503** (JSON polling still works).
- State events ~every 500ms; **heartbeat** comment every 15s to keep proxies from idle-dropping connections.
- Static/HLS paths use a hardened `safeJoin` (`path.resolve` + `path.sep` prefix check) to block traversal.


## DJ mind (the fly’s set)

North star: **“Hey, I trained a fruit fly to DJ — this is its set.”** Everyone on the shared stream hears the same decisions.

### How it chooses when / how

1. **Min play** (≥ ~30s, shorter only for tiny beds) — xfader stays **glued to an edge** while PLAYING (~90% of the time).
2. Each **mind tick** (~2s) scores: synthetic energy arc, phrase proximity (BPM/bars), novelty vs recent tracks, BPM/energy match to candidates, patience.
3. Soft leave only after a cushion past min play, usually on a **phrase gate**, with a comedy reason in SSE (`mindReason`), e.g. `DNa02 bias → energy crash · leave in ~4 bars`.
4. **Fade length is chosen** (not a fixed timer): roughly **8–32s** from style blend speed, energy/BPM compatibility, and a little seeded jitter — longer on novelty / compatible pairs, shorter when aggressive.
5. **Must-leave before EOF**: `leaveAt ≤ duration − fadeSec − 1` so acrossfade still has outgoing energy (never “play to silence then fake blend”).
6. Decisions append to an **append-only show log** (`server/cache/show-log.json`) keyed by show time — deterministic from `SHOW_SEED` + history so reconnecting clients stay on the same set.

### Crossfade / Liquidsoap contract

The fly still decides leave time and fade length; Liquidsoap **executes** the blend in one process (no ffmpeg spawn per PLAYING/TRANSITION, no PTS reset across HLS segments).

- Each show-log row becomes one `annotate:` request in `server/cache/radio.m3u`.
- `liq_cue_in` / `liq_cue_out` cut the file at the mind’s leave point (cue processing is built into request resolution; `cue_cut` was removed in Liquidsoap 2.2.4).
- `liq_fade_in` of track N is the previous row’s `fadeSec`; `liq_fade_out` is this row’s `fadeSec`; `liq_cross_duration` is the overlap (`crossfade` `override_duration`).
- Transition helper: `fade.out` + `fade.in` (sin) mixed with `smooth_add` (`add(normalize=false)`).
- Playlist `mode="normal"`, `loop=false`, `reload_mode="watch"`. Node writes **remaining** (not-yet-played) rows so a reload does not replay history, and skips rewrites in the last ~40s of PLAYING so the prefetch buffer for the next crossfade stays intact.
- `fallback` onto a quiet sine bed so the encoder never stalls if the M3U runs dry.
- HLS: `output.file.hls` → 2s MPEG-TS segments in `server/hls/`. Club clients keep using `/hls/live.m3u8`.
- Icecast: `output.icecast` only when `ICECAST_HOST` is non-empty. HLS is independent and always on.

### ffmpeg fallback contract

Used when `STREAM_ENGINE=ffmpeg` or `liquidsoap` is missing locally:

- PLAYING encodes from seek for the mind’s play window **once** (loops only if the file is shorter than the window).
- TRANSITION `fromSeek` = play end (with `fadeSec` of audio left); `toSeek` = start of next (or mid-join).
- Preferred filter: equal-power `afade` + `amix` for the full `fadeSec`; `acrossfade` fallback.
- HLS `-start_number` advances by **max segment index + 1** (never by file count — `delete_segments` would rewind otherwise).

### HUD

SSE `mindReason` + `xfaderEdge` drive the club HUD. During TRANSITION the xfader knob travels with the blend; pill shows `LIVE · TRANSITION`.

## Requirements

- **Node 20+**
- **ffmpeg / ffprobe on PATH** (crate duration probes; also the local HLS fallback)
- **liquidsoap 2.2.4+ on PATH** for the production engine (Debian Trixie: `apt-get install liquidsoap` → 2.3.x). Optional locally — the server logs a notice and falls back to ffmpeg.
- CC0 mp3s under `public/crate/` (see `LICENSES.md`)

```bash
# Debian/Ubuntu (Trixie / production-like)
sudo apt-get install -y liquidsoap ffmpeg
liquidsoap --version
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
| `SHOW_SEED` | `dj-drosophila` | Deterministic rotation + mind RNG |
| `DJ_STYLE` | `psy-peak` | Mind style lane: `psy-peak` / `stadium-hype` / `bass-blender` |
| `SHOW_START_MS` | boot time | Optional fixed show epoch (ms) |
| `ADMIN_TOKEN` | empty | Enables `/api/admin/status` only (`X-Admin-Token` header) |
| `MAX_SSE_CLIENTS` | `200` | Cap concurrent SSE HUD listeners (503 when full) |
| `SERVE_DIST` | `1` | Serve Vite `dist/` |
| `STREAM_ENGINE` | `auto` locally / `liquidsoap` in Docker | `liquidsoap` \| `ffmpeg` \| `auto`. Auto uses liquidsoap when the binary exists, otherwise ffmpeg with a log notice. |
| `ICECAST_HOST` | empty | If set, Liquidsoap also streams to Icecast. HLS is unchanged. |
| `ICECAST_PORT` | `8000` | Icecast port |
| `ICECAST_PASSWORD` | empty | Icecast source password |
| `ICECAST_MOUNT` | `/drosophila` | Icecast mount |
| `ICECAST_USER` | `source` | Icecast source user |

## Liquidsoap assumptions

- **Liquidsoap 2.2.4+** (image uses Debian Trixie 2.3.x). Bookworm’s 2.1.3 cannot run `server/radio.liq`.
- Cue points: annotate `liq_cue_in` / `liq_cue_out` (request-layer successor to `cue_cut`)
- Transitions: `cross` + `fade.in` / `fade.out` / `smooth_add`; duration from `liq_cross_duration`
- HLS: `%ffmpeg` MPEG-TS AAC, `segment_duration=2`, media playlist `live.m3u8`
- Icecast skipped cleanly when `ICECAST_HOST` is unset
- Check the script without streaming: `liquidsoap -c server/radio.liq` (needs a dummy `server/cache/radio.m3u`)

## ffmpeg assumptions (fallback engine)

- `ffmpeg` + `ffprobe` on PATH inside the container/host
- Encoders: **libaac** / native `aac`, demux **mp3**
- Filters: `acrossfade` (preferred on TRANSITION; mind-chosen `fadeSec`), fallback `afade` + `amix`
- Durations: **ffprobe** at crate load (`durationSec`) so play windows leave room for the fade
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
| `npm run live` | Always-on Node live server (liquidsoap if present, else ffmpeg) |
| `npm test` | Annotated M3U / cue-math unit tests |
| `npm run live:build` | `build` then `live` |
