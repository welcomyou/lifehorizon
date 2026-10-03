// HISTORICAL AUDIT: probes the preserved pre-upgrade source. Current tests: app.test.js.
// Independent audit probes. Read app code without changing it or browser data.
// Run: node app/test/audit-input-probes.js
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../backups/2026-09-08-before-fixes/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const core = script.slice(0, script.indexOf('/* ================= Render'));
function fresh() {
  const c = vm.createContext({console});
  vm.runInContext(core, c);
  vm.runInContext(`
    setNow(2026*12+8); state.simYears=5; state.periods=[];
    state.pensionMode='simple'; state.pensionSimple={amount:0,startYear:2100,growth:0};
    state.events=[]; state.incomePeriods=[]; state.milestones=[{y:0,label:'Base',monthly:0}];
    state.infl=0; state.assets={mmf:100000000,tk:0,tp:0,cp:0};
    state.goldChi=0; state.landPlots=[]; state.rates={mmf:0,tk:0,tp:0};
    state.mmfMonths=1; state.allocPolicy.lumpEnabled=false;
    state.allocRetire={tk:0,tp:0,cp:0,gold:0,land:0};
    state.series={gold:Array(60).fill(0),cp:Array(60).fill(0),land:Array(60).fill(0)};
    state.seriesV=2;
  `, c);
  return c;
}
const observations = [];
function probe(name, setup, expression, expectation) {
  const c = fresh();
  vm.runInContext(setup, c);
  const actual = vm.runInContext(expression, c);
  observations.push({name, expectation, actual});
}
probe('I1 invalid savings rate accepted', 'state.rates.tk=-101;state.assets.tk=100000000;',
  `({errors:validateErrors(), finite: isFinite(runSim(true).months[0].total), firstShort:runSim(true).firstShort})`,
  'A rate below -100% must block simulation; invalid NAV must never produce a success conclusion.');
probe('I2 negative gold quantity accepted', 'state.goldChi=-4;',
  `({errors:validateErrors(), gold:runSim(true).months[0].gold})`,
  'Negative holding must be rejected before simulation.');
probe('I3 fractional event year silently omitted', `state.events=[{kind:'thu',y:0.5,label:'Half year',amount:10000000,allocMode:'follow'}];`,
  `({errors:validateErrors(), incomeEvent:runSim(true).evIn})`,
  'Either execute the event at month 6 or reject fractional event years.');
probe('I4 future-only spending applied now', `state.milestones=[{y:2,label:'Future only',monthly:1000000}];`,
  `({errors:validateErrors(), firstMonth:runSim(true).months[0].mmf})`,
  'Explicitly request a present spending baseline; do not silently apply a year-2 milestone at month 0.');
probe('I5 January-start real value off by one year', `setNow(2026*12);state.infl=10;`,
  `({actual:runSim(true).years[4].real,expected:100000000/Math.pow(1.1,5),endingMonth:runSim(true).months[59].month})`,
  'End of 60 months uses 60/12=5 years of inflation.');
probe('I6 September-start interim real value', 'state.infl=10;',
  `({actual:runSim(true).years[0].real,expected:100000000/Math.pow(1.1,4/12),months:runSim(true).years[0].months})`,
  'End of first four months uses 4/12 years of inflation.');
probe('I7 zero phase allocation falls back to retirement allocation', `state.assets.mmf=0;state.allocRetire={tk:100,tp:0,cp:0,gold:0,land:0};state.incomePeriods=[{fromY:2026,toY:2030,amount:10000000,growth:0,alloc:{tk:0,tp:0,cp:0,gold:0,land:0}}];`,
  `({warnings:validateState(),firstMMF:runSim(true).months[0].mmf,firstSavings:runSim(true).months[0].tk})`,
  'UI explicitly says total allocation 0 retains surplus in MMF.');
probe('I8 no-future-information monthly NAV', `state.assets={mmf:0,tk:0,tp:0,cp:100000000}; state.series.cp[0]=0.10;state.series.cp[1]=-0.20;`,
  `({month1:runSim(true).months[0].cp,month2:runSim(true).months[1].cp})`,
  'Month 1 = 110m; month 2 = 88m. No end-year return should be applied early.');
console.log(JSON.stringify(observations, null, 2));
