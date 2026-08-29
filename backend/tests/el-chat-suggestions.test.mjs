import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectModules } = require('../src/services/elModuleRegistry.cjs');
const { runElAnalyst } = require('../src/services/elAnalystEngine.cjs');

const period = { from:'2026-08-28',to:'2026-08-28',days:1 };
const summary = {
  revenue:109257,orders:117,sales:164,returns:4,returnRate:2.4,
  cogs:29138,commission:21851,logistics:0,advertising:8907,storage:0,acquiring:0,
  penalties:0,deductions:0,tax:8924,fixed:0,operatingProfit:44139,margin:40.4,
};
const negativeSummary = {
  revenue:740492,orders:403,sales:1104,returns:11,returnRate:1,
  cogs:291380,commission:201997,logistics:151188,advertising:83091,storage:5180,acquiring:32840,
  penalties:1947,deductions:0,tax:89246,fixed:0,operatingProfit:-120550,margin:-16.3,
};
const financeRows = [
  {nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',revenue:109257,sales:164,returns:4,advertising:8907,commission:21851,logistics:0,acquiring:0,storage:0,expenses:65118,profit:44139,margin:40.4,financeSource:'wb_finance_api'},
];
const lossRows = [
  {nmID:360,vendorCode:'360',title:'Кабель 360',revenue:311647,sales:491,returns:3,advertising:34818,commission:85000,logistics:67000,acquiring:12000,storage:5180,expenses:360000,profit:-48353,margin:-15.5,financeSource:'wb_finance_api'},
];
const baseData = {
  overview:{ok:true,data:{available:true,period,summary,criticalProducts:[],topRecommendations:[{title:'Проверить рекламу 2505'}]}},
  finance:{ok:true,data:{available:true,period,summary,productPnlRows:financeRows,lossMakingProducts:[],missingCostProducts:[]}},
  advertising:{ok:true,data:{available:true,period,summary:{spend:8907,operatingProfit:44139,margin:40.4},advertising:{period,statsAvailable:true,totals:{spend:8907,revenue:109257,orders:164},campaigns:[{advertId:77,name:'Поиск 2505',spend:8907,revenue:109257,orders:164,clicks:420}]},productsWithAds:financeRows}},
  stocks:{ok:true,data:{available:true,period,summary:{stockUnits:12,zeroStock:1,lowStock:2,slowStock:0,stockCoverDays:6},lowStockProducts:[{nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',stock:3,stockCoverDays:4,profit:44139}],slowStockProducts:[]}},
  procurement:{ok:true,data:{available:true,period,candidates:[{nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',stock:3,stockCoverDays:4,profit:44139}],exclusions:[]}},
  returns:{ok:true,data:{available:true,period,summary:{returns:4,sales:164,returnRate:2.4},highestReturnRate:[{nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',returns:4,returnRate:2.4}]}},
  reviews:{ok:true,data:{available:true,period,summary:{reviews:{total:12,averageRating:4.6,lowRated:1,unanswered:0},questions:{total:2,unanswered:0},chats:{total:0}},productSignals:[{nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',totalReviews:12,lowRatedReviews:1,unansweredReviews:0,unansweredQuestions:0,averageRating:4.6}],lowRatedReviews:[{nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',rating:2,text:'Короткий провод'}],relatedReturns:[{nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',returns:4,returnRate:2.4}]}},
  products:{ok:true,data:{available:true,period,summary:{activeProducts:1},products:[financeRows[0]]}},
  diagnostics:{ok:true,data:{available:true,period,comparePeriod:{from:'2026-08-27',to:'2026-08-27',days:1},state:'down',headlineMetric:'operatingProfit',headlineChange:{value:-1200,pct:-2.7},metrics:{revenue:{available:true,value:900},orders:{available:true,value:3},sales:{available:true,value:4},operatingProfit:{available:true,value:-1200}},causes:[{title:'Реклама стала дороже',evidence:'Расход вырос относительно прошлого периода.',impact:8907,impactKind:'direct_expense'}],action:{text:'Проверь кампанию Поиск 2505 и её вклад в прибыль.',reason:'это самый заметный расход'},confidence:'high'}},
};

async function ask(message) {
  const modules = detectModules(message, 4);
  return runElAnalyst({
    message,
    history:[],
    context:{ period,screen:{ period,summary } },
    identity:{userId:'u1',userName:'Мария'},
    personality:{character:'insider',humor:'off',support:true,celebrations:true,address:'informal'},
    classification:{modules,reason:'cabinet-question'},
    dataBridge:{ async getMany(requested) {
      return Object.fromEntries(requested.map(module => [module, baseData[module] || {ok:false,warning:`Нет тестовых данных ${module}`}]));
    }},
  });
}

const ads = await ask('Какие рекламные кампании съедают прибыль?');
assert.match(ads.text,/Реклама за/);
assert.match(ads.text,/Поиск 2505/);

const moneyAds = await ask('Какие рекламы тащат бабки?');
assert.match(moneyAds.text,/Кампании, которые сейчас тащат деньги/);
assert.match(moneyAds.text,/Поиск 2505/);
assert.match(moneyAds.text,/ДРР|ROMI/);

const decision = await ask('Что изменилось за выбранный период, почему и что мне сделать первым?');
assert.match(decision.text,/Сравнил/);
assert.match(decision.text,/Одно главное действие/);

const procurement = await ask('Какие товары скоро закончатся и стоит ли их дозаказывать?');
assert.match(procurement.text,/Кандидаты на пополнение|Риск дефицита/);
assert.match(procurement.text,/2505/);

const relation = await ask('Свяжи возвраты с отзывами и карточками');
assert.match(relation.text,/Связал отзывы с возвратами/);
assert.match(relation.text,/2505/);

const profitGap = await ask('Почему прибыль ниже выручки?');
assert.match(profitGap.text,/выручка — это деньги до расходов/);
assert.match(profitGap.text,/Что съело разницу/);

const tired = await ask('Эл, я устала. Помоги выбрать одно главное действие.');
assert.match(tired.text,/Понимаю, что сейчас тяжело/);
assert.match(tired.text,/Одно главное действие/);

const praise = await ask('Похвали меня по делу: что в кабинете уже хорошо?');
assert.match(praise.text,/по делу/);
assert.match(praise.text,/подтвержд/);
assert.match(praise.text,/выручка|продажи|остатки|реклама/);

const turnaround = await runElAnalyst({
  message:'Эл пишет что кабинет в минусе. Найди решения, чтобы вытянуть кабинет в плюс, но учитывай жесткую конкуренцию.',
  history:[],
  context:{ period,screen:{ period,summary:negativeSummary } },
  identity:{userId:'u1',userName:'Мария'},
  personality:{character:'insider',humor:'off',support:true,celebrations:true,address:'informal'},
  classification:{modules:detectModules('кабинет в минусе вытянуть в плюс жесткая конкуренция',4),reason:'cabinet-question'},
  dataBridge:{ async getMany(requested) {
    const data = {
      finance:{ok:true,data:{available:true,period,summary:negativeSummary,productPnlRows:lossRows,lossMakingProducts:lossRows,missingCostProducts:[]}},
      advertising:{ok:true,data:{available:true,period,summary:{spend:83091,operatingProfit:-120550,margin:-16.3},advertising:{period,statsAvailable:true,totals:{spend:83091,revenue:740492,orders:1104},campaigns:[{advertId:360,name:'Поиск 360',spend:34818,revenue:311647,orders:491,clicks:900},{advertId:77,name:'Слив бюджета',spend:22000,revenue:0,orders:0,clicks:1200}]},productsWithAds:lossRows}},
      pricing:{ok:true,data:{available:true,period,lossMakingProducts:lossRows,pricingProducts:lossRows}},
      procurement:{ok:true,data:{available:true,period,candidates:[],exclusions:lossRows,recommendations:[]}},
    };
    return Object.fromEntries(requested.map(module => [module, data[module] || {ok:false,warning:`Нет тестовых данных ${module}`}]));
  }},
});
assert.match(turnaround.text,/кабинет в минусе/);
assert.match(turnaround.text,/План выхода в плюс/);
assert.match(turnaround.text,/жестк|конкур/i);
assert.match(turnaround.text,/Рекламу не выключать всю/);

console.log('ELISEI El chat suggestion regression tests passed');
