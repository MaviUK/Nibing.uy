const MAX_SUBMISSION_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const BOOKING_ID_RE = /^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;

let getStoreSafe = null;
try {
  const { getStore } = require("@netlify/blobs");
  getStoreSafe = function (name) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    const options = { name, consistency: "strong" };
    if (siteID && token) {
      options.siteID = siteID;
      options.token = token;
    }
    return getStore(options);
  };
} catch (_) {
  // Netlify Blobs is expected in production. Freshness validation still works if unavailable.
}

function validateBookingSubmission(payload, { now = Date.now() } = {}) {
  const bookingId = String(payload?.bookingId || "").trim();
  const submittedAt = String(payload?.submittedAt || "").trim();
  const submittedMs = Date.parse(submittedAt);
  const receivedMs = Number(now);
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

async function claimBookingSubmission({ bookingId, submittedAt, serverReceivedAt, channel }, { store } = {}) {
  // An unavailable replay guard must NEVER fail open. Every accepted
  // submission needs one atomic reservation before emails, XP or Squeegee.
  if (!store && !getStoreSafe) {
    console.error("Booking replay guard module unavailable");
    return { ok: false, reason: "booking_guard_not_ready", retryable: true };
  }
  try {
    const handle = store || getStoreSafe("booking-submission-ids");
    const claimed = await handle.setJSON(bookingId, {
      bookingId,
      submittedAt,
      serverReceivedAt,
      channel: channel || "unknown",
      claimedAt: new Date().toISOString(),
    }, { onlyIfNew: true });
    if (claimed?.modified === false)
      return { ok: false, duplicate: true, reason: "duplicate_submission" };
    if (claimed?.modified !== true || !claimed.etag)
      return { ok: false, reason: "booking_reservation_uncertain" };
    return { ok: true, etag: claimed.etag };
  } catch (error) {
    // A timeout or uncertain Blob response might occur AFTER a reservation
    // was written. Never permit another POST with this booking reference.
    console.error("Booking reservation result uncertain:", error?.name || "storage_error");
    return { ok: false, reason: "booking_reservation_uncertain" };
  }
}

function submissionErrorResponse(submission) {
  const reason = submission?.reason ||
    (submission?.duplicate ? "duplicate_submission" : "invalid_submission");
  const notReady = reason === "booking_guard_not_ready";
  const uncertain = reason === "booking_reservation_uncertain";
  return {
    statusCode: notReady || uncertain ? 503 : 409,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      error: notReady
        ? "Booking security storage is temporarily unavailable. Nothing was submitted."
        : uncertain
          ? "The booking reservation may have succeeded. Do not submit again until it is checked."
          : "This booking submission is no longer valid. Check your existing booking reference before trying again.",
      reason,
      bookingId: submission?.bookingId || null,
      safeToRetry: notReady,
    }),
  };
}

module.exports = {
  validateBookingSubmission,
  claimBookingSubmission,
  submissionErrorResponse,
};
