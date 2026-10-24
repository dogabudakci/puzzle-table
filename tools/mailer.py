"""Sends the app's emails (password reset, email confirmation).

With a mail server configured, emails go out over an encrypted connection. Without one (while
developing), each email is written to data/outbox/ (readable only by this computer's user) and
its subject is printed, so links can be tested without a mail account.

Configuration (environment variables):
  PUZZLE_SMTP_HOST, PUZZLE_SMTP_PORT (default 587), PUZZLE_SMTP_USER, PUZZLE_SMTP_PASSWORD,
  PUZZLE_MAIL_FROM (e.g. "Puzzle Table <hello@example.com>")
Port 465 uses SSL from the start; any other port must offer STARTTLS, or nothing is sent.
"""

import os
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTBOX = ROOT / "data" / "outbox"

SMTP_HOST = os.environ.get("PUZZLE_SMTP_HOST")
SMTP_PORT = int(os.environ.get("PUZZLE_SMTP_PORT") or 587)
SMTP_USER = os.environ.get("PUZZLE_SMTP_USER")
SMTP_PASSWORD = os.environ.get("PUZZLE_SMTP_PASSWORD")
MAIL_FROM = os.environ.get("PUZZLE_MAIL_FROM") or "Puzzle Table <no-reply@localhost>"


def _deliver(message):
    if not SMTP_HOST:
        OUTBOX.mkdir(parents=True, exist_ok=True)
        OUTBOX.chmod(0o700)
        path = OUTBOX / f"{int(time.time() * 1000)}.eml"
        path.write_bytes(bytes(message))
        path.chmod(0o600)
        print(f"[mail] no mail server set: saved \"{message['Subject']}\" to {path}")
        return
    context = ssl.create_default_context()  # verifies the server's certificate
    if SMTP_PORT == 465:
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20)
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
        server.starttls(context=context)  # raises if the server can't encrypt: never send in the clear
    with server:
        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD or "")
        server.send_message(message)


def send(to, subject, text):
    """Sends in the background, so how long a request takes never reveals whether an email went out."""
    message = EmailMessage()
    message["From"] = MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text, cte="7bit")  # plain text, so links are never wrapped or encoded

    def run():
        try:
            _deliver(message)
        except Exception as err:  # the address itself is never logged
            print(f"[mail] sending \"{subject}\" failed: {err!r}")

    threading.Thread(target=run, daemon=True).start()
