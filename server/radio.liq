# DJ Drosophila — 24/7 Liquidsoap radio
#
# Requires Liquidsoap 2.2.4+ (Debian Trixie ships 2.3.x).
# Cue in/out is applied at request resolution via liq_cue_in / liq_cue_out
# (the cue_cut operator was removed in 2.2.4; playlist passes those fields).
#
# Env (set by server/liquidsoapStream.js):
#   RADIO_M3U, HLS_DIR,
#   ICECAST_HOST, ICECAST_PORT, ICECAST_PASSWORD, ICECAST_MOUNT, ICECAST_USER,
#   PUBLIC_URL

settings.log.stdout.set(true)
settings.log.file.set(false)
settings.frame.audio.samplerate.set(44100)

def env(name, default) =
  v = list.assoc(default="", name, environment())
  if v == "" then default else v end
end

m3u_path = env("RADIO_M3U", "./server/cache/radio.m3u")
hls_dir = env("HLS_DIR", "./server/hls")
icecast_host = env("ICECAST_HOST", "")
icecast_port = int_of_string(env("ICECAST_PORT", "8000"))
icecast_password = env("ICECAST_PASSWORD", "hackme")
icecast_mount = env("ICECAST_MOUNT", "/drosophila")
icecast_user = env("ICECAST_USER", "source")
public_url = env("PUBLIC_URL", "https://dj.sagirosenthal.com")

if not file.exists(hls_dir) then ignore(file.mkdir(parents=true, hls_dir)) end

# Mind-generated annotated M3U. Node rewrites remaining (unplayed) tracks;
# watch reloads. loop=false so consumed history is never replayed.
radio =
  playlist(
    id="radio_m3u",
    mode="normal",
    loop=false,
    reload=30,
    reload_mode="watch",
    mime_type="audio/x-mpegurl",
    prefetch=1,
    cue_in_metadata="liq_cue_in",
    cue_out_metadata="liq_cue_out",
    m3u_path
  )

# Mix two already-faded decks (smooth_add-style overlap, no extra normalize).
def smooth_add(a, b) =
  add(normalize=false, [b, a])
end

# Equal-power-ish overlap: fade.out the outgoing deck, fade.in the incoming.
# Per-track liq_fade_in / liq_fade_out / liq_fade_*_type come from annotate.
def fly_transition(old, new) =
  outgoing =
    fade.out(
      type="sin",
      duration=12.,
      persist_overrides=true,
      initial_metadata=old.metadata,
      old.source
    )
  incoming =
    fade.in(
      type="sin",
      duration=12.,
      persist_overrides=true,
      initial_metadata=new.metadata,
      new.source
    )
  smooth_add(outgoing, incoming)
end

radio =
  cross(
    id="fly_cross",
    duration=20.,
    override_duration="liq_cross_duration",
    fly_transition,
    radio
  )

# Never stall the encoder: quiet procedural bed if the playlist is empty.
safe_bed = sine(id="safe_bed", amplitude=0.004, 110.)
radio = fallback(id="safe", track_sensitive=false, [radio, safe_bed])

aac_ts =
  %ffmpeg(
    format="mpegts",
    %audio(
      codec="aac",
      channels=2,
      ar=44100,
      b="128k"
    )
  )

# Master playlist is index.m3u8; media playlist is live.m3u8 (frontend URL).
output.file.hls(
  id="hls",
  playlist="index.m3u8",
  segment_duration=2.0,
  segments=20,
  segments_overhead=10,
  hls_dir,
  [("live", aac_ts)],
  radio
)

if icecast_host != "" then
  ignore(
    output.icecast(
      %ffmpeg(
        format="mp3",
        %audio(codec="libmp3lame", b="128k", samplerate=44100, channels=2)
      ),
      id="icecast",
      host=icecast_host,
      port=icecast_port,
      user=icecast_user,
      password=icecast_password,
      mount=icecast_mount,
      name="DJ Drosophila",
      description="Hey, I trained a fruit fly to DJ — this is its set.",
      genre="electronic",
      url=public_url,
      fallible=true,
      radio
    )
  )
end
