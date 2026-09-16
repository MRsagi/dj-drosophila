# MaleCNS motif (v1)

**Date:** 2026-09-14  
**Status:** draft — awaiting review  
**ADRs:** 0001 liquidsoap-only encoder, 0002 club-only no lab

Replace the three browser LIF toys (DN-L, DN-R, GF) with a **frozen identified motif** from `male-cns:v1.0`. The graph lives in git and in the Docker image. Node steps it from the **show clock**. Visitors see the same rates over SSE. No neuPrint token in production. No whole-brain. No audience swarm. No live training.

## Goal

The club’s descending-neuron **names are bodyIds that came from neuPrint**, with **real synapse counts** between them. Behavior can still be a cartoon (currents from the show clock, not photoreceptors). The honesty is the wiring, not a 166k-cell runtime.

## Out of scope

- Whole-brain or “few hundred cells” beyond this motif
- Live `neuprint.janelia.org` from Docker or the browser
- Audience instances, DJ-reads-the-floor, plasticity / co-training
- Changing Liquidsoap, the crate, or leave-mind scoring
- Eyes: still local HLS tap → lattice (not MaleCNS ommatidia)

## Snapshot (data)

**Fetch (local only).** Script: `scripts/fetch-male-cns-motif.py`. Uses `NEUPRINT_TOKEN` from the environment. Dataset `male-cns:v1.0`, server `https://neuprint.janelia.org`.

Queries, in order, **regex-tolerant**:

1. Type / instance matching `DNa02` — expect a left and a right if instance strings allow; otherwise take up to two bodies and tag side `unknown`.
2. Giant Fiber / `GF` / `DNp01` — take the first verified hit; record which string matched.
3. Empty query → a `misses[]` entry, **not** a synthetic cell.

Then: among returned `bodyId`s, fetch synapse counts (A→B). Keep the **strongest 40 edges** (by count). If that set is tiny, one hop to at most **8** extra partners that look motor-ish (`MN`, `leg`, `wing` in type/instance) **only if** total cells stay **≤ 24**. Weights are raw synapse counts.

**Roles written at fetch time** (not guessed in the club):

| role | how assigned |
|------|----------------|
| `dnL` | DNa02 with left-ish instance, else first DNa02 |
| `dnR` | DNa02 with right-ish instance, else second DNa02 |
| `gf`  | GF / DNp01 hit |
| `other` | everyone else |

If a role has no cell, it is omitted. Club treats missing role as rate `0`. HUD: `motif: none` if no file; `motif: miss gf` (etc.) if the JSON exists but that role is absent. `status` is `none` (no file), `ok` (at least one cell), `partial` (cells plus nonempty `misses[]`).

**Committed files:**

- `src/brain/maleCnsMotif.json` — cells, edges, dataset, `fetchedAt`, `misses`, query log summary
- `src/brain/maleCnsMotif.fetched.md` — human note: what matched, what missed

Docker `COPY`s the repo; no extra download. `LICENSES.md` already credits MaleCNS CC BY; add one line that this JSON is a derived slice, not the full dump.

Re-fetch is manual: run the script, commit new JSON.

## Server step

On boot, load the JSON (sibling of show clock). Missing/empty file: radio still runs; `motif` on the snapshot is `{ cells: [], status: "none" }`.

Each SSE tick (**500 ms**, same timer as today’s show clock):

1. Read public show state: `state`, `xfaderEdge`, `playedSec`, `plannedSec`, `transitionProgress`.
2. Build currents:
   - **PLAYING:** current on `dnL` if edge is A (`xfaderEdge < 0`), on `dnR` if B. Magnitude from `playedSec/plannedSec` (0.2–1.0).
   - **TRANSITION:** both `dnL` and `dnR` mixed by `xfaderEdge`; `gf` current peaks mid-blend (`sin(π · progress)`).
3. Step every cell: leaky rate, **α = 0.2** per 500 ms tick.  
   `v ← (1-α)v + α(I_syn + I_ext)`  
   `I_syn = Σ_pre w_norm · rate_pre`  
   `w_norm = w / max(w)` on the snapshot (max weight 1) so the graph cannot blow up.  
   `rate = 40 · max(0, v)` so HUD Hz is in the same ballpark as today’s LIF.
4. Attach to **public snapshot** only:

```json
"motif": {
  "dataset": "male-cns:v1.0",
  "status": "ok" | "partial" | "none",
  "cells": [{ "bodyId": 1, "type": "DNa02", "instance": "…", "role": "dnL", "rate": 12.3 }]
}
```

No synapse list, no paths, no token. Encoder-private fields stay off SSE (`showClock.publicSnapshot` grows an explicit `motif` key).

Tests: load a **fixture** motif (not neuPrint); PLAYING A drives `dnL` more than `dnR`; TRANSITION midpoint drives `gf`; missing file → `status: "none"`.

## Club

`createClubFrame` **stops** constructing `createCircuit()` for DN-L/R/GF. It reads `liveClient.state.motif`.

Map `role` → existing consumers:

- `dnL` / `dnR` rates → fly steer, booth filter  
- `gf` rate + a rising-edge (rate crosses a threshold with cooldown already in booth) → jump / rare loop  

Eyes unchanged (local FFT). Booth FX still local (dry encoder) but **driven by shared motif rates**, so two browsers agree on lean/loop aside from existing slew.

HUD: `type bodyId · N Hz` for the three roles. If `status !== "ok"`, one line `motif: none` or `motif: miss gf`.

No `#lab`. No second floor view.

## Failure

| case | behavior |
|------|----------|
| No JSON | Radio on, `motif.status = none`, rates empty |
| JSON but role missing | That channel 0, HUD miss |
| neuPrint fetch fails on a laptop | Do not commit a partial lie; keep previous JSON |
| Token missing when fetching | Script exits non-zero; says export `NEUPRINT_TOKEN` |

Liquidsoap fail-closed is unchanged.

## Files (intended)

| path | role |
|------|------|
| `scripts/fetch-male-cns-motif.py` | local neuPrint → JSON |
| `src/brain/maleCnsMotif.json` | committed snapshot |
| `server/motif.js` | load + step; used by schedule/snapshot |
| `server/showClock.js` | pass `motif` through public snapshot |
| `src/club/frame.js` | consume SSE rates; delete local LIF circuit for DNs |
| `src/brain/circuit.js` | stop using from club/main; delete if nothing else imports it |

## Success

- `maleCnsMotif.json` contains real `bodyId`s from `male-cns:v1.0` (or documented misses).  
- Two browsers, same SSE `motif.cells[].rate`.  
- HUD shows those types, not “DN-L toy”.  
- Production has no neuPrint token.

## Later (not this spec)

Subgraph B (optic → DN → VNC, server-side, hundreds of cells). Audience swarm. DJ reading the floor. Whole-brain GPU.
