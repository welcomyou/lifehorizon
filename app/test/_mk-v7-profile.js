'use strict';
/* Tạo hồ sơ v7 (BĐS kiểu cũ: yield %/năm + landSellable chung + salePrice tuyệt đối) để nghiệm thu
   migration v8 trên trình duyệt. Ghi file trực tiếp vào thư mục hồ sơ THỬ của server 8301. */
const fs = require('node:fs');
const { context } = require('./harness');
const c = context();
const s = c.state;
s.lifePlan = c.newLifePlan(c.NOW);
c.ensureSeries();
const v7 = JSON.parse(JSON.stringify(s));
v7.schemaVersion = 7;
v7.landSellable = false;                                   // cấu hình "không bán sớm" cũ
v7.landPlots = [{
  id: 'old-yield-plot', label: 'Đất vườn cũ', area: 120, price: 20000000, total: 2400000000,
  priceMode: 'unit', saleYear: 2031, salePrice: 3200000000,           // 3,2 tỷ TẠI NĂM BÁN (nghĩa cũ)
  rent: true, rentMode: 'yield', rentYield: 6, rentGrowth: 2
}];
delete v7.landPlots[0].ownYear; delete v7.landPlots[0].sellable; delete v7.landPlots[0].expenses;
const profile = {
  format: 'lifesim-vn-profile', profileVersion: 1,
  id: 'p-test-migrate-v7', name: 'Hồ sơ v7 thử migration',
  description: 'BĐS yield %/năm + landSellable chung + salePrice tuyệt đối', createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z', revision: 1, appVersion: '1.0.0', modelVersion: 3,
  state: v7, viewState: { tab: 't2', cfYear: 2026 }, lastRiskRun: null
};
const dir = 'D:/App/dongtien/audit/2026-09-19-property-v8/profiles';
fs.writeFileSync(dir + '/p-test-migrate-v7.json', JSON.stringify(profile, null, 1));
console.log('OK wrote', dir + '/p-test-migrate-v7.json');
