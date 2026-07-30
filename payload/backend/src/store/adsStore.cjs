'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolveStoreFile() {
  if (process.env.ELISEI_ADS_CACHE_FILE) return path.resolve(process.env.ELISEI_ADS_CACHE_FILE);
  const candidates = [
    path.resolve(process.cwd(), 'backend/data/wb-ads-cache.json'),
    path.resolve(process.cwd(), 'data/wb-ads-cache.json'),
  ];
  return fs.existsSync(path.dirname(candidates[0])) ? candidates[0] : candidates[1];
}

function emptyStore() {
  return { version: 1, ranges: {}, updatedAt: null };
}

function readStore() {
  const file = resolveStoreFile();
  try {
    return { file, data: { ...emptyStore(), ...JSON.parse(fs.readFileSync(file, 'utf8')) } };
  } catch (_) {
    return { file, data: emptyStore() };
  }
}

function writeStore(data) {
  const file = resolveStoreFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(temp, file);
  return file;
}

function rangeKey(from, to) {
  return `${from}__${to}`;
}

function getRange(from, to) {
  const { data } = readStore();
  return data.ranges?.[rangeKey(from, to)] || null;
}

function setRange(from, to, value) {
  const { data } = readStore();
  const ranges = { ...(data.ranges || {}), [rangeKey(from, to)]: value };
  const entries = Object.entries(ranges)
    .sort(([, a], [, b]) => String(b.syncedAt || '').localeCompare(String(a.syncedAt || '')))
    .slice(0, 12);
  data.ranges = Object.fromEntries(entries);
  writeStore(data);
  return value;
}

module.exports = { resolveStoreFile, readStore, writeStore, getRange, setRange, rangeKey };
