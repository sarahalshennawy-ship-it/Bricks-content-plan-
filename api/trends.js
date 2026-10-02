// /api/trends.js
// The monthly "trends brief" every content plan uses.
//
//   GET                                   -> { text, updatedAt }      (public, read by the tool)
//   POST { action:"save", text }           -> saves the brief          (admin only)
//   POST { action:"draft" }                -> AI drafts a new brief using web search (admin only, NOT saved)
//
// Admin requests need the header x-admin-key = ADMIN_SECRET (same key as admin.html).
// Uses ANTHROPIC_API_KEY and REDIS_URL, which this project already has.

import { createClient } from 'redis';

export const config = { maxDuration: 60 };

let client;
async function getRedis() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis client error', err));
  }
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

const KEY = 'trends:current';

function draftPrompt() {
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return `Today is ${month}. Research what is working right now in short-form social media content (Instagram Reels, carousels, stories, TikTok) for small businesses in the UAE and Saudi Arabia.

Write a concise trends brief for a content-planning tool, in English, under 220 words, as short lines starting with "- ", grouped under these exact headings on their own lines:
FORMATS: (2-4 lines: formats and structures performing well now)
HOOKS: (2-3 lines: hook styles that are working)
AUDIO & STYLE: (1-3 lines: editing styles, audio types; no specific copyrighted song names)
GULF MOMENTS: (2-4 lines: seasonal or cultural moments in the next 6 weeks in the UAE and Saudi Arabia, with dates)
AVOID: (1-2 lines: what is getting tired)

Only include things you found evidence for in your searches. If something is uncertain, leave it out.`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const redis = await getRedis();

    if (req.method === 'GET') {
      const raw = await redis.get(KEY);
      return res.status(200).json(raw ? JSON.parse(raw) : { text: '', updatedAt: null });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { action, text } = req.body || {};

    if (action === 'save') {
      const clean = String(text || '').trim().slice(0, 3000);
      const record = { text: clean, updatedAt: new Date().toISOString() };
      await redis.set(KEY, JSON.stringify(record));
      return res.status(200).json({ ok: true, ...record });
    }

    if (action === 'draft') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: [{ role: 'user', content: draftPrompt() }]
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({ error: 'ai_error', message: (data.error && data.error.message) || `HTTP ${r.status}` });
      }
      const draft = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return res.status(200).json({ ok: true, draft });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    console.error('trends error:', err);
    const timedOut = err && err.name === 'AbortError';
    return res.status(timedOut ? 504 : 500).json({ error: timedOut ? 'timeout' : 'server_error', message: timedOut ? 'The search took too long. Try again.' : 'Something went wrong.' });
  }
}
