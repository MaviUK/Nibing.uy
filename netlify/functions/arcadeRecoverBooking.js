/*
 * Preview 1 only: restore a previously confirmed booking from the random
 * reference stored in the browser's first-party XP cookie. No email address,
 * phone number or booking name ever needs to be submitted a second time.
 * Never publish opted-out bookings. Never return private contact details.
 */
const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const { verifyBooking } = require("./lib/arcadeBookingProof");
const { autoEnrollBooking } = require("./arcadeLeaderboard");

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const respond = (statusCode, result) => ({
  statusCode, headers: HEADERS, body: JSON.stringify(result),
});
const LIMIT_MS = 14 * 24 * 60 * 60 * 1000;
const buckets = new Map();

function store(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  const options = { name, consistency: "strong" };
  if (siteID && token) Object.assign(options, { siteID, token });
  return getStore(options);
}

function acceptRequest(event) {
  const ip = String(event.headers?.["x-nf-client-connection-ip"]
    || event.headers?.["x-forwarded-for"] || "unknown").split(",")[0].slice(0, 100);
  const hash = crypto.createHash("sha256").update(ip).digest("hex");
  const now = Date.now();
  for (const [key, value] of buckets) if (value.expire < now) buckets.delete(key);
  const current = buckets.get(hash) || { count: 0, expire: now + 60000 };
  current.count++;
  buckets.set(hash, current);
  return current.count <= 8;
}

function getBookingTimestamp(input) {
  const reference = String(input || "").toUpperCase().trim();
  const match = /^NBG-([A-Z0-9]{7,12})-([A-Z0-9]{8,14})$/.exec(reference);
  if (!match) return null;
  const stamped = parseInt(match[1], 36);
  if (!Number.isSafeInteger(stamped) || stamped <= 0) return null;
  const age = Date.now() - stamped;
  if (age < -5 * 60000 || age > LIMIT_MS) return null;
  return { id: reference, stamped };
}

function safeActivity(keys) {
  return Array.isArray(keys)
    ? keys.filter(value => typeof value === "string" &&
        /^(?:l:[a-z0-9-]{1,60}|a:coverage|a:bin-checker)$/.test(value)).slice(0, 20)
    : [];
}

async function readConfirmedBooking(info) {
  const status = await store("booking-submission-status")
    .get(info.id, { type: "json" });
  if (status?.status === "confirmed" && status.arcadeOptOut !== true) {
    const proof = verifyBooking(status.arcadeBookingProof);
    if (proof?.id === info.id) {
      return {
        bookingId: info.id,
        name: proof.name,
        email: proof.email,
        phone: proof.phone,
        address: proof.address,
        bins: proof.bins,
      };
    }
  }
  if (status?.arcadeOptOut === true) return null;

  const audit = store("tos-confirmations");
  const baseDate = new Date(info.stamped);
  // An email booking's audit key is its UTC timestamp followed by the email.
  // Check adjacent days to handle a submission crossing midnight.
  for (let delta = -1; delta <= 1; delta++) {
    const date = new Date(baseDate.getTime() + delta * 86400000)
      .toISOString().slice(0, 10);
    const listing = await audit.list({ prefix: date + "T" });
    const rows = listing?.blobs || [];
    // No wide scans. Search only recent booking-day records, in bounded
    // chunks; no customer information appears in logs or API responses.
    for (let i = 0; i < Math.min(rows.length, 400); i += 25) {
      const batch = await Promise.all(rows.slice(i, i + 25).map(async ({ key }) => {
        try { return await audit.get(key, { type: "json" }); }
        catch (_) { return null; }
      }));
      const matched = batch.find(row =>
        row?.bookingId?.toUpperCase() === info.id &&
        row?.termsAccepted === true &&
        row?.arcadeOptOut !== true &&
        typeof row?.name === "string" && row.name.trim() &&
        typeof row?.email === "string" && row.email.includes("@") &&
        Array.isArray(row?.bins) &&
        row.bins.some(bin => Number(bin?.count) > 0 && bin?.type)
      );
      if (matched) {
        return {
          bookingId: info.id,
          name: matched.name,
          email: matched.email,
          phone: matched.phone,
          address: matched.address,
          bins: matched.bins,
        };
      }
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });
  if (!acceptRequest(event)) return respond(429, { error: "Too many requests" });
  if (typeof event.body !== "string" || event.body.length > 5000) {
    return respond(400, { error: "Invalid recovery request" });
  }
  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, { error: "Invalid JSON" }); }
  const info = getBookingTimestamp(body?.bookingId);
  if (!info) return respond(400, { error: "Invalid or expired booking reference" });

  try {
    const booking = await readConfirmedBooking(info);
    if (!booking) return respond(404, { error: "No eligible confirmed booking found" });
    const entry = await autoEnrollBooking({
      ...booking,
      arcadeClaimed: safeActivity(body?.claimed),
    });
    if (!entry?.registered) return respond(404, { error: "Not eligible for leaderboard" });
    return respond(200, {
      success: true,
      playerToken: entry.playerToken,
      points: entry.points,
      // Never include email, phone, address, or private booking details.
    });
  } catch (error) {
    console.warn("Arcade booking recovery temporarily unavailable:", error?.name || "unknown");
    return respond(503, { error: "Leaderboard temporarily unavailable" });
  }
};
