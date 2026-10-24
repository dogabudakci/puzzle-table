"""Serves the app, its account API, and keeps the photo library up to date.

Every time the app asks for the library list, the `library/` folder is checked first, so a photo
dropped there shows up after a reload of the page.

Run it with:  python3 tools/serve.py        then open http://localhost:8765
Options (environment variables):
  PUZZLE_HOST=0.0.0.0        listen on the network, not just this computer (default 127.0.0.1)
  PUZZLE_SECURE_COOKIES=1    mark the session cookie Secure; set this whenever the site is served over HTTPS
  PUZZLE_DB=path             use another database file (for testing)
  PUZZLE_PUBLIC_URL=https://…  the site's public address, used in emailed links (default http://localhost:PORT)
  PUZZLE_SMTP_HOST etc.      the mail server for emails (see tools/mailer.py); without it, emails go to data/outbox/
"""

import base64
import hashlib
import http.server
import json
import os
import re
import sys
import threading
from functools import partial
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_library  # noqa: E402
from accounts import DB_PATH, SESSION_DAYS, AccountError, Accounts  # noqa: E402
from userdata import UserData  # noqa: E402
from recovery import Recovery, public_url  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HOST = os.environ.get("PUZZLE_HOST", "127.0.0.1")
SECURE_COOKIES = os.environ.get("PUZZLE_SECURE_COOKIES") == "1"
ROOT = build_library.ROOT
LIBRARY_LIST = "/assets/library/library.json"
COOKIE = "pt_session"
MAX_BODY = 8 * 1024  # account requests are tiny
MAX_UPLOAD_BODY = 9 * 1024 * 1024  # a picture (as base64) plus its details

# Only these are ever served; the database, tools, original photos and hidden files are not.
PUBLIC_FILES = {"/", "/index.html", "/styles.css"}
PUBLIC_DIRS = ("/js/", "/assets/", "/vendor/")

build_lock = threading.Lock()
accounts = Accounts(os.environ.get("PUZZLE_DB") or DB_PATH)
userdata = UserData(accounts)
recovery = Recovery(accounts, public_url(PORT))


def inline_script_hashes():
    """CSP hashes for the small inline scripts in index.html, so no other inline script can run."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    return " ".join(f"'sha256-{base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()}'" for s in scripts)


CSP = "; ".join([
    "default-src 'self'",
    f"script-src 'self' {inline_script_hashes()}",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "PuzzleTable"
    sys_version = ""

    # ---------- Static files ----------

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self.api_get(path)
        if not self.is_public(path):
            return self.send_error(404)
        if path == LIBRARY_LIST:
            with build_lock:
                try:
                    build_library.build(verbose=True)
                except Exception as err:  # still serve the last good list
                    print(f"library update failed: {err}")
        super().do_GET()

    def do_HEAD(self):
        if not self.is_public(urlsplit(self.path).path):
            return self.send_error(404)
        super().do_HEAD()

    @staticmethod
    def is_public(path):
        if ".." in path or "/." in path:
            return False
        return path in PUBLIC_FILES or path.startswith(PUBLIC_DIRS)

    def list_directory(self, path):  # never show folder listings
        self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always show the latest files while developing
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        if SECURE_COOKIES:
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    # ---------- Account API ----------

    def api_get(self, path):
        if path == "/api/me":
            return self.send_json(200, {"user": self.current_user()})
        try:
            user = self.require_user()
            uid = user["id"]
            if path == "/api/gallery":
                return self.send_json(200, {"puzzles": userdata.list_gallery(uid)})
            match = re.fullmatch(r"/api/gallery/(\d{1,12})/image", path)
            if match:
                return self.send_jpeg(userdata.gallery_image(uid, int(match[1])))
            if path == "/api/achievements":
                return self.send_json(200, {"achievements": userdata.list_achievements(uid)})
            if path == "/api/daily":
                return self.send_json(200, {"days": userdata.list_days(uid)})
            if path == "/api/progress":
                return self.send_json(200, {"progress": userdata.get_progress(uid)})
            if path in ("/api/progress/photo", "/api/progress/thumb"):
                return self.send_jpeg(userdata.progress_image(uid, path.rsplit("/", 1)[1]))
            self.send_json(404, {"error": "Not found."})
        except AccountError as err:
            self.send_json(err.status, {"error": str(err)})
        except Exception as err:  # never leak details to the browser
            print(f"api error on {path}: {err!r}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def do_POST(self):
        path = urlsplit(self.path).path
        routes = {
            "/api/signup": self.api_signup,
            "/api/login": self.api_login,
            "/api/logout": self.api_logout,
            "/api/password": self.api_password,
            "/api/delete-account": self.api_delete,
            "/api/gallery/add": self.api_gallery_add,
            "/api/gallery/delete": self.api_gallery_delete,
            "/api/achievements": self.api_achievements,
            "/api/daily": self.api_daily,
            "/api/progress": self.api_progress,
            "/api/progress/photo": self.api_progress_photo,
            "/api/progress/clear": self.api_progress_clear,
            "/api/reset/request": self.api_reset_request,
            "/api/reset/confirm": self.api_reset_confirm,
            "/api/email": self.api_email,
            "/api/email/resend": self.api_email_resend,
            "/api/email/confirm": self.api_email_confirm,
        }
        uploads = {"/api/gallery/add", "/api/progress/photo", "/api/progress"}
        route = routes.get(path)
        if not route:
            return self.send_json(404, {"error": "Not found."})
        if not self.same_origin():
            return self.send_json(403, {"error": "Request refused."})
        try:
            body = self.read_json(MAX_UPLOAD_BODY if path in uploads else MAX_BODY)
            route(body)
        except AccountError as err:
            self.send_json(err.status, {"error": str(err)})
        except Exception as err:  # never leak details to the browser
            print(f"api error on {path}: {err!r}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    # Saved data: each handler only ever touches the signed-in player's own rows.

    def api_gallery_add(self, body):
        item_id = userdata.add_gallery(self.require_user()["id"], body)
        self.send_json(201, {"id": item_id})

    def api_gallery_delete(self, body):
        userdata.delete_gallery(self.require_user()["id"], body.get("id"))
        self.send_json(200, {"ok": True})

    def api_achievements(self, body):
        userdata.add_achievements(self.require_user()["id"], body.get("achievements"))
        self.send_json(200, {"ok": True})

    def api_daily(self, body):
        userdata.add_days(self.require_user()["id"], body.get("days"))
        self.send_json(200, {"ok": True})

    def api_progress(self, body):
        userdata.save_progress(self.require_user()["id"], body.get("progress"))
        self.send_json(200, {"ok": True})

    def api_progress_photo(self, body):
        userdata.save_progress_photo(self.require_user()["id"], body)
        self.send_json(200, {"ok": True})

    def api_progress_clear(self, body):
        userdata.clear_progress(self.require_user()["id"])
        self.send_json(200, {"ok": True})

    def api_signup(self, body):
        token, user = accounts.sign_up(body.get("identifier"), body.get("password"), self.address())
        if user["email"]:
            try:
                recovery.send_verification(user["id"], user["email"], self.address())
            except AccountError:
                pass  # rate-limited: they can resend from their account
        self.send_json(201, {"user": user}, session=token)

    # Email confirmation and password reset (see tools/recovery.py)

    def api_reset_request(self, body):
        recovery.request_reset(body.get("email"), self.address())
        self.send_json(200, {"ok": True})

    def api_reset_confirm(self, body):
        token = recovery.reset_password(body.get("token"), body.get("password"))
        self.send_json(200, {"user": accounts.session_user(token)}, session=token)

    def api_email(self, body):
        user = self.require_user()
        recovery.set_email(user["id"], body.get("email"), body.get("password"), self.address())
        self.send_json(200, {"user": accounts.user(user["id"])})

    def api_email_resend(self, body):
        recovery.resend_verification(self.require_user()["id"], self.address())
        self.send_json(200, {"ok": True})

    def api_email_confirm(self, body):
        user_id = recovery.confirm_email(body.get("token"))
        current = self.current_user()
        # Only hand back account details to the account itself (the link may be opened elsewhere).
        self.send_json(200, {"user": accounts.user(user_id) if current and current["id"] == user_id else None})

    def api_login(self, body):
        token, user = accounts.sign_in(body.get("identifier"), body.get("password"), self.address())
        self.send_json(200, {"user": user}, session=token)

    def api_logout(self, body):
        accounts.sign_out(self.session_token())
        self.send_json(200, {"user": None}, session="")

    def api_password(self, body):
        user = self.require_user()
        accounts.change_password(user["id"], body.get("current"), body.get("password"), self.session_token())
        self.send_json(200, {"user": user})

    def api_delete(self, body):
        user = self.require_user()
        accounts.delete_account(user["id"], body.get("password"))
        self.send_json(200, {"user": None}, session="")

    # ---------- Helpers ----------

    def same_origin(self):
        """Refuse cross-site requests: the Origin header must match this server, and the body must be JSON."""
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if not origin or urlsplit(origin).netloc != host:
            return False
        return self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"

    def read_json(self, limit=MAX_BODY):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise AccountError("Invalid request.")
        if length < 0 or length > limit:
            raise AccountError("Request too large.", 413)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise AccountError("Invalid request.")
        if not isinstance(data, dict):
            raise AccountError("Invalid request.")
        return data

    def address(self):
        return self.client_address[0]

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie[COOKIE].value if COOKIE in cookie else None

    def current_user(self):
        return accounts.session_user(self.session_token())

    def require_user(self):
        user = self.current_user()
        if not user:
            raise AccountError("Please sign in first.", 401)
        return user

    def send_jpeg(self, data):
        if data is None:
            return self.send_json(404, {"error": "Not found."})
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data, session=None):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if session is not None:
            # HttpOnly: page scripts can't read it. SameSite=Strict: other sites can't send it.
            parts = [f"{COOKIE}={session}", "Path=/", "HttpOnly", "SameSite=Strict",
                     f"Max-Age={SESSION_DAYS * 86400 if session else 0}"]
            if SECURE_COOKIES:
                parts.append("Secure")
            self.send_header("Set-Cookie", "; ".join(parts))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    handler = partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer((HOST, PORT), handler) as server:
        print(f"Puzzle Table: http://localhost:{PORT}  (drop photos into {build_library.SOURCE})")
        server.serve_forever()
