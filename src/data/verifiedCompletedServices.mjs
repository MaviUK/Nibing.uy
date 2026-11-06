/**
 * Public aggregate service totals reconciled from the owner-supplied
 * 2026-11-05 Squeegee backup and 31 monthly completed-job CSV reports
 * (2024-05 through 2026-11). Services colour and explicit xN quantity
 * determine physical bins, NOT number of job rows or invoice prices.
 *
 * These are completed bins across ALL historic customers. They are NOT
 * paid-customer leaderboard eligibility, not scheduled work, and not live.
 * No private customer data is stored in this module.
 */
export const VERIFIED_COMPLETED_SERVICES = Object.freeze({
  asOf: "2026-11-05",
  beforeSqueegeeBins: 14000, // owner-confirmed previous non-overlapping work
  byYear: Object.freeze({
    2024: Object.freeze({ Brown: 3241, Black: 2784, Blue: 391, Green: 10 }),
    2025: Object.freeze({ Brown: 6532, Black: 4892, Blue: 755, Green: 9 }),
    2026: Object.freeze({ Brown: 6809, Black: 4758, Blue: 981, Green: 50 }),
  }),
  regularBins: 30450,
  oneOffBins: 762,
  completedJobRows: 25476,
  recordsSource: "Squeegee backup + completed Jobs CSV monthly reports, 5 Nov 2026",
});
const {byYear,regularBins,oneOffBins,beforeSqueegeeBins}=VERIFIED_COMPLETED_SERVICES;
export const SQUEEGEE_COMPLETED_BINS=Object.values(byYear).reduce(
  (total,colours)=>total+Object.values(colours).reduce((n,count)=>n+count,0),0
);
if(SQUEEGEE_COMPLETED_BINS!==31212 || regularBins+oneOffBins!==SQUEEGEE_COMPLETED_BINS)
  throw new Error("Completed Squeegee bin audit does not reconcile");
export const LIFETIME_COMPLETED_BINS=beforeSqueegeeBins+SQUEEGEE_COMPLETED_BINS;
