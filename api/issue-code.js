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
import { MONTHLY_CALLS } from './_lib/codes.js';

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

  const { code, callsAllowed, validDays, product, lifetime } = req.body || {};
  // Two products share this code system:
  //   "content-plan"   - Content Plan Generator (limited AI calls, expires)
  //   "launch-planner" - UAE Business Launch Planner at planner.bricksmedia.org
  //                      (no AI calls, lifetime access)
  // Old requests without a product field are Content Plan codes, as before.
  const prod = product === 'launch-planner' ? 'launch-planner' : 'content-plan';
  const isLifetime = prod === 'launch-planner' || lifetime === true;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'missing_code' });
  }

  const redis = await getRedis();
  const key = `code:${code}`;
  const existing = await redis.get(key);
  if (existing) {
    return res.status(409).json({ error: 'code_exists', message: 'This code was already issued.' });
  }

  const days = validDays || 30; // codes are valid for 1 month by default
  const issuedAt = new Date();
  const expiresAt = isLifetime ? null : new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);

  const record = {
    product: prod,
    // The planner makes no AI calls; 1 keeps any "used up" check from
    // ever marking a fresh planner code as used.
    callsAllowed: prod === 'content-plan' ? (callsAllowed || 4) : 1,
    callsUsed: 0,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null
  };
  // Content Plan lifetime codes: a monthly allowance that resets every 30 days.
  if (prod === 'content-plan') {
    if (isLifetime) {
      record.lifetime = true;
      record.monthlyCalls = callsAllowed || MONTHLY_CALLS;
      record.callsAllowed = record.monthlyCalls;
      record.periodStart = issuedAt.toISOString();
    } else {
      record.lifetime = false;
    }
  }
  await redis.set(key, JSON.stringify(record));
  return res.status(200).json({ ok: true, code, record });
}
