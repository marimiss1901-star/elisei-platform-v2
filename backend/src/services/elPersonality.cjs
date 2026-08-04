'use strict';

const DEFAULT_EL_PROFILE = Object.freeze({
  character: 'insider',
  humor: 'light',
  support: true,
  celebrations: true,
  address: 'auto',
  noHumorInCritical: true,
});

const CHARACTER_VALUES = new Set(['professional', 'friendly', 'insider']);
const HUMOR_VALUES = new Set(['off', 'light', 'noticeable']);
const ADDRESS_VALUES = new Set(['auto', 'formal', 'informal']);

const CRITICAL_RE = /(?:убыт|минус|штраф|удержан|блокир|заблок|приостан|ошибк|не работает|сломал|потер|долг|претензи|суд|опасн|критич|провал|резк(?:ая|ое|ий)\s+пад|возврат(?:ов)?\s+(?:слишком\s+)?много|товар\s+скрыт)/i;
const FORMAL_RE = /(?:\bвы\b|\bвам\b|\bвас\b|пожалуйста|будьте добры)/i;
const INFORMAL_RE = /(?:\bты\b|\bтебе\b|\bтебя\b|давай|слушай|привет|окей|ок|ага)/i;

const EMOTION_RULES = [
  ['tired', /(?:я\s+устал|устала|сил\s+нет|выдохлась|выдохся|очень\s+устал|замучил)/i],
  ['frustrated', /(?:ничего\s+не\s+получается|бесит|достало|раздражает|опять\s+не\s+работает|я\s+злюсь|кошмар)/i],
  ['worried', /(?:переживаю|страшно|волнуюсь|боюсь|паник)/i],
  ['celebrate', /(?:получилось|ура|мы\s+сделали|готово|заработало|всё\s+работает|отличный\s+результат)/i],
  ['thanks', /(?:спасибо|благодарю|ты\s+молодец)/i],
  ['joke', /(?:пошути|расскажи\s+шутк|развесели|что-нибудь\s+смешн)/i],
  ['praise', /(?:похвали|что\s+у\s+меня\s+хорошо|я\s+молодец|поддержи\s+меня)/i],
  ['greeting', /^(?:эл[,!?:\s-]*)?(?:привет(?:ик(?:и)?|ики|ствую)?|прив|здравствуй(?:те)?|здрасьте|салют|хай|hello|доброе\s+утро|добрый\s+(?:день|вечер)|как\s+(?:дела|ты)|есть\s+кто)[!?.…,:;\s-]*$/i],
  ['presence', /^(?:эл[,!?:\s-]*)?(?:ты\s+(?:тут|здесь)|что\s+делаешь|чем\s+занят|как\s+настроение|ты\s+живой|отзовись)[!?.…,:;\s-]*$/i],
];

const HUMOR = {
  ads: {
    light: [
      'Реклама должна продавать, а не просто красиво тратить бюджет.',
      'Клики — ребята общительные, но кассу делают всё-таки заказы.',
      'ДРР любит внимание: оставишь без присмотра — быстро освоится в бюджете.',
    ],
    noticeable: [
      'Реклама не должна работать фитнес-тренером для бюджета: деньги убежали, а заказов не прибавилось.',
      'Кампания бодро машет показами, но касса пока не машет в ответ.',
      'Бюджет уже на работе. Проверим, почему продажи ещё ищут парковку.',
    ],
  },
  stocks: {
    light: [
      'Склад любит запасы, но деньги всё-таки любят движение.',
      'Полный склад — ещё не победа. Иногда это просто очень дорогая коллекция коробок.',
      'Размерный ряд должен продаваться, а не играть в прятки.',
    ],
    noticeable: [
      'Если товар лежит слишком долго, склад начинает считать его членом семьи.',
      'Коробки на складе выглядят солидно, но дивиденды пока не платят.',
      'Остаток большой — хорошо. Остаток без продаж — уже интерьер.',
    ],
  },
  finance: {
    light: [
      'Выручка выглядит бодро, но прибыль всегда просит показать чеки.',
      'Оборот любит сцену, а прибыль предпочитает тихо пересчитать расходы за кулисами.',
      'Красивый лям — ещё не прибыльный лям. Смотрим, сколько дошло домой.',
    ],
    noticeable: [
      'Выручка пришла нарядная, а за ней комиссия, логистика и реклама — вся компания в сборе.',
      'Оборот может быть лям двести, но прибыль всё равно спросит: «А мне что осталось?»',
      'Цифра большая, настроение хорошее. Теперь открываем расходы — и знакомимся с реальностью.',
    ],
  },
  returns: {
    light: [
      'Покупатель иногда голосует не звёздами, а коробкой обратно.',
      'Возврат — неприятный, но довольно честный комментарий к карточке.',
      'Здесь товару явно есть что обсудить с размерной сеткой.',
    ],
    noticeable: [
      'Коробка съездила к покупателю и вернулась с мнением. Разберём, каким именно.',
      'Возвраты устроили обратную логистику мнений — пора читать сигналы.',
      'Когда товар возвращается чаще покупателя, это уже не доставка, а гастроли.',
    ],
  },
  sync: {
    light: [
      'WB снова попросил паузу. Данные не потерялись — просто API взял кофе-брейк.',
      'Очередь жива, курсор сохранён. Никакой кнопочной паники.',
      'Поток притормозил, но не забыл, куда шёл.',
    ],
    noticeable: [
      'WB API ненадолго ушёл подумать о вечном. Мы сохранили страницу и подождём.',
      'Синхронизация не сломалась — просто Wildberries включил режим «перезвоните позже».',
      'Курсор на месте, данные на месте, драму отменяем.',
    ],
  },
  success: {
    light: [
      'Вот это уже хороший рабочий результат.',
      'Сделано аккуратно — можно двигаться дальше.',
      'Отлично: система не просто выглядит живой, она действительно работает.',
    ],
    noticeable: [
      'Вот это разговор — цифры наконец ведут себя прилично.',
      'Красиво сделали. Даже таблицы выглядят немного гордыми.',
      'Есть контакт: кнопки нажимаются, данные считаются, нервы отдыхают.',
    ],
  },
  neutral: {
    light: [
      'Цифры без паники: сначала проверяем, потом назначаем виновных.',
      'Разложим по полкам — желательно не только складским.',
      'Сначала факты, потом выводы. Магию оставим конкурентам.',
    ],
    noticeable: [
      'Сейчас спокойно разберёмся: цифры любят порядок больше, чем совещания.',
      'Давайте откроем данные — там обычно меньше драмы и больше конкретики.',
      'Проверим факты. Хрустальный шар снова можно не доставать.',
    ],
  },
};

function normalizeElProfile(input = {}) {
  const character = CHARACTER_VALUES.has(String(input.character || '')) ? String(input.character) : DEFAULT_EL_PROFILE.character;
  let humorInput = input.humor;
  if (humorInput === true) humorInput = 'light';
  if (humorInput === false) humorInput = 'off';
  const humor = HUMOR_VALUES.has(String(humorInput || '')) ? String(humorInput) : DEFAULT_EL_PROFILE.humor;
  const address = ADDRESS_VALUES.has(String(input.address || '')) ? String(input.address) : DEFAULT_EL_PROFILE.address;
  return {
    character,
    humor,
    support: input.support !== false,
    celebrations: input.celebrations !== false,
    address,
    noHumorInCritical: true,
  };
}

function historyText(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-24)
    .map((item) => String(item?.content || item?.text || ''))
    .join('\n')
    .toLowerCase();
}

function safeSummary(context = {}) {
  const screen = context?.screen && typeof context.screen === 'object' ? context.screen : {};
  const summary = screen?.summary && typeof screen.summary === 'object' ? screen.summary : {};
  return summary;
}

function isCriticalSituation(message, context = {}) {
  if (CRITICAL_RE.test(String(message || ''))) return true;
  const summary = safeSummary(context);
  if (summary.operatingProfit != null && Number(summary.operatingProfit) < 0) return true;
  if (summary.penalties != null && Number(summary.penalties) > 0) return true;
  if (summary.deductions != null && Number(summary.deductions) > 0) return true;
  return false;
}

function detectEmotion(message) {
  const text = String(message || '').trim();
  for (const [name, pattern] of EMOTION_RULES) if (pattern.test(text)) return name;
  return 'neutral';
}

function resolveAddress(profile, message, history = []) {
  if (profile.address === 'formal') return 'formal';
  if (profile.address === 'informal') return 'informal';
  const sample = `${historyText(history)}\n${String(message || '')}`;
  if (FORMAL_RE.test(sample) && !INFORMAL_RE.test(sample)) return 'formal';
  return 'informal';
}

function stableIndex(seed, length) {
  let hash = 2166136261;
  for (const char of String(seed || 'elisei')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, length);
}

function pickNonRepeated(phrases, history, seed) {
  const list = Array.isArray(phrases) ? phrases.filter(Boolean) : [];
  if (!list.length) return '';
  const previous = historyText(history);
  const fresh = list.filter((phrase) => !previous.includes(String(phrase).toLowerCase()));
  const pool = fresh.length ? fresh : list;
  return pool[stableIndex(seed, pool.length)] || '';
}

function createVoiceContext({ profile, message, history, context, seed } = {}) {
  const normalized = normalizeElProfile(profile);
  const critical = isCriticalSituation(message, context);
  const emotion = detectEmotion(message);
  const address = resolveAddress(normalized, message, history);
  const humorAllowed = normalized.humor !== 'off' && !(normalized.noHumorInCritical && critical);
  return {
    profile: normalized,
    character: normalized.character,
    humor: normalized.humor,
    support: normalized.support,
    celebrations: normalized.celebrations,
    address,
    critical,
    emotion,
    history: Array.isArray(history) ? history : [],
    context: context || {},
    seed: seed || `${message || ''}:${Date.now()}`,
    message: String(message || ''),
    humorAllowed,
  };
}

function humorLine(voice, key = 'neutral') {
  if (!voice?.humorAllowed) return '';
  const level = voice.humor === 'noticeable' ? 'noticeable' : 'light';
  const group = HUMOR[key] || HUMOR.neutral;
  return pickNonRepeated(group[level], voice.history, `${voice.seed}:${key}:${level}`);
}

function greetingFor(voice, identity = {}) {
  const clientHour = Number(voice?.context?.screen?.localHour);
  const hour = Number.isFinite(clientHour) && clientHour >= 0 && clientHour <= 23 ? clientHour : new Date().getHours();
  const daypart = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const name = String(identity.userName || '').trim().split(/\s+/)[0];
  const address = name ? `, ${name}` : '';
  const playfulGreeting = /приветик|приветики|хай|салют|прив/i.test(String(voice?.message || ''));
  if (voice.character === 'professional') return `${daypart}${address}. Я на связи и готов проверить данные кабинета.`;
  if (voice.character === 'friendly') return `${playfulGreeting ? 'Привет' : daypart}${address}! Я рядом. Что сегодня разберём первым?`;
  const joke = humorLine(voice, 'neutral');
  const hello = playfulGreeting ? 'Приветики' : daypart;
  return `${hello}${address} 😄 Я тут и уже мысленно открыл таблицы.${joke ? ` ${joke}` : ' Что разбираем?'}`;
}

function presenceResponse(voice, identity = {}) {
  const name = String(identity.userName || '').trim().split(/\s+/)[0];
  const address = name ? `, ${name}` : '';
  if (voice.character === 'professional') return `Да${address}, я на связи. Готов перейти к вопросу по кабинету.`;
  if (voice.character === 'friendly') return `Я здесь${address}. Не пропал — просто ждал, с чего начнём.`;
  const joke = humorLine(voice, 'neutral');
  return `Тут${address} 😄 Не сплю, не завис — караулю цифры.${joke ? ` ${joke}` : ''}`;
}

function noDataResponse(voice, identity = {}) {
  const name = String(identity?.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  if (voice.character === 'professional') {
    return `${prefix}я понял вопрос, но подтверждённых данных выбранного кабинета пока недостаточно. Проверьте подключение WB и журнал синхронизаций — вывод без фактов делать не буду.`;
  }
  if (voice.character === 'friendly') {
    return `${prefix}я понял, что нужно проверить, но WB пока не дал достаточно подтверждённых данных. Давай заглянем в подключение и синхронизации — после загрузки разберу всё нормально, без догадок.`;
  }
  const joke = humorLine(voice, 'sync');
  return `${prefix}вопрос понял, но цифр пока маловато. Не буду изображать ясновидящего: сначала проверим подключение WB и синхронизации.${joke ? ` ${joke}` : ''}`;
}

function supportResponse(voice, identity = {}) {
  const name = String(identity.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  if (!voice.support) return `${prefix}готов помочь с конкретным вопросом по кабинету. Выберем один раздел и разберём его по фактам.`;
  if (voice.emotion === 'tired') {
    return voice.address === 'formal'
      ? `${prefix}понимаю. Давайте сегодня без героизма: выберем одно самое важное действие по кабинету и закроем только его. Остальное не убежит.`
      : `${prefix}понимаю. Давай сегодня без героизма: выберем одно самое важное действие по кабинету и закроем только его. Остальное не убежит.`;
  }
  if (voice.emotion === 'frustrated') {
    return voice.address === 'formal'
      ? `${prefix}да, это раздражает. Не буду отвечать пустым «всё хорошо»: покажите, что именно не сработало, и мы отделим ошибку WB от ошибки ELISEI.`
      : `${prefix}да, это бесит. Не буду отвечать пустым «всё хорошо»: покажи, что именно не сработало, и мы отделим ошибку WB от ошибки ELISEI.`;
  }
  if (voice.emotion === 'worried') {
    return voice.address === 'formal'
      ? `${prefix}давайте не делать вывод раньше данных. Сначала проверим масштаб проблемы, период и источник — после этого будет понятно, что действительно требует действия.`
      : `${prefix}давай не делать вывод раньше данных. Сначала проверим масштаб проблемы, период и источник — после этого станет понятно, что реально требует действия.`;
  }
  return `${prefix}я рядом. Назови, что сейчас давит сильнее всего, и разберём это без лишней драмы — по одному шагу.`;
}

function praiseResponse(voice, identity = {}) {
  const name = String(identity.userName || '').trim().split(/\s+/)[0];
  const prefix = name ? `${name}, ` : '';
  const summary = safeSummary(voice.context);
  const facts = [];
  if (summary.revenue != null) facts.push(`в кабинете есть подтверждённая выручка ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(summary.revenue || 0))} ₽`);
  if (summary.operatingProfit != null && Number(summary.operatingProfit) > 0) facts.push(`операционная прибыль положительная`);
  if (summary.stockUnits != null) facts.push(`остатки собраны в единую картину`);
  const fact = facts[0] || 'ты последовательно доводишь систему до рабочего состояния, а не оставляешь её красивым макетом';
  const ending = voice.celebrations ? humorLine(voice, 'success') : '';
  return `${prefix}${fact}. Это не комплимент для настроения, а реальный результат работы.${ending ? ` ${ending}` : ''}`;
}

function jokeResponse(voice) {
  if (!voice.humorAllowed) return 'Сейчас лучше без шуток: в сообщении есть признаки критической ситуации. Сначала разберём проблему, потом уже можно смеяться над API.';
  const line = humorLine(voice, 'neutral');
  return line || 'У меня сегодня строгий режим: шутки отключены в настройках характера.';
}

function socialResponse({ message, profile, history, context, identity } = {}) {
  const voice = createVoiceContext({ profile, message, history, context, seed: message });
  if (voice.emotion === 'greeting') return { text: greetingFor(voice, identity), reaction: reactionFor({ voice, kind: 'greeting' }), kind: 'social' };
  if (voice.emotion === 'presence') return { text: presenceResponse(voice, identity), reaction: reactionFor({ voice, kind: 'greeting' }), kind: 'social' };
  if (['tired', 'frustrated', 'worried'].includes(voice.emotion)) return { text: supportResponse(voice, identity), reaction: reactionFor({ voice, kind: 'support' }), kind: 'support' };
  if (voice.emotion === 'praise') return { text: praiseResponse(voice, identity), reaction: reactionFor({ voice, kind: 'praise' }), kind: 'support' };
  if (voice.emotion === 'joke') return { text: jokeResponse(voice), reaction: reactionFor({ voice, kind: 'joke' }), kind: 'social' };
  if (voice.emotion === 'thanks') {
    const text = voice.character === 'professional' ? 'Рад помочь. Продолжаем по данным кабинета.' : 'Пожалуйста. Мы с цифрами уже почти сработались.';
    return { text, reaction: reactionFor({ voice, kind: 'thanks' }), kind: 'social' };
  }
  if (voice.emotion === 'celebrate' && voice.celebrations) {
    const line = humorLine(voice, 'success');
    return { text: line || 'Отлично. Это хороший рабочий результат — зафиксировали и идём дальше.', reaction: reactionFor({ voice, kind: 'celebrate' }), kind: 'celebration' };
  }
  return null;
}

function reactionFor({ voice, kind = 'analysis', positive = false, warning = false } = {}) {
  if (kind === 'support') return { mood: 'supportive', label: 'Я рядом' };
  if (kind === 'praise' || kind === 'celebrate' || positive) return { mood: 'proud', label: 'Есть чем гордиться' };
  if (kind === 'joke' || kind === 'thanks' || kind === 'greeting') return { mood: 'happy', label: 'На связи' };
  if (voice?.critical || warning) return { mood: 'concerned', label: 'Спокойно, проверяем' };
  return { mood: 'thinking', label: 'Смотрю на данные' };
}

module.exports = {
  DEFAULT_EL_PROFILE,
  normalizeElProfile,
  createVoiceContext,
  humorLine,
  socialResponse,
  noDataResponse,
  reactionFor,
  isCriticalSituation,
  detectEmotion,
  pickNonRepeated,
};
