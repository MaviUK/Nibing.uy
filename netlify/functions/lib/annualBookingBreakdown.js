"use strict";

// Customer-facing illustration of the first 13 four-weekly cleans (52 weeks).
// Only rows with a recognised four-weekly plan are counted. This is never
// used to charge a customer; the existing verified quote remains authoritative.
const RECURRING_PLANS = new Set([
  "domestic_4w", "comm_lt360_4w", "comm_gt660_4w",
]);
const CLEANS_PER_YEAR = 13;
function gbp(value) {
  const n = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return "GBP " + (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2));
}
function annualBookingBreakdown(pricing) {
  const rows = Array.isArray(pricing?.lines) ? pricing.lines : [];
  const recurring = rows.filter(row => RECURRING_PLANS.has(String(row?.planId || "")));
  if (!recurring.length) return "";
  if (recurring.length > 20) return "";
  let perVisitPence = 0;
  const lines = ["13 cleans across 52 weeks (4-weekly plan):"];
  for (const row of recurring) {
    const quantity = Number(row.count);
    const unit = Number(row.unitPrice);
    const lineCharge = Number(row.lineTotal);
    if (!Number.isSafeInteger(quantity) || quantity < 1 ||
        !Number.isFinite(unit) || unit < 0 ||
        !Number.isFinite(lineCharge) || lineCharge < 0) return "";
    const type = String(row.type || "Bin").trim().replace(/[^\w\s-]/g, "").slice(0, 26) || "Bin";
    const size = row.sizeLitres === 660 || row.sizeLitres === 1100
      ? " (" + row.sizeLitres + "L)" : "";
    const desc = quantity + " x " + type + size;
    const chargedPence = Math.round(lineCharge * 100);
    perVisitPence += chargedPence;
    // lineTotal includes any offer already shown in the submitted price.
    lines.push(desc + ": " + gbp(lineCharge) + " x 13 = " +
      gbp((chargedPence * CLEANS_PER_YEAR) / 100));
  }
  lines.push("Per 4-weekly visit: " + gbp(perVisitPence / 100));
  lines.push("TOTAL FOR 13 CLEANS: " + gbp(perVisitPence * CLEANS_PER_YEAR / 100));
  lines.push("Estimate at the quoted rate; not payable upfront.");
  lines.push("Price/discount changes may affect actual costs." +
    (rows.length !== recurring.length ? " One-offs excluded." : ""));
  return lines.join("\n");
}
module.exports = { annualBookingBreakdown, CLEANS_PER_YEAR };
