'use strict';

const crypto = require('node:crypto');
const { detectModules, MODULES } = require('./elModuleRegistry.cjs');
const { BUSINESS_RE } = require('./elModeRouter.cjs');
const { normalizeElProfile, createVoiceContext, humorLine, socialResponse, noDataResponse, reactionFor } = require('./elPersonality.cjs');
const { formatRuPeriod, formatRuDate, validDateKey } = require('./elTemporal.cjs');

const money = (value) => value == null || !Number.isFinite(Number(value)) ? 'нет данных' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value))} ₽`;
const number = (value) => value == null || !Number.isFinite(Number(value)) ? 'нет данных' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value));
const percent = (value) => value == null || !Number.isFinite(Number(value)) ? 'нет данных' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value))}%`;

function moduleData(result) {
  if (!result) return null;
  return result.data && typeof result.data === 'object' ? result.data : result;
}

function periodLabel(data, context = {}) {
  const period = data?.period || context?.period;
  return formatRuPeriod(period || {});
}

function periodKeys(period = {}) {
  return {
    from:validDateKey(period?.from || period?.dateFrom || period?.date_from),
    to:validDateKey(period?.to || period?.dateTo || period?.date_to),
  };
}

function samePeriod(left = {}, right = {}) {
  const a = periodKeys(left);
  const b = periodKeys(right);
  if (!a.from || !a.to || !b.from || !b.to) return false;
  return a.from === b.from && a.to === b.to;
}

function titleOf(item = {}) {
  const article = item.vendorCode || item.nmID || item.key || '';
  return `${item.title || item.name || 'Товар'}${article ? ` (${article})` : ''}`;
}

function topItems(items, score, limit = 5) {
  return [...(Array.isArray(items) ? items : [])]
    .filter(Boolean)
    .sort((a, b) => Number(score(b) || 0) - Number(score(a) || 0))
    .slice(0, limit);
}

function mildHumor(voice, key) {
  const phrase = humorLine(voice, key);
  return phrase ? ` ${phrase}` : '';
}

function coverageWarnings(data) {
  const warnings = [];
  if (data?.warning) warnings.push(data.warning);
  if (Array.isArray(data?.syncWarnings)) warnings.push(...data.syncWarnings.slice(0, 2));
  if (data?.coverage?.note) warnings.push(data.coverage.note);
  return [...new Set(warnings.filter(Boolean))]
    .filter(item => !/timeout exceeded when trying to connect|connection timeout|database.*reconnect/i.test(String(item)));
}

function fulfillmentOrders(data = {}) {
  const fulfillment = data?.fulfillment && typeof data.fulfillment === 'object' ? data.fulfillment : {};
  const fbs = Number(fulfillment?.FBS?.orders ?? fulfillment?.fbs?.orders ?? 0);
  const fbo = Number(fulfillment?.FBO?.orders ?? fulfillment?.fbo?.orders ?? 0);
  const total = Number(data?.summary?.orders ?? fulfillment?.totalOrders ?? 0);
  const classified = Number.isFinite(Number(fulfillment?.classifiedOrders))
    ? Number(fulfillment.classifiedOrders)
    : Math.max(0,fbs) + Math.max(0,fbo);
  const unknown = Number.isFinite(Number(fulfillment?.unknownOrders))
    ? Math.max(0,Number(fulfillment.unknownOrders))
    : Math.max(0,total-classified);
  const available = Boolean(fulfillment?.ordersAvailable ?? fulfillment?.available ?? (classified > 0 || total === 0));
  return { fbs:Math.max(0,fbs),fbo:Math.max(0,fbo),total:Math.max(0,total),classified:Math.max(0,classified),unknown,available };
}

function followupMetric(context = {}, message = '') {
  return context?.conversationFollowup?.metric || (/(?:^|[^a-zа-я0-9])(?:fbs|фбс)(?=$|[^a-zа-я0-9])/i.test(message) ? 'fbs_orders'
    : /(?:^|[^a-zа-я0-9])(?:fbo|фбо)(?=$|[^a-zа-я0-9])/i.test(message) ? 'fbo_orders'
      : /возврат/i.test(message) ? 'returns'
        : /выручк/i.test(message) ? 'revenue'
          : /заказ/i.test(message) ? 'orders'
            : /товар|артикул|лидер|топ/i.test(message) ? 'products' : null);
}

function isConversationalFollowup(context = {}) {
  return Boolean(context?.conversationFollowup?.isFollowup);
}

function screenDailyRows(screen = {}) {
  const sources = [screen.dailyTrend, screen.salesDailyTrend, screen?.analytics?.dailyTrend];
  const byDate = new Map();
  for (const rows of sources) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const date = validDateKey(row?.date || row?.day || row?.dt);
      if (!date) continue;
      byDate.set(date, {
        date,
        revenue:Number(row?.revenue || 0),
        orders:Number(row?.orders || 0),
        sales:Number(row?.sales || 0),
        returns:Number(row?.returns || 0),
      });
    }
  }
  return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
}

function screenSalesCoverage(screen = {}) {
  const coverage = screen.periodCoverage || screen.dataCoverage || {};
  const sales = coverage.sales && typeof coverage.sales === 'object' ? coverage.sales : {};
  const orders = coverage.orders && typeof coverage.orders === 'object' ? coverage.orders : {};
  const from = [sales.from,orders.from].map(validDateKey).filter(Boolean).sort()[0] || null;
  const to = [sales.to,orders.to].map(validDateKey).filter(Boolean).sort().at(-1) || null;
  return { from,to };
}

function exactDailySalesFromScreen(context = {}) {
  const screen = context?.screen && typeof context.screen === 'object' ? context.screen : {};
  const period = periodKeys(context.period || {});
  if (!period.from || period.from !== period.to) return null;
  const rows = screenDailyRows(screen);
  const row = rows.find(item => item.date === period.from);
  const coverage = screenSalesCoverage(screen);
  const observed = row && [row.revenue,row.orders,row.sales,row.returns].some(value => Number(value || 0) !== 0);
  const covered = Boolean(coverage.from && coverage.to && period.from >= coverage.from && period.from <= coverage.to);
  if (row && (observed || covered)) {
    return {
      available:true,
      period:{ from:period.from,to:period.to,days:1 },
      periodDataAvailable:true,
      selectedRows:{ orders:Number(row.orders || 0),sales:Number(row.sales || 0) },
      summary:{
        revenue:Number(row.revenue || 0),orders:Number(row.orders || 0),sales:Number(row.sales || 0),returns:Number(row.returns || 0),
        returnRate:Number(row.sales || 0) > 0 ? Number(row.returns || 0) / Number(row.sales || 0) * 100 : 0,
      },
      topByRevenue:[],topBySales:[],
      source:'screen_daily_trend',
    };
  }
  const latest = coverage.to || rows.at(-1)?.date || null;
  if (latest && period.from > latest) {
    return {
      available:true,
      period:{ from:period.from,to:period.to,days:1 },
      periodDataAvailable:false,
      selectedRows:{orders:0,sales:0},
      latestAvailableDate:latest,
      summary:{revenue:null,orders:null,sales:null,returns:null,returnRate:null},
      topByRevenue:[],topBySales:[],
      source:'screen_daily_coverage',
    };
  }
  return null;
}

function screenFallback(moduleName, context = {}) {
  const screen = context?.screen && typeof context.screen === 'object' ? context.screen : {};
  if (moduleName === 'sales') {
    const exactDaily = exactDailySalesFromScreen(context);
    if (exactDaily) return exactDaily;
  }
  const summary = screen?.summary && typeof screen.summary === 'object' ? screen.summary : null;
  if (!summary) return null;
  const has = (...keys) => keys.some((key) => summary[key] != null && Number.isFinite(Number(summary[key])));
  const period = screen.period || context.period || null;
  if (context?.period && (!screen.period || !samePeriod(context.period, screen.period))) return null;
  if (moduleName === 'sales' && has('revenue','orders','sales','returns')) {
    return { available:true, summary, period, fulfillment:screen.fulfillment || null, topByRevenue:[], topBySales:[], warning:'Использованы подтверждённые показатели текущего экрана ELISEI; товарная детализация через внутренний мост временно недоступна.' };
  }
  if (moduleName === 'overview' && has('revenue','orders','sales','stockUnits','operatingProfit')) {
    return { available:true, summary, period, criticalProducts:[], topRecommendations:[], warning:'Использованы подтверждённые показатели текущего экрана ELISEI.' };
  }
  if (moduleName === 'stocks' && has('stockUnits','zeroStock','lowStock','slowStock')) {
    return { available:true, summary, period, lowStockProducts:[], slowStockProducts:[], warning:'Использован текущий сводный снимок остатков ELISEI; детализация товаров временно недоступна.' };
  }
  if (moduleName === 'finance' && has('revenue','operatingProfit','margin')) {
    return { available:true, summary, period, missingCostProducts:[], lossMakingProducts:[], warning:'Использованы подтверждённые финансовые показатели текущего экрана ELISEI; построчная детализация временно недоступна.' };
  }
  if (moduleName === 'advertising') {
    const advertising = screen.advertising && typeof screen.advertising === 'object' ? screen.advertising : null;
    if (advertising) {
      const campaigns = Array.isArray(advertising.campaigns) ? advertising.campaigns : [];
      const productRows = Array.isArray(advertising.productRows) ? advertising.productRows : [];
      const totals = advertising.totals && typeof advertising.totals === 'object' ? advertising.totals : advertising;
      if (campaigns.length || productRows.length || ['spend','revenue','orders'].some(key => totals[key] != null && Number.isFinite(Number(totals[key])))) {
        return {
          available:true,
          summary:{ spend:totals.spend, operatingProfit:summary?.operatingProfit, margin:summary?.margin },
          advertising:{
            totals,
            period,
            statsAvailable:Boolean(advertising.statsAvailable || campaigns.some(item => item?.statsStatus === 'loaded') || Number(totals.revenue || totals.orders || 0) > 0),
            campaigns,
            productRows,
          },
          productsWithAds:[],
          warning:'Использован текущий рекламный снимок экрана ELISEI; если WB ещё не отдал всю статистику, часть кампаний может быть без выручки/заказов.',
        };
      }
    }
  }
  return null;
}

function formatOverview(data, tone) {
  const s = data?.summary || {};
  const critical = Array.isArray(data?.criticalProducts) ? data.criticalProducts : [];
  const recs = Array.isArray(data?.topRecommendations) ? data.topRecommendations : [];
  const lines = [
    `Сводка за ${periodLabel(data)}:`,
    `• выручка — ${money(s.revenue)}; продажи — ${number(s.sales)}; заказы — ${number(s.orders)};`,
    `• возвраты — ${number(s.returns)} (${percent(s.returnRate)});`,
    `• операционная прибыль — ${money(s.operatingProfit)}; маржа — ${percent(s.margin)};`,
    `• остаток — ${number(s.stockUnits)} шт.; заканчиваются — ${number(s.lowStock)}; без остатка — ${number(s.zeroStock)}.`,
  ];
  if (critical.length) lines.push(`В первую очередь проверь: ${critical.slice(0, 4).map(titleOf).join(', ')}.`);
  if (recs.length) lines.push(`Главное действие: ${recs[0].title || recs[0].text || 'проверить рекомендации на главной'}.`);
  lines.push(mildHumor(tone, 'default'));
  return lines.filter(Boolean).join('\n');
}

function formatSales(data, tone, options = {}) {
  const s = data?.summary || {};
  const top = data?.topByRevenue || data?.topBySales || [];
  const message = String(options.message || tone?.message || '');
  const context = options.context || {};
  const name = String(options?.identity?.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  const asksRevenue = /выручк/i.test(message);
  const asksProductDetail = /товар|артикул|лидер|топ|что\s+продал|по\s+каким/i.test(message);
  const asksComparison = /сравн|динамик|рост|паден|измен/i.test(message);
  const dateLabel = periodLabel(data, context);
  const metric = followupMetric(context,message);
  const followup = isConversationalFollowup(context);
  const lines = [];
  if (data?.periodDataAvailable === false) {
    const latest = validDateKey(data?.latestAvailableDate);
    const latestText = latest ? ` Последняя подтверждённая дата в потоках — ${formatRuDate(latest,true)}.` : '';
    const action = 'Общие потоки продаж и заказов подключены, поэтому переподключать WB не нужно — дождёмся следующей синхронизации.';
    return `${prefix}за ${dateLabel} подтверждённые строки продаж и заказов пока не дошли в ELISEI.${latestText} ${action}`.trim();
  }

  if (['fbs_orders','fbo_orders'].includes(metric) || /(?:^|[^a-zа-я0-9])(?:fbs|fbo|фбс|фбо)(?=$|[^a-zа-я0-9])/i.test(message)) {
    const split = fulfillmentOrders(data);
    if (!split.available || (split.total > 0 && split.classified === 0)) {
      return `${prefix}за ${dateLabel} загружено ${number(split.total)} заказов, но схема FBS/FBO по ним пока не подтверждена. Нулевую долю FBS я не показываю, чтобы не выдать отсутствие детализации за факт.`;
    }
    const fbsShare = split.total > 0 ? split.fbs / split.total * 100 : 0;
    const fboShare = split.total > 0 ? split.fbo / split.total * 100 : 0;
    const parts = [`Из ${number(split.total)} заказов за ${dateLabel}: FBS — ${number(split.fbs)} (${percent(fbsShare)}), FBO — ${number(split.fbo)} (${percent(fboShare)})`];
    if (split.unknown > 0) parts.push(`Без подтверждённой схемы — ${number(split.unknown)}. Эти заказы не добавлены ни в FBS, ни в FBO.`);
    else parts[0] += '.';
    return `${prefix}${parts.join(' ')}`.trim();
  }

  if (followup && metric === 'returns') {
    const rate = Number(s.sales || 0) > 0 ? Number(s.returns || 0) / Number(s.sales || 0) * 100 : s.returnRate;
    return `${prefix}за ${dateLabel} возвратов — ${number(s.returns)} шт., это ${percent(rate)} от проданных единиц.`;
  }
  if (followup && metric === 'orders') return `${prefix}за ${dateLabel} заказов — ${number(s.orders)}.`;
  if (followup && metric === 'sales') return `${prefix}за ${dateLabel} проданных единиц — ${number(s.sales)}.`;
  if (followup && metric === 'revenue') return `${prefix}за ${dateLabel} выручка составила ${money(s.revenue)}.`;

  if (asksRevenue && !asksProductDetail && !asksComparison) {
    lines.push(`${prefix}за ${dateLabel} выручка составила ${money(s.revenue)}. Заказов — ${number(s.orders)}, проданных единиц — ${number(s.sales)}. Возвраты — ${number(s.returns)} шт.`);
  } else {
    lines.push(`Продажи за ${dateLabel}: выручка — ${money(s.revenue)}; заказов — ${number(s.orders)}; проданных единиц — ${number(s.sales)}; возвратов — ${number(s.returns)} (${percent(s.returnRate)}).`);
  }
  if (top.length && asksProductDetail) lines.push(`Лидеры по выручке: ${top.slice(0, 5).map((item) => `${titleOf(item)} — ${money(item.revenue)}`).join('; ')}.`);
  if (!top.length && asksProductDetail) lines.push('Товарная детализация продаж за этот период пока не загружена.');
  if (!asksRevenue || asksProductDetail || asksComparison) lines.push(mildHumor(tone, 'default'));
  return lines.filter(Boolean).join('\n');
}

function campaignMetrics(campaign = {}) {
  const spend = Number(campaign.spend || 0);
  const revenue = Number(campaign.revenue || 0);
  const clicks = Number(campaign.clicks || 0);
  const orders = Number(campaign.orders || 0);
  return {
    ...campaign,
    spend,
    revenue,
    drr: revenue > 0 ? spend / revenue * 100 : null,
    roas: spend > 0 ? revenue / spend : null,
    romi: spend > 0 ? (revenue - spend) / spend * 100 : campaign.romi ?? null,
    cpo: orders > 0 ? spend / orders : null,
    cpc: clicks > 0 ? spend / clicks : campaign.cpc ?? null,
  };
}

function formatAdvertising(data, tone, options = {}) {
  const s = data?.summary || {};
  const ads = data?.advertising || {};
  const totals = ads.totals || {};
  const campaigns = (Array.isArray(ads.campaigns) ? ads.campaigns : []).map(campaignMetrics).filter((item) => item.spend > 0 || item.statsStatus === 'loaded');
  const message = String(options.message || tone?.message || '');
  const asksWinners = /тащ|принос|бабк|деньг|какие.*(?:дают|делают)|окуп/i.test(message) && !/съеда|жр|слива|минус|убыт/i.test(message);
  const winners = [...campaigns].filter(item => Number(item.revenue || 0) > 0 || Number(item.orders || 0) > 0).sort((a,b) => {
    const aScore = Number(a.revenue || 0) - Number(a.spend || 0);
    const bScore = Number(b.revenue || 0) - Number(b.spend || 0);
    if (bScore !== aScore) return bScore - aScore;
    return Number(b.roas || 0) - Number(a.roas || 0);
  }).slice(0,5);
  const risky = [...campaigns].sort((a, b) => {
    const aScore = a.revenue <= 0 && a.spend > 0 ? 100000 + a.spend : Number(a.drr || 0);
    const bScore = b.revenue <= 0 && b.spend > 0 ? 100000 + b.spend : Number(b.drr || 0);
    return bScore - aScore;
  }).slice(0, 5);
  const lossProducts = (Array.isArray(data?.productsWithAds) ? data.productsWithAds : [])
    .filter((item) => item.profit != null && Number(item.profit) < 0)
    .sort((a, b) => Number(a.profit) - Number(b.profit))
    .slice(0, 5);
  const totalDrr = totals.crr ?? (Number(totals.revenue) > 0 ? Number(totals.spend || 0) / Number(totals.revenue) * 100 : null);
  const lines = [
    `Реклама за ${ads.period?.from && ads.period?.to ? `${ads.period.from} — ${ads.period.to}` : periodLabel(data)}: расходы ${money(totals.spend ?? s.spend)}, рекламная выручка ${money(totals.revenue)}, заказы ${number(totals.orders)}, ДРР ${percent(totalDrr)}.`,
  ];
  if (ads.snapshotFallback) lines.push('Точного рекламного среза за выбранный период пока нет, поэтому беру последний сохранённый снимок кампаний и не выдаю его за полный факт периода.');
  if (!ads.statsAvailable) lines.push('Статистика кампаний WB ещё не загружена полностью — выводы по эффективности ограничены.');
  if (asksWinners) {
    if (winners.length) {
      lines.push('Кампании, которые сейчас тащат деньги по подтверждённой рекламной статистике:');
      winners.forEach((item) => lines.push(`• ${item.name || `Кампания ${item.advertId || ''}`}: выручка ${money(item.revenue)}, расход ${money(item.spend)}, заказов ${number(item.orders)}, ДРР ${percent(item.drr)}, ROMI ${percent(item.romi)}.`));
      lines.push(`Вывод: держи фокус на ${winners[0].name || `кампании ${winners[0].advertId}`}; масштабировать можно только после проверки прибыли товара, комиссии, логистики и себестоимости.`);
    } else if (campaigns.length) {
      lines.push('По кампаниям вижу расходы, но подтверждённых заказов/рекламной выручки пока нет. Нулём прибыль не считаю: WB мог ещё не отдать статистику.');
      lines.push('Вывод: сейчас нельзя честно назвать “тащит бабки”. Сначала обновить статистику рекламы, потом ранжировать по выручке, ДРР и прибыли товара.');
    }
  } else if (risky.length) {
    lines.push('Кампании, которые нужно проверить первыми:');
    risky.forEach((item) => lines.push(`• ${item.name || `Кампания ${item.advertId || ''}`}: расход ${money(item.spend)}, выручка ${money(item.revenue)}, ДРР ${percent(item.drr)}, заказов ${number(item.orders)}.`));
  }
  if (lossProducts.length) {
    lines.push('Товары с рекламой и отрицательной итоговой прибылью:');
    lossProducts.forEach((item) => lines.push(`• ${titleOf(item)}: реклама ${money(item.advertising)}, прибыль ${money(item.profit)}, маржа ${percent(item.margin)}.`));
  } else if ((data?.productsWithAds || []).length && (data?.productsWithAds || []).every((item) => item.profit == null)) {
    lines.push('Прибыль после рекламы нельзя подтвердить: у рекламируемых товаров не заполнена себестоимость. ДРР и расходы я показываю, но минус не выдумываю.');
  }
  if (!asksWinners) lines.push(`Вывод: ${risky[0] ? `начни с ${risky[0].name || `кампании ${risky[0].advertId}`}` : 'сначала дождись полной статистики кампаний'}.${mildHumor(tone, 'ads')}`);
  return lines.filter(Boolean).join('\n');
}

function formatStocks(data, tone) {
  const s = data?.summary || {};
  const low = Array.isArray(data?.lowStockProducts) ? data.lowStockProducts : [];
  const slow = Array.isArray(data?.slowStockProducts) ? data.slowStockProducts : [];
  const lines = [
    `Остатки: ${number(s.stockUnits)} шт.; без остатка — ${number(s.zeroStock)}; заканчиваются — ${number(s.lowStock)}; избыточные/медленные — ${number(s.slowStock)}; среднее покрытие — ${s.stockCoverDays == null ? 'нет данных' : `${number(s.stockCoverDays)} дн.`}.`,
  ];
  if (low.length) lines.push(`Риск дефицита: ${low.slice(0, 6).map((item) => `${titleOf(item)} — ${number(item.stock)} шт.${item.stockCoverDays != null ? ` / ${number(item.stockCoverDays)} дн.` : ''}`).join('; ')}.`);
  if (slow.length) lines.push(`Замороженный остаток: ${slow.slice(0, 5).map(titleOf).join(', ')}.`);
  lines.push(`Рекомендация: дозаказ рассматривай только для товаров с продажами, нормальной маржой и актуальным сезоном.${mildHumor(tone, 'stocks')}`);
  return lines.filter(Boolean).join('\n');
}

function asksProductPnlDetail(message = '') {
  return /по\s+(?:каждому\s+)?артикул|артикул|товар|nmid|расшифров|детализац|по\s+каждому|эквайринг|комисси|логистик|хранен|штраф|удержан|затрат/i.test(String(message || ''));
}

function asksProfitRevenueGap(message = '') {
  return /почему\s+прибыл[ьи]?\s+(?:ниже|меньше)\s+выручк|прибыл[ьи]?\s+(?:ниже|меньше)\s+выручк|куда\s+делась\s+выручк/i.test(String(message || ''));
}

function asksTurnaroundPlan(message = '') {
  return /(?:кабинет|бизнес|p&l|pnl|прибыл|марж).*(?:минус|убыт|просел|плохо)|(?:вытян|вывест|вытащ).*(?:плюс|прибыл)|(?:решени|план|что\s+делать).*(?:плюс|минус|убыт)|ж[её]стк\w*\s+конкур/i.test(String(message || ''));
}

function asksBusinessPraise(message = '') {
  return /похвал[иь].*(?:делу|кабинет|хорош)|что\s+(?:в\s+кабинете\s+)?(?:уже\s+)?хорош/i.test(String(message || ''));
}

function formatTurnaroundPlan({ financeData, advertisingData, pricingData, procurementData, context = {}, identity = {} } = {}) {
  const name = String(identity?.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  const summary = financeData?.summary || context?.screen?.summary || {};
  const period = periodLabel(financeData || { period:context?.period }, context);
  const revenue = Number(summary.revenue);
  const profit = Number(summary.operatingProfit);
  const gap = Number.isFinite(profit) && profit < 0 ? Math.abs(profit) : 0;
  const expenses = [
    ['логистика', summary.logistics],
    ['комиссия WB', summary.commission],
    ['реклама', summary.advertising],
    ['налог', summary.tax],
    ['себестоимость', summary.cogs],
    ['хранение', summary.storage],
  ].filter(([,value]) => Number(value || 0) > 0).sort((a,b) => Number(b[1] || 0)-Number(a[1] || 0));
  const campaigns = (Array.isArray(advertisingData?.advertising?.campaigns) ? advertisingData.advertising.campaigns : []).map(campaignMetrics);
  const winners = campaigns.filter(item => Number(item.revenue || 0) > 0 || Number(item.orders || 0) > 0)
    .sort((a,b) => (Number(b.revenue || 0)-Number(b.spend || 0)) - (Number(a.revenue || 0)-Number(a.spend || 0))).slice(0,3);
  const burners = campaigns.filter(item => Number(item.spend || 0) > 0 && Number(item.revenue || 0) <= 0)
    .sort((a,b) => Number(b.spend || 0)-Number(a.spend || 0)).slice(0,3);
  const lossProducts = Array.isArray(financeData?.lossMakingProducts) ? financeData.lossMakingProducts.slice(0,4) : [];
  const stockCandidates = Array.isArray(procurementData?.candidates) ? procurementData.candidates.slice(0,4) : [];
  const priceRisks = Array.isArray(pricingData?.lossMakingProducts) ? pricingData.lossMakingProducts.slice(0,4) : lossProducts;
  const lines = [
    `${prefix}по ${period} кабинет в минусе: выручка ${money(revenue)}, операционная прибыль ${money(profit)}, маржа ${percent(summary.margin)}. Чтобы выйти хотя бы в ноль, нужно вернуть примерно ${money(gap)} прибыли без потери продаж.`,
    'План выхода в плюс с учетом жесткой конкуренции:',
  ];
  if (expenses.length) lines.push(`1. Сначала бить по самым большим подтверждённым расходам: ${expenses.slice(0,4).map(([label,value]) => `${label} ${money(value)}`).join('; ')}. Это быстрее, чем просто поднимать цену.`);
  if (burners.length) lines.push(`2. Рекламу не выключать всю: урезать/ставить на паузу кампании без подтверждённой отдачи: ${burners.map(item => `${item.name || `кампания ${item.advertId}`} — расход ${money(item.spend)}, выручка ${money(item.revenue)}`).join('; ')}.`);
  else lines.push('2. Рекламу делить на две корзины: оставить кампании с заказами и приемлемым ДРР, а кампании без выручки держать на минимальном тестовом бюджете до подтверждения статистики.');
  if (winners.length) lines.push(`3. Масштабировать только то, что уже тащит деньги: ${winners.map(item => `${item.name || `кампания ${item.advertId}`} — выручка ${money(item.revenue)}, ДРР ${percent(item.drr)}`).join('; ')}. Перед ростом бюджета проверить прибыль товара, а не только заказы.`);
  if (priceRisks.length) lines.push(`4. Цены трогать точечно: не общий рост по кабинету, а товары с минусом/низкой маржой: ${priceRisks.map(item => `${titleOf(item)} — прибыль ${money(item.profit)}, маржа ${percent(item.margin)}`).join('; ')}. При жесткой конкуренции безопаснее сначала поднять цену на 1-3% или убрать лишнюю скидку, чем резко улететь выше рынка.`);
  else lines.push('4. Цены поднимать осторожно: при высокой конкуренции сначала проверить карточки с отрицательной маржой, затем тестировать +1-3% или снижение скидки, отслеживая заказы 1-2 дня.');
  if (stockCandidates.length) lines.push(`5. Закупки только по товарам с продажами и нормальной экономикой: ${stockCandidates.map(item => `${titleOf(item)} — остаток ${number(item.stock)} шт.`).join('; ')}. Минусовые или без доказанной маржи не дозаказывать.`);
  else lines.push('5. Закупки заморозить для спорных товаров: дозаказывать только то, где есть продажи, остаток заканчивается и после комиссии/логистики/рекламы остается маржа.');
  lines.push('Главное сейчас: не лечить минус выручкой любой ценой. Вытаскиваем прибыль через связку “товарная прибыль -> рекламная отдача -> конкурентная цена -> закупка”, иначе можно просто купить оборот и углубить минус.');
  return lines.filter(Boolean).join('\n');
}

function formatProductPnlDetail(data, tone, options = {}) {
  const rows = Array.isArray(data?.productPnlRows) ? data.productPnlRows : [];
  const message = String(options.message || '');
  const needleMatch = message.match(/(?:артикул|nmid|nmID)\s*([a-zа-яё0-9._/-]+)/i) || message.match(/\b(\d{3,}|[a-zа-яё]{2,}[-_/]?\d{2,})\b/i);
  const needle = String(needleMatch?.[1] || '').toLowerCase();
  const visible = needle
    ? rows.filter(item => [item.vendorCode,item.nmID,item.key,item.title].some(value => String(value || '').toLowerCase().includes(needle)))
    : rows;
  const selected = visible.slice(0, needle ? 8 : 7);
  const lines = [`Товарный P&L за ${periodLabel(data)}: ${rows.length ? `${number(rows.length)} строк по артикулам` : 'пока нет товарных строк'}.`];
  if (!rows.length) {
    lines.push('Общая финансовая сводка может быть доступна, но построчная привязка к товарам за этот период ещё не подтверждена. Нули по артикулам не выдумываю.');
    return lines.join('\n');
  }
  if (needle && !selected.length) {
    lines.push(`По запросу «${needle}» товар в текущем периоде не найден. Проверь период или открой поиск по артикулу в таблице «Деньги по каждому артикулу».`);
    return lines.join('\n');
  }
  for (const item of selected) {
    const financeSource = item.financeSource === 'wb_finance_api' ? 'WB финансы' : 'резервный расчёт';
    const profit = item.profit == null ? 'прибыль не рассчитана: нужна себестоимость' : `прибыль ${money(item.profit)}, маржа ${percent(item.margin)}`;
    lines.push(`• ${titleOf(item)}: выручка ${money(item.revenue)}, продажи ${number(item.sales)}, реклама ${money(item.advertising)}, комиссия ${money(item.commission)}, логистика ${money(item.logistics)}, эквайринг ${money(item.acquiring)}, хранение ${money(item.storage)}, штрафы/удержания ${money(Number(item.penalties || 0)+Number(item.deductions || 0))}, все затраты ${money(item.expenses)}, ${profit}. Источник: ${financeSource}.`);
  }
  if (!needle && visible.length > selected.length) lines.push(`Показал первые ${selected.length} строк с самым заметным денежным эффектом. Полный список доступен в «Аналитика» → «Деньги по каждому артикулу» и в CSV-выгрузке.`);
  const missing = Array.isArray(data?.missingCostProducts) ? data.missingCostProducts : [];
  if (missing.length) lines.push(`Ограничение: у ${number(missing.length)} товаров не заполнена себестоимость, поэтому прибыль по ним скрыта, а не показана нулём.`);
  lines.push('Следующее действие: открой самый убыточный или самый дорогой по расходам артикул в SKU 360 и проверь цену, рекламу и возвраты.');
  return lines.filter(Boolean).join('\n');
}

function formatProfitRevenueGap(data, tone, options = {}) {
  const s = data?.summary || {};
  const period = periodLabel(data, options.context);
  const expenses = [
    ['себестоимость', s.cogs],
    ['комиссия WB', s.commission],
    ['логистика', s.logistics],
    ['реклама', s.advertising],
    ['эквайринг', s.acquiring],
    ['хранение', s.storage],
    ['штрафы/удержания', Number(s.penalties || 0) + Number(s.deductions || 0)],
    ['налог', s.tax],
    ['постоянные расходы', s.fixed],
  ].filter(([,value]) => Number(value || 0) !== 0);
  const lines = [
    `Прибыль ниже выручки за ${period}, потому что выручка — это деньги до расходов, а прибыль остаётся после WB-комиссии, логистики, рекламы, себестоимости и прочих списаний.`,
    `Сейчас: выручка ${money(s.revenue)}, операционная прибыль ${money(s.operatingProfit)}, маржа ${percent(s.margin)}.`,
  ];
  if (expenses.length) {
    lines.push(`Что съело разницу: ${expenses.map(([label,value]) => `${label} ${money(value)}`).join('; ')}.`);
  } else {
    lines.push('Расходная детализация за период пока неполная, поэтому я не буду раскладывать разницу выдуманными нулями.');
  }
  const controllable = expenses
    .filter(([label]) => !['себестоимость','налог'].includes(label))
    .sort((a,b) => Math.abs(Number(b[1] || 0))-Math.abs(Number(a[1] || 0)));
  const biggest = controllable[0] || expenses[0];
  if (biggest) {
    lines.push(`Первым проверь: ${biggest[0]} — это самый заметный управляемый расход в этом ответе. Себестоимость тоже важна, но её сначала надо сверить по артикулам, а не пытаться “урезать” общей кнопкой.`);
  }
  return lines.filter(Boolean).join('\n');
}

function formatFinance(data, tone, options = {}) {
  if (asksProfitRevenueGap(options.message)) return formatProfitRevenueGap(data, tone, options);
  if (asksProductPnlDetail(options.message)) return formatProductPnlDetail(data, tone, options);
  const s = data?.summary || {};
  const missing = Array.isArray(data?.missingCostProducts) ? data.missingCostProducts : [];
  const losses = Array.isArray(data?.lossMakingProducts) ? data.lossMakingProducts : [];
  const lines = [
    `P&L за ${periodLabel(data)}:`,
    `• выручка — ${money(s.revenue)};`,
    `• себестоимость — ${money(s.cogs)}; комиссия — ${money(s.commission)}; логистика — ${money(s.logistics)};`,
    `• реклама — ${money(s.advertising)}; хранение — ${money(s.storage)}; постоянные расходы — ${money(s.fixed)}; налог — ${money(s.tax)};`,
    `• операционная прибыль — ${money(s.operatingProfit)}; маржа — ${percent(s.margin)}.`,
  ];
  if (missing.length) lines.push(`Себестоимость не заполнена минимум у ${missing.length} товаров из показанной выборки — по ним прибыль не считается, а не считается «нулевой».`);
  if (losses.length) lines.push(`Самые убыточные: ${losses.slice(0, 5).map((item) => `${titleOf(item)} — ${money(item.profit)}`).join('; ')}.`);
  lines.push(mildHumor(tone, 'finance'));
  return lines.filter(Boolean).join('\n');
}

function formatOneActionFromFinance(data, tone, options = {}) {
  const s = data?.summary || {};
  const period = periodLabel(data, options.context);
  const losses = Array.isArray(data?.lossMakingProducts) ? data.lossMakingProducts : [];
  const rows = Array.isArray(data?.productPnlRows) ? data.productPnlRows : [];
  const costly = [...rows]
    .filter(item => Number(item.expenses || 0) > 0 || Number(item.advertising || 0) > 0 || Number(item.logistics || 0) > 0)
    .sort((a,b) => Number(b.expenses || 0) - Number(a.expenses || 0));
  const operatingProfit = Number(s.operatingProfit);
  const margin = Number(s.margin);
  const advertising = Number(s.advertising || 0);
  const logistics = Number(s.logistics || 0);
  const commission = Number(s.commission || 0);
  const lines = [];
  lines.push(`Одно главное действие за ${period}: ${operatingProfit < 0 ? 'сначала остановить лишний денежный слив, а не гнаться за ростом выручки.' : 'сначала проверить самый дорогой расход, который сильнее всего давит на прибыль.'}`);
  lines.push(`Почему: операционная прибыль ${money(s.operatingProfit)}, маржа ${percent(s.margin)}${Number.isFinite(advertising) || Number.isFinite(logistics) || Number.isFinite(commission) ? `; реклама ${money(s.advertising)}, логистика ${money(s.logistics)}, комиссия WB ${money(s.commission)}.` : '.'}`);
  if (losses.length) {
    const item = losses[0];
    lines.push(`Куда смотреть первым: ${titleOf(item)} — прибыль ${money(item.profit)}, выручка ${money(item.revenue)}, расходы ${money(item.expenses)}, реклама ${money(item.advertising)}.`);
  } else if (costly.length) {
    const item = costly[0];
    lines.push(`Куда смотреть первым: ${titleOf(item)} — расходы ${money(item.expenses)}, реклама ${money(item.advertising)}, логистика ${money(item.logistics)}, комиссия ${money(item.commission)}.`);
  } else if (advertising > 0) {
    lines.push('Куда смотреть первым: реклама. Открой кампании и отключи/урежь то, что тратит деньги без понятного вклада в продажи и прибыль.');
  } else if (logistics > 0 || commission > 0) {
    lines.push('Куда смотреть первым: финансовый реестр по логистике и комиссии WB. Проверь, какие операции съели прибыль.');
  } else {
    lines.push('Куда смотреть первым: таблица «Деньги по каждому артикулу». Отсортируй по прибыли снизу вверх и открой первый минусовой товар.');
  }
  lines.push('Не делай сейчас десять задач сразу: выбери один самый дорогой артикул или расход и проверь его в SKU 360.');
  const warnings = coverageWarnings(data).slice(0, 1);
  if (warnings.length) lines.push(`Ограничение: ${warnings[0]}`);
  return lines.filter(Boolean).join('\n');
}

function formatBusinessPraise({ overviewData, financeData, stocksData, advertisingData, context = {}, identity = {} } = {}) {
  const name = String(identity?.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  const summary = overviewData?.summary || financeData?.summary || context?.screen?.summary || {};
  const facts = [];
  if (summary.revenue != null && Number(summary.revenue) > 0) facts.push(`есть подтверждённая выручка ${money(summary.revenue)}`);
  if (summary.sales != null && Number(summary.sales) > 0) facts.push(`продажи уже читаются: ${number(summary.sales)} шт.`);
  if (summary.operatingProfit != null && Number(summary.operatingProfit) > 0) facts.push(`операционная прибыль положительная: ${money(summary.operatingProfit)}`);
  if (summary.stockUnits != null) facts.push(`остатки собраны в единый снимок: ${number(summary.stockUnits)} шт.`);
  const adsSpend = advertisingData?.summary?.spend ?? advertisingData?.advertising?.totals?.spend ?? summary.advertising;
  if (adsSpend != null && Number(adsSpend) > 0) facts.push(`реклама уже связана с кабинетом: расход ${money(adsSpend)}`);
  const lines = [`${prefix}по делу: уже хорошо то, что кабинет не пустой и ELISEI опирается на факты, а не на красивую заглушку.`];
  if (facts.length) {
    lines.push(`Что подтверждено: ${facts.slice(0,4).join('; ')}.`);
  } else {
    lines.push('Даже если часть потоков ещё догружается, хорошо уже то, что система честно отделяет подтверждённые данные от ожидающих и не рисует ложные нули.');
  }
  lines.push('Самое ценное: ты довела кабинет до состояния, где уже можно принимать решения по периодам, товарам, рекламе, финансам и закупкам.');
  return lines.join('\n');
}

function formatProducts(data, tone) {
  const products = Array.isArray(data?.products) ? data.products : [];
  const top = topItems(products, (item) => item.revenue, 6);
  const lines = [`В кабинете доступно ${number(data?.summary?.activeProducts ?? products.length)} товаров.`];
  if (top.length) lines.push(`По выручке лидируют: ${top.map((item) => `${titleOf(item)} — ${money(item.revenue)}`).join('; ')}.`);
  if (data?.recommendations?.length) lines.push(`Первая рекомендация: ${data.recommendations[0].title || data.recommendations[0].text}.`);
  lines.push(mildHumor(tone, 'default'));
  return lines.filter(Boolean).join('\n');
}


function asksReviewReturnLink(message = '') {
  const text = String(message || '').toLowerCase();
  const hasReviews = /отзыв|рейтинг|оценк|жалоб|feedback/.test(text);
  const hasReturns = /возврат|отказ|невыкуп|брак|дефект/.test(text);
  const asksRelation = /свяж|сопостав|сравн|совпад|связ|коррел|причин|влиян|пересеч/.test(text);
  return hasReviews && hasReturns && asksRelation;
}

function normalizedProductValue(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
}

function productKeys(item = {}) {
  const keys = [];
  if (item.nmID != null && String(item.nmID).trim()) keys.push(`n:${String(item.nmID).trim()}`);
  const vendor = normalizedProductValue(item.vendorCode || item.supplierArticle);
  if (vendor) keys.push(`v:${vendor}`);
  const title = normalizedProductValue(item.title || item.name);
  if (title && !['товар','товарwb'].includes(title)) keys.push(`t:${title}`);
  return keys;
}

function buildProductIndex(items = []) {
  const index = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    for (const key of productKeys(item)) if (!index.has(key)) index.set(key,item);
  }
  return index;
}

function findProduct(index, item = {}) {
  for (const key of productKeys(item)) {
    const found = index.get(key);
    if (found) return found;
  }
  return null;
}


function reviewSignalsForLink(reviewsData = {}) {
  const byKey = new Map();
  const upsert = (item = {}) => {
    const keys = productKeys(item);
    const key = keys[0];
    if (!key) return null;
    let current = byKey.get(key);
    if (!current) {
      current = {
        nmID:item.nmID ?? null,
        vendorCode:item.vendorCode || item.supplierArticle || '',
        title:item.title || item.name || 'Товар WB',
        totalReviews:0,
        lowRatedReviews:0,
        unansweredReviews:0,
        unansweredQuestions:0,
        ratings:[],
      };
      byKey.set(key,current);
      for (const alias of keys.slice(1)) if (!byKey.has(alias)) byKey.set(alias,current);
    }
    return current;
  };
  for (const row of Array.isArray(reviewsData?.reviews) ? reviewsData.reviews : []) {
    const current = upsert(row);
    if (!current) continue;
    current.totalReviews += 1;
    if (row.rating != null && Number.isFinite(Number(row.rating))) {
      current.ratings.push(Number(row.rating));
      if (Number(row.rating) <= 3) current.lowRatedReviews += 1;
    }
    if (!row.isAnswered && !row.archived) current.unansweredReviews += 1;
  }
  for (const signal of Array.isArray(reviewsData?.productSignals) ? reviewsData.productSignals : []) {
    const current = upsert(signal);
    if (!current) continue;
    current.lowRatedReviews = Math.max(current.lowRatedReviews,Number(signal.lowRatedReviews || 0));
    current.unansweredReviews = Math.max(current.unansweredReviews,Number(signal.unansweredReviews || 0));
    current.unansweredQuestions = Math.max(current.unansweredQuestions,Number(signal.unansweredQuestions || 0));
    if (!current.ratings.length && signal.averageRating != null) current.averageRating = Number(signal.averageRating);
  }
  return [...new Set(byKey.values())].map(item=>({
    ...item,
    averageRating:item.averageRating ?? (item.ratings.length ? item.ratings.reduce((sum,value)=>sum+value,0)/item.ratings.length : null),
    ratings:undefined,
  }));
}

function matchingFeedbackTexts(rows = [], item = {}) {
  const wanted = new Set(productKeys(item));
  if (!wanted.size) return [];
  const texts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!productKeys(row).some(key => wanted.has(key))) continue;
    const text = String(row.text || row.cons || row.pros || '').replace(/\s+/g,' ').trim();
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.slice(0,2);
}

function formatReviewReturnLink({ returnsData, reviewsData, productsData, context = {} } = {}) {
  const period = returnsData?.period || reviewsData?.period || context?.period || {};
  const returnRows = Array.isArray(returnsData?.highestReturnRate) && returnsData.highestReturnRate.length
    ? returnsData.highestReturnRate
    : (Array.isArray(reviewsData?.relatedReturns) ? reviewsData.relatedReturns : []);
  const signals = reviewSignalsForLink(reviewsData);
  const lowReviews = Array.isArray(reviewsData?.lowRatedReviews) ? reviewsData.lowRatedReviews : [];
  const productRows = Array.isArray(productsData?.products) ? productsData.products : [];
  const returnIndex = buildProductIndex(returnRows);
  const productIndex = buildProductIndex(productRows);
  const matched = [];

  for (const signal of signals) {
    const returned = findProduct(returnIndex,signal);
    if (!returned || Number(returned.returns || 0) <= 0) continue;
    const card = findProduct(productIndex,signal) || findProduct(productIndex,returned) || null;
    const combined = { ...returned, ...signal, ...(card || {}) };
    matched.push({
      ...combined,
      returns:Number(returned.returns || 0),
      returnRate:returned.returnRate == null ? null : Number(returned.returnRate),
      totalReviews:Number(signal.totalReviews || 0),
      lowRatedReviews:Number(signal.lowRatedReviews || 0),
      unansweredReviews:Number(signal.unansweredReviews || 0),
      unansweredQuestions:Number(signal.unansweredQuestions || 0),
      averageRating:signal.averageRating == null ? null : Number(signal.averageRating),
      complaints:matchingFeedbackTexts(lowReviews,signal),
      riskScore:Number(returned.returns || 0) * 2 + Number(returned.returnRate || 0) + Number(signal.lowRatedReviews || 0) * 5 + Number(signal.unansweredReviews || 0),
    });
  }
  matched.sort((a,b)=>b.riskScore-a.riskScore);

  const lines = [`Связал отзывы с возвратами за ${formatRuPeriod(period)}. Сопоставление выполнено по nmID, затем по артикулу продавца; при отсутствии идентификаторов — по названию товара.`];
  if (!reviewsData?.available) {
    lines.push('Отзывы за выбранный период не подтверждены, поэтому реальную связь с возвратами сейчас построить нельзя. Нулём это не считаю.');
    return lines.join('\n');
  }
  if (!returnRows.length) {
    lines.push('Товарная детализация возвратов за выбранный период пока недоступна. Отзывы вижу, но привязать их к возвратам без списка товаров нельзя.');
    return lines.join('\n');
  }
  if (!signals.length) {
    lines.push('В отзывах нет товарных негативных сигналов или неотвеченных обращений, которые можно было бы сопоставить с возвратами.');
    return lines.join('\n');
  }
  if (!matched.length) {
    lines.push('Прямых совпадений по nmID или артикулу в доступной выборке не найдено. Это не означает, что связи нет: часть отзывов или возвратов могла прийти без общего товарного идентификатора.');
    return lines.join('\n');
  }

  const productWord = matched.length === 1 ? 'товара' : 'товаров';
  lines.push(`Совпадение найдено у ${number(matched.length)} ${productWord}. В первую очередь проверь:`);
  for (const item of matched.slice(0,6)) {
    const reviewBits = [];
    if (item.totalReviews) reviewBits.push(`отзывов в выборке — ${number(item.totalReviews)}`);
    if (item.lowRatedReviews) reviewBits.push(`низких отзывов — ${number(item.lowRatedReviews)}`);
    if (item.averageRating != null) reviewBits.push(`средняя оценка — ${number(item.averageRating)} ★`);
    if (item.unansweredReviews || item.unansweredQuestions) reviewBits.push(`без ответа — ${number(item.unansweredReviews + item.unansweredQuestions)}`);
    const complaint = item.complaints.length ? ` Причины из отзывов: «${item.complaints.join('»; «').slice(0,260)}».` : '';
    lines.push(`• ${titleOf(item)}: возвратов — ${number(item.returns)}, доля — ${percent(item.returnRate)}; ${reviewBits.join(', ') || 'есть сигнал из отзывов'}.${complaint}`);
  }
  lines.push('Это совпадение сигналов, а не доказанная причина возврата. Приоритет — открыть карточки этих товаров, проверить повторяющиеся жалобы, размерную сетку, описание и качество партии.');
  return lines.join('\n');
}

function formatReturns(data, tone) {
  const s = data?.summary || {};
  const top = Array.isArray(data?.highestReturnRate) ? data.highestReturnRate : [];
  const lines = [`Возвраты за ${periodLabel(data)}: ${number(s.returns)} при ${number(s.sales)} продажах, доля — ${percent(s.returnRate)}.`];
  if (top.length) lines.push(`Наибольшая доля возвратов: ${top.slice(0, 6).map((item) => `${titleOf(item)} — ${percent(item.returnRate)} (${number(item.returns)} возвр.)`).join('; ')}.`);
  lines.push(`Чтобы назвать причину, нужны отзывы/причины возврата; без них я отмечаю связь, но не выдумываю диагноз.${mildHumor(tone, 'returns')}`);
  return lines.filter(Boolean).join('\n');
}

function formatReviews(data, tone) {
  if (!data?.available) return data?.warning || 'Отзывы, вопросы и чаты пока не синхронизированы с WB, поэтому я не буду придумывать мнение покупателей.';
  const reviewSummary = data?.summary?.reviews || {};
  const questionSummary = data?.summary?.questions || {};
  const chatSummary = data?.summary?.chats || {};
  const low = Array.isArray(data?.lowRatedReviews) ? data.lowRatedReviews : [];
  const unansweredQuestions = Array.isArray(data?.unansweredQuestions) ? data.unansweredQuestions : [];
  const signals = Array.isArray(data?.productSignals) ? data.productSignals : [];
  const lines = [
    `Коммуникации за ${periodLabel(data)}: отзывы — ${number(reviewSummary.total)}, вопросы — ${number(questionSummary.total)}, диалоги и события чатов — ${number(chatSummary.total)}.`,
  ];
  if (reviewSummary.averageRating != null) lines.push(`Средняя оценка по доступной выборке — ${number(reviewSummary.averageRating)} ★; низких оценок 1–3 ★ — ${number(reviewSummary.lowRated)}.`);
  lines.push(`Без ответа: отзывы — ${number(reviewSummary.unanswered)}, вопросы — ${number(questionSummary.unanswered)}.`);
  if (low.length) {
    lines.push(`Низкие оценки, которые стоит разобрать первыми: ${low.slice(0,4).map((item) => {
      const product = titleOf(item);
      const text = String(item.text || item.cons || '').trim();
      return `${product} — ${item.rating == null ? 'без оценки' : `${number(item.rating)} ★`}${text ? `: «${text.slice(0,120)}»` : ''}`;
    }).join('; ')}.`);
  }
  if (unansweredQuestions.length) {
    lines.push(`Неотвеченные вопросы: ${unansweredQuestions.slice(0,4).map((item) => `${titleOf(item)} — ${String(item.text || 'вопрос без текста').slice(0,120)}`).join('; ')}.`);
  }
  if (signals.length) lines.push(`Наибольшая концентрация сигналов по товарам: ${signals.slice(0,5).map((item) => `${titleOf(item)} — низких отзывов ${number(item.lowRatedReviews)}, без ответа ${number(item.unansweredReviews + item.unansweredQuestions)}`).join('; ')}.`);
  if (chatSummary.readOnly) lines.push('Чаты загружены только для анализа: Эл не отправляет сообщения без отдельного подтверждения и write-инструмента.');
  lines.push(`Следующий шаг: сначала ответить на вопросы без ответа и проверить товары, где низкие оценки совпадают с возвратами.${mildHumor(tone, 'returns')}`);
  return lines.filter(Boolean).join('\n');
}

function formatPricing(data, tone) {
  const losses = Array.isArray(data?.lossMakingProducts) ? data.lossMakingProducts : [];
  const priced = Array.isArray(data?.pricingProducts) ? data.pricingProducts : [];
  const lines = [`Ценовые расчёты доступны для ${number(priced.length)} товаров в текущей выборке.`];
  if (losses.length) lines.push(`Товары, где цену нужно проверить первой: ${losses.slice(0, 6).map((item) => `${titleOf(item)} — прибыль ${money(item.profit)}, цена ${money(item.averagePrice)}, безубыточная ${money(item.breakevenPrice)}`).join('; ')}.`);
  if (!priced.length) lines.push('Для рекомендаций по цене заполните себестоимость и дождитесь продаж/цен WB.');
  lines.push(mildHumor(tone, 'finance'));
  return lines.filter(Boolean).join('\n');
}

function formatSeasonality(data, tone) {
  const products = Array.isArray(data?.products) ? data.products : [];
  const lines = [`Сезонность сейчас оценивается по доступной истории кабинета за ${periodLabel(data)}.`];
  if (products.length) lines.push(`Товары с наибольшими продажами в периоде: ${products.slice(0, 6).map((item) => `${titleOf(item)} — ${number(item.sales)} продаж`).join('; ')}.`);
  if (data?.warning) lines.push(data.warning);
  lines.push('Для надёжного годового вывода нужна история минимум за 12 месяцев; текущий всплеск не называю сезоном без проверки.');
  return lines.filter(Boolean).join('\n');
}

function formatProcurement(data, tone) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const exclusions = Array.isArray(data?.exclusions) ? data.exclusions : [];
  const lines = [];
  if (candidates.length) lines.push(`Кандидаты на пополнение: ${candidates.slice(0, 7).map((item) => `${titleOf(item)} — остаток ${number(item.stock)} шт.${item.stockCoverDays != null ? `, ${number(item.stockCoverDays)} дн.` : ''}, прибыль ${money(item.profit)}`).join('; ')}.`);
  else lines.push('Подтверждённых кандидатов на дозаказ сейчас нет.');
  if (exclusions.length) lines.push(`Не дозаказывать без отдельной проверки: ${exclusions.slice(0, 6).map(titleOf).join(', ')}.`);
  lines.push(`Правило: плохие продажи в сезон, отрицательная прибыль или избыток — стоп-сигнал для закупки.${mildHumor(tone, 'stocks')}`);
  return lines.filter(Boolean).join('\n');
}

function signedMoney(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 'нет данных';
  return `${numberValue > 0 ? '+' : ''}${money(numberValue)}`;
}

function signedNumber(value, suffix = '') {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 'нет данных';
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits:1 }).format(numberValue);
  return `${numberValue > 0 ? '+' : ''}${formatted}${suffix}`;
}

function diagnosticImpact(item = {}) {
  if (item.impact == null || !Number.isFinite(Number(item.impact))) return '';
  if (item.impactKind === 'direct_expense') return `Прямой эффект: около ${money(item.impact)} дополнительных расходов.`;
  if (item.impactKind === 'profit_delta') return `Вклад: около ${money(item.impact)} снижения прибыли по товару.`;
  if (item.impactKind === 'estimated_revenue_risk') return `Оценочный риск выручки: около ${money(item.impact)}.`;
  if (item.impactKind === 'revenue_at_risk') return `Снижение выручки: около ${money(item.impact)}.`;
  return `Денежный масштаб: около ${money(item.impact)}.`;
}

function formatDiagnostics(data, tone) {
  if (!data?.available) return data?.warning || 'Для анализа изменений нужен выбранный и предыдущий сопоставимый период.';
  const currentLabel = formatRuPeriod(data.period || {});
  const compareLabel = formatRuPeriod(data.comparePeriod || {});
  const mainMetric = data.headlineMetric === 'operatingProfit' ? 'операционная прибыль' : 'выручка';
  const main = data.headlineChange || {};
  const stateText = data.state === 'down' ? 'стало хуже' : data.state === 'up' ? 'стало лучше' : 'существенного денежного сдвига не вижу';
  const lines = [
    `Сравнил ${currentLabel} с ${compareLabel}: ${stateText}.`,
    `${mainMetric[0].toUpperCase()}${mainMetric.slice(1)}: ${signedMoney(main.value)}${main.pct == null ? '' : ` (${signedNumber(main.pct, '%')})`} к предыдущему периоду.`,
  ];

  const metrics = data.metrics || {};
  const compact = [];
  if (metrics.revenue?.available) compact.push(`выручка ${signedMoney(metrics.revenue.value)}`);
  if (metrics.orders?.available) compact.push(`заказы ${signedNumber(metrics.orders.value)}`);
  if (metrics.sales?.available) compact.push(`продажи ${signedNumber(metrics.sales.value)}`);
  if (metrics.returnRate?.available && Math.abs(Number(metrics.returnRate.value || 0)) >= 0.1) compact.push(`доля возвратов ${signedNumber(metrics.returnRate.value,' п.п.')}`);
  if (data.headlineMetric !== 'operatingProfit' && metrics.operatingProfit?.available) compact.push(`прибыль ${signedMoney(metrics.operatingProfit.value)}`);
  if (compact.length) lines.push(`Что изменилось: ${compact.slice(0,5).join('; ')}.`);

  const causes = Array.isArray(data.causes) ? data.causes : [];
  if (causes.length) {
    lines.push('Почему это произошло:');
    causes.slice(0,3).forEach((item,index) => {
      const impact = diagnosticImpact(item);
      lines.push(`${index + 1}. ${item.title}. ${item.evidence}${impact ? ` ${impact}` : ''}`);
    });
  } else {
    lines.push('Я не вижу одного подтверждённого негативного фактора, который заметно объясняет изменение. Не буду придумывать причину из шума.');
  }

  if (data.action?.text) {
    lines.push(`Одно главное действие сейчас: ${data.action.text}`);
    if (data.action.reason) lines.push(`Почему именно оно: ${data.action.reason}.`);
  }

  const confidence = data.confidence === 'high' ? 'высокая' : data.confidence === 'medium' ? 'средняя' : 'низкая';
  lines.push(`Уверенность вывода: ${confidence}.`);
  if (Array.isArray(data.warnings) && data.warnings.length) lines.push(`Ограничения: ${data.warnings.slice(0,2).join(' ')}`);
  if (data.state === 'up') lines.push(mildHumor(tone, 'default'));
  return lines.filter(Boolean).join('\n');
}

function isDecisionRequest(message = '') {
  return /(что\s+(?:изменилось|поменялось)|почему\s+(?:упал|упала|упали|просел|просела|просели|снизил|снизилась|снизились|стало\s+хуже)|важнее\s+всего|главн(?:ое|ый)\s+действи|одно\s+главн(?:ое|ый)\s+действи|выбер(?:и|ать)\s+одно|помоги\s+выбрать|разбери\s+причин|найди\s+причин|что\s+делать(?:\s+по\s+кабинету)?)/i.test(String(message || ''));
}

function formatSync(data) {
  const states = Array.isArray(data?.syncStates) ? data.syncStates : [];
  const failed = states.filter((item) => !['success', 'idle'].includes(item.status));
  const lines = [`Синхронизации: ${states.length} потоков, проблемных/ожидающих — ${failed.length}. Последнее обновление: ${data?.lastSync ? new Date(data.lastSync).toLocaleString('ru-RU') : 'нет данных'}.`];
  if (failed.length) lines.push(`Требуют внимания: ${failed.slice(0, 6).map((item) => `${item.stage}: ${item.lastError || item.status}`).join('; ')}.`);
  if (data?.syncWarnings?.length) lines.push(`Предупреждения: ${data.syncWarnings.slice(0, 3).join('; ')}.`);
  return lines.join('\n');
}

const FORMATTERS = {
  diagnostics: formatDiagnostics,
  overview: formatOverview,
  sales: formatSales,
  advertising: formatAdvertising,
  stocks: formatStocks,
  finance: formatFinance,
  products: formatProducts,
  returns: formatReturns,
  reviews: formatReviews,
  pricing: formatPricing,
  seasonality: formatSeasonality,
  procurement: formatProcurement,
  sync: formatSync,
};

function inferModules(message, history = [], limit = 3) {
  let modules = detectModules(message, limit);
  if (!modules.length || (modules.length === 4 && modules[0] === 'overview')) {
    const previous = [...(Array.isArray(history) ? history : [])].reverse().find((item) => item?.role === 'user' && BUSINESS_RE.test(String(item.content || '')));
    if (previous) modules = detectModules(previous.content, limit);
  }
  return modules.length ? modules.slice(0, limit) : ['overview'];
}

async function handleMemoryCommand(options) {
  const text = String(options.message || '').trim();
  const remember = text.match(/^(?:эл[,!]?\s*)?(?:запомни|сохрани правило)[:\s-]+(.+)/i);
  if (remember && options.memoryStore) {
    const saved = await options.memoryStore.addMemory(options.identity, { text: remember[1].trim(), category: 'business_rule' });
    return { text: `Запомнил: ${saved.text}`, modulesUsed: [], memoryAction: 'saved' };
  }
  const forget = text.match(/^(?:эл[,!]?\s*)?(?:забудь|удали из памяти)[:\s-]+(.+)/i);
  if (forget && options.memoryStore) {
    const removed = await options.memoryStore.forgetByText(options.identity, forget[1].trim());
    return { text: removed.length ? `Забыл ${removed.length} запись(и).` : 'Не нашёл такую запись в памяти.', modulesUsed: [], memoryAction: 'forgot' };
  }
  if (/что ты помнишь|какие правила.*помнишь/i.test(text)) {
    const memories = Array.isArray(options.memories) ? options.memories : [];
    return { text: memories.length ? `Помню:\n${memories.slice(0, 12).map((item) => `• ${item.text}`).join('\n')}` : 'Пока не сохранил ни одного правила.', modulesUsed: [], memoryAction: 'listed' };
  }
  return null;
}

async function runElAnalyst(options = {}) {
  const message = String(options.message || '').trim();
  const personality = normalizeElProfile(options.personality || { humor: String(options.tone || '').includes('playful') ? 'light' : 'off' });
  const voice = createVoiceContext({
    profile: personality,
    message,
    history: options.history,
    context: options.context,
    seed: `${options.identity?.userId || 'owner'}:${message}`,
  });

  const memoryAnswer = await handleMemoryCommand(options);
  if (memoryAnswer) return {
    id: crypto.randomUUID(), ...memoryAnswer, sources: [], usedWeb: false,
    model: 'elisei-analyst-local', usage: null, apiUsed: false, toolTrace: [],
    reaction: reactionFor({ voice, kind:'analysis' }),
    grounding: { facts:[], assumptions:[] }, personality,
  };

  const social = !BUSINESS_RE.test(message) ? socialResponse({ message, profile:personality, history:options.history, context:options.context, identity:options.identity }) : null;
  if (social) return {
    id: crypto.randomUUID(), text:social.text, sources:[], usedWeb:false,
    model:'elisei-analyst-local', usage:null, apiUsed:false, toolTrace:[], modulesUsed:[],
    reaction:social.reaction, answerKind:social.kind,
    grounding:{ facts:[], assumptions:[] }, personality,
  };

  if (!BUSINESS_RE.test(message) && options.classification?.reason === 'analyst-selected') {
    return {
      id: crypto.randomUUID(),
      text: personality.character === 'professional'
        ? 'В режиме «Эл Аналитик» я работаю с данными WB-кабинета: продажами, рекламой, остатками, финансами, товарами, возвратами, ценами, закупками и качеством данных. Для универсальных задач используется «Эл GPT», а для интернета и исследований — «Эл Pro».'
        : 'В базовом режиме я живу внутри твоего WB-кабинета: разбираю продажи, рекламу, остатки, финансы, товары, возвраты, цены и закупки. Для свободных задач есть «Эл GPT», а интернет и исследования — в «Эл Pro».',
      sources: [], usedWeb: false, model: 'elisei-analyst-local', usage: null, apiUsed: false, toolTrace: [], modulesUsed: [],
      reaction:reactionFor({ voice, kind:'analysis' }), grounding:{ facts:[], assumptions:[] }, personality,
    };
  }

  let modules = options.classification?.modules?.length ? options.classification.modules.slice(0, 3) : inferModules(message, options.history, 3);
  const decisionRequest = isDecisionRequest(message);
  const businessPraiseRequest = asksBusinessPraise(message);
  const turnaroundRequest = asksTurnaroundPlan(message);
  // Эл 2.0: диагностический запрос сам агрегирует сравнение периодов и причины,
  // поэтому не дублируем его обычными сводками finance/sales/overview.
  if (modules.includes('diagnostics') && decisionRequest) modules = ['diagnostics', 'finance'];
  if (businessPraiseRequest) modules = ['overview', 'finance', 'stocks', 'advertising'];
  if (turnaroundRequest) modules = ['finance', 'advertising', 'pricing', 'procurement'];
  if (asksProfitRevenueGap(message)) modules = ['finance'];
  const results = await options.dataBridge.getMany(modules, message);
  const sections = [];
  const warnings = [];
  if (turnaroundRequest) {
    const financeData = moduleData(results.finance);
    const advertisingData = moduleData(results.advertising);
    const pricingData = moduleData(results.pricing);
    const procurementData = moduleData(results.procurement);
    sections.push(formatTurnaroundPlan({
      financeData:results.finance?.ok ? financeData : null,
      advertisingData:results.advertising?.ok ? advertisingData : null,
      pricingData:results.pricing?.ok ? pricingData : null,
      procurementData:results.procurement?.ok ? procurementData : null,
      context:options.context,
      identity:options.identity,
    }));
    warnings.push(...coverageWarnings(financeData),...coverageWarnings(advertisingData),...coverageWarnings(pricingData),...coverageWarnings(procurementData));
  }
  if (businessPraiseRequest) {
    const overviewData = moduleData(results.overview);
    const financeData = moduleData(results.finance);
    const stocksData = moduleData(results.stocks);
    const advertisingData = moduleData(results.advertising);
    sections.push(formatBusinessPraise({
      overviewData:results.overview?.ok ? overviewData : null,
      financeData:results.finance?.ok ? financeData : null,
      stocksData:results.stocks?.ok ? stocksData : null,
      advertisingData:results.advertising?.ok ? advertisingData : null,
      context:options.context,
      identity:options.identity,
    }));
    warnings.push(...coverageWarnings(overviewData),...coverageWarnings(financeData),...coverageWarnings(stocksData),...coverageWarnings(advertisingData));
  }
  const relationRequest = asksReviewReturnLink(message) && modules.includes('reviews') && modules.includes('returns');
  const relationHandled = new Set();
  if (relationRequest) {
    const returnsData = moduleData(results.returns);
    const reviewsData = moduleData(results.reviews);
    const productsData = moduleData(results.products);
    sections.push(formatReviewReturnLink({ returnsData,reviewsData,productsData,context:options.context }));
    relationHandled.add('returns');
    relationHandled.add('reviews');
    if (modules.includes('products')) relationHandled.add('products');
    warnings.push(...coverageWarnings(returnsData),...coverageWarnings(reviewsData));
  }
  for (const moduleName of modules) {
    if (turnaroundRequest) continue;
    if (businessPraiseRequest) continue;
    if (relationHandled.has(moduleName)) continue;
    const result = results[moduleName];
    let data = moduleData(result);
    if (!result?.ok || !data?.available) {
      const fallback = screenFallback(moduleName, options.context);
      if (fallback) {
        data = fallback;
      } else {
        warnings.push(data?.warning || result?.warning || `Данные раздела «${MODULES[moduleName]?.title || moduleName}» пока недоступны.`);
        continue;
      }
    }
    const formatter = FORMATTERS[moduleName] || formatOverview;
    if (moduleName === 'finance' && decisionRequest && modules.includes('diagnostics') && !sections.length) {
      sections.push(formatOneActionFromFinance(data, voice, { message,context:options.context,identity:options.identity }));
    } else if (moduleName !== 'finance' || !decisionRequest || !modules.includes('diagnostics')) {
      sections.push(formatter(data, voice, { message,context:options.context,identity:options.identity }));
    }
    warnings.push(...coverageWarnings(data));
  }

  if (!sections.length) {
    const metric = followupMetric(options.context || {}, message);
    const screenSummary = options.context?.screen?.summary && typeof options.context.screen.summary === 'object'
      ? options.context.screen.summary : null;
    if (modules.includes('sales') && ['fbs_orders','fbo_orders'].includes(metric) && screenSummary?.orders != null && Number.isFinite(Number(screenSummary.orders))) {
      const name = String(options.identity?.userName || '').trim().split(/\s+/)[0];
      const prefix = name ? `${name}, ` : '';
      sections.push(`${prefix}за ${formatRuPeriod(options.context?.period || options.context?.screen?.period || {})} загружено ${number(screenSummary.orders)} заказов, но точную разбивку FBS/FBO сейчас получить не удалось. Я не буду показывать FBS = 0, потому что отсутствие разбивки — не нулевой результат.`);
      warnings.push('Общая сумма заказов подтверждена текущим экраном ELISEI; детализация схемы доставки временно недоступна.');
    } else {
      sections.push(noDataResponse(voice, options.identity));
    }
  }
  if (voice.support && ['tired','frustrated','worried'].includes(voice.emotion)) {
    sections.unshift(voice.address === 'formal'
      ? 'Понимаю, что сейчас тяжело. Давайте без лишнего шума: ниже только главное по подтверждённым данным.'
      : 'Понимаю, что сейчас тяжело. Давай без лишнего шума: ниже только главное по подтверждённым данным.');
  }
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))].slice(0, 3);
  if (uniqueWarnings.length) sections.push(`Ограничения данных:\n${uniqueWarnings.map((item) => `• ${item}`).join('\n')}`);

  return {
    id: crypto.randomUUID(),
    text: sections.join('\n\n'),
    sources: [],
    usedWeb: false,
    model: 'elisei-analyst-local',
    usage: null,
    apiUsed: false,
    toolTrace: modules.map((module) => ({ name: 'local_analytics', module, ok: Boolean(results[module]?.ok) })),
    modulesUsed: modules,
    reaction: reactionFor({ voice, warning: uniqueWarnings.length > 0 }),
    answerKind: 'analysis',
    grounding: {
      facts: modules.filter((module) => Boolean(results[module]?.ok)).map((module) => MODULES[module]?.title || module),
      assumptions: uniqueWarnings,
    },
    followupContext:{ period:options.context?.period || null,modules,metric:followupMetric(options.context,message) },
    personality,
  };
}

module.exports = { runElAnalyst, inferModules, FORMATTERS, campaignMetrics, asksReviewReturnLink, formatReviewReturnLink, formatDiagnostics, isDecisionRequest };
