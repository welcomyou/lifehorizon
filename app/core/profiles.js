'use strict';
/* [core/profiles.js] Định dạng file hồ sơ (profile) JSON — THUẦN, không DOM, không ghi state.
   ĐỌC: MODEL_VERSION (core/model.js). Trả về đối tượng profile mới; bản gốc không bị sửa.
   Profile = một bản chụp ĐẦY ĐỦ cấu hình: state toàn phần (kể cả chuỗi lợi suất từng tháng,
   seed, BHXH từng người) + trạng thái xem + kết quả kiểm tra rủi ro lần gần nhất.
   Quy ước: id là mã duy nhất vĩnh viễn (trùng tên file .json trong thư mục profiles), tên hiển thị
   đổi tự do không mất liên kết; revision tăng +1 mỗi lần lưu; file cũ nhập vào luôn tạo bản mới
   trừ khi người dùng chọn ghi đè. Chi tiết: AGENTS.md mục "Hồ sơ profile". */
var PROFILE_FORMAT = 'lifesim-vn-profile';
var PROFILE_VERSION = 1;

/* Tên file an toàn cho Windows từ tên hiển thị: bỏ dấu tiếng Việt, chỉ giữ chữ/số/-, giới hạn dài */
function profileSlug(name){
  var s = String(name == null ? '' : name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 32);
}
/* Mã profile mới = p-<slug>-<yyyymmdd>-<hhmm>-<hex> — vừa đọc được khi mở thư mục, vừa không trùng
   (đợt 12: thêm giờ:phút — tạo hai hồ sơ cùng tên trong cùng ngày cũng ra hai file khác nhau) */
function newProfileId(name){
  var d = new Date(), pad = function(n){ return (n < 10 ? '0' : '') + n; };
  var hex = Math.floor(Math.random() * 0xffff).toString(16);
  return 'p-' + (profileSlug(name) || 'ho-so') + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + '-' + (hex.length < 4 ? '0' + hex : hex);
}
function nowIso(){ return new Date().toISOString(); }

/* Dựng profile đầy đủ để lưu/xuất. base = profile đang mở (giữ id/createdAt) hoặc null.
   st = state hiện tại; viewState = {tab, cfYear}; riskRun = kết quả kiểm tra rủi ro gần nhất hoặc null.
   state được SAO CHÉP SÂU — giữ nguyên độ chính xác đầy đủ (không lấy số đã làm tròn để hiển thị). */
function buildProfile(base, name, description, st, viewState, riskRun, revision){
  var p = {
    format: PROFILE_FORMAT,
    profileVersion: PROFILE_VERSION,
    id: (base && base.id) || newProfileId(name),
    name: String(name == null ? '' : name).trim(),
    description: String(description == null ? '' : description),
    createdAt: (base && base.createdAt) || nowIso(),
    updatedAt: nowIso(),
    revision: revision != null ? revision : (((base && base.revision) || 0) + 1),
    appVersion: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1.1'),
    modelVersion: MODEL_VERSION,
    state: JSON.parse(JSON.stringify(st)),
    viewState: viewState ? JSON.parse(JSON.stringify(viewState)) : null,
    lastRiskRun: riskRun ? JSON.parse(JSON.stringify(riskRun)) : null
  };
  if(!p.name) p.name = 'Hồ sơ không tên';
  return p;
}

/* Kiểm tra cấu trúc profile (đã là object): đủ state, metadata hợp lệ. Trả về mảng lỗi tiếng Việt. */
function profileStructuralErrors(p){
  var errs = [];
  if(!p || typeof p !== 'object') return ['Nội dung không phải đối tượng JSON.'];
  if(p.format !== PROFILE_FORMAT) errs.push('Thiếu nhận dạng định dạng "' + PROFILE_FORMAT + '".');
  if(!Number.isInteger(p.profileVersion) || p.profileVersion < 1) errs.push('Thiếu phiên bản định dạng profile (profileVersion).');
  if(p.profileVersion > PROFILE_VERSION) errs.push('File tạo bằng định dạng mới hơn (profileVersion ' + p.profileVersion + ' > ' + PROFILE_VERSION + ') — cần nâng cấp phần mềm để mở.');
  if(!p.state || typeof p.state !== 'object' || Array.isArray(p.state)) errs.push('Thiếu khối "state" (toàn bộ cấu hình).');
  if(typeof p.id !== 'string' || !p.id) errs.push('Thiếu mã hồ sơ (id).');
  return errs;
}

/* Đọc text file JSON hồ sơ. Chấp nhận HAI dạng:
   1) profile đầy đủ (format = lifesim-vn-profile);
   2) bản "Sao lưu JSON" cũ — state trần (có schemaVersion) → bọc thành profile mới, id mới.
   Trả về {ok:true, profile, legacy:boolean} hoặc {ok:false, errors:[...]}.
   KHÔNG migrate state ở đây (migrateState chạy khi áp dụng vào ứng dụng — ui/profiles.js). */
function parseProfileText(text){
  var obj;
  try{ obj = JSON.parse(text); }
  catch(e){ return {ok:false, errors:['Không đọc được JSON: ' + e.message]}; }
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return {ok:false, errors:['Nội dung không phải đối tượng JSON.']};
  if(obj.format === PROFILE_FORMAT){
    var errs = profileStructuralErrors(obj);
    if(errs.length) return {ok:false, errors:errs};
    return {ok:true, legacy:false, profile:obj};
  }
  /* Bản lưu trần cũ: phải trông giống state (có schemaVersion hoặc các khối đặc trưng) */
  var looksLikeState = obj.schemaVersion !== undefined ||
    (obj.series && obj.seriesMeta && obj.assets && obj.pensionSimple);
  if(!looksLikeState) return {ok:false, errors:['File không phải hồ sơ của LifeHorizon (thiếu nhận dạng định dạng và không giống bản lưu cũ).']};
  var name = (typeof obj.mainName === 'string' && obj.mainName.trim()) ? obj.mainName.trim() : 'Hồ sơ nhập từ bản lưu cũ';
  var p = buildProfile(null, name, 'Nhập từ bản sao lưu JSON của trình duyệt.', obj, null, null, 1);
  return {ok:true, legacy:true, profile:p};
}
