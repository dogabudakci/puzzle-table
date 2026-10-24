"""A signed-in player's saved data: gallery, achievements, daily streak and unfinished puzzle.

Security choices:
- Every query is scoped to the signed-in user's id, so one player can never read, change or
  delete another player's data, even by guessing ids.
- Incoming data is checked field by field against what the app actually sends; anything else
  is dropped. Images must really be JPEGs (checked by their first bytes) and are size-limited.
- Each player has a cap on how many puzzles and how much image data they can store.
- All rows reference the user with ON DELETE CASCADE, so deleting an account deletes its data.
"""

import base64
import json
import re
import time

from accounts import AccountError

MAX_GALLERY_ITEMS = 1000
MAX_IMAGE_BYTES = 4 * 1024 * 1024        # one finished-puzzle picture
MAX_PROGRESS_PHOTO = 6 * 1024 * 1024     # the photo of the unfinished puzzle
MAX_STORAGE_BYTES = 300 * 1024 * 1024    # all of one player's pictures together
MAX_PROGRESS_JSON = 512 * 1024
MAX_DAYS = 5000

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SLUG_RE = re.compile(r"^[a-z0-9-]{1,40}$")
UID_RE = re.compile(r"^[A-Za-z0-9:._-]{1,80}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,
    meta TEXT NOT NULL,
    image BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, uid)
);
CREATE TABLE IF NOT EXISTS achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    earned_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS daily (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    meta TEXT NOT NULL,
    photo BLOB,
    thumb BLOB,
    saved_at INTEGER NOT NULL
);
"""


# ---------- Checking what the browser sends ----------

def jpeg(data_b64, limit, what):
    if not isinstance(data_b64, str) or len(data_b64) > limit * 4 // 3 + 8:
        raise AccountError(f"The {what} is too large.", 413)
    try:
        data = base64.b64decode(data_b64, validate=True)
    except ValueError:
        raise AccountError(f"The {what} couldn't be read.")
    if len(data) > limit:
        raise AccountError(f"The {what} is too large.", 413)
    if not data.startswith(b"\xff\xd8\xff"):
        raise AccountError(f"The {what} must be a JPEG.")
    return data


def number(value, low, high, default=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(low, min(high, int(value)))


def text(value, limit, default=""):
    return value[:limit] if isinstance(value, str) else default


def clean_puzzle(record):
    """The finished-puzzle fields the gallery uses, and nothing else."""
    if not isinstance(record, dict):
        raise AccountError("Invalid puzzle.")
    table = record.get("table")
    return {
        "name": text(record.get("name"), 200, "Puzzle"),
        "createdAt": number(record.get("createdAt"), 0, 10 ** 13, int(time.time() * 1000)),
        "imageW": number(record.get("imageW"), 1, 10000, 1),
        "imageH": number(record.get("imageH"), 1, 10000, 1),
        "pieces": number(record.get("pieces"), 1, 5000, 1),
        "cols": number(record.get("cols"), 1, 200, 1),
        "rows": number(record.get("rows"), 1, 200, 1),
        "table": table if isinstance(table, str) and SLUG_RE.match(table) else "oak",
        "timeMs": number(record.get("timeMs"), 0, 10 ** 10, 0),
        "limitMs": number(record.get("limitMs"), 0, 10 ** 10),
        "beatClock": record.get("beatClock") is True,
        "hintsUsed": number(record.get("hintsUsed"), 0, 100000, 0),
        "moves": number(record.get("moves"), 0, 10 ** 7, 0),
        "stars": number(record.get("stars"), 0, 3, 0),
    }


class UserData:
    def __init__(self, accounts):
        self.accounts = accounts
        with accounts.connect() as db:
            db.executescript(SCHEMA)

    def connect(self):
        return self.accounts.connect()

    def storage_used(self, db, user_id):
        row = db.execute(
            "SELECT COALESCE((SELECT SUM(LENGTH(image)) FROM gallery WHERE user_id = ?), 0)"
            " + COALESCE((SELECT LENGTH(photo) + LENGTH(thumb) FROM progress WHERE user_id = ?), 0)",
            (user_id, user_id),
        ).fetchone()
        return row[0] or 0

    # ---------- Gallery ----------

    def list_gallery(self, user_id):
        with self.connect() as db:
            rows = db.execute("SELECT id, uid, meta FROM gallery WHERE user_id = ? ORDER BY created_at", (user_id,)).fetchall()
        return [{**json.loads(r["meta"]), "id": r["id"], "uid": r["uid"]} for r in rows]

    def add_gallery(self, user_id, body):
        uid = body.get("uid")
        if not isinstance(uid, str) or not UID_RE.match(uid):
            raise AccountError("Invalid puzzle.")
        meta = clean_puzzle(body.get("puzzle"))
        image = jpeg(body.get("image"), MAX_IMAGE_BYTES, "picture")
        with self.connect() as db:
            existing = db.execute("SELECT id FROM gallery WHERE user_id = ? AND uid = ?", (user_id, uid)).fetchone()
            if existing:  # already uploaded (e.g. a retry): nothing to do
                return existing["id"]
            count = db.execute("SELECT COUNT(*) FROM gallery WHERE user_id = ?", (user_id,)).fetchone()[0]
            if count >= MAX_GALLERY_ITEMS:
                raise AccountError("Your gallery is full. Remove a few puzzles to make room.", 409)
            if self.storage_used(db, user_id) + len(image) > MAX_STORAGE_BYTES:
                raise AccountError("Your account's storage is full. Remove a few puzzles to make room.", 409)
            cursor = db.execute(
                "INSERT INTO gallery (user_id, uid, meta, image, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, uid, json.dumps(meta), image, int(time.time())),
            )
            return cursor.lastrowid

    def gallery_image(self, user_id, item_id):
        with self.connect() as db:
            row = db.execute("SELECT image FROM gallery WHERE id = ? AND user_id = ?", (item_id, user_id)).fetchone()
        return row["image"] if row else None

    def delete_gallery(self, user_id, item_id):
        if not isinstance(item_id, int):
            raise AccountError("Invalid puzzle.")
        with self.connect() as db:
            db.execute("DELETE FROM gallery WHERE id = ? AND user_id = ?", (item_id, user_id))

    # ---------- Achievements ----------

    def list_achievements(self, user_id):
        with self.connect() as db:
            rows = db.execute("SELECT id, earned_at FROM achievements WHERE user_id = ?", (user_id,)).fetchall()
        return [{"id": r["id"], "earnedAt": r["earned_at"]} for r in rows]

    def add_achievements(self, user_id, items):
        if not isinstance(items, list) or len(items) > 100:
            raise AccountError("Invalid achievements.")
        with self.connect() as db:
            for item in items:
                if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not SLUG_RE.match(item["id"]):
                    continue
                db.execute(
                    "INSERT OR IGNORE INTO achievements (user_id, id, earned_at) VALUES (?, ?, ?)",
                    (user_id, item["id"], number(item.get("earnedAt"), 0, 10 ** 13, int(time.time() * 1000))),
                )

    # ---------- Daily puzzle ----------

    def list_days(self, user_id):
        with self.connect() as db:
            return [r["day"] for r in db.execute("SELECT day FROM daily WHERE user_id = ? ORDER BY day", (user_id,))]

    def add_days(self, user_id, days):
        if not isinstance(days, list) or len(days) > MAX_DAYS:
            raise AccountError("Invalid days.")
        with self.connect() as db:
            for day in days:
                if isinstance(day, str) and DAY_RE.match(day):
                    db.execute("INSERT OR IGNORE INTO daily (user_id, day) VALUES (?, ?)", (user_id, day))

    # ---------- Unfinished puzzle ----------

    def get_progress(self, user_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT meta, saved_at, photo IS NOT NULL AS has_photo FROM progress WHERE user_id = ?", (user_id,)
            ).fetchone()
        if not row or not row["has_photo"] or row["meta"] == "{}":  # no layout saved yet
            return None
        return json.loads(row["meta"])

    def save_progress(self, user_id, meta):
        if not isinstance(meta, dict):
            raise AccountError("Invalid save.")
        encoded = json.dumps(meta)
        if len(encoded) > MAX_PROGRESS_JSON:
            raise AccountError("This puzzle is too large to save.", 413)
        with self.connect() as db:
            db.execute(
                "INSERT INTO progress (user_id, meta, saved_at) VALUES (?, ?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET meta = excluded.meta, saved_at = excluded.saved_at",
                (user_id, encoded, int(time.time())),
            )

    def save_progress_photo(self, user_id, body):
        photo = jpeg(body.get("photo"), MAX_PROGRESS_PHOTO, "photo")
        thumb = jpeg(body.get("thumb"), 512 * 1024, "thumbnail")
        with self.connect() as db:
            used = self.storage_used(db, user_id)
            old = db.execute("SELECT LENGTH(photo) + LENGTH(thumb) FROM progress WHERE user_id = ?", (user_id,)).fetchone()
            if used - ((old[0] or 0) if old else 0) + len(photo) + len(thumb) > MAX_STORAGE_BYTES:
                raise AccountError("Your account's storage is full. Remove a few puzzles to make room.", 409)
            # A new photo starts a new save: the old layout belonged to the previous puzzle.
            db.execute(
                "INSERT INTO progress (user_id, meta, photo, thumb, saved_at) VALUES (?, '{}', ?, ?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET meta = '{}', photo = excluded.photo, thumb = excluded.thumb,"
                " saved_at = excluded.saved_at",
                (user_id, photo, thumb, int(time.time())),
            )

    def progress_image(self, user_id, which):
        column = {"photo": "photo", "thumb": "thumb"}[which]
        with self.connect() as db:
            row = db.execute(f"SELECT {column} FROM progress WHERE user_id = ?", (user_id,)).fetchone()
        return row[column] if row else None

    def clear_progress(self, user_id):
        with self.connect() as db:
            db.execute("DELETE FROM progress WHERE user_id = ?", (user_id,))
