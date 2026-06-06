'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — record.js
   Capture the model's outputs (one record per player/game) into a growing
   prediction log, eval/predictions.jsonl. Run this for each daily slate.

   Idempotent per snapshot date: re-running replaces that date's rows so you
   never get duplicates. Outcomes start null and are filled in later (via
   eval/outcomes.json or by editing actualHR) once the games are final.

     usage:  node eval/record.js
   ══════════════════════════════════════════════════════════════════════ */
const {
  loadModel, impliedFromOdds, ratingToProb, readPredictions, writePredictions, PRED_PATH,
} = require('./lib');

const m = loadModel();
const date = m.DATA_DATE;
const slate = m.PLAYERS.filter(p => p.playingToday);

const recs = slate.map(p => {
  const rating = m.score(p); // the REAL production score()
  return {
    date,
    id: p.id, name: p.name, team: p.team, venue: p.venue, game: p.game,
    pitcher: p.pitcher, hand: p.hand, pitcherHand: p.pitcherHand,
    rating,
    modelProb: +ratingToProb(rating).toFixed(4),       // eval-only rating->prob map
    marketOdds: p.fdOdds != null ? p.fdOdds : null,
    marketImplied: p.fdOdds != null ? +impliedFromOdds(p.fdOdds).toFixed(4) : null,
    actualHR: null, // fill in once known (or via eval/outcomes.json keyed "<date>:<id>")
  };
});

const kept = readPredictions().filter(r => r.date !== date); // drop prior rows for this date
writePredictions([...kept, ...recs]);

console.log(`Recorded ${recs.length} predictions for ${date} -> ${PRED_PATH}`);
console.log('rank  rating  modelP   mktImpl  player');
recs.slice().sort((a, b) => b.rating - a.rating).forEach((r, i) => {
  console.log(
    String(i + 1).padStart(3), ' ',
    String(r.rating).padStart(5), ' ',
    (r.modelProb * 100).toFixed(1).padStart(5) + '%', ' ',
    (r.marketImplied != null ? (r.marketImplied * 100).toFixed(1) + '%' : '   n/a').padStart(6), ' ',
    r.name,
  );
});
