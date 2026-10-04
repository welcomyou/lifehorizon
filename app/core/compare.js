'use strict';
/* [core/compare.js] Tab 8 — lưới compareYearsScan ở cuối file là phép so hiện hành:
   toàn bộ lịch BHXH cộng N năm so với gửi tiết kiệm cùng các khoản nộp từ từng tháng.
   compareOptimize bên dưới là bộ tối ưu CẬN BIÊN cũ, hiện không gọi từ giao diện Tab 8:
   phần đóng 15 năm chung cho cả hai phương án nên triệt tiêu; chỉ đem PHẦN ĐÓNG THÊM
   (tự nguyện, n tháng, mức thu nhập b tháng đầu + quy tắc tăng cố định) ra so với gửi đúng số tiền đó
   vào tiết kiệm lãi x%/năm. Hàm mục tiêu D(b,n,u) = giá trị tích lũy tại tháng tuổi u của:
     (Δ lương hưu tháng × lãi x tới u) + (trợ cấp một lần phần vượt 75% × lãi x tới u) + BHYT/tử tuất quy đổi
     − (mỗi khoản đóng 22% × thu nhập đóng × lãi x tới u).
   Δ lương hưu tính bằng CÔNG THỨC LUẬT đầy đủ (bình quân đã điều chỉnh + tỷ lệ hưởng + sàn tham chiếu)
   — KHÔNG cộng tỷ lệ phần trăm đơn giản; từng tháng đóng thêm được cộng dồn vào cùng công thức bhxhSummary.
   ĐỌC: state (infl — động theo hồ sơ), person (null = người chính: state.birthYear/gender/periods;
   phần tử state.extraPeople: hồ sơ riêng như bhxhSummary), NOW. GHI: KHÔNG — hàm thuần.
   Người gọi: ui/compare.js (Tab 8 — chọn người qua dropdown), test. KHÔNG đụng runSim — golden không đổi. */

function newCompareCfg(){
  return { version:2, personIdx:0, xSave:6.5, yPension:8, lifeAge:85, contribRate:22,
           bStart:20000000, bGrow:'infl', bStep:1000000, maxAge:100, byht:0, tutuat:0,
           xMin:4, xMax:9, iMin:3, iMax:7, yMin:5, yMax:10, gridStep:.25, winThreshold:70 };
}

/* Số năm đóng tương ứng tỷ lệ lương hưu tối đa 75% (pensionRate +2%/năm): nữ 15+15=30, nam 20+15=35.
   Vượt mốc này mỗi năm đóng chỉ còn nâng bình quân + nhận trợ cấp một lần 0,5 tháng bình quân/năm vượt
   (khoản 1 Điều 68 Luật BHXH 41/2024; trước đó khoản 3 Điều 74 Luật 2014). */
function cap75Years(gender){ return gender==='female' ? 30 : 35; }

/* Chuỗi tháng đóng của hồ sơ theo đúng thuật toán bhxhSummary (hợp nhất chồng lấn — dòng sớm thắng,
   dòng mở đóng đến hết tháng đủ tuổi, kẹp tại retIdx) + điều chỉnh theo chế độ (nn bắt đầu trước
   01/2016 quy tỷ lệ mức tham chiếu; còn lại hệ số CPI năm hưởng). Trả mảng recs tăng dần theo tháng:
   {m, isNN, b, adj}. Đối chứng với bhxhSummary nằm trong test (pension/avg/months phải khớp tuyệt đối). */
function compareRecs(person, inflPct){
  var birthYear = personBirth(person), gender = personGender(person);
  var retIdx = retireAgeMonths(birthYear, gender);
  var retStart = retIdx + 1, enjoyY = Math.floor(retStart/12);
  var ps = periodsChrono(personPeriods(person)).filter(function(p){ return p.type !== 'none'; });
  var recs = [], covered = -Infinity, first = Infinity;
  ps.forEach(function(p){
    var rawEnd = periodEnd(p, retIdx);
    if(isNaN(p._f) || isNaN(rawEnd)) return;
    var f0 = Math.max(p._f, covered + 1);
    if(f0 > rawEnd){ if(p._f < first) first = p._f; return; }
    covered = Math.max(covered, rawEnd);
    var cntEnd = Math.min(rawEnd, retIdx);
    for(var m = f0; m <= cntEnd; m++) recs.push({ m:m, isNN:p.type==='nn', b:bhAt(p, m) });
    if(p._f < first) first = p._f;
  });
  recs.sort(function(a,b){ return a.m - b.m; });
  var nnRecs = recs.filter(function(r){ return r.isNN; });
  var nnUseRef = nnRecs.length && nnRecs[0].m < 2016*12;
  recs.forEach(function(r){
    r.adj = r.b * (r.isNN && nnUseRef ? refSalary(retStart)/refSalary(r.m)
                                      : adjCoef(Math.floor(r.m/12), enjoyY, inflPct));
  });
  return { recs:recs, first:first, retIdx:retIdx, retStart:retStart, enjoyY:enjoyY, nnUseRef:nnUseRef };
}

/* Bộ phân tích chính. cfg = state.compareCfg (merge newCompareCfg). Trả {ok:false,error} khi lịch
   đóng chưa đủ 180 tháng (không tự bịa lịch hoàn thành — bổ sung ở Tab 3) hoặc đã đóng đến hết tháng
   nghỉ hưu (không còn tháng tự nguyện nào để tối ưu). */
function compareOptimize(cfg, person){
  cfg = Object.assign(newCompareCfg(), cfg || {});
  var birthYear = personBirth(person), gender = personGender(person);
  var infl = finiteNumber(state.infl) ? state.infl : 0;
  var base = compareRecs(person, infl);
  var recs = base.recs, retIdx = base.retIdx, retStart = base.retStart, enjoyY = base.enjoyY;
  if(recs.length < 180)
    return { ok:false, error:'not180', months:recs.length, retireIdx:retIdx };
  /* Phần chung = MỌI tháng đã đóng trước NOW (quá khứ không thể đảo ngược) + các tháng của lịch đóng
     chắc chắn tiếp theo cho tới đủ 180 tháng. Mọi tháng đóng sau mốc 180 của lịch gốc bị thay bằng
     phần tự nguyện (b,n) của bài toán — không tự bịa lịch hoàn thành 15 năm (báo lỗi ở trên). */
  var nPast = recs.filter(function(r){ return r.m < NOW; }).length;
  var common = recs.slice(0, Math.max(nPast, 180));
  var M0 = common[common.length - 1].m + 1;   // mốc bắt đầu phần tự nguyện
  var nMax = retIdx - M0 + 1;                 // chỉ quét tháng có thể tham gia tự nguyện, tới tháng đủ tuổi
  if(nMax < 1)
    return { ok:false, error:'noRoom', months:recs.length, retireIdx:retIdx, M0:M0 };
  var B = retIdx;                             // tháng đầu hưởng = tháng đủ tuổi (cùng quy ước pensionFromPeriods — hiển thị ở UI)
  var L = birthYear*12 + Math.round(cfg.lifeAge)*12;   // tháng "sống đến tuổi L"
  var U = birthYear*12 + Math.round(cfg.maxAge)*12;    // trần quét tuổi hòa vốn
  if(L > U) L = U;                                     // lifeAge vượt maxAge → kẹp về trần quét
  /* Thành phần bình quân của phần chung (công thức bhxhSummary): nn lấy "N năm cuối" theo năm bắt đầu
     tham gia làm bình quân rồi nhân TOÀN BỘ số tháng nn; phần còn lại dùng toàn bộ đã điều chỉnh. */
  var nnAll = common.filter(function(r){ return r.isNN; });
  var oth = common.filter(function(r){ return !r.isNN; });
  var K = nnWindowMonths(base.first);
  var nnWin = (K === null || nnAll.length <= K) ? nnAll : nnAll.slice(-K);
  var nnBase = nnWin.length ? (nnWin.reduce(function(s,r){ return s + r.adj; }, 0) / nnWin.length) * nnAll.length : 0;
  var othSum = oth.reduce(function(s,r){ return s + r.adj; }, 0);
  var compMonths = oth.length;
  var floorOK = compMonths >= 240 && isFinite(base.first) && base.first < 2025*12 + 6;
  var refFloor = refSalary(retStart);
  var nCommon = common.length;
  var avg0 = (nnBase + othSum) / nCommon;
  var rate0 = pensionRate(benefitYears(nCommon), gender);
  var pension0 = floorOK ? Math.max(rate0/100*avg0, refFloor) : rate0/100*avg0;
  var cap75Y = cap75Years(gender);
  /* Các mốc powers lãi tiết kiệm: powX[j] = (1+x)^(j/12), j = 0..(U−M0). */
  var x = cfg.xSave/100, xm = Math.pow(1 + x, 1/12);
  var powX = [1];
  for(var j = 1; j <= Math.max(0, U - M0); j++) powX[j] = Math.pow(1 + x, j/12);
  /* shapeSum(u) = Σ_{t=B..u} (1+y)^floor((t−B)/12) × (1+x)^((u−t)/12) — hệ số gộp của Δ lương hưu hằng
     tháng. byhtSum(u) = giá trị tích lũy BHYT quy đổi /12 mỗi tháng, chạy từ M0 (khoản thu chỉ phương án
     đóng thêm có — hiển thị riêng ở UI để người dùng tắt khi cho rằng BHYT thuộc phần chung). */
  var shapeSum = [], byhtSum = [], g1 = 1 + cfg.yPension/100, i;
  var ss = 0, bs = 0;
  for(i = M0; i <= U; i++){
    bs = bs * xm + cfg.byht/12;
    byhtSum[i] = bs;
    if(i >= B){
      ss = ss * xm + Math.pow(g1, Math.floor((i - B)/12));
      shapeSum[i] = ss;
    }
  }
  /* Bảng theo tuổi thọ: tối ưu riêng cho từng mốc tuổi (mỗi mốc là một "tuổi chết" khác nhau). */
  var ageMarks = [70,75,80,85,90,95,100].filter(function(a){ return a <= cfg.maxAge && birthYear*12 + a*12 >= M0; });
  var ageU = ageMarks.map(function(a){ return birthYear*12 + a*12; });
  var ageAt = {}; ageU.forEach(function(u){ ageAt[u] = { u:u, best:null, shape:(u>=B?shapeSum[u]:0), byht:(u>=B?byhtSum[u]:0) }; });
  var evalU = ageU.concat(L >= M0 && ageU.indexOf(L) < 0 ? [L] : []).filter(function(u,idx,arr){ return arr.indexOf(u) === idx; });
  var dLen = Math.max(1, U - M0 + 1);
  /* Grid mức đóng b: từ sàn tự nguyện tới trần 20× mức tham chiếu tại M0, bước công bố + đầu mút;
     kèm cả mức người dùng đang nhập để nhìn thấy điểm đó trong bảng nhiệt. */
  var bLo = tnFloor(M0), bHi = capMultiple(M0) * refSalary(M0);
  var step = Math.max(1000, Math.round(cfg.bStep));
  var bGrid = [];
  for(var bv = bLo; bv < bHi - step/2; bv += step) bGrid.push(bv);
  bGrid.push(bHi);
  if(cfg.bStart > bLo && cfg.bStart < bHi && bGrid.indexOf(cfg.bStart) < 0){
    bGrid.push(cfg.bStart); bGrid.sort(function(a,b){ return a - b; });
  }
  var probe = (cfg._probe && cfg._probe.b >= bLo && cfg._probe.b <= bHi && cfg._probe.n >= 1 && cfg._probe.n <= nMax) ? cfg._probe : null;
  if(probe && bGrid.indexOf(probe.b) < 0){ bGrid.push(probe.b); bGrid.sort(function(a,b){ return a - b; }); }
  var gB = (cfg.bGrow === 'flat') ? 0 : infl;   // quy tắc tăng mức đóng: giữ nguyên danh nghĩa hoặc theo lạm phát
  var adjCache = {};
  function adjOf(t){ var y = Math.floor(t/12); return adjCache[y] !== undefined ? adjCache[y] : (adjCache[y] = adjCoef(y, enjoyY, infl)); }
  /* Vòng quét chính: từng mức b một sweep n = 0..nMax, mọi tổng cộng dồn O(1)/tháng — toàn bộ quét
     ~ bGrid×nMax×(số mốc đánh giá) phép cộng, không gọi lại bhxhSummary cho từng ứng viên. */
  var best = { b:0, n:0, D:0, dP:0, pension:pension0, TC:0, totalC:0 };
  var all = [{ b:0, n:0, D:0, dP:0, pension:pension0, TC:0, totalC:0 }], heat = [], probeOut = null;
  var contribRate = Math.max(0, Math.min(100, cfg.contribRate)) / 100;
  var monthsNow = recs.filter(function(r){ return r.m < NOW; }).length;
  for(var gi = 0; gi < bGrid.length; gi++){
    var b = bGrid[gi];
    var months = nCommon, oth = othSum, totalC = 0;
    var FVC = {}; evalU.forEach(function(u){ FVC[u] = 0; });
    var row = new Array(Math.floor(nMax) + 1); row[0] = 0;
    for(var n = 1; n <= nMax; n++){
      var t = M0 + n - 1;
      var level = Math.min(Math.max(b * Math.pow(1 + gB/100, Math.floor((t - M0)/12)), tnFloor(t)), capMultiple(t) * refSalary(t));
      var C = contribRate * level;
      oth += adjOf(t) * level; months++; totalC += C;
      evalU.forEach(function(u){ if(t <= u) FVC[u] += C * powX[u - t]; });
      var avg = (nnBase + oth) / months;
      var rate = pensionRate(benefitYears(months), gender);
      var pension = floorOK ? Math.max(rate/100*avg, refFloor) : rate/100*avg;
      var over = Math.max(0, Math.floor(months/12) - cap75Y);
      var TC = 0.5 * avg * over;
      var dP = pension - pension0;
      var cand = { b:b, n:n, dP:dP, pension:pension, TC:TC, totalC:totalC, avg:avg, rate:rate, over:over };
      if(probe && b === probe.b && n === probe.n) probeOut = { months:months, avg:avg, rate:rate, pension:pension, TC:TC, dP:dP, over:over, D:null };
      evalU.forEach(function(u){
        var D = -FVC[u] + (byhtSum[u] || 0) + cfg.tutuat;
        if(u >= B && shapeSum[u] !== undefined){
          D += dP * shapeSum[u] + TC * powX[u - B];
        }
        if(u === L){ cand.D = D; if(probeOut && b === probe.b && n === probe.n) probeOut.D = D; }
        var slot = ageAt[u];
        if(slot && (!slot.best || D > slot.best.D)) slot.best = Object.assign({}, cand, { D:D });   /* D của chính mốc tuổi này — không để cand.D (mốc L) đè */
      });
      row[n] = cand.D !== undefined ? cand.D : null;
      if(cand.D !== undefined && cand.D > 0) all.push(Object.assign({}, cand));
    }
    heat.push(row);
  }
  all.sort(function(a,b2){ return b2.D - a.D; });
  var top5 = all.slice(0, 5);
  var bestCand = all[0] && all[0].D > 0 ? all[0] : { b:0, n:0, D:0, dP:0, pension:pension0, TC:0, totalC:0 };
  best = bestCand;
  /* Chuỗi D(u) theo từng tháng cho phương án tốt nhất + tuổi hòa vốn T (tháng đầu D>0 từ B). */
  var dSeries = [], T = null, Fu = 0, signChanges = 0, prevSign = null;
  var Cbest = {};
  var nB = Math.min(best.n, nMax);
  for(var q = 0; q < nB; q++){
    var t2 = M0 + q;
    Cbest[t2] = contribRate * Math.min(Math.max(best.b * Math.pow(1 + gB/100, Math.floor((t2 - M0)/12)), tnFloor(t2)), capMultiple(t2) * refSalary(t2));
  }
  for(var u2 = M0; u2 <= U; u2++){
    Fu = Fu * xm + (Cbest[u2] || 0);
    /* BHYT/tử tuất quy đổi chỉ thuộc ứng viên ĐÓNG THÊM — mốc dừng (n=0) là nền 0 của phép so. */
    var D2 = -Fu + (best.n > 0 ? (byhtSum[u2] || 0) + cfg.tutuat : 0);
    if(u2 >= B && shapeSum[u2] !== undefined)
      D2 += best.dP * shapeSum[u2] + best.TC * powX[u2 - B];
    dSeries.push(D2);
    if(u2 >= B){
      var sg = D2 > 0 ? 1 : (D2 < 0 ? -1 : 0);
      if(sg !== 0){
        if(prevSign !== null && sg !== prevSign) signChanges++;
        prevSign = sg;
      }
      if(T === null && D2 > 0) T = u2;
    }
  }
  return { ok:true, cfgUsed:cfg, infl:infl, retireIdx:retIdx, retStart:retStart, enjoyHuu:B, M0:M0,
    nMax:nMax, monthsNow:monthsNow, commonLastMonth:common[179].m, first:base.first,
    nnUseRef:base.nnUseRef, floorOK:floorOK, rate0:rate0, avg0:avg0, pension0:pension0,
    bGrid:bGrid, bStepUsed:step, gB:gB, best:best, top5:top5,
    ages:ageU.map(function(u){ var s = ageAt[u]; return { age:Math.round((u - birthYear*12)/12), u:u, best:s.best }; }),
    heat:heat, dSeries:{ from:M0, to:U, arr:dSeries }, crossover:T, maxU:U, probe:probeOut,
    signChanges:signChanges, lifeL:L,
    byhtAtL:(best.n > 0 ? (byhtSum[L] || 0) : 0), tutuatUsed:(best.n > 0 ? cfg.tutuat : 0),
    cap75Y:cap75Y };
}

/* ===== Lưới 4 biến: với TỪNG số năm tiếp tục đóng N (bước 1 năm, từ 0 tới mốc
   tổng năm đóng full 75% của giới tính — KỂ CẢ phần chưa đủ 15 năm), quét ba khoảng giả định cấu hình
   được để đếm tỷ lệ tổ hợp tại TỪNG tháng tuổi theo HAI mốc của sổ tiết kiệm thay thế:
   (1) "thua" — tháng đầu lãi sổ sinh ra ít hơn lương hưu phải rút, sổ bắt đầu ăn vào gốc
   (người chỉ tiêu đúng bằng lương hưu; lãi tháng nào dư thì Ở LẠI sổ sinh lãi tiếp — tái đầu tư);
   (2) "cạn" — tháng đầu sổ không còn đủ rút bằng lương hưu của tháng đó.
   MỌI tháng trong lịch đóng đã nhập ở Tab 3 được so với gửi tiết kiệm đúng khoản tiền tương ứng
   từ từng tháng đó, kể cả tháng quá khứ trong giả định phản thực. N năm đóng thêm bắt đầu sau
   tháng cuối cùng của lịch ấy (hoặc NOW nếu lịch đã kết thúc). N=0 vẫn so TOÀN BỘ lịch đã nhập
   với toàn bộ tiền gửi, không phải hai phương án giống nhau. Tổng đóng chưa đủ 180 tháng →
   kịch bản đó KHÔNG có lương hưu (bảo lưu/rút
   một lần không mô hình — ghi chú UI). Mức đóng b giữ nguyên cfg.bStart + quy tắc bGrow (không quét b).
   BHYT/tử tuất = 0 trong lưới. state.infl được ghi đè TẠM theo từng giá trị lạm phát quét (refSalary/
   adjCoef đọc state.infl) rồi khôi phục — hàm không để rò state. */
function compareYearsScan(cfg, person){
  cfg = Object.assign(newCompareCfg(), cfg || {});
  var birthYear = personBirth(person), gender = personGender(person);
  var retIdx = retireAgeMonths(birthYear, gender);
  var retStart = retIdx + 1, enjoyY = Math.floor(retStart/12);
  var B = retStart;
  var U = birthYear*12 + Math.round(cfg.maxAge)*12;
  if(U < B) U = B;
  var base = compareRecs(person, 0);            // adj sẽ tính lại theo từng lạm phát quét
  var recs = base.recs, first = base.first;
  var common = recs;
  var monthsPast = recs.filter(function(r){ return r.m < NOW; }).length;
  var monthsCommon = common.length;
  var M0 = Math.max(NOW, common.length ? common[common.length-1].m + 1 : NOW);
  var capY = cap75Years(gender);
  /* N tối đa: tổng năm đóng không vượt mốc tỷ lệ 75%; cũng không đóng quá tháng đủ tuổi. */
  var nMaxYears = Math.min(Math.floor((capY*12 - monthsCommon)/12), Math.floor((retIdx - M0 + 1)/12));
  if(nMaxYears < 0) nMaxYears = 0;
  var step = Number(cfg.gridStep), threshold = Number(cfg.winThreshold);
  if([.25,.5,1].indexOf(step) < 0) return {ok:false,error:'Bước khảo sát phải là 0,25; 0,5 hoặc 1 điểm %.'};
  if(!isFinite(threshold) || threshold < 1 || threshold > 100 || !Number.isInteger(threshold))
    return {ok:false,error:'Ngưỡng tỷ lệ phải là số nguyên từ 1 đến 100%.'};
  function rangeVals(lo, hi, label){
    lo = Number(lo); hi = Number(hi);
    if(!isFinite(lo) || !isFinite(hi) || lo < -10 || hi > 30 || lo > hi)
      throw new Error(label + ': nhập từ -10% đến 30%, mức thấp không vượt mức cao.');
    var width = (hi - lo)/step;
    if(Math.abs(width - Math.round(width)) > 1e-7)
      throw new Error(label + ': khoảng phải chia hết cho bước ' + step + ' điểm %.');
    var a = [];
    for(var k = 0; k <= Math.round(width); k++) a.push(Math.round((lo + k*step)*100)/100);
    return a;
  }
  var xVals, iVals, yVals;
  try{
    xVals = rangeVals(cfg.xMin, cfg.xMax, 'Lãi tiết kiệm');
    iVals = rangeVals(cfg.iMin, cfg.iMax, 'Lạm phát');
    yVals = rangeVals(cfg.yMin, cfg.yMax, 'Tăng lương hưu');
  }catch(e){ return {ok:false,error:e.message}; }
  var combos = xVals.length * iVals.length * yVals.length;
  if(combos > 12000) return {ok:false,error:'Lưới có ' + combos + ' tổ hợp, vượt giới hạn 12.000. Hãy thu hẹp khoảng hoặc tăng bước khảo sát.'};
  var spanU = Math.max(0, U - M0 + 1);
  var pensionFactors = yVals.map(function(y){
    var a = [];
    for(var u = B; u <= U; u++) a.push(Math.pow(1 + y/100, Math.floor((u - B)/12)));
    return a;
  });
  /* Thành phần common không đổi theo lạm phát: tách nn/oth, cửa sổ bình quân, compMonths. */
  var nnAll = common.filter(function(r){ return r.isNN; });
  var oth = common.filter(function(r){ return !r.isNN; });
  var K = nnWindowMonths(first);
  var nnWin = (K === null || nnAll.length <= K) ? nnAll : nnAll.slice(-K);
  var compMonths = oth.length;
  var floorOK = compMonths >= 240 && isFinite(first) && first < 2025*12 + 6;
  var rows = [];
  for(var N = 0; N <= nMaxYears; N++) rows.push({ N:N, months:monthsCommon + N*12, totalYears:(monthsCommon + N*12)/12,
    winCounts:new Uint16Array(U - B + 1), loseCounts:new Uint16Array(U - B + 1),
    thresholdRanges:[], loseRanges:[], peakRanges:[], peakCount:0,
    someRanges:[], allRanges:[], scenariosWithWin:0 });
  var contribRate = Math.max(0, Math.min(100, cfg.contribRate)) / 100;
  var oldInfl = state.infl;
  try{
    iVals.forEach(function(iv){
      state.infl = iv;                      // refSalary/tnFloor/adjCoef đọc state.infl
      var refFloor = refSalary(retStart);
      var adjC = function(r){ return r.b * (r.isNN && base.nnUseRef ? refSalary(retStart)/refSalary(r.m) : adjCoef(Math.floor(r.m/12), enjoyY, iv)); };
      var nnSumWin = 0; nnWin.forEach(function(r){ nnSumWin += adjC(r); });
      var nnBase = nnWin.length ? nnSumWin / nnWin.length * nnAll.length : 0;
      var othSum = 0; oth.forEach(function(r){ othSum += adjC(r); });
      var gB = (cfg.bGrow === 'flat') ? 0 : iv;
      function lawPension(months, sumOth){
        if(months < 180) return 0;          // chưa đủ điều kiện lương hưu hằng tháng
        var avg = (nnBase + sumOth) / months;
        var rate = pensionRate(benefitYears(months), gender);
        return floorOK ? Math.max(rate/100*avg, refFloor) : rate/100*avg;
      }
      var pension0 = lawPension(monthsCommon, othSum);
      /* Mỗi N nhận toàn bộ lương hưu của lịch Tab 3 cộng N năm, đối chiếu cùng dòng tiền gửi. */
      var perN = [ { pension:pension0, cArr:[] } ];
      var months = monthsCommon, othRun = othSum;
      var cArr = new Array(spanU).fill(0);
      for(var N2 = 1; N2 <= nMaxYears; N2++){
        var tEnd = M0 + N2*12 - 1;
        if(tEnd > retIdx) break;
        for(var t = M0 + (N2-1)*12; t <= tEnd; t++){
          var level = Math.min(Math.max(cfg.bStart * Math.pow(1 + gB/100, Math.floor((t - M0)/12)), tnFloor(t)), capMultiple(t) * refSalary(t));
          var C = contribRate * level;
          cArr[t - M0] = C;
          othRun += adjCoef(Math.floor(t/12), enjoyY, iv) * level; months++;
        }
        var pensionN = lawPension(months, othRun);
        perN[N2] = { pension:pensionN, cArr:cArr.slice(0, Math.min(spanU, N2*12)) };
      }
      /* Trước nghỉ hưu: mọi khoản đóng trong lịch Tab 3 và N năm đều có đối ứng gửi tiết kiệm.
         Từ B: sổ sinh lãi trên TOÀN BỘ số dư rồi rút ra đúng bằng lương hưu của tháng đó — người chỉ
         tiêu đúng bằng lương hưu nên lãi dư ở lại sổ sinh lãi tiếp (tái đầu tư), lãi thiếu thì ăn vào gốc.
         Hai mốc mỗi kịch bản: "thua" = tháng đầu lãi < hưu rút (số dư bắt đầu giảm — đã giảm thì giảm
         dần đều vì hưu không bao giờ giảm nên không phục hồi); "cạn" = tháng đầu số dư âm. Sau khi cạn,
         kịch bản vẫn được tính là thua ở các tuổi muộn hơn. */
      for(var xi = 0; xi < xVals.length; xi++){
        var monthlySave = Math.pow(1 + xVals[xi]/100, 1/12);
        var commonSavings = 0;
        common.forEach(function(r){ commonSavings += contribRate * r.b * Math.pow(monthlySave, B - 1 - r.m); });
        for(var N3 = 0; N3 <= nMaxYears; N3++){
          var cand = perN[N3];
          var row = rows[N3];
          if(row.months < 180) continue;       // chưa đủ điều kiện hưởng hưu; quyền lợi khác ngoài phạm vi
          if(cand.pension <= 0) continue;
          var cA = cand.cArr, extraSavingsAtRetirement = 0;
          for(var tSave = M0; tSave < B; tSave++){
            var ci = tSave - M0;
            extraSavingsAtRetirement = extraSavingsAtRetirement * monthlySave + (ci < cA.length ? cA[ci] : 0);
          }
          var savingsAtRetirement = commonSavings + extraSavingsAtRetirement;
          for(var yi = 0; yi < yVals.length; yi++){
            var balance = savingsAtRetirement, pensionGrowth = pensionFactors[yi], lostAt = -1;
            for(var su = 0; su < row.winCounts.length; su++){
              var prev = balance;
              balance = balance * monthlySave - cand.pension * pensionGrowth[su];
              if(lostAt < 0 && balance < prev) lostAt = su;   // lãi tháng đầu ít hơn hưu rút — ăn vào gốc
              if(balance < 0){
                row.winCounts[su]++;       // lưu số kịch bản cạn lần đầu; cộng dồn bên dưới
                row.scenariosWithWin++;
                break;
              }
            }
            if(lostAt >= 0) row.loseCounts[lostAt]++;     // cộng dồn bên dưới cùng winCounts
          }
        }
      }
    });
  }finally{ state.infl = oldInfl; }
  function intervals(counts, target){
    var out = [], from = null;
    for(var j = 0; j <= counts.length; j++){
      var yes = j < counts.length && counts[j] >= target;
      if(yes && from === null) from = B + j;
      if(!yes && from !== null){ out.push({ from:from, to:B + j - 1 }); from = null; }
    }
    return out;
  }
  rows.forEach(function(row){
    if(row.months >= 180){
      for(var su = 1; su < row.winCounts.length; su++) row.winCounts[su] += row.winCounts[su-1];
      var targetCount = Math.ceil(combos * threshold/100 - 1e-9);
      row.thresholdRanges = intervals(row.winCounts, targetCount);
      row.someRanges = intervals(row.winCounts, 1);
      row.allRanges = intervals(row.winCounts, combos);
      for(var j = 0; j < row.winCounts.length; j++) row.peakCount = Math.max(row.peakCount, row.winCounts[j]);
      if(row.peakCount > 0) row.peakRanges = intervals(row.winCounts, row.peakCount);
      for(var su2 = 1; su2 < row.loseCounts.length; su2++) row.loseCounts[su2] += row.loseCounts[su2-1];
      row.loseRanges = intervals(row.loseCounts, targetCount);   // cùng ngưỡng với mốc cạn
    }
    delete row.winCounts;
    delete row.loseCounts;
  });
  return { ok:true, rows:rows, combos:combos, nMaxYears:nMaxYears, monthsPast:monthsPast, monthsCommon:monthsCommon, M0:M0,
           capY:capY, retireIdx:retIdx, B:B, U:U, floorOK:floorOK, threshold:threshold, step:step,
           xRange:[xVals[0], xVals[xVals.length - 1]], iRange:[iVals[0], iVals[iVals.length - 1]], yRange:[yVals[0], yVals[yVals.length - 1]] };
}
