'use strict';

const crypto = require('node:crypto');

const TOKEN_FIELDS = [
  'token',
  'apiToken',
  'api_token',
  'wbToken',
  'wb_token',
  'accessToken',
  'access_token',
];

const CABINET_FIELDS = ['cabinetId', 'cabinet_id', 'shopId', 'shop_id', 'sellerId', 'seller_id', 'id'];
const USER_FIELDS = ['userId', 'user_id', 'ownerId', 'owner_id'];

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function firstField(object, fields) {
  if (!object || typeof object !== 'object') return '';
  for (const field of fields) {
    const value = text(object[field]);
    if (value) return value;
  }
  return '';
}

function userIdFrom(req) {
  return text(
    req?.user?.id
    || req?.user?.userId
    || req?.auth?.userId
    || req?.session?.userId
    || req?.identity?.userId,
  );
}

function cabinetIdFrom(req) {
  return text(
    req?.params?.cabinetId
    || req?.query?.cabinet_id
    || req?.query?.cabinetId
    || req?.headers?.['x-elisei-cabinet-id']
    || req?.body?.cabinetId
    || req?.body?.cabinet_id
    || req?.user?.activeCabinetId
    || req?.session?.activeCabinetId,
  );
}

function normalizeCandidate(candidate, defaults = {}) {
  if (!candidate) return null;
  if (typeof candidate === 'string') {
    const token = text(candidate);
    return token ? { ...defaults, token } : null;
  }
  if (typeof candidate !== 'object') return null;
  const token = firstField(candidate, TOKEN_FIELDS);
  if (!token) return null;
  return {
    ...defaults,
    ...candidate,
    token,
    cabinetId: firstField(candidate, CABINET_FIELDS) || defaults.cabinetId || '',
    userId: firstField(candidate, USER_FIELDS) || defaults.userId || '',
  };
}

function makeScopeKey({ userId, cabinetId, token }) {
  const tokenFingerprint = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
  return crypto.createHash('sha256')
    .update(`${userId || 'anonymous'}|${cabinetId || 'default'}|${tokenFingerprint}`)
    .digest('hex')
    .slice(0, 32);
}

function makeError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function verifyOwnership(candidate, requestedUserId, requestedCabinetId) {
  if (requestedUserId && candidate.userId && text(candidate.userId) !== requestedUserId) {
    throw makeError('У выбранного кабинета другой владелец.', 'WB_CABINET_FORBIDDEN', 403);
  }
  if (requestedCabinetId && candidate.cabinetId && text(candidate.cabinetId) !== requestedCabinetId) {
    throw makeError('Токен не относится к выбранному кабинету.', 'WB_CABINET_FORBIDDEN', 403);
  }
}

async function callResolver(resolver, args) {
  if (typeof resolver !== 'function') return null;
  return resolver(args);
}

async function resolveFromApplication(req, args) {
  const directCandidates = [
    req?.wbCabinet,
    req?.cabinet,
    req?.marketplaceCabinet,
    req?.wbToken,
    req?.marketplaceToken,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeCandidate(candidate, args);
    if (normalized) return { ...normalized, source: 'request-context' };
  }

  const resolvers = [
    req?.resolveWbCabinetToken,
    req?.app?.locals?.resolveWbCabinetToken,
    req?.app?.locals?.getCabinetToken,
    req?.app?.locals?.resolveMarketplaceToken,
  ];
  for (const resolver of resolvers) {
    const resolved = normalizeCandidate(await callResolver(resolver, {
      ...args,
      marketplace: 'wildberries',
      permission: 'promotion:read',
      req,
    }), args);
    if (resolved) return { ...resolved, source: 'application-resolver' };
  }
  return null;
}

function environmentMode() {
  return text(process.env.ELISEI_TOKEN_MODE || 'auto').toLowerCase();
}

function resolveFromEnvironment(args) {
  const mode = environmentMode();
  if (mode === 'database' || mode === 'oauth' || mode === 'multi-tenant') return null;
  const token = text(process.env.WB_API_TOKEN);
  if (!token) return null;
  const defaultCabinetId = text(process.env.WB_DEFAULT_CABINET_ID || 'render-default');
  if (args.cabinetId && args.cabinetId !== defaultCabinetId) {
    throw makeError(
      'Для этого кабинета нет собственного токена. Подключите кабинет в профиле Елисея.',
      'WB_CABINET_TOKEN_MISSING',
      503,
    );
  }
  return {
    token,
    userId: args.userId || 'render-owner',
    cabinetId: defaultCabinetId,
    cabinetName: text(process.env.WB_DEFAULT_CABINET_NAME || 'Основной кабинет WB'),
    source: 'render-environment',
  };
}

async function resolveCabinetContext(req) {
  const requested = {
    userId: userIdFrom(req),
    cabinetId: cabinetIdFrom(req),
  };

  let candidate = await resolveFromApplication(req, requested);
  if (!candidate) candidate = resolveFromEnvironment(requested);
  if (!candidate?.token) {
    throw makeError(
      'Токен выбранного кабинета WB не найден. Подключите кабинет или настройте серверный резолвер токенов.',
      'WB_CABINET_TOKEN_MISSING',
      503,
    );
  }

  candidate.userId = text(candidate.userId || requested.userId || 'unknown-user');
  candidate.cabinetId = text(candidate.cabinetId || requested.cabinetId || 'default-cabinet');
  candidate.cabinetName = text(candidate.cabinetName || candidate.name || candidate.title || 'Кабинет WB');
  verifyOwnership(candidate, requested.userId, requested.cabinetId);

  return {
    token: candidate.token,
    userId: candidate.userId,
    cabinetId: candidate.cabinetId,
    cabinetName: candidate.cabinetName,
    tokenSource: candidate.source || 'unknown',
    scopeKey: makeScopeKey(candidate),
  };
}

function publicCabinetContext(context) {
  if (!context) return null;
  return {
    id: context.cabinetId,
    name: context.cabinetName,
    tokenSource: context.tokenSource,
  };
}

module.exports = {
  resolveCabinetContext,
  publicCabinetContext,
  makeScopeKey,
  userIdFrom,
  cabinetIdFrom,
  normalizeCandidate,
};
