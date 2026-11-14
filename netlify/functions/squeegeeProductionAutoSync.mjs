// Production-only HMAC-signed accepted-booking event consumer.
// Never deployed to the operational live main branch until the owner approves.
// Every Squeegee POST requires a prior immutable CAS claim, a second scoped
// grant, and separate production credentials. No automatic retries.
import guard from "./lib/squeegeeProductionGuard.js";
import dispatch from "./lib/squeegeePreviewAutoDispatch.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import submission from "./lib/bookingSubmissionGuard.js";
import {createProductionClient} from "./lib/squeegeeProductionApi.js";
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";
import ownerAlerts from "./lib/squeegeeSyncOwnerAlert.js";
import ownerCertificate from "./lib/squeegeeOwnerCertificate.js";
import ownerTerms from "./lib/ownerBookingTermsSummary.js";
import playerLink from "./lib/arcadeSqueegeeLink.js";

const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
};
const respond=(status,data)=>new Response(JSON.stringify(data),{
  status,headers,
});
function trustedScope(request,context){
  return {
    hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id,
  };
}
const safeReason=value=>
  /^[a-z][a-z0-9_]{0,79}$/.test(String(value||""))?
    String(value):"production_worker_unconfirmed";
export default async function handler(request,context){
  const scope=trustedScope(request,context);
  if(!guard.isVerifiedProductionScope(scope))
    return respond(404,{error:"not_found"});
  if(request.method!=="POST")return respond(405,{error:"method_not_allowed"});
  if(!guard.productionConfigured(process.env,scope))
    return respond(503,{error:"production_squeegee_sync_disabled"});
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return respond(415,{error:"json_required"});
  if(typeof context?.waitUntil!=="function")
    return respond(503,{error:"durable_worker_not_available"});
  if(!process.env.RESEND_API_KEY)
    return respond(503,{error:"owner_alert_delivery_unavailable"});

  let raw;
  try{raw=await request.text();}
  catch{return respond(400,{error:"invalid_body"});}
  if(!guard.verifyProductionEvent(raw,
      request.headers.get("x-nbg-auto-timestamp"),
      request.headers.get("x-nbg-auto-signature"),
      {env:process.env,scope}))
    return respond(403,{error:"valid_internal_booking_signature_required"});

  let data;
  try{data=JSON.parse(raw);}catch{return respond(400,{error:"invalid_json"});}
  // WhatsApp remains OFF, independently from the email booking flow.
  if(data?.channel!=="email")
    return respond(403,{error:"production_email_bookings_only"});
  const booking=data?.booking;
  if(!booking || typeof booking!=="object" || Array.isArray(booking))
    return respond(422,{error:"invalid_booking"});
  const validation=submission.validateBookingSubmission(booking);
  if(!validation.ok)return respond(422,{error:"booking_not_current_or_valid"});
  const receipt=dispatch.normalOwnerReceipt(data.ownerReceipt);
  if(!receipt?.ownerPdfSha256)
    return respond(422,{error:"signed_owner_terms_copy_required"});
  const bookingId=validation.bookingId;

  let statusStore,claimStore,certStore,api;
  try{
    statusStore=getStore({name:guard.STATUS_STORE,consistency:"strong"});
    claimStore=getStore({name:guard.CLAIM_STORE,consistency:"strong"});
    certStore=getStore({name:guard.CERT_STORE,consistency:"strong"});
    api=createProductionClient({env:process.env,scope});
  }catch{return respond(503,{error:"production_booking_storage_unavailable"});}
  let reserved;
  try{
    reserved=await statusStore.setJSON(bookingId,{
      bookingId,channel:"email",stage:"accepted_for_validation",
      acceptedAt:new Date().toISOString(),ownerAlertDelivery:"pending",
    },{onlyIfNew:true});
  }catch{return respond(503,{error:"booking_reservation_uncertain_do_not_retry"});}
  if(reserved?.modified!==true || !reserved?.etag)
    return respond(409,{error:"booking_already_queued_or_uncertain_no_retry"});

  const provider=new Resend(process.env.RESEND_API_KEY);
  const alertOptions={
    env:process.env,
    mode:"production",
    send:message=>provider.emails.send(message),
  };
  let ownerNoticeAttempted=false;
  const alert=async(id,reason,details={})=>{
    ownerNoticeAttempted=true;
    return ownerAlerts.notifyOwnerOfSyncHold(id,reason,details,alertOptions);
  };
  const basicOwnerDetails={
    customerName:booking.name,
    serviceAddress:booking.address,
    customerEmail:booking.email,customerPhone:booking.phone,
    requestedBinCounts:(Array.isArray(booking.bins)?booking.bins:[])
      .slice(0,12).map(bin=>String(Number(bin.count)||1)+" x "+
        String(bin.type||"")),
    bookingTotal:booking.pricing?.total,
    firstCleanDates:Array.isArray(booking.bookingScheduleSnapshot?.results)?
      booking.bookingScheduleSnapshot.results.map(row=>
        row?.assignedCleanDate).slice(0,12):[],
  };
  const completedAlert=async(id,details={})=>{
    ownerNoticeAttempted=true;
    let attachments;
    try{
      const pdf=await ownerCertificate.loadCustomerCertificate(
        bookingId,receipt.ownerPdfSha256,certStore);
      attachments=[pdf];
    }catch{console.error("Production owner certificate unavailable");}
    const verifiedReceipt=ownerTerms.withActualOwnerCertificateStatus(
      receipt,Boolean(attachments?.length));
    const result=await ownerAlerts.notifyOwnerOfCompletedBooking(
      id,verifiedReceipt,{
        ...alertOptions,attachments,
        attention:{
          ...details,
          customerName:booking.name,serviceAddress:booking.address,
          customerEmail:booking.email,customerPhone:booking.phone,
        },
      });
    // Preserve an explicit undelivered owner-notice marker even when the
    // booking was successfully created in Squeegee. Never retry API writes.
    if(result?.sent!==true){
      try{
        await auto.saveAutoStatus(bookingId,"created_customer_and_jobs",{
          ownerAlertDelivery:"not_sent",
          ownerAlertReason:safeReason(result?.reason||"owner_alert_delivery_failed"),
          ownerNotificationNeedsAttention:true,
        },{store:statusStore});
      }catch{console.error("Production owner delivery failure status persistence failed");}
    }
    if(result?.sent===true && attachments?.length){
      try{await certStore.delete(bookingId);}catch{}
    }
    return result;
  };
  const rescue=async(reason,stage="requires_reconciliation")=>{
    if(ownerNoticeAttempted)return;
    let delivery={sent:false};
    try{
      delivery=await alert(bookingId,
        stage==="requires_reconciliation"?"requires_reconciliation":safeReason(reason),
        {...basicOwnerDetails,matchReason:safeReason(reason)});
    }catch{}
    try{
      await auto.saveAutoStatus(bookingId,stage,{
        reason:safeReason(reason),
        ownerAlertDelivery:delivery?.sent===true?"sent":"not_sent",
      },{store:statusStore});
    }catch{}
  };
  const run=async()=>{
    try{
      const result=await auto.executeAutomaticProductionBooking(booking,{
        channel:"email",runtimeScope:scope,env:process.env,
        deps:{
          getServices:api.getServices,
          getJobGroups:api.getJobGroups,
          listCustomers:api.listCustomers,
          getCustomer:api.getCustomer,
          createCustomer:api.createCustomer,
          addJob:api.addJobToCustomer,
          withWrite:api.withWrite,
          claim:args=>claims.claimOnce({...args,store:claimStore}),
          changeState:args=>claims.changeClaimState({...args,store:claimStore}),
          save:(id,stage,extra)=>auto.saveAutoStatus(id,stage,extra,
            {store:statusStore}),
          alert,completedAlert,
          // Only called after confirmed Squeegee jobs are committed.
          // A matching email alone never authorises a link.
          onSucceededCustomer:async({squeegeeId,booking:verifiedBooking})=>{
            const options={consistency:"strong"};
            const publicStore=getStore({name:"n64-preview-arcade-public",...options});
            const privateStore=getStore({name:"n64-preview-arcade-private",...options});
            const linkStore=getStore({name:playerLink.STORE,...options});
            const result=await playerLink.linkAcceptedSqueegeeBooking({
              squeegeeId,booking:verifiedBooking,
            },{publicStore,privateStore,linkStore});
            if(!result.linked)
              console.info("Confirmed booking player link withheld",{
                reason:result.reason,
              });
          },
        },
      });
      if(result?.status==="completed"){
        if(!ownerNoticeAttempted){
          try{await completedAlert(bookingId);}
          catch{
            // Jobs may exist: record owner delivery failure, do not rebook.
            try{await auto.saveAutoStatus(bookingId,"created_customer_and_jobs",{
              ownerAlertDelivery:"failed",
              ownerAlertReason:"owner_alert_exception",
              ownerNotificationNeedsAttention:true,
            },{store:statusStore});}catch{}
          }
        }
        return;
      }
      if(!ownerNoticeAttempted)await rescue(result?.reason||"worker_unconfirmed",
        ["held","not_started"].includes(result?.status)?
          "held_for_review":"requires_reconciliation");
    }catch{
      await rescue("production_worker_uncertain_do_not_retry");
    }
  };
  try{context.waitUntil(run());}
  catch{
    // Reservation stays permanent. The caller must NOT re-send this booking.
    return respond(503,{error:"worker_registration_uncertain_no_retry"});
  }
  return respond(202,{accepted:true,queued:true,bookingId,
    message:"Queued for independently validated production Squeegee booking"});
}
export const config={
  path:"/api/squeegee-production-auto-sync",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:45},
};
