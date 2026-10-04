const test=require('node:test'),assert=require('node:assert/strict');
const {context,fresh}=require('./harness');
function near(a,b,t=.001){assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);}

/* Tab 8 — core/compare.js: phép so cận biên phần đóng thêm sau mốc chung (kế hoạch
   docs/plan-tab8-bhxh-vs-dautu.md). fresh() neo NOW=2026*12 (T1/2026), infl=0. */
function cmpPerson(birthYear,gender,periods){ return {name:'test',birthYear,gender,periods,pension:{amount:0,startYear:2052,startMonth:1,growth:8,amountSource:'manual',amountBasis:'baseMonth'}}; }

test('compare: lịch hỗn hợp Nhà nước trước 2016 và tự nguyện điều chỉnh theo đúng chế độ từng tháng',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1980;s.gender='female';s.infl=5;
  s.periods=[
    {from:'2010-01',to:'2019-12',type:'nn',bh:5e6,growth:0},
    {from:'2020-01',to:'2025-12',type:'tn',bh:8e6,growth:0}
  ];
  const recs=c.compareRecs(null,s.infl).recs;
  const sum=c.bhxhSummary();
  near(recs.reduce((a,r)=>a+r.adj,0)/recs.length,sum.avg,1);
});

test('compare: engine khớp công thức luật bhxhSummary cho ứng viên đóng thêm (bình quân + tỷ lệ + sàn)',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2015-01',to:'',type:'dn',bh:10e6,growth:0}];
  /* NOW=T1/2026: đã đóng 132 tháng → phần chung = 180 tháng đầu (2015-01..2029-12), M0=2030-01. */
  const cfg={xSave:5,yPension:6,lifeAge:85,contribRate:22,bStart:10e6,bGrow:'flat',bStep:5e6,maxAge:100,_probe:{b:10e6,n:24}};
  const r=c.compareOptimize(cfg);
  assert.equal(r.ok,true);
  assert.equal(r.M0,2030*12);
  assert.equal(r.nMax,2047*12-2030*12+1);          /* retIdx nam 1985 = T1/2047 */
  /* Đối chứng độc lập: bhxhSummary trên person periods = phần chung cắt 2029-12 + dòng tn 24 tháng. */
  const sum=c.bhxhSummary(cmpPerson(1985,'male',[
    {from:'2015-01',to:'2029-12',type:'dn',bh:10e6,growth:0},
    {from:'2030-01',to:'2031-12',type:'tn',bh:10e6,growth:0}]));
  assert.equal(r.probe.months,sum.months);
  near(r.probe.avg,sum.avg);
  assert.equal(r.probe.rate,sum.rate);
  near(r.probe.pension,sum.pension);
  /* Baseline (n=0) cũng phải khớp bhxhSummary của lịch cắt tại mốc chung. */
  const sum0=c.bhxhSummary(cmpPerson(1985,'male',[{from:'2015-01',to:'2029-12',type:'dn',bh:10e6,growth:0}]));
  near(r.pension0,sum0.pension);
  near(r.avg0,sum0.avg);
});

test('compare: lãi cao + sống không lâu → dừng ở mốc chung; lãi thấp + sống lâu → đóng thêm thắng',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2015-01',to:'',type:'dn',bh:10e6,growth:0}];
  /* Chú ý bậc thang luật: sống 80 vẫn có thể "1 tháng đóng sàn +0,5 điểm tỷ lệ" lãi nhẹ — lấy 72
     cho sạch (kỳ hưởng ngắn, FV Δ hưu không vượt tiền nộp ở MỌI (b,n)). */
  const lo=c.compareOptimize({xSave:12,yPension:0,lifeAge:72,contribRate:22,bStart:10e6,bGrow:'flat',bStep:5e6,maxAge:100});
  assert.equal(lo.best.n,0);assert.equal(lo.best.D,0);   /* không ứng viên nào D>0 → khuyến nghị dừng */
  const hi=c.compareOptimize({xSave:2,yPension:12,lifeAge:95,contribRate:22,bStart:10e6,bGrow:'flat',bStep:5e6,maxAge:100});
  assert.ok(hi.best.n>=1);assert.ok(hi.best.D>0);
  assert.ok(hi.top5.length>=2&&hi.top5[0].D>=hi.top5[1].D);
  assert.ok(hi.crossover!==null);                        /* có tuổi hòa vốn */
  const dAt=(r,u)=>r.dSeries.arr[u-r.dSeries.from];
  assert.ok(dAt(hi,hi.crossover)>0);
  assert.ok(dAt(hi,hi.crossover-1)<=0);
});

test('compare: mức đóng thấp sau lịch sử cao làm bình quân GIẢM (không giả định đóng thêm luôn tăng hưu)',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2005-01',to:'',type:'dn',bh:30e6,growth:0}];   /* đã đóng 252 tháng trước NOW → common=252 */
  const r=c.compareOptimize({xSave:5,yPension:6,lifeAge:85,contribRate:22,bStart:1.5e6,bGrow:'flat',bStep:5e6,maxAge:100,_probe:{b:1.5e6,n:12}});
  assert.equal(r.M0,2026*12);
  assert.ok(r.probe.avg<r.avg0);      /* sàn tự nguyện 1,5tr kéo bình quân đã điều chỉnh xuống */
  assert.ok(r.probe.dP<0);            /* lương hưu tháng đầu GIẢM so với dừng tại mốc chung */
});

test('compare: trần tỷ lệ 75% và trợ cấp một lần 0,5 tháng bình quân/năm vượt',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1975;s.gender='male';   /* retIdx T1/2037; nMax=133 tháng tự nguyện */
  s.periods=[{from:'2000-01',to:'',type:'dn',bh:20e6,growth:0}];   /* đã đóng 312 tháng → common=312 */
  const r=c.compareOptimize({xSave:5,yPension:6,lifeAge:85,contribRate:22,bStart:20e6,bGrow:'flat',bStep:5e6,maxAge:100,_probe:{b:20e6,n:133}});
  assert.equal(r.probe.rate,75);                       /* 445 tháng → 37,5 năm tính hưởng, chạm trần */
  assert.equal(r.probe.over,2);                        /* floor(445/12)−35 = 2 năm vượt */
  near(r.probe.TC,r.probe.avg*0.5*2);                  /* trợ cấp = 0,5 tháng bq × số năm vượt */
  const sum=c.bhxhSummary(cmpPerson(1975,'male',[
    {from:'2000-01',to:'2025-12',type:'dn',bh:20e6,growth:0},
    {from:'2026-01',to:'2037-01',type:'tn',bh:20e6,growth:0}]));
  assert.equal(r.probe.months,sum.months);near(r.probe.pension,sum.pension);
});

test('compare: sàn mức tham chiếu kẹp cả hai phương án → Δ lương hưu = 0, đóng thêm chỉ tốn tiền',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1980;s.gender='male';
  s.periods=[{from:'2005-01',to:'2024-12',type:'dn',bh:1e6,growth:0}];  /* 240 tháng bắt buộc, lương rất thấp */
  const r=c.compareOptimize({xSave:5,yPension:6,lifeAge:85,contribRate:22,bStart:20e6,bGrow:'flat',bStep:5e6,maxAge:100,_probe:{b:20e6,n:12}});
  assert.equal(r.floorOK,true);                        /* đủ 20 năm bắt buộc + tham gia trước 01/7/2025 */
  assert.ok(r.pension0>0);
  assert.equal(r.probe.pension,r.pension0);            /* vẫn dưới sàn → mức hưu không đổi */
  assert.equal(r.probe.dP,0);
  assert.ok(r.probe.D<0);                              /* chỉ mất tiền gửi thay thế */
});

test('compare: x=0, y=0 — D kiểm tay = ΔP×số tháng hưởng − tổng tiền nộp',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';   /* hưu T1/2047 */
  s.periods=[{from:'2015-01',to:'',type:'dn',bh:10e6,growth:0}];
  const r=c.compareOptimize({xSave:0,yPension:0,lifeAge:75,contribRate:22,bStart:10e6,bGrow:'flat',bStep:5e6,maxAge:100,_probe:{b:10e6,n:24}});
  const B=2047*12,L=1985*12+75*12;
  const monthsGet=L-B+1;                               /* 157 tháng hưởng tới hết tháng sinh nhật 75 */
  near(r.probe.D,r.probe.dP*monthsGet-24*0.22*10e6,1); /* x=0 → không lãi hai vế; y=0 → ΔP hằng tháng */
});

test('compare: BHYT quy đổi + tử tuất thuộc VẾ ĐÓNG THÊM (mốc dừng là nền 0)',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2015-01',to:'',type:'dn',bh:10e6,growth:0}];
  const x=6,b=10e6;
  const base={xSave:x,yPension:6,lifeAge:85,contribRate:22,bStart:b,bGrow:'flat',bStep:5e6,maxAge:100,_probe:{b:b,n:24}};
  const r0=c.compareOptimize(Object.assign({byht:0,tutuat:0},base));
  const r1=c.compareOptimize(Object.assign({byht:12e6,tutuat:0},base));
  const r2=c.compareOptimize(Object.assign({byht:12e6,tutuat:5e6},base));
  const L=1985*12+85*12,M0=2030*12;
  let byhtSum=0;for(let t=M0;t<=L;t++)byhtSum+=1e6*Math.pow(1+x/100,(L-t)/12);  /* 12tr/năm = 1tr/tháng */
  near(r1.probe.D-r0.probe.D,byhtSum,1);
  near(r2.probe.D-r1.probe.D,5e6,1);                   /* tử tuất một lần tại tuổi đang xét, không lãi hóa */
});

test('compare: lịch chưa đủ 180 tháng / hết tháng tự nguyện → báo lỗi, không tự bịa',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';s.periods=[];
  assert.equal(c.compareOptimize({}).error,'not180');
  s.periods=[{from:'2015-01',to:'2020-12',type:'dn',bh:10e6,growth:0}];  /* 72 tháng, không dòng tương lai */
  assert.equal(c.compareOptimize({}).error,'not180');
  /* Đã đóng đến hết tháng đủ tuổi (nghỉ hưu trước NOW) → không còn tháng tự nguyện nào. */
  s.birthYear=1964;s.gender='male';                    /* retIdx T4/2025 < NOW T1/2026 */
  s.periods=[{from:'1990-01',to:'',type:'dn',bh:10e6,growth:0}];
  assert.equal(c.compareOptimize({}).error,'noRoom');
});

test('compare: bảng theo tuổi thọ — D của từng mốc là D TẠI CHÍNH mốc đó (không nhiễm D của tuổi L)',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2015-01',to:'',type:'dn',bh:10e6,growth:0}];
  const r=c.compareOptimize({xSave:2,yPension:12,lifeAge:85,contribRate:22,bStart:10e6,bGrow:'flat',bStep:5e6,maxAge:100});
  const dAt=u=>r.dSeries.arr[u-r.dSeries.from];
  /* Mọi mốc tuổi: nếu tối ưu tại đó trùng phương án tối ưu toàn cục thì D phải bằng chuỗi D(u) —
     hồi quy bug Object.assign({D:D},cand) để cand.D của mốc L đè D của mốc sau (90/95/100 bằng nhau). */
  r.ages.forEach(function(a){
    if(a.best && a.best.b===r.best.b && a.best.n===r.best.n)
      near(a.best.D,dAt(a.u),1);
    if(a.best) assert.ok(isFinite(a.best.D));
  });
  const a90=r.ages.filter(function(a){return a.age===90;})[0],a95=r.ages.filter(function(a){return a.age===95;})[0];
  assert.ok(a90.best.D>0&&a95.best.D>a90.best.D);   /* sống lâu hơn → cùng hướng thắng mạnh hơn */
});

test('compare: lưới năm×lãi×lạm phát×tăng hưu — mỗi tuổi có khoảng thắng theo từng tháng, phần chưa đủ 180 không bị kết luận sai',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2015-01',to:'2025-12',type:'dn',bh:10e6,growth:0}];
  const inflOld=s.infl;
  const t0=Date.now();
  const r=c.compareYearsScan({bStart:10e6,bGrow:'flat',contribRate:22,maxAge:100},null);
  const ms=Date.now()-t0;
  assert.equal(r.ok,true);
  assert.ok(ms<10000,'lưới quá chậm: '+ms+'ms');
  assert.equal(s.infl,inflOld);                                  // không rò state sau khi ghi đè lạm phát quét
  assert.equal(r.combos,21*17*21);
  assert.equal(r.B,r.retireIdx+1);                         // hưởng từ tháng sau tháng đủ tuổi
  /* NOW=T1/2026: lịch mới có 132 tháng (2015-01..2025-12) — N=0 chưa đủ điều kiện hưởng hưu. */
  assert.equal(r.monthsPast,132);
  assert.equal(r.monthsCommon,132);
  assert.equal(r.M0,2026*12);
  assert.equal(r.rows[0].N,0);assert.equal(r.rows[0].someRanges.length,0);
  assert.equal(r.rows[3].someRanges.length,0);            // 168 tháng: chưa có hưu tháng; quyền lợi khác chưa mô hình
  /* N=4 → 180 tháng: vừa đủ điều kiện lương hưu — với lãi 4–9% vẫn phải CÓ tổ hợp thắng khi sống lâu. */
  const r4=r.rows[4];assert.equal(r4.months,180);
  assert.ok(r4.someRanges.length>0);
  assert.ok(r4.someRanges.every(z=>z.from<=z.to&&z.from>=r.B&&z.to<=r.U));
  assert.ok(r4.allRanges.every(z=>r4.someRanges.some(w=>w.from<=z.from&&w.to>=z.to)));
  /* Mức đóng lớn: dữ liệu khoảng tuổi và số tổ hợp có lúc thắng đều được trả. */
  const big=c.compareYearsScan({bStart:50e6,bGrow:'flat',contribRate:22,maxAge:100},null);
  const b15=big.rows[15];
  assert.ok(typeof b15.scenariosWithWin==='number'&&b15.scenariosWithWin>=0&&b15.scenariosWithWin<=big.combos);
  assert.ok(b15.someRanges.length>0);
});

test('compare: lịch Test đủ 180 tháng — N=0 vẫn so toàn bộ BHXH với gửi tiết kiệm từ T1/2020',()=>{
  const c=fresh(2); c.setNow(2026*12+8); // hồ sơ neo ở T9/2026
  const person=cmpPerson(1998,'male',[{from:'2020-01',to:'2034-12',type:'tn',bh:10e6,growth:0}]);
  const r=c.compareYearsScan({bStart:10e6,bGrow:'flat',xMin:7,xMax:7,iMin:4,iMax:4,yMin:7,yMax:7},person);
  assert.equal(r.ok,true);
  assert.equal(r.monthsPast,80);             // T1/2020–T8/2026
  assert.equal(r.monthsCommon,180);          // cả lịch T1/2020–T12/2034
  assert.equal(r.M0,2035*12);               // chỉ từ T1/2035 mới xét N năm đóng thêm
  assert.equal(r.rows[0].months,180);
  assert.equal(r.rows[1].months,192);
  assert.ok(r.rows[0].thresholdRanges.length>0); // 180 khoản gửi vẫn có thể cạn khi rút toàn bộ hưu
  assert.equal(r.rows[0].thresholdRanges[0].from,24995); // T12/2082: không được tính lãi lần hai cho 180 khoản gửi
  assert.equal(r.rows[0].peakCount,1);            // đúng một tổ hợp x=7, i=4, y=7
});

test('compare: sổ hưu chi đúng bằng lương hưu — LÃI DƯ Ở LẠI SỔ tái đầu tư (đối chiếu công thức đóng)',()=>{
  /* Một tổ hợp duy nhất x=3%, lạm phát 4%, hưu KHÔNG tăng (y=0) → quỹ đạo sổ có nghiệm đóng
     b_k = (b0 − P/(m−1))·m^k + P/(m−1), m=(1+x)^(1/12). Engine phải cạn đúng tháng này: nếu bỏ mất
     phần lãi dư (không tái đầu tư), sổ cạn sớm hơn. */
  const c=fresh(2),s=c.state;c.setNow(2026*12+8);   // T9/2026 như hồ sơ chính
  s.birthYear=1998;s.gender='male';s.infl=4;
  s.periods=[{from:'2020-01',to:'2034-12',type:'tn',bh:10e6,growth:0}];
  const person=cmpPerson(1998,'male',s.periods);
  const r=c.compareYearsScan({bStart:10e6,bGrow:'flat',xMin:3,xMax:3,iMin:4,iMax:4,yMin:0,yMax:0},person);
  assert.equal(r.ok,true);
  const B=r.B, recs=c.compareRecs(person,4).recs, m=Math.pow(1.03,1/12);
  let b0=0; recs.forEach(x=>{ b0+=0.22*x.b*Math.pow(m,B-1-x.m); });        // FV 180 khoản tới B−1
  const enjoyY=Math.floor(B/12);
  let othSum=0; recs.forEach(x=>{ othSum+=x.b*c.adjCoef(Math.floor(x.m/12),enjoyY,4); });
  const P=c.pensionRate(c.benefitYears(180),'male')/100*(othSum/180);      // lịch chung 180<240 tháng tn → không sàn
  const bStar=P/(m-1);
  assert.ok(b0<bStar,'ca thử phải có điểm cạn để đối chiếu được');
  const k0=Math.log(bStar/(bStar-b0))/Math.log(m);
  assert.ok(r.rows[0].thresholdRanges.length>0);
  assert.equal(r.rows[0].thresholdRanges[0].from,B+Math.floor(k0));        // cạn ở lần cập nhật k=floor(k0)+1
  /* Hai mốc mới: ăn gốc phải xảy ra trước (hoặc cùng) mốc cạn. */
  assert.ok(r.rows[0].loseRanges.length>0);
  assert.ok(r.rows[0].loseRanges[0].from<=r.rows[0].thresholdRanges[0].from);
  assert.ok(r.rows[0].loseRanges[0].from>=r.B);
});

test('compare: loseRanges (tuổi TK bị ăn vào gốc) — cùng ngưỡng, trong miền [B,U], không muộn hơn mốc cạn',()=>{
  const c=fresh(2),s=c.state;c.setNow(2026*12);
  s.birthYear=1985;s.gender='male';
  s.periods=[{from:'2015-01',to:'2025-12',type:'dn',bh:10e6,growth:0}];
  const r=c.compareYearsScan({bStart:10e6,bGrow:'flat',contribRate:22,maxAge:100},null);
  assert.equal(r.ok,true);
  r.rows.forEach(function(row){
    if(row.months<180){ assert.equal(row.loseRanges.length,0); return; }
    assert.ok(Array.isArray(row.loseRanges));
    row.loseRanges.forEach(function(z){ assert.ok(z.from<=z.to&&z.from>=r.B&&z.to<=r.U); });
    if(row.loseRanges.length&&row.thresholdRanges.length)
      assert.ok(row.loseRanges[0].from<=row.thresholdRanges[0].from,'ăn gốc không thể muộn hơn cạn');
  });
  /* Lưới mặc định (hưu tăng 5–10%/năm nhanh hơn lãi 4–9%) phải có dòng nào đó vừa thua vừa cạn. */
  const anyBoth=r.rows.some(function(row){return row.months>=180&&row.loseRanges.length>0&&row.thresholdRanges.length>0;});
  assert.ok(anyBoth,'lưới mặc định phải có dòng vừa có mốc thua vừa có mốc cạn');
});

test('compare: migrate v9 điền compareCfg im lặng cho bản cũ, giữ cấu hình bản mới',()=>{
  const c=fresh(1);
  const old=JSON.parse(JSON.stringify(c.state));delete old.compareCfg;
  let s=c.migrateState(old);
  assert.equal(s.schemaVersion,9);
  assert.equal(s.compareCfg.xSave,6.5);                /* default newCompareCfg */
  assert.equal(s.compareCfg.bGrow,'infl');
  const edited=JSON.parse(JSON.stringify(c.state));
  edited.compareCfg={xSave:9.2,tutuat:123456};
  s=c.migrateState(edited);
  assert.equal(s.compareCfg.xSave,9.2);assert.equal(s.compareCfg.tutuat,123456);
  assert.equal(s.compareCfg.contribRate,22);           /* trường thiếu được bổ sung mặc định */
});
