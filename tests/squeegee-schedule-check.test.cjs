"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {compareDisplayedSchedule} = require("../netlify/functions/lib/squeegeeScheduleCheck");

const booking = () => ({
  address: "17 Example Street, Bangor BT20 4AA",
  bins: [
    { type: "Black Bin", count: 2, planId: "domestic_4w" },
    { type: "Blue Bin", count: 1, planId: "domestic_oneoff" },
  ],
});
const server = () => ({
  postcode: "BT20 4AA",
  town: "BANGOR",
  matched: true,
  results: [
    { bin: "Black Bin", town: "BANGOR", automatic: true, assignedCleanDate: "2026-11-02" },
    { bin: "Blue Bin", town: "BANGOR", automatic: true, assignedCleanDate: "2026-11-05" },
  ],
});
const client = () => ({
  version: 1,
  postcode: "BT20 4AA",
  matched: true,
  results: [
    { type: "Black Bin", automatic: true, assignedCleanDate: "2026-11-02" },
    { type: "Blue Bin", automatic: true, assignedCleanDate: "2026-11-05" },
  ],
});

test("both website dates and server dates agree, so dates are eligible", () => {
  const result = compareDisplayedSchedule(booking(), server(), client());
  assert.equal(result.readyCount, 2);
  assert.equal(result.matched, true);
  assert.equal(result.results[0].assignedCleanDate, "2026-11-02");
  assert.equal(result.results[1].assignedCleanDate, "2026-11-05");
  assert.equal(result.jobGroupVerified, false);
});
test("one changed bin date cannot silently overwrite what the customer saw", () => {
  const srv = server();
  srv.results[1].assignedCleanDate = "2026-11-19";
  const result = compareDisplayedSchedule(booking(), srv, client());
  assert.equal(result.readyCount, 1);
  assert.equal(result.results[0].assignedCleanDate, "2026-11-02");
  assert.equal(result.results[1].assignedCleanDate, null);
  assert.equal(result.holds[0].reason, "displayed_date_changed");
});
test("missing preview snapshot holds all Squeegee jobs", () => {
  const result = compareDisplayedSchedule(booking(), server(), null);
  assert.equal(result.readyCount, 0);
  assert.equal(result.holds[0].reason, "schedule_not_confirmed_at_submit");
});
test("missing server response holds all Squeegee jobs", () => {
  const result = compareDisplayedSchedule(booking(), null, client());
  assert.equal(result.readyCount, 0);
});
test("removed-service-area towns are not eligible for a Squeegee job", () => {
  const srv=server();
  srv.town="BALLYWALTER";
  for (const row of srv.results) row.town="BALLYWALTER";
  const result = compareDisplayedSchedule(booking(), srv, client());
  assert.equal(result.readyCount, 0);
  assert.equal(result.holds[0].reason, "unverified_service_area");
});
test("unmatched bin order cannot create an appointment for the wrong bin", () => {
  const snap=client();
  snap.results.reverse();
  const result = compareDisplayedSchedule(booking(), server(), snap);
  assert.equal(result.readyCount, 0);
  assert.equal(result.holds[0].reason, "bin_mismatch");
});
test("server cannot assign a date when its own schedule is unconfirmed", () => {
  const srv=server();
  srv.results[1].automatic=false;
  srv.results[1].assignedCleanDate=null;
  const result=compareDisplayedSchedule(booking(),srv,client());
  assert.equal(result.results[1].assignedCleanDate,null);
  assert.equal(result.holds[0].reason,"server_date_unconfirmed");
});
test("conflicting postcodes block all automatic jobs", () => {
  const snap=client();
  snap.postcode="BT22 7JJ";
  const result=compareDisplayedSchedule(booking(),server(),snap);
  assert.equal(result.readyCount,0);
});
