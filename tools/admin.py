"""The site owner's tools: reports about players, suspending or deleting accounts, and a few numbers.

Only the usernames listed in PUZZLE_ADMIN_USERNAMES (comma-separated) can use them; to everyone
else the admin API looks like it doesn't exist. Every action is printed to the server log.
"""

import os
import time

from accounts import AccountError

ADMINS = {name.strip().lower() for name in (os.environ.get("PUZZLE_ADMIN_USERNAMES") or "").split(",") if name.strip()}
ACTIONS = {"dismiss", "suspend", "unsuspend", "delete"}


class Admin:
    def __init__(self, accounts, social, hub):
        self.accounts = accounts
        self.social = social
        self.hub = hub
        accounts.database.add_column("reports", "status", "TEXT NOT NULL DEFAULT 'open'")

    def connect(self):
        return self.accounts.connect()

    @staticmethod
    def is_admin(user):
        return bool(user and user.get("username") and user["username"] in ADMINS)

    def require(self, user):
        if not self.is_admin(user):
            raise AccountError("Not found.", 404)

    def reports(self, user):
        self.require(user)
        with self.connect() as db:
            rows = db.execute(
                "SELECT r.id, r.reason, r.details, r.created_at, r.status, r.reported, r.reported_name,"
                " a.username AS reporter_name, u.username AS current_name, u.suspended,"
                " (SELECT COUNT(*) FROM reports x WHERE x.reported = r.reported) AS times_reported"
                " FROM reports r LEFT JOIN users a ON a.id = r.reporter LEFT JOIN users u ON u.id = r.reported"
                " ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 200"
            ).fetchall()
        return [{
            "id": r["id"], "reason": r["reason"], "details": r["details"], "createdAt": r["created_at"] * 1000,
            "status": r["status"], "reporter": r["reporter_name"] or "(deleted account)",
            "player": {"id": r["reported"], "username": r["current_name"] or r["reported_name"],
                       "exists": r["reported"] is not None,  # deleted accounts leave the report pointing nowhere
                       "suspended": bool(r["suspended"]), "timesReported": r["times_reported"]},
        } for r in rows]

    def act(self, user, report_id, action):
        """Closes a report, and optionally suspends, restores or deletes the reported account."""
        self.require(user)
        if not isinstance(report_id, int) or action not in ACTIONS:
            raise AccountError("Invalid request.")
        with self.connect() as db:
            report = db.execute("SELECT reported FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not report:
                raise AccountError("That report doesn't exist.", 404)
            player = report["reported"]
            if action != "dismiss" and player is None:
                raise AccountError("That account no longer exists.", 409)
            if player == user["id"]:
                raise AccountError("That's your own account.")
            if action == "suspend":
                db.execute("UPDATE users SET suspended = 1 WHERE id = ?", (player,))
                db.execute("DELETE FROM sessions WHERE user_id = ?", (player,))
            elif action == "unsuspend":
                db.execute("UPDATE users SET suspended = 0 WHERE id = ?", (player,))
            elif action == "delete":
                db.execute("DELETE FROM users WHERE id = ?", (player,))
            status = "open" if action == "unsuspend" else "closed"
            db.execute("UPDATE reports SET status = ? WHERE id = ? OR (? AND reported = ?)",
                       (status, report_id, action in ("suspend", "delete"), player))
        if action in ("suspend", "delete") and player is not None:
            self.hub.close_user(player)  # signed out everywhere, right away
        print(f"[admin] {user['username']}: {action} (report {report_id}, player {player})")

    def stats(self, user):
        self.require(user)
        with self.connect() as db:
            one = lambda sql, *args: db.execute(sql, args).fetchone()["n"]  # noqa: E731
            week = int(time.time()) - 7 * 86400
            storage = db.execute(
                "SELECT COALESCE((SELECT SUM(LENGTH(image)) FROM gallery), 0)"
                " + COALESCE((SELECT SUM(LENGTH(photo) + LENGTH(thumb)) FROM progress), 0)"
                " + COALESCE((SELECT SUM(LENGTH(image)) FROM match_puzzles), 0) AS n"
            ).fetchone()["n"]
            return {
                "players": one("SELECT COUNT(*) AS n FROM users"),
                "newThisWeek": one("SELECT COUNT(*) AS n FROM users WHERE created_at > ?", week),
                "signedInThisWeek": one("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE created_at > ?", week),
                "puzzlesSaved": one("SELECT COUNT(*) AS n FROM gallery"),
                "gamesThisWeek": one("SELECT COUNT(*) AS n FROM matches WHERE created_at > ?", week),
                "openReports": one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
                "suspended": one("SELECT COUNT(*) AS n FROM users WHERE suspended = 1"),
                "storageMB": round(int(storage or 0) / 1024 / 1024, 1),
                "onlineNow": self.hub.online_count(),
            }
