"use strict";

/**
 * Owner-approved, Preview-1-branch-only activation.
 *
 * The Netlify management connector cannot set a new variable for ONE named
 * deploy-preview branch without affecting other previews. Keep this switch
 * in PR #77's isolated source instead, with the THREE independent runtime
 * site/context/hostname gates in squeegeeApiV3.isExactPreview1.
 *
 * Initial activation is one TEST API email booking only, then a permanently
 * consumed global Blob claim holds further test writes pending verification.
 * WhatsApp stays off. No override or retry is exposed to customers.
 */
const PREVIEW1_ONE_EMAIL_PILOT_ENABLED=true;
const PILOT_CLAIM_KEY="claim-v1/auto-pilot/preview77-first-email";
// Exactly the already-accepted, owner-supplied October 30th test booking.
// Reject all other new TEST API submissions until this one is reconciled.
const PILOT_BOOKING_ID="NBG-MVV99LDX-7BEDD59D85";
const PILOT_NAME="TEST API - Pilot 2";

function autoMode(env=process.env) {
  // Explicit false is a kill switch. A later, separately approved general
  // rollout may use a dedicated preview-branch env var with value true.
  if(env?.SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED==="false")return "off";
  if(env?.SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED==="true")return "full";
  return PREVIEW1_ONE_EMAIL_PILOT_ENABLED?"pilot":"off";
}
function automaticEnabled(env=process.env) {
  return autoMode(env)!=="off";
}
function isPilotBooking(booking,channel) {
  if(channel!=="email" ||
     booking?.bookingId!==PILOT_BOOKING_ID ||
     String(booking?.name||"").trim()!==PILOT_NAME ||
     booking?.termsAccepted!==true ||
     !Array.isArray(booking?.bins) || booking.bins.length!==2) return false;
  const kinds=booking.bins.map(bin=>{
    if(bin?.planId!=="domestic_4w" || Number(bin?.count)!==1) return null;
    return String(bin.type||"").trim();
  }).sort();
  return kinds[0]==="Black Bin" && kinds[1]==="Brown Bin";
}
function acceptedForRollout(booking,channel,env=process.env) {
  const mode=autoMode(env);
  if(mode==="off")return false;
  if(channel==="whatsapp") {
    // Pilot never allows WhatsApp. Full rollout STILL requires its own flag.
    return mode==="full" &&
      env?.SQUEEGEE_PREVIEW_AUTO_WHATSAPP_ENABLED==="true";
  }
  if(channel!=="email")return false;
  return mode==="full" || isPilotBooking(booking,channel);
}
module.exports={
  PILOT_CLAIM_KEY,PILOT_BOOKING_ID,PILOT_NAME,
  autoMode,automaticEnabled,
  isPilotBooking,acceptedForRollout,
};
