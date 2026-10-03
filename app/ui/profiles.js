'use strict';
/* [ui/profiles.js] Quản lý hồ sơ (profile) — mỗi hồ sơ là MỘT file JSON trong thư mục profiles
   (dịch vụ local app/server.js). Thanh hồ sơ phía trên 7 tab gọn: chọn hồ sơ / Lưu / Lưu thành bản
   mới / Quản lý + trạng thái "đã lưu / có thay đổi chưa lưu / không lưu được". Dialog Quản lý (đợt 30
   — rộng co theo màn hình) chỉ còn ＋ Hồ sơ mới + Nhập JSON phía trên; mọi thao tác theo hồ sơ nằm
   TRÊN TỪNG HÀNG: Mở · Xuất (tải JSON của đúng hồ sơ đó) · Đổi tên · Nhân bản · Xóa → _trash;
   hồ sơ đang mở tô sáng kèm chip; offline (không dịch vụ) vẫn Nhập được và Xuất bản đang hiển thị.
   Bản nháp tự lưu vào profiles/_draft/<id>.json (trì hoãn 1,2s sau mỗi lần refresh) — khi mở lại
   hồ sơ có bản nháp mới hơn file thì báo phục hồi.
   Xung đột ghi: PUT kèm ?rev=<revision>; server trả 409 khi file đã bị sửa từ ngoài → hỏi ghi đè.
   Nạp giữa ui/results.js và ui/app.js; app.js gọi profileBarInit() cuối boot.
   ĐỌC: state, NOW, defaultState, stateSignature (app.js đặt sau mỗi refresh), lastRiskSignature
   (results.js). GHI: state (qua migrateState khi mở/nhập), localStorage CHỈ qua persist.js
   (getOpenProfileMeta/setOpenProfileMeta/resetRescueFlags). Không đụng localStorage trực tiếp. */

var prService = null;        /* {dir} khi dịch vụ hồ sơ trả lời được; null = offline (file:// hoặc server tĩnh) */
var prList = [];             /* danh sách entry từ GET /api/profiles */
var prOpen = null;           /* hồ sơ đang mở: {file,id,name,description,revision,createdAt,savedAt} */
var prSavedSignature = '';   /* signature state tại lần mở/lưu file gần nhất (so với stateSignature) */
var prBaselinePending = false; /* chốt baseline ngay sau lần refresh đầu tiên sau khi mở */
var prRiskRun = null;        /* kết quả kiểm tra rủi ro gần nhất của cấu hình hiện tại (kèm sig) */
var prPendingCfYear = null;  /* khóa cfYear cũ nay là năm đang mở ở bảng năm Tab 7 */
var prDraftTimer = null, prDraftBanner = null, prLastSaveError = '', prOfflineImported = '';

/* ===== Gọi API của app/server.js — fetch tương đối; lỗi trả Error (status, conflict) ===== */
function prApi(method, path, body){
  if(typeof fetch !== 'function') return Promise.reject(new Error('Trình duyệt không có fetch'));
  return fetch(path, {
    method: method,
    headers: body !== undefined ? {'Content-Type':'application/json'} : undefined,
    body: body !== undefined ? String(body) : undefined
  }).then(function(r){
    return r.text().then(function(t){
      var o = null; try{ o = t ? JSON.parse(t) : null; }catch(e){}
      if(!r.ok){
        var err = new Error((o && o.error) || ('Lỗi ' + r.status + ' từ dịch vụ hồ sơ'));
        err.status = r.status; err.conflict = o && o.conflict; throw err;
      }
      return o || {};
    });
  });
}
function prTime(iso){
  if(!iso) return '—';
  var d = new Date(iso); if(isNaN(d)) return '—';
  return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}
/* Ghi MỚI một file hồ sơ (?create=1). Trúng 409 "đã có file" (id trùng — hiếm: cùng tên, cùng phút,
   cùng hex) thì sinh id khác và thử lại tối đa 3 lần thay vì báo lỗi người dùng (đợt 12). */
function prPutCreate(payload, attempt){
  attempt = attempt || 0;
  return prApi('PUT', '/api/profiles/file/'+encodeURIComponent(payload.id+'.json')+'?create=1', JSON.stringify(payload))
    .catch(function(e){
      if(e.status === 409 && attempt < 3){ payload.id = newProfileId(payload.name || payload.id); return prPutCreate(payload, attempt + 1); }
      throw e;
    });
}
function prDirty(){ return stateSignature !== prSavedSignature; }

/* ===== Trạng thái xem (viewState): tab đang mở + năm đang mở trong bảng năm Tab 7.
   activePerson đã nằm trong state nên không cần lưu riêng. ===== */
function prCaptureViewState(){
  var act = document.querySelector('nav button.active');
  return { tab: act ? act.dataset.tab : 't1', cfYear: openYearActionYear||prPendingCfYear||null };
}
function prActivateTab(tab){
  var b = document.querySelector('nav button[data-tab="'+tab+'"]');
  if(!b) return;
  document.querySelectorAll('nav button').forEach(function(x){ x.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(x){ x.classList.remove('active'); });
  b.classList.add('active');
  var sec = $(b.dataset.tab); if(sec) sec.classList.add('active');
}

/* Đổi dữ liệu đang chạy sang một profile/bản nháp: migrate trên bản sao, NOW theo tháng gốc mới,
   gỡ cờ lỗi lưu cũ, XÓA cache vẽ danh sách (handler cũ đóng danh tính đối tượng của state cũ) rồi
   vẽ lại toàn bộ. refresh() cuối sẽ gọi profileAfterRefresh → chốt baseline "đã khớp file".
   baseline=false (phục hồi bản nháp): dữ liệu phục hồi KHÁC file nên phải hiện "chưa lưu". */
function prApplyState(p, baseline){
  clearTimeout(prDraftTimer);
  migrationMessages.length = 0;
  state = migrateState(JSON.parse(JSON.stringify(p.state)));
  if(isFinite(state.startMonth)) NOW = state.startMonth;
  resetRescueFlags();
  lastRiskSignature = '';
  prInvalidateRenderCaches();
  openYearActionYear = null;
  prPendingCfYear = (p.viewState && p.viewState.cfYear) ? String(p.viewState.cfYear) : null;
  if(p.viewState && p.viewState.tab) prActivateTab(p.viewState.tab);
  prBaselinePending = baseline !== false;
  if(baseline === false) prSavedSignature = '';
  writeInputs();
  seedMoneyGood(document);
  refresh();
}
/* Handler danh sách đóng danh tính ĐỐI TƯỢNG state lúc gắn — profile mới có đối tượng mới nên
   mọi cache "__html" phải bị gỡ để refresh dựng lại handler với đối tượng của hồ sơ vừa mở. */
function prInvalidateRenderCaches(){
  document.querySelectorAll('main *').forEach(function(el){
    if('__html' in el){ delete el.__html; }
  });
}

/* ===== Hook từ refresh() (app.js) — chạy sau mỗi lần vẽ + lưu localStorage ===== */
function profileAfterRefresh(){
  if(prBaselinePending){ prBaselinePending = false; prSavedSignature = stateSignature; }
  if(prPendingCfYear && $('t7').classList.contains('active')){
    if(typeof setYearActionOpen === 'function')setYearActionOpen(prPendingCfYear);
    prPendingCfYear = null;
  }
  prRenderBar();
  if(prOpen && prService && prDirty()){
    /* Chỉ ghi bản nháp khi CÓ thay đổi chưa lưu — trạng thái khớp file thì nháp chỉ gây nhiễu */
    clearTimeout(prDraftTimer);
    prDraftTimer = setTimeout(prSaveDraft, 1200);
  }
  /* Nháp cũ còn treo (khác dữ liệu) trong khi dữ liệu đã khớp file → là rác của phiên cũ: gỡ luôn */
  if(prOpen && prService && !prDirty() && prDraftBanner){
    prDeleteDraftQuiet();
    prRenderBar();
  }
}
/* Hook từ results.js sau khi kiểm tra rủi ro xong — seed ghi lại chỉ để nhận diện/tái hiện lượt cũ.
   sig = băm ngắn của signature cấu hình lúc chạy: cấu hình đổi thì kết quả cũ bị coi là hết hiệu lực,
   không lưu kèm hồ sơ nữa (so khớp bằng cùng hàm băm, không nhúng cả state vào file). */
function prSigHash(s){
  var h = 5381;
  for(var i = 0; i < s.length; i++){ h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
  return 'h' + h.toString(16);
}
function profileNoteRiskRun(r, seed){
  prRiskRun = { at:new Date().toISOString(), modelVersion:MODEL_VERSION, strategyVersion:STRATEGY_ENGINE_VERSION, sig:prSigHash(stateSignature),
    n:r.n, p10:r.p10, p50:r.p50, p90:r.p90, runOutRate:r.runOutRate,
    medianRunOutAge:r.medianRunOutAge, avgShortfall:r.avgShortfall, seed:seed||null };
}
function prRiskRunUsable(){ return prRiskRun && prRiskRun.modelVersion===MODEL_VERSION && prRiskRun.strategyVersion===STRATEGY_ENGINE_VERSION && prRiskRun.sig === prSigHash(stateSignature) ? prRiskRun : null; }

/* ===== Bản nháp tự động (server-side, theo id hồ sơ đang mở) ===== */
function prSaveDraft(){
  if(!prOpen || !prService) return;
  var payload = { id:prOpen.id, name:prOpen.name, savedAt:new Date().toISOString(),
    state:state, viewState:prCaptureViewState() };
  prApi('PUT', '/api/draft/'+encodeURIComponent(prOpen.id), JSON.stringify(payload))
    .catch(function(){ /* bản nháp là tiện ích — lỗi im lặng, file chính vẫn là nơi lưu thật */ });
}
function prDeleteDraftQuiet(){
  if(prOpen && prService) prApi('DELETE','/api/draft/'+encodeURIComponent(prOpen.id)).catch(function(){});
  prDraftBanner = null;
}
function prCheckDraft(){
  if(!prOpen || !prService){ prDraftBanner = null; prRenderBar(); return; }
  prApi('GET','/api/draft/'+encodeURIComponent(prOpen.id)).then(function(d){
    /* Chỉ báo nháp khi dữ liệu đang chạy KHỚP file (nghĩa là bản nháp giữ việc chưa lưu mà
       localStorage đã mất). Đang dirty thì localStorage luôn mới bằng hoặc mới hơn nháp (nháp được
       ghi sau localStorage 1,2s) — đưa nháp ra chỉ khiến người dùng lùi dữ liệu. */
    var cleanNow = !prDirty();
    var newer = d && d.state && d.savedAt &&
      (!prOpen.savedAt || Date.parse(d.savedAt) > Date.parse(prOpen.savedAt) - 500);
    var differs = d && d.state && JSON.stringify(d.state) !== JSON.stringify(state);
    prDraftBanner = (cleanNow && newer && differs) ? { savedAt:d.savedAt, state:d.state, viewState:d.viewState||null } : null;
    prRenderBar();
  }).catch(function(){ prDraftBanner = null; });
}
function prRestoreDraft(){
  var b = prDraftBanner; if(!b || !b.state) return;
  prDraftBanner = null;
  prApplyState({ state:b.state, viewState:b.viewState }, false);
}

/* ===== Danh sách + thanh trạng thái ===== */
function prRefreshList(){
  if(!prService) return Promise.resolve();
  return prApi('GET','/api/profiles').then(function(r){
    prService = { dir:r.dir || prService.dir };
    prList = r.profiles || [];
    prRenderBar();
  }).catch(function(){ /* giữ danh sách cũ */ });
}
function prRenderBar(){
  var sel = $('profileSelect'), st = $('profileStatus');
  if(!sel || !st) return;
  var h = '<option value="">' + (prList.length ? '— chọn hồ sơ để mở —' : '— chưa có hồ sơ —') + '</option>';
  prList.forEach(function(e){
    h += '<option value="'+esc(e.file)+'">'+esc(e.name || e.file)+(e.ok?'':' (lỗi đọc)')+'</option>';
  });
  sel.innerHTML = h;
  sel.disabled = !prService;
  if(prOpen && prList.some(function(e){ return e.file === prOpen.file; })){ sel.value = prOpen.file; }
  ['prSave','prSaveAs','prManage'].forEach(function(id){ var b=$(id); if(b)b.disabled = !prService; });

  /* Thanh nằm TRÊN NỀN XANH header (đợt 10): chỉ dùng màu sáng — .ps-saved/.ps-dirty/.ps-err */
  var html = '';
  if(!prService){
    html = '<span class="ps-err">⚠ Chưa nối được dịch vụ hồ sơ</span> — hãy khởi động bằng cách <b>nhấp đúp LifeHorizon.bat</b> trong thư mục dự án (hoặc chạy <b>npm run serve</b>) rồi mở qua địa chỉ nó in ra. Dữ liệu vẫn tự lưu trong trình duyệt.' +
      (prOfflineImported ? ' Đã nhập hồ sơ <b>'+esc(prOfflineImported)+'</b> từ file vào phiên làm việc.' : '');
  } else {
    if(prLastSaveError) html += '<span class="ps-err">⚠ Không lưu được: '+esc(prLastSaveError)+'</span> · ';
    if(!prOpen){
      html += prList.length
        ? 'Chưa mở hồ sơ nào — đang dùng dữ liệu trong trình duyệt. Chọn ở danh sách, hoặc bấm <b>Lưu</b> để tạo hồ sơ.'
        : 'Thư mục hồ sơ trống — tạo hồ sơ đầu tiên từ dữ liệu đang có. <button type="button" class="hbtn primary" id="prFirstSave">＋ Tạo hồ sơ đầu tiên</button>';
      if(prOfflineImported) html += ' Đã nhập hồ sơ <b>'+esc(prOfflineImported)+'</b> từ file vào phiên làm việc.';
    } else if(prDirty()){
      html += '<b class="ps-dirty">● Có thay đổi chưa lưu</b> — '+esc(prOpen.name);
    } else {
      html += '<b class="ps-saved">✓ Đã lưu vào file</b> — '+esc(prOpen.name)+' · lần lưu thứ '+prOpen.revision+
        (prOpen.savedAt ? ' · '+prTime(prOpen.savedAt) : '');
    }
  }
  if(prDraftBanner){
    html += '<div>🕒 Có bản nháp tự lưu lúc '+prTime(prDraftBanner.savedAt)+' mới hơn file — '+
      '<button type="button" class="hbtn primary" id="prDraftRestore">Phục hồi bản nháp</button> '+
      '<button type="button" class="hbtn" id="prDraftDrop">Gỡ bản nháp</button></div>';
  }
  st.innerHTML = html;
  var fb = $('prFirstSave'); if(fb) fb.onclick = function(){ prDialogSaveAs(); };
  var rd = $('prDraftRestore'); if(rd) rd.onclick = function(){ prRestoreDraft(); };
  var dd = $('prDraftDrop'); if(dd) dd.onclick = function(){ prDeleteDraftQuiet(); prRenderBar(); };
}

/* ===== Mở hồ sơ từ file trong thư mục ===== */
function prOpenByFile(file){
  if(!prService) return;
  if(prOpen && prOpen.file === file && !prDirty()){ prRenderBar(); return; }
  prGuardDirty(function(){
    prApi('GET','/api/profiles/file/'+encodeURIComponent(file)).then(function(p){
      var errs = profileStructuralErrors(p);
      if(errs.length){
        appDialog({title:'File hồ sơ có lỗi', html:errs.map(esc).join('<br>'), okText:'Đã hiểu'});
        return;
      }
      prOpen = { file:file, id:p.id, name:p.name, description:p.description||'', revision:p.revision||1,
        createdAt:p.createdAt||new Date().toISOString(), savedAt:p.updatedAt||null };
      setOpenProfileMeta({ file:file, id:prOpen.id, name:prOpen.name, revision:prOpen.revision, savedAt:prOpen.savedAt });
      prOfflineImported = '';
      prLastSaveError = '';
      prRiskRun = p.lastRiskRun || null;
      prApplyState(p);
      prRenderRiskOut();
      prRefreshList();
      prCheckDraft();
    }).catch(function(e){
      appDialog({title:'Không mở được hồ sơ', html:esc(e.message), okText:'Đã hiểu'});
    });
  });
}

/* ===== Khôi phục hiển thị kết quả kiểm tra rủi ro lưu kèm hồ sơ ===== */
function prRenderRiskOut(){
  var el = $('riskOut'); if(!el) return;
  if(!prRiskRun){ el.textContent = 'Chưa có kết quả kiểm tra rủi ro cho hồ sơ này — bấm nút để chạy.'; return; }
  var r = prRiskRun, stale = r.modelVersion !== MODEL_VERSION || !prRiskRunUsable();
  el.innerHTML = '<b>'+fmtNumVN(r.n,0)+' kịch bản (lần chạy lưu lúc '+prTime(r.at)+(stale
    ? ' — cấu hình hoặc mô hình đã đổi so với lần chạy (mô hình v'+r.modelVersion+') — nên chạy lại'
    : '')+'):</b> thanh khoản cuối kỳ theo giá hiện tại — P10 <b style="color:#b45309">'+fmtTr(r.p10)+
    '</b> · P50 <b>'+fmtTr(r.p50)+'</b> · P90 <b style="color:#059669">'+fmtTr(r.p90)+'</b>'+
    ' · <b style="color:'+(r.runOutRate>0?'#dc2626':'#059669')+'">'+pct(r.runOutRate)+' kịch bản cạn tiền</b>'+
    (r.runOutRate > 0 ? ' — tuổi cạn trung vị <b>'+r.medianRunOutAge+'</b>, mức thiếu bq '+fmtTr(r.avgShortfall)+'/kịch bản' : ' — không kịch bản nào cạn tiền');
}

/* ===== Lưu / Lưu thành bản mới / xung đột ===== */
function prMarkSaved(revision, savedAt){
  prOpen.revision = revision;
  prOpen.savedAt = savedAt || prOpen.savedAt;
  setOpenProfileMeta({ file:prOpen.file, id:prOpen.id, name:prOpen.name, revision:revision, savedAt:prOpen.savedAt });
  prSavedSignature = stateSignature;
  prLastSaveError = '';
  prDeleteDraftQuiet();
  prRefreshList();
}
function prDoSave(){
  return new Promise(function(resolve){
    if(!prService){
      appDialog({title:'Chưa có dịch vụ hồ sơ', html:'Ứng dụng không nối được dịch vụ local nên không ghi được file hồ sơ. Hãy khởi động bằng cách <b>nhấp đúp LifeHorizon.bat</b> trong thư mục dự án (hoặc chạy <b>npm run serve</b>) rồi mở qua địa chỉ nó in ra; hoặc dùng <b>Xuất JSON</b> để tải bản sao về máy.', okText:'Đã hiểu'});
      resolve(false); return;
    }
    if(!prOpen){ prDialogSaveAs().then(resolve); return; }
    var payload = buildProfile(prOpen, prOpen.name, prOpen.description, state, prCaptureViewState(), prRiskRunUsable(), (prOpen.revision||0)+1);
    prApi('PUT', '/api/profiles/file/'+encodeURIComponent(prOpen.file)+'?rev='+(prOpen.revision||0), JSON.stringify(payload))
    .then(function(res){ prMarkSaved(payload.revision, res.savedAt); resolve(true); })
    .catch(function(e){
      if(e.status === 409 && e.conflict){
        appDialog({title:'Hồ sơ đã bị sửa từ nơi khác',
          html:'File <b>'+esc(prOpen.file)+'</b> có lần lưu mới hơn (lúc '+prTime(e.conflict.mtime)+') so với lần bạn mở. Ghi đè lên bản trên file?',
          okText:'Ghi đè bản ngoài', cancelText:'Huỷ'})
        .then(function(over){
          if(!over){ resolve(false); return; }
          prApi('PUT', '/api/profiles/file/'+encodeURIComponent(prOpen.file)+'?force=1', JSON.stringify(payload))
          .then(function(res){ prMarkSaved(payload.revision, res.savedAt); resolve(true); })
          .catch(function(e2){ prLastSaveError = e2.message; prRenderBar(); appDialog({title:'Không lưu được hồ sơ', html:esc(e2.message), okText:'Đã hiểu'}); resolve(false); });
        });
        return;
      }
      prLastSaveError = e.message; prRenderBar();
      appDialog({title:'Không lưu được hồ sơ', html:esc(e.message), okText:'Đã hiểu'});
      resolve(false);
    });
  });
}
function prDialogSaveAs(){
  return new Promise(function(resolve){
    if(!prService){
      appDialog({title:'Chưa có dịch vụ hồ sơ', html:'Không ghi được file hồ sơ — hãy khởi động bằng <b>LifeHorizon.bat</b> (nhấp đúp) hoặc <b>npm run serve</b>, hoặc dùng <b>Xuất JSON</b> để tải bản sao về máy.', okText:'Đã hiểu'});
      resolve(false); return;
    }
    var defName = (prOpen && prOpen.name) || (state.mainName && String(state.mainName).trim()) || 'Hồ sơ của tôi';
    appDialog({title:'Lưu thành hồ sơ mới', html:
      '<label for="prAsName">Tên hồ sơ</label><input id="prAsName" maxlength="60" value="'+esc(defName)+'">'+
      '<label for="prAsDesc" style="margin-top:8px">Ghi chú (tùy chọn)</label><textarea id="prAsDesc" rows="2"></textarea>'+
      '<div class="hint">Hồ sơ được ghi thành một file JSON trong thư mục hồ sơ; tên hiển thị đổi sau được, mã file giữ nguyên.</div>',
      okText:'Lưu hồ sơ', cancelText:'Huỷ'})
    .then(function(ok){
      if(!ok){ resolve(false); return; }
      var name = ($('prAsName') && $('prAsName').value.trim()) || 'Hồ sơ không tên';
      var desc = $('prAsDesc') ? $('prAsDesc').value : '';
      /* Đợt 12 sửa lỗi: base phải là null — truyền prOpen làm buildProfile giữ nguyên id (chính là
         tên file) của hồ sơ đang mở → server chặn "Đã có file cùng tên". Bản mới = id mới. */
      var payload = buildProfile(null, name, desc, state, prCaptureViewState(), prRiskRunUsable(), 1);
      prPutCreate(payload)
      .then(function(res){
        prOpen = { file:payload.id+'.json', id:payload.id, name:name, description:desc,
          revision:1, createdAt:payload.createdAt, savedAt:res.savedAt };
        prOfflineImported = '';
        prMarkSaved(1, res.savedAt);
        resolve(true);
      })
      .catch(function(e){
        appDialog({title:'Không lưu được hồ sơ', html:esc(e.message), okText:'Đã hiểu'});
        resolve(false);
      });
    });
  });
}
function prNew(){
  prGuardDirty(function(){
    appDialog({title:'Hồ sơ mới — bắt đầu từ dữ liệu mẫu',
      html:'<label for="prNewName">Tên hồ sơ</label><input id="prNewName" maxlength="60" value="Hồ sơ mới">'+
        '<label for="prNewDesc" style="margin-top:8px">Ghi chú (tùy chọn)</label><textarea id="prNewDesc" rows="2">Bộ dữ liệu mẫu LifeHorizon — chưa chỉnh.</textarea>'+
        '<div class="hint">Hồ sơ mới dùng toàn bộ số liệu mẫu mặc định (khác hồ sơ đang mở).</div>',
      okText:'Tạo hồ sơ', cancelText:'Huỷ'})
    .then(function(ok){
      if(!ok) return;
      var name = ($('prNewName') && $('prNewName').value.trim()) || 'Hồ sơ mới';
      var desc = $('prNewDesc') ? $('prNewDesc').value : '';
      var fresh = JSON.parse(JSON.stringify(defaultState));
      fresh.startMonth = NOW;
      fresh.lifePlan = newLifePlan(NOW);
        fresh.investmentPlan = newInvestmentPlan(NOW);
      var payload = buildProfile(null, name, desc, fresh, null, null, 1);
      prPutCreate(payload)
      .then(function(res){
        prOpen = { file:payload.id+'.json', id:payload.id, name:name, description:desc,
          revision:1, createdAt:payload.createdAt, savedAt:res.savedAt };
        setOpenProfileMeta({ file:prOpen.file, id:prOpen.id, name:name, revision:1, savedAt:res.savedAt });
        prOfflineImported = '';
        prRiskRun = null;
        prApplyState(payload);
        prRenderRiskOut();
        prRefreshList();
      })
      .catch(function(e){ appDialog({title:'Không tạo được hồ sơ', html:esc(e.message), okText:'Đã hiểu'}); });
    });
  });
}

/* ===== Chuyển hồ sơ khi còn thay đổi chưa lưu: Lưu và chuyển → Bỏ thay đổi → Ở lại ===== */
function prGuardDirty(then){
  if(!prDirty()){ then(); return; }
  var name = prOpen ? prOpen.name : 'dữ liệu trong trình duyệt';
  appDialog({title:'Có thay đổi chưa lưu',
    html:'Thay đổi đang có chưa lưu vào <b>'+esc(name)+'</b>. Lưu trước khi chuyển?',
    okText: prOpen ? 'Lưu và chuyển' : 'Chưa có hồ sơ để lưu — chuyển luôn', cancelText:'Chưa'})
  .then(function(save){
    if(save && prOpen){ prDoSave().then(function(ok){ if(ok) then(); }); return; }
    if(save){ then(); return; }
    appDialog({title:'Bỏ thay đổi?', html:'Bỏ toàn bộ thay đổi chưa lưu và chuyển luôn?', okText:'Bỏ thay đổi, chuyển luôn', cancelText:'Ở lại'})
    .then(function(discard){ if(discard) then(); });
  });
}

/* ===== Màn hình Quản lý: mở / xuất / đổi tên / nhân bản / xóa (→ _trash) theo TỪNG HÀNG;
   phía trên chỉ còn ＋ Hồ sơ mới + Nhập JSON (đợt 30 — bỏ "Xuất JSON"/"Xóa hồ sơ đang mở" khỏi
   thanh công cụ vì mỗi hàng đã có nút Xuất/Xóa riêng; offline vẫn Nhập + Xuất bản đang hiển thị). ===== */
function prManage(){
  prLastSaveError = '';
  if(!prService){ prRenderManage(); return; }
  prRefreshList().then(prRenderManage);
}
function prManageToolbar(){
  var h = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  if(prService){
    h += '<button type="button" class="btn" id="prMgNew" title="Bắt đầu hồ sơ mới từ bộ dữ liệu mẫu">＋ Hồ sơ mới</button>';
  }
  h += '<button type="button" class="btn" id="prMgImport" title="Thêm hồ sơ từ file JSON trên máy">Nhập JSON</button>';
  if(!prService){
    /* Offline không có danh sách để gắn nút Xuất từng hàng — chỉ xuất được bản đang hiển thị */
    h += '<button type="button" class="btn" id="prMgExport" title="Tải bản đang hiển thị thành file JSON (gồm cả thay đổi chưa lưu)">Xuất JSON (bản đang mở)</button>';
  }
  return h + '</div>';
}
function prRenderManage(){
  var listHtml = '';
  if(prService){
    var rows = prList.map(function(e){
      if(!e.ok){
        return '<tr><td style="text-align:left">'+esc(e.file)+'</td><td colspan="2" style="color:#b91c1c;text-align:left">⚠ '+esc(e.error||'lỗi đọc file')+'</td>'+
          '<td class="mact"><button type="button" class="btn mini" data-mdel="'+esc(e.file)+'">Xóa file lỗi</button></td></tr>';
      }
      var now = prOpen && prOpen.file === e.file;
      return '<tr'+(now?' class="pr-now"':'')+'><td style="text-align:left"><b>'+esc(e.name||e.file)+'</b>'+(now?'<span class="pr-chip">đang mở</span>':'')+(e.description?'<div class="hint">'+esc(e.description)+'</div>':'')+
        '<div class="hint">'+esc(e.file)+'</div></td>'+
        '<td>'+prTime(e.updatedAt)+'</td><td>'+(e.revision!=null?e.revision:'—')+'</td>'+
        '<td class="mact">'+
        '<button type="button" class="btn mini ghost" data-mopen="'+esc(e.file)+'">Mở</button> '+
        '<button type="button" class="btn mini ghost" data-mexp="'+esc(e.file)+'" title="Tải file JSON của hồ sơ này về máy">Xuất</button> '+
        '<button type="button" class="btn mini ghost" data-mren="'+esc(e.file)+'">Đổi tên</button> '+
        '<button type="button" class="btn mini ghost" data-mclone="'+esc(e.file)+'">Nhân bản</button> '+
        '<button type="button" class="btn mini" data-mdel="'+esc(e.file)+'">Xóa</button></td></tr>';
    }).join('');
    listHtml = '<div class="hint" style="margin-bottom:6px">Thư mục: <code>'+esc(prService.dir)+'</code>. Xóa chuyển file vào <code>_trash</code> để còn khôi phục; mỗi lần ghi đè chép bản cũ vào <code>_history</code>.</div>'+
      '<div class="scroll" style="max-height:420px"><table><thead><tr><th>Hồ sơ</th><th>Sửa lúc</th><th>Lần lưu</th><th>Thao tác</th></tr></thead><tbody>'+
      (rows || '<tr><td colspan="4" style="text-align:left">Chưa có hồ sơ nào.</td></tr>')+
      '</tbody></table></div>';
  } else {
    listHtml = '<div class="hint">Chưa nối được dịch vụ hồ sơ (khởi động bằng <b>LifeHorizon.bat</b> hoặc <b>npm run serve</b>) nên không có danh sách — Nhập/Xuất JSON vẫn dùng được, dữ liệu đang lưu trong trình duyệt.</div>';
  }
  appDialog({title:'Quản lý hồ sơ', html: prManageToolbar() + listHtml, okText:'Xong', wide:true});
  var wire = function(attr, fn){
    document.querySelectorAll('#amBody [data-'+attr+']').forEach(function(b){
      b.onclick = function(){ fn(b.getAttribute('data-'+attr)); };
    });
  };
  wire('mopen', function(f){ prOpenByFile(f); });
  wire('mexp', prManageExport);
  wire('mren', prManageRename);
  wire('mclone', prManageClone);
  wire('mdel', prManageDelete);
  var bNew = $('prMgNew'); if(bNew) bNew.onclick = function(){ prNew(); };
  var bImp = $('prMgImport'); if(bImp) bImp.onclick = function(){ $('prFile').click(); };
  var bExp = $('prMgExport'); if(bExp) bExp.onclick = function(){ prExport(); };
}
function prManageReload(){ prRefreshList().then(function(){ prRenderManage(); }); }
function prManageRename(file){
  prApi('GET','/api/profiles/file/'+encodeURIComponent(file)).then(function(p){
    appDialog({title:'Đổi tên hồ sơ', html:'<label for="prRenName">Tên hiển thị mới</label><input id="prRenName" maxlength="60" value="'+esc(p.name||'')+'">'+
      '<div class="hint">Chỉ đổi tên hiển thị — file và mã hồ sơ giữ nguyên nên liên kết không mất.</div>', okText:'Đổi tên', cancelText:'Huỷ'})
    .then(function(ok){
      if(!ok) return;
      var name = ($('prRenName') && $('prRenName').value.trim()) || p.name;
      var np = buildProfile(p, name, p.description||'', p.state, p.viewState, p.lastRiskRun, (p.revision||0)+1);
      prApi('PUT','/api/profiles/file/'+encodeURIComponent(file)+'?rev='+(p.revision||0), JSON.stringify(np))
      .then(function(){
        if(prOpen && prOpen.file === file){ prOpen.name = name; prOpen.revision = np.revision; setOpenProfileMeta({ file:file, id:prOpen.id, name:name, revision:np.revision, savedAt:np.updatedAt }); }
        prManageReload();
      })
      .catch(function(e){ appDialog({title:'Không đổi được tên', html:esc(e.message), okText:'Đã hiểu'}); });
    });
  }).catch(function(e){ appDialog({title:'Không đọc được hồ sơ', html:esc(e.message), okText:'Đã hiểu'}); });
}
function prManageClone(file){
  prApi('GET','/api/profiles/file/'+encodeURIComponent(file)).then(function(p){
    var np = buildProfile(null, (p.name||'Hồ sơ')+' (bản sao)', p.description||'', p.state, p.viewState, p.lastRiskRun, 1);
    prPutCreate(np)
    .then(prManageReload)
    .catch(function(e){ appDialog({title:'Không nhân bản được', html:esc(e.message), okText:'Đã hiểu'}); });
  }).catch(function(e){ appDialog({title:'Không đọc được hồ sơ', html:esc(e.message), okText:'Đã hiểu'}); });
}
/* Xóa hồ sơ (dùng chung cho hàng "Xóa" trong Quản lý và nút Xóa trên thanh hồ sơ — đợt 18).
   Xóa = chuyển file vào _trash; nếu xóa hồ sơ ĐANG MỞ thì gỡ con trỏ "đang mở" nhưng giữ nguyên
   dữ liệu đang hiển thị trong trình duyệt (người dùng vẫn làm việc tiếp/lưu thành hồ sơ khác). */
function prDeleteByFile(file, then){
  var isOpen = prOpen && prOpen.file === file;
  var extra = isOpen ? '<div class="hint" style="margin-top:6px">Dữ liệu đang hiển thị vẫn còn trong trình duyệt — chỉ file hồ sơ bị xóa.</div>' : '';
  appDialog({title:'Xóa hồ sơ?', html:'<b>'+esc(file)+'</b> sẽ chuyển vào thư mục <code>_trash</code> (đổi tên đủ ngày giờ để khôi phục khi cần).'+extra, okText:'Xóa', cancelText:'Huỷ'})
  .then(function(ok){
    if(!ok) return;
    prApi('DELETE','/api/profiles/file/'+encodeURIComponent(file))
    .then(function(){
      if(isOpen){
        prOpen = null; setOpenProfileMeta(null); prDraftBanner = null; prRiskRun = null;
        prRenderRiskOut(); prRenderBar();
      }
      prRefreshList();
      if(then) then();
    })
    .catch(function(e){ appDialog({title:'Không xóa được', html:esc(e.message), okText:'Đã hiểu'}); });
  });
}
function prManageDelete(file){
  prDeleteByFile(file, prManageReload);
}
/* (đợt 30: "Xóa hồ sơ đang mở" trên thanh công cụ đã bỏ — hàng Xóa của chính hồ sơ đó trong bảng
   dùng chung prDeleteByFile và có dòng ghi chú riêng khi xóa hồ sơ đang mở; không còn nút trên header.) */

/* ===== Nhập JSON từ file máy — bản sao của profile cũ (chưa có format) cũng nhận ===== */
function prImportFile(input){
  var f = input.files && input.files[0];
  input.value = '';
  if(!f) return;
  var rd = new FileReader();
  rd.onload = function(){
    var parsed = parseProfileText(String(rd.result));
    if(!parsed.ok){
      appDialog({title:'File không đọc được', html:parsed.errors.map(esc).join('<br>'), okText:'Đã hiểu'});
      return;
    }
    var p = parsed.profile;
    if(!prService){
      prGuardDirty(function(){
        prOfflineImported = p.name;
        prRiskRun = p.lastRiskRun || null;
        prApplyState(p);
        prRenderRiskOut();
      });
      return;
    }
    var dup = prList.find(function(e){ return e.id === p.id; }) || prList.find(function(e){ return e.file === p.id+'.json'; });
    function afterImport(file){
      prRefreshList();
      appDialog({title:'Đã nhập hồ sơ', html:'<b>'+esc(p.name)+'</b> đã thêm vào thư mục hồ sơ.', okText:'Mở ngay', cancelText:'Để sau'})
      .then(function(openNow){ if(openNow) prOpenByFile(file); });
    }
    function put(file, force){
      prApi('PUT','/api/profiles/file/'+encodeURIComponent(file)+(force?'?force=1':'?create=1'), JSON.stringify(p))
      .then(function(){ afterImport(file); })
      .catch(function(e){ appDialog({title:'Không nhập được', html:esc(e.message), okText:'Đã hiểu'}); });
    }
    if(dup){
      appDialog({title:'Trùng hồ sơ đã có', html:'Thư mục đã có hồ sơ cùng mã (<b>'+esc(dup.name||dup.file)+'</b>). Tạo bản mới với mã riêng để không ghi đè?', okText:'Tạo bản mới', cancelText:'Ghi đè file hiện có'})
      .then(function(makeNew){
        if(makeNew){
          var np = buildProfile(null, p.name, p.description||'', p.state, p.viewState, p.lastRiskRun, 1);
          prPutCreate(np)
          .then(function(){ afterImport(np.id+'.json'); })
          .catch(function(e){ appDialog({title:'Không nhập được', html:esc(e.message), okText:'Đã hiểu'}); });
        } else {
          put(dup.file, true);
        }
      });
    } else {
      put(p.id+'.json', false);
    }
  };
  rd.readAsText(f, 'utf8');
}

/* ===== Xuất JSON — tải file độc lập về máy ===== */
function prDownloadProfile(p){
  var blob = new Blob([JSON.stringify(p, null, 1)], {type:'application/json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (profileSlug(p.name) || 'ho-so') + '-' + String(p.id || '').slice(-4) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
}
/* Xuất hồ sơ ĐANG HIỂN THỊ (kể cả thay đổi chưa lưu) — dùng khi offline và khi người dùng chọn
   "bản đang chỉnh" ở dialog hỏi của prManageExport. */
function prExport(){
  var payload = buildProfile(prOpen, (prOpen && prOpen.name) || (state.mainName && String(state.mainName).trim()) || 'Hồ sơ xuất',
    (prOpen && prOpen.description) || '', state, prCaptureViewState(), prRiskRunUsable(), prOpen ? (prOpen.revision||1) : 1);
  prDownloadProfile(payload);
}
/* Xuất đúng hồ sơ được chọn từ danh sách — file trên máy là nguồn sự thật (đợt 30). Riêng hồ sơ
   ĐANG MỞ còn thay đổi chưa lưu thì hỏi một lần: tải bản đang chỉnh (đủ thay đổi) hay file đã lưu.
   Cả hai nhánh đều mở lại dialog Quản lý (appDialog dùng chung một mask nên dialog hỏi đã đè nó). */
function prManageExport(file){
  prApi('GET','/api/profiles/file/'+encodeURIComponent(file)).then(function(p){
    if(!(prOpen && prOpen.file === file && prDirty())){ prDownloadProfile(p); return; }
    appDialog({title:'Hồ sơ đang mở có thay đổi chưa lưu',
      html:'<b>'+esc(p.name||file)+'</b> đang mở và có thay đổi chưa lưu vào file. Xuất bản nào?',
      okText:'Bản đang chỉnh', cancelText:'File đã lưu'})
    .then(function(useCurrent){
      if(useCurrent) prExport(); else prDownloadProfile(p);
      prManageReload();
    });
  }).catch(function(e){ appDialog({title:'Không đọc được hồ sơ', html:esc(e.message), okText:'Đã hiểu'}); });
}

/* ===== Khởi động: gắn nút, dò dịch vụ, khôi phục "hồ sơ đang mở" và bản nháp ===== */
function profileBarInit(){
  var sel = $('profileSelect');
  if(sel) sel.onchange = function(){ if(sel.value) prOpenByFile(sel.value); };
  var bSave = $('prSave'); if(bSave) bSave.onclick = function(){ prDoSave(); };
  var bSaveAs = $('prSaveAs'); if(bSaveAs) bSaveAs.onclick = function(){ prDialogSaveAs(); };
  var bMng = $('prManage'); if(bMng) bMng.onclick = function(){ prManage(); };
  var file = $('prFile'); if(file) file.onchange = function(){ prImportFile(file); };
  window.addEventListener('beforeunload', function(ev){
    if(prDirty()){ ev.preventDefault(); ev.returnValue = ''; }
  });
  prRenderBar();
  prApi('GET','/api/profiles').then(function(r){
    prService = { dir:r.dir };
    prList = r.profiles || [];
    var meta = getOpenProfileMeta();
    var match = meta && meta.file && prList.find(function(e){ return e.file === meta.file && e.ok; });
    if(match){
      return prApi('GET','/api/profiles/file/'+encodeURIComponent(match.file)).then(function(p){
        prOpen = { file:match.file, id:p.id, name:p.name, description:p.description||'', revision:p.revision||1,
          createdAt:p.createdAt||null, savedAt:p.updatedAt||null };
        prRiskRun = p.lastRiskRun || null;
        /* Làm việc dở phiên trước nằm trong localStorage: nếu khớp file thì coi như đã lưu,
           nếu lệch thì hiển thị "có thay đổi chưa lưu" cho đúng */
        var same = p.state && JSON.stringify(p.state) === JSON.stringify(state);
        prSavedSignature = same ? stateSignature : '';
        prBaselinePending = false;
        prRenderBar();
        prRenderRiskOut();
        prCheckDraft();
      }).catch(function(){ prRenderBar(); });
    }
    prRenderBar();
  }).catch(function(){
    prService = null;
    prRenderBar();
  });
}
