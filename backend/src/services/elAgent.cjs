'use strict';

const crypto = require('node:crypto');
const { requestResponses } = require('./openaiResponsesClient.cjs');
const { uniqueSources, outputText } = require('./elSources.cjs');
const { buildInstructions } = require('./elPrompt.cjs');
const { moduleNames, detectModules } = require('./elModuleRegistry.cjs');

const MAX_TOOL_ROUNDS = 6;

function functionTools(options = {}) {
  const tools = [
    {
      type: 'function',
      name: 'get_elisei_module_data',
      description: 'Получить актуальные read-only данные одного модуля ELISEI за выбранный период. Используй, когда вопрос касается рекламы, остатков, финансов, товаров, возвратов, отзывов, цен, сезонности, закупок, синхронизаций или продаж.',
      parameters: {
        type: 'object',
        properties: {
          module: { type: 'string', enum: moduleNames() },
          focus: { type: 'string', description: 'Какой конкретный вопрос нужно проверить в этом модуле.' },
        },
        required: ['module', 'focus'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      type: 'function',
      name: 'compare_elisei_modules',
      description: 'Сопоставить данные нескольких модулей ELISEI, чтобы найти настоящую причину проблемы: например реклама + прибыль + остатки или возвраты + отзывы + карточка товара.',
      parameters: {
        type: 'object',
        properties: {
          modules: { type: 'array', items: { type: 'string', enum: moduleNames() }, minItems: 2, maxItems: 4 },
          focus: { type: 'string' },
        },
        required: ['modules', 'focus'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      type: 'function',
      name: 'get_business_snapshot',
      description: 'Получить общий доступный контекст выбранного кабинета, страницы и периода ELISEI.',
      parameters: { type: 'object', properties: { focus: { type: 'string' } }, required: ['focus'], additionalProperties: false },
      strict: true,
    },
  ];
  if (options.allowMemory !== false) {
    tools.push(
      {
        type: 'function',
        name: 'remember_user_preference',
        description: 'Сохранить устойчивое предпочтение или правило пользователя. Использовать только при явной просьбе запомнить или для явно долгосрочного правила.',
        parameters: { type: 'object', properties: { text: { type: 'string' }, category: { type: 'string', enum: ['communication', 'analytics', 'business_rule', 'workflow', 'preference'] } }, required: ['text', 'category'], additionalProperties: false },
        strict: true,
      },
      {
        type: 'function',
        name: 'forget_user_memory',
        description: 'Удалить сохранённую память по просьбе пользователя.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        strict: true,
      },
    );
  }
  return tools;
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && item.content)
    .slice(-18)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 12000) }));
}

async function executeTool(call, deps) {
  let args = {};
  try { args = JSON.parse(call.arguments || '{}'); } catch { args = {}; }
  if (call.name === 'get_elisei_module_data') {
    if (!deps.dataBridge) return { ok: false, error: 'Мост данных ELISEI не подключён.' };
    return deps.dataBridge.getModule(args.module, args.focus);
  }
  if (call.name === 'compare_elisei_modules') {
    if (!deps.dataBridge) return { ok: false, error: 'Мост данных ELISEI не подключён.' };
    return { focus: args.focus, modules: await deps.dataBridge.getMany(args.modules, args.focus), note: 'Сопоставь причины между модулями; корреляцию не называй причинностью без подтверждения.' };
  }
  if (call.name === 'get_business_snapshot') {
    return { focus: args.focus, context: deps.context, note: 'Это снимок доступных данных; отсутствующие поля нельзя выдумывать.' };
  }
  if (call.name === 'remember_user_preference') {
    const saved = await deps.memoryStore.addMemory(deps.identity, { text: args.text, category: args.category });
    return { saved: true, memory: saved };
  }
  if (call.name === 'forget_user_memory') {
    const removed = await deps.memoryStore.forgetByText(deps.identity, args.query);
    return { removedCount: removed.length, removed: removed.map((item) => ({ id: item.id, text: item.text })) };
  }
  return { error: `Неизвестный инструмент ${call.name}` };
}

async function runElAgent(options) {
  const model = options.model || process.env.ELISEI_AI_MODEL || '';
  if (!model) {
    const error = new Error('Для платных режимов Эла не настроена модель OpenAI. Добавьте ELISEI_GPT_MODEL и ELISEI_PRO_MODEL либо общий ELISEI_AI_MODEL.');
    error.code = 'ELISEI_AI_MODEL_MISSING';
    throw error;
  }
  const reasoningEffort = options.reasoningEffort || process.env.ELISEI_REASONING_EFFORT || 'medium';
  const detectedModules = detectModules(options.message, 4);
  const tools = [...functionTools({ allowMemory: options.allowMemoryTools !== false })];
  if (options.allowWeb !== false && process.env.ELISEI_WEB_SEARCH !== 'false') {
    tools.unshift({ type: 'web_search', search_context_size: process.env.ELISEI_WEB_SEARCH_CONTEXT || 'medium' });
  }

  let input = [
    ...normalizeHistory(options.history),
    { role: 'user', content: String(options.message || '').slice(0, 12000) },
    ...(detectedModules.length ? [{ role:'developer', content:`Системная подсказка ELISEI: вопрос относится к модулям ${detectedModules.join(', ')}. Используй подтверждённые данные этих модулей; не отвечай статическим шаблоном.` }] : []),
  ];
  const instructions = buildInstructions(options);
  let response;
  let toolRounds = 0;
  const toolTrace = [];

  while (toolRounds <= MAX_TOOL_ROUNDS) {
    response = await (options.requestResponses || requestResponses)({
      model,
      instructions,
      input,
      tools,
      tool_choice: 'auto',
      reasoning: { effort: reasoningEffort },
      store: false,
      max_output_tokens: Number(process.env.ELISEI_AI_MAX_OUTPUT_TOKENS || 2600),
    });

    const calls = (response.output || []).filter((item) => item?.type === 'function_call');
    if (!calls.length) break;
    const outputs = [];
    for (const call of calls) {
      const result = await executeTool(call, options);
      toolTrace.push({ name: call.name, module: (() => { try { return JSON.parse(call.arguments || '{}').module; } catch { return null; } })(), ok: !result?.error });
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
    input = [...input, ...(response.output || []), ...outputs];
    toolRounds += 1;
  }

  const text = outputText(response) || 'Я всё проверил, но не смог сформировать ответ. Попробуй переформулировать вопрос.';
  const sources = uniqueSources(response);
  return {
    id: response?.id || crypto.randomUUID(), text, sources,
    usedWeb: sources.length > 0 || (response?.output || []).some((item) => item?.type === 'web_search_call'),
    toolTrace, model, usage: response?.usage || null,
    modulesUsed: [...new Set([...detectedModules, ...toolTrace.map((item) => item.module).filter(Boolean)])],
  };
}

module.exports = { runElAgent, functionTools, normalizeHistory, executeTool };
