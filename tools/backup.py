"""Saves the whole database to one file, or puts a saved one back.

  python3 tools/backup.py                     saves to backups/puzzle-YYYY-MM-DD-HHMM.json.gz
  python3 tools/backup.py --restore FILE      loads a backup into an EMPTY database

It uses the same database as the app: data/puzzle.db, or the online one (Neon) when
DATABASE_URL is set, e.g.  DATABASE_URL='postgresql://…' python3 tools/backup.py
(for Neon this needs: python3 -m pip install "psycopg[binary]").

Backups contain everything, including email addresses and password hashes: keep them private.
The backups/ folder is readable only by you and is never added to git.
"""

import base64
import gzip
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from accounts import DB_PATH, Accounts  # noqa: E402
from userdata import UserData  # noqa: E402
from recovery import Recovery  # noqa: E402
from social import Hub, Social  # noqa: E402
from admin import Admin  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BACKUPS = ROOT / "backups"
# In an order where everything a row points to comes before it.
TABLES = ["users", "sessions", "tokens", "gallery", "achievements", "daily", "progress",
          "friendships", "blocks", "reports", "matches", "match_puzzles", "match_players"]
WITH_IDS = ["users", "gallery", "reports"]  # numbered automatically: the numbering continues after a restore
NAME_RE = re.compile(r"^[a-z_]+$")


def open_database():
    accounts = Accounts(DB_PATH)
    # Creating these makes sure every table exists (as it does when the app starts).
    UserData(accounts)
    Recovery(accounts, "http://localhost")
    social = Social(accounts, Hub())
    Admin(accounts, social, social.hub)
    return accounts.database


def encode(value):
    if isinstance(value, (bytes, memoryview)):
        return {"$b64": base64.b64encode(bytes(value)).decode()}
    return value


def decode(value):
    if isinstance(value, dict) and "$b64" in value:
        return base64.b64decode(value["$b64"])
    return value


def save():
    database = open_database()
    data = {"savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tables": {}}
    with database.connect() as db:
        for table in TABLES:
            rows = db.execute(f"SELECT * FROM {table}").fetchall()
            data["tables"][table] = [{k: encode(v) for k, v in dict(r).items()} for r in rows]
    BACKUPS.mkdir(exist_ok=True)
    BACKUPS.chmod(0o700)
    target = BACKUPS / time.strftime("puzzle-%Y-%m-%d-%H%M.json.gz")
    target.write_bytes(gzip.compress(json.dumps(data).encode()))
    target.chmod(0o600)
    counts = ", ".join(f"{len(rows)} {name}" for name, rows in data["tables"].items() if rows)
    print(f"Saved {target} ({target.stat().st_size // 1024} KB): {counts or 'empty database'}")


def restore(path):
    data = json.loads(gzip.decompress(Path(path).read_bytes()))
    database = open_database()
    with database.connect() as db:
        if db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]:
            raise SystemExit("The database isn't empty: restoring only works into an empty one, so nothing is overwritten.")
        for table in TABLES:
            for row in data["tables"].get(table, []):
                columns = list(row)
                if not all(NAME_RE.match(c) for c in columns):
                    raise SystemExit(f"Unexpected column in {table}: refusing to restore.")
                db.execute(
                    f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                    tuple(decode(row[c]) for c in columns),
                )
        if database.postgres:
            for table in WITH_IDS:
                db.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 1))")
    total = sum(len(rows) for rows in data["tables"].values())
    print(f"Restored {total} rows from {path} (saved {data.get('savedAt')}).")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--restore":
        restore(sys.argv[2])
    elif len(sys.argv) == 1:
        save()
    else:
        print(__doc__)
