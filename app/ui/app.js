'use strict';
/* [ui/app.js] Khung ứng dụng + khởi động: refresh() (tổng điều phối vẽ + lưu), badge lỗi nav, banner
   tab, chỉ dẫn dữ liệu mẫu, điều hướng tab, wiring ô tiền (input/focusin/focusout), writeInputs (đổ
   state vào ô tĩnh lúc mở), boot (loadState → writeInputs → seedMoneyGood → refresh).
   File này nạp CUỐI CÙNG — fail-fast ở đầu kiểm tra đủ định nghĩa theo thứ tự thẻ <script>. */
(function(){
  var REQUIRED={
    'core/model.js':['makeWorld','generateMonthly','fitCAGR','annualCAGR'],
    'core/pension.js':['bhxhSummary','pensionProjection','pensionFromPeriods','validatePensionPeriods','retireAgeMonths','pensionFactor'],
    'core/compare.js':['newCompareCfg','compareOptimize'],
    'core/simulation.js':['runSim','validateState','validateErrors'],
    'core/strategy.js':['investmentStage','executeInvestment','validateInvestmentPlan'],
    'ui/strategy.js':['renderInvestmentPlan'],
    'core/series.js':['ensureSeries','regenerateSeries','riskCheck'],
    'state/defaults.js':['state','defaultState','NOW'],
    'state/persist.js':['saveState','loadState','migrateState'],
    'ui/common.js':['$','appDialog','moneyVal','fmtTr','refreshList','bindDel','seedMoneyGood','numVal','vnNumStr'],
    'ui/setup.js':['readInputs','renderTab1','renderPlots','renderMilestones','renderEvents','renderIncomePeriods'],
    'ui/bhxh.js':['renderPeopleTabs','renderPersonMeta','renderPensionDetails','renderFamilySummary','applyAutoPensionFor','writePensionInputs'],
    'ui/investment.js':['renderSeriesChart'],
    'ui/results.js':['drawMainChart','drawAllocChart','renderSimulationResults'],
    'ui/compare.js':['renderCompareTab'],
    'core/profiles.js':['PROFILE_FORMAT','PROFILE_VERSION','newProfileId','buildProfile','parseProfileText','profileStructuralErrors'],
    'ui/profiles.js':['profileBarInit','profileAfterRefresh','profileNoteRiskRun','prOpenByFile','prApplyState']
  };
  var missing=[];
  Object.keys(REQUIRED).forEach(function(f){REQUIRED[f].forEach(function(name){
    if(typeof globalThis[name]==='undefined')missing.push(name+' (kỳ vọng từ '+f+')');
  });});
  if(missing.length)throw new Error('Thiếu định nghĩa lúc khởi động — kiểm tra thứ tự thẻ <script> trong index.html: '+missing.join(', '));
})();

/* F14 — badge số lỗi trên nav + banner lỗi tại tab đang mở: người dùng thấy lỗi ngay nơi nhập,
   không phải chờ sang Tab 7. Tab 7 vẫn liệt kê đầy đủ và khoá mô phỏng khi có lỗi. */
function renderNavBadges(vs){
  var counts={};
  vs.forEach(function(v){ if(v.level==='error'){ counts[v.tab]=(counts[v.tab]||0)+1; } });
  /* Ô số (class="num") — rời ô: hiển thị lại theo quy chuẩn VN (dấu , thập phân, dấu . nhóm ngàn
   khi phần nguyên ≥ 10.000). Gõ được cả "6.5" lẫn "6,5"; chuỗi rỗng giữ nguyên (ô tùy chọn);
   sai cú pháp giữ nguyên để banner validate hiển thị lỗi. Không chuẩn hóa TRONG lúc gõ để
   không phá dấu , đang gõ dở (khác với ô tiền which tự định dạng tức thì). */
document.addEventListener('focusout', function(ev){
  var el = ev.target;
  if(!el || !el.classList || !el.classList.contains('num')) return;
  var t = String(el.value).trim();
  if(t === '')return;
  var v = numParseVN(t);
  if(!isNaN(v)) el.value = vnNumStr(v);
});
/* Đ68 — chặn lăn chuột đổi giá trị: trình duyệt tự tăng/giảm ô number đang focus khi lăn chuột;
   rời ô trước thì lăn chỉ cuộn trang. Toàn bộ ô nhập số đã chuyển sang type=text nên đây là
   lưới an toàn cho số/type=number còn sót hoặc thêm về sau. */
document.addEventListener('wheel', function(ev){
  var a = document.activeElement;
  if(a && a.tagName === 'INPUT' && a.type === 'number') a.blur();
}, {passive:true});
document.querySelectorAll('nav button').forEach(function(b){
    var old=b.querySelector('.ebadge'); if(old)old.remove();
    var nErr=counts[b.dataset.tab]||0; if(!nErr)return;
    var sp=document.createElement('span'); sp.className='ebadge'; sp.title=nErr+' lỗi dữ liệu ở tab này'; sp.textContent=nErr;
    b.appendChild(sp);
  });
}
function renderTabBanner(vs){
  var act=document.querySelector('.tab.active'); if(!act)return;
  var box=act.querySelector('.tabMsg'); if(!box)return;
  if(act.id==='t7'){ box.innerHTML=''; return; }   /* Tab 7 tự liệt kê trong renderSimulationResults */
  var errs=vs.filter(function(v){ return v.level==='error' && v.tab===act.id; });
  box.innerHTML = errs.length
    ? '<div class="warnbar" style="margin:0 0 10px;">⚠ <div><b>'+errs.length+' lỗi ở tab này — mô phỏng tạm dừng cho đến khi sửa:</b><ul style="margin:4px 0 0 18px;">'+errs.map(function(e){ return '<li>'+esc(e.msg)+'</li>'; }).join('')+'</ul></div></div>'
    : '';
}
/* U06 — chỉ dẫn dữ liệu mẫu: các tab còn nguyên bộ mẫu mặc định thì nói rõ để người mới không tưởng là hồ sơ mình */
function renderSampleBadge(){
  var el=$('sampleBadge'); if(!el)return;
  var same=function(a,b){ return JSON.stringify(a)===JSON.stringify(b); };
  var parts=[];
  if(same(state.periods,defaultState.periods))parts.push('giai đoạn BHXH');
  if(same(state.landPlots,defaultState.landPlots))parts.push('BĐS');
  if(same(state.milestones,defaultState.milestones))parts.push('mốc chi');
  if(same(state.events,defaultState.events))parts.push('sự kiện');
  el.innerHTML = parts.length
    ? '<div class="hint" style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:6px 10px;margin:0 0 8px;">⚠ Đang dùng <b>dữ liệu mẫu</b> ('+parts.join(', ')+') — sửa hoặc xóa cho hồ sơ của bạn.</div>'
    : '';
}
/* Signature toàn trạng thái — đặt lại sau mỗi lần refresh; ui/profiles.js so với baseline hồ sơ
   đang mở để hiển thị "có thay đổi chưa lưu" và làm mốc chữ ký cho kết quả kiểm tra rủi ro. */
var stateSignature='';
function refresh(){
  readInputs();
  ensureSeries();
  var vs=validateState();   /* F14 — validate sớm, trước các khối tính hiển thị nặng */
  renderNavBadges(vs);
  renderTabBanner(vs);
  renderSampleBadge();
  var signature=JSON.stringify(state);
  stateSignature=signature;
  if(signature!==lastRiskSignature){$('riskOut').textContent='Cấu hình đã thay đổi — bấm Kiểm tra rủi ro để tính lại.';lastRiskSignature=signature;}
  $('migrationNotice').textContent=migrationMessages.join(' ');
  var s = bhxhSummary();
  renderTab1(s);
  renderPeopleTabs();   /* M1 — tab con chọn người trong Tab 3 */
  renderPersonMeta();
  renderPensionDetails();         /* chi tiết BHXH theo người đang chọn */
  renderFamilySummary();
  renderAssetLabels();
  renderPlots();
  renderMilestones();
  renderEvents('chi', 'evChiList');
  renderEvents('thu', 'evThuList');
  renderIncomePeriods();
  renderInvestmentPlan();
  renderSeriesChart('scGold','gold','Vàng',ASSET_COLORS.gold.c);
  renderSeriesChart('scCP','cp','Quỹ Cổ phiếu/ETF',ASSET_COLORS.cp.c);
  renderSeriesChart('scLand','land','Bất động sản',ASSET_COLORS.land.c);
  if($('t7').classList.contains('active')) renderSimulationResults(vs);
  if(typeof renderCompareTab==='function' && $('t8').classList.contains('active')) renderCompareTab(); /* Tab 8 what-if độc lập — chỉ tính khi đang mở */
  saveState(); /* mỗi lần cấu hình / dữ liệu thay đổi → lưu lại toàn bộ (F5 giữ nguyên) */
  if(typeof profileAfterRefresh==='function')profileAfterRefresh(); /* hồ sơ: trạng thái chưa lưu + bản nháp tự lưu */
}

/* Đổ state trở lại các ô nhập tĩnh trong HTML (các danh sách động tự render từ state trong refresh) */
function writeInputs(){
  $('startMonth').value=('0'+(state.startMonth%12+1)).slice(-2)+'/'+Math.floor(state.startMonth/12);
  $('mainName').value=state.mainName||'';
  $('birthYear').value=vnNumStr(state.birthYear);$('gender').value=state.gender;$('simYears').value=vnNumStr(state.simYears);$('infl').value=vnNumStr(state.infl);
  ['mmf','tk','tp','cp'].forEach(function(k){$('a'+k.toUpperCase()).value=fmtMoney(state.assets[k]);});
  $('goldChi').value=vnNumStr(state.goldChi);$('goldPrice').value=fmtMoney(state.goldPrice);$('goldSpread').value=vnNumStr(Math.round(state.goldSpread*100)/100);   /* làm tròn 2 chữ số — bản lưu cũ tính chênh lệch từ giá mua/bán có nhiễu float */
  $('rMMF').value=vnNumStr(state.rates.mmf);$('rTK').value=vnNumStr(state.rates.tk);$('rTP').value=vnNumStr(state.rates.tp);
  $('rTKShort').value=vnNumStr(state.rates.tkShort);$('rTKMedium').value=vnNumStr(state.rates.tkMedium);
  $('tpEarlyFee').value=vnNumStr(state.rates.tpEarlyFee===undefined?2:state.rates.tpEarlyFee);
  $('tpMinMonths').value=vnNumStr(state.rates.tpMinMonths===undefined?12:state.rates.tpMinMonths);
  $('cpBuyFee').value=vnNumStr(state.rates.cpBuyFee||0);$('cpSellFee').value=vnNumStr(state.rates.cpSellFee||0);
  $('sellRule').value=state.sellRule;
  if(typeof cmpWrite==='function')cmpWrite();   /* Tab 8 — Tối ưu đóng BHXH */
  writePensionInputs();
}

/* Ô tiền (class="money") — áp cho cả ô render động. Chính sách TỰ ĐỊNH DẠNG (S03, 03/10/2026):
   người dùng gõ KHÔNG cần quan tâm dấu chấm/phẩy phân nhóm — phần mềm tự đặt lại ngay khi gõ:
   - TRONG LÚC GÕ: dấu chấm/phẩy/khoảng trắng bị bỏ qua (gõ sai vị trí cũng vậy), dãy chữ số còn lại
     được viết lại thành dạng chuẩn có chấm ngàn (fmtMoney) và con trỏ trả về đúng vị trí chữ số
     đang đứng. Xóa/sửa giữa chuỗi không còn làm nhóm lệch → ô đỏ → hoàn tác như bản cũ.
   - Chuỗi còn ký tự khác chữ số (chữ, +, -, e…) hoặc quá 15 chữ số: tô đỏ NGAY và KHÔNG đổi good
     (giữ giá trị hợp lệ trước đó — R02); rời ô hoàn tác về giá trị lúc vào ô.
   - `dataset.good` CHỈ chứa dãy chữ số thuần của chuỗi hợp lệ — mọi giá trị đọc từ good là số hữu hạn.
   - RỜI Ô: chuỗi luôn đã chuẩn → fmtMoney lần cuối; nhánh hoàn tác giữ làm lưới an toàn.
   - moneyParse/moneyEditValue (ui/common.js) giữ nguyên làm tầng đọc/fallback — bộ test phụ thuộc. */
document.addEventListener('input', function(ev){
  var el = ev.target;
  if(!el.classList || !el.classList.contains('money')) return;
  var raw = String(el.value);
  var caret = (el.selectionStart !== null && el.selectionStart !== undefined) ? el.selectionStart : raw.length;
  var digitsBefore = raw.slice(0, caret).replace(/[^0-9]/g, '').length;  /* neo con trỏ: số chữ số trước caret */
  var stripped = raw.replace(/[.,\s]/g, '');            /* dấu phân nhóm người dùng gõ — phần mềm tự quản */
  var digits = stripped.replace(/[^0-9]/g, '');
  if(/[^0-9]/.test(stripped)){ setMoneyBad(el, moneyErr(raw)); return; } /* chữ/+/-/e… — đỏ, giữ good cũ */
  if(digits.length > 15){ setMoneyBad(el, 'Quá 15 chữ số — kiểm tra lại số tiền.'); return; }
  var formatted = digits ? fmtMoney(+digits) : '';
  if(formatted !== raw){
    el.value = formatted;
    if(el.setSelectionRange){
      var pos = 0, seen = 0;
      while(pos < formatted.length && seen < digitsBefore){ if(/[0-9]/.test(formatted.charAt(pos))) seen++; pos++; }
      try{ el.setSelectionRange(pos, pos); }catch(e){}
    }
  }
  setMoneyBad(el, null);
  if(el.dataset) el.dataset.good = digits || '0';
});
document.addEventListener('focusin', function(ev){
  var el = ev.target;
  if(el.classList && el.classList.contains('money')){
    el.dataset.focusVal = el.value;
    /* S01 — giá trị hợp lệ ĐẦU PHIÊN: mọi lệnh đọc khi chuỗi đang sai phải quay về đây */
    var g = el.dataset.good !== undefined ? el.dataset.good : String(moneyParse(el.value));
    el.dataset.focusGood = isFinite(+g) ? g : '0';
  }
});
document.addEventListener('focusout', function(ev){
  var el = ev.target;
  if(!el.classList || !el.classList.contains('money')) return;
  var v = moneyParse(el.value);
  if(isNaN(v)) v = moneyEditValue(el.value);          /* nhóm-dở: cùng diễn giải với moneyVal (S01) */
  if(!isNaN(v)){ el.value = v ? fmtMoney(v) : ''; setMoneyBad(el, null); el.dataset.good = String(v); scheduleRefresh(); return; }
  el.value = el.dataset.focusVal !== undefined ? el.dataset.focusVal : (el.dataset.good !== undefined ? fmtMoney(+el.dataset.good) : '');
  /* S01 — đồng bộ good về giá trị đầu phiên: node có thể không được dựng lại (diff không đổi)
     nên good trung gian nhiễm bẩn phải được xóa ngay tại đây */
  if(el.dataset.focusGood !== undefined) el.dataset.good = el.dataset.focusGood;
  setMoneyBad(el, null);
  scheduleRefresh();
});

/* Bật tab — dùng chung cho nút nav (màn hình rộng) và dropdown chọn tab (điện thoại, ≤760px).
   navSetTab chỉ đổi trạng thái active + đồng bộ dropdown; caller tự gọi refresh(). */
function navSetTab(tab){
  document.querySelectorAll('nav button').forEach(function(x){ x.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(x){ x.classList.remove('active'); });
  var nb = document.querySelector('nav button[data-tab="'+tab+'"]');
  if(nb) nb.classList.add('active');
  var sec = $(tab); if(sec) sec.classList.add('active');
  var ns = $('navTabsSelect'); if(ns) ns.value = tab;
}
document.querySelectorAll('nav button').forEach(function(b){
  b.onclick = function(){ navSetTab(b.dataset.tab); refresh(); };
});
/* Dropdown chọn tab trên màn hẹp — dựng sẵn option từ nút nav để không lệch tên khi sửa label */
var navSel = $('navTabsSelect');
if(navSel){
  document.querySelectorAll('nav button[data-tab]').forEach(function(b){
    var lab = '';
    b.childNodes.forEach(function(n){ if(n.nodeType === 3) lab += n.textContent; });
    var o = document.createElement('option');
    o.value = b.dataset.tab; o.textContent = lab.trim();
    navSel.appendChild(o);
  });
  navSel.onchange = function(){ navSetTab(navSel.value); refresh(); };
}
document.querySelectorAll('input, select').forEach(function(el){
  if(el.id === 'navTabsSelect') return;   /* dropdown tab tự xử lý change phía trên */
  el.addEventListener('change', scheduleRefresh);
});

/* ===== Phục hồi dữ liệu đã lưu (nếu có) trước khi render lần đầu — F5 giữ nguyên mọi cấu hình & chuỗi lãi suất ===== */
loadState();
writeInputs();
seedMoneyGood(document);
refresh();
/* Hồ sơ (profile) — khởi động SAU boot chính: dò dịch vụ local, khôi phục "hồ sơ đang mở", bản nháp */
if(typeof profileBarInit==='function')profileBarInit();
