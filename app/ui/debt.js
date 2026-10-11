'use strict';
/* Tab 2: cùng một biểu mẫu cho dư nợ hiện tại và khoản giải ngân sau này. */
function debtDateInput(idx){return finiteNumber(idx)?('0'+(idx%12+1)).slice(-2)+'/'+Math.floor(idx/12):'';}
function renderDebts(){
  var list=state.debts||[],h='';
  list.forEach(function(d,i){
    var future=d.startMonth!=null,floating=d.rateMode==='fixed-floating';
    var opts='<option value="">Không gắn BĐS</option>';
    state.landPlots.forEach(function(p){if(future?plotOwnIdx(p)===0:plotOwnIdx(p)>0)return;
      opts+='<option value="'+esc(p.id)+'"'+(d.plotId===p.id?' selected':'')+'>'+esc(p.label||'BĐS '+p.id)+'</option>';});
    var firstMi=future?debtStartMi(d)+1:0;
    var first=debtPayment(d.amount||0,debtRateAt(d,firstMi)||0,d.termMonths||1);
    h+='<div class="debt-card" data-o="'+objToken(d)+'">'+
      '<div class="debt-top"><label>Tên khoản vay<input data-f="label" data-i="'+i+'" value="'+esc(d.label||'')+'" placeholder="Ví dụ: vay mua nhà"></label><button class="del" data-i="'+i+'" aria-label="Xóa khoản vay '+(i+1)+'">✕</button></div>'+
      '<div class="debt-grid">'+
      '<label>Thời điểm<select data-f="timing" data-i="'+i+'"><option value="existing"'+(!future?' selected':'')+'>Dư nợ hiện tại</option><option value="future"'+(future?' selected':'')+'>Vay mới trong tương lai</option></select></label>'+
      (future?'<label>Tháng/năm giải ngân<input data-f="startMonth" data-i="'+i+'" value="'+debtDateInput(d.startMonth)+'" placeholder="mm/yyyy" title="Kỳ trả đầu ở tháng kế tiếp"></label>':'')+
      '<label>'+(future?'Số tiền sẽ vay':'Dư nợ hiện tại')+' (đ)<input class="money" inputmode="numeric" data-f="amount" data-i="'+i+'" value="'+fmtMoney(d.amount||0)+'"></label>'+
      '<label>'+(future?'Thời hạn trả (tháng)':'Số tháng còn trả')+'<input class="num" inputmode="numeric" data-f="termMonths" data-i="'+i+'" value="'+vnNumStr(d.termMonths)+'"></label>'+
      '<label>Cách tính lãi<select data-f="rateMode" data-i="'+i+'"><option value="fixed"'+(!floating?' selected':'')+'>Cố định</option><option value="fixed-floating"'+(floating?' selected':'')+'>Cố định → Thả nổi</option></select></label>'+
      (!floating||d.introMonths>0?'<label>Lãi suất cố định (%/năm)<input class="num" inputmode="decimal" data-f="rate" data-i="'+i+'" value="'+vnNumStr(d.rate)+'"></label>':'')+
      (floating?'<label>Số tháng lãi cố định ban đầu<input class="num" inputmode="numeric" data-f="introMonths" data-i="'+i+'" value="'+vnNumStr(d.introMonths)+'" title="0 = thả nổi ngay từ kỳ trả đầu"></label>':'')+
      (floating&&d.floatingSpread?'<label>Chênh lệch với Tab 6 (điểm %)<input class="num" inputmode="decimal" data-f="floatingSpread" data-i="'+i+'" value="'+vnNumStr(d.floatingSpread)+'"></label>':'')+
      '<label>Liên kết BĐS (nếu có)<select data-f="plotId" data-i="'+i+'">'+opts+'</select></label></div>'+
      '<div class="hint">Trả tháng đầu khoảng <b>'+fmtTr(first)+'</b> (gốc + lãi).'+
      (floating?' Lãi thả nổi theo các mốc ở Tab 6'+(d.floatingSpread?' (cộng chênh lệch riêng).':'.'):'')+
      (d.plotId&&future?' Liên kết để ghi đủ tiền mua BĐS khi nhận và tất toán vay từ tiền bán.':d.plotId?' Nếu bán BĐS này, tiền bán sẽ trả dư nợ trước.':'')+'</div></div>';
  });
  refreshList('debtList',h||'<div class="hint">Chưa có khoản vay.</div>',function(box){
    box.querySelectorAll('input,select').forEach(function(el){
      var d=list[+el.dataset.i],f=el.dataset.f;
      el.onchange=function(){
        if(state.debts.indexOf(d)<0)return;
        if(f==='label')d[f]=el.value;
        else if(f==='timing'){
          d.startMonth=el.value==='future'?NOW+12:null;
          var bound=state.landPlots.find(function(x){return x.id===d.plotId;});
          if(bound){if(d.startMonth!=null&&plotOwnIdx(bound)>0)d.startMonth=bound.ownYear*12;
            else if((d.startMonth==null&&plotOwnIdx(bound)>0)||(d.startMonth!=null&&plotOwnIdx(bound)===0))d.plotId=null;}
        }
        else if(f==='startMonth')d.startMonth=parseYM(el.value);
        else if(f==='amount')d.amount=moneyVal(el);
        else if(f==='termMonths'||f==='introMonths')d[f]=numVal(el);
        else if(f==='rate'||f==='floatingSpread')d[f]=numVal(el);
        else if(f==='rateMode'){d.rateMode=el.value;d.introMonths=el.value==='fixed-floating'?Math.min(12,Math.max(0,d.termMonths-1)):0;}
        else if(f==='plotId'){
          d.plotId=el.value||null;
          var p=state.landPlots.find(function(x){return x.id===d.plotId;});
          if(p&&p.ownYear!=null&&p.ownYear*12>NOW)d.startMonth=p.ownYear*12;
        }
        scheduleRefresh();
      };
    });
    box.querySelectorAll('.del').forEach(function(b){
      var d=list[+b.dataset.i];bindDel(b,function(){
        blurActiveIn(box);
        appDialog({title:'Xóa khoản vay?',html:'Xóa <b>'+esc(d.label||'khoản vay')+'</b> khỏi mô phỏng.'+(d.plotId&&d.startMonth!=null?' BĐS tương lai gắn với khoản vay sẽ trở lại cách tính “được cho/tặng”; hãy kiểm tra BĐS đó.':''),okText:'Xóa khoản vay',cancelText:'Giữ lại'}).then(function(ok){if(ok){var j=state.debts.indexOf(d);if(j>=0){state.debts.splice(j,1);refresh();}}});
      });
    });
  });
  var balance=list.reduce(function(s,d){return s+(d.startMonth==null&&finiteNumber(d.amount)?d.amount:0);},0);
  var land=state.landPlots.reduce(function(s,p){return s+(plotOwnIdx(p)===0?plotValue(p):0);},0);
  var gross=state.assets.mmf+state.assets.tk+state.assets.tp+state.assets.cp+state.goldChi*goldBid(state.goldPrice)+land;
  $('debtTotal').innerHTML='Dư nợ hiện tại: <b>'+fmtTr(balance)+'</b> · Tài sản ròng hiện tại: <b>'+fmtTr(gross-balance)+'</b>';
  renderDebtSchedule();
}
function renderDebtSchedule(){
  var list=state.debts||[];$('debtScheduleCard').hidden=!list.length;
  var h='';
  list.forEach(function(d){
    if(!finiteNumber(d.amount)||!finiteNumber(d.termMonths)||d.termMonths<1||!finiteNumber(d.rate))return;
    var first=d.startMonth==null?NOW:d.startMonth+1,end=first+d.termMonths-1;
    var due=debtPayment(d.amount,debtRateAt(d,first-NOW),d.termMonths),change='';
    if(d.rateMode==='fixed-floating')change=d.introMonths>0
      ?' · thả nổi từ '+ymToStr(first+d.introMonths)+' theo Tab 6'
      :' · thả nổi từ kỳ đầu theo Tab 6';
    h+='<div class="hint" style="margin:6px 0;"><b>'+esc(d.label||'Khoản vay')+'</b>: '+ymToStr(first)+'–'+ymToStr(end)+' · khoảng '+fmtTr(due)+'/tháng'+change+'</div>';
  });
  $('debtSchedule').innerHTML=h||'<div class="hint">Kiểm tra dữ liệu khoản vay ở Tab 2.</div>';
}
$('addDebt').onclick=function(){
  state.debts.push({id:'debt-'+Date.now()+'-'+Math.random().toString(36).slice(2),label:'Khoản vay '+(state.debts.length+1),startMonth:null,amount:100000000,termMonths:60,rateMode:'fixed',rate:8,introMonths:0,floatingSpread:0,plotId:null});
  refresh();
};
