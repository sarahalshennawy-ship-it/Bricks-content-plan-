// /api/issue-code.js
// Manual code issuance for now (call this yourself via curl/Postman after a
// purchase) until Stripe is active and can call it automatically from a
// webhook. Protected by ADMIN_SECRET so only you can mint codes.
//
// Example (replace values):
//   curl -X POST https://your-domain.vercel.app/api/issue-code \
//     -H "x-admin-key: YOUR_ADMIN_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"code":"SARA-TEST-01"}'

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

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { code, callsAllowed } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'missing_code' });
  }

  const redis = await getRedis();
  const key = `code:${code}`;
  const existing = await redis.get(key);
  if (existing) {
    return res.status(409).json({ error: 'code_exists', message: 'This code was already issued.' });
  }

  const record = {
    callsAllowed: callsAllowed || 4,
    callsUsed: 0,
    issuedAt: new Date().toISOString()
  };
  await redis.set(key, JSON.stringify(record));
  return res.status(200).json({ ok: true, code, record });
}
