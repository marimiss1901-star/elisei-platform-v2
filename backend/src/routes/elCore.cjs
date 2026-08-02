'use strict';

const crypto = require('node:crypto');
const { createMemoryStore } = require('../services/elMemoryStore.cjs');
const { identityFromRequest, collectBusinessContext } = require('../services/elContext.cjs');
const { runElAgent } = require('../services/elAgent.cjs');
const { runElAnalyst } = require('../services/elAnalystEngine.cjs');
const { classifyElRequest } = require('../services/elModeRouter.cjs');
const { createBusinessDataBridge } = require('../services/elBusinessDataBridge.cjs');
const { publicCapabilities } = require('../services/elModuleRegistry.cjs');
const { resolveElPlan, normalizeMode, canUseMode, publicPlan, modeLabel } = require('../services/elPlans.cjs');

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

function errorPayload(error) {
  const setup = ['OPENAI_API_KEY_MISSING','ELISEI_AI_MODEL_MISSING'].includes(error?.code);
  const setupMessage = error?.code === 'ELISEI_AI_MODEL_MISSING'
    ? error.message
    : 'Для «Эл GPT» и «Эл Pro» на backend не добавлен OPENAI_API_KEY или закончился баланс API. Базовый «Эл Аналитик» продолжает работать без OpenAI.';
  return {
    ok: false,
    error: setup ? setupMessage : (error?.message || 'Не удалось получить ответ Эла.'),
    code: error?.code || 'EL_CHAT_ERROR',
    setupRequired: setup,
  };
}

function upgradeError(mode, plan) {
  const error = new Error(`${modeLabel(mode)} не входит в текущий тариф. Вопросы по WB-кабинету доступны бесплатно в режиме «Эл Аналитик».`);
  error.status = 402;
  error.code = 'EL_UPGRADE_REQUIRED';
  error.upgradeRequired = mode;
  error.plan = plan;
  return error;
}

function createRouter(express) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/status', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    const plan = await resolveElPlan(req, identity);
    res.json({
      ok: true,
      version: '5.4.3',
      name: 'El Tiered Intelligence',
      configured: Boolean(process.env.OPENAI_API_KEY && (process.env.ELISEI_GPT_MODEL || process.env.ELISEI_PRO_MODEL || process.env.ELISEI_AI_MODEL)),
      models: {
        gpt: process.env.ELISEI_GPT_MODEL || process.env.ELISEI_AI_MODEL || null,
        pro: process.env.ELISEI_PRO_MODEL || process.env.ELISEI_AI_MODEL || null,
      },
      webSearch: plan.features.webSearch && process.env.ELISEI_WEB_SEARCH !== 'false',
      memory: req.app?.locals?.elMemoryStore ? 'postgres' : 'file-fallback',
      identity: { cabinetId: identity.cabinetId, cabinetName: identity.cabinetName },
      plan,
      modes: {
        analyst: { available: true, apiUsed: false, description: 'Аналитика WB-кабинета без OpenAI API' },
        gpt: { available: plan.features.gpt, apiUsed: true, description: 'Свободное GPT-общение как дополнительная функция' },
        pro: { available: plan.features.pro, apiUsed: true, description: 'Интернет и внешние исследования как Premium-функция' },
      },
      writeActions: false,
      capabilities: publicCapabilities(),
    });
  }));

  router.get('/plan', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    res.json({ ok: true, plan: await resolveElPlan(req, identity) });
  }));

  router.put('/plan', asyncRoute(async (req, res) => {
    if (typeof req.app?.locals?.setElPlan !== 'function') return res.status(501).json({ ok: false, error: 'Управление тарифами ещё не подключено.' });
    const identity = identityFromRequest(req, req.body || {});
    const plan = await req.app.locals.setElPlan({ req, identity, body: req.body || {} });
    res.json({ ok: true, plan: publicPlan(plan) });
  }));

  router.get('/capabilities', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    const plan = await resolveElPlan(req, identity);
    res.json({ ok: true, version: '5.4.3', modules: publicCapabilities(), plan, writeActions: false });
  }));

  router.post('/chat', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const message = String(body.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Напиши Элу сообщение.' });
    if (message.length > 12000) return res.status(413).json({ ok: false, error: 'Сообщение слишком длинное.' });

    const identity = identityFromRequest(req, body);
    if (process.env.ELISEI_AUTH_STRICT === 'true' && identity.userId === 'owner' && process.env.ELISEI_TOKEN_MODE === 'database') {
      return res.status(401).json({ ok: false, error: 'Не удалось определить пользователя для изоляции диалога.' });
    }

    const plan = await resolveElPlan(req, identity);
    const requestedMode = normalizeMode(body.mode || 'analyst');
    const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    const conversationId = String(body.conversationId || crypto.randomUUID()).slice(0, 100);
    const serverHistory = await memoryStore.loadConversation(identity, conversationId);
    const history = serverHistory.length ? serverHistory : body.history;
    const classification = classifyElRequest({ message, requestedMode, history, page: body.page });
    const effectiveMode = classification.mode;

    if (!canUseMode(plan, effectiveMode)) throw upgradeError(effectiveMode, plan);

    const memories = await memoryStore.listMemories(identity);
    const context = await collectBusinessContext(req, body, identity);
    const dataBridge = createBusinessDataBridge({ req, identity, period: body.period, question: message });
    const prefetched = await dataBridge.prefetchForQuestion(message);
    context.moduleCoverage = { detected: prefetched.detectedModules, prefetched: prefetched.data };

    try {
      let answer;
      if (effectiveMode === 'analyst') {
        answer = await runElAnalyst({
          message, history, context, memories, identity,
          tone: body.tone || 'auto', memoryStore, dataBridge, classification,
        });
      } else {
        const isPro = effectiveMode === 'pro';
        answer = await runElAgent({
          message, history, context, memories: isPro ? memories : [], identity,
          tone: body.tone || 'auto',
          allowMemoryTools: isPro,
          allowWeb: isPro && body.allowWeb !== false,
          memoryStore, dataBridge,
          model: isPro
            ? (process.env.ELISEI_PRO_MODEL || process.env.ELISEI_AI_MODEL)
            : (process.env.ELISEI_GPT_MODEL || process.env.ELISEI_AI_MODEL),
          reasoningEffort: isPro
            ? (process.env.ELISEI_PRO_REASONING_EFFORT || process.env.ELISEI_REASONING_EFFORT || 'medium')
            : (process.env.ELISEI_GPT_REASONING_EFFORT || 'low'),
        });
        answer.apiUsed = true;
      }

      await memoryStore.appendMessages(identity, conversationId, [
        { role: 'user', content: message, mode: effectiveMode, createdAt: new Date().toISOString() },
        { role: 'assistant', content: answer.text, mode: effectiveMode, sources: answer.sources, modulesUsed: answer.modulesUsed, createdAt: new Date().toISOString() },
      ]);
      res.json({
        ok: true,
        conversationId,
        answer: answer.text,
        sources: answer.sources,
        usedWeb: answer.usedWeb,
        model: answer.model,
        apiUsed: Boolean(answer.apiUsed),
        mode: effectiveMode,
        requestedMode,
        routeReason: classification.reason,
        plan,
        toolTrace: answer.toolTrace,
        modulesUsed: answer.modulesUsed,
        detectedModules: prefetched.detectedModules,
      });
    } catch (error) {
      const payload = errorPayload(error);
      res.status(payload.setupRequired ? 503 : (error.status || 500)).json({ ...payload, upgradeRequired: error.upgradeRequired || null, plan: error.plan || plan });
    }
  }));

  router.get('/module/:module', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    const period = { ...req.query, from: req.query.from || req.query.date_from, to: req.query.to || req.query.date_to };
    const bridge = createBusinessDataBridge({ req, identity, period, question: req.query.focus || '' });
    const data = await bridge.getModule(req.params.module, req.query.focus || 'Проверка доступности данных');
    res.status(data.ok ? 200 : 404).json(data);
  }));

  router.get('/memory', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req); const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    res.json({ ok: true, memories: await memoryStore.listMemories(identity) });
  }));
  router.post('/memory', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req, req.body || {}); const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    res.json({ ok: true, memory: await memoryStore.addMemory(identity, req.body || {}) });
  }));
  router.delete('/memory/:id', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req); const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    res.json({ ok: true, removed: await memoryStore.removeMemory(identity, req.params.id) });
  }));
  router.delete('/conversation/:id', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req); const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    await memoryStore.deleteConversation(identity, req.params.id); res.json({ ok: true });
  }));
  router.post('/feedback', (req, res) => {
    const logger = req.app?.locals?.auditLog || console;
    logger.info?.('[EL_FEEDBACK]', { rating: req.body?.rating, conversationId: req.body?.conversationId, userId: identityFromRequest(req, req.body || {}).userId });
    res.json({ ok: true });
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('[ELISEI EL ERROR]', error);
    const payload = errorPayload(error);
    res.status(error.status || 500).json({ ...payload, upgradeRequired: error.upgradeRequired || null, plan: error.plan || null });
  });
  return router;
}

module.exports = createRouter;
