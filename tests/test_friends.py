"""Friends, invites, and the three ways to play together (live events included).

Run through tests/run_server_tests.py, which starts a fresh server for it."""
import base64, json, os, queue, sys, threading, time, urllib.request, urllib.error, http.cookiejar
from pictures import jpeg

BASE = sys.argv[1]
ok = 0


class Player:
    def __init__(self, name):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.name = name
        self.events = queue.Queue()

    def call(self, path, body=None):
        h = {"Content-Type": "application/json", "Origin": BASE}
        req = urllib.request.Request(BASE + "/api/" + path, data=None if body is None else json.dumps(body).encode(), headers=h)
        try:
            with self.op.open(req) as r:
                d = r.read()
                return r.status, (json.loads(d) if r.headers.get_content_type() == "application/json" else d)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def listen(self):
        def run():
            with self.op.open(BASE + "/api/events") as r:
                event = None
                for raw in r:
                    line = raw.decode().rstrip("\n")
                    if line.startswith("event: "):
                        event = line[7:]
                    elif line.startswith("data: "):
                        self.events.put((event, json.loads(line[6:])))
        threading.Thread(target=run, daemon=True).start()
        time.sleep(0.3)

    def wait(self, event, pred=lambda d: True, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            try:
                e, d = self.events.get(timeout=end - time.time())
            except queue.Empty:
                break
            if e == event and pred(d):
                return d
        raise SystemExit(f"FAIL: {self.name} never got {event}")


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1


def solve(player, mid, count, started_at=None):
    """Joins every piece, one neighbour at a time (row by row), as the app reports them, and waits
    until a person could have done it (400 ms per piece)."""
    for k in range(1, count):
        r = player.call("match/join", {"id": mid, "pieces": list(range(k + 1))})
        assert r[0] == 200, r
        time.sleep(0.11)
    if started_at:
        time.sleep(max(0, started_at + count * 0.4 + 0.2 - time.time()))
    return r[1]


tag = str(int(time.time() * 1000) % 10 ** 8)
ann, ben, eve = Player("ann"), Player("ben"), Player("eve")
check(ann.call("signup", {"identifier": f"ann{tag}", "password": "ann plays puzzles"})[0] == 201, "signup ann")
check(ben.call("signup", {"identifier": f"ben{tag}@example.com", "password": "ben plays puzzles"})[0] == 201, "signup ben (email)")
check(eve.call("signup", {"identifier": f"eve{tag}", "password": "eve plays puzzles"})[0] == 201, "signup eve")

# ben has no username yet: can't send requests, can't be found
check(ben.call("friends/request", {"username": f"ann{tag}"})[0] == 400, "needs username")
check(ann.call("friends/request", {"username": f"ben{tag}"})[0] == 404, "unknown username")
s, d = ben.call("username", {"username": f"ben{tag}"})
check(s == 200 and d["user"]["username"] == f"ben{tag}", "set username")
check(ben.call("username", {"username": f"bennn{tag}"})[0] == 400, "username only once")
check(eve.call("username", {"username": f"ben{tag}"})[0] in (400, 409), "username taken")

ann.listen(); ben.listen(); eve.listen()
check(ann.call("friends/request", {"username": f"@BEN{tag}"})[1]["result"] == "sent", "request sent")
ben.wait("friends")
d = ben.call("friends")[1]
check(d["incoming"][0]["username"] == f"ann{tag}" and "email" not in json.dumps(d), "incoming, no emails")
check(ben.call("friends/respond", {"id": d["incoming"][0]["id"], "accept": True})[0] == 200, "accept")
ann.wait("friends")
d = ann.call("friends")[1]
check(d["friends"][0]["username"] == f"ben{tag}" and d["friends"][0]["online"], "friends + online")
ann_id = ben.call("friends")[1]["friends"][0]["id"]
ben_id = d["friends"][0]["id"]
eve_id = eve.call("me")[1]["user"]["id"]

# not friends: no invites
lib = {"libraryId": "lake-pier", "name": "Lake pier", "cols": 4, "rows": 3}
check(ann.call("match/create", {"friend": eve_id, "mode": "race", "picks": "same", "pieces": 12, "puzzle": lib})[0] == 403, "invite non-friend")
check(ann.call("match/create", {"friend": ben_id, "mode": "race", "picks": "same", "pieces": 12,
                               "puzzle": {**lib, "libraryId": "../../tools/serve"}})[0] == 400, "bad library id")
check(ann.call("match/create", {"friend": ben_id, "mode": "race", "picks": "same", "pieces": 12,
                               "puzzle": {**lib, "cols": 40, "rows": 40}})[0] == 400, "bad grid")

# ---- together ----
s, d = ann.call("match/create", {"friend": ben_id, "mode": "together", "picks": "swap", "pieces": 12, "puzzle": lib})
check(s == 201, f"create together {s} {d}")
mid = d["id"]
ben.wait("matches", lambda d: d.get("invite") == mid)
check(eve.call(f"match/{mid}")[0] == 404, "outsider can't see match")
check(eve.call("match/respond", {"id": mid, "accept": True})[0] == 404, "outsider can't accept")
check(ann.call("match/respond", {"id": mid, "accept": True})[0] == 409, "host can't accept own")
m = ben.call("matches")[1]["matches"][0]
check(m["mode"] == "together" and m["picks"] == "same" and m["role"] == "guest", "list matches")
check(ben.call("match/respond", {"id": mid, "accept": True})[0] == 200, "accept together")
ann.wait("matches", lambda d: d.get("accepted") == mid)
pa = ann.call(f"match/{mid}")[1]["match"]["puzzle"]
pb = ben.call(f"match/{mid}")[1]["match"]["puzzle"]
check(pa == pb and pa["cols"] == 4 and pa["libraryId"] == "lake-pier", "same puzzle + seed")
layout = [{"pieces": [i], "nx": 1.2 + i * 0.01, "ny": -0.3} for i in range(12)]
check(ann.call("match/event", {"id": mid, "type": "grab", "pieces": [0]})[0] == 409, "no moves before start")
s, st = ann.call("match/ready", {"id": mid, "layout": layout})
check(s == 200 and st["startAt"] is None and st["layout"], "ann ready")
s, st = ben.call("match/ready", {"id": mid, "layout": [{"pieces": [i], "nx": 0, "ny": 0} for i in range(12)]})
check(st["startAt"] and st["layout"][0]["nx"] == 1.2, "start + first layout wins")
start = ann.wait("game", lambda d: d["type"] == "start")
check(start["layout"][3]["nx"] == 1.23, "start event to ann")
time.sleep((st["startAt"] - st["now"]) / 1000 + 0.1)

check(ann.call("match/event", {"id": mid, "type": "grab", "pieces": [0]})[1]["ok"], "ann grabs 0")
check(ben.wait("game", lambda d: d["type"] == "grab")["pieces"] == [0], "ben sees grab")
r = ben.call("match/event", {"id": mid, "type": "grab", "pieces": [0]})[1]
check(not r["ok"] and r["held"] == [0], "ben can't grab held piece")
ann.call("match/event", {"id": mid, "type": "move", "piece": 0, "nx": 0.5, "ny": 0.5})
check(ben.wait("game", lambda d: d["type"] == "move")["nx"] == 0.5, "ben sees move")
check(ben.call("match/event", {"id": mid, "type": "move", "piece": 0, "nx": 9, "ny": 0})[1]["ok"] is False, "move without lock ignored")
check(ann.call("match/event", {"id": mid, "type": "drop", "pieces": [0, 1], "nx": 0, "ny": 0})[1]["ok"], "ann joins 0+1")
check(ben.wait("game", lambda d: d["type"] == "drop")["pieces"] == [0, 1], "ben sees join")
# ben tries to join with a group that doesn't exist as he claims (stale table): resync
ben.call("match/event", {"id": mid, "type": "grab", "pieces": [2]})
r = ben.call("match/event", {"id": mid, "type": "drop", "pieces": [1, 2], "nx": 0, "ny": 0})[1]
check(not r["ok"] and r["resync"] and len(r["layout"]) == 11, "partial group refused, resync")
check(ben.call("match/event", {"id": mid, "type": "grab", "pieces": [99]})[0] == 400, "bad piece index")
check(ben.call("match/event", {"id": mid, "type": "move", "piece": [1], "nx": 0, "ny": 0})[0] in (200,), "list piece harmless")
check(ben.call("match/event", {"id": mid, "type": "drop", "pieces": [2], "nx": float("1e309") if False else 1e9, "ny": 0})[0] == 400, "huge position refused")
ben.call("match/event", {"id": mid, "type": "grab", "pieces": [7]})
r = ben.call("match/event", {"id": mid, "type": "drop", "pieces": [0, 1, 7], "nx": 0, "ny": 0})[1]
check(not r["ok"] and r["resync"], "shared table: pieces that aren't neighbours can't join")
# play to the end, alternating
groups = [0]
for i in range(2, 12):
    p = ann if i % 2 else ben
    p.call("match/event", {"id": mid, "type": "grab", "pieces": [i]})
    r = p.call("match/event", {"id": mid, "type": "drop", "pieces": list(range(i + 1)), "nx": 0, "ny": 0})[1]
    check(r["ok"], f"join {i}")
check(r.get("complete"), "complete")
ann.wait("matches", lambda d: d.get("finished") == mid)
m = ann.call(f"match/{mid}")[1]["match"]
check(m["status"] == "finished" and m["me"]["finished"] and m["them"]["timeMs"] is not None, f"together finished {m}")
check(ann.call("match/finish", {"id": mid})[1]["timeMs"] == m["me"]["timeMs"], "finish returns server time")

# ---- race, swap with an uploaded photo ----
img = base64.b64encode(jpeg(5000)).decode()
s, d = ann.call("match/create", {"friend": ben_id, "mode": "race", "picks": "swap", "pieces": 24,
                                "puzzle": {"image": img, "name": "My cat", "cols": 6, "rows": 4}})
rid = d["id"]
check(s == 201, "create race swap")
check(ben.call("match/respond", {"id": rid, "accept": True})[0] == 400, "swap needs ben's pick")
check(ben.call("match/respond", {"id": rid, "accept": True, "puzzle": {"libraryId": "oia", "name": "Oia", "cols": 6, "rows": 4}})[0] == 200, "ben picks")
mb = ben.call(f"match/{rid}")[1]["match"]
ma = ann.call(f"match/{rid}")[1]["match"]
check(mb["puzzle"]["name"] == "My cat" and mb["puzzle"]["hasImage"] and ma["puzzle"]["libraryId"] == "oia", "each plays the other's pick")
check(ben.call(f"match/{rid}/photo")[1] == base64.b64decode(img), "ben gets ann's photo")
check(ann.call(f"match/{rid}/photo")[0] == 404, "ann's puzzle is a library photo")
check(eve.call(f"match/{rid}/photo")[0] == 404, "outsider can't get photo")
ann.call("match/ready", {"id": rid})
st = ben.call("match/ready", {"id": rid})[1]
time.sleep((st["startAt"] - st["now"]) / 1000 + 0.1)
race_start = time.time()
check(ann.call("match/event", {"id": rid, "type": "progress", "share": 0.99})[0] == 400, "claimed progress isn't accepted")
check(ann.call("match/join", {"id": rid, "pieces": [0, 1, 2]})[0] == 200, "a real join")
check(ben.wait("game", lambda d: d["type"] == "progress")["share"] > 0, "ben sees ann's progress, as the server counted it")
check(ann.call("match/join", {"id": rid, "pieces": [0, 5]})[0] == 400, "pieces that aren't neighbours can't join")
check(ann.call("match/join", {"id": rid, "pieces": [0, 999]})[0] == 400, "pieces that don't exist can't join")
check(ann.call("match/event", {"id": rid, "type": "grab", "pieces": [0]})[0] == 400, "no grabs in a race")
check(ben.call("match/finish", {"id": rid, "stars": 3})[0] == 409, "no win without solving")
solve(ben, rid, 24)
check(ben.call("match/finish", {"id": rid, "stars": 3})[0] == 409, "no win faster than a person could solve it")
time.sleep(max(0, race_start + 24 * 0.4 + 0.3 - time.time()))
r = ben.call("match/finish", {"id": rid, "stars": 3, "moves": 30, "hints": 0})[1]
check(r["timeMs"] > 0, "ben finishes")
fin = ann.wait("game", lambda d: d["type"] == "finished")
check(fin["winner"] == "friend", "ann told ben won")
check(ann.call("match/finish", {"id": rid})[1].get("late"), "ann too late")
m = ann.call(f"match/{rid}")[1]["match"]
check(m["winner"] == "friend" and m["status"] == "finished", "race result")

# ---- challenge ----
s, d = ben.call("match/create", {"friend": ann_id, "mode": "challenge", "picks": "same", "pieces": 12, "puzzle": lib})
cid = d["id"]
ann.call("match/respond", {"id": cid, "accept": True})
check(ann.call("match/finish", {"id": cid})[0] == 409, "can't finish before beginning")
check(ann.call("match/join", {"id": cid, "pieces": [0, 1]})[0] == 409, "no joins before beginning")
began = time.time()
ann.call("match/begin", {"id": cid})
time.sleep(0.4)
b1 = ann.call("match/begin", {"id": cid})[1]["beganAt"]
solve(ann, cid, 12, began)
time.sleep(0.3)  # a little slower than ben will be, so the times can't tie to the millisecond
check(ann.call("match/finish", {"id": cid, "stars": 2})[0] == 200, "ann finishes the challenge")
m = ben.call(f"match/{cid}")[1]["match"]
check(m["them"]["finished"] and m["them"]["timeMs"] is None, "ben can't see ann's time before playing")
began = time.time()
ben.call("match/begin", {"id": cid})
solve(ben, cid, 12, began)
ben.call("match/finish", {"id": cid, "stars": 3})
m = ben.call(f"match/{cid}")[1]["match"]
check(m["status"] == "finished" and m["winner"] in ("me", "friend") and m["them"]["timeMs"] >= 4800, f"challenge settled {m}")

# leaving / declining, removing a friend ends open games
s, d = ann.call("match/create", {"friend": ben_id, "mode": "race", "picks": "same", "pieces": 12, "puzzle": lib})
ben.call("match/respond", {"id": d["id"], "accept": False})
check(ann.call(f"match/{d['id']}")[1]["match"]["status"] == "declined", "declined")
s, d = ann.call("match/create", {"friend": ben_id, "mode": "challenge", "picks": "same", "pieces": 12, "puzzle": lib})
ann.call("friends/remove", {"id": ben_id})
check(ben.call(f"match/{d['id']}")[1]["match"]["status"] == "cancelled", "unfriend cancels")
check(ben.call("friends")[1]["friends"] == [], "unfriended")
print(f"all {ok} social checks passed against {BASE}")
