/* User-entered house measurements are separate from automatic station data. */
(function(){
'use strict';
const KEY='bf-house-observations-v1', el=id=>document.getElementById(id);
const valid=n=>typeof n==='number'&&Number.isFinite(n);
function readings(){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a.filter(x=>valid(x.tempF)&&typeof x.localTime==='string'):[]}catch{return[]}}
function put(a){localStorage.setItem(KEY,JSON.stringify(a.slice(-400)))}
function mountainNow(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const t=Object.fromEntries(p.map(v=>[v.type,v.value]));return t.year+'-'+t.month+'-'+t.day+'T'+t.hour+':'+t.minute}
function ms(t){return Date.parse(String(t)+(/Z|[+-]\d\d:\d\d$/.test(t)?'':'Z'))}
function matched(archive){
 const actual=readings(),res=[];
 for(const r of archive.records||[]){
  if(!valid(r.forecastTempF)||!r.localHour)continue;
  if(Date.parse(r.validAt)>Date.now()+1200000)continue;
  const choices=actual.filter(x=>Math.abs(ms(x.localTime)-ms(r.localHour))<=45*60000).sort((a,b)=>Math.abs(ms(a.localTime)-ms(r.localHour))-Math.abs(ms(b.localTime)-ms(r.localHour)));
  if(choices.length){const a=choices[0];res.push({...r,houseObservation:a,houseError:Math.round((r.forecastTempF-a.tempF)*10)/10})}
 }
 return res;
}
function show(archive){
 if(!el('homeObsPanel'))return;
 const time=el('homeObsTime');if(!time.value)time.value=mountainNow();
 const actual=readings(),pairs=matched(archive),metric=el('houseAccuracyMetrics');metric.replaceChildren();
 for(const lead of [24,48,72]){
  const rows=pairs.filter(x=>x.leadHours===lead);
  const mae=rows.length?rows.reduce((s,x)=>s+Math.abs(x.houseError),0)/rows.length:null;
  const bias=rows.length?rows.reduce((s,x)=>s+x.houseError,0)/rows.length:null;
  const item=document.createElement('div');item.className='accuracyMetric';
  const title=document.createElement('div');title.className='eyebrow';title.textContent=lead+' HOUR';
  const value=document.createElement('div');value.className='accuracyValue';value.textContent=mae===null?'—':mae.toFixed(1)+'°';
  const notes=document.createElement('div');notes.className='small muted';notes.textContent=rows.length+' matched · Bias '+(bias===null?'—':(bias>0?'+':'')+bias.toFixed(1)+'°');
  item.append(title,value,notes);metric.append(item);
 }
 el('homeObsInfo').textContent=actual.length+' manually entered readings on this device · '+pairs.length+' matched forecast comparisons. Recorded temperatures are not automatically collected or shared.';
 const next=(archive.records||[]).filter(x=>x.leadHours===24&&Date.parse(x.validAt)>Date.now()).sort((a,b)=>a.validAt.localeCompare(b.validAt))[0];
 el('homeObsNext').textContent=next?'Next 24-hour verification checkpoint: '+new Date(next.validAt).toLocaleString('en-US',{timeZone:'America/Denver',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MT.':'No upcoming checkpoints loaded yet.';
 const body=el('homeObsRows');body.replaceChildren();
 for(const r of [...pairs].sort((a,b)=>b.validAt.localeCompare(a.validAt)).slice(0,15)){
  const tr=document.createElement('tr'),vals=[r.localHour.replace('T',' '),r.leadHours+'h',r.forecastTempF.toFixed(1)+'°',r.houseObservation.tempF.toFixed(1)+'°',(r.houseError>0?'+':'')+r.houseError.toFixed(1)+'°'];
  vals.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});body.append(tr);
 }
 if(!body.children.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No matching house readings yet. Log a thermometer reading near a forecast checkpoint.';tr.append(td);body.append(tr)}
 const list=el('homeObsList');list.replaceChildren();
 for(const entry of [...actual].reverse().slice(0,5)){
  const line=document.createElement('div');line.className='homeObsSaved';
  const lbl=document.createElement('span');lbl.textContent=entry.localTime.replace('T',' ')+' · '+entry.tempF.toFixed(1)+'°F';
  const del=document.createElement('button');del.className='ghostBtn';del.textContent='Delete';del.onclick=()=>{put(readings().filter(x=>x.id!==entry.id));show(archive)};
  line.append(lbl,del);list.append(line);
 }
 if(!actual.length)list.textContent='No house readings saved yet.';
}
function save(event){
 if(event)event.preventDefault();
 const time=el('homeObsTime').value,temp=Number(el('homeObsTemp').value),msg=el('homeObsMessage');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)||!valid(temp)||temp< -60||temp>130){msg.textContent='Enter a valid date/time and temperature from -60° to 130°F.';return false}
 if(ms(time)>ms(mountainNow())+1200000){msg.textContent='Future temperatures cannot be saved as actual observations.';return false}
 const entries=readings(),i=entries.findIndex(x=>Math.abs(ms(x.localTime)-ms(time))<10*60000);
 const record={id:i>=0?entries[i].id:String(Date.now()),localTime:time,tempF:Math.round(temp*10)/10,recordedAt:new Date().toISOString(),source:'user-entered house thermometer'};
 if(i>=0)entries.splice(i,1);
 entries.push(record);entries.sort((a,b)=>a.localTime.localeCompare(b.localTime));put(entries);
 msg.textContent='Saved on this device. Readings only match forecasts within 45 minutes of the target hour.';
 if(window.accuracyArchive)show(window.accuracyArchive);
 return false;
}
window.HomeObservations={show,save,readings,matched};
})();
