// /api/list-codes.js
// Read-only. Returns every issued access code with its current status.
// Protected by ADMIN_SECRET — same key used for /api/issue-code.

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const redis = await getRedis();
  const keys = [];
  for await (const key of redis.scanIterator({ MATCH: 'code:*', COUNT: 100 })) {
    keys.push(key);
  }

  const codes = [];
  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const record = JSON.parse(raw);
    const callsAllowed = record.callsAllowed || 4;
    const expired = record.expiresAt && new Date(record.expiresAt) < new Date();
    const exhausted = record.callsUsed >= callsAllowed;
    codes.push({
      code: key.replace('code:', ''),
      callsUsed: record.callsUsed || 0,
      callsAllowed,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      status: expired ? 'expired' : exhausted ? 'used' : 'active'
    });
  }

  codes.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  return res.status(200).json({ codes });
}
