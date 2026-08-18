// ===========================================================================
// POSTFLOP AUDITOR — adversarial, at scale, across every street.
//
// The recurring engine bug David keeps catching by eye (non-nut flush, the 99
// "value bet", the river range) is ALWAYS the same error: the engine judged
// VALUE / a RAISE off raw equity vs the *current* range, instead of equity vs
// the range that actually CONTINUES (calls a bet / calls a raise). High equity
// built on hands that fold to your bet is *showdown* value, not *betting* value.
//
// This tool finds every remaining instance at once. For hundreds of thousands
// of random spots (flop/turn/river, both positions, varied boards/hands/lines)
// it computes — at high trial counts — hero's equity vs the properly conditioned
// CONTINUING range, derives the principled verdict, compares it to the engine's
// recommendation, and flags + classifies the disagreements.
//
// Ground truth = equity-vs-the-right-range (rigorous), NOT a solver. So it
// catches equity/range-logic errors (the common, impactful class — exactly what
// David finds), not equilibrium-mixing subtleties (those need a real solver).
//
// Run:  node tools/audit_postflop.js [spots=40000] [workers=18]
// ===========================================================================
'use strict';
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

function loadEngine() {
  global.window = global;
  require(path.join(__dirname, 'app/charts.js'));
  require(path.join(__dirname, 'app/nash.js'));
  require(path.join(__dirname, 'app/poker.js'));
  require(path.join(__dirname, 'app/postflop.js'));
  window.Poker.init(window.POKER_DATA);
  return { P: window.Poker, PF: window.Postflop, H: require(path.join(__dirname, 'app/handeval.js')) };
}

// ---- a self-contained spot generator (independent of the drill UI) ----
const SUITS = ['s', 'h', 'd', 'c'], RANKS = '23456789TJQKA'.split('');
const POS = ['EP', 'MP', 'CO', 'BTN'];
function rnd(n) { return (Math.random() * n) | 0; }
function fullDeck() { const d = []; for (const r of RANKS) for (const s of SUITS) d.push(r + s); return d; }
function deal(deck, n, used) {
  const out = [];
  while (out.length < n) { const c = deck[rnd(deck.length)]; if (!used.has(c)) { used.add(c); out.push(c); } }
  return out;
}

// villain range bands by spot type (mirrors the drill's RANGES)
const BANDS = {
  blindDefend: [0.03, 0.45], coldCall: [0.03, 0.12], openerVs3bet: [0.02, 0.15], opener: [0.02, 0.22]
};
// per-street continue weights — used both to BUILD the line-conditioned range
// and to derive the calling/continuing sub-ranges.
function makeAudit() {
  const { P, PF, H } = loadEngine();
  const HERO_BANDS = { ip: [0.02, 0.40], oop: [0.03, 0.52] };

  function classCat(c1, c2, board, upto) { return PF.classifyFlop([c1, c2], board.slice(0, upto)).category; }

  // weights for "what CONTINUES" in different senses
  const CALL_W = { value: 0.90, medium: 0.55, draw: 0.70, overs: 0.25, airdraw: 0.25, air: 0.10 }; // calls a bet (draws call pre-river)
  const RIVER_CALL_W = { value: 0.92, medium: 0.55, overs: 0.12, airdraw: 0.12, air: 0.05, draw: 0.4 }; // calls a river bet (no draws)
  const RAISE_CONT_W = { value: 0.85, medium: 0.20, draw: 0.50, overs: 0.05, airdraw: 0.10, air: 0.05 }; // continues vs a raise

  function genSpot() {
    const street = ['flop', 'turn', 'river'][rnd(3)];
    const nBoard = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    const role = Math.random() < 0.5 ? 'aggressor' : 'defender';
    const pot3 = Math.random() < 0.25;
    const potType = pot3 ? '3bet' : 'srp';
    const pos = Math.random() < 0.5 ? 'ip' : 'oop';
    // villain range band
    const band = role === 'defender' ? (pos === 'ip' ? BANDS.coldCall : BANDS.blindDefend)
      : (pot3 ? BANDS.openerVs3bet : BANDS.opener);
    const combos = P.bandCombos(band[0], band[1]);
    if (!combos.length) return null;
    // hero hand from a plausible range
    const used = new Set();
    const hb = HERO_BANDS[pos]; const heroLabel = pickLabel(P, hb[0], hb[1]); if (!heroLabel) return null;
    const hole = labelToCards(heroLabel, used); if (!hole) return null;
    const deck = fullDeck();
    const board = deal(deck, nBoard, used);
    const cls = PF.classifyFlop(hole, board);
    const texF = PF.textureOf(board.slice(0, 3));
    const edge = role === 'aggressor'
      ? PF.preflopEdge({ potType: potType, callerBlind: pos === 'ip' ? false : true, openerEarly: false }, texF)
      : PF.defenderEdge(texF);
    // betting line + node
    const barrels = street === 'flop' ? 0 : (Math.random() < 0.6 ? 2 : 1);
    const faceBet = Math.random() < 0.5;
    const node = faceBet ? (pos === 'ip' ? 'ipBet' : 'oopBet') : (pos === 'ip' ? 'ipCheck' : 'oopFirst');
    const pot = potType === '3bet' ? (street === 'flop' ? 18 : street === 'turn' ? 26 : 30) : (street === 'flop' ? 6 : street === 'turn' ? 14 : 22);
    const fracs = [1 / 3, 0.5, 0.66, 1];
    const frac = faceBet ? fracs[rnd(fracs.length)] : null;
    const bet = faceBet ? Math.round(pot * frac * 2) / 2 : null;
    const price = faceBet ? PF.requiredEquity(bet, pot) : null;
    const villBet = role === 'defender';

    // line-conditioning: villain bet/called flop, then (barrel|check) turn
    const sw = (cat, betting) => betting ? PF.BET_FREQ[cat] : PF.CONT_FREQ[cat];
    function lineW(c1, c2, b) {
      if (street === 'flop') return 1;
      let w = sw(classCat(c1, c2, b, 3), villBet);
      if (street === 'river') w *= (barrels >= 2 ? sw(classCat(c1, c2, b, 4), villBet) : PF.CHECK_FREQ[classCat(c1, c2, b, 4)]);
      return w;
    }
    const RC = (c1, c2, b) => PF.classifyFlop([c1, c2], b).category;

    // eqShow: vs the whole conditioned range (their action applied)
    const RIVER_BET_W = { value: 0.90, medium: 0.22, overs: 0.42, airdraw: 0.45, air: 0.45, draw: 0.60 };
    const RIVER_CHK_W = { value: 0.30, medium: 0.80, overs: 0.70, airdraw: 0.70, air: 0.70, draw: 0.50 };
    const showCond = (c1, c2, b) => {
      let w = lineW(c1, c2, b);
      if (street === 'river') w *= (faceBet ? RIVER_BET_W : RIVER_CHK_W)[RC(c1, c2, b)];
      else if (faceBet) w *= PF.BET_FREQ[RC(c1, c2, b)];
      else w *= PF.CHECK_FREQ[RC(c1, c2, b)];
      return w;
    };
    // eqCall: vs the range that CALLS a bet (made hands; draws pre-river)
    const callW = street === 'river' ? RIVER_CALL_W : CALL_W;
    const callCond = (c1, c2, b) => lineW(c1, c2, b) * callW[RC(c1, c2, b)];
    // eqCallRaise: vs the range that continues vs a RAISE (strong only)
    const raiseCond = (c1, c2, b) => lineW(c1, c2, b) * RAISE_CONT_W[RC(c1, c2, b)];

    const nTr = street === 'river' ? 1800 : 1400;
    const eqShow = H.equityVsRange(hole, board, combos, { n: nTr, condition: showCond });
    const eqCall = H.equityVsRange(hole, board, combos, { n: nTr, condition: callCond });
    const eqRaise = faceBet ? H.equityVsRange(hole, board, combos, { n: nTr, condition: raiseCond }) : null;

    const tier = PF.handTier(cls, eqShow);
    const ctx = { eq: eqShow, eqCall: eqCall, price: price, frac: frac, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: PF.textureOf(board).wet, pos: pos, potType: potType, street: street, tier: tier };
    const fn = PF.flopDecide(node, ctx);
    const mix = PF.flopMix(node, ctx);
    const top = mix.slice().sort((a, b) => b.f - a.f)[0];

    const sc = {}; board.forEach(c => sc[c[1]] = (sc[c[1]] || 0) + 1);
    const maxSuit = Math.max.apply(null, Object.values(sc));
    return { street, node, pos, role, potType, cls, made: cls.made, tier, texMono: PF.textureOf(board).suit === 'mono', wet: ctx.wet,
      flushBoard: maxSuit >= 4, heroFlush: cls.flush, isValue: cls.category === 'value',
      eqShow, eqCall, eqRaise, price, engineIdeal: fn.ideal, engineTop: top.act, engineRaiseF: (mix.find(e => e.act === 'raise') || { f: 0 }).f, engineBetF: (mix.find(e => e.act === 'bet') || { f: 0 }).f,
      hole, board };
  }

  // ---- the principled verdict + flag classification ----
  function audit(s) {
    const flags = [];
    const bets = s.engineIdeal === 'bet' || s.engineBetF >= 0.5;
    const raises = s.engineIdeal === 'raise' || s.engineRaiseF >= 0.5;
    if (s.price == null) {                                   // betting node
      if (s.isValue && s.eqShow >= 0.45 && bets) {
        // (1) RIVER: terminal — value needs WORSE to call. eqCall low = showdown, not value.
        if (s.street === 'river' && s.eqCall < 0.45)
          flags.push({ kind: 'river_value_bet_no_caller', street: s.street, made: s.made, eqShow: s.eqShow, eqCall: s.eqCall, note: 'river value-bet but no worse hand calls (showdown value, not betting value)' });
        // (2) FLUSH BOARD, hero has no flush — the calling range is flushes that beat you.
        else if (s.flushBoard && !s.heroFlush && s.eqCall < 0.42)
          flags.push({ kind: 'value_bet_into_flushes', street: s.street, made: s.made, eqShow: s.eqShow, eqCall: s.eqCall, mono: true, note: 'value-bets a non-flush made hand on a 4-flush board (called only by flushes)' });
      }
    } else {                                                 // facing a bet
      // (3) value-RAISE into a range that continues only with better
      if (raises && s.eqRaise != null && s.eqRaise < 0.45 && s.eqShow >= 0.5)
        flags.push({ kind: 'over_value_raise', street: s.street, made: s.made, eqShow: s.eqShow, eqRaise: s.eqRaise, mono: s.texMono, note: 'value-raises but only better continues (folds out worse)' });
      // (4) price sanity
      if (s.engineIdeal === 'call' && s.eqShow < s.price - 0.08)
        flags.push({ kind: 'light_call', street: s.street, made: s.made, eqShow: s.eqShow, price: s.price, note: 'calls below the price' });
      if (s.engineIdeal === 'fold' && s.eqShow > s.price + 0.12)
        flags.push({ kind: 'over_fold', street: s.street, made: s.made, eqShow: s.eqShow, price: s.price, note: 'folds a hand the price says to continue' });
    }
    return flags;
  }

  return { genSpot, audit };
}

// hero/villain label helpers (need P for the rank ordering)
let _sorted = null;
function pickLabel(P, lo, hi) {
  if (!_sorted) _sorted = window.POKER_DATA.ranking.map(r => ({ h: r.h, p: P.openPct(r.h, 100) })).filter(x => x.p != null).sort((a, b) => a.p - b.p);
  const pool = _sorted.filter(x => x.p > lo && x.p <= hi);
  return pool.length ? pool[(Math.random() * pool.length) | 0].h : null;
}
function labelToCards(label, used) {
  const r1 = label[0], r2 = label[1], suited = label[2] === 's', pair = label.length === 2;
  for (let tries = 0; tries < 20; tries++) {
    let c1, c2;
    if (pair) { const a = SUITS[rnd(4)]; let b = SUITS[rnd(4)]; while (b === a) b = SUITS[rnd(4)]; c1 = r1 + a; c2 = r2 + b; }
    else if (suited) { const s = SUITS[rnd(4)]; c1 = r1 + s; c2 = r2 + s; }
    else { const a = SUITS[rnd(4)]; let b = SUITS[rnd(4)]; while (b === a) b = SUITS[rnd(4)]; c1 = r1 + a; c2 = r2 + b; }
    if (!used.has(c1) && !used.has(c2)) { used.add(c1); used.add(c2); return [c1, c2]; }
  }
  return null;
}

// ====================== worker ======================
if (!isMainThread) {
  const { genSpot, audit } = makeAudit();
  const N = workerData.n;
  const counts = { spots: 0, byKind: {}, byStreet: {} };
  const samples = {};
  for (let i = 0; i < N; i++) {
    const s = genSpot(); if (!s) continue;
    counts.spots++;
    const flags = audit(s);
    for (const f of flags) {
      counts.byKind[f.kind] = (counts.byKind[f.kind] || 0) + 1;
      const sk = f.kind + ':' + f.street; counts.byStreet[sk] = (counts.byStreet[sk] || 0) + 1;
      if (!samples[f.kind]) samples[f.kind] = [];
      if (samples[f.kind].length < 8) samples[f.kind].push({ f, hole: s.hole, board: s.board, eng: s.engineIdeal, node: s.node, pot: s.potType });
    }
  }
  parentPort.postMessage({ counts, samples });
}

// ====================== main ======================
if (isMainThread) {
  const total = parseInt(process.argv[2] || '40000', 10);
  const nWorkers = parseInt(process.argv[3] || String(Math.max(1, Math.min(18, os.cpus().length - 2))), 10);
  const per = Math.ceil(total / nWorkers);
  console.log(`auditing ~${total} postflop spots across ${nWorkers} workers (${per}/worker)...`);
  const t0 = Date.now();
  const agg = { spots: 0, byKind: {}, byStreet: {} };
  const allSamples = {};
  let done = 0;
  for (let w = 0; w < nWorkers; w++) {
    const worker = new Worker(__filename, { workerData: { n: per } });
    worker.on('message', m => {
      agg.spots += m.counts.spots;
      for (const k in m.counts.byKind) agg.byKind[k] = (agg.byKind[k] || 0) + m.counts.byKind[k];
      for (const k in m.counts.byStreet) agg.byStreet[k] = (agg.byStreet[k] || 0) + m.counts.byStreet[k];
      for (const k in m.samples) { allSamples[k] = (allSamples[k] || []).concat(m.samples[k]).slice(0, 12); }
      if (++done === nWorkers) report();
    });
    worker.on('error', e => { console.error('worker error', e); });
  }
  function report() {
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`\n=== AUDIT COMPLETE — ${agg.spots} spots in ${secs}s ===\n`);
    const kinds = Object.keys(agg.byKind).sort((a, b) => agg.byKind[b] - agg.byKind[a]);
    if (!kinds.length) { console.log('No disagreements found — the engine matched the equity-vs-continuing-range verdict on every spot. Clean.'); return; }
    console.log('FLAGGED PATTERNS (engine recommendation vs the principled equity verdict):');
    for (const k of kinds) {
      const rate = (100 * agg.byKind[k] / agg.spots).toFixed(2);
      console.log(`\n  ${k}: ${agg.byKind[k]} (${rate}% of spots)`);
      Object.keys(agg.byStreet).filter(s => s.startsWith(k + ':')).forEach(s => console.log(`     ${s.split(':')[1]}: ${agg.byStreet[s]}`));
      (allSamples[k] || []).slice(0, 5).forEach(ex => {
        const f = ex.f;
        console.log(`     e.g. ${ex.hole.join('')} on ${ex.board.join('')} [${f.street}/${ex.node}] eng=${ex.eng}` +
          (f.eqCall != null ? ` eqShow=${Math.round(f.eqShow * 100)}% eqCall=${Math.round(f.eqCall * 100)}%` : '') +
          (f.eqRaise != null ? ` eqShow=${Math.round(f.eqShow * 100)}% eqRaise=${Math.round(f.eqRaise * 100)}%` : '') +
          (f.price != null ? ` eq=${Math.round(f.eqShow * 100)}% price=${Math.round(f.price * 100)}%` : '') +
          (f.mono ? ' [mono]' : ''));
      });
    }
    console.log('\n(ground truth = equity vs the properly conditioned continuing range, not a solver — review each pattern: is the engine wrong, or is the equity model too coarse for that spot?)');
  }
}
