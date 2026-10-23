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
assert.equal(E.dominantCode([{code:80,w:1}]),61,'WMO code 80 is rain showers, not snow');
assert.equal(E.dominantCode([{code:85,w:1}]),71,'WMO code 85 is snow showers');
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
const collectorText=fs.readFileSync('scripts/forecast-monitor.cjs','utf8');
new vm.Script(collectorText,{filename:'scripts/forecast-monitor.cjs'});
const collector=require('../scripts/forecast-monitor.cjs');
assert.ok(collector.MODELS.length>=8,'Monitoring must use broad model coverage');
assert.equal(collector.distanceKm(collector.HOME.lat,collector.HOME.lon),0);
const site={properties:{stationIdentifier:'XTEST',name:'Home-height station',elevation:{value:2652}},geometry:{coordinates:[collector.HOME.lon,collector.HOME.lat]}};
const ref=collector.candidate(site);
assert.ok(ref&&Math.abs(ref.elevationDifferenceFt)<50,'Station elevation filtering should accept house-height observations');
const data=collector.empty(),validAt='2024-01-01T19:00:00.000Z';
const sample={issuedAt:'2023-12-31T19:00:00.000Z',validAt,leadHours:24,localHour:'2024-01-01T12:00',forecastTempF:34,status:'pending'};
const obs=[{time:'2024-01-01T19:00:00.000Z',ms:Date.parse(validAt),tempF:30}];
const count=collector.updateRecords(data,[sample],obs,ref,Date.parse(validAt)+3600000);
assert.equal(count,1,'A measured observation should verify a saved issued forecast');
assert.equal(data.records[0].errorF,4,'Forecast error sign should be predicted minus measured');
assert.equal(data.records[0].observation.kind,'nearby NWS station (not house)');
const jsHouse=fs.readFileSync('home-observations.js','utf8');
new vm.Script(jsHouse,{filename:'home-observations.js'});
const storage=new Map();
storage.set('bf-house-observations-v1',JSON.stringify([{id:'1',tempF:30,localTime:'2024-01-01T12:10'}]));
const houseContext={window:{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v)},Date,Intl,Math,document:{}};
vm.runInNewContext(jsHouse,houseContext);
const matching=houseContext.window.HomeObservations.matched({records:[sample]});
assert.equal(matching.length,1,'Manual readings near a checkpoint should match a forecast');
assert.equal(matching[0].houseError,4,'Home temperature comparisons should retain direction and magnitude');
const jsAccuracy=fs.readFileSync('accuracy-monitor.js','utf8');
new vm.Script(jsAccuracy,{filename:'accuracy-monitor.js'});
assert.ok(html.includes('id="homeObsPanel"')&&html.includes('id="forecast-accuracy"'),'Accuracy and manual-entry views should be present');
assert.ok(sw.includes('forecast-engine.js'),'Offline worker should retain the forecasting engine');
console.log('Accuracy-monitor regressions passed: sensor labeling, saved snapshots, manual observations and frontend syntax.');

console.log('Weather engine regression checks passed: blending, NWS, missing values, month, JavaScript syntax, PWA shell.');
