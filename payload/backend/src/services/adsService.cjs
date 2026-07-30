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

async function syncRange(from, to, options = {}) {
  const key = store.rangeKey(from, to);
  if (!options.force && running.has(key)) return running.get(key);
  const job = (async () => {
    const campaigns = await promotion.listCampaigns(options);
    const ids = campaigns.map((item) => item.advertId);
    const [rawStats, config] = await Promise.all([
      promotion.getFullStats({ ids, from, to, ...options }),
      promotion.getConfig(options).catch(() => null),
    ]);
    const analyzed = analytics.aggregate(rawStats, campaigns, options);
    const result = {
      from,
      to,
      syncedAt: new Date().toISOString(),
      source: 'WB Promotion API',
      currency: config?.currency || config?.currencyCode || 'RUB',
      config,
      ...analyzed,
      meta: { campaignIds: ids.length, rawCampaignRows: rawStats.length },
    };
    store.setRange(from, to, result);
    return result;
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

async function getRange(from, to, options = {}) {
  const cached = store.getRange(from, to);
  if (cached && !options.force && (isFresh(cached) || options.autoSync === false)) return { ...cached, cache: true };
  if (options.autoSync === false) return cached ? { ...cached, cache: true, stale: true } : null;
  try {
    return await syncRange(from, to, options);
  } catch (error) {
    if (cached) return { ...cached, cache: true, stale: true, syncWarning: error.message };
    throw error;
  }
}

module.exports = { syncRange, getRange, isFresh };
