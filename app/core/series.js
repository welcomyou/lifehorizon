'use strict';
/* [core/series.js] Cầu nối model ↔ state + kiểm tra rủi ro.
   QUYỀN GHI state (nơi duy nhất ngoài persist.js): state.series, state.seriesV,
   state.seriesMeta[key].cagr (đồng bộ lại khi đổi kỳ), state.seriesSeeds (regenerateSeries).
   ĐỌC: state.simYears/scenarioSeed/seriesSeeds/seriesMeta/infl/birthYear. riskCheck chạy runSim
   với world mới mỗi kịch bản và seed ngẫu nhiên mới mỗi lượt — không ép CAGR, không đổi state. */
function ensureSeries(){
  if(!Number.isInteger(state.simYears)||state.simYears<1||state.simYears>100) return;
  var count=state.simYears*12, world=makeWorld(state.scenarioSeed,state.simYears);
  SERIES_KEYS.forEach(function(key){
    var arr=state.series[key]||[], meta=state.seriesMeta[key];
    if(!isFinite(meta.cagr)||meta.cagr<-.65||meta.cagr>.8||!isFinite(meta.sigma)||meta.sigma<0||meta.sigma>.8) return;
    if(!arr.length) state.series[key]=generateMonthly(key,meta,state.simYears,state.seriesSeeds[key],world,true);
    else if(arr.length!==count){
      var added=generateMonthly(key,meta,state.simYears,state.seriesSeeds[key],world,false);
      state.series[key]=arr.slice(0,count).concat(added.slice(arr.length,count));
      // Retain the existing path when the horizon changes; risk scenarios use its new center.
      meta.cagr=Math.max(-.65,Math.min(.8,annualCAGR(state.series[key])));
    }
  });
  state.seriesV=MODEL_VERSION;
}
function regenerateSeries(key, newSeed){
  if(newSeed) state.seriesSeeds[key]=Math.floor(Math.random()*0x7fffffff);
  state.series[key]=generateMonthly(key,state.seriesMeta[key],state.simYears,state.seriesSeeds[key],makeWorld(state.scenarioSeed,state.simYears),true);
}
function riskCheck(nRuns,withBhxh,seed){
  nRuns=nRuns||1000; withBhxh=withBhxh!==false;
  // Mỗi lượt người dùng chạy lấy seed mới. Seed tường minh chỉ phục vụ kiểm thử tái lập;
  // seed 0 giữ bộ đường cũ để golden vẫn kiểm tra đúng mọi công thức dòng tiền.
  if(seed===undefined||seed===null){
    seed=typeof crypto!=='undefined'&&typeof crypto.getRandomValues==='function'
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random()*0x100000000);
  }
  seed=seed>>>0;
  var liq=[], ages=[], shortTot=0, disc=Math.pow(1+state.infl/100,state.simYears);
  for(var i=0;i<nRuns;i++){
    var world=makeWorld((770900+seed+i*7)>>>0,state.simYears), sr={};
    SERIES_KEYS.forEach(function(key,j){ sr[key]=generateMonthly(key,state.seriesMeta[key],state.simYears,(777001+seed+i*3+j)>>>0,world,false); });
    var sim=runSim(withBhxh,{series:sr,compact:true}), last=sim.years[sim.years.length-1];
    liq.push(last.end.liquid/disc);
    if(sim.firstShort>=0){ ages.push(Math.floor(sim.firstShort/12)-state.birthYear); shortTot+=sim.shortfall; }
  }
  liq.sort(function(a,b){return a-b;}); ages.sort(function(a,b){return a-b;});
  function quantile(p){var x=p*(liq.length-1), i=Math.floor(x);return liq[i]+(liq[Math.min(i+1,liq.length-1)]-liq[i])*(x-i);}
  return {n:nRuns,p10:quantile(.1),p50:quantile(.5),p90:quantile(.9),runOutRate:ages.length/nRuns,medianRunOutAge:ages.length?ages[Math.floor((ages.length-1)/2)]:null,avgShortfall:shortTot/Math.max(1,ages.length)};
}
