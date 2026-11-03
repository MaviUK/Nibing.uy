// src/hooks/useLiveCounters.js

import { useEffect, useMemo, useState } from "react";
import { STATS_BASE } from "../data/statsPlan";
import { getDayProgress, getPlanForDate } from "../utils/liveStats";

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Sum planned totals for current month up to "yesterday"
// (so your base grows over time instead of resetting daily)
export function computeMonthToDatePlanned(now = new Date()) {
  const monthStart = startOfMonth(now);
  const cursor = new Date(monthStart);

  let bins = 0;
  let customers = 0;

  while (cursor < now) {
    const plan = getPlanForDate(cursor);
    const dayKey = plan.dayKey;

    // Only count completed days fully; today is handled with progress separately
    const isSameDay =
      cursor.getFullYear() === now.getFullYear() &&
      cursor.getMonth() === now.getMonth() &&
      cursor.getDate() === now.getDate();

    if (plan.active && !isSameDay && ["Mon","Tue","Wed","Thu"].includes(dayKey)) {
      bins += plan.bins;
      customers += plan.customers;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return { bins, customers };
}

export default function useLiveCounters() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000); // update every 10s
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tick]);
  const planToday = useMemo(() => getPlanForDate(now), [now]);
  const progress = useMemo(() => (planToday.active ? getDayProgress(now) : 0), [now, planToday.active]);

  const monthToDate = useMemo(() => computeMonthToDatePlanned(now), [now]);

  // Live “today” increments spread over the day
  const binsSoFarToday = Math.floor(planToday.bins * progress);
  const customersSoFarToday = Math.floor(planToday.customers * progress);

  // Total bins cleaned headline
  const totalBinsCleaned =
    STATS_BASE.totalBinsCleaned + monthToDate.bins + binsSoFarToday;

  // Monthly customers headline (month-to-date)
  const totalMonthlyCustomers =
    STATS_BASE.monthlyCustomers + monthToDate.customers + customersSoFarToday;

  return {
    totalBinsCleaned,
    todaysArea: planToday.area ?? (planToday.active ? "Scheduled" : "No route today"),
    totalMonthlyCustomers,
    isActiveDay: planToday.active,
    dayProgress: progress,
  };
}
