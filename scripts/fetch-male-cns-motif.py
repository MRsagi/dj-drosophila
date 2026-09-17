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
_printed_cols = False

def map_edge(r):
    """Map neuPrint adjacency row to pre/post/w. Print columns once if names differ."""
    global _printed_cols
    pre = r.get("bodyId_pre", r.get("pre"))
    post = r.get("bodyId_post", r.get("post"))
    w = r.get("weight", r.get("w"))
    if (pre is None or post is None or w is None) and not _printed_cols:
        print("conn.columns", list(r.keys()), file=sys.stderr)
        _printed_cols = True
    return pre, post, w

if len(ids) >= 2:
    # fetch_adjacencies returns (neurons_df, roi_conn_df), not (conn, _)
    _neurons, conn = fetch_adjacencies(ids, ids)
    if conn is not None and len(conn):
        print("conn.columns", list(conn.columns), file=sys.stderr)
        _printed_cols = True
        totals = {}
        for r in conn.to_dict("records"):
            pre, post, wraw = map_edge(r)
            w = int(wraw or 0)
            if pre is None or post is None or w <= 0:
                continue
            key = (int(pre), int(post))
            totals[key] = totals.get(key, 0) + w
        rows = sorted(({"pre": p, "post": q, "w": w} for (p, q), w in totals.items()),
                      key=lambda r: -r["w"])
        edges.extend(rows[:40])

# one hop only if motif is tiny
if len(cells) < 4 and ids:
    try:
        _out_neurons, out_conn = fetch_adjacencies(ids, None)
        extra = []
        if out_conn is not None:
            if not _printed_cols:
                print("conn.columns", list(out_conn.columns), file=sys.stderr)
                _printed_cols = True
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
OUT.parent.mkdir(parents=True, exist_ok=True)
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
