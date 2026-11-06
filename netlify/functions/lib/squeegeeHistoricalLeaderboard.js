"use strict";

// Pure, read-only scoring calculator. Inputs must be reconciled, NORMALISED
// Squeegee exports: never feed raw customer, invoice or API objects straight in.
// Deliberately no Netlify Blobs writes, Squeegee POSTs or public-name handling.
const crypto = require("node:crypto");
const DAY_MS = 86400000;
const ID = /^[A-Za-z0-9._:-]{1,100}$/;

function dayNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value) return null;
  return day / DAY_MS;
}

function validId(value) {
  return typeof value === "string" && ID.test(value);
}

function indexedRows(rows, required, validate, invalidKey, issues) {
  const entries = new Map();
  const conflicts = new Set();
  for (const row of rows) {
    if (!row || !validId(row[required])) {
      issues[invalidKey]++;
      continue;
    }
    const id = row[required];
    if (!validate(row)) {
      issues[invalidKey]++;
      // A malformed duplicate must invalidate the ID's good-looking copy.
      conflicts.add(id);
      continue;
    }
    const fingerprint = JSON.stringify(row);
    const previous = entries.get(id);
    if (previous && previous.fingerprint !== fingerprint) conflicts.add(id);
    else if (!previous) entries.set(id, { row, fingerprint });
  }
  for (const id of conflicts) entries.delete(id);
  issues[invalidKey + "Conflicts"] = conflicts.size;
  return [...entries.values()].map(({ row }) => row);
}

function addInterval(intervals, start, end) {
  if (start <= end) intervals.push([start, end]);
}

function countDistinctDays(intervals) {
  const ordered = intervals.sort((a, b) => a[0] - b[0]);
  let days = 0, start = null, end = null;
  for (const [nextStart, nextEnd] of ordered) {
    if (start === null) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end + 1) {
      end = Math.max(end, nextEnd);
    } else {
      days += end - start + 1;
      start = nextStart;
      end = nextEnd;
    }
  }
  return days + (start === null ? 0 : end - start + 1);
}

/**
 * Canonical completed bin-clean rows:
 *   { customerId, cleanId, invoiceId, completedOn:'YYYY-MM-DD', kind:'bin-clean', status:'completed' }
 * Canonical invoice rows:
 *   { customerId, invoiceId, dueOn:'YYYY-MM-DD'|null,
 *     state:'settled'|'open'|'excluded'|'unknown',
 *     paidOn:'YYYY-MM-DD' (settled),
 *     outstandingPence:positive_integer (open) }
 *
 * A 'settled' row is valid only with a verified FULL payment date. Partial
 * payment is 'open', with verified outstanding balance > 0. No customer names,
 * balances or invoice details are returned. Scores are PREVIEW ONLY.
 */
function calculateHistoricalScores({ cleans, invoices, asOf }) {
  const today = dayNumber(asOf);
  if (today === null) throw new Error("asOf must be a valid YYYY-MM-DD date");
  if (!Array.isArray(cleans) || !Array.isArray(invoices) ||
      cleans.length > 100000 || invoices.length > 100000) {
    throw new Error("Expected bounded cleans and invoices arrays");
  }
  const issues = {
    invalidCleans: 0, invalidInvoices: 0, heldCleans: 0,
    unavailableDueDates: 0,
  };
  const cleanRows = indexedRows(cleans, "cleanId", row =>
    validId(row.customerId) &&
    row.kind === "bin-clean" && row.status === "completed" &&
    dayNumber(row.completedOn) !== null && dayNumber(row.completedOn) <= today &&
    validId(row.invoiceId), "invalidCleans", issues);
  const invoiceRows = indexedRows(invoices, "invoiceId", row =>
    validId(row.customerId) &&
    ["settled", "open", "excluded", "unknown"].includes(row.state) &&
    (row.dueOn == null || dayNumber(row.dueOn) !== null) &&
    (row.state !== "settled" ||
      (dayNumber(row.paidOn) !== null && dayNumber(row.paidOn) <= today)) &&
    (row.state !== "open" ||
      (Number.isSafeInteger(row.outstandingPence) && row.outstandingPence > 0)),
  "invalidInvoices", issues);
  const byInvoice = new Map(invoiceRows.map(row => [row.invoiceId, row]));
  const byCustomer = new Map();
  function customer(id) {
    if (!byCustomer.has(id)) byCustomer.set(id, {
      customerId: id, paidCleans: 0, overdueDays: 0,
      heldCleans: 0, activeOverdueInvoices: 0,
      intervals: [], invoices: new Set(),
    });
    return byCustomer.get(id);
  }

  for (const clean of cleanRows) {
    const score = customer(clean.customerId);
    const invoice = byInvoice.get(clean.invoiceId);
    if (!invoice || invoice.customerId !== clean.customerId ||
        invoice.state === "excluded" || invoice.state === "unknown") {
      score.heldCleans++;
      issues.heldCleans++;
      continue;
    }
    score.invoices.add(invoice.invoiceId);
    if (invoice.state === "settled") score.paidCleans++;
    else {
      score.heldCleans++;
      issues.heldCleans++;
    }
  }

  for (const score of byCustomer.values()) {
    for (const id of score.invoices) {
      const invoice = byInvoice.get(id);
      if (invoice.dueOn == null) {
        issues.unavailableDueDates++;
        continue;
      }
      const firstPenaltyDay = dayNumber(invoice.dueOn) + 29;
      // A day is penalised only ONCE per customer, even with several invoices.
      // Historical penalties remain after a late invoice was settled.
      const finalDay = invoice.state === "settled" ? dayNumber(invoice.paidOn) : today;
      if (invoice.state === "open" && firstPenaltyDay <= today) score.activeOverdueInvoices++;
      addInterval(score.intervals, firstPenaltyDay, finalDay);
    }
    score.overdueDays = countDistinctDays(score.intervals);
  }
  const customers = [...byCustomer.values()].map(score => ({
    customerId: score.customerId,
    paidCleans: score.paidCleans,
    overdueDays: score.overdueDays,
    heldCleans: score.heldCleans,
    activeOverdueInvoices: score.activeOverdueInvoices,
    pointChange: score.paidCleans - score.overdueDays,
  })).sort((a, b) => a.customerId.localeCompare(b.customerId));
  const totals = customers.reduce((acc, row) => {
    acc.paidCleans += row.paidCleans;
    acc.overdueDays += row.overdueDays;
    acc.heldCleans += row.heldCleans;
    return acc;
  }, { paidCleans: 0, overdueDays: 0, heldCleans: 0 });
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify({ asOf, customers, issues }))
    .digest("hex");
  return {
    version: "history-preview-v1", asOf,
    readyToApply: false, // No historical scores can change a public leaderboard.
    requiresOwnerReconciliation: true,
    policy: { pointsPerPaidClean: 1, graceDaysAfterDue: 28, maxPenaltyPerCustomerPerDay: 1 },
    fingerprint: digest,
    totals, issues, customers,
  };
}

module.exports = { calculateHistoricalScores, dayNumber, countDistinctDays };
