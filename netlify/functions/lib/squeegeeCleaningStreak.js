"use strict";

/**
 * NI Bin Guy loyalty points for completed *service visits*.
 * +20 on first visit, then +2 per consecutive completed visit:
 *   20, 22, 24, 26, ...
 * A Squeegee "skipped" occurrence resets the streak; the next completed
 * visit starts at +20. Existing earned points are never deducted.
 *
 * Every verified fully-paid job occurrence on a completed visit earns that
 * visit's bonus. Multiple jobs on the SAME service day do not inflate the
 * consecutive-visit counter (they share its points rate). A completed but
 * payment-unverified occurrence earns zero until verified, but does not break
 * an attendance streak. Deleted or pending Squeegee occurrences must NOT
 * be supplied as skipped events by the source-normalisation layer.
 *
 * Event shape (no names/addresses):
 * { customerId, occurrenceId, dueOn: 'YYYY-MM-DD',
 *   status: 'completed'|'skipped', paid: boolean }
 *
 * This is a complete deterministic recalculation, not an additive ledger
 * update. Re-importing the same events must never award duplicate points.
 */
const RULE_VERSION = "2026-11-streak-20-plus-2-squeegee-skip-reset-v1";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

/**
 * A preview-only projection of the next cleaning visit, separate from the
 * already-earned historical XP ledger. A missed four-week cycle (28 days)
 * gets up to seven days' scheduling/bank-holiday allowance; longer gaps
 * cannot carry a previous visit multiplier indefinitely. Paid and unpaid
 * completed visits count for attendance, but only paid visits earned XP.
 * Do not infer an actual Squeegee "skipped" occurrence from elapsed time.
 */
const MAX_ACTIVE_GAP_DAYS = 28 + 7;
const MS_PER_DAY = 86400000;
function ukCalendarDate(now) {
  if (typeof now !== "number" || !Number.isFinite(now)) return null;
  const time = new Date(now);
  if (Number.isNaN(time.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric",
    month: "2-digit", day: "2-digit",
  }).formatToParts(time);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const day = values.year + "-" + values.month + "-" + values.day;
  return validDate(day) ? day : null;
}
function effectiveCleaningStreak(events, { now = Date.now() } = {}) {
  const fallback = { currentStreak: 0, nextBonus: 20,
    expired: false, lastCompletedOn: null };
  const today = ukCalendarDate(now);
  if (!today || !Array.isArray(events) || events.length > 2000)
    return fallback;
  const byDate = new Map();
  for (const item of events) {
    if (!item || !validDate(item.date) || item.date > today) continue;
    const flags = byDate.get(item.date) || { skipped: false, completed: false };
    if (item.event === "recorded_skip") flags.skipped = true;
    if (item.event === "paid_completed_clean" ||
        item.event === "completed_payment_not_verified") flags.completed = true;
    byDate.set(item.date, flags);
  }

  let currentStreak = 0;
  let lastDay = null;
  let lastCompletedOn = null;
  for (const [date, flags] of [...byDate].sort((a, b) =>
      a[0].localeCompare(b[0]))) {
    if (flags.skipped) {
      currentStreak = 0;
      lastDay = null;
    }
    if (!flags.completed) continue;
    const day = Date.parse(date + "T00:00:00Z") / MS_PER_DAY;
    currentStreak = lastDay !== null && day - lastDay <= MAX_ACTIVE_GAP_DAYS
      ? currentStreak + 1 : 1;
    lastDay = day;
    lastCompletedOn = date;
  }
  const todayDay = Date.parse(today + "T00:00:00Z") / MS_PER_DAY;
  const expired = lastDay !== null && todayDay - lastDay > MAX_ACTIVE_GAP_DAYS;
  if (expired) currentStreak = 0;
  return { currentStreak, nextBonus: 20 + currentStreak * 2,
    expired, lastCompletedOn };
}

function scoreCustomerVisits(input, { asOf = "2026-10-31" } = {}) {
  if (!Array.isArray(input) || input.length > 20000 || !validDate(asOf)) {
    throw new Error("invalid_streak_input");
  }
  const used = new Map();
  const dates = new Map();

  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      typeof raw.customerId !== "string" ||
      typeof raw.occurrenceId !== "string" ||
      raw.customerId.length < 1 || raw.customerId.length > 100 ||
      raw.occurrenceId.length < 1 || raw.occurrenceId.length > 140 ||
      !validDate(raw.dueOn) || raw.dueOn > asOf ||
      !["completed", "skipped"].includes(raw.status) ||
      typeof raw.paid !== "boolean" ||
      (raw.status === "skipped" && raw.paid)) {
      throw new Error("invalid_streak_event");
    }
    const event = {
      customerId: raw.customerId,
      occurrenceId: raw.occurrenceId,
      dueOn: raw.dueOn,
      status: raw.status,
      paid: raw.paid,
    };
    const signature = JSON.stringify(event);
    const previous = used.get(event.occurrenceId);
    if (previous !== undefined) {
      if (previous !== signature) throw new Error("conflicting_streak_occurrence");
      continue; // exact duplicate never adds a second set of points
    }
    used.set(event.occurrenceId, signature);
    if (!dates.has(event.dueOn)) dates.set(event.dueOn, []);
    dates.get(event.dueOn).push(event);
  }

  const customers = new Set([...used.values()].map(value => JSON.parse(value).customerId));
  if (customers.size > 1) throw new Error("mixed_customer_streak_events");

  let currentStreak = 0;
  let longestStreak = 0;
  let historicalPoints = 0;
  let paidCleans = 0;
  let heldCleans = 0;
  let skippedVisits = 0;
  const audit = [];

  for (const day of [...dates.keys()].sort()) {
    const events = dates.get(day).sort((a, b) =>
      a.occurrenceId.localeCompare(b.occurrenceId));
    const skipped = events.filter(event => event.status === "skipped");
    if (skipped.length) {
      currentStreak = 0;
      skippedVisits++;
      for (const event of skipped) {
        audit.push({
          occurrenceId: event.occurrenceId, dueOn: day,
          event: "recorded_skip", streak: 0, potentialPoints: 0,
          pointsAwarded: 0,
        });
      }
    }
    const completed = events.filter(event => event.status === "completed");
    if (!completed.length) continue;

    currentStreak++;
    longestStreak = Math.max(longestStreak, currentStreak);
    const visitPoints = 20 + 2 * (currentStreak - 1);
    for (const event of completed) {
      const points = event.paid ? visitPoints : 0;
      if (event.paid) {
        historicalPoints += points;
        paidCleans++;
      } else {
        heldCleans++;
      }
      audit.push({
        occurrenceId: event.occurrenceId, dueOn: day,
        event: event.paid ? "paid_completed_clean" : "completed_payment_not_verified",
        streak: currentStreak, potentialPoints: visitPoints,
        pointsAwarded: points,
      });
    }
  }
  return {
    ruleVersion: RULE_VERSION,
    paidCleans,
    heldCleans,
    historicalPoints,
    recordedSkippedVisits: skippedVisits,
    consecutiveCleanVisits: currentStreak,
    longestConsecutiveCleanVisits: longestStreak,
    nextCompletedVisitPoints: 20 + 2 * currentStreak,
    audit,
  };
}

module.exports = { RULE_VERSION, validDate, scoreCustomerVisits, effectiveCleaningStreak };
