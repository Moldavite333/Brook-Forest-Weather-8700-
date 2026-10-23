#!/usr/bin/env node
/* Brook Forest forecast verification collector: honest issued forecasts vs nearby measured observations. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setTimeout:delay}=require('node:timers/promises');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data','verification.json');
const HOME={lat:39.5794,lon:-105.3819,elevationFt:8700,tz:'America/Denver'};
const MODELS=[
 ['ncep_hrrr_conus','HRRR'],['ncep_nbm_conus','NBM'],['ncep_nam_conus','NAM'],
 ['ncep_gfs_global','GFS'],['ecmwf_ifs','ECMWF'],['icon_global','ICON'],
 ['cmc_gem_rdps','GEM RDPS'],['ukmo_global_deterministic_10km','UKMO'],
 ['ecmwf_aifs025_single','ECMWF AIFS'],['best_match','Terrain Best Match']
];
const LEADS=[24,48,72],DAY_MS=86400000,HOUR_MS=3600000;
const provider='BrookForestWeatherForecastMonitor/1.0 (https://github.com/Moldavite333/Brook-Forest-Weather-8700-)';
const round=(n,places=1)=>Number(n.toFixed(places));
const valid=n=>typeof n==='number'&&Number.isFinite(n);
function engine(){
 const source=fs.readFileSync(path.join(ROOT,'forecast-engine.js'),'utf8');
 const context={window:{},Date,Intl,Math,Map,Set,URL};
 vm.runInNewContext(source,context,{filename:'forecast-engine.js',timeout:10000});
 if(!context.window.ForecastEngine)throw Error('Forecast engine missing');
 return context.window.ForecastEngine;
}
async function json(url,headers={},timeoutMs=16000){
 const response=await fetch(url,{headers:{'User-Agent':provider,Accept:'application/geo+json',...headers},signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error(new URL(url).hostname+' HTTP '+response.status);
 return response.json();
}
const weatherCode='temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,weather_code,is_day';
async function fetchModel([id,label]){
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 Object.entries({latitude:HOME.lat,longitude:HOME.lon,elevation:2652,timezone:HOME.tz,temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',forecast_days:5,models:id,hourly:weatherCode}).forEach(([k,v])=>url.searchParams.set(k,v));
 const obj=await json(url.toString(),{Accept:'application/json'});
 if(!Array.isArray(obj.hourly?.time))throw Error(id+' missing hourly timeline');
 return{id,label,...obj,_index:new Map(obj.hourly.time.map((t,i)=>[t,i]))};
}
async function nwsPoint(){
 try{const point=await json('https://api.weather.gov/points/'+HOME.lat+','+HOME.lon);return point.properties||{}}
 catch(e){console.warn('NWS point feed unavailable:',e.message);return{}}
}
async function nwsHourly(point){
 try{const j=point.forecastHourly?await json(point.forecastHourly):null;return j?.properties?.periods||[]}
 catch(e){console.warn('NWS hourly unavailable:',e.message);return[]}
}
function distanceKm(lat,lon){
 const r=6371,a1=HOME.lat*Math.PI/180,a2=lat*Math.PI/180,dl=(lat-HOME.lat)*Math.PI/180,do2=(lon-HOME.lon)*Math.PI/180;
 const a=Math.sin(dl/2)**2+Math.cos(a1)*Math.cos(a2)*Math.sin(do2/2)**2;return 2*r*Math.asin(Math.sqrt(a));
}
function candidate(s){
 const p=s.properties||{},c=s.geometry?.coordinates||[];
 const lon=Number(c[0]),lat=Number(c[1]),e=p.elevation?.value*3.28084;
 if(!valid(lat)||!valid(lon)||!valid(e)||!p.stationIdentifier)return null;
 const distance=distanceKm(lat,lon),difference=e-HOME.elevationFt;
 if(distance>60||Math.abs(difference)>2000)return null;
 return{id:p.stationIdentifier,name:p.name||p.stationIdentifier,distanceKm:round(distance,1),elevationFt:Math.round(e),elevationDifferenceFt:Math.round(difference),score:distance*1.3+Math.abs(difference)/90};
}
async function chooseStation(point,preferred){
 if(!point.observationStations)return null;
 try{
  const stations=await json(point.observationStations),available=(stations.features||[]).map(candidate).filter(Boolean).sort((a,b)=>a.score-b.score);
  const keep=available.find(s=>s.id===preferred);
  return keep||available[0]||null;
 }catch(e){console.warn('Station catalog unavailable:',e.message);return null}
}
function parseObservations(features){
 return(features||[]).map(f=>{
  const p=f.properties||{},stamp=Date.parse(p.timestamp),tempC=p.temperature?.value;
  if(!valid(stamp)||!valid(tempC)||tempC< -65||tempC>60)return null;
  return{time:new Date(stamp).toISOString(),ms:stamp,tempF:round(tempC*9/5+32)};
 }).filter(Boolean);
}
async function fetchObservations(station,now){
 const end=new Date(now+60000).toISOString(),start=new Date(now-6*DAY_MS).toISOString();
 const uri=new URL('https://api.weather.gov/stations/'+encodeURIComponent(station.id)+'/observations');
 uri.searchParams.set('start',start);uri.searchParams.set('end',end);uri.searchParams.set('limit','500');
 try{const obj=await json(uri.toString());return parseObservations(obj.features)}
 catch(e){console.warn('Observations unavailable for '+station.id+':',e.message);return[]}
}
function empty(){
 return{version:1,location:HOME,updatedAt:null,currentStation:null,collector:{state:'starting',lastAttempt:null,lastPredictionCapture:null,lastObservation:null,modelFeeds:0,nwsForecast:false,notes:[]},records:[]};
}
function load(){
 try{const data=JSON.parse(fs.readFileSync(DATA,'utf8'));if(data.version!==1||!Array.isArray(data.records))throw Error('unrecognized file');return data}
 catch(e){if(e.code==='ENOENT')return empty();throw e}
}
function updateRecords(data,forecasts,observations,station,now){
 const cutoff=now-90*DAY_MS;
 const existing=new Set(data.records.map(x=>[x.issuedAt,x.validAt,x.leadHours].join('|')));
 for(const forecast of forecasts){
  const key=[forecast.issuedAt,forecast.validAt,forecast.leadHours].join('|');
  if(!existing.has(key)){data.records.push(forecast);existing.add(key)}
 }
 let verified=0;
 for(const record of data.records){
  if(record.status==='verified'||record.status==='expired')continue;
  const target=Date.parse(record.validAt);
  if(now<target+15*60000)continue;
  if(station){
   const nearby=observations.filter(o=>Math.abs(o.ms-target)<=55*60000).sort((a,b)=>Math.abs(a.ms-target)-Math.abs(b.ms-target));
   if(nearby.length){
    const observed=nearby[0];
    record.status='verified';
    record.observation={time:observed.time,tempF:observed.tempF,stationId:station.id,stationName:station.name,stationElevationFt:station.elevationFt,stationElevationDifferenceFt:station.elevationDifferenceFt,stationDistanceKm:station.distanceKm,kind:'nearby NWS station (not house)'};
    record.errorF=round(record.forecastTempF-observed.tempF);
    verified++;
    continue;
   }
  }
  if(now-target>7*DAY_MS)record.status='expired';
 }
 data.records=data.records.filter(x=>Date.parse(x.validAt)>=cutoff).sort((a,b)=>a.issuedAt.localeCompare(b.issuedAt)||a.leadHours-b.leadHours);
 return verified;
}
async function main(){
 const started=Date.now(),data=load(),attempt=new Date(started).toISOString();
 const source=engine();
 const point=await nwsPoint(),results=await Promise.allSettled([nwsHourly(point),...MODELS.map(fetchModel)]);
 const nwsp=results[0].status==='fulfilled'?results[0].value:[];
 const models=results.slice(1).filter(x=>x.status==='fulfilled').map(x=>x.value);
 for(const result of results.slice(1))if(result.status==='rejected')console.warn('Model unavailable:',result.reason?.message);
 const slot=Math.floor(started/HOUR_MS)*HOUR_MS;
 const localSlot=source.mountainKey(new Date(slot).toISOString(),HOME.tz);
 const consensus=source.hourlyConsensus(models,nwsp,localSlot,HOME.tz);
 const forecasts=[];
 for(const lead of LEADS){
  const validAt=new Date(slot+lead*HOUR_MS).toISOString();
  const local=source.mountainKey(validAt,HOME.tz);
  const item=consensus.find(x=>x.time===local);
  if(!item||!valid(item.temp)||item.sourceCount<1)continue;
  forecasts.push({issuedAt:new Date(slot).toISOString(),capturedAt:attempt,validAt,localHour:local,leadHours:lead,forecastTempF:round(item.temp),modelCount:item.modelCount,sourceCount:item.sourceCount,nwsIncluded:item.nwsIncluded,status:'pending'});
 }
 const station=await chooseStation(point,data.currentStation?.id);
 const observations=station?await fetchObservations(station,started):[];
 const nVerified=updateRecords(data,forecasts,observations,station,started);
 data.currentStation=station||data.currentStation||null;
 const lastObs=observations[0]?.time||null;
 data.updatedAt=attempt;
 data.collector={state:forecasts.length?'running':'forecast unavailable',lastAttempt:attempt,lastPredictionCapture:forecasts.length?attempt:data.collector.lastPredictionCapture,lastObservation:lastObs||data.collector.lastObservation,modelFeeds:models.length,nwsForecast:!!nwsp.length,notes:[!station?'No suitable NWS station within 60 km and ±2000 ft; station verification unavailable.':'Measurements are from a nearby station, NOT the house.']};
 fs.mkdirSync(path.dirname(DATA),{recursive:true});
 fs.writeFileSync(DATA,JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({captured:forecasts.length,verified:nVerified,rows:data.records.length,models:models.length,nws:nwsp.length,station:station?.id||'none',observations:observations.length},null,2));
 if(!forecasts.length)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error('Monitor collector failed:',e);process.exitCode=1});
module.exports={HOME,MODELS,LEADS,candidate,parseObservations,updateRecords,empty,engine,load,distanceKm};
