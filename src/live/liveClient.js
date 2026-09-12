/**
 * Shared club live mode — all visitors hear the same HLS stream.
 * Driven by SSE /api/live/state; does NOT run local setEngine audio.
 */

import Hls from 'hls.js';

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
  const onState = opts.onState || (() => {});

  function ensureAudio() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.id = 'live-shared-audio';
    audio.crossOrigin = 'anonymous';
    audio.playsInline = true;
    audio.preload = 'auto';
    audio.style.display = 'none';
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
    /**
     * Snapshot shaped like setEngine HUD for FlyDJ / hud.update
     */
    setSnapshot() {
      const s = state;
      if (!s) return null;
      return {
        state: s.state,
        activeSide: s.activeDeck,
        quietSide: s.quietDeck,
        activeEdge: s.activeDeck === 'A' ? -1 : 1,
        xfaderTarget: s.xfaderEdge,
        lockXfader: s.state === 'PLAYING',
        playedSec: s.playedSec,
        plannedSec: s.plannedSec,
        transitionProgress: s.transitionProgress,
        transitionDurSec: s.transitionSec,
        nextTitle: s.nextTrack?.title || null,
        fxIntensity: s.state === 'TRANSITION' ? 0.55 : 0.28,
        statusLine: s.statusLine,
        timeStr: s.timeStr,
        edgeLabel: s.edgeLabel,
        canTransition: true,
      };
    },
  };
}
