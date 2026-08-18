#!/usr/bin/env python3
"""Parse poker hand shorthand (see hands/FORMAT.md) into pretty text or JSON.

Usage:
  python3 tools/parse_hands.py hands/2026-06.md [more.md ...]
  python3 tools/parse_hands.py --json hands/2026-06.md
  python3 tools/parse_hands.py --flagged hands/2026-06.md
  echo "- 1/3 co AhKs 300 | open15 c | +20" | python3 tools/parse_hands.py -
"""
import argparse
import json
import re
import sys

POS = {"utg", "utg1", "u1", "u2", "mp", "lj", "hj", "co", "btn", "sb", "bb"}
EXACT_CARDS = re.compile(r"^([2-9TJQKA][shdc]){1,5}$", re.I)
COMBO = re.compile(r"^[2-9TJQKA]{2}[so]?$", re.I)
BOARD = re.compile(r"^\(([^)]*)\)\s*(.*)$")
DATE_HEADING = re.compile(r"^##+\s+(\d{4}-\d{2}-\d{2})")
STREETS = ["pre", "flop", "turn", "river"]
SUIT = {"s": "♠", "h": "♥", "d": "♦", "c": "♣"}


def pretty_cards(s):
    if s and EXACT_CARDS.match(s):
        return "".join(s[i].upper() + SUIT[s[i + 1].lower()] for i in range(0, len(s), 2))
    return (s or "").upper()


def parse_line(line, date=None):
    raw = line.strip()
    flag = raw.endswith("!!")
    if flag:
        raw = raw[:-2].rstrip()
    hand = {"raw": line.strip(), "date": date, "flag": flag, "parsed": False}
    parts = [p.strip() for p in raw.split("|")]
    head = parts[0].split()
    if not head:
        return hand
    i = 0
    if head[0].lower() == "mtt":
        hand["game"] = "mtt"
        i = 1
        if i < len(head) and head[i].lower().endswith("bb"):
            hand["eff"] = head[i][:-2]
            i += 1
    else:
        hand["game"] = "cash"
        hand["stakes"] = head[0]
        i = 1
    if i < len(head) and head[i].lower() in POS:
        hand["pos"] = head[i].lower()
        i += 1
    if i < len(head) and (EXACT_CARDS.match(head[i]) or COMBO.match(head[i])):
        hand["cards"] = head[i]
        i += 1
    if i < len(head):
        hand["eff"] = head[i]
    if len(parts) > 1 and parts[1]:
        streets = []
        for idx, seg in enumerate(s.strip() for s in parts[1].split("/")):
            m = BOARD.match(seg)
            board, action = (m.group(1), m.group(2).strip()) if m else (None, seg)
            name = STREETS[idx] if idx < len(STREETS) else "street%d" % idx
            streets.append({"street": name, "board": board, "action": action})
        hand["streets"] = streets
    if len(parts) > 2 and parts[2]:
        m = re.match(r"^[+-]?\d+(\.\d+)?", parts[2])
        if m:
            hand["result"] = float(m.group(0))
    if len(parts) > 3 and parts[3]:
        hand["note"] = parts[3]
    hand["parsed"] = "pos" in hand or "cards" in hand
    return hand


def iter_hands(text):
    date = None
    for line in text.splitlines():
        t = line.strip()
        m = DATE_HEADING.match(t)
        if m:
            date = m.group(1)
            continue
        if t.startswith("- "):
            yield parse_line(t[2:], date)


def pretty(hand):
    if not hand["parsed"]:
        return "  (unparsed) %s" % hand["raw"]
    bits = [hand.get("date") or "????-??-??"]
    bits.append(hand["game"] + (" " + hand.get("stakes", "") if hand["game"] == "cash" else ""))
    if "pos" in hand:
        bits.append(hand["pos"].upper())
    if "cards" in hand:
        bits.append(pretty_cards(hand["cards"]))
    if "eff" in hand:
        bits.append("eff " + str(hand["eff"]) + ("bb" if hand["game"] == "mtt" else ""))
    if "result" in hand:
        bits.append("net %+g" % hand["result"])
    if hand["flag"]:
        bits.append("⚑ review")
    out = ["  ".join(b for b in bits if b.strip())]
    for s in hand.get("streets", []):
        board = (pretty_cards(s["board"]) + " | ") if s["board"] else ""
        out.append("  %-5s: %s%s" % (s["street"], board, s["action"]))
    if "note" in hand:
        out.append("  note : %s" % hand["note"])
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="markdown files of hands, or - for stdin")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of pretty text")
    ap.add_argument("--flagged", action="store_true", help="only hands flagged with !!")
    args = ap.parse_args()

    hands = []
    for f in args.files:
        text = sys.stdin.read() if f == "-" else open(f, encoding="utf-8").read()
        hands.extend(iter_hands(text))
    if args.flagged:
        hands = [h for h in hands if h["flag"]]

    if args.json:
        json.dump(hands, sys.stdout, indent=2, ensure_ascii=False)
        print()
    else:
        for h in hands:
            print(pretty(h))
            print()
        bad = sum(1 for h in hands if not h["parsed"])
        flagged = sum(1 for h in hands if h["flag"])
        print("-- %d hands, %d flagged, %d unparsed" % (len(hands), flagged, bad))


if __name__ == "__main__":
    main()
