// HISTORICAL AUDIT: probes the preserved pre-upgrade source. Current tests: app.test.js.
/* Independent audit probes. Read-only toward the app; prints observed/expected values. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../../backups/2026-09-08-before-fixes/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const ctx = vm.createContext({ console });
vm.runInContext(script.slice(0, script.indexOf('/* ================= Render')), ctx);
const original = JSON.parse(JSON.stringify(ctx.state));
function reset(years = 2) {
  ctx.state = JSON.parse(JSON.stringify(original));
  Object.assign(ctx.state, {
    simYears: years, infl: 0, periods: [], incomePeriods: [], events: [],
    milestones: [{ y: 0, monthly: 0 }], assets: { mmf: 0, tk: 0, tp: 0, cp: 0 },
    goldChi: 0, goldPrice: 10000000, landPlots: [], rates: { mmf: 0, tk: 0, tp: 0 },
    landAutoBuy: false, landSellable: true, landLot: 50, landBuyPrice: 10000000,
    mmfMonths: 12, allocRetire: {tk: 0, tp: 0, cp: 0, gold: 0, land: 0},
    allocPolicy: {lumpEnabled: false, lumpAlloc: {tk: 0, tp: 0, cp: 0, gold: 0, land: 0}},
    pensionMode: 'simple', pensionSimple: {amount: 0, startYear: 2099, growth: 0},
    series: {gold: Array(years*12).fill(0), cp: Array(years*12).fill(0), land: Array(years*12).fill(0)}, seriesV: 2,
  });
  ctx.setNow(2026*12);
  return ctx.state;
}
function report(name, actual, expected, note) {
  console.log(JSON.stringify({name, actual, expected, difference: actual-expected, note}));
}
// Integer gold trades use the current month's price and preserve change in MMF.
{
  const s=reset(1); s.series.gold[0]=1; s.series.gold[1]=-0.5;
  s.events=[{y:0,kind:'thu',amount:55e6,allocMode:'custom',alloc:{gold:100}}];
  const sim=ctx.runSim(false);
  report('gold-buy-current-price',sim.months[0].gold,40e6);
  report('gold-buy-change-mmf',sim.months[0].mmf,15e6);
  report('gold-buy-next-month-price',sim.months[1].gold,20e6);
}
{
  const s=reset(1); s.goldChi=10; s.series.gold[0]=0.1;
  s.events=[{y:0,kind:'chi',amount:15e6}];
  const sim=ctx.runSim(false);
  report('gold-sell-current-price',sim.months[0].gold,88e6);
  report('gold-sell-change-mmf',sim.months[0].mmf,7e6);
  report('gold-sell-conservation',sim.months[0].total,95e6);
}
// A new property is bought at the current index, without reapplying past growth.
{
  const s=reset(1); s.landAutoBuy=true; s.series.land[0]=0.1; s.series.land[1]=-0.2;
  s.events=[{y:0,kind:'thu',amount:550e6,allocMode:'custom',alloc:{land:100}}];
  const sim=ctx.runSim(false);
  report('land-buy-current-price',sim.months[0].land,550e6);
  report('land-buy-next-month-price',sim.months[1].land,440e6);
}
// Each mark-to-market asset must use its exact month, not the annual average.
{
  const s = reset(1);
  s.assets = {mmf: 1e8, tk: 1e8, tp: 1e8, cp: 1e8};
  s.rates = {mmf: 4.5, tk: 6.5, tp: 6};
  s.goldChi = 10;
  s.landPlots = [{label:'P', area:10, price:1e7, holdYears:null, rent:false}];
  s.series.gold = [0.1,-0.2,0.3,0,0,0,0,0,0,0,0,0];
  s.series.cp = [-0.3,0.5,0.1,0,0,0,0,0,0,0,0,0];
  s.series.land = [0.2,-0.1,0.05,0,0,0,0,0,0,0,0,0];
  const sim=ctx.runSim(false), end=sim.months[11];
  for(const [k,r] of Object.entries(s.rates)) report('annual-effective-'+k,end[k],1e8*(1+r/100));
  for(const k of ['gold','cp','land']) {
    let expected=1e8;
    s.series[k].forEach((r,i)=>{expected*=1+r; report('month-'+(i+1)+'-'+k,sim.months[i][k],expected);});
  }
}
// End-of-month purchases must receive only later returns.
{
  const s=reset(1); s.series.cp[0]=1; s.series.cp[1]=-0.5;
  s.events=[{y:0,kind:'thu',amount:1e8,allocMode:'custom',alloc:{cp:100}}];
  const sim=ctx.runSim(false);
  report('end-month-cp-purchase',sim.months[0].cp,1e8);
  report('end-month-cp-purchase-next-return',sim.months[1].cp,5e7);
}
// A one-year hold should expose the asset to exactly twelve monthly returns.
{
  const s=reset(2); s.series.land.fill(0.01);
  s.landPlots=[{label:'P',area:100,price:1e7,holdYears:1,rent:false}];
  const sim=ctx.runSim(false);
  report('one-year-sale-proceeds',sim.evIn,1e9*Math.pow(1.01,12),'Actual sale after 13 monthly revaluations.');
}
// Direct monthly rent belongs to the whole entered property and must shrink after a partial sale.
{
  const s=reset(1);
  s.landPlots=[{label:'P',area:100,price:1e7,holdYears:null,rent:true,rentMode:'direct',rentVnd:1e7,rentGrowth:0}];
  s.events=[{y:0,kind:'chi',amount:1e8}];
  const sim=ctx.runSim(false);
  report('rent-after-half-property-sold',sim.years[0].inc,1e7+11*5e6,'One full month at 10m, eleven months after selling 50 of 100 m2 at 5m.');
  report('nav-after-half-property-sold',sim.months[11].total,1e9-1e8+1e7+11*5e6);
}
// Same-month end-of-period cash income can fund an end-of-period event.
{
  const s=reset(1);
  s.incomePeriods=[{fromY:2026,toY:2026,amount:1e8,growth:0,alloc:{tk:0,tp:0,cp:0,gold:0,land:0}}];
  s.events=[{y:0,kind:'chi',amount:5e7}];
  const sim=ctx.runSim(false);
  report('same-month-cash-shortfall',sim.shortfall,0,'Only monthly timing is available; engine pays event before receiving salary.');
  report('same-month-cash-ending-nav',sim.months[11].total,12*1e8-5e7);
}
// Sale proceeds must remain separate from external income in a conservation equation.
{
  const s=reset(2);
  s.landPlots=[{label:'P',area:100,price:1e7,holdYears:1,rent:false}];
  const sim=ctx.runSim(false);
  report('property-sale-conservation-naive-evIn',1e9+sim.evIn,sim.months[23].total,'evIn includes internal property liquidation; do not treat it as external new wealth.');
}
// A configured sellable property can be smaller than the global lot size.
{
  const s=reset(1);
  s.landPlots=[{label:'P',area:40,price:1e7,holdYears:null,rent:false}];
  s.events=[{y:0,kind:'chi',amount:1e8}];
  const sim=ctx.runSim(false);
  report('smaller-than-lot-property-shortfall',sim.shortfall,0,'40 m2 property never sold because global minimum lot is 50 m2.');
}
// Drawdown should depend on unit price, not the size of the investment after prior withdrawals.
{
  const s=reset(2); s.assets.cp=1e8; s.goldChi=10;
  s.events=[{y:0,kind:'chi',amount:9e7},{y:1,kind:'chi',amount:1e7}];
  s.series.cp[12]=-0.05;
  const sim=ctx.runSim(false);
  report('unit-price-drawdown-gold-sale-year2',sim.years[1].srcDrawn.gold||0,1e7,'At year2 gold price unchanged at peak; CP price down 5%. Holdings peaks wrongly make the already-withdrawn gold look 90% below its peak.');
  console.log(JSON.stringify({name:'drawdown-year2-actual-sources',sources:sim.years[1].srcDrawn}));
}
// Human labels must not merge newly purchased land into a different cost-basis property.
{
  const s=reset(1); s.landAutoBuy=true;
  s.landPlots=[{label:'Mua thêm',area:100,price:2e7,holdYears:null,rent:false}];
  s.incomePeriods=[{fromY:2026,toY:2026,amount:5e8,growth:0,alloc:{land:100}}];
  const sim=ctx.runSim(false);
  report('existing-label-collision-month1-nav',sim.months[0].total,2e9+5e8,'New 50 m2 bought at 10m/m2 gets valued at existing plot price 20m/m2.');
}
// Explicit all-zero phase allocation must preserve cash as documented.
{
  const s=reset(1); s.allocRetire={cp:100};
  s.incomePeriods=[{fromY:2026,toY:2026,amount:1e7,growth:0,alloc:{tk:0,tp:0,cp:0,gold:0,land:0}}];
  const sim=ctx.runSim(false);
  report('zero-allocation-keep-cash',sim.months[0].mmf,1e7,'activeAlloc falls back to retire allocation instead of preserving an explicit zero vector.');
}
// Property purchases must leave the MMF minimum funded even when landFund was counted as MMF.
{
  const s=reset(2); s.landAutoBuy=true; s.landBuyPrice=2e6;
  s.mmfMonths=12; s.milestones=[{y:0,monthly:1e6},{y:1,monthly:2e6}];
  s.incomePeriods=[{fromY:2026,toY:2027,amount:1e7,growth:0,alloc:{land:100}}];
  const sim=ctx.runSim(false);
  report('land-purchase-month13-reserve',sim.months[12].mmf,116e6,'24m reserve required; cannot buy a 100m lot out of 116m total cash without breaking the reserve.');
  console.log(JSON.stringify({name:'land-reserve-cash-months',months:sim.months.slice(10,14).map(m=>({mi:m.mi,mmf:m.mmf,land:m.land}))}));
}
