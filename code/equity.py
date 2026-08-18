#!/usr/bin/env python3
"""Compute push/fold training data for the Poker Log app — NO external deps.

Outputs tools/app/charts.js with:
  - ranking: 169 starting hands ordered by a short-stack JAM score, with each
    hand's raw equity-vs-a-random-hand and combo weight.
  - matchups: common all-in equities (computed, not recalled) for the pocket card.

The jam score = equity-vs-random plus small, documented bonuses that float pairs
and suited hands up toward where real Nash push/fold charts put them (their value
comes from fold equity + flips, which raw equity-vs-random understates). This is a
TRAINING approximation, not a solver. Exact spots: verify in GTO Wizard / SnapShove.

Run:  python3 tools/equity.py            (default samples)
      python3 tools/equity.py 8000 30000 (rank samples, matchup samples)
"""
import os
import random
import sys
from collections import Counter

random.seed(42)
RANKS = "23456789TJQKA"
RVAL = {r: i + 2 for i, r in enumerate(RANKS)}      # '2'->2 ... 'A'->14
RORD = "AKQJT98765432"                                # display order, best first
FULL_DECK = [(RVAL[r], s) for r in RANKS for s in range(4)]


def eval7(cards):
    """Return a comparable tuple for the best 5-card hand out of 7."""
    ranks = sorted((c[0] for c in cards), reverse=True)
    rc = Counter(c[0] for c in cards)
    sc = Counter(c[1] for c in cards)
    cand = []

    def best_straight(rset):
        rs = set(rset)
        if 14 in rs:
            rs.add(1)                                 # wheel
        for top in range(14, 4, -1):
            if all((top - i) in rs for i in range(5)):
                return top
        return 0

    for suit, cnt in sc.items():
        if cnt >= 5:
            fr = [c[0] for c in cards if c[1] == suit]
            sf = best_straight(fr)
            if sf:
                cand.append((8, sf))
            cand.append((5,) + tuple(sorted(fr, reverse=True)[:5]))

    by = sorted(rc.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    if by[0][1] == 4:
        q = by[0][0]
        cand.append((7, q, max(r for r in ranks if r != q)))
    if by[0][1] == 3 and len(by) > 1 and by[1][1] >= 2:
        cand.append((6, by[0][0], by[1][0]))
    st = best_straight(ranks)
    if st:
        cand.append((4, st))
    if by[0][1] == 3:
        t = by[0][0]
        cand.append((3, t) + tuple(r for r in ranks if r != t)[:2])
    if by[0][1] == 2 and len(by) > 1 and by[1][1] == 2:
        hp, lp = by[0][0], by[1][0]
        cand.append((2, hp, lp, max(r for r in ranks if r not in (hp, lp))))
    if by[0][1] == 2:
        p = by[0][0]
        cand.append((1, p) + tuple(r for r in ranks if r != p)[:3])
    cand.append((0,) + tuple(ranks[:5]))
    return max(cand)


def label_cards(label):
    """Canonical concrete cards for a hand label: AA, AKs, AKo."""
    a, b = label[0], label[1]
    if a == b:
        return [(RVAL[a], 0), (RVAL[b], 1)]
    if label[2] == "s":
        return [(RVAL[a], 0), (RVAL[b], 0)]
    return [(RVAL[a], 0), (RVAL[b], 1)]


def eq_vs_random(hero, n):
    """Equity of a 2-card hero hand vs one random hand over random boards."""
    used = set(hero)
    deck = [c for c in FULL_DECK if c not in used]
    wins = ties = 0
    for _ in range(n):
        s = random.sample(deck, 7)
        opp, board = s[:2], s[2:]
        h = eval7(hero + board)
        o = eval7(opp + board)
        if h > o:
            wins += 1
        elif h == o:
            ties += 1
    return (wins + ties / 2) / n


def eq_head_to_head(hero, vill, n):
    used = set(hero) | set(vill)
    deck = [c for c in FULL_DECK if c not in used]
    wins = ties = 0
    for _ in range(n):
        board = random.sample(deck, 5)
        h = eval7(hero + board)
        o = eval7(vill + board)
        if h > o:
            wins += 1
        elif h == o:
            ties += 1
    return (wins + ties / 2) / n


def all_hands():
    hands = []
    for i, a in enumerate(RORD):
        for j, b in enumerate(RORD):
            if i == j:
                hands.append((a + b, 6))                     # pair: 6 combos
            elif i < j:
                hands.append((a + b + "s", 4))               # suited: 4 combos
            else:
                hands.append((b + a + "o", 12))              # offsuit: 12 combos
    seen, out = set(), []
    for h, w in hands:
        if h not in seen:
            seen.add(h)
            out.append((h, w))
    return out


def jam_score(label, eq):
    """Equity-vs-random nudged toward push/fold reality (documented heuristic)."""
    is_pair = label[0] == label[1]
    is_suited = label.endswith("s")
    score = eq
    if is_pair:
        score += 0.070                                       # fold equity + flip value (pairs jam wide)
    if is_suited:
        score += 0.020                                       # playability / nut potential
    if not is_pair:                                          # connectedness
        gap = abs(RVAL[label[0]] - RVAL[label[1]])
        if gap <= 2:
            score += 0.012 if is_suited else 0.006
        if label[0] == "A" or label[1] == "A":
            score += 0.010                                   # ace blocker
    return score


def resolve_matchup(hero_label, vill_label):
    """Concrete distinct cards for two hands, honoring suited/offsuit."""
    hero = label_cards(hero_label)
    for s0 in range(4):
        for s1 in range(4):
            if vill_label[0] == vill_label[1]:
                vc = [(RVAL[vill_label[0]], s0), (RVAL[vill_label[1]], s1)]
            elif vill_label[2] == "s":
                vc = [(RVAL[vill_label[0]], s0), (RVAL[vill_label[1]], s0)]
                s1 = s0
            else:
                if s0 == s1:                    # offsuit must use distinct suits
                    continue
                vc = [(RVAL[vill_label[0]], s0), (RVAL[vill_label[1]], s1)]
            if len(set(hero + vc)) == 4 and (vill_label[1] != vill_label[0] or s0 != s1):
                return hero, vc
    raise ValueError("cannot place " + hero_label + " vs " + vill_label)


def main():
    n_rank = int(sys.argv[1]) if len(sys.argv) > 1 else 6000
    n_match = int(sys.argv[2]) if len(sys.argv) > 2 else 25000

    eq = {}
    for label, w in all_hands():
        eq[label] = eq_vs_random(label_cards(label), n_rank)

    # Smooth out Monte-Carlo noise: within each kicker family (e.g. all A-x suited)
    # and down the pairs, a stronger card must never rank below a weaker one.
    # Reassign each family's equities in sorted order — same values, monotonic.
    def smooth(members):                       # members ordered strongest -> weakest
        vals = sorted((eq[m] for m in members), reverse=True)
        for m, v in zip(members, vals):
            eq[m] = v

    smooth([r + r for r in RORD])              # pairs AA..22
    for hi in RORD:
        for cls in ("s", "o"):
            fam = [hi + lo + cls for lo in RORD if RVAL[lo] < RVAL[hi]]
            if fam:
                smooth(fam)

    weights = dict(all_hands())
    rows = [{"h": h, "eq": round(eq[h], 4), "w": weights[h], "s": jam_score(h, eq[h])}
            for h in weights]
    rows.sort(key=lambda r: r["s"], reverse=True)

    # sanity
    top = rows[0]["h"]
    bottom = rows[-1]["h"]
    assert top == "AA", "expected AA on top, got " + top
    assert rows[0]["eq"] > 0.80, "AA equity looks wrong: %s" % rows[0]["eq"]
    eqmap = {r["h"]: r["eq"] for r in rows}
    assert eqmap["72o"] < 0.36, "72o equity looks wrong: %s" % eqmap["72o"]

    matchup_specs = [
        ("AA", "KK"), ("AA", "AKs"), ("KK", "QQ"), ("QQ", "AKo"), ("JJ", "AKo"),
        ("TT", "AKo"), ("99", "AJs"), ("AKo", "22"), ("AKs", "QJs"), ("AKo", "A5o"),
        ("AQo", "AJo"), ("KQs", "ATo"), ("88", "77"), ("AKo", "KQo"), ("JJ", "22"),
        ("QQ", "99"), ("99", "87s"), ("TT", "A8o"), ("99", "65s"),
    ]
    matchups = []
    for a, b in matchup_specs:
        hero, vill = resolve_matchup(a, b)
        eqa = eq_head_to_head(hero, vill, n_match)
        matchups.append({"a": a, "b": b, "eqA": round(eqa * 100, 1)})

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app", "charts.js")
    ranking = [{"h": r["h"], "eq": r["eq"], "w": r["w"]} for r in rows]
    import json
    with open(out, "w") as f:
        f.write("// generated by tools/equity.py — approximate push/fold training data.\n")
        f.write("// jam order = equity-vs-random + documented pair/suited/ace bonuses.\n")
        f.write("// NOT a solver; verify exact spots in GTO Wizard / SnapShove.\n")
        f.write("window.POKER_DATA = ")
        f.write(json.dumps({"ranking": ranking, "matchups": matchups,
                            "nRank": n_rank, "nMatch": n_match}, separators=(",", ":")))
        f.write(";\n")

    # cumulative weight for range previews
    tot = sum(r["w"] for r in rows)
    cum, pct = 0, {}
    for r in rows:
        cum += r["w"]
        pct[r["h"]] = cum / tot

    def rng(thresh):
        return [r["h"] for r in rows if pct[r["h"]] <= thresh]

    print("wrote", out)
    print("top 24:", " ".join(r["h"] for r in rows[:24]))
    print("bottom 8:", " ".join(r["h"] for r in rows[-8:]))
    print()
    print("BTN  ~15bb jam (top 28%):", " ".join(rng(0.28)))
    print("CO   ~15bb jam (top 17%):", " ".join(rng(0.175)))
    print("UTG  ~15bb jam (top 8.5%):", " ".join(rng(0.085)))
    print("call vs late ~12bb (top 17%):", " ".join(rng(0.17)))
    print()
    print("matchups:")
    for m in matchups:
        print("  %-4s vs %-4s : %5.1f / %4.1f" % (m["a"], m["b"], m["eqA"], round(100 - m["eqA"], 1)))


if __name__ == "__main__":
    main()
