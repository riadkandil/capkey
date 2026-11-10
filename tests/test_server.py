"""python -m unittest discover -s tests  (no network: YouTube is stubbed)"""
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import youtube  # noqa: E402

SRV3_MANUAL = """<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>
<p t="12645" d="1370">So in college,</p>
<p t="16937" d="2462">which means I had to write
a lot of papers.</p>
<p t="19423" d="2048">it&#39;s &amp;amp; done</p>
</body></timedtext>"""

SRV3_AUTO = """<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><ws id="0"/></head><body>
<w t="0" id="1" wp="1" ws="1"/>
<p t="12559" d="4480" w="1"><s ac="0">so</s><s t="200" ac="0"> in</s></p>
<p t="14350" d="2689" w="1" a="1">
</p>
<p t="14360" d="5280" w="1"><s ac="0">college</s><s t="1000" ac="0"> I</s></p>
</body></timedtext>"""

LEGACY = """<?xml version="1.0" encoding="utf-8" ?><transcript>
<text start="12.645" dur="1.37">So in college,</text><text start="15.349" dur="1.564">I was a government major,</text>
</transcript>"""

PLAYER = {
    "playabilityStatus": {"status": "OK"},
    "videoDetails": {"title": "Talk", "author": "TED", "lengthSeconds": "843"},
    "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [
        {"languageCode": "ar", "name": {"runs": [{"text": "Arabic"}]}, "baseUrl": "https://x/ar"},
        {"languageCode": "en", "kind": "asr", "name": {"runs": [{"text": "English (auto-generated)"}]}, "baseUrl": "https://x/asr?fmt=srv3"},
        {"languageCode": "en-GB", "name": {"simpleText": "English (UK)"}, "baseUrl": "https://x/gb"},
        {"languageCode": "en", "name": {"runs": [{"text": "English"}]}, "baseUrl": "https://x/en?lang=en"},
    ]}},
}


class ParseTests(unittest.TestCase):
    def test_manual_srv3(self):
        cues = youtube.parse_timedtext(SRV3_MANUAL)
        self.assertEqual(cues[0], {"s": 12.645, "e": 14.015, "text": "So in college,"})
        self.assertEqual(cues[1]["text"], "which means I had to write a lot of papers.")
        self.assertEqual(cues[2]["text"], "it's & done")
        self.assertNotIn("words", cues[0])

    def test_auto_srv3_has_word_times(self):
        cues = youtube.parse_timedtext(SRV3_AUTO)
        self.assertEqual(len(cues), 2)  # the empty "append" row is skipped
        self.assertEqual(cues[0]["words"], [[12.559, "so"], [12.759, "in"]])
        self.assertEqual(cues[1]["words"][1], [15.36, "I"])
        self.assertEqual(cues[1]["text"], "college I")

    def test_legacy_format(self):
        cues = youtube.parse_timedtext(LEGACY)
        self.assertEqual([c["s"] for c in cues], [12.645, 15.349])
        self.assertEqual(cues[1]["e"], 16.913)

    def test_bad_xml(self):
        with self.assertRaises(youtube.CaptionError):
            youtube.parse_timedtext("<nope")

    def test_track_order_and_choice(self):
        tracks = youtube.english_tracks(PLAYER)
        self.assertEqual([t["id"] for t in tracks], ["en.manual", "en-GB.manual", "en.auto"])
        self.assertEqual(tracks[1]["name"], "English (UK)")
        self.assertEqual(youtube.pick(tracks)["id"], "en.manual")
        self.assertEqual(youtube.pick(tracks, "en.auto")["id"], "en.auto")
        self.assertEqual(youtube.pick(tracks, "zz")["id"], "en.manual")
        self.assertIsNone(youtube.pick([]))

    def test_track_url_forces_srv3(self):
        self.assertEqual(youtube.track_url("https://x/asr?fmt=json3&v=1"), "https://x/asr?v=1&fmt=srv3")

    def test_bad_id(self):
        with self.assertRaises(youtube.CaptionError) as e:
            youtube.get_captions("../etc/passwd")
        self.assertEqual(e.exception.status, 400)

    def test_get_captions_with_stubs(self):
        orig_player, orig_req = youtube.fetch_player, youtube._request
        youtube._cache.clear()
        try:
            youtube.fetch_player = lambda vid: PLAYER
            youtube._request = lambda url, *a, **k: SRV3_AUTO if "asr" in url else SRV3_MANUAL
            d = youtube.get_captions("abcdefghijk")
            self.assertEqual(d["track"]["id"], "en.manual")
            self.assertEqual(d["title"], "Talk")
            self.assertEqual(d["seconds"], 843)
            self.assertNotIn("url", d["tracks"][0])
            a = youtube.get_captions("abcdefghijk", "en.auto")
            self.assertIn("words", a["cues"][0])
            youtube.fetch_player = lambda vid: {"playabilityStatus": {"status": "OK"}}
            with self.assertRaises(youtube.CaptionError) as e:
                youtube.get_captions("zzzzzzzzzzz")
            self.assertEqual(e.exception.status, 404)
            youtube.fetch_player = lambda vid: {"playabilityStatus": {"status": "LOGIN_REQUIRED", "reason": "Sign in to confirm your age"}}
            with self.assertRaises(youtube.CaptionError) as e:
                youtube.get_captions("yyyyyyyyyyy")
            self.assertIn("confirm your age", str(e.exception))
        finally:
            youtube.fetch_player, youtube._request = orig_player, orig_req
            youtube._cache.clear()


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.Handler.quiet = True
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_index_and_assets(self):
        status, headers, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"capkey", body)
        self.assertIn("frame-src https://www.youtube.com", headers["Content-Security-Policy"])
        status, headers, _ = self.get("/js/app.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/javascript"))

    def test_no_path_traversal(self):
        self.assertEqual(self.get("/../server.py")[0], 404)
        self.assertEqual(self.get("/%2e%2e/server.py")[0], 404)
        self.assertEqual(self.get("/js/missing.js")[0], 404)

    def test_captions_api(self):
        orig = youtube.get_captions
        try:
            youtube.get_captions = lambda vid, track=None: {"id": vid, "track": track, "cues": []}
            status, _, body = self.get("/api/captions?v=abcdefghijk&track=en.auto")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), {"id": "abcdefghijk", "track": "en.auto", "cues": []})

            def boom(vid, track=None):
                raise youtube.CaptionError("no captions", 404)
            youtube.get_captions = boom
            status, _, body = self.get("/api/captions?v=abcdefghijk")
            self.assertEqual(status, 404)
            self.assertEqual(json.loads(body)["error"], "no captions")
        finally:
            youtube.get_captions = orig


if __name__ == "__main__":
    unittest.main()
