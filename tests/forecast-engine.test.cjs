'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const engineCode=fs.readFileSync('forecast-engine.js','utf8');
const scope={window:{},Date,Intl,Math,Map,Set};
new vm.Script(engineCode,{filename:'forecast-engine.js'}).runInNewContext(scope);
const E=scope.window.ForecastEngine;
assert.ok(E&&typeof E.hourlyConsensus==='function','Forecast engine should expose its API');
const hour=n=>'2026-10-23T'+String(n).padStart(2,'0')+':00';
function model(id,temperatures,popValues){
 const time=temperatures.map((_,i)=>hour(i));
 return{id,_index:new Map(time.map((x,i)=>[x,i])),hourly:{
 time,temperature_2m:temperatures,precipitation_probability:popValues,
 precipitation:temperatures.map(()=>0),snowfall:temperatures.map(()=>0),
 weather_code:temperatures.map((_,i)=>i===2?71:0),is_day:temperatures.map((_,i)=>i===2?1:0),
 relative_humidity_2m:temperatures.map(()=>60),wind_speed_10m:temperatures.map(()=>3),
 wind_gusts_10m:temperatures.map(()=>8)
 }};
}
const hr=model('ncep_hrrr_conus',[29,31,36],[5,15,30]);
const ec=model('ecmwf_ifs',[40,42,44],[40,30,40]);
const hrs=E.hourlyConsensus([hr,ec],[],hour(0));
assert.equal(hrs.length,3);
assert.ok(hrs[0].temp<34,'Short-range HRRR should outweigh global guidance');
assert.equal(hrs[0].modelCount,2);
assert.ok([0,2,3,61,71,95].includes(hrs[2].code),'WMO codes should be categorical, not numerically averaged');
assert.equal(E.wt('ncep_hrrr_conus',200),0,'HRRR should not influence later periods');
assert.equal(E.leadDays('2026-11-10','2026-10-23'),18);
assert.equal(E.mountainKey('2026-10-23T06:00:00Z'),'2026-10-23T00:00');
const noPop=model('ncep_hrrr_conus',[29,31,36],[null,null,null]);
assert.equal(E.hourlyConsensus([noPop],[],hour(0))[0].pop,null,'Missing PoP must remain unknown, not zero');
const nws=Array.from({length:24},(_,i)=>({
 startTime:'2026-10-23T'+String(i).padStart(2,'0')+':00:00-06:00',
 temperature:30+i/8,temperatureUnit:'F',isDaytime:i>=7&&i<=18,
 shortForecast:'Mostly Clear',probabilityOfPrecipitation:{value:10}
}));
const fromNws=E.hourlyConsensus([],nws,hour(0));
assert.equal(fromNws.length,24,'NWS alone should populate hourly forecast');
assert.equal(fromNws[0].modelCount,0);
assert.equal(fromNws[0].sourceCount,1);
assert.equal(Math.round(fromNws[0].temp),30);
const nwsDays=E.buildDays(fromNws,[],[],nws,'2026-10-23');
assert.ok(nwsDays[0].nwsIncluded&&nwsDays[0].sourceCount===1,'NWS-only daily guidance should remain visible');
const ensembles=[{id:'GEFS',daily:{time:['2026-11-10'],temperature_2m_max:[45],temperature_2m_min:[25],precipitation_sum:[0.02],snowfall_sum:[0]}}];
const extended=E.buildDays(hrs,[hr,ec],ensembles,[],'2026-10-23');
const day18=extended.find(x=>x.date==='2026-11-10');
assert.ok(day18&&day18.tier==='outlook'&&day18.ensembleHi===45);
assert.equal(day18.modelCount,0);
assert.equal(E.agreement(day18).label,'OUTLOOK','Month outlook cannot claim high confidence');
const html=fs.readFileSync('index.html','utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline,'App should have an inline JavaScript entry');
new vm.Script(inline[1],{filename:'index.html:script'});
assert.ok(html.includes('<script src="./forecast-engine.js"></script>'),'HTML should load forecast core');
assert.ok(html.includes('id="monthDetail"'),'Monthly outlook should include day details');
assert.ok(html.includes("ncep_gefs05_ensemble_mean"),'GEFS 0.5-degree model should provide the 35-day feed');
const sw=fs.readFileSync('sw.js','utf8');
new vm.Script(sw,{filename:'sw.js'});
assert.ok(sw.includes("'./forecast-engine.js'"),'Offline cache should contain the forecast engine');
console.log('Weather engine regression checks passed: blending, NWS, missing values, month, JavaScript syntax, PWA shell.');
