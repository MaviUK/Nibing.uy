"use strict";

/**
 * Owner-approved, Preview-1-branch-only activation.
 *
 * The Netlify management connector cannot set a new variable for ONE named
 * deploy-preview branch without affecting other previews. Keep this switch
 * in PR #77's isolated source instead, with the THREE independent runtime
 * site/context/hostname gates in squeegeeApiV3.isExactPreview1.
 *
 * The new, one-use, Fresh Sync email test uses a NEW immutable claim key.
 * Previously accepted booking references and claims must never be cleared
 * or reused. All further automatic writes stop after the one test claim.
 * WhatsApp stays off. No override or retry is exposed to customers.
 */
// Owner approved general Email/Submit Booking syncing on Preview 1 after
// independently verifying one customer, one Brown job, round/date and £5/4w.
// This code is only on draft PR #77; exact runtime hostname/context/site gates
// in squeegeeApiV3 protect Production and Preview 2.
const PREVIEW1_FULL_EMAIL_SYNC_ENABLED=true;
const PREVIEW1_ONE_EMAIL_PILOT_ENABLED=true;
// Fresh one-use pilot: NEVER clear/reuse the old pilot claim or the old
// accepted booking. A new key is required to keep their histories immutable.
const PILOT_CLAIM_KEY="claim-v1/auto-pilot/preview77-fresh-brown-v1";
const ABANDONED_BOOKING_ID="NBG-MVV99LDX-7BEDD59D85";
const PILOT_NAME="TEST API - Fresh Sync";

function autoMode(env=process.env) {
  // Explicit false is a kill switch. A later, separately approved general
  // rollout may use a dedicated preview-branch env var with value true.
  if(env?.SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED==="false")return "off";
  if(env?.SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED==="pilot")
    return PREVIEW1_ONE_EMAIL_PILOT_ENABLED?"pilot":"off";
  if(env?.SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED==="true")return "full";
  return PREVIEW1_FULL_EMAIL_SYNC_ENABLED?"full":
    PREVIEW1_ONE_EMAIL_PILOT_ENABLED?"pilot":"off";
}
function automaticEnabled(env=process.env) {
  return autoMode(env)!=="off";
}
function isPilotBooking(booking,channel) {
  // This is a new normal website booking. Its random booking ID cannot be
  // known in advance; the CAS pilot claim is what permits just ONE booking.
  // Never replay or reissue a previously accepted booking for this pilot.
  if(channel!=="email" ||
     booking?.bookingId===ABANDONED_BOOKING_ID ||
     !/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i.test(String(booking?.bookingId||"")) ||
     String(booking?.name||"").trim()!==PILOT_NAME ||
     booking?.termsAccepted!==true ||
     !Array.isArray(booking?.bins) || booking.bins.length!==1) return false;
  const bin=booking.bins[0];
  return bin?.type==="Brown Bin" &&
    bin.planId==="domestic_4w" && Number(bin.count)===1;
}
function acceptedForRollout(booking,channel,env=process.env) {
  const mode=autoMode(env);
  if(mode==="off")return false;
  // The abandoned website booking is never replayed in any rollout mode.
  if(booking?.bookingId===ABANDONED_BOOKING_ID)return false;
  if(channel==="whatsapp") {
    // Pilot never allows WhatsApp. Full rollout STILL requires its own flag.
    return mode==="full" &&
      env?.SQUEEGEE_PREVIEW_AUTO_WHATSAPP_ENABLED==="true";
  }
  if(channel!=="email")return false;
  return mode==="full" || isPilotBooking(booking,channel);
}
module.exports={
  PILOT_CLAIM_KEY,ABANDONED_BOOKING_ID,PILOT_NAME,
  autoMode,automaticEnabled,
  isPilotBooking,acceptedForRollout,
};
