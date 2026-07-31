'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MESSAGES = 80;
const MAX_MEMORIES = 100;
let writeQueue = Promise.resolve();

function safePart(value, fallback) {
  const result = String(value || fallback || '').replace(/[^a-zA-Z0-9_.@-]+/g, '_').slice(0, 100);
  return result || 'default';
}

function tenantKey(identity) {
  return `${safePart(identity?.userId, 'owner')}__${safePart(identity?.cabinetId, 'main')}`;
}

function dataDir() {
  return process.env.ELISEI_DATA_DIR || path.join(process.cwd(), '.elisei-data');
}

function filePath(identity) {
  return path.join(dataDir(), `el-${tenantKey(identity)}.json`);
}

function blank() { return { conversations: {}, memories: [], updatedAt: new Date().toISOString() }; }

function read(identity) {
  const file = filePath(identity);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...blank(), ...parsed, conversations: parsed.conversations || {}, memories: parsed.memories || [] };
  } catch { return blank(); }
}

async function write(identity, data) {
  const file = filePath(identity);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  data.updatedAt = new Date().toISOString();
  writeQueue = writeQueue.then(async () => {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, file);
  });
  return writeQueue;
}

function normalizeText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function createMemoryStore(customStore) {
  if (customStore && typeof customStore === 'object') return customStore;
  return {
    async loadConversation(identity, conversationId) {
      const data = read(identity);
      return data.conversations[conversationId]?.messages || [];
    },
    async appendMessages(identity, conversationId, messages) {
      const data = read(identity);
      const current = data.conversations[conversationId] || { id: conversationId, createdAt: new Date().toISOString(), messages: [] };
      current.messages = [...current.messages, ...messages]
        .filter((item) => item && ['user', 'assistant'].includes(item.role) && item.content)
        .slice(-MAX_MESSAGES);
      current.updatedAt = new Date().toISOString();
      data.conversations[conversationId] = current;
      await write(identity, data);
      return current;
    },
    async deleteConversation(identity, conversationId) {
      const data = read(identity);
      delete data.conversations[conversationId];
      await write(identity, data);
    },
    async listMemories(identity) {
      return read(identity).memories.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async addMemory(identity, input) {
      const data = read(identity);
      const text = normalizeText(input?.text, 800);
      if (!text) throw new Error('Пустую память сохранить нельзя.');
      const category = normalizeText(input?.category || 'preference', 50);
      const existing = data.memories.find((item) => item.text.toLowerCase() === text.toLowerCase());
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        existing.category = category;
        await write(identity, data);
        return existing;
      }
      const memory = { id: crypto.randomUUID(), text, category, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      data.memories.unshift(memory);
      data.memories = data.memories.slice(0, MAX_MEMORIES);
      await write(identity, data);
      return memory;
    },
    async removeMemory(identity, memoryId) {
      const data = read(identity);
      const before = data.memories.length;
      data.memories = data.memories.filter((item) => item.id !== memoryId);
      await write(identity, data);
      return before !== data.memories.length;
    },
    async forgetByText(identity, query) {
      const data = read(identity);
      const needle = normalizeText(query, 300).toLowerCase();
      const removed = data.memories.filter((item) => item.text.toLowerCase().includes(needle));
      data.memories = data.memories.filter((item) => !item.text.toLowerCase().includes(needle));
      await write(identity, data);
      return removed;
    },
  };
}

module.exports = { createMemoryStore, tenantKey };
