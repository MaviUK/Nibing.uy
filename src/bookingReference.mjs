/**
 * Canonical two-section customer booking reference: NBG-K7P4R2XM.
 * Eight random base32 characters use 40 bits of browser Web Crypto entropy,
 * avoiding the easily confused characters O/0/I/1. NOT date-only:
 * multiple bookings on the same day must never share one reference.
 *
 * This reference is the actual immutable booking ID used for Netlify Blobs
 * replay claims, owner notifications, Squeegee job claims and leaderboard.
 * Older three-section IDs remain valid in the server-side validators.
 */
const SAFE_BASE32="23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function createFriendlyBookingReference(cryptoSource=globalThis.crypto){
  if(!cryptoSource||typeof cryptoSource.getRandomValues!=="function")
    throw new Error("secure_booking_reference_unavailable");
  const bytes=new Uint8Array(8);
  cryptoSource.getRandomValues(bytes);
  return "NBG-"+Array.from(bytes,byte=>SAFE_BASE32[byte&31]).join("");
}
