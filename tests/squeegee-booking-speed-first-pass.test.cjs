"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const { getBundledLogoBytes, buildTermsAcceptancePdfAttachment } =
  require("../netlify/functions/lib/termsPdf");

function edgeHandler(filename, fakeFetch) {
  const code = read("netlify/functions/" + filename)
    .replace("export default async function handler(req)", "async function handler(req)");
  assert.doesNotMatch(code, /\bexport\s+default/);
  return new Function("fetch", "Response", "URL", code + "\nreturn handler;")(
    fakeFetch, Response, URL);
}

test("postcodes: only successful public council responses are cached by the durable CDN", async () => {
  let requests = 0;
  const handler = edgeHandler("binAddresses.js", async () => {
    requests++;
    return { ok: true, json: async () => ({
      addresses: [{ uprn: "12345", addressText: "12 Example Road, Bangor BT20 4AA" }],
    }) };
  });
  const res = await handler({
    url: "https://deploy-preview-77--nibinguy.netlify.app/.netlify/functions/binAddresses?postcode=BT20%204AA",
  });
  assert.equal(res.status, 200);
  assert.equal(requests, 1);
  assert.match(res.headers.get("Netlify-CDN-Cache-Control"), /durable, max-age=21600/);
  assert.match(res.headers.get("Cache-Control"), /max-age=0/);
  const broken = edgeHandler("binAddresses.js", async () => { throw new Error("down"); });
  const bad = await broken({
    url: "https://deploy-preview-77--nibinguy.netlify.app/.netlify/functions/binAddresses?postcode=BT20%204AA",
  });
  assert.equal(bad.status, 500);
  assert.equal(bad.headers.get("Netlify-CDN-Cache-Control"), null);
});

test("collection dates: successful UPRN calendars cache for ten minutes, not errors", async () => {
  const handler = edgeHandler("binCalendar.js", async () => ({
    ok: true,
    text: async () => JSON.stringify({ calendarHTML: "<p>Next collection: 10 Nov 2026</p>" }),
  }));
  const req = {
    url: "https://deploy-preview-77--nibinguy.netlify.app/.netlify/functions/binCalendar?uprn=12345",
  };
  const res = await handler(req);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Netlify-CDN-Cache-Control"), /durable, max-age=600, stale-while-revalidate=60/);
  assert.match((await res.json()).html, /10 Nov 2026/);
  const fail = edgeHandler("binCalendar.js", async () => ({ ok: false, status: 503 }));
  const bad = await fail(req);
  assert.equal(bad.status, 502);
  assert.equal(bad.headers.get("Netlify-CDN-Cache-Control"), null);
  assert.doesNotMatch(read("netlify/functions/bookingSchedule.js"), /Netlify-CDN-Cache-Control/);
});

test("signed PDF uses bundled original logo, even when outbound HTTP is unavailable", async () => {
  const bytes = getBundledLogoBytes();
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const priorFetch = global.fetch;
  try {
    global.fetch = async () => { throw new Error("network must never be used for PDF logo"); };
    const cert = await buildTermsAcceptancePdfAttachment({
      name: "Offline Terms Test", email: "test@example.org", phone: "02890000000",
      address: "1 Test Road BT20 4AA", binsText: "1 x Black Bin",
      pricingText: "GBP 5", termsAccepted: true, termsVersion: "September 2026",
      termsTimestamp: "2026-11-03T12:00:00Z",
    });
    const pdf = await PDFDocument.load(Buffer.from(cert.content, "base64"));
    assert.ok(pdf.getPageCount() >= 1);
    assert.equal(cert.contentType, "application/pdf");
  } finally {
    global.fetch = priorFetch;
  }
  const config = read("netlify.toml");
  for (const name of ["sendBookingEmail", "sendStreetBookingEmail",
    "sendStreetBookingEmailV2", "sendAutomaticBookingConfirmation", "sendTosReceipt"]) {
    assert.match(config, new RegExp("\\[functions\\." + name + "\\]\\s+included_files = \\[\\"public/logo\\.png\\"\\]"));
  }
  assert.doesNotMatch(read("netlify/functions/lib/termsPdf.js"), /fetch\("https:\/\/nibing\.uy\/logo\.png"/);
});

test("booking server exposes independent, privacy-safe timing of major stages", () => {
  const booking = read("netlify/functions/sendBookingEmail.js");
  for (const stage of ["security", "pdf", "ownerPdfStore", "claim",
    "receiptsAndAudit", "leaderboard", "readOnlyStage", "squeegeeQueue"]) {
    assert.match(booking, new RegExp('timed\\("' + stage + '"'));
  }
  assert.match(booking, /"Server-Timing": serverTiming/);
  assert.match(booking, /Booking stage timings \(ms\)/);
  assert.doesNotMatch(booking, /Booking stage timings \(ms\).*bookingId:/);
});
