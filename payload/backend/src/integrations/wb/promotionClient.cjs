'use strict';

const DEFAULT_BASE_URL = 'https://advert-api.wildberries.ru';
const MAX_STATS_DAYS = 31;
const MAX_IDS_PER_REQUEST = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireToken(explicitToken) {
  const token = String(explicitToken || '').trim();
  if (!token) {
    const error = new Error('Токен выбранного кабинета WB не передан в рекламный модуль.');
    error.code = 'WB_CABINET_TOKEN_MISSING';
    error.status = 503;
    throw error;
  }
  return token;
}

function dateKey(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`Некорректная дата: ${raw}`);
  return raw;
}

function toUtcDate(key) {
  const [year, month, day] = dateKey(key).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtc(date) {
  return date.toISOString().slice(0, 10);
}

function splitDateRange(from, to, maxDays = MAX_STATS_DAYS) {
  const start = toUtcDate(from);
  const end = toUtcDate(to);
  if (start > end) throw new Error('Дата начала периода позже даты окончания.');
  const result = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    result.push({ from: formatUtc(cursor), to: formatUtc(chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);
  return Math.min(1000 * (2 ** attempt), 30_000);
}

function apiError(response, payload, text) {
  const message = payload?.message || payload?.detail || text || 'ошибка запроса';
  const error = new Error(`WB Promotion API ${response.status}: ${message}`);
  error.status = response.status;
  error.payload = payload;
  if (response.status === 401) {
    error.code = 'WB_TOKEN_INVALID';
    error.message = 'WB отклонил токен выбранного кабинета. Проверьте токен и подключение кабинета.';
  } else if (response.status === 403) {
    error.code = 'WB_PROMOTION_ACCESS_DENIED';
    error.message = 'У токена выбранного кабинета нет доступа к категории «Продвижение».';
  } else if (response.status === 429) {
    error.code = 'WB_RATE_LIMIT';
  } else {
    error.code = 'WB_PROMOTION_API_ERROR';
  }
  return error;
}

async function fetchJson(pathname, options = {}) {
  const token = requireToken(options.token);
  const baseUrl = options.baseUrl || process.env.WB_PROMOTION_API_URL || DEFAULT_BASE_URL;
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const attempts = Number(options.attempts || 4);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
          'User-Agent': 'ELISEI-WB-Ads/5.3.13',
          ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });

      if (response.status === 204) return null;
      const responseText = await response.text();
      let payload = null;
      if (responseText) {
        try { payload = JSON.parse(responseText); } catch (_) { payload = { raw: responseText }; }
      }

      if (response.ok) return payload;
      const error = apiError(response, payload, responseText);
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
        await sleep(retryDelay(response, attempt));
        lastError = error;
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError' || error.status || attempt >= attempts - 1) throw error;
      await sleep(Math.min(1000 * (2 ** attempt), 10_000));
    }
  }
  throw lastError || new Error('WB Promotion API недоступен.');
}

function flattenCampaigns(payload) {
  const groups = Array.isArray(payload) ? payload : (payload?.adverts || payload?.advert_list || []);
  const result = [];
  const visit = (node, inherited = {}) => {
    if (!node || typeof node !== 'object') return;
    const advertId = Number(node.advertId ?? node.advert_id ?? node.id);
    if (Number.isFinite(advertId) && advertId > 0) {
      result.push({
        advertId,
        type: Number(node.type ?? inherited.type ?? 0),
        status: Number(node.status ?? inherited.status ?? 0),
        changeTime: node.changeTime || node.change_time || inherited.changeTime || null,
      });
    }
    const nextInherited = {
      type: node.type ?? inherited.type,
      status: node.status ?? inherited.status,
      changeTime: node.changeTime ?? node.change_time ?? inherited.changeTime,
    };
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((item) => visit(item, nextInherited));
    }
  };
  groups.forEach((item) => visit(item));
  const unique = new Map();
  result.forEach((item) => unique.set(item.advertId, { ...(unique.get(item.advertId) || {}), ...item }));
  return [...unique.values()];
}

async function listCampaigns(options = {}) {
  const payload = await fetchJson('/adv/v1/promotion/count', options);
  return flattenCampaigns(payload);
}

async function getConfig(options = {}) {
  try {
    return await fetchJson('/api/advert/v1/config', options);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function getFullStats({ ids, from, to, ...options }) {
  const campaignIds = [...new Set((ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!campaignIds.length) return [];
  const ranges = splitDateRange(from, to);
  const idBatches = chunk(campaignIds, MAX_IDS_PER_REQUEST);
  const all = [];
  for (const range of ranges) {
    for (const idBatch of idBatches) {
      const payload = await fetchJson('/adv/v3/fullstats', {
        ...options,
        query: {
          ...(options.query || {}),
          ids: idBatch.join(','),
          beginDate: range.from,
          endDate: range.to,
        },
      });
      if (Array.isArray(payload)) all.push(...payload);
      else if (Array.isArray(payload?.adverts)) all.push(...payload.adverts);
      else if (payload) all.push(payload);
      await sleep(Number(options.batchDelayMs ?? 250));
    }
  }
  return all;
}

module.exports = {
  MAX_STATS_DAYS,
  MAX_IDS_PER_REQUEST,
  fetchJson,
  flattenCampaigns,
  listCampaigns,
  getConfig,
  getFullStats,
  splitDateRange,
  requireToken,
};
