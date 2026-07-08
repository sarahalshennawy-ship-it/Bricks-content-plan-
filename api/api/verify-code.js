// /api/verify-code.js
// Read-only check — does not consume a call. Used at the access-code gate
// so the customer finds out immediately if a code is invalid or already
// used, instead of after filling out the whole quiz.

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'missing_code' });
  }

  const record = await kv.get(`code:${code}`);
  if (!record) {
    return res.status(200).json({ valid: false, error: 'invalid_code', message: 'This access code was not recognized.' });
  }

  const callsAllowed = record.callsAllowed || 4;
  if (record.callsUsed >= callsAllowed) {
    return res.status(200).json({ valid: false, error: 'code_exhausted', message: 'This code has already been used to generate a plan.' });
  }

  return res.status(200).json({ valid: true });
}
