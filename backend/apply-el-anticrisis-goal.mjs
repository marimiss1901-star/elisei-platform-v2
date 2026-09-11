import fs from 'node:fs'

const enginePath = new URL('./src/services/elAnalystEngine.cjs', import.meta.url)
const promptPath = new URL('./src/services/elPrompt.cjs', import.meta.url)

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`ELISEI 5.19.17 patch anchor missing: ${label}`)
  return source.replace(needle, replacement)
}

let engine = fs.readFileSync(enginePath, 'utf8')
if (!engine.includes("function asksAntiCrisisGoal(message = '')")) {
  const helpers = String.raw`
function antiCrisisAmount(value, unit = '') {
  const numeric = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  const normalized = String(unit || '').toLowerCase();
  const multiplier = /млн|миллион|лям|кк/.test(normalized) ? 1_000_000 : /тыс/.test(normalized) ? 1_000 : 1;
  return numeric * multiplier;
}

function parseAntiCrisisGoalAmount(message = '') {
  const text = String(message || '');
  const amount = '(\\d+(?:[.,]\\d+)?)';
  const unit = '(млн|миллион(?:а|ов)?|лям(?:а|ов)?|кк|тыс(?:\\.|яч[аи]?)?)?';
  const after = new RegExp('(?:высвобод[а-яё]*|освобод[а-яё]*|найт[иь]|достать|вернуть|где\\s+взять|нужно|надо)[^0-9]{0,45}' + amount + '\\s*' + unit, 'i');
  const before = new RegExp(amount + '\\s*' + unit + '[^а-яё0-9]{0,30}(?:высвобод[а-яё]*|освобод[а-яё]*|из\\s+бизнеса|из\\s+оборот[а-яё]*)', 'i');
  const match = text.match(after) || text.match(before);
  return match ? antiCrisisAmount(match[1], match[2]) : null;
}

function parseAntiCrisisGoalDays(message = '') {
  const text = String(message || '').toLowerCase();
  const match = text.match(/за\\s+(\\d+)\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)/i);
  if (match) {
    const value = Number(match[1]);
    if (/недел/.test(match[2])) return value * 7;
    if (/месяц/.test(match[2])) return value * 30;
    return value;
  }
  if (/за\\s+(?:один\\s+)?месяц/i.test(text)) return 30;
  if (/за\\s+(?:одну\\s+)?недел/i.test(text)) return 7;
  return null;
}

function asksAntiCrisisGoal(message = '') {
  const text = String(message || '');
  const amount = parseAntiCrisisGoalAmount(text);
  if (!(amount > 0)) return false;
  return /высвобод|освобод|где\\s+взять|оборотк|оборотн[а-яё]*\\s+капитал|из\\s+бизнеса|антикризис|кассов[а-яё]*\\s+цель/i.test(text);
}

function antiCrisisProductLabel(item = {}) {
  const article = item.vendorCode || item.nmID || item.key || '';
  return String(item.title || item.name || 'Товар') + (article ? ' (' + article + ')' : '');
}

function antiCrisisLockedCost(item = {}) {
  const stock = Number(item.stock ?? item.stockQty ?? item.quantity ?? 0);
  const unitCost = Number(item.unitCost ?? item.costPrice ?? item.cost ?? 0);
  return stock > 0 && unitCost > 0 ? stock * unitCost : null;
}

function formatAntiCrisisGoal({ financeData, advertisingData, stocksData, pricingData, procurementData, context = {}, message = '', identity = {} } = {}) {
  const goal = parseAntiCrisisGoalAmount(message);
  const days = parseAntiCrisisGoalDays(message);
  const summary = financeData?.summary || context?.screen?.summary || {};
  const period = financeData?.period || context?.period || context?.screen?.period || {};
  const name = String(identity?.userName || '').trim().split(/\\s+/)[0];
  const prefix = name ? name + ', ' : '';
  const profit = Number(summary.operatingProfit);
  const margin = Number(summary.margin);
  const currentBalance = Number(financeData?.balance?.current);
  const lines = [prefix + 'антикризисная цель: высвободить ' + money(goal) + (days ? ' за ' + number(days) + ' дн.' : '.')];
  if (days) lines.push('Темп цели — около ' + money(goal / days) + ' в день. Это ориентир по ликвидности, а не требование ежедневно выводить такую сумму.');
  if (Number.isFinite(profit)) lines.push('Исходная точка P&L за ' + periodLabel(financeData || { period }, context) + ': операционная прибыль ' + money(profit) + ', маржа ' + percent(margin) + '.');
  if (Number.isFinite(currentBalance)) lines.push('Текущий баланс WB — ' + money(currentBalance) + '. Не считаю его свободными деньгами: из него нельзя автоматически вычесть цель и назвать остаток безопасным.');

  const losses = (Array.isArray(financeData?.lossMakingProducts) ? financeData.lossMakingProducts : [])
    .filter(item => Number.isFinite(Number(item.profit)) && Number(item.profit) < 0)
    .sort((a,b) => Number(a.profit)-Number(b.profit));
  const lossPool = losses.reduce((sum,item) => sum + Math.abs(Number(item.profit || 0)),0);
  if (losses.length) {
    lines.push('1. Минусовые SKU: в доступной выборке ' + number(losses.length) + ' товаров дают около ' + money(lossPool) + ' отрицательного результата. Это не лежащий в кассе кэш, а слив прибыли, который надо остановить первым.');
    lines.push('   Первые: ' + losses.slice(0,4).map(item => antiCrisisProductLabel(item) + ' ' + money(item.profit)).join('; ') + '.');
  } else {
    lines.push('1. Минусовые SKU: подтверждённого списка сейчас нет — этот источник экономии не оцениваю нулём.');
  }

  const ads = advertisingData?.advertising || {};
  const campaigns = (Array.isArray(ads.campaigns) ? ads.campaigns : []).map(campaignMetrics);
  const burners = campaigns.filter(item => Number(item.spend || 0) > 0 && Number(item.revenue || 0) <= 0)
    .sort((a,b) => Number(b.spend || 0)-Number(a.spend || 0));
  const burnerSpend = burners.reduce((sum,item) => sum + Number(item.spend || 0),0);
  if (ads.statsAvailable && burners.length) {
    lines.push('2. Реклама без подтверждённой отдачи: ' + number(burners.length) + ' кампаний, расход ' + money(burnerSpend) + ' за доступный рекламный срез. Это потенциальная экономия следующего сопоставимого периода при паузе/урезании, а не мгновенно высвобожденные деньги.');
    lines.push('   Первые: ' + burners.slice(0,4).map(item => (item.name || 'Кампания ' + (item.advertId || '')) + ' — ' + money(item.spend)).join('; ') + '.');
  } else if (campaigns.length) {
    lines.push('2. Реклама: кампании вижу, но полной подтверждённой статистики для оценки “сжечь/оставить” сейчас недостаточно. Сумму экономии не выдумываю.');
  } else {
    lines.push('2. Реклама: подтверждённых кампаний для антикризисного расчёта сейчас нет.');
  }

  const slow = Array.isArray(stocksData?.slowStockProducts) ? stocksData.slowStockProducts : [];
  const valuedSlow = slow.map(item => ({ item, locked:antiCrisisLockedCost(item) })).filter(row => Number.isFinite(row.locked) && row.locked > 0)
    .sort((a,b) => b.locked-a.locked);
  const lockedCost = valuedSlow.reduce((sum,row) => sum + row.locked,0);
  if (valuedSlow.length) {
    lines.push('3. Зависший товар: по ' + number(valuedSlow.length) + ' позициям с известной себестоимостью заморожено около ' + money(lockedCost) + ' по себестоимости. Это верхняя оценка связанного капитала, не гарантия, что столько вернётся при распродаже.');
    lines.push('   Первые: ' + valuedSlow.slice(0,4).map(row => antiCrisisProductLabel(row.item) + ' — около ' + money(row.locked)).join('; ') + '.');
  } else if (slow.length) {
    lines.push('3. Зависший товар: найдено ' + number(slow.length) + ' медленных/избыточных позиций, но без подтверждённой себестоимости денежный объём не считаю.');
  } else {
    lines.push('3. Зависший товар: подтверждённых медленных остатков в текущей выборке нет.');
  }

  const exclusions = Array.isArray(procurementData?.exclusions) ? procurementData.exclusions : [];
  if (exclusions.length) lines.push('4. Закупки: ' + number(exclusions.length) + ' позиций сейчас нельзя дозаказывать без отдельной проверки. Отмена будущей закупки сохраняет кэш, но не считаю её уже “высвобожденными” деньгами без суммы заказа.');
  else lines.push('4. Закупки: нет подтверждённых исключений с денежной суммой, поэтому экономию здесь не рисую.');

  const priceRisks = Array.isArray(pricingData?.lossMakingProducts) ? pricingData.lossMakingProducts : [];
  if (priceRisks.length) lines.push('5. Цена: сначала пересчитать ' + priceRisks.slice(0,4).map(antiCrisisProductLabel).join(', ') + '. При жёсткой конкуренции задача — убрать отрицательную маржу, а не просто резко поднять цены.');

  const candidates = [];
  if (losses[0]) candidates.push({ kind:'sku', amount:Math.abs(Number(losses[0].profit || 0)), text:'разобрать самый убыточный SKU ' + antiCrisisProductLabel(losses[0]) });
  if (ads.statsAvailable && burners[0]) candidates.push({ kind:'ads', amount:Number(burners[0].spend || 0), text:'проверить/урезать рекламную кампанию ' + (burners[0].name || burners[0].advertId || '') });
  if (valuedSlow[0]) candidates.push({ kind:'stock', amount:Number(valuedSlow[0].locked || 0), text:'подготовить план выхода из зависшего остатка ' + antiCrisisProductLabel(valuedSlow[0].item) });
  candidates.sort((a,b) => b.amount-a.amount);
  if (candidates[0]) lines.push('Одно действие сейчас: ' + candidates[0].text + '. Денежный масштаб сигнала — около ' + money(candidates[0].amount) + '.');

  lines.push('Важно: суммы “минусовые SKU”, “реклама” и “зависший товар” НЕ складываю в один красивый итог — реклама уже может сидеть внутри прибыли SKU, а товарный остаток является активом, а не расходом. Поэтому достижимость цели ' + money(goal) + ' подтвержу только после плана по непересекающимся источникам денег.');
  return lines.join('\n');
}
`
  engine = replaceOnce(engine, "function asksBusinessPraise(message = '') {", helpers + "\nfunction asksBusinessPraise(message = '') {", 'anti-crisis helpers')
}

if (!engine.includes('const antiCrisisGoalRequest = asksAntiCrisisGoal(message);')) {
  engine = replaceOnce(
    engine,
    "  const turnaroundRequest = asksTurnaroundPlan(message);\n  const cashSafetyRequest = asksCashSafety(message);",
    "  const turnaroundRequest = asksTurnaroundPlan(message);\n  const cashSafetyRequest = asksCashSafety(message);\n  const antiCrisisGoalRequest = asksAntiCrisisGoal(message);",
    'anti-crisis request detection',
  )
}
if (!engine.includes("if (antiCrisisGoalRequest) modules = ['finance', 'advertising', 'stocks', 'pricing', 'procurement'];")) {
  engine = replaceOnce(
    engine,
    "  if (cashSafetyRequest) modules = ['finance', 'stocks', 'sync'];\n  if (asksProfitRevenueGap(message)) modules = ['finance'];",
    "  if (cashSafetyRequest) modules = ['finance', 'stocks', 'sync'];\n  if (antiCrisisGoalRequest) modules = ['finance', 'advertising', 'stocks', 'pricing', 'procurement'];\n  if (asksProfitRevenueGap(message)) modules = ['finance'];",
    'anti-crisis module routing',
  )
}
if (!engine.includes('sections.push(formatAntiCrisisGoal({')) {
  engine = replaceOnce(
    engine,
    "  const sections = [];\n  const warnings = [];\n  if (cashSafetyRequest) {",
    "  const sections = [];\n  const warnings = [];\n  if (antiCrisisGoalRequest) {\n    const financeData = moduleData(results.finance);\n    const advertisingData = moduleData(results.advertising);\n    const stocksData = moduleData(results.stocks);\n    const pricingData = moduleData(results.pricing);\n    const procurementData = moduleData(results.procurement);\n    sections.push(formatAntiCrisisGoal({\n      financeData:results.finance?.ok ? financeData : null,\n      advertisingData:results.advertising?.ok ? advertisingData : null,\n      stocksData:results.stocks?.ok ? stocksData : null,\n      pricingData:results.pricing?.ok ? pricingData : null,\n      procurementData:results.procurement?.ok ? procurementData : null,\n      context:options.context,\n      message,\n      identity:options.identity,\n    }));\n    warnings.push(...coverageWarnings(financeData),...coverageWarnings(advertisingData),...coverageWarnings(stocksData),...coverageWarnings(pricingData),...coverageWarnings(procurementData));\n  }\n  if (cashSafetyRequest) {",
    'anti-crisis response block',
  )
}
if (!engine.includes('if (antiCrisisGoalRequest) continue;')) {
  engine = replaceOnce(
    engine,
    "  for (const moduleName of modules) {\n    if (cashSafetyRequest) continue;",
    "  for (const moduleName of modules) {\n    if (antiCrisisGoalRequest) continue;\n    if (cashSafetyRequest) continue;",
    'anti-crisis duplicate formatter guard',
  )
}
if (!engine.includes('formatAntiCrisisGoal, asksAntiCrisisGoal')) {
  engine = replaceOnce(
    engine,
    "formatCashSafety, asksCashSafety, parseCashWithdrawal };",
    "formatCashSafety, asksCashSafety, parseCashWithdrawal, formatAntiCrisisGoal, asksAntiCrisisGoal, parseAntiCrisisGoalAmount, parseAntiCrisisGoalDays };",
    'anti-crisis exports',
  )
}
fs.writeFileSync(enginePath, engine)

let prompt = fs.readFileSync(promptPath, 'utf8')
if (!prompt.includes('антикризисную денежную цель')) {
  prompt = replaceOnce(
    prompt,
    "- Если бизнес убыточен, прямо объясни, что вывод денег уменьшает накопленную ликвидность, даже если на WB ещё есть баланс. Не называй весь баланс безопасной суммой к выводу.",
    "- Если бизнес убыточен, прямо объясни, что вывод денег уменьшает накопленную ликвидность, даже если на WB ещё есть баланс. Не называй весь баланс безопасной суммой к выводу.\n- Если пользователь задаёт антикризисную денежную цель (например, высвободить 1 млн за 30 дней), разбери непересекающиеся источники: остановка подтверждённых убытков, реклама без отдачи, зависший капитал в остатках и сохранение кэша на закупках. Не складывай пересекающиеся суммы в ложный общий “потенциал”.",
    'anti-crisis prompt rule',
  )
}
fs.writeFileSync(promptPath, prompt)

console.log('ELISEI 5.19.17 El anti-crisis cash goal applied')
