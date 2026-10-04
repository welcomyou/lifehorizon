'use strict';
/* [ui/common.js] Tiện ích giao diện dùng chung: nhãn loại giai đoạn (TYPES), đọc tiền BA TẦNG
   (moneyParse → moneyEditValue → focusGood), định dạng số/tiền (fmt*), esc.
   KHÔNG có lệnh nào chạy lúc nạp (an toàn cho Node VM); mọi hàm chỉ đụng DOM khi được gọi. */
var TYPES = {
  dn:{label:'DN', color:'#2563eb'}, nn:{label:'NN/Sự nghiệp', color:'#059669'},
  tn:{label:'Tự nguyện', color:'#d97706'}, none:{label:'Nghỉ', color:'#94a3b8'}
};

function esc(s){return String(s===undefined?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

/* Hiển thị tháng ở dạng người Việt quen thuộc: 01/2027 (không dùng "January 2027" của input month) */
function ymToVN(s){ var p = String(s||'').split('-'); return p.length === 2 ? (('0'+p[1]).slice(-2)) + '/' + p[0] : (s||''); }
function vnToYM(s){ var i = parseYM(s); if(isNaN(i)) return null; return Math.floor(i/12) + '-' + (('0'+((i%12)+1)).slice(-2)); }

/* P1 (13/09/2026) — nhập nhanh mốc tháng: bộ parse MỀM dành cho ô nhập UI, thử parseYM chuẩn
   trước rồi các dạng gõ tắt. KHÔNG thay parseYM trong core (validation/golden phụ thuộc chữ ký
   nghiêm của nó). Chấp nhận thêm: "3/25"·"03-25" → 03/2025 (yy 00–69 = 20xx, 70–99 = 19xx);
   "3.2025"·"3-2025" (dấu ngăn cách bấm nhầm); một số đơn "3" → tháng 3 của NĂM GỢI Ý (hintYear —
   ô 'to' lấy năm của 'from', ô 'from' lấy năm kết thúc dòng kế trước, không có thì năm gốc NOW).
   Trả CHUỖI 'yyyy-mm' (cùng dạng vnToYM — state lưu chuỗi) hoặc NaN nếu không hiểu. */
function parseYMFlexible(s, hintYear){
  s = strTrim(s);
  var v = parseYM(s);
  if(!isNaN(v)) return vnToYM(s);
  var m = s.match(/^(\d{1,2})\s*[/.\-]\s*(\d{4})$/);            // 3.2025 · 03-2025
  if(m && +m[1] >= 1 && +m[1] <= 12) return (+m[2]) + '-' + (('0'+(+m[1])).slice(-2));
  m = s.match(/^(\d{1,2})\s*[/.\-]\s*(\d{2})$/);                // 3/25 · 03-25
  if(m && +m[1] >= 1 && +m[1] <= 12){
    var yy = +m[2];
    return (yy < 70 ? 2000+yy : 1900+yy) + '-' + (('0'+(+m[1])).slice(-2));
  }
  m = s.match(/^(\d{1,2})$/);                                   // "3" → tháng 3 năm gợi ý
  if(m && +m[1] >= 1 && +m[1] <= 12 && isFinite(hintYear))
    return hintYear + '-' + (('0'+(+m[1])).slice(-2));
  return NaN;
}

function fmtNumVN(x, dec){ /* 1234567.89 -> "1.234.567,9" (kiểu VN: ngàn = ".", thập phân = ",") */
  return (+x).toLocaleString('vi-VN', {minimumFractionDigits:dec, maximumFractionDigits:dec}); }
/* Đ7 (11/09) — mọi mốc hiển thị rút gọn LÀM TRÒN XUỐNG theo yêu cầu người dùng (7.154.000 đ → "7,1 trđ",
   không bao giờ hiển thị nhiều hơn số thật): bậc tỷ cắt tại 10 triệu, bậc trđ cắt tại 100 nghìn,
   dưới 1 triệu cắt tại đồng; số âm cắt về phía 0 để độ lớn không bị phóng đại. */
function floorTo(x, step){ return x >= 0 ? Math.floor(x/step)*step : Math.ceil(x/step)*step; }
function fmtTr(x){ if(!isFinite(x)) return '—';
  if(Math.abs(x) >= 1e9) return fmtNumVN(floorTo(x,1e7)/1e9, 2)+' tỷ đ';
  if(Math.abs(x) >= 1e6) return fmtNumVN(floorTo(x,1e5)/1e6, 1)+' trđ';
  return fmtNumVN(floorTo(x,1), 0)+' đ'; }
function fmtM1(x){ return fmtNumVN(x/1e6, 1); }
function fmtMoney(x){ return Math.round(+x||0).toLocaleString('vi-VN'); } /* 150000000 -> "150.000.000" */
/* F02 — tiền là đồng VND nguyên. Chuỗi có dấu âm, phần lẻ, ký hiệu khoa học, chữ hay quá 15 chữ số
   là KHÔNG hợp lệ: từ chối (NaN) thay vì âm thầm lọc ký tự rồi hiểu thành số khác.
   Chấp nhận: chữ số; chấm/phẩy làm dấu phân nhóm (nhóm đủ 3 chữ số); một dấu phân nhóm dư ở cuối khi đang gõ. */
function moneyParse(v){
  var s=String(v==null?'':v).replace(/\s/g,'');
  if(s==='')return 0;
  if(/[eE]/.test(s))return NaN;
  if(s.indexOf('-')>=0)return NaN;
  if(/[.,]\d{1,2}$/.test(s))return NaN;          // phần lẻ thập phân — không hỗ trợ đồng nguyên
  var t=s.replace(/[.,]$/,'');                   // dấu phân nhóm vừa gõ chưa có số theo sau
  if(!/^(\d{1,3}(?:[.,]\d{3})+|\d{1,15})$/.test(t))return NaN;
  var d=t.replace(/[.,]/g,'');
  if(d.length>15)return NaN;
  return +d;
}
function moneyErr(s){
  var t=String(s==null?'':s).replace(/\s/g,'');
  if(/\D/.test(t.replace(/[.,]/g,'')))return 'Ô tiền chỉ nhận chữ số — phần mềm tự thêm dấu chấm ngàn, không cần gõ.';
  if(/[eE]/.test(t))return 'Không hỗ trợ ký hiệu khoa học (ví dụ 1e6) — nhập số thường, ví dụ 1.000.000.';
  if(t.indexOf('-')>=0)return 'Ô tiền chỉ nhận số dương — không nhập dấu trừ.';
  if(/[.,]\d{1,2}$/.test(t))return 'Tiền tính theo đồng nguyên — bỏ phần lẻ sau dấu phẩy/chấm.';
  if(t.replace(/[.,]/g,'').length>15)return 'Quá 15 chữ số — kiểm tra lại số tiền.';
  return 'Giá trị tiền không hợp lệ.';
}
function setMoneyBad(el,why){
  if(!el||!el.classList)return;
  if(why){ if(!el.classList.contains('bad'))el.dataset.ot=el.getAttribute('title')||''; el.classList.add('bad'); el.setAttribute('title',why); }
  else if(el.classList.contains('bad')){ el.classList.remove('bad'); if(el.dataset.ot)el.setAttribute('title',el.dataset.ot); else el.removeAttribute('title'); delete el.dataset.ot; }
}
/* S04 (03/10/2026) — ô SỐ theo quy chuẩn VN: dấu . là nhóm ngàn, dấu , là thập phân.
   numParseVN đọc cả hai thói quen gõ: "6,5" và "6.5" đều = 6,5; "20.000.000" = 20 triệu;
   "2,000,000" = 2 triệu (kiểu EN, đủ nhóm 3 chữ số); nhận dấu -, +; sai cú pháp → NaN.
   numVal = numParseVN của el.value (ô class="num"); vnNumStr hiển thị ngược lại: , thập phân,
   . nhóm ngàn chỉ khi phần nguyên ≥ 10.000 để năm/tháng/tuổi không thành "2.052". */
function numParseVN(v){
  var s=String(v==null?'':v).replace(/\s/g,'');
  if(s==='')return 0;
  var neg=s.charAt(0)==='-';
  if(neg||s.charAt(0)==='+')s=s.slice(1);
  if(!/^[0-9.,]+$/.test(s))return NaN;
  if(s.indexOf(',')>=0){
    if(s.indexOf('.')<0&&/^\d{1,3}(,\d{3})+$/.test(s))s=s.replace(/,/g,'');
    else s=s.replace(/\./g,'').replace(/,/g,'.');
  }else if(s.indexOf('.')>=0){
    if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
    else if(!/^\d*\.\d*$/.test(s))return NaN;
  }
  if(!/^\d*\.?\d*$/.test(s)||s===''||s==='.')return NaN;
  var n=parseFloat(s);
  return isFinite(n)?(neg?-n:n):NaN;
}
function numVal(el){ return numParseVN(el&&el.value!==undefined?el.value:el); }
function vnNumStr(v){
  if(!isFinite(v))return '';
  var r=Math.round(v*1e6)/1e6, neg=r<0, a=String(Math.abs(r)), ip=a, dp='';
  var dot=a.indexOf('.');
  if(dot>=0){ ip=a.slice(0,dot); dp=a.slice(dot+1); }
  if(+ip>=10000)ip=fmtMoney(+ip);
  return (neg?'-':'')+(dp?ip+','+dp:ip);
}
/* Diễn giải chuỗi ĐANG BIÊN TẬP (dùng chung cho commit lẫn blur — S01): dãy số + dấu chấm được coi
   là "gõ dở một nhóm mới" (nhóm cuối ≥3 chữ số, nhóm giữa đủ 3, nhóm đầu 1–3) thì lấy nguyên dãy
   chữ số; dạng thập phân như '1.5' (nhóm cuối <3 chữ số) KHÔNG diễn giải — trả NaN. */
function moneyEditValue(raw){
  var t=String(raw==null?'':raw).replace(/\s/g,'');
  if(/^[0-9.]+$/.test(t) && t.indexOf('.') >= 0){
    var groups=t.split('.'), lastG=groups[groups.length-1];
    var midOk=groups.slice(1,-1).every(function(g){ return g.length===3; });
    if(groups[0].length>=1 && groups[0].length<=3 && midOk && lastG.length>=3){
      var d=t.replace(/\./g,'');
      if(d.length<=15) return +d;
    }
  }
  return NaN;
}
/* Đọc ô tiền (S01): strict-hợp lệ → đúng số đó; đang biên tập nhóm-dở → dãy chữ số (đồng bộ với blur);
   còn lại (chèn giữa tạo lai, thập phân, chữ…) → GIÁ TRỊ ĐẦU PHIÊN (focusGood) — không bao giờ dùng
   good trung gian có thể là diễn giải khác, cũng không rơi về NaN/0. */
function moneyVal(el){
  var v=moneyParse(el&&el.value);
  if(!isNaN(v)){ if(el&&el.dataset)el.dataset.good=String(v); return v; }
  var ev=moneyEditValue(el&&el.value);
  if(!isNaN(ev)){ if(el&&el.dataset)el.dataset.good=String(ev); return ev; }
  if(el&&el.dataset&&el.dataset.focusGood!==undefined)return +el.dataset.focusGood;
  if(el&&el.dataset&&el.dataset.good!==undefined)return +el.dataset.good;
  return 0;
}
function pct(x){ return (x*100).toFixed(1).replace('.',',')+'%'; }
function ageAt(idx){ return Math.floor(idx/12) - state.birthYear; }

/* ---- DOM & danh sách dùng chung (bổ sung B4 — chuyển từ inline script) ---- */
function $(id){ return document.getElementById(id); }
/* ================= Dialog thông báo của app — KHÔNG dùng alert/confirm mặc định trình duyệt =================
   appDialog({title, html, okText, cancelText}) → Promise: true = bấm OK/Enter · false = bấm Huỷ/Esc/bấm ngoài.
   Không truyền cancelText = dialog chỉ có 1 nút OK (dùng thay cho alert). */
function appDialog(opt){
  opt = opt || {};
  return new Promise(function(resolve){
    var mask = $('appModal'), tt = $('amTitle'), bb = $('amBody'), btns = $('amBtns');
    var box = mask.querySelector('.modal');
    if(box) box.classList.toggle('wide', !!opt.wide); // dialog rộng (Quản lý hồ sơ) — co theo màn hình, thân cuộn riêng
    if(box && opt.cls) box.classList.add(opt.cls);    // đợt 80 — class riêng cho popup (vd .lsum: cao giới hạn có cuộn)
    tt.textContent = opt.title || 'Thông báo';
    bb.innerHTML = opt.html || '';
    btns.innerHTML = '';
    function done(v){ mask.classList.remove('show'); if(box){ box.classList.remove('wide'); if(opt.cls) box.classList.remove(opt.cls); } document.removeEventListener('keydown', onKey, true); resolve(v); }
    function mk(txt, cls, val){
      var b = document.createElement('button'); b.className = cls; b.textContent = txt;
      b.onclick = function(){ done(val); }; btns.appendChild(b); return b;
    }
    if(opt.cancelText) mk(opt.cancelText, 'mcancel', false);
    var okB = mk(opt.okText || 'OK', 'mok', true);
    function onKey(e){
      if(e.key === 'Escape'){ e.preventDefault(); done(false); }
      else if(e.key === 'Enter'){ e.preventDefault(); done(true); }
    }
    mask.onclick = function(ev){ if(ev.target === mask) done(false); }; // bấm vùng nền mờ = huỷ
    mask.classList.add('show');
    try{ okB.focus(); }catch(e){}
    document.addEventListener('keydown', onKey, true);
  });
}
/* Refresh sau khi ô nhập đổi giá trị phải TRÌ HOÃN qua hết chuỗi sự kiện con trỏ:
   change phát sinh ngay khi ô nhập mất trọng tâm — tức tại mousedown trên nút ✕ kế bên.
   Nếu vẽ lại danh sách ngay lúc đó, nút vừa bấm bị thay bằng node mới và trình duyệt
   bỏ mất click → cảm giác "không xóa được dòng". Gộp nhiều change liên tiếp thành một lần vẽ. */
var refreshQueued=false;
function scheduleRefresh(){
  if(refreshQueued)return;
  refreshQueued=true;
  setTimeout(function(){ refreshQueued=false; refresh(); }, 0);
}
/* F07 — vẽ lại danh sách theo diff: HTML không đổi thì bỏ qua (giữ nguyên node → focus/selection
   không mất). Khi phải dựng lại: ghi nhớ ô đang focus theo định danh ổn định (data-f/data-k + data-i)
   rồi focus lại và trả caret về đúng vị trí sau khi vẽ. */
/* S02 — định danh đối tượng ổn định cho từng dòng danh sách: token cố định theo tham chiếu đối tượng
   (WeakMap), sống qua các lần sắp xếp lại mảng. Focus sau redraw khôi phục theo (token + trường),
   không theo data-i vốn đổi ý nghĩa khi state.events/milestones/incomePeriods bị sort. */
var objTokens=new WeakMap(), objTokenSeq=0;
function objToken(o){ var t=objTokens.get(o); if(!t){ t='o'+(++objTokenSeq); objTokens.set(o,t); } return t; }
function refreshList(boxId, html, wire){
  var box=$(boxId); if(!box)return;
  if(box.__html===html)return;
  var fr=null,a=document.activeElement;
  if(a&&box.contains(a)&&a.tagName!=='BODY'&&a.dataset&&(a.dataset.f||a.dataset.k||(a.classList&&a.classList.contains('del')))){
    var row=a.closest?a.closest('[data-o]'):null;
    fr={f:a.dataset.f||a.dataset.k||'', del:!!(a.classList&&a.classList.contains('del')), o:row?row.getAttribute('data-o'):null, selA:a.selectionStart, selB:a.selectionEnd, isSel:a.tagName==='SELECT'};
  }
  box.__html=html; box.innerHTML=html;
  if(wire)wire(box);
  seedMoneyGood(box);   /* R02 — ô tiền mới render luôn có giá trị tốt từ state */
  if(fr){
    var scope=fr.o?box.querySelector('[data-o="'+fr.o+'"]'):null, root=scope||box;
    var el=fr.del
      ? root.querySelector('.del')
      : (root.querySelector('[data-f="'+fr.f+'"]') || root.querySelector('[data-k="'+fr.f+'"]'));
    if(el&&el.focus){try{el.focus();if(!fr.isSel&&!fr.del&&fr.selA!==undefined&&el.setSelectionRange)el.setSelectionRange(fr.selA,fr.selB);}catch(e){}}
  }
}
/* Trước khi xóa dòng: blur ô đang focus TRONG danh sách để change commit vào đúng chỉ số còn hợp lệ
   — tránh sự kiện change phát trên node đã gỡ ghi giá trị vào dòng khác (chỉ số đã dịch). */
function blurActiveIn(box){
  var a=document.activeElement;
  if(a&&box.contains(a)&&a.blur){try{a.blur();}catch(e){}}
}
/* R03/R04 — nút ✕ kích hoạt theo DANH TÍNH đối tượng được đóng lại lúc gắn handler (act), không theo
   data-i có thể cũ sau khi một change sắp xếp lại danh sách (đổi năm rồi xóa không còn nhầm dòng khác).
   Hoạt động bằng: chuột trái qua pointerdown (redraw giữa mousedown/mouseup không nuốt được), bàn
   phím Enter/Space qua click tự nhiên của button; click phát ngay sau pointerdown do chính nút này
   gây ra bị delGuard chặn để không xóa hai lần; chuột phải/giữa không xóa (pointerdown lọc button 0,
   và trình duyệt không phát click cho chuột phải). */
var delGuard=0;
function bindDel(b, act){
  b.addEventListener('pointerdown', function(ev){
    if(ev.button !== 0) return;
    ev.preventDefault();
    delGuard = Date.now();
    act();
  });
  b.addEventListener('click', function(){ if(Date.now() - delGuard < 400) return; act(); });
}

/* R02 — gieo giá trị tốt ban đầu cho mọi ô tiền từ chính giá trị đã render (= state) */
function seedMoneyGood(root){
  var els = root && root.querySelectorAll ? root.querySelectorAll('input.money') : [];
  Array.prototype.forEach.call(els, function(el){
    if(el.dataset.good !== undefined) return;
    var v = moneyParse(el.value);
    if(!isNaN(v)) el.dataset.good = String(v);
  });
}
