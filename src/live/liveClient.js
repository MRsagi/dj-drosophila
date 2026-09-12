/**
 * Shared club live mode — all visitors hear the same HLS stream.
 * Driven by SSE /api/live/state; does NOT run local setEngine audio.
 */

import Hls from 'hls.js';
import { createAnalyser } from '../audio/analyser.js';
import { createBoothFx } from '../audio/boothFx.js';

const LIVE_MUTE_KEY = 'dj-drosophila:liveMuted';

/**
 * @returns {boolean} true when URL forces live (?live=1) or disables (?live=0)
 */
export function liveQueryFlag() {
  const q = new URLSearchParams(location.search);
  if (q.get('live') === '0') return false;
  if (q.get('live') === '1') return true;
  return null; // auto
}

/**
 * Probe whether a shared live server is available.
 * @param {number} [timeoutMs]
 */
export async function probeLiveServer(timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch('/api/live/state', {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.state && j.streamUrl) return j;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{ onState?: (s: object) => void, audioEl?: HTMLAudioElement }} opts
 */
export function createLiveClient(opts = {}) {
  /** @type {object|null} */
  let state = null;
  /** @type {EventSource|null} */
  let es = null;
  /** @type {HTMLAudioElement|null} */
  let audio = opts.audioEl || null;
  /** @type {Hls|null} */
  let hls = null;
  let started = false;
  let muted = false;
  /** @type {{ ac: AudioContext, analyser: ReturnType<typeof createAnalyser>, gain: GainNode, booth: ReturnType<typeof createBoothFx> }|null} */
  let tap = null;
  let pitch = 1;
  try {
    muted = localStorage.getItem(LIVE_MUTE_KEY) === '1';
  } catch {
    muted = false;
  }
  const onState = opts.onState || (() => {});
  /** @type {(muted: boolean) => void} */
  let onMuteChange = opts.onMuteChange || (() => {});

  function applyMuteToEl(el) {
    if (!el) return;
    // When the Web Audio tap owns output, keep the element unmuted so the
    // analyser still sees the stream; mute via gain instead.
    el.muted = tap ? false : muted;
    if (tap) tap.gain.gain.value = muted ? 0 : 1;
  }

  function ensureTap() {
    if (tap) return tap;
    const el = ensureAudio();
    const ac = new AudioContext();
    const src = ac.createMediaElementSource(el);
    const analyser = createAnalyser(ac, { fftSize: 2048, smoothing: 0.5 });
    const booth = createBoothFx(ac);
    const gain = ac.createGain();
    // Tap FFT dry (eyes); booth hears the same source, mute is post-FX.
    src.connect(analyser.node);
    src.connect(booth.input);
    booth.output.connect(gain);
    gain.connect(ac.destination);
    gain.gain.value = muted ? 0 : 1;
    tap = { ac, analyser, gain, booth };
    el.muted = false;
    applyPitch();
    return tap;
  }

  function applyPitch() {
    if (!audio) return;
    audio.playbackRate = pitch;
    audio.preservesPitch = false;
    audio.webkitPreservesPitch = false;
  }

  function ensureAudio() {
    if (audio) {
      applyMuteToEl(audio);
      return audio;
    }
    audio = document.createElement('audio');
    audio.id = 'live-shared-audio';
    audio.crossOrigin = 'anonymous';
    audio.playsInline = true;
    audio.preload = 'auto';
    audio.style.display = 'none';
    audio.preservesPitch = false;
    audio.webkitPreservesPitch = false;
    applyMuteToEl(audio);
    applyPitch();
    document.body.appendChild(audio);
    return audio;
  }

  function attachHls(url) {
    const el = ensureAudio();
    const abs = new URL(url, location.origin).href;

    if (hls) {
      hls.destroy();
      hls = null;
    }

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
      });
      hls.loadSource(abs);
      hls.attachMedia(el);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data?.fatal) {
          console.warn('[live] HLS fatal', data.type, data.details);
          try {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
          } catch {
            /* ignore */
          }
        }
      });
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = abs;
    } else {
      console.error('[live] HLS not supported in this browser');
    }
  }

  function applyState(s) {
    state = s;
    onState(s);
  }

  function connectSse() {
    if (es) {
      es.close();
      es = null;
    }
    es = new EventSource('/api/live/state');
    es.onmessage = (ev) => {
      try {
        const s = JSON.parse(ev.data);
        applyState(s);
      } catch (err) {
        console.warn('[live] bad SSE payload', err);
      }
    };
    es.onerror = () => {
      // EventSource reconnects automatically
    };
  }

  return {
    get state() {
      return state;
    },
    get audio() {
      return audio;
    },
    get started() {
      return started;
    },
    /**
     * Begin SSE + HLS. Must be called from a user gesture for autoplay policy.
     */
    async start() {
      if (started) {
        const el = ensureAudio();
        try {
          await el.play();
        } catch {
          /* ignore */
        }
        return;
      }
      started = true;
      connectSse();

      // Prefer stream URL from probe / first state
      let url = state?.streamUrl || '/hls/live.m3u8';
      if (!state) {
        const probed = await probeLiveServer(2000);
        if (probed) {
          applyState(probed);
          url = probed.streamUrl || url;
        }
      }
      attachHls(url);
      const el = ensureAudio();
      try {
        ensureTap();
        if (tap.ac.state === 'suspended') await tap.ac.resume();
      } catch (err) {
        console.warn('[live] audio tap failed — eyes will stay dark', err);
        tap = null;
      }
      applyMuteToEl(el);
      try {
        await el.play();
      } catch (err) {
        console.warn('[live] autoplay blocked — waiting for gesture', err);
      }
    },
    stop() {
      started = false;
      if (es) {
        es.close();
        es = null;
      }
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (audio) {
        try {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        } catch {
          /* ignore */
        }
      }
    },
    get muted() {
      return muted;
    },
    /**
     * Client-only mute of the shared <audio> element. Does not affect other listeners.
     * @param {boolean} [next]
     */
    setMuted(next = !muted) {
      muted = !!next;
      try {
        localStorage.setItem(LIVE_MUTE_KEY, muted ? '1' : '0');
      } catch {
        /* ignore */
      }
      applyMuteToEl(ensureAudio());
      onMuteChange(muted);
      return muted;
    },
    toggleMute() {
      return this.setMuted(!muted);
    },
    onMuteChange(cb) {
      onMuteChange = cb || (() => {});
    },
    /**
     * Snapshot shaped like setEngine HUD for FlyDJ / hud.update
     */
    setSnapshot() {
      const s = state;
      if (!s) return null;
      const xf = typeof s.xfaderEdge === 'number' ? s.xfaderEdge : 0;
      return {
        state: s.state,
        activeSide: s.activeDeck,
        quietSide: s.quietDeck,
        activeEdge: s.activeDeck === 'A' ? -1 : 1,
        xfaderTarget: xf,
        xfader: xf,
        xfaderEdge: xf,
        lockXfader: s.state === 'PLAYING',
        playedSec: s.playedSec,
        plannedSec: s.plannedSec,
        transitionProgress: s.transitionProgress,
        transitionDurSec: s.transitionSec,
        nextTitle: s.nextTrack?.title || null,
        statusLine: s.statusLine,
        timeStr: s.timeStr,
        edgeLabel: s.edgeLabel,
        mindReason: s.mindReason || null,
      };
    },
    /**
     * FFT features from the shared HLS element, or null if tap is unavailable.
     */
    readFeat() {
      if (!tap) return null;
      return tap.analyser.read(tap.ac.currentTime);
    },
    get booth() {
      return tap?.booth || null;
    },
    get pitch() {
      return pitch;
    },
    /**
     * Vinyl-style pitch on the local HLS element only (±8%).
     * @param {number} rate
     */
    setPitch(rate) {
      pitch = Math.max(0.92, Math.min(1.08, Number(rate) || 1));
      applyPitch();
      return pitch;
    },
  };
}
