// YouTube IFrame player that plays a time range and pauses itself at its end.
// getCurrentTime() only changes when the iframe reports in, so the position is
// extrapolated from the last report to stop within a few hundredths of a second.

let apiPromise = null;

function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('Could not load the YouTube player. Check your connection.')); };
    document.head.append(s);
  });
  return apiPromise;
}

export const PLAYER_ERRORS = {
  2: 'YouTube rejected the video id.',
  5: 'This video cannot be played in the browser player.',
  100: 'The video was not found (removed or private).',
  101: 'The owner does not allow this video to be played on other sites.',
  150: 'The owner does not allow this video to be played on other sites.',
  153: 'YouTube refused to play the video here (missing referrer).',
};

export class Clip {
  constructor(host) {
    this.host = host;
    this.player = null;
    this.id = null;
    this.timer = 0;
    this.range = null;
    this.onError = null;
    this.onState = null;
  }

  async load(id) {
    const YT = await loadApi();
    if (this.player && this.id === id) return;
    if (this.player) {
      this.cancel();
      this.id = id;
      this.player.cueVideoById(id);
      return;
    }
    this.id = id;
    await new Promise((resolve) => {
      const el = document.createElement('div');
      this.host.replaceChildren(el);
      this.player = new YT.Player(el, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          cc_load_policy: 0, iv_load_policy: 3, rel: 0, playsinline: 1,
          modestbranding: 1, fs: 0, origin: location.origin,
        },
        events: {
          onReady: () => { this.hideCaptions(); resolve(); },
          onError: (e) => { this.cancel(); this.onError?.(e.data); resolve(); },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) this.hideCaptions();
            // paused or ended by the user (our own pause clears the range first)
            if ((e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) && this.range?.armed) this.cancel();
            this.onState?.(e.data);
          },
        },
      });
    });
  }

  hideCaptions() {
    try { this.player.unloadModule('captions'); } catch { /* not loaded */ }
    try { this.player.unloadModule('cc'); } catch { /* not loaded */ }
  }

  /** Play [start, end] at `rate`; onEnd runs when it pauses at the end. */
  playRange(start, end, rate = 1, onEnd = null) {
    const p = this.player;
    if (!p || !p.seekTo) return;
    this.cancel();
    this.range = { start, end, rate, onEnd, armed: false, t0: performance.now(), lastT: -1, lastAt: 0 };
    p.setPlaybackRate(rate);
    p.seekTo(start, true);
    p.playVideo();
    this.timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    const r = this.range;
    const p = this.player;
    if (!r || !p.getCurrentTime) return;
    const now = performance.now();
    const t = p.getCurrentTime();
    if (t !== r.lastT) { r.lastT = t; r.lastAt = now; }
    const playing = p.getPlayerState() === 1;
    const est = t + (playing ? Math.min(0.5, (now - r.lastAt) / 1000) * r.rate : 0);
    if (!r.armed) {
      // right after seekTo the old position can still be reported
      if ((t >= r.start - 0.75 && t < r.end) || now - r.t0 > 4000) r.armed = true;
      else return;
    }
    if (est >= r.end) {
      p.pauseVideo();
      const cb = r.onEnd;
      this.cancel();
      cb?.();
    }
  }

  get busy() { return !!this.range; }

  cancel() {
    clearInterval(this.timer);
    this.timer = 0;
    this.range = null;
  }

  pause() {
    this.cancel();
    try { this.player?.pauseVideo(); } catch { /* player not ready */ }
  }
}
