"""Serves the app locally and keeps the photo library up to date.

Every time the app asks for the library list, the `library/` folder is checked first, so a photo
dropped there shows up after a reload of the page.

Run it with:  python3 tools/serve.py        then open http://localhost:8765
"""

import http.server
import sys
import threading
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_library  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
LIBRARY_LIST = "/assets/library/library.json"
build_lock = threading.Lock()


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == LIBRARY_LIST:
            with build_lock:
                try:
                    build_library.build(verbose=True)
                except Exception as err:  # still serve the last good list
                    print(f"library update failed: {err}")
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always show the latest files while developing
        super().end_headers()


if __name__ == "__main__":
    handler = partial(Handler, directory=str(build_library.ROOT))
    with http.server.ThreadingHTTPServer(("", PORT), handler) as server:
        print(f"Puzzle Table: http://localhost:{PORT}  (drop photos into {build_library.SOURCE})")
        server.serve_forever()
