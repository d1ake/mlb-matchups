'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — record.js   (run once per day, by the daily workflow)
   Snapshots today's predictions (one row per rostered hitter) into
   eval/predictions.jsonl so they can be graded against real HR outcomes later.

   Predictions CANNOT be reconstructed after the fact (the model's inputs change
   as season stats update), so this must run every day to build a sample.
   Outcomes start null and get filled in later by grade.js.

   Standalone: reads the live data.js + app.js, runs the REAL score(), so the
   recorded rating always matches what ships. No dependency on the model internals.
   ══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRED_PATH = path.join(__dirname, 'predictions.jsonl');

// Load the production data + scorer without modifying or duplicating them.
const data = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
const app  = fs.readFileSync(path.join(ROOT, 'app.js'),  'utf8');
global.document = { addEventListener() {} };   // app.js registers a DOM handler at load
global.window = {};
let M;
try {
  (0, eval)(
    data + '\n' + app +
    '\n;globalThis.__bq={PLAYERS,ROSTER:(typeof ROSTER!=="undefined"?ROSTER:[]),DATA_DATE,score};'
  );
  M = globalThis.__bq;
} finally {
  delete globalThis.__bq; delete global.document; delete global.window;
}

const date = M.DATA_DATE;
// Record the full roster when available (best for calibration), else the cards.
const slate = (M.ROSTER && M.ROSTER.length ? M.ROSTER : M.PLAYERS).filter(p => p.playingToday);

const recs = slate.map(p => {
  const rating = M.score(p);                 // the REAL production score()
  return {
    date,
    id: p.id, name: p.name, team: p.team, venue: p.venue, game: p.game,
    pitcher: p.pitcher, hand: p.hand, pitcherHand: p.pitcherHand,
    rating,
    modelProb: +Math.max(0, Math.min(1, rating / 100)).toFixed(4), // naive map; calibrate later
    actualHR: null,                          // filled by grade.js once games are final
  };
});

// Append-only log, idempotent per date (re-running a date replaces its rows).
let kept = [];
if (fs.existsSync(PRED_PATH)) {
  kept = fs.readFileSync(PRED_PATH, 'utf8').split('\n').filter(Boolean)
    .map(JSON.parse).filter(r => r.date !== date);
}
fs.writeFileSync(PRED_PATH, [...kept, ...recs].map(r => JSON.stringify(r)).join('\n') + '\n');

console.log(`[record] ${recs.length} predictions for ${date} -> ${PRED_PATH}`);
console.log(`[record] log now holds ${kept.length + recs.length} rows across all dates`);
