// Node test for the push/fold grader. Run: node tools/test_poker.js
global.window = {};
require('./app/charts.js');           // sets window.POKER_DATA
require('./app/nash.js');             // sets window.NASH (solved push/fold)
const Poker = require('./app/poker.js');
Poker.init(window.POKER_DATA);

let fail = 0;
function ok(cond, msg) { if (!cond) { console.log('  FAIL:', msg); fail++; } else { console.log('  ok  :', msg); } }

console.log('label parsing');
ok(Poker.handLabel('Ah', 'Ks') === 'AKo', 'AhKs -> AKo');
ok(Poker.handLabel('Ks', 'Ah') === 'AKo', 'order-independent');
ok(Poker.handLabel('Ah', 'As') === 'AA', 'pair');
ok(Poker.handLabel('7h', '8h') === '87s', 'suited higher-first');
ok(Poker.handLabel('2c', '2d') === '22', 'low pair');

console.log('monotonic percentile');
ok(Poker.pct('AA') < Poker.pct('KK'), 'AA stronger than KK');
ok(Poker.pct('KK') < Poker.pct('72o'), 'KK stronger than 72o');
ok(Poker.pct('AA') > 0 && Poker.pct('72o') <= 1, 'percentiles bounded');

console.log('jamming widens with position and shortness');
ok(Poker.jamThreshold('BTN', 12) > Poker.jamThreshold('EP', 12), 'BTN jams wider than EP');
ok(Poker.jamThreshold('SB', 8) > Poker.jamThreshold('CO', 8), 'SB jams wider than CO');
ok(Poker.jamThreshold('BTN', 8) > Poker.jamThreshold('BTN', 20), 'shorter stack jams wider');

console.log('Nash-solved push/fold (per-hand EVs)');
ok(!!window.NASH && !!window.NASH.jam[12], 'nash.js loaded');
['EP', 'MP', 'CO', 'BTN', 'SB'].forEach(p => {
  [8, 12, 15, 20].forEach(s => {
    const aa = Poker.jamEval(p, s, 'AA');
    ok(aa.in && aa.ev > 1, 'jam AA ' + p + ' ' + s + 'bb (EV +' + aa.ev + ')');
  });
});
['EP', 'MP', 'CO', 'BTN'].forEach(p => {
  [8, 12, 15, 20].forEach(s => ok(!Poker.jamEval(p, s, '72o').in, 'fold 72o ' + p + ' ' + s + 'bb'));
});
ok(Poker.jamEval('EP', 12, 'AKo').in, 'jam AKo UTG 12bb');
ok(Poker.jamEval('CO', 12, 'KQs').in, 'jam KQs CO 12bb');
ok(Poker.jamEval('BTN', 12, '22').in, 'jam 22 BTN 12bb');
// suited hands jam beyond their raw rank (Nash sets are not percentile prefixes)
(function () {
  const j = window.NASH.jam[12].BTN;
  const suitedIn = ['K9s', 'Q9s', 'J9s'].filter(h => j[h] > 0).length;
  ok(suitedIn >= 2, 'suited broadway-ish hands jam BTN 12bb (' + suitedIn + '/3)');
})();

console.log('calling a jam (Nash, BB)');
ok(Poker.callThreshold('late', 12) < Poker.jamThreshold('SB', 12), 'BB calls tighter than the SB jams');
ok(Poker.callThreshold('early', 12) < Poker.callThreshold('late', 12), 'call tighter vs early jammer');
ok(Poker.callEval('late', 12, 'AKo').in && Poker.callEval('late', 12, 'AKo').ev > 0, 'call AKo vs late jam 12bb');
ok(!Poker.callEval('early', 12, '87s').in, 'fold 87s vs early jam 12bb');
ok(!Poker.callEval('early', 20, 'KQo').in, 'fold KQo vs early 20bb jam');
ok(Poker.callEval('late', 8, 'A7o').in, 'call A7o vs late 8bb jam (wide vs wide)');

console.log('marginal band (EV-based)');
(function () {
  const j = window.NASH.jam[12].BTN;
  const boundary = Object.keys(j).find(h => Math.abs(j[h]) <= 0.15);
  ok(boundary && Poker.jamEval('BTN', 12, boundary).marginal, 'boundary hand ' + boundary + ' is marginal (|EV|≤0.15)');
  ok(!Poker.jamEval('BTN', 12, 'AA').marginal, 'AA not marginal');
  ok(!Poker.jamEval('EP', 12, '72o').marginal, '72o not marginal');
})();

console.log('preflop drill evals (open / vs-raise, with marginal)');
ok(Poker.openEval('BTN', 30, 'AA').in && !Poker.openEval('EP', 30, '72o').in, 'open: AA in BTN, 72o out EP');
(function () {
  const t = Poker.openThreshold('CO', 20);
  let best = null, bd = 9;   // search by the rank the eval uses (realization-adjusted)
  window.POKER_DATA.ranking.forEach(r => { const d = Math.abs(Poker.openPct(r.h) - t); if (d < bd) { bd = d; best = r.h; } });
  ok(Poker.openEval('CO', 20, best).marginal, 'open boundary hand ' + best + ' is marginal');
})();
ok(Poker.vsEval(30, 'BTN', 'AA').action === 'threebet', 'vsEval: 3-bet AA vs BTN');
ok(Poker.vsEval(30, 'BTN', '72o').action === 'fold', 'vsEval: fold 72o vs BTN');
ok(['threebet', 'call', 'fold'].includes(Poker.vsEval(20, 'EP', 'A9s').action), 'vsEval returns a valid action');
(function () {
  // a hand near the call boundary should flag nearCall (search by the eval's rank AT THAT DEPTH)
  const th = Poker.vsThresholds(30, 'BTN');
  let best = null, bd = 9;
  window.POKER_DATA.ranking.forEach(r => { const d = Math.abs(Poker.openPct(r.h, 30) - th.call); if (d < bd) { bd = d; best = r.h; } });
  ok(Poker.vsEval(30, 'BTN', best).nearCall, 'call-boundary hand ' + best + ' flags nearCall');
})();

console.log('blind defense (SB/BB vs an open)');
ok(Poker.blindVsThresholds('BB', 30, 'BTN').call > Poker.vsThresholds(30, 'BTN').call, 'BB defends wider than a field caller vs BTN');
ok(Poker.blindVsThresholds('SB', 30, 'BTN').call < Poker.vsThresholds(30, 'BTN').call, 'SB flats narrower than a field caller (3-bet-or-fold lean)');
ok(Poker.blindVsThresholds('BB', 30, 'SB').call > Poker.blindVsThresholds('BB', 30, 'EP').call, 'BB defends widest vs SB, tightest vs UTG');
ok(Poker.blindVsThresholds('BB', 10, 'BTN').call < Poker.blindVsThresholds('BB', 30, 'BTN').call, 'shallower = tighter BB defense');
// realization rank (2026-06-12): T9s is a premium suited connector — both blinds
// now CONTINUE vs a BTN open (BB 3-bets/calls, SB 3-bets) rather than folding it
ok(Poker.blindVsEval('BB', 30, 'BTN', 'T9s').action !== 'fold', 'BB continues T9s vs BTN open');
ok(Poker.blindVsEval('SB', 30, 'BTN', 'T9s').action !== 'fold', 'SB does not fold T9s vs BTN (suited connector, realization-promoted)');
// the realization split itself: suited connectors open far wider than their all-in rank
ok(Poker.openPct('87s') < Poker.pct('87s') - 0.15, '87s opening rank is well above its all-in rank (realization premium)');
ok(Poker.openIn('CO', 100, '87s') && Poker.openIn('BTN', 100, '76s'), '87s opens CO, 76s opens BTN (matches solver RFI)');
ok(!Poker.openIn('CO', 100, 'K2o') && !Poker.openIn('BTN', 100, 'Q5o'), 'offsuit junk (K2o, Q5o) still not opened — realization demotes it');
ok(Poker.openIn('EP', 100, '55') && Poker.openIn('BTN', 100, '22'), 'small pairs still open where they should (set-mining value intact)');
ok(Poker.vs4betEval(50, 'ip', 'AQs').action === 'fold', 'AQs still folds vs a 4-bet — war tiers stay on equity, realization off');
// SB limp range (David's catch: the ante gives the SB a huge limp range)
ok(Poker.sbAction(100, 'KK') === 'raise' && Poker.sbAction(100, '72o') === 'fold', 'SB: KK raises, 72o folds');
ok(Poker.sbAction(100, 'A5o') === 'limp' || Poker.sbAction(100, 'A5o') === 'raise', 'SB: A5o is no longer a fold (limp or raise)');
ok(['raise', 'limp', 'fold'].indexOf(Poker.sbAction(100, 'K3o')) >= 0 && Poker.sbAction(100, 'K3o') === 'limp', 'SB: K3o limps the playable band deep');
(function () {
  const W = h => h.length === 2 ? 6 : h[2] === 's' ? 4 : 12;
  const RORD2 = 'AKQJT98765432', all = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) all.push(r === c ? RORD2[r] + RORD2[r] : r < c ? RORD2[r] + RORD2[c] + 's' : RORD2[c] + RORD2[r] + 'o');
  const vpip = d => { let v = 0; all.forEach(h => { if (Poker.sbAction(d, h) !== 'fold') v += W(h); }); return v / 1326; };
  ok(vpip(100) > 0.62 && vpip(100) < 0.74, 'SB 100bb VPIP ≈ 68% (ante-wide): ' + Math.round(vpip(100) * 100) + '%');
  ok(vpip(20) < vpip(50) && vpip(50) < vpip(100), 'SB VPIP widens with depth (limp range grows deep): ' + [20, 50, 100].map(d => Math.round(vpip(d) * 100) + '%').join('<'));
})();
// realization DEPTH ramp (David's stack-size catch): speculative suited
// connectors tighten as stacks shorten (less implied odds to realize)
ok(Poker.openPct('87s', 20) > Poker.openPct('87s', 100), '87s opening rank tightens at 20bb vs 100bb (depth ramp)');
ok(!Poker.openIn('BTN', 20, '54s') && Poker.openIn('BTN', 100, '54s'), '54s: too speculative to open BTN at 20bb, opens deep at 100bb');
ok(Poker.openIn('CO', 50, '87s') && !Poker.openIn('CO', 20, '87s'), '87s opens CO deep (50bb) but not at 20bb');
// small-pair set-mining (David's catch): folds short (no implied odds), set-mines
// deep (15:1 crosses ~33-40bb). 88+ excluded (3-bet tier); push/fold untouched.
ok(Poker.vsEval(20, 'CO', '22').action === 'fold' && Poker.vsEval(100, 'CO', '22').action === 'call',
  '22 folds a CO open at 20bb (no set-mine), set-mines (flats) at 100bb');
ok(Poker.vsEval(20, 'CO', '33').action === 'fold' && Poker.vsEval(50, 'CO', '33').action !== 'fold',
  '33 tightens short, continues by 50bb');
ok(Poker.vsEval(100, 'CO', '88').action === 'threebet' && Poker.vsEval(100, 'CO', '99').action === 'threebet',
  '88/99 stay in the 3-bet tier (set-mine bonus excludes them)');
ok(Poker.openPct('22', 20) >= Poker.openPct('22', 100) - 1e-9, '22 opening rank tightens short, improves deep (set-mine ramp)');
ok(Poker.pct('AA') < Poker.pct('99') && Poker.pct('99') < Poker.pct('22') && Poker.pct('22') < Poker.pct('72o'),
  'push/fold equity rank (pct) preserves pair order AA<99<22<72o — realization never touches it');
ok(Poker.blindVsEval('BB', 30, 'BTN', 'AA').action === 'threebet', 'BB 3-bets AA');
ok(Poker.blindVsEval('SB', 30, 'EP', '72o').action === 'fold', 'SB folds 72o vs UTG');

console.log('multiway + vs-3bet evals');
ok(Poker.squeezeEval(30, 'late', 'AA').action === 'threebet', 'squeeze AA vs late open+caller');
ok(Poker.squeezeEval(30, 'late', '72o').action === 'fold', 'fold 72o to squeeze spot');
// squeeze is tighter than a heads-up 3-bet
(function () {
  function cont(fn, ...args) { let n = 0; window.POKER_DATA.ranking.forEach(r => { if (fn(...args, r.h) !== 'fold') n += r.w; }); return n; }
  const hu = cont((d, o, h) => Poker.vsEval(d, o, h).action, 30, 'CO');
  const sq = cont((d, b, h) => Poker.squeezeEval(d, b, h).action, 30, 'late');
  ok(sq < hu, 'squeeze range tighter than HU 3-bet vs same depth (' + sq + ' < ' + hu + ')');
})();
ok(Poker.vs3betEval(30, 'ip', 'AA').action === 'threebet', '4-bet AA vs 3-bet');
ok(Poker.vs3betEval(30, 'ip', 'A2o').action === 'fold', 'fold A2o vs 3-bet');

console.log('raise-war adjustments (AK promotion, mid-pair demotion)');
ok(Poker.vs3betEval(20, 'ip', 'AKo').action === 'threebet' && !Poker.vs3betEval(20, 'ip', 'AKo').nearTb, 'AKo jams vs 3-bet at 20bb (strict)');
ok(Poker.vs3betEval(30, 'oop', 'AKo').action === 'threebet' && Poker.vs3betEval(30, 'oop', 'AKo').nearTb, 'AKo 4-bets at 30bb (flat = close, not wrong)');
ok(Poker.vs3betEval(30, 'ip', 'AKs').action === 'threebet', 'AKs 4-bets at 30bb');
ok(Poker.vs3betEval(30, 'ip', 'TT').action === 'call', 'TT demoted to call vs 3-bet at 30bb');
ok(Poker.vs3betEval(20, 'ip', 'TT').action === 'threebet', 'TT still jams vs 3-bet at 20bb');
ok(Poker.squeezeEval(20, 'late', 'AKo').action === 'threebet', 'AKo squeeze-jams at 20bb');

console.log('squeeze fixes: demotion scoped to wars, BB closing gets pot odds');
ok(Poker.squeezeEval(30, 'early', 'TT').action === 'threebet', 'TT SQUEEZES at 30bb (demotion is for 4-bet wars only)');
ok(Poker.squeezeEval(30, 'early', '99').action === 'threebet', '99 squeezes too');
ok(Poker.vs3betEval(30, 'ip', 'TT').action === 'call' && Poker.vs3betEval(30, 'ip', 'TT').note, 'TT still demoted vs a 3-BET, with an explanatory note');
ok(Poker.squeezeEval(30, 'late', '98s', 'BB', 2).action === 'call', 'BB closing multiway overcalls 98s (pot odds)');
ok(Poker.squeezeEval(30, 'late', '98s', 'BTN', 2).action === 'fold', 'same hand in the FIELD folds (players behind, no discount)');
ok(Poker.squeezeThresholds(30, 'late', 'BB', 2).call > Poker.squeezeThresholds(30, 'late', 'SB', 2).call, 'BB overcalls wider than SB');
ok(Poker.squeezeThresholds(30, 'late', 'SB', 2).call > Poker.squeezeThresholds(30, 'late', 'BTN', 2).call, 'SB wider than field');

console.log('calljam graded vs the NAMED seat');
ok(!!window.NASH.callBBSeat && !!window.NASH.callBBSeat[8], 'per-seat call EVs present');
ok(!Poker.callEval('BTN', 8, 'Q5o').in, 'Q5o FOLDS vs an actual BTN 8bb jam (bucket avg said call — bug fixed)');
ok(Poker.callEval('SB', 8, 'Q5o').in, 'Q5o calls vs an SB 8bb jam (their range really is ~76%)');
ok(Poker.callEval('EP', 12, 'AKo').in, 'AKo calls vs a UTG 12bb jam');
ok(Poker.callEval('EP', 12, 'KJo').marginal, 'KJo vs a UTG 12bb jam is a true coin-flip (EV ≈ +0.04)');
ok(!Poker.callEval('EP', 12, '98o').in, '98o folds vs a UTG 12bb jam');
ok(Poker.callEval('late', 12, 'AKo').in, 'bucket back-compat still works');

console.log('deep stacks: premium dilemmas (his ask)');
ok(Poker.vs3betEval(100, 'ip', 'QQ').action === 'call' && Poker.vs3betEval(100, 'ip', 'QQ').note, 'QQ CALLS a 3-bet at 100bb (noted: modern default; 4-bet fine vs aggro)');
ok(Poker.vs3betEval(50, 'oop', 'JJ').action === 'call', 'JJ calls a 3-bet at 50bb');
ok(Poker.vs3betEval(30, 'ip', 'QQ').action === 'threebet', 'QQ still 4-bets at 30bb (depth gate)');
ok(Poker.vs3betEval(100, 'ip', 'AA').action === 'threebet', 'AA always 4-bets');
ok(Poker.vs3betEval(100, 'ip', 'AKo').action === 'threebet' && Poker.vs3betEval(100, 'ip', 'AKo').nearTb, 'AK 4-bets deep, flat = close');
ok(Poker.vs3betEval(100, 'ip', 'AQs').action === 'call', 'AQs flats a 3-bet deep IP');
ok(Poker.vs4betEval(100, 'ip', 'KK').action === 'threebet', 'KK 5-bet jams vs a 4-bet');
ok(Poker.vs4betEval(100, 'ip', 'QQ').action === 'call', 'QQ calls a 4-bet at 100bb (set-mine-and-evaluate)');
ok(Poker.vs4betEval(50, 'ip', 'AQs').action === 'fold', 'AQs FOLDS to a 4-bet at 50bb — the classic trap hand');
ok(Poker.vs4betEval(100, 'ip', 'AKs').action === 'threebet', 'AKs continues vs a 4-bet (promoted)');
ok(Poker.vs4betEval(100, 'ip', '88').action === 'fold' || Poker.vs4betEval(100, 'ip', '88').action === 'call', '88 at best set-mines vs a 4-bet');

console.log('isolation class + cold3b context (his multiway question)');
(function(){
  const aq = Poker.squeezeEval(30, 'late', 'AQo', 'BB', 1);
  ok(aq.action === 'threebet' && aq.nearTb && /ISOLATE/.test(aq.note || ''), 'AQo in squeeze spots: squeeze-to-isolate (overcall acceptable)');
  const tt = Poker.squeezeEval(30, 'late', 'TT', 'BB', 1);
  ok(tt.action === 'threebet', 'TT squeezes (in tier or isolated)');
  const s98 = Poker.squeezeEval(30, 'late', '98s', 'BB', 2);
  ok(s98.action === 'call' && !s98.note, '98s still OVERCALLS — suited/connected wants the multiway pot');
  const cold = Poker.cold3bEval(50, 'QQ');
  ok(cold.action === 'call' && /cold|behind/.test(cold.note || ''), 'QQ cold vs open+3bet: call with COLD-context note (not the vs-3-bet text)');
  const own = Poker.vs3betEval(50, 'ip', 'QQ');
  ok(own.action === 'call' && /modern default/.test(own.note || ''), 'QQ vs a 3-bet of YOUR open keeps the heads-up note');
})();

console.log('facing a cold 3-bet (open + 3-bet in front)');
ok(Poker.cold3bEval(30, 'AA').action === 'threebet', 'cold 4-bet AA');
ok(Poker.cold3bEval(30, 'AKo').action === 'threebet', 'AK promoted into cold 4-bet zone');
ok(Poker.cold3bEval(30, 'AQs').action === 'fold' || Poker.cold3bEval(30, 'AQs').action === 'call', 'AQs at best calls cold');
ok(Poker.cold3bEval(30, 'KQs').action === 'fold', 'KQs folds to a cold 3-bet');
ok(Poker.cold3bEval(30, 'TT').action === 'call', 'TT calls cold at 30bb (set-mine tier)');
ok(Poker.cold3bEval(30, 'A9s').action === 'fold', 'A9s folds — two shown ranges in front');
// cold continues tighter than heads-up vs-3-bet
(function () {
  function width(fn) { let n = 0; window.POKER_DATA.ranking.forEach(r => { if (fn(r.h).action !== 'fold') n += r.w; }); return n; }
  const cold = width(h => Poker.cold3bEval(30, h));
  const hu = width(h => Poker.vs3betEval(30, 'ip', h));
  ok(cold < hu, 'cold-3-bet continues tighter than facing a 3-bet heads-up (' + cold + ' < ' + hu + ' combos)');
})();
ok(Poker.isoThreshold('BTN', 30) < Poker.openThreshold('BTN', 30), 'iso tighter than open');
ok(Poker.isoEval('BTN', 30, 'AA').in && !Poker.isoEval('EP', 30, '72o').in, 'iso: AA in BTN, 72o out EP');

console.log('pocket-card action model (10/20/30bb)');
ok(Poker.openIn('BTN', 30, 'AA') && !Poker.openIn('EP', 30, '72o'), 'open: AA in BTN, 72o out EP');
ok(Poker.openThreshold('BTN', 30) > Poker.openThreshold('EP', 30), 'BTN opens wider than EP');
ok(Poker.vsAction(30, 'BTN', 'AA') === 'threebet', '3-bet AA vs BTN open 30bb');
ok(Poker.vsAction(30, 'BTN', '72o') === 'fold', 'fold 72o vs BTN open');
// wider vs a later opener: more 3bet+call combos vs BTN than vs EP
function contCombos(depth, opener) {
  let n = 0; window.POKER_DATA.ranking.forEach(r => { if (Poker.vsAction(depth, opener, r.h) !== 'fold') n += r.w; }); return n;
}
ok(contCombos(30, 'BTN') > contCombos(30, 'EP'), 'continue wider vs BTN than vs EP');
ok(['threebet', 'call', 'fold'].includes(Poker.vsAction(20, 'CO', 'KJs')), 'vsAction returns a valid action');

console.log('matchups present & sane');
const m = window.POKER_DATA.matchups;
ok(m.length >= 16, m.length + ' matchups');
const aaKK = m.find(x => x.a === 'AA' && x.b === 'KK');
ok(aaKK && aaKK.eqA > 78 && aaKK.eqA < 86, 'AA vs KK ~83% (' + (aaKK && aaKK.eqA) + ')');
ok(m.find(x => x.a === 'QQ' && x.b === '99'), 'overpair-vs-underpair matchup present');
ok(m.find(x => x.a === 'TT' && x.b === 'A8o'), 'pair-vs-over+under matchup present');

console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASS');
process.exit(fail ? 1 : 0);
