"""The app in WebKit (Safari's engine): desktop + iPhone, solo game, zoom, friends playing together.
python webkit_e2e.py BASE OUT"""
import sys, time
from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
ok = 0
problems = []


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1
    print("ok -", what)


def watch(page, name):
    page.on("pageerror", lambda e: problems.append(f"{name} error: {e}"))
    page.on("console", lambda m: problems.append(f"{name} console {m.type}: {m.text}") if m.type in ("error",) else None)


GROUP_OF = "(i) => [...document.querySelector(`#table .piece[data-index=\"${i}\"]`).parentElement.querySelectorAll('.piece')].map(x => +x.dataset.index)"
TO_PLACE = """(i) => {
  const piece = document.querySelector(`#table .piece[data-index="${i}"]`);
  const world = document.querySelector('#table .world');
  const zoom = +(world.style.transform.match(/scale\\(([\\d.]+)\\)/) || [0, 1])[1];
  const mat = document.querySelector('.work-mat');
  const pad = -parseFloat(document.querySelector('#table .piece[data-index="0"]').style.left);
  const [gx, gy] = piece.parentElement.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/).slice(1).map(Number);
  const tx = parseFloat(mat.style.left) + pad, ty = parseFloat(mat.style.top) + pad;
  const r = piece.getBoundingClientRect();
  for (const fy of [.5, .44, .56, .4, .6]) for (const fx of [.5, .44, .56, .4, .6]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 2 || y < 60 || x > innerWidth - 60 || y > innerHeight - 2) continue;
    const top = document.elementsFromPoint(x, y).find((e) => e.classList.contains('piece'));
    if (top && top.parentElement === piece.parentElement) return {x, y, dx: (tx - gx) * zoom, dy: (ty - gy) * zoom};
  }
  return null;
}"""


def place(page, i):
    d = page.evaluate(TO_PLACE, i)
    if d is None:
        return False
    page.mouse.move(d["x"], d["y"])
    page.mouse.down()
    for k in range(1, 11):
        page.mouse.move(d["x"] + d["dx"] * k / 10, d["y"] + d["dy"] * k / 10)
    page.mouse.up()
    time.sleep(0.5)
    return True


def join_any(page, taken=()):
    """Places a reachable pair of side-by-side pieces (4 x 3 puzzle); returns the pair."""
    for a in range(12):
        b = a + 1
        if a % 4 == 3 or a in taken or b in taken:
            continue
        if page.evaluate(TO_PLACE, a) and page.evaluate(TO_PLACE, b) and place(page, a) and place(page, b):
            if b in page.evaluate(GROUP_OF, a):
                return a, b
    return None


def signup(page, ident):
    return page.evaluate("""(ident) => fetch('/api/signup', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({identifier: ident, password: 'puzzle phrase for tests'})}).then(r => r.status)""", ident)


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    desk = browser.new_context(viewport={"width": 1400, "height": 900}, reduced_motion="reduce", bypass_csp=True)
    phone = browser.new_context(**pw.devices["iPhone 14"], reduced_motion="reduce", bypass_csp=True)
    # Test-only: let the test tool evaluate its checks, which the page's CSP (rightly) forbids.
    def no_csp(route):
        response = route.fetch()
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-security-policy"}
        route.fulfill(response=response, headers=headers)
    for ctx in (desk, phone):
        ctx.route(lambda url: "/api/" not in url and (url.endswith("/") or url.endswith(".html")), no_csp)
    for ctx in (desk, phone):  # the first-time tips card would cover pieces
        ctx.add_init_script("try { localStorage.setItem('puzzle-guide-seen', '1'); } catch {}")
    ann, ben = desk.new_page(), phone.new_page()
    watch(ann, "desktop")
    watch(ben, "iphone")
    ann.goto(BASE)
    ben.goto(BASE)
    ben.wait_for_timeout(1500)
    ben.screenshot(path=OUT + "/w1-iphone-home.png")

    # Solo game on desktop WebKit: library photo, 24 pieces, pouch, drag, zoom
    ann.wait_for_function("document.querySelectorAll('#photo-library .library-photo').length > 5")
    ann.click("#photo-library .library-photo >> nth=2")
    ann.wait_for_function("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 2")
    ann.evaluate("""() => [...document.querySelectorAll('#piece-grid label.option')].find((l) => l.textContent.trim().startsWith('24')).querySelector('input').click()""")
    ann.click("#start-btn")
    ann.wait_for_selector("#table .pouch")
    ann.click("#table .pouch")
    ann.wait_for_function("!document.querySelector('#table .pouch') && document.querySelectorAll('#table .group').length === 24", timeout=15000)
    time.sleep(2.5)  # the pieces can be picked up once they've all landed
    check(place(ann, 0) and place(ann, 1), "dragging pieces works in WebKit")
    check(1 in ann.evaluate(GROUP_OF, 0), "pieces snap together in WebKit")
    ann.mouse.move(700, 450)
    ann.mouse.wheel(0, -300)
    time.sleep(0.5)
    zoom = ann.evaluate("+(document.querySelector('#table .world').style.transform.match(/scale\\(([\\d.]+)\\)/) || [0, 1])[1]")
    check(zoom > 1.2, f"wheel zoom in WebKit ({zoom:.2f})")
    ann.screenshot(path=OUT + "/w2-safari-game.png")
    ann.click("#back-btn")

    # Accounts and friends: Ann (desktop) and Ben (iPhone)
    tag = str(int(time.time()) % 100000)
    check(signup(ann, f"ann{tag}") == 201 and signup(ben, f"ben{tag}") == 201, "sign up in WebKit")
    ann.evaluate(f"""() => fetch('/api/friends/request', {{method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify({{username: 'ben{tag}'}})}})""")
    ben.evaluate("""() => fetch('/api/friends').then(r => r.json()).then(d => fetch('/api/friends/respond', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: d.incoming[0].id, accept: true})}))""")
    ann.reload()
    ben.reload()
    ann.wait_for_selector("#friends-btn:not([hidden])", timeout=20000)
    ben.wait_for_selector("#friends-btn:not([hidden])", timeout=20000)
    ben.wait_for_timeout(800)
    ben.screenshot(path=OUT + "/w3a-iphone-header.png", clip={"x": 0, "y": 0, "width": 390, "height": 140})

    # Ben, on the phone, invites Ann to play together
    ben.click("#friends-btn")
    ben.wait_for_selector("#friend-list .btn.primary")
    ben.screenshot(path=OUT + "/w3-iphone-friends.png")
    ben.click("#friend-list .btn.primary")
    ben.wait_for_function("document.querySelectorAll('#mp-photo .library-photo').length > 5")
    ben.click("#mp-photo .library-photo >> nth=0")
    ben.select_option("#mp-pieces", "12")
    ben.screenshot(path=OUT + "/w4-iphone-new-game.png", full_page=False)
    ben.click("#send-invite")
    ann.wait_for_selector("#notice:not([hidden])", timeout=10000)
    ann.click("#notice-action")
    ann.wait_for_selector("#game-list .game-row.invited .btn.primary")
    ann.click("#game-list .game-row.invited .btn.primary")
    for p in (ann, ben):
        p.wait_for_function("!document.getElementById('game').hidden && document.querySelectorAll('#table .group').length === 12 && !document.querySelector('#table .pouch')", timeout=20000)
    time.sleep(2.5)
    ben.screenshot(path=OUT + "/w5-iphone-table.png")
    pair = join_any(ann)
    check(pair is not None, f"ann joins two pieces on the shared table {pair}")
    ben.wait_for_function(f"({GROUP_OF})({pair[0]}).includes({pair[1]})", timeout=10000)
    check(True, "ben's iPhone shows ann's join")
    pair2 = join_any(ben, taken=pair)
    check(pair2 is not None, f"ben joins two pieces on his phone {pair2}")
    ann.wait_for_function(f"({GROUP_OF})({pair2[0]}).includes({pair2[1]})", timeout=10000)
    check(True, "ann sees ben's join")
    ben.screenshot(path=OUT + "/w6-iphone-playing.png")

    errors = [p for p in problems if "favicon" not in p]
    check(not errors, f"no errors: {errors[:3]}")
    print(f"all {ok} WebKit checks passed")
    browser.close()
