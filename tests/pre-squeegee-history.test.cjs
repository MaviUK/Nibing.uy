"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the owner-reported 14,000 pre-Squeegee cleans are counted once alongside the verified backup", async () => {
  const { CYCLE_SNAPSHOT } = await import("../src/data/cleaningCycleData.mjs");
  assert.equal(CYCLE_SNAPSHOT.completedBinsThroughBackup, 30803);
  const stats = fs.readFileSync(path.join(__dirname, "../src/data/statsPlan.js"), "utf8");
  assert.match(stats, /PRE_SQUEEGEE_COMPLETED_BINS = 14000/);
  assert.match(stats, /PRE_SQUEEGEE_COMPLETED_BINS \+ CYCLE_SNAPSHOT\.completedBinsThroughBackup/);
  assert.match(stats, /totalBinsCleaned: TOTAL_COMPLETED_BINS/);
  assert.match(stats, /totalBinsCleaned:TOTAL_COMPLETED_BINS/);
  assert.equal(14000 + CYCLE_SNAPSHOT.completedBinsThroughBackup, 44803);
  assert.doesNotMatch(stats, /computeEstimatedRouteTotals|sessionAddsRef|dailyProgressBins/);
});

test("the homepage labels the older cleans separately from the Squeegee data date", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/LandingPage.jsx"), "utf8");
  assert.match(source, /preSqueegeeCompletedBins/);
  assert.match(source, /pre-Squeegee cleans/);
  assert.match(source, /Squeegee records to \{verifiedThrough\}/);
});
