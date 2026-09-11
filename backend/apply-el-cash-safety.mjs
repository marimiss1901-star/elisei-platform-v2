import fs from 'node:fs'

const enginePath = new URL('./src/services/elAnalystEngine.cjs', import.meta.url)
const registryPath = new URL('./src/services/elModuleRegistry.cjs', import.meta.url)
const promptPath = new URL('./src/services/elPrompt.cjs', import.meta.url)
const serverPath = new URL('./src/server.js', import.meta.url)

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`ELISEI 5.19.16 patch anchor missing: ${label}`)
  return source.replace(needle, replacement)
}

let registry = fs.readFileSync(registryPath, 'utf8')
registry = registry.replace("'бюджет', 'продвижен', 'бабк', 'деньг', 'тащ', 'принос'", "'бюджет', 'продвижен', 'бабк', 'тащ', 'принос'")
if (!registry.includes("'кассов'")) {
  registry = replaceOnce(
    registry,
    "'удержан', 'налог', 'по каждому артикулу', 'по артикулам'",
    "'удержан', 'налог', 'по каждому артикулу', 'по артикулам', 'вывести деньги', 'вывод денег', 'вывести из бизнеса', 'забрать деньги', 'оборотк', 'оборотн', 'кассов', 'денежный поток', 'собственник', 'хватит денег', 'сколько можно вывести', 'сколько можно забрать', 'проедает капитал'",
    'finance cash keywords',
  )
}
fs.writeFileSync(registryPath, registry)

let server = fs.readFileSync(serverPath, 'utf8')
if (!server.includes('balance: core?.finance?.balance || null,')) {
  server = replaceOnce(
    server,
    "      summary: core.summary,\n      settings: core.settings,\n      productPnlRows: products",
    "      summary: core.summary,\n      balance: core?.finance?.balance || null,\n      settings: core.settings,\n      productPnlRows: products",
    'El finance provider balance',
  )
}
fs.writeFileSync(serverPath, server)

let engine = fs.readFileSync(enginePath, 'utf8')
if (!engine.includes("function asksCashSafety(message = '')")) {
  const helpers = String.raw`
function asksCashSafety(message = '') {
  return /(?:вывест|вывод|вывел|вывели|забра|снял|снять|вытащ).{0,45}(?:ден|млн|миллион|лям|тыс|оборот)|(?:сколько|можно|опасно|безопасно).{0,35}(?:вывест|забрать|снять)|оборотк|оборотн\w*\s+капитал|кассов\w*\s+разрыв|хватит\s+денег|сколько\s+(?:дней|месяц\w*).*(?:хватит|прожив)|проеда\w*\s+капитал|бизнесу\s+(?:пизд|конец)|денежн\w*\s+поток\s+собствен/i.test(String(message || ''));
}

function cashAmount(value, unit = '') {
  const numeric = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  const normalized = String(unit || '').toLowerCase();
  const multiplier = /млн|миллион|лям|кк/.test(normalized) ? 1_000_000 : /тыс/.test(normalized) ? 1_000 : 1;
  return numeric * multiplier;
}

function moneyMatch(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? cashAmount(match[1], match[2]) : null;
}

function parseCashWithdrawal(message = '') {
  const amount = '(\\d+(?:[.,]\\d+)?)';
  const unit = '(млн|миллион(?:а|ов)?|лям(?:а|ов)?|кк|тыс(?:\\.|яч[аи]?)?)?';
  const after = new RegExp('(?:вывел(?:и|а)?|вывод(?:или|им)?|вывести|забрал(?:и|а)?|забрать|снял(?:и|а)?|снять|вытащил(?:и|а)?|вытащить)[^0-9]{0,35}' + amount + '\\s*' + unit, 'i');
  const before = new RegExp(amount + '\\s*' + unit + '[^а-яё0-9]{0,20}(?:вывел(?:и|а)?|вывести|вывод|забрал(?:и|а)?|забрать|снять)', 'i');
  return moneyMatch(message, after) ?? moneyMatch(message, before);
}

function parseProcessingCash(text = '') {
  const amount = '(\\d+(?:[.,]\\d+)?)';
  const unit = '(млн|миллион(?:а|ов)?|лям(?:а|ов)?|кк|тыс(?:\\.|яч[аи]?)?)?';
  const pattern = new RegExp('(?:к\\s+вывод\\w*|банком?\\s+обрабатыва\\w*|обрабатыва\\w*)[^0-9]{0,35}' + amount + '\\s*' + unit, 'i');
  return moneyMatch(text, pattern);
}

function cashConversationText(history = [], message = '') {
  const recent = (Array.isArray(history) ? history : [])
    .filter(item => item?.role === 'user' && item?.content)
    .slice(-8)
    .map(item => String(item.content));
  return [...recent, String(message || '')].join('\n');
}

function firstFinite(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function cashBalance(financeData = {}, context = {}) {
  const balance = firstFinite(
    financeData?.balance?.current,
    financeData?.finance?.balance?.current,
    context?.screen?.balance?.current,
    context?.screen?.finance?.balance?.current,
    context?.cabinetData?.balance?.current,
    context?.cabinetData?.finance?.balance?.current,
  );
  const forWithdraw = firstFinite(
    financeData?.balance?.for_withdraw,
    financeData?.balance?.forWithdraw,
    financeData?.finance?.balance?.for_withdraw,
    context?.screen?.balance?.for_withdraw,
    context?.screen?.balance?.forWithdraw,
    context?.screen?.finance?.balance?.for_withdraw,
    context?.cabinetData?.balance?.for_withdraw,
    context?.cabinetData?.finance?.balance?.for_withdraw,
  );
  const updatedAt = financeData?.balance?.updatedAt || financeData?.finance?.balance?.updatedAt || context?.screen?.balance?.updatedAt || context?.cabinetData?.balance?.updatedAt || null;
  return { balance, forWithdraw, updatedAt };
}

function cashPeriodDays(period = {}) {
  const explicit = Number(period?.days);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const from = validDateKey(period?.from || period?.dateFrom || period?.date_from);
  const to = validDateKey(period?.to || period?.dateTo || period?.date_to);
  if (!from || !to) return null;
  const diff = Math.floor((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
  return diff > 0 ? diff : null;
}

function formatCashSafety({ financeData, stocksData, syncData, context = {}, history = [], message = '', identity = {} } = {}) {
  const summary = financeData?.summary || context?.screen?.summary || {};
  const period = financeData?.period || context?.period || context?.screen?.period || {};
  const periodText = formatRuPeriod(period);
  const name = String(identity?.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? name + ', ' : '';
  const revenue = firstFinite(summary.revenue);
  const profit = firstFinite(summary.operatingProfit);
  const margin = firstFinite(summary.margin);
  const requestedWithdrawal = parseCashWithdrawal(message);
  const conversation = cashConversationText(history, message);
  const processingCash = parseProcessingCash(conversation);
  const noSupplierDebt = /(?:долг\w*\s+(?:перед\s+)?поставщик\w*|поставщик\w*[^.!?\n]{0,25}долг)[^.!?\n]{0,45}(?:нет|ноль|0\s*₽)/i.test(conversation);
  const cash = cashBalance(financeData, context);
  const days = cashPeriodDays(period);
  const dailyLoss = Number.isFinite(profit) && profit < 0 && days ? Math.abs(profit) / days : null;
  const runwayDays = dailyLoss && cash.balance != null && cash.balance > 0 ? cash.balance / dailyLoss : null;
  const financeWarning = coverageWarnings(financeData)[0] || null;
  const syncWarning = coverageWarnings(syncData)[0] || null;
  const lines = [prefix + 'кассовая безопасность за ' + periodText + ':'];
  lines.push('• P&L: выручка ' + money(revenue) + ', операционная прибыль ' + money(profit) + ', маржа ' + percent(margin) + '.');
  if (cash.balance != null || cash.forWithdraw != null) {
    const withdrawPart = cash.forWithdraw != null ? '; доступно к выводу ' + money(cash.forWithdraw) : '';
    lines.push('• Деньги WB сейчас: баланс ' + money(cash.balance) + withdrawPart + '. Баланс WB не считаю прибылью или свободной обороткой.');
  }
  if (requestedWithdrawal != null) lines.push('• Вывод собственника из вопроса: ' + money(requestedWithdrawal) + '.');
  if (processingCash != null && (requestedWithdrawal == null || Math.abs(processingCash-requestedWithdrawal) > 1)) lines.push('• По последним сообщениям в обработке/к выводу: ' + money(processingCash) + '.');
  if (noSupplierDebt) lines.push('• По последним сообщениям: долгов поставщикам нет. Это снижает риск, но не заменяет резерв на налоги, зарплаты, рекламу, логистику и закупки.');

  let risk = 'ТРЕБУЕТ РЕЗЕРВА';
  if (Number.isFinite(profit) && profit < 0 && requestedWithdrawal != null && requestedWithdrawal > 0) risk = 'ВЫСОКИЙ';
  else if (requestedWithdrawal != null && cash.balance != null && requestedWithdrawal > cash.balance) risk = 'ВЫСОКИЙ';
  else if (Number.isFinite(profit) && profit < 0) risk = 'ВЫСОКИЙ';
  lines.push('Риск вывода денег: ' + risk + '.');

  if (Number.isFinite(profit) && profit < 0) {
    lines.push('Причина: бизнес за период не создаёт свободную прибыль, а теряет ' + money(Math.abs(profit)) + '. Поэтому любой вывод собственника в этот момент уменьшает накопленную ликвидность/оборотный капитал, если его не компенсирует отдельный приток денег.');
    if (requestedWithdrawal != null && requestedWithdrawal > 0) {
      lines.push('Если ' + money(requestedWithdrawal) + ' были выведены именно в этом же периоде, вывод + операционный убыток дают около ' + money(requestedWithdrawal + Math.abs(profit)) + ' уменьшения денежного капитала до учёта внешних пополнений.');
    }
  } else if (Number.isFinite(profit) && requestedWithdrawal != null && requestedWithdrawal > Math.max(0,profit)) {
    lines.push('Вывод ' + money(requestedWithdrawal) + ' больше операционной прибыли периода ' + money(profit) + '. Разница берётся не из заработанной прибыли этого периода, а из ранее накопленных денег/оборотного капитала.');
  }

  if (runwayDays != null) {
    lines.push('Грубый стресс-тест: при темпе убытка этого периода около ' + money(dailyLoss) + ' в день текущего баланса WB ' + money(cash.balance) + ' хватило бы примерно на ' + number(runwayDays) + ' дн. Это не полный runway: банковский счёт, налоги, зарплаты, закупки и будущие выплаты WB сюда не добавлены.');
  }

  const stockUnits = firstFinite(stocksData?.summary?.stockUnits);
  if (stockUnits != null) lines.push('Остаток товара: ' + number(stockUnits) + ' шт. Товар — актив бизнеса, но не считаю его живыми деньгами, пока он не продан.');
  if (requestedWithdrawal == null) {
    lines.push('Точную «безопасную сумму к выводу» не называю без денежного резерва бизнеса: нужно знать ближайшие налоги, зарплаты/постоянные расходы, закупки и деньги на рекламу/логистику. Баланс WB сам по себе не является суммой, которую можно забрать без риска.');
  }
  lines.push('Одно главное действие: до следующего вывода зафиксировать минимальный денежный резерв бизнеса. Эл должен считать свободными только деньги сверх этого резерва и подтверждённой прибыли, а не весь баланс WB.');
  const warning = financeWarning || syncWarning;
  if (warning) lines.push('Ограничение данных: ' + warning);
  return lines.join('\n');
}
`
  engine = replaceOnce(engine, "function asksTurnaroundPlan(message = '') {", helpers + "\nfunction asksTurnaroundPlan(message = '') {", 'cash safety helpers')
}

if (!engine.includes('const cashSafetyRequest = asksCashSafety(message);')) {
  engine = replaceOnce(
    engine,
    "  const decisionRequest = isDecisionRequest(message);\n  const businessPraiseRequest = asksBusinessPraise(message);\n  const turnaroundRequest = asksTurnaroundPlan(message);",
    "  const decisionRequest = isDecisionRequest(message);\n  const businessPraiseRequest = asksBusinessPraise(message);\n  const turnaroundRequest = asksTurnaroundPlan(message);\n  const cashSafetyRequest = asksCashSafety(message);",
    'cash safety request detection',
  )
}
if (!engine.includes("if (cashSafetyRequest) modules = ['finance', 'stocks', 'sync'];")) {
  engine = replaceOnce(
    engine,
    "  if (turnaroundRequest) modules = ['finance', 'advertising', 'pricing', 'procurement'];\n  if (asksProfitRevenueGap(message)) modules = ['finance'];",
    "  if (turnaroundRequest) modules = ['finance', 'advertising', 'pricing', 'procurement'];\n  if (cashSafetyRequest) modules = ['finance', 'stocks', 'sync'];\n  if (asksProfitRevenueGap(message)) modules = ['finance'];",
    'cash safety module routing',
  )
}
if (!engine.includes('sections.push(formatCashSafety({')) {
  engine = replaceOnce(
    engine,
    "  const sections = [];\n  const warnings = [];\n  if (turnaroundRequest) {",
    "  const sections = [];\n  const warnings = [];\n  if (cashSafetyRequest) {\n    const financeData = moduleData(results.finance);\n    const stocksData = moduleData(results.stocks);\n    const syncData = moduleData(results.sync);\n    sections.push(formatCashSafety({\n      financeData:results.finance?.ok ? financeData : null,\n      stocksData:results.stocks?.ok ? stocksData : null,\n      syncData:results.sync?.ok ? syncData : null,\n      context:options.context,\n      history:options.history,\n      message,\n      identity:options.identity,\n    }));\n    warnings.push(...coverageWarnings(financeData),...coverageWarnings(stocksData),...coverageWarnings(syncData));\n  }\n  if (turnaroundRequest) {",
    'cash safety response block',
  )
}
if (!engine.includes('if (cashSafetyRequest) continue;')) {
  engine = replaceOnce(
    engine,
    "  for (const moduleName of modules) {\n    if (turnaroundRequest) continue;",
    "  for (const moduleName of modules) {\n    if (cashSafetyRequest) continue;\n    if (turnaroundRequest) continue;",
    'cash safety duplicate formatter guard',
  )
}
if (!engine.includes('formatCashSafety, asksCashSafety')) {
  engine = replaceOnce(
    engine,
    "module.exports = { runElAnalyst, inferModules, FORMATTERS, campaignMetrics, asksReviewReturnLink, formatReviewReturnLink, formatDiagnostics, isDecisionRequest };",
    "module.exports = { runElAnalyst, inferModules, FORMATTERS, campaignMetrics, asksReviewReturnLink, formatReviewReturnLink, formatDiagnostics, isDecisionRequest, formatCashSafety, asksCashSafety, parseCashWithdrawal };",
    'cash safety exports',
  )
}
fs.writeFileSync(enginePath, engine)

let prompt = fs.readFileSync(promptPath, 'utf8')
if (!prompt.includes('Баланс WB не равен свободным деньгам')) {
  prompt = replaceOnce(
    prompt,
    "- В закупках не предлагай дозаказ только потому, что остаток мал.\n- В ценах не предлагай скидку ниже безубыточной цены.",
    "- В закупках не предлагай дозаказ только потому, что остаток мал.\n- Баланс WB не равен свободным деньгам и не равен прибыли. На вопрос о выводе денег/оборотке сначала сопоставь P&L, актуальный balance, обязательства и ближайший денежный резерв; вывод собственника не записывай в операционные расходы P&L.\n- Если бизнес убыточен, прямо объясни, что вывод денег уменьшает накопленную ликвидность, даже если на WB ещё есть баланс. Не называй весь баланс безопасной суммой к выводу.\n- В ценах не предлагай скидку ниже безубыточной цены.",
    'El prompt cash safety rules',
  )
}
fs.writeFileSync(promptPath, prompt)

console.log('ELISEI 5.19.16 El cash-safety guard applied')
