'use strict';
/* Nạp ứng dụng vào Node VM THEO DANH SÁCH FILE (thứ tự = đúng thứ tự thẻ <script> trong index.html).
   Không còn trích inline script theo marker chuỗi. API giữ nguyên cho test: context, fresh, plot, html.
   Chỉ nạp các file không chạy lệnh nào lúc tải (core/state/ui common) — phần render/sự kiện cần DOM,
   sống trong ui/*.js và không thuộc phạm vi hồi quy Node. */
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..'), html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const files=['core/model.js','core/pension.js','core/compare.js','core/simulation.js','core/strategy.js','core/series.js','core/profiles.js','state/defaults.js','state/persist.js','ui/common.js'];
function context(){
  const c=vm.createContext({console});
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c,{filename:file});
  return c;
}
function fresh(years=2){
  const c=context(),s=c.state;s.lifePlan=null;s.schemaVersion=6;c.setNow(2026*12);
  /* Đợt 14 — chỉ còn chiến lược theo giai đoạn. fresh() dùng bucket dự phòng 12 tháng, tỷ trọng
     trái phiếu 100%: tháng thiếu chi vẫn rút theo thứ tự TK → TP → vàng/CP như bộ test cũ kỳ vọng;
     test muốn tiền dư đi đâu khác thì tự đặt weights qua invest(). */
  const plan=c.newInvestmentPlan(c.NOW);
  Object.assign(plan.stages[0],{method:'bucket',reserveMonths:12,emergencyMonths:0,minMonths:6,refillMonths:12,
    weights:{tk:0,tp:100,cp:0,gold:0}});
  Object.assign(s,{simYears:years,investmentPlan:plan,periods:[],incomePeriods:[],events:[],infl:0,
    assets:{mmf:0,tk:0,tp:0,cp:0},goldChi:0,goldPrice:1e7,goldSpread:0,landPlots:[],
    rates:{mmf:0,tk:0,tp:0,tkShort:0,tkMedium:0},milestones:[{y:0,monthly:0}],
    pensionSimple:{amount:0,startYear:2100,startMonth:1,growth:0},series:{gold:Array(years*12).fill(0),cp:Array(years*12).fill(0),land:Array(years*12).fill(0)}});
  return c;
}
function plot(extra={}){return Object.assign({id:'test-property',label:'BĐS',ownYear:null,area:100,total:1e9,sellable:true,saleYear:null,salePrice:null,rent:false,rentVnd:0,rentFromYear:null,rentGrowth:0,expenses:[]},extra);}
module.exports={context,fresh,plot,html,files,root};
