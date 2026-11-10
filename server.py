#!/usr/bin/env python3
"""capkey - YouTube dictation practice.

    python server.py [--port 8770] [--host 127.0.0.1] [--quiet]

Serves static/ and GET /api/captions?v=<video id>[&track=<track id>].
"""
import argparse
import json
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import youtube  # noqa: E402

STATIC = Path(__file__).resolve().parent / "static"
CSP = ("default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; "
       "frame-src https://www.youtube.com https://www.youtube-nocookie.com; "
       "img-src 'self' https://i.ytimg.com data:; style-src 'self' 'unsafe-inline'; "
       "connect-src 'self'; base-uri 'none'; form-action 'self'")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class Handler(BaseHTTPRequestHandler):
    quiet = False
    server_version = "capkey/1.0"

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)

    def send_bytes(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_bytes(status, body, "application/json; charset=utf-8",
                        {"Cache-Control": "no-store"})

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/api/captions":
            q = parse_qs(url.query)
            vid = (q.get("v") or [""])[0].strip()
            track = (q.get("track") or [None])[0]
            try:
                self.send_json(200, youtube.get_captions(vid, track))
            except youtube.CaptionError as e:
                self.send_json(e.status, {"error": str(e)})
            except Exception as e:  # keep the server alive, report the cause
                self.send_json(500, {"error": f"Unexpected error: {e}"})
            return
        if url.path == "/api/health":
            self.send_json(200, {"ok": True})
            return
        self.static(url.path)

    def static(self, path):
        rel = path.lstrip("/") or "index.html"
        target = (STATIC / rel).resolve()
        if STATIC not in target.parents and target != STATIC:
            self.send_json(404, {"error": "Not found"})
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            # Unknown paths fall back to the app (hash routing keeps state in the URL).
            if "." in Path(rel).name:
                self.send_json(404, {"error": "Not found"})
                return
            target = STATIC / "index.html"
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "xml")):
            ctype += "; charset=utf-8"
        extra = {"Cache-Control": "no-cache"}
        if target.suffix == ".html":
            extra["Content-Security-Policy"] = CSP
        self.send_bytes(200, target.read_bytes(), ctype, extra)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    Handler.quiet = a.quiet
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"capkey on http://{a.host}:{a.port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
