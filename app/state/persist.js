'use strict';
/* [state/persist.js] Lưu/phục hồi/nâng cấp bản lưu — nơi DUY NHẤT đụng localStorage (chỉ trong
   saveState/loadState, khi được gọi). ĐỌC/GHI: `state` (loadState gán lại toàn cục), localStorage,
   DOM chỉ qua updateSaveStatus khi có lỗi lưu. migrateState thuần — nạp được trong Node VM cho test.
   Chuỗi nâng cấp v1→v6 + backup: xem AGENTS.md mục 5. */
var migrationMessages=[];
var savingBlocked=false;

/* ================= Lưu & phục hồi trạng thái (localStorage) =================
   Toàn bộ state (điểm lãi suất, dòng tiền, cấu hình) được lưu mỗi khi refresh() chạy.
   Chuỗi đã lưu được giữ nguyên khi nâng cấp. */
/* F13/S03 — lỗi ghi localStorage không được nuốt im lặng: hiện trạng thái "chưa lưu được" + lối sao lưu.
   Nếu việc TẢI/PHỤC HỒI thất bại (rescueRaw khác null) thì nút xuất phải cứu đúng BẢN GỐC raw đó,
   không phải state mặc định đang hiển thị. */
var saveFailed=false, rescueRaw=null;
var SAVE_KEY = 'lifesim_vn_state_v1';
function saveState(){
  if(savingBlocked)return;
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    if(saveFailed){saveFailed=false;updateSaveStatus();}
  }catch(e){
    if(!saveFailed){saveFailed=true;updateSaveStatus();}
  }
}
function updateSaveStatus(){
  var el=$('saveStatus'); if(!el)return;
  if(!saveFailed){ el.innerHTML=''; return; }
  var isRescue = rescueRaw !== null;
  el.innerHTML='<div class="warnbar">⚠ <div><b>Chưa lưu được vào trình duyệt</b> — thay đổi sẽ mất khi tải lại trang. Bản lưu tốt lần cuối vẫn còn nguyên.'+(isRescue?'<br>Phục hồi dữ liệu gốc thất bại — nút bên dưới xuất <b>BẢN GỐC</b> cần cứu, không phải cấu hình mẫu đang hiển thị.':'')+'</div><button type="button" class="btn mini" id="backupJsonBtn">'+(isRescue?'Sao lưu BẢN GỐC (JSON)':'Sao lưu JSON')+'</button></div>';
  var b=$('backupJsonBtn'); if(b)b.onclick=function(){
    var txt = isRescue ? rescueRaw : JSON.stringify(state,null,1);
    function done(ok){ appDialog({title:ok?(isRescue?'Đã sao chép BẢN GỐC':'Đã sao chép cấu hình'):'Không sao chép được tự động', html:ok
      ? (isRescue
          ? 'Đây là raw bản gốc y hệt trong localStorage (kể cả phần không đọc được). Dán vào tệp để giữ dự phòng; có thể phục hồi bằng cách ghi lại vào localStorage khóa <b>'+SAVE_KEY+'</b> rồi tải lại trang.'
          : 'Dán vào tệp văn bản để giữ dự phòng. Có thể phục hồi bằng cách ghi lại vào localStorage khóa <b>'+SAVE_KEY+'</b>.')
      : 'Trình duyệt chặn clipboard — mở DevTools và chạy:<br><code>copy('+(isRescue?'window.__rescueRaw || localStorage.getItem(\''+SAVE_KEY+'\')':'JSON.stringify(state)')+')</code>', okText:'Đã hiểu'}); }
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(function(){done(true);},function(){done(fallbackCopy(txt));}); }
    else done(fallbackCopy(txt));
  };
}
function fallbackCopy(t){
  try{ var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); var ok=document.execCommand('copy'); document.body.removeChild(ta); return !!ok; }
  catch(e){ return false; }
}
function migrateState(saved){
  var result=JSON.parse(JSON.stringify(defaultState));
  Object.keys(result).forEach(function(k){if(saved[k]!==undefined)result[k]=saved[k];});
  ['assets','rates','pensionSimple','seriesMeta','seriesSeeds'].forEach(function(k){result[k]=Object.assign({},defaultState[k],saved[k]||{});});
  /* Bản cũ thiếu lãi kỳ hạn ngắn (tkShort/tkMedium) được điền mặc định 3/4,5 qua merge ở trên —
     im lặng, không còn banner (yêu cầu 19/09/2026: bỏ thông báo thay đổi kết quả). */
  SERIES_KEYS.forEach(function(k){result.seriesMeta[k]=Object.assign({},defaultState.seriesMeta[k],(saved.seriesMeta||{})[k]||{});});
  result.startMonth=saved.startMonth===undefined?NOW:saved.startMonth;
  /* Đợt 14 — bỏ cách phân bổ cũ: trường alloc/allocMode của pha thu nhập và sự kiện bị xóa khỏi
     bản lưu; tiền dư/thiếu giờ do chiến lược đầu tư (Tab 6) quyết định. */
  result.incomePeriods=result.incomePeriods.map(function(p){var c=Object.assign({},p,{toY:p.toY===''?null:p.toY});
    /* Đợt 11 — bỏ chế độ "theo lạm phát" (checkbox đã bỏ khỏi Tab 5): bản lưu cũ có followInfl=true
       quy về growth = lạm phát đang cấu hình tại lúc migrate, xóa cờ — từ đó tăng theo % đã nhập. */
    if(c.followInfl===true){c.growth=finiteNumber(result.infl)?result.infl:5;}
    delete c.followInfl;delete c.alloc;
    return c;});
  result.events=result.events.map(function(e){var c=Object.assign({},e);delete c.alloc;delete c.allocMode;return c;});
  result.landPlots=(Array.isArray(result.landPlots)?result.landPlots:[]).map(function(p,i){var c=Object.assign({},p);c.id=c.id||'saved-property-'+i;if(c.total===undefined||c.total===null||!finiteNumber(c.total))c.total=plotValue(c);if(c.saleYear===undefined)c.saleYear=c.holdYears?Math.floor((result.startMonth+c.holdYears*12-1)/12):null;if(c.salePrice===undefined)c.salePrice=null;if(c.rentFromYear===undefined)c.rentFromYear=null;delete c.holdYears;return c;});
  /* v8 — BĐS theo GIÁ HIỆN TẠI + năm sở hữu + chi phí duy tu + “Có thể bán” từng BĐS:
     bản cũ quy đổi để DÒNG TIỀN MÔ PHỎNG GIỮ NGUYÊN (yield %/năm → VND/tháng; giá bán tuyệt đối
     tại năm bán → chia lạm phát về giá hiện tại); cấu hình bán sớm chung chuyển thành sellable
     từng BĐS rồi xóa khỏi state. Bản v8 đã có sẵn các trường này — bỏ qua, giữ nguyên số.
     Thông báo nằm trong migrateState (không chỉ loadState) để MỞ HỒ SƠ FILE cũ cũng thấy hướng dẫn. */
  if(saved.schemaVersion===undefined||saved.schemaVersion<8){
    result.landPlots=result.landPlots.map(function(p){
      var c=Object.assign({},p);
      if(c.ownYear===undefined||c.ownYear===null||c.ownYear==='')c.ownYear=null;
      if(c.rent&&(c.rentMode||'yield')!=='direct'&&!c.rentVnd)c.rentVnd=Math.round(plotValue(c)*(c.rentYield||0)/100/12);
      if(c.salePrice!=null&&c.saleYear!=null){
        var dy=(c.saleYear*12+11-result.startMonth)/12;
        if(dy>0)c.salePrice=c.salePrice/Math.pow(1+(finiteNumber(result.infl)?result.infl:5)/100,dy);
      }
      c.sellable=c.sellable===undefined?(saved.landSellable===undefined?true:!!saved.landSellable):!!c.sellable;
      c.expenses=Array.isArray(c.expenses)?c.expenses.map(function(x){return {y:+x.y||0,label:x.label==null?'':String(x.label),amount:+x.amount||0};}):[];
      delete c.rentMode;delete c.rentYield;delete c.price;delete c.priceMode;
      return c;
    });
    migrationMessages.push('Đã nâng cấp Tab 2 → “Tài sản” (v8): mọi số của BĐS (giá trị, giá thuê, giá bán, chi phí) giờ nhập theo giá hiện tại — số cũ đã được quy đổi tương đương; thêm Năm sở hữu cho BĐS nhận sau này, danh mục chi phí sửa chữa/duy tu và ô “Có thể bán” cho từng BĐS (thay cho cấu hình bán sớm chung). Kết quả mô phỏng của dữ liệu cũ không đổi.');
  }
  delete result.landSellable;
  result.pensionMode='simple';result.lumpsum=false;result.allocPolicy={lumpEnabled:false,lumpAlloc:{}};
  /* Chỉ bản v1 (không có schemaVersion) mới cần nâng cấp v2 — bản v2/v3/v4 đã có sẵn các lựa chọn này
     và phải được giữ nguyên (review F01 11/09: "!==2" khiến bản v3 bị reset landSellable/sellRule). */
  if(saved.schemaVersion===undefined||saved.schemaVersion<2){result.landSellable=true;result.sellRule='nearPeak';}
  /* v3 — nghĩa mới của pensionSimple.amount (giá tại tháng gốc). Merge ở trên đã thêm
     amountSource/amountBasis mặc định; bản cũ có amount>0 mà không tự khai báo gốc giá →
     'unknown' để Tab 4 hỏi lại (bàn giao mục 7.2: không suy đoán từ số tiền, không nhân/chia gì).
     Chỉ bản TRƯỚC v3 (undefined/1/2) mới xét — bản v4 luôn khai báo đủ nghĩa. */
  if((saved.schemaVersion===undefined||saved.schemaVersion<3) && result.pensionSimple.amount>0 && !(saved.pensionSimple&&saved.pensionSimple.amountBasis))
    result.pensionSimple.amountBasis='unknown';
  /* v4 — gia đình nhiều người (M1 11/09): người chính giữ nguyên vị trí (Tab 1 + state.periods/
     pensionSimple) nên kết quả mô phỏng của bản cũ KHÔNG đổi; extraPeople là mảng thêm, chuẩn hoá
     từng thành viên đủ trường hợp. */
  result.extraPeople=Array.isArray(result.extraPeople)?result.extraPeople.map(function(p0,i){
    var c=Object.assign({},p0);
    c.id=c.id||('person-'+i);
    c.name=String(c.name==null?'':c.name);
    c.birthYear=finiteNumber(c.birthYear)?c.birthYear:1990;
    c.gender=c.gender==='female'?'female':'male';
    c.periods=Array.isArray(c.periods)?c.periods:[];
    c.pension=Object.assign({amount:0,startYear:2052,startMonth:1,growth:8,amountSource:'manual',amountBasis:'baseMonth'},c.pension||{});
    return c;
  }):[];
  if(!Number.isInteger(result.activePerson)||result.activePerson<0||result.activePerson>result.extraPeople.length)result.activePerson=0;
  if(typeof result.mainName!=='string')result.mainName='';
  /* Đợt 14 (v6) — cách phân bổ cũ đã bị xóa: mọi bản lưu chạy chiến lược theo giai đoạn.
     Bản đang dùng chiến lược giữ nguyên kế hoạch; bản còn chế độ cũ (hoặc thiếu) nhận kế hoạch
     mặc định một giai đoạn. allocRetire/mmfMonths không còn trong defaults nên tự rơi khỏi kết quả. */
  var sp=saved.investmentPlan;
  if(sp&&typeof sp==='object'&&sp.mode!=='legacy'){
    // Preserve an edited or future-version plan even if invalid: validation must surface it,
    // never silently replace a saved portfolio with the default allocation.
    result.investmentPlan=JSON.parse(JSON.stringify(sp));delete result.investmentPlan.mode;
  }else result.investmentPlan=newInvestmentPlan(result.startMonth);
  if(!sp||sp.mode==='legacy')
    migrationMessages.push('Cách phân bổ cũ đã được bỏ. Hồ sơ này giờ dùng chiến lược đầu tư theo giai đoạn (Tab 6) với kế hoạch mặc định — mở Tab 6 để chỉnh tỷ trọng và số tháng dự phòng theo ý bạn.');
  result.lifePlan=saved.lifePlan===undefined?null:JSON.parse(JSON.stringify(saved.lifePlan));
  if(!result.lifePlan&&(!saved.schemaVersion||saved.schemaVersion<7)){
    // Refuse to hide invalid/future strategy inputs behind a valid replacement.
    var previousIncomeEnd=-Infinity;
    var badIncome=result.incomePeriods.slice().sort(function(a,b){return a.fromY-b.fromY;}).some(function(p){var end=p.toY==null?retireAgeMonths(result.birthYear,result.gender):p.toY*12+11;var bad=!Number.isInteger(p.fromY)||(p.toY!=null&&(!Number.isInteger(p.toY)||p.toY<p.fromY))||p.fromY*12<=previousIncomeEnd||!finiteNumber(p.amount)||p.amount<0||!finiteNumber(p.growth)||p.growth<=-100||p.growth>100;previousIncomeEnd=end;return bad;});
    if(!badIncome&&!validateInvestmentPlan(result.investmentPlan,result.startMonth,result.simYears).some(function(e){return e.level==='error';})){
      result.lifePlanArchive={incomePeriods:JSON.parse(JSON.stringify(result.incomePeriods)),investmentPlan:JSON.parse(JSON.stringify(result.investmentPlan))};
      result.lifePlan=lifePlanFromLegacy(result);
      migrationMessages.push('Đã gộp thu nhập và phân bổ tại Tab 5. Giữ mốc thu nhập, dự phòng và tỷ lệ; áp dụng cân bằng theo lịch chung (lịch và mức sàn của giai đoạn đầu). Kiểu quỹ dự phòng cũ chuyển sang cân bằng định kỳ; chuyển dần cũ thành mốc tỷ lệ đầu/cuối. Cấu hình cũ được giữ trong bản sao chuyển đổi.');
    }
  }
  /* Đợt 23b — bảng thu nhập đổi sang nhập theo GIÁ HIỆN TẠI (lifePlan.version 1→2): bản cũ nhập
     amount theo giá tại mốc — quy lùi về giá hôm nay (chia (1+lạm phát)^(số năm tới mốc)) để
     DÒNG TIỀN MÔ PHỎNG KHÔNG ĐỔI; cột "(tương lai)" sẽ tự tính lại đúng mức cũ. */
  if(result.lifePlan&&Array.isArray(result.lifePlan.rows)&&!(result.lifePlan.version>=2)){
    var conv=0,inflY=Math.pow(1+(finiteNumber(result.infl)?result.infl:5)/100,1);
    result.lifePlan.rows.forEach(function(r){
      if(r&&r.income&&finiteNumber(r.income.amount)&&r.from>result.startMonth){r.income.amount=r.income.amount/Math.pow(inflY,(r.from-result.startMonth)/12);conv++;}
    });
    result.lifePlan.version=2;
    if(conv)migrationMessages.push('Bảng thu nhập đã đổi sang nhập theo giá hiện tại: các mốc được quy lùi về giá hôm nay — dòng tiền mô phỏng giữ nguyên. Cột "Thu nhập/tháng (tương lai)" hiển thị mức thực nhận tự tính.');
  }
  if(result.lifePlan&&result.lifePlan.version>=2&&Array.isArray(result.lifePlan.rows)){
    /* Quy tắc dự phòng MMF mới áp im lặng (số tháng × chi phí sinh hoạt) — không còn banner
       (yêu cầu 19/09/2026: bỏ thông báo thay đổi kết quả). */
    result.lifePlan.reserveBasis='expenses';
    delete result.lifePlan.emergencyMonths;
  }
  /* Năm 0 chỉ bắt buộc có phân bổ. Thu nhập 0 đ mặc định của bản cũ là mốc giả,
     bỏ im lặng để bảng thu nhập chỉ còn các dòng người dùng thực sự nhập. */
  if(result.lifePlan&&Array.isArray(result.lifePlan.rows)){
    var row0=result.lifePlan.rows.find(function(r){return r&&r.from===result.startMonth;});
    if(row0&&row0.income&&row0.income.amount===0&&row0.income.growth===0&&!row0.incomeLabel){
      row0.income=null;
      if(!row0.allocation)result.lifePlan.rows.splice(result.lifePlan.rows.indexOf(row0),1);
    }
    if(!lifeValueAt(result.lifePlan,result.startMonth,'allocation')){
      row0=result.lifePlan.rows.find(function(r){return r&&r.from===result.startMonth;});
      if(!row0){row0={id:'life-'+result.startMonth+'-anchor',from:result.startMonth,label:'Hiện tại',income:null,allocation:null};result.lifePlan.rows.push(row0);}
      row0.allocation=JSON.parse(JSON.stringify(lifeValueAt(result.lifePlan,result.startMonth-1,'allocation')||newLifePlan(result.startMonth).rows[0].allocation));
      migrationMessages.push('Đã tạo lại phân bổ tài sản lần đầu tại năm thứ 0. Mốc này không xóa/dời được.');
    }
  }
  /* Đợt 63 (v3) — "Tăng %/năm" Tab 5 đổi nghĩa thành tốc độ tăng danh nghĩa TỔNG kể từ tháng gốc:
     mặc định bằng lạm phát, 0 = đứng nguyên số nhập mọi năm (khoản thu theo giá quy định). Bản v2
     lưu growth = tăng thật SAU lạm phát ngầm tới mốc → quy đổi gộp ((1+lạm phát)×(1+growth cũ)−1)
     để ý "tăng thêm ngoài lạm phát" của số cũ được giữ trọn trong nghĩa mới; amount (giá hiện tại)
     giữ nguyên. Mốc tại năm thứ 0 tăng nhanh hơn trước đúng phần lạm phát; mốc năm sau cộng thêm
     phần trượt giá tới mốc — mở Tab 5 rà lại và sửa mức tăng nếu muốn khác mặc định. */
  if(result.lifePlan&&result.lifePlan.version===2&&Array.isArray(result.lifePlan.rows)){
    var inflF=1+(finiteNumber(result.infl)?result.infl:5)/100,convG=0;
    result.lifePlan.rows.forEach(function(r){
      if(r&&r.income&&finiteNumber(r.income.growth)){r.income.growth=Math.round((inflF*(1+r.income.growth/100)-1)*10000)/100;convG++;}
    });
    result.lifePlan.version=3;
    if(convG)migrationMessages.push('Tab 5: "Tăng %/năm" nay là tốc độ tăng danh nghĩa tổng kể từ hôm nay — mốc mới mặc định bằng lạm phát, nhập 0 nếu khoản thu không tăng (vd phí gửi xe theo giá quy định). Các mốc cũ đã được quy đổi gộp lạm phát vào mức tăng để giữ đúng ý tăng thật cũ; hãy mở Tab 5 rà lại từng mốc và sửa nếu muốn.');
  }
  result.schemaVersion=9;result.seriesV=MODEL_VERSION;
  /* v9 — Tab 8 Tối ưu đóng BHXH: compareCfg là what-if độc lập (không đụng dòng tiền mô phỏng),
     bản cũ thiếu trường được điền im lặng mặc định — không banner. */
  result.compareCfg=Object.assign(newCompareCfg(),saved.compareCfg&&typeof saved.compareCfg==='object'?saved.compareCfg:{});
  /* Chi phí cố định Tab 4 (không theo lạm phát) — trường optional, bản cũ thiếu được điền rỗng
     im lặng (tiền lệ rentFromYear): hồ sơ cũ không đổi một số mô phỏng nào. */
  if(!Array.isArray(result.fixedMilestones))result.fixedMilestones=[];
  /* F03 — kiểm tra TỪNG chuỗi độc lập: chuỗi hỏng (không phải mảng số hợp lệ) chỉ reset chính nó,
     hai chuỗi tốt giữ nguyên đường đã lưu. Raw gốc được loadState sao dự phòng trước khi sửa. */
  if(typeof result.series!=='object'||!result.series||Array.isArray(result.series))result.series={};
  var seriesBroken=[];
  SERIES_KEYS.forEach(function(k){
    var v=result.series[k];
    if(!Array.isArray(v)||!v.every(function(r){return finiteNumber(r)&&r>-1;})){
      result.series[k]=[];seriesBroken.push(k);
    }
  });
  if(seriesBroken.length)migrationMessages.push('Chuỗi lợi suất '+seriesBroken.map(function(k){return {gold:'vàng',cp:'cổ phiếu',land:'BĐS'}[k]||k;}).join(', ')+' không đọc được — đã sinh lại riêng chuỗi đó (trạng thái sao lưu bản gốc được loadState báo riêng).');
  SERIES_KEYS.forEach(function(k){
    var a=result.series[k],meta=result.seriesMeta[k];
    if(a.length&&a.length%12===0&&a.every(function(r){return finiteNumber(r)&&r>-1;})&&finiteNumber(meta.cagr)&&meta.cagr>=-.65&&meta.cagr<=.8){
      var actual=annualCAGR(a);
      if(actual>=-.65-1e-10&&actual<=.8+1e-10&&Math.abs(meta.cagr-actual)>1e-9){
        meta.cagr=Math.max(-.65,Math.min(.8,actual));
        migrationMessages.push('CAGR '+({gold:'vàng',cp:'cổ phiếu',land:'BĐS'}[k])+' đã đồng bộ với đường lợi suất đã lưu; nhập CAGR mới ở Tab 6 nếu muốn tạo lại đường.');
      }
    }
  });
  return result;
}
function seriesStructureBroken(saved){
  var s=saved&&saved.series;
  if(!s||typeof s!=='object'||Array.isArray(s))return true;
  return SERIES_KEYS.some(function(k){var v=s[k];return !Array.isArray(v)||!v.every(function(r){return typeof r==='number'&&isFinite(r)&&r>-1;});});
}
/* ===== Hồ sơ (profile) — khóa meta "hồ sơ đang mở" trong localStorage =====
   persist.js vẫn là nơi DUY NHẤT đụng localStorage; ui/profiles.js đọc/ghi chỉ qua các hàm này.
   Meta chỉ là con trỏ (file/id/tên/revision/lần lưu cuối) — toàn bộ dữ liệu hồ sơ nằm trong file
   JSON của thư mục profiles do app/server.js quản lý. */
var PROFILE_META_KEY='lifesim_vn_open_profile_v1';
function getOpenProfileMeta(){
  try{ var raw=localStorage.getItem(PROFILE_META_KEY); var m=raw?JSON.parse(raw):null; return (m&&typeof m==='object')?m:null; }
  catch(e){ return null; }
}
function setOpenProfileMeta(m){
  try{
    if(m)localStorage.setItem(PROFILE_META_KEY,JSON.stringify(m));
    else localStorage.removeItem(PROFILE_META_KEY);
  }catch(e){ /* meta là tiện ích — không chặn lưu state chính */ }
}
/* Mở hồ sơ thay thế dữ liệu đang chạy: gỡ cờ lỗi lưu/phục hồi cũ kẻo chặn saveState của hồ sơ mới */
function resetRescueFlags(){
  savingBlocked=false;saveFailed=false;rescueRaw=null;
  if(typeof updateSaveStatus==='function')updateSaveStatus();
}
function loadState(){
  try{
    var raw=localStorage.getItem(SAVE_KEY);if(!raw)return false;
    var saved=JSON.parse(raw);if(!saved||typeof saved!=='object')throw new Error('Bản lưu không hợp lệ');
    if(saved.schemaVersion===undefined||saved.schemaVersion<7){
      if(!localStorage.getItem(SAVE_KEY+'_backup_before_v7'))localStorage.setItem(SAVE_KEY+'_backup_before_v7',raw);
    }
    if(saved.schemaVersion===undefined||saved.schemaVersion<6){
      if(!localStorage.getItem(SAVE_KEY+'_backup_before_v6'))localStorage.setItem(SAVE_KEY+'_backup_before_v6',raw);
      migrationMessages.push('Đã nâng cấp (v6): cách phân bổ cũ đã được bỏ. Hồ sơ giờ dùng chiến lược đầu tư theo giai đoạn ở Tab 6 — kiểm tra lại tỷ trọng và số tháng dự phòng nếu bạn chưa từng chỉnh.');
    }
    if(saved.schemaVersion===undefined||saved.schemaVersion<2){
      if(!localStorage.getItem(SAVE_KEY+'_backup_before_v2'))localStorage.setItem(SAVE_KEY+'_backup_before_v2',raw);
      migrationMessages.push('Đã nâng cấp: giữ số dư và chuỗi đã lưu; bỏ gom mua BĐS, tỷ lệ BĐS cũ chuyển về MMF. Kiểm tra lại năm bán BĐS (bán cuối năm), giá vàng bán lại mặc định thấp hơn giá mua 2%. Bản lưu cũ được giữ dự phòng.');
    }
    /* v3 — lương hưu hai giai đoạn (BAN_GIAO_CPI_LUONG_HUU_2026-09-10.md): ô mức hưu đổi nghĩa
       từ "giá tại tháng hưởng" sang "giá hiện tại". Bản lưu cũ có mức hưu > 0 không ghi rõ gốc giá
       → không suy đoán: giữ nguyên số, đánh dấu cần xác nhận ở Tab 4 (mục 7.2). */
    if(saved.schemaVersion===2){
      if(!localStorage.getItem(SAVE_KEY+'_backup_before_v3'))localStorage.setItem(SAVE_KEY+'_backup_before_v3',raw);
      migrationMessages.push('Đã nâng cấp lương hưu (v3): ô mức hưu giờ là tiền theo giá hiện tại — phần mềm tự nhân lạm phát đến tháng bắt đầu hưởng rồi tăng sau từng năm hưởng.'+
        ((saved.pensionSimple&&saved.pensionSimple.amount>0)?' Bản cũ có mức hưu đang lưu: chọn nghĩa của số đó ở Tab 4 khi mở lại.':'')+' Bản lưu trước nâng cấp được giữ dự phòng.');
    }
    /* v4 — gia đình nhiều người (M1 11/09/2026): thay đổi cộng thêm, không dựng lại dữ liệu cũ;
       vẫn sao dự phòng raw theo đúng quy ước các lần nâng cấp trước. */
    if(saved.schemaVersion===undefined||saved.schemaVersion<4){
      if(!localStorage.getItem(SAVE_KEY+'_backup_before_v4'))localStorage.setItem(SAVE_KEY+'_backup_before_v4',raw);
      migrationMessages.push('Đã thêm hỗ trợ gia đình nhiều người (v4): hồ sơ gốc giữ nguyên — bấm “＋ Thêm người” ở Tab 4 để thêm vợ/chồng, mỗi người có giai đoạn đóng BHXH và lương hưu riêng; mô phỏng cộng hưu đúng thời điểm từng người bắt đầu nhận. Bản lưu trước nâng cấp được giữ dự phòng.');
    }
    /* v8 — BĐS theo giá hiện tại (báo + quy đổi nằm trong migrateState; ở đây chỉ sao dự phòng raw). */
    if(saved.schemaVersion===undefined||saved.schemaVersion<8){
      if(!localStorage.getItem(SAVE_KEY+'_backup_before_v8'))localStorage.setItem(SAVE_KEY+'_backup_before_v8',raw);
    }
    /* F03/R07/S04 — JSON parse được nhưng một chuỗi lợi suất sai cấu trúc: LUÔN sao raw hiện tại vào
       khóa thời điểm MỚI (không đè backup cũ của lần phục hồi trước); chỉ khi ghi khóa mới THẤT BẠI
       (viết xong đọc lại không khớp) mới giữ nguyên bản gốc, không migrate, không ghi đè. */
    if(seriesStructureBroken(saved)){
      var newKey = SAVE_KEY+'_backup_series_'+Date.now();
      var wrote = false;
      try{
        localStorage.setItem(newKey, raw);
        wrote = localStorage.getItem(newKey) === raw;
      }catch(e2){ wrote = false; }
      if(!wrote){
        rescueRaw = raw;               /* S03 — nút xuất phải cứu đúng bản gốc này */
        savingBlocked = true; saveFailed = true; updateSaveStatus();
        migrationMessages.push('Phát hiện chuỗi lợi suất hỏng nhưng KHÔNG sao lưu được bản gốc (lỗi lưu trữ). Đã giữ nguyên bản lưu — không tự sửa, không ghi đè. Hãy dùng nút "Sao lưu BẢN GỐC (JSON)" đầu trang để cứu dữ liệu, hoặc dọn dung lượng rồi tải lại trang.');
        return false;
      }
      var oldBk = null;
      try{ oldBk = localStorage.getItem(SAVE_KEY+'_backup_before_series_fix'); }catch(e3){}
      migrationMessages.push('Đã sao bản gốc (trước khi sửa chuỗi hỏng) vào khóa '+newKey+'.'+(oldBk !== null ? ' Bản sao cũ ở khóa '+SAVE_KEY+'_backup_before_series_fix được giữ nguyên, không ghi đè.' : ''));
    }
    state=migrateState(saved);if(isFinite(state.startMonth))NOW=state.startMonth;return true;
  }catch(e){if(typeof raw==='string')rescueRaw=raw;savingBlocked=true;saveFailed=true;updateSaveStatus();migrationMessages.push('Không đọc được bản lưu: '+e.message+'. Chưa ghi đè dữ liệu gốc. Dùng nút "Sao lưu BẢN GỐC (JSON)" để cứu dữ liệu.');return false;}
}
