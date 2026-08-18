// Build the "Full Hands" pool — real hands played decision-by-decision. Each hand groups
// ALL of one player's postflop decisions (in order) with the engine take + the ACTUAL action,
// so the app can walk it through every street: you call each spot, get graded vs the engine,
// see what they really did, and the hand keeps following reality. Heads-up-from-the-flop only.
// Prioritizes multi-decision, 3-bet, big-pot hands. → tools/app/realhands.json
//   node tools/phh_build_hands.js [dir] [target]
'use strict';
const fs = require('fs');
const path = require('path');
const { parsePHH, reconstruct } = require(path.join(__dirname, 'phh_real_spots.js'));
const { engineTake } = require(path.join(__dirname, 'phh_engine_take.js'));
const POS6 = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];

function lineText(line, bb) {
  const conv = tok => {
    const sp = tok.split(' '), pos = sp[0], a = sp[1] || '';
    if (!a) return pos;
    if (a[0] === 'b') return pos + ' bets ' + (+a.slice(1) / bb).toFixed(1);
    return pos + ' ' + ({ c: 'calls', x: 'checks', f: 'folds' }[a] || a);
  };
  const out = {};
  for (const st of ['preflop', 'flop', 'turn', 'river']) out[st] = (line[st] || []).map(conv).join(' · ');
  return out;
}

// full action on a street, first bet vs later raises distinguished (for the end-of-hand recap)
function streetFullText(tokens, bb) {
  let bet = false;
  return (tokens || []).map(tok => {
    const sp = tok.split(' '), pos = sp[0], a = sp[1] || '';
    if (!a) return pos;
    if (a[0] === 'b') { const v = (+a.slice(1) / bb).toFixed(1); const s = pos + (bet ? ' raises to ' : ' bets ') + v; bet = true; return s; }
    return pos + ' ' + ({ c: 'calls', x: 'checks', f: 'folds' }[a] || a);
  }).join(' · ');
}
// the COMPLETE postflop run-out (flop→river), board-labeled, so the play-through has a satisfying end
function tailText(fullLine, board, bb) {
  const streets = ['flop', 'turn', 'river'], slice = { flop: [0, 3], turn: [3, 4], river: [4, 5] }, parts = [];
  for (const st of streets) {
    const toks = fullLine[st] || []; if (!toks.length) continue;
    parts.push(st[0].toUpperCase() + st.slice(1) + ' (' + board.slice(slice[st][0], slice[st][1]).join('') + '): ' + streetFullText(toks, bb));
  }
  return parts.join('  ·  ');
}

function buildHand(h, id) {
  const r = reconstruct(h), bb = h.blinds[1] || 100;
  const post = r.spots.filter(s => ['flop', 'turn', 'river'].includes(s.street));
  if (!post.length) return null;
  if (post.some(s => !s.liveOpps || s.liveOpps.length !== 1)) return null;   // HU at every decision (clean play-through)
  const bySeat = {};
  post.forEach(s => (bySeat[s.hero] = bySeat[s.hero] || []).push(s));
  let heroSeat = null, best = 0;                                              // hero = the seat with the most decisions
  for (const seat in bySeat) if (bySeat[seat].length > best && r.hole[seat] && r.hole[seat].indexOf('?') < 0) { best = bySeat[seat].length; heroSeat = +seat; }
  if (heroSeat == null) return null;
  const ds = bySeat[heroSeat];
  const villPos = ds[0].liveOpps[0], villSeat = POS6.indexOf(villPos), villCards = r.hole[villSeat];
  if (!villCards || villCards.indexOf('?') >= 0) return null;
  const decisions = [];
  for (const s of ds) {
    const t = engineTake(s, 100);
    if (t.skip || t.ideal == null) return null;                              // any unevaluable decision → drop the hand (no gaps)
    const facing = s.toCall > 0;
    decisions.push({
      street: s.street, board: s.board, pot: +(s.pot / bb).toFixed(1), toCall: +(s.toCall / bb).toFixed(1),
      frac: facing ? +(s.curBet / Math.max(1, s.pot - s.curBet)).toFixed(2) : null,
      decision: facing ? 'fcr' : 'cb', line: lineText(s.line, bb), label: t.label, heroIP: t.heroIP,
      engine: { ideal: t.ideal, eq: Math.round(t.eq * 100), eqCall: t.eqCall != null ? Math.round(t.eqCall * 100) : null, why: t.why, range: t.rangeNote },
      actual: s.action
    });
  }
  if (!decisions.length) return null;
  return {
    id, heroPos: POS6[heroSeat], villPos, heroCards: r.hole[heroSeat], villCards, bb,
    net: +(((r.finish[heroSeat] - r.stacks[heroSeat]) / bb).toFixed(1)),
    tail: tailText(r.fullLine, r.board, bb), decisions
  };
}

if (require.main === module) {
  const dir = process.argv[2] || '/home/user/poker-data/phh/data/pluribus';
  const target = +(process.argv[3] || 1500);
  const files = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (e.name.endsWith('.phh')) files.push(p); } })(dir);
  // gather candidate hands (cheap structural pass — no engine yet), then weighted-sample, then bake
  console.log('gathering candidate hands…');
  const is3bet = pre => (pre || []).filter(t => (t.split(' ')[1] || '')[0] === 'b').length >= 2;
  const cands = [];
  for (const f of files) {
    const h = parsePHH(fs.readFileSync(f, 'utf8')); if (h.variant !== 'NT') continue;
    const r = reconstruct(h);
    const post = r.spots.filter(s => ['flop', 'turn', 'river'].includes(s.street));
    if (!post.length || post.some(s => !s.liveOpps || s.liveOpps.length !== 1)) continue;
    // pick the same hero buildHand will (most postflop decisions, cards known), so weights match the real hand
    const bySeat = {}; post.forEach(s => (bySeat[s.hero] = bySeat[s.hero] || []).push(s));
    let heroSeat = null, best = 0;
    for (const seat in bySeat) if (bySeat[seat].length > best && r.hole[seat] && r.hole[seat].indexOf('?') < 0) { best = bySeat[seat].length; heroSeat = +seat; }
    if (heroSeat == null) continue;
    const ds = bySeat[heroSeat];
    const facing = ds.filter(s => s.toCall > 0).length;                      // hero decisions that face a bet
    const aggr = ds.filter(s => /b/.test((s.action || '')[0] || '')).length; // hero bets/raises (action richness)
    cands.push({
      f, id: path.relative(dir, f).replace(/\.phh$/, ''), nDec: ds.length, facing, aggr,
      pot: Math.max(...ds.map(s => s.pot / (h.blinds[1] || 100))), pre: post[0].line.preflop
    });
  }
  // weight toward engaging hands: more decisions, hands with real betting (facing a bet + hero aggression),
  // 3-bet pots, big pots. A passive check-check-check hand has facing=0/aggr=0 and sinks to the bottom.
  cands.forEach(c => {
    const w = 1 + (c.nDec - 1) * 1.2 + c.facing * 1.5 + c.aggr * 0.8 + (is3bet(c.pre) ? 2 : 0) + Math.min(c.pot / 18, 3);
    c.key = Math.pow(Math.random(), 1 / w);
  });
  cands.sort((a, b) => b.key - a.key);
  console.log('candidate HU-from-flop hands: ' + cands.length + ' → baking up to ' + target);
  const hands = [];
  for (const c of cands) {
    if (hands.length >= target) break;
    let hand = null; try { hand = buildHand(parsePHH(fs.readFileSync(c.f, 'utf8')), c.id); } catch (e) { }
    if (hand) hands.push(hand);
    if (hands.length % 200 === 0 && hands.length) process.stdout.write('  baked ' + hands.length + '/' + target + '\r');
  }
  const out = path.join(__dirname, 'app', 'realhands.json');
  fs.writeFileSync(out, JSON.stringify(hands));
  const dec = hands.reduce((a, h) => a + h.decisions.length, 0);
  const multi = hands.filter(h => h.decisions.length >= 2).length;
  const facing = hands.reduce((a, h) => a + h.decisions.filter(d => d.decision === 'fcr').length, 0);
  const is3bp = h => ((h.decisions[0].line.preflop || '').match(/bets/g) || []).length >= 2;
  const pc = n => (100 * n / hands.length | 0) + '%';
  console.log('\nhands ' + hands.length + ' · ' + dec + ' decisions (' + (dec / hands.length).toFixed(1) + '/hand) · ' + facing + ' facing-a-bet · ' + pc(multi) + ' multi-decision');
  console.log('  3-bet pots ' + pc(hands.filter(is3bp).length) + ' · pot≥20bb ' + pc(hands.filter(h => Math.max(...h.decisions.map(d => d.pot)) >= 20).length) +
    ' · size ' + (fs.statSync(out).size / 1048576).toFixed(2) + 'MB → ' + out);
}

module.exports = { buildHand };
