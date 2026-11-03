/* Squeegee backup dated 31 October 2026. AGGREGATES ONLY: no PII.
 * bins = SUM OF SERVICE QUANTITIES, not number of jobs or service lines.
 * E.g. Brown quantity 2 = two bins; Brown + Black = two services/bins.
 * The snapshot active 4-weekly rota excludes towns no longer covered.
 * washedLastCycle uses quantities from completed JOB OCCURRENCES with
 * due dates 5-31 October, never later job settings or scheduled counts.
 * Round 04 had 42 physical bins on Friday as a one-time overflow.
 * 20-round cycle, Week 1 starts 19 October; 2 November = Week 3 Round 11.
 * completedBinsThroughBackup covers all historical completed occurrences
 * including one-offs/former towns, and is not a live API counter.
 */
export const CYCLE_SNAPSHOT = Object.freeze({
  "backupDate": "2026-10-31",
  "lastCompletedCycleFrom": "2026-10-05",
  "lastCompletedCycleThrough": "2026-10-31",
  "weekOneMonday": "2026-10-19",
  "activeFourWeeklyCustomers": 785,
  "activeFourWeeklyJobs": 1065,
  "scheduledFourWeeklyBinServices": 1288,
  "scheduledFourWeeklyBinsPerCycle": 1343,
  "lastCycleWashedFourWeeklyJobs": 984,
  "lastCycleWashedFourWeeklyServiceEntries": 1186,
  "lastCycleWashedFourWeeklyBins": 1222,
  "completedBinsThroughBackup": 30803,
  "historicalCompletedJobs": 25299,
  "countingMethod": "Sum each service.quantity (default 1) from active jobs for planned bins and from completed job occurrences for washed bins. Never equate jobs or service entries with bin counts.",
  "exclusions": "Active 4-weekly in serviced towns only: exclude inactive/deleted jobs, one-offs, Ballywalter, Greyabbey, Cloughey, Portavogie, Ballyhalbert from current rota.",
  "note": "Round 04 had 89 physical bins washed Thu 22 Oct and 42 physical bins washed Fri 23 Oct as a one-off overflow, not a regular Friday round. Lifetime completed total includes one-offs and historical former areas."
});
/* Owner-provided current-week takings, 3 Nov 2026. This is independent
 * of the historical 31 Oct Squeegee backup. The reported £1,995 at £5 per
 * bin is 399 physical bins across Mon-Thu 2-5 Nov, Week 3.
 *
 * Do not distribute the unmatched seven bins to arbitrary days or assume
 * they are completed. Update each route when the verified daily split
 * becomes available; the historical washed counter must stay unchanged.
 */
export const OWNER_CONFIRMED_WEEK = Object.freeze({
  monday: "2026-11-02",
  thursday: "2026-11-05",
  cycleWeek: 3,
  perBinGBP: 5,
  scheduledValueGBP: 1995,
  scheduledPhysicalBins: 399,
  source: "owner confirmed 3 November 2026",
});

export const FOUR_WEEK_PLAN = Object.freeze([
  {
    "Mon": {
      "round": 1,
      "area": "Comber & Newtownards",
      "bins": 122,
      "washedLastCycle": 111,
      "customers": 107,
      "scheduledJobs": 108,
      "washedJobsLastCycle": 97
    },
    "Tue": {
      "round": 2,
      "area": "Bangor & Newtownards",
      "bins": 97,
      "washedLastCycle": 93,
      "customers": 78,
      "scheduledJobs": 78,
      "washedJobsLastCycle": 76
    },
    "Wed": {
      "round": 3,
      "area": "Comber & Newtownards",
      "bins": 103,
      "washedLastCycle": 100,
      "customers": 90,
      "scheduledJobs": 90,
      "washedJobsLastCycle": 88
    },
    "Thu": {
      "round": 4,
      "area": "Bangor & Newtownards",
      "bins": 140,
      "washedLastCycle": 131,
      "customers": 96,
      "scheduledJobs": 96,
      "washedJobsLastCycle": 91
    }
  },
  {
    "Mon": {
      "round": 6,
      "area": "No cleans scheduled",
      "bins": 0,
      "washedLastCycle": 0,
      "customers": 0,
      "scheduledJobs": 0,
      "washedJobsLastCycle": 0
    },
    "Tue": {
      "round": 7,
      "area": "No cleans scheduled",
      "bins": 0,
      "washedLastCycle": 0,
      "customers": 0,
      "scheduledJobs": 0,
      "washedJobsLastCycle": 0
    },
    "Wed": {
      "round": 8,
      "area": "Comber & Newtownards",
      "bins": 81,
      "washedLastCycle": 72,
      "customers": 67,
      "scheduledJobs": 68,
      "washedJobsLastCycle": 63
    },
    "Thu": {
      "round": 9,
      "area": "Comber & Newtownards",
      "bins": 56,
      "washedLastCycle": 51,
      "customers": 55,
      "scheduledJobs": 55,
      "washedJobsLastCycle": 51
    }
  },
  {
    "Mon": {
      "round": 11,
      "area": "Portaferry",
      "bins": 102,
      "washedLastCycle": 100,
      "customers": 65,
      "scheduledJobs": 70,
      "washedJobsLastCycle": 68
    },
    "Tue": {
      "round": 12,
      "area": "Millisle & Donaghadee",
      "bins": 67,
      "washedLastCycle": 42,
      "customers": 60,
      "scheduledJobs": 60,
      "washedJobsLastCycle": 40
    },
    "Wed": {
      "round": 13,
      "area": "Donaghadee",
      "bins": 98,
      "washedLastCycle": 92,
      "customers": 68,
      "scheduledJobs": 70,
      "washedJobsLastCycle": 66
    },
    "Thu": {
      "round": 14,
      "area": "Donaghadee & Millisle",
      "bins": 125,
      "washedLastCycle": 115,
      "customers": 85,
      "scheduledJobs": 86,
      "washedJobsLastCycle": 81
    }
  },
  {
    "Mon": {
      "round": 16,
      "area": "Bangor & Newtownards",
      "bins": 85,
      "washedLastCycle": 77,
      "customers": 62,
      "scheduledJobs": 62,
      "washedJobsLastCycle": 58
    },
    "Tue": {
      "round": 17,
      "area": "Bangor & Millisle",
      "bins": 76,
      "washedLastCycle": 62,
      "customers": 59,
      "scheduledJobs": 59,
      "washedJobsLastCycle": 53
    },
    "Wed": {
      "round": 18,
      "area": "Newtownards & Bangor",
      "bins": 98,
      "washedLastCycle": 93,
      "customers": 81,
      "scheduledJobs": 83,
      "washedJobsLastCycle": 78
    },
    "Thu": {
      "round": 19,
      "area": "Newtownards & Bangor",
      "bins": 93,
      "washedLastCycle": 83,
      "customers": 79,
      "scheduledJobs": 80,
      "washedJobsLastCycle": 74
    }
  }
]);

/** Returns the current-week reconciliation without inventing daily bins. */
export function getOwnerConfirmedWeekReconciliation() {
  const days = ["Mon", "Tue", "Wed", "Thu"];
  const weeklyPlan = FOUR_WEEK_PLAN[OWNER_CONFIRMED_WEEK.cycleWeek - 1];
  const allocatedBinsFromBackup = days.reduce((sum, day) => sum + weeklyPlan[day].bins, 0);
  return {
    ...OWNER_CONFIRMED_WEEK,
    allocatedBinsFromBackup,
    unallocatedBins: OWNER_CONFIRMED_WEEK.scheduledPhysicalBins - allocatedBinsFromBackup,
  };
}
