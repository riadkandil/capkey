// capkey caption server as a Cloudflare Worker: the same API as server.py
// (GET /api/health, GET /api/captions?v=<id>[&track=<track id>]) for the GitHub Pages site.
// A port of youtube.py: watch page -> Innertube key -> player API (ANDROID client) ->
// English caption tracks -> srv3 XML -> cues.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALLOWED_ORIGINS = [
  /^https:\/\/riadkandil\.github\.io$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+cb; SOCS=CAI' };
const FALLBACK_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
// YouTube shows some Cloudflare addresses a "Sign in to confirm you're not a bot" wall, depending on
// the client the request claims to be; these are tried in turn until one gets captions.
// (Measured 2026-11-10: 20-75 % of requests are walled depending on the hour, for every client and every
// call inside that request at once - it follows the outgoing address. The embedded web / TV clients never
// helped and were dropped; cookies / Accept-Language make no difference.)
export const CLIENTS = [
  { name: 'android', client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
  { name: 'android_vr', client: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
    ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip' },
  { name: 'ios', client: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
];
const RETRY_STATUS = new Set(['LOGIN_REQUIRED', 'UNPLAYABLE_BOT']);
// Captions rarely change, and every successful fetch saves later visitors from YouTube's bot wall.
const CACHE_SECONDS = 7 * 24 * 3600;

export class CaptionError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

async function request(url, init = {}, tries = 3) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
      if (r.ok) return await r.text();
      if (r.status < 500) throw new CaptionError(`YouTube answered ${r.status} (${new URL(url).pathname}).`, 502);
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (e instanceof CaptionError) throw e;
      last = e;
    }
    await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }
  throw new CaptionError(`Could not reach YouTube (${last && last.message}).`, 502);
}

// The watch page (where server.py reads the key) answers 429 to Cloudflare's addresses, so the
// Worker goes straight to the player API with the public web key.
export async function fetchPlayer(videoId, c = CLIENTS[0]) {
  const context = { client: { hl: 'en', gl: 'US', ...c.client } };
  if (c.thirdParty) context.thirdParty = c.thirdParty;
  const raw = await request(`https://www.youtube.com/youtubei/v1/player?key=${FALLBACK_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(c.ua ? { 'User-Agent': c.ua } : {}) },
    body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true }),
  }, 1);
  return JSON.parse(raw);
}

/** A bot wall / rate limit worth trying another client for (not a real "no captions"). */
const blocked = (e) => e instanceof CaptionError && /429|not a bot|confirm you|Unreadable|empty/i.test(e.message);

function trackName(t) {
  const n = t.name || {};
  if (n.simpleText) return n.simpleText;
  return (n.runs || []).map((r) => r.text || '').join('') || t.languageCode || '';
}

export function englishTracks(player) {
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const out = [];
  for (const t of tracks) {
    const lang = t.languageCode || '';
    if (!(lang === 'en' || lang.startsWith('en-'))) continue;
    const kind = t.kind === 'asr' ? 'auto' : 'manual';
    out.push({ id: `${lang}.${kind}`, lang, kind, name: trackName(t), url: t.baseUrl || '' });
  }
  // manual first, plain "en" before regional ones (stable, like Python's sort)
  return out
    .map((t, i) => [t, i])
    .sort((a, b) => (a[0].kind !== 'manual') - (b[0].kind !== 'manual') || (a[0].lang !== 'en') - (b[0].lang !== 'en') || a[1] - b[1])
    .map((x) => x[0]);
}

export function pick(tracks, want) {
  if (!tracks.length) return null;
  return tracks.find((t) => t.id === want) || tracks[0];
}

export function trackUrl(url) {
  const u = new URL(url);
  u.searchParams.delete('fmt');
  u.searchParams.append('fmt', 'srv3');
  return u.toString();
}

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
function decode(s) {
  return s.replace(ENTITY, (_, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

// XML entities once (the parser's job), then HTML entities (YouTube double-escapes some text).
const clean = (raw) => decode(decode(raw.replace(/<[^>]*>/g, ''))).replace(/\s+/g, ' ').trim();
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const r3 = (x) => Math.round(x * 1000) / 1000;

/** srv3 (<p t d>[<s t>]) or legacy (<text start dur>) XML -> cues in seconds. */
export function parseTimedtext(xml) {
  if (!/<(timedtext|transcript)\b/.test(xml)) throw new CaptionError('Unreadable caption data.', 502);
  const cues = [];
  for (const m of xml.matchAll(/<p\b([^>]*?)>([\s\S]*?)<\/p>/g)) {
    const a = attrs(m[1]);
    const t = (parseInt(a.t || '0', 10)) / 1000;
    const d = (parseInt(a.d || '0', 10)) / 1000;
    const spans = [...m[2].matchAll(/<s\b([^>]*?)>([\s\S]*?)<\/s>/g)];
    if (spans.length) {
      const words = spans
        .map((s) => [r3(t + parseInt(attrs(s[1]).t || '0', 10) / 1000), clean(s[2])])
        .filter((w) => w[1]);
      if (words.length) cues.push({ s: t, e: r3(t + d), text: words.map((w) => w[1]).join(' '), words });
      continue;
    }
    const text = clean(m[2]);
    if (text) cues.push({ s: t, e: r3(t + d), text });
  }
  for (const m of xml.matchAll(/<text\b([^>]*?)>([\s\S]*?)<\/text>/g)) {
    const text = clean(m[2]);
    if (!text) continue;
    const a = attrs(m[1]);
    const s = parseFloat(a.start || '0');
    cues.push({ s, e: r3(s + parseFloat(a.dur || '0')), text });
  }
  return cues.sort((x, y) => x.s - y.s);
}

export async function getCaptions(videoId, track, deps = {}) {
  if (!VIDEO_ID.test(videoId || '')) throw new CaptionError('That is not a YouTube video id.', 400);
  const clients = deps.clients || CLIENTS;
  // Retrying inside one request never helped (measured: same outgoing address); the site retries with
  // fresh requests instead, which often get through.
  const rounds = deps.rounds ?? 1;
  const errors = [];
  let attempts = 0;
  for (let round = 0; round < rounds; round++) {
    if (round) await new Promise((res) => setTimeout(res, 400 * round));
    for (const c of clients) {
      attempts++;
      try {
        const data = await captionsWith(videoId, track, c, deps);
        data.via = c.name;
        data.attempts = attempts;
        return data;
      } catch (e) {
        if (!(e.retry || blocked(e))) throw e;
        errors.push(e);
      }
    }
    // a video that every client calls unavailable (not a bot wall) is really unavailable
    if (!errors.some(blocked)) break;
  }
  if (errors.some(blocked)) {
    const e = errors.find(blocked);
    throw new CaptionError(`${e.message} YouTube is blocking the caption server right now; try again in a minute, or paste the transcript.`, 503);
  }
  throw errors[0];
}

async function captionsWith(videoId, track, c, deps) {
  const getPlayer = deps.fetchPlayer || fetchPlayer;
  const getText = deps.request || request;
  const player = await getPlayer(videoId, c);
  const status = player.playabilityStatus || {};
  if (status.status && status.status !== 'OK') {
    // Cloudflare addresses sometimes get "unavailable" or a sign-in wall for one client only: try the next.
    const msg = `YouTube says: ${status.reason || status.status}`;
    const err = new CaptionError(msg, RETRY_STATUS.has(status.status) || /bot/i.test(msg) ? 503 : 422);
    err.retry = true;
    throw err;
  }
  const tracks = englishTracks(player);
  const chosen = pick(tracks, track);
  if (!chosen) throw new CaptionError('This video has no English captions. You can paste a transcript instead.', 404);
  const cues = parseTimedtext(await getText(trackUrl(chosen.url), {}, 1));
  if (!cues.length) throw new CaptionError('The caption track is empty.', 404);
  const d = player.videoDetails || {};
  const pub = ({ id, lang, name, kind }) => ({ id, lang, name, kind });
  return {
    id: videoId,
    title: d.title || '',
    author: d.author || '',
    seconds: parseInt(d.lengthSeconds || '0', 10) || 0,
    embeddable: status.playableInEmbed !== false,
    track: pub(chosen),
    tracks: tracks.map(pub),
    cues,
  };
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const h = { Vary: 'Origin' };
  if (ALLOWED_ORIGINS.some((re) => re.test(origin))) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
    if (url.pathname === '/api/health') return json({ ok: true }, 200, { ...cors, 'Cache-Control': 'no-store' });
    if (url.pathname !== '/api/captions') return json({ error: 'Not found' }, 404, cors);

    const v = (url.searchParams.get('v') || '').trim();
    const track = url.searchParams.get('track') || null;
    const key = new Request(`${url.origin}/api/captions?v=${encodeURIComponent(v)}&track=${encodeURIComponent(track || '')}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      for (const [k, val] of Object.entries(cors)) res.headers.set(k, val);
      return res;
    }
    try {
      const data = await getCaptions(v, track);
      const fresh = json(data, 200, { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
      ctx.waitUntil(cache.put(key, fresh.clone()));
      for (const [k, val] of Object.entries(cors)) fresh.headers.set(k, val);
      return fresh;
    } catch (e) {
      const status = e instanceof CaptionError ? e.status : 500;
      return json({ error: e instanceof CaptionError ? e.message : `Unexpected error: ${e.message}` }, status, { ...cors, 'Cache-Control': 'no-store' });
    }
  },
};
