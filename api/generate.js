// /api/generate.js
// Holds the real Anthropic API key server-side. The browser never sees it.
// Each access code is allowed a fixed number of Anthropic calls (default 4:
// 3 day-batches + 1 advisor/summary call = one full 30-day plan).
//
// Requires: `npm install redis`, a Redis database created via the Vercel
// Marketplace (Storage tab, "Redis — Official Redis for Vercel") and linked
// to this project, and this env var set in Vercel:
//   ANTHROPIC_API_KEY   — your real Anthropic key
//   (REDIS_URL is added automatically when you connect the database)

import { createClient } from 'redis';
import { refreshContentCode, resetAt } from './_lib/codes.js';

// Vercel's default serverless function timeout is only 10 seconds, which is
// too short for a real Anthropic API call. Extend it to the Hobby plan's max.
export const config = {
  maxDuration: 60
};

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

const DEFAULT_CALLS_PER_CODE = 34; // 4 for the initial full plan, 30 headroom for regenerating individual days

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { code, prompt, max_tokens, images } = req.body || {};

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'missing_code', message: 'No access code provided.' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'missing_prompt', message: 'No prompt provided.' });
  }

  // Optional account screenshots (used for the account snapshot). Max 5,
  // JPEG/PNG/WebP only, each already shrunk in the browser.
  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  let imageBlocks = [];
  if (Array.isArray(images) && images.length) {
    if (images.length > 5) {
      return res.status(400).json({ error: 'too_many_images', message: 'Please upload up to 5 screenshots.' });
    }
    for (const im of images) {
      if (!im || !OK_TYPES.includes(im.media_type) || typeof im.data !== 'string' || im.data.length > 1500000) {
        return res.status(400).json({ error: 'bad_image', message: 'One of the screenshots could not be read. Please try a different one.' });
      }
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
    }
  }

  const redis = await getRedis();
  const key = `code:${code}`;
  const raw = await redis.get(key);
  const record = raw ? JSON.parse(raw) : null;

  if (!record) {
    return res.status(403).json({ error: 'invalid_code', message: 'This access code was not recognized.' });
  }

  // Launch Planner codes must never be able to spend AI calls.
  if (record.product && record.product !== 'content-plan') {
    return res.status(403).json({ error: 'wrong_product', message: 'This code is for a different Bricks tool.' });
  }

  // Lifetime codes: upgrade old codes, and reset the monthly allowance when due.
  if (refreshContentCode(record)) {
    await redis.set(key, JSON.stringify(record));
  }

  const callsAllowed = record.callsAllowed || DEFAULT_CALLS_PER_CODE;

  if (record.callsUsed >= callsAllowed) {
    return res.status(403).json({ error: 'code_exhausted', message: record.monthlyCalls ? 'You have used this month\'s generations. They reset automatically.' : 'This code has already been used to generate a plan.', resetAt: resetAt(record) });
  }

  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return res.status(403).json({ error: 'code_expired', message: 'This code has expired.' });
  }

  // Reserve the call before hitting Anthropic so two near-simultaneous
  // requests from the same code can't both slip through.
  record.callsUsed = (record.callsUsed || 0) + 1;
  record.lastUsedAt = new Date().toISOString();
  await redis.set(key, JSON.stringify(record));

  try {
    const controller = new AbortController();
    // Abort well before Vercel's own 60s hard limit, so this function's own
    // catch block (and its refund) always gets to run — a platform-level
    // kill for exceeding maxDuration does NOT run our catch block, which
    // would otherwise silently burn the customer's call with nothing delivered.
    const timeout = setTimeout(() => controller.abort(), 50000);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(max_tokens || 900, 3000),
        messages: [{ role: 'user', content: imageBlocks.length ? [...imageBlocks, { type: 'text', text: prompt }] : prompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      // Refund the call since Anthropic never returned usable content.
      record.callsUsed -= 1;
      await redis.set(key, JSON.stringify(record));
      return res.status(anthropicRes.status).json({
        error: 'anthropic_error',
        message: (errBody.error && errBody.error.message) || `HTTP ${anthropicRes.status}`
      });
    }

    const data = await anthropicRes.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    return res.status(200).json({ text, callsRemaining: callsAllowed - record.callsUsed, resetAt: resetAt(record) });
  } catch (err) {
    // Covers both our own abort (timeout) and any other network failure —
    // either way, the customer got nothing, so the call must be refunded.
    record.callsUsed -= 1;
    await redis.set(key, JSON.stringify(record));
    const timedOut = err.name === 'AbortError';
    return res.status(timedOut ? 504 : 500).json({
      error: timedOut ? 'timeout' : 'server_error',
      message: timedOut
        ? 'The request took too long and was cancelled. Your call was not counted — please try again.'
        : err.message
    });
  }
}
