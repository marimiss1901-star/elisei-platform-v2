'use strict';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = ['date','day','period','createdAt','created_at','updatedAt','updated_at','saleDate','sale_date','orderDate','order_date','eventDate','event_date','lastChangeDate','last_change_date','reportDate','report_date','beginDate','endDate'];
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const bool = (value, fallback = false) => value === undefined || value === null || value === '' ? fallback : ['1','true','yes','on'].includes(String(value).toLowerCase());
function validDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!DATE_RE.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? '' : raw;
}
function parsePeriod(req) {
  const query = req.query || {}, body = req.body || {}, headers = req.headers || {};
  return {
    from: validDate(first(query.date_from, query.from, query.startDate, query.period_from, body.date_from, body.from, body.startDate, body.period?.from, headers['x-elisei-date-from'])),
    to: validDate(first(query.date_to, query.to, query.endDate, query.period_to, body.date_to, body.to, body.endDate, body.period?.to, headers['x-elisei-date-to'])),
    mode: String(first(query.period_mode, body.period_mode, body.period?.mode, headers['x-elisei-period-mode'], 'custom')),
    compareEnabled: bool(first(query.compare, body.compare, body.period?.compareEnabled, headers['x-elisei-compare']), true),
    compareFrom: validDate(first(query.compare_from, body.compare_from, body.period?.compareFrom, headers['x-elisei-compare-from'])),
    compareTo: validDate(first(query.compare_to, body.compare_to, body.period?.compareTo, headers['x-elisei-compare-to'])),
    revision: Number(first(query._period_revision, headers['x-elisei-period-revision'], 0)) || 0,
  };
}
function applyAliases(req, period) {
  if (!period.from || !period.to || !req.query || typeof req.query !== 'object') return;
  const aliases = {
    date_from: period.from, date_to: period.to,
    from: period.from, to: period.to,
    startDate: period.from, endDate: period.to,
    period_from: period.from, period_to: period.to,
    period_mode: period.mode,
    compare: period.compareEnabled ? '1' : '0',
    compare_from: period.compareFrom, compare_to: period.compareTo,
  };
  for (const [key, value] of Object.entries(aliases)) {
    if (value !== '' && value !== undefined) {
      try { req.query[key] = value; } catch (_) {}
    }
  }
}
function extractItemDate(item) {
  if (!item || typeof item !== 'object') return '';
  for (const field of DATE_FIELDS) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(item[field] || ''));
    if (match) return match[1];
  }
  return '';
}
function filterPayloadByPeriod(payload, period, depth = 0) {
  if (!period?.from || !period?.to || depth > 8 || payload == null) return payload;
  if (Array.isArray(payload)) return payload
    .filter((item) => { const date = extractItemDate(item); return !date || (date >= period.from && date <= period.to); })
    .map((item) => filterPayloadByPeriod(item, period, depth + 1));
  if (typeof payload !== 'object') return payload;
  const result = {};
  for (const [key, value] of Object.entries(payload)) result[key] = filterPayloadByPeriod(value, period, depth + 1);
  if (depth === 0) result.period = { ...period };
  return result;
}
function sqlPeriod(column, period, startIndex = 1) {
  if (!period?.from || !period?.to) return { clause: '', values: [], nextIndex: startIndex };
  return { clause: `${column} >= $${startIndex}::date AND ${column} < ($${startIndex + 1}::date + INTERVAL '1 day')`, values: [period.from, period.to], nextIndex: startIndex + 2 };
}
module.exports = { parsePeriod, applyAliases, filterPayloadByPeriod, sqlPeriod, extractItemDate, validDate };
