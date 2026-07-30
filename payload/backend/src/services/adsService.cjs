'use strict';

const promotion = require('../integrations/wb/promotionClient.cjs');
const store = require('../store/adsStore.cjs');
const analytics = require('./adsAnalytics.cjs');

const running = new Map();
const CACHE_TTL_MS = Number(process.env.ELISEI_ADS_CACHE_TTL_MS || 15 * 60 * 1000);

function isFresh(value) {
  if (!value?.syncedAt) return false;
  return Date.now() - new Date(value.syncedAt).getTime() < CACHE_TTL_MS;
}

function requireScope(options) {
  if (!options?.scopeKey) {
    const error = new Error('Не определён кабинет для рекламной аналитики.');
    error.code = 'WB_CABINET_REQUIRED';
    error.status = 400;
    throw error;
  }
  return options.scopeKey;
}

async function syncRange(from, to, options = {}) {
  const scopeKey = requireScope(options);
  const jobKey = `${scopeKey}:${store.rangeKey(from, to)}`;
  if (!options.force && running.has(jobKey)) return running.get(jobKey);
  const job = (async () => {
    const campaigns = await promotion.listCampaigns(options);
    const ids = campaigns.map((item) => item.advertId);
    const [rawStats, config] = await Promise.all([
      promotion.getFullStats({ ids, from, to, ...options }),
      promotion.getConfig(options).catch((error) => {
        if (error.code === 'WB_PROMOTION_ACCESS_DENIED' || error.code === 'WB_TOKEN_INVALID') throw error;
        return null;
      }),
    ]);
    const analyzed = analytics.aggregate(rawStats, campaigns, options);
    const result = {
      from,
      to,
      syncedAt: new Date().toISOString(),
      source: 'WB Promotion API',
      cabinetId: options.cabinetId,
      currency: config?.currency || config?.currencyCode || 'RUB',
      config,
      ...analyzed,
      meta: { campaignIds: ids.length, rawCampaignRows: rawStats.length },
    };
    store.setRange(scopeKey, from, to, result, {
      cabinetId: options.cabinetId,
    });
    return result;
  })().finally(() => running.delete(jobKey));
  running.set(jobKey, job);
  return job;
}

async function getRange(from, to, options = {}) {
  const scopeKey = requireScope(options);
  const cached = store.getRange(scopeKey, from, to);
  if (cached && !options.force && (isFresh(cached) || options.autoSync === false)) return { ...cached, cache: true };
  if (options.autoSync === false) return cached ? { ...cached, cache: true, stale: true } : null;
  try {
    return await syncRange(from, to, options);
  } catch (error) {
    if (cached) return { ...cached, cache: true, stale: true, syncWarning: error.message };
    throw error;
  }
}

module.exports = { syncRange, getRange, isFresh, requireScope };
