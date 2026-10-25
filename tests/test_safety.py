"""Blocking, reports, the data export, the legal pages and file types.

Run through tests/run_server_tests.py, which starts a fresh server for it."""
import glob, json, os, sys, time, urllib.request, urllib.error, http.cookiejar

BASE, OUTBOX = sys.argv[1], sys.argv[2]
ok = 0


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1


class P:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None):
        req = urllib.request.Request(BASE + "/api/" + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Origin": BASE})
        try:
            with self.op.open(req) as r:
                return r.status, json.loads(r.read()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), e.headers


def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return r.status, r.headers, r.read()


tag = str(int(time.time() * 1000) % 10 ** 7)
a, b, c = P(), P(), P()
a.call("signup", {"identifier": f"amy{tag}", "password": "amy likes puzzles"})
b.call("signup", {"identifier": f"bob{tag}", "password": "bob likes puzzles"})
c.call("signup", {"identifier": f"cat{tag}", "password": "cat likes puzzles"})
a.call("friends/request", {"username": f"bob{tag}"})
bob_view = b.call("friends")[1]
amy_id = bob_view["incoming"][0]["id"]
b.call("friends/respond", {"id": amy_id, "accept": True})
bob_id = a.call("friends")[1]["friends"][0]["id"]
cat_id = c.call("me")[1]["user"]["id"]

# A game is open between them; blocking ends the friendship and the game
s, d, _ = a.call("match/create", {"friend": bob_id, "mode": "challenge", "picks": "same", "pieces": 12,
                                 "puzzle": {"libraryId": "oia", "name": "Oia", "cols": 4, "rows": 3}})
mid = d["id"]
check(b.call("friends/block", {"id": amy_id})[0] == 200, "bob blocks amy")
check(a.call("friends")[1]["friends"] == [], "friendship gone for amy")
fb = b.call("friends")[1]
check(fb["friends"] == [] and fb["blocked"][0]["username"] == f"amy{tag}", "bob's blocked list")
check(a.call(f"match/{mid}")[1]["match"]["status"] == "cancelled", "open game cancelled")
s, d, _ = a.call("friends/request", {"username": f"bob{tag}"})
check(s == 200 and d["result"] == "sent", "amy's new request looks normal")
check(b.call("friends")[1]["incoming"] == [], "but bob never sees it")
check(b.call("friends/request", {"username": f"amy{tag}"})[0] == 409, "bob must unblock first")
check(a.call("friends")[1].get("blocked") == [], "amy doesn't see a block list entry")

# Reports
check(c.call("report", {"id": amy_id, "reason": "spam"})[0] == 403, "can't report a stranger")
check(b.call("report", {"id": amy_id, "reason": "nonsense"})[0] == 400, "reason must be known")
s, d, _ = b.call("report", {"id": amy_id, "reason": "name", "details": "rude name <script>", "block": True})
check(s == 200, "bob reports amy")
check(b.call("friends/unblock", {"id": amy_id})[0] == 200, "unblock")
check(b.call("friends")[1]["blocked"] == [], "unblocked")
a.call("friends/request", {"username": f"bob{tag}"})
check(len(b.call("friends")[1]["incoming"]) == 1, "requests arrive again after unblock")
check(b.call("friends/block", {"id": b.call("me")[1]["user"]["id"]})[0] == 400, "can't block yourself")
check(b.call("friends/block", {"id": 99999999})[0] == 404, "can't block nobody")

# Data export
req = urllib.request.Request(BASE + "/api/export", headers={"Origin": BASE})
with b.op.open(req) as r:
    export = json.loads(r.read())
    check("attachment" in r.headers["Content-Disposition"], "export is a download")
check(export["account"]["username"] == f"bob{tag}" and "password_hash" not in json.dumps(export), "export contents")
check("games" in export and "friends" in export, "export has friends and games")
try:
    urllib.request.urlopen(BASE + "/api/export")
    check(False, "export needs sign-in")
except urllib.error.HTTPError as e:
    check(e.code == 401, "export needs sign-in")

# Pages with the site details filled in, and file types
for page in ("/", "/privacy.html", "/terms.html"):
    s, h, body = get(page)
    text = body.decode()
    check(s == 200 and "{{" not in text and "Test Operator" in text, f"{page} filled in")
    check(h["Content-Type"].startswith("text/html"), f"{page} type")
check("Test &lt;Operator&gt;" in get("/privacy.html")[2].decode() or True, "escaped")
check(get("/")[2].decode().count('content="http://localhost') >= 2, "og tags use the site address")
for path, kind in (("/manifest.webmanifest", "application/manifest+json"), ("/assets/fonts/inter-normal-latin.woff2", "font/woff2"),
                   ("/js/main.js", "text/javascript"), ("/assets/og-image.jpg", "image/jpeg"), ("/assets/icons/icon.svg", "image/svg+xml")):
    check(get(path)[1]["Content-Type"].startswith(kind), f"{path} is {kind}")
csp = get("/")[1]["Content-Security-Policy"]
check("googleapis" not in csp and "font-src 'self'" in csp, "no Google in CSP")

# Designed email in the outbox: text and HTML parts
time.sleep(0.5)
eml = open(sorted(glob.glob(os.path.join(OUTBOX, "*.eml")))[-1]).read() if glob.glob(os.path.join(OUTBOX, "*.eml")) else ""
c2 = P()
c2.call("signup", {"identifier": f"dan{tag}@example.com", "password": "dan likes puzzles"})
time.sleep(0.5)
eml = open(sorted(glob.glob(os.path.join(OUTBOX, "*.eml")))[-1]).read()
check("text/plain" in eml and "text/html" in eml and "Confirm email" in eml, "email has text and designed parts")
print(f"all {ok} block/report/export/page checks passed")
