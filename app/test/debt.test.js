'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fresh,plot}=require('./harness');
function loan(extra={}){return Object.assign({id:'loan-1',label:'Khoản vay',startMonth:null,amount:1200,termMonths:12,rateMode:'fixed',rate:0,introMonths:0,floatingSpread:0,plotId:null},extra);}
function close(a,b){assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);}

test('nợ hiện tại: trả đều 0%, tài sản và dư nợ cùng giảm, tài sản ròng không đổi',()=>{
  const c=fresh(1),s=c.state;s.assets.mmf=1200;s.debts=[loan()];
  const sim=c.runSim(false),m=sim.months;
  close(sim.initialDebt,1200);close(m[0].debtPaid,100);close(m[0].debt,1100);close(m[0].netWorth,0);
  close(m[11].debt,0);close(m[11].total,0);close(sim.shortfall,0);
});
test('vay mới: giải ngân tăng tiền và dư nợ cùng tháng; trả kỳ đầu tháng sau',()=>{
  const c=fresh(2),s=c.state;s.debts=[loan({startMonth:c.NOW+6})];
  const m=c.runSim(false).months;
  close(m[5].debt,0);close(m[6].loanDraw,1200);close(m[6].total,1200);close(m[6].debt,1200);close(m[6].netWorth,0);
  close(m[6].debtPaid,0);close(m[7].debtPaid,100);close(m[7].debt,1100);
});
test('cố định rồi thả nổi: lấy lãi Tab 6 và tính lại kỳ trả',()=>{
  const c=fresh(2),s=c.state;s.assets.mmf=1500;s.debtFloatingRates=[{fromY:0,rate:12}];
  s.debts=[loan({rateMode:'fixed-floating',introMonths:2,rate:0})];
  const m=c.runSim(false).months;
  close(m[0].debtPaid,100);close(m[1].debtPaid,100);
  assert.ok(m[2].debtDue>100);close(m[2].debtInterest,10);close(m[11].debt,0);
});
test('lãi thả nổi đổi ở mốc năm Tab 6, khoản trả đổi theo dư nợ còn lại',()=>{
  const c=fresh(2),s=c.state;s.assets.mmf=2000;
  s.debtFloatingRates=[{fromY:0,rate:0},{fromY:1,rate:12}];
  s.debts=[loan({termMonths:18,rateMode:'fixed-floating',introMonths:0})];
  const m=c.runSim(false).months;
  close(m[0].debtInterest,0);close(m[11].debtInterest,0);
  assert.ok(m[12].debtInterest>0);assert.ok(m[12].debtDue>m[11].debtDue);
});
test('mọi khoản vay đang thả nổi dùng lãi của năm hiện tại dù giải ngân khác thời điểm',()=>{
  const c=fresh(3),s=c.state;
  s.debtFloatingRates=[{fromY:0,rate:6},{fromY:1,rate:12},{fromY:2,rate:4}];
  const old=loan({id:'old',termMonths:36,rateMode:'fixed-floating',introMonths:0,rate:3});
  const newer=loan({id:'new',startMonth:c.NOW+15,termMonths:24,rateMode:'fixed-floating',introMonths:0,rate:9});
  const introductory=loan({id:'intro',startMonth:c.NOW+15,termMonths:24,rateMode:'fixed-floating',introMonths:2,rate:9});
  close(c.debtRateAt(old,11),6);close(c.debtRateAt(old,12),12);
  close(c.debtRateAt(newer,16),12);close(c.debtRateAt(introductory,16),9);
  close(c.debtRateAt(introductory,18),12);
  close(c.debtRateAt(old,24),4);close(c.debtRateAt(newer,24),4);
});
test('migrate khoản vay v10 giữ lịch lãi cũ ở kịch bản Tab 6 mặc định',()=>{
  const c=fresh(2),s=c.state,old=JSON.parse(JSON.stringify(s));
  old.schemaVersion=10;delete old.debtFloatingRates;
  old.debts=[{id:'old',label:'Cũ',kind:'consumer',startMonth:null,amount:1200,termMonths:12,rate:0,introMonths:2,rateAfter:12,plotId:null}];
  const m=c.migrateState(old);
  assert.equal(m.schemaVersion,12);assert.equal(m.debts[0].rateMode,'fixed-floating');
  assert.equal(m.debts[0].floatingSpread,4);assert.equal('kind' in m.debts[0],false);
  close(m.debtFloatingRates[0].rate+m.debts[0].floatingSpread,12);
  s.debts=m.debts;s.debtFloatingRates=m.debtFloatingRates;s.assets.mmf=2000;
  close(c.runSim(false).months[2].debtInterest,10);
});
test('sinh lãi vay theo từng năm trong biên độ, tái lập theo seed và giữ kịch bản cũ khi migrate',()=>{
  const c=fresh(5),s=c.state;
  const a=c.generateDebtFloatingRates(5,9.5,2,123),b=c.generateDebtFloatingRates(5,9.5,2,123);
  assert.equal(JSON.stringify(a),JSON.stringify(b));
  assert.equal(a.length,5);a.forEach((row,y)=>{assert.equal(row.fromY,y);assert.ok(row.rate>=7.5&&row.rate<=11.5);});
  assert.ok(new Set(a.map(row=>row.rate)).size>1);
  s.debtFloatingRates=a;
  a.forEach((row,y)=>close(c.debtFloatingRateAt(y*12),row.rate));
  const old=JSON.parse(JSON.stringify(s));old.schemaVersion=11;delete old.debtRateGenerator;
  const migrated=c.migrateState(old);
  assert.equal(JSON.stringify(migrated.debtFloatingRates),JSON.stringify(a));
  close(migrated.debtRateGenerator.center,a[0].rate);close(migrated.debtRateGenerator.swing,2);
});
test('mốc lãi Tab 6 trùng năm hoặc thiếu năm 0 bị chặn',()=>{
  const c=fresh(2),s=c.state;
  s.debtFloatingRates=[{fromY:1,rate:8},{fromY:1,rate:12}];
  const errors=c.validateState().filter(x=>x.level==='error'&&x.tab==='t6').map(x=>x.msg);
  assert.ok(errors.some(x=>x.includes('trùng')));assert.ok(errors.some(x=>x.includes('năm 0')));
});
test('BĐS mua bằng vay mới: chi đủ giá mua, chỉ giải ngân phần vay; không tạo tài sản ròng ảo',()=>{
  const c=fresh(2),s=c.state,p=plot({id:'house',ownYear:2027,total:1000,sellable:false});
  s.landPlots=[p];s.assets.mmf=400;s.debts=[loan({startMonth:2027*12,amount:600,termMonths:12,plotId:'house'})];
  const m=c.runSim(false).months[12];
  close(m.loanDraw,600);close(m.propertyPurchase,1000);close(m.land,1000);close(m.total,1000);close(m.debt,600);close(m.netWorth,400);close(m.short,0);
});
test('BĐS mua cuối tháng chưa hưởng lợi suất của chính tháng mua',()=>{
  const c=fresh(2),s=c.state;s.landPlots=[plot({id:'house',ownYear:2027,total:1000,sellable:false,rent:true,rentVnd:10})];
  s.assets.mmf=400;s.debts=[loan({startMonth:2027*12,amount:600,termMonths:12,plotId:'house'})];
  s.series.land[12]=.1;s.series.land[13]=.1;
  const m=c.runSim(false).months;
  close(m[12].land,1000);close(m[13].land,1100);close(m[12].rent,0);close(m[13].rent,10);
});
test('bán BĐS gắn vay: dùng tiền bán trả dư nợ trước, phần dư mới thành tiền mặt',()=>{
  const c=fresh(2),s=c.state,p=plot({id:'house',total:1000,saleYear:2026,sellable:false});
  s.landPlots=[p];s.debts=[loan({amount:600,termMonths:24,plotId:'house'})];s.assets.mmf=300;
  const m=c.runSim(false).months[11];
  assert.ok(m.debtPayoff>0);close(m.debt,0);close(m.land,0);close(m.ledger.error,0);
  close(m.strategy.reserveTarget,0);
});
test('bán BĐS khẩn cấp đang gắn nợ không trả trùng kỳ vay và sổ NAV vẫn cân',()=>{
  const c=fresh(1),s=c.state,p=plot({id:'house',total:1000,sellable:true});
  s.landPlots=[p];s.debts=[loan({amount:600,termMonths:12,plotId:'house'})];
  s.milestones=[{y:0,monthly:100}];
  const m=c.runSim(false).months[0];
  assert.ok(m.debtPayoff>0);close(m.debt,0);close(m.land,0);close(m.ledger.error,0);
  assert.ok(m.short<1);
});
test('thiếu tiền trả: phần chưa thanh toán vẫn nằm trong dư nợ',()=>{
  const c=fresh(1),s=c.state;s.debts=[loan({amount:1000,termMonths:10})];
  const m=c.runSim(false).months[0];
  close(m.debtDue,100);close(m.debtPaid,0);close(m.short,100);close(m.debt,1000);
});
test('liên kết BĐS và thời điểm giải ngân không khớp bị chặn',()=>{
  const c=fresh(2),s=c.state;s.landPlots=[plot({id:'house',ownYear:2027,total:1000})];
  s.debts=[loan({startMonth:2027*12+1,plotId:'house'})];
  assert.ok(c.validateState().some(x=>x.level==='error'&&x.tab==='t2'&&x.msg.includes('tháng giải ngân')));
});
test('kiểm tra rủi ro dùng dòng trả nợ của mọi đường lợi suất',()=>{
  const c=fresh(2),s=c.state;s.debts=[loan({amount:1200,termMonths:12})];
  const r=c.riskCheck(5,false,123);
  assert.equal(r.n,5);close(r.runOutRate,1);assert.ok(r.avgShortfall>=1200);
});
