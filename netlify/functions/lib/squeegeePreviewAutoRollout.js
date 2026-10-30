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
const PILOT_NAME_RE=/^TEST API - [^\r\n]{2,80}$/i;

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
  return channel==="email" &&
    PILOT_NAME_RE.test(String(booking?.name||"").trim()) &&
    booking?.termsAccepted===true &&
    Array.isArray(booking?.bins) && booking.bins.length===1 &&
    booking.bins[0]?.type &&
    booking.bins[0].planId==="domestic_4w" &&
    Number(booking.bins[0].count)===1;
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
  PILOT_CLAIM_KEY,autoMode,automaticEnabled,
  isPilotBooking,acceptedForRollout,
};
