import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDecisionAnalysis, previousEqualPeriod } = require('../src/services/elDecisionEngine.cjs');
const { detectModules, publicCapabilities } = require('../src/services/elModuleRegistry.cjs');
const { runElAnalyst } = require('../src/services/elAnalystEngine.cjs');

assert.deepEqual(previousEqualPeriod({ from:'2026-08-10',to:'2026-08-16' }), { from:'2026-08-03',to:'2026-08-09',days:7 });
assert.equal(detectModules('Почему упала прибыль за эту неделю?')[0], 'diagnostics');
assert.equal(detectModules('Что сейчас важнее всего по кабинету?')[0], 'diagnostics');
assert.equal(publicCapabilities().some(item => item.id === 'diagnostics'), false, 'internal diagnostics must not become a new UI module');

const previous = {
  period:{from:'2026-08-03',to:'2026-08-09',days:7},
  availability:{sales:true,orders:true},
  summary:{
    revenue:120000,orders:120,sales:100,returns:8,returnRate:8,
    operatingProfit:24000,margin:20,advertising:7000,commission:18000,logistics:9000,storage:2500,acceptance:500,acquiring:900,penalties:0,deductions:0,
    advertisingSource:'wb_api',logisticsSource:'wb_api',commissionSource:'wb_api',storageSource:'finance_report',
  },
  products:[
    {nmID:1,vendorCode:'A1',title:'Кроссовки',revenue:70000,profit:15000,salesCount:55,returnsCount:3,returnRate:5.5,advertising:3000},
    {nmID:2,vendorCode:'B2',title:'Ботинки',revenue:50000,profit:9000,salesCount:45,returnsCount:5,returnRate:11.1,advertising:4000},
  ],
};
const current = {
  period:{from:'2026-08-10',to:'2026-08-16',days:7},
  availability:{sales:true,orders:true},
  summary:{
    revenue:90000,orders:92,sales:78,returns:13,returnRate:16.7,
    operatingProfit:11000,margin:12.2,advertising:12000,commission:14500,logistics:12000,storage:2500,acceptance:500,acquiring:900,penalties:0,deductions:0,
    advertisingSource:'wb_api',logisticsSource:'wb_api',commissionSource:'wb_api',storageSource:'finance_report',
  },
  products:[
    {nmID:1,vendorCode:'A1',title:'Кроссовки',revenue:40000,profit:5000,salesCount:32,returnsCount:8,returnRate:25,advertising:7000},
    {nmID:2,vendorCode:'B2',title:'Ботинки',revenue:50000,profit:6000,salesCount:46,returnsCount:5,returnRate:10.9,advertising:5000},
  ],
};

const analysis = buildDecisionAnalysis({
  current,previous,
  period:current.period,
  comparePeriod:previous.period,
  comparisonCoverage:true,
});
assert.equal(analysis.available,true);
assert.equal(analysis.state,'down');
assert.equal(analysis.headlineMetric,'operatingProfit');
assert.equal(analysis.headlineChange.value,-13000);
assert.ok(analysis.causes.some(item => item.id === 'expense-advertising' && item.impact === 5000));
assert.ok(analysis.causes.some(item => item.id === 'returns-growth'));
assert.ok(analysis.productDrivers.profitLosses.some(item => item.vendorCode === 'A1'));
assert.ok(analysis.action?.text);
assert.equal(analysis.confidence,'high');

let requestedModules = null;
const answer = await runElAnalyst({
  message:'Почему упала прибыль за эту неделю и что делать?',
  history:[],
  context:{ period:current.period },
  identity:{userId:'u1',userName:'Мария'},
  personality:{character:'professional',humor:'off',support:false,celebrations:false,address:'informal'},
  classification:{modules:['diagnostics','finance'],reason:'cabinet-question'},
  dataBridge:{
    async getMany(modules) {
      requestedModules = modules;
      return { diagnostics:{ok:true,data:analysis} };
    },
  },
});
assert.deepEqual(requestedModules,['diagnostics']);
assert.deepEqual(answer.modulesUsed,['diagnostics']);
assert.match(answer.text,/Сравнил/);
assert.match(answer.text,/Почему это произошло:/);
assert.match(answer.text,/Одно главное действие сейчас:/);
assert.match(answer.text,/Уверенность вывода: высокая/);

console.log('ELISEI 5.10.0 decision engine tests passed');
