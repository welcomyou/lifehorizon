'use strict';
/* [ui/bhxh.js] Tab 3 trọn gói (gia đình nhiều người): card "Gia đình" trên cùng (một dòng mỗi người
   + dòng tổng), tab con chọn người (#peopleTabs), khối thông tin người (#personMeta), danh sách
   "Giai đoạn đóng BHXH" ở trên (kéo ⠿), hộp "Lương hưu" và kết quả quy đổi ở dưới, đồng bộ nguồn mức hưu (applyAutoPensionFor
   + các handler psAmount/psStart/psMonth/psUsePeriods/psBasisCur/psBasisRet, birthYear/gender/
   startMonth/infl).
   Công thức tính nằm ở core/pension.js — file này chỉ đọc/hiển thị/điều phối.
   GHI state: periods/pension của người đang chọn, extraPeople, activePerson
   (tên hiển thị người chính state.mainName nhập ở Tab 1 — qua readInputs của ui/setup.js).
   Quy tắc nguồn mức hưu (manual không bị ghi đè…): AGENTS.md mục 1. */
/* ===== M1 — người đang mở trong Tab 3 (gia đình nhiều người) ===== */
function activePersonObj(){ return state.activePerson>0 ? (state.extraPeople[state.activePerson-1]||null) : null; }
function activePeriods(){ var p=activePersonObj(); return p ? (Array.isArray(p.periods)?p.periods:[]) : state.periods; }
function activePension(){ var p=activePersonObj(); return p ? p.pension : state.pensionSimple; }
function personLabel(p,pi){
  if(!p){ var n=strTrim(state.mainName); return n || 'Người 1'; }
  var n2=strTrim(p.name); return n2 || ('Người '+(pi+2));
}
function personAgeAt(p,idx){ return Math.floor(idx/12) - (p?p.birthYear:state.birthYear); }
/* Mốc bắt đầu nhận hưu của MỌI người có mức > 0 — dùng vẽ đường ┄ trên biểu đồ Tab 7 */
function pensionStarts(){
  var out=[];
  if(state.pensionMode==='simple'){
    var ps=state.pensionSimple;
    if(ps.amount>0)out.push({name:personLabel(null,0),idx:ps.startYear*12+(ps.startMonth===undefined?1:ps.startMonth)-1,p0:ps.amount*pensionFactor(ps.startYear*12+(ps.startMonth===undefined?1:ps.startMonth)-1,NOW,state.infl)});
    (state.extraPeople||[]).forEach(function(p,i){
      var q=p.pension;
      if(q&&q.amount>0){var ix=q.startYear*12+(q.startMonth===undefined?1:q.startMonth)-1;out.push({name:personLabel(p,i),idx:ix,p0:q.amount*pensionFactor(ix,NOW,state.infl)});}
    });
  }
  return out;
}

function orderConsistent(P){
  P = P || state.periods;
  var ps = P.map(function(p){ return {f:parseYM(p.from), t:(p.to && String(p.to).length ? parseYM(p.to) : Infinity)}; });
  for(var i=1;i<ps.length;i++){ if(ps[i].f < ps[i-1].f) return false; if(ps[i].f <= ps[i-1].t) return false; }
  return true;
}
/* ===== M1 — tab con chọn người (Tab 3) ===== */
function renderPeopleTabs(){
  var box=$('peopleTabs'); if(!box)return;
  var h='<button type="button" class="pseg'+(state.activePerson===0?' active':'')+'" data-p="0">'+esc(personLabel(null,0))+'</button>';
  state.extraPeople.forEach(function(p,i){
    h+='<button type="button" class="pseg'+(state.activePerson===i+1?' active':'')+'" data-p="'+(i+1)+'">'+esc(personLabel(p,i))+'</button>';
  });
  h+='<button type="button" class="pseg" data-p="add" style="flex:0 0 auto;">＋ Thêm người</button>';
  if(box.__html===h)return;
  box.__html=h; box.innerHTML=h;
  box.querySelectorAll('button').forEach(function(b){
    b.onclick=function(){
      if(b.dataset.p==='add'){ addPerson(); return; }
      switchPerson(+b.dataset.p);
    };
  });
}
/* Khối thông tin của người đang chọn: người chính KHÔNG còn gì ở đây (Đ7 11/09 — ô "Tên hiển thị"
   chuyển lên Tab 1 — Hồ sơ; dòng dẫn hồ sơ đã bỏ vì card "Gia đình" trên cùng đã nêu đủ thông tin);
   người thêm có tên/năm sinh/giới tính riêng + nút xóa người (xóa cả giai đoạn & lương hưu của họ). */
function renderPersonMeta(){
  var p=activePersonObj(), pi=state.activePerson-1;
  var html, wire;
  if(!p){
    html=''; wire=null;
  } else {
    html='<div class="card" style="padding:10px 12px;" data-o="'+objToken(p)+'"><div class="row person-meta-row" style="align-items:end;">'+
      '<div style="max-width:200px;"><label>Tên</label><input data-f="name" value="'+esc(p.name||'')+'" placeholder="ví dụ: Vợ"></div>'+
      '<div style="max-width:140px;"><label>Năm sinh</label><input type="text" inputmode="numeric" class="num" data-f="birthYear" value="'+p.birthYear+'"></div>'+
      '<div style="max-width:120px;"><label>Giới tính</label><select data-f="gender"><option value="male"'+(p.gender!=='female'?' selected':'')+'>Nam</option><option value="female"'+(p.gender==='female'?' selected':'')+'>Nữ</option></select></div>'+
      '<div style="flex:0 0 auto;"><button type="button" class="del" data-f="delPerson" title="Xóa người này khỏi gia đình">✕ Xóa người</button></div></div></div>';
    wire=function(box){
      box.querySelectorAll('input, select').forEach(function(el){
        var f=el.dataset.f;
        if(f==='delPerson')return;
        el.addEventListener('change',function(){
          if(f==='name')p.name=el.value;
          else if(f==='birthYear')p.birthYear=numVal(el);
          else if(f==='gender')p.gender=el.value;
          applyAutoPensionFor(p);   /* đổi năm sinh/giới tính của NGƯỜI NÀY → tính lại hưu tự tính của họ */
          scheduleRefresh();
        });
      });
      var del=box.querySelector('[data-f="delPerson"]');
      if(del)bindDel(del,function(){
        appDialog({title:'Xóa người khỏi gia đình?',html:'Xóa <b>'+esc(personLabel(p,pi))+'</b> — mất toàn bộ giai đoạn đóng BHXH và lương hưu của người này; mô phỏng tiếp theo chỉ còn các người còn lại. Thao tác không hoàn tác được.',okText:'Xóa người',cancelText:'Giữ lại'})
          .then(function(ok){
            if(!ok)return;
            var idx=state.extraPeople.indexOf(p);
            if(idx<0)return;
            state.extraPeople.splice(idx,1);
            if(state.activePerson===idx+1)state.activePerson=0;
            else if(state.activePerson>idx+1)state.activePerson--;
            writePensionInputs();
            refresh();
          });
      });
    };
  }
  refreshList('personMeta', html, wire);
}
function renderPensionDetails(){   /* giữ tên gọi cũ — giờ vẽ chi tiết theo NGƯỜI ĐANG CHỌN ở tab con Tab 3 */
  var person=activePersonObj(), pi=state.activePerson-1, label=personLabel(person,pi);
  var s=bhxhSummary(person), P=activePeriods();
  /* Đ3 — chip 👤 người đang xem đồng bộ ở CẢ BA card (giai đoạn đóng / lương hưu / BHXH);
     tiêu đề ngắn — không mang "của Người X", không "hồ sơ chính" (tab con đầu đã là Người 1) */
  $('periodTitle').innerHTML='Giai đoạn đóng BHXH <span class="badge pchip">👤 '+esc(label)+'</span>';
  $('psCardTitle').innerHTML='Lương hưu <span class="badge pchip">👤 '+esc(label)+'</span>';
  $('lawCardTitle').innerHTML='Lương hưu quy đổi <span class="badge pchip">👤 '+esc(label)+'</span>';
  $('periodAdjHint').textContent='“Sau bù trượt giá”: bình quân lương đóng của giai đoạn tại năm hưởng hưu '+Math.floor(s.retStart/12)+'; đã tính tăng lương và giới hạn đóng.';
  var warn = $('orderWarn');
  var warnBits=[];
  if(!orderConsistent(P)) warnBits.push('<span>⚠ Thứ tự / thời gian các giai đoạn chưa khớp.</span><button class="btn mini" id="sortBtn">Sắp xếp theo thời gian</button>');
  if(s.overlapMonths>0) warnBits.push('<span>⚠ '+s.overlapMonths+' tháng trùng giữa các giai đoạn chồng lấn — chỉ tính một lần theo dòng sớm hơn.</span>');
  if(s.monthsAfterRetire>0) warnBits.push('<span>⚠ '+s.monthsAfterRetire+' tháng đóng sau mốc đủ tuổi — <b>nghỉ hưu muộn chưa được ước tính</b>: những tháng này không tính vào điều kiện/mức hưởng.</span>');
  warn.innerHTML = warnBits.length ? '<div class="warnbar">'+warnBits.join(' ')+'</div>' : '';
  /* Dòng đạt/thiếu tháng tối thiểu (180 tháng — thay hint tĩnh theo yêu cầu): theo người đang chọn */
  var mh = $('bhxhMonthsHint');
  if(mh){
    mh.innerHTML = s.months===0 ? 'Chưa có tháng đóng BHXH.' : (s.months >= 180)
      ? 'Theo các giai đoạn đã nhập: <b>'+s.months+' tháng đóng</b> · đạt mốc 180 tháng.'
      : 'Theo các giai đoạn đã nhập: <b>'+s.months+' tháng đóng</b> · còn thiếu <b>'+(180-s.months)+' tháng</b> để đạt 180.';
  }
  var sb=$('sortBtn'); if(sb) sb.onclick = function(){ P.sort(function(a,b){ return parseYM(a.from)-parseYM(b.from); }); refresh(); };
  /* comment phân biệt người để diff refreshList nhận ra đổi người khi HTML trùng dạng */
  var html = '<!--nguoi:'+state.activePerson+'--><div class="period head"><div></div><div>Từ tháng/năm</div><div>Đến tháng/năm</div><div>Số tháng</div><div>Làm việc tại</div><div>Lương đóng BHXH</div><div>Tăng lương %/năm</div><div>Sau bù trượt giá</div><div></div></div>';
  var retIdxRow = retireAgeMonths(personBirth(person), personGender(person));
  function rowMonths(p){
    /* Số tháng đóng của RIÊNG dòng này: từ tháng "Từ" đến hết tháng "Đến" (trống = đến tháng đủ
       tuổi), không tính tháng đóng sau mốc đủ tuổi — nhất quán với cách bhxhSummary đếm. */
    var f = parseYM(p.from);
    if(isNaN(f)) return null;
    var e = (p.to && String(p.to).length ? parseYM(p.to) : retIdxRow);
    if(isNaN(e)) return null;
    return Math.max(0, Math.min(e, retIdxRow) - f + 1);
  }
  P.forEach(function(p, i){
    var rm = rowMonths(p);
    html += '<div class="period" data-i="'+i+'" data-o="'+objToken(p)+'">'+
      '<div class="handle" draggable="true" title="Kéo để sắp xếp">⠿</div>'+
      '<div><input type="text" inputmode="numeric" aria-label="Từ tháng, giai đoạn '+(i+1)+' của '+esc(label)+'" placeholder="01/2027" value="'+ymToVN(p.from)+'" data-f="from" data-i="'+i+'"></div>'+
      '<div><input type="text" inputmode="numeric" aria-label="Đến tháng, giai đoạn '+(i+1)+' của '+esc(label)+'" placeholder="nghỉ hưu" value="'+(p.to?ymToVN(p.to):'')+'" data-f="to" data-i="'+i+'"></div>'+
      '<div><input type="text" disabled tabindex="-1" title="Tự tính từ Từ/Đến tháng — không sửa trực tiếp" aria-label="Số tháng, giai đoạn '+(i+1)+' của '+esc(label)+'" value="'+(rm===null?'—':rm)+'"></div>'+
      '<div><select data-f="type" data-i="'+i+'">'+ ['dn','nn','tn','none'].map(function(k){ return '<option value="'+k+'"'+(p.type===k?' selected':'')+'>'+TYPES[k].label+'</option>'; }).join('') +'</select></div>'+
      '<div><input type="text" inputmode="numeric" class="money" value="'+fmtMoney(p.bh)+'" data-f="bh" data-i="'+i+'"></div>'+
      '<div><input type="text" inputmode="decimal" class="num" value="'+vnNumStr(p.growth)+'" data-f="growth" data-i="'+i+'"></div>'+
      '<div><input type="text" class="period-adjusted" disabled tabindex="-1" title="Bình quân lương đóng của giai đoạn, quy về năm bắt đầu hưởng hưu" aria-label="Sau bù trượt giá, giai đoạn '+(i+1)+' của '+esc(label)+'" value="'+(s.periodAdjusted[i]===null?'—':fmtMoney(s.periodAdjusted[i]))+'"></div>'+
      '<div><button class="del" data-i="'+i+'" aria-label="Xóa giai đoạn đóng '+(i+1)+' của '+esc(label)+'">✕</button></div></div>';
  });
  refreshList('periodList', html, function(box){
    /* P1 (13/09/2026) — năm gợi ý khi chỉ gõ MỘT SỐ vào ô tháng: ô 'to' lấy năm của 'from' cùng dòng,
       ô 'from' lấy năm kết thúc dòng kế trước (không có thì năm gốc NOW). */
    function hintYearFor(p, f, P){
      if(f === 'to') return (p.from && !isNaN(parseYM(p.from))) ? Math.floor(parseYM(p.from)/12) : Math.floor(NOW/12);
      var i = P.indexOf(p), prev = i > 0 ? P[i-1] : null;
      if(prev && prev.to && String(prev.to).length && !isNaN(parseYM(prev.to))) return Math.floor(parseYM(prev.to)/12);
      return Math.floor(NOW/12);
    }
    /* P2 — di chuyển focus kiểu bảng tính trong lưới .period: dir ±1 qua ô kế/trước trong dòng,
       chạm biên dòng thì qua đầu/cuối dòng kế (dir<0: dòng trước ô cuối). allowAdd chỉ bật cho
       Enter: ở ô CUỐI của dòng CUỐI → thêm dòng mới (addPeriodRow) rồi focus ô đầu dòng đó.
       Việc focus đi khỏi ô hiện tại tự bắn blur → change → commit theo logic cũ, không cần
       gọi lại code ghi state ở đây. */
    function moveFocus(el, dir, allowAdd){
      var row = el.closest('.period');
      if(!row) return;
      var list = Array.prototype.slice.call(row.querySelectorAll('input:not([disabled]), select:not([disabled])'));
      var j = list.indexOf(el) + dir;
      if(j >= 0 && j < list.length){
        var nx = list[j];
        try{ nx.focus(); if(nx.tagName === 'INPUT' && nx.select) nx.select(); }catch(e){}
        return;
      }
      var rows = Array.prototype.slice.call(box.querySelectorAll('.period:not(.head)'));
      var ri = rows.indexOf(row);
      if(dir > 0 && allowAdd && ri === rows.length - 1){ addPeriodRow(true); return; }
      var r = ri + (dir > 0 ? 1 : -1);
      if(r < 0 || r >= rows.length) return;
      var tgt = Array.prototype.slice.call(rows[r].querySelectorAll('input:not([disabled]), select:not([disabled])'));
      if(!tgt.length) return;
      var cell = dir > 0 ? tgt[0] : tgt[tgt.length-1];
      try{ cell.focus(); if(cell.tagName === 'INPUT' && cell.select) cell.select(); }catch(e){}
    }
    box.querySelectorAll('.period input, .period select').forEach(function(el){
      el.addEventListener('keydown', function(ev){
        if(ev.key === 'Enter'){
          ev.preventDefault();
          moveFocus(el, ev.shiftKey ? -1 : 1, true);
        } else if(ev.key === ' ' && el.tagName !== 'SELECT'){
          /* Space trong ô số/tháng vô nghĩa → dùng làm "sang ô kế" (giống Excel); select giữ Space
             nguyên bản để mở dropdown. */
          ev.preventDefault();
          moveFocus(el, 1, false);
        }
      });
    });
    box.querySelectorAll('input, select').forEach(function(el){
      var p = P[+el.dataset.i];   /* R03: danh tính lúc gắn */
      if(!p) return;
      el.addEventListener('change', function(){
        if(P.indexOf(p) < 0) return;
        var f = el.dataset.f;
        if(f === 'type') p.type = el.value;
        else if(f === 'bh') p.bh = moneyVal(el);
        else if(f === 'growth') p.growth = numVal(el);
        else if(f === 'from' || f === 'to'){
          var raw = strTrim(el.value);
          var norm = (raw === '' && f === 'to') ? '' : parseYMFlexible(raw, hintYearFor(p, f, P));
          /* parseYMFlexible trả CHUỖI 'yyyy-mm' hoặc NaN — kiểm tra kiểu, KHÔNG dùng isNaN
             (isNaN ép chuỗi ngày '2025-03' về số rồi báo sai oan). */
          if(raw !== '' && typeof norm !== 'string'){
            el.value = (f==='from' ? ymToVN(p.from) : (p.to ? ymToVN(p.to) : ''));
            appDialog({ title:'Định dạng tháng chưa đúng', html:'Nhập dạng <b>mm/năm</b>, ví dụ <b>01/2027</b> — hoặc gõ tắt <b>3/25</b> (03/2025), <b>3</b> (tháng 3 năm gợi ý).', okText:'Đã hiểu' });
            return;
          }
          p[f] = norm;
          if(f === 'from' && norm) el.value = ymToVN(norm);
          else if(f === 'to' && norm) el.value = ymToVN(norm);   /* P1: 'to' cũng tự chuẩn hóa hiển thị */
        }
        applyAutoPensionFor(person);   /* sửa giai đoạn của người này → tự tính lại ô lương hưu của họ (im lặng nếu chưa tính được) */
        scheduleRefresh();
      });
    });
    box.querySelectorAll('.del').forEach(function(b){
      var p = P[+b.dataset.i];
      bindDel(b, function(){
        blurActiveIn(box);
        var idx = P.indexOf(p);
        if(idx >= 0){ P.splice(idx, 1); applyAutoPensionFor(person); refresh(); }
      });
    });
    box.querySelectorAll('.handle').forEach(function(h){
      h.addEventListener('dragstart', function(ev){ dragI = +h.parentNode.dataset.i; h.parentNode.classList.add('dragging'); try{ ev.dataTransfer.setData('text/plain',''); }catch(e){} });
      h.addEventListener('dragend', function(){ h.parentNode.classList.remove('dragging'); });
    });
  });

  /* Tầng 1 — kết quả của người đang chọn, đọc đúng mức và nguồn từ hộp Lương hưu. */
  var ps = activePension(), psStart = pensionStartOf(ps).start;
  var pr = {psStart:psStart, p0:ps.amount>0 ? ps.amount*pensionFactor(psStart,NOW,state.infl) : 0};
  function moneyText(v){ return fmtTr(v).replace('trđ','triệu đ'); }
  /* Đ2 — nhãn nguồn mức hưu NGAY CẠNH ô tiền (nhập tay / tính từ giai đoạn đóng / trống / chưa xác nhận nghĩa) */
  var chip = $('psSourceChip');
  if(chip){
    chip.style.display=ps.amount>0?'':'none';
    if(ps.amountBasis === 'unknown'){ chip.className='badge src-warn'; chip.textContent='⚠ chưa xác nhận nghĩa số cũ'; }
    else if(ps.amountSource === 'fromPeriods'){ chip.className='badge src-auto'; chip.textContent='⚙ tự tính'; }
    else if(ps.amount > 0){ chip.className='badge src-manual'; chip.textContent='✎ nhập tay'; }
    else { chip.className='badge src-empty'; chip.textContent='○ trống'; }
  }
  /* Banner xác nhận nghĩa bản lưu cũ (bàn giao mục 7.2): không suy đoán từ số tiền — hỏi người dùng */
  var ask = $('psBasisAsk');
  if(ask) ask.style.display = (ps.amount > 0 && ps.amountBasis === 'unknown') ? '' : 'none';
  /* Đ6 — chỉ giữ mức theo giá tháng gốc, mức bắt đầu nhận và tăng sau nghỉ hưu.
     Giai đoạn đóng vẫn dùng trong pensionFromPeriods; không vẽ lại bảng tham khảo/đóng góp. */
  var unknown=ps.amountBasis==='unknown', hasAmount=ps.amount>0 && !unknown;
  var retired=psStart<NOW;
  $('kUseBase').innerHTML=hasAmount ? moneyText(ps.amount)+' <span class="pension-unit">/tháng</span>' : '—';
  $('kUseBaseS').textContent='Theo sức mua tại '+ymToStr(NOW)+'.';
  $('kUseAmtT').textContent=retired?'Lương hưu tại tháng gốc':'Lương hưu khi bắt đầu nhận';
  $('kUseAmt').innerHTML=hasAmount ? moneyText(pr.p0)+' <span class="pension-unit">/tháng</span>' : '—';
  $('kUseAmtS').textContent=retired
    ? 'Mô phỏng từ '+ymToStr(NOW)+' · Đã nhận từ '+ymToStr(psStart)+'.'
    : 'Nhận từ '+ymToStr(psStart)+' · '+personAgeAt(person,psStart)+' tuổi.';
  $('kUseNotice').textContent=unknown
    ? 'Xác nhận nghĩa số tiền phía trên để xem kết quả.'
    : 'Chưa có mức hưu để quy đổi.';
  $('kUseNotice').style.display=hasAmount?'none':'';
}
/* Tổng hợp gia đình: mỗi người có mốc nghỉ, nguồn hưu, mức theo giá hiện tại và mức lúc nhận;
   chỉ cộng các mức theo giá hiện tại khi có ít nhất hai người có hưu. */
function renderFamilySummary(){
  var el=$('familyLines'); if(!el)return;
  var totAmt=0, amtCount=0;
  function row(p,pi){
    var ps=p?p.pension:state.pensionSimple, pr=pensionProjection(ps);
    var retIdx=retireAgeMonths(personBirth(p),personGender(p));
    var h='<b>'+esc(personLabel(p,pi))+'</b> · '+(personGender(p)==='male'?'Nam':'Nữ')+' · sinh '+personBirth(p)+
      ' · nghỉ hưu '+ymToStr(retIdx)+' ('+personAgeAt(p,retIdx)+' tuổi)';
    if(ps.amount>0){
      totAmt+=ps.amount; amtCount++;
      h+=' · hưu '+(ps.amountSource==='fromPeriods'?'tự tính':'nhập tay')+' '+fmtMoney(ps.amount)+' đ/tháng (giá hiện tại) → ≈ '+fmtMoney(pr.p0)+' đ/tháng '+(pr.psStart<NOW?'tại '+ymToStr(NOW):'khi nhận');
      if(pr.psStart!==retIdx) h+=' · nhận từ '+ymToStr(pr.psStart);   /* đợt 13: mốc quy ước = tháng đủ tuổi */
    } else h+=' · chưa có mức hưu';
    return '<div class="kv"><span>'+h+'</span></div>';
  }
  var html=row(null,0);
  state.extraPeople.forEach(function(p,i){ html+=row(p,i); });
  if(amtCount>1) html+='<div class="kv" style="border-top:1px dashed var(--line);margin-top:4px;padding-top:6px;">'+
    '<span><b>Tổng các mức hưu theo giá hiện tại</b></span><b>'+fmtMoney(totAmt)+' đ/tháng</b></div>';
  el.innerHTML=html;
}

/* M1 — đổ hộp "Lương hưu — nhập trực tiếp" (tĩnh, dùng chung cho mọi người) về giá trị của NGƯỜI
   ĐANG CHỌN; gọi khi khởi động và khi chuyển tab con TRƯỚC refresh() để readInputs không đọc nhầm
   số của người trước ghi vào người sau. */
function writePensionInputs(){
  var ps=activePension();
  $('psAmount').value=fmtMoney(ps.amount);
  $('psAmount').dataset.good=String(Math.round(ps.amount));
  $('psStart').value=ps.startYear;$('psMonth').value=ps.startMonth===undefined?1:ps.startMonth;$('psGrowth').value=vnNumStr(ps.growth);
}
/* M1 — chuyển tab con / thêm người mới trong Tab 3 */
function switchPerson(i){
  if(i===state.activePerson)return;
  state.activePerson=i;
  writePensionInputs();
  refresh();
}
function newExtraPerson(){
  var by=finiteNumber(state.birthYear)?state.birthYear:1990, g='female';
  var ret=retireAgeMonths(by,g);   /* đợt 13 — mặc định tháng hưởng = tháng đủ tuổi (tháng 1 với sinh tháng 1) */
  return { id:'person-'+Date.now()+'-'+Math.random().toString(36).slice(2), name:'', birthYear:by, gender:g,
           periods:[],
           pension:{ amount:0, startYear:Math.floor(ret/12), startMonth:ret%12+1, growth:8, amountSource:'manual', amountBasis:'baseMonth' } };
}
function addPerson(){
  var p=newExtraPerson();
  state.extraPeople.push(p);
  state.activePerson=state.extraPeople.length;
  writePensionInputs();
  refresh();
}

/* dragstart của tay cầm ⠿ (gắn trong renderPensionDetails) ghi vào BIẾN MODULE này; drop dưới đây đọc lại.
   Không khai báo dragI cục bộ trong wire callback — biến cục bộ sẽ che biến module và làm drop
   luôn đọc -1 (kéo ⠿ không sắp xếp được). */
var dragI = -1;
$('periodList').addEventListener('dragover', function(ev){ ev.preventDefault(); });
$('periodList').addEventListener('drop', function(ev){
  ev.preventDefault();
  var row = ev.target.closest ? ev.target.closest('.period') : null;
  if(!row || dragI < 0) return;
  var toI = +row.dataset.i;
  if(toI === dragI) return;
  var P = activePeriods();   /* M1: sắp xếp mảng của người đang chọn */
  var item = P.splice(dragI,1)[0];
  P.splice(toI, 0, item);
  dragI = -1; applyAutoPensionFor(activePersonObj()); refresh();
});
/* ===== Tab 3: tự tính lương hưu nhập tay từ giai đoạn đóng =====
   Được gọi khi người dùng thêm/xóa/sửa giai đoạn, đổi năm sinh/giới tính (Tab 1 hoặc khối người
   thêm), đổi tháng gốc mô phỏng (NOW) hoặc đổi lạm phát. Quy tắc nguồn (bảng mục 5 bàn giao +
   review F02/F04 11/09):
   - Mức NHẬP TAY (amountSource 'manual', amount > 0) KHÔNG bao giờ bị ghi đè bởi dữ liệu tham khảo —
     người dùng phải chủ động bấm “⚙ Tính hưu từ giai đoạn đóng” (force).
   - Tự điền/ cập nhật khi nguồn đã là fromPeriods, hoặc ô còn trống (amount = 0): ghi mức quy về giá
     hiện tại (full precision — không đọc lại số làm tròn trên giao diện) + tháng hưởng + nguồn, giữ
     nguyên “Tăng %/năm” người dùng nhập.
   - Từ chối tự tính (giai đoạn lỗi / chưa đủ 180 tháng): mức TỰ TÍNH cũ không được im lặng thành mức
     nhập tay hợp lệ (F04) — về 0 + nguồn manual; sửa giai đoạn cho hợp lệ hoặc bấm nút sẽ tính lại.
   M1: applyAutoPensionFor(person) tính cho MỘT người (null = người chính); chỉ cập nhật DOM khi
   person là người đang mở (ô nhập hiển thị đúng người). Lý do từ chối hiển thị ở tầng “ước tính từ
   giai đoạn đóng” + banner lỗi của tab. KHÔNG gọi trong refresh() chung. */
function applyAutoPensionFor(person, force){
  var tgt = person ? person.pension : state.pensionSimple;
  var r = pensionFromPeriods(person);
  if(!r){
    if(tgt.amountSource==='fromPeriods'){
      tgt.amountSource='manual';
      tgt.amount=0;
      if(person===activePersonObj()){ $('psAmount').value='0'; $('psAmount').dataset.good='0'; }
    }
    return;
  }
  if(!force && tgt.amountSource!=='fromPeriods' && tgt.amount>0) return;
  var next = { amount:r.amount, startYear:r.startYear, startMonth:r.startMonth,
               growth:tgt.growth, amountSource:'fromPeriods', amountBasis:'baseMonth' };
  if(person)person.pension=next;else state.pensionSimple=next;
  if(person===activePersonObj()){
    $('psAmount').value = fmtMoney(r.amount);
    $('psAmount').dataset.good = String(Math.round(r.amount));   /* R02 — giá trị tốt mới cho cơ chế khôi phục ô tiền */
    $('psStart').value = r.startYear;
    $('psMonth').value = r.startMonth;
  }
}
/* ＋ Thêm giai đoạn đóng: dòng mới mặc định đóng đến nghỉ hưu, bắt đầu ngay sau mốc kết thúc XÁC ĐỊNH
   muộn nhất (bỏ qua dòng mở “đến nghỉ hưu” — tính theo nó sẽ rơi đúng tháng nghỉ hưu, vô dụng),
   không sớm hơn NOW — người dùng sửa tiếp trực tiếp trên dòng. M1: thêm vào mảng của người đang chọn.
   P2 (13/09/2026): tách thành addPeriodRow(focusNew) — nút ＋ và phím Enter ở ô cuối dòng cuối
   dùng chung; focusNew=true thì sau khi refresh focus vào ô "Từ tháng/năm" của dòng vừa thêm
   (dò lại theo token đối tượng vì sort có thể đặt dòng mới giữa danh sách). */
function addPeriodRow(focusNew){
  var P = activePeriods();
  var lastEnd = -Infinity;
  P.forEach(function(p0){
    var e = (p0.to && String(p0.to).length) ? parseYM(p0.to) : NaN;
    if(!isNaN(e) && e > lastEnd) lastEnd = e;
  });
  var m = Math.max(lastEnd + 1, NOW);
  var added = { from:Math.floor(m/12)+'-'+(('0'+(m%12+1)).slice(-2)), to:'', type:'dn', bh:0, growth:0 };
  P.push(added);
  P.sort(function(a,b){ return parseYM(a.from)-parseYM(b.from); });
  applyAutoPensionFor(activePersonObj());
  refresh();
  if(focusNew){
    var row = $('periodList').querySelector('[data-o="'+objToken(added)+'"]');
    if(row){
      var inp = row.querySelector('input[data-f="from"]');
      if(inp){ try{ inp.focus(); inp.select(); }catch(e){} }
    }
  }
}
$('addPeriod').onclick = function(){ addPeriodRow(false); };
/* Đổi năm sinh/giới tính ở TAB 1 → thuộc NGƯỜI CHÍNH (review F03 11/09: A_auto quy đổi theo hồ sơ
   phải được tính lại; mức nhập tay vẫn giữ nguyên). Đổi THÁNG GỐC (NOW) ảnh hưởng quy đổi của MỌI
   người → tính lại cả người chính lẫn các thành viên thêm. */
['birthYear','gender'].forEach(function(id){ $(id).addEventListener('change', function(){
  readInputs(); // scheduleRefresh chạy sau 1 tick; cần state mới (năm sinh/giới tính) trước khi tính hưu.
  applyAutoPensionFor(null);
}); });
$('startMonth').addEventListener('change', function(){
  readInputs(); // NOW dịch → hệ số quy đổi của mọi người đổi
  applyAutoPensionFor(null);
  state.extraPeople.forEach(function(p0){ applyAutoPensionFor(p0); });
});
/* ===== Lương hưu hai giai đoạn — đồng bộ nguồn mức hưu (bàn giao CPI 10/09/2026, mục 5) =====
   Người dùng sửa trực tiếp mức tiền/mốc hưởng đang tự điền → chuyển sang nhập tay; số vừa nhập
   luôn mang nghĩa giá hiện tại của quy ước mới. Đổi riêng “Tăng %/năm” KHÔNG đổi nguồn.
   M1: các ô này thuộc người đang chọn ở tab con. */
$('psAmount').addEventListener('change', function(){
  var t=activePension(); t.amountSource='manual'; t.amountBasis='baseMonth';
});
['psStart','psMonth'].forEach(function(id){ $(id).addEventListener('change', function(){
  activePension().amountSource='manual';
}); });
/* Đổi lạm phát: hưu nhập tay giữ nguyên A (F và mức tháng hưởng tự đổi theo công thức khi chạy);
   hưu đang tự tính từ giai đoạn đóng phải tính lại P0_auto và quy đổi lại A_auto ngay — theo TỪNG người. */
$('infl').addEventListener('change', function(){
  readInputs(); // cần infl mới vào state trước khi tính lại hưu tự tính
  if(state.pensionSimple.amountSource==='fromPeriods') applyAutoPensionFor(null);
  state.extraPeople.forEach(function(p0){ if(p0.pension.amountSource==='fromPeriods') applyAutoPensionFor(p0); });
});
/* Nút chuyển lại nguồn tự tính sau khi đã nhập tay (bảng mục 5, dòng cuối bàn giao) — force: ghi đè manual */
$('psUsePeriods').onclick = function(){
  var person=activePersonObj();
  var r = pensionFromPeriods(person);
  if(!r){
    appDialog({ title:'Chưa tính được từ giai đoạn đóng',
      html:'Giai đoạn đóng (của <b>'+esc(personLabel(person,state.activePerson-1))+'</b>) còn lỗi định dạng, chưa đủ 180 tháng hoặc chưa có tháng đóng hợp lệ. Kiểm tra định dạng và thời gian của các giai đoạn đóng phía trên. Mức hưu hiện tại được giữ nguyên.', okText:'Đã hiểu' });
    return;
  }
  applyAutoPensionFor(person, true);
  refresh();
};
/* Nút "Tính giá trị rút BHXH 1 lần": popup mức hưởng ước tính theo khoản 3
   Điều 70 Luật BHXH 41/2024 (tự nguyện: Điều 102) cho NGƯỜI ĐANG CHỌN ở tab con. Công thức nằm ở
   core/pension.js (bhxhLumpSum) — file này chỉ đọc/hiển thị; không ghi state. Điều kiện hưởng
   (khoản 1) là dữ kiện cá nhân app không kiểm tra được → chỉ nêu để người dùng tự đối chiếu. */
$('psLumpSum').onclick = function(){
  var person=activePersonObj(), label=personLabel(person,state.activePerson-1);
  var r = bhxhLumpSum(person);
  if(!r.ok){
    appDialog({ title:r.reason==='invalid'?'Giai đoạn đóng còn lỗi':'Chưa có tháng đóng BHXH',
      html:r.reason==='invalid'
        ? 'Giai đoạn đóng của <b>'+esc(label)+'</b> còn lỗi định dạng tháng hoặc lương đóng — sửa các dòng được báo lỗi ở bảng “Giai đoạn đóng BHXH” rồi bấm lại. Chưa tính được mức rút.'
        : '<b>'+esc(label)+'</b> chưa có giai đoạn đóng BHXH hợp lệ nào. Thêm giai đoạn ở bảng “Giai đoạn đóng BHXH” rồi bấm lại.',
      okText:'Đã hiểu' });
    return;
  }
  function yrTxt(v){ return fmtNumVN(v, Number.isInteger(v) ? 0 : Number.isInteger(v*2) ? 1 : 2); }
  function mTxt(m){ var y=Math.floor(m/12), r2=m%12; return (y?y+' năm':'')+(y&&r2?' ':'')+(r2?r2+' tháng':''); }
  var L=r.split, estimateYear=Math.floor(Math.max(NOW,r.eligMonth)/12);
  var calculation = r.underOneYear
    ? '22% tổng lương/thu nhập đã đóng'+(r.capped ? ', giới hạn 2 tháng bình quân' : '')
    : yrTxt(r.monthlyCount)+' tháng bình quân × '+fmtMoney(r.avg)+' đ';
  var split = r.underOneYear
    ? '22% tổng lương/thu nhập đã đóng = '+fmtMoney(r.paid22)+' đ; tối đa 2 tháng bình quân = '+fmtMoney(2*r.avg)+' đ.'
    : (L.yearsPre ? yrTxt(L.yearsPre)+' năm trước 2014 × 1,5' : '')+
      (L.yearsPre && L.yearsPool ? ' + ' : '')+
      (L.yearsPool ? yrTxt(L.yearsPool)+' năm '+(r.monthsPost ? 'từ 2014' : 'tháng lẻ trước 2014')+' × '+yrTxt(L.poolRate) : '')+
      ' = '+yrTxt(r.monthlyCount)+' tháng bình quân.'+
      (r.monthsPre%12 && r.monthsPost ? ' '+r.monthsPre%12+' tháng lẻ trước 2014 được gộp vào giai đoạn sau.' : '');
  var warns=[];
  if(r.overlapMonths>0) warns.push(r.overlapMonths+' tháng đóng trùng chỉ tính một lần.');
  if(r.openRows>0) warns.push('Dòng chưa nhập “Đến tháng” được tính đến '+ymToStr(r.retireIdx)+'.');
  var html='<div class="lsum-hero">'+
      '<div class="lsum-caption">Số tiền ước tính</div>'+
      '<div class="lsum-amount">'+fmtMoney(r.amount)+' <small>đ</small></div>'+
      '<div class="lsum-date">Theo giá trị dự kiến năm '+estimateYear+' · đóng đến '+ymToStr(r.lastEnd)+'</div>'+
    '</div>'+
    '<div class="lsum-facts">'+
      '<div><span>Đã đóng</span><b>'+mTxt(r.months)+'</b></div>'+
      '<div><span>Lương/thu nhập bình quân</span><b>'+fmtMoney(r.avg)+' đ/tháng</b></div>'+
      '<div><span>Cách tính</span><b>'+calculation+'</b></div>'+
    '</div>'+
    '<div class="lsum-caution">Đây là mức ước tính, chưa xác nhận bạn đủ điều kiện nhận BHXH một lần.</div>'+
    (warns.length ? '<div class="lsum-warnings">'+warns.map(function(w){ return '⚠ '+esc(w); }).join('<br>')+'</div>' : '')+
    '<details class="lsum-more"><summary>Điều kiện và cách tính chi tiết</summary>'+
      '<div class="lsum-more-body">'+
        '<b>Phép tính:</b> '+split+' Tổng '+r.months+' tháng đóng (trước 2014: '+r.monthsPre+'; từ 2014: '+r.monthsPost+').<br>'+
        '<b>Khi nào được rút?</b> Nếu đã tham gia trước 01/07/2025 và đóng chưa đủ 20 năm, trường hợp nghỉ đóng cần đủ 12 tháng không tham gia BHXH trước khi nộp hồ sơ; theo lịch nhập, mốc chờ dự kiến là '+ymToStr(r.eligMonth)+'. Các trường hợp đủ tuổi hưu nhưng chưa đủ 15 năm, định cư nước ngoài, bệnh theo luật, suy giảm khả năng lao động từ 81% hoặc khuyết tật đặc biệt nặng có điều kiện riêng; một số quân nhân, công an xuất ngũ cũng có thể được hưởng.<br>'+
        '<b>Giả định:</b> Hệ số điều chỉnh tiền lương/thu nhập của năm '+estimateYear+' được dự phóng theo lạm phát đã nhập nếu chưa công bố. Cơ quan BHXH tính mức thực tế theo thời điểm ra quyết định. App chưa tính phần Nhà nước hỗ trợ đóng BHXH tự nguyện; phần này được tính trong một số trường hợp bệnh hoặc suy giảm khả năng lao động theo Điều 70.</div>'+
    '</details>';
  appDialog({ title:'Rút BHXH một lần · '+label, html:html, okText:'Đóng', cls:'lsum' });
};
/* Xác nhận nghĩa mức hưu của bản lưu cũ (migration v3 — bàn giao mục 7.2): KHÔNG suy đoán từ số tiền.
   M1: áp cho hộp của người đang chọn. */
$('psBasisCur').onclick = function(){     // số cũ đã là giá theo sức mua hiện tại → dùng nguyên
  var t=activePension(); t.amountBasis='baseMonth'; t.amountSource='manual'; refresh();
};
$('psBasisRet').onclick = function(){     // số cũ là giá tại tháng hưởng → quy về giá hiện tại, không nhân hai lần
  var t=activePension(), R=t.startYear*12+((t.startMonth===undefined?1:t.startMonth)-1);
  t.amount = t.amount / pensionFactor(R, NOW, state.infl);
  t.amountBasis='baseMonth'; t.amountSource='manual';
  $('psAmount').value = fmtMoney(t.amount);
  $('psAmount').dataset.good = String(Math.round(t.amount));
  refresh();
};
