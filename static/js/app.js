// capkey app: home (load a video, recent videos) and practice (play a sentence,
// pause, fill the blanks, check). State lives in S; progress in localStorage.
import * as L from './lib.js';
import { Clip, PLAYER_ERRORS } from './player.js';

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  replay: svg(`<path d="M4 12a8 8 0 1 0 2.4-5.7" ${STROKE}/><path d="M4 4.5v4h4" ${STROKE}/>`),
  slow: svg(`<path d="M3.5 16.5h13a3.5 3.5 0 0 0 3.5-3.5v-1h-2.5" ${STROKE}/><path d="M5.5 16.5a6 6 0 0 1 11.5-2.5" ${STROKE}/><path d="M7 16.5v2.5M14 16.5v2.5" ${STROKE}/>`),
  prev: svg(`<path d="M15 6l-6 6 6 6" ${STROKE}/>`),
  next: svg(`<path d="M9 6l6 6-6 6" ${STROKE}/>`),
  hint: svg(`<path d="M9 18h6M10 21h4" ${STROKE}/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" ${STROKE}/>`),
  eye: svg(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" ${STROKE}/><circle cx="12" cy="12" r="2.8" ${STROKE}/>`),
  gear: svg(`<circle cx="12" cy="12" r="3" ${STROKE}/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" ${STROKE}/>`),
  sun: svg(`<circle cx="12" cy="12" r="4" ${STROKE}/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" ${STROKE}/>`),
  moon: svg(`<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" ${STROKE}/>`),
  auto: svg(`<circle cx="12" cy="12" r="8.5" ${STROKE}/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>`),
  headphones: svg(`<path d="M4 14v-2a8 8 0 0 1 16 0v2" ${STROKE}/><rect x="3" y="13" width="4.5" height="7" rx="1.6" fill="currentColor"/><rect x="16.5" y="13" width="4.5" height="7" rx="1.6" fill="currentColor"/>`),
  subs: svg(`<rect x="3" y="5" width="18" height="14" rx="2.5" ${STROKE}/><path d="M7 15h4M13 15h4M7 11.5h2M11 11.5h6" ${STROKE}/>`),
  close: svg(`<path d="M6 6l12 12M18 6 6 18" ${STROKE}/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5" ${STROKE}/>`),
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('capkey.' + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('capkey.' + k, JSON.stringify(v)); } catch { /* full or blocked */ }
  },
  del(k) { try { localStorage.removeItem('capkey.' + k); } catch { /* blocked */ } },
};

const DEFAULTS = {
  blanks: 'all', letters: true, live: true, typos: true, autoNext: true, autoPlay: true,
  speed: 1, veil: false, cover: false, theme: 'auto',
};
const EXAMPLE = 'https://www.youtube.com/watch?v=arj7oStGLkU';
const API = (document.querySelector('meta[name="capkey-api"]')?.content || '').trim().replace(/\/+$/, '');
const apiUrl = (path) => (API ? `${API}/${path}` : path);

const S = {
  settings: { ...DEFAULTS, ...store.get('settings', {}) },
  data: null, sentences: [], idx: 0, prog: null, key: '',
  clip: null, slots: [], phase: 'type', checked: false, dirty: false,
  autoTimer: 0, loadToken: 0, playing: false,
};

const saveSettings = () => store.set('settings', S.settings);

// ------------------------------------------------------------------ theme

const THEMES = ['auto', 'light', 'dark'];
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const b = $('theme-btn');
  b.innerHTML = ICON[t === 'auto' ? 'auto' : t === 'light' ? 'sun' : 'moon'];
  b.title = `Theme: ${t} (click to change)`;
}

// ------------------------------------------------------------------ routing

function route() {
  const m = location.hash.match(/^#\/v\/([\w-]{11})(?:\/([\w.-]+))?/);
  if (m) openVideo(m[1], m[2] || null);
  else showHome();
}

function showHome(error = '') {
  S.loadToken++;
  S.clip?.pause();
  clearTimeout(S.autoTimer);
  $('practice').hidden = true;
  $('home').hidden = false;
  document.title = 'capkey';
  const box = $('home-error');
  box.hidden = !error;
  box.textContent = error;
  renderRecent();
  renderPicks();
}

// ------------------------------------------------------------------ recommendations

const LEVELS = ['All', 'Easy', 'Medium', 'Fast'];
const LEVEL_TIP = { Easy: 'under 150 words a minute', Medium: '150 to 170 words a minute', Fast: 'over 170 words a minute' };

function loadPicks() {
  S.picksLoad ??= fetch('data/videos.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return S.picksLoad;
}

const minutes = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function renderPicks() {
  const videos = await loadPicks();
  $('picks').hidden = !videos.length;
  if (!videos.length) return;
  const level = LEVELS.includes(S.settings.pickLevel) ? S.settings.pickLevel : 'All';
  $('level-chips').replaceChildren(...LEVELS.map((lv) => {
    const b = el('button', 'chip-btn', lv);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(lv === level));
    if (LEVEL_TIP[lv]) b.title = LEVEL_TIP[lv];
    const count = lv === 'All' ? videos.length : videos.filter((v) => v.level === lv).length;
    b.append(el('span', 'count', String(count)));
    b.addEventListener('click', () => { S.settings.pickLevel = lv; saveSettings(); renderPicks(); });
    return b;
  }));
  const recent = Object.fromEntries(store.get('recent', []).map((r) => [r.id, r]));
  const shown = videos.filter((v) => level === 'All' || v.level === level);
  $('pick-grid').replaceChildren(...shown.map((v) => {
    const a = el('a', 'pick-card');
    a.href = `#/v/${v.id}`;
    const thumb = el('div', 'pick-thumb');
    const img = el('img');
    img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img, el('span', 'duration', minutes(v.seconds)));
    const body = el('div', 'pick-body');
    body.append(el('b', 'pick-title', v.title), el('span', 'pick-speaker', v.speaker));
    const meta = el('div', 'pick-meta');
    const lv = el('span', `level ${v.level.toLowerCase()}`, v.level);
    lv.title = LEVEL_TIP[v.level];
    meta.append(lv, el('span', '', `${v.wpm} wpm`), el('span', '', v.topic));
    body.append(meta);
    const r = recent[v.id];
    if (r && r.done) {
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round((100 * r.done) / r.n)}%`;
      bar.append(fill);
      bar.title = `${r.done} of ${r.n} sentences done`;
      body.append(bar);
    }
    a.append(thumb, body);
    return a;
  }));
}

// ------------------------------------------------------------------ loading

async function fetchCaptions(id, track) {
  if (track === 'pasted') {
    const p = store.get('pasted.' + id);
    if (!p) throw new Error('Your pasted transcript for this video is gone. Paste it again.');
    return { id, title: p.title || '', author: '', track: { id: 'pasted', name: 'Your transcript', kind: 'pasted' }, tracks: [], cues: p.cues };
  }
  // Recommended videos ship with their captions (works on static hosting, and instantly).
  const bundled = await loadBundled(id);
  if (bundled && (!track || track === bundled.track.id)) return bundled;
  if (await hasApi()) {
    const r = await fetch(apiUrl(`api/captions?v=${id}` + (track ? `&track=${encodeURIComponent(track)}` : '')));
    const data = await r.json().catch(() => ({ error: `The caption server answered ${r.status}.` }));
    if (!r.ok) throw new Error(data.error || `The caption server answered ${r.status}.`);
    return data;
  }
  if (bundled) return bundled;
  throw new Error(STATIC_MSG);
}

const STATIC_MSG = 'This copy of capkey runs without a caption server, so it cannot read captions from YouTube by itself '
  + '(browsers are not allowed to). Pick one of the recommended videos, paste the transcript below, '
  + 'or run capkey on your computer (python server.py) to use any video.';

async function loadBundled(id) {
  try {
    const r = await fetch(`data/captions/${id}.json`);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Is there a caption server (python server.py, or the one named in <meta name="capkey-api">)? */
function hasApi() {
  S.apiCheck ??= fetch(apiUrl('api/health'))
    .then((r) => r.ok && (r.headers.get('content-type') || '').includes('json'))
    .catch(() => false)
    .then((ok) => (S.api = ok));
  return S.apiCheck;
}

async function openVideo(id, track) {
  const token = ++S.loadToken;
  S.clip?.pause();
  clearTimeout(S.autoTimer);
  $('home').hidden = true;
  $('practice').hidden = false;
  $('finish').hidden = true;
  $('video-title').textContent = 'Loading captions…';
  $('video-sub').textContent = '';
  $('line').replaceChildren(el('p', 'loading', 'Fetching the captions and splitting them into sentences…'));
  $('feedback').textContent = '';
  let data;
  try {
    data = await fetchCaptions(id, track);
  } catch (e) {
    if (token !== S.loadToken) return;
    $('url').value = `https://www.youtube.com/watch?v=${id}`;
    $('paste').open = true;
    history.replaceState(null, '', '#/');
    showHome(e.message);
    return;
  }
  if (token !== S.loadToken) return;

  const sentences = L.segment(L.buildWords(data.cues));
  if (!sentences.length) {
    history.replaceState(null, '', '#/');
    showHome('The captions have no words to practise with.');
    return;
  }
  S.data = data;
  S.sentences = sentences;
  S.key = `p.${id}.${data.track.id}`;
  const saved = store.get(S.key, null);
  S.prog = saved && saved.n === sentences.length ? saved : { n: sentences.length, idx: 0, done: {} };

  await hasApi();
  if (token !== S.loadToken) return;
  renderMeta();
  renderTracks();
  $('seek').max = sentences.length;

  if (!S.clip) {
    S.clip = new Clip($('player'));
    S.clip.onError = (code) => showScreenMsg(PLAYER_ERRORS[code] || `The player reported error ${code}.`);
    S.clip.onState = (st) => {
      if (st === 1) showScreenMsg('');
      if (st !== 1 && st !== 3 && !S.clip.busy) setPlaying(false);
      fillTitle();
    };
  }
  showScreenMsg('');
  try {
    await S.clip.load(id);
  } catch (e) {
    showScreenMsg(e.message);
  }
  if (token !== S.loadToken) return;
  fillTitle();
  touchRecent();
  goTo(Math.min(S.prog.idx || 0, sentences.length - 1), { play: false });
}

/** Pasted transcripts have no title: take it from the player once it knows it. */
function fillTitle() {
  if (!S.data || S.data.title) return;
  let vd;
  try { vd = S.clip?.player?.getVideoData?.(); } catch { /* player not ready */ }
  if (vd && vd.title && vd.video_id === S.data.id) {
    S.data.title = vd.title;
    renderMeta();
    touchRecent();
  }
}

function renderMeta() {
  const d = S.data;
  $('video-title').textContent = d.title || 'YouTube video';
  const bits = [d.author, `${S.sentences.length} sentences`, d.track.name].filter(Boolean);
  $('video-sub').textContent = bits.join(' · ');
  document.title = `${d.title || 'Practice'} · capkey`;
}

function renderTracks() {
  const d = S.data;
  const sel = $('track');
  // without a caption server only the bundled track can be loaded
  const usable = S.api ? d.tracks : d.tracks.filter((t) => t.id === d.track.id);
  const opts = usable.map((t) => [t.id, t.kind === 'auto' ? `${t.name}` : `${t.name} (by the uploader)`]);
  if (store.get('pasted.' + d.id)) opts.push(['pasted', 'Your transcript']);
  if (d.track.id === 'pasted' && !opts.some((o) => o[0] === 'pasted')) opts.push(['pasted', 'Your transcript']);
  sel.replaceChildren(...opts.map(([v, label]) => { const o = el('option', '', label); o.value = v; return o; }));
  sel.value = d.track.id;
  $('track-wrap').hidden = opts.length < 2;
}

function showScreenMsg(text) {
  const m = $('screen-msg');
  m.hidden = !text;
  m.textContent = text;
}

// ------------------------------------------------------------------ progress

function saveProgress() {
  S.prog.idx = S.idx;
  store.set(S.key, S.prog);
  touchRecent();
}

function totals() {
  const done = Object.values(S.prog.done);
  const score = done.reduce((n, d) => n + d.score, 0);
  const total = done.reduce((n, d) => n + d.total, 0);
  return { count: done.length, score, total, perfect: done.filter((d) => d.score === d.total).length };
}

function touchRecent() {
  const d = S.data;
  const t = totals();
  const list = store.get('recent', []).filter((r) => r.id !== d.id);
  list.unshift({
    id: d.id, track: d.track.id, title: d.title || 'YouTube video', n: S.sentences.length,
    done: t.count, score: t.score, total: t.total, at: Date.now(),
  });
  store.set('recent', list.slice(0, 12));
}

function renderRecent() {
  const list = store.get('recent', []);
  $('recent-wrap').hidden = !list.length;
  $('recent').replaceChildren(...list.map((r) => {
    const card = el('div', 'recent-card');
    const open = el('a', 'recent-open');
    open.href = `#/v/${r.id}` + (r.track && r.track !== 'en.manual' ? `/${r.track}` : '');
    const img = el('img');
    img.src = `https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    const body = el('div', 'recent-body');
    body.append(el('b', 'recent-title', r.title));
    const pct = r.n ? Math.round((100 * r.done) / r.n) : 0;
    const bar = el('div', 'bar');
    bar.append(el('i'));
    bar.firstChild.style.width = pct + '%';
    const acc = r.total ? ` · ${Math.round((100 * r.score) / r.total)}% right` : '';
    body.append(bar, el('span', 'muted small', `${r.done} of ${r.n} sentences${acc}`));
    open.append(img, body);
    const rm = el('button', 'icon-btn remove');
    rm.type = 'button';
    rm.title = 'Remove from this list (keeps progress)';
    rm.innerHTML = ICON.close;
    rm.addEventListener('click', () => {
      store.set('recent', store.get('recent', []).filter((x) => x.id !== r.id));
      renderRecent();
    });
    card.append(open, rm);
    return card;
  }));
}

// ------------------------------------------------------------------ sentence

function goTo(i, { play = true } = {}) {
  if (!S.sentences.length) return;
  S.idx = Math.max(0, Math.min(i, S.sentences.length - 1));
  S.clip?.pause();
  setPlaying(false);
  $('finish').hidden = true;
  renderSentence();
  saveProgress();
  renderStats();
  renderTranscript();
  if (play) playSentence(false);
  else {
    $('feedback').textContent = 'Press Enter or Play to hear the sentence.';
    focusSlot(0);
  }
}

function setW(slot) {
  const len = slot.input.value.length;
  const w = S.settings.letters ? Math.max(slot.core.length, len) : Math.max(5, len + 1);
  slot.input.style.setProperty('--w', w);
}

function renderSentence() {
  clearTimeout(S.autoTimer);
  const sen = S.sentences[S.idx];
  const pick = L.pickBlanks(sen, S.settings.blanks);
  S.slots = [];
  S.phase = 'type';
  S.checked = false;
  S.dirty = false;
  const line = $('line');
  line.className = 'line' + (S.settings.letters ? '' : ' no-letters');
  const nodes = sen.words.map((w, k) => {
    const { lead, core, tail } = L.splitWord(w.t);
    if (!pick[k]) return el('span', 'word given', w.t);
    const word = el('span', 'word slot');
    if (lead) word.append(el('span', 'punct', lead));
    const cell = el('span', 'cell');
    const input = el('input', 'blank');
    Object.assign(input, { type: 'text', autocomplete: 'off', spellcheck: false });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'done');
    input.style.setProperty('--n', core.length);
    cell.append(el('span', 'answer', core), input);
    word.append(cell);
    if (tail) word.append(el('span', 'punct', tail));
    const slot = { core, key: L.normalize(core), input, word, state: '', hinted: false, revealed: false };
    input.setAttribute('aria-label', `Word ${S.slots.length + 1}`);
    S.slots.push(slot);
    setW(slot);
    wire(slot);
    return word;
  });
  line.replaceChildren(...nodes);
  S.slots.forEach((s, j) => s.input.setAttribute('aria-label', `Word ${j + 1} of ${S.slots.length}`));
  $('counter').textContent = `Sentence ${S.idx + 1} of ${S.sentences.length}`;
  $('seek').value = S.idx + 1;
  $('main-btn').textContent = 'Check';
  $('hint-btn').disabled = false;
  $('reveal-btn').disabled = false;
  $('prev-btn').disabled = S.idx === 0;
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
  $('card').classList.remove('perfect');
}

function setState(slot, st) {
  slot.state = st;
  slot.word.classList.toggle('right', st === 'right');
  slot.word.classList.toggle('close', st === 'close');
  slot.word.classList.toggle('wrong', st === 'wrong');
}

const isOk = (s) => s.state === 'right' || s.state === 'close';

function focusSlot(i, atEnd = false) {
  const s = S.slots[i];
  if (!s) return;
  s.input.focus({ preventScroll: true });
  const n = atEnd ? s.input.value.length : s.input.value.length;
  try { s.input.setSelectionRange(n, n); } catch { /* not focusable */ }
}

/** Next blank at or after i that still needs typing. */
function focusOpen(i) {
  for (let j = i; j < S.slots.length; j++) {
    if (!isOk(S.slots[j]) && !S.slots[j].revealed) return focusSlot(j);
  }
  for (let j = 0; j < i && j < S.slots.length; j++) {
    if (!isOk(S.slots[j]) && !S.slots[j].revealed) return focusSlot(j);
  }
}

/** Text with spaces in one blank (phone keyboards, paste, dictation): spread it over the next blanks. */
function spill(slot) {
  const raw = slot.input.value;
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const trailing = /\s$/.test(raw);
  slot.input.value = parts.shift() || '';
  slot.input.dispatchEvent(new Event('input'));
  if (S.phase === 'done') return;
  const i = S.slots.indexOf(slot);
  const next = S.slots.slice(i + 1).find((s) => !s.revealed);
  if (!next) return;
  if (parts.length) {
    next.input.focus({ preventScroll: true });
    next.input.value = parts.join(' ') + (trailing ? ' ' : '');
    next.input.dispatchEvent(new Event('input'));
  } else if (trailing && slot.input.value && document.activeElement === slot.input) {
    focusSlot(S.slots.indexOf(next));
  }
}

function wire(slot) {
  const input = slot.input;
  input.addEventListener('input', () => {
    if (/\s/.test(input.value)) return spill(slot);
    setW(slot);
    if (S.phase === 'done' || slot.revealed) return;
    S.dirty = true;
    if (slot.state && slot.state !== 'right') setState(slot, '');
    if (!S.settings.live) return;
    const r = L.checkWord(input.value, slot.key, false);
    if (r === 'right' && slot.state !== 'right') {
      setState(slot, 'right');
      if (input.selectionStart === input.value.length) focusOpen(S.slots.indexOf(slot) + 1);
      if (S.slots.every((s) => isOk(s) || s.revealed)) check();
    } else if (r !== 'right' && slot.state === 'right') setState(slot, '');
  });
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = S.slots.indexOf(slot);
    const at = input.selectionStart;
    const collapsed = at === input.selectionEnd;
    if (e.key === ' ') {
      e.preventDefault();
      if (input.value.trim() && i < S.slots.length - 1) focusSlot(i + 1);
    } else if (e.key === 'Backspace' && !input.value && i > 0) {
      e.preventDefault();
      focusSlot(i - 1, true);
    } else if (e.key === 'ArrowLeft' && collapsed && at === 0 && i > 0) {
      e.preventDefault();
      focusSlot(i - 1, true);
    } else if (e.key === 'ArrowRight' && collapsed && at === input.value.length && i < S.slots.length - 1) {
      e.preventDefault();
      focusSlot(i + 1);
    }
  });
}

function recordFirst() {
  const good = S.slots.filter((s) => isOk(s) && !s.hinted && !s.revealed).length;
  S.prog.done[S.idx] = { score: good, total: S.slots.length, at: Date.now() };
  saveProgress();
}

function check() {
  if (S.phase === 'done' || !S.slots.length) return;
  let bad = 0;
  for (const s of S.slots) {
    if (s.revealed) continue;
    const r = L.checkWord(s.input.value, s.key, S.settings.typos);
    setState(s, r === 'empty' ? 'wrong' : r);
    if (r === 'wrong' || r === 'empty') bad++;
  }
  if (!S.checked) { S.checked = true; recordFirst(); }
  S.dirty = false;
  if (!bad) return finish();
  S.phase = 'checked';
  const fb = $('feedback');
  fb.className = 'feedback warn';
  fb.textContent = `${bad} word${bad > 1 ? 's' : ''} to fix. Correct ${bad > 1 ? 'them' : 'it'} and press Enter, or press Enter to see the answers.`;
  $('main-btn').textContent = 'Show answers';
  focusOpen(0);
}

function reveal() {
  if (S.phase === 'done') return;
  for (const s of S.slots) {
    if (isOk(s)) continue;
    s.revealed = true;
    s.word.classList.add('revealed');
    if (!s.input.value.trim()) s.word.classList.add('missed');
    setState(s, 'wrong');
  }
  if (!S.checked) { S.checked = true; recordFirst(); }
  finish();
}

function hint() {
  if (S.phase === 'done') return;
  const active = S.slots.find((s) => s.input === document.activeElement && !isOk(s) && !s.revealed);
  const s = active || S.slots.find((x) => !isOk(x) && !x.revealed);
  if (!s) return;
  s.input.value = L.nextHint(s.input.value, s.core);
  s.hinted = true;
  s.word.classList.add('hinted');
  focusSlot(S.slots.indexOf(s), true);
  s.input.dispatchEvent(new Event('input'));
}

function finish() {
  S.phase = 'done';
  for (const s of S.slots) s.input.readOnly = true;
  const d = S.prog.done[S.idx];
  const perfect = d && d.score === d.total;
  const fb = $('feedback');
  fb.className = 'feedback ' + (perfect ? 'good' : 'plain');
  const last = S.idx >= S.sentences.length - 1;
  if (perfect) fb.textContent = last ? 'Perfect. That was the last sentence.' : 'Perfect. Press Enter for the next sentence.';
  else fb.textContent = `${d ? d.score : 0} of ${S.slots.length} words right the first time. Press Enter to go on.`;
  $('card').classList.toggle('perfect', !!perfect);
  $('main-btn').textContent = last ? 'Finish' : 'Next';
  $('hint-btn').disabled = true;
  $('reveal-btn').disabled = true;
  $('main-btn').focus({ preventScroll: true });
  renderStats();
  renderTranscript();
  if (perfect && S.settings.autoNext && !last) S.autoTimer = setTimeout(() => next(), 1100);
}

function next() {
  clearTimeout(S.autoTimer);
  if (S.idx >= S.sentences.length - 1) {
    if (S.phase === 'done') showFinish();
    return;
  }
  goTo(S.idx + 1, { play: S.settings.autoPlay });
}

function prev() {
  clearTimeout(S.autoTimer);
  if (S.idx > 0) goTo(S.idx - 1, { play: true });
}

function primary() {
  if (S.phase === 'done') return next();
  if (S.phase === 'checked') return S.dirty ? check() : reveal();
  // Nothing typed yet: Enter (re)plays the sentence instead of marking everything wrong.
  if (S.slots.every((s) => !s.input.value.trim())) return playSentence(false);
  check();
}

// ------------------------------------------------------------------ playback

function setPlaying(on) {
  S.playing = on;
  const b = $('replay-btn');
  b.classList.toggle('is-playing', on);
  b.innerHTML = on
    ? '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span>Playing</span>'
    : `${ICON.replay}<span>Replay</span>`;
  $('phase').textContent = on ? 'Listening' : '';
}

function playSentence(slow) {
  if (!S.clip?.player || !S.sentences.length) return;
  clearTimeout(S.autoTimer);
  const { start, end } = L.playWindow(S.sentences, S.idx);
  const speed = +S.settings.speed || 1;
  const rate = slow ? Math.max(0.5, speed - 0.25 >= 0.5 ? speed - 0.25 : 0.5) : speed;
  setPlaying(true);
  S.clip.playRange(start, end, rate, () => setPlaying(false));
  if (S.phase !== 'done') {
    if ($('feedback').textContent.startsWith('Press Enter or Play')) $('feedback').textContent = '';
    focusOpen(0);
  }
}

// ------------------------------------------------------------------ side panels

function renderStats() {
  const t = totals();
  const acc = t.total ? Math.round((100 * t.score) / t.total) + '%' : '–';
  const tiles = [
    ['Done', `${t.count}`, `of ${S.sentences.length}`],
    ['Words right', acc, t.total ? `${t.score} of ${t.total}` : 'first try'],
    ['Perfect', `${t.perfect}`, 'sentences'],
  ];
  $('stats').replaceChildren(...tiles.map(([label, value, sub]) => {
    const tile = el('div', 'tile');
    tile.append(el('span', 'tile-label', label), el('b', 'tile-value', value), el('span', 'tile-sub', sub));
    return tile;
  }));
}

function renderTranscript() {
  const ids = Object.keys(S.prog.done).map(Number).filter((i) => i < S.sentences.length).sort((a, b) => a - b);
  $('transcript-empty').hidden = ids.length > 0;
  $('transcript-count').textContent = ids.length ? `${ids.length} sentence${ids.length > 1 ? 's' : ''}` : '';
  $('transcript').replaceChildren(...ids.map((i) => {
    const d = S.prog.done[i];
    const li = el('li', i === S.idx ? 'current' : '');
    const b = el('button', 'tline');
    b.type = 'button';
    b.append(el('span', 'tnum', String(i + 1)), el('span', 'ttext', S.sentences[i].words.map((w) => w.t).join(' ')));
    const chip = el('span', 'chip ' + (d.score === d.total ? 'ok' : d.score / d.total >= 0.7 ? 'mid' : 'low'), `${d.score}/${d.total}`);
    b.append(chip);
    b.title = 'Practise this sentence again';
    b.addEventListener('click', () => goTo(i, { play: true }));
    li.append(b);
    return li;
  }));
  // keep the current line in view by scrolling the list only, never the page
  const list = $('transcript');
  const cur = list.querySelector('.current') || list.lastElementChild;
  if (cur) {
    const top = cur.offsetTop; // the list is the offsetParent (position: relative)
    if (top < list.scrollTop || top + cur.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }
}

function showFinish() {
  const t = totals();
  const box = $('finish');
  const acc = t.total ? Math.round((100 * t.score) / t.total) : 0;
  box.replaceChildren();
  box.append(
    el('h3', '', 'You reached the end of the video'),
    el('p', '', `${t.count} of ${S.sentences.length} sentences done, ${acc}% of the words right the first time, ${t.perfect} perfect.`),
  );
  const row = el('div', 'row');
  const again = el('button', 'btn', 'Start over');
  again.type = 'button';
  again.addEventListener('click', () => resetProgress(false));
  const home = el('a', 'btn primary', 'Pick another video');
  home.href = '#/';
  row.append(again, home);
  box.append(row);
  box.hidden = false;
}

function resetProgress(ask = true) {
  if (!S.prog) return;
  if (ask && !confirm('Forget your results for this video and start from the first sentence?')) return;
  S.prog = { n: S.sentences.length, idx: 0, done: {} };
  goTo(0, { play: false });
}

// ------------------------------------------------------------------ toggles & settings

function applyScreen() {
  $('veil').hidden = !S.settings.veil;
  $('subcover').hidden = !S.settings.cover;
  const vb = $('veil-btn');
  vb.setAttribute('aria-pressed', String(!!S.settings.veil));
  vb.innerHTML = `${ICON.headphones}<span>Audio only</span>`;
  const cb = $('cover-btn');
  cb.setAttribute('aria-pressed', String(!!S.settings.cover));
  cb.innerHTML = `${ICON.subs}<span>Cover subtitles</span>`;
  $('speed').value = String(S.settings.speed);
}

function openSettings() {
  const f = $('settings').querySelector('form');
  f.blanks.value = S.settings.blanks;
  for (const k of ['letters', 'live', 'typos', 'autoNext', 'autoPlay']) f[k].checked = !!S.settings[k];
  $('reset-progress').hidden = $('practice').hidden;
  $('settings').showModal();
}

function onSettingChange(e) {
  const t = e.target;
  if (!t.name) return;
  S.settings[t.name] = t.type === 'checkbox' ? t.checked : t.value;
  saveSettings();
  if ((t.name === 'blanks' || t.name === 'letters') && !$('practice').hidden && S.sentences.length) {
    renderSentence();
  }
}

// ------------------------------------------------------------------ setup

function init() {
  applyTheme();
  applyScreen();
  $('settings-btn').innerHTML = ICON.gear;
  $('prev-btn').innerHTML = ICON.prev;
  $('next-btn').innerHTML = ICON.next;
  $('slow-btn').innerHTML = `${ICON.slow}<span>Slower</span>`;
  $('hint-btn').innerHTML = `${ICON.hint}<span>Hint</span>`;
  $('reveal-btn').innerHTML = `${ICON.eye}<span>Show answers</span>`;
  setPlaying(false);

  $('theme-btn').addEventListener('click', () => {
    S.settings.theme = THEMES[(THEMES.indexOf(S.settings.theme) + 1) % THEMES.length];
    saveSettings();
    applyTheme();
  });

  $('load-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = L.parseVideoId($('url').value);
    if (!id) {
      $('home-error').hidden = false;
      $('home-error').textContent = 'That does not look like a YouTube link. Copy the address of the video page and paste it here.';
      return;
    }
    location.hash = `#/v/${id}`;
  });
  $('example').addEventListener('click', () => {
    $('url').value = EXAMPLE;
    $('load-form').requestSubmit();
  });
  $('paste-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) $('paste-text').value = await f.text();
  });
  $('paste-go').addEventListener('click', () => {
    const id = L.parseVideoId($('url').value);
    const err = $('home-error');
    if (!id) {
      err.hidden = false;
      err.textContent = 'Put the YouTube link in the box above first, so the video can play.';
      $('url').focus();
      return;
    }
    const cues = L.parseSubtitles($('paste-text').value);
    if (!cues.length) {
      err.hidden = false;
      err.textContent = 'No timed lines found. The transcript needs times like 00:00:12,645 --> 00:00:14,015 or 0:12.';
      return;
    }
    store.set('pasted.' + id, { cues });
    location.hash = `#/v/${id}/pasted`;
  });

  $('replay-btn').addEventListener('click', () => playSentence(false));
  $('slow-btn').addEventListener('click', () => playSentence(true));
  $('prev-btn').addEventListener('click', prev);
  $('next-btn').addEventListener('click', () => { clearTimeout(S.autoTimer); goTo(S.idx + 1, { play: true }); });
  $('speed').addEventListener('change', (e) => { S.settings.speed = +e.target.value; saveSettings(); });
  $('veil-btn').addEventListener('click', () => { S.settings.veil = !S.settings.veil; saveSettings(); applyScreen(); });
  $('veil').addEventListener('click', () => { S.settings.veil = false; saveSettings(); applyScreen(); });
  $('cover-btn').addEventListener('click', () => { S.settings.cover = !S.settings.cover; saveSettings(); applyScreen(); });
  $('track').addEventListener('change', (e) => {
    const v = e.target.value;
    location.hash = `#/v/${S.data.id}` + (v === S.data.tracks[0]?.id ? '' : `/${v}`);
  });
  $('seek').addEventListener('input', (e) => { $('counter').textContent = `Sentence ${e.target.value} of ${S.sentences.length}`; });
  $('seek').addEventListener('change', (e) => goTo(+e.target.value - 1, { play: true }));

  $('main-btn').addEventListener('click', primary);
  $('hint-btn').addEventListener('click', hint);
  $('reveal-btn').addEventListener('click', reveal);

  $('settings-btn').addEventListener('click', openSettings);
  $('settings').addEventListener('change', onSettingChange);
  $('reset-progress').addEventListener('click', () => { $('settings').close(); resetProgress(true); });
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').close(); });

  document.addEventListener('keydown', (e) => {
    if ($('practice').hidden || $('settings').open) return;
    const tag = e.target.tagName;
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.target !== $('main-btn')) return;
      }
      e.preventDefault();
      primary();
    } else if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      playSentence(false);
    } else if (e.ctrlKey && e.key === 'ArrowDown') {
      e.preventDefault();
      playSentence(true);
    } else if (e.ctrlKey && e.key === 'ArrowRight') {
      e.preventDefault();
      clearTimeout(S.autoTimer);
      goTo(S.idx + 1, { play: true });
    } else if (e.ctrlKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.ctrlKey && (e.key === '/' || e.code === 'Slash')) {
      e.preventDefault();
      hint();
    }
  });

  hasApi().then((ok) => { $('static-note').hidden = ok; });
  window.addEventListener('hashchange', route);
  route();
}

init();
