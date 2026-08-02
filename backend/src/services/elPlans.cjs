'use strict';

const TIERS = Object.freeze({ analyst: 0, gpt: 1, pro: 2 });
const MODES = Object.freeze({ analyst: 0, gpt: 1, pro: 2 });

function normalizeTier(value, fallback = 'analyst') {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TIERS, key) ? key : fallback;
}

function normalizeMode(value, fallback = 'analyst') {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODES, key) ? key : fallback;
}

function tierFeatures(tierValue) {
  const tier = normalizeTier(tierValue);
  return {
    analyst: true,
    gpt: TIERS[tier] >= TIERS.gpt,
    pro: TIERS[tier] >= TIERS.pro,
    webSearch: TIERS[tier] >= TIERS.pro,
    longMemory: TIERS[tier] >= TIERS.pro,
    externalResearch: TIERS[tier] >= TIERS.pro,
  };
}

function publicPlan(value = {}) {
  const tier = normalizeTier(value.tier);
  return {
    tier,
    status: value.status || 'active',
    features: tierFeatures(tier),
    source: value.source || 'default',
    startsAt: value.startsAt || value.starts_at || null,
    expiresAt: value.expiresAt || value.expires_at || null,
    metadata: value.metadata && typeof value.metadata === 'object' ? value.metadata : {},
  };
}

async function resolveElPlan(req, identity = {}) {
  const provider = req?.app?.locals?.getElPlan;
  if (typeof provider === 'function') {
    const provided = await provider({ req, identity });
    if (provided) return publicPlan(provided);
  }
  return publicPlan({ tier: process.env.ELISEI_EL_DEFAULT_TIER || 'analyst', source: 'environment-default' });
}

function canUseMode(planValue, modeValue) {
  const plan = publicPlan(planValue);
  const mode = normalizeMode(modeValue);
  return TIERS[plan.tier] >= MODES[mode];
}

function apiRequiredForMode(modeValue) {
  return normalizeMode(modeValue) !== 'analyst';
}

function modeLabel(modeValue) {
  const mode = normalizeMode(modeValue);
  return mode === 'pro' ? 'Эл Pro' : mode === 'gpt' ? 'Эл GPT' : 'Эл Аналитик';
}

module.exports = {
  TIERS,
  MODES,
  normalizeTier,
  normalizeMode,
  tierFeatures,
  publicPlan,
  resolveElPlan,
  canUseMode,
  apiRequiredForMode,
  modeLabel,
};
