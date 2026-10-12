'use strict';
/* Test module hồ sơ (profile) — core/profiles.js thuần: build → parse vòng tròn, nhận diện bản lưu
   trần cũ, từ chối file hỏng, id duy nhất & an toàn tên file Windows, sao chép sâu giữ nguyên vẹn. */
const test = require('node:test');
const assert = require('node:assert');
const { context } = require('./harness');

function ctx() {
  const c = context();
  c.setNow(2026 * 12 + 8); // T9/2026
  return c;
}

test('profile: build → JSON → parse giữ nguyên id, tên, state từng điểm lợi suất', () => {
  const c = ctx();
  const s = c.state;
  s.mainName = 'Anh';
  s.seriesMeta.gold.cagr = 0.0712345678;
  s.series = { gold: Array.from({length: 24}, (_, i) => (i % 5) * 0.001), cp: Array.from({length: 24}, (_, i) => 0.002 * (i % 3)), land: Array.from({length: 24}, () => 0.004) };
  const p = c.buildProfile(null, 'Hồ sơ thử', 'ghi chú', s, { tab: 't6', cfYear: '2031' }, null, 3);
  assert.equal(p.format, 'lifesim-vn-profile');
  assert.equal(p.revision, 3);
  assert.equal(p.modelVersion, c.MODEL_VERSION);
  const back = c.parseProfileText(JSON.stringify(p));
  assert.ok(back.ok, 'parse phải OK: ' + JSON.stringify(back.errors || null));
  assert.equal(back.legacy, false);
  assert.equal(back.profile.id, p.id);
  assert.equal(back.profile.name, 'Hồ sơ thử');
  assert.equal(back.profile.revision, 3);
  assert.deepEqual(back.profile.state, s);
  assert.deepEqual(back.profile.viewState, { tab: 't6', cfYear: '2031' });
});

test('profile: nhận diện bản "Sao lưu JSON" trần của trình duyệt (chưa có format)', () => {
  const c = ctx();
  const s = JSON.parse(JSON.stringify(c.defaultState));
  s.mainName = 'Bản cũ';
  const back = c.parseProfileText(JSON.stringify(s));
  assert.ok(back.ok);
  assert.equal(back.legacy, true);
  assert.equal(back.profile.name, 'Bản cũ');
  assert.equal(back.profile.format, 'lifesim-vn-profile');
  assert.ok(back.profile.id.length > 4);
});

test('profile: từ chối JSON hỏng / đối tượng lạ, nêu lỗi tiếng Việt', () => {
  const c = ctx();
  const bad1 = c.parseProfileText('{không phải json');
  assert.equal(bad1.ok, false);
  assert.ok(bad1.errors.length && /JSON/.test(bad1.errors[0]));
  const bad2 = c.parseProfileText(JSON.stringify({ foo: 1 }));
  assert.equal(bad2.ok, false);
  const bad3 = c.parseProfileText(JSON.stringify({ format: 'lifesim-vn-profile', profileVersion: 1, id: 'x' }));
  assert.equal(bad3.ok, false);
  assert.ok(bad3.errors.some(e => /state/.test(e)));
});

test('profile: chặn định dạng mới hơn, thiếu id', () => {
  const c = ctx();
  const p = c.buildProfile(null, 'A', '', c.state, null, null, 1);
  p.profileVersion = c.PROFILE_VERSION + 1;
  const back = c.parseProfileText(JSON.stringify(p));
  assert.equal(back.ok, false);
  assert.ok(back.errors.some(e => /mới hơn/.test(e)));
  const p2 = c.buildProfile(null, 'B', '', c.state, null, null, 1);
  delete p2.id;
  assert.equal(c.parseProfileText(JSON.stringify(p2)).ok, false);
});

test('profile: id mới duy nhất, an toàn tên file Windows; slug bỏ dấu tiếng Việt', () => {
  const c = ctx();
  const a = c.newProfileId('Hồ sơ của Tôi');
  const b = c.newProfileId('Hồ sơ của Tôi');
  assert.notEqual(a, b);
  assert.match(a, /^p-ho-so-cua-toi-\d{8}-\d{4}-[0-9a-f]{2,4}$/);
  assert.match(a, /^[A-Za-z0-9][A-Za-z0-9 .()\-]*$/);
  assert.equal(c.profileSlug('Đặng Văn Đủ').includes('d'), true);
  assert.equal(c.profileSlug('***'), '');
});

test('profile: Lưu thành bản mới phải sinh id MỚI kể cả khi base là hồ sơ đang mở (đợt 12)', () => {
  const c = ctx();
  const first = c.buildProfile(null, 'Giai đoạn A', '', c.state, null, null, 1);
  // lỗi cũ: truyền base (hồ sơ đang mở) khi "Lưu thành bản mới" → giữ nguyên id → trùng file
  const sameId = c.buildProfile(first, 'Giai đoạn A', '', c.state, null, null, 1);
  assert.equal(sameId.id, first.id);
  const fresh = c.buildProfile(null, 'Giai đoạn A', '', c.state, null, null, 1);
  assert.notEqual(fresh.id, first.id);
  assert.equal(fresh.revision, 1);
});

test('profile: buildProfile sao chép sâu — sửa state sau khi dựng không đổi hồ sơ', () => {
  const c = ctx();
  const mmfBefore = c.state.assets.mmf;
  const msBefore = c.state.milestones.length;
  const p = c.buildProfile(null, 'X', '', c.state, null, null, 1);
  c.state.assets.mmf = 1;
  c.state.milestones.push({ y: 99, monthly: 1 });
  assert.equal(p.state.assets.mmf, mmfBefore);
  assert.equal(p.state.milestones.length, msBefore);
});

test('profile: không truyền revision thì tự tăng từ base; cấu trúc check bắt thiếu trường', () => {
  const c = ctx();
  const p1 = c.buildProfile(null, 'A', '', c.state, null, null, 1);
  const p2 = c.buildProfile(p1, 'A', '', c.state, null, null);
  assert.equal(p2.revision, 2);
  assert.equal(p2.id, p1.id, 'base truyền vào thì giữ nguyên id');
  const errs = c.profileStructuralErrors({});
  assert.equal(errs.length, 4);
  assert.ok(errs.every(e => typeof e === 'string'));
});

/* Đợt 89 — stateSig (ui/common.js): chữ ký dirty loại trường thuần-xem. Bấm chuyển tab con
   người (activePerson) ở Tab 3 không được tính là "thay đổi chưa lưu"; đổi dữ liệu thật thì có. */
test('profile: stateSig bỏ activePerson — đổi tab con người không phải thay đổi dữ liệu', () => {
  const c = ctx();
  const s = c.state;
  s.activePerson = 0;
  const base = c.stateSig(s);
  s.activePerson = 1;
  assert.equal(c.stateSig(s), base, 'đổi người đang mở không đổi chữ ký');
  s.activePerson = 0;
  assert.equal(c.stateSig(s), base);
  assert.notEqual(JSON.stringify(s), base, 'state stringify đầy đủ vẫn khác — stateSig là bản bỏ trường xem');
});

test('profile: stateSig vẫn nhạy với dữ liệu thật và khớp giữa hai bản sao từ JSON', () => {
  const c = ctx();
  const s = c.state;
  s.activePerson = 2;
  const a = c.stateSig(s);
  s.assets.mmf = 999e6;
  assert.notEqual(c.stateSig(s), a, 'sửa tài sản phải đổi chữ ký');
  // hai đối tượng tách dòng (file JSON.parse vs state đang chạy) cùng dữ liệu → cùng chữ ký
  const roundTrip = JSON.parse(JSON.stringify(s));
  assert.equal(c.stateSig(roundTrip), c.stateSig(s));
});

/* Đợt 98 — kết quả Kiểm tra rủi ro của engine cũ phải hết hiệu lực qua cơ chế có sẵn:
   v14 (đợt 96, bản stripPlotForecast lỗi) lưu strategyVersion=14; nâng engine lên 15 thì
   prRiskRunUsable phải từ chối kết quả cũ và chấp nhận kết quả của phiên bản hiện hành. */
test('profile: kết quả rủi ro của engine cũ bị đánh dấu cũ, bản hiện hành được chấp nhận', () => {
  const fs2 = require('node:fs'), path2 = require('node:path'), vm2 = require('node:vm');
  const c = ctx();
  const elements = new Map();
  c.document = { getElementById(id){ if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:''}); return elements.get(id); } };
  vm2.runInContext(fs2.readFileSync(path2.join(__dirname,'../ui/profiles.js'),'utf8'), c);
  c.stateSignature = 'sig-demo';
  // Kết quả lưu từ v14 (bản lỗi đợt 96) — phải bị từ chối dù sig khớp
  c.prRiskRun = { at:'2026-10-12T00:00:00Z', modelVersion:c.MODEL_VERSION, strategyVersion:14, sig:c.prSigHash('sig-demo') };
  assert.equal(c.prRiskRunUsable(), null, 'kết quả v14 phải hết hiệu lực');
  // Kết quả của engine hiện hành, sig khớp → được chấp nhận
  c.prRiskRun = { at:'2026-10-12T00:00:00Z', modelVersion:c.MODEL_VERSION, strategyVersion:c.STRATEGY_ENGINE_VERSION, sig:c.prSigHash('sig-demo') };
  assert.equal(c.prRiskRunUsable(), c.prRiskRun);
  // Cùng phiên bản nhưng state đã đổi (sig lệch) → vẫn bị từ chối
  c.prRiskRun = { at:'2026-10-12T00:00:00Z', modelVersion:c.MODEL_VERSION, strategyVersion:c.STRATEGY_ENGINE_VERSION, sig:'khac' };
  assert.equal(c.prRiskRunUsable(), null);
  // Kết quả v14 hiển thị kèm cảnh báo "nên chạy lại"; kết quả phiên bản hiện hành thì không
  const run14 = { at:'2026-10-12T00:00:00Z', modelVersion:c.MODEL_VERSION, strategyVersion:14, sig:c.prSigHash('sig-demo'), n:20, p10:1, p50:2, p90:3, runOutRate:0 };
  c.prRiskRun = run14;
  c.prRenderRiskOut();
  assert.ok(elements.get('riskOut').innerHTML.includes('nên chạy lại'), 'kết quả v14 phải kèm cảnh báo chạy lại');
  c.prRiskRun = Object.assign({}, run14, { strategyVersion:c.STRATEGY_ENGINE_VERSION });
  c.prRenderRiskOut();
  assert.ok(!elements.get('riskOut').innerHTML.includes('nên chạy lại'), 'kết quả phiên bản hiện hành không cảnh báo');
});
