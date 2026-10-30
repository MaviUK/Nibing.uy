/*
 * Preview 1 only. Lets an EXISTING customer recover the arcade invitation
 * without making another booking. Sends a one-time email code to the address
 * of a previously received booking. No public display or prize consent occurs
 * until the customer explicitly joins the leaderboard.
 */
const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const { Resend } = require("resend");
const { signBooking, verifyBooking } = require("./lib/arcadeBookingProof");

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const reply = (statusCode, data) => ({
  statusCode, headers: HEADERS, body: JSON.stringify(data),
});
const SECRET = process.env.N64_PREVIEW_LEADERBOARD_SECRET || "";
const VERIFY_TTL = 10 * 60 * 1000;
const BOOKING_WINDOW = 14 * 24 * 60 * 60 * 1000;
const RESEND_WAIT = 90 * 1000;
const requestsByIp = new Map();

function getSafeStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  return siteID && token ? getStore({ name, siteID, token, consistency: "strong" })
    : getStore({ name, consistency: "strong" });
}
function emailKey(email) {
  return crypto.createHmac("sha256", SECRET).update(email).digest("hex");
}
function normalizeEmail(value) {
  const email = String(value || "").toLowerCase().trim();
  return /^[^\s@<>]{1,100}@[^\s@<>]{1,160}\.[a-z]{2,}$/i.test(email) && email.length <= 254
    ? email : "";
}
function codeHash(email, code) {
  return crypto.createHmac("sha256", SECRET)
    .update("claim:" + email + ":" + code).digest("hex");
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function allowIp(event) {
  const ip = String(event.headers?.["x-nf-client-connection-ip"]
    || event.headers?.["x-forwarded-for"] || "unknown").split(",")[0].slice(0, 100);
  const key = emailKey(ip);
  const now = Date.now();
  for (const [k, v] of requestsByIp) if (v.expires <= now) requestsByIp.delete(k);
  const current = requestsByIp.get(key) || { count: 0, expires: now + 60000 };
  current.count++;
  requestsByIp.set(key, current);
  return current.count <= 14;
}

async function findRecentBooking(email) {
  const auditStore = getSafeStore("tos-confirmations");
  // Existing successful email booking calls already leave a terms/audit
  // record keyed by UTC date and the customer's booking email.
  const safeEmail = email.replace(/[^a-z0-9@.+_-]/gi, "_").toLowerCase();
  for (let day = 0; day < 14; day++) {
    const dayDate = new Date(Date.now() - day * 86400000).toISOString().slice(0, 10);
    const listing = await auditStore.list({ prefix: dayDate });
    const keys = (listing?.blobs || []).map(x => x.key)
      .filter(key => key.toLowerCase().endsWith("__" + safeEmail + ".json"))
      .slice(-15).reverse();
    for (const key of keys) {
      const data = await auditStore.get(key, { type: "json" });
      const time = Date.parse(data?.createdAt || "");
      if (data?.termsAccepted === true &&
          normalizeEmail(data?.email) === email &&
          Number.isFinite(time) && Date.now() - time >= 0 &&
          Date.now() - time <= BOOKING_WINDOW &&
          Array.isArray(data.bins) && data.bins.some(b => b?.type && Number(b.count) > 0) &&
          typeof data.name === "string" && data.name.trim()) {
        return { source: "email", key };
      }
    }
  }

  // WhatsApp bookings are stored separately once the email-confirmation job
  // completes. Only confirmed bookings with a valid signed proof are eligible.
  const statusStore = getSafeStore("booking-submission-status");
  const list = await statusStore.list({ prefix: "NBG-" });
  const keys = (list?.blobs || []).map(item => item.key).slice(-1000).reverse();
  for (const key of keys) {
    const status = await statusStore.get(key, { type: "json" });
    if (status?.status !== "confirmed") continue;
    const time = Date.parse(status.updatedAt || "");
    if (!Number.isFinite(time) || Date.now() - time > BOOKING_WINDOW) continue;
    const booking = verifyBooking(status.arcadeBookingProof);
    if (booking && normalizeEmail(booking.email) === email) {
      return { source: "whatsapp", key };
    }
  }
  return null;
}

async function proofForBooking(reference, email) {
  if (!reference?.key) return null;
  if (reference.source === "email") {
    const audit = await getSafeStore("tos-confirmations").get(reference.key, { type: "json" });
    if (normalizeEmail(audit?.email) !== email || audit?.termsAccepted !== true) return null;
    const created = Date.parse(audit.createdAt || "");
    if (!Number.isFinite(created) || Date.now() - created > BOOKING_WINDOW) return null;
    const bookingId = "AUDIT-" + crypto.createHash("sha256").update(reference.key).digest("hex").slice(0, 32);
    return signBooking({
      bookingId, name: audit.name, email: audit.email,
      phone: audit.phone, address: audit.address, bins: audit.bins,
    });
  }
  if (reference.source === "whatsapp") {
    const row = await getSafeStore("booking-submission-status")
      .get(reference.key, { type: "json" });
    if (row?.status !== "confirmed") return null;
    const booking = verifyBooking(row.arcadeBookingProof);
    if (!booking || normalizeEmail(booking.email) !== email) return null;
    return signBooking(booking);
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });
  if (!SECRET || !process.env.RESEND_API_KEY) return reply(503, { error: "Booking verification unavailable" });
  if (typeof event.body !== "string" || event.body.length > 1500 || !allowIp(event)) {
    return reply(429, { error: "Too many requests. Try again later." });
  }
  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: "Invalid request" }); }
  const email = normalizeEmail(body?.email);
  if (!email) return reply(400, { error: "Enter a valid booking email address" });
  const claims = getSafeStore("n64-preview-prize-claim-v1");
  const key = "verify:" + emailKey(email);

  try {
    if (body.action === "request") {
      const old = await claims.get(key, { type: "json" });
      if (old?.sentAt && Date.now() - old.sentAt < RESEND_WAIT) {
        return reply(200, { success: true, message: "If we found your booking, check your email for a six-digit code." });
      }
      const match = await findRecentBooking(email);
      if (match) {
        const code = String(crypto.randomInt(100000, 1000000));
        const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: process.env.RESEND_FROM || "NI Bin Guy <noreply@nibing.uy>",
          to: email,
          subject: "NI Bin Guy — verify your leaderboard entry",
          text: "Your one-time leaderboard verification code is " + code +
            ".\n\nThis code expires in 10 minutes. Only enter it at your NI Bin Guy booking preview." +
            "\n\nIf you didn't request this, you can ignore this email.",
        });
        if (result?.error) {
          console.warn("Prize-code email could not be sent");
          return reply(503, { error: "Verification email unavailable right now" });
        }
        await claims.setJSON(key, {
          hash: codeHash(email, code),
          expires: Date.now() + VERIFY_TTL,
          sentAt: Date.now(),
          attempts: 0,
          booking: match,
        });
      }
      return reply(200, {
        success: true,
        message: "If we found your recent booking, a six-digit code has been emailed to you.",
      });
    }

    if (body.action === "confirm") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return reply(400, { error: "Enter the six-digit code" });
      const stored = await claims.get(key, { type: "json" });
      if (!stored || !stored.expires || stored.expires <= Date.now() ||
          stored.attempts >= 5) {
        return reply(400, { error: "Code expired or invalid. Request another code." });
      }
      if (!safeEqual(stored.hash, codeHash(email, code))) {
        await claims.setJSON(key, { ...stored, attempts: (stored.attempts || 0) + 1 });
        return reply(400, { error: "Incorrect code. Please try again." });
      }
      const signedProof = await proofForBooking(stored.booking, email);
      if (!signedProof) {
        return reply(400, { error: "Unable to verify a recent confirmed booking." });
      }
      await claims.delete(key);
      return reply(200, { success: true, bookingProof: signedProof });
    }
    return reply(400, { error: "Unknown verification action" });
  } catch (error) {
    // Never log the address, email, code, token or private booking details.
    console.warn("Prize booking claim temporarily unavailable:", error?.name || "error");
    return reply(503, { error: "Booking verification temporarily unavailable" });
  }
};
