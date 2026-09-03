const MAX_SUBMISSION_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const BOOKING_ID_RE = /^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i;

let getStoreSafe = null;
try {
  const { getStore } = require("@netlify/blobs");
  getStoreSafe = function (name) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    return siteID && token ? getStore({ name, siteID, token }) : getStore({ name });
  };
} catch (_) {
  // Netlify Blobs is expected in production. Freshness validation still works if unavailable.
}

function validateBookingSubmission(payload) {
  const bookingId = String(payload?.bookingId || "").trim();
  const submittedAt = String(payload?.submittedAt || "").trim();
  const submittedMs = Date.parse(submittedAt);
  const receivedMs = Date.now();
  const serverReceivedAt = new Date(receivedMs).toISOString();

  if (!BOOKING_ID_RE.test(bookingId)) {
    return { ok: false, reason: "missing_or_invalid_booking_id", bookingId, submittedAt, serverReceivedAt };
  }
  if (!Number.isFinite(submittedMs)) {
    return { ok: false, reason: "missing_or_invalid_submission_time", bookingId, submittedAt, serverReceivedAt };
  }
  if (receivedMs - submittedMs > MAX_SUBMISSION_AGE_MS) {
    return { ok: false, reason: "stale_submission", bookingId, submittedAt, serverReceivedAt };
  }
  if (submittedMs - receivedMs > MAX_FUTURE_SKEW_MS) {
    return { ok: false, reason: "submission_time_in_future", bookingId, submittedAt, serverReceivedAt };
  }

  return { ok: true, bookingId, submittedAt: new Date(submittedMs).toISOString(), serverReceivedAt };
}

async function claimBookingSubmission({ bookingId, submittedAt, serverReceivedAt, channel }) {
  if (!getStoreSafe) {
    console.warn("Booking replay guard unavailable: Netlify Blobs module not available");
    return { ok: true, dedupeUnavailable: true };
  }

  try {
    const store = getStoreSafe("booking-submission-ids");
    const existing = await store.get(bookingId, { type: "json" });
    if (existing) return { ok: false, duplicate: true, existing };

    await store.setJSON(bookingId, {
      bookingId,
      submittedAt,
      serverReceivedAt,
      channel: channel || "unknown",
      claimedAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (error) {
    console.warn("Booking replay guard could not use Netlify Blobs:", error.message);
    return { ok: true, dedupeUnavailable: true };
  }
}

function submissionErrorResponse(submission) {
  return {
    statusCode: 409,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      error: "This booking submission is no longer valid. Please refresh the booking form and submit again.",
      reason: submission?.reason || (submission?.duplicate ? "duplicate_submission" : "invalid_submission"),
      bookingId: submission?.bookingId || null,
    }),
  };
}

module.exports = {
  validateBookingSubmission,
  claimBookingSubmission,
  submissionErrorResponse,
};
