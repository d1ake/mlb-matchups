'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — evaluate.js
   Grade recorded predictions against actual home-run outcomes and report:
     • observed base rate
     • Brier score for the MODEL vs the MARKET-implied baseline vs climatology
     • Brier Skill Scores (model vs each reference)
     • Expected Calibration Error
     • reliability (calibration) curves for model and market

   Outcomes come from (in priority order):
     1. actualHR set on a prediction row, else
     2. eval/outcomes.json, keyed "<date>:<id>" -> 1 (homered) / 0 (did not)

     usage:
       node eval/evaluate.js          # real outcomes only
       node eval/evaluate.js --demo   # fill MISSING outcomes with SYNTHETIC
                                      # seeded draws so the full report renders.
   ══════════════════════════════════════════════════════════════════════ */
const {
  readPredictions, readOutcomes, brier, reliability, ece, brierSkill,
} = require('./lib');

const DEMO = process.argv.includes('--demo');

// Seeded PRNG (mulberry32) — reproducible demo outcomes.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const preds = readPredictions();
if (!preds.length) {
  console.error('No predictions found. Run:  node eval/record.js');
  process.exit(1);
}

const outcomes = readOutcomes();
const rnd = mulberry32(0x42BA11); // fixed seed
let synth = 0;

const rows = [];
for (const r of preds) {
  let o = r.actualHR;
  if (o == null) {
    const k = `${r.date}:${r.id}`;
    if (k in outcomes && outcomes[k] != null) o = outcomes[k];
  }
  if (o == null && DEMO && r.marketImplied != null) { o = rnd() < r.marketImplied ? 1 : 0; synth++; }
  if (o == null) continue;
  rows.push({ ...r, o, modelP: r.modelProb, mktP: r.marketImplied });
}

const N = rows.length;
console.log(
  `\nBarrelIQ evaluation  —  ${N} graded prediction(s)` +
  (DEMO ? `  [${synth} SYNTHETIC demo outcomes]` : '') +
  `\n` + '='.repeat(66),
);
if (!N) {
  console.log('No graded outcomes yet. Either:');
  console.log('  • set "actualHR" on rows in eval/predictions.jsonl, or');
  console.log('  • add "<date>:<id>": 0|1 entries to eval/outcomes.json, or');
  console.log('  • run "node eval/evaluate.js --demo" to see the report on synthetic data.');
  process.exit(0);
}
if (DEMO) {
  console.log('NOTE: demo outcomes are sampled from the market-implied probabilities,');
  console.log('      so the market baseline is favored by construction. Use real');
  console.log('      outcomes to actually judge the model. (Pipeline demonstration only.)\n');
}

const hrCount = rows.reduce((s, r) => s + r.o, 0);
const baseRate = hrCount / N;
const rowsMkt = rows.filter(r => r.mktP != null);
const rowsClim = rows.map(r => ({ ...r, clim: baseRate }));

const bModel = brier(rows, 'modelP');
const bMkt = brier(rowsMkt, 'mktP');
const bClim = brier(rowsClim, 'clim');

console.log(`Observed HR rate (base rate): ${pct(baseRate)}  (${hrCount} of ${N})\n`);

console.log('Brier score  (0 = perfect, lower is better):');
console.log(`  Model  (rating -> prob)    : ${bModel.toFixed(4)}`);
console.log(`  Market implied (baseline)  : ${bMkt != null ? bMkt.toFixed(4) : 'n/a'}   (n=${rowsMkt.length})`);
console.log(`  Climatology (predict base) : ${bClim.toFixed(4)}\n`);

console.log('Brier Skill Score  (BSS = 1 - Brier/ref;  >0 beats the reference):');
console.log(`  Model  vs Market       : ${fmt(brierSkill(bModel, bMkt))}`);
console.log(`  Model  vs Climatology  : ${fmt(brierSkill(bModel, bClim))}`);
console.log(`  Market vs Climatology  : ${fmt(brierSkill(bMkt, bClim))}\n`);

console.log(`Expected Calibration Error (lower is better):`);
console.log(`  Model : ${pct(ece(rows, 'modelP'))}`);
console.log(`  Market: ${pct(ece(rowsMkt, 'mktP'))}`);

printCurve('MODEL reliability curve', rows, 'modelP');
printCurve('MARKET reliability curve', rowsMkt, 'mktP');
console.log('\nIn a well-calibrated curve, observed% (█) tracks predicted% (•) down the diagonal.');

/* ── formatting helpers (hoisted) ──────────────────────────────────────── */
function fmt(x) { return x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(3); }
function pct(x) { return x == null ? 'n/a' : (x * 100).toFixed(1) + '%'; }
function printCurve(title, rs, key) {
  const W = 40;
  console.log(`\n${title}  (n=${rs.length})`);
  console.log('  prob bin     n   pred%   obs%   reliability  [pred=•  obs=█]');
  reliability(rs, key, 10).forEach(b => {
    if (!b.n) return;
    const pred = Math.min(W - 1, Math.round(b.meanP * W));
    const obs = Math.min(W - 1, Math.round(b.obs * W));
    let bar = '';
    for (let i = 0; i < W; i++) {
      bar += (i === obs && i === pred) ? '╫' : i === obs ? '█' : i === pred ? '•' : '·';
    }
    console.log(
      '  ' + b.range.padEnd(9),
      String(b.n).padStart(3), ' ',
      ((b.meanP * 100).toFixed(0) + '%').padStart(5), ' ',
      ((b.obs * 100).toFixed(0) + '%').padStart(5), ' ',
      bar,
    );
  });
}
