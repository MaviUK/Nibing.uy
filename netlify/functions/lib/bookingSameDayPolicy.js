"use strict";
/**
 * Shared same-day eligibility policy for booking channels.
 * This module is deliberately NOT an authorization mechanism: a caller's
 * "street-signup" string must never by itself grant permission to bypass
 * the ordinary booking cutoff. The server must authenticate the staff
 * channel before invoking this policy with staffVerified=true.
 */
function ukClock(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_booking_clock");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { today: p.year + "-" + p.month + "-" + p.day,
    minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function sameDayAllowed({ channel = "standard", staffVerified = false, now = new Date() } = {}) {
  const clock = ukClock(now);
  return channel === "street-signup" && staffVerified === true ||
    clock.minutes < 10 * 60;
}
module.exports = { ukClock, sameDayAllowed };
