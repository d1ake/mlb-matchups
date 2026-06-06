'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — EVALUATION LAYER (shared utilities)

   This module is READ-ONLY with respect to the scoring model. It loads the
   REAL score() from app.js (with a tiny document stub) instead of copying it,
   so the evaluation can never silently drift from what ships in production.

   IMPORTANT: the model emits a 0-100 RATING, not a probability. To compute
   Brier scores / calibration we need a probability, so this eval layer owns a
   swappable rating->probability mapping (ratingToProb below). That mapping is
   part of the evaluation, NOT the scoring model. The reliability curve is
   precisely what reveals whether the chosen mapping is calibrated.
   ══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRED_PATH = path.join(__dirname, 'predictions.jsonl');
const OUTCOMES_PATH = path.join(__dirname, 'outcomes.json');

/* ── Load the production model without modifying or duplicating it ──────── */
function loadModel() {
  const data = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  // app.js registers a DOMContentLoaded handler at load time — stub it out.
  global.document = { addEventListener() {} };
  try {
    // Indirect eval runs the two files in one shared scope; the trailing line
    // captures the consts/functions we need onto globalThis so we can read them.
    (0, eval)(
      data + '\n' + app +
      '\n;globalThis.__bq={PLAYERS,PF,WX,DATA_DATE,score,adjPF,vigImp,valScore};'
    );
  } finally {
    delete global.document;
  }
  const m = globalThis.__bq;
  delete globalThis.__bq;
  return m;
}

/* ── Probability helpers (EVAL-ONLY; not part of the scoring model) ─────── */

// American odds -> implied probability. NOTE: this includes the book's vig, so
// it is slightly inflated vs the "fair" probability. Devigging a single yes/no
// prop needs the NO-side odds, which we don't store, so we use raw implied as a
// transparent, standard baseline.
function impliedFromOdds(am) {
  return am > 0 ? 100 / (am + 100) : Math.abs(am) / (Math.abs(am) + 100);
}

// Map the 0-100 Rating to a probability for scoring purposes.
// DEFAULT = naive linear reading (rating/100). The rating is NOT a calibrated
// probability; expect the reliability curve to show over-prediction. Swap this
// function (e.g. for a fitted logistic/isotonic map) to test better mappings —
// without ever touching the scoring model.
function ratingToProb(rating) {
  return Math.max(0, Math.min(1, rating / 100));
}

/* ── Metrics ───────────────────────────────────────────────────────────── */

// Brier score = mean squared error between probability and {0,1} outcome.
function brier(rows, key) {
  if (!rows.length) return null;
  return rows.reduce((s, r) => s + Math.pow(r[key] - r.o, 2), 0) / rows.length;
}

// Reliability table: bin predictions, report mean predicted vs observed rate.
function reliability(rows, key, nbins = 10) {
  const bins = Array.from({ length: nbins }, (_, i) => (
    { lo: i / nbins, hi: (i + 1) / nbins, n: 0, sumP: 0, sumO: 0 }
  ));
  rows.forEach(r => {
    let idx = Math.floor(r[key] * nbins);
    if (idx < 0) idx = 0;
    if (idx > nbins - 1) idx = nbins - 1;
    const b = bins[idx];
    b.n++; b.sumP += r[key]; b.sumO += r.o;
  });
  return bins.map(b => ({
    range: `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,
    n: b.n,
    meanP: b.n ? b.sumP / b.n : null,
    obs: b.n ? b.sumO / b.n : null,
  }));
}

// Expected Calibration Error = sum_b (n_b/N) * |obs_b - pred_b|.
function ece(rows, key, nbins = 10) {
  const N = rows.length;
  if (!N) return null;
  return reliability(rows, key, nbins)
    .reduce((s, b) => (b.n ? s + (b.n / N) * Math.abs(b.obs - b.meanP) : s), 0);
}

// Brier Skill Score = 1 - Brier_model / Brier_reference. >0 means model beats ref.
function brierSkill(model, ref) {
  return (model == null || ref == null || ref === 0) ? null : 1 - model / ref;
}

/* ── IO ────────────────────────────────────────────────────────────────── */
function readPredictions() {
  if (!fs.existsSync(PRED_PATH)) return [];
  return fs.readFileSync(PRED_PATH, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}
function writePredictions(recs) {
  fs.writeFileSync(PRED_PATH, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
}
function readOutcomes() {
  if (!fs.existsSync(OUTCOMES_PATH)) return {};
  return JSON.parse(fs.readFileSync(OUTCOMES_PATH, 'utf8'));
}

module.exports = {
  loadModel, impliedFromOdds, ratingToProb,
  brier, reliability, ece, brierSkill,
  readPredictions, writePredictions, readOutcomes,
  PRED_PATH, OUTCOMES_PATH,
};
