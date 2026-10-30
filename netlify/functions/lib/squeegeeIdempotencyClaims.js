"use strict";

/**
 * Fail-closed job/customer claims for future authorised Squeegee writes.
 *
 * Netlify Blobs' onlyIfNew is an atomic single-key create operation; use
 * onlyIfMatch with a real ETag to change state. This is NOT a multi-row
 * transaction. Each independent job gets a permanent immutable claim key.
 *
 * Never repeat an ambiguous Squeegee POST after a timeout; a claimed record
 * always requires manual reconciliation before a separate override.
 *
 * This module is not connected to any Squeegee POSTs. Writes remain disabled.
 */
const crypto = require("node:crypto");
const { normalizedPostcode, normalizedBinType, validDate } = require("./squeegeeBookingPlan");

const STORE_NAME = "squeegee-preview1-write-claims";
const PREFIX = "claim-v1";
const BOOKING_RE = /^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i;
function digest(parts) {
  return crypto.createHash("sha256").update(
    parts.map(part => String(part || "").toUpperCase().trim().replace(/\s+/g, " ")).join("\u001f")
  ).digest("hex");
}
function customerKey(input) {
  const address = String(input?.address || "").trim();
  const postcode = normalizedPostcode(address);
  if (!postcode || !address) throw new Error("Missing customer property identity");
  // Claim per property, not per email: two submissions at the same address
  // with different contact details must not concurrently create customers.
  // Hash includes full normalized address to keep distinct flats separate.
  const normalized = address.toUpperCase()
    .replace(new RegExp(postcode.replace(/\s/g, "").slice(0,-3) + "\\s*" +
      postcode.slice(-3), "gi"), " ")
    .replace(/\bRD\b/g, "ROAD").replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\bUNITED KINGDOM\b/g, "").replace(/\bNORTHERN IRELAND\b/g, "")
    .replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  if (normalized.length < 5) throw new Error("Incomplete property identity");
  return PREFIX + "/customers/" + digest([postcode, normalized]);
}
function jobKey(booking, job) {
  const customer = customerKey(booking);
  const planId = String(job?.planId || "").trim();
  const bin = normalizedBinType(job?.type);
  const date = String(job?.date || "");
  if (!planId || !["black", "brown", "green", "blue"].includes(bin) || !validDate(date)) {
    throw new Error("Missing verified job identity");
  }
  // Ignore bookingId and quantity deliberately: a repeated submission,
  // even with a newly generated bookingId, should hold the same property /
  // bin / service / clean date for manual review instead of double-booking.
  return PREFIX + "/jobs/" + digest([customer, planId, bin, date]);
}
function validEtag(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getClaimsStore() {
  const { getStore } = require("@netlify/blobs");
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  const options = { name: STORE_NAME, consistency: "strong" };
  if (siteID && token) { options.siteID = siteID; options.token = token; }
  return getStore(options);
}
function validateBookingId(bookingId) {
  if (!BOOKING_RE.test(String(bookingId || ""))) throw new Error("Invalid bookingId");
}

/**
 * Claim exactly once before ANY Squeegee POST. Never treat missing ETag as
 * success: some SDK versions can report modified=true with etag empty when
 * a conditional request actually failed.
 */
async function claimOnce({ key, bookingId, channel, store = null }) {
  validateBookingId(bookingId);
  if (!key.startsWith(PREFIX + "/")) throw new Error("Invalid claim key");
  const record = {
    bookingId, channel: String(channel || "unknown"),
    state: "reserved", createdAt: new Date().toISOString(),
    // Do not write name, email, address or phone in claim metadata.
  };
  try {
    const safeStore = store || getClaimsStore();
    const response = await safeStore.setJSON(key, record, { onlyIfNew: true });
    if (response?.modified === true && validEtag(response.etag)) {
      return { acquired: true, key, etag: response.etag };
    }
    // Can be a duplicate or a failed conditional write; both must block.
    return { acquired: false, reason: "already_claimed_or_uncertain" };
  } catch {
    return { acquired: false, reason: "claim_failed" };
  }
}

/** CAS state change. A conflicting writer can never be silently overwritten. */
async function changeClaimState({
  key, etag, bookingId, state, store = null,
}) {
  validateBookingId(bookingId);
  if (!key.startsWith(PREFIX + "/") || !validEtag(etag)) {
    return { changed: false, reason: "invalid_claim_version" };
  }
  if (!["request_in_progress", "succeeded", "requires_reconciliation"].includes(state)) {
    return { changed: false, reason: "invalid_state" };
  }
  try {
    const safeStore = store || getClaimsStore();
    const response = await safeStore.setJSON(key, {
      bookingId, state, updatedAt: new Date().toISOString(),
    }, { onlyIfMatch: etag });
    if (response?.modified === true && validEtag(response.etag)) {
      return { changed: true, etag: response.etag };
    }
    return { changed: false, reason: "conflict_or_uncertain_update" };
  } catch {
    return { changed: false, reason: "claim_update_failed" };
  }
}

/**
 * Consumer contract:
 * 1. claimOnce -> acquired & valid etag
 * 2. changeClaimState(request_in_progress) -> changed & NEW etag
 * 3. Send Squeegee POST at most once
 * 4. On success: changeClaimState(succeeded), else requires_reconciliation.
 * If 2 fails: never POST. If 3 times out: never POST again automatically.
 */
module.exports = {
  customerKey, jobKey, claimOnce, changeClaimState, validEtag,
};
