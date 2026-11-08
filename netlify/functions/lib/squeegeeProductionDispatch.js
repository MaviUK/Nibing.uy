"use strict";
/*
 * Production-only internal sender from an ALREADY accepted website booking.
 * No browser supplies a signature, recipient, claim, or destination. It is
 * OFF unless every production switch and separate secret is configured.
 */
const crypto=require("node:crypto");
const {validateBookingSubmission}=require("./bookingSubmissionGuard");
const {acceptedEventBooking,normalOwnerReceipt}=
  require("./squeegeePreviewAutoDispatch");
const guard=require("./squeegeeProductionGuard");
const ORIGIN="https://nibing.uy";
const MAX_BODY=30000;
function issuerConfigured(env=process.env,eventHost="") {
  return eventHost===guard.PRODUCTION_HOST &&
    env?.SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED==="true" &&
    env?.SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES==="true" &&
    env?.SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY==="true" &&
    env?.SQUEEGEE_PRODUCTION_WRITES_PAUSED==="false" &&
    typeof env?.SQUEEGEE_PRODUCTION_API_KEY==="string" &&
    env.SQUEEGEE_PRODUCTION_API_KEY.trim().length>=20 &&
    typeof env?.SQUEEGEE_PRODUCTION_EVENT_SECRET==="string" &&
    env.SQUEEGEE_PRODUCTION_EVENT_SECRET.length>=32;
}
function signedEvent(body,timestamp,env) {
  const secret=env.SQUEEGEE_PRODUCTION_EVENT_SECRET;
  const signingKey=crypto.createHmac("sha256",secret)
    .update(guard.SIGNING_DOMAIN).digest();
  return crypto.createHmac("sha256",signingKey)
    .update(String(timestamp)+"\n"+body).digest("hex");
}
async function dispatchAcceptedProductionBooking(payload,{
  channel,eventHost,ownerReceipt=null,
  env=process.env,fetchImpl=globalThis.fetch,now=Date.now(),timeoutMs=3500,
}={}) {
  if(!issuerConfigured(env,eventHost))
    return {queued:false,reason:"production_sync_off"};
  // WhatsApp handoff has a different anti-abuse model and remains disabled.
  if(channel!=="email")
    return {queued:false,reason:"production_channel_not_approved"};
  const accepted=validateBookingSubmission(payload,{now});
  if(!accepted.ok)
    return {queued:false,reason:"invalid_or_expired_booking"};
  const receipt=normalOwnerReceipt(ownerReceipt);
  if(!receipt || !receipt.ownerPdfSha256)
    return {queued:false,reason:"production_owner_receipt_missing"};
  const body=JSON.stringify({channel,
    booking:acceptedEventBooking(payload),ownerReceipt:receipt});
  if(body.length>MAX_BODY)
    return {queued:false,reason:"booking_too_large"};
  const timestamp=String(now);
  const signature=signedEvent(body,timestamp,env);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,4000));
  try{
    const response=await fetchImpl(ORIGIN+"/api/squeegee-production-auto-sync",{
      method:"POST",redirect:"error",cache:"no-store",signal:controller.signal,
      headers:{
        "Content-Type":"application/json",
        "X-NBG-Auto-Timestamp":timestamp,
        "X-NBG-Auto-Signature":signature,
      },body,
    });
    return {
      queued:response.status===202,
      reason:response.status===202?
        "queued":"production_handoff_not_accepted",
    };
  }catch{
    // The receiver might have stored a permanent receipt. NEVER retry.
    return {queued:false,reason:"production_handoff_uncertain_reconcile"};
  }finally{clearTimeout(timer);}
}
module.exports={ORIGIN,issuerConfigured,dispatchAcceptedProductionBooking};
