"use strict";

const { verifyAndPriceBooking } = require("./squeegeeBookingPricing");
const { compareDisplayedSchedule } = require("./squeegeeScheduleCheck");
const { resolveSqueegeeServiceIds, resolvedServiceIdForBin } = require("./squeegeeServiceCatalog");
const { buildSqueegeeBookingPlan, normalizedBinType } = require("./squeegeeBookingPlan");
const {
  CYCLE_ANCHOR_MONDAY,
  resolveSqueegeeRoundJobGroup,
} = require("./squeegeeRoundCycle");

/**
 * Prepare a per-bin Squeegee job using both exact website dates and the
 * owner-confirmed 20-round/4-week cycle. This is GET-only preview preparation.
 *
 * Never assign a group by town: the same groups serve different towns.
 * Missing/duplicate account group labels and bank-holiday recurring anchors
 * hold the affected job. No Squeegee POST is performed here.
 */
function prepareReadOnlyBooking(booking, serverSchedule, services, {
  jobGroups, legacyLargeCommercialPrice = false,
} = {}) {
  const price = verifyAndPriceBooking(booking?.bins, booking?.discountCode,
    booking?.pricing,{legacyLargeCommercialPrice});
  const dates = compareDisplayedSchedule(booking, serverSchedule,
    booking?.bookingScheduleSnapshot);
  const mapped = resolveSqueegeeServiceIds(Array.isArray(services) ? services : []);
  const bins = (Array.isArray(booking?.bins) ? booking.bins : []).filter(bin => bin?.type);
  const errors = [];

  if (!price.ok) errors.push(price.reason);
  if (dates.holds.length) errors.push("unverified_or_changed_dates");

  // Only the services on THIS booking must be present in Squeegee.
  const unmappedServices = bins.filter(bin =>
    !resolvedServiceIdForBin(mapped.serviceIds, bin))
    .map(bin => {
      const type = normalizedBinType(bin?.type);
      const planId = String(bin?.planId || "");
      return {
        // Keep diagnostic status PII-free, bounded to known choices.
        binType: ["black", "brown", "green", "blue"].includes(type) ? type : "unknown",
        planId: /^(?:domestic|comm_lt360|comm_gt660)_(?:4w|oneoff)$/.test(planId) ?
          planId : "unknown",
        sizeLitres: planId.startsWith("comm_gt660_") &&
          [660, 1100].includes(bin.sizeLitres) ? bin.sizeLitres : null,
      };
    });
  if (unmappedServices.length) errors.push("unmapped_squeegee_services");

  const rounds = bins.map((bin, index) => {
    const date = dates.results[index]?.assignedCleanDate;
    if (!date) return { status: "date_not_verified", jobGroupId: null };
    return resolveSqueegeeRoundJobGroup(date, jobGroups, {
      recurring: /_4w$/.test(String(bin.planId || "")),
    });
  });
  const roundProblems = [...new Set(
    rounds.filter(round => round.status !== "mapped")
      .map(round => round.status)
  )];
  if (roundProblems.length) {
    errors.push("job_group_round_mapping_required");
    errors.push(...roundProblems);
  }

  let plan = null;
  if (price.canonical && price.ok) {
    // Never let browser prices or free-form town strings choose job groups.
    const verifiedBooking = { ...booking, pricing: price.canonical };
    try {
      plan = buildSqueegeeBookingPlan(verifiedBooking, dates, {
        serviceIds: mapped.serviceIds,
        pricesVerifiedByServer: true,
        requireJobGroup: true,
        jobGroupFor: ({ index }) => rounds[index]?.status === "mapped"
          ? rounds[index].jobGroupId : null,
      });
    } catch (error) {
      // Do not mislabel a rejected booking ID as a council-date error.
      // Expose only these fixed, non-personal diagnostic codes.
      const invalidReference=/valid original booking reference/i.test(
        String(error?.message||""));
      errors.push(invalidReference?
        "invalid_booking_reference":"invalid_customer_or_booking");
    }
  }

  const jobs = (plan?.jobs || []).map((job, index) => ({
    bin: job.bin,
    quantity: job.quantity || null,
    sizeLitres: job.sizeLitres || null,
    date: job.date,
    frequency: job.input?.frequencyType || null,
    interval: job.input?.frequencyInterval || null,
    price: job.input?.price ?? null,
    status: job.status,
    roundNumber: rounds[index]?.roundNumber ?? null,
    roundWeek: rounds[index]?.weekNumber ?? null,
    roundStatus: rounds[index]?.status || "date_not_verified",
    bankHolidayShifted: rounds[index]?.bankHolidayShifted === true,
    // Numeric group number only; never store Squeegee account UUIDs here.
  }));

  const summary = {
    bookingId: String(booking?.bookingId || ""),
    readOnly: true,
    approvedToWrite: false,
    pricingVerified: price.ok,
    datesVerified: dates.matched,
    roundCycleAnchor: CYCLE_ANCHOR_MONDAY,
    needsJobGroupMapping: roundProblems.length > 0,
    unmappedServices: unmappedServices.slice(0, 12),
    jobCount: jobs.length,
    jobs,
    heldDates: dates.holds.map(({ index, bin, reason }) => ({ index, bin, reason })),
    blockedReasons: [...new Set(errors)],
  };

  return {
    status: summary.blockedReasons.length ? "held_for_review" : "prepared_read_only",
    summary,
    // The private planner object must never be returned as public response.
    privatePlan: plan,
  };
}

module.exports = { prepareReadOnlyBooking };
