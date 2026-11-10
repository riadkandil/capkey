"""Fetch English captions of a YouTube video (stdlib only).

The watch page gives the public Innertube key; the player endpoint (ANDROID client)
lists the caption tracks with URLs that work without a proof-of-origin token; a track
is fetched as srv3 XML. Manual tracks have punctuated cues, auto-generated ("asr")
tracks have per-word timing (<s t="offset">) but usually no punctuation.

get_captions(video_id, track=None) -> {
    id, title, author, seconds,
    track: {id, lang, name, kind},          # the chosen one
    tracks: [{id, lang, name, kind}, ...],  # every English track
    cues: [{s, e, text, words?: [[t, word], ...]}]   # seconds
}
"""
import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
           "Cookie": "CONSENT=YES+cb; SOCS=CAI"}
# Public key of the web client, used when the watch page does not carry one.
FALLBACK_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
CLIENT = {"clientName": "ANDROID", "clientVersion": "20.10.38"}
CACHE_TTL = 6 * 3600

_cache = {}
_lock = threading.Lock()


class CaptionError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def _request(url, data=None, headers=None, timeout=15, tries=3):
    req = urllib.request.Request(url, data=data, headers={**HEADERS, **(headers or {})})
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise CaptionError(f"YouTube answered {e.code}.", 502) from e
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(0.4 * (attempt + 1))
    raise CaptionError(f"Could not reach YouTube ({last}).", 502)


def fetch_player(video_id):
    page = _request(f"https://www.youtube.com/watch?v={video_id}")
    m = re.search(r'"INNERTUBE_API_KEY":\s*"([^"]+)"', page)
    key = m.group(1) if m else FALLBACK_KEY
    body = json.dumps({"context": {"client": CLIENT}, "videoId": video_id}).encode()
    raw = _request(f"https://www.youtube.com/youtubei/v1/player?key={key}", body,
                   {"Content-Type": "application/json"})
    return json.loads(raw)


def _name(track):
    n = track.get("name") or {}
    if "simpleText" in n:
        return n["simpleText"]
    return "".join(r.get("text", "") for r in n.get("runs", [])) or track.get("languageCode", "")


def english_tracks(player):
    tracks = (player.get("captions", {}).get("playerCaptionsTracklistRenderer", {})
              .get("captionTracks", []))
    out = []
    for t in tracks:
        lang = t.get("languageCode", "")
        if not (lang == "en" or lang.startswith("en-")):
            continue
        kind = "auto" if t.get("kind") == "asr" else "manual"
        out.append({"id": f"{lang}.{kind}", "lang": lang, "kind": kind,
                    "name": _name(t), "url": t.get("baseUrl", "")})
    # Manual tracks first (punctuated, human checked), plain "en" before regional ones.
    out.sort(key=lambda t: (t["kind"] != "manual", t["lang"] != "en"))
    return out


def pick(tracks, want=None):
    if not tracks:
        return None
    for t in tracks:
        if t["id"] == want:
            return t
    return tracks[0]


def track_url(url):
    parts = urllib.parse.urlsplit(url)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if k != "fmt"]
    q.append(("fmt", "srv3"))
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(q)))


def _clean(text):
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def parse_timedtext(xml_text):
    """srv3 (<p t d>[<s t>]) or legacy (<text start dur>) XML -> cues in seconds."""
    try:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ET.ParseError as e:
        raise CaptionError(f"Unreadable caption data ({e}).", 502) from e
    cues = []
    for p in root.iter("p"):
        t = int(p.get("t", 0)) / 1000
        d = int(p.get("d", 0)) / 1000
        spans = list(p.iter("s"))
        if spans:
            words = []
            for s in spans:
                w = _clean("".join(s.itertext()))
                if w:
                    words.append([round(t + int(s.get("t", 0)) / 1000, 3), w])
            if words:
                cues.append({"s": t, "e": round(t + d, 3),
                             "text": " ".join(w for _, w in words), "words": words})
            continue
        text = _clean("".join(p.itertext()))
        if text:
            cues.append({"s": t, "e": round(t + d, 3), "text": text})
    for node in root.iter("text"):
        text = _clean("".join(node.itertext()))
        if text:
            s = float(node.get("start", 0))
            cues.append({"s": s, "e": round(s + float(node.get("dur", 0)), 3), "text": text})
    cues.sort(key=lambda c: c["s"])
    return cues


def get_captions(video_id, track=None):
    if not VIDEO_ID.match(video_id or ""):
        raise CaptionError("That is not a YouTube video id.", 400)
    key = (video_id, track or "")
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]
    player = fetch_player(video_id)
    status = player.get("playabilityStatus", {})
    if status.get("status") not in ("OK", None):
        reason = status.get("reason") or status.get("status")
        raise CaptionError(f"YouTube says: {reason}", 422)
    tracks = english_tracks(player)
    chosen = pick(tracks, track)
    if not chosen:
        raise CaptionError("This video has no English captions. You can paste a transcript instead.", 404)
    cues = parse_timedtext(_request(track_url(chosen["url"])))
    if not cues:
        raise CaptionError("The caption track is empty.", 404)
    details = player.get("videoDetails", {})
    public = lambda t: {k: t[k] for k in ("id", "lang", "name", "kind")}
    data = {
        "id": video_id,
        "title": details.get("title", ""),
        "author": details.get("author", ""),
        "seconds": int(details.get("lengthSeconds") or 0),
        "embeddable": status.get("playableInEmbed", True) is not False,
        "track": public(chosen),
        "tracks": [public(t) for t in tracks],
        "cues": cues,
    }
    with _lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[key] = (time.time(), data)
        _cache[(video_id, chosen["id"])] = (time.time(), data)
    return data
