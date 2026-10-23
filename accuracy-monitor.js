/* Brook Forest Weather verification dashboard. Public, read-only statistics; no invented observations. */
(function(){
 'use strict';
 const REMOTE='https://raw.githubusercontent.com/Moldavite333/Brook-Forest-Weather-8700-/main/data/verification.json';
 let last=null,loading=false;
 const $=id=>document.getElementById(id);
 const valid=n=>typeof n==='number'&&Number.isFinite(n);
 const number=(n,d=1)=>valid(n)?n.toFixed(d):'—';
 const sign=n=>valid(n)?(n>0?'+':'')+n.toFixed(1):'—';
 const local=t=>t?new Date(t).toLocaleString('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
 const within=(x,days)=>Date.parse(x.validAt)>=Date.now()-days*86400000;
 function metrics(rows){
   const clean=rows.filter(x=>x.status==='verified'&&valid(x.forecastTempF)&&valid(x.observation?.tempF)&&valid(x.errorF));
   const mean=clean.length?clean.reduce((a,x)=>a+x.errorF,0)/clean.length:null;
   const mae=clean.length?clean.reduce((a,x)=>a+Math.abs(x.errorF),0)/clean.length:null;
   const rmse=clean.length?Math.sqrt(clean.reduce((a,x)=>a+x.errorF*x.errorF,0)/clean.length):null;
   return {count:clean.length,mae,bias:mean,rmse};
 }
 function paint(data){
   const root=$('accuracyBody'),message=$('accuracyInfo');
   if(!root||!message)return;
   if(!data||!Array.isArray(data.records))throw Error('Verification archive invalid');
   const station=data.currentStation,all=data.records;
   const verified=all.filter(x=>x.status==='verified');
   const current=verified.filter(x=>station?.id&&x.observation?.stationId===station.id);
   const currentMonth=current.filter(x=>within(x,30));
   const pending=all.filter(x=>x.status==='pending').length;
   const lastAt=Date.parse(data.collector?.lastAttempt),stale=valid(lastAt)&&Date.now()-lastAt>5*3600000;
   message.textContent=(data.updatedAt?'Last monitor run: '+local(data.collector?.lastAttempt):'Collector starting; no runs recorded')+
    (stale?' · WARNING: collection may be delayed':'')+
    ' · '+all.length+' saved forecast snapshots · '+pending+' awaiting observations';
   $('accuracyStation').textContent=station?
    'Comparison source: '+station.name+' ('+station.id+') · '+number(station.distanceKm,1)+' km away · '+(station.elevationDifferenceFt>0?'+':'')+station.elevationDifferenceFt.toLocaleString()+' ft elevation difference. This is NOT a measurement at the house.':
    'No eligible nearby NWS station has been selected. Verification cannot proceed until a suitable observation source is available.';
   const containers=$('accuracyMetrics');
   containers.innerHTML='';
   for(const lead of [24,48,72]){
     const stat=metrics(currentMonth.filter(x=>x.leadHours===lead));
     const box=document.createElement('div');
     box.className='accuracyMetric';
     box.innerHTML='<div class="eyebrow">'+lead+' HOUR FORECAST</div><div class="accuracyValue">'+(stat.count?number(stat.mae)+'°':'—')+'</div><div class="muted small">Mean absolute error</div><div class="small" style="margin-top:6px">'+stat.count+' verified comparisons</div><div class="small muted">Bias '+(stat.count?sign(stat.bias)+'°F':'—')+'</div>';
     containers.appendChild(box);
   }
   const overview=metrics(currentMonth);
   $('accuracyExplainer').textContent=overview.count?
     'Past 30 days · '+overview.count+' matched station readings · overall MAE '+number(overview.mae)+'°F · forecast bias '+sign(overview.bias)+'°F (positive means predicted too warm). Each forecast is compared with the closest station temperature, not a reanalysis or an updated forecast.':
     'No 24/48/72-hour comparisons are verified yet for the selected station. The first result can only appear after a saved prediction reaches its target time and a valid station observation is available.';
   const body=$('accuracyRows');body.innerHTML='';
   const sorted=[...current].sort((a,b)=>b.validAt.localeCompare(a.validAt)).slice(0,25);
   for(const rec of sorted){
      const row=document.createElement('tr');
      const cells=[local(rec.validAt),rec.leadHours+'h',number(rec.forecastTempF)+'°',number(rec.observation.tempF)+'°',sign(rec.errorF)+'°',rec.observation.stationId];
      for(const value of cells){const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell)}
      body.appendChild(row);
   }
   if(!sorted.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;cell.className='muted';cell.textContent='No matched station temperatures yet. Predictions currently being collected are not counted as verified.';row.appendChild(cell);body.appendChild(row)}
   const link=$('accuracySourceLink');
   if(link)link.href=station?'https://api.weather.gov/stations/'+encodeURIComponent(station.id)+'/observations/latest':'https://www.weather.gov/documentation/services-web-api';
   $('accuracySourceLabel').textContent=station?'View source station observations':'NWS observation API information';
   $('accuracyStatus').textContent=station?(data.collector?.state==='running'?'Monitoring':'Data feed needs attention'):'Awaiting station coverage';
 }
 async function loadAccuracy(force=false){
   if(loading||!$('accuracyBody'))return;
   if(last&&!force){paint(last);return}
   loading=true;
   $('accuracyInfo').textContent='Checking saved predictions against station observations…';
   try{
      let response;
      try{response=await fetch(REMOTE+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(14000)});if(!response.ok)throw Error('HTTP '+response.status)}
      catch(err){response=await fetch('./data/verification.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw err;}
      const data=await response.json();
      if(data.version!==1||!Array.isArray(data.records))throw Error('Invalid archive version');
      last=data;paint(data);
   }catch(err){
      $('accuracyInfo').textContent='Verification history unavailable: '+err.message+'. Check internet or the monitoring workflow.';
      $('accuracyStatus').textContent='Cannot load verification history';
   }finally{loading=false}
 }
 window.loadAccuracy=loadAccuracy;
 window.verifyMetrics=metrics;
})();
