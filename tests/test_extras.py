"""Head-to-head records, the friends' daily ranking and reactions.

Run through tests/run_server_tests.py, which starts a fresh server for it."""
import json, sys, time, urllib.request, urllib.error, http.cookiejar, queue, threading

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


tag = str(int(time.time() * 1000) % 10 ** 7)
a, b, c = Player("a"), Player("b"), Player("c")
for p, n in ((a, "ida"), (b, "joe"), (c, "kim")):
    p.call("signup", {"identifier": f"{n}{tag}", "password": f"{n} plays puzzles a lot"})
a.call("friends/request", {"username": f"joe{tag}"})
b.call("friends/respond", {"id": b.call("friends")[1]["incoming"][0]["id"], "accept": True})
joe_id = a.call("friends")[1]["friends"][0]["id"]
ida_id = b.call("friends")[1]["friends"][0]["id"]
lib = {"libraryId": "oia", "name": "Oia", "cols": 4, "rows": 3}

# Two challenges: ida wins one, joe the other; then a race joe wins
def challenge(first_faster):
    mid = a.call("match/create", {"friend": joe_id, "mode": "challenge", "picks": "same", "pieces": 12, "puzzle": lib})[1]["id"]
    b.call("match/respond", {"id": mid, "accept": True})
    fast, slow = (a, b) if first_faster else (b, a)
    for player, extra in ((fast, 0), (slow, 0.6)):
        began = time.time()
        player.call("match/begin", {"id": mid})
        for k in range(1, 12):  # solved for real: the server checks every join
            player.call("match/join", {"id": mid, "pieces": list(range(k + 1))})
            time.sleep(0.11)
        time.sleep(max(0, began + 12 * 0.4 + 0.2 + extra - time.time()))
        player.call("match/finish", {"id": mid})
challenge(True)
challenge(False)
challenge(True)
rec = a.call("friends")[1]["friends"][0]["record"]
check(rec == {"wins": 2, "losses": 1, "draws": 0, "together": 0}, f"ida's record {rec}")
rec = b.call("friends")[1]["friends"][0]["record"]
check(rec["wins"] == 1 and rec["losses"] == 2, f"joe's record {rec}")

# Daily ranking
day = time.strftime("%Y-%m-%d")
check(a.call("daily/result", {"day": day, "timeMs": 300000})[1].get("ranked") is False,
      "a time with no start the server saw doesn't rank")
for player in (a, b, c):
    player.call("daily/start", {"day": day})
check(a.call("daily/result", {"day": day, "timeMs": 300000})[1].get("ranked") is False,
      "nor one longer than the time since the start")
# As if they'd begun an hour ago (the test can't wait that long).
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from db import Database  # noqa: E402
with Database(os.environ.get("PUZZLE_DB"), os.environ.get("DATABASE_URL")).connect() as db:
    db.execute("UPDATE daily SET started_at = started_at - 3600000 WHERE day = ?", (day,))
a.call("daily/start", {"day": day})  # a second start doesn't move the first
check(a.call("daily/result", {"day": day, "timeMs": 5000})[1].get("ranked") is False, "impossibly fast time doesn't rank")
check(a.call("daily/result", {"day": "2001-01-01", "timeMs": 300000})[0] == 400, "old day refused")
check(a.call("daily/result", {"day": day, "timeMs": 300000, "moves": 120})[1].get("ranked") is True, "ida's time")
a.call("daily/result", {"day": day, "timeMs": 400000})  # slower: the best is kept
b.call("daily/result", {"day": day, "timeMs": 250000})
c.call("daily/result", {"day": day, "timeMs": 100000})  # not a friend: not on their board
board = a.call(f"daily/friends/{day}")[1]["board"]
check([r["username"] for r in board] == [f"joe{tag}", f"ida{tag}"] and board[1]["me"] and board[1]["timeMs"] == 300000,
      f"board {board}")
check(c.call(f"daily/friends/{day}")[1]["board"][0]["me"], "kim sees only herself")
check(a.call("daily")[1]["days"] == [day], "daily days still listed")

# Reactions in a live game
mid = a.call("match/create", {"friend": joe_id, "mode": "race", "picks": "same", "pieces": 12, "puzzle": lib})[1]["id"]
b.call("match/respond", {"id": mid, "accept": True})
b.listen()
a.call("match/ready", {"id": mid})
st = b.call("match/ready", {"id": mid})[1]
time.sleep((st["startAt"] - st["now"]) / 1000 + 0.1)
check(a.call("match/event", {"id": mid, "type": "react", "reaction": 2})[1]["ok"], "react")
check(b.wait("game", lambda d: d["type"] == "react")["reaction"] == 2, "friend gets the reaction")
check(a.call("match/event", {"id": mid, "type": "react", "reaction": 9})[0] == 400, "unknown reaction refused")
check(a.call("match/event", {"id": mid, "type": "react", "reaction": "<b>"})[0] == 400, "text reaction refused")
print(f"all {ok} extras checks passed")
