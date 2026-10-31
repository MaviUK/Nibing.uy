"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateHistoricalScores } =
  require("../netlify/functions/lib/squeegeeHistoricalLeaderboard.js");
const bill = (invoiceId, customerId = "customer-1", extras = {}) => ({
  customerId, invoiceId, state: "settled", dueOn: "2026-09-01",
  paidOn: "2026-09-10", ...extras,
});
const clean = (cleanId, invoiceId, customerId = "customer-1") => ({
  cleanId, invoiceId, customerId, completedOn: "2026-08-31",
  kind: "bin-clean", status: "completed",
});
const score = (cleans, invoices, asOf = "2026-10-31") =>
  calculateHistoricalScores({ cleans, invoices, asOf });

test("one point per paid appointment, independently of quantity or repeated row", () => {
  const a = { ...clean("clean-1", "inv-1"), quantity: 3 };
  const result = score([a, a, clean("clean-2", "inv-1")], [bill("inv-1")]);
  assert.equal(result.customers[0].paidCleans, 2);
  assert.equal(result.customers[0].pointChange, 2);
  assert.equal(result.readyToApply, false);
});

test("day 28 is free; day 29 costs one point; day 31 costs three", () => {
  const cleans = [clean("clean-1", "inv-1")];
  const invoice = bill("inv-1", "customer-1", {
    state: "open", dueOn: "2026-10-01", paidOn: undefined,
    outstandingPence: 500,
  });
  assert.equal(score(cleans, [invoice], "2026-10-29").customers[0].overdueDays, 0);
  assert.equal(score(cleans, [invoice], "2026-10-30").customers[0].overdueDays, 1);
  assert.equal(score(cleans, [invoice], "2026-11-01").customers[0].overdueDays, 3);
});

test("late settlement retains accrued penalty but stops new deductions", () => {
  const invoice = bill("inv-1", "customer-1", {
    dueOn: "2026-09-01", paidOn: "2026-10-01",
  });
  const result = score([clean("clean-1", "inv-1")], [invoice]);
  assert.equal(result.customers[0].paidCleans, 1);
  assert.equal(result.customers[0].overdueDays, 2);
  assert.equal(result.customers[0].pointChange, -1);
  assert.equal(result.customers[0].activeOverdueInvoices, 0);
});

test("overlapping late invoices count only one penalty per calendar day per customer", () => {
  const cleans = [clean("c1", "i1"), clean("c2", "i2")];
  const invoices = [
    bill("i1", "customer-1", { state: "open", dueOn: "2026-10-01", outstandingPence: 500 }),
    bill("i2", "customer-1", { state: "open", dueOn: "2026-10-02", outstandingPence: 500 }),
  ];
  const result = score(cleans, invoices, "2026-11-01");
  assert.equal(result.customers[0].overdueDays, 3);
  assert.equal(result.customers[0].activeOverdueInvoices, 2);
});

test("unverified, disputed, partial or missing invoices never award paid points", () => {
  const cleans = [clean("c1", "i1"), clean("c2", "i2"), clean("c3", "i3"), clean("c4", "i4")];
  const invoices = [
    bill("i1", "customer-1", {state: "open", outstandingPence: 1, paidOn: undefined}),
    bill("i2", "customer-1", {state: "unknown", paidOn: undefined}),
    bill("i3", "customer-1", {state: "excluded", paidOn: undefined}),
  ];
  const result = score(cleans, invoices);
  assert.equal(result.customers[0].paidCleans, 0);
  assert.equal(result.customers[0].heldCleans, 4);
});

test("conflicting invoice duplicates are held and never double-awarded", () => {
  const result = score([clean("c1", "i1")], [
    bill("i1"), bill("i1", "customer-1", {paidOn: "2026-10-31"}),
  ]);
  assert.equal(result.customers[0].paidCleans, 0);
  assert.equal(result.issues.invalidInvoicesConflicts, 1);
});

test("customer mismatches cannot attach one customer's invoice to another", () => {
  const result = score([clean("c1", "i1")], [bill("i1", "customer-2")]);
  assert.equal(result.customers[0].heldCleans, 1);
  assert.equal(result.totals.paidCleans, 0);
});

test("invalid dates, unsupported jobs and missing full-payment dates fail closed", () => {
  const result = score([
    clean("c1", "i1"),
    { ...clean("c2", "i1"), completedOn: "2026-02-30" },
    { ...clean("c3", "i1"), kind: "surcharge" },
  ], [bill("i1", "customer-1", { paidOn: "bad" })]);
  assert.equal(result.totals.paidCleans, 0);
  assert.equal(result.issues.invalidCleans, 2);
  assert.equal(result.issues.invalidInvoices, 1);
});

test("permuting rows does not change preview totals or fingerprint", () => {
  const a = clean("c1", "i1"), b = clean("c2", "i2");
  const x = bill("i1"), y = bill("i2");
  const first = score([a, b], [x, y]);
  const second = score([b, a], [y, x]);
  assert.deepEqual(first, second);
  assert.ok(!JSON.stringify(first).includes("example@example.com"));
});

test("settled invoice with unverified due date still earns clean point but has no penalty", () => {
  const result = score([clean("c1", "i1")], [bill("i1", "customer-1", {dueOn: null})]);
  assert.equal(result.totals.paidCleans, 1);
  assert.equal(result.issues.unavailableDueDates, 1);
  assert.equal(result.totals.overdueDays, 0);
});
