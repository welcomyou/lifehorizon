// HISTORICAL AUDIT: probes the preserved pre-upgrade source. Current tests: app.test.js.
// Independent return-model audit; run: node app/test/audit-return-probes.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../backups/2026-09-08-before-fixes/index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const probe = new Function(src.slice(0, src.indexOf('/* ================= Render')) + '\nreturn function(code){return eval(code);};')();
const results = {scope:{annualMonthlyPaths:500,yearsPerPath:40,diagnosticPathsPerAsset:20000,assets:3,forcedCAGRPathsPerAsset:20000},notes:['Deterministic diagnostic sampling; these are model outputs, not forecasts or backtest results.','Sigma statistics use sample standard deviation of log returns; monthly SD is annualized by sqrt(12).','Model diagnostics use the same annual seed family for each asset; production riskCheck offsets each asset seed by 1.']};
results.annualMonthlyMaxError = probe(`
  var err=0;
  for(var seed=1; seed<=500; seed++){
    var annual=genSeries(.09,.25,40,seed,true,state.seriesMeta.cp.crash,makeWorld(seed,40));
    var monthly=yearlyToMonthly(annual,.25,seed);
    for(var y=0;y<40;y++){
      var prod=1;for(var m=0;m<12;m++)prod*=1+monthly[y*12+m];
      err=Math.max(err,Math.abs(prod-1-annual[y]));
    }
  }
  err;
`);
results.modelMetrics = probe(`
  var stats={};
  ['gold','cp','land'].forEach(function(key){
    var meta=state.seriesMeta[key], logTotal=0, means=[], annualSD=[], monthlySD=[];
    var mMin=Infinity,mMax=-Infinity, forcedMaxErr=0, forcedBad=null;
    for(var seed=0;seed<20000;seed++){
      var a=genSeries(meta.cagr,meta.sigma,40,777001+seed*3,false,meta.crash,makeWorld(770900+seed*7,40));
      var ls=a.map(function(r){return Math.log(1+r);});
      var mean=ls.reduce(function(s,v){return s+v;},0)/40;
      logTotal+=mean;means.push(Math.exp(mean)-1);
      annualSD.push(Math.sqrt(ls.reduce(function(s,v){return s+(v-mean)*(v-mean);},0)/39));
      var mm=yearlyToMonthly(a,meta.sigma,887001+seed*3).map(function(r){return Math.log(1+r);});
      var mmean=mean/12;
      monthlySD.push(Math.sqrt(mm.reduce(function(s,v){return s+(v-mmean)*(v-mmean);},0)/479*12));
      for(var k=0;k<mm.length;k++){mMin=Math.min(mMin,Math.exp(mm[k])-1);mMax=Math.max(mMax,Math.exp(mm[k])-1);}
      var forced=genSeries(meta.cagr,meta.sigma,40,seed,true,meta.crash,makeWorld(seed,40));
      var diff=Math.abs(seriesCAGR(forced)-meta.cagr);
      if(diff>forcedMaxErr){forcedMaxErr=diff;forcedBad={seed:seed,cagr:seriesCAGR(forced)};}
    }
    means.sort(function(a,b){return a-b;});
    function avg(a){return a.reduce(function(s,v){return s+v;},0)/a.length;}
    stats[key]={targetCAGR:meta.cagr,geometricAcrossRuns:Math.exp(logTotal/20000)-1,medianCAGR:means[10000],meanCAGR:avg(means),inputSigma:meta.sigma,averageAnnualLogSD:avg(annualSD),averageAnnualizedMonthlyLogSD:avg(monthlySD),minMonth:mMin,maxMonth:mMax,maxForcedCAGRError:forcedMaxErr,badForcedExample:forcedBad};
  });
  stats;
`);
results.pendingParameters = probe(`
  ensureSeries();var old=state.series.cp.slice();state.seriesMeta.cp.cagr=.01;state.seriesMeta.cp.sigma=.01;ensureSeries();
  ({seriesUnchanged:old.join(',')===state.series.cp.join(','),inputCAGR:state.seriesMeta.cp.cagr,inputSigma:state.seriesMeta.cp.sigma,actualCAGR:Math.pow(1+seriesCAGR(state.series.cp),12)-1});
`);
results.seriesMigration = probe(`
  state.seriesV=1;
  state.series.gold=new Array(480).fill(.001);state.series.cp=new Array(480).fill(.001);state.series.land=new Array(480).fill(.001);
  ensureSeries();
  ({goldChanged:state.series.gold[0]!==.001,cpChanged:state.series.cp[0]!==.001,landChanged:state.series.land[0]!==.001,seriesV:state.seriesV});
`);
results.boundedCAGRCounterexample = probe(`
  var a=genSeries(.20,.25,5,897,true,state.seriesMeta.cp.crash,makeWorld(897,5));
  ({target:.20,sigma:.25,years:5,seed:897,actual:seriesCAGR(a),returns:a});
`);
results.chartClamp = {inputIndices:[0.35,0.2,0.1],displayedIndices:[0.35,0.2,0.1].map(function(x){return Math.max(.5,x);}),line:1469};
const resultFile=path.join(__dirname,'audit-return-results.json');
fs.writeFileSync(resultFile,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
