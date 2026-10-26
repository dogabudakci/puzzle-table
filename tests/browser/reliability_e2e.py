"""Saving and finishing when things go wrong, signed in: a new puzzle started while the last
save is still uploading, another tab saving a different puzzle, a finished puzzle whose gallery
upload fails, signing out offline, and error codes in German. python3 reliability_e2e.py BASE OUT"""
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


# Requests can be held back or made to fail: window.__net = { 'progress/full': 3000, 'gallery/add': 'fail' }.
NET = """window.__net = {}; const realFetch = window.fetch;
window.fetch = async (url, options) => {
  const rule = Object.entries(window.__net).find(([part]) => String(url).includes('/api/' + part));
  if (rule && rule[1] === 'fail') throw new TypeError('Failed to fetch');
  if (rule) await new Promise((r) => setTimeout(r, rule[1]));
  return realFetch(url, options);
};"""

b = Browser(OUT + "/chrome-reliability")
p = b.page(BASE, init=NET)
p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 20)
tag = str(int(time.time() * 1000) % 10 ** 8)
p.js(f"""fetch('/api/signup', {{method: 'POST', headers: {{'Content-Type': 'application/json'}},
  body: JSON.stringify({{identifier: 'rel{tag}', password: 'a long enough phrase'}})}}).then((r) => r.status)""")
p.call("Page.reload")
p.wait("document.getElementById('photo-library')?.querySelectorAll('.library-photo').length > 5", 20)
time.sleep(1)

SERVER_GAME = "fetch('/api/progress').then((r) => r.json()).then((d) => d.progress && d.progress.gameId)"
STATUS = "document.getElementById('save-status').dataset.state"


def start(photo_index, pieces_index=0, exactly=None):
    p.wait(f"document.querySelectorAll('#photo-library .library-photo').length > {photo_index}", 15)
    p.js(f"document.querySelectorAll('#photo-library .library-photo')[{photo_index}].click()")
    p.wait("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 2", 15)
    time.sleep(1.5)  # the grid is drawn again for the new photo
    if exactly:
        p.js(f"[...document.querySelectorAll('#piece-grid label.option')].find((l) => l.textContent.trim().startsWith('{exactly}')).querySelector('input').click()")
    else:
        p.js(f"[...document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)')][{pieces_index}].click()")
    p.wait("!document.getElementById('start-btn').disabled")
    p.js("document.getElementById('start-btn').click()")
    p.wait("document.querySelector('#table .pouch')", 15)
    p.js("document.querySelector('#table .pouch').click()")
    p.wait("!document.querySelector('#table .pouch')", 15)
    time.sleep(2.5)


def nudge():
    r = p.js("(() => { const r = document.querySelector('#table .piece').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    p.drag(r[0], r[1], r[0] + 40, r[1] + 30)


# 1. A new puzzle started while the last one's first save is still uploading gets saved too.
p.js("window.__net['progress/full'] = 2500")
start(0)
nudge()
time.sleep(0.5)
p.js("document.getElementById('back-btn').click()")
p.wait("!document.getElementById('setup').hidden")
p.js("window.__net = {}")
start(1)
second = None
for _ in range(40):
    time.sleep(0.25)
    if p.js(STATUS) in ("saved", "idle") and p.js(SERVER_GAME):
        second = p.js(SERVER_GAME)
        break
check(second is not None and p.js(STATUS) != "error", "the new puzzle is saved without waiting for another change")
first_id = second

# 2. Another tab saves a different puzzle: this one stops saving instead of writing over it.
p.js("""(async () => { const blob = await (await fetch('/assets/og-image.jpg')).blob();
  const b64 = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(blob); });
  return (await fetch('/api/progress/full', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({photo: b64, thumb: b64, progress: {gameId: 'other-tab', layout: []}})})).status; })()""")
nudge()
p.wait(f"{STATUS} === 'replaced'", 10, "the replaced status")
check(True, "the toolbar says another puzzle was saved since")
check(p.js(SERVER_GAME) == "other-tab", "and the other tab's puzzle is untouched")
p.js("document.getElementById('back-btn').click()")
p.wait("!document.getElementById('setup').hidden")

# 3. Finishing while the gallery can't be reached: the puzzle is kept here and sent later.
# (The gallery step the finished card runs, called directly on a game in progress.)
start(0, exactly=12)
nudge()
time.sleep(1.5)
p.js("window.__net['gallery/add'] = 'fail'")
safe = p.js("import('/js/galleryScreen.js').then((g) => g.saveToGallery({ timeMs: 60000, limitMs: null, beatClock: false, hintsUsed: 0, moves: 20, stars: 3 }))")
check(safe is True, "the puzzle counts as safe")
check("connection" in p.js("document.getElementById('saved-note').textContent"), "a failed gallery upload is kept on this device")
time.sleep(1)
waiting = """(async () => { const db = await new Promise((r) => { const q = indexedDB.open('puzzle-table'); q.onsuccess = () => r(q.result); });
  const all = await new Promise((r) => { const q = db.transaction('saved').objectStore('saved').getAll(); q.onsuccess = () => r(q.result); });
  return all.filter((x) => String(x.id).startsWith('gallery-')).length; })()"""
check(p.js(waiting) == 1, "the finished puzzle waits on this device")
check(p.js(SERVER_GAME) is not None, "and the unfinished save isn't removed before then")
p.js("window.__net = {}; window.dispatchEvent(new Event('online'))")
for _ in range(40):
    time.sleep(0.25)
    if p.js(waiting) == 0:
        break
check(p.js(waiting) == 0, "back online, it goes to the gallery")
check(p.js("fetch('/api/gallery').then((r) => r.json()).then((d) => d.puzzles.length)") == 1, "and is in the gallery")

# 4. Signing out while offline: says so, and stays signed in.
p.js("window.__net['logout'] = 'fail'")
p.js("document.getElementById('back-btn')?.click()")
time.sleep(0.5)
p.js("document.getElementById('account-btn').click()")
p.wait("document.getElementById('logout-btn').offsetParent !== null", 5)
p.js("document.getElementById('logout-btn').click()")
p.wait("!document.getElementById('logout-error').hidden", 5)
check(p.js("fetch('/api/me').then((r) => r.json()).then((d) => Boolean(d.user))"), "signing out offline says it didn't work, and the account is still signed in")
p.js("window.__net = {}")
p.js("document.getElementById('logout-btn').click()")
p.wait("fetch('/api/me').then((r) => r.json()).then((d) => !d.user)", 5)
check(True, "online, signing out works")

# 5. In German, errors still carry their code (retries look at the code, not the words).
p.js("localStorage.setItem('puzzle-language', 'de')")
p.call("Page.reload")
p.wait("document.documentElement.lang === 'de' && document.querySelectorAll('#photo-library .library-photo').length > 5", 20)
r = p.js("import('/js/api.js').then((m) => m.api('match/join', {id: 'abcdefghijklmnop', pieces: [0, 1]})).catch((e) => [e.code, e.message])")
check(r[0] == "signInFirst" and "sign in" not in r[1].lower(), f"a German error has its code {r}")

errors = [m for m in b.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} reliability checks passed")
b.close()
