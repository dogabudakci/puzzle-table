"""Reconnecting and server restarts: a friend who drops off catches up, and after the server
restarts, sign-ins, a shared table and a race carry on where they were.

This suite starts (and restarts) its own server. Run through tests/run_server_tests.py."""
import json, os, queue, socket, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error, http.cookiejar
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ok = 0


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()
BASE = f"http://localhost:{PORT}"
folder = Path(tempfile.mkdtemp())
env = {**os.environ, "PUZZLE_OUTBOX": str(folder / "outbox")}
if not env.get("DATABASE_URL"):
    env["PUZZLE_DB"] = str(folder / "restart.db")


def start():
    server = subprocess.Popen([sys.executable, "-u", str(ROOT / "tools" / "serve.py"), str(PORT)], env=env,
                              stdout=open(folder / "server.log", "a"), stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            urllib.request.urlopen(BASE + "/healthz", timeout=1)
            return server
        except OSError:
            time.sleep(0.1)
    raise SystemExit("FAIL: server didn't start")


class Player:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.events = queue.Queue()

    def call(self, path, body=None):
        req = urllib.request.Request(BASE + "/api/" + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Origin": BASE})
        try:
            with self.op.open(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def listen(self):
        def run():
            try:
                with self.op.open(BASE + "/api/events") as r:
                    event = None
                    for raw in r:
                        line = raw.decode().rstrip("\n")
                        if line.startswith("event: "):
                            event = line[7:]
                        elif line.startswith("data: "):
                            self.events.put((event, json.loads(line[6:])))
            except OSError:
                pass  # the server went away
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
        raise SystemExit(f"FAIL: never got {event}")


server = start()
try:
    tag = str(int(time.time() * 1000) % 10 ** 7)
    a, b = Player(), Player()
    a.call("signup", {"identifier": f"ria{tag}", "password": "ria plays puzzles"})
    b.call("signup", {"identifier": f"tom{tag}", "password": "tom plays puzzles"})
    a.call("friends/request", {"username": f"tom{tag}"})
    b.call("friends/respond", {"id": b.call("friends")[1]["incoming"][0]["id"], "accept": True})
    tom = a.call("friends")[1]["friends"][0]["id"]
    lib = {"libraryId": "oia", "name": "Oia", "cols": 4, "rows": 3}

    # A shared table
    mid = a.call("match/create", {"friend": tom, "mode": "together", "picks": "same", "pieces": 12, "puzzle": lib})[1]["id"]
    b.call("match/respond", {"id": mid, "accept": True})
    layout = [{"pieces": [i], "nx": 1.1, "ny": -0.2} for i in range(12)]
    a.call("match/ready", {"id": mid, "layout": layout})
    st = b.call("match/ready", {"id": mid, "layout": layout})[1]
    time.sleep((st["startAt"] - st["now"]) / 1000 + 0.1)

    # Tom drops off; Ria joins two pieces meanwhile; Tom comes back and catches up
    a.call("match/event", {"id": mid, "type": "grab", "pieces": [1]})
    a.call("match/event", {"id": mid, "type": "drop", "pieces": [0, 1], "nx": 0, "ny": 0})
    st = b.call("match/ready", {"id": mid})[1]
    check(any(g["pieces"] == [0, 1] for g in st["layout"]), "back after dropping off: the friend's join is there")

    # A race, half solved
    rid = a.call("match/create", {"friend": tom, "mode": "race", "picks": "same", "pieces": 12, "puzzle": lib})[1]["id"]
    b.call("match/respond", {"id": rid, "accept": True})
    a.call("match/ready", {"id": rid})
    st = b.call("match/ready", {"id": rid})[1]
    time.sleep((st["startAt"] - st["now"]) / 1000 + 0.1)
    race_start = time.time()
    for k in range(1, 6):
        a.call("match/join", {"id": rid, "pieces": list(range(k + 1))})
        time.sleep(0.11)
    time.sleep(2.2)  # the shared table is saved at most every 2 seconds
    a.call("match/event", {"id": mid, "type": "grab", "pieces": [2]})
    a.call("match/event", {"id": mid, "type": "drop", "pieces": [0, 1, 2], "nx": 0, "ny": 0})

    # The server restarts
    server.terminate()
    server.wait(timeout=10)
    server = start()
    check(a.call("me")[1]["user"]["username"] == f"ria{tag}", "still signed in after a restart")
    st = a.call("match/ready", {"id": mid})[1]
    check(st["startAt"] and any(g["pieces"] == [0, 1, 2] for g in st["layout"]), f"shared table restored: {st['layout'][:2]}")
    a.call("match/event", {"id": mid, "type": "grab", "pieces": [3]})
    r = a.call("match/event", {"id": mid, "type": "drop", "pieces": [0, 1, 2, 3], "nx": 0, "ny": 0})[1]
    check(r["ok"], "the shared game carries on")
    b.listen()
    a.call("match/event", {"id": mid, "type": "grab", "pieces": [4]})
    a.call("match/event", {"id": mid, "type": "drop", "pieces": [0, 1, 2, 3, 4], "nx": 0, "ny": 0})
    check(b.wait("game", lambda d: d["type"] == "drop")["pieces"][-1] == 4, "live updates work again after the restart")

    for k in range(6, 12):  # the race too: the server still knows what was solved
        a.call("match/join", {"id": rid, "pieces": list(range(k + 1))})
        time.sleep(0.11)
    time.sleep(max(0, race_start + 12 * 0.4 + 0.3 - time.time()))
    s, d = a.call("match/finish", {"id": rid})
    check(s == 200 and d["timeMs"] > 0, f"race finished after the restart {s} {d}")
    print(f"all {ok} reconnect and restart checks passed")
finally:
    server.terminate()
