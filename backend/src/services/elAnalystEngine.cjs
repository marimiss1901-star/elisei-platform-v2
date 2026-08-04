'use strict';

const crypto = require('node:crypto');
const { detectModules, MODULES } = require('./elModuleRegistry.cjs');
const { BUSINESS_RE } = require('./elModeRouter.cjs');
const { normalizeElProfile, createVoiceContext, humorLine, socialResponse, noDataResponse, reactionFor } = require('./elPersonality.cjs');
const { formatRuPeriod, validDateKey } = require('./elTemporal.cjs');

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
  return [...new Set(warnings.filter(Boolean))];
}

function screenFallback(moduleName, context = {}) {
  const screen = context?.screen && typeof context.screen === 'object' ? context.screen : {};
  const summary = screen?.summary && typeof screen.summary === 'object' ? screen.summary : null;
  if (!summary) return null;
  const has = (...keys) => keys.some((key) => summary[key] != null && Number.isFinite(Number(summary[key])));
  const period = screen.period || context.period || null;
  if (context?.period && (!screen.period || !samePeriod(context.period, screen.period))) return null;
  if (moduleName === 'sales' && has('revenue','orders','sales','returns')) {
    return { available:true, summary, period, topByRevenue:[], topBySales:[], warning:'Использованы подтверждённые показатели текущего экрана ELISEI; товарная детализация через внутренний мост временно недоступна.' };
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
  const name = String(options?.identity?.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  const asksRevenue = /выручк/i.test(message);
  const asksProductDetail = /товар|артикул|лидер|топ|что\s+продал|по\s+каким/i.test(message);
  const asksComparison = /сравн|динамик|рост|паден|измен/i.test(message);
  const dateLabel = periodLabel(data, options.context);
  const lines = [];
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
    cpo: orders > 0 ? spend / orders : null,
    cpc: clicks > 0 ? spend / clicks : campaign.cpc ?? null,
  };
}

function formatAdvertising(data, tone) {
  const s = data?.summary || {};
  const ads = data?.advertising || {};
  const totals = ads.totals || {};
  const campaigns = (Array.isArray(ads.campaigns) ? ads.campaigns : []).map(campaignMetrics).filter((item) => item.spend > 0 || item.statsStatus === 'loaded');
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
  if (!ads.statsAvailable) lines.push('Статистика кампаний WB ещё не загружена полностью — выводы по эффективности ограничены.');
  if (risky.length) {
    lines.push('Кампании, которые нужно проверить первыми:');
    risky.forEach((item) => lines.push(`• ${item.name || `Кампания ${item.advertId || ''}`}: расход ${money(item.spend)}, выручка ${money(item.revenue)}, ДРР ${percent(item.drr)}, заказов ${number(item.orders)}.`));
  }
  if (lossProducts.length) {
    lines.push('Товары с рекламой и отрицательной итоговой прибылью:');
    lossProducts.forEach((item) => lines.push(`• ${titleOf(item)}: реклама ${money(item.advertising)}, прибыль ${money(item.profit)}, маржа ${percent(item.margin)}.`));
  } else if ((data?.productsWithAds || []).length && (data?.productsWithAds || []).every((item) => item.profit == null)) {
    lines.push('Прибыль после рекламы нельзя подтвердить: у рекламируемых товаров не заполнена себестоимость. ДРР и расходы я показываю, но минус не выдумываю.');
  }
  lines.push(`Вывод: ${risky[0] ? `начни с ${risky[0].name || `кампании ${risky[0].advertId}`}` : 'сначала дождись полной статистики кампаний'}.${mildHumor(tone, 'ads')}`);
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

function formatFinance(data, tone) {
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

function formatProducts(data, tone) {
  const products = Array.isArray(data?.products) ? data.products : [];
  const top = topItems(products, (item) => item.revenue, 6);
  const lines = [`В кабинете доступно ${number(data?.summary?.activeProducts ?? products.length)} товаров.`];
  if (top.length) lines.push(`По выручке лидируют: ${top.map((item) => `${titleOf(item)} — ${money(item.revenue)}`).join('; ')}.`);
  if (data?.recommendations?.length) lines.push(`Первая рекомендация: ${data.recommendations[0].title || data.recommendations[0].text}.`);
  lines.push(mildHumor(tone, 'default'));
  return lines.filter(Boolean).join('\n');
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
  if (!data?.available) return data?.warning || 'Отзывы пока не синхронизированы с WB, поэтому я не буду придумывать мнение покупателей.';
  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
  return `Загружено ${number(reviews.length)} отзывов. Для точного разбора по темам и артикулам нужен нормализованный текст отзывов и связь с nmID.${mildHumor(tone, 'returns')}`;
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

function formatSync(data) {
  const states = Array.isArray(data?.syncStates) ? data.syncStates : [];
  const failed = states.filter((item) => !['success', 'idle'].includes(item.status));
  const lines = [`Синхронизации: ${states.length} потоков, проблемных/ожидающих — ${failed.length}. Последнее обновление: ${data?.lastSync ? new Date(data.lastSync).toLocaleString('ru-RU') : 'нет данных'}.`];
  if (failed.length) lines.push(`Требуют внимания: ${failed.slice(0, 6).map((item) => `${item.stage}: ${item.lastError || item.status}`).join('; ')}.`);
  if (data?.syncWarnings?.length) lines.push(`Предупреждения: ${data.syncWarnings.slice(0, 3).join('; ')}.`);
  return lines.join('\n');
}

const FORMATTERS = {
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

  const modules = options.classification?.modules?.length ? options.classification.modules.slice(0, 3) : inferModules(message, options.history, 3);
  const results = await options.dataBridge.getMany(modules, message);
  const sections = [];
  const warnings = [];
  for (const moduleName of modules) {
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
    sections.push(formatter(data, voice, { message,context:options.context,identity:options.identity }));
    warnings.push(...coverageWarnings(data));
  }

  if (!sections.length) {
    sections.push(noDataResponse(voice, options.identity));
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
    personality,
  };
}

module.exports = { runElAnalyst, inferModules, FORMATTERS, campaignMetrics };
