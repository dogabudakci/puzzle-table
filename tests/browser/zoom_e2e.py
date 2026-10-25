"""Zoom and pan on the table: wheel, drag, pinch, dragging pieces while zoomed. python zoom_e2e.py BASE OUT"""
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


VIEW = """(() => { const m = document.querySelector('#table .world').style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/);
  return m ? m.slice(1).map(Number) : [0, 0, 1]; })()"""
GROUP_XY = """((i) => document.querySelector(`#table .piece[data-index="${i}"]`).parentElement.style.transform
  .match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/).slice(1).map(Number))(%d)"""

b = Browser(OUT + "/chrome-zoom", port=9338)
p = b.page(BASE)
p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 20)
p.js("document.querySelector('#photo-library .library-photo').click()")
p.wait("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 2", 15)
p.js("""(() => { const input = [...document.querySelectorAll('#piece-grid label.option')].find((l) => l.textContent.trim().startsWith('48')).querySelector('input');
  input.click(); })()""")
p.wait("!document.getElementById('start-btn').disabled")
p.js("document.getElementById('start-btn').click()")
p.wait("document.querySelector('#table .pouch')", 15)
p.js("document.querySelector('#table .pouch').click()")
p.wait("!document.querySelector('#table .pouch') && !document.getElementById('zoom-controls').hidden", 15, "spilled")
time.sleep(1.5)
check(p.js(VIEW) == [0, 0, 1], "starts showing the whole table")

# Mouse wheel zooms around the cursor
p.b.call("Target.activateTarget", {"targetId": p.target})
p.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": 700, "y": 450, "deltaX": 0, "deltaY": -100})
time.sleep(0.3)
x, y, z = p.js(VIEW)
check(z > 1.1, f"wheel zooms in ({z:.2f})")
check(p.js("document.getElementById('zoom-level').textContent") == f"{round(z * 100)}%", "zoom level shown")
check(not p.js("document.getElementById('zoom-fit').disabled"), "fit button enabled")

# Zoom in more with the button, then pan by dragging the empty table
p.js("document.getElementById('zoom-in').click()")
time.sleep(0.5)
x, y, z = p.js(VIEW)
check(z > 1.6, f"+ button zooms ({z:.2f})")
EMPTY = """(() => { for (let y = 120; y < 800; y += 37) for (let x = 120; x < 1300; x += 41) {
  if (!document.elementsFromPoint(x, y).some((e) => e.classList.contains('piece') || e.closest('.zoom-controls'))) return [x, y]; } })()"""
ex, ey = p.js(EMPTY)
p.drag(ex, ey, ex + 150, ey + 90)
x2, y2, z2 = p.js(VIEW)
check(abs((x2 - x) - 150) < 2 and abs((y2 - y) - 90) < 2 and z2 == z, f"dragging the table pans ({x2 - x:.0f}, {y2 - y:.0f})")

# Dragging a piece while zoomed: it follows the mouse exactly (screen distance / zoom in table units)
FIND = """(() => { for (const c of document.querySelectorAll('#table .piece')) { const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (cx > 140 && cx < 1150 && cy > 140 && cy < 820 && document.elementsFromPoint(cx, cy).find((e) => e.classList.contains('piece')) === c
      && c.parentElement.children.length === 1) return [+c.dataset.index, cx, cy]; } })()"""
found = p.js(FIND)
if found is None:  # everything in view is the empty mat: look at the whole table again, closer to the pieces
    p.js("document.getElementById('zoom-fit').click()"); time.sleep(0.5)
    p.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": 150, "y": 200, "deltaX": 0, "deltaY": -200}); time.sleep(0.4)
    found = p.js(FIND)
check(found is not None, "a piece in view")
i, cx, cy = found
gx, gy = p.js(GROUP_XY % i)
p.drag(cx, cy, cx + 120, cy - 60)
time.sleep(0.4)
nx, ny = p.js(GROUP_XY % i)
_, _, z = p.js(VIEW)
check(abs((nx - gx) - 120 / z) < 3 and abs((ny - gy) + 60 / z) < 3, f"piece follows the mouse at {z:.2f}x ({nx - gx:.1f}, {ny - gy:.1f})")
time.sleep(0.6)
res = p.js("document.querySelector('#table .piece').width / parseFloat(document.querySelector('#table .piece').style.width)")
check(res > 1.4, f"pieces redrawn sharper when zoomed (resolution {res:.2f})")
p.shot(OUT + "/z1-zoomed.png")

# 0 key: back to the whole table
p.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "0", "code": "Digit0", "text": "0"})
p.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "0", "code": "Digit0"})
time.sleep(0.6)
check(p.js(VIEW) == [0, 0, 1], "0 key shows the whole table")

# Touch: pinch with two fingers zooms; one finger on empty table pans
p.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
ex, ey = p.js(EMPTY)
def touch(kind, points):
    p.call("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": n} for n, (x, y) in enumerate(points)]})
touch("touchStart", [(ex, ey)])
touch("touchStart", [(ex, ey), (ex + 40, ey)])
for k in range(1, 9):
    touch("touchMove", [(ex - 15 * k, ey), (ex + 40 + 15 * k, ey)])
    time.sleep(0.03)
touch("touchEnd", [])
time.sleep(0.4)
x, y, z = p.js(VIEW)
check(z > 2, f"pinch zooms in ({z:.2f})")
p.shot(OUT + "/z2-pinched.png")
errors = [m for m in b.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} zoom checks passed")
b.close()
