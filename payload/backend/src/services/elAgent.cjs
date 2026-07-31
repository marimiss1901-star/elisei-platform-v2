'use strict';

const crypto = require('node:crypto');
const { requestResponses } = require('./openaiResponsesClient.cjs');
const { uniqueSources, outputText } = require('./elSources.cjs');
const { buildInstructions } = require('./elPrompt.cjs');

const MAX_TOOL_ROUNDS = 4;

function functionTools() {
  return [
    {
      type: 'function',
      name: 'get_business_snapshot',
      description: 'Получить доступный контекст выбранного кабинета, текущей страницы и периода ELISEI.',
      parameters: { type: 'object', properties: { focus: { type: 'string', description: 'Что именно нужно проверить в данных.' } }, required: ['focus'], additionalProperties: false },
      strict: true,
    },
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
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Текст или тема, которую нужно забыть.' } }, required: ['query'], additionalProperties: false },
      strict: true,
    },
  ];
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
  const model = options.model || process.env.ELISEI_AI_MODEL || 'gpt-5.6';
  const reasoningEffort = options.reasoningEffort || process.env.ELISEI_REASONING_EFFORT || 'medium';
  const tools = [...functionTools()];
  if (options.allowWeb !== false && process.env.ELISEI_WEB_SEARCH !== 'false') {
    tools.unshift({ type: 'web_search', search_context_size: process.env.ELISEI_WEB_SEARCH_CONTEXT || 'medium' });
  }

  let input = [
    ...normalizeHistory(options.history),
    { role: 'user', content: String(options.message || '').slice(0, 12000) },
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
      max_output_tokens: Number(process.env.ELISEI_AI_MAX_OUTPUT_TOKENS || 2200),
    });

    const calls = (response.output || []).filter((item) => item?.type === 'function_call');
    if (!calls.length) break;
    const outputs = [];
    for (const call of calls) {
      const result = await executeTool(call, options);
      toolTrace.push({ name: call.name, ok: !result?.error });
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
    input = [...input, ...(response.output || []), ...outputs];
    toolRounds += 1;
  }

  const text = outputText(response) || 'Я всё проверил, но не смог сформировать ответ. Попробуй переформулировать вопрос.';
  const sources = uniqueSources(response);
  return {
    id: response?.id || crypto.randomUUID(),
    text,
    sources,
    usedWeb: sources.length > 0 || (response?.output || []).some((item) => item?.type === 'web_search_call'),
    toolTrace,
    model,
    usage: response?.usage || null,
  };
}

module.exports = { runElAgent, functionTools, normalizeHistory };
