'use strict';

const { MODULES, normalizeModule, detectModules } = require('./elModuleRegistry.cjs');

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_CHARS = 30000;

function compact(value, max = MAX_RESPONSE_CHARS) {
  if (value == null) return null;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, max);
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= max) return value;
    return { truncated: true, preview: raw.slice(0, max) };
  } catch {
    return String(value).slice(0, max);
  }
}

function periodQuery(period = {}) {
  const from = period.from || period.dateFrom || period.date_from || period.start || period.startDate;
  const to = period.to || period.dateTo || period.date_to || period.end || period.endDate;
  const params = new URLSearchParams();
  if (from) { params.set('from', from); params.set('date_from', from); }
  if (to) { params.set('to', to); params.set('date_to', to); }
  const compare = period.compareEnabled ?? period.compare ?? false;
  if (compare) params.set('compare', '1');
  if (period.compareFrom) params.set('compare_from', period.compareFrom);
  if (period.compareTo) params.set('compare_to', period.compareTo);
  params.set('limit', String(Math.min(Number(period.limit || 100), 200)));
  return params;
}

function requestBase(req) {
  const explicit = process.env.ELISEI_INTERNAL_API_BASE || process.env.ELISEI_BACKEND_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.get?.('host') || req.headers.host;
  if (!host) return null;
  return `${proto}://${host}`;
}

function forwardHeaders(req, identity) {
  const headers = {
    Accept: 'application/json',
    'X-Cabinet-Id': identity.cabinetId,
    'X-Cabinet-Name': encodeURIComponent(identity.cabinetName || ''),
    'X-El-Internal-Read': '1',
  };
  for (const name of ['authorization', 'cookie', 'x-user-id', 'x-api-key']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  return headers;
}

function routePaths(app) {
  const result = new Set();
  const root = app?._router?.stack || app?.router?.stack || [];
  function walk(stack, prefix = '') {
    for (const layer of stack || []) {
      if (layer.route?.path) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        const methods = Object.keys(layer.route.methods || {}).filter((method) => layer.route.methods[method]);
        if (!methods.includes('get')) continue;
        for (const item of paths) {
          const full = `${prefix}${item}`.replace(/\/+/g, '/');
          if (!full.includes(':') && full.startsWith('/api/') && !full.startsWith('/api/el')) result.add(full);
        }
      } else if (layer.handle?.stack) {
        const guessed = layer.regexp?.fast_slash ? '' : '';
        walk(layer.handle.stack, `${prefix}${guessed}`);
      }
    }
  }
  walk(root);
  return [...result];
}

function discoveredForModule(app, moduleName) {
  const config = MODULES[moduleName];
  if (!config) return [];
  const tokens = [moduleName, ...config.keywords].map((item) => item.replace(/[^a-zа-я0-9]/gi, '')).filter((item) => item.length >= 4);
  return routePaths(app).filter((route) => {
    const clean = route.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    return tokens.some((token) => clean.includes(token));
  }).slice(0, 8);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const response = await (options.fetchImpl || fetch)(url, { headers: options.headers, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, MAX_RESPONSE_CHARS) }; }
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return compact(data);
  } finally {
    clearTimeout(timer);
  }
}

function createBusinessDataBridge({ req, identity, period, question, fetchImpl } = {}) {
  if (!req) throw new Error('Для El data bridge нужен Express request.');
  const app = req.app;
  const base = requestBase(req);
  const headers = forwardHeaders(req, identity);
  const cache = new Map();

  async function fromProvider(moduleName, focus) {
    const providers = app?.locals?.elModuleProviders;
    if (providers && typeof providers[moduleName] === 'function') {
      return { source: 'provider', data: compact(await providers[moduleName]({ req, identity, period, question, focus, module: moduleName })) };
    }
    if (typeof app?.locals?.getElModuleData === 'function') {
      const data = await app.locals.getElModuleData({ req, identity, period, question, focus, module: moduleName });
      if (data != null) return { source: 'provider', data: compact(data) };
    }
    return null;
  }

  async function fromEndpoints(moduleName) {
    if (!base) return { source: 'none', warning: 'Не удалось определить внутренний адрес backend.' };
    const config = MODULES[moduleName];
    const paths = [...new Set([...config.paths, ...discoveredForModule(app, moduleName)])].filter((path) => !path.startsWith('/api/el'));
    const query = periodQuery(period);
    const successes = [];
    const failures = [];
    for (const path of paths) {
      if (successes.length >= 2) break;
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}${query.toString()}`;
      try {
        const data = await fetchJson(url, { headers, fetchImpl });
        successes.push({ path, data });
      } catch (error) {
        failures.push({ path, status: error.status || null, message: error.message });
      }
    }
    if (successes.length) return { source: 'internal-api', endpoints: successes };
    return { source: 'none', warning: `Данные модуля «${config.title}» не найдены через доступные read-only API.`, attempts: failures.slice(0, 6) };
  }

  async function getModule(moduleValue, focus = '') {
    const moduleName = normalizeModule(moduleValue);
    if (!moduleName) return { ok: false, error: `Неизвестный модуль: ${moduleValue}` };
    const cacheKey = `${moduleName}:${String(focus).slice(0, 200)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const promise = (async () => {
      try {
        const provider = await fromProvider(moduleName, focus);
        const result = provider || await fromEndpoints(moduleName);
        return { ok: result.source !== 'none', module: moduleName, title: MODULES[moduleName].title, period, focus, ...result };
      } catch (error) {
        return { ok: false, module: moduleName, title: MODULES[moduleName].title, period, focus, warning: error.message };
      }
    })();
    cache.set(cacheKey, promise);
    return promise;
  }

  async function getMany(modules, focus = '') {
    const unique = [...new Set((modules || []).map(normalizeModule).filter(Boolean))].slice(0, 4);
    const values = await Promise.all(unique.map((moduleName) => getModule(moduleName, focus)));
    return Object.fromEntries(values.map((value) => [value.module, value]));
  }

  async function prefetchForQuestion(text = question) {
    const modules = detectModules(text, 4);
    return { detectedModules: modules, data: await getMany(modules, text) };
  }

  return { getModule, getMany, prefetchForQuestion, availableModules: Object.keys(MODULES) };
}

module.exports = { createBusinessDataBridge, periodQuery, requestBase, routePaths, compact };
