// Pure logic shared by the app and the Node tests: YouTube links, subtitle files,
// word timing, sentence splitting and answer checking. No DOM here.

const ID = /^[\w-]{11}$/;

export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (ID.test(s)) return s;
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const ok = (id) => (id && ID.test(id) ? id : null);
  if (host === 'youtu.be') return ok(u.pathname.split('/')[1]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.searchParams.get('v')) return ok(u.searchParams.get('v'));
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v|e)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------- subtitle files

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;

export function parseTime(str) {
  const m = TIME.exec(String(str).trim());
  if (!m) return NaN;
  const [, h, mm, ss, frac] = m;
  return (+h || 0) * 3600 + +mm * 60 + +ss + (frac ? +('0.' + frac.padEnd(3, '0')) : 0);
}

const ARROW = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
const STAMP = /^\(?((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\)?\s*(.*)$/;
const SPOKEN_TIME = /^\d+ (?:hours?|minutes?|seconds?)(?:, \d+ (?:hours?|minutes?|seconds?))*$/i;

function cleanTags(line) {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .trim();
}

/** SRT, WebVTT or a copied YouTube transcript ("0:12" lines) -> [{s, e, text}]. */
export function parseSubtitles(raw) {
  const text = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let cues = [];
  if (ARROW.test(text)) {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const k = lines.findIndex((l) => ARROW.test(l));
      if (k < 0) continue;
      const m = ARROW.exec(lines[k]);
      const body = lines.slice(k + 1).map(cleanTags).filter(Boolean);
      if (body.length) cues.push({ s: parseTime(m[1]), e: parseTime(m[2]), lines: body });
    }
    // Auto-generated VTT repeats the previous line at the top of every cue.
    for (let i = 1; i < cues.length; i++) {
      const prev = cues[i - 1].lines;
      while (cues[i].lines.length && prev.length && cues[i].lines[0] === prev[prev.length - 1]) {
        cues[i].lines.shift();
      }
    }
  } else {
    let cur = null;
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (!l || SPOKEN_TIME.test(l)) continue;
      const m = STAMP.exec(l);
      if (m && Number.isFinite(parseTime(m[1]))) {
        cur = { s: parseTime(m[1]), lines: [] };
        cues.push(cur);
        if (m[2]) cur.lines.push(m[2]);
      } else if (cur) cur.lines.push(l);
    }
    cues.forEach((c, i) => { c.e = i + 1 < cues.length ? cues[i + 1].s : c.s + 5; });
  }
  cues = cues.filter((c) => c.lines.length && Number.isFinite(c.s) && Number.isFinite(c.e));
  return cues.map((c) => ({ s: c.s, e: Math.max(c.e, c.s + 0.2), text: c.lines.join(' ') }));
}

// ---------------------------------------------------------------- words

const HAS_WORD = /[\p{L}\p{N}]/u;

/** Drop sound tags ([Music], (Laughter), ♪) and speaker-change marks (>>). */
export function cleanCaption(text) {
  return String(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:\s*[^()\s]+){1,3}\s*\)/g, ' ')
    .replace(/[♪♫]+|>>+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const estimate = (t) => Math.max(0.45, 0.08 * t.length + 0.3);

/** Cues -> [{t, s, e}] with a time span for every word. */
export function buildWords(cues) {
  const words = [];
  cues.forEach((c, ci) => {
    const next = cues[ci + 1];
    const limit = next && next.s > c.s ? Math.min(c.e, next.s) : c.e;
    let items;
    if (c.words && c.words.length) {
      items = [];
      for (const [t, w] of c.words) {
        for (const tok of cleanCaption(w).split(' ').filter(Boolean)) {
          items.push({ t: tok, s: t, e: c.e, timed: true });
        }
      }
    } else {
      const toks = cleanCaption(c.text).split(' ').filter(Boolean);
      const end = limit - c.s >= 0.2 ? limit : c.e;
      const total = toks.reduce((n, t) => n + t.length + 1, 0) || 1;
      let at = c.s;
      items = toks.map((t) => {
        const span = ((end - c.s) * (t.length + 1)) / total;
        const w = { t, s: at, e: at + span };
        at += span;
        return w;
      });
    }
    for (const it of items) {
      if (!HAS_WORD.test(it.t)) {
        // "--", "-", "…": glue to the previous word, no blank for them
        if (words.length) words[words.length - 1].t += ' ' + it.t;
        continue;
      }
      words.push(it);
    }
  });
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.timed) continue;
    const nx = words[i + 1];
    if (nx && nx.s > w.s) w.e = Math.min(w.e, nx.s);
    w.e = Math.max(w.s + 0.15, Math.min(w.e, w.s + estimate(w.t)));
    delete w.timed;
  }
  return words;
}

// ---------------------------------------------------------------- sentences

const END = /[.?!…]["'”’)\]]*$/;
const ABBR = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|u\.s|u\.k|no|vol|fig|inc|ltd|co|approx)\.$/i;
const BREAK = /[,;:—–]["'”’)]*$|\s--?$/;

export function isPunctuated(words) {
  const n = words.filter((w) => END.test(w.t)).length;
  return n >= 1 && n / Math.max(words.length, 1) >= 1 / 40;
}

function startsSentence(t) {
  const m = /[\p{L}\p{N}]/u.exec(t);
  return !m || /[\p{Lu}\p{N}]/u.test(m[0]);
}

function splitLong(ws, max, punctuated) {
  if (ws.length <= max) return [ws];
  const min = 4;
  let best = -1;
  let score = -Infinity;
  const mid = (ws.length - 1) / 2;
  for (let k = min - 1; k < ws.length - min; k++) {
    const gap = ws[k + 1].s - ws[k].e;
    const brk = BREAK.test(ws[k].t) ? 1 : 0;
    const sc = (punctuated ? brk * 3 : 0) + Math.min(gap, 1.5) * 2 - Math.abs(k - mid) / ws.length;
    if (sc > score) { score = sc; best = k; }
  }
  if (best < 0) return [ws];
  return [...splitLong(ws.slice(0, best + 1), max, punctuated), ...splitLong(ws.slice(best + 1), max, punctuated)];
}

/** Words -> sentences [{i, s, e, words}]. Punctuation when the track has it, pauses otherwise. */
export function segment(words, opts = {}) {
  const punctuated = opts.punctuated ?? isPunctuated(words);
  const max = opts.maxWords ?? (punctuated ? 24 : 16);
  const groups = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const nx = words[i + 1];
    const gap = nx ? nx.s - w.e : Infinity;
    let end;
    if (!nx) end = true;
    else if (punctuated) {
      const core = w.t.replace(/^[^\p{L}\p{N}]+/u, '');
      end = (END.test(w.t) && !ABBR.test(core) && startsSentence(nx.t)) || (gap > 2 && cur.length >= 3);
    } else {
      end = (gap >= 0.35 && cur.length >= 5) || gap >= 1.2;
    }
    if (end) { groups.push(cur); cur = []; }
  });
  const out = [];
  for (const g of groups) out.push(...splitLong(g, max, punctuated));
  // A one-word sentence ("So.", "Okay.") goes with the next one.
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i].length === 1 && out[i + 1].length + 1 <= max + 4) out.splice(i, 2, [...out[i], ...out[i + 1]]);
  }
  return out.map((ws, i) => ({ i, s: ws[0].s, e: ws[ws.length - 1].e, words: ws }));
}

/** Seconds to play for a sentence: a short lead-in and a tail that stops before the next one. */
export function playWindow(sentences, i, lead = 0.15, tail = 0.3) {
  const sen = sentences[i];
  const next = sentences[i + 1];
  const prev = sentences[i - 1];
  let start = Math.max(0, sen.s - lead);
  if (prev && prev.e > start) start = Math.max(start, Math.min(sen.s, prev.e));
  let end = sen.e + tail;
  if (next) end = Math.max(sen.e + 0.05, Math.min(end, next.s + 0.1));
  return { start, end };
}

// ---------------------------------------------------------------- answers

export function splitWord(t) {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(t);
  return { lead: m[1], core: m[2], tail: m[3] };
}

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

const NUMBERS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
const TENS = { thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000 };
const ALIASES = { okay: 'ok', alright: 'allright', gonna: 'gonna', percent: 'percent', mister: 'mr', doctor: 'dr' };

function canon(k) {
  const n = NUMBERS.indexOf(k);
  if (n >= 0) return String(n);
  if (k in TENS) return String(TENS[k]);
  return ALIASES[k] || k;
}

export function distance(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** 'right' | 'close' (small typo, still counts) | 'wrong' | 'empty' */
export function checkWord(typed, key, tolerant = true) {
  const a = canon(normalize(typed));
  const b = canon(key);
  if (!a) return 'empty';
  if (a === b) return 'right';
  if (tolerant && b.length >= 4 && distance(a, b) <= (b.length >= 8 ? 2 : 1)) return 'close';
  return 'wrong';
}

/** The answer up to the first wrong letter of what was typed, plus one more letter. */
export function nextHint(typed, core) {
  const t = String(typed || '').toLowerCase();
  const c = core.toLowerCase();
  let n = 0;
  while (n < t.length && n < c.length && t[n] === c[n]) n++;
  let k = n + 1;
  while (k < core.length && !/[\p{L}\p{N}]/u.test(core[k - 1])) k++;
  return core.slice(0, Math.min(k, core.length));
}

function rand(seed) {
  let x = (seed * 2654435761) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Which words of a sentence become blanks: 'all' | 'half' | 'long'. */
export function pickBlanks(sentence, mode = 'all') {
  const keys = sentence.words.map((w) => normalize(splitWord(w.t).core));
  let pick = keys.map((k) => !!k);
  if (mode === 'half') pick = keys.map((k, j) => !!k && rand(sentence.i * 97 + j + 1) < 0.5);
  if (mode === 'long') pick = keys.map((k) => k.length >= 5);
  if (!pick.some(Boolean)) {
    let best = -1;
    keys.forEach((k, j) => { if (k && (best < 0 || k.length > keys[best].length)) best = j; });
    if (best >= 0) pick[best] = true;
  }
  return pick;
}
