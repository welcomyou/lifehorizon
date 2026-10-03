// Repeatable distribution diagnostics, not empirical forecasts/backtesting.
const {context}=require('./harness');
const c=context(),N=500,years=40,stats={};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const quant=(a,p)=>{a.sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)];};
for(const key of c.SERIES_KEYS){
  let vol=[],cagr=[],drawdowns=[],negativeYears=0,annualCount=0;
  for(let seed=0;seed<N;seed++){
    let a=c.generateMonthly(key,c.state.seriesMeta[key],years,71000+seed*3+c.SERIES_KEYS.indexOf(key),c.makeWorld(79000+seed*7,years),false);
    vol.push(c.annualizedVol(a));cagr.push(c.annualCAGR(a));
    let nav=1,peak=1,dd=0;for(let r of a){nav*=1+r;peak=Math.max(peak,nav);dd=Math.max(dd,1-nav/peak);}drawdowns.push(dd);
    for(let r of c.annualReturns(a)){annualCount++;if(r<0)negativeYears++;}
  }
  stats[key]={assumptions:c.state.seriesMeta[key],meanAnnualizedMonthlyLogVol:mean(vol),CAGR:{p10:quant(cagr,.1),p50:quant(cagr,.5),p90:quant(cagr,.9)},medianMaxDrawdown:quant(drawdowns,.5),negativeYearShare:negativeYears/annualCount};
}
console.log(JSON.stringify({pathsPerAsset:N,years,conditionedOnTargetCAGR:false,stats},null,2));
