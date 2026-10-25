"""Email confirmation and password reset.

Security choices:
- Links carry a random 256-bit token that is single-use and short-lived; only its SHA-256 is
  stored. Tokens travel in the link's #fragment, which browsers never send to servers or put in
  Referer headers, so they don't end up in logs.
- Links are built from the configured public address (PUZZLE_PUBLIC_URL), never from the
  request's Host header, which an attacker could fake to receive someone's reset link.
- "Forgot password" answers the same way whether or not the email has an account, and only
  confirmed emails can receive reset links (otherwise anyone could sign up with someone
  else's address and take it over later).
- Resetting a password signs out every session and cancels every other outstanding link.
- Requests are rate-limited per email and per network address.
"""

import os
import secrets
import time

import mailer
from accounts import EMAIL_RE, AccountError, hash_password, check_password, token_hash

RESET_MINUTES = 30
VERIFY_HOURS = 48
MAX_REQUESTS_PER_EMAIL = 3
MAX_REQUESTS_PER_ADDRESS = 10

SCHEMA = """
CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('reset', 'verify')),
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
"""


class Recovery:
    def __init__(self, accounts, public_url):
        self.accounts = accounts
        self.public_url = public_url.rstrip("/")
        accounts.database.script(SCHEMA)
        accounts.database.add_column("users", "email_verified", "INTEGER NOT NULL DEFAULT 0")
        accounts.database.add_column("users", "pending_email", "TEXT")

    def connect(self):
        return self.accounts.connect()

    def _limited(self, email, address):
        limits = self.accounts.limits
        if (limits.count(f"mail:{email}") >= MAX_REQUESTS_PER_EMAIL
                or limits.count(f"mail-ip:{address}") >= MAX_REQUESTS_PER_ADDRESS):
            return True
        limits.add(f"mail:{email}")
        limits.add(f"mail-ip:{address}")
        return False

    def _new_token(self, db, user_id, purpose, email, seconds):
        token = secrets.token_urlsafe(32)
        db.execute("DELETE FROM tokens WHERE expires_at < ?", (int(time.time()),))
        db.execute("DELETE FROM tokens WHERE user_id = ? AND purpose = ?", (user_id, purpose))  # one live link at a time
        db.execute(
            "INSERT INTO tokens (token_hash, user_id, purpose, email, expires_at) VALUES (?, ?, ?, ?, ?)",
            (token_hash(token), user_id, purpose, email, int(time.time()) + seconds),
        )
        return token

    def _take_token(self, db, token, purpose):
        """The token's row if it's valid, deleting it so it can't be used twice."""
        if not isinstance(token, str) or not 20 <= len(token) <= 100:
            return None
        row = db.execute(
            "SELECT user_id, email FROM tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?",
            (token_hash(token), purpose, int(time.time())),
        ).fetchone()
        db.execute("DELETE FROM tokens WHERE token_hash = ?", (token_hash(token),))
        return row

    # ---------- Confirming an email ----------

    def send_verification(self, user_id, email, address):
        if self._limited(email, address):
            raise AccountError("We've sent a few emails already. Please check your inbox, or try again later.", 429)
        with self.connect() as db:
            token = self._new_token(db, user_id, "verify", email, VERIFY_HOURS * 3600)
        link = f"{self.public_url}/#verify={token}"
        mailer.send(email, "Confirm your email for Puzzle Table", (
            "Hello,\n\nPlease confirm this email address for your Puzzle Table account by opening this link:\n\n"
            f"{link}\n\n"
            f"The link works for {VERIFY_HOURS} hours. If you didn't ask for this, you can ignore this email.\n"
        ), mailer.design(self.public_url, "Confirm your email", [
            "Please confirm this email address for your Puzzle Table account. "
            "Then you can reset your password if you ever forget it.",
        ], ("Confirm email", link), f"The link works for {VERIFY_HOURS} hours. If you didn't ask for this, you can ignore this email."))

    def confirm_email(self, token):
        with self.connect() as db:
            row = self._take_token(db, token, "verify")
            if not row:
                raise AccountError("This link has expired or was already used. You can send a new one from your account.", 410)
            before = db.execute("SELECT email, email_verified FROM users WHERE id = ?", (row["user_id"],)).fetchone()
            try:
                db.execute(
                    "UPDATE users SET email = ?, email_verified = 1,"
                    " pending_email = CASE WHEN pending_email = ? THEN NULL ELSE pending_email END WHERE id = ?",
                    (row["email"], row["email"], row["user_id"]),
                )
            except self.accounts.database.IntegrityError:
                raise AccountError("That email now belongs to another account.", 409)
        # Tell the old confirmed address, so a change nobody asked for doesn't go unnoticed.
        if before and before["email"] and before["email_verified"] and before["email"] != row["email"]:
            mailer.send(before["email"], "Your Puzzle Table email was changed", (
                "Hello,\n\nThe email address of your Puzzle Table account was just changed to a different one.\n"
                "If that was you, there's nothing to do. If not, someone may have your password: please reset it\n"
                f"from {self.public_url} and contact us.\n"
            ), mailer.design(self.public_url, "Your email was changed", [
                "The email address of your Puzzle Table account was just changed to a different one.",
                "If that was you, there's nothing to do. If not, someone may have your password: "
                "please reset it and contact us.",
            ], ("Open Puzzle Table", self.public_url)))
        return row["user_id"]

    def set_email(self, user_id, email, password, address):
        """Adds or changes the account's email. It only takes effect once confirmed from the new inbox."""
        email = (email or "").strip().lower()
        if len(email) > 254 or not EMAIL_RE.match(email):
            raise AccountError("Please enter a valid email address.")
        with self.connect() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row or not check_password(password or "", row["password_hash"]):
                raise AccountError("Your password isn't right.", 401)
            taken = db.execute("SELECT 1 FROM users WHERE email = ? AND id != ?", (email, user_id)).fetchone()
            if taken:
                raise AccountError("That email belongs to another account.", 409)
            db.execute("UPDATE users SET pending_email = ? WHERE id = ?", (email, user_id))
        self.send_verification(user_id, email, address)

    def resend_verification(self, user_id, address):
        with self.connect() as db:
            row = db.execute("SELECT email, email_verified, pending_email FROM users WHERE id = ?", (user_id,)).fetchone()
        email = row and (row["pending_email"] or (row["email"] if not row["email_verified"] else None))
        if not email:
            raise AccountError("There's no email waiting to be confirmed.")
        self.send_verification(user_id, email, address)

    # ---------- Password reset ----------

    def request_reset(self, email, address):
        """Always succeeds from the outside; an email only goes out for a confirmed account email."""
        email = (email or "").strip().lower()
        if len(email) > 254 or not EMAIL_RE.match(email):
            raise AccountError("Please enter a valid email address.")
        if self._limited(email, address):
            return  # same answer as success: don't reveal anything, just don't send more
        with self.connect() as db:
            row = db.execute("SELECT id FROM users WHERE email = ? AND email_verified = 1", (email,)).fetchone()
            if not row:
                return
            token = self._new_token(db, row["id"], "reset", email, RESET_MINUTES * 60)
        link = f"{self.public_url}/#reset={token}"
        mailer.send(email, "Reset your Puzzle Table password", (
            "Hello,\n\nSomeone (hopefully you) asked to reset the password for your Puzzle Table account.\n"
            "Choose a new password here:\n\n"
            f"{link}\n\n"
            f"The link works once, for {RESET_MINUTES} minutes. If you didn't ask for this, ignore this email:\n"
            "your password stays the same.\n"
        ), mailer.design(self.public_url, "Reset your password", [
            "Someone (hopefully you) asked to reset the password for your Puzzle Table account.",
        ], ("Choose a new password", link),
            f"The link works once, for {RESET_MINUTES} minutes. If you didn't ask for this, ignore this email: "
            "your password stays the same."))

    def reset_password(self, token, password):
        # Check the new password before using up the link, so a too-weak one can simply be retried.
        valid = isinstance(token, str) and 20 <= len(token) <= 100
        with self.connect() as db:
            row = db.execute(
                "SELECT t.user_id, u.username, u.email FROM tokens t JOIN users u ON u.id = t.user_id"
                " WHERE t.token_hash = ? AND t.purpose = 'reset' AND t.expires_at > ?",
                (token_hash(token), int(time.time())),
            ).fetchone() if valid else None
        if not row:
            raise AccountError("This link has expired or was already used. Please ask for a new one.", 410)
        self.accounts.check_new_password(password, row["email"] or row["username"])
        stored = hash_password(password)
        with self.connect() as db:
            used = db.execute("DELETE FROM tokens WHERE token_hash = ?", (token_hash(token),)).rowcount
            if not used:  # someone used it a moment ago
                raise AccountError("This link has expired or was already used. Please ask for a new one.", 410)
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (stored, row["user_id"]))
            db.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))  # sign out everywhere
            db.execute("DELETE FROM tokens WHERE user_id = ?", (row["user_id"],))
        return self.accounts.new_session(row["user_id"])

def public_url(port):
    return os.environ.get("PUZZLE_PUBLIC_URL") or f"http://localhost:{port}"
