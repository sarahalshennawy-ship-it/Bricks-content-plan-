// /api/generate.js
// Holds the real Anthropic API key server-side. The browser never sees it.
// Each access code is allowed a fixed number of Anthropic calls (default 4:
// 3 day-batches + 1 advisor/summary call = one full 30-day plan).
//
// Requires: `npm install @vercel/kv`, a KV store created and linked in the
// Vercel dashboard (Storage tab), and these env vars set in Vercel:
//   ANTHROPIC_API_KEY   — your real Anthropic key
//   (KV_* vars are added automatically when you link a KV store)

import { kv } from '@vercel/kv';

const DEFAULT_CALLS_PER_CODE = 4;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { code, prompt, max_tokens } = req.body || {};

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'missing_code', message: 'No access code provided.' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'missing_prompt', message: 'No prompt provided.' });
  }

  const key = `code:${code}`;
  const record = await kv.get(key);

  if (!record) {
    return res.status(403).json({ error: 'invalid_code', message: 'This access code was not recognized.' });
  }

  const callsAllowed = record.callsAllowed || DEFAULT_CALLS_PER_CODE;

  if (record.callsUsed >= callsAllowed) {
    return res.status(403).json({ error: 'code_exhausted', message: 'This code has already been used to generate a plan.' });
  }

  // Reserve the call before hitting Anthropic so two near-simultaneous
  // requests from the same code can't both slip through.
  record.callsUsed = (record.callsUsed || 0) + 1;
  record.lastUsedAt = new Date().toISOString();
  await kv.set(key, record);

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 900,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      // Refund the call since Anthropic never returned usable content.
      record.callsUsed -= 1;
      await kv.set(key, record);
      return res.status(anthropicRes.status).json({
        error: 'anthropic_error',
        message: (errBody.error && errBody.error.message) || `HTTP ${anthropicRes.status}`
      });
    }

    const data = await anthropicRes.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    return res.status(200).json({ text, callsRemaining: callsAllowed - record.callsUsed });
  } catch (err) {
    record.callsUsed -= 1;
    await kv.set(key, record);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
}
