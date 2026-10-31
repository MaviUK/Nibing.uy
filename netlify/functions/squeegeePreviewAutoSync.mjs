// Preview 1 accepted-booking event consumer. No public booking creation API.
// The only caller that can sign events is the accepted booking email/WhatsApp
// server handler. The durable per-booking receipt is written BEFORE 202.
// Writes are OFF by default until the isolated preview branch is approved.
import api from "./lib/squeegeeApiV3.js";
import dispatch from "./lib/squeegeePreviewAutoDispatch.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import guard from "./lib/bookingSubmissionGuard.js";
import rollout from "./lib/squeegeePreviewAutoRollout.js";
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";
import ownerAlerts from "./lib/squeegeeSyncOwnerAlert.js";
import terms from "./lib/termsPdf.js";

const respond=(status,data)=>new Response(JSON.stringify(data),{
  status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
  },
});
function trustedScope(request,context) {
  return {
    hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id,
  };
}
export default async function handler(request,context) {
  const scope=trustedScope(request,context);
  if(!api.isExactPreview1(process.env,scope))
    return respond(404,{error:"Not found"});
  if(request.method!=="POST")return respond(405,{error:"Method not allowed"});
  if(!dispatch.autoDispatchConfigured(process.env))
    return respond(403,{error:"Preview-only automatic Squeegee writes are not enabled"});
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return respond(415,{error:"JSON required"});
  if(typeof context?.waitUntil!=="function")
    return respond(503,{error:"Durable post-response worker unavailable"});
  let raw;
  try{raw=await request.text();}
  catch{return respond(400,{error:"Invalid request"});}
  if(!dispatch.verifyAcceptedEvent(raw,
      request.headers.get("x-nbg-auto-timestamp"),
      request.headers.get("x-nbg-auto-signature"))) {
    return respond(403,{error:"Signed, recently accepted booking required"});
  }
  let data;
  try{data=JSON.parse(raw);}
  catch{return respond(400,{error:"Invalid JSON"});}
  if(!data || !["email","whatsapp"].includes(data.channel))
    return respond(422,{error:"Invalid booking channel"});
  if(data.channel==="whatsapp" &&
     process.env.SQUEEGEE_PREVIEW_AUTO_WHATSAPP_ENABLED!=="true")
    return respond(403,{error:"WhatsApp automatic sync needs separate approval"});
  const booking=data.booking;
  if(!booking || typeof booking!=="object" || Array.isArray(booking))
    return respond(422,{error:"Invalid booking"});
  if(!rollout.acceptedForRollout(booking,data.channel,process.env))
    return respond(422,{error:"Booking not admitted for Preview 1 automatic sync"});
  const validation=guard.validateBookingSubmission(booking);
  if(!validation.ok)
    return respond(422,{error:"Missing or expired booking acceptance"});
  const bookingId=validation.bookingId;
  let statusStore,claimStore;
  try{
    statusStore=getStore({name:auto.STATUS_STORE,consistency:"strong"});
    claimStore=getStore({name:auto.CLAIM_STORE,consistency:"strong"});
  }catch{
    return respond(503,{error:"Preview booking sync storage unavailable"});
  }
  let reserved;
  try {
    reserved=await statusStore.setJSON(bookingId,{
      bookingId,stage:"accepted_for_validation",channel:data.channel,
      acceptedAt:new Date().toISOString(),jobsPlanned:null,
    },{onlyIfNew:true});
  }catch{
    return respond(503,{error:"Could not reserve booking for sync"});
  }
  if(reserved?.modified!==true || !reserved.etag) {
    return respond(409,{
      error:"Booking already queued or its sync status is uncertain; no retry",
    });
  }
  // The working normal booking sender statically imports Resend from its
  // ESM entrypoint. Inject the same transport for ALL owner notifications
  // instead of dynamically requiring Resend in CommonJS after dispatch.
  const provider=process.env.RESEND_API_KEY?
    new Resend(process.env.RESEND_API_KEY):null;
  const alertOptions=provider?{
    env:process.env,send:message=>provider.emails.send(message),
  }:{env:process.env};
  const ownerReceipt=dispatch.normalOwnerReceipt(data.ownerReceipt);
  let ownerNoticeAttempted=false;
  // A normal admin email is intentionally delayed to avoid sending BOTH a
  // normal booking receipt and a review notice for one held booking.
  const completedAlert=ownerReceipt?async(id)=>{
    ownerNoticeAttempted=true;
    let attachments;
    try {
      const pdf=await terms.buildTermsAcceptancePdfAttachment({
        name:booking.name,email:booking.email,phone:booking.phone,
        address:booking.address,binsText:ownerReceipt.binsText,
        pricingText:ownerReceipt.pricingText,
        termsAccepted:booking.termsAccepted,
        termsVersion:booking.termsVersion||"August 2026",
        termsTimestamp:booking.termsTimestamp||booking.submittedAt,
        termsAcceptanceText:booking.termsAcceptanceText||
          "I confirm I have read and agree to the NI Bin Guy Terms of Service.",
        termsBody:ownerReceipt.termsBody,
        source:booking.source||"website",
      });
      if(pdf)attachments=[pdf];
    }catch{
      // Send the complete original HTML/text booking email even if a fresh
      // owner PDF cannot be generated. Customer's PDF was already emailed.
    }
    return ownerAlerts.notifyOwnerOfCompletedBooking(id,ownerReceipt,{
      ...alertOptions,attachments,
    });
  }:null;
  const basicOwnerDetails={
    customerName:booking.name,serviceAddress:booking.address,
    customerEmail:booking.email,customerPhone:booking.phone,
    requestedBinCounts:Array.isArray(booking.bins)?
      booking.bins.map(bin=>String(Number(bin.count)||1)+" x "+
        String(bin.type||"")).slice(0,12):[],
    bookingTotal:booking.pricing?.total,
  };
  const alert=async(id,reason,details)=>{
    ownerNoticeAttempted=true;
    return ownerAlerts.notifyOwnerOfSyncHold(id,reason,details,alertOptions);
  };
  // If the worker returns before its normal held() path, the signed
  // booking STILL needs an owner-facing manual action email. Preserve a
  // PII-free status for the authenticated diagnostics and never retry writes.
  const rescueOwnerNotice=async(reason,{stage="requires_reconciliation"}={})=>{
    if(!ownerReceipt||ownerNoticeAttempted)return;
    const verifiedReason=/^[a-z][a-z0-9_]{0,100}$/.test(String(reason||""))?
      String(reason):"worker_returned_without_owner_notice";
    const uncertain=stage==="requires_reconciliation";
    const emailReason=uncertain?"requires_reconciliation":verifiedReason;
    let delivery={sent:false,reason:"owner_alert_not_attempted"};
    try{
      delivery=await alert(bookingId,emailReason,{
        ...basicOwnerDetails,
        matchReason:verifiedReason,
        firstCleanDates:Array.isArray(booking.bookingScheduleSnapshot?.results)?
          booking.bookingScheduleSnapshot.results.map(row=>
            row?.assignedCleanDate):[],
      });
    }catch{delivery={sent:false,reason:"owner_alert_exception"};}
    try{
      await auto.saveAutoStatus(bookingId,stage,{
        reason:verifiedReason,
        ownerAlertDelivery:delivery?.sent===true?"sent":"not_sent",
        ...(typeof delivery?.reason==="string" &&
          /^[a-z_]{1,80}$/.test(delivery.reason)?
            {ownerAlertReason:delivery.reason}:{}),
      },{store:statusStore});
    }catch{}
  };
  const task=auto.executeAutomaticPreviewBooking(booking,{
    channel:data.channel,runtimeScope:scope,
    deps:{
      claim:args=>claims.claimOnce({...args,store:claimStore}),
      changeState:args=>claims.changeClaimState({...args,store:claimStore}),
      save:(id,stage,extra)=>auto.saveAutoStatus(id,stage,extra,{store:statusStore}),
      alert,
      ...(completedAlert?{completedAlert}:{}),
      duplicateAlert:(id,flags)=>
        ownerAlerts.notifyOwnerOfDuplicateSignals(id,flags,alertOptions),
      quantityAlert:(id,details)=>
        ownerAlerts.notifyOwnerOfQuantityBooking(id,details,alertOptions),
    },
  }).then(async result=>{
    if(!ownerReceipt||ownerNoticeAttempted)return;
    if(result?.status==="completed"){
      // Extremely defensive fallback for a completed worker result that
      // unexpectedly skipped its ordinary owner email.
      if(completedAlert)await completedAlert(bookingId);
      return;
    }
    const stage=["held","not_started"].includes(result?.status)?
      "held_for_review":"requires_reconciliation";
    await rescueOwnerNotice(result?.reason||"worker_returned_without_owner_notice",
      {stage});
  }).catch(async()=>{
    await rescueOwnerNotice("worker_failed_unsafely_no_retry",
      {stage:"requires_reconciliation"});
    // An alert that was already attempted must never be duplicated.
    if(ownerNoticeAttempted){
      try{
        const existing=await statusStore.get(bookingId,{type:"json"});
        if(existing?.stage==="accepted_for_validation"){
          await auto.saveAutoStatus(bookingId,"requires_reconciliation",{
            reason:"worker_failed_unsafely_no_retry",
          },{store:statusStore});
        }
      }catch{}
    }
  });
  try{context.waitUntil(task);}
  catch {
    // This receipt is permanent. Do not dispatch a second Squeegee POST.
    return respond(503,{
      error:"Worker registration uncertain, do not retry automatically",
    });
  }
  return respond(202,{accepted:true,queued:true,bookingId,
    message:"Preview 1 booking queued for independently validated Squeegee sync"});
}
export const config={
  path:"/api/squeegee-preview-auto-sync",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:45},
};
