'use strict';
/* [core/simulation.js] Bộ máy mô phỏng dòng tiền (runSim, SavingsBook) + đường so sánh "100% tiết kiệm"
   (savingsOnlyNav — thuần, đọc sim+state) + kiểm tra dữ liệu (validateState).
   ĐỌC: state, NOW, state.series (hoặc opt.series do riskCheck truyền), core/pension.js (bhxhSummary,
   pensionMonthly, pensionStartOf, validatePensionPeriods), core/series.js (ensureSeries khi thiếu chuỗi).
   GHI: KHÔNG đổi state — mọi tính toán trên bản sao cục bộ; đối chiếu sổ NAV từng tháng, lỗi là throw. */
var ALLOCATION_KEYS=['mmf','tk','tp','cp','gold'];
function finiteNumber(v){return typeof v==='number'&&isFinite(v);}
function goldBid(price){return price*(1-state.goldSpread/100);}
function goldBuy(money,price){var chi=Math.floor((money+1e-7)/price);return {chi:chi,leftover:Math.max(0,money-chi*price)};}
function goldSell(need,chi,price){var sell=Math.min(chi,Math.ceil(Math.max(0,need-1e-7)/price)),got=sell*price,applied=Math.min(got,need);return {chi:sell,got:got,applied:applied,change:Math.max(0,got-applied)};}
function plotValue(p){return finiteNumber(p.total)?p.total:p.area*p.price;}
/* ===== BĐS v8 — mọi số nhập theo GIÁ HIỆN TẠI tại tháng gốc NOW =====
   ownIdx = số tháng từ NOW tới khi bắt đầu sở hữu (ownYear null/0/năm đã qua = có sẵn đầu kỳ).
   Trước ownIdx BĐS không nằm trong NAV, không thuê, không bán được, không phát sinh chi phí.
   Giá trị tại tháng nhận = giá trị nhập × (1+lạm phát)^(số tháng tới/12), sau đó đi theo chuỗi giá đất.
   Tiền thuê = giá thuê nhập × lạm phát tới tháng BẮT ĐẦU THUÊ × (1+tăng thuê)^(số năm thuê đã trôi).
   Thuê từ năm (rentFromYear) trống/null = cho thuê ngay khi có BĐS; nhập trước năm sở hữu được
   kẹp về năm sở hữu. BÁN BỐN BỀ: tháng bán vẫn nhận đủ tiền thuê, từ tháng sau sold=true hết hẳn.
   Giá bán nhập (nếu có) = giá hiện tại, nhân lạm phát tới tháng bán; trống = giá mô phỏng lúc bán. */
function plotOwnIdx(p){var idx=(p.ownYear==null||p.ownYear==='')?0:p.ownYear*12-NOW;return idx>0?idx:0;}
function plotRentIdx(p){
  var own=plotOwnIdx(p),rf=(p.rentFromYear==null||p.rentFromYear==='')?0:p.rentFromYear*12-NOW;
  if(rf<own)rf=own;   // thuê trước năm sở hữu → coi như thuê ngay khi có BĐS
  return rf>0?rf:0;
}
function plotRentAt(p,mi){
  if(!p.rent)return 0;
  var from=plotRentIdx(p);if(mi<from)return 0;
  return (p.rentVnd||0)*Math.pow(1+state.infl/100,from/12)*Math.pow(1+(p.rentGrowth||0)/100,Math.floor((mi-from)/12));
}
/* Chi phí sửa chữa/duy tu/bảo trì/đầu tư thêm phát sinh cuối tháng 12 của năm đã chọn (năm dương lịch),
   nhân lạm phát từ NOW tới tháng phát sinh; chỉ tính từ năm sở hữu trở đi. */
function plotExpenseAt(m){
  var t=0;state.landPlots.forEach(function(p){
    var ownM=NOW+plotOwnIdx(p);
    (p.expenses||[]).forEach(function(x){if(x.y*12+11===m&&m>=ownM)t+=(x.amount||0)*Math.pow(1+state.infl/100,(m-NOW)/12);});
  });
  return t;
}
// Latest started milestone applies until the next one; the final milestone lasts to the simulation end.
// Every entered level is in base-month prices. Inflation below uses years since NOW, never since the milestone.
function monthlyLevel(elapsed){var lv=0;state.milestones.slice().sort(function(a,b){return a.y-b.y;}).forEach(function(ms){if(ms.y<=elapsed)lv=ms.monthly;});return lv;}
// Fixed (non-inflating) commitments share the milestone semantics: each level replaces the previous
// one and stays nominal. No y=0 anchor is required; months before the first milestone carry no fixed cost.
function fixedLevel(elapsed){var lv=0;(state.fixedMilestones||[]).slice().sort(function(a,b){return a.y-b.y;}).forEach(function(ms){if(ms.y<=elapsed)lv=ms.monthly;});return lv;}
// Single source of monthly living expense for runSim AND investmentForecast, so the MMF reserve and
// the savings-book schedule can never drift from the simulated cash flow.
function expensesAtY(y){return monthlyLevel(y)*Math.pow(1+state.infl/100,y)+fixedLevel(y);}
/* Savings lots accrue simple interest until maturity. plan() splits only new money
   and matured lots to cover known spending over the next 12 months. Existing locked
   lots keep their terms; unplanned withdrawals forfeit only the withdrawn portion's
   current-term interest. All cash flows occur at month end, so the first bill can
   be funded by a one-month deposit. */
function SavingsBook(initial,rate,remaining){
  this.rate=rate/100;this.lots=[];this.forfeited=0;
  if(initial>0){var age=12-(remaining===undefined?12:remaining);this.lots.push({principal:initial,age:age,term:12,rate:this.rate});}
}
SavingsBook.prototype.principal=function(){return this.lots.reduce(function(s,l){return s+l.principal;},0);};
SavingsBook.prototype.value=function(){return this.lots.reduce(function(s,l){return s+l.principal*(1+l.rate*l.age/12);},0);};
SavingsBook.prototype.tick=function(){this.lots.forEach(function(l){l.age++;if(l.age>=l.term){l.principal*=1+l.rate*l.term/12;l.age=0;}});};
SavingsBook.prototype.deposit=function(x){if(x<=1e-7)return;var lot=this.lots.filter(function(l){return l.age===0&&l.term===12;})[0];if(lot)lot.principal+=x;else this.lots.push({principal:x,age:0,term:12,rate:this.rate});};
SavingsBook.prototype.withdraw=function(need){
  var got=0,lost=0;
  this.lots.sort(function(a,b){return a.rate*a.age-b.rate*b.age;}); // matured/new first, then smallest lost interest per dong
  for(var i=0;i<this.lots.length&&need>1e-7;i++){
    var l=this.lots[i],take=Math.min(l.principal,need);
    lost+=take*l.rate*l.age/12;l.principal-=take;need-=take;got+=take;
  }
  this.lots=this.lots.filter(function(l){return l.principal>1e-7;});this.forfeited+=lost;
  return {got:got,lost:lost};
};
SavingsBook.prototype.plan=function(deficits,cash,shortRate,mediumRate){
  var available=0,locked=[],due=Array(12).fill(0),self=this;
  this.lots.forEach(function(l){
    if(l.age===0)available+=l.principal;
    else {locked.push(l);var d=l.term-l.age;if(d<=12)due[d-1]+=l.principal*(1+l.rate*l.term/12);}
  });
  this.lots=locked;
  var bridge=Math.max(0,cash||0);
  for(var i=0;i<Math.min(12,deficits.length);i++){
    bridge+=due[i];
    var need=Math.max(0,deficits[i]),covered=Math.min(bridge,need);bridge-=covered;need-=covered;
    if(need<=1e-7||available<=1e-7)continue;
    var term=i+1,rate=(term<6?shortRate:term<12?mediumRate:self.rate*100)/100;
    var principal=Math.min(available,need/(1+rate*term/12));
    this.lots.push({principal:principal,age:0,term:term,rate:rate});available-=principal;
  }
  this.deposit(available); // unused money earns the full 12-month rate
};
/* Quỹ trái phiếu / quỹ cổ phiếu: NAV tăng lãi kép theo tháng — lãi ĐÃ SINH luôn bảo toàn khi rút
   ở bất kỳ thời điểm nào (khác tiết kiệm mất lãi kỳ này). Riêng quỹ trái phiếu: gói nạp dưới 12 tháng
   tuổi bị trừ 2% phí trên phần rút; rút gói CŨ trước (FIFO tuổi giảm dần) để chỉ gói mới chịu phí.
   Số dư ban đầu coi như đã giữ trên 12 tháng — không phí. */
function FundBook(initial,rateAnnual,earlyFeePct,minMonths){
  this.monthly=Math.pow(1+rateAnnual/100,1/12);
  this.earlyFee=(earlyFeePct||0)/100;this.minAge=minMonths||12;
  this.lots=[];this.fees=0;
  if(initial>0)this.lots.push({principal:initial,age:this.minAge});
}
FundBook.prototype.tick=function(){var r=this.monthly;this.lots.forEach(function(l){l.principal*=r;l.age++;});};
FundBook.prototype.value=function(){return this.lots.reduce(function(s,l){return s+l.principal;},0);};
FundBook.prototype.deposit=function(x){
  if(x<=1e-7)return;
  // Merge purchases made in the same month only; each later purchase starts its own fee clock.
  var fresh=this.lots.filter(function(l){return l.age===0;})[0];
  if(fresh)fresh.principal+=x;else this.lots.push({principal:x,age:0});
};
FundBook.prototype.withdraw=function(need){
  var got=0,fee=0,self=this;
  this.lots.sort(function(a,b){return b.age-a.age;});
  for(var i=0;i<this.lots.length&&need>1e-7;i++){
    var l=this.lots[i],free=l.age>=this.minAge;
    var take=Math.min(l.principal,free?need:need/(1-self.earlyFee));
    var f=free?0:take*self.earlyFee;
    l.principal-=take;fee+=f;got+=take-f;need-=take-f;
  }
  this.lots=this.lots.filter(function(l){return l.principal>1e-7;});
  this.fees+=fee;
  return {got:got,fee:fee};
};
/* Only known life cash flows inform maturities: no future market prices or forced
   property sales. MMF already held and existing maturities cover deficits first.
   Future surplus is not pledged until it is actually received. */
function savingsDeficits(forecast,from,plots){
  return forecast.slice(from,from+12).map(function(r,j){
    var rent=0;
    (plots||[]).forEach(function(p){
      if(p.sold||!p.rent||(p.saleYear!=null&&r.m>p.saleYear*12+11))return;
      rent+=plotRentAt(p,from+j);
    });
    return Math.max(0,r.expense+r.eventOut-r.salary-r.pension-(r.eventIn||0)-rent);
  });
}
function planSavings(book,deficits,cash){
  book.plan(deficits,cash,state.rates.tkShort===undefined?3:state.rates.tkShort,state.rates.tkMedium===undefined?4.5:state.rates.tkMedium);
}

function runSim(withBhxh,opt){
  opt=opt||{};
  if(!opt.series)ensureSeries();
  var plan=opt.investmentPlan===undefined?effectiveInvestmentPlan():opt.investmentPlan; /* Đợt 14: luôn chạy chiến lược theo giai đoạn — không còn chế độ phân bổ cũ */
  var errors=validateState(plan).filter(function(e){return e.level==='error'&&!e.refOnly;});if(errors.length)throw new Error(errors.map(function(e){return e.msg;}).join(' '));
  var series=opt.series||state.series, count=state.simYears*12;
  SERIES_KEYS.forEach(function(k){if(!series[k]||series[k].length!==count||series[k].some(function(r){return !finiteNumber(r)||r<=-1;}))throw new Error('Chuỗi '+k+' không đủ tháng hoặc có lợi suất không hợp lệ.');});
  var summary=bhxhSummary(),a={mmf:state.assets.mmf,cp:state.assets.cp};
  var tp=new FundBook(state.assets.tp,state.rates.tp,
    state.rates.tpEarlyFee===undefined?2:state.rates.tpEarlyFee,
    state.rates.tpMinMonths===undefined?12:state.rates.tpMinMonths);
  var savings=new SavingsBook(state.assets.tk,state.rates.tk,12); // initial balance starts a fresh 12-month term
  var chi=state.goldChi,ask=state.goldPrice,cpIdx=1,cpPeak=1,goldPeak=ask;
  /* Mỗi BĐS có chuỗi giá RIÊNG bắt đầu tick từ tháng sở hữu (ownIdx): BĐS nhận sau không nằm
     trong NAV trước đó; giá trị nhập đã được nhân lạm phát tới tháng nhận thành baseNom. */
  var plots=state.landPlots.map(function(p){var own=plotOwnIdx(p);return {id:p.id,label:p.label,ownYear:p.ownYear,own:own,baseNom:plotValue(p)*Math.pow(1+state.infl/100,own/12),area:p.area,rent:p.rent,rentVnd:p.rentVnd||0,rentFromYear:p.rentFromYear==null?null:p.rentFromYear,rentGrowth:p.rentGrowth||0,saleYear:p.saleYear,salePrice:p.salePrice,sellable:p.sellable!==false,idx:1,sold:false};});
  var years=[],months=[],firstShort=-1,shortfall=0,pensionGot=0,evIn=0,evOut=0,landSold=0,initial=0,curMi=0;
  /* MMF là nguồn chi trực tiếp; nhãn nguồn theo tiền đã rút từ MMF. Tiền bán tài sản nạp vào
     MMF được giữ theo nguồn cho tới khi dùng để chi, nên tái cân bằng không tự đổi màu đường NAV. */
  /* MMF là tiền chung: ghi nguồn theo quy ước chi khoản vào trước, đầu tư khoản vào sau.
     Nhờ vậy bán nạp MMF chỉ đổi màu khi khoản tiền đó thực sự được rút chi. */
  var mmfLots=state.assets.mmf>0?[{src:'mmf',amount:state.assets.mmf,kind:'initial',mi:-1}]:[];
  function addMmfLot(src,amount,kind,mi){if(amount>1e-7)mmfLots.push({src:src,amount:amount,kind:kind,mi:mi});}
  function takeMmfLots(amount,latest){
    var out={},left=amount;
    while(left>1e-7&&mmfLots.length){
      var i=latest?mmfLots.length-1:0,lot=mmfLots[i],take=Math.min(lot.amount,left);
      lot.amount-=take;left-=take;out[lot.src]=(out[lot.src]||0)+take;
      if(lot.amount<=1e-7)mmfLots.splice(i,1);
    }
    // The fund balance and provenance lots compound separately; sub-cent drift can build up over decades.
    if(left>.01)throw new Error('Đối chiếu nguồn MMF không khớp tại '+ymToStr(NOW+curMi)+'.');
    return out;
  }
  var forecast=investmentForecast(withBhxh),previousStage=null,cpHistory=[1];
  var strategyStats={stockSoldInDrawdown:0,proactiveSales:0,reserveShortMonths:0};
  /* M1 — hưu gia đình: dựng MỘT LẦN trước vòng lặp mốc hưởng/mức/tăng của từng người;
     từng tháng cộng các dòng hưu đã đến hạn theo đúng công thức hai giai đoạn của người đó. */
  var pensioners=[];
  if(withBhxh&&state.pensionMode==='simple'){
    pensioners.push(pensionStartOf(state.pensionSimple));
    (state.extraPeople||[]).forEach(function(p0){ pensioners.push(pensionStartOf(p0.pension)); });
  }
  function landValue(){return plots.reduce(function(v,p){return v+(p.sold||curMi<p.own?0:p.baseNom*p.idx);},0);}
  function total(){return a.mmf+savings.value()+tp.value()+a.cp+chi*goldBid(ask)+landValue();}
  function values(){return {mmf:a.mmf,tk:savings.value(),tp:tp.value(),cp:a.cp,gold:chi*goldBid(ask)};}
  function incomeAt(m){
    var found=null;state.incomePeriods.forEach(function(p){var end=p.toY===null?summary.retireIdx:p.toY*12+11;if(m>=p.fromY*12&&m<=end)found=p;}); /* pha mở chạy đến HẾT tháng đủ tuổi nghỉ hưu */
    return found;
  }
  initial=total();
  planSavings(savings,savingsDeficits(forecast,0,plots),a.mmf);
  var lastTrade={};
  for(var mi=0;mi<count;mi++){
    var m=NOW+mi,year=Math.floor(m/12),elapsed=Math.floor(mi/12),before=total();
    curMi=mi;
    var ya=years[years.length-1];
    if(!ya||ya.year!==year){ya={year:year,age:year-state.birthYear,inc:0,pen:0,exp:0,evIn:0,evOut:0,landSold:0,short:0,months:0,srcDrawn:{},effDrawn:{},tkLost:0};years.push(ya);}
    var mmfGrowth=Math.pow(1+state.rates.mmf/100,1/12);
    a.mmf*=mmfGrowth;mmfLots.forEach(function(lot){lot.amount*=mmfGrowth;});
    tp.tick();
    savings.tick();a.cp*=1+series.cp[mi];cpIdx*=1+series.cp[mi];ask*=1+series.gold[mi];
    plots.forEach(function(p){if(mi>=p.own)p.idx*=1+series.land[mi];});
    cpPeak=Math.max(cpPeak,cpIdx);goldPeak=Math.max(goldPeak,ask);
    cpHistory.push(cpIdx);
    var stage=investmentStageAt(plan,m),trades=[],strategy=null;
    var marketPnL=total()-before,phase=incomeAt(m);
    /* Đợt 11 — bỏ chế độ "theo lạm phát" của giai đoạn thu nhập: tăng trưởng luôn theo % đã nhập
       (bản lưu cũ có followInfl được migrateState quy về growth = lạm phát lúc migrate). */
    var salary=salaryAt(m,summary);
    var rent=0;plots.forEach(function(p){if(p.rent&&!p.sold&&!(p.saleYear!=null&&m>p.saleYear*12+11))rent+=plotRentAt(p,mi);}); /* sold từ tháng sau bán → hết thuê hẳn; plotRentAt tự guard năm bắt đầu thuê */
    var pension=0;
    if(withBhxh){
      if(state.pensionMode==='simple')pensioners.forEach(function(pp){pension+=pensionMonthly(pp.amount,pp.start,pp.growth,state.infl,NOW,m);});
      else if(summary.eligible&&m>=summary.retStart)pension=summary.pension*Math.pow(1+state.pensionIdx/100,Math.floor((m-summary.retStart)/12));
    }
    var expense=expensesAtY(elapsed),eventOut=0,eventIn=0;
    var plotExp=plotExpenseAt(m);eventOut+=plotExp; /* chi sửa chữa/duy tu BĐS: cuối tháng 12 năm chọn, đã gồm lạm phát */
    var ordinary=salary+rent+pension,sales=0,salesPnL=0,goldCost=0,tkLost=0,tpFee=0,cpFee=0,drawn={},refillBySrc={},mmfSpentBySrc={};
    // All rental income is earned through this month's end; a sale stops next month's rent.
    plots.forEach(function(p){
      if(!p.sold&&mi>=p.own&&p.saleYear!==null&&p.saleYear!==undefined&&m===p.saleYear*12+11){
        var marked=p.baseNom*p.idx,proceeds=p.salePrice===null||p.salePrice===undefined?marked:p.salePrice*Math.pow(1+state.infl/100,(m-NOW)/12);
        sales+=proceeds;salesPnL+=proceeds-marked;p.sold=true;ordinary+=proceeds;
      }
    });
    state.events.forEach(function(e){
      if(Math.round(e.y*12)!==mi)return;
      var value=e.amount*Math.pow(1+state.infl/100,e.y);
      if(e.kind==='chi')eventOut+=value;
      else {eventIn+=value;ordinary+=value;} /* Đợt 14: mọi dòng thu đi qua chiến lược — không còn tỷ lệ riêng của sự kiện */
    });
    var external=salary+rent+pension+eventIn,required=expense+eventOut;
    var ordinaryUsed=Math.min(ordinary,required);ordinary-=ordinaryUsed;var need=required-ordinaryUsed;
    function record(k,v){if(v>0){drawn[k]=(drawn[k]||0)+v;ya.srcDrawn[k]=(ya.srcDrawn[k]||0)+v;}}
    // Internal transfers only: selling never counts as external income or new NAV.
    function sellToCash(k,amount,reason){
      if(amount<=1e-7)return 0;
      var got=0,lost=0;
      if(k==='tk'){var w=savings.withdraw(amount);got=w.got;lost=w.lost;tkLost+=lost;}
      else if(k==='tp'){var t=tp.withdraw(amount);got=t.got;lost=t.fee;tpFee+=t.fee;}
      else if(k==='gold'){var g=goldSell(amount,chi,goldBid(ask));chi-=g.chi;got=g.got;}
      else if(k==='cp'){var rate=(state.rates.cpSellFee||0)/100,gross=Math.min(a.cp,amount/(1-rate));
        a.cp-=gross;lost=gross*rate;cpFee+=lost;got=gross-lost;}
      else {got=Math.min(a[k],amount);a[k]-=got;}
      a.mmf+=got;addMmfLot(k,got,reason==='Bù phần chi còn thiếu'?'direct':'strategy',mi);
      if(got>1e-7){trades.push({side:'sell',asset:k,amount:got,reason:reason,cost:lost});
        if(k==='cp'&&cpIdx/cpPeak<=.8+1e-12)strategyStats.stockSoldInDrawdown+=got;
      }
      return got;
    }
    /* Cân bằng theo GIÁ TRỊ tài sản: rút TK mất lãi kỳ này, TP có thể mất phí.
       Bán đúng phần giá trị đang vượt mục tiêu, thay vì thu về bấy nhiêu tiền mặt rồi
       phải mua lại chính tài sản vừa bán sau khi NAV giảm vì chi phí rút. */
    function cashForAssetValue(k,excess){
      if(k==='tk'){
        var leftTk=excess,cashTk=0;
        savings.lots.slice().sort(function(a,b){return a.rate*a.age-b.rate*b.age;}).forEach(function(l){
          if(leftTk<=1e-7)return;
          var factor=1+l.rate*l.age/12,take=Math.min(l.principal,leftTk/factor);
          cashTk+=take;leftTk-=take*factor;
        });
        return cashTk;
      }
      if(k==='tp'){
        var leftTp=excess,cashTp=0;
        tp.lots.slice().sort(function(a,b){return b.age-a.age;}).forEach(function(l){
          if(leftTp<=1e-7)return;
          var take=Math.min(l.principal,leftTp);
          cashTp+=take*(l.age>=tp.minAge?1:1-tp.earlyFee);leftTp-=take;
        });
        return cashTp;
      }
      if(k==='cp')return excess*(1-(state.rates.cpSellFee||0)/100);
      return excess;
    }
    // Quote an order without changing any lot. Rebalancing uses the quote before committing
    // a withdrawal; it must not discover an early-redemption fee after placing the order.
    function saleQuote(k,value){
      var held=values()[k],wanted=Math.min(Math.max(0,value),held);
      if(k==='gold'){
        var g=goldSell(wanted,chi,goldBid(ask));
        return {value:g.got,cash:g.got,cost:0};
      }
      var cash=cashForAssetValue(k,wanted);
      return {value:wanted,cash:cash,cost:Math.max(0,wanted-cash)};
    }
    function cashDraw(k){var take=Math.min(a[k],need);a[k]-=take;need-=take;record(k,take);
      if(k==='mmf')mmfSpentBySrc=takeMmfLots(take,false);
    }
    if(need>1e-7)cashDraw('mmf');
    var risky=['cp','gold'];
    if(state.sellRule!=='cpFirst'&&ask/goldPeak>cpIdx/cpPeak+1e-12)risky=['gold','cp'];
    if(need>1e-7){
      function fundFrom(k,amount){
        var got=sellToCash(k,Math.min(need,amount),'Bù phần chi còn thiếu'),used=Math.min(need,got);
        a.mmf-=used;takeMmfLots(used,true);need-=used;record(k,used);
      }
      // Pay expenses from holdings with the lowest immediate redemption cost first.
      // Within the same cost tier, prefer an asset currently above its target weight.
      var v=values(),reserveNow=investmentReserve(forecast,mi,stage.reserveMonths);
      var net=Math.max(0,ALLOCATION_KEYS.reduce(function(s,k){return s+v[k];},0)-need-(stage.unified?0:reserveNow)),w=investmentWeights(stage,m);
      if(stage.unified){
        var excess={},totalFreeExcess=0,initialNeed=need;
        INVESTMENT_KEYS.forEach(function(k){
          var q=saleQuote(k,v[k]),free=q.cost<1?Math.max(0,v[k]-net*w[k]):0;
          excess[k]=free;totalFreeExcess+=free;
        });
        if(totalFreeExcess>0)INVESTMENT_KEYS.forEach(function(k){
          if(excess[k]>0&&need>1e-7)fundFrom(k,Math.min(excess[k],initialNeed*excess[k]/totalFreeExcess));
        });
      }
      var expenseOrder=INVESTMENT_KEYS.slice().sort(function(x,y){
        function rank(k){var q=saleQuote(k,Math.min(v[k],Math.max(need,1))),cost=q.cash>0?q.cost/q.cash:Infinity;
          return cost;}
        var d=rank(x)-rank(y);if(Math.abs(d)>1e-9)return d;
        if(risky.indexOf(x)>=0&&risky.indexOf(y)>=0)return risky.indexOf(x)-risky.indexOf(y);
        var ex=(v[y]-net*w[y])-(v[x]-net*w[x]);if(Math.abs(ex)>1)return ex;
        return ['tk','tp'].concat(risky).indexOf(x)-['tk','tp'].concat(risky).indexOf(y);
      });
      expenseOrder.forEach(function(k){if(need>1e-7)fundFrom(k,need);});
    }
    // Emergency sales liquidate whole properties that allow it ("Có thể bán"), smallest market
    // value first. A future negotiated sale price is never brought forward to an earlier month.
    if(need>1e-7){
      plots.filter(function(p){return !p.sold&&p.sellable&&mi>=p.own&&p.baseNom>0;}).sort(function(a,b){return a.baseNom*a.idx-b.baseNom*b.idx;}).forEach(function(p){
        if(need<=1e-7)return;
        var proceeds=p.baseNom*p.idx,used=Math.min(proceeds,need);
        p.sold=true;sales+=proceeds;need-=used;ordinary+=proceeds-used;record('land',used);
      });
    }
    var shortage=need>1e-6?need:0;
    if(shortage){shortfall+=shortage;if(firstShort<0)firstShort=m;}
    // Pool all remaining inflows once; the investment stage governs the whole portfolio.
    // Allocate only after all current-month expenses have been funded.
    var totalIn=ordinary; /* Đợt 14: mọi nguồn thu hợp một dòng duy nhất, chia theo chiến lược đang chạy */
    var topup=0,goldLeft=0,bought={mmf:0,tk:0,tp:0,cp:0,gold:0};
    var cashBefore=a.mmf;
    a.mmf+=totalIn;addMmfLot('mmf',totalIn,'inflow',mi);
    var reserve=investmentReserve(forecast,mi,stage.reserveMonths);
    topup=Math.min(totalIn,Math.max(0,reserve-cashBefore));
    bought.mmf=totalIn-topup;
    var priorSales=trades.length;
    var futureBills=forecast.slice(mi+1,mi+13).reduce(function(s,r){return s+Math.max(0,r.eventOut-r.eventIn);},0);
    var maturities=savings.lots.filter(function(l){return l.age>0&&l.age<l.term;}).map(function(l){return l.term-l.age;})
      .concat(tp.lots.filter(function(l){return l.age<tp.minAge;}).map(function(l){return tp.minAge-l.age;}));
    var waitMaturity=maturities.length?Math.min.apply(null,maturities):0;
    var bridgeNeed=waitMaturity?savingsDeficits(forecast,mi+1,plots).slice(0,waitMaturity).reduce(function(s,v){return s+v;},0):Infinity;
    var deferRefill=waitMaturity>0&&a.mmf+1>=bridgeNeed;
    strategy=executeInvestment(stage,m,{values:values,reserve:reserve,futureBills:futureBills,
      newCash:totalIn,first:mi===0,lastTrade:lastTrade,deferRefill:deferRefill,
      priorSold:trades.filter(function(t){return t.side==='sell';}).map(function(t){return t.asset;}),
      previewSale:saleQuote,freeSaleValue:function(k){
        if(k==='tk')return savings.lots.reduce(function(s,l){return s+(l.age===0?l.principal:0);},0);
        if(k==='tp')return tp.lots.reduce(function(s,l){return s+(l.age>=tp.minAge?l.principal:0);},0);
        return values()[k];
      },goldAsk:ask,goldBid:goldBid(ask),
      sellValue:function(k,excess,reason){return sellToCash(k,cashForAssetValue(k,excess),reason);},
      minimum:investmentReserve(forecast,mi,stage.minMonths),
      refill:investmentReserve(forecast,mi,stage.refillMonths),
      // history[0] is BEFORE month 0, history[mi+1] is after the current month.
      // Exactly 12 observed returns: history[mi+1] / history[mi+1-12].
      changed:previousStage!==stage.id,trailingReturn:mi>=11?cpIdx/cpHistory[mi-11]-1:null,riskyOrder:risky,
      sell:sellToCash,buy:function(k,amount,reason){
        amount=Math.min(amount,Math.max(0,a.mmf-reserve));if(amount<=1e-7)return;
        var used=amount,cost=0;
        if(k==='tk')savings.deposit(amount);
        else if(k==='tp')tp.deposit(amount);
        else if(k==='gold'){var g=goldBuy(amount,ask);chi+=g.chi;used=g.chi*ask;goldLeft+=g.leftover;cost=g.chi*(ask-goldBid(ask));goldCost+=cost;}
        else if(k==='cp'){cost=amount*(state.rates.cpBuyFee||0)/100;cpFee+=cost;a.cp+=amount-cost;}
        else a[k]+=amount;
        a.mmf-=used;takeMmfLots(used,true);bought[k]+=used;
        if(used>1e-7)trades.push({side:'buy',asset:k,amount:used,reason:reason,cost:cost});
      }});
    if(state.lifePlan){var currentRow=lifeRows(state.lifePlan).filter(function(r){return r.from<=m;}).pop();if(currentRow)strategy.label=currentRow.label;}
    strategy.netCashflow=external-required;strategy.trades=trades;
    trades.forEach(function(t){lastTrade[t.asset]={side:t.side,month:m};});
    bought.mmf=Math.min(Math.max(0,totalIn-topup),Math.max(0,a.mmf-reserve));
    strategy.cpDrawdown=cpIdx/cpPeak-1;
    trades.slice(priorSales).forEach(function(t){if(t.side==='sell')strategyStats.proactiveSales+=t.amount;});
    if(strategy.reserveShort>1)strategyStats.reserveShortMonths++;
    previousStage=stage.id;
    /* Chỉ khoản bán trong chiến lược còn lại sau các lệnh mua mới là nạp ròng MMF.
       Nạp ròng không tính là chi; màu nguồn xuất hiện khi khoản đó được rút sau này. */
    mmfLots.forEach(function(lot){if(lot.kind==='strategy'&&lot.mi===mi)refillBySrc[lot.src]=(refillBySrc[lot.src]||0)+lot.amount;});
    var eff={};Object.keys(drawn).forEach(function(k){if(k!=='mmf')eff[k]=drawn[k];});
    Object.keys(mmfSpentBySrc).forEach(function(k){eff[k]=(eff[k]||0)+mmfSpentBySrc[k];});
    Object.keys(eff).forEach(function(k){ya.effDrawn[k]=(ya.effDrawn[k]||0)+eff[k];});
    var lotBalance=mmfLots.reduce(function(s,lot){return s+lot.amount;},0);
    if(Math.abs(lotBalance-a.mmf)>Math.max(.01,a.mmf*1e-10))throw new Error('Đối chiếu số dư MMF không khớp tại '+ymToStr(m)+'.');
    planSavings(savings,savingsDeficits(forecast,mi+1,plots),a.mmf);
    var ending=total(),expected=before+marketPnL+salesPnL+external-(required-shortage)-goldCost-tkLost-tpFee-cpFee;
    var ledgerError=ending-expected;
    if(!isFinite(ending)||!isFinite(expected)||Math.abs(ledgerError)>Math.max(.01,Math.abs(ending)*1e-10))throw new Error('Đối chiếu NAV không khớp tại '+ymToStr(m)+'.');
    var snap={mi:mi,year:year,month:m%12+1,age:year-state.birthYear,mmf:a.mmf,tk:savings.value(),tkPrincipal:savings.principal(),tkAccrued:savings.value()-savings.principal(),tp:tp.value(),cp:a.cp,gold:chi*goldBid(ask),chi:chi,goldAsk:ask,goldBid:goldBid(ask),land:landValue(),area:plots.reduce(function(v,p){return v+(p.sold||mi<p.own?0:p.area);},0),total:ending,liquid:a.mmf+savings.principal()+tp.value()+a.cp+chi*goldBid(ask),real:ending/Math.pow(1+state.infl/100,(mi+1)/12),short:shortage,drawn:drawn,expense:expense,
      /* F15/U02 — phân tách dòng thu và lệnh đầu tư của tháng để dán nhãn nguồn chi và đối chiếu */
      salary:salary,rent:rent,pension:pension,eventIn:eventIn,eventOut:eventOut,plotExp:plotExp,phaseFrom:state.lifePlan?(currentRow?Math.floor(currentRow.from/12):null):(phase?phase.fromY:null),
      topup:topup,bought:bought,goldLeft:goldLeft,refillBySrc:refillBySrc,mmfSpentBySrc:mmfSpentBySrc,effDrawn:eff,
      ledger:{opening:before,marketPnL:marketPnL,salePnL:salesPnL,externalIn:external,propertyProceeds:sales,plannedOut:required,fundedOut:required-shortage,goldSpreadCost:goldCost,savingsForfeited:tkLost,tpFee:tpFee,cpFee:cpFee,closing:ending,error:ledgerError}};
    snap.strategy=strategy; /* Đợt 14: chiến lược luôn chạy — mỗi tháng đều có nhãn giai đoạn */
    if(!opt.compact)months.push(snap);
    ya.end=snap;ya.real=snap.real;ya.months++;ya.inc+=salary+rent;ya.pen+=pension;ya.exp+=expense;ya.evIn+=eventIn;ya.evOut+=eventOut;ya.landSold+=sales;ya.short+=shortage;ya.tkLost+=tkLost;
    pensionGot+=pension;evIn+=eventIn;evOut+=eventOut;landSold+=sales;
  }
  /* F15/R10 — nhãn "nguồn chi" theo dòng tiền thật: tháng không rút tài sản thì nguồn chính là
     DÒNG THU LỚN NHẤT trong tháng đó (hưu/lương+thuê/bán BĐS/thu sự kiện), không ưu tiên theo sự hiện diện.
     Đợt 36: tính trên effDrawn — rút MMF đã được gán về tài sản bán nạp MMF (nguồn gián tiếp). */
  var names={mmf:'Quỹ MMF',tk:'Tiết kiệm',tp:'Quỹ Trái phiếu',cp:'Quỹ Cổ phiếu/ETF',gold:'Vàng',land:'BĐS'};
  years.forEach(function(y){
    var keys=Object.keys(y.effDrawn).sort(function(a,b){return y.effDrawn[b]-y.effDrawn[a];});
    if(y.short){y.src='KHÔNG ĐỦ';return;}
    if(keys.length){y.src=names[keys[0]];return;}
    var flows=[['Lương hưu',y.pen],['Thu nhập',y.inc],['BĐS',y.landSold],['Thu sự kiện',y.evIn]].sort(function(a,b){return b[1]-a[1];});
    y.src=flows[0][1]>0?flows[0][0]:'Tích lũy';
  });
  var result={years:years,months:months,shortfall:shortfall,firstShort:firstShort,pensionGot:pensionGot,evIn:evIn,evOut:evOut,landSold:landSold,initial:initial,retireIdx:summary.retireIdx,bhxh:summary,bhtnGot:0,lumpGot:0,doLump:false,savingsForfeited:savings.forfeited,tpRedemptionFees:tp.fees};
  result.strategyStats=strategyStats;return result;
}
/* ===== Đường so sánh "Nếu 100% tài khoản là tiết kiệm" (Tab 7) =====
   Kịch bản đối chiếu: toàn bộ tài sản ban đầu (NAV tháng gốc — MMF + tiết kiệm + trái phiếu + cổ phiếu
   + vàng theo giá bán lại + BĐS theo giá trị ban đầu) vào SavingsBook giống danh mục:
   chia sổ đáo hạn theo chi thiếu 12 tháng tới, còn lại gửi 12 tháng. Lãi nhập gốc
   khi đáo hạn, rút trước hạn mất lãi kỳ này của phần rút.
   Mỗi tháng cộng dòng tiền đời sống LẤY TỪ LẦN CHẠY engine (snap): lương +
   hưu + thu sự kiện − chi thường xuyên − chi sự kiện. Không còn BĐS nên KHÔNG có tiền thuê và không
   có các đợt bán BĐS (kể cả bán có lịch); thiếu chi rút hết tài khoản vẫn thiếu → NAV chạm 0 và ghi
   thiếu chi (không tạo NAV âm — cùng quy tắc với engine). Lãi sinh TRƯỚC, dòng tiền vào CUỐI tháng —
   đúng nhịp tài sản/dòng tiền của runSim. THUẦN: chỉ đọc sim + state, trả {nav[], shortfall,
   firstShort, rate, seed}; không ghi state, không đụng runSim (vân tay golden giữ nguyên). */
function savingsOnlyNav(sim){
  var ms=(sim&&sim.months)||[],savings=new SavingsBook(sim?sim.initial:0,state.rates.tk,12);
  var nav=[],shortfall=0,firstShort=-1;
  var forecast=ms.map(function(m){return {salary:m.salary||0,pension:m.pension||0,eventIn:m.eventIn||0,expense:m.expense||0,eventOut:m.eventOut||0};});
  planSavings(savings,savingsDeficits(forecast,0,[]),0);
  ms.forEach(function(m,i){
    savings.tick();
    var flow=(m.salary||0)+(m.pension||0)+(m.eventIn||0)-(m.expense||0)-(m.eventOut||0);
    if(flow<0){
      var need=-flow,withdrawal=savings.withdraw(need);
      var lack=need-withdrawal.got;
      if(lack>1e-6){shortfall+=lack;if(firstShort<0)firstShort=NOW+(m.mi||0);}
    }else savings.deposit(flow);
    planSavings(savings,savingsDeficits(forecast,i+1,[]),0);
    nav.push(savings.value());
  });
  return {nav:nav,shortfall:shortfall,firstShort:firstShort,rate:state.rates.tk,seed:sim?sim.initial:0,savingsForfeited:savings.forfeited};
}
function validateState(plan){
  plan=plan===undefined?effectiveInvestmentPlan():plan;
  var out=[],end=NOW+state.simYears*12-1;
  /* R06 — refOnly=true: lỗi của dữ liệu THAM KHẢO (giai đoạn đóng BHXH, chỉ dùng cho Generate/tổng hợp
     tham khảo) — không chặn mô phỏng/kiểm tra rủi ro đang chạy bằng lương hưu nhập tay. */
  function add(level,tab,msg,refOnly){out.push({level:level,tab:tab,msg:msg,refOnly:!!refOnly});}
  function number(v,label,tab,min,max,integer){if(!finiteNumber(v)||v<min||v>max||(integer&&!Number.isInteger(v)))add('error',tab,label+' không hợp lệ'+(integer?' (cần số nguyên)':'')+'.');}
  if(state.schemaVersion>=7&&!state.lifePlan)add('error','t5','Thiếu kế hoạch thu nhập và phân bổ; hãy phục hồi hồ sơ hợp lệ.');
  number(state.startMonth,'Tháng bắt đầu','t1',1900*12,2200*12,true);
  number(state.birthYear,'Năm sinh','t1',1900,Math.floor(NOW/12),true);
  number(state.simYears,'Số năm mô phỏng','t1',1,100,true);
  number(state.infl,'Lạm phát','t4',-20,100,false);
  number(state.rates.mmf,'Lãi MMF','t6',0,100,false);number(state.rates.tk,'Lãi tiết kiệm','t6',0,100,false);number(state.rates.tp,'Lãi quỹ trái phiếu','t6',0,100,false);
  if(state.rates.tkShort!==undefined)number(state.rates.tkShort,'Lãi tiết kiệm 1–5 tháng','t6',0,100,false);
  if(state.rates.tkMedium!==undefined)number(state.rates.tkMedium,'Lãi tiết kiệm 6–11 tháng','t6',0,100,false);
  if(state.rates.cpBuyFee!==undefined)number(state.rates.cpBuyFee,'Phí mua quỹ cổ phiếu/ETF','t6',0,10,false);
  if(state.rates.cpSellFee!==undefined)number(state.rates.cpSellFee,'Phí bán quỹ cổ phiếu/ETF','t6',0,10,false);
  if(state.rates.tpEarlyFee!==undefined)number(state.rates.tpEarlyFee,'Phí rút quỹ trái phiếu trước hạn','t6',0,10,false);
  if(state.rates.tpMinMonths!==undefined)number(state.rates.tpMinMonths,'Số tháng giữ quỹ trái phiếu để miễn phí rút','t6',1,120,true);
  Object.keys(state.assets).forEach(function(k){number(state.assets[k],'Tài sản '+k,'t2',0,1e16,false);});
  number(state.goldChi,'Số chỉ vàng','t2',0,1e9,true);number(state.goldPrice,'Giá mua vàng','t2',1,1e15,false);number(state.goldSpread,'Chênh lệch giá vàng','t6',0,99,false);
  SERIES_KEYS.forEach(function(k){var meta=state.seriesMeta[k];number(meta.cagr,'CAGR '+k,'t6',-.65,.8,false);number(meta.sigma,'Độ biến động '+k,'t6',0,.8,false);if(state.series[k].some(function(r){return !finiteNumber(r)||r<=-1;}))add('error','t6','Chuỗi '+k+' có lợi suất tháng không hợp lệ.');});
  var ips=state.incomePeriods.slice().sort(function(a,b){return a.fromY-b.fromY;}),previousEnd=-Infinity;
  if(!state.lifePlan)ips.forEach(function(p){
    number(p.fromY,'Năm đầu pha','t5',1900,2200,true);if(p.toY!==null)number(p.toY,'Năm cuối pha','t5',p.fromY,2200,true);
    var last=p.toY===null?Math.floor(retireAgeMonths(state.birthYear,state.gender)/12):p.toY;
    if(p.fromY<=previousEnd)add('error','t5','Các pha thu nhập chồng nhau; hãy tách khoảng thời gian.');previousEnd=Math.max(previousEnd,last);
    number(p.amount,'Thu nhập tháng','t5',0,1e15,false);number(p.growth,'Tăng thu nhập','t5',-99,100,false);
    /* F12 — pha rỗng (mốc nghỉ hưu quy ước đã qua) hoặc nằm ngoài kỳ mô phỏng */
    var effEnd=p.toY===null?retireAgeMonths(state.birthYear,state.gender):p.toY*12+11;
    if(effEnd<p.fromY*12)add('warn','t5','Pha từ năm '+p.fromY+' không phát sinh tháng nào — mốc nghỉ hưu quy ước đã qua trước năm bắt đầu pha.');
    else if(effEnd<NOW)add('warn','t5','Pha từ năm '+p.fromY+' nằm trước kỳ mô phỏng, không phát sinh thu nhập.');
    else if(p.fromY*12>end)add('warn','t5','Pha từ năm '+p.fromY+' nằm sau kỳ mô phỏng, chưa chạy.');
  });
  if(!state.milestones.some(function(ms){return ms.y===0;}))add('error','t4','Cần một mốc chi tiêu năm thứ 0 (mức chi hiện tại).');
  var seen={};state.milestones.forEach(function(ms){number(ms.y,'Năm mốc chi','t4',0,100,true);number(ms.monthly,'Mức chi tháng','t4',0,1e15,false);if(seen[ms.y])add('error','t4','Mốc chi tiêu trùng năm '+ms.y+'.');seen[ms.y]=true;if(ms.y>=state.simYears)add('warn','t4','Mốc chi năm '+ms.y+' nằm ngoài kỳ, được giữ cho kỳ dài hơn.');});
  /* Chi phí cố định (không theo lạm phát): mỗi mốc là TỔNG mức đang áp dụng, thay thế mốc trước.
     Không bắt buộc mốc năm 0 — trước mốc đầu tiên phần cố định bằng 0; mảng rỗng hợp lệ. */
  var seenFixed={};(state.fixedMilestones||[]).forEach(function(ms){
    number(ms.y,'Năm chi cố định','t4',0,100,true);number(ms.monthly,'Mức chi cố định tháng','t4',0,1e15,false);
    if(seenFixed[ms.y])add('error','t4','Chi phí cố định trùng năm '+ms.y+' — mỗi mốc là tổng mức đang áp dụng, hãy gộp các khoản cùng thời kỳ vào một mốc (vd trả góp 20tr + bảo hiểm 3tr → nhập 23tr).');
    seenFixed[ms.y]=true;
    if(ms.y>=state.simYears)add('warn','t4','Chi phí cố định năm '+ms.y+' nằm ngoài kỳ, được giữ cho kỳ dài hơn.');
  });
  state.events.forEach(function(e){number(e.y,'Năm thứ của sự kiện','t4',0,100,true);number(e.amount,'Số tiền sự kiện','t4',0,1e16,false);if(e.kind!=='thu'&&e.kind!=='chi')add('error','t4','Loại sự kiện không hợp lệ.');if(e.y>=state.simYears)add('warn','t4','Sự kiện '+e.label+' nằm ngoài kỳ, chưa thực hiện.');});
  var ids={};state.landPlots.forEach(function(p){
    number(p.area,'Diện tích BĐS','t2',0,1e10,false);number(plotValue(p),'Giá trị BĐS','t2',0,1e17,false);
    if(!p.id||ids[p.id])add('error','t2','Mỗi BĐS cần một mã riêng.');ids[p.id]=true;
    var own=p.ownYear==null||p.ownYear===''?null:p.ownYear;
    if(own!==null){
      number(own,'Năm sở hữu BĐS','t2',1900,2200,true);
      if(own*12>end)add('warn','t2','BĐS '+p.label+': năm sở hữu nằm sau kỳ mô phỏng — BĐS chưa bao giờ có mặt trong kết quả.');
      if(p.saleYear!==null&&p.saleYear!==undefined&&p.saleYear<own)add('error','t2','BĐS '+p.label+': năm bán trước năm sở hữu.');
    }
    if(p.saleYear!==null&&p.saleYear!==undefined){number(p.saleYear,'Năm bán BĐS','t2',Math.floor(NOW/12),2200,true);if(p.saleYear*12+11>end)add('warn','t2','BĐS '+p.label+': năm bán ở sau kỳ mô phỏng.');}
    if(p.salePrice!==null&&p.salePrice!==undefined)number(p.salePrice,'Giá bán BĐS','t2',0,1e17,false);
    if(p.rent){
      number(p.rentGrowth||0,'Tăng tiền thuê','t2',-99,100,false);number(p.rentVnd||0,'Tiền thuê BĐS','t2',0,1e15,false);
      if(p.rentFromYear!=null&&p.rentFromYear!=='')number(p.rentFromYear,'Thuê từ năm','t2',1900,2200,true);
    }
    (p.expenses||[]).forEach(function(x){
      number(x.y,'Năm chi phí BĐS','t2',1900,2200,true);number(x.amount,'Số tiền chi phí BĐS','t2',0,1e17,false);
      if(own!==null&&x.y<own)add('error','t2','BĐS '+p.label+': chi phí năm '+x.y+' trước năm sở hữu.');
      if(x.y*12+11>end)add('warn','t2','BĐS '+p.label+': chi phí năm '+x.y+' nằm sau kỳ mô phỏng, chưa thực hiện.');
    });
  });
  if(state.pensionMode==='simple'){var ps=state.pensionSimple;number(ps.amount,'Lương hưu','t3',0,1e15,false);number(ps.startYear,'Năm hưởng hưu','t3',1900,2200,true);number(ps.startMonth===undefined?1:ps.startMonth,'Tháng hưởng hưu','t3',1,12,true);number(ps.growth,'Tăng lương hưu','t3',-99,100,false);}
  /* Bàn giao CPI mục 7.2 + review F05 (11/09): bản lưu cũ chưa xác nhận nghĩa của mức hưu
     (amountBasis 'unknown') không được đưa vào mô phỏng theo giả định — chặn tới khi người dùng
     chọn nghĩa ở Tab 3. Lỗi KHÔNG refOnly: đây là đầu vào hưu đang dùng, không phải dữ liệu tham khảo. */
  if(state.pensionMode==='simple'&&state.pensionSimple.amount>0&&state.pensionSimple.amountBasis==='unknown')
    add('error','t3','Mức hưu bản lưu cũ chưa xác nhận nghĩa (giá hiện tại hay giá tại tháng hưởng) — chọn một trong hai ở khung "Lương hưu — nhập trực tiếp" (Tab 3) trước khi mô phỏng.');
  /* M1 — thành viên gia đình thêm (state.extraPeople): hồ sơ hưu nhập tay cùng quy tắc người chính;
     tên người đứng trong ngoặc để phân biệt lỗi của từng người. */
  (state.extraPeople||[]).forEach(function(p0,pi){
    var nm=String(p0.name==null?'':p0.name).replace(/^\s+|\s+$/g,'');
    var lb=nm||('Người '+(pi+2));
    number(p0.birthYear,'Năm sinh ('+lb+')','t3',1900,Math.floor(NOW/12),true);
    if(p0.gender!=='male'&&p0.gender!=='female')add('error','t3','Giới tính của '+lb+' không hợp lệ (nam/nữ).');
    var q=p0.pension||{};
    number(q.amount,'Lương hưu ('+lb+')','t3',0,1e15,false);number(q.startYear,'Năm hưởng hưu ('+lb+')','t3',1900,2200,true);number(q.startMonth===undefined?1:q.startMonth,'Tháng hưởng hưu ('+lb+')','t3',1,12,true);number(q.growth,'Tăng lương hưu ('+lb+')','t3',-99,100,false);
    if(state.pensionMode==='simple'&&q.amount>0&&q.amountBasis==='unknown')
      add('error','t3',lb+': Mức hưu bản lưu cũ chưa xác nhận nghĩa (giá hiện tại hay giá tại tháng hưởng) — chọn một trong hai ở khung "Lương hưu — nhập trực tiếp" (Tab 3) trước khi mô phỏng.');
  });
  /* F04 — giai đoạn đóng BHXH: kiểm tra riêng trước summary/Generate; lỗi chỉ rõ dòng gây ra.
     refOnly: toàn bộ nhóm này là dữ liệu tham khảo — sai chỉ khóa Generate/tổng hợp tham khảo (R06).
     M1: kiểm theo TỪNG người (người chính giữ thông điệp cũ; người thêm có tiền tố [Tên]). */
  out=out.concat(validatePensionPeriods(state.periods,state.birthYear,state.gender,''));
  (state.extraPeople||[]).forEach(function(p0,pi){
    var nm=String(p0.name==null?'':p0.name).replace(/^\s+|\s+$/g,'');
    out=out.concat(validatePensionPeriods(Array.isArray(p0.periods)?p0.periods:[],p0.birthYear,p0.gender,'['+(nm||('Người '+(pi+2)))+']'));
  });
  return out.concat(state.lifePlan?validateLifePlan(state.lifePlan,NOW):[],validateInvestmentPlan(plan));
}
/* Lỗi chặn mô phỏng: loại trừ lỗi refOnly (dữ liệu tham khảo BHXH) — R06 */
function validateErrors(){return validateState().filter(function(v){return v.level==='error'&&!v.refOnly;});}
