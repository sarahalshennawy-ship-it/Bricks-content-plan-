// /api/keep-alive.js
// Called automatically by Vercel Cron (see vercel.json) on a schedule.
// Does one trivial Redis write so the database always shows recent
// activity, preventing Redis Cloud's free-tier "deleted after inactivity"
// policy from ever triggering again — the exact thing that almost wiped
// every access code this system depends on.
//
// Protected by CRON_SECRET so random requests can't hit it - Vercel
// automatically sends this header when it triggers the scheduled job, as
// long as the CRON_SECRET env var is set on this project.

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
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // once CRON_SECRET is set as an env var on this project. Reject anything
  // else so this isn't a public no-op endpoint anyone can hit.
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const redis = await getRedis();
    const now = new Date().toISOString();
    await redis.set('_heartbeat', now);
    const check = await redis.get('_heartbeat');
    return res.status(200).json({ ok: true, heartbeat: check });
  } catch (err) {
    console.error('keep-alive failed:', err);
    return res.status(500).json({ error: 'keep_alive_failed', message: err.message });
  }
}
