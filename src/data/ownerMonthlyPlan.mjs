/**
 * Owner-reported new-round figures (3 November 2026).
 *
 * This is a MONTHLY PLANNING TARGET, not an actual Squeegee import:
 * 1,734 active monthly customers; GBP 12,000 planned monthly cleaning value
 * divided by GBP 5 for each paid physical-bin clean = 2,400 bin cleans.
 * Spread evenly over four planning weeks, Monday-Thursday. Do not replace
 * historical Squeegee round sizes or claim these were already washed.
 */
export const OWNER_MONTHLY_PLAN = Object.freeze({
  updatedOn: "2026-11-03",
  monthlyCustomers: 1734,
  monthlyRevenueTargetGBP: 12000,
  pricePerPaidCleanGBP: 5,
  planningWeeks: 4,
  cleaningDaysPerWeek: 4,
});

const p=OWNER_MONTHLY_PLAN;
const monthlyCleans=p.monthlyRevenueTargetGBP/p.pricePerPaidCleanGBP;
if (!Number.isSafeInteger(monthlyCleans)) {
  throw new Error("Monthly cleaning target must yield whole paid bin quantities");
}
const base=Math.floor(monthlyCleans/p.planningWeeks);
const remainder=monthlyCleans%p.planningWeeks;
const weekly=Array.from({length:p.planningWeeks},(_,i)=>{
  const cleans=base+(i<remainder?1:0);
  return Object.freeze({
    week:i+1,
    cleans,
    revenueGBP:cleans*p.pricePerPaidCleanGBP,
    dailyAverageCleans:cleans/p.cleaningDaysPerWeek,
  });
});
export const MONTHLY_CLEANING_TARGET = Object.freeze({
  monthlyCleans,
  averageCleansPerWeek:monthlyCleans/p.planningWeeks,
  averageCleansPerWorkday:monthlyCleans/(p.planningWeeks*p.cleaningDaysPerWeek),
  weekly:Object.freeze(weekly),
});
