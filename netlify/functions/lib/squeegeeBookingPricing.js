"use strict";

/**
 * Trusted NI Bin Guy website price calculator.
 *
 * Keep parity with the customer-facing pricing in src/LandingPage.jsx.
 * Source prices checked on preview/n64-retro-site 2026-10-30.
 *
 * All input from the browser (including its pricing breakdown) is untrusted.
 * Never pass prices to a Squeegee write without a verified canonical quote.
 */
const PLANS = Object.freeze({
  domestic_4w: { label: "4 Weekly", price: 5 },
  domestic_oneoff: { label: "One-off", price: 15 },
  comm_lt360_4w: { label: "Commercial <360L 4 Weekly", price: 5 },
  comm_lt360_oneoff: { label: "Commercial <360L One-Off", price: 15 },
  comm_gt660_4w: { label: "Commercial >660L 4 Weekly", price: 12.5 },
  comm_gt660_oneoff: { label: "Commercial >660L One-Off", price: 35 },
});
const DISCOUNTS = Object.freeze({
  FRESH20: {
    type: "percent",
    value: 20,
    appliesTo: ["domestic_4w"],
    expiresAt: "2026-07-31T23:59:59Z",
  },
});
const MONEY_EPSILON = 0.001;
const roundMoney = n => Math.round(Number(n) * 100) / 100;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}
function normalizedBinType(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+bin\b/g, "").replace(/[^a-z]/g, "");
}

function discountFor(planId, code, now) {
  const key = normalizeCode(code);
  if (!key) return { valid: true, applied: false, rule: null };
  const rule = DISCOUNTS[key];
  if (!rule) return { valid: false, reason: "unknown_discount" };
  if (rule.startsAt && now < Date.parse(rule.startsAt)) return { valid: false, reason: "discount_not_active" };
  if (rule.expiresAt && now > Date.parse(rule.expiresAt)) return { valid: false, reason: "discount_expired" };
  if (!rule.appliesTo.includes(planId)) return { valid: true, applied: false, rule };
  return { valid: true, applied: true, rule };
}

function verifyAndPriceBooking(bins, discountCode, postedPricing, { now = Date.now() } = {}) {
  if (!Array.isArray(bins) || bins.length === 0 || bins.length > 20) {
    return { ok: false, reason: "invalid_bin_count" };
  }
  const code = normalizeCode(discountCode);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "invalid_server_time" };
  if (code && !DISCOUNTS[code]) return { ok: false, reason: "unknown_discount" };
  if (code && !bins.some(bin => DISCOUNTS[code].appliesTo.includes(bin?.planId))) {
    return { ok: false, reason: "discount_not_applicable" };
  }
  if (code && DISCOUNTS[code].startsAt && nowMs < Date.parse(DISCOUNTS[code].startsAt)) {
    return { ok: false, reason: "discount_not_active" };
  }
  if (code && DISCOUNTS[code].expiresAt && nowMs > Date.parse(DISCOUNTS[code].expiresAt)) {
    return { ok: false, reason: "discount_expired" };
  }

  const lines = [];
  for (let idx = 0; idx < bins.length; idx++) {
    const bin = bins[idx];
    const plan = PLANS[bin?.planId];
    const count = Number(bin?.count);
    const type = normalizedBinType(bin?.type);
    if (!plan || !["black", "blue", "brown", "green"].includes(type)) {
      return { ok: false, reason: "unknown_plan_or_bin" };
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
      return { ok: false, reason: "invalid_quantity" };
    }
    const discount = discountFor(bin.planId, code, nowMs);
    if (!discount.valid) return { ok: false, reason: discount.reason };
    let unitPrice = plan.price;
    if (discount.applied) {
      const rule = discount.rule;
      if (rule.type === "percent") unitPrice = roundMoney(plan.price * (1 - rule.value / 100));
      else if (rule.type === "fixed") unitPrice = Math.max(0, roundMoney(plan.price - rule.value));
      else if (rule.type === "free") unitPrice = 0;
    }
    lines.push({
      idx, type: bin.type, count, planId: bin.planId, planLabel: plan.label,
      baseUnit: plan.price, unitPrice, discounted: discount.applied,
      freeCount: 0, multiBuyDiscount: 0,
      lineTotal: roundMoney(unitPrice * count),
    });
  }
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.baseUnit * line.count, 0));
  const totalBins = lines.reduce((sum, line) => sum + line.count, 0);
  let freeBinsRemaining = Math.floor(totalBins / 7);
  const cheapest = lines.map((line, lineIndex) => ({
    lineIndex, unitPrice: line.unitPrice,
  })).filter(item => item.unitPrice > 0)
    .sort((a, b) => a.unitPrice - b.unitPrice || a.lineIndex - b.lineIndex);

  for (const { lineIndex } of cheapest) {
    if (freeBinsRemaining <= 0) break;
    const line = lines[lineIndex];
    const freeCount = Math.min(line.count, freeBinsRemaining);
    if (freeCount <= 0) continue;
    line.freeCount = freeCount;
    line.multiBuyDiscount = roundMoney(line.unitPrice * freeCount);
    line.lineTotal = Math.max(0, roundMoney(line.lineTotal - line.multiBuyDiscount));
    line.planLabel += " — 7 for 6 offer (" + freeCount + " free)";
    freeBinsRemaining -= freeCount;
  }

  const canonical = {
    lines, subtotal,
    total: roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
    multiBuyFreeBins: lines.reduce((sum, line) => sum + line.freeCount, 0),
    multiBuyDiscount: roundMoney(lines.reduce((sum, line) => sum + line.multiBuyDiscount, 0)),
  };

  // Refuse any discrepancy, including a missing or additional line, altered
  // discount and re-ordered rows. Never trust a browser-supplied flag.
  if (!postedPricing || !Array.isArray(postedPricing.lines) ||
      postedPricing.lines.length !== lines.length) {
    return { ok: false, reason: "missing_or_invalid_client_pricing", canonical };
  }
  const same = (a, b) => Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < MONEY_EPSILON;
  for (const line of lines) {
    const posted = postedPricing.lines[line.idx];
    if (!posted || posted.idx !== line.idx ||
        posted.planId !== line.planId ||
        normalizedBinType(posted.type) !== normalizedBinType(line.type) ||
        !same(posted.count, line.count) ||
        !same(posted.baseUnit, line.baseUnit) ||
        !same(posted.unitPrice, line.unitPrice) ||
        !same(posted.lineTotal, line.lineTotal) ||
        !same(posted.freeCount, line.freeCount) ||
        !same(posted.multiBuyDiscount, line.multiBuyDiscount) ||
        Boolean(posted.discounted) !== line.discounted) {
      return { ok: false, reason: "client_price_mismatch", canonical };
    }
  }
  if (!same(postedPricing.total, canonical.total) ||
      !same(postedPricing.subtotal, canonical.subtotal) ||
      !same(postedPricing.multiBuyDiscount, canonical.multiBuyDiscount) ||
      !same(postedPricing.multiBuyFreeBins, canonical.multiBuyFreeBins)) {
    return { ok: false, reason: "client_price_mismatch", canonical };
  }
  return { ok: true, canonical };
}

module.exports = { PLANS, DISCOUNTS, verifyAndPriceBooking, normalizedBinType };
