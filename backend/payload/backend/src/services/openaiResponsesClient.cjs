'use strict';

const DEFAULT_TIMEOUT_MS = 120000;

function buildUrl(base) {
  return `${String(base || 'https://api.openai.com').replace(/\/$/, '')}/v1/responses`;
}

async function requestResponses(payload, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY не настроен на backend Елисея.');
    error.code = 'OPENAI_API_KEY_MISSING';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || process.env.ELISEI_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(buildUrl(options.baseUrl || process.env.OPENAI_BASE_URL), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(process.env.OPENAI_PROJECT ? { 'OpenAI-Project': process.env.OPENAI_PROJECT } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw: text }; }

    if (!response.ok) {
      const message = data?.error?.message || data?.message || `OpenAI API вернул HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = data?.error?.code || 'OPENAI_API_ERROR';
      error.details = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Эл думал слишком долго. Попробуйте ещё раз.');
      timeoutError.code = 'OPENAI_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { requestResponses };
