// node worker/test_worker.mjs - the Worker's parser and track logic, same cases as tests/test_server.py
import assert from 'node:assert/strict';
import { parseTimedtext, englishTracks, pick, trackUrl, getCaptions, CaptionError } from './worker.js';

const SRV3_MANUAL = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>
<p t="12645" d="1370">So in college,</p>
<p t="16937" d="2462">which means I had to write
a lot of papers.</p>
<p t="19423" d="2048">it&#39;s &amp;amp; done</p>
</body></timedtext>`;

const SRV3_AUTO = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><ws id="0"/></head><body>
<w t="0" id="1" wp="1" ws="1"/>
<p t="12559" d="4480" w="1"><s ac="0">so</s><s t="200" ac="0"> in</s></p>
<p t="14350" d="2689" w="1" a="1">
</p>
<p t="14360" d="5280" w="1"><s ac="0">college</s><s t="1000" ac="0"> I</s></p>
</body></timedtext>`;

const LEGACY = `<?xml version="1.0" encoding="utf-8" ?><transcript>
<text start="12.645" dur="1.37">So in college,</text><text start="15.349" dur="1.564">I was a government major,</text>
</transcript>`;

const PLAYER = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { title: 'Talk', author: 'TED', lengthSeconds: '843' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { languageCode: 'ar', name: { runs: [{ text: 'Arabic' }] }, baseUrl: 'https://x/ar' },
    { languageCode: 'en', kind: 'asr', name: { runs: [{ text: 'English (auto-generated)' }] }, baseUrl: 'https://x/asr?fmt=srv3' },
    { languageCode: 'en-GB', name: { simpleText: 'English (UK)' }, baseUrl: 'https://x/gb' },
    { languageCode: 'en', name: { runs: [{ text: 'English' }] }, baseUrl: 'https://x/en?lang=en' },
  ] } },
};

const manual = parseTimedtext(SRV3_MANUAL);
assert.deepEqual(manual[0], { s: 12.645, e: 14.015, text: 'So in college,' });
assert.equal(manual[1].text, 'which means I had to write a lot of papers.');
assert.equal(manual[2].text, "it's & done");

const auto = parseTimedtext(SRV3_AUTO);
assert.equal(auto.length, 2);
assert.deepEqual(auto[0].words, [[12.559, 'so'], [12.759, 'in']]);
assert.deepEqual(auto[1].words[1], [15.36, 'I']);
assert.equal(auto[1].text, 'college I');

const legacy = parseTimedtext(LEGACY);
assert.deepEqual(legacy.map((c) => c.s), [12.645, 15.349]);
assert.equal(legacy[1].e, 16.913);
assert.throws(() => parseTimedtext('<nope'), CaptionError);

const tracks = englishTracks(PLAYER);
assert.deepEqual(tracks.map((t) => t.id), ['en.manual', 'en-GB.manual', 'en.auto']);
assert.equal(tracks[1].name, 'English (UK)');
assert.equal(pick(tracks).id, 'en.manual');
assert.equal(pick(tracks, 'en.auto').id, 'en.auto');
assert.equal(pick(tracks, 'zz').id, 'en.manual');
assert.equal(pick([]), null);
assert.equal(trackUrl('https://x/asr?fmt=json3&v=1'), 'https://x/asr?v=1&fmt=srv3');

const deps = { rounds: 1, fetchPlayer: async () => PLAYER, request: async (url) => (url.includes('asr') ? SRV3_AUTO : SRV3_MANUAL) };
const d = await getCaptions('abcdefghijk', null, deps);
assert.equal(d.track.id, 'en.manual');
assert.equal(d.seconds, 843);
assert.equal(d.embeddable, true);
assert.ok(!('url' in d.tracks[0]));
assert.ok('words' in (await getCaptions('abcdefghijk', 'en.auto', deps)).cues[0]);
await assert.rejects(getCaptions('../etc/passwd', null, deps), (e) => e.status === 400);
await assert.rejects(getCaptions('zzzzzzzzzzz', null, { ...deps, fetchPlayer: async () => ({ playabilityStatus: { status: 'OK' } }) }), (e) => e.status === 404);
await assert.rejects(
  getCaptions('yyyyyyyyyyy', null, { ...deps, fetchPlayer: async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' } }) }),
  (e) => /confirm your age/.test(e.message),
);

// a bot wall on one client: the next client is tried
const WALL = { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } };
const seen = [];
const rotated = await getCaptions('abcdefghijk', null, { ...deps, fetchPlayer: async (v, c) => { seen.push(c.name); return seen.length === 1 ? WALL : PLAYER; } });
assert.equal(rotated.via, 'android_vr');
assert.deepEqual(seen, ['android', 'android_vr']);
// walled everywhere: 503, so the site knows a fresh request may work
await assert.rejects(
  getCaptions('abcdefghijk', null, { ...deps, fetchPlayer: async () => WALL }),
  (e) => e.status === 503 && /blocking the caption server/.test(e.message),
);
// "unavailable" from every client stays a plain 422
await assert.rejects(
  getCaptions('abcdefghijk', null, { ...deps, fetchPlayer: async () => ({ playabilityStatus: { status: 'ERROR', reason: 'This video is unavailable' } }) }),
  (e) => e.status === 422 && /unavailable/.test(e.message),
);

console.log('TEST OK (worker)');
