// Build the 169×169 all-in equity matrix: eq[i][j] = equity of hand-class i vs
// hand-class j, averaged over random suit assignments (= blocker-averaged) and
// random 5-card runouts. Foundation for the push/fold Nash solver.
// Run: node tools/solve/eqmatrix.js [trialsPerPair]   (default 2500, ~1-2 min)
const path = require('path');
const fs = require('fs');
global.window = global;
const H = require(path.join(__dirname, '..', 'app', 'handeval.js'));

const RORD = 'AKQJT98765432';
const SUITS = 'shdc';

// canonical 169 labels + combo counts
function allLabels() {
  const out = [];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    if (i === j) out.push({ h: RORD[i] + RORD[j], w: 6 });
    else if (i < j) out.push({ h: RORD[i] + RORD[j] + 's', w: 4 });
  }
  for (let i = 0; i < 13; i++) for (let j = i + 1; j < 13; j++) out.push({ h: RORD[i] + RORD[j] + 'o', w: 12 });
  return out;
}
const LABELS = allLabels();
const N = LABELS.length;
if (N !== 169) throw new Error('label count ' + N);

function rnd(n) { return (Math.random() * n) | 0; }
function deal(label, used) {
  // random concrete combo for a label avoiding `used` card-ids; null if impossible after tries
  const r1 = label[0], r2 = label[1];
  for (let t = 0; t < 24; t++) {
    let c1, c2;
    if (label.length === 2) {                      // pair
      const a = rnd(4); let b; do { b = rnd(4); } while (b === a);
      c1 = r1 + SUITS[a]; c2 = r2 + SUITS[b];
    } else if (label[2] === 's') {
      const s = SUITS[rnd(4)];
      c1 = r1 + s; c2 = r2 + s;
    } else {
      const a = rnd(4); let b; do { b = rnd(4); } while (b === a);
      c1 = r1 + SUITS[a]; c2 = r2 + SUITS[b];
    }
    const i1 = H.cardId(c1), i2 = H.cardId(c2);
    if (!used[i1] && !used[i2]) return [i1, i2];
  }
  return null;
}

const TRIALS = +process.argv[2] || 2500;
const eq = Array.from({ length: N }, () => new Float32Array(N));
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  eq[i][i] = 0.5;
  for (let j = i + 1; j < N; j++) {
    let wins = 0, ties = 0, done = 0;
    for (let t = 0; t < TRIALS; t++) {
      const used = {};
      const a = deal(LABELS[i].h, used);
      if (!a) continue;
      used[a[0]] = used[a[1]] = 1;
      const b = deal(LABELS[j].h, used);
      if (!b) continue;
      used[b[0]] = used[b[1]] = 1;
      const board = [];
      while (board.length < 5) { const c = rnd(52); if (!used[c]) { used[c] = 1; board.push(c); } }
      const ha = H.eval7(a.concat(board)), hb = H.eval7(b.concat(board));
      const r = H.cmp(ha, hb);
      if (r > 0) wins++; else if (r === 0) ties++;
      done++;
    }
    const e = done ? (wins + ties / 2) / done : 0.5;
    eq[i][j] = e;
    eq[j][i] = 1 - e;
  }
  if (i % 20 === 0) process.stderr.write('  row ' + i + '/169 (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
}

// sanity before writing
const idx = {}; LABELS.forEach((l, k) => idx[l.h] = k);
const aaKK = eq[idx.AA][idx.KK];
if (!(aaKK > 0.78 && aaKK < 0.86)) throw new Error('AA vs KK off: ' + aaKK);
const akQQ = eq[idx.AKo][idx.QQ];
if (!(akQQ > 0.40 && akQQ < 0.50)) throw new Error('AKo vs QQ off: ' + akQQ);

const out = { labels: LABELS.map(l => l.h), weights: LABELS.map(l => l.w), trials: TRIALS, eq: eq.map(r => Array.from(r).map(x => +x.toFixed(4))) };
fs.writeFileSync(path.join(__dirname, 'eqmatrix.json'), JSON.stringify(out));
console.log('wrote tools/solve/eqmatrix.json · ' + ((Date.now() - t0) / 1000).toFixed(0) + 's · AAvKK=' + (aaKK * 100).toFixed(1) + ' AKovQQ=' + (akQQ * 100).toFixed(1));
