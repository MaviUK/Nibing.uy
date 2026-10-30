"use strict";

/**
 * Internal event dispatch from an already-successful NI Bin Guy booking.
 * No browser can authorise a Squeegee write: only the legacy confirmation
 * functions, holding the preview-only Squeegee secret, can sign an event.
 * Disabled by default. Production / Preview 2 never dispatch anything.
 */
const crypto=require("node:crypto");
const {validateBookingSubmission}=require("./bookingSubmissionGuard");
const rollout=require("./squeegeePreviewAutoRollout");

const PREVIEW_ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";
const SECRET_DOMAIN="nibinguy-preview77-accepted-booking-auto-sync-v1";
const MAX_TIMESTAMP_MS=90*1000;
const MIN_SECRET_LENGTH=20;

function previewInternalSecret(env=process.env) {
  const root=String(env?.SQUEEGEE_API_KEY||"").trim();
  if(root.length<MIN_SECRET_LENGTH)return null;
  return crypto.createHmac("sha256",root).update(SECRET_DOMAIN).digest();
}
function acceptedEventBooking(payload) {
  // Excludes tokens, leaderboard sessions, incoming custom options and
  // anything which the Squeegee API does not need.
  const keys=[
    "bookingId","submittedAt","name","email","phone","address",
    "placeId","lat","lng","bins","pricing","discountCode",
    "termsAccepted","bookingScheduleSnapshot",
  ];
  const booking={};
  for(const key of keys)if(payload?.[key]!==undefined)booking[key]=payload[key];
  return booking;
}
function signAcceptedEvent(body,timestamp,env=process.env) {
  const secret=previewInternalSecret(env);
  if(!secret || typeof body!=="string" || !Number.isSafeInteger(Number(timestamp)))
    return null;
  return crypto.createHmac("sha256",secret)
    .update(String(timestamp)+"\n"+body).digest("hex");
}
function verifyAcceptedEvent(body,timestamp,signature,env=process.env,now=Date.now()) {
  if(typeof body!=="string" || body.length>30000 ||
     !/^\d{13}$/.test(String(timestamp||"")) ||
     !/^[a-f0-9]{64}$/i.test(String(signature||"")) ||
     !Number.isSafeInteger(now))return false;
  const age=now-Number(timestamp);
  if(age < -30000 || age>MAX_TIMESTAMP_MS)return false;
  const expected=signAcceptedEvent(body,timestamp,env);
  if(!expected)return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected,"hex"),Buffer.from(signature,"hex"));
}
function autoDispatchConfigured(env=process.env) {
  return rollout.automaticEnabled(env) &&
    Boolean(previewInternalSecret(env));
}
async function dispatchAcceptedBooking(payload,{
  channel,eventHost,env=process.env,fetchImpl=fetch,timeoutMs=3000,
  now=Date.now(),
}={}) {
  if(!autoDispatchConfigured(env))return {queued:false,reason:"not_enabled"};
  if(eventHost!=="deploy-preview-77--nibinguy.netlify.app")
    return {queued:false,reason:"not_exact_preview_1"};
  if(!["email","whatsapp"].includes(channel))
    return {queued:false,reason:"unrecognised_channel"};
  // WhatsApp opens before its background confirmation and does not use
  // the Preview 1 email-work challenge. Keep its Squeegee write path locked
  // behind a separate owner-controlled flag pending security review.
  if(channel==="whatsapp" && env.SQUEEGEE_PREVIEW_AUTO_WHATSAPP_ENABLED!=="true")
    return {queued:false,reason:"whatsapp_auto_sync_requires_separate_approval"};
  if(!rollout.acceptedForRollout(payload,channel,env))
    return {queued:false,reason:"outside_approved_preview_email_pilot"};
  const accepted=validateBookingSubmission(payload,{now});
  if(!accepted.ok)return {queued:false,reason:"invalid_or_expired_booking"};
  const booking=acceptedEventBooking(payload);
  const body=JSON.stringify({channel,booking});
  if(body.length>30000)return {queued:false,reason:"booking_too_large"};
  const timestamp=String(now);
  const signature=signAcceptedEvent(body,timestamp,env);
  if(!signature)return {queued:false,reason:"signing_unavailable"};

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,4000));
  try {
    const response=await fetchImpl(PREVIEW_ORIGIN+"/api/squeegee-preview-auto-sync",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "X-NBG-Auto-Timestamp":timestamp,
        "X-NBG-Auto-Signature":signature,
      },
      body,signal:controller.signal,cache:"no-store",redirect:"error",
    });
    // This is only acknowledgement of a durable queued receipt, never
    // evidence of an actual Squeegee customer/job creation.
    return {queued:response.status===202,
      reason:response.status===202?"queued":"dispatch_not_accepted"};
  }catch{
    // No retry: request may have reached the durable receipt before timeout.
    return {queued:false,reason:"dispatch_uncertain_reconcile"};
  }finally{clearTimeout(timer);}
}
module.exports={
  PREVIEW_ORIGIN,acceptedEventBooking,autoDispatchConfigured,
  signAcceptedEvent,verifyAcceptedEvent,dispatchAcceptedBooking,
};
