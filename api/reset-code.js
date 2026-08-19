// /api/reset-code.js
// Resets an existing code's usage back to 0 without changing its name,
// callsAllowed, or expiry date. Useful for testing, or for a real customer
// who lost their generation to a bug (like a timeout that didn't refund
// properly before that was fixed). Protected by ADMIN_SECRET.
//
// Example:
//   curl -X POST https://your-domain.vercel.app/api/reset-code \
//     -H "x-admin-key: YOUR_ADMIN_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"code":"BRICKS-58DA5D2078"}'

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

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'missing_code' });
  }

  const redis = await getRedis();
  const key = `code:${code}`;
  const raw = await redis.get(key);
  if (!raw) {
    return res.status(404).json({ error: 'not_found', message: 'No code with that name exists.' });
  }

  const record = JSON.parse(raw);
  record.callsUsed = 0;
  delete record.lastUsedAt;
  await redis.set(key, JSON.stringify(record));

  return res.status(200).json({ ok: true, code, record });
}
