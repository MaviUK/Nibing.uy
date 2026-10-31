/**
 * Human-friendly, cryptographically random NI Bin Guy booking reference.
 * Example: NBG-261031-K7P4R2XM
 *
 * Date is Europe/London (YYMMDD), NOT the device's current timezone.
 * Eight base32 characters use 40 secure random bits with no 0/O/1/I
 * ambiguity. This is the real booking key for NEW submissions, not a
 * separate public alias that would break Squeegee, ledger or audit links.
 *
 * Existing NBG-* keys remain valid through bookingSubmissionGuard.js.
 */
const SAFE_BASE32="23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LONDON_DATE=new Intl.DateTimeFormat("en-GB",{
  timeZone:"Europe/London",year:"2-digit",month:"2-digit",day:"2-digit",
});

export function createFriendlyBookingReference(now=new Date(),cryptoSource=globalThis.crypto){
  if(!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new TypeError("invalid_booking_reference_date");
  if(!cryptoSource || typeof cryptoSource.getRandomValues!=="function")
    throw new Error("secure_booking_reference_unavailable");
  const pieces=LONDON_DATE.formatToParts(now);
  const find=type=>pieces.find(part=>part.type===type)?.value;
  const dateCode=[find("year"),find("month"),find("day")].join("");
  if(!/^\d{6}$/.test(dateCode))
    throw new Error("booking_reference_date_unavailable");
  const bytes=new Uint8Array(8);
  cryptoSource.getRandomValues(bytes);
  const randomCode=Array.from(bytes,byte=>SAFE_BASE32[byte&31]).join("");
  return "NBG-"+dateCode+"-"+randomCode;
}
