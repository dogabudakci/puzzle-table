"""Player accounts: sign up, sign in and sessions, stored in the database (see tools/db.py).

Security choices:
- Passwords are never stored. Only an scrypt hash is kept (N=2^15, r=8, p=3: one of OWASP's
  equally strong settings, chosen because it needs 32 MB of memory instead of 128 MB on a small
  server), with a random 16-byte salt per user. The parameters are stored with each hash, so
  they can be changed later and old hashes upgraded on the next sign-in. Only two hashes are
  worked out at a time, so a flood of sign-in attempts can't use up the server's memory.
- A session is a random 256-bit token, given to the browser in an HttpOnly cookie. The
  database only keeps its SHA-256, so a leaked database can't be used to sign in.
- Sign-in answers the same way, and takes about as long, whether or not the account exists,
  so it can't be used to find out who has an account. Repeated failures are slowed down per
  account and per network address.
- Every query is parameterised.
"""

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from pathlib import Path

from db import Database

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "puzzle.db"

SESSION_DAYS = 30
SCRYPT = {"n": 2 ** 15, "r": 8, "p": 3}
SCRYPT_MAXMEM = 2 ** 28  # also allows checking older N=2^17 hashes
HASHING = threading.BoundedSemaphore(2)

USERNAME_RE = re.compile(r"^[a-z0-9_.-]{3,24}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
MIN_PASSWORD, MAX_PASSWORD = 10, 128
# A few of the most guessed passwords that pass the length rule.
COMMON_PASSWORDS = {
    "1234567890", "12345678910", "qwertyuiop", "password123", "password12", "iloveyou12",
    "qwerty1234", "1q2w3e4r5t", "abcdefghij", "0123456789", "passwordpassword", "1111111111",
}

# Failed sign-ins allowed within the window before more attempts are refused.
WINDOW = 15 * 60
MAX_FAILS_PER_ACCOUNT = 5
MAX_FAILS_PER_ADDRESS = 30
MAX_SIGNUPS_PER_ADDRESS = 10


class AccountError(Exception):
    """A problem to show to the player, with an HTTP status."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password, salt=None, n=SCRYPT["n"], r=SCRYPT["r"], p=SCRYPT["p"]):
    salt = salt or secrets.token_bytes(16)
    with HASHING:
        digest = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, maxmem=SCRYPT_MAXMEM, dklen=32)
    return f"scrypt${n}${r}${p}${b64(salt)}${b64(digest)}"


def check_password(password, stored):
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = hash_password(password, unb64(salt), int(n), int(r), int(p)).split("$")[-1]
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(expected, digest)


def needs_rehash(stored):
    _, n, r, p, *_ = stored.split("$")
    return (int(n), int(r), int(p)) != (SCRYPT["n"], SCRYPT["r"], SCRYPT["p"])


# Checked against when the account doesn't exist, so a wrong name takes as long as a wrong password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class RateLimiter:
    """Counts events per key within a sliding window (kept in memory)."""

    def __init__(self):
        self.events = {}
        self.lock = threading.Lock()

    def count(self, key):
        now = time.time()
        with self.lock:
            recent = [t for t in self.events.get(key, []) if now - t < WINDOW]
            self.events[key] = recent
            return len(recent)

    def add(self, key):
        with self.lock:
            self.events.setdefault(key, []).append(time.time())

    def clear(self, key):
        with self.lock:
            self.events.pop(key, None)


class Accounts:
    def __init__(self, db_path=DB_PATH):
        self.database = Database(db_path)
        self.limits = RateLimiter()
        self.database.script("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    username TEXT UNIQUE,
                    email TEXT UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    CHECK (username IS NOT NULL OR email IS NOT NULL)
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
            """)
        self.database.add_column("users", "suspended", "INTEGER NOT NULL DEFAULT 0")  # set from the admin page

    def connect(self):
        return self.database.connect()

    # ---------- Checks ----------

    @staticmethod
    def parse_identifier(identifier):
        """'Email or username' as typed -> ('email' | 'username', normalised value)."""
        value = (identifier or "").strip().lower()
        if "@" in value:
            if len(value) > 254 or not EMAIL_RE.match(value):
                raise AccountError("Please enter a valid email address.")
            return "email", value
        if not USERNAME_RE.match(value):
            raise AccountError("Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.")
        return "username", value

    @staticmethod
    def check_new_password(password, identifier):
        if not isinstance(password, str) or len(password) < MIN_PASSWORD:
            raise AccountError(f"Please use at least {MIN_PASSWORD} characters for your password.")
        if len(password) > MAX_PASSWORD:
            raise AccountError(f"Passwords can be at most {MAX_PASSWORD} characters.")
        lowered = password.lower()
        if lowered in COMMON_PASSWORDS or len(set(password)) < 4:
            raise AccountError("That password is too easy to guess. Try a short phrase of a few words.")
        if identifier.split("@")[0] in lowered:
            raise AccountError("Your password shouldn't contain your username or email.")

    # ---------- Sign up, sign in, sessions ----------

    def sign_up(self, identifier, password, address):
        if self.limits.count(f"signup:{address}") >= MAX_SIGNUPS_PER_ADDRESS:
            raise AccountError("Too many new accounts from here. Please try again later.", 429)
        kind, value = self.parse_identifier(identifier)
        self.check_new_password(password, value)
        self.limits.add(f"signup:{address}")
        stored = hash_password(password)
        try:
            with self.connect() as db:
                user_id = db.execute(
                    f"INSERT INTO users ({kind}, password_hash, created_at) VALUES (?, ?, ?) RETURNING id",
                    (value, stored, int(time.time())),
                ).fetchone()["id"]
        except self.database.IntegrityError:
            raise AccountError("That name is already taken. Try signing in instead.", 409)
        return self.new_session(user_id), self.user(user_id)

    def sign_in(self, identifier, password, address):
        try:
            kind, value = self.parse_identifier(identifier)
        except AccountError:
            kind, value = "username", ""
        if (self.limits.count(f"fail:{value}") >= MAX_FAILS_PER_ACCOUNT
                or self.limits.count(f"fail-ip:{address}") >= MAX_FAILS_PER_ADDRESS):
            raise AccountError("Too many attempts. Please wait 15 minutes and try again.", 429)

        with self.connect() as db:
            row = db.execute(f"SELECT id, password_hash, suspended FROM users WHERE {kind} = ?", (value,)).fetchone() if value else None
        ok = check_password(password or "", row["password_hash"] if row else DUMMY_HASH) and row is not None
        if ok and row["suspended"]:  # only said to someone who knows the password
            raise AccountError("This account has been suspended. If you think that's a mistake, please contact us.", 403)
        if not ok:
            self.limits.add(f"fail:{value}")
            self.limits.add(f"fail-ip:{address}")
            raise AccountError("That email/username and password don't match.", 401)

        self.limits.clear(f"fail:{value}")
        if needs_rehash(row["password_hash"]):
            with self.connect() as db:
                db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"]))
        return self.new_session(row["id"]), self.user(row["id"])

    def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            db.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash(token), user_id, now, now + SESSION_DAYS * 86400),
            )
        return token

    def session_user(self, token):
        if not token:
            return None
        with self.connect() as db:
            row = db.execute(
                "SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id"
                " WHERE s.token_hash = ? AND s.expires_at > ? AND u.suspended = 0",
                (token_hash(token), int(time.time())),
            ).fetchone()
        return self.user(row["user_id"]) if row else None

    def sign_out(self, token):
        if token:
            with self.connect() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))

    def change_password(self, user_id, current, new, keep_token):
        with self.connect() as db:
            row = db.execute("SELECT username, email, password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row or not check_password(current or "", row["password_hash"]):
            raise AccountError("Your current password isn't right.", 401)
        self.check_new_password(new, row["email"] or row["username"])
        with self.connect() as db:
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))
            # Sign out everywhere else: a stolen session stops working once the password changes.
            db.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user_id, token_hash(keep_token)))

    def delete_account(self, user_id, password):
        with self.connect() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row or not check_password(password or "", row["password_hash"]):
                raise AccountError("That password isn't right.", 401)
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def user(self, user_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        user = dict(row)
        user.pop("password_hash", None)  # never sent anywhere
        user["email_verified"] = bool(user.get("email_verified"))
        user.pop("suspended", None)
        return user
