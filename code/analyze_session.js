// Mass-analyze every hand in one session/tournament: grade the preflop decision
// against the SAME range engine the drills use, flag the pots that mattered, the
// all-ins, and the leaks (with direction + the stack depth they happened at).
// Reusable: node tools/analyze_session.js <sessionId>   (default: Sun Run)
'use strict';
const path = require('path');
global.window = global;
require(path.join(__dirname, 'app/charts.js'));
require(path.join(__dirname, 'app/nash.js'));
require(path.join(__dirname, 'app/poker.js'));
require(path.join(__dirname, 'app/postflop.js'));
window.Poker.init(window.POKER_DATA);
const P = window.Poker;
const store = require(path.join(__dirname, '..', 'backups', 'store.json'));

const sid = process.argv.slice(2).find(a => !a.startsWith('--')) || 'acr:t:35259189';   // first non-flag arg
const T = store.tourneys.find(t => t.id === sid);
const hands = store.hands.filter(h => h.sessionId === sid).sort((a, b) => (a.ts || 0) - (b.ts || 0));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const net = h => num(h.amount) * (h.sign === '-' ? -1 : 1);
const DEPTHS = [10, 20, 30, 50, 100];
const bucket = bb => DEPTHS.reduce((a, d) => Math.abs(d - bb) < Math.abs(a - bb) ? d : a, 100);
const SEATS = new Set(['utg', 'mp', 'lj', 'hj', 'co', 'btn', 'sb', 'bb']);

// parse the preflop segment into an ordered action list (hero = bare tokens)
function parsePre(pre) {
  const toks = pre.split(/\s+/).filter(Boolean), seq = [];
  for (let i = 0; i < toks.length; i++) {
    let who = 'hero', t = toks[i];
    if (SEATS.has(t)) { who = t; t = toks[++i]; if (!t) break; }
    const m = t.match(/^(open|limp|3b|4b|5b|jam|ai|c|f|x|r|b)([\d.]*)$/);
    if (m) seq.push({ who, act: m[1] === 'ai' ? 'jam' : m[1], size: m[2] ? parseFloat(m[2]) : null });
  }
  return seq;
}
const RAISE = { open: 1, '3b': 1, '4b': 1, '5b': 1, jam: 1, r: 1 };

// classify hero's PRIMARY preflop decision + grade vs the engine
function gradePre(h) {
  const depth = bucket(num(h.eff)), label = P.handLabel(h.c1, h.c2);
  const seq = parsePre(h.action.split('/')[0]);
  const hi = seq.findIndex(s => s.who === 'hero');
  if (hi < 0) return { scen: 'none', txt: 'no hero action parsed' };
  const before = seq.slice(0, hi);
  const raisesBefore = before.filter(s => RAISE[s.act]);
  const callsBefore = before.filter(s => s.act === 'c' || s.act === 'limp').length;
  const heroFirst = seq[hi];
  const opener = before.find(s => s.act === 'open');
  const dir = (heroAct, ideal) => {                                  // over-aggression vs too-tight
    const A = { fold: 0, x: 0, limp: 1, c: 1, call: 1, open: 2, r: 2, '3b': 3, threebet: 3, '4b': 3, jam: 3 };
    return A[heroAct] > A[ideal] ? 'LOOSE' : A[heroAct] < A[ideal] ? 'tight' : 'ok';
  };

  // A) hero is first-in (no raise before): open / limp
  if (raisesBefore.length === 0) {
    if (h.pos === 'sb') {
      const want = P.sbAction(depth, label);              // raise/limp/fold
      const got = heroFirst.act === 'open' ? 'raise' : heroFirst.act === 'limp' ? 'limp' : heroFirst.act;
      return { scen: 'SB open', depth, ok: got === want, want, got, leak: got !== want && (want === 'fold' || (want === 'limp' && got === 'raise')) ? 'LOOSE' : got !== want ? 'tight' : 'ok' };
    }
    if (heroFirst.act === 'limp') return { scen: 'limp', depth, ok: false, want: 'open/fold', got: 'limp', leak: 'limp' };
    const inRange = P.openIn(h.pos, depth, label);
    return { scen: 'open', depth, ok: inRange, want: inRange ? 'open' : 'fold', got: 'open', leak: inRange ? 'ok' : 'LOOSE' };
  }
  // B/C/D) hero faces action. opener seat:
  const opSeat = opener ? opener.who : 'MP';
  const opPos = opSeat === 'hero' ? null : opSeat.toUpperCase();
  // hero opened, then faces a 3-bet (war) — grade the continue
  if (heroFirst.act === 'open') {
    const after = seq.slice(hi + 1);
    const threeB = after.find(s => s.who !== 'hero' && (s.act === '3b' || s.act === 'jam'));
    if (threeB) {
      const heroNext = after.slice(after.indexOf(threeB) + 1).find(s => s.who === 'hero');
      const v = P.vs3betEval(depth, 'ip', label);          // pos3 approx
      const got = !heroNext ? 'f' : heroNext.act;
      const idealMap = { threebet: '4b', call: 'c', fold: 'f' };
      const ideal = idealMap[v.action];
      return { scen: 'open→vs3bet', depth, ok: got === ideal || (got === 'c' && v.action === 'call'), want: v.action, got, leak: dir(got, ideal === '4b' ? '4b' : ideal === 'c' ? 'c' : 'fold') };
    }
    const inRange = P.openIn(h.pos, depth, label);
    return { scen: 'open (called)', depth, ok: inRange, want: inRange ? 'open' : 'fold', got: 'open', leak: inRange ? 'ok' : 'LOOSE' };
  }
  // hero 3-bet over an open, then faced a 4-bet — grade the CONTINUE (the real
  // decision; calling a 4-bet light is the classic deep-stack spew)
  if ((heroFirst.act === '3b' || heroFirst.act === 'jam') && !( raisesBefore.length >= 2)) {
    const after = seq.slice(hi + 1);
    const fourB = after.find(s => s.who !== 'hero' && (s.act === '4b' || s.act === 'jam'));
    if (fourB) {
      const heroNext = after.slice(after.indexOf(fourB) + 1).find(s => s.who === 'hero');
      const v = P.vs4betEval(depth, 'oop', label);
      const got = !heroNext ? 'f' : heroNext.act;
      const idealMap = { threebet: '5b-jam', call: 'c', fold: 'f' };
      const ideal = idealMap[v.action];
      return { scen: '3bet→vs4bet', depth, ok: got === ideal || (got === 'c' && v.action === 'call'), want: v.action, got, leak: dir(got === 'jam' ? 'jam' : got === 'c' ? 'c' : 'fold', v.action === 'threebet' ? 'jam' : v.action === 'call' ? 'c' : 'fold') };
    }
  }
  // hero faces an open (+maybe callers / +maybe a cold 3bet)
  const coldThreeB = raisesBefore.length >= 2;
  let v, scen;
  if (coldThreeB) { v = P.cold3bEval(depth, label); scen = 'cold 3-bet'; }
  else if (callsBefore > 0 && (h.pos === 'bb' || h.pos === 'sb')) { v = P.squeezeEval(depth, 'late', label, h.pos.toUpperCase(), callsBefore); scen = 'squeeze/defend'; }
  else if (callsBefore > 0) { v = P.squeezeEval(depth, 'late', label, h.pos.toUpperCase(), callsBefore); scen = 'squeeze/overcall'; }
  else if (h.pos === 'bb' || h.pos === 'sb') { v = P.blindVsEval(h.pos.toUpperCase(), depth, opPos || 'CO', label); scen = 'blind defend'; }
  else { v = P.vsEval(depth, opPos || 'CO', label); scen = 'vs open'; }
  const got = heroFirst.act === '3b' ? 'threebet' : heroFirst.act === 'jam' ? 'threebet' : heroFirst.act === 'c' ? 'call' : heroFirst.act === 'f' ? 'fold' : heroFirst.act;
  const ideal = v.action;
  return { scen, depth, ok: got === ideal, want: ideal + (v.note ? '*' : ''), got, leak: dir({ threebet: '3b', call: 'c', fold: 'fold' }[got] || got, { threebet: '3b', call: 'c', fold: 'fold' }[ideal] || ideal), note: v.note };
}

// ---- POSTFLOP grade: heads-up lines only; flag clear −EV calls (the A-high
// spew). Reconstruct villain range from preflop, track pot, compare hero equity
// vs price on each call. Conservative: only flags equity < price − 6pts. ----
const H = require(path.join(__dirname, 'app/handeval.js'));
const PF = window.Postflop;
function villainBand(scen, opPos) {
  if (/cold 3-bet|vs4bet/.test(scen)) return [0, 0.06];
  if (/3bet|squeeze/.test(scen)) return [0, 0.12];
  if (/blind|vs open|open/.test(scen)) return [0, P.openThreshold(opPos || 'CO', 30)];
  return [0.03, 0.45];
}
const PORD = { sb: 0, bb: 1, utg: 2, mp: 3, lj: 4, hj: 5, co: 6, btn: 7 };
const NAMES = ['pre', 'flop', 'turn', 'river'];
// Grade EVERY hero postflop decision (bet/barrel/check-raise/call), HU + multiway.
// Flags the over-aggression leaks (barrel air, raise a bluff-catcher, light call)
// while leaving value bets/raises alone. eq vs the derived villain range/field.
function gradePost(h, g) {
  const segs = h.action.split('/').map(s => s.trim());
  if (segs.length < 2) return { flags: [] };
  const preSeq = parsePre(segs[0]);
  const vills = [...new Set(preSeq.filter(s => s.who !== 'hero' && s.act !== 'f').map(s => s.who))];
  let nLive = Math.max(1, vills.length);
  const band = villainBand(g.scen || '', vills[0] ? vills[0].toUpperCase() : 'CO');
  const pool = P.bandCombos(band[0], band[1]);
  const contFreq = (c1, c2, b) => PF.CONT_FREQ[PF.classifyFlop([c1, c2], b.slice(0, 3)).category];
  const eqAt = board => nLive >= 2
    ? H.equityVsField([h.c1, h.c2], board, Array.from({ length: nLive }, () => pool), { n: 500 })
    : H.equityVsRange([h.c1, h.c2], board, pool, { n: 700, condition: contFreq });
  // hero IP vs the (single) villain for HU streets
  const heroIP = (PORD[h.pos] ?? 9) > (PORD[vills[0]] ?? 0);
  let pot = 4, board = [], flags = [], heroBets = 0, foldsFaced = 0, correctFolds = 0;
  (segs[0].match(/(?:open|3b|4b|r)([\d.]+)/g) || []).forEach(m => { pot += 2 * parseFloat(m.replace(/[a-z]/g, '')); });

  for (let i = 1; i < segs.length; i++) {
    const m = segs[i].match(/^\(([^)]*)\)\s*(.*)$/); if (!m) continue;
    board = board.concat(m[1].match(/.{2}/g) || []);
    const raw = (m[2] || '').split(/\s+/).filter(Boolean);
    const hasSeat = raw.some(t => SEATS.has(t));
    // build ordered (actor, act, size); HU = alternate from OOP, MW = bare is hero
    const acts = [];
    if (hasSeat) {
      for (let j = 0; j < raw.length; j++) {
        let who = 'hero', t = raw[j];
        if (SEATS.has(t)) { who = t; t = raw[++j]; if (!t) break; }
        const bm = t.match(/^(x|c|f|jam|b|r)([\d.]*)$/); if (bm) acts.push({ who, act: bm[1], sz: bm[2] ? +bm[2] : 0 });
      }
    } else {
      let turn = heroIP ? 'v' : 'hero';
      for (const t of raw) { const bm = t.match(/^(x|c|f|jam|b|r)([\d.]*)$/); if (!bm) continue; acts.push({ who: turn, act: bm[1], sz: bm[2] ? +bm[2] : 0 }); turn = turn === 'hero' ? 'v' : 'hero'; }
    }
    let liveBet = 0, eq = null, cls = null;
    const ensure = () => { if (eq === null) { eq = eqAt(board); cls = PF.classifyFlop([h.c1, h.c2], board); } };
    for (const a of acts) {
      const facing = liveBet;
      if (a.who === 'hero' && board.length >= 3) {
        ensure();
        const eqp = Math.round(eq * 100), isDraw = cls.category === 'draw';   // real 8+-out draw
        const st = NAMES[i];
        if (a.act === 'b' && facing === 0) {                  // hero bets / barrels
          heroBets++;
          // A flop c-bet HU is a standard range bet — never flag it. Spew = committing
          // chips with a hand that has no equity AND no real draw where fold equity is
          // poor: (a) into 2+ players (FE collapses multiplicatively), or (b) a 2nd+
          // barrel / later street (chips piled on a busted hand). Equity-driven, not
          // a hand list.
          const lateBet = heroBets >= 2 || i >= 2, mw = nLive >= 2;
          if (!isDraw && eq < 0.33 && (mw || lateBet))
            flags.push({ k: 'bet thin', street: st, board: board.join(''), eq: eqp, note: cls.label + (mw ? ' · ' + nLive + '-way' : heroBets >= 2 ? ' · barrel #' + heroBets : '') });
        } else if ((a.act === 'r' || a.act === 'jam') && facing > 0) {   // raise / check-raise
          // A raise reps strength: +EV as value (high eq) or as a semibluff (a real
          // draw). eq < 0.35 with no draw is neither → a thin bluff-raise.
          if (!isDraw && eq < 0.35)
            flags.push({ k: 'raise thin', street: st, board: board.join(''), eq: eqp, note: cls.label });
        } else if (a.act === 'c' && facing > 0) {             // hero calls a bet
          const price = facing / (pot + facing);              // pot already includes villain's bet → required equity to call
          if (eq < price - 0.06) flags.push({ k: 'light call', street: st, board: board.join(''), eq: eqp, price: Math.round(price * 100) });
        } else if (a.act === 'f' && facing > 0) {             // hero FOLDS facing a bet — was it too tight?
          foldsFaced++;
          const price = facing / (pot + facing);
          if (eq >= price + 0.05) flags.push({ k: 'tight fold', street: st, board: board.join(''), eq: eqp, price: Math.round(price * 100), note: cls.label });
          else correctFolds++;
        }
      }
      // pot / live-bet / players bookkeeping
      if (a.act === 'b' || a.act === 'r') { liveBet = a.sz; pot += a.sz; }
      else if (a.act === 'jam') { liveBet = liveBet || a.sz || pot; pot += liveBet; }
      else if (a.act === 'c') { pot += liveBet; liveBet = 0; }
      else if (a.act === 'x') { liveBet = 0; }
      else if (a.act === 'f' && a.who !== 'hero') { nLive = Math.max(1, nLive - 1); }
    }
  }
  return { flags, foldsFaced, correctFolds };
}

// ---- run ----
console.log('=== ' + (T ? T.event : sid) + ' ===');
if (T) console.log('finish ' + T.place + '/' + T.field + ' · cash $' + T.cash + ' + KO $' + (T.bounty || 0) + ' − buyin $' + T.buyin + '×' + (T.entries || 1) + ' = net $' + (num(T.cash) + num(T.bounty) - num(T.buyin) * Math.max(num(T.entries), 1)).toFixed(2));
console.log(hands.length + ' played hands\n');

const rows = hands.map(h => { const g = gradePre(h); return { h, g, post: gradePost(h, g), net: net(h), ai: /\bjam\b/.test(h.action) }; });

// render a postflop flag as readable text (used by both report + --tag)
function flagText(f) {
  if (f.k === 'light call') return f.street + ' light call: ' + f.eq + '% eq vs ' + f.price + '% price';
  if (f.k === 'tight fold') return f.street + ' tight fold: ' + f.eq + '% eq vs ' + f.price + '% price (had the odds)';
  if (f.k === 'bet thin') return f.street + ' ' + (f.eq < 18 ? 'barrel w/ air' : 'thin barrel') + ' (' + f.eq + '% eq — ' + f.note + ')';
  if (f.k === 'raise thin') return f.street + ' bluff-raise: ' + (f.note || 'weak') + ' (' + f.eq + '% eq)';
  return f.street + ' ' + f.k;
}
console.log('--- POSTFLOP LEAKS (bet/raise/call decisions that look like spew) ---');
const postRows = rows.filter(r => r.post && r.post.flags && r.post.flags.length);
if (!postRows.length) console.log('  (none — every postflop bet, raise, and call had the equity for the price)');
postRows.forEach(r =>
  r.post.flags.filter(f => f.k !== 'tight fold').forEach(f => console.log('  ' + (r.h.c1 + r.h.c2).padEnd(4) + ' ' + r.h.pos.padEnd(3) + ' (' + f.board + ') ' + flagText(f) + '  net ' + r.net.toFixed(1))));

// ---- FOLD REVIEW (were the folds right? over-fold = had the equity for the price but folded) ----
const foldFaced = rows.reduce((a, r) => a + (r.post.foldsFaced || 0), 0);
const foldRight = rows.reduce((a, r) => a + (r.post.correctFolds || 0), 0);
const overFolds = rows.flatMap(r => (r.post.flags || []).filter(f => f.k === 'tight fold').map(f => ({ r, f })));
console.log('\n--- FOLD REVIEW (facing a postflop bet) ---');
console.log('  ' + foldFaced + ' folds vs a bet · ' + foldRight + ' priced-out (correct) · ' + overFolds.length + ' likely OVER-folds (had the equity for the price):');
overFolds.forEach(({ r, f }) => console.log('    ' + (r.h.c1 + r.h.c2).padEnd(4) + ' ' + r.h.pos.padEnd(3) + ' (' + f.board + ') ' + f.street + ' — had ' + f.eq + '% vs ' + f.price + '% price · ' + f.note + '  net ' + r.net.toFixed(1)));

// ---- OVER-SPECULATIVE TURN/RIVER CALLS (continued too light) ----
const looseCalls = rows.flatMap(r => (r.post.flags || []).filter(f => f.k === 'light call' && (f.street === 'turn' || f.street === 'river')).map(f => ({ r, f })));
console.log('\n--- OVER-SPECULATIVE TURN/RIVER CALLS (eq < price) ---');
if (!looseCalls.length) console.log('  (none — turn/river calls were priced)');
looseCalls.forEach(({ r, f }) => console.log('    ' + (r.h.c1 + r.h.c2).padEnd(4) + ' ' + r.h.pos.padEnd(3) + ' (' + f.board + ') ' + f.street + ' — ' + f.eq + '% eq vs ' + f.price + '% price  net ' + r.net.toFixed(1)));


console.log('--- PREFLOP LEAKS (decision deviates from range) ---');
const leaks = rows.filter(r => r.g.leak === 'LOOSE' || r.g.leak === 'limp' || (r.g.ok === false && r.g.leak !== 'tight'));
leaks.forEach(r => console.log('  ' + (r.h.c1 + r.h.c2).padEnd(4) + ' ' + r.h.pos.padEnd(3) + ' ' + (r.g.depth + 'bb').padEnd(5) + ' ' + (r.g.scen).padEnd(14) + ' you ' + r.g.got + ' / range ' + r.g.want + '  [' + r.g.leak + ']  net ' + r.net.toFixed(1)));
const aggro = rows.filter(r => r.g.leak === 'LOOSE').length, tight = rows.filter(r => r.g.leak === 'tight').length;
console.log('  → preflop deviations: ' + aggro + ' too-loose vs ' + tight + ' too-tight');

console.log('\n--- BIGGEST POTS (|net| ≥ 10bb) ---');
rows.filter(r => Math.abs(r.net) >= 10).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).forEach(r =>
  console.log('  ' + (r.net >= 0 ? '+' : '') + r.net.toFixed(1) + 'bb'.padEnd(3) + '  ' + (r.h.c1 + r.h.c2).padEnd(4) + ' ' + r.h.pos.padEnd(3) + ' ' + r.g.depth + 'bb' + (r.ai ? ' AI' : '') + ' | ' + r.h.action.slice(0, 80)));

console.log('\n--- ALL-INS (' + rows.filter(r => r.ai).length + ') ---');
rows.filter(r => r.ai).forEach(r => console.log('  ' + (r.net >= 0 ? '+' : '') + r.net.toFixed(1) + 'bb  ' + (r.h.c1 + r.h.c2).padEnd(4) + ' ' + r.h.pos.padEnd(3) + ' ' + r.g.depth + 'bb | ' + r.h.action.slice(0, 70)));

const total = rows.reduce((a, r) => a + r.net, 0);
console.log('\nsession chip net (played hands): ' + (total >= 0 ? '+' : '') + total.toFixed(1) + 'bb');

// --tag: write a short leak tag onto each flagged hand + POST so the app's
// Review filter can surface them (in-app review view).
if (process.argv.includes('--tag')) {
  const nowMs = Date.now();
  const tagged = [];
  rows.forEach(r => {
    const tags = [];
    if (r.g.leak === 'LOOSE') tags.push('preflop too loose: ' + (r.g.got || '?') + ' / range ' + (r.g.want || '?') + ' @' + r.g.depth + 'bb');
    else if (r.g.leak === 'tight') tags.push('preflop too tight: ' + (r.g.got || '?') + ' / range ' + (r.g.want || '?') + ' @' + r.g.depth + 'bb');
    else if (r.g.scen === 'limp') tags.push('limped — open or fold');
    if (r.post && r.post.flags) r.post.flags.forEach(f => tags.push(flagText(f)));
    const rec = JSON.parse(JSON.stringify(r.h));
    if (tags.length) { rec.review = tags.join(' · '); rec.up = nowMs; tagged.push(rec); }
    else if (r.h.review) { rec.review = ''; rec.up = nowMs; tagged.push(rec); }   // clear stale tags
  });
  require('fs').writeFileSync('/tmp/review-tags.json', JSON.stringify({ hands: tagged }));
  console.log('\n--tag: ' + tagged.length + ' hands tagged → /tmp/review-tags.json (POST to /api/backup to surface in app)');
}
