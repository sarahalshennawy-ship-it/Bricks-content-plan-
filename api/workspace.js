// /api/workspace.js
// Saves and loads each buyer's 30-day plan and results tracker, tied to their
// access code, so it works on any device and survives a page refresh.
//
//   POST { code, action: "load" }
//   POST { code, action: "savePlan", plan, meta }      (only while the code is active)
//   POST { code, action: "saveTracker", tracker }      (allowed even after the code expires)
//
// After a code expires or its AI calls run out, the buyer can still open their
// plan (read-only) and keep logging results. Only generating new content stops.

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

const MAX_PLAN_BYTES = 250000;
const MAX_TRACKER_BYTES = 120000;

function isActive(record) {
  const callsAllowed = record.callsAllowed || 4;
  const expired = record.expiresAt && new Date(record.expiresAt) < new Date();
  return !expired && (record.callsUsed || 0) < callsAllowed;
}

// Keep only the numeric/boolean fields we expect, so nothing odd gets stored.
function cleanTracker(t) {
  const out = { entries: {}, analysis: null };
  const entries = (t && t.entries) || {};
  for (let day = 1; day <= 30; day++) {
    const e = entries[day] || entries[String(day)];
    if (!e) continue;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 1e9) : null;
    };
    out.entries[day] = {
      posted: !!e.posted,
      date: typeof e.date === 'string' ? e.date.slice(0, 10) : null,
      views: num(e.views), follows: num(e.follows), saves: num(e.saves), enquiries: num(e.enquiries)
    };
  }
  if (t && t.analysis && typeof t.analysis.text === 'string') {
    out.analysis = { text: t.analysis.text.slice(0, 6000), at: String(t.analysis.at || '').slice(0, 40) };
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const action = body.action;
  if (!code || code.length > 64) {
    return res.status(400).json({ error: 'missing_code' });
  }

  try {
    const redis = await getRedis();
    const raw = await redis.get(`code:${code}`);
    const record = raw ? JSON.parse(raw) : null;
    if (!record) {
      return res.status(403).json({ error: 'invalid_code', message: 'This access code was not recognized.' });
    }
    if (record.product && record.product !== 'content-plan') {
      return res.status(403).json({ error: 'wrong_product', message: 'This code is for a different Bricks tool.' });
    }

    const key = `ws:${code}`;
    const wsRaw = await redis.get(key);
    const ws = wsRaw ? JSON.parse(wsRaw) : {};
    const active = isActive(record);

    if (action === 'load') {
      return res.status(200).json({
        ok: true,
        active,
        callsRemaining: Math.max(0, (record.callsAllowed || 4) - (record.callsUsed || 0)),
        plan: ws.plan || null,
        meta: ws.meta || null,
        tracker: ws.tracker || { entries: {}, analysis: null }
      });
    }

    if (action === 'savePlan') {
      if (!active) return res.status(403).json({ error: 'inactive', message: 'This code can no longer change the plan.' });
      const planStr = JSON.stringify(body.plan || null);
      if (!body.plan || planStr.length > MAX_PLAN_BYTES) return res.status(400).json({ error: 'bad_plan' });
      const m = body.meta || {};
      ws.plan = body.plan;
      ws.meta = {
        companyName: String(m.companyName || '').slice(0, 120),
        lang: m.lang === 'ar' ? 'ar' : 'en',
        cl: String(m.cl || '').slice(0, 40),
        biz: Array.isArray(m.biz) ? m.biz.slice(0, 10).map(String) : [],
        goal: Array.isArray(m.goal) ? m.goal.slice(0, 10).map(String) : [],
        platforms: Array.isArray(m.platforms) ? m.platforms.slice(0, 10).map(String) : []
      };
      ws.updatedAt = new Date().toISOString();
      await redis.set(key, JSON.stringify(ws));
      return res.status(200).json({ ok: true });
    }

    if (action === 'saveTracker') {
      const tracker = cleanTracker(body.tracker);
      if (JSON.stringify(tracker).length > MAX_TRACKER_BYTES) return res.status(400).json({ error: 'too_large' });
      ws.tracker = tracker;
      ws.updatedAt = new Date().toISOString();
      await redis.set(key, JSON.stringify(ws));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    console.error('workspace error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
}
