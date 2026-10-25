# Tests

## Server tests (no extra installs)

```
python3 tests/run_server_tests.py
```

Starts a fresh server with a temporary database for each suite and runs:

| Suite | What it checks |
|---|---|
| `test_accounts.py` | Sign-up and sign-in, sessions, saved puzzles, email confirmation, password reset, rate limits, blocked files |
| `test_friends.py` | Friend requests, invites, playing together, races, challenges, who may see what |
| `test_safety.py` | Blocking, reports, data export, legal pages, file types and security headers |
| `test_extras.py` | Head-to-head records, the friends' daily ranking, reactions |
| `test_admin.py` | The admin page: reports, suspending and deleting accounts |

To run them against PostgreSQL (like Neon) instead: `python3 tests/run_server_tests.py --postgres postgresql://…`
(needs `python3 -m pip install "psycopg[binary]"`; use an empty test database, never the real one).

## Browser tests (optional)

These drive real browsers, so they need two extra packages and a running server:

```
python3 -m pip install websocket-client playwright
python3 -m playwright install webkit
PUZZLE_DB=/tmp/browser-test.db python3 tools/serve.py 8793      # in a second window
cd tests/browser
python3 friends_e2e.py http://localhost:8793 /tmp     # two players in Chrome: together, race, reactions
python3 challenge_e2e.py http://localhost:8793 /tmp   # a challenge with "pick for each other", phone layout
python3 zoom_e2e.py http://localhost:8793 /tmp        # zoom and pan: wheel, buttons, dragging, pinch
python3 webkit_e2e.py http://localhost:8793 /tmp      # Safari's engine: desktop and iPhone playing together
```

The Chrome tests use Google Chrome from /Applications. Screenshots land in the folder given last.
Restart the server between runs: it allows only 10 new accounts per address every 15 minutes.
