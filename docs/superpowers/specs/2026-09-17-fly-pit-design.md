# Fly pit (v1)

**Date:** 2026-09-17  
**Status:** draft — awaiting review  
**Depends on:** MaleCNS motif v1 (SSE `motif` rates)

Show a **DJ fly on the decks** and a **pit of flies** that move with the set. Copy may say the DJ is a fly mind playing **for** other flies. The DJ does **not** pick tracks from pit reactions. Leave/fade/next stay the existing leave mind.

## Goal

One Three.js scene: DJ (current fly) plus a cheap crowd. Shared SSE motif for *when* the room leans or hops. Local HLS bass/kick for *how hard*. Two browsers agree on lean/hop timing, not on every wingbeat.

## Out of scope

- Extra MaleCNS instances / per-fly motif steppers
- Crowd state feeding leave-mind, fade, or next-track
- Second canvas, 50+ flies, instanced blobs instead of Drosophila meshes
- Changing Liquidsoap, crate, or booth FX wiring (except using the same SSE rates already on the DJ)

## Scene

- Canvas: existing `#fly-dj`.
- **DJ:** current factory (headphones, lights, decks). Unchanged pose language.
- **Pit:** 16 flies if desktop (`innerWidth >= 700` and not coarse pointer); **8** otherwise. Same body/legs/wings; **no** headphones, **no** extra lights. Share materials with the DJ.
- Layout: DJ upstage on decks. Pit in two shallow rows facing the booth, scale ~0.45. Camera pulled back so both read.
- WebGL init fail → DJ only, no throw.

## Drive

Same club-frame rAF as today.

| Input | DJ | Pit |
|-------|----|-----|
| SSE `dnL` / `dnR` | lean / steer | same lean, phase-offset gait |
| SSE `gf` rising-edge | jump | **room hop** (all pit, not 16 independent GF detectors) |
| Local `bass` / `kick` | wings | stride height + wing amp, per-fly phase `φ` |

No SSE of positions. No second `createMotif`. `document.hidden` → skip pit pose updates.

## Copy / HUD

- Story / caption may say: fly mind playing for other flies.
- Must **not** say the set is chosen from crowd reaction.
- HUD one line: `pit 16 · motif ok` (or `pit 8`; `motif: none` if no motif). No per-fly Hz.

## Failure

| case | behavior |
|------|----------|
| WebGL fail | DJ only |
| Motif `none` | Pit still walks on local bass; HUD `pit n · motif: none` |
| Context lost | Do not respawn pit until a successful restore |

## Tests

Pure helper: `(φ, bass, kick, dnL, dnR, gfHop) → strideScale, lean`. No WebGL in `node --test`. Manual: two browsers, same lean on a blend; phone uses 8.

## Files (intended)

| path | role |
|------|------|
| `src/scene/FlyDJ.js` | Pit factory / tick; DJ path stays |
| `src/scene/pitPose.js` | Pure pose math (testable) |
| `src/club/frame.js` | Pass motif + featM into pit tick |
| `src/ui/hud.js` / `index.html` | Pit line; dry copy |

## Success

- Club shows DJ + pit on one canvas.
- Copy: playing **for** flies, not **because of** them.
- Phone does not melt (8 flies).
- Leave mind unchanged.

## Later (not this spec)

Crowd → leave/fade loop. Server-side N motif copies. Dense pit.
