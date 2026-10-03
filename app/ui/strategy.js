'use strict';
/* Tab 5 unified income/allocation milestones; edits lifePlan only. Pension rows are read-only. */
function strategyMonth(m){return Math.floor(m/12)+'-'+('0'+(m%12+1)).slice(-2);}
function strategyField(p,k,label,type,extra){
  return '<div><label for="inv-'+esc(p.id)+'-'+k+'">'+label+'</label><input id="inv-'+esc(p.id)+'-'+k+'" data-f="'+k+'" type="'+(type||'number')+'" value="'+esc(type==='month'?strategyMonth(p[k]):String(p[k]===undefined?'':p[k]))+'" '+(extra||'')+'></div>';
}
function strategySelect(p,k,label,choices){
  return '<div><label for="inv-'+esc(p.id)+'-'+k+'">'+label+'</label><select id="inv-'+esc(p.id)+'-'+k+'" data-f="'+k+'">'+Object.keys(choices).map(function(v){return '<option value="'+v+'"'+(String(p[k])===v?' selected':'')+'>'+choices[v]+'</option>';}).join('')+'</select></div>';
}
function strategyWeightsHtml(p,key,label){
  var w=p[key]||{},sum=0;
  return '<p><b>'+label+'</b></p><div class="strategy-weights">'+INVESTMENT_KEYS.map(function(k){sum+=Number(w[k])||0;return '<div><label for="inv-'+esc(p.id)+'-'+key+'-'+k+'">'+ALNAME[k]+' (%)</label><input id="inv-'+esc(p.id)+'-'+key+'-'+k+'" type="number" min="0" max="100" step="5" data-f="'+key+'_'+k+'" value="'+esc(String(w[k]===undefined?'':w[k]))+'"></div>';}).join('')+'</div><div class="hint"'+(Math.abs(sum-100)>.001?' style="color:#b91c1c"':'')+'>Tổng '+fmtNumVN(sum,1)+'% / 100% · Không gồm MMF và bất động sản.</div>';
}
function lifeAllocationSummary(a){return a?INVESTMENT_KEYS.map(function(k){return ALNAME[k]+' '+(a.weights||{})[k]+'%';}).join(' · ')+' · MMF '+a.reserveMonths+' tháng':'Chưa có phân bổ';}
function lifeInput(value,key,label,extra){return '<input data-f="'+key+'" aria-label="'+esc(label)+'" value="'+esc(String(value==null?'':value))+'" '+(extra||'type="number"')+'>';}
function renderInvestmentPlan(){
  var lp=state.lifePlan;
  if(!lp){$('investmentList').textContent='Không đọc được kế hoạch. Hãy kiểm tra hồ sơ.';$('allocationList').innerHTML='';return;}
  if(document.activeElement!==$('lifeReview'))$('lifeReview').value=lp.reviewMonths;
  var rows=lifeRows(lp),incomeRows=rows.filter(function(r){return r.income!=null;}),allocRows=rows.filter(function(r){return r.allocation!=null;});
  var items=incomeRows.map(function(r){return {from:r.from,row:r};});
  var people=[{name:state.mainName||'Người 1',pension:state.pensionSimple}].concat((state.extraPeople||[]).map(function(p){return {name:p.name||'Thành viên',pension:p.pension};}));
  people.forEach(function(p){var v=pensionStartOf(p.pension);if(v.amount>0&&v.start<NOW+state.simYears*12)items.push({from:Math.max(NOW,v.start),person:p});});
  /* Cùng Năm thứ: xếp theo đúng THÁNG của mốc — dòng hưu neo tháng đủ tuổi thật từ Tab 3,
     nên trong cùng năm thứ có thể rơi SAU dòng thường (thứ tự khớp trình tự thời gian thật);
     trùng đúng một tháng thì dòng hưu (nhãn khóa, đọc từ Tab 3) vẫn đứng trên dòng thường. */
  items.sort(function(a,b){var ya=Math.floor((a.from-NOW)/12),yb=Math.floor((b.from-NOW)/12);
    if(ya!==yb)return ya-yb;
    if(a.from!==b.from)return a.from-b.from;
    return a.row?1:-1;});
  var h='<div class="milestone-income milestone-head"><div>Năm thứ</div><div>Năm</div><div>Giai đoạn</div><div>Thu nhập/tháng<br>(hiện tại)</div><div>Thu nhập/tháng<br>(tương lai)</div><div title="Tốc độ tăng danh nghĩa TỔNG kể từ hôm nay — mốc mới mặc định bằng lạm phát; 0 = không tăng (khoản thu theo giá quy định)">Tăng %/năm</div><div></div></div>';
  if(!incomeRows.length)h+='<div class="hint">Chưa có thu nhập. Bấm “Thêm mốc thu nhập” nếu có lương hoặc nguồn thu khác.</div>';
  items.forEach(function(item){var m=item.from,year=Math.floor((m-NOW)/12);
    if(item.person){
      var v=pensionStartOf(item.person.pension),amount=pensionMonthly(v.amount,v.start,v.growth,state.infl,NOW,m),total=0;
      people.forEach(function(p){var z=pensionStartOf(p.pension);total+=pensionMonthly(z.amount,z.start,z.growth,state.infl,NOW,m);});
      h+='<div class="milestone-income pension-milestone">'+
        '<div><input type="number" value="'+year+'" disabled aria-label="Năm thứ hưu, '+esc(item.person.name)+'" title="Năm thứ = số nguyên năm kể từ mốc gốc, làm tròn xuống — tháng đủ tuổi hưu của '+esc(item.person.name)+' là '+ymToStr(m)+' nên rơi trong năm thứ '+year+'"></div>'+
        '<div class="cyear" title="Mốc hưu tính theo THÁNG đủ tuổi (Tab 3 · BHXH), không theo đúng tháng kỷ niệm của mốc gốc — nên cùng Năm thứ '+year+' có thể khác năm lịch với dòng thường">'+ymToStr(m)+'</div>'+
        '<div><input type="text" value="'+esc(item.person.name)+' về hưu" disabled aria-label="Mốc hưu, '+esc(item.person.name)+'"></div>'+
        '<div><input type="text" class="money" value="'+fmtTr(v.amount)+'/tháng" disabled title="Mức nhập theo giá hiện tại (Tab 3 · BHXH) — '+fmtMoney(v.amount)+' đ/tháng"></div>'+
        /* Đ27 — ô Tương lai của dòng hưu là div .fsalary KHÔNG viền, giống dòng thường (trước là input disabled có viền) */
        '<div class="fsalary" title="Thực nhận dự kiến từ '+ymToStr(m)+': ≈ '+fmtMoney(amount)+' đ/tháng (đã gồm lạm phát và tăng sau hưu) · Tổng hưu cả nhà tại tháng này: '+fmtTr(total)+'/tháng">'+fmtTr(amount)+'/tháng</div>'+
        '<div><input type="number" value="'+v.growth+'" disabled aria-label="Tăng %/năm lương hưu, '+esc(item.person.name)+'"></div>'+
        '<div class="lockcell" title="Lấy từ Tab 3 · BHXH — chỉ là nhãn nhận biết giai đoạn về hưu, không phải dòng thu nhập; không sửa được ở đây">🔒</div></div>';return;
    }
    var r=item.row,i=incomeRows.indexOf(r),name='thu nhập '+(i+1);
    var showLabel=r.incomeLabel||(r.label==='Thu nhập & Phân bổ ban đầu'||r.label==='Phân bổ tài sản lần đầu'?'Thu nhập hiện tại':r.label);
    h+='<div class="milestone-income" data-id="'+esc(r.id)+'" data-kind="income" data-o="'+objToken(r)+'">'+
       '<div>'+lifeInput(year,'year','Năm thứ, '+name,'type="number" min="0" max="100" step="1"')+'</div><div class="cyear">'+Math.floor(m/12)+'</div><div>'+lifeInput(showLabel,'label','Giai đoạn '+name,'type="text" maxlength="80"')+'</div><div>'+lifeInput(fmtMoney(r.income.amount),'amount','Thu nhập tháng giá hiện tại, '+name,'type="text" class="money" inputmode="numeric"')+'</div><div class="fsalary" title="Thực nhận dự kiến từ '+ymToStr(m)+': ≈ '+fmtMoney(lifeSalary(lp,m))+' đ/tháng — tự tính = số nhập × (1+Tăng %/năm) mũ số năm tới mốc. Tăng 0% = đứng nguyên số nhập mọi năm (khoản thu theo giá quy định).">'+fmtMoney(lifeSalary(lp,m))+'</div><div>'+lifeInput(r.income.growth,'growth','Tăng %/năm (tổng, mặc định bằng lạm phát), '+name,'type="number" step="0.5" placeholder="0"')+'</div><div><button class="del" aria-label="Xóa mốc '+name+'">✕</button></div></div>';
  });
  var a='<div class="milestone-allocation milestone-head"><div>Năm thứ</div><div>Năm</div><div>Giai đoạn</div><div>Dự phòng MMF<br>(tháng chi)</div><div>Tiết kiệm<br>(%)</div><div>Quỹ Trái phiếu<br>(%)</div><div>Quỹ Cổ phiếu/ETF<br>(%)</div><div>Vàng<br>(%)</div><div>Tổng</div><div></div></div>';
  allocRows.forEach(function(r,i){var w=r.allocation.weights||{},sum=INVESTMENT_KEYS.reduce(function(v,k){return v+(Number(w[k])||0);},0),name='phân bổ '+(i+1),anchor=r.from===NOW,anchorAttr=anchor?' disabled title="Mốc gốc năm 0 — bắt buộc, không dời/xóa được"':'';
    a+='<div class="milestone-allocation'+(anchor?' milestone-anchor':'')+'" data-id="'+esc(r.id)+'" data-kind="allocation" data-o="'+objToken(r)+'"><div>'+lifeInput(Math.floor((r.from-NOW)/12),'year','Năm thứ, '+name,'type="number" min="0" max="100" step="1"'+anchorAttr)+'</div><div class="cyear">'+Math.floor(r.from/12)+'</div><div>'+lifeInput(anchor?'Phân bổ tài sản lần đầu':r.allocationLabel||r.label,'label','Giai đoạn '+name,'type="text" maxlength="80"'+(anchor?' disabled title="Tên mốc phân bổ ban đầu cố định"':''))+'</div><div>'+lifeInput(r.allocation.reserveMonths,'reserveMonths','Dự phòng MMF (tháng chi), '+name,'type="number" min="0" max="60"')+'</div>'+INVESTMENT_KEYS.map(function(k){return '<div>'+lifeInput(w[k],'weights_'+k,ALNAME[k]+' %, '+name,'type="number" min="0" max="100" step="5"')+'</div>';}).join('')+'<div class="allocation-sum'+(Math.abs(sum-100)>.001?' invalid':'')+'">'+fmtNumVN(sum,0)+'%</div><div><button class="del" '+(anchor?'disabled title="Phân bổ tài sản lần đầu — không xóa được">🔒':'aria-label="Xóa mốc '+name+'">✕')+'</button></div></div>';
  });
  function wire(box){box.querySelectorAll('[data-kind]').forEach(function(row){
    var r=lp.rows.find(function(x){return x&&x.id===row.dataset.id;}),kind=row.dataset.kind;
    function live(){return state.lifePlan===lp&&lp.rows.indexOf(r)>=0;}
    row.querySelectorAll('input').forEach(function(el){el.onchange=function(){if(!live())return;var k=el.dataset.f;
      if(k==='year'){
        var to=el.value===''?NaN:NOW+12*(+el.value),error=moveLifeComponent(lp,r,kind,to);
        if(error){appDialog({title:'Không đổi được mốc',html:esc(error),okText:'Đã hiểu'});delete box.__html;refresh();return;}
      }else if(k==='label'){r[kind+'Label']=el.value;if(!r[kind==='income'?'allocation':'income'])r.label=el.value;}
      else if(kind==='income'){var amount=r.income.amount,growth=r.income.growth;r.income={amount:k==='amount'?moneyVal(el):amount,growth:k==='growth'?(el.value===''?0:+el.value):growth,anchor:r.from};}
      else if(k==='reserveMonths')r.allocation.reserveMonths=el.value===''?null:+el.value;
      else if(k.indexOf('weights_')===0)(r.allocation.weights||(r.allocation.weights={}))[k.slice(8)]=el.value===''?null:+el.value;
      scheduleRefresh();
    };});
    bindDel(row.querySelector('.del'),function(){if(!live()||(kind==='allocation'&&r.from===NOW))return;blurActiveIn(box);r[kind]=null;if(!r.income&&!r.allocation)lp.rows.splice(lp.rows.indexOf(r),1);refresh();});
  });}
  refreshList('investmentList',h,wire);refreshList('allocationList',a,wire);
}
function addLifeComponent(kind){var lp=state.lifePlan;if(!lp)return;var rows=lifeRows(lp).filter(function(r){return r[kind]!=null;}),from=rows.length?NOW+(Math.floor((Math.max(NOW,rows[rows.length-1].from)-NOW)/12)+1)*12:NOW;
  var row=lp.rows.find(function(r){return r.from===from;});if(!row){row={id:'life-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),from:from,label:'Giai đoạn mới',income:null,allocation:null};lp.rows.push(row);}
  if(kind==='income'){var gDef=(typeof state.infl==='number'?state.infl:5);
    /* v3 — mốc mới mặc định tăng bằng lạm phát (tốc độ tổng nhìn thấy trên ô nhập); thừa hưởng
       mức danh nghĩa tại mốc kế trước rồi quy về giá hiện tại theo chính mức mặc định này. */
    row.income={amount:lifeSalary(lp,from)/Math.pow(1+gDef/100,(from-NOW)/12),growth:gDef,anchor:from};}
  else{var old=lifeValueAt(lp,from,'allocation');row.allocation=JSON.parse(JSON.stringify(old?old.allocation:newLifePlan(NOW).rows[0].allocation));}
  row[kind+'Label']=kind==='income'&&from===NOW?'Thu nhập hiện tại':'Giai đoạn mới';refresh();
}
$('addInc').onclick=function(){addLifeComponent('income');};
$('addAllocation').onclick=function(){addLifeComponent('allocation');};
/* Đợt 22 — ⟳ Đồng bộ giai đoạn thu nhập: đẩy trạng thái bảng phân bổ về khớp bảng mốc thu nhập
   (giữ nguyên mốc đã có, xóa mốc thừa, thêm mốc thiếu — quy tắc trong core/strategy.js).
   Bảng phân bổ vẫn có thể lệch bảng thu nhập sau đó vì người dùng sửa tự do. */
$('syncAllocIncome').onclick=function(){
  var lp=state.lifePlan;if(!lp)return;
  if(!lifeRows(lp).some(function(r){return r.income!=null;})){
    appDialog({title:'Chưa có mốc thu nhập',html:'Đồng bộ cần ít nhất một mốc ở bảng <b>Các mốc thu nhập/tháng (không gồm lương hưu)</b> bên trên.',okText:'Đã hiểu'});return;
  }
  var res=syncLifeAllocations(lp);
  if(!res.added&&!res.removed){
    appDialog({title:'Đã đồng bộ',html:'Mọi mốc thu nhập đều đã có phân bổ và không có mốc phân bổ nào thừa — không đổi gì.',okText:'Đã hiểu'});return;
  }
  refresh();
};
$('lifeReview').onchange=function(){if(state.lifePlan){state.lifePlan.reviewMonths=+this.value;scheduleRefresh();}};
