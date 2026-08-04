'use strict';

const { parseElTemporalRange, validDateKey } = require('./elTemporal.cjs');
const { detectModules } = require('./elModuleRegistry.cjs');

const FOLLOWUP_RE = /(?:^|\s)(?:а\s+)?(?:из\s+них|из\s+этого|по\s+ним|а\s+сколько|сколько\s+из\s+них|а\s+возврат|а\s+заказ|а\s+продаж|а\s+выруч|а\s+товар|какие\s+товар|а\s+по\s+(?:fbs|fbo|фбс|фбо)|(?:fbs|fbo|фбс|фбо)(?:\s|$)|а\s+что\s+с\s+ними|а\s+доля|а\s+процент)/i;
const DIRECT_FOLLOWUP_METRIC_RE = /(?:fbs|фбс|fbo|фбо|возврат|заказ|проданн(?:ых|ые)?\s+единиц|продаж|выручк|товар|артикул|доля|процент)/i;

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : []).filter((item) => item && ['user','assistant'].includes(item.role) && item.content);
}

function isFollowupMessage(message = '') {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 220) return false;
  if (FOLLOWUP_RE.test(text)) return true;
  if (/^(?:а|и|тогда|ещё|еще)\b/i.test(text) && DIRECT_FOLLOWUP_METRIC_RE.test(text)) return true;
  return false;
}

function metricFromText(message = '') {
  const text = String(message || '').toLowerCase();
  if (/(?:^|[^a-zа-я0-9])(?:fbs|фбс)(?=$|[^a-zа-я0-9])/i.test(text) && /заказ|сколько|из\s+них|доля|процент/.test(text)) return 'fbs_orders';
  if (/(?:^|[^a-zа-я0-9])(?:fbo|фбо)(?=$|[^a-zа-я0-9])/i.test(text) && /заказ|сколько|из\s+них|доля|процент/.test(text)) return 'fbo_orders';
  if (/возврат/.test(text)) return 'returns';
  if (/выручк/.test(text)) return 'revenue';
  if (/заказ/.test(text)) return 'orders';
  if (/проданн(?:ых|ые)?\s+единиц|продаж/.test(text)) return 'sales';
  if (/товар|артикул|лидер|топ/.test(text)) return 'products';
  return null;
}

function cleanPeriod(value = {}) {
  const from = validDateKey(value?.from || value?.dateFrom || value?.date_from);
  const to = validDateKey(value?.to || value?.dateTo || value?.date_to);
  if (!from || !to) return null;
  const days = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
  return { from,to,days };
}

function lastAssistantContext(history = []) {
  for (const item of [...normalizeHistory(history)].reverse()) {
    if (item.role !== 'assistant') continue;
    const context = item.analysisContext && typeof item.analysisContext === 'object' ? item.analysisContext : null;
    const period = cleanPeriod(context?.period || item.resolvedPeriod || {});
    const modules = Array.isArray(context?.modules) ? context.modules.filter(Boolean) : Array.isArray(item.modulesUsed) ? item.modulesUsed.filter(Boolean) : [];
    if (period || modules.length || context?.metric) return { period,modules,metric:context?.metric || null };
  }
  return null;
}

function lastBusinessUserContext(history = [], clock = {}) {
  for (const item of [...normalizeHistory(history)].reverse()) {
    if (item.role !== 'user') continue;
    const modules = detectModules(item.content,4);
    const period = parseElTemporalRange(item.content,clock);
    if (period || modules.length) return { period:cleanPeriod(period || {}),modules,metric:metricFromText(item.content) };
  }
  return null;
}

function resolveConversationFollowup({ message,history,clock,defaultPeriod } = {}) {
  const followup = isFollowupMessage(message);
  const currentMetric = metricFromText(message);
  if (!followup) return { isFollowup:false,metric:currentMetric,inheritedPeriod:null,inheritedModules:[],antecedentMetric:null };
  const assistant = lastAssistantContext(history);
  const user = lastBusinessUserContext(history,clock);
  const inheritedPeriod = assistant?.period || user?.period || cleanPeriod(defaultPeriod || {});
  const inheritedModules = assistant?.modules?.length ? assistant.modules : user?.modules || [];
  return {
    isFollowup:true,
    metric:currentMetric,
    inheritedPeriod,
    inheritedModules,
    antecedentMetric:assistant?.metric || user?.metric || null,
  };
}

function buildAnalysisContext({ period,modules,message,followup } = {}) {
  return {
    period:cleanPeriod(period || {}),
    modules:Array.isArray(modules) ? modules.filter(Boolean).slice(0,4) : [],
    metric:metricFromText(message) || followup?.metric || null,
    followup:Boolean(followup?.isFollowup),
  };
}

module.exports = {
  isFollowupMessage,
  metricFromText,
  resolveConversationFollowup,
  buildAnalysisContext,
  cleanPeriod,
};
