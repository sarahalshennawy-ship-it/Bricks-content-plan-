// Shared rules for Content Plan Generator codes: lifetime access with a
// monthly AI allowance that resets every 30 days.
//
// Codes issued before lifetime access existed are upgraded automatically the
// first time they are used (unless they were issued with lifetime:false).

export const MONTHLY_CALLS = 40;
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export function isContentCode(record) {
  return !!record && (!record.product || record.product === 'content-plan');
}

// Upgrades old codes and resets the allowance when a new 30-day period starts.
// Returns true if the record changed and should be saved.
export function refreshContentCode(record) {
  if (!isContentCode(record) || record.lifetime === false) return false;
  let changed = false;
  if (!record.monthlyCalls) {
    record.product = 'content-plan';
    record.lifetime = true;
    record.monthlyCalls = MONTHLY_CALLS;
    record.callsAllowed = MONTHLY_CALLS;
    record.callsUsed = Math.min(record.callsUsed || 0, MONTHLY_CALLS);
    record.expiresAt = null;
    record.periodStart = new Date().toISOString();
    changed = true;
  }
  const start = new Date(record.periodStart).getTime();
  const now = Date.now();
  if (now - start >= PERIOD_MS) {
    const periods = Math.floor((now - start) / PERIOD_MS);
    record.periodStart = new Date(start + periods * PERIOD_MS).toISOString();
    record.callsUsed = 0;
    record.callsAllowed = record.monthlyCalls;
    changed = true;
  }
  return changed;
}

export function resetAt(record) {
  if (!record || !record.monthlyCalls || !record.periodStart) return null;
  return new Date(new Date(record.periodStart).getTime() + PERIOD_MS).toISOString();
}
