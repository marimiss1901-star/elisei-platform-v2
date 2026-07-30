const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = ['date','day','period','createdAt','created_at','updatedAt','updated_at','saleDate','sale_date','orderDate','order_date','eventDate','event_date','lastChangeDate','last_change_date','reportDate','report_date'];
const validDate = (value) => {
  if (!DATE_RE.test(String(value || ''))) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : String(value);
};
const bool = (value, fallback = false) => value === undefined || value === null || value === '' ? fallback : ['1','true','yes','on'].includes(String(value).toLowerCase());
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
function parsePeriod(req) {
  const query = req.query || {}, body = req.body || {}, headers = req.headers || {};
  return {
    from: validDate(first(query.date_from, body.date_from, body.period?.from, headers['x-elisei-date-from'])),
    to: validDate(first(query.date_to, body.date_to, body.period?.to, headers['x-elisei-date-to'])),
    mode: String(first(query.period_mode, body.period_mode, body.period?.mode, headers['x-elisei-period-mode'], 'custom')),
    compareEnabled: bool(first(query.compare, body.compare, body.period?.compareEnabled, headers['x-elisei-compare']), true),
    compareFrom: validDate(first(query.compare_from, body.compare_from, body.period?.compareFrom, headers['x-elisei-compare-from'])),
    compareTo: validDate(first(query.compare_to, body.compare_to, body.period?.compareTo, headers['x-elisei-compare-to'])),
  };
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
  if (!period?.from || !period?.to || depth > 5 || payload == null) return payload;
  if (Array.isArray(payload)) return payload.filter((item) => { const date = extractItemDate(item); return !date || (date >= period.from && date <= period.to); }).map((item) => filterPayloadByPeriod(item, period, depth + 1));
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
module.exports = { parsePeriod, filterPayloadByPeriod, sqlPeriod };
