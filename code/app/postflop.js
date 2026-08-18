// Postflop logic for the C-bet and Pot-odds drills. Pure, no DOM, testable in Node.
// Pot-odds math is EXACT. Hand/texture classification + c-bet are transparent
// heuristics (clearly labeled), good enough to build live intuition.
(function (g) {
  'use strict';
  var RANKS = '23456789TJQKA';
  function val(ch) { return RANKS.indexOf(ch) + 2; }            // '2'->2 ... 'A'->14
  function parse(c) { return { r: val(c[0]), s: c[1] }; }
  function rname(v) { return ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' })[v] || String(v); }

  // ---- exact pot-odds ----
  function requiredEquity(bet, pot) { return bet / (pot + 2 * bet); }   // call B into pot P

  // draw -> equity to improve (1 card = turn->river, 2 cards = flop->river)
  var DRAWS = {
    gut: { outs: 4, one: 0.087, two: 0.165, name: 'gutshot' },
    overs: { outs: 6, one: 0.13, two: 0.24, name: 'two overcards' },
    oesd: { outs: 8, one: 0.174, two: 0.315, name: 'open-ender' },
    flush: { outs: 9, one: 0.196, two: 0.35, name: 'flush draw' },
    fgut: { outs: 12, one: 0.26, two: 0.45, name: 'flush draw + gutshot' },
    foesd: { outs: 15, one: 0.326, two: 0.54, name: 'flush draw + open-ender' }
  };

  // ---- straight draws from a set of present ranks (with wheel) ----
  function straightInfo(present, holeSet) {
    var rs = new Set(present); if (rs.has(14)) rs.add(1);
    var hs = new Set(holeSet); if (hs.has(14)) hs.add(1);
    function holeIn(vals) { return vals.some(function (v) { return hs.has(v); }); }
    for (var hi = 14; hi >= 5; hi--) {            // made straight
      var ok = true; for (var i = 0; i < 5; i++) if (!rs.has(hi - i)) { ok = false; break; }
      if (ok) return { made: true, oesd: false, gut: false };
    }
    for (var v = 2; v <= 11; v++) {               // open-ender: 4 in a row, both ends live
      var run = [v, v + 1, v + 2, v + 3];
      if (run.every(function (x) { return rs.has(x); }) && holeIn(run) && (v - 1) >= 1 && (v + 4) <= 14)
        return { made: false, oesd: true, gut: false };
    }
    for (var w = 1; w <= 10; w++) {               // gutshot: 4 of a 5-window present
      var win = [w, w + 1, w + 2, w + 3, w + 4];
      var pres = win.filter(function (x) { return rs.has(x); });
      if (pres.length === 4 && holeIn(pres)) return { made: false, oesd: false, gut: true };
    }
    return { made: false, oesd: false, gut: false };
  }

  // Best straight available from hr+br(+extra rank): does one exist, and does
  // its 5-window use a hole card? With one card to come, a "draw" whose best
  // straight is board-only is a sucker end — drawing dead to the board.
  function bestStraightUse(hr, br, extra) {
    var pres = new Set(hr.concat(br)); if (extra != null) pres.add(extra); if (pres.has(14)) pres.add(1);
    var hs = new Set(hr); if (hs.has(14)) hs.add(1);
    for (var hi = 14; hi >= 5; hi--) {
      var full = true;
      for (var k = 0; k < 5; k++) if (!pres.has(hi - k)) { full = false; break; }
      if (full) {
        var uses = false;
        for (var k2 = 0; k2 < 5; k2++) if (hs.has(hi - k2)) { uses = true; break; }
        return { made: true, usesHole: uses };
      }
    }
    return { made: false, usesHole: false };
  }

  // ---- classify hero's flop hand (2 hole + 3 board) ----
  function classifyFlop(holeS, boardS) {
    var hole = holeS.map(parse), board = boardS.map(parse);
    var hr = hole.map(function (c) { return c.r; });
    var br = board.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
    var top = br[0], bot = br[br.length - 1];                 // board may be 3 (flop) or 4 (turn)
    var cnt = {}; hr.concat(br).forEach(function (r) { cnt[r] = (cnt[r] || 0) + 1; });
    var sc = {}; hole.concat(board).forEach(function (c) { sc[c.s] = (sc[c.s] || 0) + 1; });
    var flushSuit = null, maxSuit = 0;
    Object.keys(sc).forEach(function (s) { if (sc[s] > maxSuit) { maxSuit = sc[s]; flushSuit = s; } });
    var holeInFlush = hole.some(function (c) { return c.s === flushSuit; });
    // street-aware draw semantics: with one card to come (4-card board) there is
    // no runner-runner — 3 to a suit is DEAD, never a "backdoor flush"
    var oneCard = boardS.length >= 4;
    var river = boardS.length >= 5;                           // 5-card board = NO cards to come
    // draws are DEAD on the river: 4-to-a-flush you're not in, a one-card straw —
    // none can complete. Only made hands count. (oneCard already kills backdoors.)
    var flush = maxSuit >= 5, flushDraw = !river && maxSuit === 4 && holeInFlush, bdFlush = !oneCard && maxSuit === 3 && holeInFlush;

    var str = straightInfo(new Set(hr.concat(br)), new Set(hr));
    if (river) str = { made: str.made, oesd: false, gut: false };   // no draw on a complete board
    else if (oneCard && !str.made) {
      // one card to come: count completing ranks where the BEST straight uses a
      // hole card (run-based detection overclaims sucker ends on 4-card boards)
      var comp = 0;
      for (var cr = 2; cr <= 14; cr++) {
        var bs = bestStraightUse(hr, br, cr);
        if (bs.made && bs.usesHole) comp++;
      }
      str = { made: false, oesd: comp >= 2, gut: comp === 1 };
    }
    var isPocket = hr[0] === hr[1];
    var boardPaired = false;
    for (var bi = 0; bi < br.length; bi++) for (var bj = bi + 1; bj < br.length; bj++) if (br[bi] === br[bj]) boardPaired = true;
    var pairedBoard = hr.filter(function (r) { return br.indexOf(r) >= 0; });
    var distinctPaired = Array.from(new Set(pairedBoard));
    var holeTrips = hr.some(function (r) { return cnt[r] >= 3; });

    var made = null, strong = false, fine = null;             // fine = precise display name
    if (flush || str.made) { made = str.made ? 'straight' : 'flush'; strong = true; }
    else if (holeTrips || (isPocket && br.indexOf(hr[0]) >= 0)) {
      made = 'set/trips'; strong = true;
      fine = isPocket ? (hr[0] === top ? 'top set' : 'set') : 'trips';
    }
    else if (!isPocket && distinctPaired.length === 2) { made = 'two pair'; strong = true; }
    else if (isPocket) { made = hr[0] > top ? 'overpair' : 'underpair'; strong = hr[0] > top; }
    else if (pairedBoard.length === 1) {
      var pr = pairedBoard[0];
      made = pr === top ? 'top pair' : pr === bot ? 'bottom pair' : 'middle pair';
      strong = pr === top;
      if (pr === top) fine = 'top pair, ' + rname(hr[0] === pr ? hr[1] : hr[0]) + ' kicker';
    }
    var overcards = !made ? hr.filter(function (r) { return r > top; }).length : 0;

    // coarse category that drives the c-bet heuristic
    var cat;
    if (strong) cat = 'value';
    else if (flushDraw || str.oesd) cat = 'draw';            // semi-bluff (may also hold a weak pair)
    else if (made) cat = 'medium';                            // middle/bottom pair, underpair
    else if (overcards >= 2) cat = 'overs';                   // two overcards (e.g. AK on a Q-high board)
    else if (str.gut || overcards >= 1 || bdFlush) cat = 'airdraw';
    else cat = 'air';

    // NUT-FLUSH check: on a made flush, how many higher flushes can a villain
    // hold? = ranks above hero's top flush card that aren't on the board. 0 → the
    // nuts; 1 → second nut. Drives both the label and the value-raise gate (a
    // non-nut flush on a flush board can't raise for value — worse folds, only a
    // higher flush continues). David's TsTc-on-AsKsQs+5s catch, 2026-06-16.
    var nutFlush = true, flushHigher = 0;
    if (flush) {
      var hf = hole.filter(function (c) { return c.s === flushSuit; }).map(function (c) { return c.r; });
      var heroTop = hf.length ? Math.max.apply(null, hf) : 0;
      var bf = board.filter(function (c) { return c.s === flushSuit; }).map(function (c) { return c.r; });
      for (var fr = heroTop + 1; fr <= 14; fr++) if (bf.indexOf(fr) < 0 && hf.indexOf(fr) < 0) flushHigher++;
      nutFlush = flushHigher === 0;
      fine = flushHigher === 0 ? 'nut flush' : flushHigher === 1 ? '2nd-nut flush' : 'flush (not nut)';
    }
    var boardTrips = br[0] === br[1] && br[1] === br[2];
    var parts = [];
    if (made) parts.push(fine || made);
    if (!made && overcards) parts.push(overcards + ' overcard' + (overcards > 1 ? 's' : ''));
    if (!flush) { if (flushDraw) parts.push('flush draw'); else if (bdFlush && !boardTrips) parts.push('backdoor flush'); }   // made flush already in `fine`
    if (!str.made && !flush) { if (str.oesd) parts.push('open-ender'); else if (str.gut) parts.push('gutshot'); }   // a gutshot is irrelevant with a made flush
    if (!parts.length) parts.push('no pair');
    if (boardTrips) parts.unshift('board trips');           // 333: everyone has trips, kickers play
    else if (boardPaired && !made) parts.push('(paired board)');

    return { category: cat, made: made, strong: strong, flush: flush, flushDraw: flushDraw, nutFlush: nutFlush, flushHigher: flushHigher, str: str, overcards: overcards, label: parts.join(' + ') };
  }

  // ---- board texture & who the flop favors ----
  function textureOf(boardS) {
    var b = boardS.map(parse);
    var r = b.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
    var paired = false;                                        // any pair, 3- or 4-card board
    for (var pi = 0; pi < r.length; pi++) for (var pj = pi + 1; pj < r.length; pj++) if (r[pi] === r[pj]) paired = true;
    var sc = {}; b.forEach(function (c) { sc[c.s] = (sc[c.s] || 0) + 1; });
    var ms = Math.max(sc.s || 0, sc.h || 0, sc.d || 0, sc.c || 0);
    var suit = ms >= 3 ? 'mono' : ms === 2 ? 'two-tone' : 'rainbow';   // 4+ to a suit (turn/river) is still monotone — was falling through to 'rainbow'
    var span = r[0] - r[2];
    var connected = span <= 4 && !paired;
    var broadway = r[0] >= 12;                                 // Q/K/A high
    var pfrAdv;
    if (broadway && !paired && suit !== 'mono' && !connected) pfrAdv = 'high';
    // measured (2026-06-12, range-vs-range 60×350 MC): raiser range equity by
    // flop class = broadway-dry 51.3 / paired-low 52.2 / unpaired-low-dry 51.5 /
    // low-wet 51.4% — PAIRED low boards do not favor the caller (no nut
    // advantage either: raiser keeps all overpairs), so they don't take the
    // 'low' demotion; unpaired low keeps it for the caller's NUT advantage
    // (two-pairs/straights), which raw equity doesn't capture.
    else if (r[0] <= 9 && !paired && (connected || suit !== 'rainbow')) pfrAdv = 'low';
    else pfrAdv = 'medium';
    var wet = (connected && suit !== 'rainbow') || suit === 'mono' || (connected && r[0] <= 11);
    return { top: r[0], paired: paired, suit: suit, connected: connected, broadway: broadway, pfrAdv: pfrAdv, wet: wet };
  }

  // ---- c-bet heuristic (as the preflop raiser, flop) ----
  // Range/nut edge on this flop given the preflop story (who raised where, pot type).
  // opts: { potType:'srp'|'3bet', callerBlind:bool, openerEarly:bool }
  function preflopEdge(opts, tex) {
    var s = tex.pfrAdv === 'high' ? 2 : tex.pfrAdv === 'low' ? 0 : 1;
    opts = opts || {};
    if (opts.potType === '3bet' && tex.pfrAdv !== 'low') s += 1;     // condensed strong range
    if (opts.potType !== '3bet') {
      if (opts.callerBlind && tex.top >= 12) s += 1;                 // capped blind vs broadway
      if (opts.callerBlind && tex.pfrAdv === 'low' && tex.connected) s -= 1;
      if (opts.openerEarly && tex.top >= 12) s += 1;                 // tight opener smashes high boards
    }
    return s >= 2 ? 'big' : s >= 1 ? 'some' : 'low';
  }

  // Range edge for the preflop CALLER (capped vs the raiser) — opposite of preflopEdge.
  function defenderEdge(tex) {
    if (tex.top >= 12) return tex.connected ? 'some' : 'low';   // broadway favors the raiser
    if (tex.top <= 9 && tex.connected) return 'big';            // low connected hits the defender
    return 'some';
  }

  // How often each hand class bets (or checks) when it has the option — a simple,
  // documented action model used to CONDITION the villain's range on what they did.
  // Not a solver; a transparent frequency model.
  var BET_FREQ = { value: 0.92, draw: 0.85, medium: 0.45, overs: 0.42, airdraw: 0.40, air: 0.28 };
  var CHECK_FREQ = { value: 0.25, draw: 0.30, medium: 0.65, overs: 0.68, airdraw: 0.70, air: 0.85 };
  // continue-vs-a-bet (call+raise mass) — conditions a range on "they called the flop bet"
  var CONT_FREQ = { value: 0.95, draw: 0.88, medium: 0.70, overs: 0.35, airdraw: 0.38, air: 0.10 };

  var NODE_OPTS = {
    ipCheck: [{ label: 'Check back', act: 'check' }, { label: 'Bet', act: 'bet' }],
    ipBet: [{ label: 'Fold', act: 'fold' }, { label: 'Call', act: 'call' }, { label: 'Raise', act: 'raise' }],
    oopFirst: [{ label: 'Check', act: 'check' }, { label: 'Bet', act: 'bet' }],
    oopBet: [{ label: 'Fold', act: 'fold' }, { label: 'Call', act: 'call' }, { label: 'Check-raise', act: 'raise' }]
  };

  // Equity-driven flop decision. ctx:
  //   eq    — hero equity vs villain's (conditioned) range, 0..1
  //   price — required equity to call (bet/(pot+2bet)), or null when no bet to face
  //   cat   — hero hand class (for raise semantics + explanation)
  //   edge  — whose range the board favors ('big'|'some'|'low', hero-relative)
  //   wet   — board texture
  //   pos   — 'ip' | 'oop'
  // Facing a bet: pure pot-odds vs range, plus value-raise and semi-bluff layers.
  // No bet to face: value-bet / semi-bluff / range-pressure thresholds.
  var CLOSE = 0.04;
  // ---- RIVER: no cards to come, so the logic changes. Betting is POLAR (value
  // or bluff — no semi-bluffs); a medium hand is a bluff-catcher that should
  // CHECK to induce a bluff / get to showdown, because betting it folds out
  // worse and is only called by better; facing a bet is a pure equity-vs-price
  // bluff-catch (raise only with the near-nuts). eq here = showdown win%.
  function riverDecide(ctx, node) {
    var eq = ctx.eq, price = ctx.price, edge = ctx.edge;
    var eqTxt = 'Showdown equity ≈ <b>' + Math.round(eq * 100) + '%</b>';
    var ideal, ok, why;
    if (price != null) {                                   // facing a river bet = bluff-catch
      var priceTxt = ' · price <b>' + Math.round(price * 100) + '%</b>';
      if (eq >= 0.82) { var nuts = eq >= 0.97; ideal = 'raise'; ok = ['raise', 'call']; why = eqTxt + priceTxt + (nuts ? ' — you have <b>the nuts</b>: raise for <b>maximum value</b>. Finished board, nothing to protect — so polarize hard: raise big and charge their whole bluff-and-second-best range. (Flatting to trap is fine, but the value is in the raise.)' : ' — you have the near-nuts: raise for value (no draws left to protect against, so it’s purely value). Calling to trap is fine.'); }
      else if (eq >= price + CLOSE) { ideal = 'call'; ok = ['call']; why = eqTxt + priceTxt + ' — your hand beats enough of their value-and-bluffs to call. No raise: there are no worse hands to make call you, and nothing to protect against on a finished board.'; }
      else if (Math.abs(eq - price) <= CLOSE) { ideal = eq >= price ? 'call' : 'fold'; ok = ['call', 'fold']; why = eqTxt + priceTxt + ' — right at the price. The read decides: call vs a player who over-bluffs rivers, fold vs one who only value-bets.'; }
      else { ideal = 'fold'; ok = ['fold']; if (edge === 'big') ok.push('raise'); why = eqTxt + priceTxt + ' — you don’t beat enough of their betting range to call.' + (edge === 'big' ? ' On a board this favorable a bluff-RAISE (turning your air into a bluff) is a read-based alternative — but the default is fold.' : ' Give it up.'); }
    } else {                                               // checked to / first to act on the river
      // VALUE is judged vs the CALLING range (what calls a bet), not the whole
      // range. High showdown eq built on busted draws is not value — betting folds
      // those out, only better calls. eqCall = eq vs the made-hand calling range.
      var eqC = ctx.eqCall != null ? ctx.eqCall : eq;
      var callTxt = ctx.eqCall != null ? ' · vs the calling range <b>' + Math.round(eqC * 100) + '%</b>' : '';
      if (eqC >= 0.60) { ideal = 'bet'; ok = ['bet', 'check']; why = eqTxt + callTxt + ' — value: worse made hands still call, so bet to get called by worse. Size it so their bluff-catchers can pay.'; }
      else if (eqC >= 0.48) { ideal = (node === 'ipCheck' || node === 'ipBet') ? 'bet' : 'check'; ok = ['bet', 'check']; why = eqTxt + callTxt + ' — thin value: a small bet still picks off a few worse pairs, but it’s close — check back if they only call with better.'; }
      else if (eq >= 0.50) { ideal = 'check'; ok = ['check', 'bet']; why = eqTxt + callTxt + ' — <b>check back / take it to showdown.</b> You’re ahead at showdown (you beat the busted draws), but no WORSE hand calls a bet after they’ve called two streets — betting only folds out what you beat and gets called by what beats you. Bet nothing; win at showdown.'; }
      else if (eq >= 0.30) { ideal = 'check'; ok = ['check', 'bet']; why = eqTxt + ' — <b>bluff-catcher: check to induce.</b> You beat their bluffs but lose to their value — betting folds out worse and is only called (or raised) by better. Check, and call a bet you’re priced into.'; }
      else {   // eq < 0.30: no showdown value — bluff IFF there's real fold equity (capped range), else give up
        var fe = ctx.foldEq != null ? ctx.foldEq : 0, beB = 0.40;   // ~⅔-pot bluff breaks even at ~40% folds
        if (fe >= 0.50) { ideal = 'bet'; ok = ['bet', 'check']; why = eqTxt + ' — <b>bluff</b>: no showdown value, but the villain’s line is <b>capped</b> — about <b>' + Math.round(fe * 100) + '%</b> of their range folds to a bet (a ⅔-pot bluff needs ~' + Math.round(beB * 100) + '%). Fold equity is real → betting is +EV. <b>But never bluff a station</b> — give up vs a player who won’t fold.'; }
        else { ideal = 'check'; ok = ['check', 'bet']; why = eqTxt + ' — no showdown value, and only ~<b>' + Math.round(fe * 100) + '%</b> of their range folds (a bluff needs ~' + Math.round(beB * 100) + '%) — not enough fold equity, so a bluff just donates. <b>Give up and check.</b>'; }
      }
    }
    return { ideal: ideal, ok: ok, why: why, options: NODE_OPTS[node] };
  }
  function flopDecide(node, ctx) {
    if (ctx.street === 'river') return riverDecide(ctx, node);
    var eq = ctx.eq, price = ctx.price, cat = ctx.cat, edge = ctx.edge;
    var eqTxt = 'Equity vs ' + (ctx.multiway >= 2 ? 'the field' : 'their range') + ' ≈ <b>' + Math.round(eq * 100) + '%</b>';
    var ideal, ok, why;
    if (price != null) {                                   // facing a bet
      var priceTxt = ' · price <b>' + Math.round(price * 100) + '%</b>';
      if (eq >= 0.60) {
        var nutMonster = ctx.nutFlush !== false;
        var bigMade = MONSTER_MADE[ctx.made] || ctx.made === 'overpair';
        var stackOff = bigMade && nutMonster;
        ideal = stackOff ? 'raise' : 'call'; ok = stackOff ? ['raise', 'call'] : ['call', 'raise'];
        why = eqTxt + priceTxt + (stackOff
          ? ' — you’re way ahead: raise for value (calling to trap is fine).'
          : (bigMade && !nutMonster)
            ? ' — a flush, but NOT the nuts on a flush board: <b>call, don’t raise</b>. Raising folds out every worse hand (they fear the flush) and only a HIGHER flush continues — you’d fold out what you beat and isolate vs what beats you. Trap and bluff-catch instead.'
            : ' — way ahead of their BETTING range, but one pair raised into action folds the worse hands that were paying and answers only to the re-raise tail: call-dominant, raise sparingly for protection.');
      } else if (eq >= price + CLOSE) {
        ideal = 'call'; ok = ['call'];
        if (cat === 'draw' || (cat === 'value' && ctx.wet)) ok.push('raise');
        why = eqTxt + priceTxt + ' — clear continue.' + (ok.indexOf('raise') > 0 ? ' Raising as a semi-bluff also works with this much equity.' : '');
      } else if (Math.abs(eq - price) <= CLOSE) {
        ideal = eq >= price ? 'call' : 'fold'; ok = ['call', 'fold'];
        why = eqTxt + priceTxt + ' — right at the price: close either way. Implied odds and reads break the tie.';
      } else {
        ideal = 'fold'; ok = ['fold'];
        if (edge === 'big' && (cat === 'air' || cat === 'airdraw')) ok.push('raise');
        why = eqTxt + priceTxt + ' — you’re not getting the price.' +
          (ok.indexOf('raise') > 0 ? ' Their bet is out of line on a board that favors you, so a bluff-raise is a fine alternative to folding.' : ' Give it up.');
      }
    } else {                                               // no bet to face: bet or check
      if (eq >= 0.62) {
        ideal = 'bet'; ok = ctx.wet ? ['bet'] : ['bet', 'check'];
        var strong = cat === 'value';
        if (ctx.tier === 'monster') why = eqTxt + (ctx.wet
          ? ' — smashed it: bet big, every draw out there pays to chase.'
          : ' — smashed it: the question is how three streets of value go in, not whether to bet. Start small to keep worse hands aboard.');
        else if (strong && ctx.wet) why = eqTxt + ' — bet big for value and protection; this texture gives free cards real teeth.';
        else if (strong) why = eqTxt + ' — bet for value; worse pairs and draws pay you off. (Trapping a dry board occasionally is fine.)';
        else why = eqTxt + ' — thin value / protection bet: you’re ahead of their range but vulnerable' +
          (ctx.made ? ' (' + ctx.made + ')' : '') + ' — betting denies overcards their equity. Checking back for pot control is also fine.';
      } else if (cat === 'draw') {
        ideal = 'bet'; ok = ['bet', 'check'];
        why = eqTxt + ' — semi-bluff: fold equity now plus the draw when called.';
      } else if (eq >= 0.45) {
        ideal = (ctx.pos === 'ip' && edge !== 'low') ? 'bet' : 'check';
        ok = ['bet', 'check'];
        why = eqTxt + ' — medium strength: ' + (ideal === 'bet' ? 'a small bet takes the pot or builds it cheaply.' : 'check to control the pot and protect your checking range.');
      } else if (edge === 'big') {
        ideal = 'bet'; ok = ['bet', 'check'];
        why = eqTxt + ' — weak hand but the board smashes your range: ' +
          (ctx.wet ? 'a stab here has to be bigger (wet texture), so it needs the fold to happen now.' : 'small range-pressure bet prints.');
      } else if (edge === 'low') {
        ideal = 'check'; ok = ['check'];
        why = eqTxt + ' — weak hand on their board: betting just burns chips.';
      } else {
        ideal = 'check'; ok = ['check', 'bet'];
        why = eqTxt + ' — not enough equity or fold equity to commit; checking is the default.';
      }
      // MULTIWAY: fold equity is multiplicative — bluffing collapses. C-bet
      // value-heavy; weak/medium hands check (someone holds a piece of the board).
      if (ctx.multiway >= 2) {
        var nway = ctx.multiway + 1;        // total players in the pot
        if (cat === 'value') why = eqTxt + ' — <b>' + nway + '-way</b>: this is value, so bet — multiway you bet your STRONG hands and protect, just skip the thin stuff.';
        else if (cat === 'draw') { ok = ['check', 'bet']; why = eqTxt + ' — <b>' + nway + '-way</b>: a draw still has equity, but semi-bluff far less — you need everyone to fold. Often just check and realize.'; }
        else if (ideal === 'bet') { ideal = 'check'; if (ok.indexOf('check') < 0) ok.unshift('check'); ok = ['check']; why = eqTxt + ' — <b>' + nway + '-way</b>: a bet has no fold equity (someone holds a piece of almost any flop), and you’re not value → <b>check</b>. The heads-up range-bet is a multiway leak.'; }
      }
    }
    return { ideal: ideal, ok: ok, why: why, options: NODE_OPTS[node] };
  }

  // ---- measure a hand+board for the draw generator ----
  function measure(holeS, boardS) {
    var hole = holeS.map(parse), board = boardS.map(parse);
    var hr = hole.map(function (c) { return c.r; }), br = board.map(function (c) { return c.r; });
    var pairBoard = hr.some(function (r) { return br.indexOf(r) >= 0; });
    var pocket = hr[0] === hr[1];
    var boardPair = false;
    for (var i = 0; i < br.length; i++) for (var j = i + 1; j < br.length; j++) if (br[i] === br[j]) boardPair = true;
    var sc = {}; hole.concat(board).forEach(function (c) { sc[c.s] = (sc[c.s] || 0) + 1; });
    var maxSuit = 0, maxS = null;
    Object.keys(sc).forEach(function (s) { if (sc[s] > maxSuit) { maxSuit = sc[s]; maxS = s; } });
    var holeInMax = hole.some(function (c) { return c.s === maxS; });
    var str = straightInfo(new Set(hr.concat(br)), new Set(hr));
    var top = Math.max.apply(null, br);
    var overs = (!pairBoard && !pocket) ? hr.filter(function (r) { return r > top; }).length : 0;
    return { pair: pairBoard || pocket || boardPair, flush: maxSuit >= 5, flushDraw: maxSuit === 4 && holeInMax,
      made: str.made, oesd: str.oesd, gut: str.gut, overs: overs };
  }

  // ---- generate a hand+board that genuinely makes a named draw ----
  // boardCount: 3 (flop, 2 cards to come) or 4 (turn, 1 to come). Validated by measure().
  var SUITS = ['s', 'h', 'd', 'c'];
  function ch(v) { return RANKS[v - 2]; }
  function rnd(n) { return (Math.random() * n) | 0; }
  function pick(arr) { return arr[rnd(arr.length)]; }

  var WANT = {
    flush: function (m) { return m.flushDraw && !m.made && !m.oesd && !m.gut && !m.pair && !m.flush; },
    oesd: function (m) { return m.oesd && !m.flushDraw && !m.made && !m.pair && !m.flush; },
    gut: function (m) { return m.gut && !m.flushDraw && !m.oesd && !m.made && !m.pair && !m.flush; },
    overs: function (m) { return !m.pair && !m.flushDraw && !m.made && !m.oesd && !m.gut && !m.flush && m.overs === 2; },
    fgut: function (m) { return m.flushDraw && m.gut && !m.made && !m.pair && !m.flush; },
    foesd: function (m) { return m.flushDraw && m.oesd && !m.made && !m.pair && !m.flush; }
  };
  var FALLBACK = {
    flush: { hole: ['Ah', 'Th'], board: ['7h', '4h', '2c', 'Kd'] },
    oesd: { hole: ['9d', '8c'], board: ['7h', '6s', '2c', 'Kd'] },
    gut: { hole: ['Kd', '9c'], board: ['Qh', 'Js', '2c', '3d'] },
    overs: { hole: ['Ad', 'Kc'], board: ['8h', '5s', '2c', '3d'] },
    fgut: { hole: ['Kh', '9h'], board: ['Qh', 'Jh', '2c', '3d'] },
    foesd: { hole: ['9h', '8h'], board: ['7h', '6h', '2c', 'Kd'] }
  };

  function buildCandidate(key, boardCount) {
    var used = {}, cards = [];
    function put(c) { if (used[c]) return false; used[c] = 1; cards.push(c); return true; }
    function blank(forbidRanks, fs) {
      for (var tries = 0; tries < 40; tries++) {
        var v = 2 + rnd(13), s = pick(SUITS);
        if (fs && s === fs) continue;
        if (forbidRanks.indexOf(v) >= 0) continue;
        if (put(ch(v) + s)) return;
      }
    }
    var fs = pick(SUITS), n;
    if (key === 'flush') {
      var pool = [14, 12, 10, 8, 6, 4, 2]; // gaps ≥2 → no straightiness
      for (var i = pool.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      put(ch(pool[0]) + fs); put(ch(pool[1]) + fs);          // hole (2 of fs)
      put(ch(pool[2]) + fs); put(ch(pool[3]) + fs);          // board (2 of fs)
      while (cards.length < 2 + boardCount) blank([pool[0], pool[1], pool[2], pool[3]], fs);
    } else if (key === 'oesd') {
      n = 5 + rnd(6);                                        // run n-1..n+2
      put(ch(n + 1) + SUITS[0]); put(ch(n) + SUITS[1]);
      put(ch(n - 1) + SUITS[2]); put(ch(n + 2) + SUITS[1]);
      while (cards.length < 2 + boardCount) blank([n - 2, n - 1, n, n + 1, n + 2, n + 3]);
    } else if (key === 'gut') {
      n = 3 + rnd(7);                                        // present n,n+1,n+3,n+4 (miss n+2)
      put(ch(n + 4) + SUITS[0]); put(ch(n + 1) + SUITS[1]);
      put(ch(n) + SUITS[2]); put(ch(n + 3) + SUITS[1]);
      while (cards.length < 2 + boardCount) blank([n - 1, n, n + 1, n + 2, n + 3, n + 4, n + 5]);
    } else if (key === 'overs') {
      var hi = [14, 13, 12]; put(ch(pick(hi)) + SUITS[0]);
      var h2; do { h2 = pick(hi); } while (used[ch(h2) + SUITS[1]]); put(ch(h2) + SUITS[1]);
      var lows = [8, 7, 6, 5, 4, 3, 2];
      for (var k = lows.length - 1; k > 0; k--) { var j2 = rnd(k + 1); var t2 = lows[k]; lows[k] = lows[j2]; lows[j2] = t2; }
      put(ch(lows[0]) + SUITS[0]); put(ch(lows[1]) + SUITS[2]); put(ch(lows[2]) + SUITS[1]);
      while (cards.length < 2 + boardCount) blank([14, 13, 12, lows[0], lows[1], lows[2]]);
    } else if (key === 'fgut') {
      n = 3 + rnd(6);                                        // present n,n+1,n+3,n+4 (miss n+2), 4 of fs
      put(ch(n + 4) + fs); put(ch(n + 1) + fs);
      put(ch(n) + fs); put(ch(n + 3) + fs);
      while (cards.length < 2 + boardCount) blank([n - 1, n, n + 1, n + 2, n + 3, n + 4, n + 5], fs);
    } else { // foesd
      n = 4 + rnd(6);                                        // present n..n+3, 4 of fs
      put(ch(n + 2) + fs); put(ch(n + 1) + fs);
      put(ch(n) + fs); put(ch(n + 3) + fs);
      while (cards.length < 2 + boardCount) blank([n - 2, n - 1, n, n + 1, n + 2, n + 3, n + 4], fs);
    }
    return { hole: [cards[0], cards[1]], board: cards.slice(2, 2 + boardCount) };
  }

  function genDraw(key, boardCount) {
    for (var t = 0; t < 60; t++) {
      var cand = buildCandidate(key, boardCount);
      if (cand.board.length === boardCount && WANT[key](measure(cand.hole, cand.board))) return cand;
    }
    var fb = FALLBACK[key];
    return { hole: fb.hole.slice(), board: fb.board.slice(0, boardCount) };
  }

  // ---- action MIXES: postflop is fluid, so output a distribution, not a verdict.
  // Frequencies are a calibrated model anchored to solver heuristics:
  //   - range-bet small on big-edge dry boards (high betF even with air)
  //   - polarize on wet/neutral boards (value+draws bet, medium checks)
  //   - facing a bet: defense tracks equity-vs-price margin (logistic), with
  //     raise mass for value (eq>=~0.60) and semi-bluff draws; MDF as context.
  // NOT a solve — but the SHAPE (what mixes, what's pure) matches theory.
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  // RIVER frequencies — polar by design: value bets, bluff-catchers CHECK (the
  // induce zone), air is bet-as-bluff-or-give-up; facing = bluff-catch by price,
  // raise only near-nuts. No semi-bluffs (no equity left to draw to).
  function riverMix(ctx) {
    var eq = ctx.eq, price = ctx.price, entries;
    if (price != null) {                                   // facing a river bet
      var callBase = clamp01(1 / (1 + Math.exp(-(eq - price) * 16)));
      var raiseF = eq >= 0.82 ? clamp01(0.45 + (eq - 0.82) * 1.5) : 0;   // value-raise only with the near-nuts
      var callF = clamp01(callBase * (1 - raiseF));
      entries = [{ act: 'fold', f: clamp01(1 - callF - raiseF) }, { act: 'call', f: callF }, { act: 'raise', f: raiseF }];
    } else {                                               // checked to / first
      var eqC = ctx.eqCall != null ? ctx.eqCall : eq;      // value is judged vs what CALLS, not the whole range
      var betF = eqC >= 0.60 ? 0.78              // value: worse made hands call
        : eqC >= 0.48 ? 0.5                      // thin value
          : eq >= 0.30 ? 0.10                    // ahead at showdown but no worse calls → CHECK back / induce
            : clamp01(0.08 + (ctx.foldEq != null ? Math.max(0, ctx.foldEq - 0.40) * 1.5 : 0));   // air: bluff freq scales with fold equity (capped range)
      entries = [{ act: 'check', f: clamp01(1 - betF) }, { act: 'bet', f: clamp01(betF) }];
    }
    var tot = entries.reduce(function (a, e) { return a + e.f; }, 0) || 1;
    entries.forEach(function (e) { e.f = e.f / tot; if (e.act === 'bet' || e.act === 'raise') e.size = eq >= 0.72 ? 'big' : 'small'; });
    entries.sort(function (a, b) { return b.f - a.f; });
    return entries;
  }
  function flopMix(node, ctx) {
    if (ctx.street === 'river') return riverMix(ctx);
    var eq = ctx.eq, price = ctx.price, cat = ctx.cat, edge = ctx.edge;
    var big = edge === 'big', low = edge === 'low';
    var entries;
    if (price != null) {                                  // facing a bet: fold/call/raise
      var margin = eq - price;
      var callBase = clamp01(1 / (1 + Math.exp(-margin * 16)));        // 0.5 at the price
      // bet-size elasticity: vs small bets the defender raises MORE (their
      // betting range is wide/capped); vs big bets the raising range narrows.
      var frac = ctx.frac != null ? ctx.frac : (price != null ? price / (1 - 2 * price) : 0.5);
      var sizeMul = frac <= 0.34 ? 1.35 : frac <= 0.55 ? 1.0 : frac <= 0.8 ? 0.65 : 0.45;
      var raiseF = 0;
      // Value-raise mass gates on MADE-HAND CLASS, not equity alone (his A9
      // catch, measured 2026-06-12): eq vs their lead range → eq vs the range
      // that CONTINUES after a 3x raise: 77-set 96.4→95.4 (raising loses
      // nothing) · T9-two-pair 82→74 · A9-TPTK 86→79 · KQ-TPGK dry 85→70.
      // One pair also can't stand a re-raise and flatting IP keeps their worse
      // bets paying future streets → monsters raise big, pairs call-dominant.
      var monsterMade = MONSTER_MADE[ctx.made] || ctx.made === 'overpair';
      // a NON-NUT made flush is a monster by class but NOT a value-raise: on a
      // flush board, raising folds out everything worse (sets, lower flushes,
      // bluffs all fear the flush) and only a HIGHER flush continues — so you
      // fold out what you beat and isolate vs what beats you. Call-dominant;
      // raise only the nut flush (David's TsTc-on-4-spade-board catch).
      var nutMonster = ctx.nutFlush !== false;
      if (eq >= 0.60) raiseF = (monsterMade && nutMonster)
        ? clamp01(0.35 + (eq - 0.60) * 1.8)                            // the nuts / non-flush monster: raise for value
        : monsterMade
          ? clamp01(Math.min(0.18, 0.06 + (eq - 0.75) * 0.3))          // non-nut flush: trap/bluff-catch, occasional raise vs a station
          : clamp01(Math.min(0.22, Math.max(0.05, 0.12 + (eq - 0.70) * 0.4)));   // one pair: rare protection raise
      else if (cat === 'draw' && margin > -0.02) raiseF = 0.30 * sizeMul;          // semi-bluff draws
      else if ((cat === 'overs' || cat === 'airdraw') && big && margin > -0.06) raiseF = 0.25 * sizeMul;  // equity semi-bluffs on YOUR board (overs+gutshot etc.)
      else if ((cat === 'air' || cat === 'airdraw') && big && margin < 0) raiseF = 0.18 * sizeMul;        // attack out-of-line bets
      raiseF = clamp01(raiseF);
      if (ctx.street === 'turn' && eq < 0.60) raiseF *= 0.8;   // semi-bluff raises shrink with one card left
      var callF = clamp01(callBase * (1 - raiseF));
      if (cat === 'medium' && margin > 0 && margin < 0.12) callF = Math.max(callF, 0.72 * (1 - raiseF)); // bluff-catchers defend
      var foldF = clamp01(1 - callF - raiseF);
      entries = [{ act: 'fold', f: foldF }, { act: 'call', f: callF }, { act: 'raise', f: raiseF }];
    } else {                                              // option to bet: check/bet
      var betF;
      if (cat === 'value') betF = ctx.wet ? 0.85 : 0.62;               // slowplay some dry boards
      else if (cat === 'draw') betF = ctx.wet ? 0.70 : 0.60;
      else if (cat === 'medium') betF = big && ctx.pos === 'ip' ? 0.45 : 0.20;
      else if (cat === 'overs' || cat === 'airdraw') betF = big ? 0.60 : low ? 0.12 : 0.33;
      else betF = big ? (ctx.pos === 'ip' ? 0.72 : 0.45) : low ? 0.08 : 0.25;   // air: range-bet your boards
      if (ctx.street === 'turn') {                       // one card to come: semi-bluffs thin out, mediums check
        if (cat === 'draw') betF = Math.max(0.15, betF - 0.12);
        else if (cat === 'medium') betF *= 0.65;
        else if (cat === 'overs' || cat === 'airdraw' || cat === 'air') betF *= 0.8;
        // turn-card awareness for the bluff-side categories: barreling after a
        // brake-class card (their flush completes, catch-up over, 8-T mid pairs)
        // burns chips — those card classes are sim-validated (−3.6 to −8pts);
        // a barrel-class scare card keeps the measured fold-shift (+4-5pts)
        if (cat !== 'value' && cat !== 'draw') {
          if (ctx.tcard === 'brake') betF *= 0.45;
          else if (ctx.tcard === 'barrel' && cat !== 'medium') betF = Math.min(betF * 1.25, 0.65);
        }
      }
      // MULTIWAY: fold equity is multiplicative — each extra opponent slashes
      // bluff betF (you need them ALL to fold). Value still bets (often bigger
      // for protection); draws cut hard; air/medium/overs collapse toward a check.
      if (ctx.multiway >= 2) {
        var opp = ctx.multiway;
        if (cat === 'value') betF = ctx.wet ? 0.85 : 0.66;             // value bets, protects on wet
        else if (cat === 'draw') betF *= Math.pow(0.70, opp);          // semi-bluffs reduced
        else betF *= Math.pow(0.42, opp);                             // air/medium/overs: bluffing collapses
      }
      entries = [{ act: 'check', f: clamp01(1 - betF) }, { act: 'bet', f: clamp01(betF) }];
    }
    var tot = entries.reduce(function (a, e) { return a + e.f; }, 0) || 1;
    entries.forEach(function (e) { e.f = e.f / tot; });
    var size = (ctx.wet || ctx.potType === '3bet') ? 'big' : 'small';
    entries.forEach(function (e) { if (e.act === 'bet' || e.act === 'raise') e.size = size; });
    entries.sort(function (a, b) { return b.f - a.f; });
    return entries;
  }

  // ---- hand-strength tier: what the REST of the hand is trying to do ----
  // monster: stack-off value · strong: one-pair value that becomes a bluff-catcher
  // marginal: showdown hand, pot control · draw: semi-bluff with real outs
  // semibluff: overs/gutter equity-bluff · air: range pressure only
  var MONSTER_MADE = { 'set/trips': 1, 'two pair': 1, straight: 1, flush: 1 };
  function handTier(cls, eq) {
    if (MONSTER_MADE[cls.made]) return 'monster';
    if (cls.made === 'overpair' && eq >= 0.84) return 'monster';   // AA-on-rags class
    // NOTE: one-pair hands never reach monster on equity alone — "get the
    // stacks in" with top pair is the exact over-aggression leak this trains out
    if (cls.strong && eq >= 0.55) return 'strong';
    if (cls.category === 'draw') return 'draw';
    if (eq >= 0.62) return 'strong';
    if (cls.made && eq >= 0.38) return 'marginal';
    if (cls.category === 'overs' || cls.category === 'airdraw') return 'semibluff';
    return eq >= 0.45 ? 'marginal' : 'air';
  }

  // Computable next-card classes (no frequencies): which cards help YOUR hand
  // vs which hit THEIR continuing range. Flop boards plan the turn; turn
  // boards plan the river.
  function cardClasses(holeS, boardS) {
    var hole = holeS.map(parse), board = boardS.map(parse);
    var hr = hole.map(function (c) { return c.r; });
    var br = board.map(function (c) { return c.r; });
    var top = Math.max.apply(null, br);
    var out = { next: boardS.length >= 4 ? 'river' : 'turn', fills: null, mySuit: null, theirSuit: null, oversTxt: null, oversHeld: null, mids: null };
    var have = straightInfo(new Set(hr.concat(br)), new Set(hr));
    if (!have.made) {
      var outs = [];
      for (var r = 2; r <= 14; r++) {
        var bs = bestStraightUse(hr, br, r);
        if (bs.made && bs.usesHole) outs.push(rname(r));   // board-only straights are not YOUR fills
      }
      if (outs.length) out.fills = outs.join('/');
    }
    var sc = {}; board.forEach(function (c) { sc[c.s] = (sc[c.s] || 0) + 1; });
    Object.keys(sc).forEach(function (su) {
      var sym = { s: '♠', h: '♥', d: '♦', c: '♣' }[su];
      var mine = hole.filter(function (c) { return c.s === su; }).length;
      var high = hole.some(function (c) { return c.s === su && c.r >= 11; });
      if (boardS.length === 3) {
        if (sc[su] === 2) {
          // Gate derived from simulation (tools/exp_plan_gates.js, 2026-06-12):
          // a 3rd suit card is YOUR barrel card only when it completes your
          // flush (2 in hand, +38pts hand-eq). Holding ONE suit card generates
          // NO fold-shift at any blocker rank (A −0.6, K +0.6, Q −0.7, ≤J −1.6)
          // and only ~+3-5pts of draw pickup — no claim, regardless of rank.
          if (mine === 2) out.mySuit = { sym: sym, high: high, made: true };
          else if (!mine) { out.theirSuit = sym; out.theirN = 2; }
        }
      } else {                                   // turn board: river flush dynamics
        if (sc[su] >= 3) {
          if (mine && sc[su] + mine < 5) out.mySuit = { sym: sym, high: high, made: true };  // river suit completes yours
          else if (!mine) { out.theirSuit = sym; out.theirN = sc[su]; }
        } else if (sc[su] === 2) {
          if (mine === 2) out.mySuit = { sym: sym, high: high, made: true };
          // two on board, none in hand: a river of the suit completes THEIR
          // two-in-hand flush draws (2 board + 2 hand + river = 5)
          else if (!mine) { out.theirSuit = sym; out.theirN = 2; }
        }
      }
    });
    // Overcards-to-the-board: meaning flips with whether we already have a pair.
    // Unpaired: held overs = our outs; unheld overs = raiser-range fold leverage.
    // Gates derived from simulation (tools/exp_plan_gates.js + validator C,
    // 2026-06-12): fold-shift by board top = 8:+4.3 · 9:+3.7 · T:+3.4 ·
    // J:+2.2 · Q:−0.9 · K:−0.7 pts → top <= 11 only. And DRY UNPAIRED boards
    // only — fold equity comes from villain's middling pairs; on wet/monotone/
    // paired textures their continue range is draws/flushes/pockets that
    // don't fold to scare cards (measured −8.3pts on a monotone board).
    // Paired hero: held overcard ABOVE our pair = improvement barrel; unheld
    // overcard above our pair = THEIR catch-up card (brake).
    var pairRanks = hr[0] === hr[1] ? [hr[0]] : hr.filter(function (r) { return br.indexOf(r) >= 0; });
    var pairRank = pairRanks.length ? Math.max.apply(null, pairRanks) : 0;
    // overs logic applies to ONE-pair hands only: with trips/sets/two-pair,
    // overcards neither improve nor threaten enough to claim either direction
    if (pairRank) {
      var prCount = hr.concat(br).filter(function (r) { return r === pairRank; }).length;
      if (prCount >= 3 || new Set(pairRanks).size >= 2) pairRank = -1;   // claim nothing
    }
    if (top < 14 && pairRank >= 0) {
      var ovs = []; for (var v = top + 1; v <= 14; v++) ovs.push(v);
      var held = ovs.filter(function (v) { return hr.indexOf(v) >= 0; });
      if (!pairRank) {
        if (held.length) {
          out.oversTxt = held.slice(-2).reverse().map(rname).join('/');
          out.oversHeld = rname(held[held.length - 1]);
        } else if (top <= 11) {
          var tex = textureOf(boardS);
          if (!tex.wet && !tex.paired) {
            out.oversTxt = ovs.slice(-2).reverse().map(rname).join('/');
            out.oversRange = true;
          }
        }
      } else {
        var improve = held.filter(function (v) { return v > pairRank; });
        if (improve.length) { out.oversTxt = improve.slice(-2).reverse().map(rname).join('/'); out.oversHeld = rname(improve[improve.length - 1]); out.oversImprove = true; }
        var catchup = ovs.filter(function (v) { return hr.indexOf(v) < 0 && v > pairRank; });
        if (catchup.length) out.overBrake = catchup.slice(-2).reverse().map(rname).join('/');
      }
    }
    // Straight-completers for THEIR range (his A5-on-2T96→6 catch: "78 just
    // got there" was tagged brick). A next-card rank qualifies when some
    // 5-window needs exactly {card + two specific hole ranks} — i.e. a real
    // two-card holding (87, Q8, KQ...) makes a NEW straight on that card.
    // Hero's own fill ranks are excluded (those are barrels, checked first).
    (function () {
      var fillSet = {};
      if (out.fills) out.fills.split('/').forEach(function (x) { fillSet[x] = 1; });
      var brSet = new Set(br); if (brSet.has(14)) brSet.add(1);
      var cnts = {};
      for (var lo = 1; lo <= 10; lo++) {
        var needed = [];
        for (var w = lo; w < lo + 5; w++) if (!brSet.has(w)) needed.push(w === 1 ? 14 : w);
        if (needed.length !== 3) continue;            // card + exactly 2 hole ranks
        needed.forEach(function (nr) { if (!fillSet[rname(nr)]) cnts[nr] = (cnts[nr] || 0) + 1; });
      }
      // hand-aware exclusions (validator-driven, same pattern as mids): ranks
      // we HOLD pair us, and ranks that hand US a draw are our cards — both
      // measured hero-POSITIVE (worst violations −14pts before exclusion)
      var ranks = Object.keys(cnts).map(Number).filter(function (nr) { return hr.indexOf(nr) < 0; });
      if (ranks.length && boardS.length === 3) {
        var sc2 = {}; hole.concat(board).forEach(function (c) { sc2[c.s] = (sc2[c.s] || 0) + 1; });
        var neutral = ['s', 'h', 'd', 'c'].sort(function (a, b) { return (sc2[a] || 0) - (sc2[b] || 0); })[0];
        var beforeCat = classifyFlop(holeS, boardS).category;
        ranks = ranks.filter(function (nr) {
          var aft = classifyFlop(holeS, boardS.concat([rname(nr) + neutral]));
          return !(aft.category === 'draw' && beforeCat !== 'draw') && !(aft.strong && !classifyFlop(holeS, boardS).strong);
        });
      }
      if (ranks.length) {
        out.strCompAll = {}; ranks.forEach(function (nr) { out.strCompAll[rname(nr)] = 1; });
        ranks.sort(function (a, b) { return cnts[b] - cnts[a] || b - a; });
        out.strComp = ranks.slice(0, 3).map(rname).join('/');
      }
    })();
    // Board-RELATIVE + rank-windowed, all measured (exp_plan_gates Exp3 +
    // by-rank buckets, 2026-06-12): the turn class that improves the CALLER's
    // range is pairing the middle board rank, and only when that rank is 8–T —
    // villain gain by mid rank: 2-4 −0.4 · 5-7 −0.2 · 8-T +1.2pts (caller
    // ranges are densest in T9/98/87-type holdings). Exclusions: ranks we
    // hold (that pair card is OUR trips) and broadway mids (raiser-range
    // dense). Between-gap/under/top-pairing cards measured ≈ 0 — no claims.
    var srt = br.slice().sort(function (a, b) { return b - a; });
    var midRanks = Array.from(new Set(srt.slice(1, srt.length - 1).filter(function (v) {
      return v !== srt[0] && v !== srt[srt.length - 1] && v >= 8 && v <= 10 && hr.indexOf(v) < 0;
    })));
    if (midRanks.length) out.mids = midRanks.map(rname).join('/');
    return out;
  }

  // ---- next-street planning: name your cards BEFORE the chips go in ----
  // Strength-aware: the same card classes get framed by the tier — a monster
  // wants action on the exact cards a one-pair hand brakes on. ctx: { tier }.
  function turnPlan(holeS, boardS, ctx) {
    ctx = ctx || {};
    var cc = cardClasses(holeS, boardS);
    var N = cc.next, tier = ctx.tier || 'strong';
    var barrel = [], brake = [], third = boardS.length >= 4 ? 'fourth' : 'third';
    if (cc.fills) barrel.push(cc.fills + ' (fills your straight)');
    if (cc.mySuit) barrel.push('any ' + cc.mySuit.sym + ' (your flush comes in)');
    if (cc.theirSuit) brake.push(cc.theirN >= 4 ? 'any ' + cc.theirSuit + ' (four-flush board — you hold none)'
      : (cc.theirN === 3 ? 'fourth ' : 'third ') + cc.theirSuit + ' (completes THEIR draws, you hold none)');
    if (cc.overBrake) brake.push(cc.overBrake + ' (overcard to your pair — their range catches up)');
    if (cc.strComp) brake.push('a ' + cc.strComp + ' (completes straights for their range)');
    if (cc.oversTxt) {
      if (cc.oversImprove) barrel.push(cc.oversTxt + ' (improves you past your pair)');
      else if (cc.oversHeld) barrel.push(cc.oversTxt + ' (over the board — and you hold ' + cc.oversHeld + ')');
      else if (cc.oversRange) barrel.push(cc.oversTxt + ' (over the board — hits your raising range)');
    }
    if (cc.mids) brake.push('a ' + cc.mids + ' (pairs the middle of the board — their calling range holds it)');
    barrel = barrel.slice(0, 3); brake = brake.slice(0, 2);
    var text;
    if (tier === 'monster') {
      text = 'You have this board smashed — the plan is value, not caution: bet every ' + N +
        (cc.theirSuit && !(cc.theirN >= 4) ? '; if the ' + third + ' ' + cc.theirSuit + ' lands, keep betting but downshift one size' : '') +
        '. Cards that improve their calling range are good news — they pay you with worse. If you trap instead: one street only, never two.';
    } else if (tier === 'strong') {
      text = (barrel.length ? 'Barrel ' + barrel.join('; ') : 'Barrel ' + N + 's that change nothing (low bricks)') +
        (brake.length ? ' · brake on ' + brake.join('; ') + ' — there you check-call: the hand becomes a bluff-catcher and the price decides, not the escalation' : '') + '.';
    } else if (tier === 'draw') {
      var hits = barrel.filter(function (b) { return b.indexOf('over the board') < 0; });
      text = 'Semi-bluff plan: when it hits (' + (hits.length ? hits.join('; ') : 'your outs') + ') you switch to value. One barrel on a brick keeps the story; brick twice and shut down — never triple-barrel a busted draw.';
    } else if (tier === 'marginal') {
      text = 'This hand wants a showdown, not a big pot: check most ' + N + 's, call fair prices on bricks' +
        (barrel.length ? ', bet only if you improve (' + barrel[0] + ')' : '') +
        (brake.length ? ' — and let it go vs big bets when ' + brake[0].split(' (')[0] + ' lands' : '') + '.';
    } else if (tier === 'semibluff') {
      text = 'One more barrel max, and only on scare cards: ' + (barrel.length ? barrel.join('; ') : 'an overcard') +
        '. Give up on ' + (cc.mids ? 'a board-pairing ' + cc.mids + ' (their calling range holds it)' : 'anything that helps their calling range') + '.';
    } else {
      text = 'That bet was range pressure — it doesn’t continue. ' +
        (barrel.length ? 'Fire once more only on ' + barrel[0] + '; otherwise' : 'Unless the ' + N + ' is a perfect scare card,') + ' you’re done with this hand.';
    }
    return { tier: tier, next: N, barrel: barrel, brake: brake, text: text };
  }

  // What did the TURN CARD do, per the sim-validated card classes? Drives the
  // bluff-side turn bet frequencies + the feedback's turn-card tag.
  var SUIT_OF_SYM = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
  function classifyTurnCard(holeS, flop3, card) {
    var cc = cardClasses(holeS, flop3);
    var r = card[0], su = card[1];
    var inList = function (txt) { return txt && txt.split('/').indexOf(r) >= 0; };
    if (cc.theirSuit && SUIT_OF_SYM[cc.theirSuit] === su) return 'brake';   // their flush > our minor upgrades
    if (inList(cc.fills) || (cc.mySuit && SUIT_OF_SYM[cc.mySuit.sym] === su)) return 'barrel';   // our made straight/flush first
    // hand-STATE upgrades the flop card-classes can't see (backdoor → real
    // flush draw, runner two-pair) — your real draw arriving outranks their
    // straight-completers: you barrel the NFD whether or not T9 got there
    var before = classifyFlop(holeS, flop3), after = classifyFlop(holeS, flop3.concat([card]));
    if ((after.category === 'draw' && before.category !== 'draw') || (after.strong && !before.strong)
      || (MONSTER_MADE[after.made] && !MONSTER_MADE[before.made])) return 'barrel';
    if (cc.strCompAll && cc.strCompAll[r]) return 'brake';                  // their straights got there (his A5-on-2T96→6 catch)
    if (inList(cc.oversTxt)) return 'barrel';
    if (inList(cc.overBrake) || inList(cc.mids)) return 'brake';
    return 'brick';
  }

  // ---- the decision tree, one node deep: what each branch commits you to ----
  // Every grade shows not just bet/check but what bet-called, bet-raised and
  // the unchosen branch each mean for THIS hand strength.
  function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function planTree(node, ctx, holeS, boardS) {
    var tier = ctx.tier || 'strong';
    var tp = turnPlan(holeS, boardS, ctx);
    var N = tp.next, lines = [];
    // exception card only for the heavyweight brakes (their flush / catch-up
    // overcard) — theoretical straight gappers don't slow a monster down
    var heavyBrake = tp.brake.filter(function (b) { return /completes THEIR draws|four-flush|overcard to your pair/.test(b); })[0];
    if (node === 'ipBet' || node === 'oopBet') {           // facing a bet
      lines.push({ when: 'Call →', what:
        tier === 'monster' ? ('you’re trapping: the plan is raise this street or the ' + N + ' — flat only vs frequent barrelers' +
          (heavyBrake ? '. The one card that changes the plan: ' + heavyBrake.split(' (')[0] + ' — re-read there instead of auto-stacking.' : ', and then never fold later.'))
        : tier === 'strong' ? 'bricks: call again at the right price. ' + (tp.brake.length ? capFirst(tp.brake[0].split(' (')[0]) + ' + a big bet is the judgment spot — one pair is a pure bluff-catcher there.' : 'Scare card + big bet: price and their frequency decide, not fear.')
        : tier === 'draw' ? 'when it hits (' + (tp.barrel.length ? tp.barrel[0].split(' (')[0] : 'your out') + '), switch to value. Brick + another barrel = strict price math, no sticky calls.'
        : tier === 'marginal' ? 'you’re calling to catch bluffs — call bricks at fair prices, fold when the ' + N + ' completes their story AND the sizing turns up.'
        : (ctx.price != null && ctx.eq >= ctx.price + 0.04)
          ? 'you’re calling on live equity (overcard/draw outs), not a made hand: improve → value; miss → fold to the next barrel, no hero calls.'
          : 'calling only makes sense with a live read — air doesn’t bluff-catch.' });
      lines.push({ when: 'Raise →', what:
        tier === 'monster' ? 'if they come back over the top: get it in.'
        : tier === 'draw' ? 'semi-bluff raise re-raised: take the price only if it beats your outs — usually fold.'
        : (tier === 'semibluff' || tier === 'air')
          ? 'with no showdown value, raising IS the bluff — viable only when their bet looks out of line on a board that favors your range (the mix shows how often); the one action that makes no sense is calling.'
        : tier === 'strong'
          ? 'mostly flat: a raise folds the worse hands still paying you and matters only vs the re-raise tail you can’t beat. The rare raise is protection on draw-heavy boards — the mix shows how rare.'
          : 'raising turns a made hand into a bluff — better never folds, worse never calls. With showdown value, call or fold.' });
    } else {                                               // option to bet
      lines.push({ when: 'Bet, called →', what: tp.text });
      lines.push({ when: 'Bet, raised →', what:
        tier === 'monster' ? 'welcome news — get the stacks in; you bet to build exactly this pot.'
        : tier === 'strong' ? 'call once and switch to bluff-catching: each street is price vs their frequency. Fold only when the raise tells a coherent value story on a board that hit them.'
        : tier === 'draw' ? 'call if the price beats your outs — the draw plays on, their raise doesn’t kill it. No sticky calls beyond the math.'
        : tier === 'marginal' ? 'fold — a raise beats one weak pair; don’t pay to confirm it.'
        : 'fold and move on — the bet earns when they fold, and a raise means this one didn’t.' });
      lines.push({ when: 'Check instead →', what:
        tier === 'monster' ? (node === 'oopFirst' ? 'trapping: check-raise their stab — and never trap two streets in a row.' : 'trapping: fine once — then bet any ' + N + ', never trap twice.')
        : tier === 'strong' ? 'fine on dry boards for pot control — then bet most ' + N + 's; you’re still the value hand.'
        : tier === 'draw' ? (node === 'oopFirst' ? 'check-raising semi-bluffs is stronger than leading — your outs back it up.' : 'taking the free card is worth a full street of equity.')
        : tier === 'marginal' ? (node === 'oopFirst' ? 'check-call a fair price: this is a bluff-catcher, not a bet.' : 'check back and realize your equity for free.')
        : (ctx.eq >= 0.52 ? 'with this much raw equity you can check-call one reasonable bet — fold to big sizing.'
          : 'give up vs any real bet — chips saved count the same as chips won.') });
    }
    return lines;
  }

  var Postflop = {
    RANKS: RANKS, val: val, requiredEquity: requiredEquity, DRAWS: DRAWS,
    straightInfo: straightInfo, classifyFlop: classifyFlop, textureOf: textureOf,
    preflopEdge: preflopEdge, defenderEdge: defenderEdge, flopDecide: flopDecide, flopMix: flopMix,
    turnPlan: turnPlan, handTier: handTier, planTree: planTree, cardClasses: cardClasses, classifyTurnCard: classifyTurnCard,
    BET_FREQ: BET_FREQ, CHECK_FREQ: CHECK_FREQ, CONT_FREQ: CONT_FREQ,
    measure: measure, genDraw: genDraw
  };
  g.Postflop = Postflop;
  if (typeof module !== 'undefined' && module.exports) module.exports = Postflop;
})(typeof window !== 'undefined' ? window : globalThis);
