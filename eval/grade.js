'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — grade.js
   Fills in actualHR on logged predictions by reading real MLB box scores.

   For each date that still has ungraded rows, it pulls that day's final
   box scores and marks each predicted player:
       1  = homered that day
       0  = appeared (had a plate appearance) but didn't homer
       null = did NOT appear (sat / scratched) -> left ungraded, so a benched
              guy never gets a misleading 0.

   Idempotent and resumable: only touches rows where actualHR is null, so you
   can run it daily (grade yesterday) or re-run to backfill the whole log.

     usage:  node eval/grade.js            # grade all ungraded past dates
             node eval/grade.js --date=2026-06-21
   ══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PRED_PATH = path.join(__dirname, 'predictions.jsonl');
const MLB = 'https://statsapi.mlb.com/api/v1';
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

async function getJSON(url){
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 15000);
  try { const r = await fetch(url, { signal: ctrl.signal }); if(!r.ok) throw new Error(r.status+' '+url); return await r.json(); }
  finally { clearTimeout(t); }
}
async function mapPool(items, n, fn){
  const q = items.slice(), workers = [];
  for(let i=0;i<Math.min(n,q.length);i++) workers.push((async()=>{ while(q.length) await fn(q.shift()); })());
  await Promise.all(workers);
}

// For one date -> {played:Set<id>, hr:Set<id>} from final box scores.
async function outcomesForDate(date){
  const played = new Set(), hr = new Set();
  const sched = await getJSON(`${MLB}/schedule?sportId=1&date=${date}`);
  const games = (sched.dates?.[0]?.games || []).filter(g =>
    /final|completed/i.test(g.status?.abstractGameState || g.status?.detailedState || ''));
  if(!games.length) return { played, hr, gameCount: 0 };
  await mapPool(games, 6, async g => {
    try {
      const box = await getJSON(`${MLB}/game/${g.gamePk}/boxscore`);
      for(const side of ['home','away']){
        const players = box.teams?.[side]?.players || {};
        for(const key of Object.keys(players)){
          const b = players[key]?.stats?.batting; if(!b) continue;
          const id = players[key]?.person?.id; if(id==null) continue;
          const pa = +(b.plateAppearances||0), ab = +(b.atBats||0), homers = +(b.homeRuns||0);
          if(pa>0 || ab>0) played.add(id);
          if(homers>0) hr.add(id);
        }
      }
    } catch(e){ /* one game failing just leaves its players ungraded */ }
  });
  return { played, hr, gameCount: games.length };
}

async function main(){
  if(!fs.existsSync(PRED_PATH)){ console.error('[grade] no predictions.jsonl found'); process.exit(1); }
  const onlyDate = (process.argv.find(a=>a.startsWith('--date'))||'').split('=')[1] || null;

  const rows = fs.readFileSync(PRED_PATH,'utf8').split('\n').filter(Boolean).map(JSON.parse);

  // Which dates need grading? Past dates only (today's games aren't final yet).
  const dates = [...new Set(rows
    .filter(r => r.actualHR==null && typeof r.id==='number' && r.date < TODAY && (!onlyDate || r.date===onlyDate))
    .map(r => r.date))].sort();

  if(!dates.length){ console.log('[grade] nothing to grade (no past ungraded numeric-id rows).'); return; }
  console.log(`[grade] grading ${dates.length} date(s): ${dates[0]} .. ${dates[dates.length-1]}`);

  let graded=0, homers=0;
  for(const date of dates){
    let res;
    try { res = await outcomesForDate(date); }
    catch(e){ console.log(`  ${date}: schedule fetch failed, skipping (${e.message})`); continue; }
    if(!res.gameCount){ console.log(`  ${date}: no final games found, skipping`); continue; }
    let d=0,h=0,sat=0;
    for(const r of rows){
      if(r.date!==date || r.actualHR!=null || typeof r.id!=='number') continue;
      if(res.hr.has(r.id)){ r.actualHR=1; d++; h++; }
      else if(res.played.has(r.id)){ r.actualHR=0; d++; }
      else { sat++; } // didn't appear -> stays null
    }
    graded+=d; homers+=h;
    console.log(`  ${date}: ${res.gameCount} games · graded ${d} (${h} HR) · ${sat} didn't appear`);
  }

  fs.writeFileSync(PRED_PATH, rows.map(r=>JSON.stringify(r)).join('\n') + '\n');
  console.log(`[grade] done. graded ${graded} rows, ${homers} home runs. base rate ${graded?(100*homers/graded).toFixed(1):'0'}%`);
}

main().catch(e=>{ console.error('[grade] FAILED:', e); process.exit(1); });
