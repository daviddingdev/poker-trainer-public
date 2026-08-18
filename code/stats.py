#!/usr/bin/env python3
"""Tournament ROI and cash-session stats from tournaments/*.csv."""
import csv
import os
import sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tournaments")


def num(x):
    try:
        return float(x or 0)
    except ValueError:
        return 0.0


def read(path):
    if not os.path.exists(path):
        return None
    with open(path, newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if any((v or "").strip() for v in r.values())]


def tournaments(path):
    rows = read(path)
    if rows is None:
        return print(f"tournaments : file missing ({path})")
    if not rows:
        return print("tournaments : no data yet")
    invested = sum(num(r["buyin"]) * max(num(r["entries"]), 1) for r in rows)
    returned = sum(num(r["cash"]) for r in rows)
    net = returned - invested
    itm = sum(1 for r in rows if num(r["cash"]) > 0)
    roi = (net / invested * 100) if invested else 0.0
    print(f"tournaments : {len(rows)} entered | invested ${invested:,.0f} | "
          f"returned ${returned:,.0f} | net ${net:+,.0f} | ROI {roi:.1f}% | ITM {itm}/{len(rows)}")
    best = max(rows, key=lambda r: num(r["cash"]) - num(r["buyin"]) * max(num(r["entries"]), 1))
    if num(best["cash"]) > 0:
        print(f"best score  : {best['date']} {best['venue']} — ${num(best['cash']):,.0f} ({best['event'] or '?'})")


def sessions(path):
    rows = read(path)
    if rows is None:
        return print(f"sessions    : file missing ({path})")
    if not rows:
        return print("sessions    : no data yet")
    net = sum(num(r["cashout"]) - num(r["buyin"]) for r in rows)
    hours = sum(num(r["hours"]) for r in rows)
    rate = net / hours if hours else 0.0
    print(f"cash        : {len(rows)} sessions | {hours:.1f} hrs | net ${net:+,.0f} | ${rate:,.0f}/hr")


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else BASE
    tournaments(os.path.join(base, "tournaments.csv"))
    sessions(os.path.join(base, "sessions.csv"))
