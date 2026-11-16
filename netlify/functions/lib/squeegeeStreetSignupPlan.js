"use strict";

/**
 * Street signup date policy. The street clean is NOT marked completed here.
 * The first appointment is the date of acceptance in Europe/London, and
 * recurring work repeats every four weeks. Completion is manual in Squeegee.
 */
function streetSignupDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_signup_timestamp");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}
const PLAN_IDS = new Set([
  "domestic_4w", "domestic_oneoff",
  "comm_lt360_4w", "comm_lt360_oneoff",
  "comm_gt660_4w", "comm_gt660_oneoff"
]);
function prepareStreetSignupJobs(bins, now = new Date()) {
  if (!Array.isArray(bins) || !bins.length) throw new Error("missing_bins");
  const date = streetSignupDate(now);
  const jobs = [];
  for (const bin of bins) {
    if (!PLAN_IDS.has(bin?.planId)) throw new Error("unsupported_street_plan");
    if (!["Black", "Brown", "Blue", "Green"].includes(String(bin.type || "").replace(/ Bin$/i, "")))
      throw new Error("unsupported_bin_colour");
    const count = Number(bin.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 20)
      throw new Error("invalid_bin_count");
    if (bin.planId.startsWith("comm_gt660_") && ![660, 1100].includes(Number(bin.sizeLitres)))
      throw new Error("commercial_size_required");
    for (let i = 0; i < count; i++) {
      const recurring = bin.planId.endsWith("_4w");
      jobs.push({
        type: String(bin.type).replace(/ Bin$/i, ""),
        planId: bin.planId,
        sizeLitres: bin.sizeLitres || null,
        date,
        frequencyType: recurring ? "weeks" : "adhoc",
        ...(recurring ? { frequencyInterval: 4 } : {}),
        completion: "manual",
      });
    }
  }
  return jobs;
}
module.exports = { streetSignupDate, prepareStreetSignupJobs };
