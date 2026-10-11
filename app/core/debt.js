'use strict';
/* Khoản vay trả góp đều: dư nợ gốc hiện tại hoặc giải ngân trong tương lai.
   Lãi cố định theo từng khoản; khi hết introMonths, lãi thả nổi lấy từ kịch bản
   chung Tab 6 và tính lại khoản trả theo số tháng còn lại. */
function debtStartMi(d){return d.startMonth==null?0:d.startMonth-NOW;}
function debtPayment(balance,annualRate,monthsLeft){
  if(balance<=0||monthsLeft<=0)return Math.max(0,balance);
  var r=annualRate/1200;
  return r===0?balance/monthsLeft:balance*r/(1-Math.pow(1+r,-monthsLeft));
}
function debtBook(){
  return (state.debts||[]).map(function(d){return {cfg:d,balance:d.startMonth==null?d.amount:0};});
}
function debtBalance(book){return book.reduce(function(s,b){return s+b.balance;},0);}
function debtDraw(book,mi){
  var drawn=0;
  book.forEach(function(b){if(b.cfg.startMonth!=null&&debtStartMi(b.cfg)===mi){b.balance+=b.cfg.amount;drawn+=b.cfg.amount;}});
  return drawn;
}
/* Mốc lãi ở Tab 6 có hiệu lực từ đầu năm mô phỏng được nhập. */
function debtFloatingRateAt(mi){
  var year=Math.floor(mi/12),rate=8,best=-1;
  (state.debtFloatingRates||[]).forEach(function(row){
    if(row.fromY<=year&&row.fromY>=best){best=row.fromY;rate=row.rate;}
  });
  return rate;
}
/* Kịch bản tham khảo theo từng năm. Biên độ là số điểm phần trăm tối đa quanh
   mức trung tâm; seed giúp kiểm thử tái lập, còn các mức đã sinh được lưu hẳn. */
function generateDebtFloatingRates(years,center,swing,seed){
  var rnd=mulberry32(seed),out=[];
  for(var y=0;y<years;y++){
    var rate=Math.round(Math.max(0,Math.min(100,center+(rnd()*2-1)*swing))*10)/10;
    out.push({fromY:y,rate:rate});
  }
  return out;
}
/* Tiền bán tài sản gắn vay trả nợ trước, tối đa bằng số tiền bán. Nếu bán không
   đủ, phần nợ còn lại vẫn phải trả theo lịch. */
function debtRateAt(d,mi){
  var elapsed=d.startMonth==null?mi:mi-debtStartMi(d)-1;
  return d.rateMode==='fixed-floating'&&elapsed>=d.introMonths
    ?Math.max(0,debtFloatingRateAt(mi)+(d.floatingSpread||0)):d.rate;
}
function debtSettlePlot(book,plotId,proceeds,mi){
  var left=Math.max(0,proceeds),paid=0,interest=0;
  book.forEach(function(b){if(b.cfg.plotId!==plotId||left<=0||b.balance<=0)return;
    /* Bán vào cuối tháng: cộng lãi tháng bán trước khi tất toán. */
    var add=b.balance*debtRateAt(b.cfg,mi)/1200;
    b.balance+=add;b.accruedMi=mi;interest+=add;
    var take=Math.min(left,b.balance);b.balance-=take;left-=take;paid+=take;
  });
  return {paid:paid,interest:interest};
}
function debtDues(book,mi){
  return book.map(function(b){
    var d=b.cfg,start=debtStartMi(d),elapsed=d.startMonth==null?mi:mi-start-1;
    if(b.balance<=1e-7||elapsed<0)return {book:b,interest:0,due:0};
    var rate=debtRateAt(d,mi);
    var interest=b.accruedMi===mi?0:b.balance*rate/1200,monthsLeft=Math.max(1,d.termMonths-elapsed);
    return {book:b,interest:interest,due:Math.min(b.balance+interest,debtPayment(b.balance,rate,monthsLeft))};
  });
}
/* Nếu cả danh mục không đủ chi, trả nợ được ưu tiên. Khoản thiếu không được
   coi là đã trả; lãi chưa trả ở lại dư nợ. */
function debtApplyDues(dues,available){
  var total=dues.reduce(function(s,x){return s+x.due;},0),ratio=total>0?Math.min(1,Math.max(0,available)/total):0;
  var paid=0,interest=0,principal=0;
  dues.forEach(function(x){
    if(!x.due)return;
    var p=x.due*ratio,old=x.book.balance;
    x.book.balance=Math.max(0,old+x.interest-p);
    paid+=p;interest+=x.interest;principal+=old-x.book.balance;
  });
  return {paid:paid,interest:interest,principal:principal};
}
function debtPurchaseAt(mi){
  var cost=0;
  (state.debts||[]).forEach(function(d){
    if(d.startMonth==null||!d.plotId||debtStartMi(d)!==mi)return;
    var p=state.landPlots.find(function(q){return q.id===d.plotId;});
    if(p)cost+=plotValue(p)*Math.pow(1+state.infl/100,mi/12);
  });
  return cost;
}
/* Dự báo dòng tiền đã biết cho MMF/sổ tiết kiệm. Giá bán BĐS tương lai chưa biết
   nên không lấy tiền bán để hứa trước việc trả nợ; sau khi bán thật, engine cập nhật. */
function debtForecast(count){
  var book=debtBook(),rows=[];
  for(var mi=0;mi<count;mi++){
    var draw=debtDraw(book,mi),dues=debtDues(book,mi);
    var payment=dues.reduce(function(s,x){return s+x.due;},0);
    debtApplyDues(dues,payment);
    rows.push({draw:draw,payment:payment,purchase:debtPurchaseAt(mi)});
  }
  return rows;
}
/* Sau một lần bán BĐS hoặc tháng trả thiếu, cập nhật phần dự báo còn lại từ
   dư nợ THỰC trong runSim; các khoản vay tương lai vẫn giải ngân đúng lịch. */
function debtFuturePayments(book,fromMi,count){
  var copy=book.map(function(b){return {cfg:b.cfg,balance:b.balance};}),out=[];
  for(var mi=fromMi;mi<count;mi++){
    debtDraw(copy,mi);
    var dues=debtDues(copy,mi),payment=dues.reduce(function(s,x){return s+x.due;},0);
    debtApplyDues(dues,payment);out.push(payment);
  }
  return out;
}
