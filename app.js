/* ══════════════════════════════════════════════════════════
   BarrelIQ — APP LOGIC
   Depends on data.js (PF, WX, PLAYERS) being loaded first.
══════════════════════════════════════════════════════════ */

// Weather-adjusted park factor (uses PF + WX from data.js)
function adjPF(k){return Math.round((PF[k]?.f||100)+(WX[k]?.impactMod||0));}

/* ══════════════════════════════════════════════════════════════
   SCORING
══════════════════════════════════════════════════════════════ */
function score(p){
  if(!p.playingToday) return 3;
  const pf=adjPF(p.venue),W={b:25,e:20,x:15,h:20,p:10,pi:10};
  const bS=(p.barrel/22)*100,eS=((p.ev-85)/15)*100,xS=((p.xwoba-.25)/.25)*100;
  const hS=(p.hrPct/12)*100,pfS=((pf-85)/50)*100,piS=p.pitcherHR9?(p.pitcherHR9/3.5)*100:50;
  const raw=(W.b*bS+W.e*eS+W.x*xS+W.h*hS+W.p*pfS+W.pi*piS)/(W.b+W.e+W.x+W.h+W.p+W.pi);
  let base=Math.min(95,Math.max(5,Math.round(raw*.58+7)));
  if(p.l10?.hot) base=Math.min(97,base+2);
  if(p.l10?.hr>=3) base=Math.min(97,base+1);
  const gP=(p.hand==='L'&&p.pitcherHand==='R')||(p.hand==='R'&&p.pitcherHand==='L');
  const bP=(p.hand==='L'&&p.pitcherHand==='L')||(p.hand==='R'&&p.pitcherHand==='R');
  if(gP) base=Math.min(97,base+2); if(bP) base=Math.max(4,base-2);
  if(p.bvp?.hr>0) base=Math.min(97,base+1);
  return base;
}

// ── CALIBRATION ───────────────────────────────────────────────────────
// Turns the 0-100 rating into a REAL home-run probability.
// Fit from 5,484 graded player-games (Jun 2026):  p = 0.0057*rating - 0.022
// Verified vs observed rates: r25->12%, r35->18%, r45->24%.
function calibrate(rating){ return Math.max(0.01, Math.min(0.60, 0.0057*rating - 0.022)); }
function calibPct(rating){ return Math.round(calibrate(rating)*100)+'%'; }

function probColor(p){return p>=52?'#e8a320':p>=44?'#22c97a':p>=36?'#4a9eff':'#4a5260'}
function tierClass(p){return p>=52?'tier-elite':p>=44?'tier-strong':p>=36?'tier-solid':'tier-watch'}
function toDecimal(am){return am>0?am/100+1:100/Math.abs(am)+1}
function toAmerican(d){return d>=2?'+'+(Math.round((d-1)*100)):'-'+(Math.round(100/(d-1)))}
function vigImp(am){return am>0?100/(am+100):Math.abs(am)/(Math.abs(am)+100)}
function valScore(p){return p.fdOdds?(p.prob/100)/vigImp(p.fdOdds):0}

let expanded=null,activeTab={},currentFilter='games',scored=[];
let rosterSortKey='cal',rosterSortDir=-1;   // full-slate table sort state
let rosterView='game';                          // 'game' | 'team' | 'flat'
function setRosterView(v){ rosterView=v; renderRoster(); }

/* ══ PARK GRID ══ */
function renderParks(){
  const today=Object.keys(WX);
  const sorted=Object.entries(PF).sort((a,b)=>b[1].f-a[1].f);
  const list=[...sorted.filter(([k])=>today.includes(k)),...sorted.filter(([k])=>!today.includes(k))];
  document.getElementById('park-grid').innerHTML=list.slice(0,20).map(([key,p])=>{
    const isT=today.includes(key);
    const adj=adjPF(key),wx=WX[key],diff=adj-p.f;
    const t=adj>=115?'elite':adj>=105?'good':adj>=95?'neutral':'bad';
    const bw=Math.round(Math.min(100,Math.max(0,(adj-80)/60*100)));
    const bc=adj>=115?'#e8a320':adj>=105?'#22c97a':adj>=95?'#4a9eff':'#e84040';
    const adjStr=diff>0?`+${diff}`:diff<0?`${diff}`:'';
    return`<div class="park-card ${t} ${isT?'active-today':''}">
      <div class="park-name">${p.name}</div>
      <div class="park-team">${key}</div>
      <div class="park-numbers">
        <span class="park-factor-num ${t}">${adj}</span>
        ${adjStr?`<span style="font-family:var(--font-mono);font-size:10px;color:${diff>0?'var(--orange)':'var(--purple)'}">${adjStr}</span>`:''}
      </div>
      ${wx?`<div class="park-wx ${wx.impact==='boost'?'boost':wx.impact==='suppress'?'suppress':''}">${wx.tag}</div>`:''}
      <div class="park-bar"><div class="park-bar-fill" style="width:${bw}%;background:${bc}"></div></div>
      ${isT?'<div class="today-badge">TODAY</div>':''}
    </div>`;
  }).join('');
}

/* ══ FILTERS ══ */
function getFiltered(){
  return scored.filter(p=>{
    if(currentFilter==='games'&&!p.playingToday) return false;
    if(currentFilter==='L'&&p.hand!=='L'&&p.hand!=='S') return false;
    if(currentFilter==='R'&&p.hand!=='R'&&p.hand!=='S') return false;
    if(currentFilter==='elite'&&p.barrel<16) return false;
    if(currentFilter==='hot'&&!p.l10?.hot) return false;
    return true;
  });
}
function setFilter(f){
  currentFilter=f;
  ['fGames','fAll','fL','fR','fElite','fHot'].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove('active')});
  const m={games:'fGames',all:'fAll',L:'fL',R:'fR',elite:'fElite',hot:'fHot'};
  const e=document.getElementById(m[f]);if(e)e.classList.add('active');
  renderPlayers();
}
function switchTab(pid,tab){activeTab[pid]=tab;renderPlayers();}
function toggleCard(id){expanded=(expanded===id)?null:id;if(expanded&&!activeTab[id])activeTab[id]='statcast';renderPlayers();}

/* ══ CELL COLORING ══ */
function avgClass(v){return v>=.310?'cell-elite':v>=.270?'cell-good':v<=.200?'cell-bad':''}
function hhClass(v){return v>=55?'cell-elite':v>=45?'cell-good':v<=33?'cell-bad':''}
function barClass(v){return v>=18?'cell-elite':v>=12?'cell-good':v<=7?'cell-bad':''}
function evClass(v){return v>=93?'cell-elite':v>=90?'cell-good':v<=86?'cell-bad':''}
function wobaClass(v){return v>=.420?'cell-elite':v>=.340?'cell-good':v<=.270?'cell-bad':''}
function hrClass(v){return v>=8?'cell-elite':v>=5?'cell-good':v<=2.5?'cell-bad':''}

/* ══ PLAYER CARDS ══ */
function renderPlayers(){
  const grid=document.getElementById('players-grid');
  const filtered=getFiltered();
  if(!filtered.length){grid.innerHTML='<div class="loading-state"><div class="loading-label" style="color:var(--muted)">No players match filter.</div></div>';return;}
  grid.innerHTML=filtered.map((p,i)=>{
    const rC=i<3?`r${i+1}`:'';
    const adj=adjPF(p.venue),pf=PF[p.venue]||{f:100};
    const pfHot=adj>=108,pfCold=adj<95;
    const wx=WX[p.venue];
    const barColor=probColor(p.prob);
    const bw=Math.round((p.prob/filtered[0].prob)*100);
    const isOpen=expanded===p.id;
    const hLabel=p.hand==='S'?'S/W':p.hand==='L'?'LHB':'RHB';
    const hotTag=p.l10?.hot?`<span class="tag hot">🔥 L10: .${Math.round(p.l10.avg*1000)} ${p.l10.hr}HR</span>`:'';
    const bvpTag=p.bvp?.hr>0?`<span class="tag hot">BvP HR</span>`:'';
    const parkTag=pfHot?`<span class="tag hot">🏟 PF${adj}</span>`:pfCold?`<span class="tag danger">❄️ PF${adj}</span>`:`<span class="tag">PF${adj}</span>`;
    const wxTag=wx?.impact==='boost'?`<span class="tag wx-boost">${wx.tag}</span>`:wx?.impact==='suppress'?`<span class="tag wx-bad">${wx.tag}</span>`:'';
    const gP=(p.hand==='L'&&p.pitcherHand==='R')||(p.hand==='R'&&p.pitcherHand==='L');
    const bP=(p.hand==='L'&&p.pitcherHand==='L')||(p.hand==='R'&&p.pitcherHand==='R');
    const platTag=gP?`<span class="tag good">✓ PLATOON</span>`:bP?`<span class="tag danger">✗ SAME-HAND</span>`:'';

    let detail='';
    if(isOpen){
      const tab=activeTab[p.id]||'statcast';
      const tabs=['statcast','form','pitcher','pitchmix','weather','park'].map(t=>`<button class="dtab ${tab===t?'active':''}" onclick="switchTab('${p.id}','${t}');event.stopPropagation()">${t==='pitchmix'?'PITCH MIX':t.toUpperCase()}</button>`).join('');
      let pane='';

      if(tab==='statcast'){
        pane=`<div class="stat-row">
          <div class="stat-chip ${p.barrel>=16?'hl':''}"><div class="sv">${p.barrel}%</div><div class="sl">Barrel%</div></div>
          <div class="stat-chip ${p.ev>=92?'hl':''}"><div class="sv">${p.ev}</div><div class="sl">Avg EV</div></div>
          <div class="stat-chip ${p.xwoba>=.380?'hl':''}"><div class="sv">${p.xwoba}</div><div class="sl">xwOBA</div></div>
          <div class="stat-chip"><div class="sv">${p.hrPct}%</div><div class="sl">HR/PA%</div></div>
          <div class="stat-chip ${p.pitcherHR9>=2.5?'red':p.pitcherHR9<=0.6?'grn':''}"><div class="sv">${p.pitcherHR9||'—'}</div><div class="sl">P.HR/9</div></div>
          <div class="stat-chip"><div class="sv">${p.hrSeason}</div><div class="sl">2026 HR</div></div>
          <div class="stat-chip"><div class="sv">${hLabel}</div><div class="sl">Bats</div></div>
          ${p.fdOdds?`<div class="stat-chip hl"><div class="sv" style="color:var(--green)">+${p.fdOdds}</div><div class="sl">FD Odds</div></div>`:''}
        </div>
        <div class="note-box"><div class="nb-label">Analysis</div>${p.note}</div>`;
      }
      if(tab==='form'){
        const g=p.l10;
        pane=`<div class="note-box"><div class="nb-label">Last 10 Games</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px">
            <span><strong>${(g.avg*1000|0)/1000}</strong> <span style="color:var(--dim)">AVG</span></span>
            <span><strong>${g.hr}</strong> <span style="color:var(--dim)">HR</span></span>
            <span style="color:${g.hot?'var(--gold)':'var(--muted)'}">${g.hot?'🔥 Hot streak':'— Cooling'}</span>
          </div>
        </div>
        <div class="note-box"><div class="nb-label">Batter vs Pitcher (Career)</div>
          ${p.bvp.pa>0?`<strong>${p.bvp.pa} PA · .${Math.round(p.bvp.avg*1000)} AVG · ${p.bvp.hr} HR</strong><br><span style="color:var(--muted)">${p.bvp.note}</span>`:`<span style="color:var(--muted)">${p.bvp.note}</span>`}
        </div>
        <div class="note-box"><div class="nb-label">vs ${p.pitcherHand==='L'?'LHP':'RHP'} Split (2026)</div>${p.vsHand.note}</div>`;
      }
      if(tab==='pitcher'){
        pane=`<div class="note-box"><div class="nb-label">Pitcher: ${p.pitcher} (${p.pitcherHand}HP) · HR/9: ${p.pitcherHR9||'—'}</div>
          <strong>vs LHB:</strong> ${p.pitcher_splits.vsL}<br><strong>vs RHB:</strong> ${p.pitcher_splits.vsR}
        </div>
        <div class="note-box"><div class="nb-label">Bullpen — ${p.bullpen.team}</div>${p.bullpen.note}</div>`;
      }
      if(tab==='pitchmix'){
        const bars=p.pitchMix.map(pm=>`<div class="pitch-row">
          <span class="pitch-name">${pm.n}</span>
          <div class="pitch-bar-bg"><div class="pitch-bar-fill" style="width:${pm.p}%;background:${pm.c}"></div></div>
          <span class="pitch-pct">${pm.p}%</span>
        </div>`).join('');
        const tableRows=p.pitchSplits.map(s=>{
          const isTarget=s.target,isAvoid=s.avoid;
          const rowClass=isTarget?'target-row':'';
          const marker=isTarget?'🎯 ':isAvoid?'⛔ ':'';
          return`<tr class="${rowClass}">
            <td>${marker}${s.pitch} <span style="color:var(--dim);font-size:9px">${s.usage}%</span></td>
            <td class="${avgClass(s.avg)}">.${Math.round(s.avg*1000)}</td>
            <td class="${hhClass(s.hh)}">${s.hh}%</td>
            <td class="${barClass(s.barrel)}">${s.barrel}%</td>
            <td class="${evClass(s.ev)}">${s.ev}</td>
            <td class="${wobaClass(s.woba)}">.${Math.round(s.woba*1000)}</td>
            <td class="${hrClass(s.hrRate)}">${s.hrRate}%</td>
          </tr>`;
        }).join('');
        pane=`<div class="note-box" style="margin-bottom:8px"><div class="nb-label">Pitcher Arsenal — ${p.pitcher}</div>
          <div class="pitch-mix">${bars}</div>
        </div>
        <div class="note-box" style="padding:0;overflow:hidden">
          <div style="padding:8px 12px 4px"><div class="nb-label">Batter vs Each Pitch — ${p.name} (2026 Statcast)</div></div>
          <div style="overflow-x:auto;padding:0 0 4px">
            <table class="pvb-table">
              <thead><tr>
                <th style="text-align:left">Pitch</th>
                <th>AVG</th><th>HH%</th><th>BBL%</th><th>EV</th><th>wOBA</th><th>HR%</th>
              </tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
        <div class="pitch-target-box">
          <div class="ptb-label">🎯 Targeting strategy</div>
          <p>${p.pitchTarget}</p>
        </div>`;
      }
      if(tab==='weather'){
        const w=WX[p.venue];
        if(!w){pane=`<div class="note-box"><div class="nb-label">Weather</div><span style="color:var(--muted)">Dome/retractable — weather not a factor.</span></div>`;}
        else{
          const adjF=adjPF(p.venue),base=PF[p.venue]?.f||100,diff=adjF-base;
          const wClass=w.impact==='boost'?'boost':w.impact==='suppress'?'suppress':w.dome?'dome':'neutral';
          pane=`<div class="wx-grid">
            <div class="wx-chip"><div class="wv" style="color:${w.temp>=85?'var(--orange)':w.temp<65?'var(--blue)':'var(--text)'}">${w.temp}°</div><div class="wl">Temp</div></div>
            <div class="wx-chip"><div class="wv" style="color:${w.impact==='boost'?'var(--gold)':w.impact==='suppress'?'var(--purple)':'var(--text)'}">${w.wind}mph</div><div class="wl">Wind</div></div>
            <div class="wx-chip"><div class="wv">${w.windDir}</div><div class="wl">Direction</div></div>
            <div class="wx-chip"><div class="wv" style="color:${w.rain>30?'var(--red)':'var(--text)'}">${w.rain}%</div><div class="wl">Rain</div></div>
          </div>
          <div class="wx-impact ${wClass}">${w.desc}</div>
          <div class="note-box"><div class="nb-label">Park Factor Adjustment</div>
            Base PF: <strong>${base}</strong> → Weather-Adj: <strong>${adjF}</strong> ${diff!==0?`(${diff>0?'+':''}${diff} from ${w.impact==='boost'?'heat/wind boost':'wind/cold suppression'})`:' (no adjustment)'}
          </div>`;
        }
      }
      if(tab==='park'){
        const pfD=PF[p.venue]||{f:100,name:'Unknown',notes:'No data'};
        const adjF=adjPF(p.venue),diff=adjF-pfD.f;
        const pfT=adjF>=115?'elite':adjF>=105?'good':adjF>=95?'neutral':'bad';
        const pfNumC=pfT==='elite'?'var(--gold2)':pfT==='good'?'var(--green)':pfT==='neutral'?'var(--blue)':'var(--muted)';
        pane=`<div class="park-detail-row">
          <div class="pf-big" style="color:${pfNumC}">${pfD.f}</div>
          <div class="pf-arrow">→</div>
          <div class="pf-adj">${adjF}${diff>0?` (+${diff})`:diff<0?` (${diff})`:''}</div>
          <div><div style="font-family:var(--font-mono);font-size:12px;color:var(--text)">${pfD.name}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">${pfD.notes}</div></div>
        </div>
        <div class="note-box"><div class="nb-label">What this means</div>
          100 = league avg. <strong>${adjF}</strong> (weather-adjusted) = ~<strong>${Math.abs(adjF-100)}% ${adjF>=100?'MORE':'FEWER'} HRs</strong> than a neutral park today.
          ${adjF>=115?'🔥 Elite HR conditions.':adjF>=105?'✓ Favorable.':adjF>=95?'Neutral park.':'❄️ Suppressive conditions.'}
        </div>`;
      }
      detail=`<div class="card-detail open">
        <div class="detail-tabs">${tabs}</div>
        <div class="tab-pane active">${pane}</div>
      </div>`;
    }
    return`<div class="player-card ${tierClass(p.prob)} ${isOpen?'open':''}" onclick="toggleCard('${p.id}')">
      <div class="card-main">
        <div class="rank-num ${rC}">${i+1}</div>
        <div>
          <div class="player-name">${p.name}</div>
          <div class="player-sub">
            <span>${p.team}</span><span>·</span><span>${p.game}</span><span>·</span><span>vs ${p.pitcher}</span>
            ${parkTag}${platTag}${wxTag}${hotTag}${bvpTag}
          </div>
        </div>
        <div class="prob-block">
          <div class="prob-pct" style="color:${barColor}">${calibPct(p.prob)}</div>
          <div class="prob-lbl">HR PROBABILITY</div>
          <div class="mkt-implied">Rating ${p.prob}/100</div>
        </div>
      </div>
      <div class="prob-bar-row"><div class="prob-bar-fill" style="width:${bw}%;background:${barColor}"></div></div>
      ${detail}
    </div>`;
  }).join('');
}

/* ══ PARLAY ══ */
function renderParlays(){
  const el=document.getElementById('parlay-grid');
  const elig=scored.filter(p=>p.playingToday&&p.fdOdds);
  const combos=[];
  for(let i=0;i<elig.length;i++)
    for(let j=i+1;j<elig.length;j++)
      for(let k=j+1;k<elig.length;k++){
        const legs=[elig[i],elig[j],elig[k]];
        const gc={};legs.forEach(l=>{gc[l.game]=(gc[l.game]||0)+1});
        if(Object.values(gc).some(c=>c>2)) continue;
        const val=legs.reduce((a,l)=>a*valScore(l),1)*legs.reduce((a,l)=>a*(l.prob/100),1);
        combos.push({legs,val});
      }
  combos.sort((a,b)=>b.val-a.val);
  if(!combos.length){el.innerHTML='<div class="loading-state" style="grid-column:1/-1"><div class="loading-label" style="color:var(--muted)">Not enough data.</div></div>';return;}
  el.innerHTML=combos.slice(0,3).map((c,idx)=>{
    const legs=c.legs;
    const dec=legs.reduce((a,l)=>a*toDecimal(l.fdOdds),1);
    const amOdds=toAmerican(dec),profit=((dec-1)*10).toFixed(2);
    const mp=(legs.reduce((a,l)=>a*(l.prob/100),1)*100).toFixed(1);
    return`<div class="parlay-card ${idx===0?'best':''}">
      <div class="parlay-header"><span class="parlay-rank-lbl">#${idx+1} COMBO</span>${idx===0?'<span class="parlay-badge">BEST VALUE</span>':''}</div>
      <div class="parlay-legs">${legs.map(l=>`<div class="parlay-leg">
        <div><div class="parlay-leg-name">${l.name}</div><div class="parlay-leg-sub">${l.team} · vs ${l.pitcher}</div></div>
        <div class="parlay-leg-odds">+${l.fdOdds}</div>
      </div>`).join('')}</div>
      <div class="parlay-stats-row">
        <div class="parlay-stat"><div class="pv">${amOdds}</div><div class="pl">PARLAY ODDS</div></div>
        <div class="parlay-stat"><div class="pv">$${profit}</div><div class="pl">PROFIT/$10</div></div>
        <div class="parlay-stat"><div class="pv">${mp}</div><div class="pl">MODEL SCORE</div></div>
      </div>
    </div>`;
  }).join('');
}

/* ══ FULL SLATE TABLE (all qualified hitters, sortable) ══ */
function rosterSort(key){
  if(rosterSortKey===key) rosterSortDir*=-1;
  else { rosterSortKey=key; rosterSortDir=(key==='name'||key==='team')?1:-1; }
  renderRoster();
}
function renderRoster(){
  const wrap=document.getElementById('roster-wrap');
  if(!wrap) return;
  if(typeof ROSTER==='undefined'||!Array.isArray(ROSTER)||!ROSTER.length){
    wrap.innerHTML='<div class="loading-state"><div class="loading-label" style="color:var(--muted)">Full slate appears after the next daily build.</div></div>';
    return;
  }
  const rows=ROSTER.map(p=>{const r=score(p);const cp=calibrate(r);return {...p,rating:r,cal:cp,fo:cp};});
  const COLN=11;

  // one row's cells — identical in every view (Rating, HR%, then the rest)
  const cells=p=>{
    const c=probColor(p.rating), hot5=p.hr5!=null&&p.hr5>=2;
    return `<td class="num" style="font-family:var(--font-mono);color:var(--gold2)">${calibPct(p.rating)}</td>
      <td class="num" style="font-family:var(--font-mono);color:${c}">${probToFairOdds(p.cal)}</td>
      <td class="slate-name">${p.name}</td>
      <td>${p.team}</td>
      <td class="slate-match">${p.game||'—'}${p.pitcher&&p.pitcher!=='TBD'?` · vs ${p.pitcher}`:''}</td>
      <td class="num">${p.barrel??'—'}</td>
      <td class="num">${p.ev??'—'}</td>
      <td class="num">${p.xwoba!=null?'.'+Math.round(p.xwoba*1000):'—'}</td>
      <td class="num">${p.hrSeason??0}</td>
      <td class="num"${hot5?' style="color:var(--gold2)"':''}>${p.hr5!=null?p.hr5:'—'}</td>
      <td class="num">${p.avg5!=null?'.'+String(Math.round(p.avg5*1000)).padStart(3,'0'):'—'}</td>`;
  };

  const toggle=`<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <button class="ctrl-btn${rosterView==='game'?' active':''}" onclick="setRosterView('game')">BY MATCHUP</button>
    <button class="ctrl-btn${rosterView==='team'?' active':''}" onclick="setRosterView('team')">BY TEAM</button>
    <button class="ctrl-btn${rosterView==='flat'?' active':''}" onclick="setRosterView('flat')">SORTABLE</button>
  </div>`;
  const grpStyle="background:var(--surface2);color:var(--gold2);font-family:var(--font-disp);font-size:15px;letter-spacing:.04em;padding:9px 10px;border-top:1px solid var(--border2)";

  let head, body;
  if(rosterView==='flat'){
    const k=rosterSortKey,dir=rosterSortDir;
    rows.sort((a,b)=>{let x=a[k],y=b[k];
      if(typeof x==='string'){x=x.toLowerCase();y=(y||'').toLowerCase();return x<y?-dir:x>y?dir:0;}
      return ((x??0)-(y??0))*dir;});
    const cols=[['cal','HR%'],['fo','Fair Odds'],['name','Player'],['team','Tm'],['matchup','Matchup'],['barrel','Bar%'],['ev','EV'],['xwoba','xwOBA'],['hrSeason','HR'],['hr5','HR L5'],['avg5','AVG L5']];
    const arrow=c=> rosterSortKey===c ? (rosterSortDir<0?' ▼':' ▲') : '';
    head=cols.map(([c,lbl])=>`<th onclick="rosterSort('${c}')" class="${['cal','fo','barrel','ev','xwoba','hrSeason','hr5','avg5'].includes(c)?'num':''}">${lbl}${arrow(c)}</th>`).join('');
    body=rows.map(p=>`<tr>${cells(p)}</tr>`).join('');
  }else{
    const key=rosterView==='team'?'team':'game';
    const groups={};
    rows.forEach(p=>{(groups[p[key]]=groups[p[key]]||[]).push(p);});
    const ordered=Object.keys(groups).sort((a,b)=>
      Math.max(...groups[b].map(p=>p.rating))-Math.max(...groups[a].map(p=>p.rating)));
    const label=g=> rosterView==='team' ? teamName(g) : matchupLabel(g);
    body=ordered.map(g=>{
      const list=groups[g].sort((a,b)=>b.rating-a.rating);
      return `<tr><td colspan="${COLN}" style="${grpStyle}">${label(g)} · ${list.length}</td></tr>`
        + list.map(p=>`<tr>${cells(p)}</tr>`).join('');
    }).join('');
    const cols=['HR%','Fair Odds','Player','Tm','Matchup','Bar%','EV','xwOBA','HR','HR L5','AVG L5'];
    const numset=new Set(['HR%','Fair Odds','Bar%','EV','xwOBA','HR','HR L5','AVG L5']);
    head=cols.map(c=>`<th class="${numset.has(c)?'num':''}" style="cursor:default">${c}</th>`).join('');
  }

  wrap.innerHTML=toggle
    +`<div class="slate-count">${rows.length} qualified hitters · HR% = calibrated probability · Fair Odds = model (not a market price)${rosterView==='flat'?' · click a column to sort':' · sorted by rating within each group'}</div>`
    +`<div class="slate-scroll"><table class="slate-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// abbr -> nickname, for readable group headers
const TEAM_NAME={ARI:'Diamondbacks',ATL:'Braves',BAL:'Orioles',BOS:'Red Sox',CHC:'Cubs',CWS:'White Sox',CIN:'Reds',CLE:'Guardians',COL:'Rockies',DET:'Tigers',HOU:'Astros',KC:'Royals',LAA:'Angels',LAD:'Dodgers',MIA:'Marlins',MIL:'Brewers',MIN:'Twins',NYM:'Mets',NYY:'Yankees',PHI:'Phillies',PIT:'Pirates',SD:'Padres',SF:'Giants',SEA:'Mariners',STL:'Cardinals',TB:'Rays',TEX:'Rangers',TOR:'Blue Jays',WSH:'Nationals',ATH:'Athletics'};
const teamName=a=>TEAM_NAME[a]||a;
function matchupLabel(game){const[a,h]=String(game).split('@');return h?`${teamName(a)} @ ${teamName(h)}`:teamName(a);}

/* ══ INIT ══ */
function fmtDate(s){const[y,m,d]=s.split('-');const mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const dy=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];const dt=new Date(y,m-1,d);return`${dy[dt.getDay()]}, ${mo[m-1]} ${parseInt(d)}, ${y}`}
function localISODate(){const d=new Date();const p=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}
const TEAM_MAP={
  "Arizona Diamondbacks":"ARI","Atlanta Braves":"ATL","Baltimore Orioles":"BAL","Boston Red Sox":"BOS",
  "Chicago Cubs":"CHC","Chicago White Sox":"CWS","Cincinnati Reds":"CIN","Cleveland Guardians":"CLE",
  "Colorado Rockies":"COL","Detroit Tigers":"DET","Houston Astros":"HOU","Kansas City Royals":"KC",
  "Los Angeles Angels":"LAA","Los Angeles Dodgers":"LAD","Miami Marlins":"MIA","Milwaukee Brewers":"MIL",
  "Minnesota Twins":"MIN","New York Mets":"NYM","New York Yankees":"NYY","Philadelphia Phillies":"PHI",
  "Pittsburgh Pirates":"PIT","San Diego Padres":"SD","San Francisco Giants":"SF","Seattle Mariners":"SEA",
  "St. Louis Cardinals":"STL","Tampa Bay Rays":"TB","Texas Rangers":"TEX","Toronto Blue Jays":"TOR",
  "Washington Nationals":"WSH","Athletics":"ATH","Oakland Athletics":"ATH","Sacramento Athletics":"ATH"
};
function resolveAbbr(team){
  if(!team) return '';
  const raw=TEAM_MAP[(team.name||'').trim()] || team.abbreviation || team.name || '';
  return String(raw).trim().toUpperCase();
}
async function fetchTodaySlate(dateStr){
  const url=`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}`;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),8000);
  let data;
  try{
    const res=await fetch(url,{signal:ctrl.signal});
    if(!res.ok) throw new Error('HTTP '+res.status);
    data=await res.json();
  } finally { clearTimeout(timer); }
  const games=data?.dates?.[0]?.games || [];
  const teams=new Set();
  games.forEach(g=>{
    const h=resolveAbbr(g?.teams?.home?.team), a=resolveAbbr(g?.teams?.away?.team);
    if(h) teams.add(h);
    if(a) teams.add(a);
  });
  return { teams, gameCount: games.length };
}

/* ══ SLATE STATE ══ */
let TODAY_TEAMS=null;
let SLATE_DATE=DATA_DATE;
let LIVE_GAMES=null;
let SELECTED_DATE=null;
function targetDate(){ return SELECTED_DATE || localISODate(); }

function buildScored(){
  scored = PLAYERS.map(p=>{
    const prob = score(p);
    const active = TODAY_TEAMS ? TODAY_TEAMS.has(p.team) : p.playingToday;
    return { ...p, prob, playingToday: active };
  }).sort((a,b)=>b.prob-a.prob);
}

function paint(){
  buildScored();
  const activeCount = scored.filter(p=>p.playingToday).length;
  document.getElementById('today-date').textContent = fmtDate(SLATE_DATE);
  document.getElementById('sdot').className = 'status-dot ok';
  const st = document.getElementById('status-text');
  const mlbChip = document.getElementById('chip-mlb');
  if(TODAY_TEAMS){
    if(LIVE_GAMES===0){
      st.textContent = `No MLB games scheduled on ${fmtDate(SLATE_DATE)} — your players are under ALL PLAYERS`;
    } else if(activeCount){
      st.textContent = `Live · ${fmtDate(SLATE_DATE)} · ${LIVE_GAMES} MLB games · ${activeCount} tracked player(s) active`;
    } else {
      st.textContent = `Live · ${fmtDate(SLATE_DATE)} · ${LIVE_GAMES} MLB games · none of your tracked players that day — tap ALL PLAYERS`;
    }
    if(mlbChip) mlbChip.className = 'api-chip live';
  } else {
    st.textContent = `Curated slate · ${fmtDate(SLATE_DATE)} · ${activeCount} players · Statcast model active`;
    if(mlbChip) mlbChip.className = 'api-chip cached';
  }
  ['chip-savant','chip-parks','chip-wx'].forEach(id=>{const e=document.getElementById(id); if(e) e.className='api-chip cached';});
  renderParks();
  renderPlayers();
  renderParlays();
  renderRoster();
}

async function refreshLiveSlate(explicit=false){
  const date = targetDate();
  try{
    const slate = await fetchTodaySlate(date);
    if(!slate.teams.size && !explicit) return;
    TODAY_TEAMS = slate.teams;
    SLATE_DATE  = date;
    LIVE_GAMES  = slate.gameCount;
    paint();
  }catch(e){
    console.warn('Live MLB schedule unavailable — showing curated snapshot.', e);
    if(explicit){
      const st=document.getElementById('status-text');
      if(st) st.textContent = `Couldn't load the schedule for ${fmtDate(date)} — showing curated snapshot.`;
    }
  }
}

function onDatePick(value){
  SELECTED_DATE = value || null;
  const st=document.getElementById('status-text'), dot=document.getElementById('sdot');
  if(st) st.textContent = `Loading ${fmtDate(targetDate())}…`;
  if(dot) dot.className = 'status-dot loading';
  refreshLiveSlate(true);
}

function initApp(){
  if (typeof PLAYERS === 'undefined' || typeof WX === 'undefined') {
    const s=document.getElementById('status-text'), d=document.getElementById('sdot');
    if(s) s.textContent='Error: data.js failed to load.';
    if(d) d.className='status-dot';
    return;
  }
  expanded=null; activeTab={}; currentFilter='games';
  TODAY_TEAMS=null; SLATE_DATE=DATA_DATE; LIVE_GAMES=null;
  paint();
  const dp=document.getElementById('date-picker'); if(dp) dp.value=targetDate();
  refreshLiveSlate(SELECTED_DATE!==null);
  window.initAppRan=true;
}

/* ══ POST MODE (screenshot-ready Top 10) ══ */
// Probability (0-1) -> fair American odds (no vig). This is the model's number
// restated as odds, NOT a market price — labeled "fair" so it can't read as edge.
function probToFairOdds(p){
  if(p<=0) return '+9999'; if(p>=1) return '-9999';
  return p>=0.5 ? '-'+Math.round(100*p/(1-p)) : '+'+Math.round(100*(1-p)/p);
}
function closePostMode(){ const o=document.getElementById('post-overlay'); if(o) o.remove(); }
function openPostMode(){
  closePostMode();
  const top = scored.filter(p=>p.playingToday).slice(0,10);
  const chip = (txt,col)=>`<span style="font-family:var(--font-mono);font-size:10px;padding:2px 7px;border-radius:20px;border:1px solid var(--border2);color:${col||'var(--muted)'};white-space:nowrap">${txt}</span>`;
  const rows = top.map((p,i)=>{
    const prob=calibrate(p.prob), pct=Math.round(prob*100)+'%', fair=probToFairOdds(prob);
    const col=probColor(p.prob), adj=adjPF(p.venue), wx=WX[p.venue];
    const gP=(p.hand==='L'&&p.pitcherHand==='R')||(p.hand==='R'&&p.pitcherHand==='L');
    const chips=[
      chip('PF '+adj, adj>=108?'var(--gold)':adj<95?'var(--purple)':'var(--muted)'),
      (wx&&wx.tag)?chip(wx.tag, wx.impact==='boost'?'var(--orange)':wx.impact==='suppress'?'var(--purple)':'var(--muted)'):'',
      gP?chip('✓ PLATOON','var(--green)'):''
    ].filter(Boolean).join('');
    return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--border)">
      <div style="font-family:var(--font-disp);font-size:24px;line-height:1;color:${i<3?'var(--gold2)':'var(--dim)'};width:26px;text-align:center">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-disp);font-size:19px;letter-spacing:.03em;color:var(--text);line-height:1.1">${p.name}</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--muted);margin:3px 0 5px">${p.team} · ${p.game} · vs ${p.pitcher}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${chips}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--font-disp);font-size:30px;line-height:1;color:${col}">${pct}</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--muted);margin-top:1px">HR PROB</div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--dim);margin-top:3px">${fair} fair</div>
      </div>
    </div>`;
  }).join('');

  const o=document.createElement('div');
  o.id='post-overlay';
  o.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);overflow:auto;padding:24px 12px;display:flex;justify-content:center;align-items:flex-start';
  o.innerHTML=`<div style="position:relative;width:100%;max-width:440px">
    <button onclick="closePostMode()" style="position:absolute;top:-10px;right:-2px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:20px;font-family:var(--font-mono);font-size:11px;padding:4px 12px;cursor:pointer;z-index:2">✕ CLOSE</button>
    <div style="font-family:var(--font-mono);font-size:10px;color:var(--muted);text-align:center;margin-bottom:8px">📸 screenshot the card below</div>
    <div id="post-card" style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r-lg);overflow:hidden">
      <div style="padding:16px 14px 12px;background:linear-gradient(135deg,rgba(232,163,32,.12),transparent)">
        <div style="font-family:var(--font-disp);font-size:30px;letter-spacing:.02em;background:linear-gradient(135deg,var(--gold2),var(--orange));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1">D1AKE DINGERS</div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:2px">Top 10 HR Projections · ${fmtDate(SLATE_DATE)}</div>
      </div>
      ${rows}
      <div style="padding:11px 14px;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:9px;line-height:1.5;color:var(--dim)">
        HR PROB = model-calibrated home-run probability (fit on 5,400+ graded games). "Fair" odds restate that probability — they are NOT a sportsbook price and no edge over the market is claimed. For entertainment only, not betting advice. If gambling is a problem, call 1-800-GAMBLER.
      </div>
    </div>
  </div>`;
  document.body.appendChild(o);
}
function injectPostButton(){
  if(document.getElementById('post-mode-btn')) return;
  const b=document.createElement('button');
  b.id='post-mode-btn'; b.textContent='📸 POST';
  b.onclick=openPostMode;
  b.style.cssText='position:fixed;bottom:18px;right:18px;z-index:500;background:var(--gold);color:var(--bg);border:none;border-radius:24px;font-family:var(--font-mono);font-size:12px;font-weight:500;letter-spacing:.04em;padding:10px 16px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)';
  document.body.appendChild(b);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.initAppRan) initApp();
  injectPostButton();
});
