'use strict';

const MONTHS = new Map([
  ['январь',1],['января',1],['янв',1],
  ['февраль',2],['февраля',2],['фев',2],
  ['март',3],['марта',3],['мар',3],
  ['апрель',4],['апреля',4],['апр',4],
  ['май',5],['мая',5],
  ['июнь',6],['июня',6],['июн',6],
  ['июль',7],['июля',7],['июл',7],
  ['август',8],['августа',8],['авг',8],
  ['сентябрь',9],['сентября',9],['сен',9],['сент',9],
  ['октябрь',10],['октября',10],['окт',10],
  ['ноябрь',11],['ноября',11],['ноя',11],
  ['декабрь',12],['декабря',12],['дек',12],
]);

const MONTH_NAMES = ['','января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

function pad(value) { return String(value).padStart(2, '0'); }
function validDateKey(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}
function keyFromParts(year, month, day) {
  const key = `${String(year).padStart(4,'0')}-${pad(month)}-${pad(day)}`;
  return validDateKey(key);
}
function dateFromKey(key) { return new Date(`${validDateKey(key)}T00:00:00.000Z`); }
function keyFromDate(date) { return date.toISOString().slice(0, 10); }
function addDays(key, count) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + Number(count || 0));
  return keyFromDate(date);
}
function daysInclusive(from, to) {
  return Math.max(1, Math.round((dateFromKey(to) - dateFromKey(from)) / 86400000) + 1);
}
function startOfWeek(key) {
  const date = dateFromKey(key);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return keyFromDate(date);
}
function startOfMonth(key) { return `${key.slice(0, 7)}-01`; }
function endOfMonth(year, month) { return keyFromDate(new Date(Date.UTC(year, month, 0))); }
function normalizeYear(raw, referenceYear) {
  if (!raw) return referenceYear;
  const value = Number(raw);
  if (!Number.isFinite(value)) return referenceYear;
  return value < 100 ? 2000 + value : value;
}
function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[\u00a0\s]+/g, ' ').trim();
}
function monthNumber(raw) {
  const key = normalizeText(raw).replace(/\.$/, '');
  return MONTHS.get(key) || null;
}
function makePeriod(from, to, kind, matchedText = '') {
  const start = validDateKey(from);
  const end = validDateKey(to);
  if (!start || !end || start > end) return null;
  return {
    from:start,
    to:end,
    days:daysInclusive(start,end),
    source:'message',
    kind,
    matchedText:String(matchedText || '').trim(),
  };
}
function referenceLocalDate(options = {}) {
  const supplied = validDateKey(options.localDate || options.clientLocalDate || options.referenceDate);
  if (supplied) return supplied;
  return new Date().toISOString().slice(0, 10);
}

function parseNumericRange(text, reference) {
  const refYear = Number(reference.slice(0,4));
  const match = text.match(/(?:^|\s)(?:с\s+)?(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\s*(?:по|до|—|–|-)\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?(?=$|\s|[,.!?])/i);
  if (!match) return null;
  const fromYear = normalizeYear(match[3] || match[6], refYear);
  const toYear = normalizeYear(match[6] || match[3], fromYear);
  return makePeriod(
    keyFromParts(fromYear, Number(match[2]), Number(match[1])),
    keyFromParts(toYear, Number(match[5]), Number(match[4])),
    'explicit-range', match[0],
  );
}

function parseTextRange(text, reference) {
  const refYear = Number(reference.slice(0,4));
  let match = text.match(/(?:^|\s)(?:с\s+)?(\d{1,2})\s*(?:по|до|—|–|-)\s*(\d{1,2})\s+([а-я.]+)(?:\s+(\d{4}))?(?=$|\s|[,.!?])/i);
  if (match) {
    const month = monthNumber(match[3]);
    const year = normalizeYear(match[4], refYear);
    if (month) return makePeriod(keyFromParts(year,month,Number(match[1])), keyFromParts(year,month,Number(match[2])), 'explicit-range', match[0]);
  }
  match = text.match(/(?:^|\s)с\s+(\d{1,2})\s+([а-я.]+)(?:\s+(\d{4}))?\s+(?:по|до)\s+(\d{1,2})\s+([а-я.]+)(?:\s+(\d{4}))?(?=$|\s|[,.!?])/i);
  if (!match) return null;
  const month1 = monthNumber(match[2]);
  const month2 = monthNumber(match[5]);
  if (!month1 || !month2) return null;
  const year1 = normalizeYear(match[3] || match[6], refYear);
  const year2 = normalizeYear(match[6] || match[3], year1);
  return makePeriod(keyFromParts(year1,month1,Number(match[1])), keyFromParts(year2,month2,Number(match[4])), 'explicit-range', match[0]);
}

function parseExplicitDate(text, reference) {
  const refYear = Number(reference.slice(0,4));
  let match = text.match(/(?:^|\s)(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?(?=$|\s|[,.!?])/i);
  if (match) {
    const key = keyFromParts(normalizeYear(match[3], refYear), Number(match[2]), Number(match[1]));
    if (key) return makePeriod(key,key,'explicit-date',match[0]);
  }
  match = text.match(/(?:^|\s)(\d{1,2})\s+([а-я.]+)(?:\s+(\d{4}))?(?=$|\s|[,.!?])/i);
  if (!match) return null;
  const month = monthNumber(match[2]);
  if (!month) return null;
  const key = keyFromParts(normalizeYear(match[3], refYear), month, Number(match[1]));
  return key ? makePeriod(key,key,'explicit-date',match[0]) : null;
}

function parseElTemporalRange(message, options = {}) {
  const text = normalizeText(message);
  if (!text) return null;
  const today = referenceLocalDate(options);
  const todayDate = dateFromKey(today);
  const year = todayDate.getUTCFullYear();
  const month = todayDate.getUTCMonth() + 1;

  if (/позавчера/.test(text)) {
    const key = addDays(today,-2); return makePeriod(key,key,'day-before-yesterday','позавчера');
  }
  if (/вчера(?:шн(?:ий|его|ему|ем|яя|юю|ей|ее)\s+день)?/.test(text)) {
    const key = addDays(today,-1); return makePeriod(key,key,'yesterday','вчера');
  }
  if (/сегодня(?:шн(?:ий|его|ему|ем|яя|юю|ей|ее)\s+день)?/.test(text)) {
    return makePeriod(today,today,'today','сегодня');
  }

  let match = text.match(/(?:за\s+)?последн(?:ие|их)\s+(\d{1,3})\s+дн(?:я|ей|ь)/);
  if (!match) match = text.match(/(?:^|\s)за\s+(\d{1,3})\s+дн(?:я|ей|ь)/);
  if (match) {
    const count = Math.max(1,Math.min(366,Number(match[1])));
    return makePeriod(addDays(today,-count+1),today,'last-days',match[0]);
  }

  if (/(?:на\s+этой|в\s+этой|текущ(?:ая|ую))\s+недел(?:е|я|ю)|с\s+начала\s+недел(?:и|я)/.test(text)) {
    return makePeriod(startOfWeek(today),today,'current-week','текущая неделя');
  }
  if (/(?:за\s+)?прошл(?:ая|ую|ой)\s+недел(?:я|ю|е)/.test(text)) {
    const to = addDays(startOfWeek(today),-1);
    return makePeriod(addDays(to,-6),to,'previous-week','прошлая неделя');
  }
  if (/(?:в\s+этом|за\s+текущ(?:ий|ем)|текущ(?:ий|его))\s+месяц(?:е|а)?|с\s+начала\s+месяц(?:а)?/.test(text)) {
    return makePeriod(startOfMonth(today),today,'current-month','текущий месяц');
  }
  if (/(?:за\s+)?прошл(?:ый|ого|ом)\s+месяц(?:е|а)?/.test(text)) {
    const previousMonthDate = new Date(Date.UTC(year,month-2,1));
    const prevYear = previousMonthDate.getUTCFullYear();
    const prevMonth = previousMonthDate.getUTCMonth()+1;
    return makePeriod(keyFromParts(prevYear,prevMonth,1),endOfMonth(prevYear,prevMonth),'previous-month','прошлый месяц');
  }
  if (/(?:в\s+этом|за\s+текущ(?:ий|ем)|текущ(?:ий|его))\s+год(?:у|а)?|с\s+начала\s+год(?:а)?/.test(text)) {
    return makePeriod(`${year}-01-01`,today,'current-year','текущий год');
  }
  if (/(?:за\s+)?прошл(?:ый|ого|ом)\s+год(?:у|а)?/.test(text)) {
    return makePeriod(`${year-1}-01-01`,`${year-1}-12-31`,'previous-year','прошлый год');
  }

  return parseNumericRange(text,today)
    || parseTextRange(text,today)
    || parseExplicitDate(text,today)
    || null;
}

function formatRuDate(key, includeYear = true) {
  const valid = validDateKey(key);
  if (!valid) return String(key || '');
  const [year,month,day] = valid.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month]}${includeYear ? ` ${year} года` : ''}`;
}

function formatRuPeriod(period = {}) {
  const from = validDateKey(period.from || period.dateFrom || period.date_from);
  const to = validDateKey(period.to || period.dateTo || period.date_to);
  if (!from || !to) return period.days ? `${period.days} дн.` : 'доступный период';
  if (from === to) return formatRuDate(from,true);
  const [fy,fm,fd] = from.split('-').map(Number);
  const [ty,tm,td] = to.split('-').map(Number);
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTH_NAMES[fm]} ${fy} года`;
  if (fy === ty) return `${fd} ${MONTH_NAMES[fm]} — ${td} ${MONTH_NAMES[tm]} ${fy} года`;
  return `${formatRuDate(from,true)} — ${formatRuDate(to,true)}`;
}

module.exports = {
  parseElTemporalRange,
  formatRuDate,
  formatRuPeriod,
  validDateKey,
  addDays,
  daysInclusive,
};
