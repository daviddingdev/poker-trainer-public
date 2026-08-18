// Study tab: jam/fold Drill + Pocket Card. Depends on window.Poker + window.POKER_DATA.
// Grading lives in poker.js; this is UI. Loaded after the main app script.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SU = { s: '♠', h: '♥', d: '♦', c: '♣' };
  var RANKS = '23456789TJQKA';
  var RORD = 'AKQJT98765432';
  var LS = 'pokerlog.train';
  var P = window.Poker, DATA = window.POKER_DATA, PF = window.Postflop, H = window.HandEval;
  var sorted = [];   // [{label, pct}] ascending by percentile (strongest first)

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }
  function cardHtml(c) {
    if (!c) return '';
    var r = c[0].toUpperCase(), s = c[1].toLowerCase();
    return '<span class="pc"><b>' + esc(r) + '</b><span class="suit-' + s + '">' + SU[s] + '</span></span>';
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- persisted drill stats ---------- */
  function freshStats() { return { v: 2, att: 0, cor: 0, mix: 0, streak: 0, best: 0, byMode: {}, byDepth: {}, misses: [], mode: 'pf' }; }
  var stats;
  try { stats = Object.assign(freshStats(), JSON.parse(localStorage.getItem(LS) || '{}')); }
  catch (e) { stats = freshStats(); }
  if (!stats.byMode) stats.byMode = {};
  if (!stats.byDepth) stats.byDepth = {};
  if (!stats.misses) stats.misses = [];
  if (stats.v !== 2) { stats.byDepth = {}; stats.misses = []; stats.v = 2; }  // depth/miss schema changed
  function saveStats() { localStorage.setItem(LS, JSON.stringify(stats)); }

  /* ---------- cards ---------- */
  function cardsFor(label) {        // label -> two concrete cards with random legal suits
    var r1 = label[0], r2 = label[1], s = 'shdc';
    if (label.length === 2) {       // pair
      var a = (Math.random() * 4) | 0, b; do { b = (Math.random() * 4) | 0; } while (b === a);
      return [r1 + s[a], r1 + s[b]];
    }
    if (label[2] === 's') { var q = (Math.random() * 4) | 0; return [r1 + s[q], r2 + s[q]]; }
    var x = (Math.random() * 4) | 0, y; do { y = (Math.random() * 4) | 0; } while (y === x);
    return [r1 + s[x], r2 + s[y]];
  }
  function nearestHand(target) {     // pick one of the hands closest to a target percentile
    var arr = sorted.map(function (h) { return { h: h.label, d: Math.abs(h.pct - target) }; });
    arr.sort(function (a, b) { return a.d - b.d; });
    var k = arr.slice(0, 6);
    return k[(Math.random() * k.length) | 0].h;
  }

  /* ====================== DRILL ====================== */
  var cur = null, mode = stats.mode || 'pf', oddsHard = stats.oddsHard !== false;  // hide draw name by default
  if (mode === 'odds') mode = 'hands';   // Pot odds retired → Full hands; migrate an old saved mode
  var MODES = [{ v: 'pf', t: 'Preflop' }, { v: 'flop', t: 'Flop' }, { v: 'turn', t: 'Turn' }, { v: 'river', t: 'River' }, { v: 'hands', t: 'Full hands' }];
  function spotKey(s) { return [s.kind, (s.blind || '') + (s.pos || s.opener || s.pos3 || ''), s.vseat || '', s.raiser || '', s.depth].join('|'); }
  function rnd(n) { return (Math.random() * n) | 0; }

  // seats: preflop action order EP→BB; postflop order SB→BTN (later = in position)
  var PRE_ORDER = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'];
  var POST_ORDER = ['SB', 'BB', 'EP', 'MP', 'CO', 'BTN'];
  var SEAT_NAME = { EP: 'UTG', MP: 'MP', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };
  function seatsAfter(seat) { return PRE_ORDER.slice(PRE_ORDER.indexOf(seat) + 1); }
  function ipVs(hero, other) { return POST_ORDER.indexOf(hero) > POST_ORDER.indexOf(other) ? 'ip' : 'oop'; }
  function isEarly(pos) { return pos === 'EP' || pos === 'MP'; }
  // aggressive-action label + colour by scenario/depth
  function aggrInfo(s) {
    if (s.kind === 'open' || s.kind === 'iso') return s.depth === 10 ? { w: 'Jam', c: 'jam' } : { w: 'Raise', c: 'raise' };
    if (s.kind === 'bbopt') return { w: 'Raise', c: 'raise' };
    if (s.kind === 'limpRR') return s.depth >= 30 ? { w: '4-bet', c: 'threebet' } : { w: 'Jam', c: 'jam' };
    if (s.kind === 'squeeze') return s.depth >= 30 ? { w: 'Squeeze', c: 'threebet' } : { w: 'Jam', c: 'jam' };
    if (s.kind === 'vs3bet' || s.kind === 'cold3b') return s.depth >= 30 ? { w: '4-bet', c: 'threebet' } : { w: 'Jam', c: 'jam' };
    if (s.kind === 'vs4bet') return { w: '5-bet jam', c: 'jam' };
    return s.depth >= 30 ? { w: '3-bet', c: 'threebet' } : { w: 'Jam', c: 'jam' };  // vs
  }
  function aggrBtn(ai, action) { return '<button class="act ' + ai.c + '" data-a="' + action + '">' + ai.w + '</button>'; }

  function pfStyle() { return stats.pfStyle || 'live'; }
  function pfDepthFocus() { return stats.pfDepth || 'all'; }
  function renderModeSel() {
    $('drillMode').innerHTML = MODES.map(function (m) {
      return '<button data-m="' + m.v + '"' + (m.v === mode ? ' class="on"' : '') + '>' + m.t + '</button>';
    }).join('') + (mode === 'pf'
      ? '<span class="styletog">' +
        '<button data-s="live" class="minitog' + (pfStyle() === 'live' ? ' on' : '') + '">🎲 live deal</button>' +
        '<button data-s="hard" class="minitog' + (pfStyle() === 'hard' ? ' on' : '') + '">🎯 hard spots</button>' +
        '</span><span class="styletog">' +
        '<button data-w="all" class="minitog' + (pfDepthFocus() === 'all' ? ' on' : '') + '">all</button>' +
        '<button data-w="short" class="minitog' + (pfDepthFocus() === 'short' ? ' on' : '') + '">≤30bb</button>' +
        '<button data-w="deep" class="minitog' + (pfDepthFocus() === 'deep' ? ' on' : '') + '">deep 50+</button>' +
        '<button data-w="leak" class="minitog' + (pfDepthFocus() === 'leak' ? ' on' : '') + '" title="30–50bb + facing re-raises — your weak spots">🩹 leak</button>' +
        '<button data-w="jam" class="minitog' + (pfDepthFocus() === 'jam' ? ' on' : '') + '" title="BB facing an open-jam — call or fold, every seat at 8–15bb">🅱️ vs jam</button>' +
        '</span>'
      : (mode === 'flop' || mode === 'turn')
        ? '<span class="styletog">' +
          '<button data-w="all" class="minitog' + (pfDepthFocus() !== 'leak' && pfDepthFocus() !== 'raises' ? ' on' : '') + '">all spots</button>' +
          '<button data-w="leak" class="minitog' + (pfDepthFocus() === 'leak' ? ' on' : '') + '" title="facing aggression — donk bets, check-raises, 2nd barrels, OOP">🩹 leak</button>' +
          '<button data-w="raises" class="minitog' + (pfDepthFocus() === 'raises' ? ' on' : '') + '" title="raise-or-fold reps — facing small bets, the fold/call/RAISE decision">🔼 raises</button>' +
          '</span>'
        : '');
    $('drillMode').onclick = function (e) {
      var tg = e.target.closest('[data-s]');
      if (tg) {
        if (tg.dataset.s !== pfStyle()) { stats.pfStyle = tg.dataset.s; saveStats(); renderModeSel(); newScenario(); }
        return;
      }
      var tw = e.target.closest('[data-w]');
      if (tw) {
        if (tw.dataset.w !== pfDepthFocus()) { stats.pfDepth = tw.dataset.w; saveStats(); renderModeSel(); newScenario(); }
        return;
      }
      var b = e.target.closest('[data-m]'); if (!b) return;
      mode = b.dataset.m; stats.mode = mode; saveStats();
      renderModeSel(); newScenario();
    };
  }

  function dealCards(n) {           // n distinct cards
    var used = {}, out = [];
    while (out.length < n) {
      var c = RANKS[(Math.random() * 13) | 0] + 'shdc'[(Math.random() * 4) | 0];
      if (!used[c]) { used[c] = 1; out.push(c); }
    }
    return out;
  }
  function pickHandForThreshold(t) {
    if (Math.random() < 0.8) {                          // aim near the boundary (hard, decidable)
      var off = (Math.random() * 0.30) - 0.15;
      if (Math.abs(off) < 0.02) off += (off < 0 ? -0.02 : 0.02);
      return nearestHand(clamp(t + off, 0.01, 0.99));
    }
    return sorted[(Math.random() * sorted.length) | 0].label;
  }
  function handInBand(lo, hi) {                          // a hand whose strength percentile is in [lo,hi]
    var pool = sorted.filter(function (h) { return h.pct > lo && h.pct <= hi; });
    if (!pool.length) pool = sorted;
    return pool[rnd(pool.length)].label;
  }
  function dealAvoiding(n, used) {                       // n distinct cards not in `used`
    var u = {}; used.forEach(function (c) { u[c] = 1; });
    var out = [];
    while (out.length < n) { var c = RANKS[rnd(13)] + 'shdc'[rnd(4)]; if (!u[c]) { u[c] = 1; out.push(c); } }
    return out;
  }

  /* ---- preflop scenario builders ---- */
  function attachHand(s, t) { var h = cardsFor(s.label = pickHandForThreshold(t)); s.c1 = h[0]; s.c2 = h[1]; }
  function bandRow(s) {
    if (s.kind === 'vs') return s.blind ? P.blindVsThresholds(s.blind, s.depth, s.opener) : P.vsThresholds(s.depth, s.opener);
    if (s.kind === 'squeeze') {
      if (s.limped) return (s.vseat === 'SB' || s.vseat === 'BB')
        ? P.blindVsThresholds(s.vseat, s.depth, s.opener) : P.vsThresholds(s.depth, s.opener);
      return P.squeezeThresholds(s.depth, isEarly(s.opener) ? 'early' : 'late', s.vseat, s.callers);
    }
    if (s.kind === 'cold3b' || s.kind === 'limpRR') return P.VSCOLD3B[s.depth] || P.VSCOLD3B[30];
    if (s.kind === 'vs4bet') return P.VS4BET[s.depth] || P.VS4BET[100];
    return (P.VS3BET[s.depth] || P.VS3BET[30])[s.pos3];               // vs3bet
  }
  function pfThreshold(s) {
    if (s.kind === 'open') return P.openThreshold(s.pos, s.depth);
    if (s.kind === 'iso') return P.isoThreshold(s.pos, s.depth);
    if (s.kind === 'bbopt') return P.isoThreshold('CO', s.depth);   // BB iso-over-limpers, value-weighted
    if (s.kind === 'calljam') return P.callThreshold(isEarly(s.pos) ? 'early' : 'late', s.depth);
    var r = bandRow(s); return Math.random() < 0.5 ? r.tb : r.call;
  }
  var COPY = ['kind', 'pos', 'opener', 'raiser', 'vseat', 'pos3', 'callers', 'limpers', 'limped', 'blind', 'depth'];
  // 🩹 LEAK MODE — David's weak spots: 30-50bb mid-stack + FACING re-raises
  // (you opened/3-bet and someone came back over the top). These are the
  // continue-or-fold-under-pressure decisions he's least comfortable with;
  // the postflop half (facing c-bets / barrels / check-raises) is handled in
  // scenarioCbet's leak branch. Depth forced mid-stack; kinds are the
  // facing-aggression set only.
  function leakPF() {
    var depth = [30, 30, 50][rnd(3)], roll = Math.random();
    if (roll < 0.46) {                                   // you open, they 3-bet you
      var ho = ['EP', 'MP', 'CO', 'BTN'][rnd(4)], tp = seatsAfter(ho), tb3 = tp[rnd(tp.length)];
      return { mode: 'pf', kind: 'vs3bet', pos: ho, raiser: tb3, pos3: ipVs(ho, tb3), depth: depth };
    }
    if (roll < 0.76) {                                   // open + 3-bet in front, you cold-decide
      var op = ['EP', 'MP', 'CO'][rnd(3)], rs = seatsAfter(op).filter(function (x) { return x !== 'BB'; }), raiser = rs[rnd(rs.length)], hp = seatsAfter(raiser);
      return { mode: 'pf', kind: 'cold3b', opener: op, raiser: raiser, vseat: hp[rnd(hp.length)], depth: depth };
    }
    var h4 = ['MP', 'CO', 'BTN', 'SB', 'BB'][rnd(5)], before = PRE_ORDER.slice(0, PRE_ORDER.indexOf(h4)), op4 = before.length ? before[rnd(before.length)] : 'EP';
    return { mode: 'pf', kind: 'vs4bet', vseat: h4, raiser: op4, pos3: ipVs(h4, op4), depth: 50 };   // you 3-bet, they 4-bet
  }
  function scenarioPF() {
    var s;
    var focusF = pfDepthFocus();
    var pool = stats.misses.filter(function (m) {
      return focusF === 'deep' ? (m.depth || 0) >= 50 : focusF === 'short' ? (m.depth || 99) <= 30 : true;
    });
    if (pool.length && pfDepthFocus() !== 'leak' && pfDepthFocus() !== 'jam' && Math.random() < 0.3) {
      var m = pool[rnd(pool.length)];
      s = { mode: 'pf', replay: true };
      COPY.forEach(function (k) { s[k] = m[k]; });
      // legacy misses predate the seat-explicit fields — backfill so a replayed
      // spot can never show "you're the ?"
      if (s.kind === 'vs' && !s.vseat) {
        var la = seatsAfter(s.opener || 'EP');
        s.vseat = s.blind || la[rnd(la.length)];
        s.blind = (s.vseat === 'SB' || s.vseat === 'BB') ? s.vseat : null;
      }
      if (s.kind === 'squeeze') {
        s.opener = s.opener || 'MP'; s.callers = s.callers || 1;
        if (!s.vseat) s.vseat = 'BB';
        var sgap = PRE_ORDER.indexOf(s.vseat) - PRE_ORDER.indexOf(s.opener) - 1;
        if (!s.limped && (sgap < 1 || s.callers > sgap)) { s.vseat = 'BB'; sgap = PRE_ORDER.indexOf('BB') - PRE_ORDER.indexOf(s.opener) - 1; s.callers = Math.min(s.callers, Math.max(1, sgap)); }
      }
      if (s.kind === 'cold3b' && (!s.raiser || !s.vseat)) {
        s.opener = s.opener || 'MP';
        var rs2 = seatsAfter(s.opener).filter(function (x) { return x !== 'BB'; });
        s.raiser = s.raiser || rs2[rnd(rs2.length)];
        var hp2 = seatsAfter(s.raiser);
        s.vseat = s.vseat || hp2[rnd(hp2.length)];
      }
      if (s.kind === 'vs3bet' && !s.raiser) {
        s.pos = s.pos || 'CO';
        var tp = seatsAfter(s.pos);
        s.raiser = tp[rnd(tp.length)];
        s.pos3 = ipVs(s.pos, s.raiser);
      }
    } else if (pfStyle() === 'live' && window.Dealer && pfDepthFocus() !== 'leak' && pfDepthFocus() !== 'jam') {
      // LIVE DEAL: simulate the whole table; the spot is whatever reaches you.
      // Honest random cards — frequencies emerge from the table model.
      var live = window.Dealer.simulateSpot({ focus: pfDepthFocus() });
      if (live) {
        s = Object.assign({ mode: 'pf' }, live);
        s.label = P.handLabel(s.c1, s.c2);
        return s;
      }
      s = null;                                  // sim failed; fall through to the roll
    }
    if (!s && pfDepthFocus() === 'leak') { s = leakPF(); }   // 🩹 weak-spot focus: 30-50bb facing re-raises
    if (!s && pfDepthFocus() === 'jam') s = { mode: 'pf', kind: 'calljam', pos: P.POS[rnd(P.POS.length)], depth: [8, 10, 12, 15][rnd(4)] };   // 🅱️ vs-jam focus: every spot is a BB call-or-fold
    if (!s) {
      var focus = pfDepthFocus();
      var dpool = focus === 'deep' ? [50, 100] : focus === 'short' ? [10, 20, 30] : [10, 20, 30, 50, 100];
      var depth = dpool[rnd(dpool.length)], roll = Math.random();
      if (focus === 'deep') roll = roll < 0.45 ? roll * 0.78 : 0.74 + (roll - 0.45) * 0.473;   // ~32% raise-war spots
      if (roll < 0.20) s = { mode: 'pf', kind: 'open', pos: P.POS[rnd(P.POS.length)], depth: depth };
      else if (roll < 0.40) {
        // facing an open: hero is a NAMED seat acting after the opener
        var opener = ['EP', 'MP', 'CO', 'BTN', 'SB'][rnd(5)];
        var later = seatsAfter(opener);
        var vseat = later[rnd(later.length)];
        s = { mode: 'pf', kind: 'vs', opener: opener, vseat: vseat,
          blind: (vseat === 'SB' || vseat === 'BB') ? vseat : null, depth: depth };
      }
      else if (roll < 0.54) {
        // squeeze spot with a NAMED hero seat — callers must FIT between opener and hero
        var sqOpener = ['EP', 'MP', 'CO'][rnd(3)];
        var sqRoll = Math.random();
        var sqSeat = sqRoll < 0.5 ? 'BB' : sqRoll < 0.65 ? 'SB'
          : (function () { var f = seatsAfter(sqOpener).filter(function (x) { return x !== 'SB' && x !== 'BB' && PRE_ORDER.indexOf(x) - PRE_ORDER.indexOf(sqOpener) >= 2; }); return f[rnd(f.length)] || 'BB'; })();
        var sqGap = PRE_ORDER.indexOf(sqSeat) - PRE_ORDER.indexOf(sqOpener) - 1;
        s = { mode: 'pf', kind: 'squeeze', opener: sqOpener, vseat: sqSeat, callers: 1 + rnd(Math.max(1, Math.min(2, sqGap))) - (sqGap >= 1 ? 0 : 0), depth: depth };
        if (s.callers > sqGap) s.callers = Math.max(1, sqGap);
      }
      else if (roll < 0.60) s = { mode: 'pf', kind: 'iso', pos: ['MP', 'CO', 'BTN', 'SB'][rnd(4)], limpers: 1 + rnd(2), depth: depth };
      else if (roll < 0.63) s = { mode: 'pf', kind: 'bbopt', limpers: 1 + rnd(2), depth: depth };   // BB option in a limped pot: check or raise
      else if (roll < 0.66) s = { mode: 'pf', kind: 'limpRR', pos: ['MP', 'CO', 'BTN', 'SB'][rnd(4)], limpers: 1 + rnd(2), depth: Math.max(depth, 30) };   // you iso'd, a limper limp-reraises
      else if (roll < 0.76 && pfDepthFocus() !== 'deep') s = { mode: 'pf', kind: 'calljam', pos: P.POS[rnd(P.POS.length)], depth: [8, 10, 12, 15][rnd(4)] };
      else if (roll < 0.85) {
        // cold 3-bet: open + 3-bet in front, action on a NAMED hero seat
        var op2 = ['EP', 'MP', 'CO'][rnd(3)];
        var rs = seatsAfter(op2).filter(function (x) { return x !== 'BB'; });
        var raiser = rs[rnd(rs.length)];
        var heroPool = seatsAfter(raiser);
        var c3d = pfDepthFocus() === 'deep' ? [50, 100] : pfDepthFocus() === 'short' ? [20, 30] : [20, 30, 50, 100];
        s = { mode: 'pf', kind: 'cold3b', opener: op2, raiser: raiser,
          vseat: heroPool[rnd(heroPool.length)], depth: c3d[rnd(c3d.length)] };
      }
      else if (roll < 0.94) {
        // you opened, got 3-bet — both seats named, position derived
        var heroOpen = ['EP', 'MP', 'CO', 'BTN'][rnd(4)];
        var tbPool = seatsAfter(heroOpen);
        var tb3 = tbPool[rnd(tbPool.length)];
        s = { mode: 'pf', kind: 'vs3bet', pos: heroOpen, raiser: tb3,
          pos3: ipVs(heroOpen, tb3), depth: (pfDepthFocus() === 'deep' ? [50, 100] : pfDepthFocus() === 'short' ? [20, 30] : [20, 30, 50, 100])[rnd(pfDepthFocus() === 'all' ? 4 : 2)] };
      }
      else {
        // DEEP: you 3-bet, they 4-bet — premium dilemmas (QQ/JJ call, AQs folds)
        var h4 = ['MP', 'CO', 'BTN', 'SB', 'BB'][rnd(5)];
        var before4 = PRE_ORDER.slice(0, PRE_ORDER.indexOf(h4));
        var op4 = before4.length ? before4[rnd(before4.length)] : 'EP';
        s = { mode: 'pf', kind: 'vs4bet', vseat: h4, raiser: op4,
          pos3: ipVs(h4, op4), depth: Math.random() < 0.5 ? 50 : 100 };
        if (pfDepthFocus() === 'short') s.depth = 50;   // vs4bet only exists deep
      }
    }
    attachHand(s, pfThreshold(s)); return s;
  }
  function scenarioOdds() {
    var variant = Math.random() < 0.5 ? 'turn' : 'flop';
    var key = ['flush', 'oesd', 'gut', 'overs', 'fgut', 'foesd'][rnd(6)], d = PF.DRAWS[key];
    var boardCount = variant === 'turn' ? 4 : 3, deal = PF.genDraw(key, boardCount);
    var pot = [200, 300, 400, 500, 600][rnd(5)];
    var bet = Math.max(20, Math.round(pot * [0.33, 0.5, 0.66, 0.75, 1][rnd(5)] / 10) * 10);
    return { mode: 'odds', variant: variant, key: key, name: d.name, outs: d.outs, hole: deal.hole, board: deal.board,
      pot: pot, bet: bet, required: PF.requiredEquity(bet, pot), equity: variant === 'turn' ? d.one : d.two };
  }
  var FRACS = [{ f: 1 / 3, t: '⅓ pot' }, { f: 1 / 3, t: '⅓ pot' }, { f: 0.5, t: '½ pot' }, { f: 0.5, t: '½ pot' }, { f: 0.75, t: '¾ pot' }, { f: 1, t: 'pot' }];
  // Villain range assumptions (percentile bands on the 169-hand ranking).
  // Shown in feedback so the model is never a black box.
  var RANGES = {
    blindDefend: { band: [0.03, 0.45], desc: 'blind-defend ~top 45%' },
    coldCall: { band: [0.03, 0.12], desc: 'cold-call ~top 12%' },
    openerVs3bet: { band: [0.02, 0.15], desc: 'opener flats 3-bet ~top 15%' }
  };
  function openerRange(seat) {
    var t = P.openThreshold(seat, 30);
    return { band: [0, t], desc: SEAT_NAME[seat] + ' open ~top ' + Math.round(t * 100) + '%' };
  }
  // MULTIWAY c-bet (David's ask): you opened, TWO players called, 3-way flop,
  // you're first to act. The lesson: bluffing collapses (you need BOTH to fold),
  // so c-bet value-heavy and check your air. Equity is vs the FIELD (beat both).
  function scenarioCbetMW() {
    var heroSeat = ['EP', 'MP', 'CO'][rnd(3)];
    var after = seatsAfter(heroSeat);                       // 2 distinct callers behind
    var pickN = function (arr, k) { var c = arr.slice(), o = []; while (o.length < k && c.length) o.push(c.splice(rnd(c.length), 1)[0]); return o; };
    var callers = pickN(after.length >= 2 ? after : ['CO', 'BTN', 'SB', 'BB'], 2);
    var hole = cardsFor(handInBand(0, P.openThreshold(heroSeat, 30)));
    var board = dealAvoiding(3, hole);
    var cls = PF.classifyFlop(hole, board), tex = PF.textureOf(board);
    var edge = PF.preflopEdge({ potType: 'srp', callerBlind: false, openerEarly: isEarly(heroSeat) }, tex);
    var pool = P.bandCombos(RANGES.coldCall.band[0], RANGES.coldCall.band[1]);
    var cond = function (c1, c2, b) { return PF.CONT_FREQ[PF.classifyFlop([c1, c2], b).category]; };  // they called the flop (we condition the field on continuing)
    var eq = H.equityVsField(hole, board, [pool, pool], { n: 500 });
    var tier = PF.handTier(cls, eq);
    var ctx = { eq: eq, price: null, frac: null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: tex.wet, pos: 'oop', potType: 'srp', tier: tier, multiway: 2 };
    var fn = PF.flopDecide('oopFirst', ctx);
    var mix = PF.flopMix('oopFirst', ctx);
    // pot: 3 players × 2.2 (open) + dead money from folded blinds + BB ante
    var pot = 3 * 2.2 + (callers.indexOf('SB') < 0 ? 0.5 : 0) + (callers.indexOf('BB') < 0 ? 1 : 0) + 1;
    pot = Math.round(pot * 2) / 2;
    return { mode: 'cbet', multiway: 2, hole: hole, board: board, role: 'aggressor', pos: 'oop', potType: 'srp',
      heroSeat: heroSeat, callers: callers, node: 'oopFirst', cls: cls, tex: tex, edge: edge,
      pot: pot, bet: null, frac: null, price: null, eq: eq, villDesc: '2 cold-callers ~top 12% each', fn: fn, mix: mix, tier: tier, ctx: ctx };
  }
  function scenarioCbet() {
    var leak = pfDepthFocus() === 'leak';                  // 🩹 face-aggression focus (his discomfort)
    var raises = pfDepthFocus() === 'raises';              // 🔼 raise-or-fold reps: face small bets, decide fold/call/RAISE
    var facingFocus = leak || raises;
    if (!facingFocus && Math.random() < 0.18) return scenarioCbetMW();     // multiway c-bet (3-way), David's ask
    var role = facingFocus ? 'defender' : (Math.random() < 0.5 ? 'aggressor' : 'defender');   // facing focus = you’re the one facing the bet
    var heroSeat, villSeat, pos, node, potType = 'srp', band, villRange;
    if (role === 'aggressor') {
      potType = Math.random() < 0.25 ? '3bet' : 'srp';
      if (potType === '3bet') {
        // villain OPENS first; hero 3-bets from a seat that acts AFTER them preflop
        villSeat = ['EP', 'MP', 'CO', 'BTN'][rnd(4)];
        var later = seatsAfter(villSeat);
        heroSeat = later[rnd(later.length)];
        pos = ipVs(heroSeat, villSeat);
        node = pos === 'ip' ? (Math.random() < 0.85 ? 'ipCheck' : 'ipBet') : 'oopFirst';
        band = [0, P.vsThresholds(30, villSeat).tb];                      // hero's 3-bet range
        villRange = RANGES.openerVs3bet;
      } else if (Math.random() < 0.5) {                 // SRP, hero IP, villain in the blinds
        heroSeat = ['MP', 'CO', 'BTN'][rnd(3)]; villSeat = ['SB', 'BB'][rnd(2)]; pos = 'ip';
        node = Math.random() < 0.82 ? 'ipCheck' : 'ipBet';   // caller mostly checks; sometimes donks
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.blindDefend;
      } else {                                          // SRP, hero OOP opener, villain flats behind
        heroSeat = ['EP', 'MP'][rnd(2)]; villSeat = ['CO', 'BTN'][rnd(2)]; pos = 'oop';
        node = 'oopFirst';
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.coldCall;
      }
    } else {                                            // hero is the caller / defender
      if (Math.random() < 0.5) {                        // hero IP defender (flatted on the button)
        villSeat = ['EP', 'MP', 'CO'][rnd(3)]; heroSeat = 'BTN'; pos = 'ip';
        node = facingFocus ? 'ipBet' : (Math.random() < 0.5 ? 'ipCheck' : 'ipBet');   // leak/raises: face the c-bet, don't get a free check
        band = [0.04, 0.26];
      } else {                                          // hero OOP defender (defended a blind)
        villSeat = ['CO', 'BTN'][rnd(2)]; heroSeat = ['SB', 'BB'][rnd(2)]; pos = 'oop';
        node = 'oopBet';
        band = [0.04, 0.52];
      }
      villRange = openerRange(villSeat);                // villain = the opener
    }
    // deal hero a hand actually in their preflop range for this spot
    var hole = cardsFor(handInBand(band[0], band[1]));
    var board = dealAvoiding(3, hole);
    var cls = PF.classifyFlop(hole, board), tex = PF.textureOf(board);
    var edge = role === 'aggressor'
      ? PF.preflopEdge({ potType: potType, callerBlind: villSeat === 'SB' || villSeat === 'BB', openerEarly: isEarly(heroSeat) }, tex)
      : PF.defenderEdge(tex);
    // pot + (maybe) a bet to face — price computed from the actual numbers shown
    var pot = potType === '3bet' ? 18 : 6;
    var facing = node === 'ipBet' || node === 'oopBet';
    var frac = facing ? (raises ? FRACS[rnd(4)] : FRACS[rnd(FRACS.length)]) : null;   // raises: small bets (⅓–½) → raising is live
    var bet = facing ? Math.round(pot * frac.f * 2) / 2 : null;
    var price = facing ? PF.requiredEquity(bet, pot) : null;
    // hero equity vs villain's range, conditioned on what they did
    var combos = P.bandCombos(villRange.band[0], villRange.band[1]);
    var condition = null;
    if (facing) condition = function (c1, c2, b) { return PF.BET_FREQ[PF.classifyFlop([c1, c2], b).category]; };
    else if (node === 'ipCheck') condition = function (c1, c2, b) { return PF.CHECK_FREQ[PF.classifyFlop([c1, c2], b).category]; };
    var eq = H.equityVsRange(hole, board, combos, { n: 650, condition: condition });
    var tier = PF.handTier(cls, eq);
    var ctx = { eq: eq, price: price, frac: frac ? frac.f : null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: tex.wet, pos: pos, potType: potType, tier: tier };
    var fn = PF.flopDecide(node, ctx);
    var mix = PF.flopMix(node, ctx);
    return { mode: 'cbet', hole: hole, board: board, role: role, pos: pos, potType: potType,
      heroSeat: heroSeat, villSeat: villSeat, node: node, cls: cls, tex: tex, edge: edge,
      pot: pot, bet: bet, frac: frac, price: price, eq: eq, villDesc: villRange.desc, fn: fn, mix: mix, tier: tier, ctx: ctx };
  }
  // ---- TURN spots: the flop story already happened; plan meets reality ----
  // SIX sub-stories. Aggressor side: barrel (c-bet called → you continue), lead
  // (c-bet called → they donk), delayed (flop checked through → they bet), probe
  // (flop checked through → they check again, YOU decide bet/check), probeRaised
  // (flop checked through → you stab → they check-raise). Caller side: barreled
  // (you called the flop c-bet → they fire again). The three checked-through
  // lines (delayed/probe/probeRaised) were under-represented — David's catch.
  function scenarioTurn(facingOnly) {
    var raises = pfDepthFocus() === 'raises';              // 🔼 raises: face small bets you can RAISE (no facing-a-check-raise)
    facingOnly = facingOnly || pfDepthFocus() === 'leak' || raises;
    var r0 = Math.random();
    // 🩹 leak = FACING-aggression turns; 🔼 raises = small-bet facing only (donk lead / 2nd barrel / turn bet), no probeRaised
    var sub = facingOnly
      ? (raises ? (r0 < 0.4 ? 'barreled' : r0 < 0.7 ? 'lead' : 'delayed')
        : (r0 < 0.30 ? 'barreled' : r0 < 0.52 ? 'lead' : r0 < 0.78 ? 'delayed' : 'probeRaised'))
      : r0 < 0.26 ? 'barrel' : r0 < 0.38 ? 'lead' : r0 < 0.54 ? 'delayed' : r0 < 0.67 ? 'probe' : r0 < 0.78 ? 'probeRaised' : 'barreled';
    var heroSeat, villSeat, pos, node, potType = 'srp', band, villRange;
    if (sub !== 'barreled') {                              // hero is the preflop aggressor
      potType = Math.random() < 0.22 ? '3bet' : 'srp';
      var needIp = sub !== 'barrel';    // lead/delayed/probe/probeRaised all need hero IP
      if (potType === '3bet') {
        villSeat = ['EP', 'MP', 'CO'][rnd(3)];
        var later = seatsAfter(villSeat).filter(function (x) { return !needIp || ipVs(x, villSeat) === 'ip'; });
        heroSeat = later[rnd(later.length)];
        pos = ipVs(heroSeat, villSeat);
        band = [0, P.vsThresholds(30, villSeat).tb];
        villRange = RANGES.openerVs3bet;
      } else if (needIp || Math.random() < 0.5) {          // SRP, hero IP vs a blind
        heroSeat = ['MP', 'CO', 'BTN'][rnd(3)]; villSeat = ['SB', 'BB'][rnd(2)]; pos = 'ip';
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.blindDefend;
      } else {                                             // SRP, hero OOP opener vs cold-caller
        heroSeat = ['EP', 'MP'][rnd(2)]; villSeat = ['CO', 'BTN'][rnd(2)]; pos = 'oop';
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.coldCall;
      }
      node = sub === 'barrel' ? (pos === 'ip' ? 'ipCheck' : 'oopFirst')
        : sub === 'probe' ? 'ipCheck'        // checked through twice — YOU decide bet/check
        : 'ipBet';                           // lead / delayed / probeRaised — you face a bet/raise
    } else {                                               // hero called a c-bet, faces the 2nd barrel
      if (Math.random() < 0.5) { villSeat = ['EP', 'MP', 'CO'][rnd(3)]; heroSeat = 'BTN'; pos = 'ip'; node = 'ipBet'; band = [0.04, 0.26]; }
      else { villSeat = ['CO', 'BTN'][rnd(2)]; heroSeat = ['SB', 'BB'][rnd(2)]; pos = 'oop'; node = 'oopBet'; band = [0.04, 0.52]; }
      villRange = openerRange(villSeat);
    }
    var hole = cardsFor(handInBand(band[0], band[1]));
    var board = dealAvoiding(4, hole);
    var cls = PF.classifyFlop(hole, board), texF = PF.textureOf(board.slice(0, 3)), tex4 = PF.textureOf(board);
    var edge = sub !== 'barreled'
      ? PF.preflopEdge({ potType: potType, callerBlind: villSeat === 'SB' || villSeat === 'BB', openerEarly: isEarly(heroSeat) }, texF)
      : PF.defenderEdge(texF);
    // pot through the flop story
    var pot0 = potType === '3bet' ? 18 : 6;
    var f1 = [1 / 3, 1 / 3, 0.5][rnd(3)];
    var b1 = Math.round(pot0 * f1 * 2) / 2;
    var potT = (sub === 'delayed' || sub === 'probe') ? pot0   // flop checked through: no flop bet in the pot
      : pot0 + 2 * b1;                                          // a flop bet (or your turn stab) is in
    var facing = node === 'ipBet' || node === 'oopBet';
    var frac = facing ? (sub === 'probeRaised' ? FRACS[4] : raises ? FRACS[rnd(4)] : FRACS[rnd(FRACS.length)]) : null;   // check-raise big; raises-focus small
    var bet = facing ? Math.round(potT * frac.f * 2) / 2 : null;
    var price = facing ? PF.requiredEquity(bet, potT) : null;
    // villain range conditioned on the WHOLE story: flop action × turn action
    var combos = P.bandCombos(villRange.band[0], villRange.band[1]);
    var FC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b.slice(0, 3)).category; };
    var TC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b).category; };
    // a turn check-raise (after checking the flop) is POLARIZED — nutted value +
    // a few semibluffs/bluffs, almost no medium hands (those just call)
    var XR = { value: 0.85, draw: 0.55, airdraw: 0.30, air: 0.18, overs: 0.05, medium: 0.08 };
    var condition =
      sub === 'barrel' ? (node === 'ipCheck'
        ? function (c1, c2, b) { return PF.CONT_FREQ[FC(c1, c2, b)] * PF.CHECK_FREQ[TC(c1, c2, b)]; }
        : function (c1, c2, b) { return PF.CONT_FREQ[FC(c1, c2, b)]; })
        : sub === 'lead' ? function (c1, c2, b) { return PF.CONT_FREQ[FC(c1, c2, b)] * PF.BET_FREQ[TC(c1, c2, b)]; }
          : sub === 'delayed' ? function (c1, c2, b) { return PF.CHECK_FREQ[FC(c1, c2, b)] * PF.BET_FREQ[TC(c1, c2, b)]; }
            : sub === 'probe' ? function (c1, c2, b) { return PF.CHECK_FREQ[FC(c1, c2, b)] * PF.CHECK_FREQ[TC(c1, c2, b)]; }
              : sub === 'probeRaised' ? function (c1, c2, b) { return PF.CHECK_FREQ[FC(c1, c2, b)] * (XR[TC(c1, c2, b)] || 0.1); }
                : function (c1, c2, b) { return PF.BET_FREQ[FC(c1, c2, b)] * PF.BET_FREQ[TC(c1, c2, b)]; };
    var eq = H.equityVsRange(hole, board, combos, { n: 550, condition: condition });
    var tier = PF.handTier(cls, eq);
    var tcard = PF.classifyTurnCard(hole, board.slice(0, 3), board[3]);
    var ctx = { eq: eq, price: price, frac: frac ? frac.f : null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush,
      edge: edge, wet: tex4.wet, pos: pos, potType: potType, street: 'turn', tier: tier, tcard: tcard };
    var fn = PF.flopDecide(node, ctx);
    var mix = PF.flopMix(node, ctx);
    return { mode: 'cbet', street: 'turn', sub: sub, hole: hole, board: board,
      role: sub === 'barreled' ? 'defender' : 'aggressor', pos: pos, potType: potType,
      heroSeat: heroSeat, villSeat: villSeat, node: node, cls: cls, tex: tex4, edge: edge,
      pot: potT, f1txt: f1 === 0.5 ? '½' : '⅓', bet: bet, frac: frac, price: price, eq: eq,
      villDesc: villRange.desc, fn: fn, mix: mix, tier: tier, tcard: tcard, ctx: ctx };
  }
  // ---- RIVER spots: the board is complete — no draws, pure showdown value. The
  // villain range is conditioned on the WHOLE LINE (called/bet flop, barrel or
  // check turn, then the river) — so calling two streets actually NARROWS them to
  // made hands + busted draws. Two equities matter:
  //   eqShow = vs that whole range → the bluff-CATCH / showdown decision.
  //   eqCall = vs the hands that would CALL a river bet (made hands, not air) →
  //            the VALUE decision. High showdown equity built on busted draws is
  //            NOT value: betting folds those out and only better calls (David's
  //            99-on-KTT catch — "what worse calls after calling two streets?").
  var RIVER_BET = { value: 0.90, medium: 0.22, overs: 0.42, airdraw: 0.45, air: 0.45, draw: 0.60 };   // their river BET (polar)
  var RIVER_CHK = { value: 0.30, medium: 0.80, overs: 0.70, airdraw: 0.70, air: 0.70, draw: 0.50 };   // their CHECKED range (capped)
  var RIVER_CALL = { value: 0.92, medium: 0.55, overs: 0.12, airdraw: 0.12, air: 0.05, draw: 0.40 };  // what CALLS your river bet (made hands)
  function scenarioRiver() {
    var role = Math.random() < 0.5 ? 'aggressor' : 'defender';
    var heroSeat, villSeat, pos, potType = 'srp', band, villRange;
    if (role === 'aggressor') {
      potType = Math.random() < 0.2 ? '3bet' : 'srp';
      if (potType === '3bet') {
        villSeat = ['EP', 'MP', 'CO'][rnd(3)]; var later = seatsAfter(villSeat); heroSeat = later[rnd(later.length)]; pos = ipVs(heroSeat, villSeat);
        band = [0, P.vsThresholds(30, villSeat).tb]; villRange = RANGES.openerVs3bet;
      } else { heroSeat = ['MP', 'CO', 'BTN'][rnd(3)]; villSeat = ['SB', 'BB'][rnd(2)]; pos = 'ip'; band = [0, P.openThreshold(heroSeat, 30)]; villRange = RANGES.blindDefend; }
    } else {
      if (Math.random() < 0.5) { villSeat = ['EP', 'MP', 'CO'][rnd(3)]; heroSeat = 'BTN'; pos = 'ip'; band = [0.04, 0.26]; }
      else { villSeat = ['CO', 'BTN'][rnd(2)]; heroSeat = ['SB', 'BB'][rnd(2)]; pos = 'oop'; band = [0.04, 0.52]; }
      villRange = openerRange(villSeat);
    }
    // Build the pot through a COHERENT betting line — the aggressor barrels 1-2
    // streets, called (so the river pot actually matches the action, instead of
    // the old "checks through to an 18bb pot" incoherence). Then the river plays:
    // a defender mostly faces another bet (bluff-catch); the aggressor mostly gets
    // to decide (3rd barrel / value / check-to-induce), sometimes faces a donk.
    var barrels = Math.random() < 0.6 ? 2 : 1;
    var pot = potType === '3bet' ? 14 : 5;
    for (var k = 0; k < barrels; k++) { var bk = Math.round(pot * 0.6); pot += 2 * bk; }
    pot = Math.round(pot);
    var faceBet = role === 'defender' ? Math.random() < 0.68 : Math.random() < 0.38;
    // COHERENT hero line: a defender who CALLED the flop c-bet (and a turn barrel,
    // if any) can't have been holding stone air — re-deal until hero's flop (and
    // barreled-turn) hand is a plausible continue. The aggressor may have barreled
    // air (a realistic river bluff/give-up), so only gate the defender's calls.
    var heroDef = role === 'defender';
    var hole, board, tries = 0, coherent = false;
    while (!coherent && tries++ < 60) {
      hole = cardsFor(handInBand(band[0], band[1]));
      board = dealAvoiding(5, hole);
      coherent = !heroDef || (PF.classifyFlop(hole, board.slice(0, 3)).category !== 'air'
        && (barrels < 2 || PF.classifyFlop(hole, board.slice(0, 4)).category !== 'air'));
    }
    var cls = PF.classifyFlop(hole, board), texF = PF.textureOf(board.slice(0, 3));
    var edge = role === 'aggressor'
      ? PF.preflopEdge({ potType: potType, callerBlind: villSeat === 'SB' || villSeat === 'BB', openerEarly: isEarly(heroSeat) }, texF)
      : PF.defenderEdge(texF);
    var frac = faceBet ? FRACS[rnd(FRACS.length)] : null;
    var bet = faceBet ? Math.round(pot * frac.f * 2) / 2 : null;
    var price = faceBet ? PF.requiredEquity(bet, pot) : null;
    var combos = P.bandCombos(villRange.band[0], villRange.band[1]);
    var FC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b.slice(0, 3)).category; };
    var TC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b.slice(0, 4)).category; };
    var RC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b).category; };
    var villBet = role === 'defender';                     // villain was the bettor; aggressor = villain called
    var sw = function (cls2, betting) { return betting ? PF.BET_FREQ[cls2] : PF.CONT_FREQ[cls2]; };
    var lineW = function (c1, c2, b) {                     // called/bet flop, then (barrel or checked) turn
      var pf = sw(FC(c1, c2, b), villBet);
      var pt = barrels >= 2 ? sw(TC(c1, c2, b), villBet) : PF.CHECK_FREQ[TC(c1, c2, b)];
      return pf * pt;
    };
    var showCond = function (c1, c2, b) { return lineW(c1, c2, b) * (faceBet ? RIVER_BET[RC(c1, c2, b)] : RIVER_CHK[RC(c1, c2, b)]); };
    var eq = H.equityVsRange(hole, board, combos, { n: 700, condition: showCond });
    var eqCall = eq;
    if (!faceBet) {                                        // value decision: equity vs the CALLING range, not the whole range
      var callCond = function (c1, c2, b) { return lineW(c1, c2, b) * RIVER_CALL[RC(c1, c2, b)]; };
      eqCall = H.equityVsRange(hole, board, combos, { n: 700, condition: callCond });
    }
    var tier = PF.handTier(cls, eq);
    var node = faceBet ? (pos === 'ip' ? 'ipBet' : 'oopBet') : (pos === 'ip' ? 'ipCheck' : 'oopFirst');
    var ctx = { eq: eq, eqCall: eqCall, price: price, frac: frac ? frac.f : null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: texF.wet, pos: pos, potType: potType, street: 'river', tier: tier };
    var fn = PF.flopDecide(node, ctx), mix = PF.flopMix(node, ctx);
    return { mode: 'river', street: 'river', sub: faceBet ? 'riverFace' : 'riverBet', barrels: barrels, hole: hole, board: board, role: role, pos: pos, potType: potType,
      heroSeat: heroSeat, villSeat: villSeat, node: node, cls: cls, tex: texF, edge: edge, pot: pot, bet: bet, frac: frac, price: price, eq: eq,
      villDesc: villRange.desc, fn: fn, mix: mix, tier: tier, ctx: ctx };
  }
  var ACT_CLS = { check: 'fold', bet: 'go', fold: 'fold', call: 'call', raise: 'threebet' };
  var pendingChain = null;

  // ---- REAL SPOTS: real turn/river hands (PHH/Pluribus) with the action-aware
  // engine take + the ACTUAL outcome baked in (tools/phh_build_pool.js → realspots.json).
  // These REPLACE the synthetic turn/river generators (kept only as offline fallback).
  var REAL_POOL = null, REAL_ERR = false;
  function loadRealPool() {
    if (REAL_POOL || REAL_ERR) return;
    if (typeof fetch === 'undefined') { REAL_ERR = true; return; }     // no fetch (node/tests) → synthetic fallback
    fetch('./realspots.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (p) { REAL_POOL = p; if (cur && cur.loading) newScenario(); })
      .catch(function () { REAL_ERR = true; if (cur && cur.loading) newScenario(); });
  }
  function realScenario(street) {
    var foc = pfDepthFocus(), facingOnly = foc === 'leak' || foc === 'raises';   // focus toggles → facing-a-bet only
    var pool = REAL_POOL.filter(function (e) { return e.street === street && (!facingOnly || e.decision === 'fcr'); });
    if (!pool.length) pool = REAL_POOL.filter(function (e) { return e.street === street; });
    if (!pool.length) pool = REAL_POOL;
    var e = pool[rnd(pool.length)];
    return { mode: street, street: street, real: true, e: e, hole: e.heroCards.match(/../g), board: e.board,
      options: e.decision === 'fcr'
        ? [{ label: 'Fold', act: 'fold' }, { label: 'Call', act: 'call' }, { label: 'Raise', act: 'raise' }]
        : [{ label: 'Check', act: 'check' }, { label: 'Bet', act: 'bet' }] };
  }
  function realSpotHtml(s, prog) {
    var e = s.e, L = e.line;
    function row(n, t) { return t ? '<div style="font-size:12px;line-height:1.5;opacity:.9"><span style="opacity:.5;display:inline-block;min-width:54px">' + n + '</span> ' + esc(t) + '</div>' : ''; }
    var face = e.decision === 'fcr'
      ? '<b>' + e.villPos + '</b> bets <b>' + e.toCall + 'bb</b>' + (e.frac ? ' (' + e.frac + '×pot)' : '') + ' — you’re the <b>' + e.heroPos + '</b> (' + (e.heroIP ? 'IP' : 'OOP') + '), pot ' + e.pot + 'bb.'
      : (e.heroIP
          ? '<b>' + e.villPos + '</b> checks — you’re the <b>' + e.heroPos + '</b> (IP), pot ' + e.pot + 'bb.'
          : 'you’re <b>first to act</b> — <b>' + e.heroPos + '</b> (OOP), pot ' + e.pot + 'bb.');
    return '<div style="font-size:10px;letter-spacing:1px;opacity:.55;margin-bottom:5px">' + (prog || 'REAL HAND · 100bb 6-max') + '</div>' +
      row('Preflop', L.preflop) + row('Flop', L.flop) + row('Turn', L.turn) + (e.street === 'river' ? row('River', L.river) : '') +
      '<div style="margin-top:6px"><b>' + e.street.charAt(0).toUpperCase() + e.street.slice(1) + ':</b> ' + face + '</div>';
  }

  // ---- FULL HANDS: play one real hand decision-by-decision. Each decision is shaped
  // like a real-spot entry (so renderScenario/realSpotHtml reuse cleanly), but the hand
  // carries the constant hero/villain cards + the full run-out tail, and the line GROWS
  // across decisions — so the villain's action between your turns shows up as the next
  // decision's framing, and the hand always follows what actually happened.
  var REAL_HANDS = null, REAL_HANDS_ERR = false;
  function loadRealHands() {
    if (REAL_HANDS || REAL_HANDS_ERR) return;
    if (typeof fetch === 'undefined') { REAL_HANDS_ERR = true; return; }
    fetch('./realhands.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (p) { REAL_HANDS = p; if (cur && cur.loading) newScenario(); })
      .catch(function () { REAL_HANDS_ERR = true; if (cur && cur.loading) newScenario(); });
  }
  function handAt(hand, di) {                  // build the cur object for decision di of a hand
    var d = hand.decisions[di];
    var e = { street: d.street, bb: hand.bb, heroPos: hand.heroPos, villPos: hand.villPos, heroIP: d.heroIP,
      heroCards: hand.heroCards, villCards: hand.villCards, board: d.board, pot: d.pot, toCall: d.toCall,
      frac: d.frac, decision: d.decision, line: d.line, label: d.label, engine: d.engine, actual: { action: d.actual } };
    return { mode: 'hands', street: d.street, real: true, hands: true, hand: hand, di: di, e: e,
      hole: hand.heroCards.match(/../g), board: d.board,
      options: d.decision === 'fcr'
        ? [{ label: 'Fold', act: 'fold' }, { label: 'Call', act: 'call' }, { label: 'Raise', act: 'raise' }]
        : [{ label: 'Check', act: 'check' }, { label: 'Bet', act: 'bet' }] };
  }
  function handScenario() { return handAt(REAL_HANDS[rnd(REAL_HANDS.length)], 0); }

  function newScenario() {
    if (pendingChain) { cur = pendingChain; pendingChain = null; renderScenario(); return; }
    if (mode === 'hands') {                                 // Full end-to-end hands: walk a real hand decision-by-decision
      if (!REAL_HANDS && !REAL_HANDS_ERR) loadRealHands();
      if (REAL_HANDS) { cur = handScenario(); renderScenario(); return; }
      if (!REAL_HANDS_ERR) { cur = { real: true, hands: true, loading: true, mode: 'hands', street: 'flop' }; renderScenario(); return; }
      cur = scenarioCbet(); renderScenario(); return;       // offline / load failed → a synthetic flop spot so the tab isn't dead
    }
    if (mode === 'flop' || mode === 'turn' || mode === 'river') {   // Real Spots replace the synthetic flop/turn/river drill
      if (!REAL_POOL && !REAL_ERR) loadRealPool();         // kicks the fetch (or sets REAL_ERR synchronously when no fetch)
      if (REAL_POOL) { cur = realScenario(mode); renderScenario(); return; }
      if (!REAL_ERR) { cur = { real: true, loading: true, mode: mode, street: mode }; renderScenario(); return; }   // browser: awaiting fetch
      // REAL_ERR (offline / no fetch / load failed) → synthetic fallback below
    }
    cur = mode === 'pf' ? scenarioPF()
      : mode === 'odds' ? scenarioOdds()
        : mode === 'turn' ? scenarioTurn()
          : mode === 'river' ? scenarioRiver()
            : scenarioCbet();                              // 'flop' (and legacy 'cbet') → flop spots
    renderScenario();
  }

  /* ---- render per mode ---- */
  function resetFb() { $('drillBtns').hidden = false; $('drillFb').hidden = true; $('drillFb').innerHTML = ''; }
  function pfSpot(s) {
    var rep = s.replay ? ' &nbsp;<span class="rep">↻ replay</span>' : '';
    if (s.kind === 'open') return 'Folded to you · <b>' + P.POS_NAME[s.pos] + '</b> · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'iso') return '<b>' + s.limpers + ' limper' + (s.limpers > 1 ? 's' : '') + '</b> · you’re <b>' + P.POS_NAME[s.pos] + '</b> · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'bbopt') return '<b>' + s.limpers + ' limper' + (s.limpers > 1 ? 's' : '') + '</b>, folds to you in the <b>BB</b> · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'limpRR') return 'You iso’d <b>' + s.limpers + ' limper' + (s.limpers > 1 ? 's' : '') + '</b> from <b>' + P.POS_NAME[s.pos] + '</b>, a limper <b>limp-reraises</b> · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'vs') return '<b>' + P.POS_NAME[s.opener] + '</b> opens · <b>' + s.depth + 'bb</b> · you’re the <b>' + (s.vseat || s.blind || '?') + '</b>' + rep;
    if (s.kind === 'calljam') return '<b>' + P.POS_NAME[s.pos] + '</b> jams <b>' + s.depth + 'bb</b> · you’re the <b>BB</b>' + rep;
    if (s.kind === 'squeeze'){
      if (s.limped) return '<b>' + s.callers + '</b> limp' + (s.callers > 1 ? 's' : '') + ', <b>' + P.POS_NAME[s.opener] + '</b> raises · <b>' + s.depth + 'bb</b> · you’re the <b>' + (s.vseat || '?') + '</b>' + rep;
      return '<b>' + P.POS_NAME[s.opener] + '</b> opens, <b>' + s.callers + '</b> call' + (s.callers > 1 ? 's' : '') + ' · <b>' + s.depth + 'bb</b> · you’re the <b>' + (s.vseat || '?') + '</b>' + (s.vseat === 'BB' ? ' (closing)' : '') + rep;
    }
    if (s.kind === 'cold3b') return '<b>' + P.POS_NAME[s.opener] + '</b> opens, <b>' + (s.raiser || '?') + '</b> 3-bets · <b>' + s.depth + 'bb</b> · you’re the <b>' + (s.vseat || '?') + '</b>' + rep;
    if (s.kind === 'vs4bet') return 'You 3-bet from the <b>' + (s.vseat || '?') + '</b>, <b>' + P.POS_NAME[s.raiser] + '</b> 4-bets (you’re ' + (s.pos3 === 'ip' ? 'IP' : 'OOP') + ') · <b>' + s.depth + 'bb</b>' + (s.chained ? ' <span class="rep">↪ same hand</span>' : '') + rep;
    return 'You open <b>' + P.POS_NAME[s.pos] + '</b>, <b>' + (s.raiser || '?') + '</b> 3-bets (you’re ' + (s.pos3 === 'ip' ? 'IP' : 'OOP') + ') · <b>' + s.depth + 'bb</b>' + (s.chained ? ' <span class="rep">↪ same hand</span>' : '') + rep;  // vs3bet
  }
  function renderScenario() {
    var s = cur;
    if (s.real) {
      resetFb();
      if (s.loading) {
        var le = s.hands ? REAL_HANDS_ERR : REAL_ERR;
        $('drillSpot').innerHTML = le ? '<span class="bad">Couldn’t load real hands — reconnect to the Spark.</span>' : '<span class="dim">Loading real hands…</span>';
        $('drillHand').innerHTML = ''; $('drillQ').textContent = ''; $('drillBtns').innerHTML = ''; return;
      }
      $('drillSpot').innerHTML = s.hands
        ? realSpotHtml(s, 'PLAY-THROUGH · decision ' + (s.di + 1) + '/' + s.hand.decisions.length + ' · ' + s.e.street)
        : realSpotHtml(s);
      var bl = s.e.board;
      var bdR = bl.length === 5
        ? '<div class="bdlab">flop · turn · river</div><div class="board">' + bl.map(cardHtml).join('') + '</div>'
        : bl.length === 4
          ? '<div class="bdlab">flop · turn</div><div class="board">' + bl.slice(0, 3).map(cardHtml).join('') + '<span class="tsep">→</span>' + cardHtml(bl[3]) + '</div>'
          : '<div class="bdlab">flop</div><div class="board">' + bl.map(cardHtml).join('') + '</div>';
      $('drillHand').innerHTML = '<div class="hole">' + cardHtml(s.hole[0]) + cardHtml(s.hole[1]) + '</div>' + bdR;
      $('drillQ').textContent = s.options.map(function (o) { return o.label; }).join(' / ') + '?';
      $('drillBtns').className = s.options.length === 3 ? 'three' : '';
      $('drillBtns').innerHTML = s.options.map(function (o) { return '<button class="act ' + (ACT_CLS[o.act] || 'go') + '" data-a="' + o.act + '">' + o.label + '</button>'; }).join('');
      return;
    }
    if (s.mode === 'pf') {
      $('drillSpot').innerHTML = pfSpot(s);
      $('drillHand').innerHTML = cardHtml(s.c1) + cardHtml(s.c2);
      if (s.kind === 'calljam') {
        $('drillQ').textContent = 'Call the jam or fold?';
        $('drillBtns').className = '';
        $('drillBtns').innerHTML = '<button class="act fold" data-a="fold">Fold</button><button class="act call" data-a="call">Call</button>';
      } else if (s.kind === 'bbopt') {                 // BB option: free check or raise (never fold)
        $('drillQ').textContent = 'Check or raise?';
        $('drillBtns').className = '';
        $('drillBtns').innerHTML = '<button class="act fold" data-a="check">Check</button><button class="act raise" data-a="raise">Raise</button>';
      } else if (s.kind === 'open' && s.pos === 'SB' && s.depth >= 20) {   // SB folded-to: raise / limp / fold
        $('drillQ').textContent = 'Raise, limp, or fold?';
        $('drillBtns').className = 'three';
        $('drillBtns').innerHTML = '<button class="act fold" data-a="fold">Fold</button><button class="act call" data-a="limp">Limp</button><button class="act raise" data-a="open">Raise</button>';
      } else {
        var ai = aggrInfo(s), single = s.kind === 'open' || s.kind === 'iso';
        $('drillQ').textContent = single ? ai.w + ' or fold?' : ai.w + ', call, or fold?';
        $('drillBtns').className = single ? '' : 'three';
        $('drillBtns').innerHTML = '<button class="act fold" data-a="fold">Fold</button>' +
          (single ? aggrBtn(ai, 'open') : '<button class="act call" data-a="call">Call</button>' + aggrBtn(ai, 'threebet'));
      }
    } else if (s.mode === 'odds') {
      var street = s.variant === 'turn' ? 'Turn — one card to come' : 'Flop — villain is all-in, two cards come';
      $('drillSpot').innerHTML = '<b>' + street + '</b> · pot <b>$' + s.pot + '</b> · bets <b>$' + s.bet + '</b>' +
        '<button id="oddsTog" class="minitog">' + (oddsHard ? '🔍 spot-it-yourself' : 'name shown') + '</button>';
      $('drillHand').innerHTML = '<div class="hole">' + cardHtml(s.hole[0]) + cardHtml(s.hole[1]) + '</div>' +
        '<div class="bdlab">board</div><div class="board">' + s.board.map(cardHtml).join('') + '</div>' +
        '<div class="drawname' + (oddsHard ? ' dim' : '') + '">' + (oddsHard ? 'what’s your draw &amp; equity?' : 'you have a ' + esc(s.name)) + '</div>';
      $('drillQ').textContent = 'Call or fold?';
      $('drillBtns').className = '';
      $('drillBtns').innerHTML = '<button class="act fold" data-a="fold">Fold</button><button class="act call" data-a="call">Call</button>';
      $('oddsTog').onclick = function () { oddsHard = !oddsHard; stats.oddsHard = oddsHard; saveStats(); renderScenario(); };
    } else {
      $('drillSpot').innerHTML = cbetSpot(s);
      var bd = s.board.length === 5
        ? '<div class="bdlab">flop · turn · river</div><div class="board">' + s.board.map(cardHtml).join('') + '</div>'   // complete board — no arrows, the label tells the streets
        : s.board.length === 4
          ? '<div class="bdlab">flop · turn</div><div class="board">' + s.board.slice(0, 3).map(cardHtml).join('') + '<span class="tsep">→</span>' + cardHtml(s.board[3]) + '</div>'
          : '<div class="bdlab">flop</div><div class="board">' + s.board.map(cardHtml).join('') + '</div>';
      $('drillHand').innerHTML = '<div class="hole">' + cardHtml(s.hole[0]) + cardHtml(s.hole[1]) + '</div>' + bd;
      var opts = s.fn.options;
      $('drillQ').textContent = opts.map(function (o) { return o.label; }).join(' / ') + '?';
      $('drillBtns').className = opts.length === 3 ? 'three' : '';
      $('drillBtns').innerHTML = opts.map(function (o) {
        return '<button class="act ' + (ACT_CLS[o.act] || 'go') + '" data-a="' + o.act + '">' + o.label + '</button>';
      }).join('');
    }
    resetFb();
  }
  function cbetSpot(s) {
    var hero = SEAT_NAME[s.heroSeat], vill = SEAT_NAME[s.villSeat], pot3 = s.potType === '3bet';
    if (s.multiway) {
      var cs = (s.callers || []).map(function (c) { return SEAT_NAME[c] || c; }).join(' + ');
      // postflop order is SB→BB→EP→…→BTN: players earlier than hero act FIRST and
      // check to the PFR; players later are still behind. (Hero is "first to act"
      // only when no caller is earlier — i.e. no blind in the pot.)
      var ord = function (x) { return POST_ORDER.indexOf(x); };
      var before = (s.callers || []).filter(function (c) { return ord(c) < ord(s.heroSeat); });
      var behind = (s.callers || []).filter(function (c) { return ord(c) > ord(s.heroSeat); });
      var flow = before.length
        ? '<b>' + before.map(function (c) { return SEAT_NAME[c] || c; }).join(' + ') + '</b> check' + (before.length > 1 ? '' : 's') + ', action on you' +
            (behind.length ? ' (<b>' + behind.map(function (c) { return SEAT_NAME[c] || c; }).join(' + ') + '</b> behind)' : '')
        : 'you’re first to act' + (behind.length ? ' (<b>' + behind.length + '</b> behind)' : '');
      return 'You open <b>' + hero + '</b>, <b>' + cs + '</b> call (<b>3-way</b>). <b>Flop:</b> ' + flow + ' (pot ' + s.pot + 'bb).';
    }
    var story = s.role === 'aggressor'
      ? (pot3 ? '<b>' + vill + '</b> opens, you 3-bet <b>' + hero + '</b>, they call.' : 'You open <b>' + hero + '</b>, <b>' + vill + '</b> calls.')
      : '<b>' + vill + '</b> opens, you call <b>' + hero + '</b>.';
    var betTxt = s.bet != null ? ' <b>' + s.bet + 'bb</b> into <b>' + s.pot + 'bb</b> (' + s.frac.t + ')' : '';
    if (s.street === 'river') {
      var rpos = s.pos === 'ip' ? 'you’re IP' : 'you’re OOP';
      // spell out EVERY street so the turn is never omitted (David's catch)
      var flopL = s.role === 'aggressor' ? 'You c-bet flop, <b>' + vill + '</b> calls' : '<b>' + vill + '</b> c-bets flop, you call';
      var turnL = s.barrels >= 2
        ? (s.role === 'aggressor' ? 'you barrel turn, <b>' + vill + '</b> calls' : '<b>' + vill + '</b> barrels turn, you call')
        : 'turn checks through';
      turnL = turnL.charAt(0).toUpperCase() + turnL.slice(1);
      var act = s.sub === 'riverFace'
        ? (s.pos === 'oop'
            ? 'you check, <b>' + vill + '</b> bets' + betTxt + ' — ' + rpos + '.'
            : '<b>' + vill + '</b> ' + (s.role === 'aggressor' ? 'leads into you' : 'bets') + betTxt + ' — ' + rpos + '.')
        : (s.pos === 'ip' ? '<b>' + vill + '</b> checks — ' + rpos + ', action on you (pot ' + s.pot + 'bb).' : 'you’re first to act (' + rpos + ', pot ' + s.pot + 'bb).');
      return story + ' ' + flopL + '. ' + turnL + '. <b>River:</b> ' + act;
    }
    if (s.street === 'turn') {
      var checkedThrough = s.sub === 'delayed' || s.sub === 'probe' || s.sub === 'probeRaised';
      var fs = checkedThrough ? 'they check, you check back'
        : s.sub === 'barreled' ? 'they c-bet ' + s.f1txt + ', you call'
          : (s.pos === 'ip' ? 'they check, you bet ' + s.f1txt + ', they call' : 'you bet ' + s.f1txt + ', they call');
      var ta = s.sub === 'barrel'
        ? (s.pos === 'ip' ? '<b>' + vill + '</b> checks again (pot ' + s.pot + 'bb) — you’re IP.' : 'you’re first to act (pot ' + s.pot + 'bb).')
        : s.sub === 'lead' ? '<b>' + vill + '</b> now <b>leads</b>' + betTxt + ' — you’re IP.'
          : s.sub === 'delayed' ? '<b>' + vill + '</b> bets' + betTxt + '.'
            : s.sub === 'probe' ? '<b>' + vill + '</b> checks again (pot ' + s.pot + 'bb) — you’re IP, action on you.'
              : s.sub === 'probeRaised' ? 'you stab, <b>' + vill + '</b> <b>check-raises</b>' + betTxt + ' — you’re IP, facing it.'
                : '<b>' + vill + '</b> <b>barrels</b>' + betTxt + (s.pos === 'ip' ? ' — you’re IP.' : '.');
      return story + ' <b>Flop:</b> ' + fs + '. <b>Turn:</b> ' + ta;
    }
    var act = s.node === 'ipCheck' ? '<b>' + vill + '</b> checks (pot ' + s.pot + 'bb) — you’re IP.'
      : s.node === 'ipBet' ? '<b>' + vill + '</b> ' + (s.role === 'aggressor' ? 'leads' : 'c-bets') + betTxt + ' — you’re IP.'
        : s.node === 'oopFirst' ? 'You’re <b>OOP</b>, first to act (pot ' + s.pot + 'bb).'
          : 'You check, <b>' + vill + '</b> c-bets' + betTxt + '.';
    return story + ' <b>Flop:</b> ' + act;
  }

  /* ---- grade per mode (each returns {right, marginal, idealWord, why}) ---- */
  function gradePF(s, a) {
    if (s.kind === 'calljam') {
      var cv = P.callEval(s.pos, s.depth, s.label);     // graded vs the NAMED seat's jam range
      var cAct = cv.in ? 'call' : 'fold';
      var evTxt = cv.ev != null ? 'Nash call EV ' + (cv.ev > 0 ? '+' : '') + cv.ev.toFixed(2) + 'bb' : esc(s.label) + ' vs ~top ' + (cv.t * 100).toFixed(0) + '%';
      return {
        right: cv.marginal || a === cAct, marginal: cv.marginal, idealAct: cAct, idealWord: cAct === 'call' ? 'Call' : 'Fold', verb: 'Nash',
        why: evTxt + ' vs a ' + P.POS_NAME[s.pos] + ' ' + s.depth + 'bb jamming range <span class="dim">(solved, ante-adjusted; their range ~top ' +
          Math.round((window.NASH && window.NASH.jamPct[s.depth] ? window.NASH.jamPct[s.depth][s.pos] : 0)) + '%)</span>'
      };
    }
    var ai = aggrInfo(s);
    if (s.kind === 'bbopt') {                          // BB option in a limped pot: raise (iso) or check — never fold
      var tB = P.isoThreshold('CO', s.depth), pB = P.openPct(s.label, s.depth);
      var closeB = pB != null && Math.abs(pB - tB) <= 0.035;
      var corrB = pB != null && pB <= tB ? 'raise' : 'check';
      return {
        right: closeB || a === corrB, marginal: closeB, idealAct: corrB, idealWord: corrB === 'raise' ? 'Raise' : 'Check',
        why: esc(s.label) + ' at ' + ((pB || 1) * 100).toFixed(0) + '% vs a ~' + (tB * 100).toFixed(0) + '% BB iso-over-limpers range.' +
          ' <span class="dim">In the BB you have a <b>free check</b> — raise your value + a few bluffs to attack the capped limpers and deny the free flop, check the rest. The only mistake is raising too wide (you don’t need fold equity when checking is free) or never raising at all.</span>'
      };
    }
    if (s.kind === 'open' && s.pos === 'SB' && s.depth >= 20) {   // SB folded-to: raise / limp / fold (ante VPIP)
      var sb = P.sbEval(s.depth, s.label);
      var sbIdeal = sb.action === 'raise' ? 'open' : sb.action;   // map to button action
      var sbAcc = [sbIdeal];
      if (sb.nearRaise) { if (sbAcc.indexOf('open') < 0) sbAcc.push('open'); if (sbAcc.indexOf('limp') < 0) sbAcc.push('limp'); }
      if (sb.nearLimp) { if (sbAcc.indexOf('limp') < 0) sbAcc.push('limp'); if (sbAcc.indexOf('fold') < 0) sbAcc.push('fold'); }
      var sbRight = sbAcc.indexOf(a) >= 0;
      var sbWord = { open: 'Raise', limp: 'Limp', fold: 'Fold' };
      return {
        right: sbRight, marginal: sbRight && a !== sbIdeal, idealAct: sbIdeal, idealWord: sbWord[sbIdeal],
        why: esc(s.label) + ': SB raises ~top ' + Math.round(sb.raiseT * 100) + '%, limps the playable band to ~' + Math.round(sb.limpT * 100) + '%, folds the rest. ' +
          '<span class="dim">With the big-blind ante the SB plays ~' + Math.round((sb.limpT) * 100) + '%+ of hands (vs only the BB). Raise your value + bluffs; <b>limp</b> the suited/connected/small-pair hands too weak to raise but too cheap to fold OOP; fold offsuit junk. ' +
          (sb.action === 'limp' ? 'This one limps — complete and see a flop, don’t raise-or-fold it.' : sb.action === 'raise' ? 'This one’s a raise — strong enough to be the aggressor.' : 'This one folds — even the great price can’t save offsuit junk OOP.') + '</span>'
      };
    }
    if (s.kind === 'open' || s.kind === 'iso') {
      var ev = s.kind === 'open' ? P.openEval(s.pos, s.depth, s.label) : P.isoEval(s.pos, s.depth, s.label);
      var correct = ev.in ? 'open' : 'fold';
      var what = s.kind === 'iso' ? 'iso-raising vs limpers' : P.POS_NAME[s.pos] + ' opening';
      if (ev.ev != null) return {                              // 10bb first-in: Nash-solved jam
        right: ev.marginal || a === correct, marginal: ev.marginal, idealAct: correct, idealWord: correct === 'open' ? ai.w : 'Fold', verb: 'Nash',
        why: 'Nash jam EV ' + (ev.ev > 0 ? '+' : '') + ev.ev.toFixed(2) + 'bb from the ' + P.POS_NAME[s.pos] +
          ' at ' + s.depth + 'bb <span class="dim">(solved, ante-adjusted — jam range ~top ' + (ev.t * 100).toFixed(0) + '%)</span>'
      };
      var isoNote = s.kind === 'iso'
        ? ' <span class="dim">This wide iso assumes a <b>capped</b> limper (no premiums — the usual weak limp). It’s the right default vs the field. <b>Adjust vs good limpers</b> who limp a <b>polarized</b> range: they limp-reraise (limp-3-bet) their monsters to trap your wide iso, and flat their speculative hands to outplay you postflop. The counter: iso a touch tighter / more for value vs a known limp-reraiser, and <b>respect the limp-reraise</b> — it’s badly underbluffed even by decent players. Mix in over-limping yourself to stop being so readable.</span>'
        : '';
      return {
        right: ev.marginal || a === correct, marginal: ev.marginal, idealAct: correct, idealWord: correct === 'open' ? ai.w : 'Fold',
        why: esc(s.label) + ' at ' + (ev.p * 100).toFixed(0) + '% vs a ~' + (ev.t * 100).toFixed(0) + '% ' + what + ' range' + (ev.marginal ? ' — right on the line.' : '.') + isoNote
      };
    }
    var v = s.kind === 'vs' ? (s.blind ? P.blindVsEval(s.blind, s.depth, s.opener, s.label) : P.vsEval(s.depth, s.opener, s.label))
      : s.kind === 'squeeze' ? (s.limped
          ? ((s.vseat === 'SB' || s.vseat === 'BB') ? P.blindVsEval(s.vseat, s.depth, s.opener, s.label) : P.vsEval(s.depth, s.opener, s.label))
          : P.squeezeEval(s.depth, isEarly(s.opener) ? 'early' : 'late', s.label, s.vseat, s.callers))
        : (s.kind === 'cold3b' || s.kind === 'limpRR') ? P.cold3bEval(s.depth, s.label)
          : s.kind === 'vs4bet' ? P.vs4betEval(s.depth, s.pos3, s.label)
            : P.vs3betEval(s.depth, s.pos3, s.label);
    var acc = [v.action];
    if (v.nearTb) { if (acc.indexOf('threebet') < 0) acc.push('threebet'); if (acc.indexOf('call') < 0) acc.push('call'); }
    if (v.nearCall) { if (acc.indexOf('call') < 0) acc.push('call'); if (acc.indexOf('fold') < 0) acc.push('fold'); }
    var right = acc.indexOf(a) >= 0, word = { threebet: ai.w, call: 'Call', fold: 'Fold' };
    var verb = s.kind === 'squeeze' ? 'squeeze' : s.kind === 'vs3bet' ? (s.depth >= 30 ? '4-bet' : 'jam') : s.kind === 'vs4bet' ? '5-bet jam' : ai.w.toLowerCase();
    var seatTag = (s.kind === 'vs' || s.kind === 'cold3b' || s.kind === 'squeeze') && (s.vseat || s.blind) ? 'as the ' + (s.vseat || s.blind) + ': ' : '';
    // overrides (AK promotion, war demotions) explain themselves — never print a
    // band sentence the verdict contradicts
    if (v.note) return {
      right: right, marginal: right && a !== v.action, idealAct: v.action, idealWord: word[v.action],
      why: seatTag + v.note + ' <span class="dim">(' + esc(s.label) + ' ranks top ' + (v.p * 100).toFixed(0) + '%.)</span>'
    };
    var blindNote = s.blind === 'BB' ? ' BB defends wide — you close the action with a discount.'
      : s.blind === 'SB' ? ' SB leans 3-bet-or-fold — OOP all hand, flatting is thin.'
        : s.kind === 'vs' && s.vseat ? ' In the field (no discount, players behind) you continue tighter than the blinds.'
          : s.kind === 'cold3b' ? ' An open AND a 3-bet in front of you = two shown ranges — only the nutted tier continues cold.'
          : s.kind === 'vs4bet' ? ' Facing a 4-bet deep: jam KK+ (and AK), call the QQ/JJ set-mine tier, release AQs and prettier-than-they-look hands.'
          : s.kind === 'limpRR' ? ' A limper who limp-reraises shows up with a NUTTED range (AA/KK/AK mostly) — limp-3-bet bluffs barely exist, even from decent players. 4-bet only your premiums, call the QQ/JJ set-mine tier, fold the rest — and never hero-call light here.' : '';
    if (s.kind === 'squeeze' && s.limped){
      blindNote = ' A raise OVER limpers — treat it like facing an open: the limps are dead money, but iso ranges run stronger than normal opens.';
    } else if (s.kind === 'squeeze' && s.vseat === 'BB'){
      // show the actual price: open 2.2x + N callers, BB has 1bb in + ante pot
      var potB = 2.2 * (s.callers + 1) + 0.5 + 1 + 1, callAmt = 1.2;
      blindNote = ' Closing the BB multiway: ~' + callAmt.toFixed(1) + 'bb into ~' + potB.toFixed(1) + 'bb ≈ ' +
        Math.round(100 * callAmt / (potB + callAmt)) + '% price — overcall wide, squeeze only your value tier.';
    } else if (s.kind === 'squeeze' && s.vseat === 'SB'){
      blindNote = ' SB multiway: good price but no closure and OOP — overcall medium-wide, squeeze the value tier.';
    } else if (s.kind === 'squeeze'){
      blindNote = ' In the field with players still behind — continue tight; the squeeze does more work than the flat.';
    }
    return {
      right: right, marginal: right && a !== v.action, idealAct: v.action, idealWord: word[v.action],
      why: seatTag + verb + ' ~top ' + (v.tb * 100).toFixed(0) + '%, call/overcall to ~' + (v.call * 100).toFixed(0) + '%, else fold. ' + esc(s.label) + ' is at ' + (v.p * 100).toFixed(0) + '%.' + blindNote
    };
  }
  function gradeOdds(s, a) {
    var marginal = Math.abs(s.equity - s.required) <= 0.025;
    var correct = s.equity >= s.required ? 'call' : 'fold';
    return {
      right: marginal || a === correct, marginal: marginal, idealAct: correct, idealWord: correct === 'call' ? 'Call' : 'Fold',
      why: 'It was a <b>' + s.name + '</b> = <b>' + s.outs + ' outs</b> ≈ <b>' + Math.round(s.equity * 100) + '%</b> (' + (s.variant === 'turn' ? '×2' : '×4') + ' rule). ' +
        'You needed <b>' + Math.round(s.required * 100) + '%</b> = $' + s.bet + ' ÷ ($' + s.pot + ' pot + $' + s.bet + ' bet + $' + s.bet + ' your call = $' + (s.pot + 2 * s.bet) + '). ' +
        '<span class="dim">' + (s.equity >= s.required ? 'Price is right.' : 'Short — unless implied odds bail you out.') + ' Don’t forget your own call sits in the final pot.</span>'
    };
  }
  function gradeCbet(s, a) {
    var mix = s.mix, fn = s.fn;
    var labelOf = {};
    fn.options.forEach(function (o) { labelOf[o.act] = o.label; });
    var pick = mix.filter(function (e) { return e.act === a; })[0] || { f: 0 };
    var top = mix[0];
    var f = pick.f, fTop = top.f;
    var right = f >= 0.12, marginal = right && a !== top.act;
    var mixTxt = mix.filter(function (e) { return e.f >= 0.05; }).map(function (e) {
      var szTag = e.act === 'bet' ? (e.size === 'big' ? '⅔' : '⅓')
        : e.act === 'raise' ? (e.size === 'big' ? 'pot-ish' : '≈3x') : null;   // raises size off THEIR bet, not the pot
      var nm = (labelOf[e.act] || e.act) + (e.size && szTag ? ' (' + szTag + ')' : '');
      var pctF = Math.round(e.f * 100) + '%';
      return e.act === a ? '<b>' + nm + ' ' + pctF + '</b>' : nm + ' ' + pctF;
    }).join(' · ');
    var head = a === top.act ? (labelOf[a] || a) + ' — the main line (' + Math.round(fTop * 100) + '%)'
      : right ? 'part of the mix — you took the ' + Math.round(f * 100) + '% line'
        : 'not in the mix (<12%) — main line ' + (labelOf[top.act] || top.act) + ' ' + Math.round(fTop * 100) + '%';
    var plan = '';
    if (s.multiway) {                            // multiway: heads-up turn-plan tree doesn't apply
      plan = '<div class="fbtree">' +
        '<span class="tw">Bet, called →</span> still likely multiway — keep barreling only strong value; check/give up the rest.<br>' +
        '<span class="tw">Bet, raised →</span> fold far more than heads-up: a raise into a multiway field is nutted, and a player may still be behind. Continue only with strong value / big draws.<br>' +
        '<span class="tw">Why so tight →</span> you must beat BOTH callers, and a bluff needs them BOTH to fold — fold equity is multiplicative. C-bet value-heavy, check your air.</div>';
    } else if (s.ctx && s.street !== 'river') {  // heads-up: the decision tree, framed by hand strength (no next street on the river)
      var tree = PF.planTree(s.node, s.ctx, s.hole, s.board);
      plan = '<div class="fbtree">' + tree.map(function (l) {
        return '<span class="tw">' + esc(l.when) + '</span> ' + l.what;
      }).join('<br>') + '</div>';
    }
    var mdf = '';
    if (s.price != null) {
      var mdfPct = Math.round(100 * s.pot / (s.pot + s.bet));
      mdf = ' MDF vs this size ≈ <b>' + mdfPct + '%</b> of your range continues.';
    }
    var actTag = s.multiway ? ', equity vs the FIELD (beat both)'
      : s.street === 'turn' ? ', story-weighted (flop + turn actions)'
      : (s.node === 'ipBet' || s.node === 'oopBet') ? ', bet-weighted' : s.node === 'ipCheck' ? ', check-weighted' : '';
    // Sizing rationale — reinforce the mental model (range advantage + texture)
    // on every betting rep without grading exact bb. Shown whenever a bet/raise
    // carries weight in the mix.
    var betE = mix.filter(function (e) { return (e.act === 'bet' || e.act === 'raise') && e.f >= 0.12; })[0];
    var sizeWhy = '';
    if (betE) {
      var wet = s.ctx && s.ctx.wet;
      var isRaise = betE.act === 'raise';
      // RIVER monster: finished board, no draws to protect → the most polarized spot
      // in poker. Size BIG for max value regardless of texture — the board heuristic
      // is for range-betting, never for a specific monster. (A♥7♥ nut-flush catch.)
      var riverMonster = s.street === 'river' && (s.tier === 'monster' || (s.eq != null && s.eq >= 0.90));
      var sz, rationale;
      if (riverMonster) {
        sz = isRaise ? 'raise big (≈ a pot-sized raise / 3×+ their bet)' : 'bet big (≈ pot or overbet)';
        rationale = 'finished board, nothing to protect and you hold a monster → ' + (isRaise ? 'raising' : 'betting') +
          ' BIG is pure max value: charge their whole bluff-and-second-best range. The most polarized spot in poker — don’t shrink it to stay balanced (slow-playing some is fine, but the value is in sizing up)';
      } else {
        sz = isRaise ? (betE.size === 'big' ? 'raise pot-ish (≈3× their bet)' : 'raise small (≈2.5×)')
                     : (betE.size === 'big' ? 'lean bigger (≈⅔–pot)' : 'small (≈⅓)');
        rationale = s.multiway ? 'multiway you size UP with value (more players = more equity to deny) and check your bluffs — fold equity is multiplicative'
          : (s.edge === 'big' && !wet) ? 'your range owns a dry board → bet small and often; nothing draws, so a big bet only folds out what you already beat'
            : wet ? 'wet board → size up to charge draws + protect, or check the hands that don’t want a bloated pot'
              : 'shared/neutral board → keep it medium and check more; equities run close, so don’t over-polarize';
      }
      sizeWhy = ' <span class="szwhy"><b>Sizing:</b> ' + sz + ' — ' + rationale + '.</span>';
    }
    // Bet TYPE — teach "bet with a reason," not a bluff frequency. Driven by the
    // objective tier (shapes prose, never the verdict). Pure bluffs get the
    // exploit reminder: vs a recreational field, balance is wasted and his leak
    // is over-bluffing → default to giving up unless he has a read.
    var betNature = '';
    if (betE) {
      var t = s.tier;
      betNature = (t === 'monster' || t === 'strong')
        ? ' <span class="natw"><b>Bet type:</b> value — you’re betting to get called by worse.</span>'
        : t === 'marginal'
          ? ' <span class="natw"><b>Bet type:</b> thin value / protection — deny equity and get called by worse; don’t pile in if raised.</span>'
          : (t === 'draw' || t === 'semibluff')
            ? ' <span class="natw"><b>Bet type:</b> semi-bluff — you have equity (a draw + outs) AND fold equity. This is +EV aggression — keep it.</span>'
            : ' <span class="natw"><b>Bet type:</b> pure bluff (no equity) — only profits if they fold. Vs this field that needs a <b>read</b>: bluff the nits, never the stations, and default to giving up when unsure. This is exactly where your leak lives.</span>';
    }
    var baseWhy = '<b>' + esc(s.cls.label) + '</b> · ' + (s.edge === 'big' ? 'board favors YOUR range' : s.edge === 'low' ? 'board favors them' : 'neutral board') +
      (s.tcard ? ' · turn card: ' + (s.tcard === 'brake' ? '<b>brake</b> (helps their range)' : s.tcard === 'barrel' ? '<b>scare/improve</b> (your card)' : 'brick') : '') +
      ' · mix: ' + mixTxt + '. ' + fn.why + mdf + sizeWhy + betNature +
      ' <span class="dim">(range: ' + esc(s.villDesc) + actTag + ' · frequencies are a calibrated model — not a solve)</span>' + plan;
    return { right: right, marginal: marginal, idealAct: top.act, idealWord: head, verb: 'Mix', why: baseWhy };
  }

  // Real spot: compare your action to the engine's baked take, then REVEAL what
  // actually happened (the result is context, not the answer key).
  function answerReal(s, a) {
    var e = s.e, ideal = e.engine.ideal, match = (a === ideal);
    stats.att++;
    var mr = stats.byMode[mode] || (stats.byMode[mode] = { a: 0, c: 0 }); mr.a++;
    if (match) { stats.cor++; mr.c++; stats.streak++; if (stats.streak > stats.best) stats.best = stats.streak; }
    else stats.streak = 0;
    saveStats();
    if (window.recordDrill) { try { window.recordDrill({ t: Date.now(), m: s.street, k: 'real:' + e.decision, r: match ? 'right' : 'wrong', ans: a, ideal: ideal, hand: e.label, board: e.board.join(''), eq: e.engine.eq, real: 1 }); } catch (err) { } }
    var net = e.actual.net, H = window.HandEval, villC = e.villCards.match(/../g).map(cardHtml).join(''), heroBest = null;
    if (H && H.eval7) { var c = H.cmp(H.eval7(e.heroCards.match(/../g).concat(e.board).map(H.cardId)), H.eval7(e.villCards.match(/../g).concat(e.board).map(H.cardId))); heroBest = c > 0 ? 1 : c < 0 ? -1 : 0; }
    var aggro = e.actual.action === 'bet' || e.actual.action === 'raise';
    var res = net > 0 ? 'hero <b>won +' + net + 'bb</b>' : net < 0 ? 'hero <b>lost ' + net + 'bb</b>' : 'hero <b>chopped</b>';
    var note = (aggro && net > 0 && heroBest === -1) ? ' — a <b>bluff that worked</b> (villain folded a better hand)'
      : (e.actual.action === 'check' && e.actual.tail && /raises to/.test(e.actual.tail)) ? ' — a <b>check-raise</b>'
        : '';
    // show the COMPLETE action from the decision onward, so the net always makes sense (e.g. a "check"
    // that became a check-raise all-in). Falls back to a one-liner for older pools without the tail.
    var story = (e.actual.tail ? esc(e.actual.tail) + ' → ' : '') + res + ' · villain had ' + villC + note;
    var cls = match ? 'good' : 'mix';
    var head = match ? '✓ You matched the engine — <b>' + ideal + '</b>' : '≈ Engine’s take: <b>' + ideal + '</b> <span class="dim">(you chose ' + a + ')</span>';
    var eqLine = 'eq <b>' + e.engine.eq + '%</b>' + (e.engine.eqCall != null && e.decision === 'cb' ? ' · vs the calling range <b>' + e.engine.eqCall + '%</b>' : '');
    $('drillBtns').hidden = true;
    var fb = $('drillFb'); fb.hidden = false;
    fb.innerHTML = '<div class="fbhead ' + cls + '">' + head + '</div>' +
      '<div class="fbwhy"><span class="dim">' + eqLine + '</span> — ' + esc(e.engine.why) +
      '<div class="dim" style="margin-top:3px">villain range: ' + esc(e.engine.range) + '</div>' +
      '<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25)"><b>What actually happened:</b> ' + story +
      '. <span class="dim">The result isn’t the answer — just the real spot.</span></div></div>' +
      '<button class="btn next" id="drillNext">Next hand</button>';
    $('drillNext').onclick = newScenario;
    renderStats();
  }

  // Full-hand decision: grade your action vs the engine's baked take, reveal what the
  // real player did at THIS point, then advance along the real line (or, on the last
  // decision, show the whole run-out + showdown).
  function answerHand(s, a) {
    var hand = s.hand, di = s.di, d = hand.decisions[di], e = s.e;
    var ideal = e.engine.ideal, match = (a === ideal), last = di >= hand.decisions.length - 1;
    stats.att++;
    var mr = stats.byMode.hands || (stats.byMode.hands = { a: 0, c: 0 }); mr.a++;
    if (match) { stats.cor++; mr.c++; stats.streak++; if (stats.streak > stats.best) stats.best = stats.streak; }
    else stats.streak = 0;
    saveStats();
    if (window.recordDrill) { try { window.recordDrill({ t: Date.now(), m: 'hands', k: 'hand:' + e.decision, r: match ? 'right' : 'wrong', ans: a, ideal: ideal, hand: e.label, board: e.board.join(''), eq: e.engine.eq, real: 1, hid: hand.id, di: di }); } catch (err) { } }
    var cls = match ? 'good' : 'mix';
    var head = match ? '✓ You matched the engine — <b>' + ideal + '</b>' : '≈ Engine’s take: <b>' + ideal + '</b> <span class="dim">(you chose ' + a + ')</span>';
    var eqLine = 'eq <b>' + e.engine.eq + '%</b>' + (e.engine.eqCall != null && e.decision === 'cb' ? ' · vs the calling range <b>' + e.engine.eqCall + '%</b>' : '');
    var actW = { check: 'checked', bet: 'bet', fold: 'folded', call: 'called', raise: 'raised' }[d.actual] || d.actual;
    $('drillBtns').hidden = true;
    var fb = $('drillFb'); fb.hidden = false;
    var body = '<div class="fbhead ' + cls + '">' + head + '</div>' +
      '<div class="fbwhy"><span class="dim">' + eqLine + '</span> — ' + esc(e.engine.why) +
      '<div class="dim" style="margin-top:3px">villain range: ' + esc(e.engine.range) + '</div>' +
      '<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25)"><b>Actual line:</b> hero <b>' + actW + '</b>.';
    if (last) {
      var net = hand.net, villC = hand.villCards.match(/../g).map(cardHtml).join('');
      var res = net > 0 ? 'won <b>+' + net + 'bb</b>' : net < 0 ? 'lost <b>' + net + 'bb</b>' : '<b>chopped</b>';
      body += '</div>' +
        '<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25)"><b>How it played out:</b> ' +
        (hand.tail ? esc(hand.tail) + ' → ' : '') + 'hero ' + res + ' · villain had ' + villC +
        '. <span class="dim">You walked the real hand — the engine take was the lesson, the result is just how it went.</span></div></div>' +
        '<button class="btn next" id="drillNext">Next hand</button>';
      fb.innerHTML = body;
      $('drillNext').onclick = newScenario;
    } else {
      var nd = hand.decisions[di + 1], nextLabel = nd.street !== d.street ? 'see the ' + nd.street + ' →' : 'continue →';
      body += ' <span class="dim">The hand follows reality — next decision uses what actually happened.</span></div></div>' +
        '<button class="btn next" id="drillNext">' + nextLabel + '</button>';
      fb.innerHTML = body;
      $('drillNext').onclick = function () { cur = handAt(hand, di + 1); renderScenario(); };
    }
    renderStats();
  }

  function answer(a) {
    var s = cur;
    if (s.real) { if (s.hands) { if (s.e) answerHand(s, a); } else if (s.e) answerReal(s, a); return; }   // ignore clicks while pool still loading
    var g = s.mode === 'pf' ? gradePF(s, a) : s.mode === 'odds' ? gradeOdds(s, a) : gradeCbet(s, a);
    // close spot where you picked the strictly-ideal action = a clean correct,
    // not a "mix" (mix = you took the OTHER acceptable line)
    var pickedIdeal = g.idealAct != null && a === g.idealAct;

    stats.att++;
    var mr = stats.byMode[mode] || (stats.byMode[mode] = { a: 0, c: 0 }); mr.a++;
    var dep = s.mode === 'pf' ? (stats.byDepth[s.depth] || (stats.byDepth[s.depth] = { a: 0, c: 0 })) : null;
    if (dep) dep.a++;
    if (g.marginal && !pickedIdeal) { stats.mix++; stats.cor++; mr.c++; if (dep) dep.c++; }   // took the other fine line
    else if (g.right) { stats.cor++; mr.c++; if (dep) dep.c++; stats.streak++; if (stats.streak > stats.best) stats.best = stats.streak; if (s.mode === 'pf' && s.replay) removeMiss(s); }
    else { stats.streak = 0; if (s.mode === 'pf') addMiss(s); }
    saveStats();

    logAnswer(s, a, g);

    // deep chain: you 3-bet a deep open and the opener 4-bets — same hand
    if (s.mode === 'pf' && s.kind === 'vs' && a === 'threebet' && s.depth >= 50 && Math.random() < (pfDepthFocus() === 'deep' ? 0.22 : 0.10)) {
      pendingChain = { mode: 'pf', kind: 'vs4bet', vseat: s.vseat, raiser: s.opener,
        pos3: ipVs(s.vseat, s.opener), depth: s.depth, c1: s.c1, c2: s.c2, label: s.label, chained: true };
    }
    // live-deal chain: you opened and a seat behind 3-bets — same hand, new decision
    if (s.mode === 'pf' && s.kind === 'open' && s.chainRaiser && a === 'open') {
      pendingChain = { mode: 'pf', kind: 'vs3bet', pos: s.pos, raiser: s.chainRaiser,
        pos3: ipVs(s.pos, s.chainRaiser), depth: s.depth >= 20 ? s.depth : 20,
        c1: s.c1, c2: s.c2, label: s.label, chained: true };
    }

    var head, cls, verb = g.verb || 'Ideal';
    if (verb === 'Mix') {                                  // c-bet: frequency-phrased heads
      cls = g.marginal ? 'mix' : g.right ? 'good' : 'bad';
      head = (cls === 'good' ? '✓ ' : cls === 'mix' ? '≈ ' : '✗ ') + g.idealWord;
    }
    else if (g.marginal && pickedIdeal) {
      // close spot AND you picked the ideal action — acknowledge it, don't imply you deviated
      cls = 'good'; head = '✓ ' + g.idealWord + ' <span class="dim">(close — the other line’s fine too)</span>';
    }
    else if (g.marginal) { cls = 'mix'; head = '≈ Close — ' + verb.toLowerCase() + ' is <b>' + g.idealWord + '</b>, your answer’s fine'; }
    else if (g.right) { cls = 'good'; head = '✓ ' + g.idealWord; }
    else { cls = 'bad'; head = '✗ ' + verb + ': ' + g.idealWord; }

    $('drillBtns').hidden = true;
    var fb = $('drillFb'); fb.hidden = false;
    fb.innerHTML = '<div class="fbhead ' + cls + '">' + head + '</div><div class="fbwhy">' + g.why + '</div>' +
      '<button class="btn next" id="drillNext">' + (pendingChain ? P.POS_NAME[pendingChain.raiser] + (pendingChain.kind === 'vs4bet' ? ' 4-bets you →' : ' 3-bets you →') : 'Next hand') + '</button>';
    $('drillNext').onclick = newScenario;
    renderStats();
  }

  // Record each answer to the synced db (db.drills) for later pattern analysis.
  function logAnswer(s, a, g) {
    if (!window.recordDrill) return;
    var e = { t: Date.now(), m: s.mode, r: (g.marginal && a !== g.idealAct) ? 'mix' : (g.right ? 'right' : 'wrong'), ans: a, ideal: g.idealWord };
    if (pfDepthFocus() === 'leak') e.focus = 'leak';     // tag weak-spot reps for leak-trend analysis
    if (s.mode === 'pf') { e.k = s.kind; e.depth = s.depth; e.spot = [s.opener, s.raiser, s.vseat || s.pos || s.pos3].filter(Boolean).join('>'); e.hand = s.label; e.style = pfStyle(); if (s.chained) e.chained = 1; }
    else if (s.mode === 'odds') { e.k = 'odds:' + s.key; e.eq = Math.round(s.equity * 100); e.req = Math.round(s.required * 100); e.street = s.variant; }
    else { e.k = (s.street === 'river' ? 'river:' : 'cbet:') + s.node; e.spot = SEAT_NAME[s.heroSeat] + (s.pos === 'ip' ? '/IP' : '/OOP'); e.pot = s.potType; e.edge = s.edge; e.hand = s.cls.label; e.board = s.board.join(''); e.eq = Math.round(s.eq * 100); if (s.price != null) { e.price = Math.round(s.price * 100); e.bet = s.bet; } if (s.street === 'turn' || s.street === 'river') { e.street = s.street; e.sub = s.sub; e.tier = s.tier; } }
    try { window.recordDrill(e); } catch (err) { /* logging must never break the drill */ }
  }

  function addMiss(s) {
    var k = spotKey(s);
    stats.misses = stats.misses.filter(function (m) { return spotKey(m) !== k; });
    stats.misses.unshift({ kind: s.kind, pos: s.pos, opener: s.opener, raiser: s.raiser, vseat: s.vseat, pos3: s.pos3, callers: s.callers, limpers: s.limpers, blind: s.blind, depth: s.depth });
    if (stats.misses.length > 40) stats.misses.length = 40;
  }
  function removeMiss(s) {
    var k = spotKey(s);
    stats.misses = stats.misses.filter(function (m) { return spotKey(m) !== k; });
    saveStats();
  }

  function renderStats() {
    var acc = stats.att ? Math.round(stats.cor / stats.att * 100) : 0;
    var modeChips = MODES.filter(function (m) { return stats.byMode[m.v]; }).map(function (m) {
      var r = stats.byMode[m.v]; return '<span class="chip">' + m.t + ' <b>' + Math.round(r.c / r.a * 100) + '%</b></span>';
    }).join('');
    var depths = Object.keys(stats.byDepth).sort(function (a, b) { return a - b; });
    var dh = mode === 'pf' ? depths.map(function (k) {
      var r = stats.byDepth[k]; return '<span class="chip">' + k + 'bb <b>' + (r.a ? Math.round(r.c / r.a * 100) : 0) + '%</b></span>';
    }).join('') : '';
    $('drillStats').innerHTML =
      '<div class="stats">' +
      '<span class="chip">accuracy <b>' + acc + '%</b></span>' +
      '<span class="chip">hands <b>' + stats.att + '</b></span>' +
      '<span class="chip">streak <b>' + stats.streak + '</b></span>' +
      '<span class="chip">best <b>' + stats.best + '</b></span>' +
      (stats.misses.length ? '<span class="chip">review queue <b>' + stats.misses.length + '</b></span>' : '') +
      '</div>' + (modeChips ? '<div class="stats" style="margin-top:6px">' + modeChips + '</div>' : '') +
      (dh ? '<div class="stats" style="margin-top:6px">' + dh + '</div>' : '') +
      '<button class="reset" id="drillReset">reset stats</button>';
    $('drillReset').onclick = function () {
      if (!confirm('Reset drill stats and review queue?')) return;
      var mo = stats.mode; stats = freshStats(); stats.mode = mo; saveStats(); renderStats();
    };
  }

  /* ====================== POCKET CARD ====================== */
  var cDepth = 20, cSit = 'open', cPos = 'BTN', cOpener = 'BTN', cYou = 'field', cIpo = 'ip';

  function selRow(items, attr, val) {
    return items.map(function (it) {
      return '<button data-' + attr + '="' + it.v + '"' + (it.v == val ? ' class="on"' : '') + '>' + it.t + '</button>';
    }).join('');
  }

  function renderSelectors() {
    var dlist = cSit === 'vs3' ? [20, 30, 50, 100] : P.CARD_DEPTHS;
    if (dlist.indexOf(cDepth) < 0) cDepth = dlist[0];
    var depths = dlist.map(function (d) { return { v: d, t: d + 'bb' }; });
    var sits = [{ v: 'open', t: 'First in' }, { v: 'vs', t: 'Facing a raise' }, { v: 'vs3', t: 'Vs 3-bet' }];
    var html = '<div class="sel" id="selDepth">' + selRow(depths, 'd', cDepth) + '</div>' +
      '<div class="sel" id="selSit">' + selRow(sits, 'x', cSit) + '</div>';
    if (cSit === 'open') {
      var pos = P.POS.map(function (p) { return { v: p, t: p }; });
      html += '<div class="sel sub"><span class="sl">You:</span>' + selRow(pos, 'p', cPos) + '</div>';
    } else if (cSit === 'vs3') {
      var ipo = [{ v: 'ip', t: 'You’re IP' }, { v: 'oop', t: 'You’re OOP' }];
      html += '<div class="sel sub"><span class="sl">Position:</span>' + selRow(ipo, 'i', cIpo) + '</div>';
    } else {
      var yous = [{ v: 'field', t: 'In field' }, { v: 'SB', t: 'SB' }, { v: 'BB', t: 'BB' }];
      html += '<div class="sel sub"><span class="sl">You:</span>' + selRow(yous, 'u', cYou) + '</div>';
      var ops = cYou === 'BB' ? ['EP', 'MP', 'CO', 'BTN', 'SB'] : P.OPENERS;   // BB can face an SB open
      if (ops.indexOf(cOpener) < 0) cOpener = ops[ops.length - 1];
      var op = ops.map(function (p) { return { v: p, t: p }; });
      html += '<div class="sel sub"><span class="sl">Opener:</span>' + selRow(op, 'o', cOpener) + '</div>';
    }
    $('cardSel').innerHTML = html;
    // single idempotent delegate (renderSelectors re-runs on every change)
    $('cardSel').onclick = function (e) {
      var b;
      if ((b = e.target.closest('[data-d]'))) { cDepth = +b.dataset.d; return renderCard(); }
      if ((b = e.target.closest('[data-x]'))) { cSit = b.dataset.x; return renderCard(); }
      if ((b = e.target.closest('[data-p]'))) { cPos = b.dataset.p; return renderCard(); }
      if ((b = e.target.closest('[data-u]'))) { cYou = b.dataset.u; return renderCard(); }
      if ((b = e.target.closest('[data-i]'))) { cIpo = b.dataset.i; return renderCard(); }
      if ((b = e.target.closest('[data-o]'))) { cOpener = b.dataset.o; return renderCard(); }
    };
  }
  function vsRow() { return cYou === 'field' ? P.vsThresholds(cDepth, cOpener) : P.blindVsThresholds(cYou, cDepth, cOpener); }

  function cellAction(label) {
    if (cSit === 'open') {
      if (cDepth === 10 && window.NASH && window.NASH.jam[10])      // Nash set, not a percentile prefix
        return window.NASH.jam[10][cPos][label] > 0 ? 'in' : 'fold';
      if (cPos === 'SB' && cDepth >= 20) {                          // SB: raise / limp / fold (ante VPIP)
        var sa = P.sbAction(cDepth, label); return sa === 'raise' ? 'in' : sa === 'limp' ? 'call' : 'fold';
      }
      return P.openIn(cPos, cDepth, label) ? 'in' : 'fold';
    }
    if (cSit === 'vs3') return P.vs3betEval(cDepth, cIpo, label).action;   // includes AK promotion
    var row = vsRow();
    var p = P.defendPct(label, cDepth);               // defend rank (SC + set-mine), matches bandEval
    if (p == null) return 'fold';
    return p <= row.tb ? 'threebet' : p <= row.call ? 'call' : 'fold';
  }

  function renderGrid() {
    var html = '<div class="grid13">';
    for (var r = 0; r < 13; r++) {
      for (var c = 0; c < 13; c++) {
        var label = r === c ? RORD[r] + RORD[r] : r < c ? RORD[r] + RORD[c] + 's' : RORD[c] + RORD[r] + 'o';
        var a = cellAction(label);
        var cls = a === 'in' ? 'in' : a === 'threebet' ? 'tb' : a === 'call' ? 'cl' : '';
        html += '<div class="g13 ' + cls + '">' + label + '</div>';
      }
    }
    $('cardGrid').innerHTML = html + '</div>' + legend();
  }

  function legend() {
    if (cSit === 'open') {
      if (cPos === 'SB' && cDepth >= 20)                            // SB: 3-color raise/limp/fold
        return '<div class="lg"><span class="k in"></span>raise<span class="k cl"></span>limp<span class="k"></span>fold' +
          ' <span class="dim">· s = suited, o = offsuit</span></div>';
      var verb = cDepth === 10 ? 'jam' : 'raise';
      return '<div class="lg"><span class="k in"></span>' + verb + '<span class="k"></span>fold' +
        ' <span class="dim">· s = suited, o = offsuit</span></div>';
    }
    var tb = cSit === 'vs3' ? (cDepth >= 30 ? '4-bet' : '4-bet jam') : (cDepth >= 30 ? '3-bet' : '3-bet jam');
    return '<div class="lg"><span class="k tb"></span>' + tb + '<span class="k cl"></span>call' +
      '<span class="k"></span>fold <span class="dim">· s = suited, o = offsuit</span></div>';
  }

  function combosFor(test) {
    var n = 0;
    for (var i = 0; i < DATA.ranking.length; i++) if (test(DATA.ranking[i].h)) n += DATA.ranking[i].w;
    return n;
  }

  function renderMeta() {
    if (cSit === 'open') {
      var thr = P.openThreshold(cPos, cDepth);
      var pctH = Math.round(thr * 100);
      if (cPos === 'SB' && cDepth >= 20) {                          // SB with a limp range
        var lc = Math.round(P.sbLimpCutoff(cDepth) * 100);
        $('cardMeta').innerHTML = '<b>small blind</b>, ' + cDepth + 'bb — folded to you, heads-up vs the BB. ' +
          'Raise <b>~' + pctH + '%</b>, <b>limp</b> the playable band out to <b>~' + lc + '%</b>, fold the rest.' +
          ' <span class="dim">The big-blind ante makes completing cheap, so the SB plays a huge total VPIP (~' + lc + '%) — far more than the raise range alone. Limp the suited/connected/small-pair hands too weak to raise but too good to fold OOP; the green cells are your limps. Fold offsuit junk even at the great price.</span>';
        return;
      }
      var verb = cDepth === 10 ? 'open-jam' : 'open-raise';
      var src = cDepth === 10 && window.NASH ? ' <span class="dim">Nash-solved (BB-ante pot) — note the suited hands hanging below the offsuit line.</span>'
        : ' <span class="dim">Folded to you, first in.</span>';
      $('cardMeta').innerHTML = '<b>' + P.POS_NAME[cPos] + '</b>, ' + cDepth + 'bb — ' + verb +
        ' <b>~' + pctH + '%</b> of hands.' + src;
    } else if (cSit === 'vs3') {
      var t3 = (P.VS3BET[cDepth] || P.VS3BET[30])[cIpo];
      var v3 = cDepth >= 30 ? '4-bet' : '4-bet jam';
      $('cardMeta').innerHTML =
        'You opened, someone <b>3-bet</b>, you’re <b>' + (cIpo === 'ip' ? 'in position' : 'out of position') + '</b> at ' + cDepth + 'bb. ' +
        v3 + ' ~<b>' + Math.round(t3.tb * 100) + '%</b>, call up to ~<b>' + Math.round(t3.call * 100) + '%</b>, fold the rest. ' +
        '<span class="dim">' + (cDepth === 20 ? 'At ≤20bb this is really jam-or-fold — flatting creates an SPR≈1 guessing game.' :
          cIpo === 'ip' ? 'IP you can flat the middle of your range; the 4-bets are value-weighted.' :
            'OOP lean 4-bet-or-fold — calling to play a 3-bet pot out of position bleeds.') +
        ' Note AK is promoted into the 4-bet zone at every depth (blockers + domination beat its raw rank) — see the AK playbook below.</span>' +
        '<div class="refnote"><b>4-bet bluffs — default vs adjust.</b> Theory says polarize: value (AA/KK/AK) + a few bluffs, ideally <b>suited wheel aces (A5s/A4s/A3s)</b> — they block AA/AKs and keep a wheel/flush backup when called. <b>Default at $1–1.5K live: stay value-heavy, flat the wheel aces.</b> The field 3-bets value-heavy and doesn’t fold to 4-bets, so bluff-4-betting folds out hands that aren’t there. <b>Adjust UP vs aggressive regs / online-style 3-bettors</b> (they 3-bet light → A5s 4-bet bluffs print). Same logic for <b>flat-calling 4-bets light</b> (suited Broadway/Ax, IP, deep): a reg-game move, not a default vs a range that 4-bets only the nuts.</div>';
    } else {
      var th = vsRow();
      var tbVerb = cDepth >= 30 ? '3-bet' : '3-bet jam';
      var who = cYou === 'field' ? 'folded to you (in the field)' : 'you’re in the <b>' + cYou + '</b>';
      var note = cYou === 'BB'
        ? 'BB defends widest — you close the action and already have 1bb in. Vs the SB it’s the widest spot in poker.'
        : cYou === 'SB'
          ? 'SB leans 3-bet-or-fold — out of position all hand with no closing discount, so flatting is thin.'
          : 'You play wider vs a later opener (button) than vs UTG — that’s the whole idea.';
      $('cardMeta').innerHTML =
        '<b>' + P.POS_NAME[cOpener] + '</b> open-raises, ' + who + '. ' +
        tbVerb + ' ~<b>' + Math.round(th.tb * 100) + '%</b>, ' + (cYou === 'BB' ? 'defend' : 'flat-call') + ' up to ~<b>' + Math.round(th.call * 100) + '%</b>, fold the rest. ' +
        '<span class="dim">' + note + '</span>';
    }
  }

  /* ---------- reference blocks ---------- */
  function maxCall(e) {                              // direct-odds max bet (× pot) for equity e
    if (e >= 0.5) return 'any size';
    var x = e / (1 - 2 * e);
    var s = x >= 1 ? x.toFixed(1) : x.toFixed(2).replace(/^0/, '');   // 1.2  or  .31
    return '≤ ' + s + '× pot';
  }
  function mEq(a, b) { var m = (DATA.matchups || []).find(function (z) { return z.a === a && z.b === b; }); return m ? m.eqA : null; }

  function refHtml() {
    // pot odds
    var pot = '<table class="ref"><tr><th>they bet</th><th class="r">you need</th></tr>' +
      '<tr><td>pot-size</td><td class="r">33%</td></tr>' +
      '<tr><td>¾ pot</td><td class="r">30%</td></tr>' +
      '<tr><td>½ pot</td><td class="r">25%</td></tr>' +
      '<tr><td>⅓ pot</td><td class="r">20%</td></tr>' +
      '<tr><td>¼ pot</td><td class="r">17%</td></tr></table>' +
      '<div class="dim" style="margin-top:6px">Need % = bet ÷ (pot + 2·bet). Beat it → call.</div>';

    // outs -> equity -> max callable bet
    var draws = [
      ['Gutshot', 4, 9, 16],
      ['Two overcards', 6, 13, 24],
      ['Open-ender', 8, 17, 32],
      ['Flush draw', 9, 19, 35],
      ['FD + gutshot', 12, 26, 45],
      ['FD + open-ender', 15, 33, 54]
    ];
    var outs = '<table class="ref"><tr><th>draw</th><th class="r">turn</th><th class="r">river</th><th class="r">max call*</th></tr>';
    draws.forEach(function (d) {
      outs += '<tr><td>' + d[0] + ' <span class="dim">(' + d[1] + ')</span></td>' +
        '<td class="r">' + d[2] + '%</td><td class="r">' + d[3] + '%</td>' +
        '<td class="r">' + maxCall(d[2] / 100) + '</td></tr>';
    });
    outs += '</table>' +
      '<div class="dim" style="margin-top:6px">turn/river = chance to hit with 1 / 2 cards to come (×2 / ×4 rule). ' +
      '<b>max call*</b> = biggest bet you can call on the <b>turn</b> (1 card) on raw odds. ' +
      'Your flush draw worth ~35% by the river can call up to ~1.2× pot only if there’s no more betting; facing a turn bet (~19%) call ≤ ~⅓ pot. Implied odds let you call a bit more, reverse-implied a bit less.</div>';

    // all-in rules of thumb (model-backed, rounded)
    function pctTxt(v) { return v == null ? '' : Math.round(v) + ' / ' + (100 - Math.round(v)); }
    var rules = '<table class="ref"><tr><th>all-in</th><th class="r">≈ %</th></tr>' +
      '<tr><td>Overpair vs underpair <span class="dim">QQ/99</span></td><td class="r"><b>' + pctTxt(mEq('QQ', '99')) + '</b></td></tr>' +
      '<tr><td>Pair vs two undercards <span class="dim">99/87s</span></td><td class="r"><b>' + pctTxt(mEq('99', '87s')) + '</b></td></tr>' +
      '<tr><td>Pair vs one over+under <span class="dim">TT/A8</span></td><td class="r"><b>' + pctTxt(mEq('TT', 'A8o')) + '</b></td></tr>' +
      '<tr><td>Pair vs two overs <span class="dim">TT/AK</span></td><td class="r"><b>' + pctTxt(mEq('TT', 'AKo')) + '</b></td></tr>' +
      '<tr><td>One card dominated <span class="dim">AQ/AJ</span></td><td class="r"><b>' + pctTxt(mEq('AQo', 'AJo')) + '</b></td></tr>' +
      '<tr><td>Big pair vs two unders <span class="dim">AA/KK</span></td><td class="r"><b>' + pctTxt(mEq('AA', 'KK')) + '</b></td></tr>' +
      '</table><div class="dim" style="margin-top:6px">Rules of thumb: pair vs 2 unders ≈ 4:1, vs over+under ≈ 2:1, vs 2 overs ≈ coin flip (pair edge), dominated ≈ 7:3.</div>';

    var xr = '<ul class="reads">' +
      '<li><b>Why:</b> get value from your strong hands + fold equity with draws, and stop opponents auto-betting when you check.</li>' +
      '<li><b>Build it ~half value / half draws</b> — semi-bluffs with real equity (flush/straight draws, overs+backdoors), not air.</li>' +
      '<li><b>Size ~3× their bet.</b> On wet boards lean bigger; on dry boards check-raise less (you don’t need protection).</li>' +
      '<li><b>Live exploit:</b> vs players who c-bet too much, check-raise more for <b>value</b> — they barrel off. Vs nits who only bet value, check-raise less and believe them.</li>' +
      '</ul>';

    var lead = '<ul class="reads">' +
      '<li><b>Default: don’t.</b> Check to the raiser — preflop aggressor has the range &amp; nut advantage on most boards.</li>' +
      '<li><b>Lead when the board hits <u>your</u> range harder</b> — low/connected flops you defended in the BB (765, 988, 654). You hold more of those than a UTG opener.</li>' +
      '<li><b>Small blocker leads (25–33% pot)</b> on the turn/river set a cheap price and deny a free check-back — great vs passive players who only raise the nuts.</li>' +
      '<li><b>Don’t lead to “see where you’re at.”</b> Bet with a plan: value, deny equity, or set your price.</li>' +
      '</ul>';

    var ak = '<ul class="reads">' +
      '<li><b>AK’s identity: it’s a preflop hand.</b> Best unpaired holding, blocks AA/KK, dominates everything that continues — but it flops a pair only 1 in 3. The <i>default</i> plan: end the hand preflop or get the money in preflop. Defaults are what print vs unknowns; reads and ICM move you off them.</li>' +
      '<li><b>You open, get 3-bet — default by depth:</b> ≤20bb → jam (deviations here are rare and need a strong reason). 25–40bb → 4-bet (~2.3× their 3-bet), call a jam. 50bb+ → 4-bet is still the lean vs wider 3-bettors; flatting is a real option <i>in position</i> or vs tight 3-bettors — with the plan pre-set: call one barrel unimproved, fold to the second.</li>' +
      '<li><b>You 3-bet, face a 4-bet:</b> ≤40bb → jam is the default. Deeper: AKs continues; AKo is genuinely close vs tight ranges.</li>' +
      '<li><b>When folding AK is actually right</b> — it happens, know the spots: ' +
      '<b>(1) the proven nit:</b> if their 4-bet/jam range is truly QQ+/AK, AKo is ~40% with chop-heavy outcomes — at 40bb+ (especially OOP) folding AKo to the oldest, tightest player’s 4-bet is fine. ' +
      '<b>(2) ICM:</b> bubbles, ladder spots, satellites — flips that are +chips are −$; near big jumps even AKs can fold to heavy action. ' +
      '<b>(3) multiway nutted action:</b> open + 3-bet + cold 4-bet in front of you = two-plus nutted ranges — AKo folds, AKs is close. ' +
      'What these share: the money went in <i>before</i> you acted, against ranges that don’t include the hands AK dominates.</li>' +
      '<li><b>Facing a single open-jam ≤25bb:</b> call is near-universal — AK is ≥40% vs every jamming range except exactly AA/KK, and the dead money covers the gap. The exceptions are the ICM cases above, not reads.</li>' +
      '<li><b>Flopped nothing:</b> ace-high is often still best — bluff-catch <b>one</b> small bet on dry boards, then let it go. Paying two streets unimproved is the classic AK leak.</li>' +
      '<li><b>PKO / covered:</b> a covering stack hunts your bounty → wider 3-bets → AK’s value goes <i>up</i>, the 4-bet gets stronger.</li>' +
      '</ul><div class="dim" style="margin-top:6px">The chart promotes AK into the 4-bet zone because that’s the best default — not a law. The drill grades flatting at 30bb+ as “close,” which is the honest answer.</div>';

    var vs3 = '<ul class="reads">' +
      '<li><b>Depth decides everything.</b> ≤20bb after you open: <b>jam or fold</b> — your continues go all-in (calling leaves SPR≈1, a guessing game with no fold equity left). 25–40bb: three buckets — 4-bet your value, call the playable middle <i>in position</i>, fold the rest. OOP: lean <b>4-bet-or-fold</b>; flatting a 3-bet OOP is where chips quietly die.</li>' +
      '<li><b>Read the 3-bet size.</b> Small (≈3× your open IP): defend wider, call more. Big (4×+ or jam-sized): tighten hard and shift to jam-or-fold — their sizing did the range-reading for you.</li>' +
      '<li><b>Facing a 4-bet</b> (you 3-bet, they 4-bet): at 30–40bb a 4-bet commits them — treat it as a jam decision. Continue <b>KK+ always</b>; <b>QQ/AK depth-dependent</b> (jam ≤35bb, closer deeper); everything else — including most of your 3-bet bluffs — <b>folds without regret</b>. Never flat a 4-bet under ~60bb.</li>' +
      '<li><b>The live overlay ($1–1.5K): 3-bets and especially 4-bets are value-heavy.</b> The pool under-bluffs both. A live 4-bet is QQ+/AK so often that folding AQ/JJ/TT is standard and even AK can be a fold vs the oldest, tightest player at the table. Your default vs a 4-bet: believe it.</li>' +
      '<li><b>Your own 4-bet bluffs:</b> A5s/A4s are the textbook candidates (the ace blocks AA/AK) — but only vs players who actually 3-bet bluff. At these stakes that’s rare; mostly just 4-bet value.</li>' +
      '</ul><div class="dim" style="margin-top:6px">The “Vs 3-bet” grid above shows the baseline ranges (calibrated, not solved); these reads tell you when to deviate.</div>';

    var icm = '<ul class="reads">' +
      '<li><b>Near a pay jump, calls need ~10%+ extra equity</b> — never call off a “slight favorite” flip on the bubble.</li>' +
      '<li><b>Medium stacks are handcuffed; big stacks attack them.</b> Be the attacker, not the hostage.</li>' +
      '<li><b>Short + jump matters → ladder. Short + jump doesn’t → jam first-in</b> with anything reasonable.</li>' +
      '</ul>';

    var exploit = '<ul class="reads">' +
      '<li><b>Value bet bigger &amp; thinner</b> — the pool calls too much. Your #1 edge.</li>' +
      '<li><b>Big river raises = the nuts.</b> Fold one pair, feel nothing.</li>' +
      '<li><b>They under-3-bet</b> — when you get 3-bet, believe it.</li>' +
      '<li><b>Iso limpers big</b> (~5–6bb); don’t limp behind into a family pot.</li>' +
      '<li><b>Don’t bluff multiway, don’t barrel stations.</b></li>' +
      '<li><b>Defend the BB wide vs small raises</b>, then honest fit-or-fold OOP.</li>' +
      '</ul>';

    // percentile anchors — computed from the live ranking so they always match the grids
    function anchorsHtml() {
      function nearest(target) {
        var best = [], arr = sorted.map(function (h) { return { h: h.label, d: Math.abs(h.pct - target) }; })
          .sort(function (a, b) { return a.d - b.d; });
        for (var i = 0; i < arr.length && best.length < 3; i++) best.push(arr[i].h);
        return best.join(' · ');
      }
      var rows = [0.01, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50].map(function (t) {
        return '<tr><td>top ' + Math.round(t * 100) + '%</td><td class="r">' + nearest(t) + '</td></tr>';
      }).join('');
      function pc(label) { return Math.round(P.pct(label) * 100); }
      var classes = '<ul class="reads">' +
        '<li><b>Pairs:</b> TT+ ≈ top ' + pc('TT') + '%, 66 ≈ top ' + pc('66') + '%, 22 ≈ top ' + pc('22') + '% — small pairs rank far lower than they feel.</li>' +
        '<li><b>Suited aces:</b> ATs ≈ top ' + pc('ATs') + '%, A5s ≈ top ' + pc('A5s') + '%, A2s ≈ top ' + pc('A2s') + '%.</li>' +
        '<li><b>Offsuit broadways:</b> AQo ≈ top ' + pc('AQo') + '%, KJo ≈ top ' + pc('KJo') + '%, QJo ≈ top ' + pc('QJo') + '%, KTo ≈ top ' + pc('KTo') + '%.</li>' +
        '<li><b>Suited connectors:</b> T9s ≈ top ' + pc('T9s') + '%, 87s ≈ top ' + pc('87s') + '%, 65s ≈ top ' + pc('65s') + '% — playable, not premium.</li>' +
        '<li><b>Trash line:</b> J8o ≈ top ' + pc('J8o') + '%, Q5o ≈ top ' + pc('Q5o') + '% — below ~55% it’s fold-vs-everything territory.</li>' +
        '</ul>';
      var ties = '<div class="dim" style="margin-top:6px">Tie it to ranges: UTG opens ~top ' + Math.round(P.openThreshold('EP', 30) * 100) +
        '% · CO ~' + Math.round(P.openThreshold('CO', 30) * 100) + '% · BTN ~' + Math.round(P.openThreshold('BTN', 30) * 100) +
        '% · 3-bet vs a CO open ~top ' + Math.round(P.vsThresholds(30, 'CO').tb * 100) + '% · cold-call ~top 12%. ' +
        'So “BTN open” ≈ everything above the trash line; “3-bet” ≈ the top-5% table plus the best suited aces.</div>';
      return '<table class="ref"><tr><th>strength</th><th class="r">anchor hands</th></tr>' + rows + '</table>' + classes + ties;
    }

    var sizing = '<p>Size isn’t a number to memorize — it’s <b>three questions, in order</b>:</p>' +
      '<ol style="margin:0 0 8px 16px;padding:0">' +
      '<li><b>Whose range is this board better for?</b> Mine → bet often. Shared → bet less, check more.</li>' +
      '<li><b>How drawy is it</b> (how much equity needs denying)? Dry/static → <b>small</b> (nothing to protect). Wet → <b>big</b> (charge draws) <i>or</i> check (don’t half-commit).</li>' +
      '<li><b>What does THIS hand want?</b> Value → big where worse still calls. Bluff → match your value size. Thin → small/check. Draw → semibluff big <i>where fold equity is real</i>.</li></ol>' +
      '<div class="dim">Texture → size:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Dry + you’re the raiser</b> (K72r): small ⅓, high frequency — a big bet only folds out what you beat.</li>' +
      '<li><b>Wet/dynamic</b> (986ss): ⅔+ with value & draws, or check the in-between hands — don’t bloat a marginal made hand.</li>' +
      '<li><b>Low/disconnected, you’re the BB</b> (752): small or check — neither range is strong, deny cheap.</li>' +
      '<li><b>Middling/connected IP</b> (T98): medium, check back more — equities run close, you get floated/raised.</li></ul>' +
      '<div class="dim">Check-raising a big draw:</div> <b>wet</b> board → raise <b>big</b> (real equity + real fold equity, build it); <b>dry</b> board → big draws barely exist and your raise reps less → lower frequency, lean call/float.<br>' +
      '<div class="dim" style="margin-top:6px">Multiway:</div> size <b>up</b> with value (more players = more equity to deny), check your bluffs — everyone has to fold, so fold equity is multiplicative.';
    var sa = '<p>Every suited ace makes the <b>nut</b> flush — there’s no “dominated flush.” They’re great speculative hands. But they’re <b>not one thing</b>:</p>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>A2s–A5s (wheel aces):</b> nut flush + wheel straight + best blockers. Your aggressive, see-flops style is <b>ideal</b> here — and these are your best 3-bet bluffs. Lean in.</li>' +
      '<li><b>A6s–A8s (middling):</b> the trap hands. No wheel; they flop top-pair-weak-kicker that gets stacked by AK/AQ. Play IP/deep, but be the <b>first to fold</b> them OOP, short, or vs an early open.</li></ul>' +
      '<div class="dim">By decision:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Open:</b> wide — every suited ace from CO/BTN, most from MP. Only tighten A6s–A2s from UTG.</li>' +
      '<li><b>Flat an open IP:</b> good — nut potential + position.</li>' +
      '<li><b>Call a 3-bet IP + deep:</b> yes. The deeper you are, the more the nut-flush implied odds + position + ace blocker justify it. <span class="dim">(The trainer now agrees — it flats suited aces, suited connectors, and small pairs IP+deep.)</span> OOP or short: fold or 4-bet, don’t flat.</li></ul>' +
      'The danger isn’t <i>playing</i> them — it’s <b>overplaying the weak top pair</b> they flop. See the flop cheap in position; then fold A-x-weak-kicker to heavy action instead of paying it off.';
    var players = '<p>Spend the first orbit or two just <b>watching</b>. The single best read is <b>what they SHOW DOWN</b> — note it. Then type each opponent and adjust:</p>' +
      '<table class="ref"><tr><th>type</th><th>tells</th><th class="r">how you beat them</th></tr>' +
      '<tr><td><b>Nit</b><br><span class="dim">tight-passive</span></td><td>folds a ton, rarely 3-bets, only bets/raises with the goods, shows down strong, often older &amp; quiet, “sighs and calls.”</td><td class="r">steal relentlessly; <b>fold when they wake up</b>; never pay the river. Bluff them — they over-fold.</td></tr>' +
      '<tr><td><b>Station</b><br><span class="dim">loose-passive</span></td><td>sees every flop, calls-calls-calls, rarely raises, calls down ace-high / bottom pair, “I had to look you up.”</td><td class="r"><b>value-bet relentlessly &amp; bigger; NEVER bluff.</b> Your most profitable seat. Thin value prints.</td></tr>' +
      '<tr><td><b>TAG</b><br><span class="dim">solid reg</span></td><td>selective but aggressive, position-aware, 3-bets &amp; c-bets, sane sizing, watching the table.</td><td class="r">respect it; avoid marginal spots OOP; don’t bluff-raise; lean on position, give them few free reads.</td></tr>' +
      '<tr><td><b>LAG / maniac</b><br><span class="dim">loose-aggressive</span></td><td>raises constantly, big/erratic sizing, lots of bluffs, hard to put on a hand, in every pot.</td><td class="r">let them hang themselves: <b>trap, call down lighter</b>, don’t get blown off hands. Stop bluffing — they don’t fold.</td></tr></table>' +
      '<div class="dim" style="margin:8px 0 2px">The adjustments, by situation:</div>' +
      '<div class="readadj"><b>NIT</b> — over-folds, only bets value' +
      '<ul><li><b>You bet / bluff:</b> bet MORE, barrel scare cards (A/K turns); steal blinds relentlessly — they hand you pots.</li>' +
      '<li><b>Facing their bet/raise:</b> believe it. Fold one-pair to a raise, fold bluff-catchers to a river bet. Don’t pay them off "to be sure."</li>' +
      '<li><b>Value:</b> skip thin value (they only call with better → you fold out worse); bet your strong hands.</li>' +
      '<li><b>Multiway:</b> a nit who keeps coming multiway is the nuts-ish — fold even more.</li></ul></div>' +
      '<div class="readadj"><b>STATION</b> — calls too much, rarely bluffs/raises' +
      '<ul><li><b>You bet:</b> value-bet relentlessly and BIGGER; thin-value too — they pay with worse. <b>NEVER bluff</b> (they don’t fold).</li>' +
      '<li><b>Facing their bet:</b> they don’t bluff → it’s value. Fold pure bluff-catchers; but they bet thin, so call/raise hands that beat their thin value.</li>' +
      '<li><b>Their raise:</b> a passive player who RAISES has it — fold unless you’re very strong.</li>' +
      '<li><b>River / multiway:</b> thin-value-bet for max, never bluff; multiway still value but tighten a touch (someone connects) and never bluff into multiple callers.</li></ul></div>' +
      '<div class="readadj"><b>TAG</b> — solid, balanced, position-aware' +
      '<ul><li><b>Overall:</b> play the straight baseline — they punish imbalance. Defend your MDF facing bets, fold the rest.</li>' +
      '<li><b>Adjust:</b> avoid marginal spots OOP; don’t bluff-raise them; lean on position, give few free reads.</li></ul></div>' +
      '<div class="readadj"><b>LAG / maniac</b> — bets &amp; bluffs constantly' +
      '<ul><li><b>Facing their aggression:</b> call down LIGHTER (their range is full of air); don’t get blown off hands — let them barrel into your made hands.</li>' +
      '<li><b>You bet:</b> don’t bluff a bluffer (they call/raise light) — check and bluff-catch instead.</li>' +
      '<li><b>Value:</b> value-bet thinner and TRAP — check-call / check-raise your strong hands to let them hang themselves.</li>' +
      '<li><b>Multiway:</b> tighten — a LAG firing into a field more often has it, and you can’t bluff-catch as wide.</li></ul></div>' +
      '<div class="dim" style="margin-top:6px"><b>Any read, multiway:</b> bluffing collapses regardless of type (you need EVERYONE to fold), and you value-bet tighter (someone connects). The read’s main multiway use is <b>who to value-target</b> (the stations) and <b>who to fear when they keep coming</b> (the nits).</div>' +
      '<div class="dim" style="margin-top:6px">Other tells: <b>bet-sizing</b> (small=weak / big=strong is common &amp; exploitable), <b>timing</b> (snap = capped or drawing; long tank = tough decision), <b>preflop VPIP</b> (how many flops they see), and how they handle a short stack. No read → play the solid baseline, lean disciplined.</div>';
    var raising = '<p>Two leaks bracket this: <b>never raise</b> (capped, face-up → bullied) and <b>raise to find out</b> (spew). A real raise range sits between — <b>polarized, with a reason.</b></p>' +
      '<div class="dim">Why you need one (or you get run over):</div> if you only call/fold facing bets, a thinking player <b>(1)</b> barrels you relentlessly — no risk; <b>(2)</b> thin-value-bets fearlessly — no punishment; <b>(3)</b> never pays your monsters — you’re face-up. The <i>threat</i> of a raise makes them check back, size down, slow down.' +
      '<div class="dim" style="margin-top:6px">Polarize — raise your best + your worst-with-blockers, call the middle:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Raise (value):</b> too strong to just call — you beat what <i>continues</i> vs the raise.</li>' +
      '<li><b>Call:</b> bluff-catchers — beat their bluffs, lose to their value, <i>and you can realize it</i>.</li>' +
      '<li><b>Raise (bluff):</b> too weak to call, but fold equity + blockers/a draw + a barrel plan.</li>' +
      '<li><b>Fold:</b> pure trash — no blockers, no equity, no fold equity.</li></ul>' +
      '<div class="dim">“Raise-or-fold” appears when the pure-CALL middle shrinks:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Out of position</b> — flatting OOP is a trap (you face barrels, can’t realize) → strong hands raise, the rest fold.</li>' +
      '<li><b>Vs a small bet</b> — raising is cheap + high fold equity → more hands raise than call.</li>' +
      '<li><b>On boards that fit YOUR range</b> — your raises are credible, so bluff-raises print.</li></ul>' +
      '<div class="dim">The 4-question filter — a raise must pass all four, or it’s spew:</div>' +
      '<ol style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Fold equity</b> — will worse/better actually fold? (Station = no — don’t bluff-raise.)</li>' +
      '<li><b>Equity-when-called OR blockers</b> — a draw (outs), or you block their value combos.</li>' +
      '<li><b>A plan for the next street</b> — if called, what’s your turn/river barrel?</li>' +
      '<li><b>Board/range fit</b> — does this board credibly belong to your range?</li></ol>' +
      '<div class="dim">Depth collapses the tree (tournaments):</div>' +
      '<ul style="margin:2px 0 0 16px;padding:0">' +
      '<li><b>≤30bb:</b> a raise ≈ a jam → raise-or-fold becomes <b>jam-or-fold</b>. Only raise hands you’ll get it in with.</li>' +
      '<li><b>30–50bb:</b> awkward — raise-fold or raise-commit, little room. Pick committal raises or don’t raise.</li>' +
      '<li><b>75bb+:</b> full tree — raises have streets to breathe + real fold equity.</li>' +
      '<li><b>Near a pay jump (ICM):</b> bluff-raises gain fold equity (they fear busting); thin value shrinks (they only stack the nuts).</li></ul>';
    // BB calling vs an open-jam — computed live from the solved push/fold tables, so it never drifts from the drill.
    function bbJamHtml() {
      var NA = (typeof window !== 'undefined' ? window.NASH : g.NASH);
      if (!NA || !NA.callBBSeat) return '<p class="dim">Solved ranges unavailable — reconnect to the Spark and reopen.</p>';
      var seats = ['EP', 'MP', 'CO', 'BTN', 'SB'], depths = NA.depths || [8, 10, 12, 15, 20], R = 'AKQJT98765432';
      function combos(l) { return l.length === 2 ? 6 : (l[2] === 's' ? 4 : 12); }
      function pctOf(t) { var n = 0, d = 0; for (var l in t) { var c = combos(l); d += c; if (t[l] > 0) n += c; } return d ? Math.round(100 * n / d) : 0; }
      function need(S) { return Math.round(100 * (S - 1) / (2 * S + 1.5)); }   // BB-ante pot odds, BB closes the action
      function notate(t) {                                                     // solved EV table -> standard range notation
        var ri = function (c) { return R.indexOf(c); }, ev = function (l) { return t[l] || 0; }, out = [];
        var low = null; for (var i = 0; i < R.length; i++) { var pp = R[i] + R[i]; if (ev(pp) > 0) low = R[i]; else break; }
        if (low) out.push(low === R[R.length - 1] ? '22+' : low + low + '+');
        ['A', 'K', 'Q', 'J', 'T'].forEach(function (hi) {
          ['s', 'o'].forEach(function (su) {
            var lk = null; for (var j = ri(hi) + 1; j < R.length; j++) if (ev(hi + R[j] + su) > 0) lk = R[j];
            if (lk) { var top = R[ri(hi) + 1]; out.push(lk === top ? hi + lk + su : hi + lk + su + '+'); }
          });
        });
        ['98s', '97s', '87s', '86s', '76s', '75s', '65s', '54s'].forEach(function (c) { if (ev(c) > 0) out.push(c); });
        return out.join(' · ');
      }
      var price = '<div class="dim">Price you need (pot odds, big-blind ante, you close the action): ' +
        '<b>5–10bb</b> shove ≈ ' + need(5) + '–' + need(10) + '% · <b>10–15bb</b> ≈ ' + need(10) + '–' + need(15) +
        '% · <b>15–20bb</b> ≈ ' + need(15) + '–' + need(20) + '%. Bigger shove = worse price = call <b>tighter</b>.</div>';
      var mtx = '<table class="ref"><tr><th>jammer</th>' + depths.map(function (d) { return '<th class="r">' + d + 'bb</th>'; }).join('') + '</tr>';
      seats.forEach(function (s) {
        mtx += '<tr><td><b>' + s + '</b></td>' + depths.map(function (d) { return '<td class="r">' + pctOf(NA.callBBSeat[d][s]) + '%</td>'; }).join('') + '</tr>';
      });
      mtx += '</table><div class="dim" style="margin-top:4px">% of all hands you call vs a first-in jam from that seat. Later seat → wider jam → you call wider.</div>';
      function bandBlock(title, dep) {
        var rows = seats.map(function (s) {
          return '<li><b>' + s + '</b> <span class="dim">(' + pctOf(NA.callBBSeat[dep][s]) + '%)</span>: ' + notate(NA.callBBSeat[dep][s]) + '</li>';
        }).join('');
        return '<div class="dim" style="margin-top:6px">' + title + '</div><ul class="reads" style="margin:2px 0 0 0">' + rows + '</ul>';
      }
      var ranges = bandBlock('5–10bb band — ranges at 8bb (tighten ~1 tier toward 10bb):', 8) +
        bandBlock('10–15bb band — ranges at 12bb:', 12) +
        bandBlock('15–20bb band — ranges at 15bb (tighten toward the 20bb column):', 15);
      var princ = '<ul class="reads" style="margin-top:8px">' +
        '<li><b>Two dials.</b> The <b>price</b> (shove size — bigger = tighter) and the <b>jammer’s seat</b> (later = they jam wider, so you call wider). EP ≈ a tier tighter than MP; CO sits between MP and BTN.</li>' +
        '<li><b>SB vs BB is the widest spot in poker</b> — you close with 1bb already in vs a steal-wide range. Call any pair, any ace, most kings, the suited stuff.</li>' +
        '<li><b>Cover or bounty → widen ~5–8%.</b> These are pure chip-EV ranges. When you can’t bust (you cover the jammer) or there’s a bounty, the threshold drops and you call meaningfully wider.</li>' +
        '<li><b>Your Q9s hand:</b> vs an <b>MP 15bb</b> jam the call is ~top ' + pctOf(NA.callBBSeat[15].MP) + '% (' + notate(NA.callBBSeat[15].MP) +
        ') — Q9s sits <i>outside</i> it, a fold on chips. It was a <b>call</b> only because you covered (no bust risk) and he had a bounty: that’s the “widen” rule, not an exception to it.</li>' +
        '<li><b>Jam-or-fold math, so it’s exact</b> — no flatting, and equity is fully realized (you see all five cards). Equity ≥ the price = call.</li>' +
        '</ul>';
      return price + mtx + ranges + princ;
    }
    var bbjam = bbJamHtml();

    // Calling a jam when you DON'T close the action — a live player still behind you.
    // Equities computed off the engine (SB vs a BTN ~8bb jam, top ~43%): heads-up your
    // good ace crushes; when the BB over-calls you're usually dominated. The tax isn't
    // the over-call FREQUENCY (low) — it's that their over-call range is exactly the
    // hands that have your ace drawing thin.
    var behindJam = '<div class="dim">When a player is still <b>live behind you</b>, you’re <b>not closing the action</b> — someone can still over-call. The classic spot: <b>SB facing a BTN jam with the BB yet to act</b>. This is a different (tighter) calculation than the BB-closes spot above.</div>' +
      '<ul class="reads" style="margin-top:8px">' +
      '<li><b>Heads-up, your good ace crushes a late jam.</b> vs a BTN ~8bb jam (top ~43%): <b>ATo ≈ 59%</b>, A9o ≈ 56%, KQo ≈ 55%, 66 ≈ 57%. With the dead money you need ~40% — every one is a slam-dunk call <i>if you were closing</i>.</li>' +
      '<li><b>But when the player behind over-calls, you’re usually crushed.</b> Three-way (BB wakes up): <b>ATo collapses to ≈ 25%</b>, A9o ≈ 22%, KQo ≈ 27% — a ~30-point cliff. Their over-call range is AK/AQ/AJ + big pairs: the exact hands that <b>dominate your ace</b>.</li>' +
      '<li><b>It’s not how OFTEN they call — it’s WHAT they call with.</b> The BB over-calls rarely (~5–10% here), so you’re heads-up most of the time. But that rare range is concentrated in hands you’re drawing thin against. Rare but severe → it taxes exactly your marginal hands.</li>' +
      '<li><b>Adjustment: subtract ~one tier from your closing range.</b> <b>Keep</b> what’s still OK 3-way — big pairs, AK/AQ, AJ/ATs, A9s+. <b>Drop</b> the dominated weak aces (A2o–A9o) and weak broadways (KTo, QJo) you’d call wide with when closing — they only beat the jammer, never the over-caller.</li>' +
      '<li><b>Suited earns the call.</b> A5s (≈24% 3-way) survives domination far better than A5o (≈20%) — a wheel/flush draw plays on when you’re dominated. Prefer suited aces, shed the offsuit ones, with a player behind.</li>' +
      '<li><b>Cover/bounty WIDENS, a player behind TIGHTENS — they partly cancel.</b> Net them: a good suited ace with a bounty and one behind is still a call; a weak offsuit ace isn’t.</li>' +
      '<li><b>More players behind = much tighter.</b> SB vs a BTN jam (only the BB behind) is a modest tax. Facing an EP/MP jam with 3–4 still to act, the over-call risk compounds → tighten toward value-only (pairs + AK/AQ/AJs).</li>' +
      '</ul>';

    function block(title, body, open) {
      return '<details class="ref-d"' + (open ? ' open' : '') + '><summary>' + title + '</summary>' + body + '</details>';
    }
    return block('Raising — a strategy, not a reflex', raising, false) +
      block('Bet sizing — the 3 questions', sizing, false) +
      block('Suited aces — play them by structure', sa, false) +
      block('Reading players — type them, then adjust', players, false) +
      block('Pot odds — what you need to call', pot, true) +
      block('Hand strength — what top-X% actually means', anchorsHtml(), false) +
      block('Draws → equity → max bet you can call', outs, true) +
      block('All-in equities (rules of thumb)', rules, false) +
      block('AK — the playbook', ak, false) +
      block('BB vs an open-jam — call ranges by stack', bbjam, false) +
      block('Calling a jam with a player behind — the over-call tax', behindJam, false) +
      block('Facing 3-bets & 4-bets', vs3, false) +
      block('Check-raising', xr, false) +
      block('Leading / donk-betting OOP', lead, false) +
      block('Exploits — $1–1.5K live field', exploit, false) +
      block('ICM in three lines', icm, false) +
      '<p class="dim" style="margin-top:10px">Ranges are an approximate Nash-style guide (equity model, not a solver). Burn in the patterns — position, depth, jam/3-bet/call/fold; verify exact spots in GTO Wizard.</p>';
  }

  function renderCard() {
    renderSelectors();
    renderGrid();
    renderMeta();
  }

  /* ====================== wiring ====================== */
  function dataReady() { return P && DATA && P.ready && P.ready(); }

  function buildSorted() {
    sorted = DATA.ranking.map(function (r) { return { label: r.h, pct: P.pct(r.h) }; })
      .sort(function (a, b) { return a.pct - b.pct; });
  }

  function initOnce() {
    if (initOnce.done) return;
    initOnce.done = true;
    if (!dataReady()) {
      $('drillSpot').innerHTML = '<span class="bad">Training data didn’t load.</span> Reconnect to the Spark and reopen.';
      $('cardMeta').textContent = 'Training data unavailable until first load over the network.';
      return;
    }
    buildSorted();
    $('drillBtns').onclick = function (e) { var b = e.target.closest('[data-a]'); if (b) answer(b.dataset.a); };
    renderModeSel();
    renderStats();
    newScenario();
    $('cardRef').innerHTML = refHtml();
    renderCard();
  }

  var seg = $('segStudy');
  if (seg) seg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    $('studyDrill').hidden = b.dataset.v !== 'drill';
    $('studyCard').hidden = b.dataset.v !== 'card';
  });

  window.StudyUI = { render: initOnce };
  // test/validation hooks (no DOM needed) — used by tools/validate_postflop.js
  window.StudyUI._test = { scenarioCbet: scenarioCbet, scenarioTurn: scenarioTurn, scenarioRiver: scenarioRiver, gradeCbet: gradeCbet, cbetSpot: cbetSpot, scenarioPF: scenarioPF, leakPF: leakPF,
    setRealPool: function (p) { REAL_POOL = p; REAL_ERR = false; },
    setRealHands: function (p) { REAL_HANDS = p; REAL_HANDS_ERR = false; }, handAt: handAt, handScenario: handScenario };
})();
