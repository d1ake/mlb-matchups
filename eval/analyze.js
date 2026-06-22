'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — analyze.js
   The actual test: do higher-rated players homer more than lower-rated ones?
   Reads graded predictions.jsonl and reports the REAL home-run rate within
   each rating band, plus a quick calibration read (model says vs actually did).

     usage:  node eval/analyze.js
   ══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const PRED_PATH = path.join(__dirname, 'predictions.jsonl');

const rows = fs.readFileSync(PRED_PATH, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter(r => r.actualHR === 0 || r.actualHR === 1);   // graded only

if (!rows.length) { console.log('No graded rows yet. Run eval/grade.js first.'); process.exit(0); }

const N = rows.length;
const HR = rows.reduce((s, r) => s + r.actualHR, 0);
const base = HR / N;

console.log(`\nGRADED SAMPLE: ${N} player-games, ${HR} home runs, base rate ${(100*base).toFixed(1)}%`);
console.log('='.repeat(72));

// ── HR rate by rating band ─────────────────────────────────────────────
const bands = [[0,20],[20,30],[30,40],[40,50],[50,200]];
console.log('\nHR RATE BY MODEL RATING  (does the rate climb with the rating?)');
console.log('  band        n      HR    actual%   model~%   lift vs base');
let prev = null, monotone = true;
for (const [lo, hi] of bands) {
  const g = rows.filter(r => r.rating >= lo && r.rating < hi);
  if (!g.length) continue;
  const hr = g.reduce((s, r) => s + r.actualHR, 0);
  const rate = hr / g.length;
  const modelMean = g.reduce((s, r) => s + r.rating, 0) / g.length; // avg rating in band
  const lift = rate / base;
  if (prev !== null && rate < prev - 1e-9) monotone = false;
  prev = rate;
  console.log(
    `  ${String(lo).padStart(2)}-${String(hi===200?'+':hi).padEnd(3)}  ` +
    `${String(g.length).padStart(5)}  ${String(hr).padStart(5)}   ` +
    `${(100*rate).toFixed(1).padStart(6)}%   ${modelMean.toFixed(0).padStart(5)}%   ` +
    `${lift.toFixed(2)}x`
  );
}

// ── Decile-style top vs bottom (cleaner signal check) ──────────────────
const sorted = rows.slice().sort((a, b) => b.rating - a.rating);
const cut = Math.max(1, Math.floor(N * 0.2));
const top = sorted.slice(0, cut), bot = sorted.slice(-cut);
const rOf = a => a.reduce((s, r) => s + r.actualHR, 0) / a.length;
const topR = rOf(top), botR = rOf(bot);

console.log('\nTOP 20% vs BOTTOM 20% BY RATING');
console.log(`  top 20%  (avg rating ${(top.reduce((s,r)=>s+r.rating,0)/top.length).toFixed(0)}): ${(100*topR).toFixed(1)}% homered`);
console.log(`  bottom 20% (avg rating ${(bot.reduce((s,r)=>s+r.rating,0)/bot.length).toFixed(0)}): ${(100*botR).toFixed(1)}% homered`);
console.log(`  ratio: ${(topR/botR).toFixed(2)}x  ${topR>botR ? '(higher-rated homer more — signal)' : '(no separation — likely noise)'}`);

// ── Calibration headline ───────────────────────────────────────────────
const meanRating = rows.reduce((s, r) => s + r.rating, 0) / N;
console.log('\nCALIBRATION (scale check)');
console.log(`  model's average rating: ${meanRating.toFixed(0)} (reads like ${meanRating.toFixed(0)}% implied)`);
console.log(`  players' actual HR rate: ${(100*base).toFixed(1)}%`);
console.log(`  -> the rating runs about ${(meanRating/(100*base)).toFixed(1)}x hotter than reality;`);
console.log(`     a calibrated map would scale a ${meanRating.toFixed(0)} down to roughly ${(100*base).toFixed(0)}%.`);

console.log('\nREAD: separation between bands = signal; flat = noise.');
console.log(`Monotonic climb across bands: ${monotone ? 'YES' : 'no (some bands out of order)'} — but ${N} rows over ~2 weeks is a FIRST look, not a verdict.\n`);
