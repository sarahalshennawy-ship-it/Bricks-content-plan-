// /api/verify-code.js
// Read-only check — does not consume a call. Used at the access-code gate
// so the customer finds out immediately if a code is invalid or already
// used, instead of after filling out the whole quiz.

import { createClient } from 'redis';

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

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'missing_code' });
  }

  const redis = await getRedis();
  const raw = await redis.get(`code:${code}`);
  const record = raw ? JSON.parse(raw) : null;

  if (!record) {
    return res.status(200).json({ valid: false, error: 'invalid_code', message: 'This access code was not recognized.' });
  }

  const callsAllowed = record.callsAllowed || 4;
  if (record.callsUsed >= callsAllowed) {
    return res.status(200).json({ valid: false, error: 'code_exhausted', message: 'This code has already been used to generate a plan.' });
  }

  return res.status(200).json({ valid: true });
}
