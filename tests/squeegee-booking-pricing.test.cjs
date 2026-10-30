"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyAndPriceBooking } = require("../netlify/functions/lib/squeegeeBookingPricing");

const regularBlack = { type: "Black Bin", count: 2, planId: "domestic_4w" };
const oneoffBlue = { type: "Blue Bin", count: 1, planId: "domestic_oneoff" };

function posted(lines, { total, subtotal, multiBuyFreeBins = 0, multiBuyDiscount = 0 } = {}) {
  return { lines, total, subtotal, multiBuyFreeBins, multiBuyDiscount };
}

test("accepts the site's normal £5 four-weekly and £15 one-off breakdown", () => {
  const quote = posted([
    { idx: 0, type: "Black Bin", count: 2, planId: "domestic_4w",
      baseUnit: 5, unitPrice: 5, lineTotal: 10, freeCount: 0,
      multiBuyDiscount: 0, discounted: false },
    { idx: 1, type: "Blue Bin", count: 1, planId: "domestic_oneoff",
      baseUnit: 15, unitPrice: 15, lineTotal: 15, freeCount: 0,
      multiBuyDiscount: 0, discounted: false },
  ], { subtotal: 25, total: 25 });
  const result = verifyAndPriceBooking([regularBlack, oneoffBlue], null, quote);
  assert.equal(result.ok, true);
  assert.equal(result.canonical.total, 25);
  assert.equal(result.canonical.lines[0].lineTotal, 10);
  assert.equal(result.canonical.lines[1].lineTotal, 15);
});

test("rejects browser-reduced prices while retaining canonical price", () => {
  const quote = posted([
    { idx: 0, type: "Black Bin", count: 2, planId: "domestic_4w",
      baseUnit: 5, unitPrice: 5, lineTotal: 0, freeCount: 0,
      multiBuyDiscount: 0, discounted: false },
    { idx: 1, type: "Blue Bin", count: 1, planId: "domestic_oneoff",
      baseUnit: 15, unitPrice: 15, lineTotal: 15, freeCount: 0,
      multiBuyDiscount: 0, discounted: false },
  ], { subtotal: 25, total: 15 });
  const result = verifyAndPriceBooking([regularBlack, oneoffBlue], "", quote);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "client_price_mismatch");
  assert.equal(result.canonical.total, 25);
});

test("reproduces exact 7-for-6 discount on cheapest billable bins", () => {
  const bins = [
    { type: "Black Bin", count: 6, planId: "domestic_4w" },
    { type: "Brown Bin", count: 1, planId: "domestic_oneoff" },
  ];
  const quote = posted([
    { idx: 0, type: "Black Bin", count: 6, planId: "domestic_4w",
      baseUnit: 5, unitPrice: 5, lineTotal: 25, freeCount: 1,
      multiBuyDiscount: 5, discounted: false },
    { idx: 1, type: "Brown Bin", count: 1, planId: "domestic_oneoff",
      baseUnit: 15, unitPrice: 15, lineTotal: 15, freeCount: 0,
      multiBuyDiscount: 0, discounted: false },
  ], { subtotal: 45, total: 40, multiBuyFreeBins: 1, multiBuyDiscount: 5 });
  const result = verifyAndPriceBooking(bins, "", quote);
  assert.equal(result.ok, true);
  assert.equal(result.canonical.lines[0].freeCount, 1);
  assert.equal(result.canonical.total, 40);
});

test("7-for-6 discount is applied to cheapest bin even when it appears later", () => {
  const bins = [
    { type: "Blue Bin", count: 6, planId: "domestic_oneoff" },
    { type: "Black Bin", count: 1, planId: "domestic_4w" },
  ];
  const quote = posted([
    { idx: 0, type: "Blue Bin", count: 6, planId: "domestic_oneoff",
      baseUnit: 15, unitPrice: 15, lineTotal: 90, freeCount: 0,
      multiBuyDiscount: 0, discounted: false },
    { idx: 1, type: "Black Bin", count: 1, planId: "domestic_4w",
      baseUnit: 5, unitPrice: 5, lineTotal: 0, freeCount: 1,
      multiBuyDiscount: 5, discounted: false },
  ], { subtotal: 95, total: 90, multiBuyFreeBins: 1, multiBuyDiscount: 5 });
  assert.equal(verifyAndPriceBooking(bins, "", quote).ok, true);
});

test("does not permit expired FRESH20 code in 2026-10", () => {
  const quote = posted([], { subtotal: 10, total: 8 });
  const result = verifyAndPriceBooking([regularBlack], "FRESH20", quote, {
    now: Date.parse("2026-10-30T11:00:00Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "discount_expired");
});

test("does not permit applying discount on wrong plan", () => {
  const result = verifyAndPriceBooking([oneoffBlue], "FRESH20", null, {
    now: Date.parse("2026-06-01T11:00:00Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "discount_not_applicable");
});

test("rejects zero/negative/decimal or excessive quantities", () => {
  for (const count of [0, -1, 1.2, 201, "none"]) {
    const result = verifyAndPriceBooking([{ ...regularBlack, count }], "", null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_quantity");
  }
});

test("rejects unrecognised plans or an unrecognised bin", () => {
  assert.equal(verifyAndPriceBooking([{ ...regularBlack, planId: "free_4w" }], "", null).reason, "unknown_plan_or_bin");
  assert.equal(verifyAndPriceBooking([{ ...regularBlack, type: "Pink Bin" }], "", null).reason, "unknown_plan_or_bin");
});

test("commercial bin price is verified but still needs separate Squeegee service mapping", () => {
  const bins = [{ type: "Brown Bin", count: 2, planId: "comm_gt660_oneoff" }];
  const quote = posted([{ idx: 0, type: "Brown Bin", count: 2,
    planId: "comm_gt660_oneoff", baseUnit: 35, unitPrice: 35,
    lineTotal: 70, freeCount: 0, multiBuyDiscount: 0, discounted: false,
  }], { total: 70, subtotal: 70 });
  const result = verifyAndPriceBooking(bins, "", quote);
  assert.equal(result.ok, true);
  assert.equal(result.canonical.lines[0].lineTotal, 70);
});
