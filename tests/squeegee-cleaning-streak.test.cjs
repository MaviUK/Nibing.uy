"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RULE_VERSION, scoreCustomerVisits } =
  require("../netlify/functions/lib/squeegeeCleaningStreak");

const event = (id, date, status = "completed", paid = true) => ({
  customerId: "customer-a", occurrenceId: id,
  dueOn: date, status, paid: status === "skipped" ? false : paid,
});
const score = events => scoreCustomerVisits(events, { asOf: "2026-10-31" });

test("20,22,24,26 for consecutive cleaned and paid appointments", () => {
  const result = score([
    event("c4", "2026-04-23"), event("c2", "2026-02-26"),
    event("c1", "2026-01-29"), event("c3", "2026-03-26"),
  ]);
  assert.equal(result.historicalPoints, 92);
  assert.equal(result.paidCleans, 4);
  assert.equal(result.consecutiveCleanVisits, 4);
  assert.equal(result.nextCompletedVisitPoints, 28);
  assert.deepEqual(result.audit.map(x => x.pointsAwarded), [20, 22, 24, 26]);
  assert.equal(result.ruleVersion, RULE_VERSION);
});

test("skipped Squeegee appointment resets next clean to 20 WITHOUT deleting earlier points", () => {
  const result = score([
    event("c1", "2026-01-29"), event("c2", "2026-02-26"),
    event("c3", "2026-03-26"), event("skip", "2026-04-23", "skipped"),
    event("c4", "2026-05-21"), event("c5", "2026-06-18"),
  ]);
  assert.deepEqual(result.audit.map(x => x.pointsAwarded), [20, 22, 24, 0, 20, 22]);
  assert.equal(result.historicalPoints, 108);
  assert.equal(result.recordedSkippedVisits, 1);
  assert.equal(result.consecutiveCleanVisits, 2);
  assert.equal(result.nextCompletedVisitPoints, 24);
});

test("separate paid jobs on the same service day share visit bonus", () => {
  const result = score([
    event("black-1", "2026-02-05"),
    event("brown-1", "2026-02-05"),
    event("black-2", "2026-03-05"),
    event("brown-2", "2026-03-05"),
  ]);
  assert.equal(result.historicalPoints, 84);
  assert.deepEqual(result.audit.map(x => x.pointsAwarded), [20, 20, 22, 22]);
  assert.equal(result.consecutiveCleanVisits, 2);
  assert.equal(result.paidCleans, 4);
});

test("a skip on the same day as another completed bin resets the streak first", () => {
  const result = score([
    event("black1", "2026-02-05"),
    event("brown1", "2026-03-05", "skipped"),
    event("black2", "2026-03-05"),
    event("black3", "2026-04-02"),
  ]);
  assert.equal(result.historicalPoints, 62);
  assert.equal(result.recordedSkippedVisits, 1);
  assert.deepEqual(result.audit.map(x => x.pointsAwarded), [20, 0, 20, 22]);
});

test("completed clean awaiting payment doesn't earn points or reset attendance streak", () => {
  const result = score([
    event("paid1", "2026-01-15"),
    event("not-yet-paid", "2026-02-12", "completed", false),
    event("paid3", "2026-03-12"),
  ]);
  assert.equal(result.historicalPoints, 44);
  assert.equal(result.heldCleans, 1);
  assert.equal(result.consecutiveCleanVisits, 3);
  assert.equal(result.nextCompletedVisitPoints, 26);
  assert.deepEqual(result.audit.map(x => x.pointsAwarded), [20, 0, 24]);
});

test("a gap of eight weeks does not falsely count as a skipped appointment", () => {
  const result = score([
    event("one", "2026-01-15"), event("two", "2026-03-12"),
  ]);
  assert.equal(result.historicalPoints, 42);
  assert.equal(result.recordedSkippedVisits, 0);
});

test("re-importing same clean occurrence is idempotent, conflicts rejected", () => {
  const completed = event("job-1", "2026-01-15");
  assert.equal(score([completed, completed, { ...completed }]).historicalPoints, 20);
  assert.throws(() => score([completed,
    { ...completed, dueOn: "2026-01-22" }]), /conflicting_streak_occurrence/);
});

test("future dates, customer mixes and invalid statuses are rejected", () => {
  assert.throws(() => score([event("future", "2026-11-01")]), /invalid_streak_event/);
  assert.throws(() => score([event("bad", "2026-02-30")]), /invalid_streak_event/);
  assert.throws(() => score([event("no", "2026-01-15", "cancelled")]), /invalid_streak_event/);
  assert.throws(() => score([event("one", "2026-01-15"),
    { ...event("two", "2026-02-12"), customerId: "another" }]),
  /mixed_customer_streak_events/);
});
