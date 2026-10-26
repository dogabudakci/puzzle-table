"""Sound that gets stuck comes back: a resume() that never finishes, an "interrupted" context and
a frozen clock each get a new audio context at the next tap, and music goes on playing on it.
python3 sound_e2e.py BASE OUT"""
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


# Keeps every audio context the page makes, so the test can break them as browsers do.
RECORD = """(() => { const Real = window.AudioContext; window.__contexts = [];
  window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__contexts.push(this); } }; })();"""

b = Browser(OUT + "/chrome-sound")
p = b.page(BASE, init=RECORD)
p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 20)


def tap():
    # A real click on an empty spot of the page: what unlocks (and checks) the sound.
    p.b.call("Target.activateTarget", {"targetId": p.target})
    p.mouse("mousePressed", 6, 300)
    p.mouse("mouseReleased", 6, 300)
    time.sleep(0.3)


def contexts():
    return p.js("window.__contexts.length")


def latest_state():
    return p.js("window.__contexts.at(-1).state")


p.js("document.getElementById('set-test-sound').click()")
p.wait("document.getElementById('sound-test-result').textContent.length > 0 && !/…$/.test(document.getElementById('sound-test-result').textContent)", 6)
check(latest_state() == "running", "the test sound plays")

p.js("document.getElementById('music-toggle').click()")
p.wait("/Playing/.test(document.getElementById('music-now').textContent)", 8, "music playing")
check(True, "music plays")

# 1. resume() never finishes (Safari after sleep): the next taps make a new context.
p.js("""(() => { const c = window.__contexts.at(-1); c.resume = () => new Promise(() => {}); return c.suspend(); })()""")
before = contexts()
tap()  # asks to resume: hangs
time.sleep(2.3)
tap()  # now it counts as stuck
p.wait("window.__contexts.at(-1).state === 'running'", 5, "a new running context")
check(contexts() == before + 1, "a hanging resume gets a new audio context")
p.wait("/Playing/.test(document.getElementById('music-now').textContent)", 5, "music still playing")
time.sleep(0.5)
check(p.js("window.__contexts.at(-2).state") == "closed", "the stuck one is closed")

# 2. "interrupted" (iPhone after a call): replaced at the next tap.
p.js("""(() => { const c = window.__contexts.at(-1); Object.defineProperty(c, 'state', { get: () => 'interrupted' }); })()""")
before = contexts()
tap()
p.wait("window.__contexts.at(-1).state === 'running'", 5)
check(contexts() == before + 1, "an interrupted context is replaced")

# 3. Says "running" but its clock stands still (a lost output device).
p.js("""(() => { const c = window.__contexts.at(-1); const t = c.currentTime; Object.defineProperty(c, 'currentTime', { get: () => t }); })()""")
before = contexts()
tap()  # a first look at the clock
time.sleep(1.6)
tap()
p.wait("window.__contexts.at(-1).state === 'running'", 5)
check(contexts() == before + 1, "a frozen clock is noticed and replaced")

# A healthy context is left alone.
before = contexts()
for _ in range(3):
    tap()
    time.sleep(1.2)
check(contexts() == before, "a working context isn't replaced")

# Effects still play after all that: a test sound on the newest context.
p.js("document.getElementById('sound-test-result').textContent = ''")
p.js("document.getElementById('set-test-sound').click()")
p.wait("document.getElementById('sound-test-result').textContent.length > 0 && !/…$/.test(document.getElementById('sound-test-result').textContent)", 6)
check("two soft notes" in p.js("document.getElementById('sound-test-result').textContent"), "and the test sound still works")

errors = [m for m in b.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} sound checks passed")
b.close()
