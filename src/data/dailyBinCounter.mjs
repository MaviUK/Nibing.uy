// Owner-reported counter pace for bins not yet represented in a Squeegee import.
// This is a website estimate, never a mutation of the verified historic audit.
// When the verified source advances, start the daily estimate the following day
// so completed bins imported later aren't counted a second time.
export const OWNER_ESTIMATED_BINS_PER_DAY = 200;
const START_MINUTE = 8 * 60;
const END_MINUTE = 18 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const UK_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function utcMidnight(dateText) {
  if (typeof dateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateText))
    return null;
  const value = Date.parse(dateText + "T00:00:00Z");
  return Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === dateText ? value : null;
}

// Counts 200 on each completed Mon–Thu after the latest verified day and
// up to another 200 between 08:00–18:00 UK local time on today's workday.
// Fri–Sun never add bins. All viewers see the same Europe/London progression.
export function ownerEstimatedBinsSince(verifiedThrough, now = new Date()) {
  const verifiedMidnight = utcMidnight(verifiedThrough);
  const current = now instanceof Date ? now : new Date(now);
  if (verifiedMidnight === null || !Number.isFinite(current.getTime()))
    return 0;
  const parts = Object.fromEntries(
    UK_CLOCK.formatToParts(current).map(({ type, value }) => [type, value])
  );
  const todayMidnight = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day)
  );
  if (todayMidnight <= verifiedMidnight) return 0;
  let bins = 0;
  for (let midnight = verifiedMidnight + DAY_MS;
    midnight < todayMidnight; midnight += DAY_MS) {
    const weekday = new Date(midnight).getUTCDay();
    if (weekday >= 1 && weekday <= 4)
      bins += OWNER_ESTIMATED_BINS_PER_DAY;
  }
  const todayWeekday = new Date(todayMidnight).getUTCDay();
  if (todayWeekday >= 1 && todayWeekday <= 4) {
    const minutesAfterEight =
      Number(parts.hour) * 60 + Number(parts.minute) - START_MINUTE;
    const elapsed = Math.max(0, Math.min(END_MINUTE - START_MINUTE, minutesAfterEight));
    bins += Math.floor(
      OWNER_ESTIMATED_BINS_PER_DAY * elapsed / (END_MINUTE - START_MINUTE)
    );
  }
  return bins;
}
