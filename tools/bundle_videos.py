"""Fetch the recommended videos' captions into static/data/ so they work without a server.

    python capkey/tools/bundle_videos.py

Writes static/data/videos.json (the list shown on the home page) and
static/data/captions/<id>.json (the same shape as GET /api/captions).
Only TED / TED-Ed talks: TED publishes them under CC BY-NC-ND 4.0, which allows
sharing the unchanged transcripts with attribution.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import youtube  # noqa: E402

OUT = ROOT / "static" / "data"

# (video id, topic) - short talks first
VIDEOS = [
    ("UNP03fDSj1U", "Habits"),
    ("H14bBuluwB8", "Education"),
    ("6Af6b_wyiwI", "Health"),
    ("eIho2S0ZahI", "Communication"),
    ("fLJsdqxnZb0", "Happiness"),
    ("8jPQjjsBbIc", "Psychology"),
    ("8KkKuTCFvzI", "Happiness"),
    ("5J6jAC6XxAI", "Habits"),
    ("arj7oStGLkU", "Habits"),
    ("RcGyVTAoXEU", "Health"),
    ("qp0HIF3SfI4", "Business"),
    ("rrkrvAUbU9Y", "Business"),
    ("c0KYU2j0TM4", "Psychology"),
    ("86x-u-tz0MA", "Creativity"),
    ("iG9CE55wbtY", "Education"),
    ("iCvmsMzlF7o", "Psychology"),
    ("Ks-_Mh1QhMc", "Psychology"),
]


def split_title(title, author):
    parts = [p.strip() for p in title.split(" | ")]
    while len(parts) > 1 and parts[-1].upper().startswith("TED"):
        parts.pop()
    if len(parts) >= 2:
        return parts[0], parts[1]
    m = re.match(r"(.+?) - ([^-]+)$", title)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return title, author


def level(wpm):
    return "Easy" if wpm < 150 else "Medium" if wpm < 170 else "Fast"


def main():
    (OUT / "captions").mkdir(parents=True, exist_ok=True)
    listing = []
    for vid, topic in VIDEOS:
        d = youtube.get_captions(vid)
        if not d["embeddable"]:
            print("skip (not embeddable):", vid)
            continue
        cues = d["cues"]
        words = sum(len(c["text"].split()) for c in cues)
        speaking = max(1.0, cues[-1]["e"] - cues[0]["s"]) / 60
        wpm = round(words / speaking)
        title, speaker = split_title(d["title"], d["author"])
        # d["tracks"] keeps every English track: the app offers the others only when a caption server answers
        (OUT / "captions" / f"{vid}.json").write_text(
            json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        listing.append({
            "id": vid, "title": title, "speaker": speaker, "channel": d["author"], "topic": topic,
            "seconds": d["seconds"], "words": words, "wpm": wpm, "level": level(wpm),
            "auto": d["track"]["kind"] == "auto",
        })
        print(f"{vid} {wpm:>3} wpm {level(wpm):<6} {title} - {speaker}")
    listing.sort(key=lambda v: v["seconds"])
    (OUT / "videos.json").write_text(json.dumps(listing, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(listing), "videos")


if __name__ == "__main__":
    main()
