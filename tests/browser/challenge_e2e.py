"""Challenge with "pick for each other" in two browser contexts, plus a phone-size look. python challenge_e2e.py BASE OUT"""
import sys, time
from cdp import Browser

BASE, OUT = sys.argv[1], sys.argv[2]
tag = str(int(time.time()) % 100000)
browser = Browser(OUT + "/chrome-challenge", port=9334)
ann = browser.page(BASE)
ben = browser.page(BASE)
for p, name in ((ann, "ann"), (ben, "ben")):
    p.js("""fetch('/api/signup', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({identifier: '%s%s', password: 'puzzle phrase for tests'})})""" % (name, tag))
ann.js(f"fetch('/api/friends/request', {{method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify({{username: 'ben{tag}'}})}})")
time.sleep(0.5)
ben.js("fetch('/api/friends').then(r => r.json()).then(d => fetch('/api/friends/respond', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: d.incoming[0].id, accept: true})}))")
ann.goto(BASE)
ben.goto(BASE)
ann.wait("!document.getElementById('friends-btn').hidden", 25)
ben.wait("!document.getElementById('friends-btn').hidden", 25)

# Ann challenges Ben, picking a photo for him
ann.js("document.getElementById('friends-btn').click()")
ann.wait("document.querySelector('#friend-list .btn.primary')")
ann.js("document.querySelector('#friend-list .btn.primary').click()")
ann.wait("document.querySelectorAll('#mp-photo .library-photo').length > 5")
ann.js("document.querySelector('#mode-picker [data-mode=challenge]').click(); document.querySelector('#picks-row [data-picks=swap]').click();"
       "document.querySelectorAll('#mp-photo .library-photo')[6].click(); document.getElementById('mp-pieces').value = '12'")
assert "Photo for ben" in ann.js("document.getElementById('photo-head').textContent")
ann.shot(OUT + "/c1-challenge-setup.png")
ann.js("document.getElementById('send-invite').click()")
ann.wait("document.querySelector('#game-list .game-row.invited')")

# Ben picks one for Ann and accepts
ben.wait("!document.getElementById('notice').hidden")
ben.js("document.getElementById('notice-action').click()")
ben.wait("document.querySelector('#game-list .game-row.invited .btn.primary')")
ben.js("document.querySelector('#game-list .game-row.invited .btn.primary').click()")
ben.wait("!document.getElementById('friends-pick').hidden")
ben.wait("document.querySelectorAll('#pick-photo .library-photo').length > 5")
ben.js("document.querySelectorAll('#pick-photo .library-photo')[2].click()")
ben.shot(OUT + "/c2-pick.png")
ben.js("document.getElementById('pick-accept').click()")
ann.wait("!document.getElementById('notice').hidden && document.getElementById('notice-text').textContent.includes('accepted')", 10)
ann.shot(OUT + "/c3-accepted.png")

# Ann plays: her puzzle is the one Ben picked (photo 2), with the normal pouch
ann.js("document.getElementById('notice-action').click()")
ann.wait("!document.getElementById('game').hidden && document.querySelector('#table .pouch')", 15)
assert not ann.js("document.querySelector('#table .pouch').disabled"), "challenge pouch is clickable"
ann.js("document.querySelector('#table .pouch').click()")
ann.wait("document.querySelectorAll('#table .group').length === 12 && !document.querySelector('#table .pouch')", 15)
time.sleep(1)
title = ann.js("document.getElementById('game-title').textContent")
assert title.startswith("Challenge with ben"), title
ann.shot(OUT + "/c4-playing.png")
ann.js("document.getElementById('back-btn').click()")
time.sleep(0.5)
ann.js("document.getElementById('friends-btn').click()")
ann.js("document.getElementById('tab-games').click()")
ann.wait("document.querySelector('#game-list .game-row.accepted')?.textContent.includes('clock is running')")
row = ann.js("document.querySelector('#game-list .game-row.accepted').textContent")
assert "clock is running" in row and "Continue" in row, row
ann.shot(OUT + "/c5-games.png")

# Phone size
ben.call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
ben.js("document.getElementById('friends-dialog').close(); document.getElementById('friends-btn').click()")
time.sleep(0.5)
ben.js("document.querySelector('#friend-list .btn.primary').click()")
time.sleep(0.8)
ben.shot(OUT + "/c6-phone-new.png")
errors = [m for m in browser.buffer if m.get("method") == "Runtime.exceptionThrown"]
assert not errors, errors[:1]
print("challenge browser checks passed")
browser.close()
