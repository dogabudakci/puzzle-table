"""The second review's findings, each tried for real: old reset links, password guessing, storage
used by game photos, a whole puzzle claimed in one move, saves from an older tab, and pictures
that only start like a JPEG.

Run through tests/run_server_tests.py, which starts a fresh server for it."""
import base64, glob, json, os, re, sys, time, urllib.request, urllib.error, http.cookiejar
from pictures import jpeg

BASE, OUTBOX = sys.argv[1], sys.argv[2]
ok = 0
used = set()


class Player:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None):
        h = {"Content-Type": "application/json", "Origin": BASE}
        req = urllib.request.Request(BASE + "/api/" + path, data=None if body is None else json.dumps(body).encode(), headers=h)
        try:
            with self.op.open(req) as r:
                d = r.read()
                return r.status, (json.loads(d) if r.headers.get_content_type() == "application/json" else d)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1


def last_link(kind):
    for _ in range(50):
        for f in reversed(sorted(glob.glob(os.path.join(OUTBOX, "*.eml")))):
            m = re.search(rf"#{kind}=([A-Za-z0-9_-]+)", open(f).read())
            if m and m[1] not in used:
                used.add(m[1])
                return m[1]
        time.sleep(0.1)
    raise SystemExit(f"FAIL: no {kind} email")


tag = str(int(time.time() * 1000) % 10 ** 8)
PW = "a long enough phrase"

# ---------- Reset links stop working once the password or email changes ----------
a = Player()
email = f"rita{tag}@example.com"
check(a.call("signup", {"identifier": email, "password": PW})[0] == 201, "sign up")
a.call("email/confirm", {"token": last_link("verify")})

a.call("reset/request", {"email": email})
old_link = last_link("reset")
check(a.call("password", {"current": PW, "password": "another long phrase"})[0] == 200, "password changed")
check(a.call("reset/confirm", {"token": old_link, "password": "the attacker's phrase"})[0] == 410,
      "a reset link from before a password change doesn't work")

a.call("reset/request", {"email": email})
old_link = last_link("reset")
check(a.call("email", {"email": f"rita{tag}b@example.com", "password": "another long phrase"})[0] == 200, "email change asked")
a.call("email/confirm", {"token": last_link("verify")})
check(a.call("me")[1]["user"]["email"] == f"rita{tag}b@example.com", "email changed")
check(a.call("reset/confirm", {"token": old_link, "password": "the attacker's phrase"})[0] == 410,
      "a reset link sent to the old email doesn't work")

# An email change waiting to be confirmed is cancelled by a password change (someone else may have asked for it).
a.call("email", {"email": f"intruder{tag}@example.com", "password": "another long phrase"})
waiting = last_link("verify")
check(a.call("password", {"current": "another long phrase", "password": "a third long phrase"})[0] == 200, "password changed again")
check(a.call("email/confirm", {"token": waiting})[0] == 410, "a waiting email change is cancelled by a password change")
check(a.call("me")[1]["user"]["email"] == f"rita{tag}b@example.com", "and the email stays the owner's")

# ---------- Guessing the password from a signed-in session is limited ----------
codes = [a.call("password", {"current": f"wrong guess {i}!", "password": "whatever phrase"})[0] for i in range(6)]
check(codes[:5] == [401] * 5 and codes[5] == 429, f"password guesses are limited {codes}")
check(a.call("delete-account", {"password": "a third long phrase"})[0] == 429, "for deleting the account too")

# ---------- Pictures ----------
b = Player()
check(b.call("signup", {"identifier": f"bo{tag}", "password": PW})[0] == 201, "sign up bo")
fake = base64.b64encode(b"\xff\xd8\xff\xe0" + os.urandom(3000)).decode()
check(b.call("gallery/add", {"uid": "g1", "puzzle": {}, "image": fake})[1].get("code") == "fileNotJpeg",
      "a file that only starts like a JPEG is refused")
huge = jpeg(100, width=30000, height=20)
check(b.call("gallery/add", {"uid": "g2", "puzzle": {}, "image": base64.b64encode(huge).decode()})[0] == 400,
      "a picture claiming an absurd size is refused")
check(b.call("gallery/add", {"uid": "g3", "puzzle": {}, "image": base64.b64encode(jpeg(2000)).decode()})[0] == 201,
      "a real JPEG is fine")

# ---------- Saves from an older tab ----------
photo = base64.b64encode(jpeg(4000)).decode()
check(b.call("progress/full", {"photo": photo, "thumb": photo, "progress": {"gameId": "new", "layout": []}})[0] == 200, "new puzzle saved")
s, d = b.call("progress", {"progress": {"gameId": "old", "layout": [1]}})
check(s == 409 and d["code"] == "saveReplaced", "an older puzzle's layout can't overwrite the newer one")
check(b.call("progress")[1]["progress"]["gameId"] == "new", "the newer one is untouched")
check(b.call("progress", {"progress": {"gameId": "new", "layout": [2]}})[0] == 200, "its own saves still work")
b.call("progress/clear", {"gameId": "old"})
check(b.call("progress")[1]["progress"] is not None, "finishing the old puzzle doesn't remove the newer one")
b.call("progress/clear", {"gameId": "new"})
check(b.call("progress")[1]["progress"] is None, "finishing the newer one does")
check(b.call("progress", {"progress": {"gameId": "new", "layout": [3]}})[0] == 409, "and no layout comes back without its photo")

# ---------- Game photos count towards the sender's storage ----------
c = Player()
check(c.call("signup", {"identifier": f"cy{tag}", "password": PW})[0] == 201, "sign up cy")
b.call("friends/request", {"username": f"cy{tag}"})
c.call("friends/respond", {"id": c.call("friends")[1]["incoming"][0]["id"], "accept": True})
cy_id = b.call("friends")[1]["friends"][0]["id"]
bo_id = c.call("friends")[1]["friends"][0]["id"]
big = base64.b64encode(jpeg(2 * 1024 * 1024 - 1000)).decode()
codes = [b.call("match/create", {"friend": cy_id, "mode": "race", "picks": "same", "pieces": 12,
                                 "puzzle": {"image": big, "name": "Big", "cols": 4, "rows": 3}})[0] for _ in range(7)]
check(201 in codes and codes[-1] == 409, f"invites with photos stop at the storage limit {codes}")

# ---------- A whole puzzle claimed in one move doesn't count ----------
lib = {"libraryId": "lake-pier", "name": "Lake pier", "cols": 4, "rows": 3}
s, d = c.call("match/create", {"friend": bo_id, "mode": "race", "picks": "same", "pieces": 12, "puzzle": lib})
rid = d["id"]
b.call("match/respond", {"id": rid, "accept": True})
c.call("match/ready", {"id": rid})
st = b.call("match/ready", {"id": rid})[1]
time.sleep((st["startAt"] - st["now"]) / 1000 + 0.1)
s, d = c.call("match/join", {"id": rid, "pieces": list(range(12))})
check(s == 400 and d["code"] == "invalidMove", "the whole puzzle in one join is refused")
check(c.call("match/join", {"id": rid, "pieces": [0, 1]})[0] == 200, "a real join is fine")
time.sleep(0.12)
check(c.call("match/join", {"id": rid, "pieces": [0, 1, 2, 3, 5, 6, 7, 10, 11]})[0] == 400, "so is claiming many loose pieces at once")
time.sleep(0.12)
check(c.call("match/join", {"id": rid, "pieces": [0, 1, 4, 5]})[0] == 200, "a drop touching a few groups is fine")

print(f"all {ok} integrity checks passed")
