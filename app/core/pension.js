'use strict';
/* [core/pension.js] Luật BHXH + lương hưu: bảng luật (REF_TABLE/ADJ2026/lộ trình tuổi), công thức
   hai giai đoạn (pensionFactor/pensionMonthly), tổng hợp từng người (bhxhSummary/pensionProjection/
   pensionFromPeriods), kiểm tra giai đoạn đóng (validatePensionPeriods).
   ĐỌC: state (infl, simYears, periods/pension/birthYear/gender — qua person hoặc mặc định người chính), NOW.
   GHI: KHÔNG — mọi hàm thuần, kết quả trả về qua giá trị trả về. Người gọi: core/simulation.js, UI Tab 3, test. */
/* ================= Law (rút gọn, cập nhật 10/09/2026 — Luật BHXH 41/2024/QH15 hiệu lực 01/7/2025,
   NĐ 158/2025 (bắt buộc), NĐ 159/2025 (tự nguyện), TT 12/2025/TT-BNV, CV 340/BHXH-CSXH, NĐ 135/2020) ================= */
function ymToStr(idx){ return 'T'+((idx%12)+1)+'/'+Math.floor(idx/12); }
/* Mức tham chiếu = mức lương cơ sở trước khi bỏ (Điều 5 NĐ 158/2025) — bảng hiệu lực theo tháng.
   Mốc theo bàn giao 10/09/2026 (BAN_GIAO_CPI_LUONG_HUU_2026-09-10.md, mục 4): 730k từ 05/2010,
   1,05tr từ 05/2012, 1,15tr từ 07/2013 (nguồn chinhphu.vn/congbao cho từng mốc); KHÔNG có mốc
   1,6tr năm 2021 hay 1.494.000 năm 2022 — 1,49tr (từ 07/2019) giữ đến hết 06/2023 rồi tăng 1,8tr
   từ 07/2023 theo lộ trình cải cách tiền lương NQ 27 (xaydungchinhsach.chinhphu.vn); 2,34tr từ
   07/2024; 2,53tr từ 07/2026 (NĐ 161/2026). Bảng là LƯƠNG CƠ SỞ; trước 2016 trần DN luật ghi theo
   mức lương tối thiểu chung — hai dải trùng mốc trừ 01/2015–04/2016 (LMTC 1,21tr vs cơ sở 1,15tr)
   → xấp xỉ. Tháng trước 10/2004 lấy mốc sớm nhất (hiếm gặp). Sau 07/2026 luật sẽ điều chỉnh theo
   CPI/tăng trưởng (Chính phủ quyết định) — mô hình GIỮ mức 2,53tr và tăng theo lạm phát giả định Tab 4. */
var REF_TABLE = [
  [2004*12+9,290000],[2005*12+9,350000],[2006*12+9,450000],[2008*12+0,540000],
  [2009*12+4,650000],[2010*12+4,730000],[2011*12+4,830000],[2012*12+4,1050000],
  [2013*12+6,1150000],[2016*12+4,1210000],[2017*12+6,1300000],[2018*12+6,1390000],
  [2019*12+6,1490000],[2023*12+6,1800000],[2024*12+6,2340000],[2026*12+6,2530000]
];
function refSalary(m){
  var v = REF_TABLE[0][1], last = REF_TABLE[REF_TABLE.length-1];
  for(var i=0;i<REF_TABLE.length;i++){ if(m >= REF_TABLE[i][0]) v = REF_TABLE[i][1]; else break; }
  var base27 = 2027*12;
  if(m >= base27 && typeof state!=='undefined' && typeof state.infl==='number' && isFinite(state.infl) && state.infl!==0)
    v = v * Math.pow(1 + state.infl/100, Math.floor((m-base27)/12)+1);
  return v;
}
/* Trần đóng: 20 × mức lương cơ sở/LMTC cho MỌI chế độ, MỌI thời điểm — khoản 3 Điều 89 Luật BHXH
   2014 (áp đến 30/6/2025; trước 01/2016 là Điều 103 Luật 2006 với 20 × mức lương tối thiểu chung),
   Điều 31 Luật 41/2024 giữ 20 × mức tham chiếu từ 01/7/2025. Không có lộ trình giảm trần. */
function capMultiple(m){ return 20; }
function capSalary(p, m){ return capMultiple(m)*refSalary(m); }
/* Sàn thu nhập tự nguyện = chuẩn hộ nghèo khu vực nông thôn: 1,5tr từ 01/01/2022 (NĐ 07/2021),
   2,2tr từ 01/01/2027 (NĐ 351/2025); trước 2022 lấy 700k (chuẩn 2016–2021, xấp xỉ giai đoạn trước). */
function tnFloor(m){ return m >= 2027*12 ? 2200000 : (m >= 2022*12 ? 1500000 : 700000); }
/* BHTN (Luật Việc làm 74/2025): 60% × bq lương đóng 6 tháng cuối, tối đa 5× lương tối thiểu vùng */
var BHTN_CAP = 5*4960000;
/* Tuổi nghỉ hưu chuẩn (Điều 169 Luật HĐLĐ sửa đổi, giữ tại Điều 69 Luật BHXH 41/2024; Phụ lục I
   NĐ 135/2020): tuổi tra theo NĂM ĐỦ TUỔI — NAM 60 tuổi 3 tháng vào năm 2021, mỗi năm +3 tháng
   đến đủ 62 tuổi vào năm 2028; NỮ 55 tuổi 4 tháng vào 2021, +4 tháng/năm đến đủ 60 tuổi vào 2035;
   trước 2021 giữ 60/55. Đối chiếu bảng tra cứu chính thức: nam sinh T1/1961 → 60y3m → T4/2021;
   T1/1964 → 61y3m → T4/2025; T1/1965 → 61y6m → T7/2026; T1/1968 → 62y → T1/2030.
   Chỉ lưu năm sinh → giả định sinh tháng 1. Trả về tháng ĐỦ TUỔI; tháng bắt đầu hưởng lương hưu
   = tháng liền kề SAU (Đ15 TT 12/2025). */
function retireAgeMonths(birthY, gender){
  var birth = birthY*12;
  for(var y = birthY+50; y <= birthY+75; y++){
    var ageM = gender==='male' ? (y < 2021 ? 720 : Math.min(723+3*(y-2021),744))
                               : (y < 2021 ? 660 : Math.min(664+4*(y-2021),720));
    if(Math.floor((birth+ageM)/12) === y) return birth+ageM;
  }
  return birth + (gender==='male'?744:720);
}
/* Số năm TÍNH HƯỞNG từ tổng tháng đóng (khoản 6 Điều 5 Luật 41/2024): tháng lẻ 1–6 → nửa năm,
   7–11 → một năm. Điều kiện hưởng vẫn xét theo tháng thực tế — 179 tháng KHÔNG được làm tròn thành 15 năm. */
function benefitYears(months){ var y=Math.floor(months/12), r=months%12; return y + (r>=7 ? 1 : r>=1 ? .5 : 0); }
/* Tỷ lệ lương hưu (Điều 66 Luật 41/2024): nữ đủ 15 năm 45% +2%/năm, tối đa 75% (30 năm);
   nam đủ 20 năm 45% +2%/năm, tối đa 75% (35 năm); nam đủ 15–dưới 20 năm 40% +1%/năm cho mỗi năm thứ 16 trở đi. */
function pensionRate(years, gender){
  var r = 0;
  if(gender==='female'){ if(years>=15) r = 45 + 2*(years-15); }
  else { if(years>=20) r = 45 + 2*(years-20); else if(years>=15) r = 40 + 1*(years-15); }
  return Math.min(r, 75);
}
/* Hệ số điều chỉnh tiền lương/thu nhập tháng đã đóng, cho năm hưởng 2026 — CV 340/BHXH-CSXH (03/02/2026),
   CPI gốc 1994 (Đ16 NĐ 158/2025, Đ10 NĐ 159/2025). NĐ 158/2025 Đ16: hệ số LÀM TRÒN 2 chữ số thập phân,
   MỨC THẤP NHẤT = 1. Phạm vi áp hệ số CPI: chế độ NSDLĐ quyết định mọi năm và chế độ Nhà nước
   CHỈ với người bắt đầu tham gia TỪ 01/01/2016 (người NN bắt đầu trước 2016 điều chỉnh theo mức
   lương cơ sở — xử lý trong bhxhSummary). Năm hưởng > 2026 chưa công bố → giả định: bảng 2026 ×
   (1+lạm phát Tab 4)^(năm hưởng−2026); năm đóng từ 2026: (1+lạm phát)^(năm hưởng−1−năm đóng);
   năm hưởng < 2026: quy đổi tương đối bảng 2026 (xấp xỉ, không phải bảng công bố của năm đó). */
var ADJ2026 = {pre1995:5.81,1995:4.91,1996:4.65,1997:4.5,1998:4.18,1999:4.01,2000:4.07,2001:4.09,2002:3.94,2003:3.81,2004:3.54,2005:3.27,2006:3.05,2007:2.81,2008:2.29,2009:2.14,2010:1.96,2011:1.65,2012:1.51,2013:1.42,2014:1.36,2015:1.36,2016:1.32,2017:1.28,2018:1.23,2019:1.2,2020:1.16,2021:1.14,2022:1.11,2023:1.07,2024:1.03,2025:1,2026:1};
function adjCoef(yearClosed, yearEnjoy, cpiPct){
  var past = yearClosed < 1995 ? ADJ2026.pre1995 : (yearClosed > 2026 ? 1 : ADJ2026[yearClosed]);
  var c;
  if(yearClosed >= 2026) c = Math.pow(1 + cpiPct/100, Math.max(0, yearEnjoy-1-yearClosed));
  else if(yearEnjoy >= 2026) c = past * Math.pow(1 + cpiPct/100, yearEnjoy-2026);
  else { var e = yearEnjoy < 1995 ? ADJ2026.pre1995 : ADJ2026[yearEnjoy]; c = past / e; }
  return Math.max(1, Math.round(c*100)/100);   /* Đ16 NĐ 158/2025: làm tròn 2 chữ số, tối thiểu 1 */
}
function empRate(p, m){ if(p.type==='tn') return 0.22; return 0.105; } /* NLĐ: 8% BHXH + 1,5% BHYT + 1% BHTN = 10,5% — ổn định qua các kỳ luật (Luật BHXH 2024 không đổi mức này) */


function strTrim(s){ return String(s || '').replace(/^\s+|\s+$/g, ''); }
function parseYM(s){
  s = strTrim(s);
  var m1 = s.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);            // 01/2027
  if(m1 && +m1[1] >= 1 && +m1[1] <= 12) return (+m1[2])*12 + (+m1[1]-1);
  var m2 = s.match(/^(\d{4})\s*-\s*(\d{1,2})$/);             // 2027-01
  if(m2 && +m2[2] >= 1 && +m2[2] <= 12) return (+m2[1])*12 + (+m2[2]-1);
  return NaN;
}

function periodsChrono(periods){
  periods = periods || state.periods;
  return periods.map(function(p,i){ return Object.assign({},p,{_row:i,_f:parseYM(p.from),_t:(p.to && String(p.to).length?parseYM(p.to):null)}); })
    .sort(function(a,b){ return a._f - b._f; });
}
/* F06 — dòng "đến nghỉ hưu" đóng đến HẾT tháng đủ tuổi (retireIdx, đóng trọn tháng cuối làm việc),
   KHÔNG kẹp theo số năm mô phỏng: đổi độ dài xem NAV phải không đổi kế hoạch đóng/hưu ước tính. */
function periodEnd(p, retireIdx){ return p._t === null ? retireIdx : p._t; }
function bhAt(p, m){ var yrs = Math.floor((m - p._f)/12); var v = p.bh * Math.pow(1 + p.growth/100, Math.max(0,yrs));
  var lo = p.type==='tn' ? tnFloor(m) : 0; return Math.min(Math.max(v, lo), capSalary(p, m)); }

/* ===== Lương hưu hai giai đoạn (BAN_GIAO_CPI_LUONG_HUU_2026-09-10.md) =====
   pensionSimple.amount là tiền/tháng theo SỨC MUA tại tháng gốc NOW (amountBasis:'baseMonth').
   Giai đoạn 1 — quy đổi trượt giá đến tháng bắt đầu hưởng R: hệ số F=(1+i)^((B−N)/12) với B=max(N,R),
   lãi kép theo đúng số tháng lẻ (18 tháng → mũ 1,5). Người đã nghỉ trước NOW (R<N) không quy đổi
   thêm (B=N → F=1) và không tăng bù cho những năm trước NOW.
   Giai đoạn 2 — sau khi bắt đầu hưởng, tăng theo growth mỗi đúng 12 tháng hưởng: tháng hưởng
   1–12 nhận P0, tháng 13 nhận P0×(1+g)… Không tăng ngay tháng đầu; sau R không nhân thêm CPI
   vào dòng hưu danh nghĩa (CPI vẫn dùng cho chi phí và quy đổi sức mua). */
function pensionFactor(startIdx, nowIdx, inflPct){
  var B = Math.max(nowIdx, startIdx);
  return Math.pow(1 + inflPct/100, (B - nowIdx)/12);
}
function pensionMonthly(amount, startIdx, growthPct, inflPct, nowIdx, m){
  if(!(amount > 0) || m < startIdx) return 0;
  var B = Math.max(nowIdx, startIdx);
  return amount * pensionFactor(startIdx, nowIdx, inflPct)
               * Math.pow(1 + growthPct/100, Math.floor((m - B)/12));
}
/* ===== Gia đình nhiều người (11/09/2026) =====
   Người chính: person = null → hồ sơ Tab 1 (state.birthYear/gender) + state.periods + state.pensionSimple.
   Thành viên thêm: person = một phần tử state.extraPeople (tự chứa birthYear/gender/periods/pension).
   Mỗi người có mốc hưởng và mức riêng; mô phỏng cộng các dòng hưu vào cùng cuối tháng theo đúng
   thời điểm từng người bắt đầu nhận — công thức hai giai đoạn áp dụng độc lập theo người. */
function personBirth(p){ return p ? p.birthYear : state.birthYear; }
function personGender(p){ return p ? p.gender : state.gender; }
function personPeriods(p){ return p ? (Array.isArray(p.periods) ? p.periods : []) : state.periods; }
/* Mốc bắt đầu hưởng (index tháng) + mức + tăng của MỘT hộp lương hưu hình dạng pensionSimple */
function pensionStartOf(ps){
  return { amount: ps.amount, start: ps.startYear*12 + ((ps.startMonth===undefined?1:ps.startMonth)-1), growth: ps.growth };
}
/* Kiểm tra giai đoạn đóng của MỘT người (F04): lỗi chỉ rõ dòng gây ra; toàn bộ là dữ liệu tham khảo
   cho tự tính lương hưu → refOnly=true (R06), NGOẠI TRỪ số tiền/tăng lương đóng không hợp lệ (giữ
   đúng hành vi cũ: hai phép number này chặn mô phỏng). prefix ('[Tên] ') phân biệt người thêm;
   người chính truyền '' để giữ nguyên thông điệp cũ. */
function validatePensionPeriods(periods, birthYear, gender, prefix){
  var out=[];
  function add(level,msg,refOnly){ out.push({level:level,tab:'t3',msg:prefix?prefix+' '+msg:msg,refOnly:!!refOnly}); }
  function number(v,label,min,max,integer){
    if(!finiteNumber(v)||v<min||v>max||(integer&&!Number.isInteger(v)))
      add('error',label+' không hợp lệ'+(integer?' (cần số nguyên)':'')+'.');
  }
  function ymLocal(s){var m2=/^(\d{4})-(\d{1,2})$/.exec(String(s==null?'':s).trim());return m2&&+m2[2]>=1&&+m2[2]<=12?(+m2[1])*12+(+m2[2]-1):NaN;}
  var eff=periods.map(function(p){var f2=ymLocal(p.from),t2=(p.to&&String(p.to).length)?ymLocal(p.to):null;return {f:f2,t2:t2,effT:t2===null?retireAgeMonths(birthYear,gender):t2};});
  periods.forEach(function(p,i){
    var a=eff[i];
    if(isNaN(a.f))add('error','Giai đoạn BHXH dòng '+(i+1)+': tháng bắt đầu chưa hợp lệ (dạng mm/năm hoặc yyyy-mm).',true);
    if(p.to&&String(p.to).length&&isNaN(a.t2))add('error','Giai đoạn BHXH dòng '+(i+1)+': tháng kết thúc chưa hợp lệ.',true);
    if(!isNaN(a.f)&&a.t2!==null&&!isNaN(a.t2)&&a.t2<a.f)add('error','Giai đoạn BHXH dòng '+(i+1)+': tháng kết thúc trước tháng bắt đầu.',true);
    if(!isNaN(a.f)&&!isNaN(a.effT)&&a.effT<a.f)add('warn','Giai đoạn BHXH dòng '+(i+1)+' nằm sau mốc nghỉ hưu quy ước — không tính vào điều kiện hưởng hưu.',true);
    number(p.bh,'Lương đóng BHXH (dòng '+(i+1)+')',0,1e15,false,true);
    number(p.growth,'Tăng lương đóng (dòng '+(i+1)+')',-99,100,false);
  });
  var ord=eff.map(function(a,i2){return {i:i2,a:a};}).sort(function(x,y2){return x.a.f-y2.a.f;});
  for(var j2=1;j2<ord.length;j2++){
    var prev=ord[j2-1].a,cur=ord[j2].a;
    if(!isNaN(prev.f)&&!isNaN(cur.f)&&cur.f<=prev.effT)add('warn','Hai giai đoạn đóng BHXH chồng lấn (bắt đầu '+String(periods[ord[j2].i].from)+') — tháng trùng chỉ tính một lần theo dòng sớm hơn.',true);
  }
  return out;
}

/* Kỳ bình quân chế độ tiền lương Nhà nước theo năm BẮT ĐẦU tham gia (khoản 1 Điều 72 Luật 41/2024,
   TT 12/2025 Đ16): trước 1995 → 5 năm cuối; 1995–2000 → 6; 2001–2006 → 8; 2007–2015 → 10;
   2016–2019 → 15; 2020–2024 → 20; từ 01/2025 → toàn bộ. Chế độ NSDLĐ quyết định và tự nguyện → toàn bộ. */
function nnWindowMonths(firstM){
  if(!isFinite(firstM) || firstM >= 2025*12) return null;
  if(firstM < 1995*12) return 60;
  if(firstM < 2001*12) return 72;
  if(firstM < 2007*12) return 96;
  if(firstM < 2016*12) return 120;
  if(firstM < 2020*12) return 180;
  return 240;
}
/* Dựng chuỗi tháng đóng đã hợp nhất của MỘT người — dùng chung cho lương hưu (bhxhSummary) và
   rút BHXH một lần (bhxhLumpSum). person=null → người chính (Tab 1 + state.periods); person là
   phần tử state.extraPeople → dùng hồ sơ của người đó. capRetire=true (lương hưu): tháng đóng sau
   mốc đủ tuổi KHÔNG tính (nghỉ hưu muộn ngoài phạm vi ước tính, đếm monthsAfterRetire kèm cảnh
   báo); capRetire=false (rút một lần): Điều 70 tính theo TOÀN BỘ thời gian ĐÃ ĐÓNG — mọi tháng
   đóng hợp lệ đều tính, kể cả sau mốc đủ tuổi. Hàm thuần: không đổi state. */
function bhxhMonthsRaw(person, capRetire){
  var birthYear = personBirth(person), gender = personGender(person), periods = personPeriods(person);
  var retIdx = retireAgeMonths(birthYear, gender);
  var retStart = retIdx + 1;   /* B05/Đ15 TT 12/2025: lương hưu tính và hưởng từ tháng liền kề sau tháng đủ tuổi */
  var ps = periodsChrono(periods).filter(function(p){ return p.type!=='none'; });
  var months=0, first=Infinity, monthsPre=0, monthsPost=0, lastEnd=-Infinity;
  var contribPast=0, contribFuture=0, contrib22=0, erFuture=0, overlapMonths=0, monthsAfterRetire=0;
  var Y2014 = 2014*12, recs=[];
  /* F04 — mỗi tháng đóng chỉ được đếm MỘT lần: giai đoạn chồng lấn hợp nhất theo thứ tự
     thời gian (dòng sớm hơn thắng phần trùng). Dòng "đến nghỉ hưu" (to trống) vẫn tính tới
     tháng đủ tuổi — giả định kế hoạch đóng của app. */
  var covered=-Infinity;
  ps.forEach(function(p){
    var rawEnd = periodEnd(p, retIdx);
    if(isNaN(p._f) || isNaN(rawEnd)) return;
    var ov = Math.min(rawEnd, covered) - p._f + 1;
    if(ov > 0) overlapMonths += ov;
    var f0 = Math.max(p._f, covered + 1);   // khoảng hiệu dụng = phần chưa bị dòng trước chiếm
    if(f0 > rawEnd){ if(p._f < first) first = p._f; return; }
    covered = Math.max(covered, rawEnd);
    var cntEnd = capRetire ? Math.min(rawEnd, retIdx) : rawEnd;
    if(cntEnd >= f0){
      for(var m = f0; m <= cntEnd; m++){
        months++;
        if(m <= Y2014-1) monthsPre++; else monthsPost++;
        var b = bhAt(p, m);
        recs.push({m:m, type:p.type, b:b, row:p._row});
        /* 22% vào quỹ hưu trí–tử tuất (bắt buộc: 8% NLĐ + 14% NSDLĐ; tự nguyện: 22%) — cơ sở
           mức hưởng "chưa đủ một năm" của BHXH một lần (điểm c khoản 3 Điều 70 Luật 41/2024). */
        contrib22 += b*0.22;
        if(m < NOW) contribPast += b*empRate(p, m);
        else { contribFuture += b*empRate(p, m); if(p.type!=='tn') erFuture += b*0.215; }
      }
    }
    if(capRetire && rawEnd > cntEnd) monthsAfterRetire += rawEnd - Math.max(cntEnd, f0 - 1);
    if(rawEnd > lastEnd) lastEnd = rawEnd;
    if(p._f < first) first = p._f;
  });
  return { periods:periods, recs:recs, months:months, first:first, monthsPre:monthsPre, monthsPost:monthsPost,
           contribPast:contribPast, contribFuture:contribFuture, contrib22:contrib22, erFuture:erFuture,
           overlapMonths:overlapMonths, monthsAfterRetire:monthsAfterRetire, lastEnd:lastEnd,
           retIdx:retIdx, retStart:retStart };
}
/* Điều chỉnh từng tháng đóng theo THÁNG HƯỞNG cho trước rồi tính bình quân tiền lương/thu nhập
   tháng đóng (Điều 72–73 Luật 41/2024 — dùng cho cả lương hưu lẫn BHXH một lần): lương hưu chọn
   tháng hưởng = retStart; rút một lần chọn tháng rút ước tính. Mutates raw.recs (thêm .adj) —
   raw là đối tượng nội bộ vừa dựng bởi bhxhMonthsRaw, không phải state. */
function bhxAvgAdjusted(raw, enjoyIdx){
  var enjoyY = Math.floor(enjoyIdx/12), periods = raw.periods, recs = raw.recs, notes=[];
  /* B01/B02 — điều chỉnh từng tháng theo CHẾ ĐỘ rồi mới bình quân (khoản 1–2 Điều 73 Luật 41/2024;
     phạm vi tại Đ16 NĐ 158/2025): dn/tn mọi năm + nn CHỈ khi bắt đầu tham gia TỪ 01/01/2016 → hệ số
     CPI của năm hưởng (CV 340; năm >2026 là giả định lạm phát); nn bắt đầu tham gia TRƯỚC 01/01/2016 →
     TOÀN BỘ tháng đóng (kể cả từ 2016 trở đi) quy theo tỷ lệ mức tham chiếu tại hưởng/tháng đóng
     (cơ chế lương cơ sở — hệ số lương × lương cơ sở hiện hành). */
  var nnRecs=[], othRecs=[];
  recs.forEach(function(r){ (r.type==='nn' ? nnRecs : othRecs).push(r); });
  var firstNN = nnRecs.length ? nnRecs[0].m : Infinity;
  var nnUseRef = firstNN < 2016*12;
  var periodAdjusted = periods.map(function(){ return null; });
  var periodAdjustedSum = periods.map(function(){ return 0; });
  var periodAdjustedMonths = periods.map(function(){ return 0; });
  recs.forEach(function(r){
    var c = (r.type==='nn' && nnUseRef) ? refSalary(enjoyIdx)/refSalary(r.m)
                                        : adjCoef(Math.floor(r.m/12), enjoyY, state.infl);
    r.adj = r.b * c;
    periodAdjustedSum[r.row] += r.adj;
    periodAdjustedMonths[r.row]++;
  });
  periodAdjusted.forEach(function(_,i){
    if(periodAdjustedMonths[i]) periodAdjusted[i] = periodAdjustedSum[i]/periodAdjustedMonths[i];
  });
  if(nnUseRef) notes.push('Lương Nhà nước (bắt đầu tham gia trước 01/2016) điều chỉnh toàn bộ theo tỷ lệ mức tham chiếu');
  if(enjoyY > 2026) notes.push('Hệ số năm '+enjoyY+' chưa công bố — ngoại suy theo lạm phát '+state.infl+'%/năm (giả định)');
  else if(enjoyY < 2026) notes.push('Năm hưởng trước 2026 — hệ số quy đổi xấp xỉ từ bảng CV 340/2026, không phải bảng công bố của năm hưởng');
  /* Kỳ bình quân: nn lấy "N năm cuối" theo năm bắt đầu tham gia (khoản 1 Điều 72), phần còn lại dùng
     toàn bộ. Hỗn hợp theo TT 12/2025 Đ16 khoản 3: (bq TL trong kỳ nn × TOÀN BỘ số tháng nn
     + tổng TL đã điều chỉnh phần kia) / (tổng tháng nn + tháng phần kia) — tháng nn ngoài kỳ vẫn
     làm trọng số, không bị mất như dùng riêng "N năm cuối" chia chung. */
  var K = nnWindowMonths(raw.first);
  var nnWin = (K===null || nnRecs.length<=K) ? nnRecs : nnRecs.slice(-K);
  var nnSum=0, othSum=0;
  nnWin.forEach(function(r){ nnSum += r.adj; });
  othRecs.forEach(function(r){ othSum += r.adj; });
  var nnAvg = nnWin.length ? nnSum/nnWin.length : 0;
  var avgMonths = nnRecs.length + othRecs.length;
  var avg = avgMonths ? (nnAvg*nnRecs.length + othSum)/avgMonths : 0;
  return { avg:avg, periodAdjusted:periodAdjusted, notes:notes };
}
/* ===== Rút BHXH một lần — khoản 3 Điều 70 (bắt buộc) / Điều 102 (tự nguyện) Luật BHXH 41/2024 =====
   Mỗi NĂM TRÒN đóng trước 01/01/2014: 1,5 × mức bình quân; từ năm 2014 trở đi: 2 × bình quân.
   Năm chưa tròn trước 2014 (khi có cả hai giai đoạn) GỘP với thời gian đóng từ 2014 trở đi để tính
   (điểm a khoản 3); tháng lẻ 1–6 tháng = nửa năm, 7–11 tháng = một năm (quy tắc làm tròn năm theo
   khoản 6 Điều 5 — cùng quy tắc benefitYears). Khi KHÔNG có tháng đóng nào từ 2014, phần lẻ trước
   2014 làm tròn theo quy tắc đó và vẫn tính hệ số 1,5 (thuộc thời gian trước 2014). Chưa đủ MỘT năm
   đóng: mức = 22% × lương/thu nhập tháng × số tháng đã đóng, tối đa 2 × bình quân (điểm c khoản 3).
   Khoản 4: riêng trường hợp bệnh (điểm c) và suy giảm khả năng lao động/khuyết tật đặc biệt nặng
   (điểm d) mức hưởng bao gồm CẢ phần ngân sách hỗ trợ BHXH tự nguyện — app không mô hình phần hỗ
   trợ. Thời điểm tính hưởng = thời điểm cơ quan BHXH ban hành quyết định (khoản 5) → hệ số điều
   chỉnh chọn theo năm rút ước tính. Người có thời gian đóng từ trước 1995 có thể được giải quyết
   theo quy định riêng cho giai đoạn này — app chưa mô hình, chỉ áp công thức 1,5/2 thống nhất. */
function lumpSumSplit(monthsPre, monthsPost){
  var split = { yearsPre: Math.floor(monthsPre/12), poolMonths: 0, yearsPool: 0, poolRate: 2 };
  if(monthsPost > 0) split.poolMonths = monthsPre%12 + monthsPost;   // gộp năm lẻ trước 2014 vào giai đoạn từ 2014
  else { split.poolMonths = monthsPre%12; split.poolRate = 1.5; }    // chỉ có trước 2014: lẻ làm tròn, hệ số 1,5
  split.yearsPool = benefitYears(split.poolMonths);
  return split;
}
function lumpSumMonthlyCount(monthsPre, monthsPost){
  var L = lumpSumSplit(monthsPre, monthsPost);
  return 1.5*L.yearsPre + L.poolRate*L.yearsPool;   // tổng "số tháng mức bình quân" được hưởng
}
/* M1 — bhxhSummary(person): tổng hợp BHXH + lương hưu của MỘT người. Lạm phát/số năm mô phỏng/NOW
   là giả định chung nhà. Hàm thuần: không đổi state. */
function bhxhSummary(person){
  var raw = bhxhMonthsRaw(person, true), gender = personGender(person);   /* lương hưu: không tính tháng đóng sau mốc đủ tuổi */
  var A = bhxAvgAdjusted(raw, raw.retStart);
  var notes = A.notes.slice();
  /* B04 — điều kiện xét theo tháng thực tế; tỷ lệ theo SỐ NĂM TÍNH HƯỞNG (tháng lẻ 1–6 = nửa năm, 7–11 = một năm). */
  var benYears = benefitYears(raw.months), rate = pensionRate(benYears, gender);
  /* B03 — sàn mức tham chiếu CHỈ áp cho hồ sơ đã tham gia trước 01/7/2025 và đủ 20 NĂM BẮT BUỘC
     (khoản 11 Điều 141 Luật 41/2024; Điều 13 NĐ 158/2025) — không áp cho thuần tự nguyện hay dưới 20 năm bắt buộc. */
  var compMonths=0; raw.recs.forEach(function(r){ if(r.type!=='tn') compMonths++; });
  var floorOK = compMonths>=240 && isFinite(raw.first) && raw.first < 2025*12+6;
  var rawPension = rate/100*A.avg;
  var pension = !raw.months ? 0 : (floorOK ? Math.max(rawPension, refSalary(raw.retStart)) : rawPension);
  if(floorOK && rawPension < refSalary(raw.retStart)) notes.push('Mức hưu được nâng lên sàn mức tham chiếu');
  /* Rút BHXH một lần — công thức Điều 70 khoản 3 (xem lumpSumSplit); dùng bình quân theo năm
     hưởng hưu của chính summary (bhxhLumpSum tính riêng theo năm rút). Thời điểm chờ 12 tháng
     (điểm đ khoản 1 Điều 70 + Điều 14 NĐ 158/2025): 12 tháng không đóng tính liên tục đến tháng
     liền trước tháng nộp hồ sơ → nộp được từ tháng thứ 13 sau tháng đóng cuối. */
  var lumpAmt = (raw.months && raw.months < 12) ? Math.min(raw.contrib22, 2*A.avg)
                                                : A.avg*lumpSumMonthlyCount(raw.monthsPre, raw.monthsPost);
  var lumpMonth = isFinite(raw.lastEnd) ? Math.min(Math.max(NOW, raw.lastEnd + 13), NOW + state.simYears*12) : -1;
  var birthYear = personBirth(person), defaultFirst = (birthYear+18)*12;
  return { months:raw.months, years:raw.months/12, benYears:benYears, avg:A.avg, rate:rate, pension:pension, first:raw.first,
           firstOrDefault: isFinite(raw.first)? raw.first : defaultFirst, usingDefault: !isFinite(raw.first),
           retireIdx:raw.retIdx, retStart:raw.retStart, eligible:raw.months>=180, floorOK:floorOK, compMonths:compMonths,
           estNotes:notes, contribPast:raw.contribPast, contribFuture:raw.contribFuture, erFuture:raw.erFuture,
           lumpAmt:lumpAmt, lumpMonth:lumpMonth, monthsPre:raw.monthsPre, monthsPost:raw.monthsPost,
           overlapMonths:raw.overlapMonths, monthsAfterRetire:raw.monthsAfterRetire, periodAdjusted:A.periodAdjusted };
}
/* bhxhLumpSum(person): mức rút BHXH một lần ước tính cho MỘT người (null = người chính) — điều kiện
   hưởng (khoản 1 Điều 70 / Điều 102: đủ tuổi hưu chưa đủ 15 năm, ra nước ngoài định cư, bệnh, suy
   giảm khả năng lao động ≥81% hoặc khuyết tật đặc biệt nặng, điểm đ — tham gia trước 01/07/2025
   đóng chưa đủ 20 năm và chờ 12 tháng, điểm e — quân nhân/công an phục viên…) là dữ kiện cá nhân
   app không kiểm tra được → hàm chỉ trả MỨC hưởng; UI nêu điều kiện. Khác bhxhSummary: (1) tính
   TOÀN BỘ thời gian đã đóng kể cả sau mốc đủ tuổi (Điều 70 không giới hạn theo tuổi — capRetire
   false); (2) hệ số điều chỉnh bình quân chọn theo NĂM RÚT ước tính (khoản 5: thời điểm tính hưởng
   = thời điểm BHXH ban hành quyết định), không theo năm hưởng hưu. Trả {ok:false, reason:'invalid'
   |'empty'} khi giai đoạn đóng còn BẤT KỲ lỗi nào (kể cả lương/tăng lương không hợp lệ — không trả
   NaN) hoặc chưa có tháng đóng nào. Thuần. */
function bhxhLumpSum(person){
  var perErrs = validatePensionPeriods(personPeriods(person),personBirth(person),personGender(person),'')
    .filter(function(v){ return v.level==='error'; });
  if(perErrs.length) return { ok:false, reason:'invalid' };
  var raw = bhxhMonthsRaw(person, false);
  if(!raw.months) return { ok:false, reason:'empty' };
  /* Mốc nộp theo trường hợp điểm đ (chờ 12 tháng): Điều 14 NĐ 158/2025 — 12 tháng không đóng tính
     liên tục đến tháng liền kề trước tháng tiếp nhận hồ sơ → đóng cuối T12/2030 → nộp từ T1/2032.
     Các trường hợp khác không có chờ 12 tháng — UI hiển thị riêng. */
  var eligMonth = raw.lastEnd + 13;
  var A = bhxAvgAdjusted(raw, Math.max(NOW, eligMonth));
  var L = lumpSumSplit(raw.monthsPre, raw.monthsPost);
  var monthlyCount = 1.5*L.yearsPre + L.poolRate*L.yearsPool;
  var underOneYear = raw.months < 12;
  var amount = underOneYear ? Math.min(raw.contrib22, 2*A.avg) : A.avg*monthlyCount;
  var openRows = personPeriods(person).filter(function(p){ return p.type!=='none' && (!p.to || !String(p.to).length); }).length;
  return { ok:true, months:raw.months, monthsPre:raw.monthsPre, monthsPost:raw.monthsPost,
           avg:A.avg, eligMonth:eligMonth, lastEnd:raw.lastEnd, split:L, monthlyCount:monthlyCount,
           amount:amount, underOneYear:underOneYear, paid22:raw.contrib22, capped:underOneYear && raw.contrib22 > 2*A.avg,
           eligible:raw.months>=180, overlapMonths:raw.overlapMonths, monthsAfterRetire:raw.monthsAfterRetire,
           openRows:openRows, notes:A.notes, retireIdx:raw.retIdx };
}


/* Chiếu dòng lương hưu NHẬP TAY theo đúng công thức runSim (hai giai đoạn — BAN_GIAO_CPI
   10/09/2026): amount là giá tại tháng gốc → nhân lạm phát đến tháng bắt đầu hưởng (p0),
   sau đó tăng mỗi đúng 12 tháng hưởng; chiết khấu lạm phát theo số tháng đã trôi. Người
   đã nghỉ trước NOW (psStart < NOW) tính tăng từ NOW, không tăng bù cho quá khứ.
   Không đổi state. R08 — kỳ mô phỏng sai (âm/thập phân/quá lớn) không vào vòng lặp đếm tháng. */
function pensionProjection(ps){
  ps = ps || state.pensionSimple;
  var psStart=ps.startYear*12+(ps.startMonth===undefined?1:ps.startMonth)-1;
  var count=(Number.isInteger(state.simYears)&&state.simYears>=1&&state.simYears<=100)?state.simYears*12:0,total=0,real=0,n=0;
  var factor=pensionFactor(psStart,NOW,state.infl), p0=ps.amount>0?ps.amount*factor:0;
  for(var mi=0; mi<count; mi++){
    var m=NOW+mi;
    var v=pensionMonthly(ps.amount,psStart,ps.growth,state.infl,NOW,m);
    if(v<=0) continue;
    total+=v; real+=v/Math.pow(1+state.infl/100,(mi+1)/12); n++;
  }
  return {psStart:psStart, months:n, total:total, real:real, p0:p0, factor:factor};
}

/* Tự tính lương hưu NHẬP TAY từ danh sách giai đoạn đóng (Tab 3): trả về {p0,amount,startYear,startMonth}
   đủ điều kiện ghi vào state.pensionSimple, hoặc null khi chưa tính được — giữ nguyên mức hiện tại:
   - giai đoạn còn BẤT KỲ lỗi nào của validatePensionPeriods (định dạng/đảo đầu-cuối — F04, hoặc
     lương/tăng lương không hợp lệ) → không tính bừa từ các dòng còn lại, không trả NaN;
   - không tháng đóng nào hợp lệ (months = 0) hoặc chưa đủ 180 tháng (điều kiện ≥ 15 năm theo tháng thực).
   Tháng bắt đầu hưởng = THÁNG ĐỦ TUỔI nghỉ hưu (đợt 13, 12/09/2026 — yêu cầu người dùng: nút ⚙ reset
   tháng về 1; giả định sinh tháng 1 nên mốc đủ tuổi rơi tháng 1). p0 = mức danh nghĩa TẠI THÁNG BẮT ĐẦU
   HƯỞNG (đã điều chỉnh hệ số đến năm hưởng — KHÔNG nhân thêm lạm phát).
   amount = p0 quy về GIÁ HIỆN TẠI (chia hệ số trượt giá F tại chính tháng hưởng này) — cùng nghĩa với ô
   nhập tay; đưa vào mô phỏng qua pensionMonthly sẽ nhận lại đúng p0 ở tháng hưởng (không nhân hai lần). */
function pensionFromPeriods(person){
  var perErrs = validatePensionPeriods(personPeriods(person),personBirth(person),personGender(person),'')
    .filter(function(v){ return v.level==='error'; });
  if(perErrs.length) return null;
  var s = bhxhSummary(person);
  if(!s.months || !s.eligible) return null;
  var B = s.retireIdx;   /* hưởng ngay tháng đủ tuổi (trước đây: retStart = retireIdx+1 theo Đ15 TT 12/2025) */
  var F = pensionFactor(B, NOW, state.infl);
  return { p0:s.pension, amount:s.pension/F, startYear:Math.floor(B/12), startMonth:B%12+1 };
}
