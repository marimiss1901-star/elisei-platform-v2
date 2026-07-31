'use strict';

const crypto = require('node:crypto');
const { createMemoryStore } = require('../services/elMemoryStore.cjs');
const { identityFromRequest, collectBusinessContext } = require('../services/elContext.cjs');
const { runElAgent } = require('../services/elAgent.cjs');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function errorPayload(error) {
  const setup = error?.code === 'OPENAI_API_KEY_MISSING';
  return {
    ok: false,
    error: setup ? 'Эл почти готов, но на backend не добавлен OPENAI_API_KEY.' : (error?.message || 'Не удалось получить ответ Эла.'),
    code: error?.code || 'EL_CHAT_ERROR',
    setupRequired: setup,
  };
}

function createRouter(express) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/status', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    res.json({
      ok: true,
      version: '5.3.19',
      name: 'El Intelligence Core',
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.ELISEI_AI_MODEL || 'gpt-5.6',
      webSearch: process.env.ELISEI_WEB_SEARCH !== 'false',
      memory: req.app?.locals?.elMemoryStore ? 'custom' : 'file-fallback',
      identity: { cabinetId: identity.cabinetId, cabinetName: identity.cabinetName },
      writeActions: false,
    });
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

    const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    const conversationId = String(body.conversationId || crypto.randomUUID()).slice(0, 100);
    const serverHistory = await memoryStore.loadConversation(identity, conversationId);
    const history = serverHistory.length ? serverHistory : body.history;
    const memories = await memoryStore.listMemories(identity);
    const context = await collectBusinessContext(req, body, identity);

    try {
      const answer = await runElAgent({
        message,
        history,
        context,
        memories,
        identity,
        tone: body.tone || 'auto',
        allowWeb: body.allowWeb !== false,
        memoryStore,
      });
      await memoryStore.appendMessages(identity, conversationId, [
        { role: 'user', content: message, createdAt: new Date().toISOString() },
        { role: 'assistant', content: answer.text, sources: answer.sources, createdAt: new Date().toISOString() },
      ]);
      res.json({ ok: true, conversationId, answer: answer.text, sources: answer.sources, usedWeb: answer.usedWeb, model: answer.model, toolTrace: answer.toolTrace });
    } catch (error) {
      const payload = errorPayload(error);
      res.status(payload.setupRequired ? 503 : (error.status || 500)).json(payload);
    }
  }));

  router.get('/memory', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    res.json({ ok: true, memories: await memoryStore.listMemories(identity) });
  }));

  router.post('/memory', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req, req.body || {});
    const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    res.json({ ok: true, memory: await memoryStore.addMemory(identity, req.body || {}) });
  }));

  router.delete('/memory/:id', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    res.json({ ok: true, removed: await memoryStore.removeMemory(identity, req.params.id) });
  }));

  router.delete('/conversation/:id', asyncRoute(async (req, res) => {
    const identity = identityFromRequest(req);
    const memoryStore = createMemoryStore(req.app?.locals?.elMemoryStore);
    await memoryStore.deleteConversation(identity, req.params.id);
    res.json({ ok: true });
  }));

  router.post('/feedback', (req, res) => {
    const logger = req.app?.locals?.auditLog || console;
    logger.info?.('[EL_FEEDBACK]', { rating: req.body?.rating, conversationId: req.body?.conversationId, userId: identityFromRequest(req, req.body || {}).userId });
    res.json({ ok: true });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('[ELISEI EL ERROR]', error);
    res.status(error.status || 500).json(errorPayload(error));
  });
  return router;
}

module.exports = createRouter;
