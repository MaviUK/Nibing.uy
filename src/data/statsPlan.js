import { useEffect, useMemo, useState } from "react";

// The completed total is a real snapshot, not a retroactive replay of
// estimated daily cleans. Future progress uses the current backup rota until
// an updated Squeegee backup or completion feed is available.
import { CYCLE_SNAPSHOT, FOUR_WEEK_PLAN, OWNER_CONFIRMED_WEEK, getOwnerConfirmedWeekReconciliation } from "./cleaningCycleData.mjs";
export { CYCLE_SNAPSHOT, FOUR_WEEK_PLAN, OWNER_CONFIRMED_WEEK, getOwnerConfirmedWeekReconciliation };

export const STATS_BASE = {
  totalBinsCleaned: CYCLE_SNAPSHOT.completedBinsThroughBackup,
  monthlyCustomers: CYCLE_SNAPSHOT.activeFourWeeklyCustomers,
};

// Verified round mapping: Monday 2 November 2026 is Round 11, Week 3.
export const ANCHOR_MONDAY = new Date(CYCLE_SNAPSHOT.weekOneMonday + "T00:00:00Z");

// Do not replay the newest route sizes against months preceding the snapshot:
// those jobs/customers/areas changed considerably during the year.
const COUNTER_COUNT_FROM = new Date("2026-11-01T00:00:00");

// Workday times
const START_HOUR = 9;
const END_HOUR = 17;

const DAY_MAP = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Calendar-week maths, immune to the March/October UK clock changes.
const weeksBetween = (a, b) => {
  const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((day(b) - day(a)) / (7 * 24 * 60 * 60 * 1000));
};

function getPlanForDate(date = new Date()) {
  const dayKey = DAY_MAP[date.getDay()];

  // Your rule:
  // Friday = Office Day
  // Saturday/Sunday = Closed
  if (dayKey === "Fri") return { active: false, dayKey, area: "Office Day", bins: 0, customers: 0 };
  if (dayKey === "Sat" || dayKey === "Sun") return { active: false, dayKey, area: "Closed", bins: 0, customers: 0 };

  // Mon–Thu rota
  const weekIndex = ((weeksBetween(ANCHOR_MONDAY, date) % 4) + 4) % 4;
  const plan = FOUR_WEEK_PLAN[weekIndex]?.[dayKey];

  return {
    active: Boolean(plan && plan.bins > 0),
    dayKey,
    area: plan?.area ?? "No cleans scheduled",
    round: plan?.round ?? null,
    bins: plan?.bins ?? 0,
    washedLastCycle: plan?.washedLastCycle ?? 0,
    customers: plan?.customers ?? 0,
  };
}

function getDayProgress(now) {
  const start = new Date(now);
  start.setHours(START_HOUR, 0, 0, 0);

  const end = new Date(now);
  end.setHours(END_HOUR, 0, 0, 0);

  return clamp((now - start) / (end - start), 0, 1);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function computeEstimatedRouteTotals(now) {
  let bins = 0;
  let customers = 0;
  const cursor = startOfDay(COUNTER_COUNT_FROM);
  const today = startOfDay(now);

  while (cursor < today) {
    const plan = getPlanForDate(cursor);

    // Post-backup days are estimated from scheduled physical BIN QUANTITIES.
    // Pre-backup totals come from actual completed occurrence quantities.
    if (plan.active && ["Mon", "Tue", "Wed", "Thu"].includes(plan.dayKey)) {
      bins += plan.bins;
      customers += plan.customers;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return { bins, customers };
}

// ✅ This is what your landing page will import and use
export function useLiveCounters() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tick]);
  const today = useMemo(() => getPlanForDate(now), [now]);
  const completedRoutes = useMemo(() => computeEstimatedRouteTotals(now), [now]);

  const progress = today.active ? getDayProgress(now) : 0;

  return {
    totalBinsCleaned: STATS_BASE.totalBinsCleaned + completedRoutes.bins + Math.floor(today.bins * progress),
    todaysArea: today.area,
    totalMonthlyCustomers: STATS_BASE.monthlyCustomers, // active four-weekly, covered towns
  };
}