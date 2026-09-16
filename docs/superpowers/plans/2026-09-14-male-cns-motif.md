# MaleCNS Motif Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three browser LIF toys with a frozen `male-cns:v1.0` motif stepped on the server from the show clock and shown on SSE.

**Architecture:** Local neuPrint fetch writes `src/brain/maleCnsMotif.json`. Docker copies it. `server/motif.js` loads and steps a leaky-rate graph each 500 ms SSE tick. Public show-clock snapshot carries `motif` (cells + rates only). Club frame reads those rates for fly/booth/HUD and drops `createCircuit()`.

**Tech Stack:** Node 22 ESM, `node --test`, neuPrint Python client (fetch script only), existing Vite club.

**Spec:** `docs/superpowers/specs/2026-09-14-male-cns-motif-design.md`

## Global Constraints

- Dataset: `male-cns:v1.0` at `https://neuprint.janelia.org`
- No `NEUPRINT_TOKEN` in Docker, browser, or committed files
- No whole-brain, audience swarm, or live training
- Liquidsoap remains the only encoder; fail-closed unchanged
- Public SSE still strips encoder paths; `motif` is the only new public key
- Club copy stays dry (no “toy CPG”, no gag/truth)
- Tests never call neuPrint; use fixtures
- `node --test` is the test runner

## File map

| File | Responsibility |
|------|----------------|
| `server/motif.js` | Load JSON, assign currents from show state, step graph, emit public `motif` |
| `server/motif.test.js` | Fixture-driven step tests |
| `server/showClock.js` | Pass `motif` through `publicSnapshot` |
| `server/schedule.js` | Call `motif.step(show)` inside `snapshot()` |
| `scripts/fetch-male-cns-motif.py` | Local neuPrint → JSON + fetched.md |
| `src/brain/maleCnsMotif.json` | Committed freeze |
| `src/brain/maleCnsMotif.fetched.md` | What matched / missed |
| `src/club/frame.js` | Consume SSE rates; no local DN circuit |
| `src/main.js` | Stop creating `createCircuit()` |
| `src/ui/hud.js` | Motif HUD line |
| `LICENSES.md`, `docs/NEUPRINT.md`, `CONTEXT.md` | Credit + glossary |

---

### Task 1: Motif graph step (pure)

**Files:**
- Create: `server/motif.js`
- Test: `server/motif.test.js`

**Interfaces:**
- Consumes: none
- Produces:
  - `createMotif(graph | null) → { step(show), snapshot() }`
  - `step(show: { state, xfaderEdge, playedSec, plannedSec, transitionProgress }) → publicMotif`
  - `publicMotif: { dataset, status: 'ok'|'partial'|'none', cells: Array<{ bodyId, type, instance, role, rate }> }`
  - Graph JSON: `{ dataset, fetchedAt, misses: string[], cells: Array<{ bodyId, type, instance, role }>, edges: Array<{ pre, post, w }> }`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMotif } from './motif.js';

const fixture = {
  dataset: 'male-cns:v1.0',
  fetchedAt: '2026-09-14T00:00:00Z',
  misses: [],
  cells: [
    { bodyId: 1, type: 'DNa02', instance: 'DNa02_L', role: 'dnL' },
    { bodyId: 2, type: 'DNa02', instance: 'DNa02_R', role: 'dnR' },
    { bodyId: 3, type: 'DNp01', instance: 'GF', role: 'gf' },
  ],
  edges: [
    { pre: 1, post: 3, w: 10 },
    { pre: 2, post: 3, w: 10 },
  ],
};

describe('motif step', () => {
  it('status none when graph is null', () => {
    const m = createMotif(null);
    const out = m.step({ state: 'PLAYING', xfaderEdge: -1, playedSec: 10, plannedSec: 40, transitionProgress: null });
    assert.equal(out.status, 'none');
    assert.equal(out.cells.length, 0);
  });

  it('PLAYING A drives dnL more than dnR', () => {
    const m = createMotif(fixture);
    let out;
    for (let i = 0; i < 8; i++) {
      out = m.step({ state: 'PLAYING', xfaderEdge: -1, playedSec: 20, plannedSec: 40, transitionProgress: null });
    }
    const dnL = out.cells.find((c) => c.role === 'dnL').rate;
    const dnR = out.cells.find((c) => c.role === 'dnR').rate;
    assert.ok(dnL > dnR + 2, `dnL ${dnL} dnR ${dnR}`);
    assert.equal(out.status, 'ok');
  });

  it('TRANSITION midpoint drives gf', () => {
    const m = createMotif(fixture);
    let out;
    for (let i = 0; i < 8; i++) {
      out = m.step({ state: 'TRANSITION', xfaderEdge: 0, playedSec: 0, plannedSec: 16, transitionProgress: 0.5 });
    }
    const gf = out.cells.find((c) => c.role === 'gf').rate;
    assert.ok(gf > 5, `gf ${gf}`);
  });

  it('partial when misses nonempty', () => {
    const m = createMotif({ ...fixture, misses: ['DNa02'] });
    const out = m.step({ state: 'PLAYING', xfaderEdge: -1, playedSec: 10, plannedSec: 40, transitionProgress: null });
    assert.equal(out.status, 'partial');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/motif.test.js`  
Expected: FAIL (cannot find module `./motif.js`)

- [ ] **Step 3: Write `server/motif.js`**

```js
const ALPHA = 0.2;
const RATE_SCALE = 40;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function externalCurrents(show) {
  const I = { dnL: 0, dnR: 0, gf: 0 };
  const planned = Math.max(1, Number(show.plannedSec) || 1);
  const frac = clamp((Number(show.playedSec) || 0) / planned, 0.2, 1);
  const xf = Number(show.xfaderEdge);
  const x = Number.isFinite(xf) ? xf : -1;
  if (show.state === 'PLAYING') {
    if (x < 0) I.dnL = frac;
    else I.dnR = frac;
  } else if (show.state === 'TRANSITION') {
    I.dnL = 0.5 * (1 - x);
    I.dnR = 0.5 * (1 + x);
    const p = clamp(Number(show.transitionProgress) || 0, 0, 1);
    I.gf = Math.sin(Math.PI * p);
  }
  return I;
}

export function createMotif(graph) {
  if (!graph || !Array.isArray(graph.cells) || graph.cells.length === 0) {
    const empty = { dataset: graph?.dataset || 'male-cns:v1.0', status: 'none', cells: [] };
    return { step() { return empty; }, snapshot() { return empty; } };
  }
  const cells = graph.cells.map((c) => ({ ...c, v: 0, rate: 0 }));
  const byId = new Map(cells.map((c) => [c.bodyId, c]));
  const maxW = Math.max(1, ...((graph.edges || []).map((e) => Number(e.w) || 0)));
  const edges = (graph.edges || []).map((e) => ({
    pre: e.pre,
    post: e.post,
    wn: (Number(e.w) || 0) / maxW,
  }));
  const status = Array.isArray(graph.misses) && graph.misses.length ? 'partial' : 'ok';
  const dataset = graph.dataset || 'male-cns:v1.0';

  function publicCells() {
    return cells.map((c) => ({
      bodyId: c.bodyId,
      type: c.type,
      instance: c.instance || '',
      role: c.role,
      rate: c.rate,
    }));
  }

  function step(show) {
    const Iext = externalCurrents(show);
    const syn = new Map(cells.map((c) => [c.bodyId, 0]));
    for (const e of edges) {
      const pre = byId.get(e.pre);
      if (!pre) continue;
      syn.set(e.post, (syn.get(e.post) || 0) + e.wn * (pre.v || 0));
    }
    for (const c of cells) {
      const ext = Iext[c.role] || 0;
      const isyn = syn.get(c.bodyId) || 0;
      c.v = (1 - ALPHA) * c.v + ALPHA * (isyn + ext);
      c.rate = RATE_SCALE * Math.max(0, c.v);
    }
    return { dataset, status, cells: publicCells() };
  }

  return {
    step,
    snapshot() {
      return { dataset, status, cells: publicCells() };
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test server/motif.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/motif.js server/motif.test.js
git commit -m "Add MaleCNS motif leaky-rate stepper"
```

---

### Task 2: Show clock + schedule wire

**Files:**
- Modify: `server/showClock.js`
- Modify: `server/showClock.test.js`
- Modify: `server/schedule.js` (`snapshot()`)
- Modify: `package.json` (`test` script add `server/motif.test.js`)

**Interfaces:**
- Consumes: `createMotif` from Task 1
- Produces: `publicSnapshot(st)` copies `st.motif` when present; `schedule.snapshot()` includes live motif rates

- [ ] **Step 1: Failing test in `showClock.test.js`**

```js
it('passes motif through when present', () => {
  const pub = publicSnapshot({
    state: 'PLAYING',
    motif: { dataset: 'male-cns:v1.0', status: 'ok', cells: [{ bodyId: 1, role: 'dnL', rate: 9 }] },
  });
  assert.equal(pub.motif.status, 'ok');
  assert.equal(pub.motif.cells[0].role, 'dnL');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test server/showClock.test.js`  
Expected: FAIL (`pub.motif` undefined)

- [ ] **Step 3: Add `'motif'` to `PUBLIC_KEYS` in `showClock.js`**

- [ ] **Step 4: Tests pass**

Run: `node --test server/showClock.test.js`  
Expected: PASS

- [ ] **Step 5: Wire schedule**

In `server/schedule.js`:

```js
import { createMotif } from './motif.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MOTIF_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/brain/maleCnsMotif.json');

function loadMotifGraph() {
  try {
    return JSON.parse(fs.readFileSync(MOTIF_PATH, 'utf8'));
  } catch {
    return null;
  }
}
```

Inside `createSchedule`, after `getState` is defined:

```js
const motif = createMotif(loadMotifGraph());

function snapshot(nowMs) {
  const st = getState(nowMs);
  st.motif = motif.step({
    state: st.state,
    xfaderEdge: st.xfaderEdge,
    playedSec: st.playedSec,
    plannedSec: st.plannedSec,
    transitionProgress: st.transitionProgress,
  });
  return publicSnapshot(st);
}
```

Replace the existing `snapshot(nowMs) { return publicSnapshot(getState(nowMs)); }` with that function.

Until Task 4 writes the JSON, `loadMotifGraph()` returns null and `status` is `none` — radio still runs.

- [ ] **Step 6: Run existing tests**

Run: `node --test server/showClock.test.js server/motif.test.js server/djMind.test.js`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/showClock.js server/showClock.test.js server/schedule.js package.json
git commit -m "Put motif rates on the public show clock"
```

---

### Task 3: Fetch script + freeze

**Files:**
- Create: `scripts/fetch-male-cns-motif.py`
- Create: `src/brain/maleCnsMotif.json` (from the script, or a documented empty freeze if neuPrint is unreachable)
- Create: `src/brain/maleCnsMotif.fetched.md`

**Interfaces:**
- Consumes: `NEUPRINT_TOKEN`, dataset `male-cns:v1.0`
- Produces: JSON matching Task 1 graph shape (`cells[].role` assigned at fetch)

- [ ] **Step 1: Write `scripts/fetch-male-cns-motif.py`**

```python
#!/usr/bin/env python3
"""Local neuPrint freeze for DJ Drosophila. Never runs in Docker."""
import json, os, sys, datetime
from pathlib import Path

TOKEN = os.environ.get("NEUPRINT_TOKEN", "").strip()
if not TOKEN:
    sys.exit("export NEUPRINT_TOKEN (neuPrint account token). Refusing to write a fake snapshot.")

from neuprint import Client, fetch_neurons, fetch_adjacencies, NeuronCriteria as NC

DATASET = "male-cns:v1.0"
OUT = Path(__file__).resolve().parents[1] / "src/brain/maleCnsMotif.json"
NOTE = Path(__file__).resolve().parents[1] / "src/brain/maleCnsMotif.fetched.md"

client = Client("https://neuprint.janelia.org", dataset=DATASET, token=TOKEN)

def q_type(*patterns):
    for p in patterns:
        try:
            df, _ = fetch_neurons(NC(type=p, regex=True))
        except Exception as e:
            print(f"query {p!r} failed: {e}", file=sys.stderr)
            continue
        if df is not None and len(df):
            return p, df
    return None, None

misses = []
cells = []
seen = set()

def add_rows(df, default_role="other"):
    if df is None:
        return
    for row in df.to_dict("records"):
        bid = int(row["bodyId"])
        if bid in seen:
            continue
        seen.add(bid)
        inst = str(row.get("instance") or "")
        typ = str(row.get("type") or "")
        cells.append({"bodyId": bid, "type": typ, "instance": inst, "role": default_role})

p, df = q_type("DNa02.*", "DNa02")
if df is None:
    misses.append("DNa02")
else:
    add_rows(df, "other")

p2, df2 = q_type("DNp01.*", "^GF$", "Giant Fiber.*", ".*giant.fiber.*")
if df2 is None:
    misses.append("GF/DNp01")
else:
    add_rows(df2, "other")

def side(inst):
    u = inst.upper()
    if "_L" in u or u.endswith("L") or "LEFT" in u: return "L"
    if "_R" in u or u.endswith("R") or "RIGHT" in u: return "R"
    return "?"

dna = [c for c in cells if "DNA02" in c["type"].upper()]
dna_l = [c for c in dna if side(c["instance"]) == "L"]
dna_r = [c for c in dna if side(c["instance"]) == "R"]
if dna_l: dna_l[0]["role"] = "dnL"
elif dna: dna[0]["role"] = "dnL"
if dna_r: dna_r[0]["role"] = "dnR"
elif len(dna) > 1: dna[1]["role"] = "dnR"
gf = [c for c in cells if c["role"] == "other" and any(x in (c["type"] + c["instance"]).upper() for x in ("DNP01", "GF", "GIANT"))]
if gf: gf[0]["role"] = "gf"

ids = [c["bodyId"] for c in cells]
edges = []
if len(ids) >= 2:
    conn, _ = fetch_adjacencies(ids, ids)
    if conn is not None and len(conn):
        rows = conn.to_dict("records")
        rows.sort(key=lambda r: -int(r.get("weight") or r.get("w") or 0))
        for r in rows[:40]:
            w = int(r.get("weight") or r.get("w") or 0)
            if w <= 0: continue
            edges.append({"pre": int(r["bodyId_pre"] if "bodyId_pre" in r else r["pre"]),
                          "post": int(r["bodyId_post"] if "bodyId_post" in r else r["post"]),
                          "w": w})

# one hop only if motif is tiny
if len(cells) < 4 and ids:
    try:
        out_conn, _ = fetch_adjacencies(ids, None)
        extra = []
        if out_conn is not None:
            for r in out_conn.to_dict("records"):
                typ = str(r.get("type_post") or "")
                inst = str(r.get("instance_post") or "")
                blob = (typ + " " + inst).lower()
                if any(k in blob for k in ("mn", "leg", "wing", "motor")):
                    extra.append(r)
            extra.sort(key=lambda r: -int(r.get("weight") or 0))
            for r in extra[:8]:
                bid = int(r.get("bodyId_post") or r.get("post"))
                if bid in seen or len(cells) >= 24:
                    break
                seen.add(bid)
                cells.append({
                    "bodyId": bid,
                    "type": str(r.get("type_post") or ""),
                    "instance": str(r.get("instance_post") or ""),
                    "role": "other",
                })
    except Exception as e:
        print(f"one-hop skipped: {e}", file=sys.stderr)

graph = {
    "dataset": DATASET,
    "fetchedAt": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    "misses": misses,
    "cells": cells,
    "edges": edges,
}
OUT.write_text(json.dumps(graph, indent=2) + "\n")
NOTE.write_text(
    f"# MaleCNS motif freeze\n\n"
    f"- dataset: `{DATASET}`\n"
    f"- fetchedAt: {graph['fetchedAt']}\n"
    f"- cells: {len(cells)}\n"
    f"- edges: {len(edges)}\n"
    f"- misses: {misses or 'none'}\n"
    f"- roles: { {c['role']: c['bodyId'] for c in cells if c['role'] in ('dnL','dnR','gf')} }\n"
)
print(f"wrote {OUT} cells={len(cells)} edges={len(edges)} misses={misses}")
```

If `fetch_adjacencies` column names differ, print `conn.columns` once and map to `bodyId_pre` / `bodyId_post` / `weight` (neuPrint-python’s usual names). Do not invent cells on failure.

- [ ] **Step 2: Dry-run token check**

Run: `test -n "$NEUPRINT_TOKEN" && echo TOKEN_OK`  
Expected: `TOKEN_OK`. If empty, stop and tell the human.

- [ ] **Step 3: Install client if needed and fetch**

Run:

```bash
pip install 'neuprint-python' --quiet
python3 scripts/fetch-male-cns-motif.py
```

Expected: `src/brain/maleCnsMotif.json` with `bodyId`s. If every seed query misses, commit the JSON with `misses` filled and empty `cells` — that is honest, not a fake DNa02.

- [ ] **Step 4: Sanity-check JSON**

Run: `node -e "const g=require('./src/brain/maleCnsMotif.json'); console.log(g.cells.length, g.misses, g.cells.map(c=>c.role))"`  
(ESM: `node --input-type=module -e "import g from './src/brain/maleCnsMotif.json' with { type: 'json' }; console.log(g.cells.length, g.misses)"`)

Expected: integer cell count; roles include at least one of `dnL`/`dnR`/`gf` **or** documented misses.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-male-cns-motif.py src/brain/maleCnsMotif.json src/brain/maleCnsMotif.fetched.md
git commit -m "Freeze male-cns:v1.0 motif snapshot"
```

---

### Task 4: Club frame consumes SSE motif

**Files:**
- Modify: `src/club/frame.js`
- Modify: `src/main.js`
- Modify: `src/ui/hud.js`

**Interfaces:**
- Consumes: `liveClient.state.motif` / `setSnapshot()` must forward `motif` from SSE
- Produces: fly/booth `dnLRate`, `dnRRate`, `gfRate` from `role`; HUD loc line from motif cells

- [ ] **Step 1: Forward `motif` in `src/live/liveClient.js` `setSnapshot()`**

Add `motif: s.motif || { status: 'none', cells: [] }` to the object returned by `setSnapshot()`.

- [ ] **Step 2: Helper in `frame.js` (top of file)**

```js
function motifRates(motif) {
  const cells = motif?.cells || [];
  const pick = (role) => cells.find((c) => c.role === role);
  const dnL = pick('dnL');
  const dnR = pick('dnR');
  const gf = pick('gf');
  const prev = motifRates._gf || 0;
  const gfRate = Number(gf?.rate) || 0;
  const gfFired = gfRate > 18 && prev <= 18;
  motifRates._gf = gfRate;
  return {
    dnLRate: Number(dnL?.rate) || 0,
    dnRRate: Number(dnR?.rate) || 0,
    gfRate,
    gfFired,
    loc: motifHudLine(motif, { dnL, dnR, gf }),
  };
}

function motifHudLine(motif, { dnL, dnR, gf }) {
  if (!motif || motif.status === 'none' || !(motif.cells || []).length) return 'motif: none';
  const bit = (c, miss) => (c ? `${c.type} ${c.bodyId} · ${Number(c.rate).toFixed(0)} Hz` : `miss ${miss}`);
  return `${bit(dnL, 'dnL')} · ${bit(dnR, 'dnR')} · ${bit(gf, 'gf')}`;
}
```

- [ ] **Step 3: In `createClubFrame`, drop `circuit` from opts**

Remove `sensorCurrents` / `circuit.step` loop. After `snap` is read:

```js
const rates = motifRates(snap?.motif || liveClient.state?.motif);
```

Pass `rates.dnLRate` / `dnRRate` / `gfRate` / `gfFired` into `fly.update` and `flyFxFromCircuit` (same property names as today).

HUD `dnL`/`dnR`/`gf` objects expected by `hud.update` can be `{ rate: rates.dnLRate }` etc.

Set `clubReason` / loc via existing `els.clubReason` path: pass a `policy` loc string — today frame sets `hud.update({ ... })` and hud builds `DN-L … Hz`. Change hud when `sharedLive` to use a new optional `motifLine` argument:

```js
// hud.js inside update(), clubReason block:
if (els.clubReason) {
  setText(els.clubReason, motifLine || `DN-L ${fmt(dnL?.rate ?? 0)} Hz · DN-R ${fmt(dnR?.rate ?? 0)} Hz · GF ${fmt(gf?.rate ?? 0)} Hz`);
}
```

Frame passes `motifLine: rates.loc`.

- [ ] **Step 4: `src/main.js`**

Remove:

```js
import { createCircuit } from './brain/circuit.js';
const circuit = createCircuit();
```

`createClubFrame({ ... })` without `circuit`.

- [ ] **Step 5: Delete `src/brain/circuit.js` if nothing imports it.** Keep `lif.js` only if something else uses it; if only circuit used it, leave `lif.js` on disk (harmless) or delete both.

Run: `rg createCircuit src`  
Expected: no matches.

- [ ] **Step 6: Manual check**

Run: `node --test`  
Expected: PASS (server tests). Vite build: `npm run build` must succeed.

- [ ] **Step 7: Commit**

```bash
git add src/club/frame.js src/main.js src/ui/hud.js src/live/liveClient.js
git commit -m "Drive club fly and booth from SSE motif rates"
```

---

### Task 5: Docs

**Files:**
- Modify: `LICENSES.md`
- Modify: `docs/NEUPRINT.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: LICENSES.md** — after the MaleCNS credit (or at end if missing), add:

```md
## MaleCNS motif slice

`src/brain/maleCnsMotif.json` is a small derived list of `bodyId`s and synapse
counts from **male-cns:v1.0** (FlyEM / Janelia, Cambridge, Google Research, CC BY).
It is not the full connectome. Refresh: `python3 scripts/fetch-male-cns-motif.py`.
```

If MaleCNS is only in captions today, still add this section.

- [ ] **Step 2: Rewrite `docs/NEUPRINT.md` lead** to say the MVP **does** ship a frozen slice; live queries are still fetch-script only. Keep explorer-verify warning.

- [ ] **Step 3: CONTEXT.md** — add:

```md
**Motif**:
Frozen MaleCNS cells + edges stepped on the server from the show clock.
_Avoid_: whole brain, neuPrint client in Docker
```

Change **Club frame** from “descending-neuron toys” to “motif rates + eyes + fly + booth”.

- [ ] **Step 4: Commit**

```bash
git add LICENSES.md docs/NEUPRINT.md CONTEXT.md
git commit -m "Document MaleCNS motif slice and fetch script"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Local fetch, token env, no Docker neuPrint | 3 |
| Roles at fetch, misses not fake cells | 3 |
| ≤24 cells, top 40 edges, optional 8 motor hops | 3 |
| JSON + fetched.md in git / image | 3 |
| Load on boot; none if missing | 1, 2 |
| Currents from PLAYING/TRANSITION show clock | 1 |
| α=0.2, w_norm, rate 40·v | 1 |
| Public `motif` on snapshot, no synapses | 2 |
| Fixture tests, no neuPrint in CI | 1 |
| Club drops local LIF, uses roles | 4 |
| HUD type bodyId Hz / miss | 4 |
| Eyes stay local FFT | 4 (untouched) |
| Liquidsoap fail-closed | — unchanged |
| Audience / whole-brain | out of scope |

No TBD. Names `createMotif` / `step` / `role` consistent across tasks.
