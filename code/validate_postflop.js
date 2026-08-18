// Simulation validator for the postflop engine: checks what the engine CLAIMS
// against brute-force ground truth, at scale. Three parts:
//
//   A. labels    — classifier invariants over random boards (street-aware draw
//                  semantics, label↔reality coherence, category/tier mapping)
//   B. scenarios — the full drill pipeline (pot/price math exact, mixes sum to 1,
//                  no NaN/undefined in any rendered text, verdicts sane vs equity)
//   C. plans     — the smart one: for every named barrel/brake card class in a
//                  turn plan, simulate ALL candidate turn cards and verify the
//                  claim against equity ground truth:
//                    hand claims  ("your draw arrives")  → hero HAND equity jumps
//                    their claims ("completes THEIR draws") → hero equity drops
//                    range claims ("hits your raising range") → hero RANGE equity holds/rises
//
// Run:  node tools/validate_postflop.js                (medium: ~2-3 min)
//       node tools/validate_postflop.js --deep         (overnight scale)
//       node tools/validate_postflop.js --labels 500000 --scenarios 8000 --plans 300
'use strict';
const path = require('path');

/* ---------- args ---------- */
const argv = process.argv.slice(2);
function argN(name, dflt) { const i = argv.indexOf('--' + name); return i >= 0 ? +argv[i + 1] : dflt; }
const DEEP = argv.includes('--deep');
const N_LABELS = argN('labels', DEEP ? 3000000 : 200000);
const N_SCEN = argN('scenarios', DEEP ? 60000 : 4000);
const N_PLANS = argN('plans', DEEP ? 1200 : 120);
const EQ_N = DEEP ? 400 : 160;      // hand-eq trials per turn card
const RR_N = DEEP ? 500 : 200;      // range-vs-range trials per turn card

/* ---------- load the real app code (DOM shim) ---------- */
const els = {};
function mkEl(id) {
  return { id, _html: '', textContent: '', hidden: false, onclick: null, dataset: {}, style: {},
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; } };
}
global.document = { getElementById(id) { return els[id] || (els[id] = mkEl(id)); } };
global.localStorage = (() => { let s = {}; return { getItem: k => k in s ? s[k] : null, setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })();
localStorage.setItem('pokerlog.train', JSON.stringify({ v: 2, mode: 'cbet' }));
global.window = global; global.confirm = () => true;
const APP = path.join(__dirname, 'app');
require(APP + '/charts.js'); require(APP + '/nash.js'); require(APP + '/poker.js');
require(APP + '/dealer.js'); require(APP + '/postflop.js'); require(APP + '/handeval.js');
window.Poker.init(window.POKER_DATA);
window.toast = () => {}; window.recordDrill = () => {};
require(APP + '/study.js');
window.StudyUI.render();
const PF = window.Postflop, P = window.Poker, H = window.HandEval, T = window.StudyUI._test;

/* ---------- shared helpers ---------- */
const RANKS = '23456789TJQKA', SUITS = 'shdc';
const SYM2SUIT = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const rnd = n => (Math.random() * n) | 0;
function dealDistinct(n, used) {
  const u = {}; (used || []).forEach(c => { u[c] = 1; });
  const out = [];
  while (out.length < n) { const c = RANKS[rnd(13)] + SUITS[rnd(4)]; if (!u[c]) { u[c] = 1; out.push(c); } }
  return out;
}
const rval = ch => RANKS.indexOf(ch) + 2;
let failures = 0, sections = [];
function report(section, checks) {
  sections.push(section);
  console.log('\n== ' + section);
  for (const [okk, msg] of checks) {
    if (!okk) { failures++; console.log('  FAIL:', msg); }
    else console.log('  ok  :', msg);
  }
}

/* ================= A. LABEL / CLASSIFIER INVARIANTS ================= */
function runLabels() {
  const t0 = Date.now();
  const bad = {};                       // invariant -> {n, ex}
  const note = (key, ex) => { (bad[key] = bad[key] || { n: 0, ex: [] }); bad[key].n++; if (bad[key].ex.length < 3) bad[key].ex.push(ex); };
  const TIERS = ['monster', 'strong', 'marginal', 'draw', 'semibluff', 'air'];
  for (let i = 0; i < N_LABELS; i++) {
    const bc = i % 2 ? 3 : 4;
    const cards = dealDistinct(2 + bc);
    const hole = cards.slice(0, 2), board = cards.slice(2);
    const cls = PF.classifyFlop(hole, board);
    const ex = hole.join('') + ' on ' + board.join('') + ' -> ' + cls.label + ' [' + cls.category + ']';
    // independent suit counts
    const sc = {}; cards.forEach(c => { sc[c[1]] = (sc[c[1]] || 0) + 1; });
    const maxSuit = Math.max(...Object.values(sc));
    const fsuit = Object.keys(sc).find(s => sc[s] === maxSuit);
    const holeIn = hole.some(c => c[1] === fsuit);
    // 1. street-aware flush claims (the bug he caught)
    if (bc === 4 && /backdoor/.test(cls.label)) note('backdoor flush claimed on a TURN board', ex);
    if (/backdoor/.test(cls.label) && !(bc === 3 && maxSuit === 3 && holeIn)) note('backdoor label without 3-flush incl. hole on flop', ex);
    if (/flush draw/.test(cls.label) && !(maxSuit === 4 && holeIn)) note('flush-draw label without exactly 4 incl. hole', ex);
    if (cls.made === 'flush' && maxSuit < 5) note('made flush without 5 of a suit', ex);
    // 2. pair-family claims re-derived
    const hr = hole.map(c => rval(c[0])), br = board.map(c => rval(c[0]));
    const cnt = {}; [...hr, ...br].forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
    if (cls.made === 'set/trips' && !hr.some(r => cnt[r] >= 3)) note('set/trips without 3 of a rank using hole', ex);
    if (cls.made === 'two pair' && new Set(hr.filter(r => br.includes(r))).size !== 2) note('two pair without both hole cards pairing', ex);
    if (cls.made === 'overpair' && !(hr[0] === hr[1] && hr[0] > Math.max(...br))) note('overpair claim wrong', ex);
    if (cls.made === 'top pair' && !(hr.includes(Math.max(...br)) && hr[0] !== hr[1])) note('top pair without top-rank hole match', ex);
    // 3. straight-draw claims vs brute force completers
    const completers = new Set();
    for (let r = 2; r <= 14; r++) {
      const present = new Set([...hr, ...br, r]); if (present.has(14)) present.add(1);
      for (let hi = 14; hi >= 5; hi--) {
        let oks = true;
        for (let k = 0; k < 5; k++) if (!present.has(hi - k)) { oks = false; break; }
        if (oks) { // straight exists with r added AND uses a hole card window
          const hs = new Set(hr); if (hs.has(14)) hs.add(1);
          for (let k = 0; k < 5; k++) if (hs.has(hi - k)) { completers.add(r); break; }
          break;
        }
      }
    }
    const already = (() => { const p = new Set([...hr, ...br]); if (p.has(14)) p.add(1);
      for (let hi = 14; hi >= 5; hi--) { let okq = true; for (let k = 0; k < 5; k++) if (!p.has(hi - k)) { okq = false; break; } if (okq) return true; } return false; })();
    if (/open-ender/.test(cls.label) && !already && completers.size < 2) note('open-ender label with <2 completing ranks', ex);
    if (/gutshot/.test(cls.label) && !already && completers.size < 1) note('gutshot label with 0 completing ranks', ex);
    if (cls.made === 'straight' && !already) note('made straight not real', ex);
    // 4. category coherence
    const c = cls.category;
    if (c === 'draw' && !(cls.flushDraw || cls.str.oesd)) note('cat draw without flushdraw/oesd', ex);
    if (c === 'value' && !cls.strong) note('cat value without strong', ex);
    // 5. tier mapping total + monster gate
    for (const eq of [0.2, 0.45, 0.63, 0.85]) {
      const tier = PF.handTier(cls, eq);
      if (!TIERS.includes(tier)) note('tier undefined', ex + ' eq=' + eq);
      if (tier === 'monster' && !(['set/trips', 'two pair', 'straight', 'flush'].includes(cls.made) || (cls.made === 'overpair' && eq >= 0.84)))
        note('monster tier from one-pair/air', ex + ' eq=' + eq);
    }
    // 6. cardClasses / turnPlan invariants
    const cc = PF.cardClasses(hole, board);
    if (cc.next !== (bc === 4 ? 'river' : 'turn')) note('cardClasses.next wrong for board length', ex);
    if (cc.mySuit) {
      const su = SYM2SUIT[cc.mySuit.sym];
      const mine = hole.filter(x => x[1] === su).length, onb = board.filter(x => x[1] === su).length;
      if (!(mine >= 1 && mine + onb + 1 >= 5)) note('mySuit claim does not complete a flush next card', ex + ' suit=' + su);
      if (mine + onb >= 5) note('mySuit "comes in" on an already-made flush', ex);
    }
    if (cc.mids) {
      const srt = [...board.map(x => rval(x[0]))].sort((a, b) => b - a);
      const midsSet = new Set(srt.slice(1, srt.length - 1).filter(v => v !== srt[0] && v !== srt[srt.length - 1]));
      for (const mr of cc.mids.split('/')) if (!midsSet.has(rval(mr))) note('mids claim names a non-middle board rank', ex + ' mids=' + cc.mids);
    }
    if (cc.theirSuit) {
      const su = SYM2SUIT[cc.theirSuit];
      if (hole.some(x => x[1] === su)) note('theirSuit claim while we hold the suit', ex);
      const onb = board.filter(x => x[1] === su).length;
      if (bc === 3 && onb !== 2) note('flop theirSuit without exactly 2 on board', ex);
      if (bc === 4 && onb < 2) note('turn theirSuit without 2+ on board (2 = their two-in-hand river flush)', ex);
    }
    for (const tier of TIERS) {
      const tp = PF.turnPlan(hole, board, { tier });
      if (!tp.text || tp.text.length < 25) note('empty/short plan text', ex + ' tier=' + tier);
      if (bc === 4 && /backdoor/.test(tp.text + tp.barrel.join(' ') + tp.brake.join(' '))) note('plan mentions backdoor on turn board', ex);
      if (tier === 'monster' && /slow down/.test(tp.text)) note('monster plan says slow down', ex);
    }
    if (bc === 4) {
      const tcv = PF.classifyTurnCard(hole, board.slice(0, 3), board[3]);
      if (['barrel', 'brake', 'brick'].indexOf(tcv) < 0) note('classifyTurnCard invalid value', ex);
      const cc3 = PF.cardClasses(hole, board.slice(0, 3));
      if (cc3.theirSuit && SYM2SUIT[cc3.theirSuit] === board[3][1] && tcv !== 'brake') note('their-suit completion not classed brake', ex);
      const b3 = PF.classifyFlop(hole, board.slice(0, 3));
      if (cls.category === 'draw' && b3.category !== 'draw' && !(cc3.theirSuit && SYM2SUIT[cc3.theirSuit] === board[3][1]) && tcv !== 'barrel')
        note('draw-pickup turn card not classed barrel', ex);
    }
  }
  const keys = Object.keys(bad);
  const checks = [[keys.length === 0, N_LABELS.toLocaleString() + ' random boards: all label/category/tier/plan invariants hold']];
  for (const k of keys) checks.push([false, bad[k].n + '× ' + k + '  e.g. ' + bad[k].ex.join(' | ')]);
  report('A. classifier invariants (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)', checks);
}

/* ================= B. DRILL PIPELINE STRUCTURE ================= */
function runScenarios() {
  const t0 = Date.now();
  const bad = {}; const note = (k, ex) => { (bad[k] = bad[k] || { n: 0, ex: [] }); bad[k].n++; if (bad[k].ex.length < 3) bad[k].ex.push(ex); };
  const tally = { street: {}, sub: {}, node: {}, tier: {}, verdicts: { main: 0, mix: 0, out: 0 } };
  let foldMainWhenPricedOut = 0, pricedOut = 0, foldMainWhenGreatPrice = 0, greatPrice = 0;
  let onePairRaiseMain = 0, onePairHi = 0;
  const ONEPAIR = { 'top pair': 1, 'middle pair': 1, 'bottom pair': 1, underpair: 1 };
  for (let i = 0; i < N_SCEN; i++) {
    const s = Math.random() < 0.5 ? T.scenarioCbet() : T.scenarioTurn();
    const ex = (s.street || 'flop') + '/' + (s.sub || s.node) + ' ' + s.hole.join('') + ' on ' + s.board.join('');
    tally.street[s.street || 'flop'] = (tally.street[s.street || 'flop'] || 0) + 1;
    if (s.sub) tally.sub[s.sub] = (tally.sub[s.sub] || 0) + 1;
    tally.node[s.node] = (tally.node[s.node] || 0) + 1;
    tally.tier[s.tier] = (tally.tier[s.tier] || 0) + 1;
    // cards legal
    if (new Set([...s.hole, ...s.board]).size !== s.hole.length + s.board.length) note('card collision', ex);
    if ((s.street === 'turn') !== (s.board.length === 4)) note('board length vs street mismatch', ex);
    // pot/price math exact
    if (s.price != null) {
      const want = s.bet / (s.pot + 2 * s.bet);
      if (Math.abs(s.price - want) > 1e-9) note('price formula drift', ex);
      if (!(s.bet > 0 && s.pot > 0)) note('nonpositive pot/bet', ex);
    }
    // mix well-formed
    const sum = s.mix.reduce((a, e) => a + e.f, 0);
    if (Math.abs(sum - 1) > 1e-6 || s.mix.some(e => isNaN(e.f) || e.f < 0)) note('mix malformed', ex);
    if (!s.mix.some(e => e.act === s.fn.ideal) && s.fn.ideal !== s.mix[0].act) note('ideal not an available act', ex);
    // story + feedback text clean for every option
    const spotTxt = T.cbetSpot(s);
    if (/undefined|NaN|\[object/.test(spotTxt)) note('story text dirty', ex + ' :: ' + spotTxt);
    for (const o of s.fn.options) {
      const g = T.gradeCbet(s, o.act);
      if (/undefined|NaN|\[object/.test(g.why + g.idealWord)) note('feedback text dirty', ex + ' act=' + o.act);
      if (!/fbtree/.test(g.why)) note('decision tree missing', ex);
      if (s.board.length === 4 && /backdoor/.test(g.why)) note('feedback claims backdoor on turn', ex + ' :: ' + g.why.replace(/<[^>]+>/g, '').slice(0, 140));
    }
    // verdict-vs-equity sanity (facing a bet)
    if (s.price != null) {
      const main = s.mix[0].act;
      if (s.eq < s.price - 0.10) { pricedOut++; if (main === 'fold') foldMainWhenPricedOut++; }
      if (s.eq > s.price + 0.15) { greatPrice++; if (main === 'fold') foldMainWhenGreatPrice++; }
      if (ONEPAIR[s.cls.made] && s.eq >= 0.70) { onePairHi++; if (main === 'raise') onePairRaiseMain++; }
    }
    // turn-story constraints
    if (s.street === 'turn') {
      if ((s.sub === 'lead' || s.sub === 'delayed') && s.pos !== 'ip') note('lead/delayed story but hero OOP', ex);
      if (s.sub === 'barreled' && s.role !== 'defender') note('barreled story but hero aggressor', ex);
    }
  }
  const keys = Object.keys(bad);
  const checks = [
    [keys.length === 0, N_SCEN.toLocaleString() + ' generated spots: structure, math, stories, feedback all clean'],
    [pricedOut === 0 || foldMainWhenPricedOut / pricedOut >= 0.9, 'priced-out spots (eq < price−10) fold as main line: ' + foldMainWhenPricedOut + '/' + pricedOut],
    [foldMainWhenGreatPrice === 0, 'great-price spots (eq > price+15) never fold as main line: ' + foldMainWhenGreatPrice + '/' + greatPrice],
    [onePairRaiseMain === 0, 'one-pair hands never raise as the main line facing a bet (' + onePairRaiseMain + '/' + onePairHi + ' high-eq one-pair spots)']
  ];
  for (const k of keys) checks.push([false, bad[k].n + '× ' + k + '  e.g. ' + bad[k].ex.join(' | ')]);
  report('B. drill pipeline (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)', checks);
  console.log('  dist: street', JSON.stringify(tally.street), 'sub', JSON.stringify(tally.sub));
  console.log('  dist: node', JSON.stringify(tally.node), 'tier', JSON.stringify(tally.tier));
}

/* ================= C. PLAN CLAIMS vs EQUITY GROUND TRUTH ================= */
// For each spot: compute hero equity (and hero-RANGE equity) on every possible
// turn card, then test the turnPlan's named card classes against those numbers.
function condChain(flopFn) { return (c1, c2, b) => flopFn(PF.classifyFlop([c1, c2], b.slice(0, 3)).category); }

function rangeVsRange(heroPool, heroCond, villPool, villCond, boardStrs, n) {
  const boardIds = boardStrs.map(H.cardId);
  const blockedB = {}; boardIds.forEach(id => { blockedB[id] = 1; });
  let wins = 0, done = 0, guard = 0;
  while (done < n && guard < n * 80) {
    guard++;
    const hc = heroPool[rnd(heroPool.length)];
    const h1 = H.cardId(hc[0]), h2 = H.cardId(hc[1]);
    if (blockedB[h1] || blockedB[h2]) continue;
    if (Math.random() > heroCond(hc[0], hc[1], boardStrs)) continue;
    const vc = villPool[rnd(villPool.length)];
    const v1 = H.cardId(vc[0]), v2 = H.cardId(vc[1]);
    if (blockedB[v1] || blockedB[v2] || v1 === h1 || v1 === h2 || v2 === h1 || v2 === h2) continue;
    if (Math.random() > villCond(vc[0], vc[1], boardStrs)) continue;
    let river; const used = { [h1]: 1, [h2]: 1, [v1]: 1, [v2]: 1 };
    do { river = rnd(52); } while (blockedB[river] || used[river]);
    const full = boardIds.concat([river]);
    const r = H.cmp(H.eval7([h1, h2, ...full]), H.eval7([v1, v2, ...full]));
    if (r > 0) wins++; else if (r === 0) wins += 0.5;
    done++;
  }
  return done ? wins / done : 0.5;
}

// Fold-equity ground truth for RANGE claims: on a given turn card, what share
// of villain's (conditioned) range has <30% equity vs hero's barreling range —
// i.e. has to fold to a real barrel. A "scare card for them" must raise this.
function villainFoldRate(villPool, villCond, heroPool, heroCond, board4) {
  const b = board4.map(H.cardId);
  let folds = 0, m = 0, guard = 0;
  while (m < 36 && guard < 4000) {
    guard++;
    const vc = villPool[rnd(villPool.length)];
    const v1 = H.cardId(vc[0]), v2 = H.cardId(vc[1]);
    if (b.includes(v1) || b.includes(v2) || v1 === v2) continue;
    if (Math.random() > villCond(vc[0], vc[1], board4)) continue;
    let w = 0, d = 0, g2 = 0;
    while (d < 60 && g2 < 3000) {
      g2++;
      const hc = heroPool[rnd(heroPool.length)];
      const h1 = H.cardId(hc[0]), h2 = H.cardId(hc[1]);
      if (b.includes(h1) || b.includes(h2) || h1 === v1 || h1 === v2 || h2 === v1 || h2 === v2) continue;
      if (Math.random() > heroCond(hc[0], hc[1], board4)) continue;
      let river; const used = { [v1]: 1, [v2]: 1, [h1]: 1, [h2]: 1 };
      do { river = rnd(52); } while (b.includes(river) || used[river]);
      const full = b.concat([river]);
      const r = H.cmp(H.eval7([v1, v2, ...full]), H.eval7([h1, h2, ...full]));
      if (r > 0) w++; else if (r === 0) w += 0.5;
      d++;
    }
    if (d) { if (w / d < 0.30) folds++; m++; }
  }
  return m ? folds / m : 0;
}

function runPlans() {
  const t0 = Date.now();
  // claim ledger: type -> {n, viol, deltas[], worst[]}
  const ledger = {};
  const claim = (type, delta, threshold, ex) => {
    const L = (ledger[type] = ledger[type] || { n: 0, viol: 0, sum: 0, worst: [] });
    L.n++; L.sum += delta;
    if (delta < threshold) { L.viol++; L.worst.push({ delta, ex }); L.worst.sort((a, b) => a.delta - b.delta); if (L.worst.length > 3) L.worst.length = 3; }
  };
  const BANDS = { blindDefend: [0.03, 0.45], coldCall: [0.03, 0.12] };
  for (let sp = 0; sp < N_PLANS; sp++) {
    // aggressor spot: hero opened (MP/CO/BTN), villain defends blind / cold-calls
    const heroSeat = ['MP', 'CO', 'BTN'][rnd(3)];
    const blind = Math.random() < 0.7;
    const villBand = blind ? BANDS.blindDefend : BANDS.coldCall;
    const heroBand = [0, P.openThreshold(heroSeat, 30)];
    const hole = dealDistinct(2);
    const flop = dealDistinct(3, hole);
    const villPool = P.bandCombos(villBand[0], villBand[1]);
    const heroPool = P.bandCombos(heroBand[0], heroBand[1]);
    // context: hero bet flop, villain (checked+)called → next decision is the turn
    const villCond = condChain(cat => (blind ? PF.CHECK_FREQ[cat] : 1) * PF.CONT_FREQ[cat]);
    const heroCond = condChain(cat => PF.BET_FREQ[cat]);
    const cls = PF.classifyFlop(hole, flop);
    const flopEq = H.equityVsRange(hole, flop, villPool, { n: 400, condition: villCond });
    const tier = PF.handTier(cls, flopEq);
    const tp = PF.turnPlan(hole, flop, { tier });
    const cc = PF.cardClasses(hole, flop);
    // equity of hero HAND and hero RANGE on every candidate turn card
    const usedSet = new Set([...hole, ...flop]);
    const cands = [];
    for (const r of RANKS) for (const su of SUITS) { const c = r + su; if (!usedSet.has(c)) cands.push(c); }
    const handEq = {}, rangeEq = {};
    let handSum = 0, rangeSum = 0;
    for (const c of cands) {
      handEq[c] = H.equityVsRange(hole, [...flop, c], villPool, { n: EQ_N, condition: villCond });
      handSum += handEq[c];
      rangeEq[c] = rangeVsRange(heroPool, heroCond, villPool, villCond, [...flop, c], RR_N);
      rangeSum += rangeEq[c];
    }
    const handBase = handSum / cands.length, rangeBase = rangeSum / cands.length;
    const mean = (cardsArr, eq) => cardsArr.reduce((a, c) => a + eq[c], 0) / cardsArr.length;
    const exTag = hole.join('') + ' on ' + flop.join('') + ' (' + tier + ')';
    // fold-rate machinery, computed lazily only for spots with RANGE claims
    let foldBase = null;
    const foldRateOf = c => villainFoldRate(villPool, villCond, heroPool, heroCond, [...flop, c]);
    const foldShift = cardsArr => {
      if (foldBase === null) {
        const sample = []; for (let k = 0; k < 10; k++) sample.push(cands[rnd(cands.length)]);
        foldBase = sample.reduce((a, c) => a + foldRateOf(c), 0) / sample.length;
      }
      return cardsArr.reduce((a, c) => a + foldRateOf(c), 0) / cardsArr.length - foldBase;
    };
    // map cc classes to concrete candidate cards
    if (cc.fills) {
      const ranks = cc.fills.split('/');
      const cardsF = cands.filter(c => ranks.includes(c[0]));
      if (cardsF.length) claim('HAND: straight fills barrel', mean(cardsF, handEq) - handBase, 0.04, exTag + ' fills=' + cc.fills);
    }
    if (cc.mySuit) {
      const su = SYM2SUIT[cc.mySuit.sym];
      const cardsS = cands.filter(c => c[1] === su);
      claim('HAND: my flush comes in', mean(cardsS, handEq) - handBase, 0.03, exTag + ' suit=' + su);
    }
    if (cc.theirSuit) {
      const su = SYM2SUIT[cc.theirSuit];
      const cardsS = cands.filter(c => c[1] === su);
      claim('THEIR: third-suit brake', handBase - mean(cardsS, handEq), -0.02, exTag + ' suit=' + su);
    }
    if (cc.oversTxt) {
      const ranks = cc.oversTxt.split('/');
      const cardsO = cands.filter(c => ranks.includes(c[0]));
      if (cardsO.length) {
        if (cc.oversImprove) claim('HAND: overcard improves past pair', mean(cardsO, handEq) - handBase, 0.02, exTag + ' overs=' + cc.oversTxt);
        else if (cc.oversHeld) claim('HAND: held overcard barrel', mean(cardsO, handEq) - handBase, 0.02, exTag + ' overs=' + cc.oversTxt);
        // fold-shift noise is ±2-2.5pts/spot (36 villains × 60 trials) — the
        // violation gate matches the metric's noise floor; deep-run evidence
        // (217 claims): mean +5.0pts
        else if (cc.oversRange) claim('RANGE: unheld overcard barrel (fold-shift)', foldShift(cardsO), -0.025, exTag + ' overs=' + cc.oversTxt);
      }
    }
    if (cc.overBrake) {
      const ranks = cc.overBrake.split('/');
      const cardsB = cands.filter(c => ranks.includes(c[0]));
      if (cardsB.length) claim('THEIR: overcard-to-your-pair brake', handBase - mean(cardsB, handEq), -0.02, exTag + ' brake=' + cc.overBrake);
    }
    if (cc.mids) {
      // board-relative claim: turns PAIRING the middle board rank(s)
      const ranks = new Set(cc.mids.split('/'));
      const pairsMid = cands.filter(c => ranks.has(c[0]));
      if (pairsMid.length) claim('THEIR: middle-board-pair brake', rangeBase - mean(pairsMid, rangeEq), -0.012, exTag + ' mids=' + cc.mids);
    }
    if (cc.strComp) {
      const ranks = new Set(cc.strComp.split('/'));
      const compCards = cands.filter(c => ranks.has(c[0]));
      if (compCards.length) claim('THEIR: straight-completer brake', handBase - mean(compCards, handEq), -0.02, exTag + ' strComp=' + cc.strComp);
    }
    if ((sp + 1) % 40 === 0) process.stdout.write('  ...' + (sp + 1) + '/' + N_PLANS + ' spots\n');
  }
  const checks = [];
  for (const [type, L] of Object.entries(ledger)) {
    const violPct = L.viol / L.n;
    const meanD = L.sum / L.n;
    const okT = violPct <= 0.25;
    checks.push([okT, type + ': ' + L.n + ' claims, mean Δ ' + (meanD >= 0 ? '+' : '') + (meanD * 100).toFixed(1) + 'pts, violations ' + (violPct * 100).toFixed(0) + '%' +
      (L.worst.length ? '  worst: ' + L.worst.map(w => w.ex + ' Δ' + (w.delta * 100).toFixed(1)).join(' | ') : '')]);
  }
  report('C. plan claims vs simulated ground truth (' + ((Date.now() - t0) / 1000).toFixed(1) + 's, ' + N_PLANS + ' spots × 45 turn cards)', checks);
}

/* ================= run ================= */
console.log('validate_postflop: labels=' + N_LABELS.toLocaleString() + ' scenarios=' + N_SCEN.toLocaleString() + ' plans=' + N_PLANS + (DEEP ? ' [DEEP]' : ''));
runLabels();
runScenarios();
runPlans();
console.log(failures ? '\n' + failures + ' INVARIANT GROUPS FAILED' : '\nALL CLEAN');
process.exit(failures ? 1 : 0);
