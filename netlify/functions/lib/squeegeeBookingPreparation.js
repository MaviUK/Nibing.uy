"use strict";

const { verifyAndPriceBooking } = require("./squeegeeBookingPricing");
const { compareDisplayedSchedule } = require("./squeegeeScheduleCheck");
const { resolveSqueegeeServiceIds } = require("./squeegeeServiceCatalog");
const { buildSqueegeeBookingPlan } = require("./squeegeeBookingPlan");

/**
 * This does not call any Squeegee POST endpoint.
 * A prepared job is NEVER permission to create that job. The account's 14
 * numeric job groups have not been mapped to actual cleaning rounds yet.
 */
function prepareReadOnlyBooking(booking, serverSchedule, services, { jobGroupFor } = {}) {
  const price = verifyAndPriceBooking(booking?.bins, booking?.discountCode,
    booking?.pricing);
  const dates = compareDisplayedSchedule(booking, serverSchedule,
    booking?.bookingScheduleSnapshot);
  const mapped = resolveSqueegeeServiceIds(Array.isArray(services) ? services : []);
  const errors = [];
  if (!price.ok) errors.push(price.reason);
  if (dates.holds.length) errors.push("unverified_or_changed_dates");
  if (mapped.unresolved.length) errors.push("unmapped_squeegee_services");
  if (!jobGroupFor) errors.push("job_group_round_mapping_required");

  let plan = null;
  if (price.canonical && price.ok) {
    // The only price ever forwarded to the planner is calculated on the server.
    const verifiedBooking = { ...booking, pricing: price.canonical };
    try {
      plan = buildSqueegeeBookingPlan(verifiedBooking, dates, {
        serviceIds: mapped.serviceIds,
        pricesVerifiedByServer: true,
        jobGroupFor,
      });
    } catch (error) {
      errors.push("invalid_customer_or_booking");
    }
  }

  const summary = {
    bookingId: String(booking?.bookingId || ""),
    readOnly: true,
    approvedToWrite: false,
    pricingVerified: price.ok,
    datesVerified: dates.matched,
    needsJobGroupMapping: !jobGroupFor,
    jobCount: Array.isArray(plan?.jobs) ? plan.jobs.length : 0,
    jobs: (plan?.jobs || []).map(job => ({
      bin: job.bin,
      quantity: job.quantity || null,
      date: job.date,
      frequency: job.input?.frequencyType || null,
      interval: job.input?.frequencyInterval || null,
      price: job.input?.price ?? null,
      status: job.status,
      // Never store service/customer/job-group IDs in staging or logs.
    })),
    heldDates: dates.holds.map(({ index, bin, reason }) => ({ index, bin, reason })),
    blockedReasons: [...new Set(errors)],
  };

  return {
    status: summary.blockedReasons.length ? "held_for_review" : "prepared_read_only",
    summary,
    // This is deliberately not returned to browser/public JSON.
    privatePlan: plan,
  };
}

module.exports = { prepareReadOnlyBooking };
