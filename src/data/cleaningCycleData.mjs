/* Aggregate-only Squeegee 31 Oct 2026 backup snapshot: NO customer details.
 * Every 'bins' number counts active 4-weekly bin services in serviced towns
 * on that round as of the backup, not verified future washes.
 * 'washedLastCycle' counts status=completed occurrences linked to those jobs
 * during the most recent four-week cycle. Round 04: 89 on Thu 22 Oct,
 * 42 overflow on Fri 23 Oct; Friday is NOT a regular route.
 * Rounds 05, 06, 07, 10, 15 and 20 have no active covered-group jobs.
 * Dates continue repeating every 28 days; Week 1 starts 19 Oct 2026.
 */
export const CYCLE_SNAPSHOT = Object.freeze({
  "backupDate": "2026-10-31",
  "lastCompletedCycleFrom": "2026-10-05",
  "lastCompletedCycleThrough": "2026-10-31",
  "weekOneMonday": "2026-10-19",
  "activeFourWeeklyCustomers": 785,
  "scheduledFourWeeklyBinsPerCycle": 1288,
  "lastCycleWashedFourWeeklyBins": 1186,
  "completedBinsThroughBackup": 30162,
  "exclusions": "Inactive and deleted jobs, one-offs, and Ballywalter, Greyabbey, Cloughey, Portavogie, Ballyhalbert from the forward recurring plan",
  "note": "Round 04 included 89 bins on Thu 22 Oct and 42 on Fri 23 Oct as a one-off overflow, not a regular Friday round."
});
export const FOUR_WEEK_PLAN = Object.freeze([
  {
    "Mon": {
      "round": 1,
      "area": "Comber & Newtownards",
      "bins": 117,
      "washedLastCycle": 106,
      "customers": 107
    },
    "Tue": {
      "round": 2,
      "area": "Bangor & Newtownards",
      "bins": 95,
      "washedLastCycle": 91,
      "customers": 78
    },
    "Wed": {
      "round": 3,
      "area": "Comber & Newtownards",
      "bins": 100,
      "washedLastCycle": 97,
      "customers": 90
    },
    "Thu": {
      "round": 4,
      "area": "Bangor & Newtownards",
      "bins": 139,
      "washedLastCycle": 131,
      "customers": 96
    }
  },
  {
    "Mon": {
      "round": 6,
      "area": "No cleans scheduled",
      "bins": 0,
      "washedLastCycle": 0,
      "customers": 0
    },
    "Tue": {
      "round": 7,
      "area": "No cleans scheduled",
      "bins": 0,
      "washedLastCycle": 0,
      "customers": 0
    },
    "Wed": {
      "round": 8,
      "area": "Comber & Newtownards",
      "bins": 75,
      "washedLastCycle": 69,
      "customers": 67
    },
    "Thu": {
      "round": 9,
      "area": "Comber & Newtownards",
      "bins": 55,
      "washedLastCycle": 51,
      "customers": 55
    }
  },
  {
    "Mon": {
      "round": 11,
      "area": "Portaferry",
      "bins": 98,
      "washedLastCycle": 96,
      "customers": 65
    },
    "Tue": {
      "round": 12,
      "area": "Millisle & Donaghadee",
      "bins": 64,
      "washedLastCycle": 41,
      "customers": 60
    },
    "Wed": {
      "round": 13,
      "area": "Donaghadee",
      "bins": 92,
      "washedLastCycle": 86,
      "customers": 68
    },
    "Thu": {
      "round": 14,
      "area": "Donaghadee & Millisle",
      "bins": 114,
      "washedLastCycle": 106,
      "customers": 85
    }
  },
  {
    "Mon": {
      "round": 16,
      "area": "Bangor & Newtownards",
      "bins": 82,
      "washedLastCycle": 75,
      "customers": 62
    },
    "Tue": {
      "round": 17,
      "area": "Bangor & Millisle",
      "bins": 66,
      "washedLastCycle": 61,
      "customers": 59
    },
    "Wed": {
      "round": 18,
      "area": "Newtownards & Bangor",
      "bins": 98,
      "washedLastCycle": 93,
      "customers": 81
    },
    "Thu": {
      "round": 19,
      "area": "Newtownards & Bangor",
      "bins": 93,
      "washedLastCycle": 83,
      "customers": 79
    }
  }
]);
