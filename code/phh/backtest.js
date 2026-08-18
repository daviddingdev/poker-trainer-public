// Backtest the engine's RIVER decisions against ground truth. Pluribus logs ALL
// hole cards, so for every river spot where hero faces a bet (heads-up) we know the
// true showdown winner — no survivorship bias from only-called hands. We score the
// chip-EV (bb) of FOLLOWING the engine's recommendation vs what the player did:
//   call/raise → won ? +pot : (tie ? 0 : -toCall)   ·   fold → 0
// (pot = chips hero wins by calling; toCall = the call.) Average over all spots.
//   node tools/phh_backtest.js [dir] [limitHands]
'use strict';
const fs = require('fs');
const path = require('path');
const { parsePHH, reconstruct } = require(path.join(__dirname, 'phh_real_spots.js'));
const { engineTake } = require(path.join(__dirname, 'phh_engine_take.js'));   // sets up window.Poker etc.
const HE = require(path.join(__dirname, 'app/handeval.js'));
const POS6 = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];

function rank(holeStr, board) { return HE.eval7(holeStr.match(/../g).concat(board).map(HE.cardId)); }

function run(dir, limit) {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.phh')) files.push(p); } })(dir);
  let hands = 0, scored = 0, skipped = 0;
  let evEng = 0, evAct = 0;                          // summed chip-EV in bb
  const engAct = { call: 0, fold: 0, raise: 0 };     // engine action counts
  let callWon = 0, callLost = 0, foldWasLoser = 0, foldWasWinner = 0;   // correctness
  let agree = 0;

  for (const f of files) {
    if (limit && hands >= limit) break;
    const h = parsePHH(fs.readFileSync(f, 'utf8'));
    if (h.variant !== 'NT') continue;
    hands++;
    const bb = h.blinds[1] || 100, r = reconstruct(h);
    for (const s of r.spots) {
      if (s.street !== 'river' || s.toCall <= 0) continue;       // facing a bet only (clean call/fold/raise EV)
      if (!s.liveOpps || s.liveOpps.length !== 1) continue;      // heads-up (engine v1)
      const villSeat = POS6.indexOf(s.liveOpps[0]);
      const villCards = r.hole[villSeat];
      if (!villCards || !s.cards) { skipped++; continue; }
      const t = engineTake(s, 100);
      if (t.skip) { skipped++; continue; }

      const c = HE.cmp(rank(s.cards, s.board), rank(villCards, s.board));   // >0 hero wins, 0 tie, <0 lose
      const potBB = s.pot / bb, callBB = s.toCall / bb;
      const scoreOf = act => (act === 'fold') ? 0 : (c > 0 ? potBB : c === 0 ? 0 : -callBB);   // call/raise scored on showdown
      const eAct = (t.ideal === 'call' || t.ideal === 'raise') ? t.ideal : 'fold';
      evEng += scoreOf(eAct);
      evAct += scoreOf(s.action);
      engAct[eAct === 'raise' ? 'raise' : eAct]++;
      if (eAct !== 'fold') { if (c > 0) callWon++; else if (c < 0) callLost++; }
      else { if (c < 0) foldWasLoser++; else if (c > 0) foldWasWinner++; }
      if (eAct === s.action || (eAct !== 'fold' && s.action !== 'fold')) agree++;
      scored++;
    }
  }
  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '—';
  console.log('\n=== RIVER BACKTEST (facing a bet, heads-up, ground-truth showdown) ===');
  console.log('hands scanned: ' + hands + '  |  river facing-bet spots scored: ' + scored + '  |  skipped: ' + skipped);
  console.log('\nENGINE avg EV : ' + (evEng / scored).toFixed(3) + ' bb / decision');
  console.log('ACTUAL avg EV : ' + (evAct / scored).toFixed(3) + ' bb / decision   (what the players did)');
  console.log('DELTA (eng-act): ' + ((evEng - evAct) / scored).toFixed(3) + ' bb / decision');
  console.log('\nengine actions: call+raise ' + (engAct.call + engAct.raise) + ' (' + pct(engAct.call + engAct.raise, scored) + '), fold ' + engAct.fold + ' (' + pct(engAct.fold, scored) + ')');
  console.log('  of engine CALLS: ' + callWon + ' won / ' + callLost + ' lost  → ' + pct(callWon, callWon + callLost) + ' were ahead');
  console.log('  of engine FOLDS: ' + foldWasLoser + ' were losers (good) / ' + foldWasWinner + ' were winners (folded the best hand) → ' + pct(foldWasLoser, foldWasLoser + foldWasWinner) + ' correct');
}

if (require.main === module) run(process.argv[2] || '/home/user/poker-data/phh/data/pluribus', +(process.argv[3] || 0));
module.exports = { run };
