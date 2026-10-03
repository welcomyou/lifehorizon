'use strict';
/* [ui/investment.js] Tab 6 — trình kéo lợi suất theo năm cho 3 chuỗi (vàng/CP/BĐS): kéo chấm giữ hình
   dạng log 12 tháng của năm đó, đổi CAGR/σ tạo lại chuỗi (core/series.js), Sinh chuỗi đổi seed.
   GHI state.series[key] (kéo chấm sửa trực tiếp chuỗi tháng) + state.seriesMeta[key].cagr sau khi thả. */
/* ---- Trình kéo lợi suất: hiển thị điểm THEO NĂM cho gọn; chuỗi chi tiết THEO THÁNG (ẩn) dùng tính NAV từng tháng ---- */
function renderSeriesChart(boxId, key, title, color){
  /* R08 — kỳ mô phỏng sai: không dựng biểu đồ theo dữ liệu kỳ đó, hiện gợi ý sửa */
  var box0 = $(boxId);
  if(!Number.isInteger(state.simYears) || state.simYears < 1 || state.simYears > 100){
    var msg0 = '<div class="hint">Số năm mô phỏng không hợp lệ (1–100) — sửa ở Tab 1 để xem và chỉnh chuỗi lợi suất.</div>';
    if(box0.__html !== msg0){ box0.__html = msg0; box0.innerHTML = msg0; }
    return;
  }
  var arr = state.series[key], n = arr.length, meta = state.seriesMeta[key];
  var nY = Math.max(1, Math.ceil(n/12)); // số năm hiển thị (mỗi chấm = 1 năm)
  function yearRet(j){ var p=1; for(var q=12*j; q<12*j+12 && q<n; q++) p *= (1+arr[q]); return p-1; } // lợi suất gộp cả năm = tích 12 tháng
  var W=1080, H=210, L=46, R=50, T=16, B=26;
  var yMin=-0.65, yMax=0.80; // giới hạn kéo MỖI NĂM (khớp kẹp −65%…+80% của chuỗi sinh sẵn)
  function X(i){ return L + i/Math.max(1,n-1)*(W-L-R); }
  function Xy(j){ return X(Math.min(n-1, 12*j+11)); } // chấm năm j đặt tại CUỐI năm j — đúng thời điểm lợi suất năm đó hiện thực, ăn khớp trục thời gian với đường NAV theo tháng
  function Y(r){ return T + (1-(r-yMin)/(yMax-yMin))*(H-T-B); }
  var iMax=0, iMin=0, i, lo=0.5, hi=2, tickStep=1, jLo=0, jHi=1;
  function recomputeIdx(){
    var vv=1, mx=-1e18, mn=1e18;
    for(i=0;i<n;i++){ vv *= (1+arr[i]); if(vv>mx) mx=vv; if(vv<mn) mn=vv; }
    iMax = mx; iMin = mn;
    /* Trục phải căn theo MỐC NHÂN ĐÔI số tròn (…25/50/100/200/400…): các vạch cách ĐỀU nhau
       trên thang log (mỗi vạch ×2) và nhãn là số tròn — đúng chuẩn biểu đồ log chuyên nghiệp.
       Trước đây chia đều theo min→max của dữ liệu → nhãn lẻ kiểu 50/94/177/332/625 gây cảm giác "không đều". */
    jLo = Math.floor(Math.log(Math.max(1e-12, iMin))/Math.log(2));
    jHi = Math.ceil(Math.log(Math.max(Math.pow(2, jLo)*1.2, iMax))/Math.log(2));
    tickStep = 1; while((jHi - jLo)/tickStep > 8) tickStep *= 2; // chuỗi quá dài → nhảy vạch ×4, ×8…
    lo = Math.pow(2, jLo); hi = Math.pow(2, jHi);
  }
  recomputeIdx();
  /* Chỉ số tích luỹ vẽ theo THANG LOG — tăng luỹ tiến dài hạn = đường dốc đều, crash = phá xuống rõ — đúng cách đọc biểu đồ dài hạn chuyên nghiệp (trục tuyến tính làm đoạn đầu bị nén phẳng khi cuối kỳ tăng nhiều lần) */
  function Y2(iv){ var a=Math.log(lo), b=Math.log(hi), l=Math.log(Math.max(1e-12,iv)); return T + (1-(l-a)/(b-a))*(H-T-B); }
  function idxPath(){
    var vv=1, d='';
    for(var j=0;j<n;j++){ vv *= (1+arr[j]); d += (j?' L':'M')+X(j).toFixed(1)+','+Y2(vv).toFixed(1); }
    return d;
  }
  var cPct = Math.round(meta.cagr*1000)/10, sPct = Math.round(meta.sigma*1000)/10;
  function cagrYearly(a){ return Math.pow(1+seriesCAGR(a), 12)-1; } // CAGR tháng → quy ra năm
  /* U04 — tooltip cho giá trị đủ chính xác của tham số đang dùng (ô hiển thị làm tròn 0,1%) */
  var cagrTip='Ô hiển thị làm tròn 0,1%. Tham số CAGR chính xác: '+fmtNumVN(meta.cagr*100,4)+'%/năm · đường hiện tại thực tế: '+fmtNumVN(cagrYearly(arr)*100,4)+'%/năm';
  var sigmaTip='Ô hiển thị làm tròn 0,1%. Độ biến động chính xác: '+fmtNumVN(meta.sigma*100,4)+'% (năm hóa theo căn 12 của log-return tháng)';
  var s = '<div class="top"><b>'+title+'</b><span class="badge" id="badge-'+key+'">CAGR '+pct(cagrYearly(arr))+'</span>'+
    '<span class="badge live" id="live-'+key+'">kéo để chỉnh</span>'+
    '<label title="'+esc(cagrTip)+'">CAGR %<input type="number" step="0.5" data-sm="cagr" data-key="'+key+'" value="'+cPct+'"></label>'+
    '<label title="'+esc(sigmaTip)+'">σ %<input type="number" step="0.5" data-sm="sigma" data-key="'+key+'" value="'+sPct+'"></label>'+
    '<button type="button" class="btn mini ghost" data-rg="'+key+'" title="Thay đường lợi suất tài sản này bằng kịch bản tháng mới với CAGR mục tiêu">⟳ Sinh chuỗi</button></div>';
  s += '<div class="svgbox"><svg id="svg-'+key+'" viewBox="0 0 '+W+' '+H+'">';
  s += '<rect x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(H-T-B)+'" fill="#f8fafc"/>';
  /* Lưới ngang mờ đi theo TRỤC PHẢI (chỉ số tích luỹ — số tuyệt đối, mỗi vạch ×2 tùy mức tăng giảm,
     chuỗi dài thì nhảy ×4/×8 để số đường còn hợp lý) thay vì bước 20% cứng của trục % trái.
     Trục trái giữ đúng 1 đường đậm làm mốc: mức lợi suất 0%. */
  for(var jt=jLo; jt<=jHi; jt+=tickStep){
    var tiv = Math.pow(2, jt), ty = Y2(tiv);
    s += '<line x1="'+L+'" y1="'+ty+'" x2="'+(W-R)+'" y2="'+ty+'" stroke="#e8edf3"/>';
    s += '<line x1="'+(W-R)+'" y1="'+ty+'" x2="'+(W-R+4)+'" y2="'+ty+'" stroke="#64748b" stroke-width="1"/>';
    s += '<text x="'+(W-R+7)+'" y="'+(ty+4)+'" text-anchor="start" font-size="10" fill="#64748b" font-weight="600">'+fmtNumVN(tiv*100, 0)+'</text>';
  }
  s += '<line x1="'+L+'" y1="'+Y(0)+'" x2="'+(W-R)+'" y2="'+Y(0)+'" stroke="#cbd5e1" stroke-width="1.5"/>';
  s += '<text x="'+(L-6)+'" y="'+(Y(0)+4)+'" text-anchor="end" font-size="10" fill="#64748b" font-weight="600">0%</text>';
  s += '<path id="idx-'+key+'" d="'+idxPath()+'" fill="none" stroke="#94a3b8" stroke-width="2"/>'; // NAV tính từ chuỗi THÁNG — vẫn nhấp nhô từng tháng
  var barD = ''; for(var jb=0; jb<nY; jb++){ barD += (jb?' L':'M')+Xy(jb).toFixed(1)+','+Y(yearRet(jb)).toFixed(1); }
  s += '<path id="bars-'+key+'" d="'+barD+'" fill="none" stroke="'+color+'" stroke-width="1" stroke-opacity="0.35" stroke-dasharray="4 4"/>'; // đường nối các điểm lợi suất NĂM: mảnh, mờ, nét đứt
  for(var j2=0;j2<nY;j2++){
    s += '<circle class="pt" data-y="'+j2+'" cx="'+Xy(j2).toFixed(1)+'" cy="'+Y(yearRet(j2)).toFixed(1)+'" r="5" fill="'+color+'" stroke="#fff" stroke-width="1.5"/>';
  }
  for(var yr=0; yr<n; yr+=120){ s += '<text x="'+X(yr)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="#64748b">năm '+Math.round(yr/12)+'</text>'; }
  s += '<text x="'+(W-R-2)+'" y="'+(H-8)+'" text-anchor="end" font-size="10" fill="#94a3b8">tháng →</text>';
  s += '</svg></div>';
  var box = $(boxId);
  if(box.__html === s) return; /* F07 — không đổi thì giữ nguyên SVG/handler/focus (kéo chấm không bị ngắt) */
  box.__html = s; box.innerHTML = s;
  box.querySelectorAll('[data-sm]').forEach(function(inp){
    inp.addEventListener('change', function(){
      var value=+inp.value/100;state.seriesMeta[key][inp.dataset.sm]=value;
      var meta=state.seriesMeta[key];if(isFinite(value)&&meta.cagr>=-.65&&meta.cagr<=.8&&meta.sigma>=0&&meta.sigma<=.8)regenerateSeries(key,false);
      scheduleRefresh();
    });
  });
  var rb = box.querySelector('[data-rg]');
  if(rb) rb.onclick = function(){
    if(!Number.isInteger(state.simYears)||state.simYears<1||state.simYears>100||meta.cagr<-.65||meta.cagr>.8||meta.sigma<0||meta.sigma>.8){showSimulationError('Sửa số năm và tham số CAGR/σ trước khi sinh chuỗi.');return;}
    regenerateSeries(key,true);refresh();
  };
  var svg = box.querySelector('svg');
  var host = box.querySelector('.svgbox');
  var tip = document.createElement('div'); tip.className = 'tt'; host.appendChild(tip);
  var dragging = -1, hoverI = -1, dragShape = null;
  function toView(ev){
    var rect = svg.getBoundingClientRect();
    return { x:(ev.clientX-rect.left)*(W/rect.width), y:(ev.clientY-rect.top)*(H/rect.height) };
  }
  function idxUpTo(i2){ var vv=1; for(var q=0;q<=i2;q++) vv *= (1+arr[q]); return vv; }
  function nearestYear(px){ var mi = (px-L)/(W-L-R)*(n-1); return Math.max(0, Math.min(nY-1, Math.round((mi-11)/12))); } // Xy(j) = X(12j+11) → nghịch đảo theo j
  svg.addEventListener('pointerdown', function(ev){
    var pt = toView(ev);
    var j2 = nearestYear(pt.x);
    dragging = j2;
    tip.style.display = 'none'; hoverI = -1;
    /* Keep the monthly pattern when editing an annual total: preserve the
       regime, clustered shocks and property smoothing within those 12 months. */
    var e0 = [], m0 = 0, d0;
    for(d0=0; d0<12; d0++){ var g0 = Math.log(1+arr[12*j2+d0]); e0.push(g0); m0 += g0; }
    m0 /= 12; for(d0=0; d0<12; d0++) e0[d0] -= m0;
    dragShape = e0;
    var c = svg.querySelector('circle[data-y="'+j2+'"]'); if(c) c.setAttribute('r','7');
    if(svg.setPointerCapture){ try{ svg.setPointerCapture(ev.pointerId); }catch(e){} }
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', function(ev){
    var pt = toView(ev);
    if(dragging < 0){ /* hover: hiện thông tin NĂM (lợi suất gộp + NAV cuối năm) */
      var jh = nearestYear(pt.x);
      var rh = yearRet(jh);
      var ivh = idxUpTo(Math.min(n-1, 12*jh+11)); // NAV tại cuối năm jh
      tip.innerHTML = '<div class="th">Năm '+jh+' · '+ymToStr(NOW+12*jh)+'–'+ymToStr(NOW+12*jh+11)+'</div>'+
        '<div class="tr"><span>Lợi suất năm</span><b style="color:'+(rh>=0?'#059669':'#dc2626')+'">'+(rh>=0?'+':'')+(rh*100).toFixed(1).replace('.',',')+'%</b></div>'+
        '<div class="tr"><span>NAV cuối năm (xuất phát 100)</span><b>'+fmtNumVN(ivh*100, 1)+'</b></div>';
      var sr = svg.getBoundingClientRect(), cr = host.getBoundingClientRect();
      var px = Xy(jh)*(sr.width/W) + (sr.left-cr.left);
      tip.style.display = 'block';
      tip.style.left = Math.max(4, Math.min(px+12, cr.width - tip.offsetWidth - 4))+'px';
      tip.style.top  = Math.max(4, Math.min(Y(rh)*(sr.height/H) + (sr.top-cr.top) - 16, cr.height - tip.offsetHeight - 4))+'px';
      if(hoverI >= 0 && hoverI !== jh){ var cp = svg.querySelector('circle[data-y="'+hoverI+'"]'); if(cp) cp.setAttribute('r','5'); }
      var ch = svg.querySelector('circle[data-y="'+jh+'"]'); if(ch) ch.setAttribute('r','6.5');
      hoverI = jh;
      return;
    }
    var r = Math.min(Math.max(yMin + (1-(pt.y-T)/(H-T-B))*(yMax-yMin), yMin), yMax);
    /* Shift each monthly log return equally so their compound equals r. */
    var cnt = 0, q0;
    for(q0=12*dragging; q0<12*dragging+12 && q0<n; q0++) cnt++;
    var per = Math.log(1+r)/cnt;
    for(q0=12*dragging; q0<12*dragging+12 && q0<n; q0++){
      arr[q0] = Math.exp(per + (dragShape ? dragShape[q0-12*dragging] : 0)) - 1;
    }
    var c = svg.querySelector('circle[data-y="'+dragging+'"]'); if(c) c.setAttribute('cy', Y(r).toFixed(1));
    var bp2 = svg.querySelector('#bars-'+key); if(bp2){ var bd2=''; for(var jb2=0;jb2<nY;jb2++){ bd2 += (jb2?' L':'M')+Xy(jb2).toFixed(1)+','+Y(yearRet(jb2)).toFixed(1); } bp2.setAttribute('d', bd2); }
    recomputeIdx();
    var pth = svg.querySelector('#idx-'+key); if(pth) pth.setAttribute('d', idxPath());
    var b = $('badge-'+key); if(b) b.textContent = 'CAGR '+pct(cagrYearly(arr));
    var lv = $('live-'+key); if(lv) lv.textContent = 'năm '+dragging+': '+(r*100).toFixed(1).replace('.',',')+'%';
  });
  svg.addEventListener('pointerleave', function(){
    tip.style.display = 'none';
    if(hoverI >= 0){ var cp = svg.querySelector('circle[data-y="'+hoverI+'"]'); if(cp) cp.setAttribute('r','5'); }
    hoverI = -1;
  });
  var lastIdx = -1;
  function endDrag(ev){
    if(dragging < 0) return;
    lastIdx = dragging; dragging = -1;
    try{
      if(svg.hasPointerCapture && ev && ev.pointerId !== undefined && svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    }catch(e){}
    var c = svg.querySelector('circle[data-y="'+lastIdx+'"]'); if(c) c.setAttribute('r','5');
    var lv = $('live-'+key); if(lv) lv.textContent = 'kéo để chỉnh';
    // Trì hoãn vẽ lại khỏi chuỗi pointerup: tránh phá huỷ phần tử đang giữ pointer capture
    state.seriesMeta[key].cagr=annualCAGR(arr);
    setTimeout(function(){ refresh(); }, 0);
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}
