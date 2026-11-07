"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const value = (fn, verifiedThrough, iso) =>
  fn(verifiedThrough, new Date(iso));

test("owner-paced bins show 200 each Monday–Thursday from 8am–6pm UK", async () => {
  const { ownerEstimatedBinsSince: bins, OWNER_ESTIMATED_BINS_PER_DAY: daily } =
    await import("../src/data/dailyBinCounter.mjs");
  assert.equal(daily, 200);
  const base = "2026-11-05"; // the current verified audit includes Thursday
  for (const date of [
    "2026-11-05T18:30:00Z", "2026-11-06T17:00:00Z",
    "2026-11-07T12:00:00Z", "2026-11-08T12:00:00Z",
    "2026-11-09T07:59:00Z", "2026-11-09T08:00:00Z",
  ]) assert.equal(value(bins, base, date), 0, date);
  assert.equal(value(bins, base, "2026-11-09T08:02:00Z"), 0);
  assert.equal(value(bins, base, "2026-11-09T08:03:00Z"), 1);
  assert.equal(value(bins, base, "2026-11-09T09:00:00Z"), 20);
  assert.equal(value(bins, base, "2026-11-09T13:00:00Z"), 100);
  assert.equal(value(bins, base, "2026-11-09T17:59:00Z"), 199);
  assert.equal(value(bins, base, "2026-11-09T18:00:00Z"), 200);
  assert.equal(value(bins, base, "2026-11-09T23:59:00Z"), 200);
  assert.equal(value(bins, base, "2026-11-10T07:59:00Z"), 200);
  assert.equal(value(bins, base, "2026-11-10T13:00:00Z"), 300);
  assert.equal(value(bins, base, "2026-11-12T18:00:00Z"), 800);
  assert.equal(value(bins, base, "2026-11-13T13:00:00Z"), 800);
  assert.equal(value(bins, base, "2026-11-15T13:00:00Z"), 800);
  assert.equal(value(bins, base, "2026-11-16T13:00:00Z"), 900);
});

test("verified audit date moves the daily starting point to prevent double counting", async () => {
  const { ownerEstimatedBinsSince: bins } =
    await import("../src/data/dailyBinCounter.mjs");
  assert.equal(value(bins, "2026-11-10", "2026-11-10T17:00:00Z"), 0);
  assert.equal(value(bins, "2026-11-10", "2026-11-11T13:00:00Z"), 100);
  assert.equal(value(bins, "2026-11-10", "2026-11-12T18:00:00Z"), 400);
  assert.equal(value(bins, "2026-11-12", "2026-11-12T18:00:00Z"), 0);
  assert.equal(value(bins, "2026-11-20", "2026-11-16T18:00:00Z"), 0);
  assert.equal(value(bins, "not-a-date", "2026-11-16T18:00:00Z"), 0);
  assert.equal(value(bins, "2026-11-05", "invalid"), 0);
});

test("UK daylight-saving time governs the eight-to-six counter, regardless of viewer location", async () => {
  const { ownerEstimatedBinsSince: bins } =
    await import("../src/data/dailyBinCounter.mjs");
  // BST: Monday 5 April 2027 starts at 07:00 UTC and ends at 17:00 UTC.
  const base = "2027-04-04";
  assert.equal(value(bins, base, "2027-04-05T06:59:00Z"), 0);
  assert.equal(value(bins, base, "2027-04-05T07:00:00Z"), 0);
  assert.equal(value(bins, base, "2027-04-05T12:00:00Z"), 100);
  assert.equal(value(bins, base, "2027-04-05T17:00:00Z"), 200);
});

test("homepage preserves its verified 45,212 audit separately from owner-paced additions", async () => {
  const { LIFETIME_COMPLETED_BINS, VERIFIED_COMPLETED_SERVICES } =
    await import("../src/data/verifiedCompletedServices.mjs");
  const { ownerEstimatedBinsSince: bins } =
    await import("../src/data/dailyBinCounter.mjs");
  assert.equal(LIFETIME_COMPLETED_BINS, 45212);
  assert.equal(VERIFIED_COMPLETED_SERVICES.asOf, "2026-11-05");
  assert.equal(LIFETIME_COMPLETED_BINS + value(
    bins, VERIFIED_COMPLETED_SERVICES.asOf, "2026-11-09T13:00:00Z"
  ), 45312);
  const stats = fs.readFileSync(path.join(__dirname, "../src/data/statsPlan.js"), "utf8");
  assert.match(stats, /ownerEstimatedBinsSince\(VERIFIED_COMPLETED_SERVICES\.asOf,now\)/);
  assert.match(stats, /totalBinsCleaned:TOTAL_COMPLETED_BINS\+ownerPacedBins/);
  assert.match(stats, /totalBinsCleaned: TOTAL_COMPLETED_BINS/);
  const hero = fs.readFileSync(path.join(__dirname, "../src/LandingPage.jsx"), "utf8");
  assert.match(hero, /Number\(totalBinsCleaned\)\.toLocaleString/);
});
