'use strict';
/* [ui/results.js] Tab 7 — kết quả mô phỏng: KPI, biểu đồ NAV theo nguồn chi cùng đường
   so sánh tiết kiệm (savingsOnlyNav), biểu đồ giá trị từng nhóm tài sản (drawAllocChart), bảng theo năm,
   thông báo lỗi mô phỏng (showSimulationError) + nút Kiểm tra rủi ro (1.000 kịch bản mới mỗi lượt).
   ĐỌC state + kết quả runSim; KHÔNG ghi state. Bảng màu ASSET_COLORS là nguồn
   duy nhất cho mọi biểu đồ (AGENTS.md mục 6 — màu biểu đồ). */
/* BẢNG MÀU CHUNG cho 6 nhóm tài sản — nguồn DUY NHẤT: biểu đồ NAV theo nguồn chi (SRC_COLORS/DRAW_NAMES),
   biểu đồ phân bổ từng tháng (GROUPS + legend tĩnh phía trên), tooltip BĐS và biểu đồ chuỗi Tab 2 cùng đọc
   từ đây → cùng một tài sản luôn cùng màu trên mọi biểu đồ. 6 tông chọn rõ khác nhau:
   xanh dương / xanh lá / tím / cam / vàng / nâu (bỏ bộ 3 amber gần giống nhau cũ). */
var ASSET_COLORS = {
  mmf:{lab:'Quỹ MMF',        c:'#2563eb'},
  tk:{lab:'Tiết kiệm',   c:'#059669'},
  tp:{lab:'Quỹ Trái phiếu',  c:'#7c3aed'},
  cp:{lab:'Quỹ Cổ phiếu/ETF',    c:'#ea580c'},
  gold:{lab:'Vàng',      c:'#eab308'},
  land:{lab:'BĐS',       c:'#92400e'}
};
/* Màu đường NAV theo nguồn chi chính của TỪNG THÁNG: 6 nhóm tài sản lấy đúng ASSET_COLORS; nhãn không
   phải tài sản (hưu/thu nhập/sự kiện…) dùng tông riêng không trùng màu tài sản. */
var SRC_COLORS = (function(){
  var m = {'Lương hưu':'#0d9488','MMF/TK':'#2563eb','Thu nhập':'#4f46e5','Sự kiện':'#db2777','Thu sự kiện':'#0891b2','Tích lũy':'#64748b','KHÔNG ĐỦ':'#dc2626'};
  Object.keys(ASSET_COLORS).forEach(function(k){ m[ASSET_COLORS[k].lab] = ASSET_COLORS[k].c; });
  return m;
})();
function srcColor(k){ return SRC_COLORS[k] || '#94a3b8'; }
function chartMonthLabel(m){ return 'Tháng '+('0'+m.month).slice(-2)+'/'+m.year; }
function drawMainChart(sim){
  var W=1080, H=300, L=70, R=20, T=16, B=46;
  var ms = sim.months || []; if(!ms.length) return;
  var n = ms.length;
  var sonly=savingsOnlyNav(sim);
  /* R09 — miền trục phải chứa cả điểm NAV BAN ĐẦU (path đã thêm điểm i=-1): khi chi hết ngay tháng đầu
     làm NAV các tháng về 0, điểm đầu vẫn nằm trong vùng vẽ thay vì bay ngoài trục. */
  var maxY = Math.max(1e9, sim.initial || 0);
  ms.forEach(function(m){ maxY = Math.max(maxY, m.total, m.real); });
  sonly.nav.forEach(function(v){if(v>maxY)maxY=v;});
  /* U03 — trục dành thêm 1 bước bên trái cho điểm NAV BAN ĐẦU (i=-1): thay đổi lớn ngay tháng đầu thấy được */
  function X(i){ return L + (i+1)/n*(W-L-R); }
  function Y(v){ return T + (1-v/maxY)*(H-T-B); }
  /* Nguồn chi chính THEO THÁNG — cùng bộ quy tắc với cột "Nguồn chính" của bảng năm:
     thiếu chi > tài sản bị rút (nhiều nhất) > Lương hưu/Thu nhập (dòng tiền đủ chi, không rút tài sản)
     > bán BĐS > thu sự kiện > tích lũy. F15: không còn nhãn "Sự kiện" suy từ chi.
     Đợt 36 — chi từ Quỹ MMF thì hiển thị NGUỒN GIÁN TIẾP: tài sản đã bán nạp vào MMF gần nhất
     (engine gán sẵn trong effDrawn — phần rút MMF được tính theo nguồn của lô tiền đã dùng);
     chưa từng bán nạp thì mới là Quỹ MMF. Bán trực tiếp bù thiếu vẫn là tài sản bị bán. */
  var DRAW_NAMES = {}; Object.keys(ASSET_COLORS).forEach(function(k){ DRAW_NAMES[k] = ASSET_COLORS[k].lab; });
  var evByMi = {};
  state.events.forEach(function(e){
    var mi = Math.round(e.y*12);                 /* engine nổ sự kiện tại tháng round(y×12) */
    if(mi < 0 || mi >= n) return;
    if(!evByMi[mi]) evByMi[mi] = {ins:[], outs:[]};
    evByMi[mi][e.kind==='thu' ? 'ins' : 'outs'].push(e);
  });
  var srcByMi = ms.map(function(m){
    if(m.short) return 'KHÔNG ĐỦ';
    var eff = m.effDrawn || m.drawn || {};
    var keys = Object.keys(eff).sort(function(a,b){ return eff[b]-eff[a]; });
    if(keys.length) return DRAW_NAMES[keys[0]] || 'Tích lũy';
    /* R10 — nguồn chính là DÒNG THU LỚN NHẤT của tháng (hưu/lương+thuê/bán BĐS/thu sự kiện),
       không ưu tiên theo sự hiện diện: lương 1 triệu cạnh sự kiện thu 100 triệu không còn được gắn nhãn "Thu nhập". */
    var flows = [['Lương hưu', m.pension||0], ['Thu nhập', (m.salary||0)+(m.rent||0)], ['BĐS', m.ledger.propertyProceeds||0], ['Thu sự kiện', m.eventIn||0]]
      .sort(function(a,b){ return b[1]-a[1]; });
    if(flows[0][1] > 0) return flows[0][0];
    return 'Tích lũy';
  });
  var s = '<svg viewBox="0 0 '+W+' '+H+'">';
  for(var g=0; g<=5; g++){ var v=maxY*g/5, y=Y(v);
    s += '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="#eef2f7"/>';
    s += '<text x="'+(L-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="#94a3b8">'+fmtNumVN(v/1e9,1)+' tỷ đ</text>'; }
  var rmi = sim.retireIdx - NOW;
  if(rmi >= 0 && rmi < n) s += '<line x1="'+X(rmi)+'" y1="'+T+'" x2="'+X(rmi)+'" y2="'+(H-B)+'" stroke="#059669" stroke-width="2"/>';
  /* U06/M1 — mốc bắt đầu nhận hưu NHẬP TAY của TỪNG người trong gia đình (khác mốc quy ước):
     đường riêng để không đọc nhầm; tooltip ghi rõ tên người */
  pensionStarts().forEach(function(st){
    var psmi = st.idx - NOW;
    if(psmi>=0 && psmi<n && psmi!==rmi)
      s += '<line x1="'+X(psmi)+'" y1="'+T+'" x2="'+X(psmi)+'" y2="'+(H-B)+'" stroke="#0d9488" stroke-width="1.5" stroke-dasharray="5 3"><title>Bắt đầu nhận hưu — '+esc(st.name)+': '+ymToStr(st.idx)+'</title></line>';
  });
  /* Đường NAV điểm THEO TỪNG THÁNG (mịn đúng như engine mô phỏng) — chia đoạn màu theo nguồn chi của
     từng tháng, gộp liền các tháng cùng màu; đoạn i−1→i mang màu nguồn của tháng i. Đoạn đầu kéo về
     điểm NAV BAN ĐẦU (U03) để tháng đầu đổi nhiều cũng thấy. */
  function navAt(q){ return q < 0 ? sim.initial : ms[q].total; }
  var segs = [], cur = null;
  for(var si=0; si<n; si++){
    var sc = srcColor(srcByMi[si]);
    if(cur && cur.c === sc) cur.i1 = si;
    else { if(cur) segs.push(cur); cur = {c:sc, i0:si-1, i1:si}; }
  }
  if(cur) segs.push(cur);
  segs.forEach(function(g2){
    var d='';
    for(var q=g2.i0; q<=g2.i1; q++) d += (q===g2.i0?'M':' L')+X(q).toFixed(1)+','+Y(navAt(q)).toFixed(1);
    s += '<path d="'+d+'" fill="none" stroke="'+g2.c+'" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><title>'+(g2.i0<0?'NAV ban đầu':ymToStr(NOW+g2.i0))+' → '+ymToStr(NOW+g2.i1)+': '+srcByMi[g2.i1]+'</title></path>';
  });
  /* Dấu viền cho TỪNG tài sản bán nạp ròng MMF, kể cả khi nguồn ấy không lớn nhất tháng. */
  ms.forEach(function(m,i){
    var keys=Object.keys(m.refillBySrc||{}).filter(function(k){return m.refillBySrc[k]>0&&ASSET_COLORS[k];});
    keys.forEach(function(k,j){
      s += '<circle cx="'+X(i).toFixed(1)+'" cy="'+(Y(m.total)+(j-(keys.length-1)/2)*8).toFixed(1)+'" r="3.5" fill="#fff" stroke="'+ASSET_COLORS[k].c+'" stroke-width="2"><title>Bán nạp MMF: '+ASSET_COLORS[k].lab+' '+fmtTr(m.refillBySrc[k])+' · '+ymToStr(NOW+i)+'</title></circle>';
    });
  });
  var dr='M'+X(-1).toFixed(1)+','+Y(sim.initial).toFixed(1); ms.forEach(function(m, di){ dr += ' L'+X(di).toFixed(1)+','+Y(m.real).toFixed(1); });
  s += '<path d="'+dr+'" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4 4"/>';
  var ds='M'+X(-1).toFixed(1)+','+Y(sim.initial).toFixed(1);
  sonly.nav.forEach(function(v, di){ds+=' L'+X(di).toFixed(1)+','+Y(v).toFixed(1);});
  s += '<path d="'+ds+'" fill="none" stroke="#92400e" stroke-width="1.75" stroke-dasharray="7 4"><title>Nếu gửi tiết kiệm 100% · lãi '+sonly.rate+'%/năm</title></path>';
  /* Mốc sự kiện neo đúng THÁNG nổ trên đường NAV danh nghĩa: ▲ thu (dưới đường, chỉ lên) · ▼ chi (trên đường) */
  Object.keys(evByMi).forEach(function(k){
    var mi = +k, evs = evByMi[mi], m = ms[mi];
    var thu = evs.ins.length > 0, x = X(mi).toFixed(1), ny = Y(m.total).toFixed(1);
    var d = thu ? 'M'+x+','+(+ny+5)+' l5,8 l-10,0 z' : 'M'+x+','+(+ny-5)+' l-5,-8 l10,0 z';
    var lab = (thu?evs.ins:evs.outs).map(function(e){ return esc(e.label); }).join(', ');
    s += '<path d="'+d+'" fill="'+(thu?'#059669':'#dc2626')+'" stroke="#fff" stroke-width="1"><title>'+lab+' · '+ymToStr(NOW+mi)+'</title></path>';
  });
  /* nhãn năm đặt tại tháng 1 của các năm tròn nằm trong khoảng mô phỏng — bước thích ứng theo độ dài kỳ (U03) */
  var spanY = Math.ceil(n/12), yStep = spanY<=3 ? 1 : spanY<=8 ? 2 : 5;
  for(var yr = Math.ceil((Math.floor(NOW/12)+1)/yStep)*yStep; yr*12-NOW < n; yr += yStep){
    var mi2 = yr*12-NOW;
    if(mi2 < 0) continue;
    s += '<text x="'+X(mi2)+'" y="'+(H-B+18)+'" text-anchor="middle" font-size="11" fill="#64748b">'+yr+'</text>';
  }
  s += '<text x="'+(W-R)+'" y="'+(H-6)+'" text-anchor="end" font-size="10" fill="#94a3b8">tháng →</text>';
  /* lớp bắt hover: đường dọc + điểm nổi trên NAV, giá trị thực, tiết kiệm + tooltip */
  s += '<line id="navHL" x1="0" y1="'+T+'" x2="0" y2="'+(H-B)+'" stroke="#334155" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>';
  s += '<circle id="navC1" r="4.5" fill="#059669" stroke="#fff" stroke-width="1.5" style="display:none"/>';
  s += '<circle id="navC2" r="4.5" fill="#64748b" stroke="#fff" stroke-width="1.5" style="display:none"/>';
  s += '<circle id="navC3" r="4.5" fill="#92400e" stroke="#fff" stroke-width="1.5" style="display:none"/>';
  s += '<rect id="navOV" x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(H-T-B)+'" fill="transparent" style="cursor:crosshair"/>';
  s += '</svg><div class="tt" id="navTT"></div>';
  $('chartBox').innerHTML = s;
  /* Legend động: nguồn chi xuất hiện trên đường NAV, theo thứ tự thời gian */
  var seen={}, ord=[];
  srcByMi.forEach(function(k){ if(!seen[k]){ seen[k]=srcColor(k); ord.push(k); } });
  var lg=''; ord.forEach(function(k){ lg += '<span><i style="background:'+seen[k]+'"></i>'+k+'</span>'; });
  var marked={};ms.forEach(function(m){Object.keys(m.refillBySrc||{}).forEach(function(k){if(m.refillBySrc[k]>0&&ASSET_COLORS[k])marked[k]=true;});});
  Object.keys(marked).forEach(function(k){lg += '<span><i style="background:#fff;border:2px solid '+ASSET_COLORS[k].c+'"></i>'+ASSET_COLORS[k].lab+' · bán nạp MMF</span>';});
  $('srcLegend').innerHTML = lg;
  /* ===== Hover tooltip cho biểu đồ NAV ===== */
  (function(){
    var svg = $('chartBox').querySelector('svg'), tt = $('navTT');
    var hl = svg.querySelector('#navHL'), ov = svg.querySelector('#navOV');
    var marks = [svg.querySelector('#navC1'), svg.querySelector('#navC2'), svg.querySelector('#navC3')];
    function trow(c, lab, val){ return '<div class="tr"><span><i style="background:'+c+'"></i>'+lab+'</span><b>'+val+'</b></div>'; }
    function hide(){
      tt.style.display = 'none'; hl.style.display = 'none';
      marks.forEach(function(m){ m.style.display = 'none'; });
    }
    ov.addEventListener('pointermove', function(ev){
      var r = svg.getBoundingClientRect();
      var vx = (ev.clientX - r.left)*(W/r.width);
      var i = Math.max(0, Math.min(n-1, Math.round((vx-L)/(W-L-R)*n)-1)); /* U03: trục đã dịch 1 bước cho điểm ban đầu */
      var a = ms[i], mc = srcColor(srcByMi[i]);
      hl.setAttribute('x1', X(i)); hl.setAttribute('x2', X(i)); hl.style.display = '';
      var vals = [a.total, a.real, sonly.nav[i]];
      for(var k=0;k<vals.length;k++){ marks[k].setAttribute('cx', X(i)); marks[k].setAttribute('cy', Y(vals[k])); marks[k].style.display = ''; }
      marks[0].setAttribute('fill', mc); /* chấm nổi theo màu nguồn chi của tháng đang hover */
      var soldBalance={},soldSpend={},soldReserve={},bought={};
      (a.strategy.trades||[]).forEach(function(t){
        var map=t.side==='buy'?bought:t.reason==='Bù phần chi còn thiếu'?soldSpend:
          (t.reason==='Tái cân bằng theo lịch'||t.reason==='Áp dụng tỷ trọng của giai đoạn'||t.reason==='Cân bằng khi sổ tiết kiệm đáo hạn'||t.reason==='Sổ tiết kiệm đáo hạn — chờ kỳ cân bằng')?soldBalance:soldReserve;
        map[t.asset]=(map[t.asset]||0)+t.amount;
      });
      function tradeLines(label,map){
        var keys=Object.keys(map).sort(function(x,y){return map[y]-map[x];});
        var total=keys.reduce(function(sum,k){return sum+map[k];},0);
        return trow('#64748b',label,fmtTr(total))+
          (keys.length?'<div class="trade-parts">Trong đó: '+keys.map(function(k){return ASSET_COLORS[k].lab.replace(/^Quỹ /,'')+' '+fmtTr(map[k]);}).join(' · ')+'</div>':'');
      }
       var isBalancing=(a.strategy.review||a.strategy.maturityReview)&&a.strategy.method!=='bucket';
      var mainKey=Object.keys(a.effDrawn||{}).sort(function(x,y){return a.effDrawn[y]-a.effDrawn[x];})[0];
      var srcLab = srcByMi[i] + (mainKey&&mainKey!=='mmf'&&a.mmfSpentBySrc&&a.mmfSpentBySrc[mainKey]>0?' (qua Quỹ MMF)':'');
      var html = '<div class="th">'+chartMonthLabel(a)+' · '+a.age+' tuổi</div>'+
        trow(mc,'Tài sản (danh nghĩa)', fmtTr(a.total))+
        trow('#92400e','Nếu gửi tiết kiệm 100%',fmtTr(sonly.nav[i])+(sonly.firstShort>=0&&NOW+i>=sonly.firstShort?' · đã thiếu chi':''))+
        trow(mc,'Màu đường tháng này', srcLab)+
        (isBalancing ? tradeLines('Bán cân bằng',soldBalance)+tradeLines('Mua cân bằng',bought) : '')+
        (Object.keys(soldSpend).length ? tradeLines('Bán bù chi',soldSpend) : '')+
        (Object.keys(soldReserve).length ? tradeLines('Bán bổ sung MMF',soldReserve) : '')+
        (!isBalancing&&Object.keys(bought).length ? tradeLines('Mua đầu tư',bought) : '')+
        trow('#64748b','MMF cuối tháng',fmtTr(a.mmf)+(a.expense>0?' · '+(a.mmf/a.expense).toFixed(1).replace('.',',')+' tháng':''));
      var evs = evByMi[i];
      if(evs){
        evs.outs.forEach(function(e2){ html += '<div class="tr" style="margin-top:3px;color:#b91c1c"><span>▼ '+esc(e2.label)+' (chi)</span><b>'+fmtTr(e2.amount*Math.pow(1+state.infl/100, e2.y))+'</b></div>'; });
        evs.ins.forEach(function(e2){ html += '<div class="tr" style="margin-top:3px;color:#059669"><span>▲ '+esc(e2.label)+' (thu)</span><b>'+fmtTr(e2.amount*Math.pow(1+state.infl/100, e2.y))+'</b></div>'; });
      }
      tt.innerHTML = html;
      tt.style.display = 'block';
      var cr = $('chartBox').getBoundingClientRect();
      var px = X(i)*(r.width/W);
      var lx = px + 14; if(lx + tt.offsetWidth > cr.width - 4) lx = px - tt.offsetWidth - 14;
      var ly = Math.max(4, Math.min(ev.clientY - cr.top - 14, cr.height - tt.offsetHeight - 4));
      tt.style.left = lx+'px'; tt.style.top = ly+'px';
    });
    ov.addEventListener('pointerleave', hide);
  })();
}
/* ===== Biểu đồ giá trị TỪNG NHÓM tài sản theo TỪNG THÁNG (Tab 7) ===== */
function drawAllocChart(sim){
  var ms = sim.months || [];
  if(!ms.length){ $('allocChartBox').innerHTML = ''; return; }
  var W=1080, H=320, L=70, R=16, T=14, B=40;
  var n = ms.length;
  /* R09 — số dư ĐẦU KỲ từng nhóm (theo state, chỉ để hiển thị) làm điểm đầu các đường và nằm trong miền trục */
  var g0 = {
    mmf: state.assets.mmf || 0, tk: state.assets.tk || 0, tp: state.assets.tp || 0, cp: state.assets.cp || 0,
    gold: (state.goldChi || 0) * goldBid(state.goldPrice || 0),
    land: state.landPlots.reduce(function(v, p){ return v + plotValue(p); }, 0)
  };
  var maxV = Math.max(1, sim.initial || 0);
  Object.keys(g0).forEach(function(k){ maxV = Math.max(maxV, g0[k]); });
  ms.forEach(function(r){ if(r.total > maxV) maxV = r.total; });
  function X(i){ return L + (i+1)/n*(W-L-R); } /* U03 — 1 bước bên trái cho điểm NAV ban đầu */
  function Y(v){ return T + (1-v/maxV)*(H-T-B); }
  var GROUPS = Object.keys(ASSET_COLORS).map(function(k){ return {k:k, lab:ASSET_COLORS[k].lab, c:ASSET_COLORS[k].c}; });
  var s = '<svg viewBox="0 0 '+W+' '+H+'">';
  for(var g=0; g<=5; g++){ var v=maxV*g/5, y=Y(v);
    s += '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="#eef2f7"/>';
    s += '<text x="'+(L-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="#94a3b8">'+fmtNumVN(v/1e9,1)+' tỷ</text>'; }
  var rx = X(Math.max(0, Math.min(n-1, sim.retireIdx-NOW)));
  if(sim.retireIdx >= NOW && sim.retireIdx <= NOW+n) s += '<line x1="'+rx+'" y1="'+T+'" x2="'+rx+'" y2="'+(H-B)+'" stroke="#059669" stroke-width="2"/>';
  /* U06/M1 — mốc nhận hưu nhập tay của từng người, khác mốc quy ước */
  pensionStarts().forEach(function(st){
    var psmi2 = st.idx - NOW;
    if(psmi2>=0 && psmi2<n && psmi2!==sim.retireIdx-NOW)
      s += '<line x1="'+X(psmi2)+'" y1="'+T+'" x2="'+X(psmi2)+'" y2="'+(H-B)+'" stroke="#0d9488" stroke-width="1.5" stroke-dasharray="5 3"><title>Bắt đầu nhận hưu — '+esc(st.name)+': '+ymToStr(st.idx)+'</title></line>';
  });
  GROUPS.forEach(function(gr){
    var d = 'M'+X(-1).toFixed(1)+','+Y(g0[gr.k]).toFixed(1);
    ms.forEach(function(r, i){ d += ' L'+X(i).toFixed(1)+','+Y(r[gr.k]).toFixed(1); });
    s += '<path d="'+d+'" fill="none" stroke="'+gr.c+'" stroke-width="1.6"/>';
  });
  var dt='M'+X(-1).toFixed(1)+','+Y(sim.initial).toFixed(1); ms.forEach(function(r, i){ dt += ' L'+X(i).toFixed(1)+','+Y(r.total).toFixed(1); });
  s += '<path d="'+dt+'" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-dasharray="6 4"/>';
  var spanY2 = Math.ceil(n/12), yStep2 = spanY2<=3 ? 12 : spanY2<=8 ? 24 : 60;
  for(var yr=0; yr<n; yr+=yStep2){ s += '<text x="'+X(yr)+'" y="'+(H-B+18)+'" text-anchor="middle" font-size="11" fill="#64748b">'+(Math.floor(NOW/12)+Math.floor(yr/12))+'</text>'; }
  s += '<text x="'+(W-R)+'" y="'+(H-6)+'" text-anchor="end" font-size="10" fill="#94a3b8">tháng →</text>';
  /* lớp bắt hover */
  s += '<line id="acHL" x1="0" y1="'+T+'" x2="0" y2="'+(H-B)+'" stroke="#334155" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>';
  GROUPS.forEach(function(gr, gi){ s += '<circle id="acC'+gi+'" r="4" fill="'+gr.c+'" stroke="#fff" stroke-width="1.2" style="display:none"/>'; });
  s += '<circle id="acCT" r="4.5" fill="#1e293b" stroke="#fff" stroke-width="1.5" style="display:none"/>';
  s += '<rect id="acOV" x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(H-T-B)+'" fill="transparent" style="cursor:crosshair"/>';
  s += '</svg><div class="tt" id="acTT"></div>';
  $('allocChartBox').innerHTML = s;
  (function(){
    var svg = $('allocChartBox').querySelector('svg'), tt = $('acTT'), hl = svg.querySelector('#acHL'), ov = svg.querySelector('#acOV');
    var marks = GROUPS.map(function(_, gi){ return svg.querySelector('#acC'+gi); }); marks.push(svg.querySelector('#acCT'));
    function hide(){ tt.style.display='none'; hl.style.display='none'; marks.forEach(function(m){ m.style.display='none'; }); }
    ov.addEventListener('pointermove', function(ev){
      var r = $('allocChartBox').querySelector('svg').getBoundingClientRect();
      var vx = (ev.clientX-r.left)*(W/r.width);
      var i = Math.max(0, Math.min(n-1, Math.round((vx-L)/(W-L-R)*n)-1)); /* U03: trục đã dịch 1 bước */
      var a = ms[i];
      hl.setAttribute('x1', X(i)); hl.setAttribute('x2', X(i)); hl.style.display = '';
      var vals = GROUPS.map(function(gr){ return a[gr.k]; }); vals.push(a.total);
      for(var k=0;k<vals.length;k++){ marks[k].setAttribute('cx', X(i)); marks[k].setAttribute('cy', Y(vals[k])); marks[k].style.display=''; }
      function row(c, lab, val){ return '<div class="tr"><span><i style="background:'+c+'"></i>'+lab+'</span><b>'+fmtTr(val)+'</b></div>'; }
      var html = '<div class="th">'+chartMonthLabel(a)+' · '+a.age+' tuổi</div>';
      GROUPS.forEach(function(gr){ html += row(gr.c, gr.lab, a[gr.k]); });
      html+=row('#64748b','TK: lãi tạm tính',a.tkAccrued)+row('#64748b','Tiền rút được (chưa BĐS)',a.liquid);
      html += row('#1e293b', '<b>Tổng</b>', a.total);
      tt.innerHTML = html; tt.style.display = 'block';
      var cr = $('allocChartBox').getBoundingClientRect();
      var px = X(i)*(r.width/W);
      var lx = px + 14; if(lx + tt.offsetWidth > cr.width - 4) lx = px - tt.offsetWidth - 14;
      tt.style.left = lx+'px';
      tt.style.top = Math.max(4, Math.min(ev.clientY - cr.top - 14, cr.height - tt.offsetHeight - 4))+'px';
    });
    ov.addEventListener('pointerleave', hide);
  })();
}
/* Một bảng năm: ô cuối tóm tắt việc cần làm, mở đúng năm để xem thứ tự từng tháng.
   Chỉ dựng 12 tháng của năm đang mở; mọi số đọc trực tiếp từ snap của runSim. */
var yearActionSim=null,openYearActionYear=null;
function actionAsset(k){return esc(ALNAME[k]||k);}
function actionTrade(t,usedForExpense){
  var verb=t.asset==='tk'?(t.side==='sell'?'Rút tiết kiệm':'Gửi tiết kiệm'):(t.side==='sell'?'Bán ':'Mua ')+actionAsset(t.asset);
  var note=[];
  if(usedForExpense!=null&&t.amount-usedForExpense>=1)note.push('dùng '+fmtTr(usedForExpense)+' để chi');
  if(t.cost>=1){
    var kind=t.asset==='tk'&&t.side==='sell'?'mất lãi kỳ này':t.asset==='tp'&&t.side==='sell'?'phí rút':
      t.asset==='gold'?'chênh lệch mua–bán':'phí giao dịch';
    note.push(kind+' '+fmtTr(t.cost));
  }
  return verb+' ('+fmtTr(t.amount)+(note.length?'; '+note.join('; '):'')+')';
}
function actionEvents(m,kind){
  return state.events.filter(function(e){return e.kind===kind&&Math.round(e.y*12)===m.mi&&e.amount*Math.pow(1+state.infl/100,e.y)>=1;})
    .map(function(e){return 'Sự kiện '+esc(e.label||'khác')+' ('+fmtTr(e.amount*Math.pow(1+state.infl/100,e.y))+')';});
}
function monthActionHtml(m){
  /* Engine có thể tạo lệnh vài phần triệu đồng do sai số float; không phải việc người dùng cần làm. */
  var trades=(m.strategy.trades||[]).filter(function(t){return t.amount>=1;}),spendSales=[],reserveSales=[],balanceSales=[],buys=[];
  trades.forEach(function(t){
    if(t.side==='buy')buys.push(actionTrade(t));
    else if(t.reason==='Bù phần chi còn thiếu')spendSales.push(t);
    else if(t.reason==='Tái cân bằng theo lịch'||t.reason==='Áp dụng tỷ trọng của giai đoạn'||t.reason==='Cân bằng khi sổ tiết kiệm đáo hạn'||t.reason==='Sổ tiết kiệm đáo hạn — chờ kỳ cân bằng')balanceSales.push(actionTrade(t));
    else reserveSales.push(actionTrade(t));
  });
  var steps=[],property=m.ledger.propertyProceeds||0;
  var income=[['Lương/thu nhập',m.salary],['Lương hưu',m.pension],['Tiền thuê BĐS',m.rent]].filter(function(x){return x[1]>=1;})
    .map(function(x){return x[0]+' ('+fmtTr(x[1])+')';});
  if(m.eventIn>=1)income=income.concat(actionEvents(m,'thu').length?actionEvents(m,'thu'):['Thu sự kiện ('+fmtTr(m.eventIn)+')']);
  if(property>=1&&!m.drawn.land)income.push('Bán BĐS theo lịch ('+fmtTr(property)+')');
  steps.push('<b>Thu:</b> '+(income.length?income.join(' + '):'Không'));
  var expenses=m.expense>=1?['Chi tiêu thường kỳ ('+fmtTr(m.expense)+')']:[];
  var eventExpense=Math.max(0,m.eventOut-m.plotExp);
  if(eventExpense>=1)expenses=expenses.concat(actionEvents(m,'chi').length?actionEvents(m,'chi'):['Chi sự kiện ('+fmtTr(eventExpense)+')']);
  if(m.plotExp>=1)expenses.push('Chi BĐS ('+fmtTr(m.plotExp)+')');
  var chi='<b>Chi:</b> '+(expenses.length?expenses.join(' + '):'Không');
  if(m.short>=1)chi+='; <b style="color:#b91c1c">chưa trả '+fmtTr(m.short)+'</b>';
  steps.push(chi);
  var usedAssets=Object.keys(m.drawn||{}).reduce(function(n,k){return n+(m.drawn[k]||0);},0);
  var usedIncome=Math.max(0,m.ledger.fundedOut-usedAssets),funding=[];
  if(usedIncome>=1)funding.push('Tiền thu ('+fmtTr(usedIncome)+')');
  if(m.drawn.mmf>=1)funding.push('Rút MMF ('+fmtTr(m.drawn.mmf)+')');
  var spendUsed={};
  spendSales.forEach(function(t){
    var used=Math.min(t.amount,Math.max(0,(m.drawn[t.asset]||0)-(spendUsed[t.asset]||0)));
    spendUsed[t.asset]=(spendUsed[t.asset]||0)+used;
    funding.push(actionTrade(t,used));
  });
  if(m.drawn.land>=1)funding.push('Bán BĐS ('+fmtTr(property)+'; dùng '+fmtTr(m.drawn.land)+' để chi)');
  if(m.ledger.plannedOut>=1){
    steps.push('<b>Nguồn chi:</b> '+(funding.length?funding.join(' + '):'Chưa có nguồn trả'));
  }
  if(m.topup>=1)steps.push('<b>Giữ tiền dư trong MMF:</b> '+fmtTr(m.topup));
  if(reserveSales.length)steps.push('<b>Bán để bổ sung MMF:</b> '+reserveSales.join(' + '));
  var balancing=(m.strategy.review||m.strategy.maturityReview)&&m.strategy.method!=='bucket';
  if(m.strategy.maturityReview){
    if(balanceSales.length)steps.push('<b>Sổ đáo hạn — chuyển vào MMF:</b> '+balanceSales.join(' + '));
    if(buys.length)steps.push('<b>Đầu tư tiền sổ đáo hạn:</b> '+buys.join(' + '));
  }else{
    if(balanceSales.length||balancing&&buys.length)steps.push('<b>Cân bằng — bán:</b> '+(balanceSales.length?balanceSales.join(' + '):'Không'));
    if(balancing&&(balanceSales.length||buys.length))steps.push('<b>Cân bằng — mua:</b> '+(buys.length?buys.join(' + '):'Không; tiền chưa mua giữ trong MMF'));
    else if(buys.length)steps.push('<b>Đầu tư khoản thu còn lại:</b> '+buys.join(' + '));
  }
  if(!trades.length&&(m.drawn.land||0)<1&&property<1)steps.push('<b>Mua/bán tài sản:</b> Không');
  var refill=Object.keys(m.refillBySrc||{}).filter(function(k){return m.refillBySrc[k]>=1;}).map(function(k){return actionAsset(k)+' ('+fmtTr(m.refillBySrc[k])+')';});
  var end='MMF cuối tháng: '+fmtTr(m.strategy.reserveActual)+'; mốc dự phòng theo Tab 5: '+fmtTr(m.strategy.reserveTarget)+'.';
  var eventCash=Math.min(Math.max(0,m.strategy.reserveActual-m.strategy.reserveTarget),m.strategy.futureBills||0);
  if(eventCash>=1)end+=' Giữ thêm '+fmtTr(eventCash)+' cho các khoản chi lớn đã nhập trong 12 tháng tới.';
  if(m.strategy.refillTrigger)end+=reserveSales.length?' MMF đã xuống dưới nửa mốc nên bán tài sản để bổ sung dự phòng.':' MMF đã xuống dưới nửa mốc nhưng không còn tài sản thanh khoản để bổ sung.';
  else if(m.strategy.refillDeferred)end+=' MMF đủ trả các khoản chi đã biết đến lúc sổ/quỹ trái phiếu đáo hạn; chờ để tránh phí rút sớm.';
  else if(m.strategy.method!=='bucket'&&m.strategy.reserveShort>=1&&!balancing)end+=' Chưa đến kỳ cân bằng và MMF chưa xuống dưới nửa mốc; tháng này không cần bán chỉ để bù dự phòng.';
  if(refill.length)end+=' Tiền bán còn trong MMF sau khi mua: '+refill.join(' + ')+'.';
  if(balanceSales.length||balancing&&buys.length)end+=m.strategy.maturityWait?' Sổ vừa đáo hạn; tiền chuyển vào MMF để phân bổ ở kỳ cân bằng tháng sau.':m.strategy.maturityReview?' Mục đích giao dịch: tận dụng lúc sổ tiết kiệm đáo hạn để cân bằng, tránh mất lãi khi rút sớm.':' Mục đích giao dịch: cân bằng tỷ trọng tài sản theo Tab 5.';
  else if(buys.length)end+=' Mục đích mua: phân bổ khoản thu mới sau khi giữ dự phòng theo Tab 5.';
  return '<div class="year-month"><strong>'+chartMonthLabel(m)+'</strong>'+
    '<div><ol>'+steps.map(function(x){return '<li>'+x+'</li>';}).join('')+'</ol><div class="month-end">'+end+'</div></div></div>';
}
function yearActionSummary(ms){
  var kinds={spend:[],reserve:[],balance:[],maturity:[],buy:[],property:[],short:[]};
  ms.forEach(function(m){
    var trades=(m.strategy.trades||[]).filter(function(t){return t.amount>=1;});
    var balance=trades.some(function(t){return t.reason==='Tái cân bằng theo lịch'||t.reason==='Áp dụng tỷ trọng của giai đoạn'||t.reason==='Cân bằng khi sổ tiết kiệm đáo hạn'||t.reason==='Sổ tiết kiệm đáo hạn — chờ kỳ cân bằng';})||
      (m.strategy.review||m.strategy.maturityReview)&&m.strategy.method!=='bucket'&&trades.some(function(t){return t.side==='buy';});
    if(trades.some(function(t){return t.side==='sell'&&t.reason==='Bù phần chi còn thiếu';})||(m.drawn.land||0)>=1)kinds.spend.push(m.month);
    if(trades.some(function(t){return t.side==='sell'&&t.reason!=='Bù phần chi còn thiếu'&&t.reason!=='Tái cân bằng theo lịch'&&t.reason!=='Áp dụng tỷ trọng của giai đoạn'&&t.reason!=='Cân bằng khi sổ tiết kiệm đáo hạn'&&t.reason!=='Sổ tiết kiệm đáo hạn — chờ kỳ cân bằng';}))kinds.reserve.push(m.month);
    if(balance){if(m.strategy.maturityReview)kinds.maturity.push(m.month);else kinds.balance.push(m.month);}
    if(!balance&&trades.some(function(t){return t.side==='buy';}))kinds.buy.push(m.month);
    if(m.ledger.propertyProceeds>=1&&(m.drawn.land||0)<1)kinds.property.push(m.month);
    if(m.short>=1)kinds.short.push(m.month);
  });
  function months(a){return 'T'+a.join(', T');}
  var parts=[];
  if(kinds.balance.length)parts.push('Cân bằng '+months(kinds.balance));
  if(kinds.maturity.length)parts.push('Xử lý sổ đáo hạn '+months(kinds.maturity));
  if(kinds.buy.length)parts.push('Đầu tư khoản thu còn lại '+months(kinds.buy));
  if(kinds.spend.length)parts.push('Bán để chi '+months(kinds.spend));
  if(kinds.reserve.length)parts.push('Bán bổ sung MMF '+months(kinds.reserve));
  if(kinds.property.length)parts.push('Bán BĐS theo lịch '+months(kinds.property));
  if(!parts.length)parts.push('Không có lệnh mua/bán tài sản');
  if(kinds.short.length)parts.push('Thiếu chi '+months(kinds.short));
  return parts.join(' · ');
}
function setYearActionOpen(year){
  var table=$('yearTable');if(!table)return;
  table.querySelectorAll('.year-plan-detail').forEach(function(row){row.hidden=true;});
  table.querySelectorAll('.year-toggle').forEach(function(btn){btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-label','Mở kế hoạch năm '+btn.dataset.year);btn.querySelector('.year-caret').textContent='▸';});
  var btn=year==null?null:table.querySelector('.year-toggle[data-year="'+String(year)+'"]');
  if(!btn||!yearActionSim){openYearActionYear=null;return;}
  var detail=table.querySelector('.year-plan-detail[data-year="'+String(year)+'"]');
  if(!detail){openYearActionYear=null;return;}
  detail.firstElementChild.innerHTML='<div class="year-month-list">'+yearActionSim.months.filter(function(m){return m.year===+year;}).map(monthActionHtml).join('')+'</div>';
  detail.hidden=false;btn.setAttribute('aria-expanded','true');btn.setAttribute('aria-label','Thu kế hoạch năm '+year);btn.querySelector('.year-caret').textContent='▾';
  openYearActionYear=String(year);
}
$('yearTable').addEventListener('click',function(ev){
  var btn=ev.target.closest('.year-toggle');if(!btn)return;
  setYearActionOpen(openYearActionYear===btn.dataset.year?null:btn.dataset.year);
});
function renderSimulationResults(vs){
  readInputs();
  /* Chặn mô phỏng khi dữ liệu có lỗi (pha trùng, số âm, ngoài khoảng…) — XOÁ kết quả cũ, khoá nút rủi ro để không ai đọc nhầm số sai */
  vs = vs || validateState();
  var errs = vs.filter(function(v){ return v.level === 'error'; });
  /* R06 — lỗi refOnly là lỗi dữ liệu THAM KHẢO BHXH (giai đoạn đóng): chỉ khóa Generate/tổng hợp tham khảo,
     không chặn mô phỏng đang chạy bằng lương hưu nhập tay. */
  var blockErrs = errs.filter(function(v){ return !v.refOnly; });
  var refErrs = errs.filter(function(v){ return v.refOnly; });
  var warns = vs.filter(function(v){ return v.level === 'warn'; });
  $('riskBtn').disabled = blockErrs.length > 0;
  $('rShortCard').hidden=true;
  if(blockErrs.length){
    yearActionSim=null;
    /* F14 — hiện TOÀN BỖ lỗi (không cắt 6); esc để tên chứa dấu nháy không phá markup (F09) */
    var w = '<div class="warnbar">⚠ <div><b>Dữ liệu còn '+blockErrs.length+' lỗi — mô phỏng tạm dừng cho đến khi sửa:</b><ul style="margin:4px 0 0 18px;">'+
      blockErrs.map(function(e){ return '<li>'+esc(e.msg)+'</li>'; }).join('')+'</ul></div></div>';
    $('simWarn').innerHTML = w;
    ['rPension','rEndW','rReal','rLiq','rRunOut','rShort'].forEach(function(id){ $(id).textContent = '—'; $(id+'S').textContent = ''; });
    $('chartBox').innerHTML = ''; $('srcLegend').innerHTML = '';
    $('allocChartBox').innerHTML = '';
    $('yearTable').innerHTML = '';
    $('concl').className = 'bigmsg warn'; $('concl').textContent = 'Chưa mô phỏng được — sửa dữ liệu ở trên.';
    $('riskOut').innerHTML = 'Dữ liệu còn lỗi — nút tạm khoá.';
    return;
  }
  var warnMsgs = refErrs.map(function(e){ return 'Giai đoạn đóng BHXH (tham khảo): '+e.msg+' — Generate bị chặn nhưng mô phỏng bằng lương hưu nhập tay vẫn chạy.'; })
    .concat(warns.map(function(vv){ return vv.msg; }));
  $('simWarn').innerHTML = warnMsgs.length
    ? '<div class="warnbar" style="background:#eff6ff;border-color:#93c5fd;color:#1e40af;">⚠ <div><b>'+warnMsgs.length+' cảnh báo dữ liệu</b> (mô phỏng vẫn chạy):<ul style="margin:4px 0 0 18px;">'+
      warnMsgs.map(function(m){ return '<li>'+esc(m)+'</li>'; }).join('')+'</ul></div></div>'
    : '';
  var sim;try{sim=runSim(true);}catch(e){showSimulationError(e.message);return;}var s=sim.bhxh;
  drawMainChart(sim);
  drawAllocChart(sim);
  if(state.pensionMode === 'simple'){
    var _ps=state.pensionSimple, _psIdx=_ps.startYear*12+(_ps.startMonth===undefined?1:_ps.startMonth)-1;
    var _all=pensionStarts();   /* M1: những người đang có mức hưu > 0 */
    if(!state.extraPeople.length){
      $('rPension').textContent = fmtTr(_ps.amount*pensionFactor(_psIdx,NOW,state.infl))+'/tháng';
      $('rPensionS').textContent = 'dự kiến tại tháng hưởng · từ T'+(_ps.startMonth||1)+'/'+_ps.startYear+' · +'+_ps.growth+'%/năm sau đó';
    } else if(!_all.length){
      $('rPension').textContent = '0 đ/tháng';
      $('rPensionS').textContent = state.extraPeople.length+1+' người trong gia đình — chưa ai có mức hưu > 0';
    } else {
      /* M1 — tổng hưu cả nhà khi mọi người đều đã hưởng; liệt kê từng người kèm mốc của riêng họ */
      var _tot=_all.reduce(function(x,st){return x+st.p0;},0);
      var _last=_all.reduce(function(a,b){return a.idx>=b.idx?a:b;}).idx;
      $('rPension').textContent = fmtTr(_tot)+'/tháng';
      $('rPensionS').textContent = 'tổng cả nhà (đủ từ '+ymToStr(_last)+') · '+
        _all.map(function(st){return esc(st.name)+' '+fmtTr(st.p0)+' từ '+ymToStr(st.idx);}).join(' · ');
    }
  } else {
    $('rPension').textContent = sim.doLump ? fmtTr(s.lumpAmt)+' (1 lần)' : (s.eligible ? fmtTr(s.pension)+'/tháng' : 'Không đủ 15 năm');
    $('rPensionS').textContent = sim.doLump ? ('rút tại '+ymToStr(s.lumpMonth)+' · không còn lương hưu') :
      (s.eligible ? 'ước tính từ luật · từ '+ymToStr(s.retireIdx)+' · +'+state.pensionIdx+'%/năm · tỷ lệ '+s.rate+'%' : 'chưa đủ điều kiện');
  }
  var lastY = sim.years[sim.years.length-1];
  $('rEndW').textContent = fmtTr(lastY.end.total);
  $('rEndWS').textContent = 'gồm cả BĐS';
  $('rReal').textContent = fmtTr(lastY.real);
  $('rRealS').textContent = 'đã chiết khấu lạm phát '+state.infl+'%/năm';
  $('rLiq').textContent = fmtTr(lastY.end.liquid);
  $('rLiqS').textContent = 'Sau rút sớm tiết kiệm, chưa gồm BĐS '+fmtTr(lastY.end.land);
  function runOutAge(simX){ return simX.firstShort>=0 ? (ageAt(simX.firstShort)+' tuổi ('+ymToStr(simX.firstShort)+')') : 'không thiếu chi'; }
  $('rRunOut').textContent = runOutAge(sim);
  $('rRunOutS').textContent = 'tháng đầu tiên chi không đủ tiền rút';
  $('rShort').textContent = fmtTr(sim.shortfall);
  $('rShortS').textContent = 'cộng các khoản đến hạn nhưng chưa trả được';
  $('rShortCard').hidden=sim.shortfall<=0;
  var c = $('concl');
  if(sim.firstShort < 0){
    /* F15 — tiêu chí thật là "không có tháng thiếu chi", không phải "còn tài sản"; NAV/thanh khoản vẫn ghi rõ số */
    c.className = 'bigmsg ok';
    c.textContent = '✓ Kịch bản hiện tại không có tháng nào thiếu chi'+(lastY.end.total<=0?' dù NAV cuối kỳ về 0':'')+'. Kiểm tra rủi ro để xem kết quả khi lợi suất thay đổi.';
  } else {
    c.className = 'bigmsg warn';
    c.textContent = '⚠ Kịch bản hiện tại thiếu chi từ '+runOutAge(sim)+' — tổng chưa trả '+fmtTr(sim.shortfall)+'. Kiểm tra mức chi, thời điểm thu và kế hoạch bán tài sản.';
  }
  /* U03 — cột Chi là KẾ HOẠCH (chưa trừ thiếu); tài sản/sự kiện chi tiết xem ở hai biểu đồ và bảng tháng. */
  var h = '<thead><tr><th>Năm</th><th>Tuổi</th><th>Thu nhập/T</th><th>Lương hưu/T</th><th title="Chi thường xuyên KẾ HOẠCH (giá tương lai) — chưa trừ phần thiếu">Chi KH/T</th><th>Thiếu</th><th>Thanh khoản</th><th>NAV</th><th>Thực</th><th>Việc trong năm</th></tr></thead><tbody>';
  sim.years.forEach(function(y){
    var yearMonths=sim.months.filter(function(m){return m.year===y.year;});
    h += '<tr class="'+(y.short>0?'bad':'')+'"><td><button type="button" class="year-toggle" data-year="'+y.year+'" aria-expanded="false" aria-controls="year-detail-'+y.year+'" aria-label="Mở kế hoạch năm '+y.year+'"><span class="year-caret" aria-hidden="true">▸</span>'+y.year+'</button></td><td>'+y.age+'</td>'+
      '<td>'+fmtM1(y.inc/y.months)+'</td><td>'+fmtM1(y.pen/y.months)+'</td><td>'+fmtM1(y.exp/y.months)+'</td>'+
      '<td'+(y.short>0?' style="color:#dc2626;font-weight:700"':'')+'>'+(y.short>0?fmtM1(y.short):'')+'</td>'+
      '<td>'+fmtM1(y.end.liquid)+'</td><td><b>'+fmtM1(y.end.total)+'</b></td><td>'+fmtM1(y.real)+'</td>'+
      '<td class="year-plan-cell">'+yearActionSummary(yearMonths)+'</td></tr>'+
      '<tr class="year-plan-detail" id="year-detail-'+y.year+'" data-year="'+y.year+'" hidden><td colspan="10"></td></tr>';
  });
  $('yearTable').innerHTML = h + '</tbody>';
  yearActionSim=sim;
  if(openYearActionYear)setYearActionOpen(openYearActionYear);
}

var lastRiskSignature='';
function showSimulationError(msg){
  yearActionSim=null;
  $('simWarn').innerHTML='<div class="warnbar">'+esc(msg)+'</div>';
  ['rPension','rEndW','rReal','rLiq','rRunOut','rShort'].forEach(function(id){$(id).textContent='—';$(id+'S').textContent='';});
  $('rShortCard').hidden=true;
  ['chartBox','allocChartBox','yearTable','srcLegend'].forEach(function(id){if($(id))$(id).innerHTML='';});
  $('concl').className='bigmsg warn';$('concl').textContent='Kết quả chưa hợp lệ — cần sửa dữ liệu.';$('riskBtn').disabled=true;$('riskOut').textContent='Chưa có kết quả rủi ro hợp lệ.';
}

/* ===== Kiểm tra rủi ro: 1.000 kịch bản, seed mới mỗi lượt, không ép CAGR =====
   Seed sinh ngay tại đây và truyền tường minh vào riskCheck (hành vi như trước — mỗi lần bấm một
   lượt hoàn toàn mới) rồi ghi lại qua profileNoteRiskRun: profile lưu kèm seed chỉ để nhận diện/
   tái hiện lượt cũ khi cần, không phải lựa chọn seed cố định trên UI. */
$('riskBtn').onclick = function(){
  if(this.disabled)return;
  if(validateErrors().length){ $('riskOut').innerHTML = '<b style="color:#b91c1c">Dữ liệu còn lỗi — sửa ở các tab nhập liệu trước khi kiểm tra rủi ro.</b>'; return; }
  var el = $('riskOut'), btn = this;
  btn.disabled = true;
  el.innerHTML = '<b>Đang chạy 1.000 kịch bản mới…</b>';
  setTimeout(function(){
    var seed = (typeof crypto!=='undefined'&&typeof crypto.getRandomValues==='function')
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random()*0x100000000);
    seed = seed>>>0;
    var r;try{r=riskCheck(1000,true,seed);}catch(e){showSimulationError(e.message);return;}
    if(typeof profileNoteRiskRun==='function')profileNoteRiskRun(r, seed);
    el.innerHTML = '<b>'+fmtNumVN(r.n,0)+' kịch bản mới (mô hình tháng có trạng thái kinh tế, không ép CAGR):</b> thanh khoản cuối kỳ theo giá hiện tại — P10 <b style="color:#b45309">'+fmtTr(r.p10)+'</b> · P50 <b>'+fmtTr(r.p50)+'</b> · P90 <b style="color:#059669">'+fmtTr(r.p90)+'</b>'+
      ' · <b style="color:'+(r.runOutRate>0?'#dc2626':'#059669')+'">'+pct(r.runOutRate)+' kịch bản cạn tiền</b>'+
      (r.runOutRate > 0 ? ' — tuổi cạn trung vị <b>'+r.medianRunOutAge+'</b>, mức thiếu bq '+fmtTr(r.avgShortfall)+'/kịch bản' : ' — không kịch bản nào cạn tiền');
    btn.disabled = false;
  }, 30);
};
