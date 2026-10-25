"""Saving when the connection drops: "Couldn't save" shows, it saves once the connection is back,
and the progress can be continued. python3 saving_e2e.py BASE OUT"""
import sys, time
from cdp import Browser

BASE, OUT = sys.argv[1], sys.argv[2]
ok = 0


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1
    print("ok -", what)


b = Browser(OUT + "/chrome-saving")
p = b.page(BASE)
tag = str(int(time.time()) % 100000)
p.js("""fetch('/api/signup', {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({identifier: 'sam%s', password: 'puzzle phrase for tests'})})""" % tag)
p.goto(BASE)
p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 20)
p.js("document.querySelector('#photo-library .library-photo').click()")
p.wait("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 2", 15)
p.js("[...document.querySelectorAll('#piece-grid label.option')].find((l) => l.textContent.trim().startsWith('24')).querySelector('input').click()")
p.wait("!document.getElementById('start-btn').disabled")
p.js("document.getElementById('start-btn').click()")
p.wait("document.querySelector('#table .pouch')", 15)
p.js("document.querySelector('#table .pouch').click()")
p.wait("document.getElementById('save-status').dataset.state === 'saved'", 15, "first save after the pieces land")
check(True, "first save (photo and layout together) shows Saved")

# The connection drops; a move can't be saved
OFF = {"offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1}
p.call("Network.enable")
p.call("Network.emulateNetworkConditions", OFF)
MOVE = """(() => { const c = [...document.querySelectorAll('#table .piece')].find((el) => { const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2; return x > 60 && y > 80 && x < innerWidth - 80 && y < innerHeight - 60
  && document.elementsFromPoint(x, y).find((e) => e.classList.contains('piece')) === el; });
  const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"""
x, y = p.js(MOVE)
p.drag(x, y, x + 40, y + 30)
p.wait("document.getElementById('save-status').dataset.state === 'error'", 10, "Couldn't save")
check("Couldn" in p.js("document.getElementById('save-status').textContent"), "the player is told it couldn't save")
p.shot(OUT + "/s1-couldnt-save.png")

# Back online: it saves by itself
p.call("Network.emulateNetworkConditions", {**OFF, "offline": False})
p.wait("document.getElementById('save-status').dataset.state === 'saved'", 25, "saved again")
check(True, "saved once the connection is back")
progress = p.js("fetch('/api/progress').then(r => r.json()).then(d => d.progress && d.progress.moves)")
check(progress and progress >= 1, f"the move is in the account ({progress} moves)")

# Leave and continue
p.js("document.getElementById('back-btn').click()")
p.wait("!document.getElementById('resume-card').hidden", 10, "continue card")
check(True, "the puzzle can be continued")
errors = [m for m in b.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} saving checks passed")
b.close()
