"""Serves the app, its account API, and keeps the photo library up to date.

Built on Starlette (a web framework) and served by Uvicorn (a production web server). Database
work runs in a pool of worker threads; live-update connections wait on the event loop, so they
cost no thread while idle.

Every time the app asks for the library list, the `library/` folder is checked first, so a photo
dropped there shows up after a reload of the page.

Run it with:  python3 tools/serve.py        then open http://localhost:8765
(needs the packages in requirements.txt; "Start Puzzle Table.command" installs them by itself)
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
  (admins are set per account with: python3 tools/admin.py grant USERNAME)
"""

import asyncio
import base64
import email.utils
import gzip
import hashlib
import html
import json
import os
import re
import shutil
import sys
import threading
import time
from pathlib import Path
from urllib.parse import unquote

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_library  # noqa: E402
from accounts import DB_PATH, SESSION_DAYS, AccountError, Accounts  # noqa: E402
from userdata import UserData, text  # noqa: E402
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
PING_SECONDS = 15  # keeps the connection (and any proxy) from timing out
OFFLINE_GRACE = 8  # seconds before friends see someone go offline (a renewing connection isn't leaving)

# Only these are ever served; the database, tools, original photos and hidden files are not.
PUBLIC_FILES = {"/", "/index.html", "/styles.css", "/privacy.html", "/terms.html", "/manifest.webmanifest", "/admin.html",
                "/sw.js"}
PUBLIC_DIRS = ("/js/", "/assets/", "/vendor/")
# Pages with the site's details filled in ({{OPERATOR}} etc.), so they live in one place: the settings.
PAGES = {"/": "index.html", "/index.html": "index.html", "/privacy.html": "privacy.html", "/terms.html": "terms.html",
         "/admin.html": "admin.html"}
LEGAL_UPDATED = "25 October 2026"
# Set here rather than taken from the system, which differs between computers: with "nosniff"
# a wrong type would stop browsers from using the file.
TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
    ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
}
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
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script>(.*?)</script>", page, re.S)
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


def public_file(raw_path):
    """The file a request may see, or None. The address is decoded first, and the result must stay
    inside the project and be a listed file or inside a listed folder: nothing else is ever served."""
    path = unquote(raw_path)
    if "\\" in path or "\x00" in path or any(part.startswith(".") for part in path.split("/") if part):
        return None
    if path not in PUBLIC_FILES and not path.startswith(PUBLIC_DIRS):
        return None
    target = (ROOT / path.lstrip("/")).resolve()
    if path in PUBLIC_FILES and target.parent == ROOT.resolve():
        return target if target.is_file() else None
    for folder in PUBLIC_DIRS:
        if target.is_relative_to((ROOT / folder.strip("/")).resolve()):
            return target if target.is_file() else None
    return None


def cache_policy(path, query):
    """Account data is never kept. Pictures, fonts and icons are kept a day, or for good when
    their address carries a version (?v=…, which changes with the file). The pages, code and
    lists are checked with the server each time, so changes show up straight away."""
    if path.startswith("/api/"):
        return "no-store"
    if path.startswith(("/assets/", "/vendor/")) and not path.endswith((".json", ".css")):
        return "public, max-age=31536000, immutable" if "v=" in query else "public, max-age=86400"
    return "no-cache"


class SecurityHeaders:
    """Adds the security headers (and the cache rule) to every response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        policy = cache_policy(scope["path"], scope.get("query_string", b"").decode("latin-1"))

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
                headers += [
                    (b"cache-control", policy.encode()),
                    (b"content-security-policy", CSP.encode()),
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"same-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    (b"cross-origin-opener-policy", b"same-origin"),
                ]
                if SECURE_COOKIES:
                    headers.append((b"strict-transport-security", b"max-age=31536000"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


# ---------- Requests ----------

class Call:
    """What a request handler needs, read on the event loop before the handler runs in a worker thread."""

    def __init__(self, request, body):
        self.body = body
        self.token = request.cookies.get(COOKIE)
        self.address = client_address(request)

    def current_user(self):
        return accounts.session_user(self.token)

    def require_user(self):
        user = self.current_user()
        if not user:
            raise AccountError("Please sign in first.", 401, code="signInFirst")
        return user


def client_address(request):
    """The visitor's network address, used for rate limits."""
    if TRUST_PROXY:
        # The proxy adds the address it was connected from at the end; anything before it came
        # from the visitor and could be made up.
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
        if forwarded:
            return forwarded[:64]
    return request.client.host if request.client else "unknown"


def same_origin(request):
    """Refuse cross-site requests: the Origin header must match this server, and the body must be JSON."""
    origin = request.headers.get("origin")
    host = request.headers.get("host", "")
    if not origin or origin.split("://", 1)[-1] != host:
        return False
    return request.headers.get("content-type", "").split(";")[0].strip() == "application/json"


async def read_json(request, limit):
    try:
        length = int(request.headers.get("content-length") or 0)
    except ValueError:
        raise AccountError("Invalid request.", code="invalidRequest")
    if length < 0 or length > limit:
        raise AccountError("Request too large.", 413, code="requestTooLarge")
    body = b""
    async for chunk in request.stream():  # also stops a body that's longer than it said
        body += chunk
        if len(body) > limit:
            raise AccountError("Request too large.", 413, code="requestTooLarge")
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        raise AccountError("Invalid request.", code="invalidRequest")
    if not isinstance(data, dict):
        raise AccountError("Invalid request.", code="invalidRequest")
    return data


def json_response(status, data, session=None):
    response = JSONResponse(data, status_code=status)
    if session is not None:
        # HttpOnly: page scripts can't read it. SameSite=Strict: other sites can't send it.
        response.set_cookie(COOKIE, session, max_age=SESSION_DAYS * 86400 if session else 0, path="/",
                            httponly=True, samesite="strict", secure=SECURE_COOKIES)
    return response


def jpeg_response(data):
    if data is None:
        return json_response(404, {"error": "Not found."})
    return Response(data, media_type="image/jpeg")


def api(handler, method="POST", limit=MAX_BODY):
    """An API endpoint: checks (for POST), runs `handler(call, **path_params)` in a worker thread,
    and turns account errors into friendly JSON. Details of other errors never reach the browser."""
    async def endpoint(request):
        try:
            if method == "POST":
                if not same_origin(request):
                    return json_response(403, {"error": "Request refused.", "code": "refused"})
                body = await read_json(request, limit)
            else:
                body = {}
            call = Call(request, body)
            result = await run_in_threadpool(handler, call, **request.path_params)
            return result if isinstance(result, Response) else json_response(200, result)
        except AccountError as err:
            return json_response(err.status, {"error": str(err), "code": err.code, "values": err.values})
        except Exception as err:  # never leak details to the browser
            print(f"api error on {request.url.path}: {err!r}", flush=True)
            return json_response(500, {"error": "Something went wrong. Please try again.", "code": "somethingWrong"})
    return endpoint


# ---------- Accounts ----------

def me(call):
    user = call.current_user()
    if user:
        user["admin"] = admin.is_admin(user)
    return {"user": user}


def signup(call):
    token, user = accounts.sign_up(call.body.get("identifier"), call.body.get("password"), call.address)
    if user["email"]:
        try:
            recovery.send_verification(user["id"], user["email"], call.address)
        except AccountError:
            pass  # rate-limited: they can resend from their account
    return json_response(201, {"user": user}, session=token)


def login(call):
    token, user = accounts.sign_in(call.body.get("identifier"), call.body.get("password"), call.address)
    return json_response(200, {"user": user}, session=token)


def logout(call):
    user = call.current_user()
    accounts.sign_out(call.token)
    if user:
        hub.close_user(user["id"])
    return json_response(200, {"user": None}, session="")


def change_password(call):
    user = call.require_user()
    accounts.change_password(user["id"], call.body.get("current"), call.body.get("password"), call.token)
    return {"user": user}


def delete_account(call):
    user = call.require_user()
    accounts.delete_account(user["id"], call.body.get("password"))
    hub.close_user(user["id"])
    return json_response(200, {"user": None}, session="")


# Email confirmation and password reset (see tools/recovery.py)

def reset_request(call):
    recovery.request_reset(call.body.get("email"), call.address)
    return {"ok": True}


def reset_confirm(call):
    token = recovery.reset_password(call.body.get("token"), call.body.get("password"))
    return json_response(200, {"user": accounts.session_user(token)}, session=token)


def set_email(call):
    user = call.require_user()
    recovery.set_email(user["id"], call.body.get("email"), call.body.get("password"), call.address)
    return {"user": accounts.user(user["id"])}


def resend_email(call):
    recovery.resend_verification(call.require_user()["id"], call.address)
    return {"ok": True}


def confirm_email(call):
    user_id = recovery.confirm_email(call.body.get("token"))
    current = call.current_user()
    # Only hand back account details to the account itself (the link may be opened elsewhere).
    return {"user": accounts.user(user_id) if current and current["id"] == user_id else None}


def export(call):
    """Everything stored about the player, as a JSON file (the right to a copy of your data)."""
    user = call.require_user()
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
    return Response(json.dumps(data, indent=2), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="puzzle-table-my-data.json"'})


# ---------- Saved data: each handler only ever touches the signed-in player's own rows ----------

def uid(call):
    return call.require_user()["id"]


ROUTES_SAVED = [
    Route("/api/gallery", api(lambda c: {"puzzles": userdata.list_gallery(uid(c))}, "GET"), methods=["GET"]),
    Route("/api/gallery/{item:int}/image", api(lambda c, item: jpeg_response(userdata.gallery_image(uid(c), item)), "GET"),
          methods=["GET"]),
    Route("/api/gallery/add", api(lambda c: json_response(201, {"id": userdata.add_gallery(uid(c), c.body)}),
                                  limit=MAX_UPLOAD_BODY), methods=["POST"]),
    Route("/api/gallery/delete", api(lambda c: userdata.delete_gallery(uid(c), c.body.get("id")) or {"ok": True}),
          methods=["POST"]),
    Route("/api/achievements", api(lambda c: {"achievements": userdata.list_achievements(uid(c))}, "GET"), methods=["GET"]),
    Route("/api/achievements", api(lambda c: userdata.add_achievements(uid(c), c.body.get("achievements")) or {"ok": True}),
          methods=["POST"]),
    Route("/api/daily", api(lambda c: {"days": userdata.list_days(uid(c))}, "GET"), methods=["GET"]),
    Route("/api/daily", api(lambda c: userdata.add_days(uid(c), c.body.get("days")) or {"ok": True}), methods=["POST"]),
    Route("/api/daily/result", api(lambda c: userdata.daily_result(
        uid(c), c.body.get("day"), c.body.get("timeMs"), c.body.get("moves")) or {"ok": True}), methods=["POST"]),
    Route("/api/daily/friends/{day}", api(lambda c, day: {"board": social.daily_board(uid(c), day)}
                                          if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) else {"board": []}, "GET"),
          methods=["GET"]),
    Route("/api/progress", api(lambda c: {"progress": userdata.get_progress(uid(c))}, "GET"), methods=["GET"]),
    Route("/api/progress", api(lambda c: userdata.save_progress(uid(c), c.body.get("progress")) or {"ok": True},
                               limit=MAX_UPLOAD_BODY), methods=["POST"]),
    Route("/api/progress/photo", api(lambda c: jpeg_response(userdata.progress_image(uid(c), "photo")), "GET"),
          methods=["GET"]),
    Route("/api/progress/thumb", api(lambda c: jpeg_response(userdata.progress_image(uid(c), "thumb")), "GET"),
          methods=["GET"]),
    Route("/api/progress/full", api(lambda c: userdata.save_progress_full(uid(c), c.body) or {"ok": True},
                                    limit=MAX_UPLOAD_BODY), methods=["POST"]),
    Route("/api/progress/clear", api(lambda c: userdata.clear_progress(uid(c), text(c.body.get("gameId"), 80, None))
                                     or {"ok": True}), methods=["POST"]),
]


# ---------- Friends and games (see tools/social.py) ----------

def set_username(call):
    user_id = uid(call)
    social.set_username(user_id, call.body.get("username"))
    return {"user": accounts.user(user_id)}


def get_match(call, match_id):
    return {"match": social.get_match(uid(call), match_id)}


ROUTES_SOCIAL = [
    Route("/api/username", api(set_username), methods=["POST"]),
    Route("/api/friends", api(lambda c: social.list_friends(uid(c)), "GET"), methods=["GET"]),
    Route("/api/friends/request", api(lambda c: {"result": social.request_friend(uid(c), c.body.get("username"))}),
          methods=["POST"]),
    Route("/api/friends/respond", api(lambda c: social.respond_friend(uid(c), c.body.get("id"),
                                                                      c.body.get("accept") is True) or {"ok": True}),
          methods=["POST"]),
    Route("/api/friends/remove", api(lambda c: social.remove_friend(uid(c), c.body.get("id")) or {"ok": True}),
          methods=["POST"]),
    Route("/api/friends/block", api(lambda c: social.block(uid(c), c.body.get("id")) or {"ok": True}), methods=["POST"]),
    Route("/api/friends/unblock", api(lambda c: social.unblock(uid(c), c.body.get("id")) or {"ok": True}),
          methods=["POST"]),
    Route("/api/report", api(lambda c: social.report(uid(c), c.body.get("id"), c.body.get("reason"), c.body.get("details"),
                                                     c.body.get("block") is True) or {"ok": True}), methods=["POST"]),
    Route("/api/matches", api(lambda c: {"matches": social.list_matches(uid(c))}, "GET"), methods=["GET"]),
    Route("/api/match/{match_id:str}", api(get_match, "GET"), methods=["GET"]),
    Route("/api/match/{match_id:str}/photo", api(lambda c, match_id: jpeg_response(social.puzzle_image(uid(c), match_id)),
                                                 "GET"), methods=["GET"]),
    Route("/api/match/create", api(lambda c: json_response(201, {"id": social.create_match(uid(c), c.body,
                                                                                           userdata.check_space)}),
                                   limit=MAX_UPLOAD_BODY), methods=["POST"]),
    Route("/api/match/respond", api(lambda c: social.respond_match(uid(c), c.body.get("id"), c.body.get("accept") is True,
                                                                   c.body.get("puzzle"), userdata.check_space)
                                    or {"ok": True}, limit=MAX_UPLOAD_BODY), methods=["POST"]),
    Route("/api/match/leave", api(lambda c: social.leave_match(uid(c), c.body.get("id")) or {"ok": True}),
          methods=["POST"]),
    Route("/api/match/begin", api(lambda c: social.begin(uid(c), c.body.get("id"))), methods=["POST"]),
    Route("/api/match/finish", api(lambda c: social.finish(uid(c), c.body.get("id"), c.body)), methods=["POST"]),
    Route("/api/match/join", api(lambda c: social.join(uid(c), c.body.get("id"), c.body.get("pieces"))),
          methods=["POST"]),
    Route("/api/match/ready", api(lambda c: social.ready(uid(c), c.body.get("id"), c.body.get("layout")),
                                  limit=MAX_LAYOUT_BODY), methods=["POST"]),
    Route("/api/match/event", api(lambda c: social.event(uid(c), c.body.get("id"), c.body)), methods=["POST"]),
    Route("/api/admin/reports", api(lambda c: {"reports": admin.reports(c.require_user())}, "GET"), methods=["GET"]),
    Route("/api/admin/stats", api(lambda c: {"stats": admin.stats(c.require_user())}, "GET"), methods=["GET"]),
    Route("/api/admin/report", api(lambda c: admin.act(c.require_user(), c.body.get("id"), c.body.get("action"))
                                   or {"ok": True}), methods=["POST"]),
]


async def events(request):
    """Server-sent events: friend requests, invites and live-game moves arrive here as they happen."""
    user = await run_in_threadpool(accounts.session_user, request.cookies.get(COOKIE))
    if not user:
        return json_response(401, {"error": "Please sign in first.", "code": "signInFirst"})
    user_id = user["id"]
    stream, first = hub.subscribe(user_id)
    if first:
        await run_in_threadpool(social.presence_changed, user_id)

    async def messages():
        try:
            yield b"retry: 3000\n\n"
            deadline = time.monotonic() + STREAM_SECONDS
            while time.monotonic() < deadline:
                try:
                    message = await stream.get(PING_SECONDS)
                except asyncio.TimeoutError:
                    yield b": ping\n\n"
                    continue
                if message is None:
                    break
                event, data = message
                yield f"event: {event}\ndata: {data}\n\n".encode()
        finally:
            if hub.unsubscribe(user_id, stream):
                loop = asyncio.get_running_loop()

                def gone():
                    if not hub.online(user_id):
                        loop.run_in_executor(None, social.presence_changed, user_id)
                loop.call_later(OFFLINE_GRACE, gone)

    return StreamingResponse(messages(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


# ---------- Files ----------

def http_date(timestamp):
    return email.utils.formatdate(timestamp, usegmt=True)


def page_response(request, name):
    text = (ROOT / name).read_text(encoding="utf-8")
    for key, value in SITE.items():
        text = text.replace("{{" + key + "}}", html.escape(value))
    return text_response(request, text.encode(), TYPES[".html"])


def text_response(request, body, media_type, modified=None):
    headers = {"Vary": "Accept-Encoding"}
    if modified:
        headers["Last-Modified"] = modified
    if "gzip" in request.headers.get("accept-encoding", ""):
        body = gzip.compress(body, compresslevel=6) if not isinstance(body, CompressedBody) else body.data
        headers["Content-Encoding"] = "gzip"
    elif isinstance(body, CompressedBody):
        body = body.plain
    return Response(b"" if request.method == "HEAD" else body, media_type=media_type, headers=headers)


class CompressedBody:
    def __init__(self, plain, data):
        self.plain = plain
        self.data = data


def static(request):
    path = request.url.path
    if path in PAGES:
        return page_response(request, PAGES[path])
    file = public_file(path)
    if file is None:
        return Response("Not found", status_code=404, media_type="text/plain")
    if path == LIBRARY_LIST and BUILD_LIBRARY:
        with build_lock:
            try:
                build_library.build(verbose=True)
            except Exception as err:  # still serve the last good list
                print(f"library update failed: {err}", flush=True)
    stat = file.stat()
    modified = http_date(stat.st_mtime)
    if request.headers.get("if-modified-since") == modified:
        return Response(status_code=304)
    media_type = TYPES.get(file.suffix, "application/octet-stream")
    if file.suffix in COMPRESSIBLE:
        key = (str(file), stat.st_mtime)
        cached = compressed_cache.get(key)
        if cached is None:
            plain = file.read_bytes()
            cached = CompressedBody(plain, gzip.compress(plain, compresslevel=6))
            if len(compressed_cache) > 200:  # files changed many times while developing
                compressed_cache.clear()
            compressed_cache[key] = cached
        return text_response(request, cached, media_type, modified)
    return FileResponse(file, media_type=media_type, stat_result=stat, headers={"Last-Modified": modified})


async def static_endpoint(request):
    return await run_in_threadpool(static, request)


async def health(request):
    return JSONResponse({"ok": True})


ROUTES = [
    Route(HEALTH_CHECK, health, methods=["GET", "HEAD"]),
    Route("/api/events", events, methods=["GET"]),
    Route("/api/me", api(me, "GET"), methods=["GET"]),
    Route("/api/export", api(export, "GET"), methods=["GET"]),
    Route("/api/signup", api(signup), methods=["POST"]),
    Route("/api/login", api(login), methods=["POST"]),
    Route("/api/logout", api(logout), methods=["POST"]),
    Route("/api/password", api(change_password), methods=["POST"]),
    Route("/api/delete-account", api(delete_account), methods=["POST"]),
    Route("/api/reset/request", api(reset_request), methods=["POST"]),
    Route("/api/reset/confirm", api(reset_confirm), methods=["POST"]),
    Route("/api/email", api(set_email), methods=["POST"]),
    Route("/api/email/resend", api(resend_email), methods=["POST"]),
    Route("/api/email/confirm", api(confirm_email), methods=["POST"]),
    *ROUTES_SAVED,
    *ROUTES_SOCIAL,
    Route("/api/{rest:path}", lambda request: json_response(404, {"error": "Not found."}), methods=["GET", "POST"]),
    Route("/{path:path}", static_endpoint, methods=["GET", "HEAD"]),
]

app = SecurityHeaders(Starlette(routes=ROUTES))


if __name__ == "__main__":
    import uvicorn

    where = "PostgreSQL" if accounts.database.postgres else accounts.database.path
    print(f"Puzzle Table: http://localhost:{PORT}  (data: {where})", flush=True)
    if BUILD_LIBRARY:
        print(f"Drop photos into {build_library.SOURCE} to add them to the library.", flush=True)
    uvicorn.run(
        app, host=HOST, port=PORT,
        proxy_headers=False,  # the visitor's address is read carefully in client_address() instead
        server_header=False,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=5,
        log_level="info",
    )
