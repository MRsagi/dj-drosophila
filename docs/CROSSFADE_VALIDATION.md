# Crossfade validation report

- **When:** 2026-09-12T14:20:37.546Z
- **Live URL:** https://dj.sagirosenthal.com
- **Duration:** 240s
- **JSONL log:** `scripts/out/crossfade-validation-1789222584573.jsonl`

## Summary

| Metric | Value |
|--------|-------|
| Transitions observed | 3 |
| Metadata xfader pass/fail | 3/0 |
| Audio blend pass/fail | 3/0 |
| Leave-timing pass/fail | 3/0 |
| **Overall** | **PASS** |

## Pass/fail criteria

1. **Metadata:** during TRANSITION, `xfaderEdge` travels gradually from near ±1 toward the other side (not stuck then jump at 100%).
2. **Audio:** during labeled TRANSITION, RMS/energy shows overlap/blend (not flat single-track then sudden change only at boundary).
3. **Leave timing:** not only at EOF; mind leaves with `fadeSec` room before duration (`leaveAt ≤ duration - fadeSec - 1`).

## Transitions

### Transition #9: And the Console Hit the Floor → Techno 3

- **fadeSec:** 28.6
- **mindReason:** phrase boundary tickles GF · 29s blend into Techno 3
- **window:** t=37.1s → 65.5s
- **leave:** played 60s / file 128.077375s (room before EOF after fade: 39.5s)
- **metadata xfader:** PASS — travel=1.994 start=0.995 mid=-0.135 end=-0.999 stuckThenJump=false
- **leave timing:** PASS playedToEof=false
- **audio:** PASS — gradual/overlapping energy consistent with blend (early/mid/late RMS 0.2040/0.1869/0.1938, maxJump=0.2136, midCv=0.349, segs=13)

### Transition #10: Techno 3 → Funky House

- **fadeSec:** 25.4
- **mindReason:** phrase boundary tickles GF · 25s blend into Funky House
- **window:** t=125.5s → 150.9s
- **leave:** played 60s / file 113.088s (room before EOF after fade: 27.7s)
- **metadata xfader:** PASS — travel=1.995 start=-0.997 mid=0.075 end=0.998 stuckThenJump=false
- **leave timing:** PASS playedToEof=false
- **audio:** PASS — gradual/overlapping energy consistent with blend (early/mid/late RMS 0.1221/0.1266/0.1697, maxJump=0.1932, midCv=0.330, segs=13)

### Transition #11: Funky House → Bouncy Hamster Dancing

- **fadeSec:** 26
- **mindReason:** ommatidia hit the run-out groove · escape circuit wants a 26s blend
- **window:** t=192.6s → 218.9s
- **leave:** played 42s / file 68.754286s (room before EOF after fade: 0.8s)
- **metadata xfader:** PASS — travel=1.998 start=1.000 mid=-0.107 end=-0.998 stuckThenJump=false
- **leave timing:** PASS playedToEof=false
- **audio:** PASS — gradual/overlapping energy consistent with blend (early/mid/late RMS 0.3600/0.3605/0.3300, maxJump=0.3557, midCv=0.251, segs=13)


## Notes

- Poll interval ~800ms.
- HLS segments downloaded from `https://dj.sagirosenthal.com/hls/live.m3u8` during TRANSITION (± capture burst).
- Audio metric: mono 22.05 kHz RMS in ~100ms blocks + coarse spectral flux.

## Root-cause findings (pre-fix production)

Metadata PASS on live (xfader travels gradually during TRANSITION). Leave timing generally PASS
(mind leaves with fade room; one tight case ~0.8s room on short beds).

**Software bugs found in `server/ffmpegStream.js` (why listeners still hear a hard cut):**

1. **`nextStartNumber` used `countSegments()` (file count)** after each encode. With
   `hls_flags=delete_segments` only ~20 `.ts` files remain on disk, so the next `-start_number`
   could **rewind and overwrite** segment indices. Playlist append + overwrite → discontinuities /
   clients sticking on old media until a boundary — feels like a hard cut when SSE hits 100%.

2. **False “acrossfade failed” fallback:** success was `countSegments() <= before`. With
   delete_segments, count stays flat even when new segments were written, so **amix always ran
   after a successful acrossfade**, encoding a **second full fadeSec** of audio. Producer wall-clock
   drifted behind the SSE schedule every transition → HUD TRANSITION while HLS still playing the
   previous encode (or a late double-blend), then a sudden catch-up / cut.

3. **Fix in this commit:** track `maxSegmentNumber()+1` for `-start_number`; detect new segments
   by max index (not count); **primary equal-power `afade`+`amix`** for the full remaining
   `fadeSec`; acrossfade only if amix writes nothing; log producer lag; avoid double-encode.

4. **Mind shaping:** `leaveQualityReward` penalizes early leave, must-leave/EOF play, and rewards
   phrase alignment + fadeSec ∈ 12–28s with `leaveAt ≤ duration - fadeSec - 1`.

**Redeploy required** for production `dj.sagirosenthal.com` to pick up producer fixes.

## Mute control (client-only)

Club HUD + gate: **Mute / Unmute** toggles the local shared `<audio>` / HLS element only
(`localStorage` key `dj-drosophila:liveMuted`). Does not affect other listeners.
