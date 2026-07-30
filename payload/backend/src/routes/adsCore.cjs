'use strict';

const service = require('../services/adsService.cjs');
const { comparison } = require('../services/adsAnalytics.cjs');
const { resolveCabinetContext, publicCabinetContext } = require('../services/cabinetTokenResolver.cjs');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function periodFrom(req) {
  const from = req.period?.from || req.query.date_from || req.query.from;
  const to = req.period?.to || req.query.date_to || req.query.to;
  if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) {
    const error = new Error('Передайте date_from и date_to в формате YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  return {
    from,
    to,
    compareEnabled: String(req.query.compare ?? req.period?.compareEnabled ?? '0') === '1' || req.period?.compareEnabled === true,
    compareFrom: req.period?.compareFrom || req.query.compare_from,
    compareTo: req.period?.compareTo || req.query.compare_to,
  };
}

function sendError(res, error) {
  const status = Number(error.status || 500);
  res.status(status).json({ ok: false, error: error.code || 'ADS_ERROR', message: error.message });
}

function serviceOptions(context, req, extra = {}) {
  return {
    token: context.token,
    scopeKey: context.scopeKey,
    userId: context.userId,
    cabinetId: context.cabinetId,
    autoSync: req.query.auto_sync !== '0',
    ...extra,
  };
}

function createAdsRouter(express) {
  const router = express.Router();

  router.get('/health', async (req, res) => {
    try {
      const context = await resolveCabinetContext(req);
      res.json({
        ok: true,
        module: 'ELISEI WB Advertising Center',
        version: '5.3.13',
        cabinet: publicCabinetContext(context),
        tokenResolved: true,
        writeOperations: false,
      });
    } catch (error) {
      res.status(error.status || 503).json({
        ok: false,
        module: 'ELISEI WB Advertising Center',
        version: '5.3.13',
        tokenResolved: false,
        error: error.code || 'WB_CABINET_TOKEN_MISSING',
        message: error.message,
        writeOperations: false,
      });
    }
  });

  router.get('/overview', async (req, res) => {
    try {
      const [period, context] = await Promise.all([periodFrom(req), resolveCabinetContext(req)]);
      const options = serviceOptions(context, req);
      const current = await service.getRange(period.from, period.to, options);
      let previous = null;
      if (period.compareEnabled && DATE_RE.test(String(period.compareFrom || '')) && DATE_RE.test(String(period.compareTo || ''))) {
        previous = await service.getRange(period.compareFrom, period.compareTo, options);
      }
      res.json({
        ok: true,
        cabinet: publicCabinetContext(context),
        period,
        data: current,
        previous,
        comparison: comparison(current?.overall, previous?.overall),
      });
    } catch (error) { sendError(res, error); }
  });

  router.get('/campaigns', async (req, res) => {
    try {
      const [period, context] = await Promise.all([periodFrom(req), resolveCabinetContext(req)]);
      const data = await service.getRange(period.from, period.to, serviceOptions(context, req));
      res.json({ ok: true, cabinet: publicCabinetContext(context), period, rows: data?.campaigns || [], syncedAt: data?.syncedAt || null });
    } catch (error) { sendError(res, error); }
  });

  router.get('/products', async (req, res) => {
    try {
      const [period, context] = await Promise.all([periodFrom(req), resolveCabinetContext(req)]);
      const data = await service.getRange(period.from, period.to, serviceOptions(context, req));
      res.json({ ok: true, cabinet: publicCabinetContext(context), period, rows: data?.products || [], syncedAt: data?.syncedAt || null });
    } catch (error) { sendError(res, error); }
  });

  router.get('/el-insights', async (req, res) => {
    try {
      const [period, context] = await Promise.all([periodFrom(req), resolveCabinetContext(req)]);
      const data = await service.getRange(period.from, period.to, serviceOptions(context, req));
      res.json({ ok: true, cabinet: publicCabinetContext(context), period, insights: data?.insights || { summary: [], actions: [] }, overall: data?.overall || {} });
    } catch (error) { sendError(res, error); }
  });

  router.post('/sync', async (req, res) => {
    try {
      const [period, context] = await Promise.all([periodFrom(req), resolveCabinetContext(req)]);
      const data = await service.syncRange(period.from, period.to, serviceOptions(context, req, { force: true }));
      res.json({ ok: true, cabinet: publicCabinetContext(context), period, data });
    } catch (error) { sendError(res, error); }
  });

  return router;
}

module.exports = { createAdsRouter, periodFrom, serviceOptions };
