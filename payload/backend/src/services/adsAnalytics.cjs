'use strict';

const fs = require('node:fs');
const path = require('node:path');

const numericKeys = {
  views: ['views', 'impressions', 'shows'],
  clicks: ['clicks'],
  spend: ['sum', 'spend', 'cost', 'expenses'],
  carts: ['atbs', 'carts', 'addToCart'],
  orders: ['orders', 'orderCount'],
  units: ['shks', 'units', 'sales'],
  revenue: ['sum_price', 'revenue', 'salesSum', 'orderSum'],
};

const number = (value) => {
  const normalized = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstNumber = (node, keys) => {
  for (const key of keys) if (node?.[key] !== undefined && node?.[key] !== null) return number(node[key]);
  return 0;
};

function rawMetrics(node = {}) {
  return Object.fromEntries(Object.entries(numericKeys).map(([name, keys]) => [name, firstNumber(node, keys)]));
}

function add(target, source) {
  for (const key of Object.keys(numericKeys)) target[key] = number(target[key]) + number(source[key]);
  return target;
}

function derived(metrics) {
  const views = number(metrics.views);
  const clicks = number(metrics.clicks);
  const spend = number(metrics.spend);
  const orders = number(metrics.orders);
  const revenue = number(metrics.revenue);
  return {
    ...metrics,
    ctr: views ? (clicks / views) * 100 : 0,
    cpc: clicks ? spend / clicks : 0,
    cpo: orders ? spend / orders : 0,
    cvr: clicks ? (orders / clicks) * 100 : 0,
    drr: revenue ? (spend / revenue) * 100 : null,
    roas: spend ? revenue / spend : null,
    romi: spend ? ((revenue - spend) / spend) * 100 : null,
  };
}

function campaignId(node) {
  const value = Number(node?.advertId ?? node?.advert_id ?? node?.id);
  return Number.isFinite(value) ? value : 0;
}

function productId(node) {
  const value = Number(node?.nmId ?? node?.nm_id ?? node?.nm ?? node?.nmid);
  return Number.isFinite(value) ? value : 0;
}

function dateFromNode(node) {
  const value = node?.date || node?.day || node?.dt;
  if (!value) return null;
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function traverse(node, visitor, parents = []) {
  if (!node || typeof node !== 'object') return;
  visitor(node, parents);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => traverse(child, visitor, [...parents, node]));
  }
}

function loadEconomics() {
  const files = [
    process.env.ELISEI_UNIT_ECONOMICS_FILE,
    path.resolve(process.cwd(), 'backend/data/product-unit-economics.json'),
    path.resolve(process.cwd(), 'data/product-unit-economics.json'),
  ].filter(Boolean);
  for (const file of files) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* optional source */ }
  }
  return {};
}

function economicsFor(map, nmId) {
  const value = map?.[String(nmId)] || map?.[nmId] || {};
  return {
    nmId,
    vendorCode: value.vendorCode || value.vendor_code || value.supplierArticle || '',
    title: value.title || value.name || '',
    photo: value.photo || value.image || value.photoUrl || '',
    stock: number(value.stock ?? value.stockQty),
    cogsPerUnit: number(value.cogsPerUnit ?? value.costPrice ?? value.cost_price),
    commissionRate: number(value.commissionRate ?? value.commission_rate),
    logisticsPerUnit: number(value.logisticsPerUnit ?? value.logistics_per_unit),
  };
}

function attachProfit(row, economics) {
  const units = number(row.units || row.orders);
  const known = economics.cogsPerUnit > 0 || economics.commissionRate > 0 || economics.logisticsPerUnit > 0;
  const cogs = economics.cogsPerUnit * units;
  const commission = economics.commissionRate <= 1
    ? economics.commissionRate * number(row.revenue)
    : (economics.commissionRate / 100) * number(row.revenue);
  const logistics = economics.logisticsPerUnit * units;
  const adProfit = known ? number(row.revenue) - cogs - commission - logistics - number(row.spend) : null;
  return {
    ...row,
    ...economics,
    title: economics.title || row.title || row.name || '',
    vendorCode: economics.vendorCode || row.vendorCode || '',
    photo: economics.photo || row.photo || '',
    cogs,
    commission,
    logistics,
    adProfit,
    adProfitKnown: known,
  };
}

function statusLabel(status) {
  return ({ '-1': 'Удалена', 4: 'Готова', 7: 'Завершена', 8: 'Отменена', 9: 'Активна', 11: 'Пауза' })[String(status)] || `Статус ${status || '—'}`;
}

function recommendation(row, targetDrr = 15) {
  const clicks = number(row.clicks);
  const orders = number(row.orders);
  const spend = number(row.spend);
  const drr = row.drr;
  if (spend > 0 && orders === 0 && clicks >= 20) return { code: 'stop', level: 'critical', title: 'Остановить и проверить', text: `Есть ${Math.round(clicks)} кликов без заказов. Проверьте карточку, цену и поисковые запросы.` };
  if (drr !== null && drr > targetDrr * 1.5) return { code: 'reduce', level: 'high', title: 'Снизить расход', text: `ДРР ${drr.toFixed(1)}% выше цели ${targetDrr}%. Снизьте ставку и отключите неэффективные кластеры.` };
  if (number(row.ctr) < 1 && number(row.views) >= 1000) return { code: 'creative', level: 'medium', title: 'Улучшить карточку', text: `CTR ${number(row.ctr).toFixed(2)}%. Нужны сильнее главное фото, заголовок и релевантность запросов.` };
  if (number(row.cvr) < 2 && clicks >= 30) return { code: 'conversion', level: 'medium', title: 'Поднять конверсию', text: `Конверсия ${number(row.cvr).toFixed(1)}%. Проверьте цену, рейтинг, отзывы и остатки размеров.` };
  if (drr !== null && drr <= targetDrr && orders > 0) return { code: 'scale', level: 'good', title: 'Можно масштабировать', text: `ДРР ${drr.toFixed(1)}% в пределах цели. Увеличивайте бюджет постепенно и контролируйте остаток.` };
  return { code: 'observe', level: 'neutral', title: 'Наблюдать', text: 'Данных пока недостаточно для уверенного действия.' };
}

function aggregate(rawStats = [], campaigns = [], options = {}) {
  const targetDrr = number(options.targetDrr || process.env.ELISEI_ADS_TARGET_DRR || 15) || 15;
  const economicsMap = options.economics || loadEconomics();
  const campaignMap = new Map(campaigns.map((item) => [Number(item.advertId), { ...item }]));
  const campaignStatsMap = new Map();
  const productMap = new Map();
  const dailyMap = new Map();

  for (const top of rawStats) {
    const advertId = campaignId(top);
    const base = campaignMap.get(advertId) || { advertId };
    const currentCampaign = campaignStatsMap.get(advertId) || {
      ...base,
      ...Object.fromEntries(Object.keys(numericKeys).map((key) => [key, 0])),
      name: top.name || top.advertName || base.name || `Кампания #${advertId}`,
    };
    add(currentCampaign, rawMetrics(top));
    currentCampaign.name = top.name || top.advertName || currentCampaign.name;
    campaignStatsMap.set(advertId, currentCampaign);

    traverse(top, (node, parents) => {
      const nmId = productId(node);
      if (nmId) {
        const current = productMap.get(nmId) || { nmId, ...Object.fromEntries(Object.keys(numericKeys).map((key) => [key, 0])), campaignIds: new Set() };
        add(current, rawMetrics(node));
        const parentCampaign = [...parents].reverse().map(campaignId).find(Boolean) || advertId;
        if (parentCampaign) current.campaignIds.add(parentCampaign);
        current.name = node.name || node.title || current.name;
        productMap.set(nmId, current);
      }
      const date = dateFromNode(node);
      if (date && !productId(node)) {
        const current = dailyMap.get(date) || { date, ...Object.fromEntries(Object.keys(numericKeys).map((key) => [key, 0])) };
        add(current, rawMetrics(node));
        dailyMap.set(date, current);
      }
    });
  }

  for (const campaign of campaigns) {
    if (!campaignStatsMap.has(Number(campaign.advertId))) {
      campaignStatsMap.set(Number(campaign.advertId), {
        ...campaign,
        ...Object.fromEntries(Object.keys(numericKeys).map((key) => [key, 0])),
        name: `Кампания #${campaign.advertId}`,
      });
    }
  }

  const campaignRows = [...campaignStatsMap.values()].map((item) => {
    const row = {
      ...item,
      ...derived(item),
      statusLabel: statusLabel(item.status),
    };
    row.recommendation = recommendation(row, targetDrr);
    return row;
  });

  const products = [...productMap.values()].map((item) => {
    const row = derived({ ...item, campaignIds: [...item.campaignIds] });
    const withProfit = attachProfit(row, economicsFor(economicsMap, row.nmId));
    withProfit.recommendation = recommendation(withProfit, targetDrr);
    return withProfit;
  }).sort((a, b) => b.spend - a.spend);

  const daily = [...dailyMap.values()].map(derived).sort((a, b) => a.date.localeCompare(b.date));
  const overall = derived(campaignRows.reduce((acc, row) => add(acc, row), Object.fromEntries(Object.keys(numericKeys).map((key) => [key, 0]))));
  const knownProducts = products.filter((item) => item.adProfitKnown);
  overall.adProfit = knownProducts.length ? knownProducts.reduce((sum, item) => sum + number(item.adProfit), 0) : null;
  overall.adProfitKnown = knownProducts.length > 0;
  overall.targetDrr = targetDrr;
  overall.activeCampaigns = campaigns.filter((item) => Number(item.status) === 9).length;
  overall.campaignCount = campaigns.length;
  overall.productCount = products.length;

  return {
    overall,
    campaigns: campaignRows.sort((a, b) => b.spend - a.spend),
    products,
    daily,
    insights: buildInsights({ overall, campaigns: campaignRows, products, targetDrr }),
  };
}

function buildInsights({ overall, campaigns, products, targetDrr }) {
  const actions = [...products, ...campaigns]
    .filter((row) => row.recommendation?.code !== 'observe')
    .sort((a, b) => {
      const rank = { critical: 4, high: 3, medium: 2, good: 1, neutral: 0 };
      return (rank[b.recommendation.level] || 0) - (rank[a.recommendation.level] || 0) || b.spend - a.spend;
    })
    .slice(0, 12)
    .map((row) => ({
      entity: row.nmId ? 'product' : 'campaign',
      id: row.nmId || row.advertId,
      label: row.vendorCode || row.title || row.name || `#${row.nmId || row.advertId}`,
      ...row.recommendation,
      spend: row.spend,
      revenue: row.revenue,
      drr: row.drr,
    }));

  const summary = [];
  if (!overall.spend) summary.push('За выбранный период рекламных расходов нет либо статистика ещё не синхронизирована.');
  else {
    summary.push(`Реклама потратила ${Math.round(overall.spend).toLocaleString('ru-RU')} и принесла ${Math.round(overall.revenue).toLocaleString('ru-RU')} выручки.`);
    if (overall.drr !== null) summary.push(`ДРР составляет ${overall.drr.toFixed(1)}% при целевом уровне ${targetDrr}%.`);
    if (!overall.adProfitKnown) summary.push('Для точной прибыли после рекламы загрузите себестоимость, комиссию и логистику по nmID.');
  }
  return { summary, actions };
}

function percentDelta(current, previous) {
  const a = number(current);
  const b = number(previous);
  if (!b) return a ? null : 0;
  return ((a - b) / Math.abs(b)) * 100;
}

function comparison(current, previous) {
  if (!previous) return null;
  const keys = ['views', 'clicks', 'spend', 'orders', 'revenue', 'ctr', 'cpc', 'cpo', 'cvr', 'drr', 'roas', 'adProfit'];
  return Object.fromEntries(keys.map((key) => [key, { current: current?.[key] ?? null, previous: previous?.[key] ?? null, deltaPercent: percentDelta(current?.[key], previous?.[key]) }]));
}

module.exports = { aggregate, derived, recommendation, buildInsights, comparison, rawMetrics, loadEconomics };
