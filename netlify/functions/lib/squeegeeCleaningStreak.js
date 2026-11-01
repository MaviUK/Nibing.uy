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

module.exports = { RULE_VERSION, validDate, scoreCustomerVisits };
