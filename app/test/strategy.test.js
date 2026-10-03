'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fresh,context,plot}=require('./harness');
function near(a,b){assert.ok(Math.abs(a-b)<.02,`${a} != ${b}`);}
function managed(years=5,method='target'){
  const c=fresh(years),s=c.state;s.investmentPlan=c.newInvestmentPlan(c.NOW);
  const p=s.investmentPlan.stages[0];Object.assign(p,{method,reserveMonths:0,emergencyMonths:0,weights:{tk:0,tp:0,cp:100,gold:0}});
  return {c,s,p};
}
test('strategy: surplus pays expenses, builds one emergency reserve, invests the remainder',()=>{
  const {c,s,p}=managed();s.assets.cp=100e6;s.milestones[0].monthly=10e6;
  s.incomePeriods=[{fromY:2026,toY:2030,amount:20e6,growth:0}];p.reserveMonths=3;
  const m=c.runSim(true).months[0];near(m.total,110e6);near(m.mmf,30e6);near(m.cp,80e6);near(m.strategy.reserveTarget,30e6);
  assert.deepEqual(Object.keys(m.drawn),[]);near(m.ledger.error,0);
});
test('strategy: stock-only early retiree sells ahead for 3 years, skips falling-market review, refills at low-water mark',()=>{
  const {c,s,p}=managed(6,'bucket');s.assets.cp=1000e6;s.milestones[0].monthly=10e6;
  Object.assign(p,{reserveMonths:36,minMonths:6,refillMonths:12});s.series.cp[1]=-.5;
  const r=c.runSim(true),a=r.months;
  near(a[0].mmf,360e6);near(a[0].cp,630e6);near(a[0].total,990e6);
  near(a[1].mmf,350e6);near(a[1].cp,315e6);
  assert.equal(a[12].strategy.trades.length,0);near(a[12].mmf,240e6);
  near(a[30].mmf,60e6);near(a[31].mmf,120e6);
  assert.match(a[31].strategy.trades[0].reason,/gần cạn/);near(a[31].strategy.trades[0].amount,70e6);
  // Bán khi đang giảm giá cộng dồn mọi lần nạp gần cạn (m31/m38/m45/m52 70tr + m59 35tr); lần bán
  // lập dự phòng đầu giai đoạn ở m0 KHÔNG tính — lúc đó cổ phiếu chưa giảm.
  near(r.strategyStats.stockSoldInDrawdown,315e6);
});
test('strategy: bucket replenishes at review after observed nonnegative trailing 12 months',()=>{
  const {c,s,p}=managed(6,'bucket');s.assets.cp=1000e6;s.milestones[0].monthly=10e6;
  Object.assign(p,{reserveMonths:36,minMonths:6,refillMonths:12});s.series.cp[12]=.2;
  const a=c.runSim(true).months;near(a[12].mmf,360e6);near(a[12].strategy.trailingReturn,.2);
  near(a[12].strategy.trades[0].amount,120e6);
});
test('strategy: trailing return uses exactly 12 completed months, including the first complete year',()=>{
  const {c,s,p}=managed(3,'bucket');s.assets.cp=1000e6;s.milestones[0].monthly=10e6;
  Object.assign(p,{reserveMonths:24,minMonths:3,refillMonths:6,reviewMonths:1});
  s.series.cp[0]=-.5;s.series.cp[11]=.1;s.series.cp[12]=.2;
  const a=c.runSim(true).months;
  assert.equal(a[10].strategy.trailingReturn,null);
  near(a[11].strategy.trailingReturn,-.45); // Jan–Dec: .5 x 1.1 - 1
  near(a[12].strategy.trailingReturn,.32); // Feb–Jan: 1.1 x 1.2 - 1, excludes first January
  near(a[12].mmf,240e6); // Reserve does not shrink at the simulation horizon.
});
test('strategy: a missing plan fails with an actionable validation error',()=>{
  const {c,s}=managed();delete s.investmentPlan;
  assert.throws(()=>c.runSim(true),/Thiếu kế hoạch đầu tư/);
});
test('strategy: scheduled target rebalance funds reserve and uses overweight holdings during deficits',()=>{
  const {c,s,p}=managed(3);s.assets={mmf:0,tk:0,tp:200e6,cp:800e6};s.milestones[0].monthly=10e6;
  p.weights={tk:0,tp:40,cp:60,gold:0};p.reserveMonths=3;
  const a=c.runSim(true).months;near(a[0].drawn.cp,10e6);assert.equal(a[0].drawn.tp,undefined);
  near(a[0].mmf,30e6);near(a[0].cp,576e6);near(a[0].tp,384e6);near(a[0].total,990e6);
});
test('strategy: stage boundary changes exactly in the chosen month, independent of income phase',()=>{
  const {c,s,p}=managed(2);s.assets.cp=100e6;
  const second=c.investmentStage(c.NOW+6,'Hưu sớm');Object.assign(second,{reserveMonths:0,emergencyMonths:0,weights:{tk:0,tp:100,cp:0,gold:0}});
  s.investmentPlan.stages.push(second);
  const a=c.runSim(true).months;near(a[5].cp,100e6);near(a[6].tp,100e6);near(a[6].cp,0);
  assert.equal(a[5].strategy.id,p.id);assert.equal(a[6].strategy.id,second.id);
});
test('strategy: glidepath can increase equity, reaches endpoint, and keeps it',()=>{
  const {c,s,p}=managed(4,'glide');s.assets.mmf=100e6;
  Object.assign(p,{weights:{tk:0,tp:80,cp:20,gold:0},endWeights:{tk:0,tp:20,cp:80,gold:0},transitionMonths:24,reviewMonths:1});
  const a=c.runSim(true).months;near(a[0].cp,20e6);
  /* Đợi lô TP đủ 12 tháng rồi mới bán; không trả 2% phí chỉ để chỉnh tỷ trọng. */
  near(a[12].cp,50e6);near(a[24].cp,80e6);near(a[35].cp,80e6);
  near(a.reduce((sum,m)=>sum+m.ledger.tpFee,0),0);
});
test('strategy: rebalance does not sell and repurchase a deposit or young bond in one month',()=>{
  {
    const {c,s,p}=managed(2);s.assets={mmf:0,tk:100e6,tp:100e6,cp:0};s.rates.tk=6;
    p.weights={tk:40,tp:40,cp:20,gold:0};
    const m=c.runSim(true).months[0],tk=m.strategy.trades.filter(t=>t.asset==='tk');
    assert.ok(!tk.some(t=>t.side==='sell'||t.side==='buy')); // chưa đáo hạn, còn TP cũ bán miễn phí
    near(m.ledger.savingsForfeited,0);
    near(m.ledger.error,0);
  }
  {
    const {c,s,p}=managed(2);s.assets={mmf:100e6,tk:0,tp:0,cp:0};p.weights={tk:0,tp:100,cp:0,gold:0};
    const next=c.investmentStage(c.NOW+1,'Giảm trái phiếu');Object.assign(next,{reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}});
    s.investmentPlan.stages.push(next);
    const m=c.runSim(true).months[1],tp=m.strategy.trades.filter(t=>t.asset==='tp');
    assert.ok(!tp.some(t=>t.side==='sell')); // lô TP vừa mua, hoãn bán để tránh phí 2%
    assert.ok(!tp.some(t=>t.side==='buy'));
    near(m.ledger.tpFee,0);
    near(m.ledger.error,0);
  }
});
test('strategy: reserve uses living expenses only, independent of income, rents and events',()=>{
  const {c,s,p}=managed(5);s.milestones[0].monthly=10e6;
  s.incomePeriods=[{fromY:2026,toY:2026,amount:20e6,growth:0}];
  s.pensionSimple={amount:3e6,startYear:2027,startMonth:1,growth:0,amountBasis:'baseMonth'};
  s.extraPeople=[{id:'p2',name:'Em',birthYear:1990,gender:'female',periods:[],pension:{amount:2e6,startYear:2027,startMonth:1,growth:0,amountBasis:'baseMonth'}}];
  s.landPlots=[plot({rent:true,rentVnd:1e6})];
  s.events=[{y:1,kind:'chi',amount:40e6},{y:1,kind:'thu',amount:900e6}];
  const f=c.investmentForecast(true),plots=[{sold:false,rent:true,rentMode:'direct',rentVnd:1e6,rentGrowth:0}];
  // 12 months x 10m living expenses, regardless of pension, rent and events.
  near(c.investmentReserve(f,11,12,plots,0),120e6);
  // The removed global floor cannot affect the result.
  near(c.investmentReserve(f,11,12,plots,10),120e6);
  plots[0].sold=true;near(c.investmentReserve(f,11,12,plots,0),120e6);
});
test('strategy: future market-path changes cannot affect any earlier cash reserve or trade',()=>{
  const {c,s,p}=managed(6,'bucket');s.assets.cp=1000e6;s.milestones[0].monthly=10e6;
  Object.assign(p,{reserveMonths:36,minMonths:6,refillMonths:12});
  const first=c.runSim(true);s.series.cp[30]=-.8;s.series.gold[35]=1;s.series.land[33]=-.5;
  const later=c.runSim(true);assert.equal(JSON.stringify(first.months.slice(0,30)),JSON.stringify(later.months.slice(0,30)));
});
test('strategy: waits for deposit maturity before reallocation instead of forfeiting interest',()=>{
  const {c,s}=managed();s.assets.tk=100e6;s.rates.tk=6;
  const ms=c.runSim(true).months;near(ms[0].tk,100.5e6);near(ms[0].cp,0);
  near(ms[11].mmf,106e6);near(ms[11].tk,0);assert.equal(ms[11].strategy.maturityWait,true);
  assert.equal(ms[11].strategy.review,false); // kỳ cân bằng theo lịch vẫn là tháng sau
  near(ms[12].cp,106e6);near(ms[12].ledger.savingsForfeited,0);near(ms[12].ledger.error,0);
});
test('strategy: gold whole units, spread and remainder reconcile both purchases and withdrawals',()=>{
  const {c,s,p}=managed();s.assets.mmf=100e6;s.goldPrice=30e6;s.goldSpread=2;p.weights={tk:0,tp:0,cp:0,gold:100};
  let a=c.runSim(true).months;near(a[0].chi,3);near(a[0].mmf,10e6);near(a[0].gold,88.2e6);near(a[0].total,98.2e6);
  s.assets.mmf=0;s.goldChi=3;s.milestones[0].monthly=5e6;
  a=c.runSim(true).months;near(a[0].total,83.2e6);near(a[0].drawn.gold,5e6);near(a[0].mmf,24.4e6);near(a[0].chi,2);
});
test('strategy: a windfall is invested by the stage; any saved per-event allocation is ignored',()=>{
  const {c,s}=managed();s.events=[{y:0,kind:'thu',amount:100e6,label:'x',allocMode:'custom',alloc:{gold:100}}];
  let m=c.runSim(true).months[0];near(m.cp,100e6);near(m.gold,0);
  s.events[0].alloc={tp:100};m=c.runSim(true).months[0];near(m.cp,100e6);
});
test('strategy: sale proceeds follow strategy; property itself never participates in rebalancing',()=>{
  const {c,s}=managed(2);s.landPlots=[plot({saleYear:2026,salePrice:200e6})];
  const a=c.runSim(true).months;near(a[0].cp,0);near(a[0].land,1e9);near(a[11].cp,200e6);near(a[11].land,0);near(a[11].ledger.error,0);
});
test('strategy: exhaustion records unfunded spending, no negative asset or implicit debt',()=>{
  const {c,s,p}=managed(3,'bucket');s.assets.cp=15e6;s.milestones[0].monthly=10e6;
  Object.assign(p,{reserveMonths:24,minMonths:6,refillMonths:12});
  const r=c.runSim(true);near(r.months[0].mmf,5e6);near(r.months[1].short,5e6);near(r.months[2].short,10e6);
  r.months.forEach(m=>{assert.ok(m.total>=0);near(m.ledger.error,0);});
});
test('strategy: suggestions separate accumulation, early-retirement bridge and pension years',()=>{
  const {c,s}=managed(6);s.milestones[0].monthly=10e6;s.incomePeriods=[{fromY:2026,toY:2027,amount:20e6,growth:0}];
  s.pensionSimple={amount:5e6,startYear:2030,startMonth:7,growth:0,amountBasis:'baseMonth'};
  const p=c.suggestedInvestmentPlan();assert.equal(p.stages.length,3);
  assert.deepEqual(Array.from(p.stages,x=>x.from),[2026*12,2028*12,2030*12+6]);
  assert.deepEqual(Array.from(p.stages,x=>x.reserveMonths),[6,36,24]);
  assert.equal(c.validateInvestmentPlan(p).filter(x=>x.level==='error').length,0);
});
test('strategy: validation rejects malformed policies, missing coverage, duplicate months, weights and refill thresholds',()=>{
  for(const mutate of [p=>p.stages=[],p=>p.version=99,p=>p.stages[0].from++,p=>p.stages.push({...p.stages[0],id:'duplicate'}),p=>p.stages[0].weights.cp=90,p=>p.stages[0].weights=null,p=>p.stages[0].reserveMonths=-1,p=>{p.stages[0].method='bucket';p.stages[0].minMonths=12;},p=>p.stages[0].reviewMonths=5,p=>p.stages[0].label='   ']){
    const {c,s}=managed();mutate(s.investmentPlan);assert.ok(c.validateErrors().length);assert.throws(()=>c.runSim(true));
  }
});
test('strategy: migration converts non-stage plans to the default plan, drops legacy fields, roundtrips saved plans',()=>{
  const {c,s}=managed();const old=JSON.parse(JSON.stringify(s));delete old.investmentPlan;old.schemaVersion=4;
  old.allocRetire={mmf:0,tk:15,tp:35,cp:40,gold:10};
  const m=c.migrateState(old);
  assert.equal(m.investmentPlan.stages.length,1);assert.equal(m.schemaVersion,9); /* v9 = Tab 8 compareCfg */
  assert.equal('allocRetire' in m,false);assert.equal('mode' in m.investmentPlan,false);
  assert.equal(JSON.stringify(m.series),JSON.stringify(old.series));
  const after=c.migrateState(JSON.parse(JSON.stringify(s)));assert.equal(JSON.stringify(after.investmentPlan),JSON.stringify(s.investmentPlan));
  const legacy=JSON.parse(JSON.stringify(s));legacy.investmentPlan={version:1,mode:'legacy',stages:[]};
  assert.equal(c.migrateState(legacy).investmentPlan.stages.length,1);
});
test('strategy: new profiles ship with a stage plan; risk and same-path comparisons leave all inputs untouched',()=>{
  assert.ok(Array.isArray(context().state.investmentPlan.stages));
  assert.equal(context().state.investmentPlan.stages.length,1);
  const {c,s,p}=managed(3);s.assets.cp=1000e6;s.milestones[0].monthly=10e6;p.emergencyMonths=3;
  const before=JSON.stringify(s),rows=c.investmentComparisons(s.investmentPlan);
  assert.equal(rows.length,4);rows.forEach(r=>c.runSim(true,{series:s.series,investmentPlan:r.plan}));
  const r1=c.riskCheck(12,true,512),r2=c.riskCheck(12,true,512);
  assert.equal(JSON.stringify(r1),JSON.stringify(r2));assert.equal(JSON.stringify(s),before);
});
test('strategy: migration preserves invalid and future-version edited plans for validation instead of resetting them',()=>{
  const {c,s}=managed();s.investmentPlan.version=99;s.investmentPlan.stages[0].weights.cp=75;
  const saved=JSON.stringify(s.investmentPlan),m=c.migrateState(JSON.parse(JSON.stringify(s)));
  assert.equal(JSON.stringify(m.investmentPlan),saved);
  assert.ok(c.validateInvestmentPlan(m.investmentPlan).some(x=>x.level==='error'));
});
test('strategy: mixed portfolio reconciles every month across random paths, all three policies',()=>{
  for(const method of ['target','bucket','glide'])for(let seed=1;seed<=4;seed++){
    const {c,s,p}=managed(8,method);s.assets={mmf:20e6,tk:70e6,tp:100e6,cp:700e6};s.rates={mmf:4,tk:6,tp:5};s.goldChi=10;s.goldPrice=14e6;s.goldSpread=2;
    s.milestones=[{y:0,monthly:12e6},{y:4,monthly:18e6}];s.infl=5;s.incomePeriods=[{fromY:2026,toY:2028,amount:18e6,growth:5}];
    s.events=[{y:1,kind:'chi',amount:100e6},{y:5,kind:'thu',amount:200e6}];s.landPlots=[plot({rent:true,rentVnd:1e6,saleYear:2031})];
    Object.assign(p,{reserveMonths:24,minMonths:6,refillMonths:12,emergencyMonths:3,weights:{tk:10,tp:20,cp:60,gold:10},endWeights:{tk:10,tp:30,cp:50,gold:10},transitionMonths:60});
    const world=c.makeWorld(seed,8),series={};for(const k of ['gold','cp','land'])series[k]=c.generateMonthly(k,s.seriesMeta[k],8,seed*17,world,false);
    const r=c.runSim(true,{series});r.months.forEach(m=>{near(m.ledger.error,0);assert.ok(m.mmf>=-.01);assert.ok(Number.isInteger(m.chi));});
  }
});
function unified(years=3){const c=fresh(years),s=c.state;s.lifePlan=c.newLifePlan(c.NOW);const r=s.lifePlan.rows[0];r.income={amount:0,growth:0,anchor:c.NOW};r.incomeLabel='Thu nhập hiện tại';r.allocation={reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}};return {c,s,lp:s.lifePlan,r};}
test('unified: new money into a balanced 60/40 portfolio is invested monthly 60/40',()=>{
 const {c,s,r}=unified();s.assets.cp=600e6;s.assets.tp=400e6;r.income.amount=100e6;
 const sim=c.runSim(true);near(sim.months[0].cp,660e6);near(sim.months[0].tp,440e6);
 near(sim.months[1].cp,720e6);near(sim.months[1].tp,480e6);
});
test('unified: MMF exhaustion withdraws proportionally to post-spending targets',()=>{
 const {c,s}=unified();s.assets.cp=600e6;s.assets.tp=400e6;s.milestones[0].monthly=100e6;
 const m=c.runSim(true).months[0];near(m.cp,540e6);near(m.tp,360e6);near(m.drawn.cp,60e6);near(m.drawn.tp,40e6);
});
test('unified: inherited income keeps its anniversary; income-only milestones do not trigger rebalance',()=>{
 const {c,s,lp,r}=unified();r.income={amount:20e6,growth:10,anchor:c.NOW};
 lp.rows.push({id:'next',from:c.NOW+6,label:'Same income',income:null,allocation:null});
 const sim=c.runSim(true);near(sim.months[6].salary,20e6);near(sim.months[12].salary,22e6);
 assert.equal(sim.months[6].strategy.review,false);
 assert.equal(c.effectiveInvestmentPlan().stages.length,1);
});
test('unified: allocation changes apply immediately without resetting global review calendar',()=>{
 const {c,s,lp,r}=unified();lp.reviewMonths=6;s.assets.cp=600e6;s.assets.tp=400e6;
 lp.rows.push({id:'risk',from:c.NOW+3,label:'Change',income:null,allocation:{reserveMonths:0,weights:{tk:0,tp:80,cp:20,gold:0}}});
 const ms=c.runSim(true).months;near(ms[3].cp,200e6);assert.equal(ms[3].strategy.review,true);assert.equal(ms[6].strategy.review,true);assert.equal(ms[9].strategy.review,false);
});
test('unified: review funds reserve without selling and repurchasing the same asset',()=>{
 const {c,s,lp,r}=unified();lp.reviewMonths=6;r.allocation.reserveMonths=12;s.assets.cp=600e6;s.assets.tp=400e6;s.milestones[0].monthly=10e6;
 const ms=c.runSim(true).months;near(ms[0].mmf,120e6);near(ms[5].mmf,70e6);near(ms[6].mmf,120e6);
 for(const m of ms){const sold=new Set(m.strategy.trades.filter(t=>t.side==='sell').map(t=>t.asset));assert.ok(m.strategy.trades.filter(t=>t.side==='buy').every(t=>!sold.has(t.asset)));near(m.ledger.error,0);}
});
test('unified: family pensions remain independent and are added to salary and forecast',()=>{
 const {c,s,r}=unified();r.income.amount=20e6;s.pensionSimple={amount:5e6,startYear:2026,startMonth:7,growth:10,amountBasis:'baseMonth'};
 s.extraPeople=[{id:'wife',name:'Wife',birthYear:1990,gender:'female',periods:[],pension:{amount:7e6,startYear:2027,startMonth:7,growth:0,amountBasis:'baseMonth'}}];
 const ms=c.runSim(true).months,fc=c.investmentForecast(true);near(ms[5].pension,0);near(ms[6].pension,5e6);near(ms[18].pension,12.5e6);near(ms[18].salary,20e6);near(fc[18].pension,ms[18].pension);
});
test('unified: migration preserves every legacy salary month, gaps and retirement cutoff',()=>{
 const c=fresh(8),s=c.state;s.schemaVersion=6;
 // Tháng gốc đầu năm: bước tăng theo năm kể từ tháng gốc trùng pha bước tháng 1 của fromY → khớp tuyệt đối.
 c.setNow(2026*12);s.investmentPlan.stages[0].from=c.NOW;
 s.birthYear=1968;s.gender='male';s.incomePeriods=[{fromY:2025,toY:2027,amount:20e6,growth:7},{fromY:2029,toY:null,amount:10e6,growth:3}];
 const before=c.investmentForecast(true).map(r=>r.salary),saved=JSON.parse(JSON.stringify(s)),m=c.migrateState(saved);assert.ok(m.lifePlan);assert.ok(m.lifePlanArchive);
 for(let i=0;i<before.length;i++)near(c.lifeSalary(m.lifePlan,c.NOW+i),before[i]);
 assert.equal(JSON.stringify(c.migrateState(JSON.parse(JSON.stringify(m))).lifePlan),JSON.stringify(m.lifePlan));assert.equal(JSON.stringify(saved),JSON.stringify(s));
});
test('unified: invalid input and future versions remain visible and block simulation',()=>{
 for(const mutate of [lp=>lp.rows[0].income.amount=-1,lp=>lp.rows[0].allocation.weights.cp=30,lp=>lp.reviewMonths=2,lp=>lp.rows.push({...lp.rows[0],id:'duplicate'}),lp=>lp.version=99]){
  const {c,s,lp}=unified();mutate(lp);assert.ok(c.validateErrors().some(e=>e.tab==='t5'));assert.throws(()=>c.runSim(true));const saved=JSON.stringify(lp);assert.equal(JSON.stringify(c.migrateState(JSON.parse(JSON.stringify(s))).lifePlan),saved);
 }
});
test('unified: all-asset cash ledger reconciles with costs across market paths',()=>{
 for(let seed=1;seed<=3;seed++){
  const {c,s,lp,r}=unified(4);s.assets={mmf:10e6,tk:200e6,tp:200e6,cp:400e6};s.goldChi=20;s.goldSpread=2;s.rates.tk=6;s.milestones[0].monthly=20e6;r.allocation={reserveMonths:12,weights:{tk:20,tp:20,cp:40,gold:20}};lp.reviewMonths=6;
  s.series.cp=s.series.cp.map((_,i)=>Math.sin(i+seed)*.15);s.series.gold=s.series.gold.map((_,i)=>Math.cos(i+seed)*.1);
  const ms=c.runSim(true).months;ms.forEach(m=>{near(m.ledger.error,0);assert.ok(m.total>=0);});
 }
});
test('separate schedules: moving income leaves allocation at its original date and preserves amount',()=>{
 const {c,s,lp,r}=unified();r.income={amount:20e6,growth:10,anchor:c.NOW-12};
 // Mốc năm 0 là mốc neo: dời thu nhập của nó bị chặn — dùng mốc khác để kiểm tra tách lịch
 const later={id:'later',from:c.NOW+24,label:'Work',income:{amount:20e6,growth:10,anchor:c.NOW+12},allocation:null};lp.rows.push(later);
 assert.equal(c.moveLifeComponent(lp,later,'income',c.NOW+36),'');
 assert.equal(later.from,c.NOW+24);assert.equal(later.income,null);assert.equal(later.allocation,null);
 const moved=lp.rows.find(x=>x.from===c.NOW+36);near(moved.income.amount,20e6);assert.equal(moved.income.anchor,c.NOW+36);
 assert.ok(r.income);assert.ok(r.allocation);   // mốc gốc nguyên vẹn
});
test('separate schedules: moving allocation merges into income row; collisions leave plan untouched',()=>{
 const {c,s,lp,r}=unified();const second={id:'second',from:c.NOW+12,label:'Work',income:{amount:10e6,growth:0,anchor:c.NOW+12},allocation:null};lp.rows.push(second);
 const extra0={id:'extra0',from:c.NOW+24,label:'Later',income:null,allocation:JSON.parse(JSON.stringify(second.allocation||{reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}}))};lp.rows.push(extra0);
 assert.equal(c.moveLifeComponent(lp,extra0,'allocation',second.from),'');assert.ok(second.allocation);assert.equal(extra0.allocation,null);
 const extra={id:'extra',from:c.NOW+36,label:'Later2',income:null,allocation:JSON.parse(JSON.stringify(second.allocation))};lp.rows.push(extra);const before=JSON.stringify(lp);
 assert.ok(c.moveLifeComponent(lp,extra,'allocation',second.from));assert.equal(JSON.stringify(lp),before);
});
test('anchor: only year-0 allocation is pinned; income can start later',()=>{
  const {c,s,lp,r}=unified();r.income={amount:20e6,growth:0,anchor:c.NOW};
  assert.ok(c.moveLifeComponent(lp,r,'allocation',c.NOW+24));
  assert.ok(c.moveLifeComponent(lp,r,'income',c.NOW-12));
  assert.equal(c.moveLifeComponent(lp,r,'income',c.NOW+12),'');
  assert.equal(r.income,null);assert.ok(r.allocation);
  assert.equal(c.lifeSalary(lp,c.NOW),0);
  near(c.lifeSalary(lp,c.NOW+12),20e6);
 // Mốc KHÔNG phải neo vẫn dời được
 const late={id:'late',from:c.NOW+36,label:'Late',income:null,allocation:{reserveMonths:6,weights:{tk:50,tp:50,cp:0,gold:0}}};lp.rows.push(late);
 assert.equal(c.moveLifeComponent(lp,late,'allocation',c.NOW+48),'');
 // Nút ＋ luôn có mốc gốc: sau heal mô phỏng không còn lỗi t5
 const errs=c.validateLifePlan(lp,c.NOW);assert.equal(errs.length,0);
});
test('anchor: migrateState rebuilds year-0 allocation without inventing income',()=>{
 const c=fresh(3);
 const saved={schemaVersion:7,startMonth:c.NOW,simYears:3,mainName:'Kiểm tra heal',
   lifePlan:{version:1,reviewMonths:12,emergencyMonths:3,rows:[{id:'life-x',from:c.NOW+120,label:'Thu nhập công việc',income:{amount:20e6,growth:5,anchor:c.NOW+120},allocation:{reserveMonths:12,weights:{tk:20,tp:20,cp:60,gold:0}}}]}};
 const migrated=c.migrateState(JSON.parse(JSON.stringify(saved)));
 const rows=migrated.lifePlan.rows.slice().sort((a,b)=>a.from-b.from),a0=rows[0];
 assert.equal(a0.from,c.NOW);
  assert.equal(a0.income,null);
 assert.deepEqual(JSON.parse(JSON.stringify(a0.allocation)),{reserveMonths:12,weights:{tk:20,tp:20,cp:60,gold:0}});
 assert.equal(c.validateLifePlan(migrated.lifePlan,c.NOW).length,0);
  assert.ok(c.migrationMessages.some(m=>m.indexOf('phân bổ tài sản lần đầu')>=0));
 // Bản lưu ĐÃ có mốc năm 0 thì giữ nguyên từng số, không báo gì
 const saved2={schemaVersion:7,startMonth:c.NOW,simYears:3,lifePlan:{version:1,reviewMonths:12,emergencyMonths:3,rows:[{id:'life-a',from:c.NOW,label:'Hiện tại',income:{amount:7e6,growth:6,anchor:c.NOW},allocation:{reserveMonths:9,weights:{tk:10,tp:10,cp:80,gold:0}}}]}};
 c.migrationMessages.length=0;
 const migrated2=c.migrateState(JSON.parse(JSON.stringify(saved2)));
 assert.equal(migrated2.lifePlan.rows.length,1);
 assert.equal(migrated2.lifePlan.rows[0].income.amount,7e6);
 assert.equal(migrated2.lifePlan.rows[0].allocation.reserveMonths,9);
  assert.ok(c.migrationMessages.every(m=>m.indexOf('phân bổ tài sản lần đầu')<0));
});
test('new life plan has only initial allocation; old zero-income placeholder is removed without changing income',()=>{
  const c=fresh(2),p=c.newLifePlan(c.NOW);
  assert.equal(p.rows[0].income,null);assert.equal(c.lifeSalary(p,c.NOW),0);
  const old=JSON.parse(JSON.stringify(p));old.rows[0].income={amount:0,growth:0,anchor:c.NOW};
  const migrated=c.migrateState({schemaVersion:9,startMonth:c.NOW,simYears:2,lifePlan:old});
  assert.equal(migrated.lifePlan.rows[0].income,null);
  assert.equal(c.validateLifePlan(migrated.lifePlan,c.NOW).length,0);
});
test('anchor: sync allocations never removes the year-0 allocation and refills it when missing',()=>{
 const {c,s,lp,r}=unified();r.income={amount:20e6,growth:0,anchor:c.NOW};
 delete r.allocation;
 const res=c.syncLifeAllocations(lp);
 assert.equal(res.added,1);assert.ok(r.allocation);
 assert.equal(c.validateLifePlan(lp,c.NOW).length,0);
});
test('income growth v3: growth is the total nominal rate from now; 0 keeps the entered amount flat',()=>{
 const {c,s,lp,r}=unified();r.income={amount:20e6,growth:6,anchor:c.NOW};
 near(c.lifeSalary(lp,c.NOW),20e6);                                   // năm 0: đúng số nhập
 near(c.lifeSalary(lp,c.NOW+120),20e6*Math.pow(1.06,10));             // năm 10: tăng đều 6%/năm từ gốc
 // Mốc tại năm 10 nhập 25 triệu giá hiện tại: tại mốc đã nhân 6%/năm đủ 10 năm (KHÔNG nhân thêm lạm phát ngầm)
 const second={id:'s2',from:c.NOW+120,label:'Raise',income:{amount:25e6,growth:6,anchor:c.NOW+120},allocation:null};lp.rows.push(second);
 near(c.lifeSalary(lp,c.NOW+120),25e6*Math.pow(1.06,10));
 near(c.lifeSalary(lp,c.NOW+132),25e6*Math.pow(1.06,11));             // sau mốc 1 năm: tiếp tục 6%/năm
 // Dời mốc không phải neo: số nhập (giá hiện tại) giữ nguyên, thời điểm bắt đầu thay đổi
 assert.equal(c.moveLifeComponent(lp,second,'income',c.NOW+240),'');
 const moved=lp.rows.find(x=>x.from===c.NOW+240);
 near(moved.income.amount,25e6);                                       // số nhập không đổi
 near(c.lifeSalary(lp,c.NOW+240),25e6*Math.pow(1.06,20));              // 6%/năm đủ 20 năm kể từ gốc
 // Tăng 0% = đứng nguyên số nhập mọi năm, kể cả mốc ở năm sau năm thứ 0 (thu theo giá quy định, vd phí gửi xe)
 const fixed={id:'s3',from:c.NOW+36,label:'Giá quy định',income:{amount:1e6,growth:0,anchor:c.NOW+36},allocation:null};lp.rows.push(fixed);
 near(c.lifeSalary(lp,c.NOW+36),1e6);
 near(c.lifeSalary(lp,c.NOW+120),1e6);
 near(c.lifeSalary(lp,c.NOW+239),1e6);   // hết tháng trước mốc "Raise" dời tới, giá quy định vẫn đứng nguyên
});
test('income current-price: migrateState converts v1 amounts to current price, v2 growth to combined total rate',()=>{
 const c=fresh(3);const NOW0=c.NOW;
 const saved={schemaVersion:7,startMonth:NOW0,simYears:3,infl:5,
   lifePlan:{version:1,reviewMonths:12,emergencyMonths:3,rows:[
     {id:'a0',from:NOW0,label:'Hiện tại',income:{amount:0,growth:0,anchor:NOW0},allocation:{reserveMonths:12,weights:{tk:20,tp:20,cp:60,gold:0}}},
     {id:'a1',from:NOW0+60,label:'Tăng lương',income:{amount:30e6,growth:6,anchor:NOW0+60},allocation:null}]}};
 const m=c.migrateState(JSON.parse(JSON.stringify(saved)));
 const row=m.lifePlan.rows.find(x=>x.from===NOW0+60);
 near(row.income.amount,30e6/Math.pow(1.05,5));                       // quy lùi 5 năm lạm phát (giá hiện tại giữ nguyên)
 near(row.income.growth,11.3);                                        // (1,05×1,06−1) — gộp lạm phát vào tốc độ tổng
 assert.ok(m.lifePlan.version>=3);
 assert.ok(m.lifePlan.rows.find(x=>x.from===NOW0));                   // mốc neo vẫn được tạo lại nếu thiếu
 // Mức thực nhận: tăng theo tốc độ tổng 11,3%/năm kể từ gốc = lãi kép (1,05×1,06) đúng ý "6% thật sau 5% lạm phát"
 c.state.lifePlan=m.lifePlan;c.state.infl=m.infl;
 near(c.lifeSalary(c.state.lifePlan,NOW0+60),30e6*Math.pow(1.06,5));
 near(c.lifeSalary(c.state.lifePlan,NOW0+72),30e6*Math.pow(1.06,5)*1.113);
 assert.ok(c.migrationMessages.some(x=>x.indexOf('giá hiện tại')>=0));
 assert.ok(c.migrationMessages.some(x=>x.indexOf('Tăng %/năm')>=0));
});
test('income growth v3: migrateState combines saved v2 growth with inflation so amounts stay untouched',()=>{
 const c=fresh(3);const NOW0=c.NOW;
 const saved={schemaVersion:9,startMonth:NOW0,simYears:3,infl:4,
   lifePlan:{version:2,reviewMonths:12,reserveBasis:'expenses',rows:[
     {id:'a0',from:NOW0,label:'Hiện tại',income:{amount:20e6,growth:2,anchor:NOW0},allocation:{reserveMonths:12,weights:{tk:20,tp:20,cp:60,gold:0}}},
     {id:'a1',from:NOW0+24,label:'Thu thêm',income:{amount:3e6,growth:0,anchor:NOW0+24},allocation:null}]}};
 const m=c.migrateState(JSON.parse(JSON.stringify(saved)));
 const r0=m.lifePlan.rows.find(x=>x.from===NOW0),r1=m.lifePlan.rows.find(x=>x.from===NOW0+24);
 near(r0.income.amount,20e6);near(r0.income.growth,6.08);             // (1,04×1,02−1) làm tròn 2 số thập phân
 near(r1.income.amount,3e6);near(r1.income.growth,4);                 // 0% cũ = chỉ lạm phát
 assert.ok(m.lifePlan.version>=3);
 c.state.lifePlan=m.lifePlan;c.state.infl=m.infl;
 near(c.lifeSalary(c.state.lifePlan,NOW0+12),20e6*1.0608);
 near(c.lifeSalary(c.state.lifePlan,NOW0+36),3e6*Math.pow(1.04,3));   // 4%/năm kể từ gốc, tại năm thứ 3
 assert.ok(c.migrationMessages.some(x=>x.indexOf('Tăng %/năm')>=0));
 // Bản v3 lưu rồi phải nguyên trạng khi migrate lại
 const again=JSON.parse(JSON.stringify(m.lifePlan));
 assert.equal(JSON.stringify(c.migrateState(JSON.parse(JSON.stringify({schemaVersion:9,startMonth:NOW0,simYears:3,infl:4,lifePlan:again}))).lifePlan),JSON.stringify(again));
});
test('sync allocations: keeps matched, adds missing (inheriting the latest earlier allocation), removes orphaned',()=>{
 const {c,s,lp,r}=unified();r.income={amount:20e6,growth:0,anchor:c.NOW};
 lp.rows.push({id:'inc2',from:c.NOW+24,label:'Lương mới',income:{amount:30e6,growth:5,anchor:c.NOW+24},allocation:null});
 lp.rows.push({id:'inc3',from:c.NOW+36,label:'Lương nữa',income:{amount:30e6,growth:0,anchor:c.NOW+36},allocation:null});
 lp.rows.push({id:'orphan',from:c.NOW+48,label:'Phân bổ riêng',income:null,allocation:{reserveMonths:6,weights:{tk:50,tp:50,cp:0,gold:0}}});
 const res=c.syncLifeAllocations(lp);   // đối tượng tạo trong VM realm — so từng trường, không deepEqual
 assert.equal(res.added,2);assert.equal(res.removed,1);
 // Mốc thu nhập đã có phân bổ cùng tháng: giữ nguyên từng số
 assert.deepEqual(JSON.parse(JSON.stringify(r.allocation)),{reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}});
 // Mốc thu nhập thiếu phân bổ: thừa hưởng phân bổ kế trước (mốc NOW; mốc NOW+36 kế qua NOW+24)
 const inc2=lp.rows.find(x=>x.id==='inc2'),inc3=lp.rows.find(x=>x.id==='inc3');
 assert.deepEqual(JSON.parse(JSON.stringify(inc2.allocation)),{reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}});
 assert.deepEqual(JSON.parse(JSON.stringify(inc3.allocation)),{reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}});
 // Mốc phân bổ không còn mốc thu nhập cùng tháng: xóa hẳn khỏi kế hoạch
 assert.equal(lp.rows.find(x=>x.id==='orphan'),undefined);
 assert.equal(c.validateLifePlan(lp,c.NOW).length,0);
});
test('sync allocations: no-op when matched; plan without any income stays untouched',()=>{
 const {c,s,lp,r}=unified();r.income={amount:20e6,growth:0,anchor:c.NOW};
 let res=c.syncLifeAllocations(lp);assert.equal(res.added,0);assert.equal(res.removed,0);
 delete r.income;   // chỉ còn phân bổ, không còn mốc thu nhập nào
 const before=JSON.stringify(lp);
 res=c.syncLifeAllocations(lp);assert.equal(res.added,0);assert.equal(res.removed,0);
 assert.equal(JSON.stringify(lp),before);
});

test('MMF stage months: salary does not reduce reserve; retirement, inflation, zero and insufficient assets',()=>{
  const {c,s,lp,r}=unified(3);s.assets.cp=1000e6;s.milestones[0].monthly=10e6;s.infl=10;
  r.income.amount=20e6;r.allocation.reserveMonths=3;
  lp.rows.push({id:'retire',from:c.NOW+12,label:'Retire',income:{amount:0,growth:0,anchor:c.NOW+12},allocation:{reserveMonths:12,weights:{tk:0,tp:40,cp:60,gold:0}}});
  lp.rows.push({id:'zero',from:c.NOW+24,label:'Zero',allocation:{reserveMonths:0,weights:{tk:0,tp:40,cp:60,gold:0}}});
  const a=c.runSim(true).months;
  near(a[0].mmf,30e6);near(a[0].strategy.reserveTarget,30e6);
  near(a[12].mmf,132e6);near(a[12].strategy.reserveTarget,132e6);
  near(a[24].mmf,0);near(a[35].strategy.reserveTarget,0);
  s.assets.cp=5e6;r.income.amount=10e6;
  const low=c.runSim(true).months[0];near(low.mmf,5e6);near(low.strategy.reserveTarget,30e6);near(low.strategy.reserveShort,25e6);
});
test('MMF migration preserves stage months and inputs, removes the global floor and survives roundtrip',()=>{
  const {c,s,lp,r}=unified();lp.emergencyMonths=24;delete lp.reserveBasis;r.allocation.reserveMonths=0;
  const before=JSON.stringify(s),m=c.migrateState(JSON.parse(before));
  assert.equal(JSON.stringify(s),before);assert.equal(m.lifePlan.emergencyMonths,undefined);
  assert.equal(m.lifePlan.reserveBasis,'expenses');near(m.lifePlan.rows[0].allocation.reserveMonths,0);
  assert.equal(JSON.stringify(m.assets),JSON.stringify(s.assets));assert.equal(JSON.stringify(m.series),JSON.stringify(s.series));
  assert.equal(JSON.stringify(c.migrateState(JSON.parse(JSON.stringify(m))).lifePlan),JSON.stringify(m.lifePlan));
  assert.ok(!c.migrationMessages.some(x=>x.includes('Dự phòng MMF'))); /* 19/09/2026 — bỏ banner thông báo thay đổi */
});

test('cost-aware: a fractional gold target does not cause a sale that cannot fund a useful purchase',()=>{
  const {c,s,p}=managed(2);s.assets.cp=100e6;s.goldPrice=100e6;s.goldSpread=5;
  p.weights={tk:0,tp:0,cp:50,gold:50};
  const m=c.runSim(true).months[0];
  assert.equal(m.strategy.trades.length,0);near(m.cp,100e6);near(m.gold,0);near(m.ledger.goldSpreadCost,0);
});

test('cost-aware: MMF is replenished at review or half-target trigger, not after every bill',()=>{
  const {c,s,lp,r}=unified(2);lp.reviewMonths=12;r.allocation.reserveMonths=12;
  r.allocation.weights={tk:0,tp:0,cp:100,gold:0}; // không có lô sắp đáo hạn để chờ
  s.assets.cp=1000e6;s.milestones[0].monthly=10e6;
  const a=c.runSim(true).months;
  near(a[0].mmf,120e6);near(a[1].mmf,110e6);near(a[6].mmf,60e6);
  assert.equal(a[1].strategy.trades.length,0);assert.equal(a[6].strategy.trades.length,0);
  assert.equal(a[7].strategy.refillTrigger,true);near(a[7].mmf,120e6);
  assert.ok(a[7].strategy.trades.some(t=>t.side==='sell'));
});

test('cost-aware: known December bill stays liquid instead of buying and redeeming a young bond',()=>{
  const {c,s,p}=managed(2);s.assets.mmf=100e6;p.weights={tk:0,tp:100,cp:0,gold:0};
  s.landPlots=[plot({expenses:[{y:2026,label:'Sửa nhà',amount:50e6}]})];
  const a=c.runSim(true).months;
  near(a[0].mmf,50e6);near(a[0].tp,50e6);
  near(a[11].drawn.mmf,50e6);near(a[11].ledger.tpFee,0);
  assert.ok(!a.slice(0,12).some(m=>m.strategy.trades.some(t=>t.asset==='tp'&&t.side==='sell')));
});

test('cost-aware: configured ETF trade fees reduce NAV once and are shown on each order',()=>{
  const {c,s,p}=managed(2);s.assets.mmf=100e6;s.rates.cpBuyFee=.2;s.rates.cpSellFee=.3;
  p.weights={tk:0,tp:0,cp:100,gold:0};s.milestones[0].monthly=10e6;
  const a=c.runSim(true).months;
  near(a[0].ledger.cpFee,180000); // spend 10m first, invest remaining 90m
  near(a[0].cp,89.82e6);near(a[0].ledger.error,0);
  const sell=a[1].strategy.trades.find(t=>t.asset==='cp'&&t.side==='sell');
  assert.ok(sell&&sell.cost>0);near(a[1].ledger.cpFee,sell.cost);near(a[1].ledger.error,0);
});

test('cost-aware: configurable bond exit period and fee postpone an optional sale until free',()=>{
  const {c,s,p}=managed(2);s.assets.mmf=100e6;s.rates.tpEarlyFee=4;s.rates.tpMinMonths=3;
  p.weights={tk:0,tp:100,cp:0,gold:0};
  const next=c.investmentStage(c.NOW+1,'Đổi sang cổ phiếu');
  Object.assign(next,{reserveMonths:0,reviewMonths:1,weights:{tk:0,tp:0,cp:100,gold:0}});
  s.investmentPlan.stages.push(next);
  const a=c.runSim(true).months;
  assert.ok(!a[1].strategy.trades.some(t=>t.asset==='tp'&&t.side==='sell'));
  assert.ok(!a[2].strategy.trades.some(t=>t.asset==='tp'&&t.side==='sell'));
  assert.ok(a[3].strategy.trades.some(t=>t.asset==='tp'&&t.side==='sell'&&t.cost===0));
  near(a.reduce((sum,m)=>sum+m.ledger.tpFee,0),0);
});
