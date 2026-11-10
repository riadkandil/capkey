# capkey

Dictation practice with English YouTube videos. capkey plays one sentence, pauses the
video by itself, and gives you a blank for every word. Type what you heard, press Enter to
check, Enter again for the next sentence.

**Try it:** https://riadkandil.github.io/capkey/

## Two ways to run it

| | Recommended videos | Any YouTube link | Pasted transcript |
|---|---|---|---|
| Online (GitHub Pages) | yes | no (see below) | yes |
| On your computer (`python server.py`) | yes | yes | yes |

Browsers are not allowed to read YouTube's captions directly, so a small server has to fetch
them. GitHub Pages only hosts files, so the online version can open:

- the **recommended videos** (17 TED talks; their captions are bundled in `static/data/`), and
- **any video with a transcript you paste** (`.srt`, `.vtt`, or the text of YouTube's
  "Show transcript" panel).

To open any link, run the server yourself (Python 3.10+, standard library only):

```
git clone https://github.com/riadkandil/capkey
cd capkey
python server.py                 # http://127.0.0.1:8770
python server.py --host 0.0.0.0  # reachable from a phone on the same network
```

A hosted copy can also use a caption server elsewhere: put its address in
`<meta name="capkey-api">` in `static/index.html` (it must answer `GET /api/captions` and
`GET /api/health` like `server.py` and allow the site's origin with CORS).

## Features

- Captions come from the video itself: the uploader's English track when there is one
  (punctuated, split into real sentences), else YouTube's auto-generated one (split at pauses).
- Each sentence plays and pauses on its own, accurate to a few hundredths of a second.
  Replay (`Ctrl+Space`), Slower (`Ctrl+↓`), speed from 0.5× to 1.5×.
- One blank per word, with dashes showing the number of letters. Space jumps to the next
  blank; pasting a whole sentence fills the blanks in order.
- Words turn green as soon as they are right. Enter checks the rest: small spelling slips
  count but show the right spelling, wrong words turn red, Enter again shows the answers.
  `10` = `ten`, `okay` = `ok`, curly and straight apostrophes match.
- Hint (`Ctrl+/`) adds the next correct letter. Audio only, and a blur bar for subtitles
  burned into the video.
- Recommended videos sorted by length, filtered by speaking speed: Easy (< 150 words a
  minute), Medium (150 - 170), Fast (> 170).
- Progress per video stays in your browser: score per sentence, your transcript so far,
  stats, a Continue list.
- Light and dark themes, works on phones.

## Development

```
node tests/test_lib.mjs                   # client logic
python -m unittest discover -s tests      # caption parsing + server (no network)
python tools/bundle_videos.py             # re-fetch the recommended videos' captions
```

- `server.py` - static files + `GET /api/captions?v=<id>[&track=en.manual|en.auto|...]`
- `youtube.py` - fetches the caption tracks through YouTube's player API, parses srv3 XML
- `static/js/lib.js` - links, subtitle files, word timing, sentences, answer checking
- `static/js/player.js` - YouTube IFrame player that plays a range and pauses at its end
- `static/js/app.js` - the app; `static/css/app.css` - styles
- `.github/workflows/pages.yml` - publishes `static/` to GitHub Pages on every push to `main`

Fetching captions relies on an unofficial YouTube API that can change; the paste box keeps
working either way.

## Credits

The recommended talks and their captions are by TED and are shared under
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). Videos play
through YouTube's embedded player.
