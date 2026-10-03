'use strict';
/* [ui/setup.js] Tab nhập liệu đơn: Tab 1 (hồ sơ + dòng đời), Tab 2 (tài sản thanh khoản cao + BĐS —
   năm sở hữu, cho thuê, bán, chi phí duy tu theo giá hiện tại), Tab 4 (mốc chi + sự kiện chi),
   Tab 5 (pha thu nhập + sự kiện thu) + readInputs (đổ mọi ô tĩnh vào state — gọi đầu mỗi refresh).
   ĐỌC state + DOM; GHI state qua handler change/✕ (đóng danh tính đối tượng — R03); vẽ lại qua
   scheduleRefresh/refresh. Ô tiền theo chính sách ba tầng của ui/common.js. */
function readInputs(){
  var nextStart=parseYM($('startMonth').value);
  if(isFinite(nextStart)&&isFinite(NOW)&&nextStart!==NOW&&state.lifePlan){var delta=nextStart-NOW;lifeRows(state.lifePlan).forEach(function(r){r.from+=delta;if(r.income)r.income.anchor+=delta;});}
  state.startMonth=nextStart; if(isFinite(state.startMonth))NOW=state.startMonth;
  state.mainName=$('mainName').value;   /* Đ7 — tên hiển thị người chính nhập ở Tab 1 (trước đây ô này nằm trong #personMeta Tab 3) */
  state.birthYear=+$('birthYear').value;state.gender=$('gender').value;state.simYears=+$('simYears').value;
  state.infl=+$('infl').value;
  state.assets={mmf:moneyVal($('aMMF')),tk:moneyVal($('aTK')),tp:moneyVal($('aTP')),cp:moneyVal($('aCP'))};
  state.goldChi=+$('goldChi').value;
  state.goldPrice=moneyVal($('goldPrice'));
  state.goldSpread=+$('goldSpread').value;   /* chênh lệch % nhập ở Tab 6 · Lợi suất — giá bán lại tự tính, không nhập tay */
  state.rates={mmf:+$('rMMF').value,tk:+$('rTK').value,tp:+$('rTP').value,tkShort:+$('rTKShort').value,tkMedium:+$('rTKMedium').value,
    tpEarlyFee:+$('tpEarlyFee').value,tpMinMonths:+$('tpMinMonths').value,
    cpBuyFee:+$('cpBuyFee').value,cpSellFee:+$('cpSellFee').value};
  state.sellRule=$('sellRule').value;
  state.pensionMode='simple';
  /* Hai giai đoạn (bàn giao 10/09/2026): không ghi đè cả object — giữ amountSource/amountBasis.
     Khi nguồn là fromPeriods, KHÔNG đọc lại amount từ ô (ô chỉ hiển thị số làm tròn) để giữ
     kết quả tính nội bộ full precision — mục 4: không đọc lại số đã làm tròn để quy đổi qua lại.
     M1: hộp lương hưu đang hiển thị thuộc NGƯỜI ĐANG CHỌN ở tab con Tab 3. */
  var own=activePersonObj(), src=own?own.pension:state.pensionSimple;
  var pensionNext={
    amount:src.amountSource==='fromPeriods'?src.amount:moneyVal($('psAmount')),
    startYear:+$('psStart').value,startMonth:+$('psMonth').value,growth:+$('psGrowth').value,
    amountSource:src.amountSource||'manual',amountBasis:src.amountBasis||'baseMonth'
  };
  if(own)own.pension=pensionNext;else state.pensionSimple=pensionNext;
}
function drawTimeline(el, minIdx, maxIdx, retireIdx){
  var html = '<div class="bar">';
  var span = Math.max(1, maxIdx - minIdx);
  periodsChrono().forEach(function(p){
    if(p.type === 'none') return;
    var end = periodEnd(p, retireIdx);
    var l = (Math.max(p._f,minIdx)-minIdx)/span*100, w = (Math.min(end,maxIdx)-Math.max(p._f,minIdx))/span*100;
    if(w <= 0) return;
    html += '<div class="seg" style="left:'+l+'%;width:'+w+'%;background:'+TYPES[p.type].color+';" title="'+TYPES[p.type].label+'"></div>';
  });
  html += '</div>';
  var rl = null;
  if(retireIdx >= minIdx && retireIdx <= maxIdx){
    rl = (retireIdx-minIdx)/span*100;
    html += '<div class="mark" style="left:'+rl+'%"></div><div class="flag" style="left:'+rl+'%;">▼ nghỉ hưu</div>';
  }
  /* U06 — mốc bắt đầu nhận hưu NHẬP TAY khác mốc quy ước: hai nhãn riêng. Hai cờ đứng gần nhau
     trên thanh (chồng chữ — vd nghỉ hưu T7/2050 nhưng nhận hưu T1/2052) thì chỉ giữ nhãn nghỉ hưu;
     thời điểm nhận hưu vẫn xem được ở Tab 3 · BHXH. Ngưỡng theo pixel thật của thanh (tab đang ẩn
     thì clientWidth = 0, dùng bề rộng điển hình). */
  var psIdx = state.pensionSimple.startYear*12+(state.pensionSimple.startMonth===undefined?1:state.pensionSimple.startMonth)-1;
  if(state.pensionMode==='simple' && state.pensionSimple.amount>0 && psIdx>=minIdx && psIdx<=maxIdx && psIdx!==retireIdx){
    var pl = (psIdx-minIdx)/span*100;
    var wpx = el.clientWidth || 560;
    if(rl === null || Math.abs(pl-rl)/100*wpx >= 80)
      html += '<div class="mark" style="left:'+pl+'%;background:#0d9488;"></div><div class="flag" style="left:'+pl+'%;top:-16px;color:#0d9488;">▶ nhận hưu (nhập tay)</div>';
  }
  var nowL = (NOW-minIdx)/span*100;
  if(nowL >= 0 && nowL <= 100){
    html += '<div class="mark now" style="left:'+nowL+'%"></div>'+
            '<div class="nowflag" style="left:'+nowL+'%;"><span class="tri">▲</span>Bây giờ ('+Math.floor(NOW/12)+')</div>';
  }
  /* Thước năm: chia đều theo bước năm tròn (1/2/5/10/20) tùy độ dài dòng đời */
  var y0 = Math.ceil(minIdx/12), y1 = Math.floor(maxIdx/12), yrs = y1 - y0;
  var step = yrs <= 4 ? 1 : yrs <= 9 ? 2 : yrs <= 45 ? 5 : yrs <= 90 ? 10 : 20;
  html += '<div class="scale">';
  for(var t = Math.ceil(y0/step)*step; t <= y1; t += step){
    var pos = (t*12-minIdx)/span*100;
    html += pos <= 1.5 ? '<span class="s0">'+t+'</span>' :
            pos >= 98.5 ? '<span class="s1">'+t+'</span>' :
            '<span style="left:'+pos+'%">'+t+'</span>';
  }
  html += '</div>';
  el.innerHTML = html;
}
function renderTab1(s){
  $('kRetAge').textContent = ageAt(s.retireIdx)+' tuổi';
  $('kRetMonth').textContent = 'hưu từ '+ymToStr(s.retireIdx)+' (tháng đủ tuổi)';   /* đợt 13 — nhận hưu ngay tháng đủ tuổi */
  $('kFirstYear').textContent = String(Math.floor(s.firstOrDefault/12));
  $('kCohort').textContent = s.usingDefault ? 'mặc định: đủ 18 tuổi' :
    (s.first < 2025*12+6 ? 'bắt đầu trước 01/7/2025 — diện chuyển tiếp' : 'bắt đầu từ 01/7/2025');
  /* R08 — kỳ mô phỏng không hợp lệ: không chạy các vòng lặp/theo năm khổng lồ, chỉ báo lỗi */
  var simOk = Number.isInteger(state.simYears) && state.simYears >= 1 && state.simYears <= 100;
  if(simOk){
    var endIdx = NOW + state.simYears*12 - 1; // tháng cuối cùng được mô phỏng
    $('kEndAge').textContent = ageAt(endIdx)+' tuổi';
    $('kEndYear').textContent = 'đến hết '+ymToStr(endIdx);
    drawTimeline($('lifeTL'), state.birthYear*12, endIdx, s.retireIdx);
  } else {
    $('kEndAge').textContent = '—';
    $('kEndYear').textContent = 'số năm không hợp lệ — sửa ở ô "Số năm mô phỏng"';
    $('lifeTL').innerHTML = '<div class="hint">Số năm mô phỏng không hợp lệ (1–100) — không vẽ dòng đời cho đến khi sửa.</div>';
  }
  /* Tổng tài sản hiện tại (gồm vàng & BĐS đang sở hữu) + xem trước tiền thuê; BĐS có năm sở hữu
     trong tương lai được tách riêng "chờ nhận" vì chưa nằm trong tài sản hôm nay. */
  var landV = 0, areaV = 0, rentPrev = 0, pending = 0;
  state.landPlots.forEach(function(p){
    if(plotOwnIdx(p)>0){pending+=plotValue(p);return;}
    landV += plotValue(p); areaV += p.area;
    if(p.rent&&plotRentIdx(p)===0) rentPrev += (+p.rentVnd||0);   /* BĐS "thuê từ năm" tương lai chưa có dòng tiền hôm nay */
  });
  var tot = state.assets.mmf + state.assets.tk + state.assets.tp + state.assets.cp + state.goldChi*goldBid(state.goldPrice) + landV;
  $('assetTotal').innerHTML = 'Tổng tài sản hiện tại: <b>'+fmtTr(tot)+'</b>'+
    (areaV > 0 ? ' · BĐS '+fmtNumVN(areaV,0)+' m² = '+fmtTr(landV) : '')+
    (rentPrev > 0 ? ' · thuê BĐS dự kiến '+fmtTr(rentPrev)+'/tháng' : '')+
    (pending > 0 ? ' · chờ nhận thêm '+fmtTr(pending)+' (giá hiện tại, theo Năm sở hữu ở Tab 2)' : '');
}
function renderAssetLabels(){
  var landV = 0;
  state.landPlots.forEach(function(p){ if(plotOwnIdx(p)===0) landV += plotValue(p); });
  var g = (state.goldChi||0)*goldBid(state.goldPrice||0);
  var tot = state.assets.mmf + state.assets.tk + state.assets.tp + state.assets.cp + g + landV;
  $('aTitle').innerHTML = 'Tài sản thanh khoản cao ban đầu — tổng '+fmtTr(tot-g-landV);
  $('lbMMF').textContent = 'Quỹ MMF';
  $('lbTK').textContent  = 'Tiết kiệm';
  $('lbTP').textContent  = 'Quỹ Trái phiếu';
  $('lbCP').textContent  = 'Quỹ Cổ phiếu/ETF';
  $('lbGold').textContent = 'Vàng — số chỉ';
  $('goldSellNote').innerHTML='Giá bán lại ước tính: <b>'+fmtMoney(goldBid(state.goldPrice))+'</b> đ/chỉ (chênh lệch chỉnh ở Tab 6).';
}
var PCOLORS=['pc0','pc1','pc2','pc3','pc4','pc5','pc6','pc7'];
function renderPlots(){
  /* Tab 2 · mục Bất động sản — mỗi BĐS MỘT KHUNG viền màu riêng (phân biệt nhanh các BĐS):
     dòng 1 tên + “Có thể bán”; dòng 2 diện tích · năm sở hữu · giá trị; dòng 3 cho thuê (giá thuê
     VND/tháng + tăng %/năm, không còn % lợi suất) · năm bán + giá bán; dòng 4 danh mục chi phí
     sửa chữa/duy tu/bảo trì/đầu tư thêm {năm, nội dung, số tiền}. Mọi số tiền nhập theo GIÁ HIỆN TẠI. */
  var h='';
  state.landPlots.forEach(function(p,i){
    var dis=p.rent?'':' disabled';
    var k=plotOwnIdx(p)/12;
    var totFv=plotValue(p)*Math.pow(1+state.infl/100,k);
    var saleFv=(p.salePrice!=null&&p.saleYear!=null)?p.salePrice*Math.pow(1+state.infl/100,(p.saleYear*12+11-NOW)/12):0;
    var expH='<div class="pexprow head"><div>Năm</div><div>Nội dung</div><div>Số tiền (giá hiện tại)</div><div></div></div>';
    (p.expenses||[]).forEach(function(x,ei){
      var xf=(x.amount||0)*Math.pow(1+state.infl/100,(x.y*12+11-NOW)/12);
      expH+='<div class="pexprow" data-o="'+objToken(x)+'">'+
        '<div><input type="number" aria-label="Năm chi phí BĐS '+(i+1)+'" value="'+x.y+'" min="1900" max="2200" data-f="expY" data-i="'+i+'" data-ei="'+ei+'" title="Phát sinh cuối tháng 12 năm này'+(xf>0?' — ≈ '+fmtTr(xf)+' giá trị tương lai':'')+'"></div>'+
        '<div><input type="text" aria-label="Nội dung chi phí BĐS '+(i+1)+'" value="'+esc(x.label||'')+'" placeholder="sửa chữa, duy tu, bảo trì, đầu tư thêm…" data-f="expL" data-i="'+i+'" data-ei="'+ei+'"></div>'+
        '<div><input type="text" inputmode="numeric" class="money" aria-label="Số tiền chi phí BĐS '+(i+1)+'" value="'+fmtMoney(x.amount||0)+'" data-f="expA" data-i="'+i+'" data-ei="'+ei+'" title="Theo giá hiện tại'+(xf>0?' — ≈ '+fmtTr(xf)+' khi phát sinh':'')+'"></div>'+
        '<div><button class="del" data-f="expDel" data-i="'+i+'" data-ei="'+ei+'" aria-label="Xóa hạng mục chi phí '+(ei+1)+' của BĐS '+(i+1)+'">✕</button></div></div>';
    });
    if(!(p.expenses||[]).length)expH+='<div class="hint" style="margin:2px 0 4px;">Chưa có hạng mục — bấm ＋ Thêm hạng mục để thêm sửa chữa, duy tu, bảo trì hay khoản đầu tư thêm cho BĐS này.</div>';
    h+='<div class="property-card '+(PCOLORS[i%PCOLORS.length])+'" data-o="'+objToken(p)+'">'+
      '<div class="prow1"><div><label>Tên bất động sản</label><input aria-label="Tên BĐS '+(i+1)+'" value="'+esc(p.label)+'" data-f="label" data-i="'+i+'"></div>'+
      '<label class="pchk" style="margin:0 0 4px;" title="Chỉ các BĐS được đánh dấu mới bị bán sớm khi mọi tài sản thanh khoản đã hết; BĐS hẹn bán theo Năm bán vẫn bán đúng lịch."><input type="checkbox"'+(p.sellable===false?'':' checked')+' data-f="sellable" data-i="'+i+'">Có thể bán</label>'+
      '<button class="del" data-i="'+i+'" aria-label="Xóa BĐS '+(i+1)+'">✕</button></div>'+
      '<div class="row"><div><label>Diện tích m²</label><input type="number" aria-label="Diện tích BĐS '+(i+1)+'" value="'+p.area+'" data-f="area" data-i="'+i+'"></div>'+
      '<div><label>Năm sở hữu</label><input type="number" aria-label="Năm sở hữu BĐS '+(i+1)+'" value="'+(p.ownYear==null?'':p.ownYear)+'" placeholder="Đã có" min="1900" max="2200" data-f="ownYear" data-i="'+i+'" title="BĐS nhận sau này (thừa kế, tặng cho, mua…): trống = đã có từ hôm nay. Trước năm sở hữu BĐS chưa nằm trong tài sản, chưa cho thuê, chưa phát sinh chi phí và không bán được."></div>'+
      '<div><label>Giá trị (giá hiện tại)</label><input class="money" inputmode="numeric" aria-label="Giá trị BĐS '+(i+1)+'" value="'+fmtMoney(plotValue(p))+'" data-f="total" data-i="'+i+'" title="Theo giá hiện tại'+(k>0?' — quy đổi ≈ '+fmtTr(totFv)+' tại năm bắt đầu sở hữu (đã gồm lạm phát '+state.infl+'%/năm)':'')+'. Sau đó giá đi theo chuỗi BĐS ở Tab 6."></div></div>'+
      '<div class="row"><label class="pchk" style="margin:0 0 4px;"><input type="checkbox"'+(p.rent?' checked':'')+' data-f="rent" data-i="'+i+'">Cho thuê</label>'+
      '<div><label>Giá thuê/tháng</label><input type="text" inputmode="numeric" class="money" aria-label="Giá thuê BĐS '+(i+1)+'" value="'+fmtMoney(p.rentVnd||0)+'" placeholder="đ/tháng"'+dis+' data-f="rentVnd" data-i="'+i+'" title="Tiền thuê ròng theo giá hiện tại — mô phỏng tự nhân lạm phát tới tháng bắt đầu thuê rồi tăng theo Tăng thuê %/năm từ đó. Nhận đến hết tháng bán."></div>'+
      '<div><label>Tăng thuê %/năm</label><input type="number" value="'+(p.rentGrowth===undefined?2:p.rentGrowth)+'" step="0.5"'+dis+' data-f="rentGrowth" data-i="'+i+'"></div>'+
      '<div><label>Thuê từ năm</label><input type="number" aria-label="Năm bắt đầu cho thuê BĐS '+(i+1)+'" value="'+(p.rentFromYear==null?'':p.rentFromYear)+'" placeholder="Ngay khi có BĐS" min="1900" max="2200"'+dis+' data-f="rentFromYear" data-i="'+i+'" title="Trống = cho thuê ngay từ năm sở hữu. Nhập năm (vd nhà tự ở đến 2035 mới cho thuê): trước năm này chưa có tiền thuê; nhập trước năm sở hữu được coi như thuê ngay khi có BĐS."></div>'+
      '<div><label>Năm bán</label><input type="number" aria-label="Năm bán BĐS '+(i+1)+'" value="'+(p.saleYear===null?'':p.saleYear)+'" placeholder="Không hẹn bán" data-f="saleYear" data-i="'+i+'" title="Bán nguyên BĐS vào cuối tháng 12 của năm này — tháng bán vẫn nhận đủ tiền thuê, từ tháng sau hết hẳn. Trống = không hẹn bán (vẫn có thể bán sớm nếu đánh dấu Có thể bán)."></div>'+
      '<div><label>Giá bán (giá hiện tại)</label><input class="money" inputmode="numeric" aria-label="Giá bán BĐS '+(i+1)+'" value="'+(p.salePrice===null?'':fmtMoney(p.salePrice))+'" placeholder="Theo giá mô phỏng" data-f="salePrice" data-i="'+i+'" title="Giá bán theo giá hiện tại — mô phỏng tự nhân lạm phát tới tháng bán'+(saleFv>0?' (≈ '+fmtTr(saleFv)+' lúc bán)':'')+'. Trống = bán theo giá mô phỏng tại tháng bán."></div></div>'+
      '<div class="pexp"><div class="pexpt">Chi phí sửa chữa, duy tu, bảo trì, đầu tư thêm</div><div class="pexpwrap">'+expH+'</div>'+
      '<button class="btn mini ghost" data-f="addExp" data-i="'+i+'">＋ Thêm hạng mục</button></div></div>';
  });
  refreshList('plotList', h || '<div class="hint">Chưa có BĐS.</div>', function(box){
    function plotOf(el){return state.landPlots[+el.dataset.i];}
    box.querySelectorAll('input, select, button[data-f="addExp"]').forEach(function(el){
      var f=el.dataset.f;
      if(f==='addExp'){el.onclick=function(){
        var p=plotOf(el);if(state.landPlots.indexOf(p)<0)return;
        var y=Math.max(Math.floor(NOW/12),p.ownYear||Math.floor(NOW/12));
        (p.expenses=p.expenses||[]).push({y:y,label:'',amount:10000000});
        p.expenses.sort(function(a,b){return a.y-b.y;});
        refresh(false);
      };return;}
      var p=plotOf(el);   /* R03: đóng danh tính lúc gắn handler */
      el.onchange=function(){
        if(state.landPlots.indexOf(p)<0)return;
        var x=null;
        if(el.dataset.ei!==undefined)x=(p.expenses||[])[+el.dataset.ei];
        if(f==='label')p.label=el.value;
        else if(f==='sellable')p.sellable=el.checked;
        else if(f==='ownYear')p.ownYear=el.value===''?null:+el.value;
        else if(f==='saleYear')p.saleYear=el.value===''?null:+el.value;
        else if(f==='salePrice')p.salePrice=el.value===''?null:moneyVal(el);
        else if(f==='total')p.total=moneyVal(el);
        else if(f==='rent')p.rent=el.checked;
        else if(f==='rentVnd')p.rentVnd=moneyVal(el);
        else if(f==='rentFromYear')p.rentFromYear=el.value===''?null:+el.value;
        else if(f==='rentGrowth')p.rentGrowth=+el.value||0;
        else if(f==='expY'){if(x){x.y=+el.value;p.expenses.sort(function(a,b){return a.y-b.y;});}}
        else if(f==='expL'){if(x)x.label=el.value;}
        else if(f==='expA'){if(x)x.amount=moneyVal(el);}
        else p.area=+el.value;   /* diện tích — chỉ còn tham khảo, giá trị là ô Giá trị */
        scheduleRefresh();
      };
    });
    box.querySelectorAll('.del').forEach(function(b){
      var p=state.landPlots[+b.dataset.i];
      if(b.dataset.f==='expDel'){
        bindDel(b, function(){
          blurActiveIn(box);
          if(state.landPlots.indexOf(p)<0)return;
          var x=(p.expenses||[])[+b.dataset.ei];if(!x)return;
          p.expenses.splice(p.expenses.indexOf(x),1);refresh();
        });
        return;
      }
      bindDel(b, function(){
        blurActiveIn(box);
        /* ✕ xóa CẢ bất động sản (giá trị + cho thuê + chi phí) — xác nhận rõ, không hoàn tác được */
        appDialog({ title:'Xóa bất động sản?', html:'Xóa <b>'+esc(p.label||'BĐS không tên')+'</b> — mất cả giá trị tài sản, dòng tiền cho thuê lẫn danh mục chi phí của BĐS này. Thao tác không hoàn tác được; cân nhắc chỉ bỏ chọn “Cho thuê” nếu chỉ muốn ngừng cho thuê.', okText:'Xóa bất động sản', cancelText:'Giữ lại' })
          .then(function(ok){ if(ok){ var idx=state.landPlots.indexOf(p); if(idx>=0){ state.landPlots.splice(idx,1); refresh(); } } });
      });
    });
  });
}

var ALNAME = {mmf:'Quỹ MMF', tk:'Tiết kiệm', tp:'Quỹ Trái phiếu', cp:'Quỹ Cổ phiếu/ETF', gold:'Vàng'};
/* Tab 5 — mỗi giai đoạn thu nhập MỘT DÒNG như danh sách giai đoạn đóng Tab 3: Từ năm · Đến năm ·
   Thu nhập/tháng · Tăng%/năm · ✕. Tiền dư/thiếu do chiến lược đầu tư Tab 6 xử lý (đợt 14).
   Nút ＋ Thêm giai đoạn nằm dưới danh sách (handler $('addInc') cuối file). */
function renderIncomePeriods(){} // Unified rows are rendered by renderInvestmentPlan.
/* Hai bảng mốc chi Tab 4 dùng MỘT hàm render (plan-tab4-chi-co-dinh.md): nhóm lạm phát
   (state.milestones, #msList) và nhóm cố định không theo lạm phát (state.fixedMilestones, #fmsList).
   Khác nhau chỉ: nhãn cột tiền, tooltip, và nhóm cố định KHÔNG có mốc neo bắt buộc (xóa tự do). */
function renderMilestones(){
  renderMilestoneBox('msList', function(){return state.milestones;}, true);
  renderMilestoneBox('fmsList', function(){return state.fixedMilestones;}, false);
}
function renderMilestoneBox(boxId, getList, anchorLock){
  /* Dòng mốc chi dùng .msrow riêng (không phải .erow của sự kiện): cột tiền cố định vừa 1 tỷ,
     thêm cột Năm CHỈ ĐỌC — năm dương lịch của tháng kỷ niệm NOW+12*y, đổi tháng gốc tự vẽ lại. */
  var list = getList(), moneyHead = anchorLock ? 'Chi phí mỗi tháng (giá hiện tại)' : 'Chi phí mỗi tháng (số tiền thực trả)',
      moneyTip = anchorLock ? 'Chuẩn hoá theo lạm phát mỗi năm kỷ niệm' : 'Số tiền thực trả, giữ nguyên đến mốc kế — không quy đổi theo lạm phát';
  var h = '<div class="msrow head"><div>Năm thứ</div><div>Năm</div><div>Giai đoạn</div><div>'+moneyHead+'</div><div></div></div>';
  list.forEach(function(ms, i){
    var calY = Math.floor((NOW+12*ms.y)/12), apFrom = ymToStr(NOW+12*ms.y);
    h += '<div class="msrow" data-o="'+objToken(ms)+'"><div><input type="number" value="'+ms.y+'" data-k="m" data-i="'+i+'" min="0" title="Mốc năm thứ '+ms.y+' áp dụng từ '+apFrom+' (năm thứ tính từ tháng gốc)"></div>'+
      '<div class="cyear" title="Năm thứ '+ms.y+' bắt đầu áp dụng từ '+apFrom+' — tính theo tháng gốc, không sửa được">'+calY+'</div>'+
      '<div><input type="text" value="'+esc(ms.label||'')+'" placeholder="tên mốc" data-k="ml" data-i="'+i+'"></div>'+
      '<div><input type="text" inputmode="numeric" class="money" value="'+fmtMoney(ms.monthly)+'" data-k="mm" data-i="'+i+'" title="'+moneyTip+'"></div>'+
      '<div><button class="del" data-k="mdel" data-i="'+i+'" aria-label="Xóa mốc chi '+(i+1)+'">✕</button></div></div>';
  });
  refreshList(boxId, h, function(box){
    box.querySelectorAll('input').forEach(function(el){
      var ms = getList()[+el.dataset.i];   /* R03: danh tính lúc gắn — đổi năm sắp xếp lại danh sách */
      if(!ms) return;
      el.addEventListener('change', function(){
        var arr = getList();
        if(arr.indexOf(ms) < 0) return;
        if(el.dataset.k==='m'){ ms.y = +el.value; arr.sort(function(a,b){ return a.y-b.y; }); }
        else if(el.dataset.k==='ml') ms.label = el.value;
        else if(el.dataset.k==='mm') ms.monthly = moneyVal(el);
        scheduleRefresh();
      });
    });
    box.querySelectorAll('.del').forEach(function(b){
      var ms = getList()[+b.dataset.i];
      bindDel(b, function(){
        blurActiveIn(box);
        if(anchorLock && ms.y === 0){ appDialog({title:'Mức chi hiện tại',html:'Giữ mốc năm 0; có thể nhập mức chi bằng 0.',okText:'Đã hiểu'}); return; }
        var arr = getList(), idx = arr.indexOf(ms);
        if(idx >= 0){ arr.splice(idx, 1); refresh(); }
      });
    });
  });
}
/* kind = 'chi' (Tab 4) hoặc 'thu' (Tab 5) */
function renderEvents(kind, boxId){
  var h = '<div class="erow head"><div>Năm thứ</div><div>Tên sự kiện</div><div>Số tiền (giá hiện tại)</div><div></div></div>';
  state.events.forEach(function(e, i){
    if(e.kind !== kind) return;
    var fv = e.amount * Math.pow(1+state.infl/100, e.y);
    h += '<div data-o="'+objToken(e)+'">';   /* S02 — wrapper giữ định danh đối tượng qua các lần sort */
    h += '<div class="erow"><div><input type="number" value="'+e.y+'" data-k="e" data-i="'+i+'" min="0" title="Xảy ra cuối tháng '+ymToStr(NOW+Math.round(e.y*12))+'"></div>'+
      '<div><input type="text" value="'+esc(e.label||'')+'" placeholder="tên" data-k="el" data-i="'+i+'"></div>'+
      '<div><input type="text" inputmode="numeric" class="money" value="'+fmtMoney(e.amount)+'" data-k="ea" data-i="'+i+'" title="giá trị tương lai: '+fmtTr(fv)+'"></div>'+
      '<div><button class="del" data-k="edel" data-i="'+i+'" aria-label="Xóa sự kiện '+(i+1)+'">✕</button></div></div>';
    h += '<div class="erow" style="background:#fff;border:none;padding:0 8px 2px;margin-bottom:8px;"><div></div><div class="hint" style="margin:0;">→ '+fmtTr(fv)+' (giá tương lai)</div><div></div><div></div></div>';
    h += '</div>';   /* đóng wrapper data-o */
  });
  refreshList(boxId, h, function(box){
    box.querySelectorAll('input, select').forEach(function(el){
      var ev0 = state.events[+el.dataset.i];   /* R03: danh tính lúc gắn — đổi năm sắp xếp lại danh sách */
      if(!ev0) return;
      el.addEventListener('change', function(){
        if(state.events.indexOf(ev0) < 0) return;
        var v = el.value;
        if(el.dataset.k==='e'){ ev0.y = +v; state.events.sort(function(a,b){ return a.y-b.y; }); }
        else if(el.dataset.k==='el') ev0.label = v;
        else if(el.dataset.k==='ea') ev0.amount = moneyVal(el);
        scheduleRefresh();
      });
    });
    box.querySelectorAll('.del').forEach(function(b){
      var ev0 = state.events[+b.dataset.i];
      bindDel(b, function(){
        blurActiveIn(box);
        var idx = state.events.indexOf(ev0);
        if(idx >= 0){ state.events.splice(idx, 1); refresh(); }
      });
    });
  });
}

/* ＋ Thêm giai đoạn thu nhập (kiểu ＋ Thêm giai đoạn đóng của Tab 3): dòng mới bắt đầu sau mốc kết
   thúc XÁC ĐỊNH muộn nhất, không sớm hơn năm hiện tại; nếu có dòng mở “đến nghỉ hưu” thì nhảy qua
   khoảng hiệu lực của nó (đến hết tháng đủ tuổi nghỉ hưu người chính) kẻo gợi ý năm tạo pha chồng
   lấn — số liệu gợi ý sẵn, người dùng sửa trực tiếp ngay trên dòng. */
function newPlot(){ return {id:'property-'+Date.now()+'-'+Math.random().toString(36).slice(2), label:'BĐS '+(state.landPlots.length+1), ownYear:null, area:100, total:2500000000, sellable:true, saleYear:null, salePrice:null, rent:false, rentVnd:0, rentFromYear:null, rentGrowth:2, expenses:[]}; }
$('addPlot').onclick = function(){ state.landPlots.push(newPlot()); refresh(false); };
$('addMs').onclick = function(){ var y=1;while(state.milestones.some(function(m){return m.y===y;}))y++;state.milestones.push({y:y, label:'Mốc mới', monthly:10000000}); state.milestones.sort(function(a,b){ return a.y-b.y; }); refresh(false); };
/* Khoản cố định mới mặc định 0 đ nằm SAU mốc cuối cùng của nhóm — đúng quy ước "thêm mốc 0 ở cuối để
   kết thúc khoản" (mốc có hiệu lực từ đầu năm thứ của nó); số tiền thật người dùng tự sửa. */
$('addFixedMs').onclick = function(){
  var arr = state.fixedMilestones = state.fixedMilestones||[], last = arr.length ? Math.max.apply(null, arr.map(function(m){return m.y;})) : -1;
  var y = Math.max(0, last+1); while(arr.some(function(m){return m.y===y;}))y++;
  arr.push({y:y, label:'Khoản cố định', monthly:0}); arr.sort(function(a,b){ return a.y-b.y; }); refresh(false);
};
$('addEvChi').onclick = function(){ state.events.push({y:5, kind:'chi', label:'Sự kiện chi', amount:100000000}); state.events.sort(function(a,b){ return a.y-b.y; }); refresh(false); };
$('addEvThu').onclick = function(){ state.events.push({y:5, kind:'thu', label:'Thu lớn', amount:200000000}); state.events.sort(function(a,b){ return a.y-b.y; }); refresh(false); };
