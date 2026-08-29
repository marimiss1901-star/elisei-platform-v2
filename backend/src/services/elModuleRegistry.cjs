'use strict';

const MODULES = Object.freeze({
  diagnostics: {
    title: 'Изменения, причины и главное действие',
    internal: true,
    keywords: ['что изменилось', 'что поменялось', 'почему упал', 'почему упала', 'почему просел', 'почему просела', 'почему снизил', 'почему снизилась', 'почему стало хуже', 'важнее всего', 'главное действие', 'одно главное действие', 'выбрать одно действие', 'выбери одно действие', 'помоги выбрать', 'что делать по кабинету', 'что делать', 'разбери причины', 'найди причину'],
    paths: [],
  },
  overview: {
    title: 'Общий обзор бизнеса',
    keywords: ['что важно', 'что происходит', 'общий обзор', 'сводка', 'сегодня', 'бизнес', 'кабинет'],
    paths: ['/api/dashboard', '/api/dashboard/summary', '/api/analytics/summary', '/api/analytics/dashboard', '/api/overview'],
  },
  sales: {
    title: 'Продажи и заказы',
    keywords: ['продаж', 'заказ', 'выручк', 'оборот', 'сколько покупателей', 'количество покупателей', 'повторные покупатели', 'конверси', 'fbs', 'фбс', 'fbo', 'фбо', 'схема доставки'],
    paths: ['/api/analytics/sales', '/api/sales', '/api/orders/analytics', '/api/orders', '/api/wb/orders'],
  },
  advertising: {
    title: 'Реклама и продвижение',
    keywords: ['реклам', 'кампан', 'ддр', 'дрр', 'roas', 'romi', 'cpc', 'ctr', 'ставк', 'бюджет', 'продвижен'],
    paths: ['/api/ads/el-insights', '/api/ads/overview', '/api/ads/campaigns', '/api/advertising/overview', '/api/promotion/analytics'],
  },
  stocks: {
    title: 'Остатки и склады',
    keywords: ['остат', 'склад', 'заканчива', 'закончат', 'скоро закончатся', 'дефицит', 'оборачиваем', 'хранен', 'поставк', 'stock'],
    paths: ['/api/stocks/analytics', '/api/stocks', '/api/wb/stocks', '/api/inventory', '/api/warehouses/stocks'],
  },
  finance: {
    title: 'Финансы и P&L',
    keywords: ['прибыл', 'марж', 'финанс', 'p&l', 'pnl', 'себестоим', 'комисси', 'эквайринг', 'логистик', 'расход', 'затрат', 'удержан', 'налог', 'по каждому артикулу', 'по артикулам'],
    paths: ['/api/finance/overview', '/api/finance', '/api/pnl', '/api/analytics/finance', '/api/profit/analytics'],
  },
  products: {
    title: 'Товары и карточки',
    keywords: ['товар', 'артикул', 'nmid', 'карточк', 'размер', 'штрихкод', 'vendorcode', 'каталог'],
    paths: ['/api/products/analytics', '/api/products', '/api/catalog/products', '/api/wb/products', '/api/nomenclatures'],
  },
  returns: {
    title: 'Возвраты и отказы',
    keywords: ['возврат', 'отказ', 'выкуп', 'брак', 'дефект', 'невыкуп'],
    paths: ['/api/returns/analytics', '/api/returns', '/api/wb/returns', '/api/analytics/returns'],
  },
  reviews: {
    title: 'Отзывы, вопросы и качество',
    keywords: ['отзыв', 'рейтинг', 'оценк', 'жалоб', 'качеств', 'feedback', 'вопрос покупател', 'вопросы покупател', 'чат с покупател', 'чаты', 'сообщени покупател'],
    paths: ['/api/reviews/analytics', '/api/reviews', '/api/feedbacks', '/api/wb/reviews', '/api/quality/reviews'],
  },
  pricing: {
    title: 'Цены и акции',
    keywords: ['цен', 'скидк', 'акци', 'промо', 'безубыточ', 'цена в ноль', 'price'],
    paths: ['/api/pricing/analytics', '/api/pricing', '/api/prices', '/api/promos', '/api/discounts'],
  },
  seasonality: {
    title: 'Сезонность и спрос',
    keywords: ['сезон', 'спрос', 'тренд', 'летн', 'зимн', 'весенн', 'осенн', 'пик продаж'],
    paths: ['/api/seasonality/analytics', '/api/seasonality', '/api/demand/analytics', '/api/trends'],
  },
  procurement: {
    title: 'Закупки и пополнение',
    keywords: ['закуп', 'дозаказ', 'дозаказывать', 'стоит ли дозаказывать', 'пополн', 'поставить', 'поставка', 'план закуп', 'сколько заказать'],
    paths: ['/api/procurement/recommendations', '/api/procurement', '/api/purchase-plan', '/api/supplies/recommendations', '/api/replenishment'],
  },
  sync: {
    title: 'Синхронизации и качество данных',
    keywords: ['синхрон', 'обновлен', 'загруз', 'импорт', 'ошибк данных', 'качество данных', 'api', 'источник данных'],
    paths: ['/api/sync/status', '/api/import/history', '/api/data-quality', '/api/health', '/api/status'],
  },
});

function moduleNames() { return Object.keys(MODULES); }

function normalizeModule(value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODULES, key) ? key : null;
}

function detectModules(question, limit = 4) {
  const text = String(question || '').toLowerCase();
  const scored = [];
  for (const [name, config] of Object.entries(MODULES)) {
    let score = 0;
    for (const keyword of config.keywords) {
      if (text.includes(keyword)) score += keyword.length >= 8 ? 3 : 2;
    }
    if (score) scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!scored.length && /что|почему|проверь|анализ|разбер|важно|делать/.test(text)) {
    return ['overview', 'finance', 'advertising', 'stocks'].slice(0, limit);
  }
  return scored.slice(0, limit).map((item) => item.name);
}

function publicCapabilities() {
  return Object.entries(MODULES).filter(([, config]) => !config.internal).map(([id, config]) => ({ id, title: config.title }));
}

module.exports = { MODULES, moduleNames, normalizeModule, detectModules, publicCapabilities };
