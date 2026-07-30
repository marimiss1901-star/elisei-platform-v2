const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = [
  'date', 'day', 'period', 'createdAt', 'created_at', 'updatedAt', 'updated_at',
  'saleDate', 'sale_date', 'orderDate', 'order_date', 'eventDate', 'event_date',
  'lastChangeDate', 'last_change_date', 'rrd_id_date', 'reportDate', 'report_date',
];

function validDate(value) {
  if (!DATE_RE.test(String(value || ''))) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : String(value);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function parsePeriod(req) {
  const query = req.query || {};
  const body = req.body || {};
  const headers = req.headers || {};
  const from = validDate(first(query.date_from, body.date_from, body.period?.from, headers['x-elisei-date-from']));
  const to = validDate(first(query.date_to, body.date_to, body.period?.to, headers['x-elisei-date-to']));
  const compareEnabled = bool(first(query.compare, body.compare, body.period?.compareEnabled, headers['x-elisei-compare']), true);
  const compareFrom = validDate(first(query.compare_from, body.compare_from, body.period?.compareFrom, headers['x-elisei-compare-from']));
  const compareTo = validDate(first(query.compare_to, body.compare_to, body.period?.compareTo, headers['x-elisei-compare-to']));
  const mode = String(first(query.period_mode, body.period_mode, body.period?.mode, headers['x-elisei-period-mode'], 'custom'));
  return { from, to, mode, compareEnabled, compareFrom, compareTo };
}

export function extractItemDate(item) {
  if (!item || typeof item !== 'object') return '';
  for (const field of DATE_FIELDS) {
    const raw = item[field];
    if (!raw) continue;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw));
    if (match) return match[1];
  }
  return '';
}

export function filterRowsByPeriod(rows, period) {
  if (!Array.isArray(rows) || !period?.from || !period?.to) return rows;
  return rows.filter((item) => {
    const date = extractItemDate(item);
    return !date || (date >= period.from && date <= period.to);
  });
}

export function filterPayloadByPeriod(payload, period, depth = 0) {
  if (!period?.from || !period?.to || depth > 5 || payload == null) return payload;
  if (Array.isArray(payload)) return filterRowsByPeriod(payload, period).map((item) => filterPayloadByPeriod(item, period, depth + 1));
  if (typeof payload !== 'object') return payload;
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = filterPayloadByPeriod(value, period, depth + 1);
  }
  if (depth === 0) result.period = { ...period };
  return result;
}

export function sqlPeriod(column, period, startIndex = 1) {
  if (!period?.from || !period?.to) return { clause: '', values: [], nextIndex: startIndex };
  return {
    clause: `${column} >= $${startIndex}::date AND ${column} < ($${startIndex + 1}::date + INTERVAL '1 day')`,
    values: [period.from, period.to],
    nextIndex: startIndex + 2,
  };
}

export function elPeriodContext(period) {
  if (!period?.from || !period?.to) return '';
  const comparison = period.compareEnabled && period.compareFrom && period.compareTo
    ? ` Сравнение: ${period.compareFrom} — ${period.compareTo}.`
    : '';
  return `Анализируй данные строго за ${period.from} — ${period.to}.${comparison}`;
}
