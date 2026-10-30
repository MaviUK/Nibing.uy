// Preview 1 accepted-booking event consumer. No public booking creation API.
// The only caller that can sign events is the accepted booking email/WhatsApp
// server handler. The durable per-booking receipt is written BEFORE 202.
// Writes are OFF by default until the isolated preview branch is approved.
import api from "./lib/squeegeeApiV3.js";
import dispatch from "./lib/squeegeePreviewAutoDispatch.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import guard from "./lib/bookingSubmissionGuard.js";
import {getStore} from "@netlify/blobs";

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
  const task=auto.executeAutomaticPreviewBooking(booking,{
    channel:data.channel,runtimeScope:scope,
    deps:{
      claim:args=>claims.claimOnce({...args,store:claimStore}),
      changeState:args=>claims.changeClaimState({...args,store:claimStore}),
      save:(id,stage,extra)=>auto.saveAutoStatus(id,stage,extra,{store:statusStore}),
    },
  }).catch(async()=>{
    try{await auto.saveAutoStatus(bookingId,"requires_reconciliation",
      {reason:"worker_failed_unsafely_no_retry"},{store:statusStore});}catch{}
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
