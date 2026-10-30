"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../netlify/functions/lib/squeegeeApiV3");
const plan = require("../netlify/functions/lib/squeegeeBookingPlan");

const SERVICE = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";

function booking() {
  return {
    bookingId: "NBG-ABC123-ABCDEFGH",
    name: "Example Customer",
    email: "example@example.org",
    phone: "07000000000",
    address: "17 Example Street, Bangor, BT20 4AA",
    bins: [
      { type: "Black Bin", count: 2, planId: "domestic_4w" },
      { type: "Blue Bin", count: 1, planId: "domestic_oneoff" },
    ],
    pricing: { lines: [
      { idx: 0, type: "Black Bin", count: 2, planId: "domestic_4w", lineTotal: 10 },
      { idx: 1, type: "Blue Bin", count: 1, planId: "domestic_oneoff", lineTotal: 15 },
    ] },
  };
}

function verifiedSchedule() {
  return {
    postcode: "BT20 4AA",
    matched: true,
    results: [
      { bin: "Black Bin", automatic: true, assignedCleanDate: "2026-11-04" },
      { bin: "Blue Bin", automatic: true, assignedCleanDate: "2026-11-06" },
    ],
  };
}

const mappings = () => ({
  serviceIds: { black: SERVICE, blue: SERVICE },
  pricesVerifiedByServer: true,
  jobGroupFor: () => GROUP,
});

test("makes exact four-weekly and one-off jobs using verified dates", () => {
  const result = plan.buildSqueegeeBookingPlan(booking(), verifiedSchedule(), mappings());
  assert.equal(result.readyJobs, 2);
  assert.equal(result.blockedJobs, 0);
  assert.equal(result.writeEnabled, false);
  assert.equal(result.customerInput.address.text, "17 Example Street, Bangor, BT20 4AA");
  assert.equal(result.jobs[0].input.date, "2026-11-04");
  assert.equal(result.jobs[0].input.firstAppointment.initialDate, "2026-11-04");
  assert.equal(result.jobs[0].input.frequencyType, "weeks");
  assert.equal(result.jobs[0].input.frequencyInterval, 4);
  assert.equal(result.jobs[0].input.price, 10);
  assert.equal(result.jobs[0].input.jobGroup, GROUP);
  assert.equal(result.jobs[1].input.date, "2026-11-06");
  assert.equal(result.jobs[1].input.frequencyType, "adhoc");
  assert.equal(Object.hasOwn(result.jobs[1].input, "frequencyInterval"), false);
});

test("partial schedule never invents a date", () => {
  const schedule = verifiedSchedule();
  schedule.results[1] = { bin: "Blue Bin", automatic: false, assignedCleanDate: null };
  const result = plan.buildSqueegeeBookingPlan(booking(), schedule, mappings());
  assert.equal(result.readyJobs, 1);
  assert.equal(result.jobs[1].status, "date_to_confirm");
  assert.equal(result.jobs[1].input, null);
  assert.equal(result.jobs[1].date, null);
});

test("fails closed if schedule postcode differs", () => {
  const schedule = verifiedSchedule();
  schedule.postcode = "BT20 1AB";
  assert.throws(() => plan.buildSqueegeeBookingPlan(booking(), schedule, mappings()), /postcode/);
});

test("fails closed if schedule bins have moved order", () => {
  const schedule = verifiedSchedule();
  schedule.results.reverse();
  const result = plan.buildSqueegeeBookingPlan(booking(), schedule, mappings());
  assert.equal(result.readyJobs, 0);
  assert.equal(result.blockedJobs, 2);
});

test("customer reference is reproducible without disclosing identifying values", () => {
  const b = booking();
  const ref1 = plan.externalCustomerReference(b);
  const ref2 = plan.externalCustomerReference({ ...b, email: b.email.toUpperCase() });
  assert.equal(ref1, ref2);
  assert.match(ref1, /^NBG-WEB-[a-f0-9]{32}$/);
  assert.equal(ref1.includes("BT20"), false);
});

test("service selection and server pricing must both be verified before any job is ready", () => {
  assert.equal(plan.buildSqueegeeBookingPlan(booking(), verifiedSchedule()).readyJobs, 0);
  assert.equal(plan.buildSqueegeeBookingPlan(booking(), verifiedSchedule(), {
    serviceIds: { default: SERVICE },
  }).readyJobs, 0);
});

test("rejects dates that do not exist", () => {
  assert.equal(plan.validDate("2026-02-30"), false);
  assert.equal(plan.validDate("2026-11-06"), true);
});

test("write operations remain disabled with a valid test API key", async () => {
  const old = process.env.SQUEEGEE_API_KEY;
  process.env.SQUEEGEE_API_KEY = "fake-test-key";
  try {
    await assert.rejects(
      api.createCustomer(plan.customerInputForBooking(booking())),
      /writes are disabled/
    );
    await assert.rejects(
      api.addJobToCustomer(SERVICE, { frequencyType: "adhoc" }),
      /writes are disabled/
    );
  } finally {
    if (old === undefined) delete process.env.SQUEEGEE_API_KEY;
    else process.env.SQUEEGEE_API_KEY = old;
  }
});

test("GET services uses the documented Bearer authorization and v3 URL", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.SQUEEGEE_API_KEY;
  let request;
  process.env.SQUEEGEE_API_KEY = "fake-test-key";
  global.fetch = async (url, options) => {
    request = { url: url.toString(), options };
    return { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: SERVICE, description: "Bin cleaning" }] }) };
  };
  try {
    const services = await api.getServices();
    assert.equal(services.length, 1);
    assert.equal(request.url, "https://api02.sqgee.com/api/v3/public/services");
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.Authorization, "Bearer fake-test-key");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SQUEEGEE_API_KEY;
    else process.env.SQUEEGEE_API_KEY = originalKey;
  }
});
