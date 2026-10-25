"""Runs every server test, each against its own freshly started server and empty database.

  python3 tests/run_server_tests.py                    with a temporary SQLite database
  python3 tests/run_server_tests.py --postgres URL     against a PostgreSQL database (needs psycopg)

Nothing touches data/puzzle.db or sends email: each server gets its own database and outbox in a
temporary folder that's deleted afterwards. Exits with 0 when everything passed.
"""

import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SUITES = ["test_accounts.py", "test_friends.py", "test_safety.py", "test_extras.py", "test_admin.py", "test_resilience.py"]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def server_env(folder, postgres):
    """The server's settings; the tests get them too, to run tools (like granting admin) on the same data."""
    env = {
        **os.environ,
        "PUZZLE_DB": str(folder / "test.db"),
        "PUZZLE_OUTBOX": str(folder / "outbox"),
        "PUZZLE_OPERATOR": "Test Operator",
        "PUZZLE_CONTACT_EMAIL": "hello@example.com",
    }
    env.pop("RENDER", None)
    if postgres:
        env["DATABASE_URL"] = postgres
    else:
        env.pop("DATABASE_URL", None)
    return env


def start_server(folder, port, admin, postgres):
    env = server_env(folder, postgres)
    log = open(folder / "server.log", "w")
    server = subprocess.Popen([sys.executable, "-u", str(ROOT / "tools" / "serve.py"), str(port)],
                              env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://localhost:{port}/healthz", timeout=1)
            return server
        except OSError:
            time.sleep(0.1)
    server.kill()
    raise SystemExit(f"The test server didn't start; see {folder / 'server.log'}")


def main():
    postgres = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--postgres" else None
    failed = []
    for suite in SUITES:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            port = free_port()
            admin = f"admin{secrets.token_hex(3)}"
            server = start_server(folder, port, admin, postgres)
            try:
                result = subprocess.run(
                    [sys.executable, str(HERE / suite), f"http://localhost:{port}", str(folder / "outbox"), admin],
                    capture_output=True, text=True, timeout=300, env=server_env(folder, postgres),
                )
            finally:
                server.terminate()
                server.wait(timeout=10)
            last = (result.stdout.strip().splitlines() or ["(no output)"])[-1]
            if result.returncode == 0:
                print(f"  ok    {suite}: {last}")
            else:
                failed.append(suite)
                print(f"  FAIL  {suite}: {last}\n{result.stderr[-2000:]}")
                errors = [line for line in (folder / "server.log").read_text().splitlines() if "api error" in line]
                if errors:
                    print("        server said: " + "\n        ".join(errors[-5:]))
    print("All server tests passed." if not failed else f"{len(failed)} of {len(SUITES)} suites failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
