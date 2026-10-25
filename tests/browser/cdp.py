"""Tiny Chrome DevTools driver: separate browser contexts (cookies) per player."""
import atexit, base64, itertools, json, socket, subprocess, time, urllib.request
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Browser:
    def __init__(self, profile, port=None):
        # A free port every time, so a browser left over from an earlier run is never reused.
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                                      "--no-first-run", "--window-size=1400,900", "--autoplay-policy=no-user-gesture-required",
                                      "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version"))
                break
            except Exception:
                time.sleep(0.2)
        self.ws = websocket.create_connection(info["webSocketDebuggerUrl"], timeout=30)
        atexit.register(self.close)  # also when a test stops early
        self.ids = itertools.count(1)
        self.buffer = []

    def call(self, method, params=None, session=None):
        mid = next(self.ids)
        msg = {"id": mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            data = json.loads(self.ws.recv())
            if data.get("id") == mid:
                if "error" in data:
                    raise RuntimeError(f"{method}: {data['error']}")
                return data.get("result", {})
            self.buffer.append(data)

    def page(self, url):
        ctx = self.call("Target.createBrowserContext")["browserContextId"]
        target = self.call("Target.createTarget", {"url": "about:blank", "browserContextId": ctx})["targetId"]
        session = self.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        p = Page(self, session)
        p.target = target
        p.call("Page.enable")
        p.call("Runtime.enable")
        # Two tabs run side by side: keep both "focused" and animating, like two real screens.
        p.call("Emulation.setFocusEmulationEnabled", {"enabled": True})
        p.call("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})  # skips the intro
        p.call("Page.addScriptToEvaluateOnNewDocument", {"source":
            "window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);"
            "window.cancelAnimationFrame = (id) => clearTimeout(id);"
            "try { localStorage.setItem('puzzle-guide-seen', '1'); } catch {}"})  # the tips card would cover pieces
        p.call("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        p.goto(url)
        return p

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()


class Page:
    def __init__(self, browser, session):
        self.b = browser
        self.s = session

    def call(self, method, params=None):
        return self.b.call(method, params, self.s)

    def goto(self, url):
        self.call("Page.navigate", {"url": url})
        time.sleep(2.5)

    def js(self, expr, await_promise=True):
        r = self.call("Runtime.evaluate", {"expression": expr, "awaitPromise": await_promise, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(f"JS error: {r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails']}")
        return r["result"].get("value")

    def wait(self, expr, timeout=10, what=None):
        end = time.time() + timeout
        while time.time() < end:
            if self.js(f"!!({expr})"):
                return True
            time.sleep(0.15)
        try:  # what the page looked like, to tell a test hiccup from a real problem
            state = self.js("JSON.stringify({game: !document.getElementById('game').hidden, notice: document.getElementById('notice').hidden ? null : document.getElementById('notice-text').textContent, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id), loading: !document.getElementById('loading').hidden, error: document.getElementById('upload-error')?.textContent})")
            logs = [m["params"].get("args", [{}])[0].get("value") or m["params"].get("exceptionDetails", {}).get("text") for m in self.b.buffer if m.get("sessionId") == self.s and m.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown")]
            print("page state:", state, "| console:", logs[-5:])
        except Exception:
            pass
        raise SystemExit(f"FAIL: timed out waiting for {what or expr}")

    def mouse(self, kind, x, y):
        self.call("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left",
                                               "buttons": 1 if kind != "mouseReleased" else 0, "clickCount": 1})

    def drag(self, x0, y0, x1, y1, steps=12):
        self.b.call("Target.activateTarget", {"targetId": self.target})
        time.sleep(0.4)
        self.mouse("mouseMoved", x0, y0)
        self.mouse("mousePressed", x0, y0)
        for i in range(1, steps + 1):
            self.mouse("mouseMoved", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
            time.sleep(0.03)
        self.mouse("mouseReleased", x1, y1)

    def shot(self, path):
        data = self.call("Page.captureScreenshot", {"format": "png"})["data"]
        open(path, "wb").write(base64.b64decode(data))
