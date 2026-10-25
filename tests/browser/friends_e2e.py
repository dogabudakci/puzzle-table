"""Two players in two browser contexts: become friends, play together, race. python friends_e2e.py BASE OUTDIR"""
import json, sys, time
from cdp import Browser

BASE, OUT = sys.argv[1], sys.argv[2]
ok = 0
T2 = "document.querySelector('#table .piece[data-index=\"2\"]').parentElement.style.transform"
WRAP = """(() => { window.__log = []; const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
  if (String(u).includes('match/event')) { const c = r.clone(); c.json().then(j => window.__log.push([o && o.body, JSON.stringify(j).slice(0, 120)])); } return r; }; })()"""




def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1
    print("ok -", what)


tag = str(int(time.time()) % 100000)
browser = Browser(OUT + "/chrome-friends")
ann = browser.page(BASE)
ben = browser.page(BASE)

SIGNUP = """fetch('/api/signup', {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({identifier: '%s', password: 'puzzle phrase for tests'})}).then(r => r.status)"""
check(ann.js(SIGNUP % f"ann{tag}") == 201, "ann signs up (username)")
check(ben.js(SIGNUP % f"ben{tag}@example.com") == 201, "ben signs up (email)")
ann.goto(BASE)
ben.goto(BASE)
ann.wait("!document.getElementById('friends-btn').hidden", 25, what="ann friends button")
ben.wait("!document.getElementById('friends-btn').hidden", 25, what="ben friends button")

# Ben has no username: the dialog asks for one first
ben.js("document.getElementById('friends-btn').click()")
ben.wait("!document.getElementById('friends-name').hidden", what="username view")
ben.js(f"document.getElementById('username-input').value = 'ben{tag}'; document.getElementById('username-form').requestSubmit()")
ben.wait("!document.getElementById('friends-main').hidden", what="friends view after username")
check(ben.js("document.getElementById('my-username').textContent") == f"ben{tag}", "ben's username shown")

# Ann adds Ben
ann.js("document.getElementById('friends-btn').click()")
ann.wait("!document.getElementById('friends-main').hidden")
ann.js(f"document.getElementById('add-friend-input').value = 'ben{tag}'; document.getElementById('add-friend-form').requestSubmit()")
ann.wait("!document.getElementById('add-friend-done').hidden", what="request sent")
ben.wait("document.querySelectorAll('#friend-requests .person').length === 1", what="ben sees request live")
check(ben.js("document.getElementById('friends-count').textContent") == "1", "badge shows 1")
ben.js("document.querySelector('#friend-requests .btn.primary').click()")
ann.wait("document.querySelectorAll('#friend-list .person').length === 1", what="ann sees friend live")
ann.wait("document.querySelector('#friend-list .avatar').classList.contains('online')", what="online dot")
ann.shot(OUT + "/f1-friends.png")
ben.js("document.getElementById('friends-dialog').close()")

# Ann sets up a "together" game: library photo, 12 pieces
ann.js("document.querySelector('#friend-list .btn.primary').click()")
ann.wait("!document.getElementById('friends-new').hidden")
ann.wait("document.querySelectorAll('#mp-photo .library-photo').length > 5", what="library in picker")
ann.js("document.querySelector('#mp-photo .library-photo').click(); document.getElementById('mp-pieces').value = '12'")
ann.shot(OUT + "/f2-new-game.png")
ann.js("document.getElementById('send-invite').click()")
ann.wait("!document.getElementById('panel-games').hidden && document.querySelector('#game-list .game-row.invited')", what="ann's waiting invite")
ann.shot(OUT + "/f3-invited.png")

ben.wait("!document.getElementById('notice').hidden", what="ben gets invite notice")
check("invited you" in ben.js("document.getElementById('notice-text').textContent"), "notice text")
ben.shot(OUT + "/f4-notice.png")
ben.js("document.getElementById('notice-action').click()")
ben.wait("document.querySelectorAll('#game-list .game-row').length >= 1", what="games list")
ben.js("document.querySelector('#game-list .btn.primary').click()")
ben.wait("!document.getElementById('game').hidden", what="ben at the table")
ann.wait("!document.getElementById('game').hidden", what="ann taken to the table")

for p in (ann, ben):
    p.wait("document.querySelectorAll('#table .group').length === 12 && !document.querySelector('#table .pouch')", 15, "pieces spilled")
time.sleep(1.5)
ann.js(WRAP); ben.js(WRAP)
ann.shot(OUT + "/f5-ann-table.png")
ben.shot(OUT + "/f5-ben-table.png")

# Same layout on both screens (relative to the work mat)
LAYOUT = """(() => {
  const mat = document.querySelector('.work-mat').getBoundingClientRect();
  const out = {};
  for (const c of document.querySelectorAll('#table .piece')) {
    const g = c.parentElement; const m = g.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/);
    out[c.dataset.index] = {g: [...g.children].filter(x => x.classList.contains('piece')).map(x => +x.dataset.index).sort((a,b)=>a-b).join(','),
      nx: (+m[1] - (mat.left - document.getElementById('table').getBoundingClientRect().left + 0)) / mat.width,
      ny: (+m[2]) / mat.height};
  }
  return out;
})()"""
la, lb = ann.js(LAYOUT), ben.js(LAYOUT)
check(all(abs(la[k]["nx"] - lb[k]["nx"]) < 0.03 for k in la), "same starting layout on both screens")

# Ann drags piece 1 next to piece 0 so they join
JOIN = """((a, b) => {
  const SPOTS = [.5, .44, .56, .4, .6, .33, .67, .27, .73];
  const pa = document.querySelector(`#table .piece[data-index="${a}"]`), pb = document.querySelector(`#table .piece[data-index="${b}"]`);
  const t = (el) => el.parentElement.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/).slice(1).map(Number);
  const [ax, ay] = t(pa), [bx, by] = t(pb);
  const r = pb.getBoundingClientRect();
  // A spot on the piece that no other piece covers.
  for (const fy of SPOTS) for (const fx of SPOTS) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const top = document.elementsFromPoint(x, y).find((e) => e.classList.contains('piece'));
    if (top === pb) return {x, y, dx: ax - bx, dy: ay - by};
  }
  return {x: r.left + r.width / 2, y: r.top + r.height / 2, dx: ax - bx, dy: ay - by};
})(%d, %d)"""
d = ann.js(JOIN % (0, 1))
ann.drag(d["x"], d["y"], d["x"] + d["dx"], d["y"] + d["dy"])
# Drags a piece's group to where it belongs on the mat (always within reach, like a player building
# the puzzle in place); the second piece of a pair then snaps onto the first.
TO_PLACE = """((i) => {
  const SPOTS = [.5, .44, .56, .4, .6, .33, .67, .27, .73];
  const piece = document.querySelector(`#table .piece[data-index="${i}"]`);
  const mat = document.querySelector('.work-mat');
  const pad = -parseFloat(document.querySelector('#table .piece[data-index="0"]').style.left);
  const [gx, gy] = piece.parentElement.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/).slice(1).map(Number);
  const tx = parseFloat(mat.style.left) + pad, ty = parseFloat(mat.style.top) + pad;
  const zoom = +(document.querySelector('#table .world').style.transform.match(/scale\\(([\\d.]+)\\)/) || [0, 1])[1];
  const r = piece.getBoundingClientRect();
  for (const fy of SPOTS) for (const fx of SPOTS) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 2 || y < 60 || x > innerWidth - 2 || y > innerHeight - 2) continue;
    const top = document.elementsFromPoint(x, y).find((e) => e.classList.contains('piece'));
    if (top && top.parentElement === piece.parentElement) return {x, y, dx: (tx - gx) * zoom, dy: (ty - gy) * zoom, done: Math.hypot(tx - gx, ty - gy) < 2};
  }
  return null;
})(%d)"""


# The piece lying on top of piece i (the first one found over it, from its middle outwards).
COVER = """((i) => { const SPOTS = [.5, .44, .56, .4, .6, .33, .67, .27, .73]; const piece = document.querySelector(`#table .piece[data-index="${i}"]`); const r = piece.getBoundingClientRect();
  for (const fy of SPOTS) for (const fx of SPOTS) {
    const top = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy).find((e) => e.classList.contains('piece'));
    if (top && top.parentElement !== piece.parentElement) return +top.dataset.index;
  }
  return null; })(%d)"""


def place(p, i, depth=0):
    # Up to three tries: a piece measured while a friend's move still glides in lands off target.
    for _ in range(3):
        d = p.js(TO_PLACE % i)
        if d is None and depth < 3:
            # Another piece lies on top: put that one in its place first, as a player would.
            place(p, p.js(COVER % i), depth + 1)
            d = p.js(TO_PLACE % i)
        if d is None:
            p.shot(OUT + "/fail-reach.png")
            raise SystemExit(f"FAIL: piece {i} can't be reached")
        if d["done"]:
            return
        p.drag(d["x"], d["y"], d["x"] + d["dx"], d["y"] + d["dy"])
        time.sleep(0.6)


def join(p, a, b):
    place(p, a)
    place(p, b)
    if not p.js(f"({GROUP_OF % a}).split(',').includes('{b}')"):
        p.shot(OUT + "/fail.png")
        raise SystemExit(f"FAIL: couldn't join {a} and {b}")


GROUP_OF = "[...document.querySelector('#table .piece[data-index=\"%d\"]').parentElement.querySelectorAll('.piece')].map(x => +x.dataset.index).sort((a,b)=>a-b).join(',')"
# Ben's connection drops: he sees the banner; Ann keeps playing; Ben catches up when he's back
OFF = {"offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1}
ben.call("Network.enable")
ben.call("Network.emulateNetworkConditions", OFF)
ben.wait("!document.getElementById('connection-banner').hidden", 15, "connection banner")
ben.shot(OUT + "/f5b-offline.png")
check(True, "banner shows when the connection drops")
join(ann, 0, 1)
ann.wait(f"({GROUP_OF % 0}).split(',').includes('1')", what="ann joined 0+1")
ben.call("Network.emulateNetworkConditions", {**OFF, "offline": False})
ben.wait("document.getElementById('connection-banner').hidden", 20, "banner gone")
ben.wait(f"({GROUP_OF % 0}).split(',').includes('1')", 10, what="ben caught up with 0+1")
check(True, "back online, the friend's move shows up")

# Ben joins 2 to that group while Ann watches
join(ben, 1, 2)
ann.wait(f"({GROUP_OF % 0}).split(',').includes('2')", what="ann sees ben's join")
check(ben.js("document.getElementById('undo-btn').hidden") and ben.js("document.getElementById('pause-btn').hidden"), "no undo/pause together")

# Finish the rest, alternating players
for i in range(3, 12):
    join(ann if i % 2 else ben, i - 1, i)
for p in (ann, ben):
    p.wait("!document.getElementById('complete-card').hidden", 15, "complete card")
note_a = ann.js("document.getElementById('match-note').textContent")
check("Finished together" in note_a and " in 0:" in note_a, f"result line: {note_a}")
ann.shot(OUT + "/f6-complete.png")

# A race: ben invites, ann accepts from the notice
for p in (ann, ben):
    p.js("document.getElementById('new-btn').click()")
ben.js("document.getElementById('friends-btn').click()")
ben.wait("document.querySelectorAll('#friend-list .btn.primary').length === 1")
ben.js("document.querySelector('#friend-list .btn.primary').click()")
ben.wait("document.querySelectorAll('#mp-photo .library-photo').length > 5")
ben.js("document.querySelector('#mode-picker [data-mode=race]').click(); document.querySelectorAll('#mp-photo .library-photo')[3].click(); document.getElementById('mp-pieces').value = '12'")
ben.js("document.getElementById('send-invite').click()")
ann.wait("!document.getElementById('notice').hidden && document.getElementById('notice-text').textContent.includes('race')", what="race invite")
ann.js("document.getElementById('notice-action').click()")
ann.wait("document.querySelector('#game-list .game-row.invited .btn.primary')")
ann.js("document.querySelector('#game-list .game-row.invited .btn.primary').click()")
ann.wait("!document.getElementById('game').hidden")
ann.shot(OUT + "/f3-race-start.png")
ben.wait("!document.getElementById('game').hidden", what="ben taken to race table")
for p in (ann, ben):
    p.wait("document.querySelectorAll('#table .group').length === 12 && !document.querySelector('#table .pouch')", 15, "race spilled")
time.sleep(1.2)
check(ann.js("!document.getElementById('friend-chip').hidden && document.getElementById('friend-chip').classList.contains('race')"), "race chip")
ben.js("new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('reaction')) window.__reaction = n.textContent; }).observe(document.getElementById('game'), {childList: true})")
ann.js("document.getElementById('react-btn').click()")
ann.js("document.querySelectorAll('#react-menu button')[2].click()")
ben.wait("(window.__reaction || '').includes('🎉')", 5, "ben sees the reaction")
ben.shot(OUT + "/f7b-reaction.png")
check(True, "reaction arrives")
# Ann solves 6 joins; ben sees ann's progress
for i in range(1, 7):
    join(ann, i - 1, i)
ben.wait("parseFloat(document.getElementById('friend-chip-fill').style.width) > 30", what="ben sees ann's progress")
ben.shot(OUT + "/f7-race.png")
for i in range(7, 12):
    join(ann, i - 1, i)
ann.wait("!document.getElementById('complete-card').hidden", 15, "ann complete")
check("You won the race" in ann.js("document.getElementById('match-note').textContent"), "ann won")
ben.wait("!document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes('finished first')", what="ben told")
ann.shot(OUT + "/f8-race-won.png")
ann.js("document.getElementById('rematch-btn').click()")
ann.wait("document.getElementById('friends-dialog').open && !document.getElementById('friends-new').hidden", 5, "rematch opens new game")
check(ann.js("document.querySelector('#mode-picker [data-mode=race]').getAttribute('aria-checked')") == "true", "rematch keeps race mode")
ann.js("document.getElementById('new-game-back').click()")
ann.wait("document.querySelector('#friend-list .person-name small')?.textContent.includes('You 1 – 0')", 10, "head-to-head shows the win")
check(True, "head-to-head shows the win")
ann.shot(OUT + "/f9-record.png")
errors = [m for m in browser.buffer if m.get("method") == "Runtime.exceptionThrown"]
check(not errors, f"no page errors {errors[:1]}")
print(f"all {ok} browser checks passed")
browser.close()
