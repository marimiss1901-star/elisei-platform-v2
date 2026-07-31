'use strict';

function uniqueSources(response) {
  const map = new Map();
  const add = (url, title) => {
    if (!url || !/^https?:\/\//i.test(String(url))) return;
    const normalized = String(url);
    if (!map.has(normalized)) map.set(normalized, { url: normalized, title: title || normalized });
  };

  for (const item of response?.output || []) {
    if (item?.type === 'web_search_call') {
      for (const source of item?.action?.sources || []) add(source?.url, source?.title);
    }
    for (const part of item?.content || []) {
      for (const annotation of part?.annotations || []) {
        if (annotation?.type === 'url_citation') add(annotation?.url, annotation?.title);
      }
    }
  }
  return [...map.values()].slice(0, 12);
}

function outputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && part?.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

module.exports = { uniqueSources, outputText };
