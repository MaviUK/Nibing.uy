"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("owner pre-Squeegee cleans are counted once alongside the 5 Nov verified physical bins", async () => {
  const { CYCLE_SNAPSHOT } = await import("../src/data/cleaningCycleData.mjs");
  const { VERIFIED_COMPLETED_SERVICES, SQUEEGEE_COMPLETED_BINS, LIFETIME_COMPLETED_BINS } = await import("../src/data/verifiedCompletedServices.mjs");
  assert.equal(CYCLE_SNAPSHOT.completedBinsThroughBackup, 30803, "31 Oct cycle data remains unchanged");
  assert.equal(VERIFIED_COMPLETED_SERVICES.asOf, "2026-11-05");
  assert.equal(VERIFIED_COMPLETED_SERVICES.beforeSqueegeeBins, 14000);
  assert.equal(SQUEEGEE_COMPLETED_BINS, 31212);
  assert.equal(LIFETIME_COMPLETED_BINS, 45212);
  assert.equal(VERIFIED_COMPLETED_SERVICES.regularBins + VERIFIED_COMPLETED_SERVICES.oneOffBins, SQUEEGEE_COMPLETED_BINS);
  const stats = fs.readFileSync(path.join(__dirname, "../src/data/statsPlan.js"), "utf8");
  assert.match(stats, /PRE_SQUEEGEE_COMPLETED_BINS = VERIFIED_COMPLETED_SERVICES\.beforeSqueegeeBins/);
  assert.match(stats, /TOTAL_COMPLETED_BINS = LIFETIME_COMPLETED_BINS/);
  assert.match(stats, /totalBinsCleaned: TOTAL_COMPLETED_BINS/);
  assert.match(stats, /totalBinsCleaned:TOTAL_COMPLETED_BINS/);
  assert.doesNotMatch(stats, /computeEstimatedRouteTotals|sessionAddsRef|dailyProgressBins/);
});

test("the homepage shows a clean lifetime number without explanatory notes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/LandingPage.jsx"), "utf8");
  assert.match(source, /Number\(totalBinsCleaned\)\.toLocaleString/);
  assert.doesNotMatch(source, /pre-Squeegee cleans|Squeegee records to|Including our new round/);
});
