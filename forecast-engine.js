/* Brook Forest Weather forecast core, v4. Source-weighted guidance; not a calibrated accuracy guarantee. */
window.ForecastEngine=(function forecastFactory(){
  "use strict";
  const modelWeights = {
    "ncep_hrrr_conus":[4.2,2.5,0,0],"ncep_nbm_conus":[3.5,3.1,2.8,0],
    "ncep_nam_conus":[3.0,1.8,0,0],"best_match":[1.2,1.0,.6,0],
    "ecmwf_ifs":[1.9,2.8,3.1,3.0],"ncep_gfs_global":[1.4,1.7,2.0,2.2],
    "icon_global":[1.0,1.2,1.4,1.1],"cmc_gem_rdps":[1.4,1.2,.8,0],
    "ukmo_global_deterministic_10km":[1.3,1.6,1.7,1.3],
    "ecmwf_aifs025_single":[.7,1.2,1.5,1.7]
  };
  const valid = n=>typeof n==="number"&&Number.isFinite(n);
  const avg = a => {const v=a.filter(valid);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
  const sum = a => a.filter(valid).reduce((a,b)=>a+b,0);
  const min = a => {const v=a.filter(valid);return v.length?Math.min(...v):null;};
  const max = a => {const v=a.filter(valid);return v.length?Math.max(...v):null;};
  function dNumber(s){const d=String(s||"").slice(0,10);return Date.parse(d+"T12:00:00Z");}
  function leadDays(date,today){return Math.round((dNumber(date)-dNumber(today))/86400000);}
  function leadHours(time,now){const a=String(time).slice(0,13),b=String(now).slice(0,13);return (Date.parse(a+":00:00Z")-Date.parse(b+":00:00Z"))/3600000;}
  function wt(id,h){const weights=modelWeights[id]||[1,1,1,1];const idx=h<=48?0:h<=120?1:h<=240?2:3;return weights[idx];}
  function wAvg(items,key){let total=0,weights=0;for(const x of items){if(valid(x[key])&&x.w>0){total+=x[key]*x.w;weights+=x.w;}}return weights?total/weights:null;}
  function wSD(items,key){const m=wAvg(items,key);if(m===null)return null;let total=0,weights=0;for(const x of items){if(valid(x[key])&&x.w>0){total+=x.w*(x[key]-m)**2;weights+=x.w;}}return weights?Math.sqrt(total/weights):null;}
  function classifyCode(code){if(!valid(code))return null;if(code>=95)return "storm";if(code>=71&&code<=86)return "snow";if(code>=51&&code<=67)return "rain";if(code>=45&&code<=48)return "fog";if(code===3)return "cloudy";if(code===2)return "partly";return "clear";}
  function codeFromText(s){if(!s)return null;const t=s.toLowerCase();if(/thunder/.test(t))return 95;if(/snow|blizzard|flurr/.test(t))return 71;if(/rain|drizzle|shower/.test(t))return 61;if(/fog|mist/.test(t))return 45;if(/overcast|cloudy/.test(t)&&!/partly|mostly sunny|mostly clear/.test(t))return 3;if(/partly|mostly sunny|mostly clear/.test(t))return 2;if(/sun|clear/.test(t))return 0;return null;}
  function dominantCode(rows){const counts=new Map();for(const e of rows){const cat=classifyCode(e.code);if(cat&&e.w>0)counts.set(cat,(counts.get(cat)||0)+e.w);}if(!counts.size)return null;const cat=[...counts].sort((a,b)=>b[1]-a[1])[0][0];return {storm:95,snow:71,rain:61,fog:45,cloudy:3,partly:2,clear:0}[cat];}
  function mountainKey(ts,tz="America/Denver"){const parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ts));const obj=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${obj.year}-${obj.month}-${obj.day}T${obj.hour}:00`;}
  function nwsMap(periods,tz){const m=new Map();for(const p of periods||[]){if(!p.startTime)continue;const t=mountainKey(p.startTime,tz);const temp=p.temperatureUnit==="C"?p.temperature*9/5+32:p.temperature;const pop=p.probabilityOfPrecipitation?.value;m.set(t,{id:"nws",w:2.8,temp:valid(temp)?temp:null,pop:valid(pop)?pop:null,code:codeFromText(p.shortForecast),isDay:p.isDaytime?1:0,precip:null,snowCm:null});}return m;}
  function hourlyConsensus(models,periods,nowHour,tz="America/Denver"){
    const weatherNws=nwsMap(periods,tz);
    const times=[...new Set([...models.flatMap(m=>m.hourly?.time||[]),...weatherNws.keys()])].sort();
    return times.map(t=>{
      const ahead=leadHours(t,nowHour), entries=[];
      for(const m of models){const i=m._index.get(t);if(i==null)continue;const a=m.hourly||{},get=k=>valid(a[k]?.[i])?a[k][i]:null;
        const temp=get("temperature_2m");if(!valid(temp)||temp < -90||temp>135)continue;
        const w=wt(m.id,ahead);if(!w)continue;
        entries.push({id:m.id,w,temp,rh:get("relative_humidity_2m"),precip:get("precipitation"),pop:get("precipitation_probability"),snowCm:get("snowfall"),cloud:get("cloud_cover"),wind:get("wind_speed_10m"),gust:get("wind_gusts_10m"),code:get("weather_code"),isDay:get("is_day")});
      }
      const nws=weatherNws.get(t);if(nws&&ahead>=-1&&ahead<=168)entries.push({...nws,w:ahead<=96?3.2:2.3});
      const independents=entries.filter(x=>x.id!=="best_match");
      return {time:t,temp:wAvg(entries,"temp"),rh:wAvg(entries,"rh"),precip:wAvg(entries,"precip"),pop:wAvg(entries,"pop"),snowCm:wAvg(entries,"snowCm"),cloud:wAvg(entries,"cloud"),wind:wAvg(entries,"wind"),gust:wAvg(entries,"gust"),tempSD:wSD(independents,"temp"),precipSD:wSD(independents,"precip"),snowSD:wSD(independents,"snowCm"),code:dominantCode(entries),isDay:wAvg(entries,"isDay")>=.5?1:0,modelCount:independents.filter(x=>x.id!=="nws").length,sourceCount:independents.length,nwsIncluded:!!nws};
    }).filter(x=>valid(x.temp));
  }
  function buildDays(hours,models,ensembles,periods,today,tz="America/Denver"){
    const ensemblesByDate=new Map();
    for(const e of ensembles||[]){const daily=e.daily||{}, dates=daily.time||[];dates.forEach((date,i)=>{
      const hi=daily.temperature_2m_max?.[i],lo=daily.temperature_2m_min?.[i],p=daily.precipitation_sum?.[i],snow=daily.snowfall_sum?.[i];
      if(!valid(hi)||!valid(lo))return;const item={id:e.id,hi,lo,p:valid(p)?p:null,snow:valid(snow)?snow/2.54:null};
      if(!ensemblesByDate.has(date))ensemblesByDate.set(date,[]);ensemblesByDate.get(date).push(item);
    });}
    const nwsD=nwsMap(periods,tz);const allDates=[...new Set([...hours.map(h=>h.time.slice(0,10)),...ensemblesByDate.keys()])].sort();
    return allDates.map(date=>{
      const ahead=leadDays(date,today),h=hours.filter(x=>x.time.slice(0,10)===date);
      const candidates=[];
      for(const m of models){const index=(m.hourly?.time||[]).map((t,i)=>t.slice(0,10)===date?i:-1).filter(i=>i>=0),a=m.hourly||{};
        const ts=index.map(i=>a.temperature_2m?.[i]).filter(valid);if(ts.length<3)continue;
        const w=wt(m.id,ahead*24+12);if(!w)continue;
        const pr=index.map(i=>a.precipitation?.[i]),snow=index.map(i=>a.snowfall?.[i]),pops=index.map(i=>a.precipitation_probability?.[i]);
        candidates.push({id:m.id,w,hi:max(ts),lo:min(ts),p:pr.some(valid)?sum(pr):null,snow:snow.some(valid)?sum(snow)/2.54:null,g:max(index.map(i=>a.wind_gusts_10m?.[i])),pop:max(pops)});
      }
      const nwsp=[...nwsD].filter(([key])=>key.slice(0,10)===date).map(([,v])=>v),temps=nwsp.map(x=>x.temp).filter(valid);
      if(temps.length>=(ahead===0?3:12))candidates.push({id:"nws",w:ahead<=4?2.5:1.9,hi:max(temps),lo:min(temps),p:null,snow:null,g:null,pop:max(nwsp.map(x=>x.pop))});
      const ens=ensemblesByDate.get(date)||[], ensHi=avg(ens.map(x=>x.hi)),ensLo=avg(ens.map(x=>x.lo)),ensPrecip=avg(ens.map(x=>x.p)),ensSnow=avg(ens.map(x=>x.snow));
      const hasReal=candidates.some(x=>x.id!=="best_match");
      const indep=candidates.filter(x=>x.id!=="best_match"),near=hasReal?candidates:[];
      const hi=wAvg(near,"hi"),lo=wAvg(near,"lo"),precip=wAvg(near,"p"),snow=wAvg(near,"snow"),gust=wAvg(near,"g"),pop=wAvg(near,"pop");
      const noon=h.find(x=>x.time.endsWith("T13:00"))||h.find(x=>x.time.endsWith("T12:00"))||h[Math.floor(h.length/2)];
      return {date,lead:ahead,hi:valid(hi)?hi:ensHi,lo:valid(lo)?lo:ensLo,precip:valid(precip)?precip:ensPrecip,snow:valid(snow)?snow:ensSnow,gust,pop,hiSD:wSD(indep,"hi"),loSD:wSD(indep,"lo"),precipRange:[min(indep.map(x=>x.p)),max(indep.map(x=>x.p))],snowRange:[min(indep.map(x=>x.snow)),max(indep.map(x=>x.snow))],hiRange:[min(indep.map(x=>x.hi)),max(indep.map(x=>x.hi))],loRange:[min(indep.map(x=>x.lo)),max(indep.map(x=>x.lo))],modelCount:indep.filter(x=>x.id!=="nws").length,sourceCount:indep.length,nwsIncluded:indep.some(x=>x.id==="nws"),ensembleCount:ens.length,ensembleHi:ensHi,ensembleLo:ensLo,ensemblePrecip:ensPrecip,ensembleSnow:ensSnow,ensembleRange:[min(ens.map(x=>x.hi)),max(ens.map(x=>x.hi))],code:noon?.code??null,tier:ahead<=3?"near":ahead<=7?"medium":ahead<=15?"extended":"outlook"};
    });
  }
  function agreement(day){
    if(!day)return{score:0,label:"UNAVAILABLE"};
    if(day.lead>=16)return{score:0,label:"OUTLOOK"};
    if(day.lead>=8)return{score:0,label:"LOW · EXTENDED"};
    const spread=valid(day.hiSD)?day.hiSD:8,low=valid(day.loSD)?day.loSD:8;
    const start=day.lead<=2?90:day.lead<=4?80:72;
    const score=Math.max(28,Math.min(92,Math.round(start-(spread*3+low*2)-(day.sourceCount<3?12:0))));
    return{score,label:score>=75?"HIGH AGREEMENT":score>=55?"MED AGREEMENT":"LOW AGREEMENT"};
  }
  return {modelWeights,wt,leadDays,leadHours,mountainKey,nwsMap,dominantCode,hourlyConsensus,buildDays,agreement};
})();
