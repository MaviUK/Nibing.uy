"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareReadOnlyBooking } = require("../netlify/functions/lib/squeegeeBookingPreparation");
const { stageAcceptedBooking, isPreview1ApiConfigured, fetchAuthoritativeSchedule } =
  require("../netlify/functions/lib/squeegeeBookingStage");

const BLACK_SERVICE = "11111111-1111-4111-8111-111111111111";
const BLUE_ONEOFF_SERVICE = "22222222-2222-4222-8222-222222222222";
const SERVICES = [
  { id: BLACK_SERVICE, description: "Black" },
  { id: BLUE_ONEOFF_SERVICE, description: "(One Off) Blue" },
];

function booking() {
  return {
    bookingId: "NBG-ABC123-ABCDEFGH",
    submittedAt: new Date().toISOString(),
    name: "Example Customer",
    email: "example@example.org",
    phone: "07000000000",
    address: "17 Example Street, Bangor, BT20 4AA",
    bins: [
      { type: "Black Bin", count: 2, planId: "domestic_4w" },
      { type: "Blue Bin", count: 1, planId: "domestic_oneoff" },
    ],
    pricing: {
      lines: [
        { idx: 0, type: "Black Bin", count: 2, planId: "domestic_4w", baseUnit: 5,
          unitPrice: 5, lineTotal: 10, freeCount: 0, multiBuyDiscount: 0, discounted: false },
        { idx: 1, type: "Blue Bin", count: 1, planId: "domestic_oneoff", baseUnit: 15,
          unitPrice: 15, lineTotal: 15, freeCount: 0, multiBuyDiscount: 0, discounted: false },
      ],
      subtotal: 25, total: 25, multiBuyDiscount: 0, multiBuyFreeBins: 0,
    },
    bookingScheduleSnapshot: {
      version: 1, postcode: "BT20 4AA", matched: true,
      results: [
        { type: "Black Bin", automatic: true, assignedCleanDate: "2026-11-02" },
        { type: "Blue Bin", automatic: true, assignedCleanDate: "2026-11-05" },
      ],
    },
  };
}
function serverSchedule() {
  return {
    postcode: "BT20 4AA", town: "BANGOR", matched: true,
    results: [
      { bin: "Black Bin", town: "BANGOR", automatic: true, assignedCleanDate: "2026-11-02" },
      { bin: "Blue Bin", town: "BANGOR", automatic: true, assignedCleanDate: "2026-11-05" },
    ],
  };
}

test("combines verified price, exact dates and correct one-off/four-weekly services", () => {
  const result = prepareReadOnlyBooking(booking(), serverSchedule(), SERVICES);
  assert.equal(result.summary.pricingVerified, true);
  assert.equal(result.summary.datesVerified, true);
  assert.equal(result.summary.jobCount, 2);
  assert.equal(result.summary.approvedToWrite, false);
  assert.equal(result.privatePlan.jobs[0].input.price, 10);
  assert.equal(result.privatePlan.jobs[0].input.date, "2026-11-02");
  assert.equal(result.privatePlan.jobs[0].input.frequencyInterval, 4);
  assert.equal(result.privatePlan.jobs[0].input.services[0], BLACK_SERVICE);
  assert.equal(result.privatePlan.jobs[1].input.frequencyType, "adhoc");
  assert.equal(result.privatePlan.jobs[1].input.services[0], BLUE_ONEOFF_SERVICE);
  assert.equal(result.summary.needsJobGroupMapping, true);
  assert.equal(result.status, "held_for_review");
});

test("client price changes block all Squeegee price calculations", () => {
  const b = booking();
  b.pricing.lines[0].lineTotal = 1;
  const result = prepareReadOnlyBooking(b, serverSchedule(), SERVICES);
  assert.equal(result.summary.pricingVerified, false);
  assert.equal(result.privatePlan, null);
  assert.equal(result.summary.jobCount, 0);
  assert.ok(result.summary.blockedReasons.includes("client_price_mismatch"));
});

test("date discrepancy keeps only the affected job held for review", () => {
  const b = booking();
  b.bookingScheduleSnapshot.results[0].assignedCleanDate = "2026-11-03";
  const result = prepareReadOnlyBooking(b, serverSchedule(), SERVICES);
  assert.equal(result.summary.datesVerified, false);
  assert.equal(result.privatePlan.jobs[0].status, "date_to_confirm");
  assert.equal(result.privatePlan.jobs[0].date, null);
  assert.equal(result.privatePlan.jobs[1].input.date, "2026-11-05");
});

test("does not prepare a job for unmapped commercial plan", () => {
  const b = booking();
  b.bins[0].planId = "comm_gt660_4w";
  b.pricing.lines[0].planId = "comm_gt660_4w";
  b.pricing.lines[0].baseUnit = 12.5;
  b.pricing.lines[0].unitPrice = 12.5;
  b.pricing.lines[0].lineTotal = 25;
  b.pricing.subtotal = 40;
  b.pricing.total = 40;
  const result = prepareReadOnlyBooking(b, serverSchedule(), SERVICES);
  assert.equal(result.summary.pricingVerified, true);
  assert.equal(result.privatePlan.jobs[0].status, "service_mapping_required");
});

test("staging an accepted booking never retains any customer PII in its private summary", async () => {
  let stored = null;
  const result = await stageAcceptedBooking(booking(), {
    keyConfigured: true,
    serverSchedule: serverSchedule(),
    services: SERVICES,
    channel: "email",
    save: async (bookingId, summary) => {
      assert.equal(bookingId, "NBG-ABC123-ABCDEFGH");
      stored = summary;
      return { saved: true };
    },
  });
  assert.equal(result.staged, true);
  assert.equal(result.status, "held_for_review");
  assert.equal(stored.channel, "email");
  assert.equal(stored.readOnly, true);
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes("example@example.org"), false);
  assert.equal(serialized.includes("17 Example Street"), false);
  assert.equal(serialized.includes("07000000000"), false);
  assert.equal(serialized.includes(BLACK_SERVICE), false);
});

test("when key is absent, Squeegee staging cannot run", async () => {
  assert.equal(isPreview1ApiConfigured({}), false);
  assert.equal(isPreview1ApiConfigured({
    SQUEEGEE_API_KEY: "fake", SQUEEGEE_WRITE_ENABLED: "true",
  }), false);
  const result = await stageAcceptedBooking(booking(), {
    keyConfigured: false, save: () => { throw new Error("must not save"); },
  });
  assert.equal(result.staged, false);
});

test("server schedule retrieval never uses an address-supplied host", async () => {
  const input = booking();
  input.address = "17 Example Street, Bangor BT20 4AA, https://evil.example";
  let url = "";
  const result = await fetchAuthoritativeSchedule(input, async (incomingUrl, options) => {
    url = incomingUrl;
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => serverSchedule() };
  });
  assert.equal(result.town, "BANGOR");
  assert.equal(url,
    "https://deploy-preview-77--nibinguy.netlify.app/api/booking-schedule");
});

test("bad booking references cannot stage records", async () => {
  const b = booking();
  b.bookingId = "invalid";
  const result = await stageAcceptedBooking(b, { keyConfigured: true, services: SERVICES });
  assert.equal(result.staged, false);
  assert.equal(result.reason, "invalid_booking_reference");
});
