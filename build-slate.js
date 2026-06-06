'use strict';
/* ══════════════════════════════════════════════════════════════════════
   BarrelIQ — build-slate.js
   Regenerates data.js for TODAY from live, free sources:
     • MLB Stats API  — today's games + probable pitchers + bat/throw hands
                        + last-10 game logs + batter-vs-pitcher history
     • Baseball Savant — season Statcast (barrel%, EV, xwOBA, HR) for hitters,
                        pitcher HR context, and probable-pitcher arsenals
     • Open-Meteo     — today's weather per home park (free, no key)

   It writes ONLY data inputs (DATA_DATE, PF, WX, PLAYERS). The 0-100 rating is
   still computed at runtime by score() in app.js, so the scoring model is never
   touched or duplicated here.

   What is REAL vs DERIVED (kept honest on purpose):
     REAL    : barrel%, EV, xwOBA, HR-rate, season HR, pitcher HR/9, pitch
               arsenal usage, park factor, weather, last-10, batter-vs-pitcher.
     DERIVED : the "Analysis" note + targeting text are auto-summaries of the
               real numbers (not hand-scouted).
     OMITTED : per-pitch batter split table (not in any free feed) and FanDuel
               odds (paid). Cards render without them.

     usage:  node build-slate.js                 # live build for today
             node build-slate.js --date=2026-06-06
             node build-slate.js --fixture=eval-build/fixtures.json   # offline test
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const SEASON = 2026;
const HITTERS_PER_TEAM = 3;     // top N power bats per playing team
const MAX_PLAYERS = 40;         // overall cap (ranked by barrel%) to keep the page tidy
const MIN_PA = 50;              // qualifier floor for Statcast reliability
const OUT_PATH = path.resolve(__dirname, 'data.js');

/* ── Static reference tables ──────────────────────────────────────────── */
// Park factors are stable season-to-season; carried as curated constants.
const PF = {
  CIN:{name:"Great American Ball Park",f:122,tier:"elite",notes:"#1 HR park. Short porches, hot summers."},
  COL:{name:"Coors Field",f:130,tier:"elite",notes:"5,280ft altitude. ~30% more HRs vs neutral park."},
  TEX:{name:"Globe Life Field",f:114,tier:"elite",notes:"Retractable roof traps heat. RF porch helps LHBs."},
  PHI:{name:"Citizens Bank Park",f:112,tier:"elite",notes:"Wind tunnel, short RF (330ft). Best LHB HR park in NL East."},
  NYY:{name:"Yankee Stadium",f:110,tier:"elite",notes:"Short RF porch (314ft). Elite for RHB pull power vs LHP."},
  CHC:{name:"Wrigley Field",f:107,tier:"good",notes:"Wind-dependent. Can swing from elite to pitcher-friendly."},
  LAD:{name:"Dodger Stadium",f:108,tier:"good",notes:"Warm nights, 300ft ASL. Consistent HR boost."},
  ARI:{name:"Chase Field",f:108,tier:"good",notes:"Desert air at 1,100ft. Roof often open nights."},
  ATH:{name:"Sutter Health Park",f:108,tier:"good",notes:"Elevated terrain, hitter-friendly."},
  BAL:{name:"Camden Yards",f:105,tier:"good",notes:"Short RF (318ft). Strong for LHBs pulling."},
  MIL:{name:"American Family Field",f:104,tier:"good",notes:"Retractable roof, consistent conditions."},
  WSH:{name:"Nationals Park",f:104,tier:"good",notes:"Moderate HR boost, good for RHB pull."},
  BOS:{name:"Fenway Park",f:103,tier:"good",notes:"RF wall 302ft — great for LHB pull power."},
  TOR:{name:"Rogers Centre",f:103,tier:"good",notes:"Dome = consistent conditions, slight hitter lean."},
  HOU:{name:"Daikin Park",f:99,tier:"neutral",notes:"AC when closed = dense air. Near-neutral."},
  STL:{name:"Busch Stadium",f:101,tier:"neutral",notes:"Hot summers carry balls slightly. Near-neutral."},
  PIT:{name:"PNC Park",f:101,tier:"neutral",notes:"Near-neutral HR factor."},
  MIN:{name:"Target Field",f:102,tier:"neutral",notes:"Near-neutral, slight RHB RF advantage."},
  CLE:{name:"Progressive Field",f:99,tier:"neutral",notes:"Near-neutral. Large foul territory."},
  KC:{name:"Kauffman Stadium",f:97,tier:"neutral",notes:"Large gaps, near-neutral."},
  TB:{name:"Tropicana Field",f:99,tier:"neutral",notes:"Dome. Near-neutral HR factor."},
  MIA:{name:"loanDepot Park",f:98,tier:"neutral",notes:"AC dome, dense air. Slightly pitcher-friendly."},
  NYM:{name:"Citi Field",f:98,tier:"neutral",notes:"Deep alleys, sea breeze. Slight pitcher lean."},
  LAA:{name:"Angel Stadium",f:97,tier:"neutral",notes:"Near-neutral. Marine layer some nights."},
  ATL:{name:"Truist Park",f:101,tier:"neutral",notes:"Warm but humid. Near-neutral."},
  CWS:{name:"Rate Field",f:102,tier:"neutral",notes:"Slight LHB advantage. Near-neutral."},
  DET:{name:"Comerica Park",f:96,tier:"bad",notes:"Cavernous outfield. Among worst HR parks."},
  SF:{name:"Oracle Park",f:96,tier:"bad",notes:"Marine layer. Deep alleys. Very tough."},
  SEA:{name:"T-Mobile Park",f:88,tier:"bad",notes:"Deepest park + marine air = hardest HR park in MLB."},
  SD:{name:"Petco Park",f:94,tier:"bad",notes:"Marine layer, deep fences. One of MLB's worst."}
};

// Home-park coordinates + dome flag (dome => weather is neutral).
const PARK = {
  NYY:[40.829,-73.926,0], BOS:[42.346,-71.097,0], TOR:[43.641,-79.389,1], BAL:[39.284,-76.621,0], TB:[27.768,-82.653,1],
  CLE:[41.496,-81.685,0], DET:[42.339,-83.048,0], MIN:[44.982,-93.278,0], CWS:[41.830,-87.634,0], KC:[39.051,-94.480,0],
  HOU:[29.757,-95.355,1], TEX:[32.747,-97.082,1], LAA:[33.800,-117.883,0], ATH:[38.580,-121.513,0], SEA:[47.591,-122.332,0],
  ATL:[33.890,-84.468,0], PHI:[39.906,-75.166,0], NYM:[40.757,-73.846,0], WSH:[38.873,-77.007,0], MIA:[25.778,-80.220,1],
  MIL:[43.028,-87.971,1], CHC:[41.948,-87.655,0], CIN:[39.097,-84.507,0], PIT:[40.447,-80.006,0], STL:[38.622,-90.193,0],
  LAD:[34.074,-118.240,0], SD:[32.707,-117.157,0], SF:[37.778,-122.389,0], ARI:[33.445,-112.067,1], COL:[39.756,-104.994,0]
};

// MLB full name -> your abbreviation convention (matches PF/WX/PLAYERS keys).
const ABBR = {
  "Arizona Diamondbacks":"ARI","Atlanta Braves":"ATL","Baltimore Orioles":"BAL","Boston Red Sox":"BOS",
  "Chicago Cubs":"CHC","Chicago White Sox":"CWS","Cincinnati Reds":"CIN","Cleveland Guardians":"CLE",
  "Colorado Rockies":"COL","Detroit Tigers":"DET","Houston Astros":"HOU","Kansas City Royals":"KC",
  "Los Angeles Angels":"LAA","Los Angeles Dodgers":"LAD","Miami Marlins":"MIA","Milwaukee Brewers":"MIL",
  "Minnesota Twins":"MIN","New York Mets":"NYM","New York Yankees":"NYY","Philadelphia Phillies":"PHI",
  "Pittsburgh Pirates":"PIT","San Diego Padres":"SD","San Francisco Giants":"SF","Seattle Mariners":"SEA",
  "St. Louis Cardinals":"STL","Tampa Bay Rays":"TB","Texas Rangers":"TEX","Toronto Blue Jays":"TOR",
  "Washington Nationals":"WSH","Athletics":"ATH","Oakland Athletics":"ATH","Sacramento Athletics":"ATH"
};

const PITCH_COLOR = {
  "4-Seam":"#22c97a","4-Seam Fastball":"#22c97a","Sinker":"#4a9eff","Cutter":"#4a9eff",
  "Slider":"#e84040","Sweeper":"#e84040","Curveball":"#e8a320","Knuckle Curve":"#e8a320",
  "Changeup":"#a78bfa","Splitter":"#a78bfa","Slurve":"#ff7340","Other":"#7a8394"
};
const pitchColor = n => PITCH_COLOR[n] || "#7a8394";

/* ── Small helpers ────────────────────────────────────────────────────── */
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const round = (v,d=1) => v==null ? null : Math.round(v*10**d)/10**d;
const compass = deg => ["N","NE","E","SE","S","SW","W","NW"][Math.round(((deg||0)%360)/45)%8];

// Minimal CSV parser (handles quoted fields with commas).
function parseCSV(text){
  const rows=[]; let i=0, field='', row=[], q=false;
  const pushF=()=>{row.push(field);field='';};
  const pushR=()=>{rows.push(row);row=[];};
  while(i<text.length){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=c; }
    else { if(c==='"')q=true; else if(c===',')pushF(); else if(c==='\n'){pushF();pushR();} else if(c!=='\r')field+=c; }
    i++;
  }
  if(field.length||row.length){pushF();pushR();}
  const header=rows.shift()||[];
  return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(header.map((h,idx)=>[h.trim(),(r[idx]||'').trim()])));
}

/* ══════════════════════════════════════════════════════════════════════
   PURE TRANSFORM  (no network — fully unit-testable)
   inputs = {
     date, games:[{awayAbbr,homeAbbr,venue,
        home:{prob:{id,name,hand,hr9,arsenal:[{n,p}]}},
        away:{prob:{...}}}],
     batters:[{id,name,teamAbbr,hand,barrel,ev,xwoba,hr,pa}],
     weatherByPark:{ABBR:{temp,wind,windDeg,rain,dome}},
     l10ById:{id:{avg,hr,games}}, bvpById:{id:{pa,avg,hr}}
   }
   ══════════════════════════════════════════════════════════════════════ */
function assembleData(inputs){
  const { date, games, batters, weatherByPark={}, l10ById={}, bvpById={} } = inputs;

  // Home parks hosting today -> WX (renderParks reads Object.keys(WX) as "today").
  const WX = {};
  for(const g of games){
    const k=g.homeAbbr, w=weatherByPark[k]||{};
    if(w.dome || (PARK[k]&&PARK[k][2]===1)){
      WX[k]={temp:w.temp??72,wind:0,windDir:"—",rain:0,dome:true,impact:"dome",impactMod:0,
             desc:`${PF[k]?.name||k} roof closed — controlled indoor conditions.`,tag:"🏟 Dome"};
      continue;
    }
    const temp=w.temp??70, wind=Math.round(w.wind??6), rain=Math.round(w.rain??0);
    let mod=0;
    if(temp>=92)mod+=3; else if(temp>=85)mod+=2; else if(temp<=55)mod-=3; else if(temp<=62)mod-=2;
    if(wind>=12)mod+=1; if(rain>=60)mod-=1;
    mod=Math.max(-4,Math.min(4,mod));
    const impact=mod>=2?"boost":mod<=-2?"suppress":"neutral";
    const dir=compass(w.windDeg);
    WX[k]={temp,wind,windDir:dir,rain,dome:false,impact,impactMod:mod,
      desc:`${temp}°F, ${wind}mph ${dir} wind, ${rain}% rain. ${impact==="boost"?"Conditions aid carry.":impact==="suppress"?"Conditions suppress carry.":"Near-neutral conditions."}`,
      tag:`${impact==="boost"?"🔥":impact==="suppress"?"❄️":"💨"} ${temp}° ${dir}`};
  }

  // Index probable pitcher faced by each team (the OPPOSING starter).
  const oppByTeam={};
  for(const g of games){
    oppByTeam[g.homeAbbr]={...(g.away?.prob||{}), venue:g.homeAbbr, game:`${g.awayAbbr}@${g.homeAbbr}`, oppAbbr:g.awayAbbr};
    oppByTeam[g.awayAbbr]={...(g.home?.prob||{}), venue:g.homeAbbr, game:`${g.awayAbbr}@${g.homeAbbr}`, oppAbbr:g.homeAbbr};
  }
  const playing=new Set(games.flatMap(g=>[g.homeAbbr,g.awayAbbr]));

  // Top power bats per playing team.
  const byTeam={};
  for(const b of batters){
    if(!playing.has(b.teamAbbr)) continue;
    if(b.pa!=null && b.pa<MIN_PA) continue;
    if(b.barrel==null||b.ev==null||b.xwoba==null) continue;
    (byTeam[b.teamAbbr]=byTeam[b.teamAbbr]||[]).push(b);
  }
  const picks=[];
  for(const team of Object.keys(byTeam)){
    byTeam[team].sort((a,b)=>(b.barrel-a.barrel)||(b.xwoba-a.xwoba));
    picks.push(...byTeam[team].slice(0,HITTERS_PER_TEAM));
  }
  picks.sort((a,b)=>(b.barrel-a.barrel)||(b.xwoba-a.xwoba));
  if(picks.length>MAX_PLAYERS) picks.length=MAX_PLAYERS;

  const PLAYERS=picks.map(b=>{
    const opp=oppByTeam[b.teamAbbr]||{};
    const hr9=opp.hr9!=null?round(opp.hr9,1):null;
    const hrPct=(b.hr!=null&&b.pa)?round(b.hr/b.pa*100,1):null;
    const arsenal=(opp.arsenal||[]).slice().sort((a,b2)=>b2.p-a.p);
    const pitchMix=arsenal.map(a=>({n:a.n,p:Math.round(a.p),c:pitchColor(a.n)}));
    const l10=l10ById[b.id]||{avg:0,hr:0,games:0};
    const hot=(l10.games>=5)&&((l10.avg>=.280)||(l10.hr>=2));
    const bvp=bvpById[b.id]||null;
    const pHand=opp.hand||"R";
    const plat=(b.hand==="L"&&pHand==="R")||(b.hand==="R"&&pHand==="L");
    const arsTxt=pitchMix.length?pitchMix.map(p=>`${p.n} ${p.p}%`).join(", "):"arsenal n/a";

    return {
      id:b.id, name:b.name, team:b.teamAbbr, hand:b.hand||"R",
      barrel:round(b.barrel,1), ev:round(b.ev,1), xwoba:round(b.xwoba,3),
      hrPct:hrPct??0, hrSeason:b.hr??0, playingToday:true,
      venue:opp.venue||b.teamAbbr, game:opp.game||"", pitcher:opp.name||"TBD",
      pitcherHand:pHand, pitcherHR9:hr9??0,
      l10:{avg:round(l10.avg,3)??0, hr:l10.hr??0, hot:!!hot},
      bvp: bvp && bvp.pa>0
        ? {pa:bvp.pa, avg:round(bvp.avg,3), hr:bvp.hr, note:`${bvp.pa} PA vs ${opp.name||"this pitcher"}: .${Math.round((bvp.avg||0)*1000)} AVG, ${bvp.hr} HR`}
        : {pa:0, avg:null, hr:0, note:`No prior matchups vs ${opp.name||"this pitcher"}.`},
      vsHand:{note:`Faces ${pHand==="L"?"LHP":"RHP"} ${opp.name||"TBD"}. ${plat?"Platoon edge.":"Same-hand matchup."}`},
      pitcher_splits:{
        vsL:`${opp.name||"Starter"} (${pHand}HP), ${hr9!=null?hr9+" HR/9":"HR/9 n/a"} this season.`,
        vsR:`Throws: ${arsTxt}.`},
      pitchMix: pitchMix.length?pitchMix:[{n:"n/a",p:100,c:"#7a8394"}],
      pitchSplits:[],   // per-pitch batter splits not available in free feeds
      pitchTarget:`${opp.name||"The starter"} throws ${arsTxt}. ${b.name} carries a ${round(b.barrel,1)}% barrel rate and ${round(b.ev,1)} mph average EV this season${hr9!=null?`; the starter allows ${hr9} HR/9`:""}. ${plat?"Platoon edge favors the hitter.":"No platoon edge."}`,
      bullpen:{team:opp.oppAbbr||"", era:null, note:`Opponent: ${opp.oppAbbr||"TBD"}.`},
      note:`Season Statcast: ${round(b.barrel,1)}% barrel, ${round(b.ev,1)} EV, .${Math.round((b.xwoba||0)*1000)} xwOBA, ${b.hr??0} HR. Faces ${pHand}HP ${opp.name||"TBD"}${hr9!=null?` (${hr9} HR/9)`:""} at ${PF[opp.venue]?.name||opp.venue||"TBD"} (PF ${PF[opp.venue]?.f??100}). ${plat?"Platoon edge.":"Same-hand matchup."}`
    };
  });

  return { DATA_DATE:date, PF, WX, PLAYERS };
}

/* ── Serialize to a data.js identical in shape to the hand-built one ────── */
function toDataJs({DATA_DATE,PF,WX,PLAYERS}){
  const J = o => JSON.stringify(o);
  const players = PLAYERS.map(p =>
    "  "+J(p)
  ).join(",\n");
  return `/* ══════════════════════════════════════════════════════════
   BarrelIQ — DATA (auto-generated ${DATA_DATE})
   Built by build-slate.js from MLB Stats API + Baseball Savant + Open-Meteo.
   Defines globals: DATA_DATE, PF, WX, PLAYERS  — must load before app.js
══════════════════════════════════════════════════════════ */
const DATA_DATE=${J(DATA_DATE)};
const PF=${J(PF)};
const WX=${J(WX)};
const PLAYERS=[
${players}
];
`;
}

/* ══════════════════════════════════════════════════════════════════════
   NETWORK LAYER  (only runs in live mode)
   Isolated so the transform above can be tested without a network.
   ══════════════════════════════════════════════════════════════════════ */
const MLB="https://statsapi.mlb.com/api/v1";
const SAVANT="https://baseballsavant.mlb.com";

async function getJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function getCSV(url){ const r=await fetch(url); if(!r.ok) throw new Error(`${r.status} ${url}`); return parseCSV(await r.text()); }

async function gatherInputs(date){
  // 1) Schedule + probable pitchers + venues.
  const sched=await getJSON(`${MLB}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue`);
  const games=[]; const pitcherIds=new Set(); const teamIds=new Set();
  for(const g of (sched.dates?.[0]?.games||[])){
    const H=g.teams.home.team, A=g.teams.away.team;
    const homeAbbr=ABBR[H.name]||H.abbreviation, awayAbbr=ABBR[A.name]||A.abbreviation;
    const hp=g.teams.home.probablePitcher, ap=g.teams.away.probablePitcher;
    if(hp) pitcherIds.add(hp.id); if(ap) pitcherIds.add(ap.id);
    teamIds.add(H.id); teamIds.add(A.id);
    games.push({homeAbbr,awayAbbr,venue:g.venue?.name||"",
      homeId:H.id,awayId:A.id,
      home:{prob:hp?{id:hp.id,name:hp.fullName}:null},
      away:{prob:ap?{id:ap.id,name:ap.fullName}:null}});
  }
  if(!games.length) return {date,games:[],batters:[]};

  // 2) Hands for probable pitchers (+ HR/9 from season pitching stats).
  for(const g of games){
    for(const side of ["home","away"]){
      const pr=g[side].prob; if(!pr) continue;
      try{
        const pj=await getJSON(`${MLB}/people/${pr.id}?hydrate=stats(group=pitching,type=season,season=${SEASON})`);
        const per=pj.people?.[0]||{};
        pr.hand=(per.pitchHand?.code)||"R";
        const s=per.stats?.[0]?.splits?.[0]?.stat||{};
        const ip=parseFloat(s.inningsPitched||"0"); const hr=+(s.homeRuns||0);
        pr.hr9= ip>0 ? hr*9/ip : null;
        // arsenal usage from Savant
        pr.arsenal=await getArsenal(pr.id);
      }catch(e){ pr.hand=pr.hand||"R"; pr.hr9=null; pr.arsenal=pr.arsenal||[]; }
    }
  }

  // 3) Season Statcast for ALL qualified batters (one CSV).
  const batterCsv=await getCSV(
    `${SAVANT}/leaderboard/custom?year=${SEASON}&type=batter&filter=&min=${MIN_PA}`+
    `&selections=barrel_batted_rate,exit_velocity_avg,xwoba,home_run,pa&csv=true`);
  const statById={};
  for(const r of batterCsv){
    const id=+(r.player_id||r.entity_id); if(!id) continue;
    statById[id]={
      barrel:num(r.barrel_batted_rate), ev:num(r.exit_velocity_avg),
      xwoba:num(r.xwoba), hr:num(r.home_run), pa:num(r.pa)
    };
  }

  // 4) Active rosters for playing teams -> batter ids + hands, joined to stats.
  const batters=[];
  for(const tid of teamIds){
    const teamName=Object.keys(ABBR).find(n=> false); // placeholder; abbr resolved below
    let abbr=null;
    // map team id -> abbr via the schedule games we already have
    for(const g of games){ if(g.homeId===tid)abbr=g.homeAbbr; if(g.awayId===tid)abbr=g.awayAbbr; }
    let roster;
    try{ roster=await getJSON(`${MLB}/teams/${tid}/roster?rosterType=active`); }catch(e){ continue; }
    for(const m of (roster.roster||[])){
      if(m.position?.type==="Pitcher") continue;
      const id=m.person.id, st=statById[id]; if(!st) continue;
      let hand="R";
      try{ const pj=await getJSON(`${MLB}/people/${id}`); hand=pj.people?.[0]?.batSide?.code||"R"; }catch(e){}
      batters.push({id,name:m.person.fullName,teamAbbr:abbr,hand, ...st});
    }
  }

  // 5) Best-effort last-10 + batter-vs-pitcher for the bats we'll likely show.
  const l10ById={}, bvpById={};
  // Pre-rank to limit extra calls to the ~top bats per team.
  const pre={};
  for(const b of batters){ (pre[b.teamAbbr]=pre[b.teamAbbr]||[]).push(b); }
  const shortlist=[];
  for(const t of Object.keys(pre)){
    pre[t].sort((a,b)=>(b.barrel-a.barrel)||(b.xwoba-a.xwoba));
    shortlist.push(...pre[t].slice(0,HITTERS_PER_TEAM));
  }
  const oppId={};
  for(const g of games){ oppId[g.homeAbbr]=g.away.prob?.id; oppId[g.awayAbbr]=g.home.prob?.id; }
  for(const b of shortlist){
    try{
      const lj=await getJSON(`${MLB}/people/${b.id}/stats?stats=lastXGames&group=hitting&limit=10&season=${SEASON}`);
      const s=lj.stats?.[0]?.splits?.[0]?.stat||{};
      l10ById[b.id]={avg:parseFloat(s.avg||"0"),hr:+(s.homeRuns||0),games:+(s.gamesPlayed||0)};
    }catch(e){}
    const pid=oppId[b.teamAbbr];
    if(pid){
      try{
        const vj=await getJSON(`${MLB}/people/${b.id}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pid}&season=all`);
        const s=(vj.stats?.find(x=>x.splits?.length)?.splits?.[0]?.stat)||{};
        if(s.plateAppearances) bvpById[b.id]={pa:+s.plateAppearances,avg:parseFloat(s.avg||"0"),hr:+(s.homeRuns||0)};
      }catch(e){}
    }
  }

  // 6) Weather per home park.
  const weatherByPark={};
  for(const g of games){
    const k=g.homeAbbr, c=PARK[k];
    if(!c){ weatherByPark[k]={dome:true}; continue; }
    if(c[2]===1){ weatherByPark[k]={dome:true,temp:72}; continue; }
    try{
      const wj=await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}`+
        `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m`+
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=America/New_York`);
      const h=wj.hourly||{}; const idx=Math.min(19,(h.time?.length||1)-1); // ~7pm local
      weatherByPark[k]={temp:Math.round(h.temperature_2m?.[idx]??70),
        wind:h.wind_speed_10m?.[idx]??6, windDeg:h.wind_direction_10m?.[idx]??0,
        rain:h.precipitation_probability?.[idx]??0, dome:false};
    }catch(e){ weatherByPark[k]={dome:false,temp:70,wind:6,windDeg:0,rain:0}; }
  }

  return {date,games,batters,weatherByPark,l10ById,bvpById};
}

async function getArsenal(pitcherId){
  try{
    const rows=await getCSV(`${SAVANT}/leaderboard/pitch-arsenals?year=${SEASON}&type=n_pitches&hand=&csv=true`);
    const mine=rows.filter(r=>+(r.pitcher||r.player_id)===pitcherId);
    // pitch-arsenals returns one row per pitcher with usage columns per pitch; fall back to long format.
    const out=[];
    for(const r of mine){
      for(const [k,v] of Object.entries(r)){
        if(/_usage$/.test(k) && num(v)){ out.push({n:prettyPitch(k.replace(/_usage$/,'')),p:num(v)}); }
      }
    }
    return out;
  }catch(e){ return []; }
}
function prettyPitch(code){
  const m={ff:"4-Seam",si:"Sinker",fc:"Cutter",sl:"Slider",st:"Sweeper",cu:"Curveball",
           kc:"Knuckle Curve",ch:"Changeup",fs:"Splitter",fourseam:"4-Seam",sinker:"Sinker"};
  return m[code.toLowerCase()]||code.toUpperCase();
}

/* ── main ─────────────────────────────────────────────────────────────── */
function arg(name){ const a=process.argv.find(x=>x.startsWith(`--${name}`)); return a? (a.split('=')[1]??true) : null; }
function todayET(){
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  return f.format(new Date());
}

async function main(){
  const fixture=arg('fixture');
  const date=arg('date')||todayET();
  let inputs;
  if(fixture){
    console.log(`[build] fixture mode: ${fixture}`);
    inputs=JSON.parse(fs.readFileSync(path.resolve(__dirname,fixture),'utf8'));
    if(!inputs.date) inputs.date=date;
  }else{
    console.log(`[build] live mode for ${date}`);
    inputs=await gatherInputs(date);
  }
  if(!inputs.games.length){
    console.log(`[build] no MLB games on ${inputs.date}. Leaving existing data.js unchanged.`);
    return;
  }
  const data=assembleData(inputs);
  console.log(`[build] ${data.PLAYERS.length} players across ${Object.keys(data.WX).length} parks for ${data.DATA_DATE}`);
  fs.writeFileSync(OUT_PATH, toDataJs(data));
  console.log(`[build] wrote ${OUT_PATH}`);
}

if(require.main===module){ main().catch(e=>{console.error('[build] FAILED:',e); process.exit(1);}); }
module.exports={ assembleData, toDataJs, parseCSV };
