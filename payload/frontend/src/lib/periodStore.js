import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'elisei.globalPeriod.v2';
const LEGACY_STORAGE_KEY = 'elisei.globalPeriod.v1';
const EVENT_NAME = 'elisei:period-changed';
const REFRESH_EVENT = 'elisei:data-refresh';
const DAY_MS = 86400000;

const pad = (value) => String(value).padStart(2, '0');
const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDateKey = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
};
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const startOfWeek = (date) => {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
};
const endOfWeek = (date) => addDays(startOfWeek(date), 6);
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1, 12);
const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);

export const PERIOD_MODES = Object.freeze({ DAY: 'day', WEEK: 'week', MONTH: 'month', CUSTOM: 'custom' });

function rangeForMode(mode, anchor = new Date(), customFrom, customTo) {
  const safeAnchor = parseDateKey(anchor) || (anchor instanceof Date ? anchor : new Date());
  if (mode === PERIOD_MODES.DAY) {
    const key = toDateKey(safeAnchor);
    return { from: key, to: key };
  }
  if (mode === PERIOD_MODES.WEEK) return { from: toDateKey(startOfWeek(safeAnchor)), to: toDateKey(endOfWeek(safeAnchor)) };
  if (mode === PERIOD_MODES.MONTH) return { from: toDateKey(startOfMonth(safeAnchor)), to: toDateKey(endOfMonth(safeAnchor)) };
  const from = parseDateKey(customFrom) || safeAnchor;
  const to = parseDateKey(customTo) || from;
  return from <= to ? { from: toDateKey(from), to: toDateKey(to) } : { from: toDateKey(to), to: toDateKey(from) };
}

function previousRange(from, to) {
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  if (!fromDate || !toDate) return { compareFrom: '', compareTo: '' };
  const length = Math.round((toDate - fromDate) / DAY_MS) + 1;
  const compareTo = addDays(fromDate, -1);
  const compareFrom = addDays(compareTo, -(length - 1));
  return { compareFrom: toDateKey(compareFrom), compareTo: toDateKey(compareTo) };
}

function normalize(value = {}) {
  const mode = Object.values(PERIOD_MODES).includes(value.mode) ? value.mode : PERIOD_MODES.WEEK;
  const anchor = parseDateKey(value.anchor) || new Date();
  const range = rangeForMode(mode, anchor, value.from, value.to);
  return {
    mode,
    anchor: toDateKey(anchor),
    from: range.from,
    to: range.to,
    compareEnabled: value.compareEnabled !== false,
    ...previousRange(range.from, range.to),
    revision: Number(value.revision || 0),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const stored = JSON.parse(raw || 'null');
    if (stored) return normalize(stored);
  } catch (_) {}
  return normalize({ mode: PERIOD_MODES.WEEK, anchor: toDateKey(new Date()), compareEnabled: true });
}

let snapshot = typeof window === 'undefined'
  ? normalize({ mode: PERIOD_MODES.WEEK, anchor: toDateKey(new Date()), compareEnabled: true })
  : loadInitial();
const listeners = new Set();
let fetchInstalled = false;
let xhrInstalled = false;
let originalFetch = null;
let originalXhrOpen = null;
let originalXhrSend = null;
let reloadTimer = null;

function expose() {
  if (typeof window === 'undefined') return;
  window.__ELISEI_PERIOD__ = { ...snapshot };
  window.__ELISEI_PERIOD_REVISION__ = snapshot.revision;
}

function updateAddressBar(period) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('date_from', period.from);
    url.searchParams.set('date_to', period.to);
    url.searchParams.set('period_mode', period.mode);
    url.searchParams.set('compare', period.compareEnabled ? '1' : '0');
    if (period.compareEnabled) {
      url.searchParams.set('compare_from', period.compareFrom);
      url.searchParams.set('compare_to', period.compareTo);
    } else {
      url.searchParams.delete('compare_from');
      url.searchParams.delete('compare_to');
    }
    window.history.replaceState(window.history.state, '', url.toString());
  } catch (_) {}
}

function notify({ refresh = true } = {}) {
  listeners.forEach((listener) => listener());
  if (typeof window === 'undefined') return;
  expose();
  updateAddressBar(snapshot);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...snapshot } }));
  if (refresh) {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: { ...snapshot } }));
    // Legacy pages often load data only once. A reload is the reliable fallback;
    // the selected period survives in localStorage and interceptors are installed before requests start.
    if (window.__ELISEI_DISABLE_PERIOD_RELOAD__ !== true) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => window.location.reload(), 120);
    }
  }
}

export function getPeriodSnapshot() { return snapshot; }

export function setPeriod(next, options = {}) {
  const candidate = normalize({ ...snapshot, ...next });
  const changed = ['mode', 'anchor', 'from', 'to', 'compareEnabled', 'compareFrom', 'compareTo']
    .some((key) => candidate[key] !== snapshot[key]);
  snapshot = { ...candidate, revision: changed ? snapshot.revision + 1 : snapshot.revision, updatedAt: new Date().toISOString() };
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  notify({ refresh: options.refresh !== false && changed });
  return snapshot;
}

export function shiftPeriod(direction) {
  const delta = direction < 0 ? -1 : 1;
  const anchor = parseDateKey(snapshot.anchor) || new Date();
  if (snapshot.mode === PERIOD_MODES.DAY) anchor.setDate(anchor.getDate() + delta);
  if (snapshot.mode === PERIOD_MODES.WEEK) anchor.setDate(anchor.getDate() + 7 * delta);
  if (snapshot.mode === PERIOD_MODES.MONTH) anchor.setMonth(anchor.getMonth() + delta);
  if (snapshot.mode === PERIOD_MODES.CUSTOM) {
    const from = parseDateKey(snapshot.from);
    const to = parseDateKey(snapshot.to);
    const length = Math.round((to - from) / DAY_MS) + 1;
    return setPeriod({
      from: toDateKey(addDays(from, length * delta)),
      to: toDateKey(addDays(to, length * delta)),
      anchor: toDateKey(addDays(to, length * delta)),
    });
  }
  return setPeriod({ anchor: toDateKey(anchor) });
}

export function subscribePeriod(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function useGlobalPeriod() { return useSyncExternalStore(subscribePeriod, getPeriodSnapshot, getPeriodSnapshot); }

export function getPeriodLabel(period = snapshot) {
  const labels = { day: 'День', week: 'Неделя', month: 'Месяц', custom: 'Период' };
  return `${labels[period.mode] || 'Период'}: ${period.from} — ${period.to}`;
}

export function getElPeriodContext(period = snapshot) {
  const comparison = period.compareEnabled ? ` Сравнивай с ${period.compareFrom} — ${period.compareTo}.` : '';
  return `Анализируй строго период ${period.from} — ${period.to} (${period.mode}).${comparison}`;
}

function addPeriodParams(url, period = snapshot) {
  const aliases = {
    date_from: period.from,
    date_to: period.to,
    from: period.from,
    to: period.to,
    startDate: period.from,
    endDate: period.to,
    period_from: period.from,
    period_to: period.to,
    period_mode: period.mode,
    compare: period.compareEnabled ? '1' : '0',
  };
  if (period.compareEnabled) {
    aliases.compare_from = period.compareFrom;
    aliases.compare_to = period.compareTo;
  }
  Object.entries(aliases).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('_period_revision', String(period.revision));
  return url;
}

export function withPeriodParams(input, period = snapshot) {
  const raw = String(input || '');
  const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  addPeriodParams(url, period);
  return /^https?:/i.test(raw) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

function isApiRequest(url) {
  const value = String(url || '');
  if (/\/api\//i.test(value)) return true;
  if (/https?:\/\/[^/]*onrender\.com\/api\//i.test(value)) return true;
  return false;
}

function periodHeaders(headers, period = snapshot) {
  headers.set('X-ELISEI-Date-From', period.from);
  headers.set('X-ELISEI-Date-To', period.to);
  headers.set('X-ELISEI-Period-Mode', period.mode);
  headers.set('X-ELISEI-Compare', period.compareEnabled ? '1' : '0');
  headers.set('X-ELISEI-Period-Revision', String(period.revision));
  if (period.compareEnabled) {
    headers.set('X-ELISEI-Compare-From', period.compareFrom);
    headers.set('X-ELISEI-Compare-To', period.compareTo);
  }
  return headers;
}

function isElRequest(url) { return /\/(ai|el|assistant|chat)(\/|\?|$)/i.test(String(url || '')); }
function enrichElBody(body, period) {
  if (!body || typeof body !== 'string') return body;
  try {
    const payload = JSON.parse(body);
    payload.period = { ...period };
    payload.periodContext = getElPeriodContext(period);
    payload.context = { ...(payload.context || {}), period: { ...period } };
    return JSON.stringify(payload);
  } catch (_) { return body; }
}

export function installPeriodTransportInterceptors() {
  if (typeof window === 'undefined') return;
  expose();

  if (!fetchInstalled && typeof window.fetch === 'function') {
    originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      if (!rawUrl || !isApiRequest(rawUrl)) return originalFetch(input, init);
      const period = getPeriodSnapshot();
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      const nextUrl = method === 'GET' || method === 'HEAD' ? withPeriodParams(rawUrl, period) : rawUrl;
      const headers = periodHeaders(new Headers(init.headers || input?.headers || {}), period);
      const nextInit = { ...init, headers, cache: 'no-store' };
      if (isElRequest(rawUrl)) nextInit.body = enrichElBody(init.body, period);
      if (typeof Request !== 'undefined' && input instanceof Request) {
        return originalFetch(new Request(nextUrl, input), nextInit);
      }
      return originalFetch(nextUrl, nextInit);
    };
    fetchInstalled = true;
  }

  if (!xhrInstalled && typeof window.XMLHttpRequest !== 'undefined') {
    originalXhrOpen = window.XMLHttpRequest.prototype.open;
    originalXhrSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      const verb = String(method || 'GET').toUpperCase();
      const target = isApiRequest(url) && (verb === 'GET' || verb === 'HEAD') ? withPeriodParams(url) : url;
      this.__eliseiApiRequest = isApiRequest(url);
      return originalXhrOpen.call(this, method, target, ...rest);
    };
    window.XMLHttpRequest.prototype.send = function patchedSend(body) {
      if (this.__eliseiApiRequest) {
        const period = getPeriodSnapshot();
        try {
          this.setRequestHeader('X-ELISEI-Date-From', period.from);
          this.setRequestHeader('X-ELISEI-Date-To', period.to);
          this.setRequestHeader('X-ELISEI-Period-Mode', period.mode);
          this.setRequestHeader('X-ELISEI-Compare', period.compareEnabled ? '1' : '0');
          if (period.compareEnabled) {
            this.setRequestHeader('X-ELISEI-Compare-From', period.compareFrom);
            this.setRequestHeader('X-ELISEI-Compare-To', period.compareTo);
          }
        } catch (_) {}
      }
      return originalXhrSend.call(this, body);
    };
    xhrInstalled = true;
  }
}

export function installPeriodFetchInterceptor() {
  installPeriodTransportInterceptors();
  return () => {};
}

export const periodEventName = EVENT_NAME;
export const periodRefreshEventName = REFRESH_EVENT;

// Critical: install before page effects start their first API requests.
if (typeof window !== 'undefined') installPeriodTransportInterceptors();
