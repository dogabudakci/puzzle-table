"""The admin page's tools: reports, suspending and deleting accounts, and who may use them.

Run through tests/run_server_tests.py, which starts a fresh server for it."""
import sys, time
import json, urllib.request, urllib.error, http.cookiejar

BASE, ADMIN = sys.argv[1], sys.argv[3]
ok = 0


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




def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1


tag = str(int(time.time() * 1000) % 10 ** 7)
boss, rude, nice = P(), P(), P()
boss.call("signup", {"identifier": ADMIN, "password": "the boss of puzzles"})
boss.call("login", {"identifier": ADMIN, "password": "the boss of puzzles"})
rude.call("signup", {"identifier": f"rude{tag}", "password": "rude player phrase"})
nice.call("signup", {"identifier": f"nice{tag}", "password": "nice player phrase"})
# Having the name isn't enough: admin rights are given to the account by the site owner.
check(boss.call("me")[1]["user"]["admin"] is False, "a new account is never admin, whatever its name")
check(boss.call("admin/reports")[0] == 404, "no admin pages before being granted")
import os, subprocess
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.run([sys.executable, os.path.join(root, "tools", "admin.py"), "grant", ADMIN], check=True, capture_output=True)
check(boss.call("me")[1]["user"]["admin"] is True, "admin flag after the owner grants it")
check(nice.call("me")[1]["user"]["admin"] is False, "no admin flag for others")
check(nice.call("admin/reports")[0] == 404, "others can't see reports")
check(nice.call("admin/report", {"id": 1, "action": "delete"})[0] == 404, "others can't act")

rude.call("friends/request", {"username": f"nice{tag}"})
rude_id = nice.call("friends")[1]["incoming"][0]["id"]
check(nice.call("report", {"id": rude_id, "reason": "name", "details": "very rude", "block": False})[0] == 200, "report sent")
reports = boss.call("admin/reports")[1]["reports"]
rep = next(r for r in reports if r["player"]["id"] == rude_id)
check(rep["status"] == "open" and rep["details"] == "very rude" and rep["reporter"] == f"nice{tag}", "report listed")
stats = boss.call("admin/stats")[1]["stats"]
check(stats["openReports"] >= 1 and stats["players"] >= 3, f"stats {stats}")

check(boss.call("admin/report", {"id": rep["id"], "action": "suspend"})[0] == 200, "suspend")
check(rude.call("me")[1]["user"] is None, "suspended player signed out")
s, d, _ = rude.call("login", {"identifier": f"rude{tag}", "password": "rude player phrase"})
check(s == 403 and "suspended" in d["error"], "suspended player can't sign in")
check(rude.call("login", {"identifier": f"rude{tag}", "password": "wrong password!!"})[1]["error"].startswith("That email"),
      "wrong password doesn't reveal suspension")
check(nice.call("friends")[1]["incoming"] == [], "suspended player hidden from friends")
check(boss.call("admin/report", {"id": rep["id"], "action": "unsuspend"})[0] == 200, "unsuspend")
check(rude.call("login", {"identifier": f"rude{tag}", "password": "rude player phrase"})[0] == 200, "can sign in again")
check(boss.call("admin/report", {"id": rep["id"], "action": "delete"})[0] == 200, "delete")
check(rude.call("login", {"identifier": f"rude{tag}", "password": "rude player phrase"})[0] == 401, "deleted")
rep = next(r for r in boss.call("admin/reports")[1]["reports"] if r["id"] == rep["id"])
check(rep["status"] == "closed" and not rep["player"]["exists"], "report closed, player gone")
check(boss.call("admin/report", {"id": rep["id"], "action": "suspend"})[0] == 409, "can't act on a deleted player")
print(f"all {ok} admin checks passed")
