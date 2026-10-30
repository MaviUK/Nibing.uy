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

const catalog = require("../netlify/functions/lib/squeegeeServiceCatalog");
const ONEOFF_SERVICE = "33333333-3333-4333-8333-333333333333";

const mappings = () => ({
  serviceIds: {
    domestic_4w: { black: SERVICE },
    domestic_oneoff: { blue: ONEOFF_SERVICE },
  },
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
  assert.deepEqual(result.jobs[0].input.services, [SERVICE]);
  assert.equal(result.jobs[0].input.price, 10);
  assert.equal(result.jobs[0].input.jobGroup, GROUP);
  assert.equal(result.jobs[1].input.date, "2026-11-06");
  assert.equal(result.jobs[1].input.frequencyType, "adhoc");
  assert.deepEqual(result.jobs[1].input.services, [ONEOFF_SERVICE]);
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

test("Squeegee regular and one-off services resolve by exact account labels", () => {
  const resolved = catalog.resolveSqueegeeServiceIds([
    { id: SERVICE, description: "Black" },
    { id: ONEOFF_SERVICE, description: "(One Off) Blue" },
  ]);
  assert.equal(resolved.serviceIds.domestic_4w.black, SERVICE);
  assert.equal(resolved.serviceIds.domestic_oneoff.blue, ONEOFF_SERVICE);
  assert.equal(resolved.serviceIds.domestic_4w.blue, undefined);
  assert.equal(resolved.unresolved.length, 6);
  const result = plan.buildSqueegeeBookingPlan(booking(), verifiedSchedule(), {
    ...mappings(), serviceIds: resolved.serviceIds,
  });
  assert.equal(result.readyJobs, 2);
});

test("never reuse a regular-clean service for a one-off without its exact mapping", () => {
  const config = mappings();
  delete config.serviceIds.domestic_oneoff;
  const result = plan.buildSqueegeeBookingPlan(booking(), verifiedSchedule(), config);
  assert.equal(result.jobs[0].status, "ready");
  assert.equal(result.jobs[1].status, "service_mapping_required");
});

test("commercial bookings stay blocked until commercial service mapping is approved", () => {
  const b = booking();
  b.bins[0].planId = "comm_gt660_4w";
  b.pricing.lines[0].planId = "comm_gt660_4w";
  const result = plan.buildSqueegeeBookingPlan(b, verifiedSchedule(), mappings());
  assert.equal(result.jobs[0].status, "service_mapping_required");
});

const matcher = require("../netlify/functions/lib/squeegeeCustomerMatcher");

test("matches an existing Squeegee customer by full postcode, property and email", () => {
  const b = booking();
  const customers = [{
    _id: SERVICE,
    name: "Example Customer",
    address: { text: "17 Example Street, Bangor BT20 4AA" },
    email: "EXAMPLE@EXAMPLE.ORG",
    phoneNumber: "+447000000000",
    _externalId: null,
    jobs: [],
  }];
  const found = matcher.matchCustomers(b, customers);
  assert.equal(found.status, "matched");
  assert.equal(found.customerId, SERVICE);
});

test("same address but different contact is held for review rather than creating a duplicate", () => {
  const b = booking();
  const customers = [{
    _id: SERVICE,
    name: "Other Resident",
    address: "17 Example Street, Bangor BT20 4AA",
    email: "other@example.org",
    phoneNumber: "07111111111",
  }];
  const found = matcher.matchCustomers(b, customers);
  assert.equal(found.status, "needs_review");
  assert.equal(found.reason, "same_address_without_contact_match");
});

test("partial address match blocks auto-creation on possible existing customer", () => {
  const b=booking();
  const customers=[{
    _id:SERVICE, name:"Example Customer",
    address:"17 Example Rd, Bangor BT20 4AA",
    email:"example@example.org",
  }];
  const found=matcher.matchCustomers(b,customers);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"possible_existing_address");
});

test("duplicate matching customer rows are never silently selected", () => {
  const b=booking();
  const one={_id:SERVICE,name:"Example Customer",address:b.address,email:b.email};
  const two={...one,_id:ONEOFF_SERVICE};
  assert.equal(matcher.matchCustomers(b,[one,two]).status,"needs_review");
});

test("external customer reference matches consistently without customer PII in reference", () => {
  const b=booking();
  const ref=plan.externalCustomerReference(b);
  const item={_id:SERVICE,_externalId:ref,address:b.address,email:b.email};
  const found=matcher.matchCustomers(b,[item]);
  assert.equal(found.status,"matched");
  assert.equal(found.reason,"external_reference");
});

test("matches Squeegee's real addressDescription address shape", () => {
  const b=booking();
  const row={
    _id:SERVICE,
    email:b.email,
    phoneNumber:b.phone,
    address:{addressDescription:"17 Example Street, Bangor, BT20 4AA",lngLat:null},
  };
  assert.equal(matcher.matchCustomers(b,[row]).status,"matched");
});

test("checks every customer page before selecting an existing customer", async () => {
  const b=booking();
  const pages=[];
  const matched=await matcher.matchCustomersAcrossPages(b,async ({page,pagedRequestId})=>{
    pages.push({page,pagedRequestId});
    if(page===1) return {customers:[],hasMore:true,pagedRequestId:"test-snapshot"};
    return {
      customers:[{_id:SERVICE,email:b.email,address:{addressDescription:b.address}}],
      hasMore:false,page:2,
    };
  });
  assert.equal(matched.status,"matched");
  assert.equal(matched.customerId,SERVICE);
  assert.equal(matched.pagesScanned,2);
  assert.deepEqual(pages,[{page:1,pagedRequestId:undefined},{page:2,pagedRequestId:"test-snapshot"}]);
});

test("fails closed if customer listing is truncated, rather than creating a duplicate", async()=>{
  const b=booking();
  const found=await matcher.matchCustomersAcrossPages(b,async({page})=>({
    customers:[],hasMore:true,page,
  }),{maxPages:2});
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"customer_pagination_limit");
});

test("one-page no-match returns not_found only after hasMore false", async()=>{
  const result=await matcher.matchCustomersAcrossPages(booking(),async()=>({
    customers:[],hasMore:false,page:1,
  }));
  assert.equal(result.status,"not_found");
  assert.equal(result.pagesScanned,1);
});
