"""Sends the app's emails (password reset, email confirmation).

Emails go out over an encrypted connection, in one of two ways:
- Brevo's web API (brevo.com, free for 300 emails a day). Online this is the one to use:
  Render's free plan blocks the ports normal mail servers use.
- A mail server (SMTP), e.g. Gmail with an app password, for running it on your own computer.
Without either (while developing), each email is written to data/outbox/ (readable only by
this computer's user) and its subject is printed, so links can be tested without a mail account.

Configuration (environment variables):
  PUZZLE_MAIL_FROM (e.g. "Puzzle Table <hello@example.com>"; with Brevo, a sender you've verified there)
  PUZZLE_BREVO_API_KEY
  or PUZZLE_SMTP_HOST, PUZZLE_SMTP_PORT (default 587), PUZZLE_SMTP_USER, PUZZLE_SMTP_PASSWORD
SMTP port 465 uses SSL from the start; any other port must offer STARTTLS, or nothing is sent.
"""

import html
import json
import os
import smtplib
import ssl
import threading
import time
import urllib.request
from email.message import EmailMessage
from email.utils import parseaddr
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTBOX = Path(os.environ.get("PUZZLE_OUTBOX") or ROOT / "data" / "outbox")

SMTP_HOST = os.environ.get("PUZZLE_SMTP_HOST")
SMTP_PORT = int(os.environ.get("PUZZLE_SMTP_PORT") or 587)
SMTP_USER = os.environ.get("PUZZLE_SMTP_USER")
SMTP_PASSWORD = os.environ.get("PUZZLE_SMTP_PASSWORD")
MAIL_FROM = os.environ.get("PUZZLE_MAIL_FROM") or "Puzzle Table <no-reply@localhost>"
BREVO_API_KEY = os.environ.get("PUZZLE_BREVO_API_KEY")
BREVO_URL = "https://api.brevo.com/v3/smtp/email"


def _deliver_brevo(message):
    name, address = parseaddr(message["From"])
    content = {
        "sender": {"name": name or "Puzzle Table", "email": address},
        "to": [{"email": message["To"]}],
        "subject": message["Subject"],
        "textContent": message.get_body(("plain",)).get_content(),
    }
    designed = message.get_body(("html",))
    if designed is not None and designed.get_content_subtype() == "html":
        content["htmlContent"] = designed.get_content()
    body = json.dumps(content).encode()
    request = urllib.request.Request(BREVO_URL, data=body, method="POST", headers={
        "api-key": BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json",
    })
    # HTTPS with the certificate checked (urllib's default); raises unless Brevo accepted the email.
    with urllib.request.urlopen(request, timeout=20) as response:
        response.read()


def _deliver(message):
    if BREVO_API_KEY:
        return _deliver_brevo(message)
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


def send(to, subject, text, designed=None):
    """Sends in the background, so how long a request takes never reveals whether an email went out.
    `designed` is an optional HTML version (see design()); the plain text always goes along too."""
    message = EmailMessage()
    message["From"] = MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text, cte="7bit")  # plain text, so links are never wrapped or encoded
    if designed:
        message.add_alternative(designed, subtype="html", cte="7bit")

    def run():
        try:
            _deliver(message)
        except Exception as err:  # the address itself is never logged
            print(f"[mail] sending \"{subject}\" failed: {err!r}")

    threading.Thread(target=run, daemon=True).start()


def design(site_url, heading, paragraphs, button=None, footnote=None):
    """The HTML version of an email, in the app's look. Built from tables and inline styles,
    which is what email apps reliably show. `button` is (label, link)."""
    e = html.escape
    logo = f"{site_url}/assets/icons/icon-192.png"
    text = "".join(
        f'<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#4c5047">{e(p)}</p>\n' for p in paragraphs
    )
    action = ""
    if button:
        label, link = button
        action = (
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>\n'
            f'<td style="border-radius:10px;background:#2f5241"><a href="{e(link)}"\n'
            ' style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#f4f1ea;'
            f'text-decoration:none;border-radius:10px">{e(label)}</a></td>\n</tr></table>\n'
            '<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#7d7f74">If the button doesn\'t work,'
            f' copy this link into your browser:<br>\n<a href="{e(link)}" style="color:#2f5241;word-break:break-all">'
            f'{e(link)}</a></p>\n'
        )
    note = f'<p style="margin:0;font-size:13px;line-height:1.5;color:#7d7f74">{e(footnote)}</p>\n' if footnote else ""
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{e(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr>
<td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 0 20px">
<img src="{e(logo)}" width="36" height="36" alt="" style="vertical-align:middle;border-radius:8px">
<span style="vertical-align:middle;margin-left:10px;font-family:Georgia,serif;font-size:20px;font-weight:600;color:#23271f">Puzzle Table</span>
</td></tr>
<tr><td style="padding:32px 28px;background:#fdfcf9;border-radius:16px">
<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:24px;font-weight:600;color:#23271f">{e(heading)}</h1>
{text}{action}{note}</td></tr>
<tr><td style="padding:20px 8px;font-family:Georgia,serif;font-style:italic;font-size:14px;color:#7d7f74;text-align:center">
Piece by Piece, Find Your Peace.<br>
<a href="{e(site_url)}" style="color:#7d7f74;font-style:normal;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px">{e(site_url)}</a>
</td></tr>
</table></td></tr></table>
</body></html>
"""
    return page.encode("ascii", "xmlcharrefreplace").decode()  # plain ASCII with short lines, safe to send as-is
