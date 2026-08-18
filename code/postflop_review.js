// Grade EVERY hero postflop decision against the SAME engine the drills + real-hands
// trainer use (postflop.flopDecide / flopMix, with the action-aware villain range that
// re-weights street-by-street off the villain's actual line). Flags any decision whose
// action wasn't in the engine's mix, with what the engine would do and WHY — a review
// list to study. Heads-up-by-the-decision only (multiway postflop is skipped, like the
// trainer). Across all sessions, or one: node tools/postflop_review.js [sessionId] [--tag] [--all]
'use strict';
const path = require('path');
global.window = global;
// Seed the RNG so the Monte-Carlo equities — and therefore the deviation verdicts —
// are REPRODUCIBLE. A review tool that flips borderline flags run-to-run is useless.
let _seed = 0x9e3779b9 >>> 0;
Math.random = function () { _seed = (_seed + 0x6D2B79F5) >>> 0; let t = _seed; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
require(path.join(__dirname, 'app/charts.js'));
require(path.join(__dirname, 'app/nash.js'));
require(path.join(__dirname, 'app/poker.js'));
require(path.join(__dirname, 'app/postflop.js'));
const H = require(path.join(__dirname, 'app/handeval.js'));
const P = window.Poker, PF = window.Postflop;
P.init(window.POKER_DATA);
const store = require(path.join(__dirname, '..', 'backups', 'store.json'));

// 8-max ACR seat → 6-max engine position (range band + postflop order). lj≈MP, hj≈CO.
const SEAT6 = { sb: 'SB', bb: 'BB', utg: 'UTG', mp: 'MP', lj: 'MP', hj: 'CO', co: 'CO', btn: 'BTN' };
const PORD = { sb: 0, bb: 1, utg: 2, mp: 3, lj: 4, hj: 5, co: 6, btn: 7 };
const SEATS = new Set(Object.keys(PORD));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const net = h => num(h.amount) * (h.sign === '-' ? -1 : 1);
const DEPTHS = [10, 20, 30, 50, 100];
const bucket = bb => DEPTHS.reduce((a, d) => Math.abs(d - bb) < Math.abs(a - bb) ? d : a, 100);
const NAMES = ['pre', 'flop', 'turn', 'river'];
const strip = s => String(s).replace(/<[^>]+>/g, '');
const RAISE_FREQ = { value: 0.55, draw: 0.28, medium: 0.05, overs: 0.04, airdraw: 0.07, air: 0.03 };
const RIVER_CALL = { value: 0.96, draw: 0.55, medium: 0.55, overs: 0.12, airdraw: 0.12, air: 0.04 };

// preflop action sequence (hero = bare tokens). Mirrors analyze_session.parsePre.
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
const RAISEACT = { open: 1, '3b': 1, '4b': 1, '5b': 1, jam: 1, r: 1, b: 1 };

// villain's preflop role → range band (same shape engineTake.preflopBand produces)
function villBand(villSeat, preSeq, depth) {
  let raises = 0, firstRaiser = null, villAct = null;
  for (const s of preSeq) {
    const isRaise = RAISEACT[s.act];
    if (isRaise) { raises++; if (!firstRaiser) firstRaiser = s.who; }
    if (s.who === villSeat) villAct = isRaise ? (raises >= 2 ? '3bet' : 'open') : s.act === 'c' ? 'call' : s.act === 'limp' ? 'call' : s.act === 'x' ? 'check' : s.act;
  }
  const v6 = SEAT6[villSeat] || 'CO', isBlind = villSeat === 'sb' || villSeat === 'bb';
  const opener6 = firstRaiser && firstRaiser !== 'hero' ? (SEAT6[firstRaiser] || 'CO') : 'CO';
  if (villAct === 'open') return { band: [0, P.openThreshold(v6, depth)], role: v6 + ' open' };
  if (villAct === '3bet') return { band: [0, P.vsThresholds(depth, opener6).tb], role: v6 + ' 3-bet' };
  if (villAct === 'call') return { band: isBlind ? [0.03, 0.50] : [0.03, 0.30], role: v6 + ' flat' };
  if (villAct === 'check') return { band: [0.0, 0.65], role: v6 + ' BB check' };
  return { band: [0, P.openThreshold(v6, depth) || 0.25], role: v6 + ' ?' };
}

// parse one postflop street segment "(board) act act ..." into ordered (who,act,sz).
function parseStreet(seg, heroIP) {
  const m = seg.match(/^\(([^)]*)\)\s*(.*)$/); if (!m) return null;
  const cards = m[1].match(/.{2}/g) || [];
  const raw = (m[2] || '').split(/\s+/).filter(Boolean);
  const hasSeat = raw.some(t => SEATS.has(t));
  const acts = [];
  if (hasSeat) {
    for (let j = 0; j < raw.length; j++) {
      let who = 'hero', t = raw[j];
      if (SEATS.has(t)) { who = t; t = raw[++j]; if (!t) break; }
      const bm = t.match(/^(x|c|f|jam|b|r)([\d.]*)$/); if (bm) acts.push({ who, act: bm[1], sz: bm[2] ? +bm[2] : 0 });
    }
  } else {                                   // no seats: alternate, OOP first (hero acts 2nd if IP)
    let turn = heroIP ? 'v' : 'hero';
    for (const t of raw) { const bm = t.match(/^(x|c|f|jam|b|r)([\d.]*)$/); if (!bm) continue; acts.push({ who: turn, act: bm[1], sz: bm[2] ? +bm[2] : 0 }); turn = turn === 'hero' ? 'v' : 'hero'; }
  }
  return { cards, acts };
}

// grade one hand: returns { devs:[...], skip } where each dev is an engine deviation.
function reviewHand(h) {
  const segs = (h.action || '').split('/').map(s => s.trim());
  if (segs.length < 2 || !h.pos || !SEATS.has(h.pos)) return { skip: 'no postflop' };
  const depth = bucket(num(h.eff)), preSeq = parsePre(segs[0]);
  // the single live villain postflop = the one non-hero seat that acts after the flop
  const postSeats = new Set();
  for (let i = 1; i < segs.length; i++) {
    const m = segs[i].match(/^\(([^)]*)\)\s*(.*)$/); if (!m) continue;
    (m[2].split(/\s+/) || []).forEach(t => { if (SEATS.has(t)) postSeats.add(t); });
  }
  postSeats.delete(h.pos);
  // when seats aren't written, infer villain from preflop (last non-hero aggressor/caller)
  let villSeat = [...postSeats][0];
  if (postSeats.size > 1) return { skip: 'multiway postflop' };
  if (!villSeat) {
    const live = preSeq.filter(s => s.who !== 'hero' && s.act !== 'f').map(s => s.who);
    villSeat = live[live.length - 1];
  }
  if (!villSeat || !SEATS.has(villSeat)) return { skip: 'no HU villain' };
  const heroIP = (PORD[h.pos] ?? 9) > (PORD[villSeat] ?? 0);
  const pos = heroIP ? 'ip' : 'oop';
  const vb = villBand(villSeat, preSeq, depth);
  const combos = P.bandCombos(vb.band[0], vb.band[1]);
  if (!combos || !combos.length) return { skip: 'no villain combos' };
  // hero preflop role → edge
  const heroRaisedPre = preSeq.some(s => s.who === 'hero' && RAISEACT[s.act]);
  const nRaisesPre = preSeq.filter(s => RAISEACT[s.act]).length;
  const potType = nRaisesPre >= 2 ? '3bet' : 'srp';
  const villIsBlind = villSeat === 'sb' || villSeat === 'bb';

  // pot after preflop (bb units): blinds + each raise/call. Approx from sizes.
  let pot = 1.5;
  preSeq.forEach(s => { if (s.size) pot += s.size; else if (s.act === 'c') pot += 1; else if (s.act === 'limp') pot += 1; });

  const villStreetAct = {};                  // villain's net action per street (for conditioning)
  function condFor(uptoStreetIdx) {          // weight a combo by villain's line through street idx
    return (c1, c2, b) => {
      let w = 1;
      for (let k = 1; k <= uptoStreetIdx; k++) {
        const va = villStreetAct[k]; if (!va) continue;
        const slice = b.slice(0, k === 1 ? 3 : k === 2 ? 4 : 5);
        if (slice.length < 3) continue;
        const cat = PF.classifyFlop([c1, c2], slice).category;
        if (va === 'bet') w *= (PF.BET_FREQ[cat] || 0.3);
        else if (va === 'raise') w *= (RAISE_FREQ[cat] || 0.05);
        else if (va === 'call') w *= (PF.CONT_FREQ[cat] || 0.2);
        else if (va === 'check') w *= (PF.CHECK_FREQ[cat] || 0.5);
      }
      return Math.max(0, Math.min(1, w));
    };
  }

  let board = [], devs = [];
  for (let i = 1; i < segs.length; i++) {
    const ps = parseStreet(segs[i], heroIP); if (!ps) continue;
    board = board.concat(ps.cards);
    if (board.length < 3) continue;
    const st = NAMES[i], texF = PF.textureOf(board.slice(0, 3));
    const edge = heroRaisedPre
      ? PF.preflopEdge({ potType, callerBlind: villIsBlind, openerEarly: PORD[h.pos] <= 3 }, texF)
      : PF.defenderEdge(texF);
    let liveBet = 0, vNet = null;
    // pre-compute equity lazily once per decision (board is fixed within the street)
    let eqCache = null, eqCallCache = null, cls = null;
    const ensure = () => {
      if (eqCache === null) {
        cls = PF.classifyFlop([h.c1, h.c2], board);
        eqCache = H.equityVsRange([h.c1, h.c2], board, combos, { n: 1200, condition: condFor(i - 1) });
        if (st === 'river') eqCallCache = H.equityVsRange([h.c1, h.c2], board, combos, { n: 1200, condition: (c1, c2, bd) => condFor(i - 1)(c1, c2, bd) * (RIVER_CALL[PF.classifyFlop([c1, c2], bd).category] || 0.1) });
      }
    };
    for (const a of ps.acts) {
      const facing = liveBet;
      if (a.who === 'hero') {
        ensure();
        const frac = facing > 0 ? facing / Math.max(1, pot) : null;
        const node = facing > 0 ? (heroIP ? 'ipBet' : 'oopBet') : (heroIP ? 'ipCheck' : 'oopFirst');
        const ctx = { eq: eqCache, eqCall: st === 'river' ? eqCallCache : eqCache, price: facing > 0 ? facing / (pot + facing) : null,
          frac, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge, wet: texF.wet, pos, potType, street: st, tier: PF.handTier(cls, eqCache) };
        const dec = PF.flopDecide(node, ctx), mix = PF.flopMix(node, ctx);
        // facing-aware: a jam (or bet) with NO bet in front is a BET (first-in shove),
        // not a raise — only call it a raise when there's a live bet to raise.
        const heroActKey = a.act === 'x' ? 'check' : a.act === 'c' ? 'call' : a.act === 'f' ? 'fold'
          : a.act === 'r' ? 'raise' : (a.act === 'b' || a.act === 'jam') ? (facing > 0 ? 'raise' : 'bet') : a.act;
        const mine = mix.find(e => e.act === heroActKey), top = mix[0];
        const freq = mine ? mine.f : 0;
        if (freq < 0.12) {                   // not in the engine's mix → a real deviation
          devs.push({ street: st, board: board.join(''), hero: heroActKey, eng: top.act, freq: Math.round(freq * 100),
            engFreq: Math.round(top.f * 100), eq: Math.round(eqCache * 100), price: ctx.price != null ? Math.round(ctx.price * 100) : null,
            cls: cls.label, why: strip(dec.why), mix: mix.filter(e => e.f >= 0.12).map(e => e.act + ' ' + Math.round(e.f * 100) + '%').join('/') });
        }
      }
      if (a.act === 'b' || a.act === 'r') { liveBet = a.sz; pot += a.sz; if (a.who !== 'hero') vNet = a.act === 'r' ? 'raise' : 'bet'; }
      else if (a.act === 'jam') { liveBet = liveBet || a.sz || pot; pot += liveBet; if (a.who !== 'hero') vNet = 'bet'; }
      else if (a.act === 'c') { pot += liveBet; liveBet = 0; if (a.who !== 'hero') vNet = 'call'; }
      else if (a.act === 'x') { liveBet = 0; if (a.who !== 'hero') vNet = 'check'; }
    }
    villStreetAct[i] = vNet;
  }
  return { devs, villRole: vb.role, heroIP, depth };
}

module.exports = { reviewHand };
// ---- run ----
if (require.main !== module) return;
const ALL = process.argv.includes('--all');
const sid = process.argv.slice(2).find(a => !a.startsWith('--'));
const tourneyName = id => { const t = store.tourneys.find(t => t.id === id); return t ? t.event : id; };
const hands = (sid ? store.hands.filter(h => h.sessionId === sid) : store.hands).filter(h => (h.action || '').split('/').length >= 2);

let totalDecisions = 0, totalDevs = 0, skipped = 0, errored = 0, reviewed = [];
const bySession = {};
for (const h of hands) {
  let r;
  try { r = reviewHand(h); }
  catch (e) { errored++; if (process.argv.includes('--debug')) console.error('ERR ' + h.c1 + h.c2 + ' ' + h.pos + ': ' + e.message); continue; }
  if (r.skip) { skipped++; continue; }
  if (r.devs.length) { reviewed.push({ h, r }); totalDevs += r.devs.length; (bySession[h.sessionId] = bySession[h.sessionId] || []).push({ h, r }); }
}

console.log('=== POSTFLOP DECISIONS vs ENGINE' + (sid ? ' — ' + tourneyName(sid) : ' (all sessions)') + ' ===');
console.log('graded ' + (hands.length - skipped - errored) + ' HU postflop hands · ' + skipped + ' skipped (multiway / unclear)' + (errored ? ' · ' + errored + ' parse errors' : '') + ' · ' + reviewed.length + ' hands with ≥1 deviation\n');

const sessIds = Object.keys(bySession).sort((a, b) => { const ta = store.tourneys.find(t => t.id === a), tb = store.tourneys.find(t => t.id === b); return (ta ? ta.date : '').localeCompare(tb ? tb.date : ''); });
for (const sx of sessIds) {
  const t = store.tourneys.find(t => t.id === sx);
  console.log('\n■ ' + (t ? t.date + ' · ' + t.event : sx));
  for (const { h, r } of bySession[sx]) {
    console.log('  ' + (h.c1 + h.c2) + ' ' + h.pos.toUpperCase() + ' (' + r.depth + 'bb, ' + (r.heroIP ? 'IP' : 'OOP') + ' vs ' + r.villRole + ')  net ' + net(h).toFixed(1) + 'bb');
    console.log('    line: ' + h.action);
    r.devs.forEach(d => {
      const priceTxt = d.price != null ? ', price ' + d.price + '%' : '';
      console.log('    ▸ ' + d.street.toUpperCase() + ' [' + d.board + '] you ' + d.hero.toUpperCase() +
        ' — engine: ' + d.eng.toUpperCase() + ' (' + d.engFreq + '%)  [' + d.cls + ', eq ' + d.eq + '%' + priceTxt + ']');
      console.log('        ' + d.why);
    });
  }
}

// breakdown of deviation TYPES (the leak signature)
const typeCount = {};
reviewed.forEach(({ r }) => r.devs.forEach(d => { const k = d.hero + '→' + d.eng; typeCount[k] = (typeCount[k] || 0) + 1; }));
console.log('\n=== DEVIATION TYPES (your action → engine action) ===');
Object.entries(typeCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + n + '×  ' + k));
console.log('\ntotal: ' + totalDevs + ' deviations across ' + reviewed.length + ' hands');

if (process.argv.includes('--tag')) {
  const nowMs = Date.now(), tagged = [];
  for (const { h, r } of reviewed) {
    const tag = r.devs.map(d => d.street + ' ' + d.hero + '→engine ' + d.eng + ' (' + d.cls + ', eq ' + d.eq + '%)').join(' · ');
    const rec = JSON.parse(JSON.stringify(h)); rec.review = tag; rec.up = nowMs; tagged.push(rec);
  }
  require('fs').writeFileSync('/tmp/postflop-review-tags.json', JSON.stringify({ hands: tagged }));
  console.log('\n--tag: ' + tagged.length + ' hands tagged → /tmp/postflop-review-tags.json');
}
