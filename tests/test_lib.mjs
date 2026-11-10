// node tests/test_lib.mjs  - pure logic of the client (no network, no DOM)
import assert from 'node:assert/strict';
import * as L from '../static/js/lib.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('video ids from every link shape', () => {
  const id = 'arj7oStGLkU';
  for (const s of [
    id, `https://www.youtube.com/watch?v=${id}`, `youtube.com/watch?v=${id}&t=42s`,
    `https://youtu.be/${id}?si=abc`, `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`, `https://music.youtube.com/watch?v=${id}`,
  ]) assert.equal(L.parseVideoId(s), id, s);
  for (const s of ['', 'hello', 'https://vimeo.com/123', 'https://youtube.com/watch?v=short', 'https://www.youtube.com/@TED']) {
    assert.equal(L.parseVideoId(s), null, s);
  }
});

t('times', () => {
  assert.equal(L.parseTime('00:00:12,645'), 12.645);
  assert.equal(L.parseTime('1:02:03.5'), 3723.5);
  assert.equal(L.parseTime('0:12'), 12);
  assert.equal(L.parseTime('12:05'), 725);
  assert.ok(Number.isNaN(L.parseTime('soon')));
});

t('SRT with tags and entities', () => {
  const cues = L.parseSubtitles('﻿1\r\n00:00:12,645 --> 00:00:14,015\r\n<i>So in</i> college,\r\n\r\n2\r\n00:00:15,349 --> 00:00:16,913\r\nI was a &amp; major,\r\n');
  assert.deepEqual(cues, [
    { s: 12.645, e: 14.015, text: 'So in college,' },
    { s: 15.349, e: 16.913, text: 'I was a & major,' },
  ]);
});

t('WebVTT with cue ids, settings and rolling auto lines', () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
so in college

00:00:03.000 --> 00:00:05.000 align:start position:0%
so in college
I was a <00:00:03.500><c>government</c> major
`;
  const cues = L.parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[1].text, 'I was a government major');
});

t('copied YouTube transcript', () => {
  const cues = L.parseSubtitles('0:12\n12 seconds\nSo in college,\n0:15\nI was a government major,\n1:02:03 the end');
  assert.deepEqual(cues.map((c) => [c.s, c.text]), [[12, 'So in college,'], [15, 'I was a government major,'], [3723, 'the end']]);
  assert.equal(cues[0].e, 15);
});

t('caption noise is dropped', () => {
  assert.equal(L.cleanCaption('(Laughter) So, [Music] you know >> right ♪'), 'So, you know right');
  assert.equal(L.cleanCaption('He said (and I quote this whole thing) yes'), 'He said (and I quote this whole thing) yes');
});

const manual = [
  { s: 12.645, e: 14.015, text: 'So in college,' },
  { s: 15.349, e: 16.913, text: 'I was a government major,' },
  { s: 16.937, e: 19.399, text: 'which means I had to write\na lot of papers.' },
  { s: 19.423, e: 21.471, text: 'Now, when Mr. Smith writes a paper,' },
  { s: 21.495, e: 23.868, text: 'he might spread the work out -- a little like this.' },
  { s: 25.067, e: 26.724, text: '(Laughter)' },
  { s: 26.748, e: 28.575, text: 'Okay. You get started maybe slowly?' },
];

t('words get times inside their cue, punctuation tokens are glued on', () => {
  const ws = L.buildWords(manual);
  assert.equal(ws[0].t, 'So');
  assert.equal(ws[0].s, 12.645);
  for (let i = 1; i < ws.length; i++) assert.ok(ws[i].s >= ws[i - 1].s, 'monotonic');
  const out = ws.find((w) => w.t.startsWith('out'));
  assert.equal(out.t, 'out --');
  assert.ok(!ws.some((w) => /Laughter/.test(w.t)));
  const last = ws.filter((w) => w.s < 14.1).at(-1);
  assert.ok(last.e <= 14.015 + 1e-9);
});

t('sentences split on punctuation, not on abbreviations; one-word sentences merge', () => {
  const ss = L.segment(L.buildWords(manual));
  const text = ss.map((s) => s.words.map((w) => w.t).join(' '));
  assert.deepEqual(text, [
    'So in college, I was a government major, which means I had to write a lot of papers.',
    'Now, when Mr. Smith writes a paper, he might spread the work out -- a little like this.',
    'Okay. You get started maybe slowly?',
  ]);
  assert.equal(ss[0].s, 12.645);
  assert.ok(ss[1].s > ss[0].e - 1e-9);
});

t('auto captions (no punctuation) split on pauses and stay short', () => {
  const words = [];
  let at = 0;
  for (let k = 0; k < 60; k++) {
    words.push([at, `w${k}`]);
    at += k % 9 === 8 ? 1.4 : 0.3; // a pause after every 9th word
  }
  const cues = [{ s: 0, e: at + 1, text: '', words }];
  const ss = L.segment(L.buildWords(cues));
  assert.ok(!L.isPunctuated(L.buildWords(cues)));
  assert.equal(ss[0].words.length, 9);
  assert.ok(ss.every((s) => s.words.length <= 16));
  assert.equal(ss.reduce((n, s) => n + s.words.length, 0), 60);
});

t('long punctuated sentences break at a comma near the middle', () => {
  const long = Array.from({ length: 40 }, (_, k) => (k === 19 ? 'word,' : k === 39 ? 'end.' : 'word')).join(' ');
  const ss = L.segment(L.buildWords([{ s: 0, e: 20, text: long }]));
  assert.equal(ss.length, 2);
  assert.equal(ss[0].words.at(-1).t, 'word,');
});

t('play window stays clear of the neighbours', () => {
  const ss = [{ s: 1, e: 3 }, { s: 3.1, e: 5 }, { s: 9, e: 10 }];
  assert.deepEqual(L.playWindow(ss, 0), { start: 0.85, end: 3.2 });
  const w = L.playWindow(ss, 1);
  assert.ok(w.start >= 3 && w.start <= 3.1);
  assert.equal(L.playWindow(ss, 2).end, 10.3);
});

t('word parts and normalising', () => {
  assert.deepEqual(L.splitWord('"papers."'), { lead: '"', core: 'papers', tail: '."' });
  assert.deepEqual(L.splitWord("don't,"), { lead: '', core: "don't", tail: ',' });
  assert.deepEqual(L.splitWord('out --'), { lead: '', core: 'out', tail: ' --' });
  assert.equal(L.normalize('Don’t'), "don't");
  assert.equal(L.normalize('Café'), 'cafe');
  assert.equal(L.normalize('well-known'), 'wellknown');
});

t('checking answers', () => {
  assert.equal(L.checkWord('Papers', 'papers'), 'right');
  assert.equal(L.checkWord('dont', "don't"), 'close');
  assert.equal(L.checkWord("don’t", "don't"), 'right');
  assert.equal(L.checkWord('10', 'ten'), 'right');
  assert.equal(L.checkWord('okay', 'ok'), 'right');
  assert.equal(L.checkWord('studant', 'student'), 'close');
  assert.equal(L.checkWord('studant', 'student', false), 'wrong');
  assert.equal(L.checkWord('procastinator', 'procrastinator'), 'close');
  assert.equal(L.checkWord('cat', 'cut'), 'wrong'); // short words must be exact
  assert.equal(L.checkWord('thing', 'this'), 'wrong');
  assert.equal(L.checkWord('  ', 'this'), 'empty');
});

t('hints add one correct letter at a time', () => {
  assert.equal(L.nextHint('', 'Paper'), 'P');
  assert.equal(L.nextHint('pa', 'Paper'), 'Pap');
  assert.equal(L.nextHint('pox', 'Paper'), 'Pa');
  assert.equal(L.nextHint('don', "don't"), "don't");
  assert.equal(L.nextHint('Paper', 'Paper'), 'Paper');
});

t('blank selection', () => {
  const sen = { i: 3, words: 'I was a government major , which'.split(' ').map((t) => ({ t })) };
  assert.deepEqual(L.pickBlanks(sen, 'all'), [true, true, true, true, true, false, true]);
  assert.deepEqual(L.pickBlanks(sen, 'long'), [false, false, false, true, true, false, true]);
  const half = L.pickBlanks(sen, 'half');
  assert.deepEqual(half, L.pickBlanks(sen, 'half'), 'stable between renders');
  assert.ok(half.some(Boolean));
  const tiny = { i: 0, words: [{ t: 'I' }, { t: 'am.' }] };
  assert.deepEqual(L.pickBlanks(tiny, 'long'), [false, true]);
});

console.log(`TEST OK (${n} groups)`);
