'use strict';
/* [state/defaults.js] Định nghĩa trạng thái mặc định (schemaVersion 9 — thêm Tab 8 Tối ưu đóng BHXH: compareCfg what-if độc lập, điền im lặng cho bản cũ) + NOW = tháng gốc mô phỏng.
   Global định nghĩa ở đây: state, defaultState, NOW (setNow neo NOW để kiểm thử).
   Chỉ state/persist.js (loadState) được gán lại toàn cục `state`; UI ghi state qua readInputs/handler. */
var NOW = (function(){ var d = new Date(); return d.getFullYear()*12 + d.getMonth(); })(); // tháng hiện tại (tự động)
function setNow(idx){ NOW = idx; if(typeof state!=='undefined')state.startMonth=idx; } // dùng cho kiểm thử: neo NOW về một tháng cố định

var state = {
  schemaVersion:9, startMonth:NOW, investmentPlan:newInvestmentPlan(NOW), scenarioSeed:20260908, seriesSeeds:{gold:313131,cp:323232,land:333333}, sellRule:'nearPeak', goldSpread:2,
  birthYear:1990, gender:'male', simYears:40, infl:5,
  /* M1 (11/09/2026) — gia đình nhiều người: người chính giữ hồ sơ Tab 1 (năm sinh/giới tính) +
     state.periods + state.pensionSimple; mỗi thành viên thêm là một phần tử extraPeople với
     hồ sơ BHXH riêng (name/birthYear/gender/periods/pension cùng hình dạng pensionSimple).
     Tab 4 có tab con chọn người; mô phỏng cộng hưu của MỌI người đúng thời điểm từng người nhận.
     activePerson: sub-tab đang mở (0 = người chính, i = extraPeople[i-1]); mainName = tên hiển thị
     của người chính (chỉ dùng nhãn). Pha thu nhập mở "đến nghỉ hưu" (toY=null) vẫn chạy đến hết
     tháng đủ tuổi của NGƯỜI CHÍNH — thu nhập riêng của người thêm nhập pha năm tường minh. */
  mainName:'', extraPeople:[], activePerson:0,
  /* Tab 2 — chỉ lương đóng BHXH; lương thực tế đã bỏ (tài sản hiện tại phản ánh tích luỹ quá khứ) */
  periods:[
    {from:'2013-01', to:'2020-06', type:'dn', bh:10000000, growth:5},
    {from:'2020-07', to:'2026-09', type:'nn', bh:9000000,  growth:3},
    {from:'2027-01', to:'',        type:'dn', bh:20000000, growth:6}
  ],
  /* Tab 5 — thu nhập thực nhận theo PHA (theo năm, chỉ tương lai). Tiền dư/thiếu do CHIẾN LƯỢC
     ĐẦU TƯ ở Tab 6 xử lý (đợt 14 đã xóa tỷ lệ phân bổ của từng pha). Mặc định KHÔNG có pha nào —
     mọi dòng thu nhập do người dùng tự nhập. */
  incomePeriods:[],
  milestones:[
    {y:0,  label:'Độc thân',   monthly:9000000},
    {y:10, label:'Lấy vợ',     monthly:15000000},
    {y:12, label:'Có con 1',   monthly:20000000},
    {y:17, label:'Có con 2',   monthly:25000000}
  ],
  /* Tab 4 — chi phí CỐ ĐỊNH không theo lạm phát (trả góp ngân hàng, phí bảo hiểm theo hợp đồng…):
     cùng shape milestones, mỗi mốc là TỔNG mức danh nghĩa đang áp dụng, thay thế mốc trước;
     không nhân lạm phát. Không bắt buộc mốc năm 0; muốn kết thúc khoản, thêm mốc mức 0 ở
     năm thứ SAU năm trả cuối (mốc có hiệu lực từ đầu năm thứ của nó). */
  fixedMilestones:[],
  events:[
    {y:20, kind:'thu', label:'Thừa kế',   amount:300000000},
    {y:32, kind:'chi', label:'Vốn con 1', amount:500000000},
    {y:37, kind:'chi', label:'Vốn con 2', amount:500000000}
  ],
  assets:{mmf:150000000, tk:50000000, tp:200000000, cp:300000000},
  goldChi:4, goldPrice:14000000,
  /* Bất động sản (v8 — mọi số theo GIÁ HIỆN TẠI tại tháng gốc): mỗi BĐS một khung gồm
     tên · năm sở hữu (null = đã có từ đầu kỳ — BĐS nhận sau chỉ vào NAV/thuê/bán từ năm đó) ·
     diện tích (tham khảo) · giá trị · Có thể bán (bán sớm khi cạn thanh khoản, thay cấu hình chung) ·
     cho thuê với giá thuê/tháng + tăng thuê %/năm (tính từ năm sở hữu) · năm bán + giá bán (trống =
     theo giá mô phỏng) · danh mục chi phí sửa chữa/duy tu/bảo trì/đầu tư thêm {năm, nội dung, số tiền}. */
  landPlots:[
    {id:'initial-property', label:'Đất vườn', ownYear:null, area:100, total:2500000000, sellable:true, saleYear:null, salePrice:null, rent:true, rentVnd:2000000, rentFromYear:null, rentGrowth:2, expenses:[]}
  ],
  rates:{mmf:4.5, tk:6.5, tp:6, tkShort:3, tkMedium:4.5, tpEarlyFee:2, tpMinMonths:12, cpBuyFee:0, cpSellFee:0},
  seriesMeta:{gold:{cagr:.07,sigma:.15},cp:{cagr:.09,sigma:.25},land:{cagr:.06,sigma:.12}},
  series:{gold:[], cp:[], land:[]},
  seriesV:3, /* giữ nguyên các chuỗi tháng đã lưu khi nâng cấp */
  /* Chế độ lương hưu: 'simple' = nhập trực tiếp (MẶC ĐỊNH — dòng tiền chính xác từ nguồn của người dùng);
     'estimate' = ước tính nhanh từ giai đoạn đóng theo luật — chỉ tham khảo */
  pensionMode:'simple',
  /* Lương hưu hai giai đoạn (BAN_GIAO_CPI_LUONG_HUU_2026-09-10.md): amount = đ/tháng theo SỨC MUA
     tại tháng gốc NOW — phần mềm nhân lạm phát (Tab 2) đến tháng bắt đầu hưởng, sau đó tăng growth
     mỗi đúng 12 tháng hưởng. amountSource: 'manual' người dùng nhập | 'fromPeriods' tự điền từ giai
     đoạn đóng (khi từ chối tự tính, mức cũ được giữ và coi như nhập tay). amountBasis: 'baseMonth'
     = giá hiện tại; 'unknown' = bản lưu cũ chưa rõ nghĩa — Tab 4 hỏi lại, không suy đoán. */
  pensionSimple:{ amount:0, startYear:2052, startMonth:1, growth:8, amountSource:'manual', amountBasis:'baseMonth' },
  pensionIdx:5.5, lumpsum:false,
  allocPolicy:{ lumpEnabled:false, lumpAlloc:{tk:30, tp:30, cp:30, gold:10, mmf:0} },
  /* Tab 8 — Tối ưu đóng BHXH: cấu hình what-if độc lập, KHÔNG đụng runSim (lãi tiết kiệm thay thế
     x%/năm, tăng lương hưu y%/năm, tuổi thọ, tỷ lệ nộp, mức đóng b + quy tắc tăng, bước quét, BHYT/tử
     tuất quy đổi). Giai đoạn đóng/giới tính/năm sinh/lạm phát luôn đọc động từ hồ sơ (Tab 3/1/4). */
  compareCfg:newCompareCfg()
};

state.lifePlan=newLifePlan(NOW);
state.lifePlanArchive=null;
var defaultState=JSON.parse(JSON.stringify(state));
