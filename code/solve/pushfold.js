// Approximate-Nash push/fold solver (first-in jam or fold; players behind call or fold).
// Method: iterated best response on jam sets (per seat × depth) and calling sets
// (per jammer-seat × caller-seat), using the 169×169 blocker-averaged equity matrix
// with rank-overlap combo adjustment. MTT pot: SB 0.5 + BB 1 + BB-ante 1 = 2.5bb dead.
// Approximations (documented): single-caller model, class-level blockers,
// non-closing callers need +0.1bb cushion. Run: node tools/solve/pushfold.js
const path = require('path');
const fs = require('fs');
const M = JSON.parse(fs.readFileSync(path.join(__dirname, 'eqmatrix.json'), 'utf8'));
const L = M.labels, W = M.weights, EQ = M.eq, N = L.length;
const idx = {}; L.forEach((h, i) => idx[h] = i);

const DEPTHS = [8, 10, 12, 15, 20];
const SEATS = ['EP', 'MP', 'CO', 'BTN', 'SB'];
const ORDER = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const POSTED = { EP: 0, MP: 0, CO: 0, BTN: 0, SB: 0.5, BB: 1 };
const DEAD = 2.5;                                   // SB + BB + BB-ante
const behind = s => ORDER.slice(ORDER.indexOf(s) + 1);

// combos of class j given a hand of class i is removed (rank-overlap adjustment)
function combosGiven(j, i) {
  const rj = [L[j][0], L[j][1]], ri = [L[i][0], L[i][1]];
  let avail = { [rj[0]]: 4, [rj[1]]: 4 };
  ri.forEach(r => { if (avail[r] != null) avail[r]--; });
  if (L[j].length === 2) { const a = avail[rj[0]]; return a * (a - 1) / 2; }          // pair
  const a = avail[rj[0]], b = avail[rj[1]];
  return L[j][2] === 's' ? Math.min(a, b) === 0 ? 0 : (() => {                         // suited: count shared suits
    // approximate: fraction of 4 suits where both cards live = scale 4 * (a/4)*(b/4)
    return 4 * (a / 4) * (b / 4);
  })() : a * b - (L[j][2] === 'o' ? Math.min(a, b) * 1 : 0) * 0;                       // offsuit ≈ a*b - suited (already excluded below)
}
// cleaner: offsuit combos = a*b - suitedGiven; recompute properly:
function combosOf(j, i) {
  const rj = [L[j][0], L[j][1]], ri = i == null ? [] : [L[i][0], L[i][1]];
  const avail = {}; avail[rj[0]] = 4; avail[rj[1]] = 4;
  ri.forEach(r => { if (avail[r] != null) avail[r]--; });
  const a = avail[rj[0]], b = avail[rj[1]];
  if (L[j].length === 2) return a * (a - 1) / 2;
  const suited = 4 * (a / 4) * (b / 4);              // expected suits where both remain
  if (L[j][2] === 's') return suited;
  return a * b - suited;
}

// frequencies (0..1 per hand) instead of hard sets — damped fictitious play
function evJam(i, seat, D, callF) {
  let pReach = 1, ev = 0;
  for (const o of behind(seat)) {
    const f = callF[seat][o];
    let cw = 0, tw = 0, eqw = 0;
    for (let j = 0; j < N; j++) {
      const w = combosOf(j, i);
      tw += w;
      if (f[j] > 0) { cw += w * f[j]; eqw += w * f[j] * EQ[i][j]; }
    }
    const c = tw ? cw / tw : 0;
    if (c > 0) {
      const eqc = eqw / cw;
      const pot = 2 * D + (DEAD - POSTED[seat] - POSTED[o]);
      ev += pReach * c * (eqc * pot - D + POSTED[seat]);
      pReach *= (1 - c);
    }
  }
  ev += pReach * DEAD;
  return ev;
}

function evCall(j, callerSeat, jammerSeat, D, jamF) {
  let tw = 0, eqw = 0;
  for (let i = 0; i < N; i++) {
    if (!jamF[i]) continue;
    const w = combosOf(i, j) * jamF[i];
    tw += w; eqw += w * EQ[j][i];
  }
  if (!tw) return -1;
  const eq = eqw / tw;
  const pot = 2 * D + (DEAD - POSTED[jammerSeat] - POSTED[callerSeat]);
  return eq * pot - D + POSTED[callerSeat];
}

// eq vs a uniform random hand (for initialization)
const eqRand = [];
for (let i = 0; i < N; i++) { let tw = 0, s = 0; for (let j = 0; j < N; j++) { const w = combosOf(j, i); tw += w; s += w * EQ[i][j]; } eqRand[i] = s / tw; }
const byStrength = Array.from({ length: N }, (_, i) => i).sort((a, b) => eqRand[b] - eqRand[a]);

function jamPct(set) { let c = 0, t = 0; for (let i = 0; i < N; i++) { t += W[i]; if (set[i]) c += W[i]; } return 100 * c / t; }

const result = { depths: DEPTHS, jam: {}, jamPct: {}, callBB: {}, callBBPct: {} };
const ALPHA = 0.2, ITERS = 220;
for (const D of DEPTHS) {
  // damped fictitious play on frequencies
  const jamF = {}, callF = {};
  for (const s of SEATS) {
    jamF[s] = new Float64Array(N);
    byStrength.slice(0, Math.round(N * 0.2)).forEach(i => jamF[s][i] = 1);
    callF[s] = {};
    for (const o of behind(s)) callF[s][o] = new Float64Array(N);
  }
  let maxDelta = 1;
  for (let iter = 0; iter < ITERS && maxDelta > 0.003; iter++) {
    maxDelta = 0;
    for (const s of SEATS) for (const o of behind(s)) {
      const cushion = o === 'BB' ? 0 : 0.1;
      for (let j = 0; j < N; j++) {
        const br = evCall(j, o, s, D, jamF[s]) > cushion ? 1 : 0;
        const nv = callF[s][o][j] + ALPHA * (br - callF[s][o][j]);
        maxDelta = Math.max(maxDelta, Math.abs(nv - callF[s][o][j]));
        callF[s][o][j] = nv;
      }
    }
    for (const s of SEATS) {
      for (let i = 0; i < N; i++) {
        const br = evJam(i, s, D, callF) > 0 ? 1 : 0;
        const nv = jamF[s][i] + ALPHA * (br - jamF[s][i]);
        maxDelta = Math.max(maxDelta, Math.abs(nv - jamF[s][i]));
        jamF[s][i] = nv;
      }
    }
  }
  // store per-hand jam EVs (vs converged call freqs) + BB call EVs vs early/late buckets
  result.jam[D] = {}; result.jamPct[D] = {}; result.callBB[D] = {}; result.callBBPct[D] = {};
  for (const s of SEATS) {
    result.jam[D][s] = {};
    const set = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      const ev = evJam(i, s, D, callF);
      result.jam[D][s][L[i]] = +ev.toFixed(2);
      set[i] = ev > 0;
    }
    result.jamPct[D][s] = +jamPct(set).toFixed(1);
  }
  // per-SEAT BB call EVs — the drill names the jammer, so grade vs that seat's
  // actual jam range (bucket averages let the SB's huge range distort BTN spots)
  result.callBBSeat = result.callBBSeat || {};
  result.callBBSeat[D] = {};
  for (const s of SEATS) {
    const freq = new Float64Array(N);
    for (let i = 0; i < N; i++) if (result.jam[D][s][L[i]] > 0) freq[i] = 1;
    result.callBBSeat[D][s] = {};
    for (let j = 0; j < N; j++) {
      let tw = 0, eqw = 0;
      for (let i = 0; i < N; i++) { if (!freq[i]) continue; const w = combosOf(i, j); tw += w; eqw += w * EQ[j][i]; }
      const pot = 2 * D + (DEAD - POSTED[s] - 1);
      result.callBBSeat[D][s][L[j]] = tw ? +(eqw / tw * pot - D + 1).toFixed(2) : -D;
    }
  }
  for (const bucket of [['early', ['EP', 'MP']], ['late', ['CO', 'BTN', 'SB']]]) {
    const [name, seats] = bucket;
    const freq = new Float64Array(N);
    seats.forEach(s => { for (let i = 0; i < N; i++) if (result.jam[D][s][L[i]] > 0) freq[i] += 1 / seats.length; });
    result.callBB[D][name] = {};
    let cc = 0, tt = 0;
    for (let j = 0; j < N; j++) {
      let tw = 0, eqw = 0;
      for (let i = 0; i < N; i++) { if (!freq[i]) continue; const w = combosOf(i, j) * freq[i]; tw += w; eqw += w * EQ[j][i]; }
      const pot = 2 * D + (DEAD - 0 - 1);            // generic jammer (no post) vs BB
      const ev = tw ? +(eqw / tw * pot - D + 1).toFixed(2) : -D;
      result.callBB[D][name][L[j]] = ev;
      tt += W[j]; if (ev > 0) cc += W[j];
    }
    result.callBBPct[D][name] = +(100 * cc / tt).toFixed(1);
  }
}

// ---- report vs the current hand-tuned tables ----
const OLD_JAM = { EP: { 8: 16, 12: 11, 15: 8.5, 20: 6.5 }, MP: { 8: 22, 12: 15, 15: 11.5, 20: 8.5 }, CO: { 8: 33, 12: 23, 15: 17.5, 20: 13 }, BTN: { 8: 50, 12: 37, 15: 28, 20: 20 }, SB: { 8: 55, 12: 45, 15: 37, 20: 28 } };
console.log('\n=== SOLVED jam % (old hand-tuned in parens) ===');
for (const D of DEPTHS) {
  console.log('  ' + D + 'bb: ' + SEATS.map(s => s + ' ' + result.jamPct[D][s] + '%' + (OLD_JAM[s][D] != null ? ' (' + OLD_JAM[s][D] + ')' : '')).join('  '));
}
console.log('\n=== SOLVED BB call % vs jam (old CALL table: late 8bb 25/12bb 17/15bb 13/20bb 10; early 13/9/7/5.5) ===');
for (const D of DEPTHS) console.log('  ' + D + 'bb: early ' + result.callBBPct[D].early + '%  late ' + result.callBBPct[D].late + '%');
console.log('\n=== example boundary hands (12bb) ===');
for (const s of ['EP', 'BTN', 'SB']) {
  const evs = result.jam[12][s];
  const close = L.filter(h => Math.abs(evs[h]) < 0.15).slice(0, 8);
  console.log('  ' + s + ' 12bb mixed/boundary: ' + close.join(' '));
}

fs.writeFileSync(path.join(__dirname, 'nash_result.json'), JSON.stringify(result));
// app artifact
const js = '// generated by tools/solve/pushfold.js — approximate-Nash push/fold EVs (bb).\n' +
  '// MTT pot (SB+BB+ante=2.5bb dead), single-caller model, class-level blockers.\n' +
  'window.NASH = ' + JSON.stringify(result) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'app', 'nash.js'), js);
console.log('\nwrote tools/app/nash.js + tools/solve/nash_result.json');
