#!/usr/bin/env python3
"""Poker Log server — static app + canonical data store. Tailnet-only.

THE SPARK IS THE SOURCE OF TRUTH. Devices are input terminals: they buffer
entries locally, push them up, and adopt the merged canonical state that comes
back. Two devices can never clobber each other — merging is per-record.

Routes:
  GET  /             static files from tools/app/
  GET  /api/backup   canonical store (what every device converges to)
  POST /api/backup   merge the device's payload into the canonical store,
                     return {ok, counts, store: <canonical>}

Merge rules:
  - hands/tourneys/sessions: upsert by record id; newer `up` (updatedAt, ms)
    wins; ties/missing -> the server's copy wins (curated edits survive).
  - drills: append-only union keyed by (t, m, k).
  - deletions: tombstones [{id, t}] — applied to all entity arrays, remembered
    so a stale device can't resurrect a deleted record.

Storage:
  backups/store.json            canonical (atomic writes)
  backups/store-YYYYMMDD-HH.json  hourly snapshots of canonical
  backups/pokerlog-dev-<id>.json  last raw payload per device (forensics)

Run: python3 tools/server.py --bind <tailnet-ip> --port 8088
No auth — the tailnet IS the auth boundary. Never bind publicly.
"""
import argparse
import glob
import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")
BACKUP_DIR = os.path.normpath(os.path.join(ROOT, "..", "backups"))
STORE = os.path.join(BACKUP_DIR, "store.json")
LEGACY_LATEST = os.path.join(BACKUP_DIR, "pokerlog-latest.json")
ENTITIES = ("hands", "tourneys", "sessions")
SNAP_KEEP = 60
MAX_BYTES = 8 * 1024 * 1024


def atomic_write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode())
    os.replace(tmp, path)


def fresh_store():
    return {"hands": [], "tourneys": [], "sessions": [], "drills": [], "deleted": []}


def load_store():
    if os.path.exists(STORE):
        with open(STORE, encoding="utf-8") as f:
            s = json.load(f)
    elif os.path.exists(LEGACY_LATEST):              # one-time seed from the old backup
        with open(LEGACY_LATEST, encoding="utf-8") as f:
            j = json.load(f)
        s = {k: j.get(k, []) for k in ENTITIES}
        s["drills"] = j.get("drills", [])
        s["deleted"] = []
    else:
        s = fresh_store()
    for k in list(fresh_store().keys()):
        s.setdefault(k, [])
    return s


def rec_time(r):
    return r.get("up") or r.get("ts") or r.get("t") or 0


# Curated fields are owned by the app/analyzer (manual flags, analyzer review
# tags, hand notes) — the ACR importer never knows them. The per-record merge
# below must NEVER let an empty/absent incoming value erase them, or an importer
# (or a stale device) re-POSTing full records with up=Date.now() wipes curation
# wholesale — exactly the clobber that bit us 2026-06-16. So curation survives an
# empty incoming value; an EXPLICIT value (incl. flag:false to un-flag) still wins.
BOOL_CURATED = ("flag", "reviewed")     # absence preserves; an explicit true/false wins
TEXT_CURATED = ("review", "note")       # empty/absent preserves; a non-empty string wins


def _empty(v):
    return v is None or v is False or v == ""


def merge_curated(winner, loser):
    """winner won the timestamp race; return it but rescue any curated field it
    would blank out from the loser. Booleans (flag, reviewed) honor an explicit
    key — so un-flag / un-review propagate — and only preserve on a missing key;
    text fields (review, note) rescue on empty-or-absent."""
    out = dict(winner)
    for k in BOOL_CURATED:
        if k not in out and loser.get(k):
            out[k] = loser[k]
    for k in TEXT_CURATED:
        if _empty(out.get(k)) and not _empty(loser.get(k)):
            out[k] = loser[k]
    return out


def merge(store, inc):
    tomb = {d.get("id") for d in store["deleted"] if d.get("id")}
    for d in inc.get("deleted") or []:
        rid = d.get("id")
        if rid and rid not in tomb:
            store["deleted"].append({"id": rid, "t": d.get("t", 0)})
            tomb.add(rid)
    for ent in ENTITIES:
        cur = {r["id"]: r for r in store[ent] if r.get("id")}
        for r in inc.get(ent) or []:
            rid = r.get("id")
            if not rid or rid in tomb:
                continue
            old = cur.get(rid)
            if old is None:
                cur[rid] = r
            elif rec_time(r) > rec_time(old):            # incoming wins on time
                cur[rid] = merge_curated(r, old)         # ...but curation survives
            else:                                        # server wins ties, still absorbs curation
                cur[rid] = merge_curated(old, r)
        store[ent] = sorted(
            (r for r in cur.values() if r["id"] not in tomb),
            key=lambda r: -(r.get("ts") or 0))
    seen = {(d.get("t"), d.get("m"), d.get("k")) for d in store["drills"]}
    for d in inc.get("drills") or []:
        key = (d.get("t"), d.get("m"), d.get("k"))
        if key not in seen:
            store["drills"].append(d)
            seen.add(key)
    store["drills"] = store["drills"][-8000:]
    store["deleted"] = store["deleted"][-500:]
    return store


def save_store(store):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    raw = json.dumps(store).encode()
    atomic_write(STORE, raw)
    atomic_write(os.path.join(BACKUP_DIR, "store-%s.json" % time.strftime("%Y%m%d-%H")), raw)
    snaps = sorted(glob.glob(os.path.join(BACKUP_DIR, "store-2*.json")))
    for old in snaps[:-SNAP_KEEP]:
        os.remove(old)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/backup":
            return self._json(200, load_store())
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/backup":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX_BYTES:
            return self._json(413, {"error": "bad size"})
        raw = self.rfile.read(n)
        try:
            data = json.loads(raw)
        except ValueError:
            return self._json(400, {"error": "invalid json"})
        if not isinstance(data, dict) or not any(
                k in data for k in ("hands", "tourneys", "sessions", "drills", "deleted")):
            return self._json(400, {"error": "not a pokerlog payload"})
        store = merge(load_store(), data)
        save_store(store)
        dev = "".join(ch for ch in str(data.get("device") or "") if ch.isalnum() or ch in "-_")[:40]
        if dev:
            atomic_write(os.path.join(BACKUP_DIR, "pokerlog-dev-%s.json" % dev), raw)
        self._json(200, {
            "ok": True, "savedAt": time.strftime("%H:%M"),
            "hands": len(store["hands"]), "tourneys": len(store["tourneys"]),
            "sessions": len(store["sessions"]), "drills": len(store["drills"]),
            "store": store,
        })


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8088)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.bind, args.port), Handler)
    print("serving %s on http://%s:%d (canonical -> %s)" % (APP_DIR, args.bind, args.port, STORE))
    srv.serve_forever()
