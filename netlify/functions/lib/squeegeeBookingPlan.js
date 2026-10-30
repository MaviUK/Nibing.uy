"use strict";

const crypto = require("node:crypto");
const { requireUuid } = require("./squeegeeApiV3");

const BOOKING_ID_RE = /^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i;
const NI_POSTCODE_RE = /\b(BT\d{1,2}\s*\d[A-Z]{2})\b/i;
const ONE_OFF_PLANS = new Set(["domestic_oneoff", "comm_lt360_oneoff", "comm_gt660_oneoff"]);
const FOUR_WEEK_PLANS = new Set(["domestic_4w", "comm_lt360_4w", "comm_gt660_4w"]);

function normalizedPostcode(text) {
  const match = String(text || "").toUpperCase().match(NI_POSTCODE_RE);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.slice(0, -3) + " " + compact.slice(-3);
}

function normalizedBinType(text) {
  return String(text || "")
    .toLowerCase().replace(/\s*bin\b/g, "").replace(/[^a-z]+/g, "");
}

function validDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function externalCustomerReference({ email, address }) {
  const post = normalizedPostcode(address);
  const mail = String(email || "").toLowerCase().trim();
  const addr = String(address || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!post || !mail || !addr) throw new Error("Customer address, postcode and email required");
  // Stable reference for repeat bookings at the same address. Never put names,
  // email addresses or postcodes directly into the external ID.
  return "NBG-WEB-" + crypto.createHash("sha256").update([mail, post, addr].join("|")).digest("hex").slice(0, 32);
}

function customerInputForBooking(booking) {
  const name = String(booking.name || "").trim();
  const email = String(booking.email || "").trim();
  const phone = String(booking.phone || "").trim();
  const address = String(booking.address || "").trim();

  if (name.length < 3 || name.length > 52) throw new Error("Squeegee requires a customer name of 3-52 characters");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Customer email is invalid");
  if (!normalizedPostcode(address)) throw new Error("Full BT postcode required for Squeegee");
  if (address.length < 5 || address.length > 100) throw new Error("Squeegee address must be 5-100 characters");

  const input = {
    name,
    email,
    phone,
    address: { text: address },
    notes: "NI Bin Guy website booking. Confirmed schedule stored against each job.",
    reference: externalCustomerReference({ email, address }),
  };
  const latitude = Number(booking.lat);
  const longitude = Number(booking.lng);
  if (booking.lat !== undefined && booking.lat !== null &&
      booking.lng !== undefined && booking.lng !== null &&
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
    input.address.coords = { lat: latitude, lng: longitude };
  }
  return input;
}

function makeJobPlan(booking, bin, index, dateRow, config) {
  const quantity = Number(bin.count);
  const type = normalizedBinType(bin.type);
  const isOneOff = ONE_OFF_PLANS.has(bin.planId);
  const isRegular = FOUR_WEEK_PLANS.has(bin.planId);
  if (!type || !Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
    return { index, bin: bin.type, status: "invalid_bin", date: null, input: null };
  }
  if (!isOneOff && !isRegular) {
    return { index, bin: bin.type, status: "invalid_plan", date: null, input: null };
  }
  if (!dateRow || normalizedBinType(dateRow.bin) !== type ||
      dateRow.automatic !== true || !validDate(dateRow.assignedCleanDate)) {
    return { index, bin: bin.type, status: "date_to_confirm", date: null, input: null };
  }

  const date = dateRow.assignedCleanDate;
  // Squeegee service and job-group IDs must come from this account's GET
  // /services and GET /job-groups, not invented or hardcoded.
  // Account-specific services differ for one-off and four-weekly cleans.
  // Never silently use a regular-clean service for a one-off or commercial.
  const serviceId = config?.serviceIds?.[bin.planId]?.[type] || null;
  if (!serviceId) return { index, bin: bin.type, status: "service_mapping_required", date, input: null };
  try { requireUuid(serviceId, "serviceId"); }
  catch (_) { return { index, bin: bin.type, status: "invalid_service_mapping", date, input: null }; }

  const priceLine = Array.isArray(booking?.pricing?.lines)
    ? booking.pricing.lines.find((line) => Number(line.idx) === index)
    : null;
  const validPrice = priceLine &&
    normalizedBinType(priceLine.type) === type &&
    priceLine.planId === bin.planId &&
    Number(priceLine.count) === quantity &&
    Number.isFinite(Number(priceLine.lineTotal)) &&
    Number(priceLine.lineTotal) >= 0 &&
    Number(priceLine.lineTotal) <= 10000;
  if (!validPrice || config?.pricesVerifiedByServer !== true) {
    return { index, bin: bin.type, status: "price_validation_required", date, input: null };
  }

  const input = {
    date,
    frequencyType: isOneOff ? "adhoc" : "weeks",
    services: [serviceId],
    notes: [
      "NI Bin Guy website booking: " + String(booking.bookingId),
      quantity + " x " + String(bin.type),
      isOneOff ? "One-off clean" : "Every 4 weeks",
      "Website date: " + date,
    ].join(" | "),
    tags: [],
    firstAppointment: { tags: [], initialDate: date },
    price: Math.round(Number(priceLine.lineTotal) * 100) / 100,
  };
  if (!isOneOff) input.frequencyInterval = 4;

  const group = config?.jobGroupFor?.({ bin, date, postcode: normalizedPostcode(booking.address) });
  if (group) input.jobGroup = requireUuid(group, "jobGroup");
  return { index, bin: bin.type, quantity, status: "ready", date, input };
}

function buildSqueegeeBookingPlan(booking, verifiedSchedule, config = {}) {
  if (!BOOKING_ID_RE.test(String(booking?.bookingId || ""))) {
    throw new Error("A valid original booking reference is required");
  }
  if (!verifiedSchedule || !Array.isArray(verifiedSchedule.results)) {
    throw new Error("Only independently verified server-side schedules may be used");
  }
  if (normalizedPostcode(verifiedSchedule.postcode) !== normalizedPostcode(booking.address)) {
    throw new Error("Verified schedule postcode does not match booking address");
  }

  const customerInput = customerInputForBooking(booking);
  const bins = (Array.isArray(booking.bins) ? booking.bins : []).filter((bin) => bin?.type);
  if (!bins.length || bins.length !== verifiedSchedule.results.length) {
    throw new Error("Verified schedule must include every selected bin in order");
  }
  const jobs = bins.map((bin, index) => makeJobPlan(booking, bin, index, verifiedSchedule.results[index], config));
  return {
    bookingId: booking.bookingId,
    externalReference: customerInput.reference,
    customerInput,
    jobs,
    readyJobs: jobs.filter((job) => job.status === "ready").length,
    blockedJobs: jobs.filter((job) => job.status !== "ready").length,
    // A generated plan is NOT permission to write to Squeegee. Actual syncing
    // requires an atomic ledger and explicit owner-approved enablement.
    writeEnabled: false,
  };
}

module.exports = {
  normalizedPostcode,
  normalizedBinType,
  validDate,
  externalCustomerReference,
  customerInputForBooking,
  buildSqueegeeBookingPlan,
};
