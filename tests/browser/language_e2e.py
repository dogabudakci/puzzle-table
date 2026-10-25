"""The app in Turkish and German: every text has its translation. python3 language_e2e.py BASE OUT"""
import json, sys, time
from cdp import Browser

BASE, OUT = sys.argv[1], sys.argv[2]
ok = 0


def check(cond, what):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    ok += 1
    print("ok -", what)


# Words that only show up in the English texts (and not in names, brands or numbers).
ENGLISH = ["the", "and", "your", "with", "pieces", "piece", "choose", "play", "settings", "sign in",
           "friends", "continue", "daily", "photo", "music", "sound", "start", "save", "minutes"]

# Every shown text and label on the page, wherever it is (also on hidden screens and dialogs).
TEXTS = """(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const node = walk.currentNode;
    if (node.parentElement.closest('script, style, svg, [translate="no"], .brand')) continue;
    if (node.textContent.trim()) out.push(node.textContent.trim());
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]'))
    for (const name of ['title', 'aria-label', 'placeholder'])
      if (el.getAttribute(name)) out.push(el.getAttribute(name));
  return out;
})()"""


def english_left(texts):
    found = []
    for text in texts:
        words = text.lower().replace("·", " ").split()
        if any(w.strip(".,:;!?…()") in ENGLISH for w in words) or "sign in" in text.lower():
            found.append(text)
    return found


for code in ("tr", "de"):
    b = Browser(f"{OUT}/chrome-lang-{code}")
    p = b.page(BASE, init=f"try {{ localStorage.setItem('puzzle-language', '{code}'); }} catch {{}}")
    p.wait("document.querySelectorAll('#photo-library .library-photo').length > 5", 20)
    check(p.js("document.documentElement.lang") == code, f"{code}: the page says it's in {code}")
    left = english_left(p.js(TEXTS))
    check(not left, f"{code}: no English on the start page {left[:8]}")

    # Into a game, where the play screen fills in its own texts.
    p.js("document.querySelector('#photo-library .library-photo').click()")
    p.wait("document.querySelectorAll('#piece-grid input[type=radio]:not(:disabled)').length > 2", 15)
    p.js("document.querySelector('#piece-grid input[type=radio]:not(:disabled)').click()")
    p.wait("!document.getElementById('start-btn').disabled")
    p.js("document.getElementById('start-btn').click()")
    p.wait("document.querySelector('#table .pouch')", 15)
    left = english_left(p.js(TEXTS))
    check(not left, f"{code}: no English on the play screen {left[:8]}")
    p.shot(f"{OUT}/lang-{code}.png")

    logs = [m for m in b.buffer if m.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown")]
    missing = [json.dumps(m)[:200] for m in logs if "No text for" in json.dumps(m)]
    errors = [m for m in logs if m.get("method") == "Runtime.exceptionThrown"]
    check(not missing, f"{code}: every key has a text {missing[:2]}")
    check(not errors, f"{code}: no page errors {errors[:1]}")
    b.close()

print(f"all {ok} language checks passed")
