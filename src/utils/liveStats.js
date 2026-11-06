// src/utils/liveStats.js

import { FOUR_WEEK_PLAN, CYCLE_SNAPSHOT } from "../data/cleaningCycleData.mjs";

// 9:00 to 17:00 = 8 hours
const START_HOUR = 9;
const END_HOUR = 17;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function dayKeyFromDate(d) {
  // JS: 0 Sun ... 6 Sat
  const map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return map[d.getDay()];
}

// Choose a fixed “anchor Monday” so weekIndex is stable.
// Pick a real Monday date that you’re happy to anchor from.
const ANCHOR_MONDAY = new Date(CYCLE_SNAPSHOT.weekOneMonday + "T00:00:00Z");

function weeksBetween(a, b) {
  const utcDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((utcDay(b) - utcDay(a)) / (7 * 24 * 60 * 60 * 1000));
}

export function getPlanForDate(date = new Date()) {
  const dayKey = dayKeyFromDate(date);

  // Only Mon-Thu active
  if (!["Mon", "Tue", "Wed", "Thu"].includes(dayKey)) {
    return { dayKey, active: false, area: null, bins: 0, customers: 0, weekIndex: null };
  }

  const weekIndex = ((weeksBetween(ANCHOR_MONDAY, date) % 4) + 4) % 4;
  const plan = FOUR_WEEK_PLAN[weekIndex]?.[dayKey];

  return {
    dayKey,
    active: Boolean(plan && plan.bins > 0),
    weekIndex,
    round: plan?.round ?? null,
    area: plan?.bins > 0 ? plan.area : null,
    bins: plan?.bins ?? 0,
    customers: plan?.customers ?? 0,
  };
}

export function getDayProgress(date = new Date()) {
  const start = new Date(date);
  start.setHours(START_HOUR, 0, 0, 0);

  const end = new Date(date);
  end.setHours(END_HOUR, 0, 0, 0);

  const now = date.getTime();
  const t = (now - start.getTime()) / (end.getTime() - start.getTime());

  // Before 9 => 0, after 5 => 1
  return clamp(t, 0, 1);
}
