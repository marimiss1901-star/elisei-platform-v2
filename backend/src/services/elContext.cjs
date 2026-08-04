'use strict';

function compact(value, max = 6000) {
  if (value == null) return null;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, max);
  try { return JSON.parse(JSON.stringify(value).slice(0, max)); }
  catch { return String(value).slice(0, max); }
}

function identityFromRequest(req, body = {}) {
  const user = req.user || req.auth || req.session?.user || {};
  const userId = user.id || user.userId || user.sub || req.headers['x-user-id'] || body.userId || 'owner';
  const cabinetId = body.cabinetId || req.headers['x-cabinet-id'] || req.query?.cabinetId || process.env.WB_DEFAULT_CABINET_ID || 'main';
  const cabinetName = body.cabinetName || req.headers['x-cabinet-name'] || process.env.WB_DEFAULT_CABINET_NAME || 'Основной кабинет';
  const userName = body.userName || user.name || user.displayName || req.headers['x-user-name'] || '';
  return { userId: String(userId), cabinetId: String(cabinetId), cabinetName: String(cabinetName), userName: String(userName).replace(/\s+/g, ' ').trim().slice(0, 120) };
}

async function collectBusinessContext(req, body, identity) {
  const input = {
    identity,
    period: compact(body.period, 2000),
    page: compact(body.page, 500),
    screen: compact(body.screenContext, 7000),
    selectedProduct: compact(body.selectedProduct, 2500),
  };

  const provider = req.app?.locals?.getElBusinessContext || req.app?.locals?.elDataProvider;
  if (typeof provider === 'function') {
    try {
      const provided = await provider({ req, identity, period: body.period, page: body.page, question: body.message });
      input.cabinetData = compact(provided, 14000);
    } catch (error) {
      input.providerWarning = `Провайдер данных временно недоступен: ${error.message}`;
    }
  } else if (provider && typeof provider.getContext === 'function') {
    try {
      input.cabinetData = compact(await provider.getContext({ req, identity, period: body.period, page: body.page, question: body.message }), 14000);
    } catch (error) {
      input.providerWarning = `Провайдер данных временно недоступен: ${error.message}`;
    }
  } else {
    input.providerWarning = 'Глубокий серверный провайдер данных ещё не подключён; использован контекст текущего экрана.';
  }
  return input;
}

module.exports = { identityFromRequest, collectBusinessContext, compact };
