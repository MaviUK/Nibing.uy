"use strict";

const { normalizedPostcode, normalizedBinType, validDate } = require("./squeegeeBookingPlan");

const COVERED_TOWNS = new Set([
  "BANGOR", "HOLYWOOD", "NEWTOWNARDS", "DONAGHADEE",
  "CARROWDORE", "COMBER", "MILLISLE", "PORTAFERRY",
]);

/**
 * Never silently replace the date the customer saw with a newly computed one.
 * The server result is authoritative; the browser snapshot is evidence of the
 * date displayed. Both must agree, otherwise that bin stays pending review.
 */
function compareDisplayedSchedule(booking, serverSchedule, browserSnapshot) {
  const bins = (Array.isArray(booking?.bins) ? booking.bins : []).filter(bin => bin?.type);
  const postcode = normalizedPostcode(booking?.address);
  const serverRows = Array.isArray(serverSchedule?.results) ? serverSchedule.results : [];
  const clientRows = Array.isArray(browserSnapshot?.results) ? browserSnapshot.results : [];

  const headerMatches = Boolean(
    postcode &&
    serverRows.length === bins.length &&
    browserSnapshot?.version === 1 &&
    clientRows.length === bins.length &&
    normalizedPostcode(serverSchedule?.postcode) === postcode &&
    normalizedPostcode(browserSnapshot?.postcode) === postcode
  );

  const holds = [];
  const results = bins.map((bin, index) => {
    const server = serverRows[index];
    const client = clientRows[index];
    const type = normalizedBinType(bin.type);
    const town = String(server?.town || serverSchedule?.town || "").trim().toUpperCase();
    let reason = null;

    if (!headerMatches) reason = "schedule_not_confirmed_at_submit";
    else if (!COVERED_TOWNS.has(town)) reason = "unverified_service_area";
    else if (normalizedBinType(server?.bin) !== type || normalizedBinType(client?.type) !== type) {
      reason = "bin_mismatch";
    } else if (server?.automatic !== true || !validDate(server?.assignedCleanDate)) {
      reason = "server_date_unconfirmed";
    } else if (client?.automatic !== true || !validDate(client?.assignedCleanDate)) {
      reason = "website_date_unconfirmed";
    } else if (server.assignedCleanDate !== client.assignedCleanDate) {
      reason = "displayed_date_changed";
    }

    if (reason) holds.push({ index, bin: bin.type, reason });
    return {
      bin: bin.type,
      assignedCleanDate: reason ? null : server.assignedCleanDate,
      automatic: !reason,
    };
  });

  return {
    postcode,
    matched: holds.length === 0 && bins.length > 0,
    results,
    holds,
    readyCount: bins.length - holds.length,
    // The date/round returned by the council schedule is NOT automatically
    // a Squeegee jobGroup UUID. Round assignment still needs mapping.
    jobGroupVerified: false,
  };
}

module.exports = { compareDisplayedSchedule, COVERED_TOWNS };
