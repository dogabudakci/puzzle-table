"""Playing with the keyboard only: choose a piece, pick it up, move it, join it. python3 keyboard_e2e.py BASE OUT"""
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


b = Browser(OUT + "/chrome-keyboard")
p = b.page(BASE)
p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 20)
p.js("document.querySelector('#photo-library .library-photo').click()")
p.wait("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 2", 15)
p.js("[...document.querySelectorAll('#piece-grid label.option')].find((l) => l.textContent.trim().startsWith('12')).querySelector('input').click()")
p.wait("!document.getElementById('start-btn').disabled")
p.js("document.getElementById('start-btn').click()")
p.wait("document.querySelector('#table .pouch')", 15)
p.js("document.querySelector('#table .pouch').click()")
p.wait("!document.querySelector('#table .pouch')", 15)
time.sleep(2.5)


def key(name, code=None, shift=False):
    for kind in ("keyDown", "keyUp"):
        p.call("Input.dispatchKeyEvent", {"type": kind, "key": name, "code": code or name,
                                          "windowsVirtualKeyCode": {"ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40, " ": 32, "n": 78, "Escape": 27}.get(name, 0),
                                          "modifiers": 8 if shift else 0, **({"text": name} if kind == "keyDown" and len(name) == 1 else {})})


p.b.call("Target.activateTarget", {"targetId": p.target})
p.js("document.getElementById('table').focus()")
check(p.js("document.activeElement.id") == "table", "the table can be reached with the keyboard")
key("n", "KeyN")
check(p.js("document.querySelectorAll('.kb-selected').length") == 1, "N selects a piece")
check("selected" in p.js("document.getElementById('announcer').textContent"), "and says so for screen readers")

# Build on the mat with the keyboard: piece 0 to its place, then piece 1 to its place: they join.
GROUP = "[...document.querySelector('.kb-selected').querySelectorAll('.piece')].map((c) => +c.dataset.index)"
XY = """((i) => document.querySelector(`#table .piece[data-index="${i}"]`).parentElement.style.transform
  .match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/).slice(1).map(Number))(%d)"""
PLACE = """(() => { const mat = document.querySelector('.work-mat'); const pad = -parseFloat(document.querySelector('#table .piece[data-index="0"]').style.left);
  return [parseFloat(mat.style.left) + pad, parseFloat(mat.style.top) + pad]; })()"""


def select(index):
    for _ in range(13):
        if index in p.js(GROUP):
            return True
        key("n", "KeyN")
    return False


def move_to_place(index):
    check(select(index), f"N reaches piece {index}")
    key(" ", "Space")
    (gx, gy), (tx, ty) = p.js(XY % index), p.js(PLACE)
    for name, steps in (("ArrowRight" if tx > gx else "ArrowLeft", round(abs(tx - gx) / 10)),
                        ("ArrowDown" if ty > gy else "ArrowUp", round(abs(ty - gy) / 10))):
        for _ in range(steps):
            key(name)
    key(" ", "Space")
    time.sleep(0.3)


move_to_place(0)
check("Put down" in p.js("document.getElementById('announcer').textContent"), "Space puts it down")
move_to_place(1)
joined = p.js("[...document.querySelector('#table .piece[data-index=\"0\"]').parentElement.querySelectorAll('.piece')].map((c) => +c.dataset.index)")
check(1 in joined, f"moved with the arrow keys and joined ({joined})")
check("Joined" in p.js("document.getElementById('announcer').textContent"), "the join is announced")

# Escape puts a piece back
key("n", "KeyN")
before = p.js(GROUP)
start = p.js(XY % before[0])
key(" ", "Space")
for _ in range(5):
    key("ArrowDown")
key("Escape")
check(p.js(XY % before[0]) == start, "Escape puts it back")
p.shot(OUT + "/k1-keyboard.png")
errors = [m for m in b.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} keyboard checks passed")
b.close()
