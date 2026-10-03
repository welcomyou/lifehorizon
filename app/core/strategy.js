'use strict';
/* [core/strategy.js] Investment stages and cash planning. Reads state/NOW; never mutates either.
   Execution uses a portfolio adapter supplied by runSim. No future market prices are read.
   MMF reserve is inside financial NAV; weights apply only to assets outside that reserve.
   Đợt 14 — cách phân bổ cũ (legacy) đã bị XÓA: mọi hồ sơ chạy đúng một chiến lược theo giai đoạn. */
var INVESTMENT_KEYS=['tk','tp','cp','gold'];
var INVESTMENT_NAMES={target:'Giữ tỷ trọng mục tiêu',bucket:'Dự phòng theo số tháng chi',glide:'Đổi tỷ trọng dần'};
var STRATEGY_VERSION=1;
var STRATEGY_ENGINE_VERSION=11; // v11: giao dịch cân bằng xét chi phí, tránh vòng bán/mua và giữ tiền cho chi đã biết.
// v7 lifePlan is the editable source. Older structures remain only for import compatibility.
// v3 (đợt 63) — income.growth là TỐC ĐỘ TĂNG DANH NGHĨA TỔNG từ tháng gốc: mặc định bằng lạm phát,
// 0 = đứng nguyên số nhập mọi năm (thu theo giá quy định). v2 cũ: growth là tăng thật SAU lạm phát
// ngầm tới mốc — người dùng không thấy lạm phát nằm ở đâu nên nhập 0 vẫn thấy số tăng.
function newLifePlan(start){return {version:3,reviewMonths:12,reserveBasis:'expenses',rows:[
  {id:'life-'+start,from:start,label:'Phân bổ tài sản lần đầu',income:null,
    allocation:{reserveMonths:12,weights:{tk:20,tp:20,cp:60,gold:0}}}]};}
function lifeRows(plan){return plan&&Array.isArray(plan.rows)?plan.rows.filter(function(r){return r&&typeof r==='object';}).slice().sort(function(a,b){return a.from-b.from;}):[];}
function lifeValueAt(plan,m,key){var found=null;lifeRows(plan).forEach(function(r){if(r.from<=m&&r[key]!=null)found=r;});return found;}
/* lifeSalary — mức thực nhận DANH NGHĨA tại tháng m: income.amount (giá hiện tại = giá trị tại
   tháng gốc) nhân đều (1+growth/100) mỗi năm kể từ tháng gốc, bước vào đúng các tháng kỷ niệm.
   "Tăng %/năm" là tốc độ tăng danh nghĩa TỔNG — người dùng thấy đúng số mình nhập; 0 giữ nguyên
   số nhập mọi năm. growth âm được phép (giảm đều). v3 (đợt 63): bỏ hệ số lạm phát ngầm tới mốc. */
function lifeSalary(plan,m){var r=lifeValueAt(plan,m,'income');if(!r)return 0;var v=r.income;
  return v.amount*Math.pow(1+v.growth/100,Math.floor((m-NOW)/12));}
// Move only the edited schedule; income and allocation may share a stored row.
function moveLifeComponent(plan,row,kind,to){
  if(!Number.isInteger(to)||to<NOW||to>NOW+1200)return 'Năm thứ phải là số nguyên từ 0 đến 100.';
  if(to===row.from)return '';
  /* Chỉ phân bổ năm 0 là bắt buộc. Không có mốc thu nhập thì thu nhập bằng 0. */
  if(kind==='allocation'&&lifeValueAt(plan,NOW,kind)===row&&to>NOW)return 'Phân bổ tài sản lần đầu phải ở năm thứ 0 — không dời được.';
  var target=plan.rows.find(function(r){return r!==row&&r.from===to;});
  if(target&&target[kind]!=null)return 'Đã có mốc '+(kind==='income'?'thu nhập':'phân bổ')+' tại năm này.';
  var value=JSON.parse(JSON.stringify(row[kind])),label=row[kind+'Label']||row.label;
  /* v3 — amount là giá hiện tại, không phụ thuộc năm bắt đầu: dời mốc giữ nguyên số nhập. */
  if(kind==='income')value.anchor=to;
  if(!target){target={id:'life-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),from:to,label:label,income:null,allocation:null};plan.rows.push(target);}
  target[kind]=value;target[kind+'Label']=label;row[kind]=null;
  if(!row.income&&!row.allocation)plan.rows.splice(plan.rows.indexOf(row),1);
  return '';
}
// Đợt 22 — đồng bộ mốc phân bổ theo bảng mốc thu nhập (nút ⟳ Tab 5): mốc thu nhập đã có phân bổ
// cùng tháng giữ nguyên; mốc phân bổ không còn mốc thu nhập cùng tháng bị xóa (row chỉ còn
// phân bổ thì xóa hẳn); mốc thu nhập chưa có phân bổ được thêm, thừa hưởng phân bổ kế trước
// (mặc định bucket 12 tháng khi không có gì kế trước). Sau khi hàm chạy xong, mốc phân bổ
// vẫn được sửa/move độc lập — đây là thao tác chạy khi bấm nút, không phải ràng buộc thường trực.
// Trả {added,removed}; kế hoạch không có mốc thu nhập nào thì không đụng (tránh mất hết phân bổ).
function syncLifeAllocations(plan){
  var rows=lifeRows(plan),income=rows.filter(function(r){return r.income!=null;}),added=0,removed=0;
  if(!income.length)return {added:0,removed:0};
  var hasIncome={};income.forEach(function(r){hasIncome[r.from]=true;});
  rows.forEach(function(r){
    if(r.allocation==null||r.from===NOW||hasIncome[r.from])return;
    r.allocation=null;delete r.allocationLabel;
    if(!r.income)plan.rows.splice(plan.rows.indexOf(r),1);
    removed++;
  });
  income.forEach(function(r){
    if(r.allocation!=null)return;
    var prev=lifeValueAt(plan,r.from,'allocation');
    r.allocation=JSON.parse(JSON.stringify(prev?prev.allocation:newLifePlan(NOW).rows[0].allocation));
    added++;
  });
  return {added:added,removed:removed};
}
function salaryAt(m,summary){
  if(state.lifePlan)return lifeSalary(state.lifePlan,m);
  var value=0;state.incomePeriods.forEach(function(p){if(m>=p.fromY*12&&m<=(p.toY===null?summary.retireIdx:p.toY*12+11))value=p.amount*Math.pow(1+p.growth/100,Math.floor(m/12)-p.fromY);});return value;
}
function effectiveInvestmentPlan(){
  if(!state.lifePlan)return state.investmentPlan;
  var lp=state.lifePlan;
  return {version:1,stages:lifeRows(lp).filter(function(r){return r.allocation!=null;}).map(function(r){
    return Object.assign(investmentStage(r.from,r.from===state.startMonth?'Phân bổ tài sản lần đầu':r.allocationLabel||r.label),r.allocation,{id:r.id,method:'target',reviewMonths:lp.reviewMonths,reviewFrom:state.startMonth,unified:true});
  })};
}
function validateLifePlan(lp,start){
  var out=[];function err(s){out.push({level:'error',tab:'t5',msg:s,refOnly:false});}
  if(!lp||(lp.version!==1&&lp.version!==2&&lp.version!==3)){err('Phiên bản kế hoạch thu nhập không được hỗ trợ.');return out;}
  if(!Array.isArray(lp.rows)||!lp.rows.length){err('Cần mốc thu nhập và phân bổ đầu tiên.');return out;}
  var ids={},months={};
  lp.rows.forEach(function(r){
    if(!r||typeof r!=='object'){err('Mốc thu nhập không hợp lệ.');return;}
    if(!r.id||ids[r.id])err('Mã mốc bị thiếu hoặc trùng.');ids[r.id]=true;
    if(!Number.isInteger(r.from)||r.from<1900*12||r.from>2300*12)err('Thời điểm mốc không hợp lệ.');
    if(months[r.from])err('Hai mốc cùng tháng bắt đầu.');months[r.from]=true;
    if(typeof r.label!=='string'||!r.label.trim())err('Cần tên giai đoạn.');
    ['incomeLabel','allocationLabel'].forEach(function(k){if(r[k]!==undefined&&(typeof r[k]!=='string'||!r[k].trim()))err('Cần tên giai đoạn.');});
    if(r.allocation!=null&&(typeof r.allocation!=='object'||Array.isArray(r.allocation)))err('Phân bổ của mốc không hợp lệ.');
    if(r.income!=null){var v=r.income;
      if(!finiteNumber(v.amount)||v.amount<0||v.amount>1e15)err('Thu nhập tháng không hợp lệ.');
      if(!finiteNumber(v.growth)||v.growth<=-100||v.growth>100)err('Tăng thu nhập phải lớn hơn −100% và không vượt 100%.');
      if(!Number.isInteger(v.anchor)||v.anchor>r.from)err('Mốc tăng thu nhập không hợp lệ.');
    }
  });
  if(!lifeValueAt(lp,start,'allocation'))err('Cần phân bổ tài sản lần đầu tại tháng bắt đầu mô phỏng.');
  return out;
}
// Preserve old salary boundaries and January growth anniversaries. Original policies are archived
// by persist before conversion; bucket/glide become explicit allocation milestones under one rule.
function lifePlanFromLegacy(s){
  var lp=newLifePlan(s.startMonth),points={};points[s.startMonth]=true;
  var retirement=retireAgeMonths(s.birthYear,s.gender);
  (s.incomePeriods||[]).forEach(function(p){points[p.fromY*12]=true;points[(p.toY==null?retirement:p.toY*12+11)+1]=true;});
  var stages=(s.investmentPlan&&s.investmentPlan.stages)||[];
  stages.forEach(function(p){points[p.from]=true;if(p.method==='glide')points[p.from+p.transitionMonths]=true;});
  var first=stages.slice().sort(function(a,b){return a.from-b.from;})[0];
  if(first){lp.reviewMonths=first.reviewMonths;}
  lp.rows=[];var prevIncome='',prevAlloc='';
  Object.keys(points).map(Number).sort(function(a,b){return a-b;}).forEach(function(m){
    if(m<s.startMonth)return;
    var ip=null;(s.incomePeriods||[]).forEach(function(p){if(m>=p.fromY*12&&m<=(p.toY==null?retirement:p.toY*12+11))ip=p;});
    /* incomePeriods cũ nhập mức tại fromY, tăng growth %/năm từ tháng 1 của fromY. Đưa vào ngữ
       nghĩa v3: amount = giá trị tại THÁNG GỐC (mũ phân số cho kỳ bắt đầu trước/sau gốc), growth
       giữ nguyên làm tốc độ tổng — bước theo năm kể từ tháng gốc nên các năm tròn khớp cũ. */
    var income=ip?{amount:ip.amount*Math.pow(1+ip.growth/100,(s.startMonth-ip.fromY*12)/12),growth:ip.growth,anchor:s.startMonth}:{amount:0,growth:0,anchor:m};
    var st=investmentStageAt({stages:stages},m),alloc=st?{reserveMonths:st.reserveMonths,weights:Object.assign({},st.method==='glide'&&m>=st.from+st.transitionMonths?st.endWeights:st.weights)}:newLifePlan(m).rows[0].allocation;
    var isig=ip?JSON.stringify(income):'zero',asig=JSON.stringify(alloc);
    lp.rows.push({id:'life-'+m,from:m,label:st&&st.from===m?st.label:ip?'Thu nhập công việc':'Không có thu nhập công việc',income:!lp.rows.length||isig!==prevIncome?income:null,allocation:!lp.rows.length||asig!==prevAlloc?alloc:null});
    prevIncome=isig;prevAlloc=asig;
  });return lp;
}
function investmentStage(from,label){
  return {id:'stage-'+from,label:label||'Giai đoạn đầu tư',from:from,method:'target',reserveMonths:12,
    reviewMonths:12,minMonths:6,refillMonths:12,refillRule:'nonNegative12m',transitionMonths:120,
    weights:{tk:20,tp:20,cp:60,gold:0},endWeights:{tk:30,tp:30,cp:40,gold:0}};
}
function newInvestmentPlan(start){return {version:STRATEGY_VERSION,stages:[investmentStage(start,'Kế hoạch đầu tư')]};}
function investmentStageAt(plan,m){
  var found=null;(plan.stages||[]).forEach(function(p){if(p.from<=m&&(!found||p.from>found.from))found=p;});return found;
}
function investmentWeights(p,m){
  var w={},sum=0,t=p.method==='glide'?Math.max(0,Math.min(1,(m-p.from)/p.transitionMonths)):0;
  INVESTMENT_KEYS.forEach(function(k){w[k]=(p.weights[k]||0)*(1-t)+((p.endWeights||p.weights)[k]||0)*t;sum+=w[k];});
  INVESTMENT_KEYS.forEach(function(k){w[k]=sum?w[k]/sum:0;});return w;
}
function validateInvestmentPlan(plan,start,horizon){
  start=start===undefined?NOW:start;horizon=horizon===undefined?state.simYears:horizon;
  var out=[];
  function err(msg){out.push({level:'error',tab:'t5',msg:msg,refOnly:false});}
  if(!plan||typeof plan!=='object'){err('Thiếu kế hoạch đầu tư — tạo giai đoạn ở Tab 5.');return out;}
  if(plan.version!==STRATEGY_VERSION)err('Phiên bản chiến lược đầu tư không được hỗ trợ.');
  if(!Array.isArray(plan.stages)||!plan.stages.length){err('Cần ít nhất một giai đoạn đầu tư.');return out;}
  var seen={},ids={},earliest=Infinity;
  plan.stages.forEach(function(p,i){
    if(!p||typeof p!=='object'){err('Giai đoạn đầu tư '+(i+1)+' không hợp lệ.');return;}
    var prefix=p.unified?'Phân bổ «'+p.label+'»: ':'Giai đoạn đầu tư '+(i+1)+': ';
    function num(v,name,min,max){if(!Number.isInteger(v)||v<min||v>max)err(prefix+name+' phải là số nguyên từ '+min+' đến '+max+'.');}
    num(p.from,'tháng bắt đầu',1900*12,2300*12);
    if(seen[p.from])err(prefix+'trùng tháng bắt đầu.');seen[p.from]=true;earliest=Math.min(earliest,p.from);
    if(!p.id||ids[p.id])err(prefix+'mã giai đoạn bị thiếu hoặc trùng.');ids[p.id]=true;
    if(typeof p.label!=='string'||!p.label.trim())err(prefix+'cần tên giai đoạn.');
    if(!Object.prototype.hasOwnProperty.call(INVESTMENT_NAMES,p.method))err(prefix+'cách quản lý không hợp lệ.');
    num(p.reserveMonths,'số tháng dự phòng',0,60);
    if([1,3,6,12].indexOf(p.reviewMonths)<0)err(prefix+'kỳ xem xét phải là 1, 3, 6 hoặc 12 tháng.');
    if(p.method==='bucket'){
      num(p.minMonths,'ngưỡng gần cạn',0,60);num(p.refillMonths,'mức bổ sung tối thiểu',0,60);
      if(p.minMonths>=p.refillMonths||p.refillMonths>p.reserveMonths)err(prefix+'cần gần cạn < bổ sung tối thiểu ≤ mục tiêu dự phòng.');
      if(['always','nonNegative12m'].indexOf(p.refillRule)<0)err(prefix+'quy tắc bổ sung không hợp lệ.'); /* nonNegative12m: giữ tên khóa cho tương thích hồ sơ, ngữ nghĩa từ 12/09/2026 là "12 tháng qua CÓ LÃI" (dương), bằng 0 sau khi giảm không nạp */
    }
    if(p.method==='glide')num(p.transitionMonths,'thời gian chuyển tỷ trọng',1,1200);
    function weights(w,name){
      var sum=0;INVESTMENT_KEYS.forEach(function(k){var v=w&&w[k];if(!finiteNumber(v)||v<0||v>100)err(prefix+name+' / '+k+' phải từ 0 đến 100%.');sum+=v||0;});
      if(Math.abs(sum-100)>.001)err(prefix+name+' phải có tổng bằng 100%.');
    }
    weights(p.weights,'tỷ trọng');if(p.method==='glide')weights(p.endWeights,'tỷ trọng cuối');
    if(p.from>=start+horizon*12)out.push({level:'warn',tab:'t5',msg:prefix+'nằm sau kỳ mô phỏng, được giữ cho kỳ dài hơn.',refOnly:false});
  });
  if(earliest>start)err('Giai đoạn đầu tư đầu tiên phải bắt đầu không muộn hơn tháng gốc.');
  return out;
}
/* Known cash flows, priced using inputs only. End-month reserve covers the NEXT N months,
   clipped to the horizon. Each month's deficit is covered independently (future windfalls
   and future property sale proceeds are not assumed to fund the reserve). */
function investmentForecast(withBhxh){
  var n=state.simYears*12,summary=bhxhSummary(),pensioners=[];
  if(withBhxh&&state.pensionMode==='simple'){
    pensioners.push(pensionStartOf(state.pensionSimple));
    (state.extraPeople||[]).forEach(function(p){pensioners.push(pensionStartOf(p.pension));});
  }
  var events={},inflows={},rows=[],ips=state.incomePeriods;
  state.events.forEach(function(e){var map=e.kind==='chi'?events:inflows;map[e.y*12]=(map[e.y*12]||0)+e.amount*Math.pow(1+state.infl/100,e.y);});
  for(var i=0;i<n;i++){
    var m=NOW+i,y=Math.floor(i/12),income=0,pension=0;
    income=salaryAt(m,summary);
    if(withBhxh){
      if(state.pensionMode==='simple')pensioners.forEach(function(p){pension+=pensionMonthly(p.amount,p.start,p.growth,state.infl,NOW,m);});
      else if(summary.eligible&&m>=summary.retStart)pension=summary.pension*Math.pow(1+state.pensionIdx/100,Math.floor((m-summary.retStart)/12));
    }
    rows.push({m:m,salary:income,pension:pension,expense:expensesAtY(y),eventOut:(events[i]||0)+plotExpenseAt(m),eventIn:inflows[i]||0});
  }
  return rows;
}
// Reserve is a stage-specific number of current living-expense months, regardless of income.
function investmentReserve(forecast,mi,n){
  return (forecast[mi]?forecast[mi].expense:0)*n;
}
// Recurring cash-flow regimes are suggestions, not automatic changes to an adopted plan.
function investmentFlowPeriods(){
  var rows=investmentForecast(true),groups=[];
  rows.forEach(function(r,i){
    var rent=0;state.landPlots.forEach(function(p){
      if(!p.rent||(p.saleYear!=null&&r.m>p.saleYear*12+11))return;
      rent+=plotRentAt(p,i);
    });
    var net=r.salary+r.pension+rent-r.expense,type=net>=-1e-6?'surplus':r.pension>0?'pension':'bridge',last=groups[groups.length-1];
    if(!last||last.type!==type){last={from:r.m,to:r.m,type:type,firstNet:net,lastNet:net};groups.push(last);}
    last.to=r.m;last.lastNet=net;
  });return groups;
}
function suggestedInvestmentPlan(){
  return {version:1,mode:'stages',stages:investmentFlowPeriods().map(function(g){
    var p=investmentStage(g.from,g.type==='surplus'?'Tích lũy — thu đủ chi':g.type==='bridge'?'Rút tài sản — chưa có lương hưu':'Rút tài sản — đã có lương hưu');
    if(g.type==='surplus'){p.reserveMonths=6;p.weights={tk:0,tp:20,cp:80,gold:0};}
    else{p.method='bucket';p.reserveMonths=g.type==='bridge'?36:24;}
    return p;
  })};
}
function investmentComparisons(plan){
  if(plan.stages.some(function(p){return p.unified;}))return [{label:'Kế hoạch đang chọn',plan:plan}].concat([6,12,24].map(function(n){var copy=JSON.parse(JSON.stringify(plan));copy.stages.forEach(function(p){p.reserveMonths=n;});return {label:'Cùng tỷ lệ · MMF '+n+' tháng',plan:copy};}));
  return [{label:'Kế hoạch đang chọn',plan:plan}].concat(['target',24,36].map(function(x){
    var copy=JSON.parse(JSON.stringify(plan));
    copy.stages.forEach(function(p){p.method=x==='target'?'target':'bucket';if(x!=='target'){p.reserveMonths=x;p.minMonths=6;p.refillMonths=12;p.refillRule='nonNegative12m';}});
    return {label:x==='target'?'Giữ tỷ trọng mục tiêu':'Dự phòng '+x+' tháng',plan:copy};
  }));
}
function investmentTargets(values,reserve,weights){
  var total=ALLOCATION_KEYS.reduce(function(s,k){return s+values[k];},0),cash=Math.min(total,reserve),out={mmf:cash};
  INVESTMENT_KEYS.forEach(function(k){out[k]=(total-cash)*weights[k];});return out;
}
/* MMF is a minimum reserve, not an amount that must be spent down every month. Review
   trades are planned with whole gold units and redemption costs before any sale. The
   5-point / 25%-of-target band and 0.1%-of-investable minimum are conservative execution
   defaults, not estimates of future returns. New cash may buy underweights between reviews. */
function executeInvestment(p,m,ctx){
  var weights=investmentWeights(p,m),reserve=ctx.reserve,reason='',didReview=ctx.changed||((m-(p.reviewFrom===undefined?p.from:p.reviewFrom))%p.reviewMonths===0);
  var scheduledReview=didReview;
  var buyFloor=reserve+(ctx.futureBills||0); // known large bills in the coming 12 months stay liquid
  var vals=ctx.values(),targets=investmentTargets(vals,reserve,weights);
  var refillTrigger=false,maturityReview=false,maturityWait=false;
  var sold={};
  (ctx.priorSold||[]).forEach(function(k){sold[k]=true;});
  function sell(k,amount,why,valueBased){
    var got=valueBased&&ctx.sellValue?ctx.sellValue(k,amount,why):ctx.sell(k,amount,why);
    if(got>1e-7)sold[k]=true;
    return got;
  }
  function band(k,investable){return investable*Math.min(.05,Math.max(.01,weights[k]*.25));}
  function orderMin(investable){return Math.max(1e6,investable*.001);}
  function reversedRecently(k,side){var last=ctx.lastTrade&&ctx.lastTrade[k];
    return last&&last.side!==side&&m-last.month<12;}
  function reversalAllowed(k,gap,investable){return ctx.changed||gap>investable*.10;}
  function saleRank(k,value){var q=ctx.previewSale(k,value);
    return (q.cash>0?q.cost/q.cash:Infinity)+(k==='gold'?Math.max(0,1-ctx.goldBid/ctx.goldAsk):0);}
  function fundReserve(goal,why){
    var v=ctx.values(),t=investmentTargets(v,goal,weights);
    INVESTMENT_KEYS.slice().sort(function(x,y){
      var gap=Math.max(0,goal-v.mmf);
      var d=saleRank(x,Math.min(v[x],gap))-saleRank(y,Math.min(v[y],gap));
      return Math.abs(d)>1e-9?d:(v[y]-t[y])-(v[x]-t[x]);
    }).forEach(function(k){if(ctx.values().mmf<goal-1e-6)sell(k,goal-ctx.values().mmf,why,false);});
  }
  if(!didReview&&p.method!=='bucket'&&ctx.freeSaleValue('tk')>0){
    var invested=INVESTMENT_KEYS.reduce(function(s,k){return s+vals[k];},0);
    if(vals.tk-targets.tk>band('tk',invested)+1){didReview=true;maturityReview=true;}
  }
  if(p.method==='bucket'){
    var goal=0;
    if(ctx.changed){goal=reserve;reason='Lập dự phòng khi bắt đầu giai đoạn';}
    else if(vals.mmf+1e-6<ctx.minimum){goal=ctx.refill;reason='Dự phòng gần cạn — bổ sung tối thiểu';}
      else if(didReview&&(p.refillRule==='always'||ctx.trailingReturn!==null&&ctx.trailingReturn>1e-12)){goal=reserve;reason='Bổ sung dự phòng tại kỳ xem xét';}
    if(goal>vals.mmf+1e-6&&!ctx.deferRefill){
      var order=['tk','tp'].concat(ctx.riskyOrder);
      INVESTMENT_KEYS.slice().sort(function(x,y){
        function cost(k){var q=ctx.previewSale(k,Math.min(vals[k],goal-vals.mmf));return q.cash>0?q.cost/q.cash:Infinity;}
        var d=cost(x)-cost(y);return Math.abs(d)>1e-9?d:order.indexOf(x)-order.indexOf(y);
      }).forEach(function(k){if(ctx.values().mmf+1e-6<goal)sell(k,goal-ctx.values().mmf,reason,false);});
    }
  }else if(maturityReview){
    var reviewFrom=p.reviewFrom===undefined?p.from:p.reviewFrom;
    var monthsToReview=p.reviewMonths-((m-reviewFrom)%p.reviewMonths);
    maturityWait=monthsToReview===1;
    reason=monthsToReview===1?'Sổ tiết kiệm đáo hạn — chờ kỳ cân bằng':'Cân bằng khi sổ tiết kiệm đáo hạn';
    var matureExcess=Math.min(ctx.freeSaleValue('tk'),Math.max(0,vals.tk-targets.tk));
    ctx.maturityBudget=sell('tk',matureExcess,reason,true);
    if(maturityWait)ctx.maturityBudget=0;
  }else if(didReview){
    reason=ctx.changed?'Áp dụng tỷ trọng của giai đoạn':maturityReview?'Cân bằng khi sổ tiết kiệm đáo hạn':'Tái cân bằng theo lịch';
    var investable=Math.max(0,INVESTMENT_KEYS.reduce(function(s,k){return s+vals[k];},0)+Math.max(0,vals.mmf-reserve));
    var drift=INVESTMENT_KEYS.some(function(k){return Math.abs(vals[k]-targets[k])>band(k,investable)+1;});
    var rebalance=ctx.changed||ctx.first||drift,planned={},totalBuy=0;
    if(rebalance){
      INVESTMENT_KEYS.forEach(function(k){if(k!=='gold'&&!sold[k]){
        var gap=Math.max(0,targets[k]-vals[k]);
        planned[k]=gap+1>=orderMin(investable)&&(!reversedRecently(k,'buy')||reversalAllowed(k,gap,investable))?gap:0;
        totalBuy+=planned[k];
      }});
      var goldGap=Math.max(0,targets.gold-vals.gold),unit=ctx.goldBid,ask=ctx.goldAsk;
      var units=unit>0?Math.floor(goldGap/unit):0;
      if(unit>0&&goldGap-units*unit>unit/2+(ask-unit))units++;
      planned.gold=sold.gold||reversedRecently('gold','buy')&&!reversalAllowed('gold',goldGap,investable)?0:units*ask;
      totalBuy+=planned.gold;
    }
    // Proceeds are requested only for executable purchases and the reserve shortfall.
    // In particular, an unfillable fractional gold target cannot cause a sale.
    var required=Math.max(0,buyFloor+totalBuy-vals.mmf);
    var excess={};INVESTMENT_KEYS.forEach(function(k){excess[k]=Math.max(0,vals[k]-targets[k]);});
    INVESTMENT_KEYS.slice().sort(function(x,y){
      var d=saleRank(x,excess[x])-saleRank(y,excess[y]);return Math.abs(d)>1e-9?d:excess[y]-excess[x];
    }).forEach(function(k){
      if(required<=1e-6||excess[k]<=1e-6)return;
      var q=ctx.previewSale(k,excess[k]);if(q.cash<=1e-6)return;
      // Do not break a term deposit or a young bond solely to hit a target weight.
      // A very large risk deviation may justify a low fee, never a 2% early exit.
      var costly=q.cost>1,urgent=excess[k]>investable*.10&&q.cost/q.cash<=.0025;
      var value=Math.min(excess[k],required*q.value/q.cash);
      if(reversedRecently(k,'sell')&&!reversalAllowed(k,excess[k],investable))
        value=Math.min(value,Math.max(0,reserve-ctx.values().mmf)*q.value/q.cash);
      if(costly&&!urgent){
        var free=ctx.freeSaleValue(k),reserveGap=ctx.deferRefill?0:Math.max(0,reserve-ctx.values().mmf);
        value=Math.min(value,Math.max(free,reserveGap*q.value/q.cash));
      }
      if(value<=1e-6)return;
      required-=sell(k,value,reason,true);
    });
    // A missing reserve is funded even when all remaining holdings have a penalty.
    // Optional rebalancing purchases never justify such an extra penalty.
    if(ctx.values().mmf<reserve-1e-6&&!ctx.deferRefill)fundReserve(reserve,reason);
    // The planned amounts cap post-sale buys; a whole gold sale or fee adjustment
    // cannot silently turn into another round of purchases.
    ctx.plannedBuys=rebalance?planned:null;
  }else if(reserve>0&&vals.mmf<reserve*.5-1&&!ctx.deferRefill){
    // Between reviews, spending may draw the reserve down. Refill only at the
    // lower trigger, so a retirement plan does not create a fee-bearing sale monthly.
    refillTrigger=true;fundReserve(reserve,'Dự phòng MMF dưới nửa mốc — bổ sung');
  }
  vals=ctx.values();targets=investmentTargets(vals,reserve,weights);
  var investableNow=Math.max(0,INVESTMENT_KEYS.reduce(function(s,k){return s+vals[k];},0)+Math.max(0,vals.mmf-reserve));
  var available=Math.max(0,vals.mmf-buyFloor),budget=refillTrigger?0:maturityReview?Math.min(available,ctx.maturityBudget||0):didReview?available:Math.min(available,ctx.newCash||0),deficits={},sum=0;
  INVESTMENT_KEYS.forEach(function(k){
    var gap=Math.max(0,targets[k]-vals[k]),cap=ctx.plannedBuys?ctx.plannedBuys[k]||0:Infinity;
    if(k==='gold'){
      var units=Math.floor(gap/ctx.goldBid),rem=gap-units*ctx.goldBid;
      if(rem>ctx.goldBid/2+(ctx.goldAsk-ctx.goldBid))units++;
      gap=units*ctx.goldAsk;
    }
    deficits[k]=sold[k]?0:Math.min(gap,cap);
    if(reversedRecently(k,'buy')&&!reversalAllowed(k,gap,investableNow))deficits[k]=0;
    if(k!=='gold'&&deficits[k]+1<orderMin(investableNow))deficits[k]=0;
    if(k!=='gold')sum+=deficits[k];
  });
  if(budget>1e-6&&deficits.gold>0){
    var goldAmount=Math.min(deficits.gold,Math.floor((budget+1e-7)/ctx.goldAsk)*ctx.goldAsk);
    if(goldAmount>=ctx.goldAsk-1e-6){var beforeGold=ctx.values().mmf;
      ctx.buy('gold',goldAmount,'Đầu tư tiền còn lại sau dự phòng');budget-=beforeGold-ctx.values().mmf;}
  }
  budget=Math.min(budget,Math.max(0,ctx.values().mmf-buyFloor));
  if(budget+1>=orderMin(investableNow)&&sum>0)INVESTMENT_KEYS.forEach(function(k){
    if(k!=='gold'&&deficits[k]>0)ctx.buy(k,Math.min(budget,sum)*deficits[k]/sum,'Đầu tư tiền còn lại sau dự phòng');
  });
  return {id:p.id,label:p.label,method:p.method,reserveTarget:reserve,reserveActual:ctx.values().mmf,
    reserveShort:Math.max(0,reserve-ctx.values().mmf),review:scheduledReview,maturityReview:maturityReview,maturityWait:maturityWait,refillTrigger:refillTrigger,
    refillDeferred:!!ctx.deferRefill&&ctx.values().mmf<reserve-1e-6,
    futureBills:ctx.futureBills||0,trailingReturn:ctx.trailingReturn,weights:weights};
}
