"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { streetSignupDate, prepareStreetSignupJobs } = require("../netlify/functions/lib/squeegeeStreetSignupPlan");

test("street signup uses UK local date across midnight", () => {
  assert.equal(streetSignupDate("2026-11-16T23:30:00Z"), "2026-11-16");
  assert.equal(streetSignupDate("2026-07-01T23:30:00Z"), "2026-07-02");
});
test("two recurring black bins create two outstanding four-weekly jobs", () => {
  const jobs = prepareStreetSignupJobs([{type:"Black",count:2,planId:"domestic_4w"}], "2026-11-16T13:20:00Z");
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.equal(job.date, "2026-11-16");
    assert.equal(job.frequencyType, "weeks");
    assert.equal(job.frequencyInterval, 4);
    assert.equal(job.completion, "manual");
  }
});
test("one-off does not recur or complete", () => {
  const [job] = prepareStreetSignupJobs([{type:"Blue",count:1,planId:"domestic_oneoff"}]);
  assert.equal(job.frequencyType,"adhoc");
  assert.equal(job.frequencyInterval,undefined);
  assert.equal(job.completion,"manual");
});
test("large commercial needs explicit size", () => {
  assert.throws(()=>prepareStreetSignupJobs([{type:"Brown",count:1,planId:"comm_gt660_4w"}]),/commercial_size_required/);
});
