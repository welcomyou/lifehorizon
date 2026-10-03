'use strict';
/* Golden run — vân tay số học của toàn bộ đường tính (bảo toàn hành vi khi tái cấu trúc).
   Cách dùng:
     node app/test/golden-run.js dump <file.json>     — ghi vân tay hiện tại
     node app/test/golden-run.js compare <file.json>  — so vân tay hiện tại với baseline
   Cấu hình + seed cố định → mọi số phải KHỚP TUYỆT ĐỐI trước/sau khi di chuyển/tách file.
   Không phụ thuộc harness slicing: chỉ dùng context() của harness — API này giữ nguyên qua các lần tách. */
const fs = require('node:fs');
const { context } = require('./harness');

function buildContext() {
  const c = context();
  c.setNow(2026 * 12 + 8); // T9/2026
  const s = c.state;
  s.lifePlan=null;s.schemaVersion=6;
  /* Đợt 14 — cách phân bổ cũ đã xóa: golden chạy đúng một chiến lược theo giai đoạn (bucket 24 tháng). */
  s.investmentPlan = { version: 1, stages: [{ id: 'golden-plan', label: 'Kế hoạch golden', from: 2026 * 12 + 8,
    method: 'bucket', reserveMonths: 24, emergencyMonths: 3, reviewMonths: 12, minMonths: 6, refillMonths: 12,
    refillRule: 'nonNegative12m', weights: { tk: 10, tp: 30, cp: 50, gold: 10 } }] };
  s.simYears = 12;
  s.infl = 5;
  s.birthYear = 1968;
  s.gender = 'male';
  s.mainName = 'Anh';
  s.periods = [
    { from: '1990-01', to: '2010-12', type: 'dn', bh: 5000000, growth: 4 },
    { from: '2011-01', to: '2026-09', type: 'nn', bh: 9000000, growth: 3 },
    { from: '2027-01', to: '', type: 'dn', bh: 20000000, growth: 6 },
  ];
  s.pensionSimple = { amount: 10500000, startYear: 2029, startMonth: 6, growth: 8, amountSource: 'manual', amountBasis: 'baseMonth' };
  s.extraPeople = [
    { id: 'p1', name: 'Vợ', birthYear: 1975, gender: 'female',
      periods: [{ from: '1995-01', to: '2024-12', type: 'dn', bh: 8000000, growth: 5 }],
      pension: { amount: 6000000, startYear: 2034, startMonth: 10, growth: 8, amountSource: 'manual', amountBasis: 'baseMonth' } },
    { id: 'p2', name: 'Em', birthYear: 1980, gender: 'female',
      periods: [{ from: '2002-01', to: '', type: 'dn', bh: 12000000, growth: 6 }],
      pension: { amount: 4000000, startYear: 2040, startMonth: 1, growth: 8, amountSource: 'fromPeriods', amountBasis: 'baseMonth' } },
  ];
  s.activePerson = 0;
  s.assets = { mmf: 400000000, tk: 250000000, tp: 300000000, cp: 500000000 };
  s.goldChi = 5;
  s.goldPrice = 14000000;
  s.goldSpread = 2.5;
  s.landPlots = [
    { id: 'land-a', label: 'Đất vườn', ownYear: null, area: 100, total: 2500000000, sellable: true, saleYear: 2032, salePrice: null, rent: true, rentVnd: 2083333, rentGrowth: 2, expenses: [{ y: 2029, label: 'Làm hàng rào', amount: 80000000 }] },
    { id: 'land-b', label: 'Nhà cho thuê', ownYear: 2030, area: 0, total: 3000000000, sellable: false, saleYear: null, salePrice: null, rent: true, rentVnd: 15000000, rentFromYear: 2033, rentGrowth: 3, expenses: [] },
  ];
  s.rates = { mmf: 4.5, tk: 6.5, tp: 6 };
  s.incomePeriods = [
    { fromY: 2026, toY: 2035, amount: 30000000, growth: 5 },
    // Đợt 11: bỏ followInfl — giai đoạn mở tăng theo % nhập (trước đây followInfl:true, growth 0 → tăng theo lạm phát).
    { fromY: 2038, toY: null, amount: 25000000, growth: 0 },
  ];
  s.milestones = [
    { y: 0, label: 'Hiện tại', monthly: 18000000 },
    { y: 6, label: 'Thêm con', monthly: 22000000 },
    { y: 10, label: 'Ít người', monthly: 20000000 },
  ];
  s.events = [
    { y: 3, kind: 'thu', label: 'Thừa kế', amount: 500000000 },
    { y: 8, kind: 'chi', label: 'Sửa nhà', amount: 300000000 },
    { y: 11, kind: 'chi', label: 'Tiền con', amount: 100000000 },
  ];
  s.sellRule = 'nearPeak';
  s.series = { gold: [], cp: [], land: [] };
  s.seriesMeta = { gold: { cagr: 0.07, sigma: 0.15 }, cp: { cagr: 0.09, sigma: 0.25 }, land: { cagr: 0.06, sigma: 0.12 } };
  return c;
}

function fingerprint() {
  const c = buildContext();
  const sim = c.runSim(true);
  const risk = c.riskCheck(20, true, 0); // Tái lập bộ đường baseline; UI luôn dùng seed ngẫu nhiên mới.
  return {
    months: sim.months,
    years: sim.years,
    totals: { shortfall: sim.shortfall, firstShort: sim.firstShort, pensionGot: sim.pensionGot, evIn: sim.evIn, evOut: sim.evOut, landSold: sim.landSold, initial: sim.initial, retireIdx: sim.retireIdx },
    bhxhMain: c.bhxhSummary(null),
    bhxhSpouse: c.bhxhSummary(c.state.extraPeople[0]),
    pensionProj: c.pensionProjection(c.state.pensionSimple),
    pensionProjSpouse: c.pensionProjection(c.state.extraPeople[1].pension),
    fromPeriodsSpouse: c.pensionFromPeriods(c.state.extraPeople[0]),
    validation: c.validateState(),
    risk: risk,
  };
}

function deepEqual(a, b, path, out) {
  if (typeof a === 'number' && typeof b === 'number') { if (a !== b) out.push(path + ': ' + a + ' != ' + b); return; }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { if (a !== b) out.push(path + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); return; }
  const ka = Object.keys(a), kb = Object.keys(b);
  for (const k of ka) if (!(k in b)) out.push(path + '.' + k + ': chỉ có ở baseline-mới (thiếu bên cũ)');
  for (const k of kb) if (!(k in a)) out.push(path + '.' + k + ': thiếu so baseline');
  for (const k of ka) if (k in b) deepEqual(a[k], b[k], path + '.' + k, out);
}

const [mode, file] = process.argv.slice(2);
if (mode === 'dump') {
  fs.writeFileSync(file, JSON.stringify(fingerprint(), null, 1));
  console.log('OK: đã ghi golden baseline → ' + file);
} else if (mode === 'compare') {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cur = fingerprint();
  const diffs = [];
  deepEqual(base, cur, '$', diffs);
  if (diffs.length) {
    console.log('KHÔNG KHỚP — ' + diffs.length + ' khác biệt (5 điểm đầu):');
    diffs.slice(0, 5).forEach(d => console.log('  ' + d));
    process.exit(1);
  }
  console.log('OK: khớp tuyệt đối với baseline ' + file);
} else {
  console.log('Dùng: node golden-run.js dump|compare <file.json>');
  process.exit(2);
}
