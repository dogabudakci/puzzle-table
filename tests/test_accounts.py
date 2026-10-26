"""Accounts, saved data, email links and password reset, and the basic protections.

Run through tests/run_server_tests.py, which starts a fresh server for it."""
import base64, glob, json, os, re, sys, time, urllib.request, urllib.error, http.cookiejar
from pictures import jpeg

BASE, OUTBOX = sys.argv[1], sys.argv[2]
ok_count = 0


def client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(c, path, body=None, headers=None, origin=True):
    h = {"Content-Type": "application/json"}
    if origin:
        h["Origin"] = BASE
    h.update(headers or {})
    req = urllib.request.Request(BASE + "/api/" + path, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with c.open(req) as r:
            data = r.read()
            return r.status, (json.loads(data) if r.headers.get_content_type() == "application/json" else data), r.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), e.headers


def check(cond, what):
    global ok_count
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok_count += 1


def last_link(kind):
    for _ in range(50):
        files = sorted(glob.glob(os.path.join(OUTBOX, "*.eml")))
        for f in reversed(files):
            m = re.search(rf"#{kind}=([A-Za-z0-9_-]+)", open(f).read())
            if m and m[1] not in used:
                used.add(m[1]); return m[1]
        time.sleep(0.1)
    raise SystemExit(f"FAIL: no {kind} email")


used = set()
JPEG = jpeg(3000)
B64 = base64.b64encode(JPEG).decode()
name = f"t{int(time.time()*1000) % 10**9}"
email = f"{name}@example.com"

# health + static + caching
with urllib.request.urlopen(BASE + "/healthz") as r:
    check(r.status == 200, "healthz")
with urllib.request.urlopen(BASE + "/") as r:
    check(r.headers["Cache-Control"] == "no-cache", "static no-cache")
    check("Content-Security-Policy" in r.headers, "csp")
for bad in ("/data/puzzle.db", "/tools/serve.py", "/library/", "/.gitignore", "/render.yaml", "/requirements.txt"):
    try:
        urllib.request.urlopen(BASE + bad); check(False, f"blocked {bad}")
    except urllib.error.HTTPError as e:
        check(e.code == 404, f"blocked {bad}")

a = client()
s, d, h = call(a, "signup", {"identifier": email, "password": "correct horse battery"})
check(s == 201 and d["user"]["email"] == email and not d["user"]["email_verified"], f"signup {s} {d}")
check("password_hash" not in d["user"], "no hash leaked")
check("httponly" in h["Set-Cookie"].lower() and "samesite=strict" in h["Set-Cookie"].lower(), "cookie flags")
check(call(a, "me")[1]["user"]["id"] == d["user"]["id"], "me")
uid = d["user"]["id"]

# duplicate, csrf, json
check(call(client(), "signup", {"identifier": email, "password": "correct horse battery"})[0] == 409, "duplicate")
check(call(a, "logout", {}, origin=False)[0] == 403, "no origin refused")
check(call(a, "logout", {}, headers={"Origin": "https://evil.example"})[0] == 403, "wrong origin refused")

# confirm email
token = last_link("verify")
s, d, _ = call(a, "email/confirm", {"token": token})
check(s == 200 and d["user"]["email_verified"], f"confirm {s} {d}")
check(call(a, "email/confirm", {"token": token})[0] == 410, "token single use")

# gallery
s, d, _ = call(a, "gallery/add", {"uid": "u1", "puzzle": {"name": "Lake", "pieces": 144, "evil": "x"}, "image": B64})
check(s == 201, f"gallery add {s} {d}")
gid = d["id"]
check(call(a, "gallery/add", {"uid": "u1", "puzzle": {"name": "Lake"}, "image": B64})[1]["id"] == gid, "idempotent add")
s, d, _ = call(a, "gallery")
check(len(d["puzzles"]) == 1 and d["puzzles"][0]["name"] == "Lake" and "evil" not in d["puzzles"][0], "gallery list")
s, img, _ = call(a, f"gallery/{gid}/image")
check(s == 200 and img == JPEG, "gallery image bytes")
check(call(a, "gallery/add", {"uid": "u2", "puzzle": {}, "image": base64.b64encode(b"GIF89a....").decode()})[0] == 400, "non-jpeg refused")

# another user can't see it
b = client()
call(b, "signup", {"identifier": name + "b", "password": "another fine phrase"})
check(call(b, f"gallery/{gid}/image")[0] == 404, "isolation image")
check(call(b, "gallery")[1]["puzzles"] == [], "isolation list")
call(b, "gallery/delete", {"id": gid})
check(len(call(a, "gallery")[1]["puzzles"]) == 1, "isolation delete")

# achievements, daily
call(a, "achievements", {"achievements": [{"id": "first-frame", "earnedAt": 1761000000000}, {"id": "first-frame", "earnedAt": 1}]})
d = call(a, "achievements")[1]["achievements"]
check(d == [{"id": "first-frame", "earnedAt": 1761000000000}], f"achievements {d}")
call(a, "daily", {"days": ["2026-10-24", "2026-10-25", "2026-10-25", "bad"]})
check(call(a, "daily")[1]["days"] == ["2026-10-24", "2026-10-25"], "daily")

# progress
check(call(a, "progress")[1]["progress"] is None, "no progress")
check(call(a, "progress/full", {"photo": B64, "thumb": B64, "progress": {"savedAt": 4, "pieces": [1]}})[0] == 200, "first save: photo and layout together")
check(call(a, "progress")[1]["progress"]["pieces"] == [1], "first save stored")
# A new puzzle whose save fails half-way (a broken photo) leaves the earlier save untouched.
check(call(a, "progress/full", {"photo": "bm90IGEganBlZw==", "thumb": B64, "progress": {"savedAt": 9, "pieces": [7]}})[0] == 400, "broken new save refused")
check(call(a, "progress")[1]["progress"]["pieces"] == [1], "earlier save kept when the new one failed")
call(a, "progress", {"progress": {"savedAt": 5, "pieces": [1, 2, 3]}})
check(call(a, "progress")[1]["progress"]["pieces"] == [1, 2, 3], "progress layout")
check(call(a, "progress/thumb")[1] == JPEG, "progress thumb")
call(a, "progress/clear", {})
check(call(a, "progress")[1]["progress"] is None, "progress cleared")

# reset password
c = client()
check(call(c, "reset/request", {"email": email})[0] == 200, "reset request")
check(call(c, "reset/request", {"email": "nobody@example.com"})[0] == 200, "reset unknown same answer")
rt = last_link("reset")
check(call(c, "reset/confirm", {"token": rt, "password": "short"})[0] == 400, "weak password refused")
s, d, _ = call(c, "reset/confirm", {"token": rt, "password": "a brand new phrase here"})
check(s == 200 and d["user"]["id"] == uid, f"reset confirm {s} {d}")
check(call(a, "me")[1]["user"] is None, "old session signed out")
check(call(client(), "login", {"identifier": email, "password": "correct horse battery"})[0] == 401, "old password fails")
a = client()
check(call(a, "login", {"identifier": email.upper(), "password": "a brand new phrase here"})[0] == 200, "login new password")

# change password, email change
check(call(a, "password", {"current": "wrong one here", "password": "x" * 12})[0] == 401, "change pw needs current")
check(call(a, "password", {"current": "a brand new phrase here", "password": "yet another phrase"})[0] == 200, "change pw")
s, d, _ = call(a, "email", {"email": name + "2@example.com", "password": "yet another phrase"})
check(s == 200 and d["user"]["pending_email"] == name + "2@example.com", f"email change {s} {d}")
call(a, "email/confirm", {"token": last_link("verify")})
check(call(a, "me")[1]["user"]["email"] == name + "2@example.com", "email changed")

# rate limit: failed logins per account
r = client()
codes = [call(r, "login", {"identifier": name + "b", "password": "wrong password!"})[0] for _ in range(6)]
check(codes[:5] == [401] * 5 and codes[5] == 429, f"login rate limit {codes}")

# An expired sign-in stops working everywhere (as if 30 days had passed)
import os, sys as _sys
_sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from db import Database  # noqa: E402
x = client()
call(x, "signup", {"identifier": f"exp{name}", "password": "expiring phrase here"})
check(call(x, "me")[1]["user"] is not None, "signed in")
database = Database(os.environ.get("PUZZLE_DB"), os.environ.get("DATABASE_URL"))
with database.connect() as db:
    db.execute("UPDATE sessions SET expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)", (f"exp{name}",))
check(call(x, "me")[1]["user"] is None, "expired sign-in: signed out")
check(call(x, "progress", {"progress": {"savedAt": 1}})[0] == 401, "expired sign-in can't save")
check(call(x, "gallery")[0] == 401, "expired sign-in can't read the gallery")
try:
    x.open(urllib.request.Request(BASE + "/api/events"))
    check(False, "live updates refused after expiry")
except urllib.error.HTTPError as e:
    check(e.code == 401, "live updates refused after expiry")

# delete account removes data
check(call(a, "delete-account", {"password": "nope nope nope"})[0] == 401, "delete needs password")
check(call(a, "delete-account", {"password": "yet another phrase"})[0] == 200, "delete account")
check(call(client(), "login", {"identifier": name + "2@example.com", "password": "yet another phrase"})[0] == 401, "deleted")
print(f"all {ok_count} checks passed against {BASE}")
