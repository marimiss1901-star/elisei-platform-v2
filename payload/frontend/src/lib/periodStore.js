import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'elisei.globalPeriod.v1';
const EVENT_NAME = 'elisei:period-changed';

const pad = (value) => String(value).padStart(2, '0');
const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDateKey = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
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
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

export const PERIOD_MODES = Object.freeze({
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  CUSTOM: 'custom',
});

function rangeForMode(mode, anchor = new Date(), customFrom, customTo) {
  const safeAnchor = parseDateKey(anchor) || (anchor instanceof Date ? anchor : new Date());
  if (mode === PERIOD_MODES.DAY) {
    const key = toDateKey(safeAnchor);
    return { from: key, to: key };
  }
  if (mode === PERIOD_MODES.WEEK) {
    return { from: toDateKey(startOfWeek(safeAnchor)), to: toDateKey(endOfWeek(safeAnchor)) };
  }
  if (mode === PERIOD_MODES.MONTH) {
    return { from: toDateKey(startOfMonth(safeAnchor)), to: toDateKey(endOfMonth(safeAnchor)) };
  }
  const from = parseDateKey(customFrom) || safeAnchor;
  const to = parseDateKey(customTo) || from;
  return from <= to
    ? { from: toDateKey(from), to: toDateKey(to) }
    : { from: toDateKey(to), to: toDateKey(from) };
}

function previousRange(from, to) {
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  if (!fromDate || !toDate) return { compareFrom: '', compareTo: '' };
  const length = Math.round((toDate - fromDate) / 86400000) + 1;
  const compareTo = addDays(fromDate, -1);
  const compareFrom = addDays(compareTo, -(length - 1));
  return { compareFrom: toDateKey(compareFrom), compareTo: toDateKey(compareTo) };
}

function normalize(value = {}) {
  const mode = Object.values(PERIOD_MODES).includes(value.mode) ? value.mode : PERIOD_MODES.WEEK;
  const anchor = parseDateKey(value.anchor) || new Date();
  const range = rangeForMode(mode, anchor, value.from, value.to);
  const comparison = previousRange(range.from, range.to);
  return {
    mode,
    anchor: toDateKey(anchor),
    from: range.from,
    to: range.to,
    compareEnabled: value.compareEnabled !== false,
    ...comparison,
    updatedAt: new Date().toISOString(),
  };
}

function loadInitial() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored) return normalize(stored);
  } catch (_) {
    // Ignore damaged local storage.
  }
  return normalize({ mode: PERIOD_MODES.WEEK, anchor: toDateKey(new Date()), compareEnabled: true });
}

let snapshot = typeof window === 'undefined'
  ? normalize({ mode: PERIOD_MODES.WEEK, anchor: toDateKey(new Date()), compareEnabled: true })
  : loadInitial();
const listeners = new Set();
let fetchInstalled = false;
let originalFetch = null;

function notify() {
  listeners.forEach((listener) => listener());
  if (typeof window !== 'undefined') {
    window.__ELISEI_PERIOD__ = { ...snapshot };
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...snapshot } }));
  }
}

export function getPeriodSnapshot() {
  return snapshot;
}

export function setPeriod(next) {
  snapshot = normalize({ ...snapshot, ...next });
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }
  notify();
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
    const length = Math.round((to - from) / 86400000) + 1;
    return setPeriod({
      from: toDateKey(addDays(from, length * delta)),
      to: toDateKey(addDays(to, length * delta)),
      anchor: toDateKey(addDays(anchor, length * delta)),
    });
  }
  return setPeriod({ anchor: toDateKey(anchor) });
}

export function subscribePeriod(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGlobalPeriod() {
  return useSyncExternalStore(subscribePeriod, getPeriodSnapshot, getPeriodSnapshot);
}

export function getPeriodLabel(period = snapshot) {
  const labels = {
    [PERIOD_MODES.DAY]: 'День',
    [PERIOD_MODES.WEEK]: 'Неделя',
    [PERIOD_MODES.MONTH]: 'Месяц',
    [PERIOD_MODES.CUSTOM]: 'Период',
  };
  return `${labels[period.mode] || 'Период'}: ${period.from} — ${period.to}`;
}

export function getElPeriodContext(period = snapshot) {
  const comparison = period.compareEnabled
    ? ` Сравнивай с предыдущим аналогичным периодом ${period.compareFrom} — ${period.compareTo}.`
    : '';
  return `Пользователь выбрал период ${period.from} — ${period.to} (${period.mode}). Все выводы, показатели, причины и рекомендации давай строго за этот диапазон.${comparison}`;
}

export function withPeriodParams(input, period = snapshot) {
  const url = new URL(String(input), typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.set('date_from', period.from);
  url.searchParams.set('date_to', period.to);
  url.searchParams.set('period_mode', period.mode);
  url.searchParams.set('compare', period.compareEnabled ? '1' : '0');
  if (period.compareEnabled) {
    url.searchParams.set('compare_from', period.compareFrom);
    url.searchParams.set('compare_to', period.compareTo);
  }
  return /^https?:/i.test(String(input)) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

function isApiRequest(url) {
  const value = String(url || '');
  return /\/api\//i.test(value) || /onrender\.com/i.test(value) || value.startsWith('/');
}

function isElRequest(url) {
  return /\/(ai|el|assistant|chat)(\/|\?|$)/i.test(String(url || ''));
}

function enrichElBody(body, period) {
  if (!body || typeof body !== 'string') return body;
  try {
    const payload = JSON.parse(body);
    payload.period = { ...period };
    payload.periodContext = getElPeriodContext(period);
    payload.context = { ...(payload.context || {}), period: { ...period } };
    return JSON.stringify(payload);
  } catch (_) {
    return body;
  }
}

export function installPeriodFetchInterceptor() {
  if (typeof window === 'undefined' || fetchInstalled) return () => {};
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    if (!rawUrl || !isApiRequest(rawUrl)) return originalFetch(input, init);
    const period = getPeriodSnapshot();
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const nextUrl = method === 'GET' || method === 'HEAD' ? withPeriodParams(rawUrl, period) : rawUrl;
    const headers = new Headers(init.headers || input?.headers || {});
    headers.set('X-ELISEI-Date-From', period.from);
    headers.set('X-ELISEI-Date-To', period.to);
    headers.set('X-ELISEI-Period-Mode', period.mode);
    headers.set('X-ELISEI-Compare', period.compareEnabled ? '1' : '0');
    if (period.compareEnabled) {
      headers.set('X-ELISEI-Compare-From', period.compareFrom);
      headers.set('X-ELISEI-Compare-To', period.compareTo);
    }
    const nextInit = { ...init, headers };
    if (isElRequest(rawUrl)) nextInit.body = enrichElBody(init.body, period);
    return originalFetch(nextUrl, nextInit);
  };
  fetchInstalled = true;
  return () => {
    if (fetchInstalled && originalFetch) window.fetch = originalFetch;
    fetchInstalled = false;
  };
}

export const periodEventName = EVENT_NAME;
