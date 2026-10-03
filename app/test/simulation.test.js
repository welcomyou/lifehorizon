const test=require('node:test'),assert=require('node:assert/strict');
const {context,fresh,plot,html}=require('./harness');
function near(a,b,t=.001){assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);}
function wage(c,amount){c.state.incomePeriods=[{fromY:2026,toY:2100,amount,growth:0}];}
function event(c,kind,amount,y=0){c.state.events.push({y,kind,amount,label:'test'});}
function invest(c,w){var p=c.state.investmentPlan.stages[0];p.weights=Object.assign({tk:0,tp:0,cp:0,gold:0},w);} /* Đợt 14: tiền dư đi theo tỷ trọng giai đoạn thay vì alloc từng pha */
function end(c){return c.runSim(false).months.at(-1);}
for(const startOffset of [0,8])test(`expense: last phase covers all 30 remaining years with inflation since base month (offset ${startOffset})`,()=>{
  const c=fresh(40),s=c.state;c.setNow(2026*12+startOffset);
  s.assets.mmf=100e9;s.infl=4;
  // Deliberately unsorted: the last chronological milestone, not array order, determines spending.
  s.milestones=[{y:10,monthly:10e6},{y:0,monthly:20e6},{y:5,monthly:15e6}];
  const before=JSON.stringify(s.milestones),sim=c.runSim(true),m=sim.months;
  assert.equal(m.length,480);assert.equal(JSON.stringify(s.milestones),before);
  let multiplier=1,totalSpent=0;
  for(let y=0;y<40;y++){
    const base=y<5?20e6:y<10?15e6:10e6;
    for(let k=0;k<12;k++)near(m[y*12+k].expense,base*multiplier);
    totalSpent+=12*base*multiplier;multiplier*=1.04;
  }
  near(m[120].expense,14802442.84918344); // 10m at year 10 already includes ten years of inflation.
  // Quy tắc quỹ trái phiếu: bán TP trong 12 tháng đầu nạp bị trừ 2% phí — nằm trong sim.tpRedemptionFees.
  near(m[479].total,100e9-totalSpent-sim.tpRedemptionFees,.01);
  near(sim.years.reduce((sum,y)=>sum+y.exp,0),totalSpent,.01);
});
test('expense: changing the horizon retains the active last phase; future milestones stay inactive',()=>{
  const c=fresh(40),s=c.state;s.infl=4;
  s.milestones=[{y:0,monthly:20e6},{y:10,monthly:10e6},{y:50,monthly:1e6}];
  const before=JSON.stringify(s.milestones);
  for(const years of [20,40,45]){
    s.simYears=years;
    const sim=c.runSim(true),m=sim.months;
    assert.equal(m.length,years*12);
    near(m[120].expense,14802442.84918344);
    near(m.at(-1).expense,10e6*1.04**(years-1));
    assert.equal(JSON.stringify(s.milestones),before);
  }
});
test('pension: offsets living costs, increases NAV, and is included by default in risk checks',()=>{
  const c=fresh(2),s=c.state;s.assets.mmf=100e6;s.milestones[0].monthly=1e6;
  s.pensionSimple={amount:2e6,startYear:2026,startMonth:9,growth:10};
  const withPension=c.runSim(true),without=c.runSim(false);
  near(withPension.pensionGot,32.8e6); // Twelve payments of 2m, then four of 2.2m.
  near(withPension.months[7].pension,0);
  near(withPension.months[8].drawn.mmf||0,0);
  near(withPension.months[8].bought.tp,0); // khoản hưu dư giữ trong MMF khi dự phòng chưa đủ
  near(withPension.months[8].mmf,6e6);
  near(withPension.months.at(-1).total,108.8e6-withPension.tpRedemptionFees);
  near(without.months.at(-1).total,76e6-without.tpRedemptionFees);
  const risk=c.riskCheck(3);
  for(const q of ['p10','p50','p90'])near(risk[q],108.8e6-withPension.tpRedemptionFees);
  // Contributions are reference data. The already selected monthly pension remains the input to runSim.
  s.periods=[{from:'2026-01',to:'2027-12',type:'tn',bh:10e6,growth:0}];
  assert.ok(c.bhxhSummary().contribFuture>0);
  near(c.runSim(true).months.at(-1).total,108.8e6-withPension.tpRedemptionFees);
});
for(const k of ['tk','tp'])test(`${k}: annual 6.5% compounds/accrues to 106.5m`,()=>{let c=fresh(1);c.state.assets[k]=100e6;c.state.rates[k]=6.5;near(end(c)[k],106.5e6);});
test('mmf: annual 6.5% compounds to 106.5m while held as the plan reserve',()=>{let c=fresh(1);c.state.assets.mmf=100e6;c.state.rates.mmf=6.5;c.state.milestones[0].monthly=5e6;c.state.investmentPlan.stages[0].reserveMonths=24;wage(c,5e6);near(end(c).mmf,106.5e6);});
for(const k of ['cp','gold','land'])test(`${k}: NAV follows this month's +10%, -20%`,()=>{let c=fresh(1),s=c.state;if(k==='cp')s.assets.cp=100e6;if(k==='gold')s.goldChi=10;if(k==='land')s.landPlots=[plot({total:100e6})];s.series[k][0]=.1;s.series[k][1]=-.2;let m=c.runSim(false).months;near(m[0][k],110e6);near(m[1][k],88e6);});
test('savings: partial early withdrawal forfeits interest on that principal only',()=>{let c=fresh(),b=new c.SavingsBook(100e6,6.5);for(let i=0;i<6;i++)b.tick();near(b.value(),103.25e6);near(b.withdraw(10e6).lost,325000);near(b.value(),92.925e6);for(let i=0;i<6;i++)b.tick();near(b.value(),95.85e6);near(b.withdraw(10e6).lost,0);});
test('savings: protects interest capitalized in prior years',()=>{let b=new (fresh().SavingsBook)(100e6,10);for(let i=0;i<18;i++)b.tick();near(b.principal(),110e6);near(b.withdraw(10e6).lost,500000);});
test('savings: withdraw youngest lot first',()=>{let b=new (fresh().SavingsBook)(100e6,10);for(let i=0;i<6;i++)b.tick();b.deposit(10e6);near(b.withdraw(10e6).lost,0);near(b.value(),105e6);});
test('savings: new end-month deposit accrues next month, annual maturity',()=>{let c=fresh();c.state.rates.tk=12;event(c,'thu',100e6,0);invest(c,{tk:100});let m=c.runSim(false).months;near(m[0].tk,100e6);near(m[1].tk,101e6);near(m[11].tk,111e6);near(m[12].tk,112e6);});
/* Quy tắc quỹ (yêu cầu 13/09/2026): lãi MMF và lãi Quỹ Trái phiếu BẢO TOÀN khi rút ở mọi thời điểm;
   riêng Quỹ Trái phiếu, phần rút từ tiền nạp trong 12 tháng đầu bị trừ 2% phí — rút gói cũ trước. */
test('fund: mmf withdrawal keeps all accrued interest',()=>{
  let c=fresh(2);c.state.assets.mmf=100e6;c.state.rates.mmf=6.5;c.state.infl=0;
  c.state.milestones[0].monthly=5e6;c.state.investmentPlan.stages[0].reserveMonths=24;wage(c,5e6);
  c.state.events=[{y:1,kind:'chi',amount:106.5e6,label:'rút toàn bộ'}]; // rút hết sau 12 tháng
  const sim=c.runSim(false);
  near(sim.months[11].mmf,106.5e6); // lãi đầy đủ vẫn trong tài khoản trước khi chi
  assert.equal(sim.shortfall,0);
  near(sim.months[12].total,106.5e6*(Math.pow(1.065,1/12)-1),.01); // rút được toàn bộ; chỉ dư lãi tháng 12 (đã mua vào Quỹ Trái phiếu)
});
test('fund: bond interest preserved on withdrawal, 2% fee only within first 12 months, oldest lot first',()=>{
  let b=new (fresh().FundBook)(100e6,12,2,12); // số dư ban đầu coi như đã giữ trên 1 năm
  for(let i=0;i<6;i++)b.tick(); // 6 tháng: 100e6 × 1.12^(6/12)
  near(b.value(),100e6*Math.pow(1.12,.5));
  let w=b.withdraw(50e6);near(w.fee,0);near(w.got,50e6);near(b.value(),100e6*Math.pow(1.12,.5)-50e6); // gói cũ: không phí, lãi giữ nguyên
  b.deposit(50e6); // gói mới, age 0 — sổ trở về đúng giá trị V
  const V=100e6*Math.pow(1.12,.5);
  w=b.withdraw(V); // rút toàn bộ: gói cũ không phí; gói mới (principal 50e6) chịu trần phí 2% trên 50e6
  near(w.fee,1e6);near(w.got,V-1e6);
  near(b.value(),0);
});
test('fund: oldest lot withdrawn first so a fresh deposit does not trigger the fee',()=>{
  let b=new (fresh().FundBook)(0,0,2,12);
  b.lots=[{principal:100e6,age:12},{principal:10e6,age:0}];
  let w=b.withdraw(100e6);near(w.fee,0);near(w.got,100e6); // gói cũ đáo hạn trước — không phí
  near(b.value(),10e6);
  w=b.withdraw(10e6);near(w.fee,10e6*0.02);near(w.got,9.8e6); // gói mới: mất 2% phần rút
  near(b.value(),0);
});
test('fund: a later bond purchase keeps its own 12-month fee period',()=>{
  let b=new (fresh().FundBook)(0,0,2,12);
  b.deposit(100e6);
  for(let i=0;i<11;i++)b.tick();
  b.deposit(100e6);
  b.tick();
  const w=b.withdraw(200e6);
  near(w.got,198e6);near(w.fee,2e6);near(b.value(),0);
});
test('fund: runSim waits for bond maturity when MMF can cover known bills',()=>{
  let c=fresh(2);c.state.assets.mmf=100e6;c.state.milestones[0].monthly=1e6; // như test pension không hưu
  const sim=c.runSim(false);
  near(sim.tpRedemptionFees,0);
  near(sim.months.at(-1).total,100e6-24e6-sim.tpRedemptionFees,.01);
  c.state.assets.tp=100e6;c.state.milestones[0].monthly=1e6;
  const sim2=c.runSim(false); // TP ban đầu là gói cũ — không phí khi rút
  assert.equal(sim2.tpRedemptionFees,0);
});
test('savings ladder: independent first-year balance, 12 bills mature without forfeiture',()=>{
  const c=fresh(),b=new c.SavingsBook(1e9,7),bills=Array(12).fill(10e6);
  b.plan(bills,0,3,4.5);near(b.value(),1e9);
  // Reserve exact principals that grow to each bill; remaining capital earns 7% for a year.
  let allocated=0;
  for(let month=1;month<=12;month++)allocated+=10e6/(1+(month<6?.03:month<12?.045:.07)*month/12);
  for(let month=1;month<=12;month++){b.tick();near(b.withdraw(10e6).got,10e6);}
  near(b.forfeited,0);near(b.value(),(1e9-allocated)*1.07,.001);
});
test('savings ladder: MMF offsets bills, original unspent capital stays in the long deposit',()=>{
  const c=fresh(),b=new c.SavingsBook(1e9,7);
  b.plan(Array(12).fill(10e6),120e6,3,4.5);
  for(let i=0;i<12;i++)b.tick();
  near(b.value(),1.07e9);near(b.forfeited,0);
});
test('savings ladder: replanning never breaks a locked lot or duplicates an existing maturity',()=>{
  const c=fresh(),b=new c.SavingsBook(1e9,7);
  b.plan([0,10e6],0,3,4.5);b.tick();
  const before=b.value(),locked=JSON.stringify(b.lots);
  b.plan([10e6],0,3,4.5);near(b.value(),before);assert.equal(JSON.stringify(b.lots),locked);
  b.deposit(100e6);b.plan([10e6],0,3,4.5);b.tick();
  near(b.withdraw(10e6).lost,0);near(b.forfeited,0);
  assert.ok(b.lots.some(l=>l.term===12&&l.principal===100e6));
});
test('savings ladder: an unplanned early withdrawal loses only the withdrawn portion interest',()=>{
  const c=fresh(),b=new c.SavingsBook(100e6,7);b.plan([],0,3,4.5);
  for(let i=0;i<6;i++)b.tick();
  near(b.withdraw(10e6).lost,350000);near(b.value(),93.15e6);
});
test('savings ladder: pension, income and known events reduce the amount to prepare',()=>{
  const c=fresh();
  const f=[{salary:10e6,pension:3e6,expense:20e6,eventOut:5e6,eventIn:4e6},
    {salary:30e6,pension:0,expense:20e6,eventOut:0,eventIn:0}];
  assert.deepEqual(Array.from(c.savingsDeficits(f,0,[])),[8e6,0]);
});
test('savings ladder: short rates migrate, roundtrip and reject invalid inputs',()=>{
  const c=fresh(),old=JSON.parse(JSON.stringify(c.state));delete old.rates.tkShort;delete old.rates.tkMedium;
  const migrated=c.migrateState(old);near(migrated.rates.tkShort,3);near(migrated.rates.tkMedium,4.5);near(migrated.rates.tk,0);
  migrated.rates.tkShort=2.7;migrated.rates.tkMedium=4.1;
  const restored=c.migrateState(JSON.parse(JSON.stringify(migrated)));
  near(restored.rates.tkShort,2.7);near(restored.rates.tkMedium,4.1);
  c.state.rates.tkShort=-1;assert.ok(c.validateState().some(e=>e.level==='error'&&e.msg.includes('1–5')));
});
test('gold: initial NAV uses sale price',()=>{let c=fresh(1);c.state.goldChi=10;c.state.goldSpread=2;near(end(c).gold,98e6);});
test('gold: buying whole chi charges spread once and preserves change',()=>{let c=fresh(1);c.state.goldSpread=2;event(c,'thu',55e6,0);invest(c,{gold:100});let m=c.runSim(false).months[0];near(m.chi,5);near(m.gold,49e6);near(m.mmf,5e6);near(m.total,54e6);near(m.ledger.goldSpreadCost,1e6);});
test('gold: selling uses bid, does not charge spread twice',()=>{let c=fresh(1);c.state.goldChi=10;c.state.goldSpread=2;event(c,'chi',15e6);let m=c.runSim(false).months[0];near(m.gold,78.4e6);near(m.tp,4.6e6);near(m.total,83e6);near(m.ledger.goldSpreadCost,0);});
test('new stock purchase earns only future returns',()=>{let c=fresh(1);c.state.series.cp[0]=1;c.state.series.cp[1]=-.5;event(c,'thu',100e6,0);invest(c,{cp:100});let m=c.runSim(false).months;near(m[0].cp,100e6);near(m[1].cp,50e6);});
test('end-month salary funds same-month event before liquidation',()=>{let c=fresh(1);wage(c,100e6);event(c,'chi',50e6);let sim=c.runSim(false);near(sim.months[0].total,50e6);near(sim.shortfall,0);near(sim.months.at(-1).total,1150e6);});
test('same-month event input order does not change available cash',()=>{let c=fresh(1);event(c,'chi',50e6);event(c,'thu',100e6);let a=end(c);c.state.events.reverse();let b=end(c);near(a.total,50e6);near(b.total,50e6);near(b.short,0);});
test('surplus follows the stage weights, cash first covered by the reserve',()=>{let c=fresh(1);invest(c,{cp:100});wage(c,10e6);near(end(c).cp,120e6);near(end(c).mmf,0);});
test('salary+pension surplus follows the same stage weights as salary-only months',()=>{let c=fresh(1),s=c.state;s.milestones[0].monthly=1e6;s.pensionSimple={amount:5e6,startYear:2026,startMonth:1,growth:0};wage(c,10e6);invest(c,{tk:100});let m=c.runSim(true).months;near(m[0].tk,2e6);near(m[0].cp,0);near(m[0].mmf,12e6);});
test('pension-only surplus follows the stage weights too',()=>{let c=fresh(1),s=c.state;s.milestones[0].monthly=1e6;s.pensionSimple={amount:5e6,startYear:2026,startMonth:1,growth:0};invest(c,{cp:100});let m=c.runSim(true).months;near(m[0].cp,0);near(m[0].mmf,4e6);near(m[3].cp,4e6);near(m[3].mmf,12e6);near(m[0].tk,0);});
test('reserve for the months after income stops is funded before investing',()=>{let c=fresh(2);c.state.milestones[0].monthly=10e6;const p=c.state.investmentPlan.stages[0];p.reserveMonths=12;invest(c,{cp:100});c.state.incomePeriods=[{fromY:2026,toY:2026,amount:20e6,growth:0}];let m=c.runSim(false).months[0];near(m.mmf,10e6);near(m.cp,0);});
test('no hidden property purchase fund or automatic purchases',()=>{let c=fresh(1);wage(c,50e6);let m=end(c);near(m.total,600e6);near(m.land,0);});
test('property: December sale includes current monthly return, separate sales column',()=>{let c=fresh(1);c.state.landPlots=[plot({saleYear:2026})];c.state.series.land.fill(.01);let sim=c.runSim(false);near(sim.months[10].land,1e9*1.01**11);near(sim.months[11].land,0);near(sim.landSold,1e9*1.01**12);near(sim.evIn,0);});
test('property: explicit sale price is in today\'s money, inflated to the sale month, allocated per stage weights',()=>{let c=fresh(2);c.state.landPlots=[plot({saleYear:2027,salePrice:1.5e9})];c.state.infl=10;wage(c,0);invest(c,{cp:100});let m=end(c);const fv=1.5e9*Math.pow(1.1,(2027*12+11-2026*12)/12);near(m.cp,fv);near(m.ledger.salePnL,fv-1e9);});
test('property: optional per-property no-early-sale keeps whole property despite shortage',()=>{let c=fresh(1);c.state.landPlots=[plot({sellable:false})];event(c,'chi',1e6);let s=c.runSim(false);near(s.shortfall,1e6);near(s.months[0].land,1e9);});
test('property: 40m2 may be sold whole, without minimum lot',()=>{let c=fresh(1);c.state.landPlots=[plot({area:40,total:400e6})];event(c,'chi',100e6);let m=end(c);near(m.land,0);near(m.total,300e6);});
test('emergency sale: smallest whole property first at current modeled value',()=>{let c=fresh(1);c.state.landPlots=[plot(),plot({id:'small',total:200e6,saleYear:2027,salePrice:999e6})];event(c,'chi',50e6);let m=end(c);near(m.land,1e9);near(m.tp,150e6);near(m.total,1150e6);});
test('property: early sale stops rent and cancels later scheduled sale',()=>{let c=fresh(2);c.state.landPlots=[plot({rent:true,rentVnd:10e6,saleYear:2027})];event(c,'chi',100e6);let s=c.runSim(false);near(s.years[0].inc,10e6);near(s.years[1].inc,0);near(s.landSold,1e9);near(s.months.at(-1).total,910e6);});
test('property: scheduled year earns rent through December only',()=>{let c=fresh(2);c.state.landPlots=[plot({rent:true,rentVnd:10e6,saleYear:2026})];let s=c.runSim(false);near(s.years[0].inc,120e6);near(s.years[1].inc,0);});
test('properties with identical labels retain independent valuation',()=>{let c=fresh(1);c.state.landPlots=[plot({total:2e9}),plot({id:'second',total:500e6})];near(end(c).land,2.5e9);});
/* ===== v8 — BĐS theo giá hiện tại: năm sở hữu, chi phí duy tu, Có thể bán từng BĐS ===== */
test('v8 ownYear: BĐS nhận giữa kỳ chưa nằm trong NAV/thuê trước năm sở hữu, lạm phát vào giá trị lúc nhận',()=>{
  let c=fresh(2);c.state.infl=10;c.state.series.land.fill(0);c.state.series.land[12]=.5;
  c.state.landPlots=[plot({ownYear:2027,total:1e9,rent:true,rentVnd:2e6,rentGrowth:0})];
  let s=c.runSim(false);
  near(s.initial,0);                                  // chưa sở hữu → không nằm trong tài sản đầu kỳ
  near(s.months[11].land,0);near(s.months[11].rent,0);
  near(s.months[12].land,1e9*1.1*1.5);                // giá trị nhập × lạm phát 1 năm, rồi ăn Return tháng đầu sở hữu
  near(s.months[12].rent,2e6*1.1);                    // giá thuê hiện tại × lạm phát tới năm sở hữu
  near(s.years[0].inc,0);near(s.years[1].inc,2.2e6*12);
});
test('v8 rentFromYear: chưa có tiền thuê trước năm bắt đầu thuê; lạm phát tính tới tháng bắt đầu thuê rồi mới tăng/năm; nhập trước năm sở hữu bị kẹp',()=>{
  let c=fresh(3);c.state.infl=10;c.state.series.land.fill(0);
  c.state.landPlots=[plot({rent:true,rentVnd:5e6,rentFromYear:2027,rentGrowth:10})];
  let s=c.runSim(false);
  near(s.years[0].inc,0);                                   // 2026 chưa cho thuê
  near(s.months[12].rent,5e6*Math.pow(1.1,1));              // T1/2027: 5 tr × lạm phát 1 năm (chưa tăng thuê)
  near(s.months[24-1].rent,5e6*Math.pow(1.1,1));            // T12/2027: vẫn năm thuê thứ 1
  near(s.months[24].rent,5e6*Math.pow(1.1,1)*1.1);          // T1/2028: đúng 12 tháng → +10%
  c.state.landPlots=[plot({ownYear:2028,rent:true,rentVnd:5e6,rentFromYear:2027,rentGrowth:0})];  // thuê trước năm sở hữu
  near(c.plotRentAt(c.state.landPlots[0],12),0);            // kẹp về năm sở hữu: 2027 (mi=12) vẫn 0
  near(c.plotRentAt(c.state.landPlots[0],24),5e6*Math.pow(1.1,2));
});
test('v8 bán BĐS (hẹn bán) là hết hẳn tiền thuê từ tháng sau — kể cả khi thuê bắt đầu muộn',()=>{
  let c=fresh(3);c.state.landPlots=[plot({rent:true,rentVnd:10e6,rentFromYear:2027,saleYear:2028})];
  let s=c.runSim(false);
  near(s.years[0].inc,0);                                   // 2026 chưa thuê
  near(s.years[1].inc,10e6*12);                             // 2027 thuê đủ 12 tháng
  near(s.years[2].inc,10e6*12);                             // 2028: thuê đủ đến tận tháng bán (T12)
  let m=s.months.at(-1);near(m.rent,10e6);                  // tháng 12/2028 vẫn nhận đủ tiền thuê
  near(s.landSold,1e9);                                     // bán cuối T12/2028
  // kỳ dài hơn: sau khi bán, các năm sau KHÔNG còn dòng thuê
  let c2=fresh(4);c2.state.landPlots=[plot({rent:true,rentVnd:10e6,rentFromYear:2027,saleYear:2028})];
  near(c2.runSim(false).years[3].inc,0);                    // năm 2029 sau bán: thuê = 0
});
test('v8 expenses: chi sửa chữa/duy tu phát sinh cuối tháng 12 năm chọn, đã gồm lạm phát; trước năm sở hữu bị bỏ',()=>{
  let c=fresh(2);c.state.infl=10;c.state.assets.mmf=200e6;
  c.state.landPlots=[plot({total:1e9,expenses:[{y:2027,label:'sửa mái',amount:50e6}]})];
  let s=c.runSim(false);
  near(s.months[23].plotExp,50e6*Math.pow(1.1,23/12));
  near(s.months[23].eventOut,50e6*Math.pow(1.1,23/12));
  near(s.months[23].ledger.error,0,.005);
  c.state.landPlots=[plot({ownYear:2028,total:1e9,expenses:[{y:2027,amount:50e6}]})];   // chi trước năm sở hữu: validation chặn mô phỏng
  assert.ok(c.validateState().some(e=>e.level==='error'&&e.msg.indexOf('trước năm sở hữu')>=0));
});
test('v8 early sale: chỉ BĐS đánh dấu Có thể bán bị bán — BĐS nhỏ hơn nhưng khóa vẫn giữ nguyên',()=>{
  let c=fresh(1);
  c.state.landPlots=[plot({id:'keep',total:200e6,sellable:false}),plot({id:'sell',total:1e9,sellable:true})];
  event(c,'chi',300e6);
  let m=end(c);near(m.land,200e6);near(m.short,0);near(m.total,200e6+700e6);
});
test('v8 migrate v7: yield %/năm → VND/tháng, giá bán tuyệt đối → giá hiện tại — dòng tiền giữ nguyên',()=>{
  let c=fresh(2);
  const saved=JSON.parse(JSON.stringify(c.state));
  saved.schemaVersion=7;saved.infl=10;
  saved.landPlots=[{id:'p1',label:'A',area:100,price:1e7,total:1e9,saleYear:2027,salePrice:1.21e9,rent:true,rentMode:'yield',rentYield:6,rentGrowth:0}];
  const m=c.migrateState(saved);
  c.state=m;c.state.lifePlan=c.newLifePlan(c.NOW);   // bản v7 thật luôn có lifePlan (bỏ qua check mốc neo)
  const p=c.state.landPlots[0];
  near(p.rentVnd,1e9*.06/12);                                    // yield 6%/năm trên 1 tỷ → 5 triệu/tháng
  near(p.salePrice,1.21e9/Math.pow(1.1,(2027*12+11-2026*12)/12));// 1,21 tỷ T12/2027 → quy về giá hiện tại
  assert.equal(p.sellable,true);assert.equal(p.expenses.length,0);assert.equal(p.ownYear,null);
  ['rentMode','rentYield','price','priceMode'].forEach(k=>assert.equal(k in p,false));
  c.state.lifePlan.rows[0].allocation.weights={tk:0,tp:0,cp:100,gold:0};   // lifePlan là nguồn tỷ trọng khi có mặt
  const sim=c.runSim(false);
  near(sim.landSold,1.21e9);                                     // bán đúng 1,21 tỷ danh nghĩa như bản cũ
  near(sim.months.at(-1).cp,1.21e9+24*5e6);                      // tiền bán + 24 tháng tiền thuê 5 triệu đều vào cp
});
test('risk sale rule uses unit-price peaks: the near-peak asset funds both spending and the future reserve',()=>{let c=fresh(2);c.state.goldChi=10;c.state.assets.cp=100e6;c.state.series.cp[0]=-.1;c.state.series.cp[12]=-.05;event(c,'chi',90e6);event(c,'chi',10e6,1);let s=c.runSim(false);near(s.months[0].gold,10e6);near(s.months[0].cp,90e6);near(s.months[0].drawn.gold,90e6);near(s.months[12].gold,0);near(s.months[12].cp,85.5e6);});
test('withdrawals: MMF then fee-free overweight asset before breaking a savings term',()=>{let c=fresh(1);Object.assign(c.state.assets,{mmf:10e6,tk:10e6,tp:10e6,cp:100e6});c.state.goldChi=10;event(c,'chi',35e6);let m=c.runSim(false).months[0],d=m.drawn;near(d.mmf,10e6);near(d.cp,25e6);assert.equal(d.tk,undefined);assert.equal(d.tp,undefined);assert.equal(d.gold,undefined);near(m.ledger.savingsForfeited,0);});
/* Nguồn MMF được theo dõi theo lô: chi khoản vào trước, đầu tư khoản vào sau. Bán nạp ròng
   chỉ trở thành nguồn chi khi khoản đó thực sự được rút; bán đổi sang tài sản khác không là nạp. */
test('nguồn MMF: dùng hết số dư ban đầu rồi mới chi khoản quỹ trái phiếu đã bán nạp',()=>{
  let c=fresh(3),s=c.state;
  s.assets={mmf:10e6,tk:0,tp:200e6,cp:0,gold:0};s.milestones[0].monthly=5e6; // không thu nhập — rút hằng tháng
  const sim=c.runSim(false),m=sim.months;
  near(m[0].drawn.mmf,5e6);                       // chi trực tiếp từ MMF
  near(m[0].refillBySrc.tp,55e6);                 // nạp dự phòng 12 tháng (60tr) bán TP sau khi đã chi 5tr
  near(m[0].effDrawn.mmf,5e6);assert.equal(m[0].effDrawn.tp,undefined);
  near(m[1].effDrawn.mmf,5e6);                     // tháng 1 vẫn chi nốt MMF ban đầu
  near(m[2].effDrawn.tp,5e6);                      // chỉ từ tháng 2 mới chi tiền bán TP
  near(m[2].mmfSpentBySrc.tp,5e6);
  assert.equal(m[1].refillBySrc.tp,undefined);
  near(m[7].refillBySrc.tp,35e6);                 // chạm ngưỡng gần cạn 6 tháng (tháng 6 vừa khớp ngưỡng) → bán TP nạp đủ 12 tháng
  near(sim.years[0].srcDrawn.mmf,60e6);           // nguồn THÔ giữ nguyên (bảng Dòng tiền tháng, sổ giao dịch)
  assert.equal(sim.years[0].src,'Quỹ Trái phiếu');// nhãn năm theo nguồn gián tiếp
});
test('nguồn gián tiếp: target xoay tiền qua MMF không tính là nạp — rút MMF vẫn là Quỹ MMF',()=>{
  let c=fresh(2),s=c.state;s.assets.mmf=100e6;s.milestones[0].monthly=5e6;
  s.investmentPlan.stages[0].method='target'; // mọi lệnh bán qua MMF là tái cân bằng, không phải nạp dự phòng
  const sim=c.runSim(false),m=sim.months;
  near(m[0].drawn.mmf,5e6);near(m[0].effDrawn.mmf,5e6);assert.equal(m[0].effDrawn.tp,undefined);
  assert.deepEqual(Object.keys(m[0].refillBySrc),[]);
  assert.equal(sim.years[0].src,'Quỹ MMF');
});
test('nguồn gián tiếp: xoay tỷ trọng target qua MMF không tính là bán nạp dự phòng',()=>{
  let c=fresh(1),s=c.state;
  Object.assign(s.assets,{mmf:50e6,tk:150e6,cp:50e6});
  s.investmentPlan.stages[0].method='target';invest(c,{tk:50,cp:50});
  const m=c.runSim(false).months[0];              // bán TK dư 25tr qua MMF mua CP — tiền luân chuyển, không nạp giữ
  assert.deepEqual(Object.keys(m.refillBySrc),[]);
  near(m.tk,125e6);near(m.cp,125e6);near(m.mmf,0);
});
test('nguồn gián tiếp: bán trực tiếp bù chi giữ đúng tài sản bị bán, phần MMF đầu tiên giữ Quỹ MMF',()=>{
  let c=fresh(1);Object.assign(c.state.assets,{mmf:10e6,tk:10e6,tp:10e6,cp:100e6});c.state.goldChi=10;
  event(c,'chi',35e6);
  const m=c.runSim(false).months[0];
  near(m.effDrawn.mmf,10e6);near(m.effDrawn.cp,25e6);
  assert.equal(m.effDrawn.tk,undefined);assert.equal(m.effDrawn.tp,undefined);
  assert.deepEqual(Object.keys(m.refillBySrc),[]);
});
test('nguồn MMF: sai số dưới một xu không làm dừng hồ sơ 50 tỷ sau 32 năm',()=>{
  const c=context(),s=c.state;
  c.setNow(2026*12+9);s.lifePlan=c.newLifePlan(c.NOW); // state mẫu đầy đủ, neo độc lập ngày chạy test
  s.simYears=40;s.assets.mmf=50e9;
  const sim=c.runSim(true),m=sim.months;
  assert.equal(m.length,480);
  near(m[384].drawn.mmf-m[384].mmfSpentBySrc.tk,0,.01);
  assert.ok(Number.isFinite(m.at(-1).total)&&m.at(-1).total>0);
  m.forEach(x=>assert.ok(Math.abs(x.ledger.error)<=Math.max(.01,x.total*1e-10)));
});
for(let offset of [0,8])test(`real NAV uses elapsed months (start offset ${offset})`,()=>{let c=fresh(5);c.setNow(2026*12+offset);c.state.infl=10;c.state.assets.mmf=100e6;let s=c.runSim(false);near(end(c).real,100e6/1.1**5);near(s.years[0].real,100e6/1.1**(s.years[0].months/12));assert.equal(s.months.length,60);assert.equal(s.years[0].months,12-offset);});
const invalid={negative_rate:s=>s.rates.mmf=-101,negative_gold:s=>s.goldChi=-1,fractional_event:s=>s.events=[{y:.5,kind:'chi',amount:1}],missing_expense_zero:s=>s.milestones=[{y:1,monthly:0}],duplicate_expense:s=>s.milestones.push({y:0,monthly:0}),negative_spread:s=>s.goldSpread=-1,bad_stage_weights:s=>s.investmentPlan.stages[0].weights.tp=90,fractional_horizon:s=>s.simYears=5.5,infinite_balance:s=>s.assets.cp=Infinity,overlap_phases:s=>s.incomePeriods=[{fromY:2026,toY:2028,amount:1,growth:0},{fromY:2028,toY:2030,amount:1,growth:0}]};
for(const [name,mutate] of Object.entries(invalid))test(`reject invalid input: ${name}`,()=>{let c=fresh(1);mutate(c.state);assert.ok(c.validateErrors().length);assert.throws(()=>c.runSim(false));});
test('out-of-horizon events retained and warned, not silently executed',()=>{let c=fresh(1);event(c,'chi',1e6,5);assert.equal(c.validateErrors().length,0);assert.ok(c.validateState().some(x=>/ngoài kỳ/.test(x.msg)));near(c.runSim(false).shortfall,0);});
test('corrupt return at -100% rejected',()=>{let c=fresh(1);c.state.series.cp[0]=-1;assert.throws(()=>end(c));});
test('monthly accounting identity across mixed cashflows and 12 random worlds',()=>{for(let seed=1;seed<=12;seed++){let c=fresh(5),s=c.state;Object.assign(s.assets,{mmf:100e6,tk:100e6,tp:100e6,cp:100e6});s.goldChi=20;s.goldSpread=2;s.rates={mmf:4.5,tk:6.5,tp:6};s.milestones[0].monthly=20e6;wage(c,10e6);invest(c,{cp:30,tk:30,tp:20,gold:20});s.landPlots=[plot({rent:true,rentVnd:3e6,saleYear:2029,salePrice:1.2e9})];event(c,'chi',150e6,1);event(c,'thu',200e6,2);let world=c.makeWorld(seed,5);for(let k of c.SERIES_KEYS)s.series[k]=c.generateMonthly(k,s.seriesMeta[k],5,seed*3+['cp','gold','land'].indexOf(k),world,false);for(let m of c.runSim(false).months){near(m.ledger.error,0,.005);assert.ok(m.total>=0);assert.ok(m.liquid<=m.total+.001);}}});
test('CAGR constraint resolves previously failing saturated-year example',()=>{let c=fresh(5),a=[.8,.8,.8,.8,-.65].flatMap(r=>Array(12).fill((1+r)**(1/12)-1)),f=c.fitCAGR(a,.2);near(c.annualCAGR(f),.2,1e-12);for(let r of c.annualReturns(f))assert.ok(r>=-.65-1e-12&&r<=.8+1e-12);});
test('all three assets: annual and monthly returns agree; exact target CAGR',()=>{let c=fresh(5);for(let seed=0;seed<20;seed++)for(let k of c.SERIES_KEYS){let a=c.generateMonthly(k,c.state.seriesMeta[k],5,seed,c.makeWorld(seed,5),true);near(c.annualCAGR(a),c.state.seriesMeta[k].cagr,1e-12);let product=c.annualReturns(a).reduce((p,r)=>p*(1+r),1);near(product,a.reduce((p,r)=>p*(1+r),1),1e-10);}});
test('zero volatility has no fixed artificial crisis',()=>{let c=fresh(5);for(let k of c.SERIES_KEYS){let a=c.generateMonthly(k,{cagr:.06,sigma:0},5,42,null,false);a.forEach(r=>near(r,1.06**(1/12)-1,1e-12));}});
test('seed reproducibility and uncertain future CAGR',()=>{let c=fresh(5),meta={cagr:.09,sigma:.25};let a=c.generateMonthly('cp',meta,5,5,null,false),b=c.generateMonthly('cp',meta,5,5,null,false),d=c.generateMonthly('cp',meta,5,6,null,false);assert.deepEqual(a,b);assert.notDeepEqual(a,d);assert.ok(Math.abs(c.annualCAGR(a)-.09)>1e-6);});
test('horizon extension preserves all existing edited months',()=>{let c=fresh(2);c.state.series.cp[3]=.12;let original=[...c.state.series.cp];c.state.simYears=3;c.ensureSeries();assert.deepEqual([...c.state.series.cp.slice(0,24)],original);assert.equal(c.state.series.cp.length,36);});
test('risk quantiles reproduce with an explicit seed and respond to changed assumptions',()=>{let c=fresh(2);c.state.assets.cp=100e6;let a=c.riskCheck(20,false,0),b=c.riskCheck(20,false,0);assert.deepEqual(a,b);assert.ok(a.p10<=a.p50&&a.p50<=a.p90);c.state.seriesMeta.cp.cagr=.2;assert.ok(c.riskCheck(20,false,0).p50>a.p50);});
test('risk defaults to 1000 fresh scenarios per call without changing the saved plan',()=>{
  const c=fresh(1);c.state.assets.cp=100e6;
  const seeds=[12345,67890];let draws=0;
  c.crypto={getRandomValues(a){a[0]=seeds[draws++];return a;}};
  const before=JSON.stringify(c.state),a=c.riskCheck(),b=c.riskCheck();
  assert.equal(a.n,1000);assert.equal(b.n,1000);assert.equal(draws,2);
  assert.notEqual(a.p50,b.p50);
  assert.deepEqual(a,c.riskCheck(1000,true,seeds[0]));
  assert.equal(draws,2);assert.equal(JSON.stringify(c.state),before);
});
test('risk draws a fresh fallback seed when crypto is unavailable',()=>{
  const c=fresh(1);c.state.assets.cp=100e6;let draws=0;
  c.Math=Object.create(Math);c.Math.random=()=>++draws/4;
  const a=c.riskCheck(5),b=c.riskCheck(5);
  assert.equal(draws,2);assert.notEqual(a.p50,b.p50);
  assert.deepEqual(a,c.riskCheck(5,true,0x40000000));
  assert.deepEqual(b,c.riskCheck(5,true,0x80000000));
});
test('migration preserves every saved monthly path and property value, converts the plan, drops legacy fields',()=>{let c=fresh(1);let old=JSON.parse(JSON.stringify(c.state));delete old.schemaVersion;old.seriesV=1;old.series={gold:Array(12).fill(.001),cp:Array(12).fill(.002),land:Array(12).fill(.003)};old.allocRetire={land:80,tk:20};old.landPlots=[{label:'old',area:40,price:1e7,holdYears:2}];let s=c.migrateState(old);near(s.series.cp[0],.002);near(s.series.land[0],.003);assert.equal('allocRetire' in s,false);assert.equal(s.investmentPlan.stages.length,1);near(s.landPlots[0].total,400e6);assert.ok(s.landPlots[0].id);assert.equal(s.landPlots[0].saleYear,2027);});
test('default 40-year simulation has 480 finite monthly NAVs',()=>{let c=context(),s=c.runSim(true);assert.equal(s.months.length,480);s.months.forEach(m=>assert.ok(Number.isFinite(m.total)));});
test('migration aligns stale CAGR parameter with preserved monthly path',()=>{let c=fresh(1),saved=JSON.parse(JSON.stringify(c.state));saved.series.cp.fill(1.09**(1/12)-1);saved.seriesMeta.cp.cagr=.2;let s=c.migrateState(saved);near(s.seriesMeta.cp.cagr,.09,1e-12);near(s.series.cp[0],saved.series.cp[0],1e-12);});
test('migration converts legacy followInfl income phase to growth = infl (đợt 11 bỏ checkbox)',()=>{let c=fresh(1);let old=JSON.parse(JSON.stringify(c.state));old.infl=5;old.incomePeriods=[{fromY:2027,toY:null,amount:10000000,growth:0,followInfl:true,alloc:{mmf:0,tk:40,tp:30,cp:20,gold:10}},{fromY:2030,toY:2035,amount:20000000,growth:6,followInfl:false}];let s=c.migrateState(old);assert.equal('followInfl' in s.incomePeriods[0],false);near(s.incomePeriods[0].growth,5);assert.equal('followInfl' in s.incomePeriods[1],false);near(s.incomePeriods[1].growth,6);});
test('BHXH summary does not mutate saved inputs or invalidate risk signature',()=>{let c=context(),before=JSON.stringify(c.state);c.bhxhSummary();assert.equal(JSON.stringify(c.state),before);});
test('pension month 0 rejected instead of silently becoming January',()=>{let c=fresh(1);c.state.pensionSimple.startMonth=0;assert.ok(c.validateErrors().length);assert.throws(()=>c.runSim(true));});
test('pension starts at selected end-month, then grows on anniversary',()=>{let c=fresh(2);c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:9,growth:10};let m=c.runSim(true).months;near(m[7].total,0);near(m[8].total,10e6);near(m[19].total,120e6);near(m[20].total,131e6);});
test('default state ships with no pre-filled income phase',()=>{let c=context();/* F16: mảng tạo trong vm context khác realm Node — so cấu trúc, không deepEqual prototype */assert.ok(Array.isArray(c.state.incomePeriods));assert.strictEqual(c.state.incomePeriods.length,0);assert.strictEqual(JSON.stringify(c.state.incomePeriods),'[]');});
test('pension projection mirrors sim formula for manually entered pension',()=>{
  let c=fresh(2);c.state.infl=0;c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:9,growth:10};
  let before=JSON.stringify(c.state),p=c.pensionProjection();
  assert.equal(p.months,16);                       // T9/2026 → hết T12/2027
  near(p.total,12*10e6+4*11e6);                    // 12 tháng 10tr rồi 4 tháng 11tr
  assert.equal(JSON.stringify(c.state),before);    // không đổi state
  c.state.infl=10;
  let p2=c.pensionProjection();
  assert.ok(p2.real<p2.total&&p2.real>0);          // chiết khấu lạm phát có tác dụng
});

/* ===== Hồi quy theo báo cáo rà soát 09/09/2026 (audit/2026-09-09) ===== */
test('F10: đảo thứ tự hai sự kiện thu cùng tháng không đổi kết quả',()=>{
  function run(swap){
    let c=fresh(1);c.state.milestones[0].monthly=10e6;invest(c,{cp:50,tp:50});wage(c,10e6);
    let a={y:0,kind:'thu',amount:10e6,label:'A'},
        b={y:0,kind:'thu',amount:10e6,label:'B'};
    c.state.events=swap?[b,a]:[a,b];
    let m=c.runSim(false).months[0];
    return [m.mmf,m.cp,m.tp,m.total];
  }
  let x=run(false),y=run(true);
  x.forEach((v,i)=>near(v,y[i]));
  near(x[0],20e6);near(x[1],0);near(x[2],0);near(x[3],20e6);
});
test('F10: chia đôi nguồn thu cũng cho kết quả như gộp một nguồn',()=>{
  function run(split){
    let c=fresh(1);c.state.milestones[0].monthly=10e6;invest(c,{cp:50,tp:50});wage(c,10e6);
    let one={y:0,kind:'thu',amount:30e6,label:'gộp'};
    c.state.events=split?[Object.assign(one,{amount:15e6,label:'nửa 1'}),Object.assign({},one,{amount:15e6,label:'nửa 2'})]:[one];
    let m=c.runSim(false).months[0];
    return [m.mmf,m.cp,m.tp,m.total];
  }
  let a=run(false),b=run(true);
  a.forEach((v,i)=>near(v,b[i]));
  near(a[0],30e6);near(a[1],0);near(a[2],0);near(a[3],30e6);
});
test('F11: hai nguồn cùng đích vàng được gộp thành MỘT lệnh mua nguyên chỉ',()=>{
  let c=fresh(1);c.state.goldPrice=10e6;c.state.goldSpread=2;wage(c,5e6);event(c,'thu',5e6,0);invest(c,{gold:100});
  let m=c.runSim(false).months[0];
  near(m.chi,1);near(m.mmf,0);near(m.total,9.8e6);near(m.ledger.goldSpreadCost,200000);
});
test('F04: giai đoạn BHXH trùng chỉ tính một lần; đóng sau tháng đủ tuổi không tính hưởng muộn',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';   // đủ tuổi T1/2052
  c.state.periods=[{from:'2010-01',to:'2019-12',type:'dn',bh:10e6,growth:0}];
  let s1=c.bhxhSummary();
  assert.equal(s1.months,120);assert.ok(!s1.eligible);
  c.state.periods.push(JSON.parse(JSON.stringify(c.state.periods[0])));  // nhân đôi nguyên dòng
  let s2=c.bhxhSummary();
  assert.equal(s2.months,120);assert.equal(s2.overlapMonths,120);assert.ok(!s2.eligible);
  c.state.periods=[{from:'2052-01',to:'2066-12',type:'dn',bh:10e6,growth:0}];
  let s3=c.bhxhSummary();
  // chỉ tháng đủ tuổi T1/2052 được tính (tháng làm việc cuối); 179 tháng sau đó là nghỉ muộn — ngoài phạm vi
  assert.equal(s3.months,1);assert.equal(s3.monthsAfterRetire,179);assert.ok(!s3.eligible);
});
test('F06: dòng đóng "đến nghỉ hưu" ổn định khi đổi số năm mô phỏng',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';
  c.state.periods=[{from:'2026-01',to:'',type:'dn',bh:10e6,growth:0}];
  let a=c.bhxhSummary().months;
  c.state.simYears=30;
  let b=c.bhxhSummary().months;
  assert.equal(a,b);assert.equal(b,313);   // T1/2026 → T1/2052 (đóng trọn tháng đủ tuổi cuối cùng)
});
test('F04: validateState bắt lỗi dòng giai đoạn BHXH (định dạng, đảo đầu-cuối) — gắn refOnly',()=>{
  let c=fresh(1);
  c.state.periods=[{from:'sai-định-dạng',to:'2027-01',type:'dn',bh:10e6,growth:0}];
  assert.ok(c.validateState().some(x=>x.level==='error'&&x.refOnly&&x.tab==='t3'&&/Giai đoạn BHXH dòng 1/.test(x.msg)));
  c.state.periods=[{from:'2027-01',to:'2026-01',type:'dn',bh:10e6,growth:0}];
  assert.ok(c.validateState().some(x=>x.level==='error'&&/trước tháng bắt đầu/.test(x.msg)));
});
test('F03: hỏng một chuỗi lợi suất không xóa hai chuỗi tốt',()=>{
  let c=fresh(1),saved=JSON.parse(JSON.stringify(c.state));
  saved.series.land=null;
  let s=c.migrateState(saved);
  assert.equal(s.series.gold.length,12);assert.equal(s.series.cp.length,12);near(s.series.cp[0],0);
  assert.ok(Array.isArray(s.series.land));assert.strictEqual(s.series.land.length,0);
  assert.ok(c.migrationMessages.some(m=>/BĐS.*không đọc được/.test(m)));
});
test('F02: parser tiền từ chối âm/phần lẻ/ký hiệu khoa học — không âm thầm thành số khác',()=>{
  let c=context();
  assert.ok(Number.isNaN(c.moneyParse('-10000000')));
  assert.ok(Number.isNaN(c.moneyParse('10.000.000,50')));
  assert.ok(Number.isNaN(c.moneyParse('1e6')));
  assert.ok(Number.isNaN(c.moneyParse('1234567890123456')));   // 16 chữ số
  assert.equal(c.moneyParse('10.000.000'),10e6);
  assert.equal(c.moneyParse('150'),150);
  assert.equal(c.moneyParse(''),0);
  assert.equal(c.moneyVal({value:'-5',dataset:{good:'123'}}),123);   // ô lỗi: dùng giá trị tốt gần nhất
});
test('F12: pha kết thúc trước mốc nghỉ hưu quy ước có cảnh báo rỗng',()=>{
  let c=fresh(2);c.state.birthYear=1960;c.state.gender='male';  // nghỉ hưu quy ước T1/2020 (60 tuổi, trước lộ trình)
  c.state.incomePeriods=[{fromY:2026,toY:null,amount:10e6,growth:0}];
  assert.ok(c.validateState().some(x=>x.level==='warn'&&/không phát sinh tháng nào/.test(x.msg)));
  assert.equal(c.validateErrors().length,0);   // pha rỗng là cảnh báo, không chặn mô phỏng
});
test('F15: năm chỉ có lương hưu đủ chi → nhãn nguồn "Lương hưu", không còn "Tích lũy"',()=>{
  let c=fresh(1);c.state.milestones[0].monthly=10e6;
  c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:0};
  let s=c.runSim(true);
  assert.equal(s.years[0].src,'Lương hưu');
  assert.ok(s.months.every(m=>m.short===0));
});
test('U02: snap phân tách dòng thu khớp sổ — lương+thuê+hưu+thu sự kiện = externalIn',()=>{
  let c=fresh(2);wage(c,10e6);
  c.state.landPlots=[plot({rent:true,rentVnd:2e6})];
  c.state.pensionSimple={amount:3e6,startYear:2026,startMonth:1,growth:0};
  event(c,'thu',5e6,1);
  let ms=c.runSim(true).months;
  ms.forEach(m=>{near(m.salary+m.rent+m.pension+m.eventIn,m.ledger.externalIn,.001);assert.ok(m.bought&&typeof m.bought==='object');});
  near(ms[12].eventIn,5e6);
  near(ms[0].salary,10e6);near(ms[0].rent,2e6);near(ms[0].pension,3e6);
});

/* ===== Hồi quy theo mục 0 — lần kiểm tra lại 09/09/2026 (R01–R10) ===== */
test('R06: lỗi giai đoạn BHXH tham khảo (refOnly) không chặn mô phỏng hưu nhập tay',()=>{
  let c=fresh(1);
  c.state.periods=[{from:'tháng-sai',to:'2027-01',type:'dn',bh:10e6,growth:0}];
  c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:0};
  assert.ok(c.validateState().some(x=>x.level==='error'&&x.refOnly));   // vẫn hiện lỗi + chặn Generate
  assert.equal(c.validateErrors().length,0);                            // nhưng không chặn runSim/risk
  let sim=c.runSim(true);
  near(sim.pensionGot,120e6);                                           // hồ sơ hưu nhập tay hợp lệ vẫn chạy
});
test('R05: only executable whole-gold orders are recorded; unspent cash remains in MMF',()=>{
  let c=fresh(1);c.state.goldPrice=1e7;c.state.goldSpread=0;
  event(c,'thu',5e6,0);invest(c,{gold:100});
  let m=c.runSim(false).months[0];
  assert.strictEqual(m.bought.gold,0);           // 5tr không đủ 1 chỉ → không phải "đã mua vàng 5tr"
  near(m.goldLeft,0);near(m.mmf,5e6);assert.strictEqual(m.chi,0); // không phát lệnh mua lẻ không thể khớp
  let c2=fresh(1);c2.state.goldPrice=1e7;c2.state.goldSpread=0;
  event(c2,'thu',15e6,0);invest(c2,{gold:100});
  let m2=c2.runSim(false).months[0];
  near(m2.bought.gold,1e7);                      // thực mua 1 chỉ × 10tr
  near(m2.goldLeft,0);assert.strictEqual(m2.chi,1);near(m2.mmf,5e6);
});
test('R08: kỳ mô phỏng sai không bao giờ vào vòng lặp chiếu hưu',()=>{
  let c=fresh(1);c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:0};
  c.state.simYears=1000000;
  let p=c.pensionProjection();
  assert.strictEqual(p.months,0);assert.strictEqual(p.total,0);
  c.state.simYears=0.5;
  assert.strictEqual(c.pensionProjection().months,0);
});
test('R10: nhãn nguồn chính là dòng thu LỚN NHẤT — lương nhỏ cạnh sự kiện thu lớn',()=>{
  let c=fresh(1);wage(c,1e6);event(c,'thu',100e6,0);
  let s=c.runSim(false);
  assert.strictEqual(s.years[0].src,'Thu sự kiện');   // 100tr thu sự kiện > 12tr lương cả năm
});

/* ===== Hồi quy vòng S01–S04 (kiểm tra lại lần 2, 09/09/2026) ===== */
test('S01: diễn giải biên tập nhóm-dở đồng bộ — không bao giờ NaN hay "1.5"→15',()=>{
  let c=context();
  // dạng thập phân KHÔNG được diễn giải thành số khác
  assert.ok(Number.isNaN(c.moneyEditValue('1.5')));
  assert.ok(Number.isNaN(c.moneyEditValue('10.000.000,50')));
  assert.ok(Number.isNaN(c.moneyEditValue('abc')));
  // nhóm-dở "đang gõ nhóm mới" lấy nguyên dãy chữ số
  assert.strictEqual(c.moneyEditValue('10.000.0000'),100000000);
  assert.strictEqual(c.moneyEditValue('1.0000'),10000);
  assert.strictEqual(c.moneyEditValue('1.500'),1500);          // strict-hợp lệ vẫn đọc đúng
  // moneyVal: chuỗi sai → giá trị đầu phiên (focusGood), không NaN/0
  assert.strictEqual(c.moneyVal({value:'abc',dataset:{focusGood:'20000000'}}),20000000);
  assert.strictEqual(c.moneyVal({value:'10000000x',dataset:{focusGood:'20000000'}}),20000000);
  assert.strictEqual(c.moneyVal({value:'1.5',dataset:{focusGood:'20000000'}}),20000000);
  assert.strictEqual(c.moneyVal({value:'10.000.0000',dataset:{focusGood:'10000000'}}),100000000);
});

/* ===== Tự tính lương hưu nhập tay từ giai đoạn đóng — Tab 4 (10/09/2026; đợt 13 đổi mốc hưởng) ===== */
test('pensionFromPeriods: đủ điều kiện → mức + tháng bắt đầu khớp bhxhSummary, không đổi state',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';   // đủ tuổi T1/2052 → hưởng NGAY T1/2052 (đợt 13)
  c.state.periods=[{from:'2013-01',to:'2051-12',type:'dn',bh:10e6,growth:0}];
  let before=JSON.stringify(c.state),r=c.pensionFromPeriods(),s=c.bhxhSummary();
  assert.ok(s.eligible);
  assert.ok(r&&Number.isFinite(r.amount)&&r.amount>0);
  near(r.p0,s.pension,.01);                                       // p0 = mức danh nghĩa tại tháng hưởng
  near(r.amount,s.pension,.01);                                   // infl=0 → F=1 → giá hiện tại = p0
  assert.equal(r.startYear,2052);assert.equal(r.startMonth,1);   // đợt 13: nhận ngay THÁNG ĐỦ TUỔI (reset tháng về 1)
  assert.equal(JSON.stringify(c.state),before);                  // hàm thuần, không ghi state
});
test('pensionFromPeriods: có lạm phát → amount quy về giá hiện tại, đổi lại đúng p0 tại tháng đủ tuổi',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';
  c.state.infl=4.5;
  c.state.periods=[{from:'2013-01',to:'2051-12',type:'dn',bh:10e6,growth:0}];
  let r=c.pensionFromPeriods(),s=c.bhxhSummary();
  let B=s.retireIdx;
  assert.equal(r.startYear,Math.floor(B/12));assert.equal(r.startMonth,B%12+1);   // tháng hưởng = tháng đủ tuổi
  near(r.amount*c.pensionFactor(B,c.NOW,c.state.infl),s.pension,.01);             // amount×F = mức luật tại tháng hưởng
  near(r.p0,s.pension,.01);
});
test('pensionFromPeriods: một dòng sai định dạng → null, không tính bừa từ dòng còn lại',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';
  c.state.periods=[{from:'2013-01',to:'2051-12',type:'dn',bh:10e6,growth:0},
                   {from:'sai-định-dạng',to:'',type:'dn',bh:20e6,growth:0}];
  assert.strictEqual(c.pensionFromPeriods(),null);
});
test('pensionFromPeriods: chưa đủ 180 tháng → null (giữ mức hưu hiện tại)',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';
  c.state.periods=[{from:'2010-01',to:'2019-12',type:'dn',bh:10e6,growth:0}];   // 120 tháng < 15 năm
  assert.strictEqual(c.pensionFromPeriods(),null);
});
test('pensionFromPeriods: không tháng đóng hợp lệ (rỗng / toàn dòng Nghỉ / sau mốc hưu) → null',()=>{
  let c=fresh(1);c.state.birthYear=1990;c.state.gender='male';
  c.state.periods=[];
  assert.strictEqual(c.pensionFromPeriods(),null);
  c.state.periods=[{from:'2013-01',to:'2051-12',type:'none',bh:10e6,growth:0}];
  assert.strictEqual(c.pensionFromPeriods(),null);
  c.state.periods=[{from:'2052-01',to:'2066-12',type:'dn',bh:10e6,growth:0}];   // đóng sau nghỉ hưu
  assert.strictEqual(c.pensionFromPeriods(),null);
});

/* ===== BHXH theo Luật 41/2024/QH15 + NĐ 158/159/2025 + TT 12/2025 + CV 340/BHXH (10/09/2026) =====
   fresh() neo NOW=T1/2026, infl=0 (hệ số năm hưởng >2026 = bảng 2026, mức tham chiếu không ngoại suy). */
test('B04/T01–T03: điều kiện theo tháng thực; tỷ lệ theo năm tính hưởng (tháng lẻ 1–6 = nửa năm, 7–11 = một năm)',()=>{
  let c=fresh(1),s=c.state;
  assert.equal(c.benefitYears(180),15);assert.equal(c.benefitYears(181),15.5);assert.equal(c.benefitYears(186),15.5);
  assert.equal(c.benefitYears(187),16);assert.equal(c.benefitYears(191),16);assert.equal(c.benefitYears(192),16);
  assert.equal(c.pensionRate(c.benefitYears(181),'female'),46);   // 181 tháng → 46%, không phải 45,17%
  s.birthYear=1970;s.gender='male';                               // đủ tuổi T1/2032 (62 tuổi)
  s.periods=[{from:'2011-01',to:'2025-11',type:'dn',bh:2e6,growth:0}];   // 179 tháng — KHÔNG làm tròn thành đủ 15 năm
  let r=c.bhxhSummary();
  assert.equal(r.months,179);assert.ok(!r.eligible);
  const male={15:40,16:41,19:44,20:45,21:47,30:65,35:75,40:75};
  for(const y in male){ s.periods=[{from:(2026-+y)+'-01',to:'2025-12',type:'dn',bh:2e6,growth:0}];
    assert.equal(c.bhxhSummary().rate,male[y],'nam '+y+' năm'); }
  s.gender='female';s.birthYear=1972;                             // nữ đủ tuổi T5/2030 (58y4m theo lộ trình)
  const female={15:45,16:47,25:65,30:75,40:75};
  for(const y in female){ s.periods=[{from:(2026-+y)+'-01',to:'2025-12',type:'dn',bh:2e6,growth:0}];
    assert.equal(c.bhxhSummary().rate,female[y],'nữ '+y+' năm'); }
  s.periods=[{from:'2008-12',to:'2023-12',type:'dn',bh:2e6,growth:0}];   // 181 tháng
  r=c.bhxhSummary();
  assert.equal(r.months,181);assert.ok(r.eligible);assert.equal(r.rate,46);
});
test('B01/T04: hồ sơ đối chiếu độc lập CV 340/2026 — bình quân 12.560.000, hưu 5.024.000, hưởng T8/2026',()=>{
  let c=fresh(1),s=c.state;s.birthYear=1965;s.gender='male';      // sinh T1/1965 → 61y6m → đủ tuổi T7/2026 (bảng tra cứu chính thức)
  s.periods=[{from:'2011-01',to:'2025-12',type:'dn',bh:10e6,growth:0}];   // 180 tháng NSDLĐ quyết định
  let r=c.bhxhSummary();
  near(r.avg,12560000);            // 10tr × tổng 15 hệ số 18,84 / 15 năm
  assert.equal(r.rate,40);         // nam đủ 15 năm (Điều 66 khoản 3)
  near(r.pension,5024000);
  assert.equal(r.floorOK,false);   // 180 tháng bắt buộc < 20 năm → không sàn
  let pf=c.pensionFromPeriods();
  assert.equal(pf.startYear,2026);assert.equal(pf.startMonth,7);   // đợt 13: hộp hưu hưởng NGAY tháng đủ tuổi T7/2026
  assert.equal(pf.amount,5024000); // không cộng đợt +8% 01/7/2026 (người mới hưởng sau mốc áp dụng)
});
test('B02/T05: điều chỉnh theo CHẾ ĐỘ (Đ73 Luật + Đ16 NĐ 158/2025); kỳ "N năm cuối"; hỗn hợp nặng toàn bộ tháng NN (TT 12 Đ16 k3)',()=>{
  // Fixture độc lập: mốc lương cơ sở theo bàn giao 10/09/2026 (BAN_GIAO_CPI_LUONG_HUU, mục 4:
  // 730k từ 05/2010, 1,05tr từ 05/2012, 1,15tr từ 07/2013; 1,49tr giữ đến hết 06/2023 — không có
  // mốc 1,6tr 2021 hay 1.494.000 2022; 1,8tr từ 07/2023, 2,34tr từ 07/2024) — không gọi bảng của app
  const SEG=[[2011,1,730000],[2011,5,830000],[2012,5,1050000],[2013,7,1150000],[2016,5,1210000],
             [2017,7,1300000],[2018,7,1390000],[2019,7,1490000],[2023,7,1800000],[2024,7,2340000]];
  const ymS=i=>Math.floor(i/12)+'-'+String(i%12+1).padStart(2,'0');
  const nnCoef=coefAt=>{                       // giai đoạn NN với bh = hệ số × lương cơ sở thật, đóng đến 2025-12
    const ps=[];
    for(let i=0;i<SEG.length;i++){
      const [y,m,base]=SEG[i],from=y*12+m-1,nx=SEG[i+1];
      const to=Math.min((nx?nx[0]*12+nx[1]-1:2026*12)-1,2025*12+11);
      ps.push({from:ymS(from),to:ymS(to),type:'nn',bh:coefAt(from)*base,growth:0});
    }
    return ps;
  };
  let c=fresh(1),s=c.state;
  // (1) NN bắt đầu tham gia 2011 (TRƯỚC 01/01/2016), hệ số lương không đổi 3: TOÀN BỘ 180 tháng
  //     điều chỉnh về 3 × mức tham chiếu tại hưởng — không dùng hệ số CPI cho phần từ 2016
  s.birthYear=1972;s.gender='male';                               // 62 tuổi T1/2034 → hưởng T2/2034, ref = 2,53tr
  s.periods=nnCoef(()=>3);
  let r=c.bhxhSummary();
  near(r.avg,3*2530000);
  assert.equal(r.months,180);assert.equal(r.rate,40);near(r.pension,0.4*3*2530000);
  assert.equal(r.floorOK,false);                                  // 180 < 240 tháng bắt buộc → không sàn
  // (2) đổi hệ số giữa chừng (3 đến 06/2018, 4 từ 07/2018): kỳ 10 năm cuối = 2016–2025
  //     → 30 tháng hệ số 3 + 90 tháng hệ số 4 trong kỳ; 2011–2015 không vào giá trị nhưng vẫn đếm đủ 180 tháng
  s.periods=nnCoef(from=>from<2018*12+6?3:4);
  r=c.bhxhSummary();
  near(r.avg,(30*3+90*4)*2530000/120);
  assert.equal(r.months,180);
  // (3) NN bắt đầu tham gia TỪ 01/01/2016 → dùng hệ số CPI (CV 340), không quy đổi lương cơ sở
  s.birthYear=1966;s.gender='male';                               // hưởng T11/2027 (lạm phát 0 → bảng 2026)
  s.periods=[{from:'2016-01',to:'2025-12',type:'nn',bh:10e6,growth:0}];
  r=c.bhxhSummary();
  near(r.avg,10e6*11.54/10);                                      // 1,32+1,28+1,23+1,2+1,16+1,14+1,11+1,07+1,03+1
  // (4) hỗn hợp: 192 tháng NN (điều chỉnh đều đúng 10tr) + 120 tháng DN 20tr → trọng số là
  //     TOÀN BỘ 192 tháng NN (TT 12 Đ16 k3a), không phải chỉ 180 tháng trong kỳ bình quân
  s.birthYear=1980;s.gender='male';s.infl=0;                      // hưởng T2/2042
  const coef={2016:1.32,2017:1.28,2018:1.23,2019:1.2,2020:1.16,2021:1.14,2022:1.11,2023:1.07,2024:1.03,2025:1};
  s.periods=[];
  for(let y=2016;y<=2031;y++)s.periods.push({from:y+'-01',to:y+'-12',type:'nn',bh:10e6/(coef[y]||1),growth:0});
  s.periods.push({from:'2032-01',to:'2041-12',type:'dn',bh:20e6,growth:0});
  r=c.bhxhSummary();
  near(r.avg,(192*10e6+120*20e6)/312,.01);
  assert.equal(r.months,312);assert.equal(r.compMonths,312);
});
test('B03/T06: sàn mức tham chiếu chỉ áp khi đủ 20 năm BẮT BUỘC và tham gia trước 01/7/2025',()=>{
  let c=fresh(1),s=c.state;
  s.birthYear=1965;s.gender='male';                               // hưởng T8/2026, sàn = 2,53tr
  s.periods=[{from:'2005-01',to:'2024-12',type:'dn',bh:500e3,growth:0}];  // 240 tháng bắt buộc, lương rất thấp
  let r=c.bhxhSummary();
  assert.equal(r.compMonths,240);assert.equal(r.floorOK,true);
  assert.equal(r.pension,2530000);                                // 45% × bq rất thấp → nâng lên đúng sàn
  s.gender='female';s.birthYear=1972;                             // hưởng T6/2030 (lạm phát 0 → mức 2,53tr)
  s.periods=[{from:'2011-01',to:'2025-12',type:'tn',bh:2e6,growth:0}];    // thuần tự nguyện 15 năm
  r=c.bhxhSummary();
  assert.equal(r.compMonths,0);assert.equal(r.floorOK,false);
  near(r.pension,0.45*2e6*18.84/15);                              // 1.130.400 — không bị nâng lên sàn
  s.gender='male';s.birthYear=1965;
  s.periods=[{from:'2011-01',to:'2025-12',type:'dn',bh:500e3,growth:0}];  // bắt buộc chỉ 15 năm
  r=c.bhxhSummary();assert.equal(r.floorOK,false);
  near(r.pension,0.40*500e3*18.84/15);
  s.periods=[{from:'2011-01',to:'2022-12',type:'dn',bh:500e3,growth:0},   // 144 bắt buộc + 36 tự nguyện = 180
             {from:'2023-01',to:'2025-12',type:'tn',bh:500e3,growth:0}];
  r=c.bhxhSummary();
  assert.equal(r.months,180);assert.equal(r.compMonths,144);assert.equal(r.floorOK,false);
});
test('B06/T07: trần 20× mức lương cơ sở MỌI thời điểm (K3 Đ89 Luật 2014; Đ31 Luật 41/2024); sàn tự nguyện theo kỳ',()=>{
  let c=fresh(1);
  const nn=ym=>c.bhAt({_f:2023*12,bh:1e9,growth:0,type:'nn'},ym);
  assert.equal(nn(2023*12+6),36e6);     // T7/2023: 20 × 1,8tr (NĐ 24/2023)
  assert.equal(nn(2026*12+5),46.8e6);   // T6/2026: 20 × 2,34tr (NĐ 73/2024)
  assert.equal(nn(2026*12+6),50.6e6);   // T7/2026: 20 × 2,53tr (NĐ 161/2026)
  assert.equal(c.bhAt({_f:2023*12,bh:1e9,growth:0,type:'dn'},2023*12+6),36e6);    // DN trước 07/2025 cũng trần 20× lương cơ sở (K3 Đ89 Luật 2014)
  assert.equal(c.bhAt({_f:2026*12,bh:1e9,growth:0,type:'dn'},2026*12+6),50.6e6);  // DN từ 07/2025: 20 × tham chiếu
  assert.equal(c.refSalary(2018*12+6),1390000);   // 1,39tr từ 07/2018 (NĐ 72/2018)
  assert.equal(c.refSalary(2021*12+6),1490000);   // 07/2021: vẫn 1,49tr — không có mốc 1,6tr (bàn giao 10/09)
  assert.equal(c.refSalary(2022*12+6),1490000);   // 07/2022: 1,49tr giữ đến hết 06/2023 — không có mốc 1.494.000
  assert.equal(c.refSalary(2023*12+5),1490000);   // T6/2023: tháng cuối cùng của 1,49tr
  assert.equal(c.bhAt({_f:2023*12,bh:5e5,growth:0,type:'tn'},2021*12+11),7e5);    // T12/2021: sàn tự nguyện 700k
  assert.equal(c.bhAt({_f:2023*12,bh:5e5,growth:0,type:'tn'},2022*12),15e5);      // 1,5tr từ 01/01/2022 (NĐ 07/2021)
  assert.equal(c.bhAt({_f:2023*12,bh:5e5,growth:0,type:'tn'},2027*12),22e5);      // 2,2tr từ 01/01/2027 (NĐ 351/2025)
});
test('B05/T08: hưởng từ tháng liền kề sau tháng đủ tuổi; lộ trình tuổi theo bảng tra cứu chính thức (Đ69 Luật 41/2024 + NĐ 135/2020)',()=>{
  let c=fresh(1);
  assert.equal(c.retireAgeMonths(1960,'male'),1960*12+720);    // trước lộ trình: 60 tuổi → T1/2020
  assert.equal(c.retireAgeMonths(1961,'male'),1961*12+723);    // 60 tuổi 3 tháng → T4/2021 (năm đủ tuổi 2021)
  assert.equal(c.retireAgeMonths(1962,'male'),1962*12+726);    // 60 tuổi 6 tháng → T7/2022
  assert.equal(c.retireAgeMonths(1964,'male'),1964*12+735);    // 61 tuổi 3 tháng → T4/2025 (năm đủ tuổi 2025: 61y3m)
  assert.equal(c.retireAgeMonths(1965,'male'),1965*12+738);    // 61 tuổi 6 tháng → T7/2026 → hưởng T8/2026
  assert.equal(c.retireAgeMonths(1968,'male'),1968*12+744);    // 62 tuổi → T1/2030; tuổi dừng ở 62 từ năm đủ tuổi 2028
  assert.equal(c.retireAgeMonths(1990,'male'),2052*12);        // 62 tuổi → T1/2052
  assert.equal(c.retireAgeMonths(1961,'female'),1961*12+660);  // trước lộ trình: 55 tuổi → T1/2016
  assert.equal(c.retireAgeMonths(1966,'female'),1966*12+664);  // 55 tuổi 4 tháng → T5/2021
  assert.equal(c.retireAgeMonths(1969,'female'),1969*12+680);  // 56 tuổi 8 tháng → T9/2025
  assert.equal(c.retireAgeMonths(1975,'female'),2034*12+8);    // 59 tuổi 8 tháng → T9/2034
  assert.equal(c.retireAgeMonths(1976,'female'),1976*12+720);  // 60 tuổi → T1/2036
  let s=c.state;s.birthYear=1990;s.gender='male';
  s.periods=[{from:'2013-01',to:'',type:'dn',bh:10e6,growth:0}];
  let r=c.bhxhSummary();
  assert.equal(r.retireIdx,2052*12);assert.equal(r.retStart,2052*12+1);   // mốc luật (tham chiếu mức): T2/2052
  let pf=c.pensionFromPeriods();
  assert.equal(pf.startYear,2052);assert.equal(pf.startMonth,1);   // đợt 13: hộp hưu hưởng NGAY tháng đủ tuổi T1/2052
});
test('B01/T10: hệ số năm hưởng 2026 đúng bảng; sau 2026 ngoại suy lạm phát rồi LÀM TRÒN 2 chữ số, tối thiểu 1 (Đ16 NĐ 158/2025)',()=>{
  let c=fresh(1),s=c.state;s.birthYear=1965;s.gender='male';
  s.periods=[{from:'2011-01',to:'2025-12',type:'dn',bh:10e6,growth:0}];
  const a26=c.bhxhSummary().avg;                 // hưởng 2026 — bảng CV 340
  s.birthYear=1972;s.infl=0;                     // hưởng T2/2034
  near(c.bhxhSummary().avg,a26);                 // lạm phát 0 → mọi năm hưởng dùng đúng bảng cũ
  s.infl=4;
  const k=Math.pow(1.04,8),past=[1.65,1.51,1.42,1.36,1.36,1.32,1.28,1.23,1.2,1.16,1.14,1.11,1.07,1.03,1];
  const sum=past.reduce((a,p)=>a+Math.round(p*k*100)/100,0);   // hệ số = bảng 2026 × (1,04)^8, tròn 2 chữ số từng năm
  near(c.bhxhSummary().avg,10e6*sum/15,.01);
  assert.equal(c.adjCoef(2016,2026,4),1.32);     // năm hưởng 2026: đúng bảng công bố
  assert.equal(c.adjCoef(2011,2026,4),1.65);
  assert.equal(c.adjCoef(2025,2034,-10),1);      // giảm phát: hệ số không được dưới 1 (Đ16 NĐ 158/2025)
  s.infl=0;s.birthYear=1965;
  s.periods=[{from:'2011-01',to:'2025-12',type:'dn',bh:10e6,growth:6}];   // tăng lương trong dòng
  const withGrowth=c.bhxhSummary().avg;
  s.periods=[];
  for(let y=2011;y<=2025;y++)s.periods.push({from:y+'-01',to:y+'-12',type:'dn',bh:10e6*Math.pow(1.06,y-2011),growth:0});
  near(withGrowth,c.bhxhSummary().avg,1);        // cùng chuỗi danh nghĩa → cùng bình quân (growth và hệ số không cộng đôi)
});
test('T11: hưu nhập tay hai giai đoạn — nhân CPI đến tháng hưởng rồi tăng đúng tháng 13',()=>{
  let c=fresh(2);c.state.infl=4;
  c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:9,growth:10};
  let m=c.runSim(true).months;
  const P0=10e6*Math.pow(1.04,8/12);            // A × 1,04^(8/12) — 8 tháng tới tháng hưởng
  near(m[7].total,0);
  near(m[8].total,P0,.01);                      // tháng hưởng đầu = P0, không là 10tr như quy ước cũ
  near(m[19].total,12*P0,.01);                  // 12 tháng đầu nhận nguyên P0
  near(m[20].total,12*P0+P0*1.1,.01);           // tháng hưởng thứ 13: P0 × 1,1
});
test('T15: đổi cấu hình hưu không đổi tăng trưởng người nhập; bhxhSummary thuần',()=>{
  let c=fresh(1),s=c.state;s.birthYear=1972;s.gender='male';s.infl=4;
  s.periods=[{from:'2011-01',to:'2025-12',type:'dn',bh:10e6,growth:0}];
  let before=JSON.stringify(c.state);
  let r=c.pensionFromPeriods();
  assert.ok(r);assert.equal(r.growth,undefined);          // mức hưu tự tính KHÔNG đụng growth (applyAutoPension giữ nguyên ô tăng)
  assert.equal(JSON.stringify(c.state),before);
  s.infl=0;                                               // đổi giả định lạm phát → hệ số năm hưởng 2034 đổi, kết quả cũ hết hiệu lực
  assert.ok(Math.abs(c.bhxhSummary().pension-r.p0)>1);
});

/* ===== Bàn giao CPI–lương hưu 10/09/2026 (BAN_GIAO_CPI_LUONG_HUU_2026-09-10.md, mục 8) =====
   Hai giai đoạn: amount = giá tại tháng gốc NOW → P0 = amount × (1+i)^((B−N)/12), B=max(N,R)
   → pension(m) = P0 × (1+g)^floor((m−B)/12). fresh() neo NOW=T1/2026. Đáp án dựng bằng công thức
   độc lập, không gọi hàm app để tạo kỳ vọng. */
test('C1: cấu hình mới — CPI 5, tăng hưu 8, ô tiền mang nghĩa giá hiện tại',()=>{
  let c=context();
  assert.equal(c.state.infl,5);
  assert.equal(c.state.pensionSimple.growth,8);
  assert.equal(c.state.pensionSimple.amountSource,'manual');
  assert.equal(c.state.pensionSimple.amountBasis,'baseMonth');
  assert.ok(/id="infl"\s+value="5"/.test(html));          // HTML tĩnh cùng mặc định mới
  assert.ok(/id="psGrowth"\s+value="8"/.test(html));
  assert.ok(html.includes('Mức hưu theo giá hiện tại'));  // nhãn ô tiền theo bàn giao mục 6
});
test('C2: nhập 10tr, hưởng sau đúng 20 năm, CPI 5% → tháng đầu hưởng ≈ 26.532.977đ',()=>{
  let c=fresh(21),s=c.state;s.infl=5;
  s.pensionSimple={amount:10e6,startYear:2046,startMonth:1,growth:0};
  const m=c.runSim(true).months;
  near(m[239].pension,0,.01);                             // trước tháng hưởng: hưu = 0 (ca 5)
  near(m[240].pension,10e6*Math.pow(1.05,20),.01);        // ≈ 26.532.977đ — 10tr × 1,05^20 (ví dụ mục 3.1)
  near(m[240].pension,26532977.05,.01);
});
test('C3: hưởng ngay tháng gốc — F=1; không tự cộng CPI hay 8% tháng đầu',()=>{
  let c=fresh(2);c.state.infl=5;
  c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:8};
  near(c.runSim(true).months[0].pension,10e6,.01);
});
test('C4: hưởng sau 18 tháng → hệ số 1,05^1,5 (năm lẻ theo số tháng, không làm tròn năm)',()=>{
  let c=fresh(3);c.state.infl=5;
  c.state.pensionSimple={amount:10e6,startYear:2027,startMonth:7,growth:0};   // R=N+18
  near(c.runSim(true).months[18].pension,10e6*Math.pow(1.05,1.5),.01);
});
test('C6: tăng 8%/năm — 12 tháng đầu nguyên P0; tháng 13 ×1,08; tháng 25 ×1,08²',()=>{
  let c=fresh(3);c.state.infl=0;
  c.state.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:8};
  const m=c.runSim(true).months;
  for(let i=0;i<12;i++)near(m[i].pension,10e6,.01);
  near(m[12].pension,10.8e6,.01);
  near(m[24].pension,11.664e6,.01);
});
test('C7: đổi CPI 5→6 — mức nhập (A) giữ nguyên; P0 và dòng tiền tự cập nhật',()=>{
  let c=fresh(21),s=c.state;
  s.pensionSimple={amount:10e6,startYear:2046,startMonth:1,growth:0};
  s.infl=5;
  const p5=c.runSim(true).months[240].pension;
  s.infl=6;
  const p6=c.runSim(true).months[240].pension;
  assert.equal(s.pensionSimple.amount,10e6);              // A không bị đụng khi đổi CPI
  near(p5,10e6*1.05**20,.01);
  near(p6,10e6*1.06**20,.01);
});
test('C8: đổi tăng hưu 8→6 — mức tháng đầu không đổi; các năm hưởng sau đổi',()=>{
  let c=fresh(3),s=c.state;s.infl=0;
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:8};
  const a=c.runSim(true).months;
  s.pensionSimple.growth=6;
  const b=c.runSim(true).months;
  near(a[0].pension,b[0].pension,.01);
  near(a[12].pension,10.8e6,.01);
  near(b[12].pension,10.6e6,.01);
});
test('C9: CPI=0 hoặc tăng hưu=0 — giai đoạn tương ứng không tăng; không NaN/Infinity',()=>{
  let c=fresh(3),s=c.state;
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:0};
  s.infl=0;
  c.runSim(true).months.forEach(x=>{assert.ok(Number.isFinite(x.pension));assert.ok(Number.isFinite(x.total));});
  s.infl=5;                                               // CPI>0, tăng=0: P0 quy đổi nhưng giữ nguyên sau hưởng
  const m2=c.runSim(true).months;
  near(m2[0].pension,10e6,.01);                           // R=N → F=1
  near(m2[1].pension,10e6,.01);
});
test('C10/C11: tự tính P0_auto quy đổi giá hiện tại — vào mô phỏng vẫn nhận đúng P0 tháng đầu; đổi CPI đồng bộ lại',()=>{
  let c=fresh(30),s=c.state;s.birthYear=1990;s.gender='male';    // hưởng T2/2052
  s.periods=[{from:'2013-01',to:'2051-12',type:'dn',bh:10e6,growth:0}];
  s.infl=5;                                                       // hệ số năm hưởng 2052 ngoại suy theo lạm phát
  const r=c.pensionFromPeriods();
  assert.ok(r&&r.p0>0);
  const F=c.pensionFactor(r.startYear*12+r.startMonth-1,2026*12,5);
  near(r.amount*F,r.p0,.01);                                      // A_auto × F = P0_auto — không nhân trượt giá hai lần
  s.pensionSimple={amount:r.amount,startYear:r.startYear,startMonth:r.startMonth,growth:0,amountSource:'fromPeriods',amountBasis:'baseMonth'};
  const first=(r.startYear*12+r.startMonth-1)-2026*12;
  const m=c.runSim(true).months;
  near(m[first-1].pension,0,.01);
  near(m[first].pension,r.p0,.01);                                // dòng tiền tháng đầu = P0_auto, không phải P0×F
  s.infl=3;
  const r2=c.pensionFromPeriods();
  assert.ok(Math.abs(r2.p0-r.p0)>1);                              // hệ số năm hưởng đổi → P0 nội bộ đổi
  near(r2.amount*c.pensionFactor(r2.startYear*12+r2.startMonth-1,2026*12,3),r2.p0,.01);
});
test('C12: người đã nghỉ trước NOW — tháng đầu mô phỏng nhận đúng A, không tăng bù cho quá khứ',()=>{
  let c=fresh(3);c.state.infl=5;
  c.state.pensionSimple={amount:10e6,startYear:2020,startMonth:1,growth:8};   // R=N−72
  const m=c.runSim(true).months;
  near(m[0].pension,10e6,.01);                                    // B=N → F=1, mũ từ NOW
  near(m[11].pension,10e6,.01);
  near(m[12].pension,10.8e6,.01);                                 // kỷ niệm 12 tháng kể từ NOW, không từ 2020
});
test('C14: kỳ ngắn/dài, nghỉ ngoài kỳ — không đổi kế hoạch hưu; ngoài kỳ không có khoản hưu trong NAV',()=>{
  let c=fresh(1),s=c.state;s.infl=5;
  s.pensionSimple={amount:10e6,startYear:2030,startMonth:1,growth:8};
  let sim=c.runSim(true);
  assert.equal(sim.pensionGot,0);
  let pr=c.pensionProjection();
  assert.equal(pr.months,0);assert.equal(pr.total,0);
  s.simYears=10;c.ensureSeries();                                 // kéo dài kỳ — mốc hưu giữ nguyên kế hoạch
  sim=c.runSim(true);
  near(sim.months[4*12].pension,10e6*Math.pow(1.05,4),.01);
  near(c.pensionProjection().total,sim.pensionGot,.01);
});
test('C15: pensionProjection khớp runSim — cùng số tháng, cùng tổng tiền',()=>{
  let c=fresh(24),s=c.state;s.infl=5;
  s.pensionSimple={amount:10e6,startYear:2030,startMonth:7,growth:8};   // R=N+54 — năm đầu/cuối thiếu tháng
  const sim=c.runSim(true),pr=c.pensionProjection();
  assert.equal(pr.months,sim.months.filter(x=>x.pension>0).length);
  near(pr.total,sim.pensionGot,.01);
});
test('C16: nguồn nhập tay hợp lệ + giai đoạn tham khảo lỗi (refOnly) — mô phỏng hai giai đoạn vẫn chạy',()=>{
  let c=fresh(1),s=c.state;s.infl=5;
  s.periods=[{from:'tháng-sai',to:'2027-01',type:'dn',bh:10e6,growth:0}];
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:8,amountSource:'manual',amountBasis:'baseMonth'};
  assert.equal(c.validateErrors().length,0);                      // lỗi refOnly không chặn mô phỏng hưu nhập tay
  near(c.runSim(true).pensionGot,12*10e6,.01);                    // R=N, F=1
});
test('C17: migrate giữ nguyên nghĩa v3 — amountSource/amountBasis/số tiền lẻ/tỷ lệ/tháng',()=>{
  let c=fresh(1);
  const saved=JSON.parse(JSON.stringify(c.state));
  saved.schemaVersion=3;
  saved.pensionSimple={amount:12345678.9,startYear:2046,startMonth:4,growth:8,amountSource:'fromPeriods',amountBasis:'baseMonth'};
  const s=c.migrateState(saved);
  assert.equal(s.pensionSimple.amountSource,'fromPeriods');
  assert.equal(s.pensionSimple.amountBasis,'baseMonth');
  near(s.pensionSimple.amount,12345678.9,.001);                   // không làm tròn/suy đoán
  assert.equal(s.pensionSimple.growth,8);
  assert.equal(s.pensionSimple.startYear,2046);assert.equal(s.pensionSimple.startMonth,4);
});
test('C18: nâng cấp bản v2 cũ — amount>0 đánh dấu cần xác nhận nghĩa, không nhân/chia; amount=0 là baseMonth',()=>{
  let c=fresh(1);
  const saved=JSON.parse(JSON.stringify(c.state));
  saved.schemaVersion=2;
  saved.pensionSimple={amount:10e6,startYear:2046,startMonth:1,growth:8};
  let s=c.migrateState(saved);
  assert.equal(s.schemaVersion,9);                     /* M1: v2 → thẳng v4 (bước qua v3 vẫn đánh dấu unknown); v6 = bỏ phân bổ cũ; v9 = Tab 8 compareCfg */
  assert.equal(s.pensionSimple.amountBasis,'unknown');            // không suy đoán nghĩa (bàn giao mục 7.2)
  near(s.pensionSimple.amount,10e6,.001);                         // giữ nguyên số, không tự chia ngược lạm phát
  assert.equal(s.pensionSimple.amountSource,'manual');
  saved.pensionSimple.amount=0;
  s=c.migrateState(saved);
  assert.equal(s.pensionSimple.amountBasis,'baseMonth');          // amount=0 không cần hỏi lại nghĩa
});
test('C19: chạy lại/kiểm tra rủi ro — không đổi state, không cộng trượt giá nhiều lần',()=>{
  let c=fresh(3),s=c.state;s.infl=5;
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:7,growth:8};
  const before=JSON.stringify(s);
  const a=c.runSim(true),b=c.runSim(true);
  near(a.pensionGot,b.pensionGot,.001);
  assert.equal(JSON.stringify(s),before);
  const risk=c.riskCheck(2);
  assert.ok(Number.isFinite(risk.p50));
  assert.equal(JSON.stringify(s),before);                         // riskCheck đi qua runSim nhưng thuần
});
test('C20: mốc lương cơ sở theo bàn giao — 05/2010, 05/2012, 07/2013; 1,49tr đến hết 06/2023',()=>{
  let c=context();
  assert.equal(c.refSalary(2010*12+3),650000);          // T4/2010: còn mốc cũ
  assert.equal(c.refSalary(2010*12+4),730000);          // 05/2010
  assert.equal(c.refSalary(2012*12+3),830000);          // T4/2012: còn 830k
  assert.equal(c.refSalary(2012*12+4),1050000);         // 05/2012
  assert.equal(c.refSalary(2013*12+5),1050000);         // T6/2013: tháng cuối 1,05tr
  assert.equal(c.refSalary(2013*12+6),1150000);         // 07/2013
  assert.equal(c.refSalary(2021*12+6),1490000);         // 07/2021 và 07/2022: đều 1,49tr
  assert.equal(c.refSalary(2022*12+6),1490000);
  assert.equal(c.refSalary(2023*12+5),1490000);         // T6/2023: tháng cuối của 1,49tr
  assert.equal(c.refSalary(2023*12+6),1800000);         // 07/2023: 1,8tr
});

/* ===== Sửa theo review độc lập 11/09/2026 (audit/2026-09-11/cpi-pension-review, F01–F05) ===== */
test('R-F01: migrate bản v3 KHÔNG chạy lại nâng cấp v1 — giữ “Có thể bán”/sellRule người dùng chọn (v8: chuyển thành sellable từng BĐS)',()=>{
  let c=fresh(1);
  const saved=JSON.parse(JSON.stringify(c.state));
  saved.schemaVersion=3;saved.landSellable=false;saved.sellRule='cpFirst';
  saved.landPlots=[plot({saleYear:2027}),plot({id:'p2',total:5e8})];
  saved.landPlots.forEach(p=>{delete p.sellable;delete p.expenses;});   // mô phỏng bản v3 thật: chưa có trường v8
  const s=c.migrateState(saved);
  assert.ok(s.landPlots.every(p=>p.sellable===false));     // v3 hợp lệ: lựa chọn "không bán sớm" chuyển sang từng BĐS
  assert.equal('landSellable' in s,false);                 // cấu hình chung đã xóa khỏi state
  assert.equal(s.sellRule,'cpFirst');
  assert.equal(s.schemaVersion,9);                         /* M1 (11/09): v4 = gia đình; v6 = bỏ phân bổ cũ; v8 = BĐS giá hiện tại; v9 = Tab 8 compareCfg */
  const v1=JSON.parse(JSON.stringify(saved));delete v1.schemaVersion;delete v1.landSellable;   // bản v1 thật: chưa có cả hai trường
  const s2=c.migrateState(v1);
  assert.ok(s2.landPlots.every(p=>p.sellable===true));assert.equal(s2.sellRule,'nearPeak'); // v1 cũ vẫn được nâng mặc định
});
test('R-F05: amountBasis unknown (bản lưu cũ chưa chọn nghĩa) chặn mô phỏng tới khi xác nhận',()=>{
  let c=fresh(1),s=c.state;
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:1,growth:8,amountSource:'manual',amountBasis:'unknown'};
  assert.ok(c.validateState().some(x=>x.level==='error'&&x.tab==='t3'&&/chưa xác nhận nghĩa/.test(x.msg)&&!x.refOnly));
  assert.ok(c.validateErrors().length>0);                 // lỗi này KHÔNG refOnly — chặn cả runSim/risk
  assert.throws(()=>c.runSim(true));
  s.pensionSimple.amountBasis='baseMonth';                // đã chọn nghĩa → hết chặn
  assert.equal(c.validateErrors().length,0);
  s.pensionSimple.amount=0;s.pensionSimple.amountBasis='unknown';   // amount=0: không có khoản hưu nào để hiểu sai nghĩa
  assert.equal(c.validateErrors().length,0);
});

/* ===== M1 — gia đình nhiều người (Tab 4 tab con; 11/09/2026) =====
   fresh() neo NOW=T1/2026, infl=0. Người chính = state.pensionSimple; thành viên thêm =
   state.extraPeople[i] với hình dạng {name,birthYear,gender,periods,pension}. */
function spouse(extra={}){
  return Object.assign({name:'Vợ',birthYear:1992,gender:'female',periods:[],
    pension:{amount:0,startYear:2052,startMonth:1,growth:8,amountSource:'manual',amountBasis:'baseMonth'}},extra);
}
test('M1: hưu hai người vào đúng mốc riêng — cộng dòng hưu, tăng kỷ niệm 12 tháng theo từng người',()=>{
  let c=fresh(3),s=c.state;
  s.pensionSimple={amount:2e6,startYear:2026,startMonth:9,growth:10};
  s.extraPeople=[spouse({pension:{amount:3e6,startYear:2027,startMonth:3,growth:0,amountSource:'manual',amountBasis:'baseMonth'}})];
  const m=c.runSim(true).months;
  near(m[7].pension,0,.01);          // trước mốc của cả hai người
  near(m[8].pension,2e6,.01);        // người chính hưởng T9/2026
  near(m[13].pension,2e6,.01);
  near(m[14].pension,5e6,.01);       // thêm người thứ hai từ T3/2027
  near(m[19].pension,5e6,.01);
  near(m[20].pension,5.2e6,.01);     // kỷ niệm 12 tháng của NGƯỜI CHÍNH (2tr→2,2tr); người thêm giữ 3tr
  near(m[20].total,47.2e6,.01);      // sổ NAV: chi 0, lãi 0 → tổng = cộng dồn hưu (MMF)
  near(c.runSim(true).pensionGot,60.08e6+66e6,.01);
});
test('M1: CPI quy đổi độc lập theo mốc hưởng của từng người (C4 cho từng người)',()=>{
  let c=fresh(3),s=c.state;s.infl=5;
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:9,growth:0};
  s.extraPeople=[spouse({pension:{amount:20e6,startYear:2027,startMonth:3,growth:0,amountSource:'manual',amountBasis:'baseMonth'}})];
  const m=c.runSim(true).months;
  near(m[8].pension,10e6*Math.pow(1.05,8/12),.01);                                   // 8 tháng tới mốc người chính
  near(m[14].pension,10e6*Math.pow(1.05,8/12)+20e6*Math.pow(1.05,14/12),.01);        // 14 tháng tới mốc người thêm
});
test('M1: lỗi hộp hưu của người thêm chặn mô phỏng; lỗi giai đoạn của họ chỉ refOnly (R06)',()=>{
  let c=fresh(1),s=c.state;
  s.pensionSimple={amount:1e6,startYear:2026,startMonth:1,growth:0,amountSource:'manual',amountBasis:'baseMonth'};
  s.extraPeople=[spouse({pension:{amount:5e6,startYear:2030,startMonth:1,growth:8,amountSource:'manual',amountBasis:'unknown'}})];
  let vs=c.validateState();
  assert.ok(vs.some(x=>x.level==='error'&&!x.refOnly&&/Vợ/.test(x.msg)&&/chưa xác nhận nghĩa/.test(x.msg)));
  assert.throws(()=>c.runSim(true));
  s.extraPeople[0].pension.amountBasis='baseMonth';       // hết chặn
  s.extraPeople[0].pension.startMonth=0;                   // tháng 0 của NGƯỜI THÊM cũng chặn
  assert.ok(c.validateErrors().length>0);
  s.extraPeople[0].pension.startMonth=1;
  s.extraPeople[0].periods=[{from:'sai-định-dạng',to:'',type:'dn',bh:10e6,growth:0}];   // giai đoạn tham khảo lỗi
  vs=c.validateState();
  assert.ok(vs.some(x=>x.level==='error'&&x.refOnly&&/Giai đoạn BHXH dòng 1/.test(x.msg)&&/\[Vợ\]/.test(x.msg)));
  assert.equal(c.validateErrors().length,0);               // refOnly không chặn hưu nhập tay
  near(c.runSim(true).pensionGot,12e6,.01);
});
test('M1: bhxhSummary(person) độc lập với người chính — dùng hồ sơ của người đó',()=>{
  let c=fresh(1),s=c.state;
  s.birthYear=1990;s.gender='male';s.periods=[];
  const p=spouse({birthYear:1975,periods:[{from:'1995-01',to:'2024-12',type:'dn',bh:20e6,growth:0}]});
  let r=c.bhxhSummary(p);
  assert.equal(r.retireIdx,2034*12+8);                    // nữ 1975: 59y8m → T9/2034 (B05/T08)
  assert.equal(r.retStart,2034*12+9);
  assert.equal(r.months,360);assert.equal(r.rate,75);assert.ok(r.eligible);
  assert.equal(c.bhxhSummary().months,0);                 // người chính không bị nhiễu
  let pf=c.pensionFromPeriods(p);
  assert.equal(pf.startYear,2034);assert.equal(pf.startMonth,9);   // đợt 13: hộp hưu hưởng NGAY tháng đủ tuổi T9/2034
  near(pf.amount,r.pension,.01);                          // infl=0 → F=1
});
test('M1: thêm người không đổi pha thu nhập mở — vẫn chạy đến hết tháng đủ tuổi NGƯỜI CHÍNH',()=>{
  function salaryMonths(withSpouse){
    let c=fresh(30),s=c.state;
    s.incomePeriods=[{fromY:2026,toY:null,amount:5e6,growth:0}];
    if(withSpouse)s.extraPeople=[spouse({birthYear:1975,pension:{amount:4e6,startYear:2026,startMonth:1,growth:0,amountSource:'manual',amountBasis:'baseMonth'}})];
    const sim=c.runSim(true);
    return [sim.months.filter(m=>m.salary>0).length,sim.months.findIndex(m=>m.salary===0),sim.retireIdx];
  }
  const [nA,firstNo,ret]=salaryMonths(false),[nB,firstNoB,retB]=salaryMonths(true);
  assert.equal(nA,nB);assert.equal(firstNo,firstNoB);assert.equal(ret,retB);
  assert.equal(firstNo,ret-2026*12+1);                    // lương chạy đến HẾT tháng đủ tuổi người chính
});
test('M1: riskCheck chạy qua cùng luồng nhiều người, không đổi state',()=>{
  let c=fresh(3),s=c.state;s.infl=5;
  s.pensionSimple={amount:10e6,startYear:2026,startMonth:6,growth:8};
  s.extraPeople=[spouse({pension:{amount:12e6,startYear:2027,startMonth:1,growth:8,amountSource:'manual',amountBasis:'baseMonth'}})];
  const before=JSON.stringify(s),risk=c.riskCheck(2);
  assert.ok(Number.isFinite(risk.p50));
  assert.equal(JSON.stringify(s),before);
});
test('M1: migrate v4 — bản cũ thêm mảng rỗng; extraPeople hợp lệ giữ nguyên; hỏng chuẩn hoá về mặc định',()=>{
  let c=fresh(1);
  const v3=JSON.parse(JSON.stringify(c.state));
  v3.schemaVersion=3;
  let s=c.migrateState(v3);
  assert.equal(s.schemaVersion,9);assert.strictEqual(JSON.stringify(s.extraPeople),'[]');assert.equal(s.activePerson,0);assert.equal(s.mainName,'');
  const v4=JSON.parse(JSON.stringify(c.state));
  v4.schemaVersion=4;
  v4.mainName='Anh';
  v4.activePerson=1;
  v4.extraPeople=[{id:'w1',name:'Vợ',birthYear:1992,gender:'female',
    periods:[{from:'2015-01',to:'',type:'dn',bh:15e6,growth:5}],
    pension:{amount:7654321.5,startYear:2038,startMonth:4,growth:8,amountSource:'fromPeriods',amountBasis:'baseMonth'}}];
  s=c.migrateState(v4);
  assert.equal(s.mainName,'Anh');assert.equal(s.activePerson,1);
  assert.equal(s.extraPeople.length,1);near(s.extraPeople[0].pension.amount,7654321.5,.001);
  assert.deepEqual(s.extraPeople[0].periods,v4.extraPeople[0].periods);
  const bad=JSON.parse(JSON.stringify(c.state));
  bad.schemaVersion=4;bad.extraPeople='hỏng';bad.activePerson=99;bad.mainName=7;
  s=c.migrateState(bad);
  assert.strictEqual(JSON.stringify(s.extraPeople),'[]');assert.equal(s.activePerson,0);assert.equal(s.mainName,'');
  const missing=JSON.parse(JSON.stringify(c.state));
  missing.schemaVersion=4;missing.extraPeople=[{name:'Em'}];   // thiếu trường → chuẩn hoá đủ hull
  s=c.migrateState(missing);
  assert.equal(s.extraPeople[0].gender,'male');assert.ok(Array.isArray(s.extraPeople[0].periods));
  assert.equal(s.extraPeople[0].pension.amountSource,'manual');
  assert.equal(s.extraPeople[0].id,'person-0');
});

/* ===== Đường so sánh "Nếu 100% tài khoản là tiết kiệm" — savingsOnlyNav (12/09/2026) =====
   Toàn bộ NAV ban đầu (gồm BĐS quy giá trị gốc) vào SavingsBook như danh mục (kỳ hạn 12 tháng,
   lãi theo rates.tk, rút trước hạn mất lãi phần rút); mỗi tháng cộng dòng tiền đời sống của lần chạy:
   lương + hưu + thu sự kiện − chi − chi sự kiện. Không còn BĐS → không thuê, không đợt bán BĐS. */
test('savingsOnlyNav: không dòng tiền — lãi đơn trong kỳ, nhập gốc khi đủ 12 tháng',()=>{
  let c=fresh(1),s=c.state;s.assets.mmf=40e6;s.assets.tk=60e6;s.rates.tk=6.5;
  const sim=c.runSim(false),r=c.savingsOnlyNav(sim),seed=s.assets.mmf+s.assets.tk;
  near(r.seed,sim.initial);                       // toàn bộ NAV ban đầu gieo vào tài khoản tiết kiệm
  assert.equal(r.nav.length,12);
  near(r.nav[0],seed*(1+.065/12),1);     // lãi sinh trước, không có dòng tiền
  near(r.nav[11],seed*1.065,1);
  assert.equal(r.shortfall,0);assert.equal(r.rate,6.5);
});
test('savingsOnlyNav: cùng dòng tiền đời sống — lương/hưu/thu vào, chi/chi sự kiện ra',()=>{
  let c=fresh(1),s=c.state;s.assets.mmf=100e6;
  s.milestones[0].monthly=4e6;
  s.pensionSimple={amount:3e6,startYear:2026,startMonth:1,growth:0,amountSource:'manual',amountBasis:'baseMonth'};
  wage(c,10e6);
  event(c,'chi',5e6,0);
  const sim=c.runSim(true),r=c.savingsOnlyNav(sim);
  near(r.nav[0],104e6,1);                         // +10tr lương +3tr hưu −4tr chi −5tr sự kiện chi
  near(r.nav[1],113e6,1);                         // mỗi tháng sau: +9tr
  near(r.nav[11],104e6+11*9e6,1);
  assert.equal(r.shortfall,0);
});
test('savingsOnlyNav: hết số dư — NAV chạm 0, thiếu chi tính từ tháng đầu không tài trợ được',()=>{
  let c=fresh(1),s=c.state;s.assets.mmf=20e6;
  event(c,'chi',25e6,0);
  const r=c.savingsOnlyNav(c.runSim(false));
  near(r.nav[0],0,1);                             // 20tr − 25tr chi sự kiện → rút hết, thiếu đúng 5tr
  near(r.shortfall,5e6,1);
  assert.equal(r.firstShort,c.NOW);
  near(r.nav[11],0,1);                            // không tạo NAV âm — thiếu các tháng sau không cộng vào NAV
});
test('savingsOnlyNav: không còn BĐS — bỏ qua tiền thuê và đợt bán BĐS có lịch của engine',()=>{
  let c=fresh(1),s=c.state;s.assets.mmf=20e6;
  s.landPlots=[plot({rent:true,rentMode:'direct',rentVnd:8e6,saleYear:2026,salePrice:1e9})];
  event(c,'chi',25e6,0);
  const sim=c.runSim(false),r=c.savingsOnlyNav(sim);
  near(r.seed,1020e6,1);                          // gieo vào gồm cả BĐS quy giá trị ban đầu
  assert.ok(sim.months[0].rent>=8e6);             // engine chính vẫn nhận tiền thuê…
  near(r.nav[0],995e6,1);                         // …còn đường tiết kiệm: 1020tr − 25tr, KHÔNG cộng 8tr thuê
  near(r.nav[10],995e6,1);                        // các tháng sau không có dòng tiền nào (tiền thuê bị bỏ qua)
  near(r.nav[11],995e6,1);                        // không nhận 1 tỷ từ đợt bán BĐS có lịch của tháng 12
  assert.equal(r.shortfall,0);
});
test('savingsOnlyNav: khớp danh mục 100% TK khi không cần giữ riêng tiền cho sự kiện sắp tới',()=>{
  const c=fresh(4),s=c.state;
  s.assets.tk=500e6;s.rates.tk=7;s.rates.tkShort=3;s.rates.tkMedium=4.5;s.milestones[0].monthly=12e6;
  s.lifePlan=c.newLifePlan(c.NOW);s.lifePlan.emergencyMonths=0;
  const row=s.lifePlan.rows[0];
  row.allocation={reserveMonths:0,weights:{tk:100,tp:0,cp:0,gold:0}};
  row.income={amount:20e6,growth:0,anchor:c.NOW};
  s.lifePlan.rows.push({id:'stop-income',from:c.NOW+18,label:'Nghỉ',income:{amount:0,growth:0,anchor:c.NOW+18},allocation:null});
  const sim=c.runSim(false),r=c.savingsOnlyNav(sim);
  sim.months.forEach((m,i)=>near(r.nav[i],m.total,.001));
  near(r.savingsForfeited,sim.savingsForfeited,.001);
  near(r.savingsForfeited,0); // known spending is funded by matured lots
});
test('savingsOnlyNav: sổ ngắn hạn đáo hạn trả cả gốc lãi, thiếu chỉ phần vượt quá',()=>{
  const c=fresh(1);c.state.rates.tk=12;c.state.rates.tkShort=3;
  const r=c.savingsOnlyNav({initial:100e6,months:[{mi:0,expense:100.5e6}]});
  near(r.nav[0],0);near(r.shortfall,.25e6);near(r.savingsForfeited,0);
  assert.equal(r.firstShort,c.NOW);
});
test('savingsOnlyNav: thuần — không đổi state; sim rỗng trả nav rỗng',()=>{
  let c=fresh(1),s=c.state;s.assets.mmf=50e6;s.rates.tk=6.5;
  const before=JSON.stringify(s),sim=c.runSim(false);
  c.savingsOnlyNav(sim);
  assert.equal(JSON.stringify(s),before);
  assert.equal(c.savingsOnlyNav({months:[],initial:sim.initial}).nav.length,0);
  assert.equal(c.savingsOnlyNav(null).nav.length,0);
});

/* ===== Chi phí cố định (không theo lạm phát) — plan-tab4-chi-co-dinh.md mục 6 ===== */
test('fixed expense: merges into monthly expense without inflation; inflating part still compounds',()=>{
  const c=fresh(40),s=c.state;s.infl=5;s.assets.mmf=100e9;
  s.milestones=[{y:0,monthly:10e6}];s.fixedMilestones=[{y:0,monthly:5e6}];
  const before=JSON.stringify(s.fixedMilestones),sim=c.runSim(true),m=sim.months;
  near(m[0].expense,15e6);
  near(m[60].expense,10e6*1.05**5+5e6,.01); // năm thứ 5: phần lạm phát nhân đủ 5 năm, phần cố định nguyên 5tr
  near(m[479].expense,10e6*1.05**39+5e6,.01);
  assert.equal(JSON.stringify(s.fixedMilestones),before);
});
test('fixed expense: months before the first fixed milestone carry no fixed cost',()=>{
  const c=fresh(5),s=c.state;s.infl=0;s.milestones=[{y:0,monthly:10e6}];
  s.fixedMilestones=[{y:3,monthly:5e6}];
  const m=c.runSim(false).months;
  near(m[0].expense,10e6);near(m[35].expense,10e6);
  near(m[36].expense,15e6);near(m[47].expense,15e6);
});
test('fixed expense: each milestone replaces the previous total (23m -> 3m, never 26m)',()=>{
  const c=fresh(15),s=c.state;s.infl=0;s.milestones=[{y:0,monthly:0}];
  s.fixedMilestones=[{y:0,monthly:23e6},{y:10,monthly:3e6}]; // trả góp 20tr + bảo hiểm 3tr; hết trả góp cuối năm thứ 9
  const m=c.runSim(false).months;
  near(m[0].expense,23e6);near(m[119].expense,23e6);
  near(m[120].expense,3e6);near(m[143].expense,3e6);near(m[149].expense,3e6);
});
test('fixed expense: a zero milestone takes effect at the FIRST month of its year — pay through year 15 by zeroing at y=16',()=>{
  const c=fresh(20),s=c.state;s.infl=0;s.milestones=[{y:0,monthly:0}];
  s.fixedMilestones=[{y:0,monthly:5e6},{y:16,monthly:0}];
  const m=c.runSim(false).months;
  near(m[191].expense,5e6); // tháng cuối năm thứ 15 vẫn trả đủ
  near(m[192].expense,0,.01); // đầu năm thứ 16 hết
  s.fixedMilestones=[{y:0,monthly:5e6},{y:15,monthly:0}];
  const m2=c.runSim(false).months;
  near(m2[180].expense,0,.01); // mốc y=15 cắt từ đầu năm thứ 15 — mất tiền năm trả cuối nếu đặt sai
});
test('fixed expense: investmentForecast rows match runSim snaps month by month (no drift between the two calculators)',()=>{
  const c=fresh(3),s=c.state;s.infl=4;
  s.milestones=[{y:0,monthly:10e6},{y:2,monthly:12e6}];
  s.fixedMilestones=[{y:0,monthly:5e6},{y:1,monthly:7e6}];
  const rows=c.investmentForecast(true),m=c.runSim(true).months;
  assert.equal(rows.length,m.length);
  for(let i=0;i<m.length;i++)near(rows[i].expense,m[i].expense,.01);
});
test('fixed expense: MMF reserve target = (inflating + fixed expense at that month) x months',()=>{
  const c=fresh(3),s=c.state;s.infl=5;
  s.milestones=[{y:0,monthly:10e6}];s.fixedMilestones=[{y:0,monthly:5e6}];
  const rows=c.investmentForecast(true);
  near(c.investmentReserve(rows,0,12),15e6*12);
  near(c.investmentReserve(rows,12,12),(10e6*1.05+5e6)*12);
  near(c.investmentReserve(rows,24,6),(10e6*1.05**2+5e6)*6);
});
test('fixed expense: savings-book schedule sees the fixed commitment in the 12-month deficits',()=>{
  const c=fresh(2),s=c.state;s.infl=0;s.milestones=[{y:0,monthly:10e6}];
  s.fixedMilestones=[{y:1,monthly:5e6}];s.events=[];
  const rows=c.investmentForecast(true);
  near(c.savingsDeficits(rows,0,[])[0],10e6);
  near(c.savingsDeficits(rows,12,[])[0],15e6);
});
test('fixed expense validation: duplicate year rejected with merge hint; empty group and shared years across groups are fine',()=>{
  const c=fresh(5),s=c.state;s.milestones=[{y:0,monthly:10e6}];s.fixedMilestones=[];
  assert.equal(c.validateErrors().filter(v=>v.tab==='t4'&&v.level==='error').length,0);
  s.fixedMilestones=[{y:2,monthly:5e6},{y:2,monthly:3e6}];
  const errs=c.validateErrors().filter(v=>v.tab==='t4'&&v.level==='error');
  assert.equal(errs.length,1);assert.match(errs[0].msg,/gộp/);
  s.fixedMilestones=[{y:0,monthly:3e6}]; // trùng năm thứ 0 với nhóm lạm phát — hợp lệ
  assert.equal(c.validateErrors().filter(v=>v.tab==='t4'&&v.level==='error').length,0);
});
test('fixed expense: runSim never mutates fixedMilestones',()=>{
  const c=fresh(2),s=c.state;s.milestones=[{y:0,monthly:3e6}];
  s.fixedMilestones=[{y:0,monthly:2e6},{y:1,monthly:0}];
  const before=JSON.stringify(s.fixedMilestones);
  c.runSim(true);c.runSim(false);
  assert.equal(JSON.stringify(s.fixedMilestones),before);
});
test('fixed expense: legacy state without fixedMilestones heals to [] silently, no migration banner',()=>{
  const c=fresh(3),s=c.state;s.infl=5;s.milestones=[{y:0,monthly:10e6}];
  const old=JSON.parse(JSON.stringify(c.state));delete old.fixedMilestones;
  const migrated=c.migrateState(old);
  assert.equal(JSON.stringify(migrated.fixedMilestones),'[]'); // realm VM — so JSON, không deepEqual
  assert.ok(!(c.migrationMessages||[]).some(msg=>/cố định/i.test(msg)));
  Object.assign(c.state,migrated); // mô phỏng trên bản đã heal: chỉ còn phần lạm phát
  near(c.runSim(true).months[0].expense,10e6); // fixed rỗng — expense = mốc 10tr tháng gốc
});
