'use strict';
/* Tab 8: một bảng theo số năm đóng tiếp. Mỗi ô tuổi là kết quả quét toàn bộ lưới
   lãi tiết kiệm × lạm phát × tăng lương hưu, không phải xác suất xảy ra. */

var cmpGridKey = null;
var cmpGridIds = ['xMin','xMax','iMin','iMax','yMin','yMax','gridStep','winThreshold'];
function cmpReadGrid(){
  var v = {};
  for(var j = 0; j < cmpGridIds.length; j++){
    var key = cmpGridIds[j], el = $('cmp' + key.charAt(0).toUpperCase() + key.slice(1));
    if(!el || el.value.trim() === '' || isNaN(numParseVN(el.value))) return {error:'Điền đủ các khoảng giả định và ngưỡng tỷ lệ.'};
    v[key] = numParseVN(el.value);
  }
  if([.25,.5,1].indexOf(v.gridStep) < 0) return {error:'Chọn bước khảo sát hợp lệ.'};
  if(!Number.isInteger(v.winThreshold) || v.winThreshold < 1 || v.winThreshold > 100)
    return {error:'Ngưỡng tỷ lệ cần là số nguyên từ 1 đến 100%.'};
  var sizes = [];
  [['xMin','xMax','Lãi tiết kiệm'],['iMin','iMax','Lạm phát'],['yMin','yMax','Tăng lương hưu']].forEach(function(p){
    var lo = v[p[0]], hi = v[p[1]], n = (hi-lo)/v.gridStep;
    if(lo < -10 || hi > 30 || lo > hi) sizes.push({error:p[2] + ': mức thấp/cao phải nằm từ -10% đến 30% và đúng thứ tự.'});
    else if(Math.abs(n-Math.round(n)) > 1e-7) sizes.push({error:p[2] + ': khoảng phải chia hết cho bước ' + v.gridStep + ' điểm %.'});
    else sizes.push({count:Math.round(n)+1});
  });
  var bad = sizes.find(function(s){ return s.error; });
  if(bad) return {error:bad.error};
  v.combos = sizes[0].count*sizes[1].count*sizes[2].count;
  if(v.combos > 12000) return {error:'Có ' + v.combos.toLocaleString('vi-VN') + ' tổ hợp, vượt giới hạn 12.000. Thu hẹp khoảng hoặc tăng bước khảo sát.'};
  return {values:v};
}
function cmpGridSummary(){
  var r = cmpReadGrid(), el = $('cmpGridSummary');
  if(!el) return;
  el.textContent = r.error || ('Sẽ tính ' + r.values.combos.toLocaleString('vi-VN') + ' tổ hợp; mỗi tổ hợp có trọng số ngang nhau.');
  el.classList.toggle('cmp-error', !!r.error);
}
function cmpPerson(i){ return i > 0 ? (state.extraPeople[i-1] || null) : null; }
function cmpSchedule(person){ return compareRecs(person, state.infl).recs; }
function cmpSync(){
  if(!state.compareCfg || typeof state.compareCfg !== 'object') state.compareCfg = newCompareCfg();
  var c = state.compareCfg, personEl = $('cmpPerson');
  if(personEl.options.length){
    var idx = Number(personEl.value);
    if(Number.isInteger(idx) && idx >= 0 && idx <= (state.extraPeople||[]).length && idx !== c.personIdx){
      c.personIdx = idx;
      var schedule = cmpSchedule(cmpPerson(idx));
      if(schedule.length){ c.bStart = schedule[schedule.length-1].b; $('cmpB').value = fmtMoney(c.bStart); }
    }
  }
  var b = moneyVal($('cmpB'));
  if(isFinite(b) && b > 0) c.bStart = b;
  c.bGrow = $('cmpGrow').value === 'flat' ? 'flat' : 'infl';
  var grid = cmpReadGrid();
  if(grid.values) cmpGridIds.forEach(function(key){ c[key] = grid.values[key]; });
}
function cmpWrite(){
  var c = state.compareCfg || (state.compareCfg = newCompareCfg());
  $('cmpB').value = fmtMoney(c.bStart);
  $('cmpGrow').value = c.bGrow === 'flat' ? 'flat' : 'infl';
  var defaults = newCompareCfg();
  cmpGridIds.forEach(function(key){
    var el = $('cmp' + key.charAt(0).toUpperCase() + key.slice(1));
    var val = c[key] === undefined ? defaults[key] : c[key];
    /* gridStep là select (giá trị option "0.25") — giữ nguyên chuỗi, không vnNumStr */
    el.value = key === 'gridStep' ? String(val) : vnNumStr(val);
  });
  cmpGridSummary();
  cmpGridKey = null;
}
function cmpAge(u, person){
  var d = u - personBirth(person)*12, years = Math.floor(d/12), months = d%12;
  return years + ' tuổi' + (months ? ' ' + months + ' tháng' : '');
}
function cmpYears(months){
  return Math.floor(months/12) + ' năm' + (months%12 ? ' ' + months%12 + ' tháng' : '');
}
function cmpSignature(){
  var c = state.compareCfg || newCompareCfg(), person = cmpPerson(c.personIdx);
  return JSON.stringify({ personIdx:c.personIdx, bStart:c.bStart, bGrow:c.bGrow,
    contribRate:22, maxAge:100, birth:personBirth(person), gender:personGender(person),
    periods:personPeriods(person), now:NOW, infl:state.infl,
    grid:cmpGridIds.map(function(k){ return c[k]; }) });
}
function renderCompareTab(){
  var c = state.compareCfg || (state.compareCfg = newCompareCfg());
  cmpSync();
  var opts = '<option value="0">' + esc(personLabel(null, -1)) + '</option>';
  (state.extraPeople||[]).forEach(function(p, i){ opts += '<option value="' + (i+1) + '">' + esc(personLabel(p, i)) + '</option>'; });
  $('cmpPerson').innerHTML = opts;
  $('cmpPerson').value = String(c.personIdx <= (state.extraPeople||[]).length ? c.personIdx : 0);
  var person = cmpPerson(c.personIdx), label = personLabel(person, (c.personIdx||1)-1);
  var schedule = cmpSchedule(person), history = schedule.filter(function(r){ return r.m < NOW; });
  var months = schedule.length, monthsPast = history.length;
  var M0 = Math.max(NOW, schedule.length ? schedule[schedule.length-1].m + 1 : NOW);
  var retIdx = retireAgeMonths(personBirth(person), personGender(person));
  var maxYears = Math.max(0, Math.min(Math.floor((cap75Years(personGender(person))*12-months)/12), Math.floor((retIdx-M0+1)/12)));
  var scheduleText = schedule.length ? 'Tab 3 ghi <b>' + cmpYears(months) + '</b> đóng BHXH (đã qua ' + cmpYears(monthsPast) + ' tính đến ' + ymToStr(NOW) + '), kết thúc ' + ymToStr(schedule[schedule.length-1].m) + '.' : 'Tab 3 chưa có lịch đóng BHXH.';
  var savingsText = schedule.length ? 'Tiết kiệm được giả định gửi thay tiền BHXH từ <b>' + ymToStr(schedule[0].m) + '</b>.' : 'Tiết kiệm được giả định gửi thay các khoản đóng trong số năm được chọn.';
  var eligibilityText = months < 180 ? 'Lịch này còn thiếu <b>' + cmpYears(180-months) + '</b> để có lương hưu.' : (monthsPast < 180 ? 'Đủ 15 năm theo lịch, chưa phải đã đóng đủ hôm nay.' : '');
  var extraText = maxYears ? 'Thử đóng thêm <b>0–' + maxYears + ' năm</b> từ <b>' + ymToStr(M0) + '</b>.' : 'Không còn năm tròn để đóng thêm trước tuổi nghỉ hưu.';
  $('cmpProfile').innerHTML = '<b>' + esc(label) + '</b>: ' + scheduleText + ' ' + savingsText +
    ' ' + extraText + ' Từ <b>' + ymToStr(retIdx+1) + '</b> mới nhận hưu và rút tiết kiệm. ' + eligibilityText;
  if(cmpGridKey !== cmpSignature()){
    $('cmpYearsOut').innerHTML = '<p class="hint">Bấm “Tính tuổi cạn” để xem kết quả với các giả định đang chọn.</p>';
    cmpGridKey = null;
  }
  cmpGridSummary();
}
function cmpRunYearsGrid(){
  cmpSync();
  var btn = $('cmpYearsBtn'), out = $('cmpYearsOut');
  var grid = cmpReadGrid();
  if(grid.error){ out.innerHTML = '<p class="cmp-error">' + esc(grid.error) + '</p>'; cmpGridSummary(); return; }
  var person = cmpPerson(state.compareCfg.personIdx);
  var key = cmpSignature();
  btn.disabled = true;
  btn.textContent = 'Đang tính…';
  setTimeout(function(){
    try{
      var g = compareYearsScan(Object.assign({}, state.compareCfg, {contribRate:22,maxAge:100}), person);
      if(!g.ok){ out.innerHTML = '<p class="cmp-error">' + esc(g.error || 'Chưa thể tính từ hồ sơ BHXH đang chọn.') + '</p>'; return; }
      var html = '<p class="hint">Người chỉ tiêu đúng bằng lương hưu: tháng nào lãi dư thì phần dư ở lại sổ sinh lãi tiếp, lãi thiếu thì lấy gốc bù. “Bị ăn vào gốc” là tuổi từ đó lãi sổ sinh ra mỗi tháng ít hơn lương hưu phải rút — sổ bắt đầu hao gốc; “cạn” là tuổi sổ không còn đủ rút bằng lương hưu của tháng đó. Cả hai mốc đếm theo ngưỡng ít nhất ' + g.threshold + '% số tổ hợp giả định.</p>';
      html += '<div class="strategy-table-wrap"><table class="cmp-table"><tr><th>Đóng tiếp</th><th>Tổng thời gian BHXH</th><th>Tuổi TK bị ăn vào gốc</th><th>Tuổi TK cạn</th></tr>';
      g.rows.forEach(function(row){
        html += '<tr><td data-label="Đóng tiếp"><b>' + row.N + ' năm</b></td><td data-label="Tổng BHXH nếu đóng tiếp">' + cmpYears(row.months) + '</td>';
        if(row.months < 180){
          html += '<td class="cmp-none" data-label="Tuổi TK bị ăn vào gốc">Chưa đủ 15 năm để nhận lương hưu; chưa so quyền lợi khác.</td>';
          html += '<td class="cmp-none" data-label="Tuổi TK cạn">Chưa đủ 15 năm để nhận lương hưu; chưa so quyền lợi khác.</td>';
        }else{
          html += '<td data-label="Tuổi TK bị ăn vào gốc" class="' + (row.loseRanges.length ? 'cmp-yes' : 'cmp-none') + '">' +
            (row.loseRanges.length ? 'Từ ' + cmpAge(row.loseRanges[0].from, person) : 'Chưa đạt ngưỡng trước 100 tuổi') + '</td>';
          html += '<td data-label="Tuổi TK cạn" class="' + (row.thresholdRanges.length ? 'cmp-yes' : 'cmp-none') + '">' +
            (row.thresholdRanges.length ? 'Từ ' + cmpAge(row.thresholdRanges[0].from, person) : 'Chưa đạt ngưỡng trước 100 tuổi') + '</td>';
        }
        html += '</tr>';
      });
      html += '</table></div><p class="hint">Khảo sát ' + g.combos.toLocaleString('vi-VN') + ' tổ hợp giả định, mỗi tổ hợp có trọng số ngang nhau. Tỷ lệ này không phải xác suất xảy ra.</p>';
      out.innerHTML = html;
      cmpGridKey = key;
    }catch(e){
      out.innerHTML = '<p class="hint" style="color:#b91c1c;">Không tính được: ' + esc(e && e.message || e) + '</p>';
      cmpGridKey = null;
    }finally{
      btn.disabled = false;
      btn.textContent = 'Tính lại tuổi cạn';
    }
  }, 30);
}
(function(){
  function wire(){
    var btn = $('cmpYearsBtn');
    if(!btn) return false;
    btn.onclick = cmpRunYearsGrid;
    cmpGridIds.forEach(function(key){
      var el = $('cmp' + key.charAt(0).toUpperCase() + key.slice(1));
      el.addEventListener('input', function(){
        cmpGridSummary();
        cmpGridKey = null;
        $('cmpYearsOut').innerHTML = '<p class="hint">Giả định đã thay đổi. Bấm “Tính tuổi cạn” để xem kết quả mới.</p>';
      });
    });
    return true;
  }
  if(typeof document !== 'undefined' && typeof $ === 'function'){
    if(!wire()) document.addEventListener('DOMContentLoaded', wire);
  }
})();
