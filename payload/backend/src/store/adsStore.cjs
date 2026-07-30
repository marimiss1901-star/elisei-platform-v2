'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_RANGES_PER_SCOPE = Number(process.env.ELISEI_ADS_CACHE_RANGES || 12);
const MAX_SCOPES = Number(process.env.ELISEI_ADS_CACHE_SCOPES || 100);

function resolveStoreFile() {
  if (process.env.ELISEI_ADS_CACHE_FILE) return path.resolve(process.env.ELISEI_ADS_CACHE_FILE);
  const candidates = [
    path.resolve(process.cwd(), 'backend/data/wb-ads-cache.json'),
    path.resolve(process.cwd(), 'data/wb-ads-cache.json'),
  ];
  return fs.existsSync(path.dirname(candidates[0])) ? candidates[0] : candidates[1];
}

function emptyStore() {
  return { version: 2, scopes: {}, updatedAt: null };
}

function migrate(data) {
  if (!data || typeof data !== 'object') return emptyStore();
  if (data.version === 2 && data.scopes) return { ...emptyStore(), ...data };
  if (data.ranges) {
    return {
      ...emptyStore(),
      scopes: {
        legacy: {
          cabinetId: 'legacy',
          updatedAt: data.updatedAt || null,
          ranges: data.ranges,
        },
      },
    };
  }
  return emptyStore();
}

function readStore() {
  const file = resolveStoreFile();
  try {
    return { file, data: migrate(JSON.parse(fs.readFileSync(file, 'utf8'))) };
  } catch (_) {
    return { file, data: emptyStore() };
  }
}

function writeStore(data) {
  const file = resolveStoreFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...data, version: 2, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(temp, file);
  return file;
}

function rangeKey(from, to) {
  return `${from}__${to}`;
}

function getRange(scopeKey, from, to) {
  const { data } = readStore();
  return data.scopes?.[scopeKey]?.ranges?.[rangeKey(from, to)] || null;
}

function setRange(scopeKey, from, to, value, metadata = {}) {
  if (!scopeKey) throw new Error('Для рекламного кэша не передан scopeKey кабинета.');
  const { data } = readStore();
  const previousScope = data.scopes?.[scopeKey] || { ranges: {} };
  const ranges = { ...(previousScope.ranges || {}), [rangeKey(from, to)]: value };
  const rangeEntries = Object.entries(ranges)
    .sort(([, a], [, b]) => String(b.syncedAt || '').localeCompare(String(a.syncedAt || '')))
    .slice(0, MAX_RANGES_PER_SCOPE);
  const now = new Date().toISOString();
  const scope = {
    ...previousScope,
    ...metadata,
    updatedAt: now,
    ranges: Object.fromEntries(rangeEntries),
  };
  const scopes = { ...(data.scopes || {}), [scopeKey]: scope };
  const scopeEntries = Object.entries(scopes)
    .sort(([, a], [, b]) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_SCOPES);
  data.scopes = Object.fromEntries(scopeEntries);
  writeStore(data);
  return value;
}

module.exports = {
  resolveStoreFile,
  readStore,
  writeStore,
  getRange,
  setRange,
  rangeKey,
  migrate,
};
