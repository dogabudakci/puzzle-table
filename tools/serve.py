"""Serves the app, its account API, and keeps the photo library up to date.

Every time the app asks for the library list, the `library/` folder is checked first, so a photo
dropped there shows up after a reload of the page.

Run it with:  python3 tools/serve.py        then open http://localhost:8765
Options (environment variables; render.yaml sets the ones the online site needs):
  PORT=8765                  the port to listen on (Render sets this itself)
  PUZZLE_HOST=0.0.0.0        listen on the network, not just this computer (default 127.0.0.1)
  PUZZLE_SECURE_COOKIES=1    mark the session cookie Secure; set this whenever the site is served over HTTPS
  PUZZLE_TRUST_PROXY=1       the server sits behind a proxy (Render) that adds the visitor's address
                             to X-Forwarded-For; never set it otherwise, since anyone can send that header
  PUZZLE_DB=path             use another database file (for testing)
  DATABASE_URL=postgresql://…  use PostgreSQL (Neon) instead of the database file (see tools/db.py)
  PUZZLE_PUBLIC_URL=https://…  the site's public address, used in emailed links (default http://localhost:PORT)
  PUZZLE_BREVO_API_KEY etc.  how emails are sent (see tools/mailer.py); without it, emails go to data/outbox/
  PUZZLE_OPERATOR, PUZZLE_CONTACT_EMAIL, PUZZLE_COUNTRY
                             who runs the site: shown in the footer, privacy policy and terms
  PUZZLE_ADMIN_EMAIL         where reports about players are emailed
  PUZZLE_ADMIN_USERNAMES     usernames (comma-separated) that can open /admin.html to handle reports
"""

import base64
import email.utils
import gzip
import hashlib
import html
import http.server
import json
import os
import queue
import re
import shutil
import sys
import threading
import time
from functools import partial
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_library  # noqa: E402
from accounts import DB_PATH, SESSION_DAYS, AccountError, Accounts  # noqa: E402
from userdata import UserData  # noqa: E402
from recovery import Recovery, public_url  # noqa: E402
from social import Hub, Social  # noqa: E402
from admin import Admin  # noqa: E402

PORT = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT") or 8765)
HOST = os.environ.get("PUZZLE_HOST", "127.0.0.1")
SECURE_COOKIES = os.environ.get("PUZZLE_SECURE_COOKIES") == "1"
TRUST_PROXY = os.environ.get("PUZZLE_TRUST_PROXY") == "1"
# The library is built with macOS tools from the original photos; online it's served as built.
BUILD_LIBRARY = build_library.SOURCE.is_dir() and shutil.which("sips") is not None
ROOT = build_library.ROOT
LIBRARY_LIST = "/assets/library/library.json"
COOKIE = "pt_session"
MAX_BODY = 8 * 1024  # account requests are tiny
MAX_UPLOAD_BODY = 7 * 1024 * 1024  # a picture (as base64) plus its details
MAX_LAYOUT_BODY = 256 * 1024  # a live game's starting layout
STREAM_SECONDS = 600  # live-update connections are renewed this often, re-checking the session
OFFLINE_GRACE = 8  # seconds before friends see someone go offline (a renewing connection isn't leaving)

# Only these are ever served; the database, tools, original photos and hidden files are not.
PUBLIC_FILES = {"/", "/index.html", "/styles.css", "/privacy.html", "/terms.html", "/manifest.webmanifest", "/admin.html"}
PUBLIC_DIRS = ("/js/", "/assets/", "/vendor/")
# Pages with the site's details filled in ({{OPERATOR}} etc.), so they live in one place: the settings.
PAGES = {"/": "index.html", "/index.html": "index.html", "/privacy.html": "privacy.html", "/terms.html": "terms.html",
         "/admin.html": "admin.html"}
LEGAL_UPDATED = "25 October 2026"
# Text files are sent compressed (gzip), which makes them about 70% smaller.
COMPRESSIBLE = {".html", ".css", ".js", ".json", ".svg", ".webmanifest"}
compressed_cache = {}  # (path, modified time) -> gzipped bytes
HEALTH_CHECK = "/healthz"  # for Render; answers without touching the database, so it never wakes it up

# Online, refuse to start with settings that would lose data, weaken sign-in, or leave the legal pages blank.
if os.environ.get("RENDER"):
    required = ("DATABASE_URL", "PUZZLE_PUBLIC_URL", "PUZZLE_OPERATOR", "PUZZLE_CONTACT_EMAIL", "PUZZLE_COUNTRY")
    missing = [name for name in required if not os.environ.get(name)]
    if missing or not SECURE_COOKIES:
        raise SystemExit(f"Not starting: set {', '.join(missing) or 'PUZZLE_SECURE_COOKIES=1'} in Render's Environment settings.")

build_lock = threading.Lock()
accounts = Accounts(os.environ.get("PUZZLE_DB") or DB_PATH)
userdata = UserData(accounts)
recovery = Recovery(accounts, public_url(PORT))
hub = Hub()
social = Social(accounts, hub)
admin = Admin(accounts, social, hub)

SITE = {
    "OPERATOR": os.environ.get("PUZZLE_OPERATOR") or "Puzzle Table",
    "CONTACT_EMAIL": os.environ.get("PUZZLE_CONTACT_EMAIL") or "contact@example.com",
    "COUNTRY": os.environ.get("PUZZLE_COUNTRY") or "the EU",
    "SITE_URL": public_url(PORT),
    "UPDATED": LEGAL_UPDATED,
    "YEAR": time.strftime("%Y"),
}


def inline_script_hashes():
    """CSP hashes for the small inline scripts in index.html, so no other inline script can run."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    return " ".join(f"'sha256-{base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()}'" for s in scripts)


CSP = "; ".join([
    "default-src 'self'",
    f"script-src 'self' {inline_script_hashes()}",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
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
    timeout = 30  # drop connections that stall, so slow clients can't tie up the server
    # Set here rather than taken from the system, which differs between computers: with "nosniff"
    # a wrong type would stop browsers from using the file.
    extensions_map = {
        ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
        ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
    }

    # ---------- Static files ----------

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self.api_get(path)
        if path == HEALTH_CHECK:
            return self.send_json(200, {"ok": True})
        if path in PAGES:
            return self.send_page(PAGES[path])
        if not self.is_public(path):
            return self.send_error(404)
        if path == LIBRARY_LIST and BUILD_LIBRARY:
            with build_lock:
                try:
                    build_library.build(verbose=True)
                except Exception as err:  # still serve the last good list
                    print(f"library update failed: {err}")
        file = ROOT / path.lstrip("/")
        if file.suffix in COMPRESSIBLE and file.is_file() and self.accepts_gzip():
            return self.send_compressed(file)
        super().do_GET()

    def accepts_gzip(self):
        return "gzip" in self.headers.get("Accept-Encoding", "")

    def send_compressed(self, file):
        stat = file.stat()
        modified = email.utils.formatdate(stat.st_mtime, usegmt=True)
        if self.headers.get("If-Modified-Since") == modified:
            self.send_response(304)
            self.end_headers()
            return
        key = (str(file), stat.st_mtime)
        body = compressed_cache.get(key)
        if body is None:
            body = gzip.compress(file.read_bytes(), compresslevel=6)
            if len(compressed_cache) > 200:  # files changed many times while developing
                compressed_cache.clear()
            compressed_cache[key] = body
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(file)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", modified)
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path in PAGES:
            return self.send_page(PAGES[path], head=True)
        if not self.is_public(path):
            return self.send_error(404)
        super().do_HEAD()

    def send_page(self, name, head=False):
        text = (ROOT / name).read_text(encoding="utf-8")
        for key, value in SITE.items():
            text = text.replace("{{" + key + "}}", html.escape(value))
        body = text.encode()
        compress = self.accepts_gzip()
        if compress:
            body = gzip.compress(body, compresslevel=6)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if compress:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def cache_policy(self):
        """Account data is never kept. Pictures, fonts and icons are kept a day, or for good when
        their address carries a version (?v=…, which changes with the file). The pages, code and
        lists are checked with the server each time, so changes show up straight away."""
        parts = urlsplit(self.path)
        if parts.path.startswith("/api/"):
            return "no-store"
        if parts.path.startswith(("/assets/", "/vendor/")) and not parts.path.endswith((".json", ".css")):
            return "public, max-age=31536000, immutable" if "v=" in parts.query else "public, max-age=86400"
        return "no-cache"

    @staticmethod
    def is_public(path):
        if ".." in path or "/." in path:
            return False
        return path in PUBLIC_FILES or path.startswith(PUBLIC_DIRS)

    def list_directory(self, path):  # never show folder listings
        self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", self.cache_policy())
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
            user = self.current_user()
            if user:
                user["admin"] = admin.is_admin(user)
            return self.send_json(200, {"user": user})
        try:
            user = self.require_user()
            uid = user["id"]
            if path == "/api/events":
                return self.stream_events(uid)
            if path == "/api/export":
                return self.send_export(user)
            if path == "/api/admin/reports":
                return self.send_json(200, {"reports": admin.reports(user)})
            if path == "/api/admin/stats":
                return self.send_json(200, {"stats": admin.stats(user)})
            if path == "/api/friends":
                return self.send_json(200, social.list_friends(uid))
            if path == "/api/matches":
                return self.send_json(200, {"matches": social.list_matches(uid)})
            match = re.fullmatch(r"/api/match/([A-Za-z0-9_-]{16})(/photo)?", path)
            if match and match[2]:
                return self.send_jpeg(social.puzzle_image(uid, match[1]))
            if match:
                return self.send_json(200, {"match": social.get_match(uid, match[1])})
            if path == "/api/gallery":
                return self.send_json(200, {"puzzles": userdata.list_gallery(uid)})
            match = re.fullmatch(r"/api/gallery/(\d{1,12})/image", path)
            if match:
                return self.send_jpeg(userdata.gallery_image(uid, int(match[1])))
            if path == "/api/achievements":
                return self.send_json(200, {"achievements": userdata.list_achievements(uid)})
            if path == "/api/daily":
                return self.send_json(200, {"days": userdata.list_days(uid)})
            match = re.fullmatch(r"/api/daily/friends/(\d{4}-\d{2}-\d{2})", path)
            if match:
                return self.send_json(200, {"board": social.daily_board(uid, match[1])})
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
            "/api/daily/result": self.api_daily_result,
            "/api/progress": self.api_progress,
            "/api/progress/photo": self.api_progress_photo,
            "/api/progress/clear": self.api_progress_clear,
            "/api/reset/request": self.api_reset_request,
            "/api/reset/confirm": self.api_reset_confirm,
            "/api/email": self.api_email,
            "/api/email/resend": self.api_email_resend,
            "/api/email/confirm": self.api_email_confirm,
            "/api/username": self.api_username,
            "/api/friends/request": self.api_friend_request,
            "/api/friends/respond": self.api_friend_respond,
            "/api/friends/remove": self.api_friend_remove,
            "/api/friends/block": self.api_friend_block,
            "/api/friends/unblock": self.api_friend_unblock,
            "/api/report": self.api_report,
            "/api/admin/report": self.api_admin_report,
            "/api/match/create": self.api_match_create,
            "/api/match/respond": self.api_match_respond,
            "/api/match/leave": self.api_match_leave,
            "/api/match/begin": self.api_match_begin,
            "/api/match/finish": self.api_match_finish,
            "/api/match/ready": self.api_match_ready,
            "/api/match/event": self.api_match_event,
        }
        uploads = {"/api/gallery/add", "/api/progress/photo", "/api/progress", "/api/match/create", "/api/match/respond"}
        route = routes.get(path)
        if not route:
            return self.send_json(404, {"error": "Not found."})
        if not self.same_origin():
            return self.send_json(403, {"error": "Request refused."})
        try:
            limit = MAX_UPLOAD_BODY if path in uploads else MAX_LAYOUT_BODY if path == "/api/match/ready" else MAX_BODY
            body = self.read_json(limit)
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

    def api_daily_result(self, body):
        userdata.daily_result(self.require_user()["id"], body.get("day"), body.get("timeMs"), body.get("moves"))
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

    # Friends and games (see tools/social.py): only ever between the signed-in player and their friends.

    def api_username(self, body):
        uid = self.require_user()["id"]
        social.set_username(uid, body.get("username"))
        self.send_json(200, {"user": accounts.user(uid)})

    def api_friend_request(self, body):
        result = social.request_friend(self.require_user()["id"], body.get("username"))
        self.send_json(200, {"result": result})

    def api_friend_respond(self, body):
        social.respond_friend(self.require_user()["id"], body.get("id"), body.get("accept") is True)
        self.send_json(200, {"ok": True})

    def api_friend_remove(self, body):
        social.remove_friend(self.require_user()["id"], body.get("id"))
        self.send_json(200, {"ok": True})

    def api_friend_block(self, body):
        social.block(self.require_user()["id"], body.get("id"))
        self.send_json(200, {"ok": True})

    def api_friend_unblock(self, body):
        social.unblock(self.require_user()["id"], body.get("id"))
        self.send_json(200, {"ok": True})

    def api_report(self, body):
        social.report(self.require_user()["id"], body.get("id"), body.get("reason"), body.get("details"),
                      body.get("block") is True)
        self.send_json(200, {"ok": True})

    def api_admin_report(self, body):
        admin.act(self.require_user(), body.get("id"), body.get("action"))
        self.send_json(200, {"ok": True})

    def api_match_create(self, body):
        match_id = social.create_match(self.require_user()["id"], body, userdata.check_space)
        self.send_json(201, {"id": match_id})

    def api_match_respond(self, body):
        social.respond_match(self.require_user()["id"], body.get("id"), body.get("accept") is True,
                             body.get("puzzle"), userdata.check_space)
        self.send_json(200, {"ok": True})

    def api_match_leave(self, body):
        social.leave_match(self.require_user()["id"], body.get("id"))
        self.send_json(200, {"ok": True})

    def api_match_begin(self, body):
        self.send_json(200, social.begin(self.require_user()["id"], body.get("id")))

    def api_match_finish(self, body):
        self.send_json(200, social.finish(self.require_user()["id"], body.get("id"), body))

    def api_match_ready(self, body):
        self.send_json(200, social.ready(self.require_user()["id"], body.get("id"), body.get("layout")))

    def api_match_event(self, body):
        self.send_json(200, social.event(self.require_user()["id"], body.get("id"), body))

    def send_export(self, user):
        """Everything stored about the player, as a JSON file (the right to a copy of your data)."""
        uid = user["id"]
        data = {
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "account": {k: user.get(k) for k in ("username", "email", "email_verified", "pending_email", "created_at")},
            "gallery": userdata.list_gallery(uid),
            "achievements": userdata.list_achievements(uid),
            "dailyPuzzles": userdata.list_days(uid),
            "unfinishedPuzzle": userdata.get_progress(uid),
            "friends": social.list_friends(uid),
            "games": social.list_matches(uid),
            "note": "Your puzzle photos can be downloaded one by one from your gallery.",
        }
        body = json.dumps(data, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="puzzle-table-my-data.json"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def stream_events(self, user_id):
        """Server-sent events: friend requests, invites and live-game moves arrive here as they happen."""
        stream, first = hub.subscribe(user_id)
        if first:
            social.presence_changed(user_id)
        self.close_connection = True
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.flush()
            deadline = time.time() + STREAM_SECONDS
            while time.time() < deadline:
                try:
                    message = stream.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")  # keeps the connection (and any proxy) from timing out
                    self.wfile.flush()
                    continue
                if message is None:
                    break
                event, data = message
                self.wfile.write(f"event: {event}\ndata: {data}\n\n".encode())
                self.wfile.flush()
        except OSError:
            pass  # the tab closed
        finally:
            if hub.unsubscribe(user_id, stream):
                def gone():
                    if not hub.online(user_id):
                        social.presence_changed(user_id)
                threading.Timer(OFFLINE_GRACE, gone).start()

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
        user = self.current_user()
        accounts.sign_out(self.session_token())
        if user:
            hub.close_user(user["id"])
        self.send_json(200, {"user": None}, session="")

    def api_password(self, body):
        user = self.require_user()
        accounts.change_password(user["id"], body.get("current"), body.get("password"), self.session_token())
        self.send_json(200, {"user": user})

    def api_delete(self, body):
        user = self.require_user()
        accounts.delete_account(user["id"], body.get("password"))
        hub.close_user(user["id"])
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
        """The visitor's network address, used for rate limits and the request log."""
        if TRUST_PROXY:
            # The proxy adds the address it was connected from at the end; anything before it came
            # from the visitor and could be made up.
            forwarded = self.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
            if forwarded:
                return forwarded[:64]
        return self.client_address[0]

    def address_string(self):
        return self.address()

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
        where = "PostgreSQL" if accounts.database.postgres else accounts.database.path
        print(f"Puzzle Table: http://localhost:{PORT}  (data: {where})")
        if BUILD_LIBRARY:
            print(f"Drop photos into {build_library.SOURCE} to add them to the library.")
        server.serve_forever()
