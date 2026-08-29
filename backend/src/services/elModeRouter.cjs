'use strict';

const { detectModules } = require('./elModuleRegistry.cjs');
const { normalizeMode } = require('./elPlans.cjs');

const BUSINESS_RE = /(wildberries|вайлдбер|\bwb\b|кабинет|продаж|заказ|выручк|оборот|деньг|бабк|тащ|принос|реклам|кампан|дрр|roas|romi|cpc|ctr|остат|склад|закончат|дефицит|оборачиваем|прибыл|марж|p&l|pnl|себестоим|комисси|логистик|расход|товар|артикул|nmid|карточк|размер|штрихкод|возврат|отказ|выкуп|fbs|фбс|fbo|фбо|отзыв|рейтинг|цен|скидк|акци|сезон|закуп|дозаказ|синхрон|импорт|качество данных|что изменилось|что поменялось|важнее всего|главное действие|разбери причины|найди причину|похвали.*(?:делу|кабинет)|что.*кабинет.*хорош)/i;
const EXTERNAL_RE = /(в интернете|в сети|поищи|найди свеж|свежие измен|новост|официальн.*источник|ссылк.*источник|конкурент|рынок|тренд.*рынк|что нового|правил.*wildberries|закон|курс валют|погода)/i;
const GENERAL_GPT_RE = /(поговор|поболта|как дела|расскажи анекдот|пошути|придумай|напиши|составь|переведи|объясни тему|план поездки|рецепт|поздравлен)/i;

function lastBusinessHint(history = []) {
  return [...(Array.isArray(history) ? history : [])].reverse().find((item) => item?.role === 'user' && BUSINESS_RE.test(String(item.content || '')))?.content || '';
}

function classifyElRequest({ message, requestedMode, history, page } = {}) {
  const text = String(message || '').trim();
  const mode = normalizeMode(requestedMode, 'analyst');
  const explicitExternal = EXTERNAL_RE.test(text);
  const explicitGeneral = GENERAL_GPT_RE.test(text);
  const modules = detectModules(text, 4);
  const business = BUSINESS_RE.test(text) || (!explicitGeneral && !explicitExternal && Boolean(lastBusinessHint(history))) || Boolean(page?.section && page.section !== 'Спросить ЭЛа' && modules.length);

  // Любой вопрос только по данным кабинета всегда обрабатывает бесплатный аналитический движок.
  if (business && !explicitExternal) return { mode: 'analyst', reason: 'cabinet-question', modules };
  if (mode === 'analyst') return { mode: 'analyst', reason: business ? 'cabinet-question' : 'analyst-selected', modules };
  if (explicitExternal && mode === 'pro') return { mode: 'pro', reason: 'external-research', modules };
  return { mode, reason: explicitGeneral ? 'general-chat' : 'user-selected', modules };
}

module.exports = { classifyElRequest, BUSINESS_RE, EXTERNAL_RE, GENERAL_GPT_RE };
