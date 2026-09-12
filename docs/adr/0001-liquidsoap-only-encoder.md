# Liquidsoap is the only 24/7 encoder

Shared radio used to have two producers (Liquidsoap and an ffmpeg CLI fallback). Dual-engine hid cue/fade bugs behind `{ start, stop, ready }` and made a producer port look real. We delete the ffmpeg HLS producer. If Liquidsoap is missing, the server fails closed (install or Docker). ffprobe may still probe crate durations. Icecast stays optional.

**Status:** accepted
