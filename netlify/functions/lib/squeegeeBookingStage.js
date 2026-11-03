"use strict";

const { getServices, getJobGroups } = require("./squeegeeApiV3");
const { prepareReadOnlyBooking } = require("./squeegeeBookingPreparation");
const { normalizedPostcode } = require("./squeegeeBookingPlan");
const { validateBookingSubmission } = require("./bookingSubmissionGuard");

const PREVIEW_URL = "https://deploy-preview-77--nibinguy.netlify.app";
const STORE_NAME = "squeegee-preview1-booking-readonly";
let getStore = null;
try {
  ({ getStore } = require("@netlify/blobs"));
} catch {
  // Integration must never affect the existing booking confirmation.
}

function isPreview1ApiConfigured(env = process.env) {
  // This variable has a value exclusively on the Netlify Preview 1 branch.
  // Production and Preview 2 never have access to this key.
  return Boolean(env.SQUEEGEE_API_KEY && env.SQUEEGEE_API_KEY.trim()) &&
    env.SQUEEGEE_WRITE_ENABLED !== "true";
}

async function fetchAuthoritativeSchedule(payload, fetchImpl = fetch, { timeoutMs = 8500 } = {}) {
  const bins = (Array.isArray(payload?.bins) ? payload.bins : []).filter(bin => bin?.type);
  if (!normalizedPostcode(payload?.address) || !bins.length) return null;

  // Fixed, known Preview 1 hostname prevents SSRF from user-supplied headers.
  const controller = new AbortController();
  const boundedTimeout=Number.isFinite(timeoutMs)?
    Math.max(1000,Math.min(20000,Number(timeoutMs))):8500;
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  try {
    const response = await fetchImpl(PREVIEW_URL + "/api/booking-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: String(payload.address || ""),
        postcode: normalizedPostcode(payload.address),
        bins: bins.map(bin => ({ type: bin.type })),
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function saveSummary(bookingId, value) {
  if (!getStore) return { saved: false, reason: "blobs_unavailable" };
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  const options = { name: STORE_NAME, consistency: "strong" };
  if (siteID && token) { options.siteID = siteID; options.token = token; }
  const store = getStore(options);
  // This store is a read-only preview audit, NOT an atomic idempotency ledger.
  // No personal names, addresses, emails or customer IDs are retained.
  await store.setJSON(String(bookingId), value);
  return { saved: true };
}

/**
 * Called AFTER the existing booking workflow has accepted a submission.
 * Every operation is GET/read-only against Squeegee. No Squeegee writes.
 * Failures are swallowed by the caller and cannot undo emails/leaderboard.
 */
async function stageAcceptedBooking(payload, {
  channel = "unknown",
  serverSchedule,
  services,
  jobGroups,
  fetchImpl,
  save,
  keyConfigured = isPreview1ApiConfigured(),
} = {}) {
  const metadata = validateBookingSubmission(payload);
  if (!metadata.ok) return { staged: false, reason: "invalid_booking_reference" };
  if (!keyConfigured) return { staged: false, reason: "preview_api_unavailable" };

  const [scheduleResult, servicesResult, groupResult] = await Promise.allSettled([
    serverSchedule !== undefined
      ? Promise.resolve(serverSchedule)
      : fetchAuthoritativeSchedule(payload, fetchImpl),
    services !== undefined ? Promise.resolve(services) : getServices(),
    jobGroups !== undefined ? Promise.resolve(jobGroups) : getJobGroups(),
  ]);

  const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : null;
  const accountServices = servicesResult.status === "fulfilled" ? servicesResult.value : [];
  const accountGroups = groupResult.status === "fulfilled" ? groupResult.value : [];
  let prepared;
  try {
    prepared = prepareReadOnlyBooking(payload, schedule, accountServices, {
      jobGroups: accountGroups,
    });
  } catch {
    return { staged: false, reason: "preparation_failed" };
  }
  const summary = {
    ...prepared.summary,
    mode: "read_only",
    channel,
    status: prepared.status,
    observedAt: new Date().toISOString(),
    customerMatch: "not_yet_reconciled",
  };
  try {
    const persisted = await (save || saveSummary)(metadata.bookingId, summary);
    return {
      staged: Boolean(persisted?.saved),
      reason: persisted?.saved ? undefined : "staging_unavailable",
      status: summary.status,
      blockedReasons: summary.blockedReasons,
    };
  } catch {
    return { staged: false, reason: "staging_unavailable" };
  }
}

/**
 * Prefer waiting beyond HTTP response with Netlify's waitUntil when available.
 * Fallback is a bounded best-effort wait. Never delay the booking confirmation
 * for a slow council lookup or Squeegee API response.
 */
async function stageWithoutBlockingBooking(payload, options) {
  const task = Promise.resolve().then(() => stageAcceptedBooking(payload, options));
  try {
    const { getContext } = require("@netlify/functions");
    const context = getContext();
    if (typeof context?.waitUntil === "function") {
      context.waitUntil(task);
      return;
    }
  } catch {
    // Legacy Netlify handler or local test; use the bounded fallback.
  }
  let timer;
  try {
    await Promise.race([
      task,
      new Promise(resolve => { timer = setTimeout(resolve, 900); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isPreview1ApiConfigured,
  fetchAuthoritativeSchedule,
  stageAcceptedBooking,
  stageWithoutBlockingBooking,
};
