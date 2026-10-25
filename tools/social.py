"""Playing with friends: friend requests, game invites, and live games.

Three ways to play, all between two friends:
- together:  one puzzle, one shared table; both move pieces at the same time.
- race:      both start at the same moment, each on their own table; the first to finish wins.
- challenge: each plays whenever they like; the faster time wins.
In a race or a challenge the players either get the same puzzle ("same"), or each picks the
puzzle the other one plays ("swap").

Security choices:
- Players find each other only by exact username, and can only invite accepted friends.
  Email addresses are never shown to other players.
- A player can block anyone: that ends the friendship and any games, and their friend requests
  are quietly dropped from then on (without telling them they're blocked). Reports are kept for
  the site's owner, and emailed to PUZZLE_ADMIN_EMAIL when it's set.
- Every game action checks that the player belongs to that game.
- Everything a player sends during a live game is checked (piece numbers in range, positions
  bounded, groups matching the table) and rate-limited, so a modified app can't flood the
  other player, break the shared table, or crash the server.
- Times in races and challenges are measured by the server, not reported by the player, and a
  win is only accepted once the server has seen the puzzle solved: every join the app reports
  must connect neighbouring pieces, and the joins must add up to the whole picture, no faster
  than a person could manage (see join() and finish()). Shared tables check joins the same way.
- Live updates go only to the two players, over their own signed-in connection.
"""

import asyncio
import json
import math
import os
import re
import secrets
import threading
import time
from pathlib import Path

import mailer
from accounts import USERNAME_RE, AccountError
from userdata import jpeg, number

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_DIR = ROOT / "assets" / "library"

MODES = {"together", "race", "challenge"}
PICKS = {"same", "swap"}
MAX_FRIENDS = 200
MAX_PENDING_REQUESTS = 50
MAX_OPEN_INVITES = 10
MAX_GRID = 40           # columns or rows
MAX_PIECES = 500
MAX_PUZZLE_IMAGE = 2 * 1024 * 1024
INVITE_DAYS = 3         # unanswered invites expire
LIVE_HOURS = 24         # a live game nobody finished is closed after this
CHALLENGE_DAYS = 14     # time to play a challenge
START_DELAY_MS = 4000   # the 3-2-1 countdown before a live game
MAX_STREAMS_PER_USER = 5
EVENTS_PER_SECOND = 40  # per player in a live game (piece moves are sent about 10 times a second)
MIN_MS_PER_PIECE = 400  # nobody solves faster than this: a quicker "finish" isn't a real one
MIN_MS_BETWEEN_JOINS = 100
REPORT_REASONS = {
    "name": "Offensive username",
    "harassment": "Harassment or unkind behaviour",
    "spam": "Spam or unwanted requests",
    "photo": "Inappropriate photo",
    "cheating": "Cheating",
    "other": "Something else",
}
MAX_REPORTS = 10  # per player within the rate-limit window (15 minutes)
ADMIN_EMAIL = os.environ.get("PUZZLE_ADMIN_EMAIL")
SLUG_RE = re.compile(r"^[a-z0-9-]{1,60}$")
MATCH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS friendships (
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(user_b);
CREATE TABLE IF NOT EXISTS blocks (
    blocker INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker, blocked)
);
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    reporter INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reported INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reported_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    picks TEXT NOT NULL,
    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'finished', 'declined', 'cancelled')),
    pieces INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    winner_id INTEGER,
    layout TEXT
);
CREATE INDEX IF NOT EXISTS matches_host ON matches(host_id);
CREATE INDEX IF NOT EXISTS matches_guest ON matches(guest_id);
CREATE TABLE IF NOT EXISTS match_puzzles (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    library_id TEXT,
    image BLOB,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    began_at INTEGER,
    finished_at INTEGER,
    time_ms INTEGER,
    stars INTEGER,
    moves INTEGER,
    hints INTEGER,
    gave_up INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, user_id)
);
"""


def connected(pieces, cols):
    """Whether the pieces form one connected patch of the grid (each touches another side by side)."""
    pieces = set(pieces)
    if not pieces:
        return False
    start = next(iter(pieces))
    seen, todo = {start}, [start]
    while todo:
        p = todo.pop()
        row, col = divmod(p, cols)
        for q in ((p - 1) if col > 0 else None, (p + 1) if col < cols - 1 else None, p - cols, p + cols):
            if q is not None and q in pieces and q not in seen:
                seen.add(q)
                todo.append(q)
    return len(seen) == len(pieces)


def now_ms():
    return int(time.time() * 1000)


def pair(a, b):
    return (a, b) if a < b else (b, a)


# ---------- Live updates (server-sent events) ----------

class Stream:
    """One open connection (a browser tab). Messages are handed to the server's event loop, so a
    waiting connection costs nothing; they can be pushed from any thread."""

    def __init__(self, loop):
        self.loop = loop
        self.queue = asyncio.Queue(maxsize=1000)

    def push(self, message):
        def put():
            if self.queue.full():  # a connection that stopped reading: close it, the app reconnects
                while not self.queue.empty():
                    self.queue.get_nowait()
                self.queue.put_nowait(None)
            else:
                self.queue.put_nowait(message)
        try:
            self.loop.call_soon_threadsafe(put)
        except RuntimeError:  # the event loop has stopped (the server is shutting down)
            pass

    async def get(self, timeout):
        return await asyncio.wait_for(self.queue.get(), timeout)


class Hub:
    """Each signed-in tab keeps one connection open; messages for a player go to all their tabs."""

    def __init__(self):
        self.lock = threading.Lock()
        self.streams = {}  # user id -> [Stream]

    def subscribe(self, user_id):
        """Called from the event loop. Returns the new stream, and whether it's the player's first."""
        stream = Stream(asyncio.get_running_loop())
        with self.lock:
            streams = self.streams.setdefault(user_id, [])
            streams.append(stream)
            if len(streams) > MAX_STREAMS_PER_USER:
                streams.pop(0).push(None)  # the oldest tab's connection closes
            first = len(streams) == 1
        return stream, first

    def unsubscribe(self, user_id, stream):
        """True when that was the player's last open connection."""
        with self.lock:
            streams = self.streams.get(user_id, [])
            if stream in streams:
                streams.remove(stream)
            if not streams:
                self.streams.pop(user_id, None)
                return True
            return False

    def online(self, user_id):
        with self.lock:
            return bool(self.streams.get(user_id))

    def online_count(self):
        with self.lock:
            return len(self.streams)

    def send(self, user_id, event, data=None):
        message = (event, json.dumps(data or {}))
        with self.lock:
            streams = list(self.streams.get(user_id, []))
        for stream in streams:
            stream.push(message)

    def close_user(self, user_id):
        """Ends every open connection of a player (on signing out or deleting the account)."""
        with self.lock:
            streams = self.streams.pop(user_id, [])
        for stream in streams:
            stream.push(None)


# ---------- The shared table of a live game ----------

class LiveGame:
    """In-memory state of a live game: who's at the table, and (playing together) the layout."""

    def __init__(self, match, count, cols):
        self.lock = threading.Lock()
        self.cols = cols
        self.id = match["id"]
        self.mode = match["mode"]
        self.players = (match["host_id"], match["guest_id"])
        self.count = count
        self.ready = set()
        self.start_at = match["started_at"]
        self.progress = {}
        self.locks = {}         # piece index -> player holding its group
        self.groups = None      # anchor (lowest piece) -> {"pieces": [...], "nx", "ny"}
        self.anchor_of = {}     # piece index -> its group's anchor
        self.saved_at = 0
        self.budget = {}        # player -> (second, events in it)
        if match["layout"]:
            self.set_layout(json.loads(match["layout"]))

    def other(self, user_id):
        return self.players[1] if user_id == self.players[0] else self.players[0]

    def allow(self, user_id):
        second = int(time.time())
        start, used = self.budget.get(user_id, (second, 0))
        if start != second:
            start, used = second, 0
        self.budget[user_id] = (start, used + 1)
        return used < EVENTS_PER_SECOND

    # Layout: groups of pieces with positions relative to the puzzle's place, in puzzle sizes.

    def check_pieces(self, pieces):
        if (not isinstance(pieces, list) or not 0 < len(pieces) <= self.count
                or not all(isinstance(p, int) and not isinstance(p, bool) and 0 <= p < self.count for p in pieces)
                or len(set(pieces)) != len(pieces)):
            raise AccountError("Invalid move.", code="invalidMove")
        return sorted(pieces)

    @staticmethod
    def check_position(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 4:
            raise AccountError("Invalid move.", code="invalidMove")
        return round(float(value), 5)

    def set_layout(self, layout):
        if not isinstance(layout, list) or not layout:
            raise AccountError("Invalid layout.", code="invalidLayout")
        groups, anchor_of = {}, {}
        for entry in layout:
            if not isinstance(entry, dict):
                raise AccountError("Invalid layout.", code="invalidLayout")
            pieces = self.check_pieces(entry.get("pieces"))
            if any(p in anchor_of for p in pieces):
                raise AccountError("Invalid layout.", code="invalidLayout")
            anchor = pieces[0]
            groups[anchor] = {"pieces": pieces, "nx": self.check_position(entry.get("nx")),
                              "ny": self.check_position(entry.get("ny"))}
            for p in pieces:
                anchor_of[p] = anchor
        if len(anchor_of) != self.count:
            raise AccountError("Invalid layout.", code="invalidLayout")
        self.groups, self.anchor_of = groups, anchor_of

    def layout(self):
        return list(self.groups.values()) if self.groups else None

    def state(self, user_id, online):
        return {
            "startAt": self.start_at, "now": now_ms(), "layout": self.layout(),
            "held": [{"pieces": self.held_by(self.other(user_id))}] if self.held_by(self.other(user_id)) else [],
            "friendReady": self.other(user_id) in self.ready, "friendOnline": online,
            "friendProgress": self.progress.get(self.other(user_id), 0),
        }

    def held_by(self, user_id):
        return sorted(p for p, holder in self.locks.items() if holder == user_id)

    def release(self, user_id):
        for p in self.held_by(user_id):
            del self.locks[p]

    def groups_touching(self, pieces):
        """The anchors of the groups the pieces belong to, if the pieces cover them completely."""
        anchors = {self.anchor_of[p] for p in pieces}
        if sum(len(self.groups[a]["pieces"]) for a in anchors) != len(pieces):
            return None  # the player's table doesn't match the shared one
        return anchors

    def grab(self, user_id, pieces):
        pieces = self.check_pieces(pieces)
        anchors = self.groups_touching(pieces)
        if anchors is None or len(anchors) != 1:
            return {"ok": False, "resync": True}
        if any(self.locks.get(p, user_id) != user_id for p in pieces):
            return {"ok": False, "held": True}
        self.release(user_id)
        for p in pieces:
            self.locks[p] = user_id
        return {"ok": True}

    def drop(self, user_id, pieces, nx, ny):
        """Puts the player's group down; `pieces` also contains any groups it joined."""
        pieces = self.check_pieces(pieces)
        nx, ny = self.check_position(nx), self.check_position(ny)
        anchors = self.groups_touching(pieces)
        held = set(self.held_by(user_id))
        if (anchors is None or not held or not held <= set(pieces)
                or any(self.locks.get(p, user_id) != user_id for p in pieces)
                or (len(anchors) > 1 and not connected(pieces, self.cols))):  # only real neighbours join
            self.release(user_id)
            return {"ok": False, "resync": True}
        for anchor in anchors:
            del self.groups[anchor]
        self.groups[pieces[0]] = {"pieces": pieces, "nx": nx, "ny": ny}
        for p in pieces:
            self.anchor_of[p] = pieces[0]
        self.release(user_id)
        return {"ok": True, "complete": len(self.groups) == 1}


# ---------- Friends and games ----------

class Social:
    def __init__(self, accounts, hub):
        self.accounts = accounts
        self.hub = hub
        self.live = {}
        self.live_lock = threading.Lock()
        accounts.database.script(SCHEMA)
        accounts.database.add_column("match_players", "joins", "TEXT")  # the server's record of each puzzle
        accounts.database.add_column("match_players", "last_join", "INTEGER")

    def connect(self):
        return self.accounts.connect()

    def _limited(self, key, limit):
        limits = self.accounts.limits
        if limits.count(key) >= limit:
            raise AccountError("That's a lot at once. Please wait a few minutes and try again.", 429, code="slowDown")
        limits.add(key)

    # ---------- Usernames ----------

    def set_username(self, user_id, username):
        """Players who signed up with an email choose a username before playing with friends."""
        username = (username or "").strip().lower()
        if not USERNAME_RE.match(username):
            raise AccountError("Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.", code="usernameRules")
        try:
            with self.connect() as db:
                changed = db.execute(
                    "UPDATE users SET username = ? WHERE id = ? AND username IS NULL", (username, user_id)
                ).rowcount
        except self.accounts.database.IntegrityError:
            raise AccountError("That username is taken. Try another one.", 409, code="usernameTaken")
        if not changed:
            raise AccountError("You already have a username.", code="hasUsername")

    def username(self, db, user_id):
        row = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
        return row["username"] if row else None

    # ---------- Friends ----------

    def friendship(self, db, a, b):
        return db.execute("SELECT * FROM friendships WHERE user_a = ? AND user_b = ?", pair(a, b)).fetchone()

    def are_friends(self, db, a, b):
        row = self.friendship(db, a, b)
        return bool(row and row["status"] == "accepted")

    def list_friends(self, user_id):
        with self.connect() as db:
            rows = db.execute(
                "SELECT f.status, f.requester, u.id, u.username FROM friendships f"
                " JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END"
                " WHERE (f.user_a = ? OR f.user_b = ?) AND u.username IS NOT NULL AND u.suspended = 0 ORDER BY u.username",
                (user_id, user_id, user_id),
            ).fetchall()
            blocked = db.execute(
                "SELECT u.id, u.username FROM blocks b JOIN users u ON u.id = b.blocked"
                " WHERE b.blocker = ? ORDER BY u.username", (user_id,)
            ).fetchall()
        friends, incoming, outgoing = [], [], []
        records = self.records(user_id)
        for r in rows:
            person = {"id": r["id"], "username": r["username"]}
            if r["status"] == "accepted":
                friends.append({**person, "online": self.hub.online(r["id"]),
                                "record": records.get(r["id"], {"wins": 0, "losses": 0, "draws": 0, "together": 0})})
            elif r["requester"] == user_id:
                outgoing.append(person)
            else:
                incoming.append(person)
        return {"friends": friends, "incoming": incoming, "outgoing": outgoing,
                "blocked": [{"id": r["id"], "username": r["username"]} for r in blocked if r["username"]]}

    def records(self, user_id):
        """Head-to-head results against each friend: races and challenges won, lost and drawn,
        and puzzles finished together."""
        with self.connect() as db:
            rows = db.execute(
                "SELECT mode, winner_id, CASE WHEN host_id = ? THEN guest_id ELSE host_id END AS friend FROM matches"
                " WHERE status = 'finished' AND (host_id = ? OR guest_id = ?)",
                (user_id, user_id, user_id),
            ).fetchall()
        records = {}
        for r in rows:
            rec = records.setdefault(r["friend"], {"wins": 0, "losses": 0, "draws": 0, "together": 0})
            if r["mode"] == "together":
                rec["together"] += 1
            elif r["winner_id"] == user_id:
                rec["wins"] += 1
            elif r["winner_id"] == r["friend"]:
                rec["losses"] += 1
            else:
                rec["draws"] += 1
        return records

    def daily_board(self, user_id, day):
        """The day's puzzle times of the player and their friends, fastest first."""
        with self.connect() as db:
            rows = db.execute(
                "SELECT u.id, u.username, d.time_ms FROM daily d JOIN users u ON u.id = d.user_id"
                " WHERE d.day = ? AND d.time_ms IS NOT NULL AND u.suspended = 0 AND (d.user_id = ? OR d.user_id IN ("
                "  SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END FROM friendships"
                "  WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'))"
                " ORDER BY d.time_ms LIMIT 50",
                (day, user_id, user_id, user_id, user_id),
            ).fetchall()
        return [{"username": r["username"] or "you", "timeMs": r["time_ms"], "me": r["id"] == user_id} for r in rows]

    def request_friend(self, user_id, username):
        self._limited(f"friend:{user_id}", 20)
        username = (username or "").strip().lower().lstrip("@")
        if not USERNAME_RE.match(username):
            raise AccountError("Please enter your friend's username.", code="enterFriendUsername")
        with self.connect() as db:
            if not self.username(db, user_id):
                raise AccountError("Choose a username first, so your friend knows who's asking.", code="usernameFirst")
            target = db.execute("SELECT id FROM users WHERE username = ? AND suspended = 0", (username,)).fetchone()
            if not target:
                raise AccountError("No player has that username. Check the spelling with your friend.", 404, code="noSuchPlayer")
            other = target["id"]
            if other == user_id:
                raise AccountError("That's your own username.", code="ownUsername")
            if self.blocked(db, user_id, other):
                raise AccountError("You've blocked this player. Unblock them first.", 409, code="youBlockedThem")
            if self.blocked(db, other, user_id):
                return "sent"  # looks the same as usual; they just never see it
            existing = self.friendship(db, user_id, other)
            if existing and existing["status"] == "accepted":
                raise AccountError("You're already friends.", 409, code="alreadyFriends")
            if existing and existing["requester"] == user_id:
                raise AccountError("You've already asked. Your friend needs to accept.", 409, code="alreadyAsked")
            if existing:  # they asked first: asking back means yes
                db.execute("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", pair(user_id, other))
                result = "accepted"
            else:
                counts = db.execute(
                    "SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ? OR user_b = ?)", (user_id, user_id)
                ).fetchone()["n"]
                pending = db.execute(
                    "SELECT COUNT(*) AS n FROM friendships WHERE requester = ? AND status = 'pending'", (user_id,)
                ).fetchone()["n"]
                if counts >= MAX_FRIENDS or pending >= MAX_PENDING_REQUESTS:
                    raise AccountError("You have too many friends or open requests for now.", 409, code="tooManyFriends")
                a, b = pair(user_id, other)
                db.execute(
                    "INSERT INTO friendships (user_a, user_b, requester, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                    (a, b, user_id, int(time.time())),
                )
                result = "sent"
        self.hub.send(other, "friends")
        return result

    def blocked(self, db, blocker, blocked):
        return db.execute("SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?", (blocker, blocked)).fetchone() is not None

    def _known(self, db, user_id, other_id):
        """Whether two players have had anything to do with each other (so reports can't target strangers)."""
        return bool(
            self.friendship(db, user_id, other_id) or self.blocked(db, user_id, other_id)
            or db.execute("SELECT 1 FROM matches WHERE (host_id = ? AND guest_id = ?) OR (host_id = ? AND guest_id = ?)",
                          (user_id, other_id, other_id, user_id)).fetchone()
        )

    def block(self, user_id, other_id):
        """Blocks a player: ends the friendship (or request) and open games, and keeps them away."""
        if not isinstance(other_id, int) or other_id == user_id:
            raise AccountError("Invalid request.", code="invalidRequest")
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM users WHERE id = ?", (other_id,)).fetchone():
                raise AccountError("That player doesn't exist.", 404, code="playerNotFound")
            if not self.blocked(db, user_id, other_id):
                db.execute("INSERT INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)",
                           (user_id, other_id, int(time.time())))
        self.remove_friend(user_id, other_id)

    def unblock(self, user_id, other_id):
        if not isinstance(other_id, int):
            raise AccountError("Invalid request.", code="invalidRequest")
        with self.connect() as db:
            db.execute("DELETE FROM blocks WHERE blocker = ? AND blocked = ?", (user_id, other_id))

    def report(self, user_id, other_id, reason, details, block):
        if not isinstance(other_id, int) or other_id == user_id or reason not in REPORT_REASONS:
            raise AccountError("Please choose what's wrong.", code="chooseReason")
        details = (details if isinstance(details, str) else "").strip()[:1000]
        self._limited(f"report:{user_id}", MAX_REPORTS)
        with self.connect() as db:
            if not self._known(db, user_id, other_id):
                raise AccountError("You can only report players you've had contact with.", 403, code="reportStrangers")
            reporter, reported = self.username(db, user_id), self.username(db, other_id)
            db.execute(
                "INSERT INTO reports (reporter, reported, reported_name, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, other_id, reported or f"#{other_id}", reason, details, int(time.time())),
            )
        if ADMIN_EMAIL:
            mailer.send(ADMIN_EMAIL, f"Puzzle Table report: {reported}", (
                f"{reporter} reported {reported} (player #{other_id}).\n\n"
                f"Reason: {REPORT_REASONS[reason]}\n"
                f"Details: {details or '(none)'}\n"
            ))
        if block:
            self.block(user_id, other_id)

    def respond_friend(self, user_id, other_id, accept):
        if not isinstance(other_id, int):
            raise AccountError("Invalid request.", code="invalidRequest")
        with self.connect() as db:
            row = self.friendship(db, user_id, other_id)
            if not row or row["status"] != "pending" or row["requester"] != other_id:
                raise AccountError("That request isn't there any more.", 404, code="requestGone")
            if accept:
                db.execute("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", pair(user_id, other_id))
            else:
                db.execute("DELETE FROM friendships WHERE user_a = ? AND user_b = ?", pair(user_id, other_id))
        self.hub.send(other_id, "friends")

    def remove_friend(self, user_id, other_id):
        """Removes a friend, or withdraws a request. Their open games end too."""
        if not isinstance(other_id, int):
            raise AccountError("Invalid request.", code="invalidRequest")
        with self.connect() as db:
            db.execute("DELETE FROM friendships WHERE user_a = ? AND user_b = ?", pair(user_id, other_id))
            open_games = db.execute(
                "SELECT id FROM matches WHERE status IN ('invited', 'accepted')"
                " AND ((host_id = ? AND guest_id = ?) OR (host_id = ? AND guest_id = ?))",
                (user_id, other_id, other_id, user_id),
            ).fetchall()
            for game in open_games:
                self._close(db, game["id"], "cancelled")
        self.hub.send(other_id, "friends")
        if open_games:
            self.hub.send(other_id, "matches")

    def presence_changed(self, user_id):
        """Tells a player's friends that they came online or went offline."""
        with self.connect() as db:
            rows = db.execute(
                "SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS friend FROM friendships"
                " WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'",
                (user_id, user_id, user_id),
            ).fetchall()
        for r in rows:
            self.hub.send(r["friend"], "presence", {"id": user_id, "online": self.hub.online(user_id)})
        with self.live_lock:
            games = [g for g in self.live.values() if user_id in g.players]
        for game in games:
            with game.lock:
                if not self.hub.online(user_id):
                    game.release(user_id)
                    game.ready.discard(user_id)
            self.hub.send(game.other(user_id), "game", {"match": game.id, "type": "presence",
                                                        "online": self.hub.online(user_id)})

    # ---------- Games: invites ----------

    def check_puzzle(self, puzzle, pieces):
        """A puzzle picked for a game: a library photo or an uploaded JPEG, and its grid."""
        if not isinstance(puzzle, dict):
            raise AccountError("Please pick a photo.", code="pickPhoto")
        cols, rows = number(puzzle.get("cols"), 0, MAX_GRID, 0), number(puzzle.get("rows"), 0, MAX_GRID, 0)
        if cols < 2 or rows < 2 or cols * rows > MAX_PIECES or abs(cols * rows - pieces) > max(6, pieces * 0.15):
            raise AccountError("Invalid number of pieces.", code="invalidPieces")
        name = puzzle.get("name") if isinstance(puzzle.get("name"), str) else "Photo"
        library_id = puzzle.get("libraryId")
        if library_id is not None:
            if not isinstance(library_id, str) or not SLUG_RE.match(library_id) or not (LIBRARY_DIR / f"{library_id}.jpg").is_file():
                raise AccountError("That photo isn't in the library.", code="photoNotInLibrary")
            image = None
        else:
            image = jpeg(puzzle.get("image"), MAX_PUZZLE_IMAGE, "photo")
        return {"name": name.strip()[:80] or "Photo", "library_id": library_id, "image": image, "cols": cols, "rows": rows}

    def _add_puzzle(self, db, match_id, player_id, puzzle):
        db.execute(
            "INSERT INTO match_puzzles (match_id, player_id, name, library_id, image, cols, rows, seed)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (match_id, player_id, puzzle["name"], puzzle["library_id"], puzzle["image"],
             puzzle["cols"], puzzle["rows"], secrets.randbelow(2 ** 31)),
        )

    def create_match(self, user_id, body, check_space):
        self._limited(f"invite:{user_id}", 30)
        mode, picks = body.get("mode"), body.get("picks")
        friend = body.get("friend")
        if mode not in MODES or picks not in PICKS or not isinstance(friend, int):
            raise AccountError("Invalid game.", code="invalidGame")
        if mode == "together":
            picks = "same"
        pieces = number(body.get("pieces"), 4, MAX_PIECES, 0)
        if not pieces:
            raise AccountError("Invalid number of pieces.", code="invalidPieces")
        puzzle = self.check_puzzle(body.get("puzzle"), pieces)
        match_id = secrets.token_urlsafe(12)
        with self.connect() as db:
            self.expire(db)
            if not self.are_friends(db, user_id, friend):
                raise AccountError("You can only invite friends.", 403, code="inviteFriendsOnly")
            open_invites = db.execute(
                "SELECT COUNT(*) AS n FROM matches WHERE host_id = ? AND status = 'invited'", (user_id,)
            ).fetchone()["n"]
            if open_invites >= MAX_OPEN_INVITES:
                raise AccountError("You have a lot of open invites. Wait for some answers first.", 409, code="tooManyInvites")
            if puzzle["image"]:
                check_space(db, user_id, 0, len(puzzle["image"]) * (2 if picks == "same" else 1))
            db.execute(
                "INSERT INTO matches (id, mode, picks, host_id, guest_id, status, pieces, created_at)"
                " VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)",
                (match_id, mode, picks, user_id, friend, pieces, int(time.time())),
            )
            # "same": both play this puzzle (with the same cut). "swap": the host picked it for the guest.
            self._add_puzzle(db, match_id, friend, puzzle)
            if picks == "same":
                db.execute(
                    "INSERT INTO match_puzzles (match_id, player_id, name, library_id, image, cols, rows, seed)"
                    " SELECT match_id, ?, name, library_id, image, cols, rows, seed FROM match_puzzles"
                    " WHERE match_id = ? AND player_id = ?",
                    (user_id, match_id, friend),
                )
            for player in (user_id, friend):
                db.execute("INSERT INTO match_players (match_id, user_id) VALUES (?, ?)", (match_id, player))
        self.hub.send(friend, "matches", {"invite": match_id})
        return match_id

    def _match(self, db, user_id, match_id):
        if not isinstance(match_id, str) or not MATCH_ID_RE.match(match_id):
            raise AccountError("That game doesn't exist.", 404, code="gameNotFound")
        row = db.execute(
            "SELECT * FROM matches WHERE id = ? AND (host_id = ? OR guest_id = ?)", (match_id, user_id, user_id)
        ).fetchone()
        if not row:
            raise AccountError("That game doesn't exist.", 404, code="gameNotFound")
        return row

    def respond_match(self, user_id, match_id, accept, puzzle, check_space):
        with self.connect() as db:
            self.expire(db)
            match = self._match(db, user_id, match_id)
            if match["guest_id"] != user_id or match["status"] != "invited":
                raise AccountError("This invite isn't open any more.", 409, code="inviteClosed")
            if not accept:
                self._close(db, match_id, "declined")
            else:
                if match["picks"] == "swap":  # the guest picks the host's puzzle now
                    picked = self.check_puzzle(puzzle, match["pieces"])
                    if picked["image"]:
                        check_space(db, user_id, 0, len(picked["image"]))
                    self._add_puzzle(db, match_id, match["host_id"], picked)
                db.execute("UPDATE matches SET status = 'accepted' WHERE id = ?", (match_id,))
        self.hub.send(match["host_id"], "matches", {"accepted" if accept else "declined": match_id})

    def leave_match(self, user_id, match_id):
        """Cancels an invite, or gives up a game. Giving up a race or challenge means the friend wins."""
        with self.connect() as db:
            match = self._match(db, user_id, match_id)
            other = match["guest_id"] if user_id == match["host_id"] else match["host_id"]
            if match["status"] not in ("invited", "accepted"):
                return
            if match["status"] == "invited" or match["mode"] == "together":
                self._close(db, match_id, "cancelled")
            else:
                db.execute("UPDATE match_players SET gave_up = 1 WHERE match_id = ? AND user_id = ?", (match_id, user_id))
                if match["mode"] == "race" and match["started_at"]:
                    self._close(db, match_id, "finished", winner=other)
                elif match["mode"] == "race":
                    self._close(db, match_id, "cancelled")
                else:
                    self._settle_challenge(db, match_id)
        self.hub.send(other, "matches")
        self.hub.send(other, "game", {"match": match_id, "type": "left"})

    def _close(self, db, match_id, status, winner=None):
        db.execute(
            "UPDATE matches SET status = ?, finished_at = ?, winner_id = ?, layout = NULL WHERE id = ?",
            (status, int(time.time()), winner, match_id),
        )
        db.execute("UPDATE match_puzzles SET image = NULL WHERE match_id = ?", (match_id,))  # photos aren't kept
        with self.live_lock:
            self.live.pop(match_id, None)

    def expire(self, db):
        """Closes invites nobody answered and games nobody finished."""
        now = int(time.time())
        stale = db.execute(
            "SELECT id, mode FROM matches WHERE (status = 'invited' AND created_at < ?)"
            " OR (status = 'accepted' AND mode != 'challenge' AND created_at < ?)"
            " OR (status = 'accepted' AND mode = 'challenge' AND created_at < ?)",
            (now - INVITE_DAYS * 86400, now - LIVE_HOURS * 3600, now - CHALLENGE_DAYS * 86400),
        ).fetchall()
        for row in stale:
            if row["mode"] == "challenge":
                self._settle_challenge(db, row["id"], force=True)
            else:
                self._close(db, row["id"], "cancelled")

    # ---------- Games: reading ----------

    def list_matches(self, user_id):
        with self.connect() as db:
            self.expire(db)
            rows = db.execute(
                "SELECT m.*, h.username AS host_name, g.username AS guest_name FROM matches m"
                " JOIN users h ON h.id = m.host_id JOIN users g ON g.id = m.guest_id"
                " WHERE (m.host_id = ? OR m.guest_id = ?)"
                " AND (m.status IN ('invited', 'accepted') OR m.created_at > ?)"
                " ORDER BY m.created_at DESC LIMIT 40",
                (user_id, user_id, int(time.time()) - 30 * 86400),
            ).fetchall()
            return [self._summary(db, user_id, r) for r in rows]

    def _summary(self, db, user_id, m):
        host = m["host_id"] == user_id
        players = {r["user_id"]: r for r in db.execute("SELECT * FROM match_players WHERE match_id = ?", (m["id"],))}
        mine = players.get(user_id)
        theirs = players.get(m["guest_id"] if host else m["host_id"])
        done = bool(mine and (mine["finished_at"] or mine["gave_up"])) or m["status"] == "finished"

        def result(row, show):
            if not row:
                return None
            return {
                "finished": bool(row["finished_at"]), "gaveUp": bool(row["gave_up"]),
                "timeMs": row["time_ms"] if show else None, "stars": row["stars"] if show else None,
                "started": bool(row["began_at"]),
            }

        return {
            "id": m["id"], "mode": m["mode"], "picks": m["picks"], "status": m["status"],
            "role": "host" if host else "guest",
            "friend": {"id": m["guest_id"] if host else m["host_id"], "username": m["guest_name"] if host else m["host_name"]},
            "pieces": m["pieces"], "createdAt": m["created_at"] * 1000, "startedAt": m["started_at"],
            "winner": None if m["winner_id"] is None else ("me" if m["winner_id"] == user_id else "friend"),
            # A friend's time stays hidden until you've played yourself, to keep the challenge fair.
            "me": result(mine, True), "them": result(theirs, done),
        }

    def get_match(self, user_id, match_id):
        with self.connect() as db:
            m = self._match(db, user_id, match_id)
            summary = self._summary(db, user_id, db.execute(
                "SELECT m.*, h.username AS host_name, g.username AS guest_name FROM matches m"
                " JOIN users h ON h.id = m.host_id JOIN users g ON g.id = m.guest_id WHERE m.id = ?", (match_id,)
            ).fetchone())
            puzzle = db.execute(
                "SELECT name, library_id, image IS NOT NULL AS has_image, cols, rows, seed FROM match_puzzles"
                " WHERE match_id = ? AND player_id = ?", (match_id, user_id)
            ).fetchone()
            began = db.execute(
                "SELECT began_at FROM match_players WHERE match_id = ? AND user_id = ?", (match_id, user_id)
            ).fetchone()
        if puzzle and m["status"] == "accepted":
            summary["puzzle"] = {
                "name": puzzle["name"], "libraryId": puzzle["library_id"], "hasImage": bool(puzzle["has_image"]),
                "cols": puzzle["cols"], "rows": puzzle["rows"], "seed": puzzle["seed"],
            }
        summary["beganAt"] = began["began_at"] if began else None
        summary["now"] = now_ms()
        return summary

    def puzzle_image(self, user_id, match_id):
        with self.connect() as db:
            m = self._match(db, user_id, match_id)
            if m["status"] != "accepted":
                return None
            row = db.execute(
                "SELECT image FROM match_puzzles WHERE match_id = ? AND player_id = ?", (match_id, user_id)
            ).fetchone()
        return bytes(row["image"]) if row and row["image"] is not None else None

    # ---------- Challenges (played whenever) ----------

    def begin(self, user_id, match_id):
        """Starts the player's clock (once): the pieces just came out of the pouch."""
        with self.connect() as db:
            m = self._match(db, user_id, match_id)
            if m["mode"] != "challenge" or m["status"] != "accepted":
                raise AccountError("This game isn't open.", 409, code="gameClosed")
            db.execute(
                "UPDATE match_players SET began_at = ? WHERE match_id = ? AND user_id = ? AND began_at IS NULL",
                (now_ms(), match_id, user_id),
            )
            row = db.execute("SELECT began_at FROM match_players WHERE match_id = ? AND user_id = ?",
                             (match_id, user_id)).fetchone()
        other = m["guest_id"] if user_id == m["host_id"] else m["host_id"]
        self.hub.send(other, "matches")
        return {"beganAt": row["began_at"], "now": now_ms()}

    def _settle_challenge(self, db, match_id, force=False):
        """Ends a challenge once both have played (or given up): the faster time wins."""
        m = db.execute("SELECT * FROM matches WHERE id = ?", (match_id,)).fetchone()
        rows = db.execute("SELECT * FROM match_players WHERE match_id = ?", (match_id,)).fetchall()
        done = [r for r in rows if r["finished_at"] or r["gave_up"]]
        if len(done) < 2 and not force:
            return
        finished = sorted((r for r in rows if r["finished_at"] and not r["gave_up"]), key=lambda r: r["time_ms"])
        winner = None
        if len(finished) == 2 and finished[0]["time_ms"] != finished[1]["time_ms"]:
            winner = finished[0]["user_id"]
        elif len(finished) == 1:
            winner = finished[0]["user_id"]
        self._close(db, match_id, "finished" if finished else "cancelled", winner)
        for player in (m["host_id"], m["guest_id"]):
            self.hub.send(player, "matches", {"finished": match_id})

    def finish(self, user_id, match_id, body):
        stars = number(body.get("stars"), 0, 3, 0)
        moves = number(body.get("moves"), 0, 10 ** 7, 0)
        hints = number(body.get("hints"), 0, 100000, 0)
        with self.connect() as db:
            m = self._match(db, user_id, match_id)
            other = m["guest_id"] if user_id == m["host_id"] else m["host_id"]
            if m["mode"] == "together":  # the server sees the last join itself (see event())
                row = db.execute("SELECT time_ms FROM match_players WHERE match_id = ? AND user_id = ?",
                                 (match_id, user_id)).fetchone()
                return {"timeMs": row["time_ms"]}
            if m["status"] != "accepted":
                return {"late": True}
            player = db.execute("SELECT * FROM match_players WHERE match_id = ? AND user_id = ?",
                                (match_id, user_id)).fetchone()
            if player["finished_at"] or player["gave_up"]:
                return {"late": True}
            started = player["began_at"] if m["mode"] == "challenge" else m["started_at"]
            if not started or started > now_ms():
                raise AccountError("This game hasn't started yet.", 409, code="gameNotStarted")
            elapsed = now_ms() - started
            solved, count = self._solved(db, m, user_id)
            if not solved or elapsed < count * MIN_MS_PER_PIECE:
                raise AccountError("The server hasn't seen this puzzle finished yet.", 409, code="notSolvedYet")
            db.execute(
                "UPDATE match_players SET finished_at = ?, time_ms = ?, stars = ?, moves = ?, hints = ?"
                " WHERE match_id = ? AND user_id = ?",
                (now_ms(), elapsed, stars, moves, hints, match_id, user_id),
            )
            if m["mode"] == "challenge":
                self._settle_challenge(db, match_id)
                self.hub.send(other, "matches")
            elif m["mode"] == "race":
                self._close(db, match_id, "finished", winner=user_id)
                self.hub.send(other, "game", {"match": match_id, "type": "finished", "winner": "friend", "timeMs": elapsed})
                self.hub.send(other, "matches")
        return {"timeMs": elapsed}

    # ---------- What each player has solved (races and challenges) ----------

    def join(self, user_id, match_id, pieces):
        """The app reports a group of pieces it just joined. The server keeps its own record of each
        player's puzzle, so a win can only come from joins that really happened."""
        with self.connect() as db:
            m = self._match(db, user_id, match_id)
            if m["mode"] == "together" or m["status"] != "accepted":
                raise AccountError("This game isn't open.", 409, code="gameClosed")
            puzzle = db.execute("SELECT cols, rows FROM match_puzzles WHERE match_id = ? AND player_id = ?",
                                (match_id, user_id)).fetchone()
            count, cols = puzzle["cols"] * puzzle["rows"], puzzle["cols"]
            player = db.execute("SELECT began_at, finished_at, joins, last_join FROM match_players"
                                " WHERE match_id = ? AND user_id = ?", (match_id, user_id)).fetchone()
            started = player["began_at"] if m["mode"] == "challenge" else m["started_at"]
            if not started or started > now_ms() + 500 or player["finished_at"]:
                raise AccountError("This game isn't open.", 409, code="gameClosed")
            if not isinstance(pieces, list) or not 2 <= len(pieces) <= count or not all(
                    isinstance(p, int) and not isinstance(p, bool) and 0 <= p < count for p in pieces):
                raise AccountError("Invalid move.", code="invalidMove")
            if not connected(pieces, cols):
                raise AccountError("Invalid move.", code="invalidMove")
            if player["last_join"] and now_ms() - player["last_join"] < MIN_MS_BETWEEN_JOINS:
                raise AccountError("Too many moves at once.", 429, code="tooManyMoves")
            groups = [set(g) for g in json.loads(player["joins"] or "[]")]
            joined = set(pieces)
            for group in [g for g in groups if g & joined]:  # everything it touches becomes one group
                joined |= group
                groups.remove(group)
            groups.append(joined)
            pieces_in_groups = sum(len(g) for g in groups)
            share = (pieces_in_groups - len(groups)) / (count - 1)
            db.execute("UPDATE match_players SET joins = ?, last_join = ? WHERE match_id = ? AND user_id = ?",
                       (json.dumps([sorted(g) for g in groups]), now_ms(), match_id, user_id))
        if m["mode"] == "race":  # the friend's progress bar shows what the server saw, not what the app claims
            with self.live_lock:
                game = self.live.get(match_id)
            if game:
                game.progress[user_id] = round(share, 4)
            other = m["guest_id"] if user_id == m["host_id"] else m["host_id"]
            self.hub.send(other, "game", {"match": match_id, "type": "progress", "share": round(share, 4)})
        return {"ok": True, "share": round(share, 4)}

    def _solved(self, db, m, user_id):
        """Whether the server's record of this player's puzzle is one whole picture."""
        puzzle = db.execute("SELECT cols, rows FROM match_puzzles WHERE match_id = ? AND player_id = ?",
                            (m["id"], user_id)).fetchone()
        count = puzzle["cols"] * puzzle["rows"]
        row = db.execute("SELECT joins FROM match_players WHERE match_id = ? AND user_id = ?",
                         (m["id"], user_id)).fetchone()
        groups = json.loads(row["joins"] or "[]")
        return len(groups) == 1 and len(groups[0]) == count, count

    def _complete_together(self, game):
        elapsed = now_ms() - game.start_at
        with self.connect() as db:
            db.execute("UPDATE match_players SET finished_at = ?, time_ms = ? WHERE match_id = ?",
                       (now_ms(), elapsed, game.id))
            self._close(db, game.id, "finished")
        for player in game.players:
            self.hub.send(player, "matches", {"finished": game.id})

    # ---------- Live games (together and race) ----------

    def _live(self, db, user_id, match_id):
        m = self._match(db, user_id, match_id)
        if m["mode"] == "challenge" or m["status"] != "accepted":
            raise AccountError("This game isn't open.", 409, code="gameClosed")
        with self.live_lock:
            game = self.live.get(match_id)
            if not game:
                puzzle = db.execute("SELECT cols, rows FROM match_puzzles WHERE match_id = ? AND player_id = ?",
                                    (match_id, user_id)).fetchone()
                game = self.live[match_id] = LiveGame(m, puzzle["cols"] * puzzle["rows"], puzzle["cols"])
        return game

    def ready(self, user_id, match_id, layout):
        """The player is at the table. Once both are, the countdown starts.
        Playing together, the first player's scatter becomes the shared starting layout."""
        with self.connect() as db:
            game = self._live(db, user_id, match_id)
            with game.lock:
                if game.mode == "together" and game.groups is None and layout is not None:
                    game.set_layout(layout)
                game.ready.add(user_id)
                other = game.other(user_id)
                starting = game.start_at is None and len(game.ready) == 2 and (game.mode != "together" or game.groups)
                if starting:
                    game.start_at = now_ms() + START_DELAY_MS
                    db.execute("UPDATE matches SET started_at = ?, layout = ? WHERE id = ?",
                               (game.start_at, json.dumps(game.layout()) if game.groups else None, match_id))
                state = game.state(user_id, self.hub.online(other))
        if starting:
            self.hub.send(other, "game", {"match": match_id, "type": "start", **game.state(other, True)})
        else:
            self.hub.send(other, "game", {"match": match_id, "type": "friend-ready"})
        return state

    def event(self, user_id, match_id, body):
        with self.connect() as db:
            game = self._live(db, user_id, match_id)
        kind = body.get("type")
        other = game.other(user_id)
        with game.lock:
            if not game.allow(user_id):
                raise AccountError("Too many moves at once.", 429, code="tooManyMoves")
            if not game.start_at or game.start_at > now_ms() + 500:
                raise AccountError("The game hasn't started yet.", 409, code="gameNotStartedYet")
            if kind == "react":  # a quick reaction for the friend: one of a few fixed ones
                reaction = body.get("reaction")
                if not isinstance(reaction, int) or isinstance(reaction, bool) or not 0 <= reaction < 6:
                    raise AccountError("Invalid reaction.", code="invalidReaction")
                out, reply = {"type": "react", "reaction": reaction}, {"ok": True}
            elif game.mode == "race":
                raise AccountError("Invalid move.", code="invalidMove")  # progress comes from join(), checked by the server
            elif kind == "grab":
                reply = game.grab(user_id, body.get("pieces"))
                out = {"type": "grab", "pieces": game.held_by(user_id)} if reply["ok"] else None
            elif kind == "move":
                piece = body.get("piece")
                if not isinstance(piece, int) or game.locks.get(piece) != user_id:
                    return {"ok": False}
                out = {"type": "move", "piece": piece,
                       "nx": game.check_position(body.get("nx")), "ny": game.check_position(body.get("ny"))}
                reply = {"ok": True}
            elif kind == "drop":
                reply = game.drop(user_id, body.get("pieces"), body.get("nx"), body.get("ny"))
                out = ({"type": "drop", "pieces": game.check_pieces(body["pieces"]),
                        "nx": game.check_position(body["nx"]), "ny": game.check_position(body["ny"])}
                       if reply["ok"] else {"type": "release"})
            elif kind == "release":
                game.release(user_id)
                out, reply = {"type": "release"}, {"ok": True}
            else:
                raise AccountError("Invalid move.", code="invalidMove")
            if reply.get("resync") or reply.get("held"):
                reply["layout"] = game.layout()
                reply["held"] = game.held_by(other)
            layout_json = None
            if kind == "drop" and reply["ok"] and time.time() - game.saved_at > 2:
                game.saved_at = time.time()
                layout_json = json.dumps(game.layout())
        if reply.get("complete"):  # recorded before the friend hears of the last join, so both see the time
            self._complete_together(game)
        if out:
            self.hub.send(other, "game", {"match": match_id, **out})
        if layout_json and not reply.get("complete"):  # so a game survives a server restart (saved at most every 2 seconds)
            with self.connect() as db:
                db.execute("UPDATE matches SET layout = ? WHERE id = ? AND status = 'accepted'", (layout_json, match_id))
        return reply
