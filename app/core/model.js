'use strict';
/* [core/model.js] Mô hình lợi suất kịch bản — THUẦN: không đọc/ghi state, không đụng DOM.
   Đầu vào/đầu ra đều qua tham số (seed, meta, years, world). Người gọi: core/series.js, UI Tab 6, test.
   Quy tắc mô hình: xem AGENTS.md mục 5. */
/* Forward scenarios: monthly shared regimes + Student-t shocks + GARCH volatility.
   Project rules, model assumptions and sources: ../AGENTS.md.
   CAGR is central log growth; sigma is the target annualized monthly log volatility.
   These are scenario assumptions, not fitted probabilities of the future. */
var MODEL_VERSION = 3;
var SERIES_KEYS = ['gold', 'cp', 'land'];
function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; var t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function gauss(rnd){ return Math.sqrt(-2*Math.log(Math.max(rnd(),1e-12)))*Math.cos(2*Math.PI*rnd()); }
function tStudent(rnd, nu){ var chi=0; for(var i=0;i<nu;i++){ var z=gauss(rnd); chi+=z*z; } return gauss(rnd)/Math.sqrt(Math.max(chi,1e-12)/(nu-2)); }
function seriesCAGR(arr){ if(!arr.length) return 0; var sum=0; arr.forEach(function(r){ sum+=Math.log(1+r); }); return Math.exp(sum/arr.length)-1; }
function annualCAGR(arr){ return Math.pow(1+seriesCAGR(arr),12)-1; }
function annualReturns(arr){ var out=[]; for(var y=0;y<arr.length;y+=12){ var p=1; for(var m=y;m<Math.min(y+12,arr.length);m++) p*=1+arr[m]; out.push(p-1); } return out; }
function annualizedVol(arr){ if(arr.length<2) return 0; var ls=arr.map(function(r){return Math.log(1+r);}), mean=ls.reduce(function(a,b){return a+b;},0)/ls.length; return Math.sqrt(12*ls.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/(ls.length-1)); }
function makeWorld(seed, years){
  var rnd=mulberry32(seed), p=0.025, q=0.18, pi=p/(p+q), stress=rnd()<pi;
  var regimes=[], common=[], lagStress=0;
  for(var m=0;m<years*12;m++){
    if(m) stress=stress ? rnd()>=q : rnd()<p;
    lagStress=0.9*lagStress+0.1*((stress?1:0)-pi);
    regimes.push({stress:stress, centered:(stress?1:0)-pi, lag:lagStress});
    common.push(tStudent(rnd,7));
  }
  return {regimes:regimes,common:common,pi:pi,seed:seed};
}
/* Solve one monotone constrained shift over ALL years, including saturated years.
   No clipping in the unconditioned risk model; bounds apply only to the editable scenario. */
function fitCAGR(months, cagr){
  if(!months.length || months.length%12) throw new Error('Chuỗi cần đủ 12 tháng mỗi năm.');
  if(!isFinite(cagr) || cagr < -0.65 || cagr > 0.80) throw new Error('CAGR kịch bản phải nằm trong −65%…80%.');
  var logs=months.map(function(r){ return Math.log(1+r); }), sums=[], n=months.length/12;
  for(var y=0;y<n;y++){ var s=0; for(var m=0;m<12;m++) s+=logs[y*12+m]; sums.push(s); }
  var lo=Math.log(.35), hi=Math.log(1.8), target=Math.log(1+cagr);
  var left=lo-Math.max.apply(null,sums)-1, right=hi-Math.min.apply(null,sums)+1;
  for(var k=0;k<90;k++){
    var mid=(left+right)/2, avg=0;
    sums.forEach(function(v){ avg+=Math.max(lo,Math.min(hi,v+mid)); });
    if(avg/n<target) left=mid; else right=mid;
  }
  var delta=(left+right)/2;
  return logs.map(function(v,i){ var y=Math.floor(i/12), fixed=Math.max(lo,Math.min(hi,sums[y]+delta)); return Math.exp(v+(fixed-sums[y])/12)-1; });
}
function generateMonthly(key, meta, years, seed, world, forceCAGR){
  if(!isFinite(meta.cagr)||meta.cagr<=-1||!isFinite(meta.sigma)||meta.sigma<0) throw new Error('Tham số lợi suất không hợp lệ.');
  world=world||makeWorld(seed^0x5f5e,years);
  var rnd=mulberry32(seed), out=[], h=1, lastShock=0, smooth=0, pi=world.pi;
  var mu=Math.log(1+meta.cagr)/12, vol=meta.sigma/Math.sqrt(12);
  var volNorm=Math.sqrt((1-pi)*.8*.8+pi*1.8*1.8);
  // Smooth property innovations without forcing a fixed crash year.
  var phi=key==='land'?.65:0;
  for(var m=0;m<years*12;m++){
    var regime=world.regimes[m], rho=key==='cp'?.6:(key==='gold'?(regime.stress?.15:-.15):.35);
    var common=world.common[key==='land'?Math.max(0,m-3):m];
    var z=rho*common+Math.sqrt(1-rho*rho)*tStudent(rnd,7);
    h=.04+.06*lastShock*lastShock+.90*h;
    // Numerical ceiling prevents a single extreme t draw from destabilizing a century.
    h=Math.min(h,25);
    lastShock=Math.sqrt(h)*z;
    smooth=phi*smooth+Math.sqrt(1-phi*phi)*lastShock;
    var mult=(regime.stress?1.8:.8)/volNorm;
    var shift=vol*(key==='cp'?-.40*regime.centered:(key==='land'?-.30*regime.lag:0));
    var lr=mu+vol*mult*smooth+shift;
    out.push(Math.exp(lr)-1);
  }
  return forceCAGR===false ? out : fitCAGR(out,meta.cagr);
}
// Legacy helper retained for diagnostics; production generates monthly paths directly.
function genSeries(cagr,sigma,n,seed,forceCAGR,profile,world){ return annualReturns(generateMonthly((profile&&profile.role)||'cp',{cagr:cagr,sigma:sigma},n,seed,world,forceCAGR)); }
function yearlyToMonthly(years,sigma,seed){
  var rnd=mulberry32(seed||20260908), out=[];
  years.forEach(function(r){
    if(!isFinite(r)||r<=-1) throw new Error('Lợi suất năm phải lớn hơn −100%.');
    var shape=[], mean=0; for(var m=0;m<12;m++){ var z=gauss(rnd); shape.push(z); mean+=z/12; }
    for(var j=0;j<12;j++) out.push(Math.exp(Math.log(1+r)/12+(shape[j]-mean)*(sigma||0)/Math.sqrt(12))-1);
  });
  return out;
}
