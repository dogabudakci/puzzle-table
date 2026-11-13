# Puzzle Table

A calm, browser-based jigsaw puzzle game: pick a photo, choose how many pieces, and solve it on
a wooden, marble or felt table — alone, or live with a friend.

### ▶ [Play it now](https://dogabudakci.github.io/puzzle-table/)

[![Tests](https://github.com/dogabudakci/puzzle-table/actions/workflows/tests.yml/badge.svg)](https://github.com/dogabudakci/puzzle-table/actions/workflows/tests.yml)

![Puzzle Table](assets/og-image.jpg)

> The live demo is a static, guest-only build hosted on GitHub Pages. Accounts, friends and
> online games need the Python server in this repository (see [Running it](#running-it)).

---

## Features

**Playing**
- Real jigsaw pieces with tabs and blanks, cut from any photo with Bézier curves
- 12 to 500 pieces, with counts offered to suit each photo's resolution
- 64 built-in photos, or upload your own (it never leaves the device)
- 8 table surfaces, zoom and pan (wheel, buttons, pinch), hints, undo and an "edges only" filter
- Pieces snap together and move as groups; works with mouse, touch and keyboard
- Stopwatch or countdown timer, star rating and personal bests

**Around the game**
- Opening animation and an interactive start page (GSAP)
- Daily puzzle, a personal gallery of finished puzzles and achievements
- Sound effects and background music **generated live with the Web Audio API** — no audio files
- English, Turkish and German
- Installable and playable offline after the first visit (service worker)

**With an account** (server version)
- Sign-up, email confirmation, password reset and progress saved across devices
- Friends, live co-op and race games, challenges and a friends' daily ranking
- Blocking, reporting and an admin page for moderation; data export and account deletion

## Built with

| Part | Technology |
|---|---|
| Front end | HTML, CSS and plain JavaScript (ES modules), Canvas, Web Audio, GSAP for animation. No framework, no build step. |
| Server | Python: Starlette + Uvicorn, live updates with Server-Sent Events |
| Database | SQLite locally, PostgreSQL (Neon) in production |
| Email | Brevo |
| Hosting | Render (full app), GitHub Pages (guest demo) |
| CI | GitHub Actions: every server test runs on each push, against SQLite and PostgreSQL |

## Security and reliability

- Passwords are stored only as scrypt hashes; sessions are HttpOnly, Secure cookies
- Rate limits on sign-in, password checks and sign-ups; strict file-type checks on uploads
- Reset and confirmation links stop working when the password or email changes
- Security headers and cross-site request protection on every response
- Per-account storage quotas, nightly database backups (GitHub Actions)
- The code went through two written security reviews; the findings were fixed and covered by tests

## Project structure

```
index.html, styles.css   the whole interface
js/                      37 small ES modules: game.js (the table), cutter.js (piece shapes),
                         music.js and effects.js (audio), multiplayer.js, i18n.js …
tools/                   the Python server: serve.py, accounts.py, social.py, db.py, mailer.py …
tests/                   server test suites and browser end-to-end tests (Playwright)
assets/                  photos, table textures, fonts and icons
```

## Running it

**Just the game** (no server): serve the folder with any static server, for example
`python3 -m http.server`, and open it. Everything except accounts and friends works.

**The full app** on a Mac: double-click `Start Puzzle Table.command`. It installs the Python
packages once and opens http://localhost:8765.

Or by hand:

```
python3 -m pip install -r requirements.txt
python3 tools/serve.py
```

Without settings it uses a local SQLite database. In production, `render.yaml` describes the
Render service; secrets (database URL, email key) are set in Render's dashboard, never in the code.

## Tests

```
python3 tests/run_server_tests.py
```

Each suite starts a fresh server with a temporary database and checks accounts, friends, safety,
admin tools and resilience. Browser end-to-end tests (Chrome and Safari's WebKit) cover
multiplayer, zoom, keyboard play, saving, sound and languages. See [tests/README.md](tests/README.md).

## Author

Made by **Doga** — [github.com/dogabudakci](https://github.com/dogabudakci)
