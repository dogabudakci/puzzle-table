"""The table during a game: no start-page pieces on it, nothing lost when the window changes size,
every piece fully on the table, and a reload goes back into the game. python3 table_e2e.py BASE OUT"""
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


# Every group's position on the table (world coordinates), by its first piece.
LAYOUT = """Object.fromEntries([...document.querySelectorAll('#table .group')].map((g) =>
  [g.querySelector('.piece').dataset.index, g.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/).slice(1).map(Number)]))"""
# Pieces sticking out of the table further than a tab can (the canvas around a piece reaches about
# 30% of a piece past each side, a fifth of the canvas), in screen pixels.
OUTSIDE = """(() => { const t = document.querySelector('#table .world').getBoundingClientRect();
  return [...document.querySelectorAll('#table .piece')].filter((c) => { const r = c.getBoundingClientRect();
    const tab = Math.min(r.width, r.height) * 0.22;
    return r.left < t.left - tab || r.top < t.top - tab || r.right > t.right + tab || r.bottom > t.bottom + tab; }).length; })()"""


def size(p, width, height):
    p.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
    time.sleep(0.8)


b = Browser(OUT + "/chrome-table")
p = b.page(BASE)
# With motion on, so the start page's falling pieces run as they do for players.
p.call("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "no-preference"}]})
p.call("Page.reload")
p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 25)
time.sleep(6)  # the intro
for y in range(0, 2400, 120):  # scrolling the start page drops small pieces down its sides
    p.js(f"scrollTo(0, {y})")
    time.sleep(0.05)
check(p.js("document.querySelectorAll('.scroll-pieces .scroll-piece').length") > 0, "the start page's falling pieces are there")

p.js("document.querySelector('#photo-library .library-photo').click()")
p.wait("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 3", 15)
p.js("[...document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)')][3].click()")
p.wait("!document.getElementById('start-btn').disabled")
p.js("document.getElementById('start-btn').click()")
p.wait("document.querySelector('#table .pouch')", 15)
check(p.js("document.querySelectorAll('.scroll-pieces .scroll-piece').length") == 0, "none of them are left over the game")
p.js("document.querySelector('#table .pouch').click()")
p.wait("!document.querySelector('#table .pouch')", 15)
time.sleep(3)
check(p.js(OUTSIDE) == 0, "every piece is on the table")

# Move a piece, so there's something of the player's own to keep.
r = p.js("(() => { const r = document.querySelector('#table .piece').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
p.drag(r[0], r[1], 700, 450)
time.sleep(1.5)
before = p.js(LAYOUT)

size(p, 800, 560)
check(p.js(LAYOUT) == before, "a smaller window moves no piece")
check(p.js(OUTSIDE) == 0, "and still shows every piece")
size(p, 1700, 1000)
check(p.js(LAYOUT) == before, "nor does a bigger one")
size(p, 1400, 900)
p.shot(OUT + "/table-1.png")

# Reload: back in the same game, every piece where it was.
time.sleep(1.5)  # the last save
p.call("Page.reload")
p.wait("document.getElementById('game')?.hidden === false && document.querySelectorAll('#table .group').length > 1", 25, "back in the game")
check(True, "a reload goes back into the game")
time.sleep(1)
check(p.js(LAYOUT) == before, "with every piece where it was")
check(p.js("document.getElementById('setup').hidden"), "not the start page")
p.shot(OUT + "/table-2.png")

# Leaving the game: a reload then shows the start page.
p.js("document.getElementById('back-btn').click()")
p.wait("!document.getElementById('setup').hidden")
p.call("Page.reload")
time.sleep(4)
check(p.js("!document.getElementById('setup').hidden"), "after leaving, a reload shows the start page")

errors = [m for m in b.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} table checks passed")
b.close()
