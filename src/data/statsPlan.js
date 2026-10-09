import { useEffect, useMemo, useState } from "react";

// ✅ Change these anytime
export const STATS_BASE = {
  totalBinsCleaned: 27886,  // total before the last 4 months were added
  monthlyCustomers: 1078,   // your starting total monthly customers
};

// ✅ Your real 4-week rota (Mon–Thu only)
export const FOUR_WEEK_PLAN = [
   // Week 1
  {
    Mon: { area: "Groomsport & Bangor", bins: 105, customers: 61 },
    Tue: { area: "Bangor", bins: 115, customers: 75 },
    Wed: { area: "Ards", bins: 95, customers: 66 },
    Thu: { area: "Ards & Bangor", bins: 121, customers: 69 },
  },
  // Week 2
  {
    Mon: { area: "Comber & Ards", bins: 110, customers: 79 },
    Tue: { area: "Bangor & Ards", bins: 95, customers: 61 },
    Wed: { area: "Comber & Ards", bins: 120, customers: 73 },
    Thu: { area: "Bangor & Ards", bins: 105, customers: 81 },
  },
  // Week 3
  {
    Mon: { area: "Bangor", bins: 100, customers: 73 },
    Tue: { area: "Bangor", bins: 90, customers: 67 },
    Wed: { area: "Comber & Ards", bins: 125, customers: 71 },
    Thu: { area: "Comber", bins: 105, customers: 75 },
  },
  // Week 4
  {
    Mon: { area: "Portaferry", bins: 135, customers: 81 },
    Tue: { area: "Millisle", bins: 101, customers: 72 },
    Wed: { area: "Donaghadee", bins: 112, customers: 71 },
    Thu: { area: "Donaghadee", bins: 129, customers: 78 },
  },
];

// ✅ Set this to the Monday that should count as “Week 1”
export const ANCHOR_MONDAY = new Date("2026-01-05T00:00:00");

// ✅ Counter catch-up date: 4 months before 6 June 2026.
// The live headline adds all completed route bins from this date onward.
const COUNTER_COUNT_FROM = new Date("2026-02-06T00:00:00");

// Workday times
const START_HOUR = 9;
const END_HOUR = 17;

const DAY_MAP = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const weeksBetween = (a, b) =>
  Math.floor((b.getTime() - a.getTime()) / (7 * 24 * 60 * 60 * 1000));

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
    active: !!plan,
    dayKey,
    area: plan?.area ?? "Route Day",
    bins: plan?.bins ?? 0,
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

function computeCompletedRouteTotals(now) {
  let bins = 0;
  let customers = 0;
  const cursor = startOfDay(COUNTER_COUNT_FROM);
  const today = startOfDay(now);

  while (cursor < today) {
    const plan = getPlanForDate(cursor);

    // Count every completed route day since the counter catch-up date.
    // This keeps the headline cumulative and includes the last 4 months.
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
  const completedRoutes = useMemo(() => computeCompletedRouteTotals(now), [now]);

  const progress = today.active ? getDayProgress(now) : 0;

  return {
    totalBinsCleaned: STATS_BASE.totalBinsCleaned + completedRoutes.bins + Math.floor(today.bins * progress),
    todaysArea: today.area,
    totalMonthlyCustomers: STATS_BASE.monthlyCustomers, // ✅ always 1078
  };
}