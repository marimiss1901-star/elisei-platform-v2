'use strict';

const DAY_MS = 86400000;

function validDate(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`)) ? text : null;
}

function normalizePeriod(period = {}) {
  const from = validDate(period.from || period.dateFrom || period.date_from);
  const to = validDate(period.to || period.dateTo || period.date_to);
  if (!from || !to) return null;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (fromMs > toMs) return null;
  return { from, to, days:Math.max(1, Math.round((toMs - fromMs) / DAY_MS) + 1) };
}

function dateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function previousEqualPeriod(period = {}) {
  const current = normalizePeriod(period);
  if (!current) return null;
  const previousToMs = Date.parse(`${current.from}T00:00:00Z`) - DAY_MS;
  const previousFromMs = previousToMs - (current.days - 1) * DAY_MS;
  return { from:dateKey(previousFromMs), to:dateKey(previousToMs), days:current.days };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function delta(current, previous) {
  const a = finite(current);
  const b = finite(previous);
  if (a == null || b == null) return { current:a, previous:b, value:null, pct:null, available:false };
  const value = a - b;
  const pct = b === 0 ? (a === 0 ? 0 : null) : value / Math.abs(b) * 100;
  return { current:a, previous:b, value, pct, available:true };
}

function normalizeIdentity(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
}

function productKeys(item = {}) {
  return [item.nmID, item.vendorCode, item.key]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function buildProductMap(products = []) {
  const map = new Map();
  for (const item of Array.isArray(products) ? products : []) {
    const keys = productKeys(item);
    if (!keys.length) continue;
    let current = keys.map(key => map.get(key)).find(Boolean);
    if (!current) current = item;
    for (const key of keys) map.set(key, current);
  }
  return map;
}

function pairedProducts(currentProducts = [], previousProducts = []) {
  const currentMap = buildProductMap(currentProducts);
  const previousMap = buildProductMap(previousProducts);
  const seen = new Set();
  const rows = [];
  const all = [...(Array.isArray(currentProducts) ? currentProducts : []), ...(Array.isArray(previousProducts) ? previousProducts : [])];
  for (const item of all) {
    const keys = productKeys(item);
    const stable = keys[0];
    if (!stable || seen.has(stable)) continue;
    const current = keys.map(key => currentMap.get(key)).find(Boolean) || null;
    const previous = keys.map(key => previousMap.get(key)).find(Boolean) || null;
    seen.add(stable);
    rows.push({
      key:stable,
      nmID:current?.nmID ?? previous?.nmID ?? null,
      vendorCode:current?.vendorCode || previous?.vendorCode || '',
      title:current?.title || previous?.title || 'Товар',
      current,
      previous,
      revenue:delta(current?.revenue ?? 0, previous?.revenue ?? 0),
      profit:delta(current?.profit, previous?.profit),
      sales:delta(current?.sales ?? current?.salesCount ?? 0, previous?.sales ?? previous?.salesCount ?? 0),
      returns:delta(current?.returns ?? current?.returnsCount ?? 0, previous?.returns ?? previous?.returnsCount ?? 0),
      returnRate:delta(current?.returnRate ?? 0, previous?.returnRate ?? 0),
      advertising:delta(current?.advertising ?? current?.adSpend ?? 0, previous?.advertising ?? previous?.adSpend ?? 0),
    });
  }
  return rows;
}

function magnitude(value) {
  return Math.abs(Number(value || 0));
}

function significant(change, { minAbs = 1, minPct = 5 } = {}) {
  if (!change?.available || change.value == null) return false;
  if (magnitude(change.value) < minAbs) return false;
  if (change.pct == null) return true;
  return magnitude(change.pct) >= minPct;
}

function confidenceLevel({ current, previous, profitAvailable, comparisonCoverage }) {
  const salesReady = Boolean(current?.availability?.sales && previous?.availability?.sales);
  const ordersReady = Boolean(current?.availability?.orders && previous?.availability?.orders);
  const coverageReady = comparisonCoverage !== false;
  if (salesReady && ordersReady && coverageReady && profitAvailable) return 'high';
  if ((salesReady || ordersReady) && coverageReady) return 'medium';
  return 'low';
}

function cause(id, type, title, evidence, impact, options = {}) {
  return {
    id,
    type,
    title,
    evidence,
    impact:finite(impact),
    impactKind:options.impactKind || 'money',
    confidence:options.confidence || 'medium',
    product:options.product || null,
    action:options.action || null,
    metric:options.metric || null,
  };
}

function productLabel(item = {}) {
  const code = item.vendorCode || item.nmID || '';
  return `${item.title || 'Товар'}${code ? ` (${code})` : ''}`;
}

function buildProductDrivers(currentProducts = [], previousProducts = []) {
  const rows = pairedProducts(currentProducts, previousProducts);
  const revenueLosses = rows
    .filter(row => Number(row.revenue?.value || 0) < 0)
    .sort((a,b) => Number(a.revenue.value) - Number(b.revenue.value))
    .slice(0,8);
  const profitLosses = rows
    .filter(row => row.profit?.available && Number(row.profit.value || 0) < 0)
    .sort((a,b) => Number(a.profit.value) - Number(b.profit.value))
    .slice(0,8);
  const returnGrowth = rows
    .filter(row => Number(row.returns?.value || 0) > 0 || Number(row.returnRate?.value || 0) >= 5)
    .sort((a,b) => (Number(b.returns?.value || 0) * 3 + Number(b.returnRate?.value || 0)) - (Number(a.returns?.value || 0) * 3 + Number(a.returnRate?.value || 0)))
    .slice(0,8);
  return { rows,revenueLosses,profitLosses,returnGrowth };
}

function buildDecisionAnalysis({ current, previous, period, comparePeriod, comparisonCoverage = true } = {}) {
  const currentPeriod = normalizePeriod(period || current?.period || {});
  const previousPeriod = normalizePeriod(comparePeriod || previous?.period || {}) || previousEqualPeriod(currentPeriod || {});
  if (!currentPeriod || !previousPeriod || !current || !previous) {
    return { available:false, warning:'Для анализа изменений нужен выбранный период и предыдущий сопоставимый период.' };
  }

  const currentSummary = current.summary || {};
  const previousSummary = previous.summary || {};
  const metrics = {
    revenue:delta(currentSummary.revenue, previousSummary.revenue),
    orders:delta(currentSummary.orders, previousSummary.orders),
    sales:delta(currentSummary.sales, previousSummary.sales),
    returns:delta(currentSummary.returns, previousSummary.returns),
    returnRate:delta(currentSummary.returnRate, previousSummary.returnRate),
    operatingProfit:delta(currentSummary.operatingProfit, previousSummary.operatingProfit),
    margin:delta(currentSummary.margin, previousSummary.margin),
    advertising:delta(currentSummary.advertising, previousSummary.advertising),
    commission:delta(currentSummary.commission, previousSummary.commission),
    logistics:delta(currentSummary.logistics, previousSummary.logistics),
    storage:delta(currentSummary.storage, previousSummary.storage),
    acceptance:delta(currentSummary.acceptance, previousSummary.acceptance),
    acquiring:delta(currentSummary.acquiring, previousSummary.acquiring),
    penalties:delta(currentSummary.penalties, previousSummary.penalties),
    deductions:delta(currentSummary.deductions, previousSummary.deductions),
  };

  const profitAvailable = metrics.operatingProfit.available;
  const drivers = buildProductDrivers(current.products || [], previous.products || []);
  const causes = [];

  if (Number(metrics.revenue.value || 0) < 0 && significant(metrics.revenue,{minAbs:500,minPct:3})) {
    const top = drivers.revenueLosses[0];
    causes.push(cause(
      'revenue-drop','sales',
      'Снизилась выручка',
      top ? `Самый большой вклад в снижение дал ${productLabel(top)}: выручка изменилась на ${Math.round(top.revenue.value)} ₽.` : 'Выручка текущего периода ниже предыдущего.',
      magnitude(metrics.revenue.value),
      { impactKind:'revenue_at_risk',confidence:'high',metric:'revenue',action:top ? `Проверь продажи, остаток и продвижение ${productLabel(top)}.` : 'Проверь товары с самым большим падением выручки.' },
    ));
  }

  const directExpenseMetrics = [
    ['advertising','Реклама стала дороже','advertising'],
    ['logistics','Выросла логистика','logistics'],
    ['commission','Выросла комиссия WB','finance'],
    ['storage','Выросло хранение','stocks'],
    ['acceptance','Выросла платная приёмка','finance'],
    ['acquiring','Вырос эквайринг','finance'],
    ['penalties','Выросли штрафы','finance'],
    ['deductions','Выросли удержания','finance'],
  ];
  for (const [metric,title,type] of directExpenseMetrics) {
    const change = metrics[metric];
    if (Number(change?.value || 0) <= 0 || !significant(change,{minAbs:300,minPct:5})) continue;
    causes.push(cause(`expense-${metric}`,type,title,`Расход вырос на ${Math.round(change.value)} ₽ относительно предыдущего сопоставимого периода.`,magnitude(change.value),{
      impactKind:'direct_expense',confidence:currentSummary?.[`${metric}Source`] === 'manual' ? 'medium' : 'high',metric,
      action:metric === 'advertising' ? 'Открой кампании с расходом без достаточного вклада в продажи и прибыль.'
        : metric === 'logistics' ? 'Проверь товары и схемы FBS/FBO, где выросла стоимость логистики.'
          : metric === 'storage' ? 'Проверь медленные остатки и товары с избыточным запасом.'
            : 'Открой финансовый реестр и проверь операции, давшие рост расхода.',
    }));
  }

  if ((Number(metrics.returns.value || 0) > 0 || Number(metrics.returnRate.value || 0) >= 3) && (significant(metrics.returns,{minAbs:2,minPct:10}) || Number(metrics.returnRate.value || 0) >= 3)) {
    const top = drivers.returnGrowth[0];
    const averageRevenuePerSale = finite(currentSummary.sales) > 0 && finite(currentSummary.revenue) != null
      ? Math.max(0, Number(currentSummary.revenue) / Math.max(1, Number(currentSummary.sales))) : null;
    const extraReturns = Math.max(0, Number(metrics.returns.value || 0));
    const estimated = averageRevenuePerSale == null ? null : Math.round(extraReturns * averageRevenuePerSale);
    causes.push(cause('returns-growth','quality','Возвраты ухудшились',top
      ? `Наибольший сигнал у ${productLabel(top)}: возвраты ${top.returns.value >= 0 ? '+' : ''}${Math.round(top.returns.value || 0)} шт., доля ${top.returnRate.value >= 0 ? '+' : ''}${Math.round(Number(top.returnRate.value || 0) * 10) / 10} п.п.`
      : `Возвраты выросли на ${Math.round(extraReturns)} шт., доля изменилась на ${Math.round(Number(metrics.returnRate.value || 0) * 10) / 10} п.п.`,estimated,{
        impactKind:'estimated_revenue_risk',confidence:'medium',metric:'returns',
        action:top ? `Свяжи отзывы и причины возврата по ${productLabel(top)} и проверь карточку/размерную сетку/партию.` : 'Свяжи возвраты с отзывами и проверь товары с ростом доли возврата.',
      }));
  }

  if (drivers.profitLosses.length && profitAvailable) {
    const top = drivers.profitLosses[0];
    causes.push(cause('product-profit-driver','product',`Просела экономика ${productLabel(top)}`,
      `Прибыль товара изменилась на ${Math.round(top.profit.value)} ₽; выручка — на ${Math.round(top.revenue.value || 0)} ₽.`,magnitude(top.profit.value),{
        impactKind:'profit_delta',confidence:'high',metric:'operatingProfit',product:{nmID:top.nmID,vendorCode:top.vendorCode,title:top.title},
        action:`Открой SKU 360 по ${productLabel(top)} и проверь цену, рекламу, возвраты и затраты.`,
      }));
  } else if (drivers.revenueLosses.length) {
    const top = drivers.revenueLosses[0];
    if (!causes.some(item => item.id === 'revenue-drop')) causes.push(cause('product-revenue-driver','product',`Сильнее всего просел ${productLabel(top)}`,
      `Выручка товара изменилась на ${Math.round(top.revenue.value)} ₽.`,magnitude(top.revenue.value),{
        impactKind:'revenue_at_risk',confidence:'high',metric:'revenue',product:{nmID:top.nmID,vendorCode:top.vendorCode,title:top.title},
        action:`Проверь остаток, поисковую видимость и рекламу ${productLabel(top)}.`,
      }));
  }

  causes.sort((a,b) => Number(b.impact || 0) - Number(a.impact || 0));
  const uniqueCauses = [];
  const seen = new Set();
  for (const item of causes) {
    const key = `${item.type}:${item.product?.nmID || item.metric || item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueCauses.push(item);
    if (uniqueCauses.length >= 5) break;
  }

  const headlineMetric = profitAvailable ? 'operatingProfit' : 'revenue';
  const headlineChange = metrics[headlineMetric];
  let state = 'stable';
  if (Number(headlineChange?.value || 0) < 0 && significant(headlineChange,{minAbs:headlineMetric === 'operatingProfit' ? 300 : 500,minPct:3})) state = 'down';
  else if (Number(headlineChange?.value || 0) > 0 && significant(headlineChange,{minAbs:headlineMetric === 'operatingProfit' ? 300 : 500,minPct:3})) state = 'up';

  const biggestCause = uniqueCauses[0] || null;
  const positiveProduct = drivers.rows
    .filter(row => Number((profitAvailable ? row.profit?.value : row.revenue?.value) || 0) > 0)
    .sort((a,b) => Number((profitAvailable ? b.profit?.value : b.revenue?.value) || 0) - Number((profitAvailable ? a.profit?.value : a.revenue?.value) || 0))[0] || null;

  let action;
  if (biggestCause?.action) {
    action = { priority:1,title:'Сначала устранить главный денежный фактор',text:biggestCause.action,reason:biggestCause.title,estimatedImpact:biggestCause.impact,impactKind:biggestCause.impactKind };
  } else if (state === 'up' && positiveProduct) {
    action = { priority:1,title:'Зафиксировать источник роста',text:`Проверь, что именно дало рост ${productLabel(positiveProduct)}, и сохрани это как рабочую гипотезу для повторения.`,reason:'Период лучше предыдущего',estimatedImpact:null,impactKind:'growth_protection' };
  } else {
    action = { priority:1,title:'Не менять всё сразу',text:'Критического денежного отклонения не видно. Сохрани текущие настройки и проверь следующий сопоставимый период.',reason:'Существенных негативных изменений не найдено',estimatedImpact:null,impactKind:'monitoring' };
  }

  const confidence = confidenceLevel({ current,previous,profitAvailable,comparisonCoverage });
  const warnings = [];
  if (!profitAvailable) warnings.push('Себестоимость настроена не для всех расчётов, поэтому главный денежный ориентир — выручка, а не прибыль.');
  if (!current?.availability?.sales || !previous?.availability?.sales) warnings.push('Продажи покрыты не полностью хотя бы в одном из сравниваемых периодов.');
  if (comparisonCoverage === false) warnings.push('Предыдущий период покрыт данными не полностью; выводы предварительные.');

  return {
    available:true,
    period:currentPeriod,
    comparePeriod:previousPeriod,
    state,
    headlineMetric,
    headlineChange,
    metrics,
    causes:uniqueCauses,
    action,
    confidence,
    warnings,
    productDrivers:{
      revenueLosses:drivers.revenueLosses.slice(0,5).map(row=>({nmID:row.nmID,vendorCode:row.vendorCode,title:row.title,revenueDelta:row.revenue.value,profitDelta:row.profit.value,salesDelta:row.sales.value,returnsDelta:row.returns.value})),
      profitLosses:drivers.profitLosses.slice(0,5).map(row=>({nmID:row.nmID,vendorCode:row.vendorCode,title:row.title,revenueDelta:row.revenue.value,profitDelta:row.profit.value,salesDelta:row.sales.value,returnsDelta:row.returns.value})),
      returnGrowth:drivers.returnGrowth.slice(0,5).map(row=>({nmID:row.nmID,vendorCode:row.vendorCode,title:row.title,returnsDelta:row.returns.value,returnRateDelta:row.returnRate.value})),
    },
  };
}

module.exports = {
  normalizePeriod,
  previousEqualPeriod,
  delta,
  pairedProducts,
  buildDecisionAnalysis,
};
