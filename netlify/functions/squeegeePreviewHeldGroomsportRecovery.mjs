// Preview 77 only: one-time owner-confirmed automatic recovery of an
// existing £15 Blue one-off booking held before Squeegee POSTs.
import crypto from "node:crypto";
import {getStore} from "@netlify/blobs";
import session from "./lib/squeegeePreviewTestSession.js";
import api from "./lib/squeegeeApiV3.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import stage from "./lib/squeegeeBookingStage.js";
import matcher from "./lib/squeegeeCustomerMatcher.js";
import prepare from "./lib/squeegeeBookingPreparation.js";
import recovery from "./lib/squeegeeHeldGroomsportRecovery.js";

const BUILD="groomsport-held-recovery-2026-10-31-v1";
const {BOOKING_ID,PATH,RECOVERY_CLAIM}=recovery;
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
function escape(value) {
  return String(value??"").replace(/&/g,"&amp;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function page(body,status=200){
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>NI Bin Guy — Existing Customer Recovery</title><style>'+
    'body{margin:0;background:#101625;color:#fff;font:16px/1.55 system-ui,sans-serif;padding:12px}'+
    'main{max-width:610px;margin:18px auto;border:2px solid #f5d34d;background:#252c40;padding:22px}'+
    'h1{font-size:24px;line-height:1.2}h2{font-size:19px}'+
    'a{color:#ffdf69}.note{padding:14px;background:#343e54;border-left:5px solid #f5d34d}'+
    'button{display:block;width:100%;padding:15px;margin:14px 0;border:0;background:#f5d34d;font-weight:bold;font-size:16px}'+
    'label{display:block;padding:10px 4px}input{width:18px;height:18px;vertical-align:middle}'+
    'small{color:#bec6d8}</style></head><body><main><h1>NI Bin Guy — Squeegee Recovery</h1>'+
    body+'<p><small>Build '+BUILD+' · Preview #77 only · Original booking preserved</small></p>'+
    '</main></body></html>',{status,headers:HEADERS});
}
function scopeOf(request,context) {
  return {hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
}
function ownerCookie(request) {
  return session.sessionCookieFromHeader(request.headers.get("cookie"));
}
function ownerIsAuthenticated(request,scope) {
  return session.verifyTestSessionCookie(ownerCookie(request),
    process.env,Date.now(),scope);
}
function confirmationToken(request) {
  return crypto.createHmac("sha256",process.env.SQUEEGEE_API_KEY)
    .update("owner-held-groomsport-recovery-v1/"+BOOKING_ID+"/"+ownerCookie(request))
    .digest("hex");
}
function validToken(input,request){
  const expected=confirmationToken(request);
  if(!/^[a-f0-9]{64}$/.test(String(input||"")))return false;
  return crypto.timingSafeEqual(Buffer.from(input,"hex"),
    Buffer.from(expected,"hex"));
}
const claimsStore=()=>getStore({name:auto.CLAIM_STORE,consistency:"strong"});
const statusStore=()=>getStore({name:auto.STATUS_STORE,consistency:"strong"});
const recoveryStore=()=>getStore({
  name:"squeegee-preview1-owner-held-recovery-status",consistency:"strong",
});
async function originalAudit() {
  const store=getStore({name:"tos-confirmations",consistency:"strong"});
  const {blobs,pagination}=await store.list({prefix:recovery.ACCEPTED_DAY+"T"});
  if(!Array.isArray(blobs)||blobs.length>200 ||
     pagination?.next_cursor || pagination?.nextCursor)return null;
  let found=null,count=0;
  for(const {key} of blobs){
    if(typeof key!=="string"||!key.endsWith(".json"))continue;
    const data=await store.get(key,{type:"json",consistency:"strong"});
    if(data?.bookingId===BOOKING_ID){count++;found=data;}
    if(count>1)return null;
  }
  return count===1?found:null;
}
async function preflight() {
  const ledger=claimsStore();
  const [status,originalClaim,oneUseClaim,audit]=await Promise.all([
    statusStore().get(BOOKING_ID,{type:"json",consistency:"strong"}),
    ledger.get(auto.BOOKING_CLAIM_PREFIX+BOOKING_ID,
      {type:"json",consistency:"strong"}),
    ledger.get(RECOVERY_CLAIM,{type:"json",consistency:"strong"}),
    originalAudit(),
  ]);
  if(oneUseClaim)return {ok:false,reason:"Recovery already attempted; no further automatic imports are permitted."};
  if(!recovery.heldBeforeAnyWrite(status,originalClaim,oneUseClaim))
    return {ok:false,reason:"Booking is not held safely before the Squeegee write. Do not retry."};
  const accepted=recovery.acceptedAudit(audit);
  if(!accepted.ok)
    return {ok:false,reason:"The original accepted booking could not be uniquely verified."};
  const b=accepted.booking;
  const [schedule,services,groups,match]=await Promise.all([
    stage.fetchAuthoritativeSchedule(b,fetch,{timeoutMs:16000}),
    api.getServices(),api.getJobGroups(),
    matcher.matchCustomersAcrossPages(b,api.listCustomers,{maxPages:100}),
  ]);
  if(match?.status!=="matched" ||
     !["exact_property_and_name","exact_property_and_contact","external_reference"]
       .includes(match.reason))
    return {ok:false,reason:"The existing Squeegee customer could not be uniquely matched."};
  const customer=await api.getCustomer(match.customerId);
  if(!recovery.existingCustomerMatches(customer,b))
    return {ok:false,reason:"Squeegee customer details/address did not verify."};
  const planned=prepare.prepareReadOnlyBooking(b,schedule,services,{jobGroups:groups});
  if(!recovery.validPreparedPlan(planned))
    return {ok:false,reason:"The original 10 November date, price, service or round could not be verified."};
  const serviceId=planned.privatePlan.jobs[0].input.services[0];
  if(!recovery.existingJobsSafe(customer.jobs,serviceId))
    return {ok:false,reason:"A matching job may already exist; do not duplicate it."};
  return {ok:true,booking:b,customerId:match.customerId,
    serviceId,
    firstClean:planned.privatePlan.jobs[0].date,
    price:planned.privatePlan.jobs[0].input.price,
    originalAcceptedAt:Date.parse(b.submittedAt),
    duplicateFlags:match.duplicateFlags||[]};
}
async function saveResult(stage,extras={}){
  try{
    await recoveryStore().setJSON(BOOKING_ID,{
      bookingId:BOOKING_ID,stage,updatedAt:new Date().toISOString(),...extras,
    });
  }catch{}
}
function blocked(message) {
  return page('<div class="note"><h2>Import not started</h2><p>'+
    escape(message)+'</p></div><p><a href="'+PATH+'">Recheck status (read-only)</a></p>',409);
}
async function resumeOnce(check,scope){
  const ledger=claimsStore();
  const reserved=await claims.claimOnce({
    key:RECOVERY_CLAIM,bookingId:BOOKING_ID,
    channel:"owner_recovery",store:ledger,
  });
  if(!reserved.acquired)
    return blocked("One-time recovery was already reserved or could not be safely locked.");
  const started=await claims.changeClaimState({
    key:reserved.key,etag:reserved.etag,bookingId:BOOKING_ID,
    state:"request_in_progress",store:ledger,
  });
  if(!started.changed)
    return blocked("The one-time recovery reservation could not be confirmed; nothing was sent.");
  await saveResult("request_in_progress");
  let result;
  try {
    // Original submission timestamp comes from the accepted server audit.
    // Only this owner-approved recovered event uses its accepted time when
    // checking the 15-minute original-submission validity. The original
    // booking reference, price and date are NEVER replaced or fabricated.
    // The present-day date is separately validated in validPreparedPlan.
    result=await auto.executeAutomaticPreviewBooking(check.booking,{
      channel:"email",runtimeScope:scope,
      now:check.originalAcceptedAt,
      deps:{
        claim:args=>claims.claimOnce({...args,store:ledger}),
        changeState:args=>claims.changeClaimState({...args,store:ledger}),
        save:(id,stage,extra)=>auto.saveAutoStatus(id,stage,extra,
          {store:statusStore()}),
        // This owner recovery can ONLY append a job to the verified
        // pre-existing Squeegee customer. A changed match must fail closed.
        createCustomer:async()=>{
          throw new Error("owner_recovery_new_customer_not_permitted");
        },
        getCustomer:async id=>{
          if(id!==check.customerId)throw new Error("recovery_customer_changed");
          const current=await api.getCustomer(id);
          if(!recovery.existingCustomerMatches(current,check.booking) ||
             !recovery.existingJobsSafe(current.jobs,check.serviceId))
            throw new Error("existing_customer_or_jobs_changed");
          return current;
        },
        addJob:async(id,input)=>{
          if(id!==check.customerId)
            throw new Error("recovery_job_target_changed");
          // A final GET prevents a recently added matching job being
          // duplicated between the page check and the external POST.
          const latest=await api.getCustomer(id);
          if(!recovery.existingCustomerMatches(latest,check.booking) ||
             !recovery.existingJobsSafe(latest.jobs,check.serviceId))
            throw new Error("existing_job_appeared_during_recovery");
          return api.addJobToCustomer(id,input);
        },
      },
    });
  }catch{
    result={status:"requires_reconciliation",reason:"owner_recovery_worker_exception"};
  }
  const good=result?.status==="completed" &&
    result.createdCustomer===false && result.createdJobs===1;
  await claims.changeClaimState({
    key:RECOVERY_CLAIM,etag:started.etag,bookingId:BOOKING_ID,
    state:good?"succeeded":"requires_reconciliation",store:ledger,
  });
  await saveResult(good?"succeeded":"requires_reconciliation",{
    resultStatus:typeof result?.status==="string"?result.status:"unknown",
    reason:/^[a-z][a-z0-9_]{0,90}$/.test(String(result?.reason||""))?
      result.reason:"unspecified",
    createdCustomer:result?.createdCustomer===true,
    jobsConfirmed:good?1:0,
  });
  if(good)
    return page('<div class="note"><h2>Job imported successfully</h2>'+
      '<p><strong>One £15 Blue Bin job</strong> was added to Gavin’s existing Squeegee account.</p>'+
      '<p>First clean: 10 November 2026 · One-off</p></div>'+
      '<p>No new customer was created. The original booking reference is unchanged.</p>');
  return page('<div class="note"><h2>Recovery stopped — do not retry</h2>'+
    '<p>Result: '+escape(result?.status||"unknown")+'</p>'+
    '<p>Reason: '+escape(result?.reason||"unconfirmed")+'</p>'+
    '<p>A job may have been created if Squeegee returned an uncertain result. '+
    'Check the existing customer before making any further changes.</p></div>',409);
}
export default async function handler(request,context){
  const scope=scopeOf(request,context);
  if(!api.isExactPreview1(process.env,scope))
    return new Response("Not found",{status:404});
  if(!["GET","POST"].includes(request.method))
    return page("Method not allowed",405);
  if(!ownerIsAuthenticated(request,scope))
    return page('<p>Owner authentication is required before any Squeegee recovery.</p>'+
      '<p><a href="/api/squeegee-preview-test?returnTo='+
      encodeURIComponent(PATH)+'">Enter owner email access code</a></p>',403);
  if(request.method==="POST"){
    if(!request.headers.get("content-type")?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded"))
      return page("Invalid confirmation form",415);
    const raw=await request.text();
    if(raw.length>1024)return page("Confirmation form too large",413);
    const form=new URLSearchParams(raw);
    if(form.get("bookingId")!==BOOKING_ID ||
       form.get("confirm")!=="yes" ||
       !validToken(form.get("csrf"),request))
      return page("Owner confirmation missing or invalid",403);
  }
  let check;
  try{check=await preflight();}
  catch{
    return blocked("A read-only Squeegee or booking-status check failed. No write was attempted.");
  }
  if(!check.ok)return blocked(check.reason);
  if(request.method==="POST")return resumeOnce(check,scope);
  const html='<p><strong>Original booking:</strong> '+escape(BOOKING_ID)+'</p>'+
    '<p><strong>Existing customer:</strong> Gavin — 78 Groomsport Road, Bangor</p>'+
    '<p><strong>Requested:</strong> One additional Blue Bin · One-off · £15</p>'+
    '<p><strong>First clean:</strong> '+escape(check.firstClean)+'</p>'+
    '<div class="note"><strong>Verified:</strong> The existing Squeegee account matches. '+
    'No separate customer will be created, and no previously confirmed job '+
    'for this booking was found in the available job details.</div>'+
    '<form method="post" action="'+PATH+'">'+
    '<input type="hidden" name="bookingId" value="'+BOOKING_ID+'">'+
    '<input type="hidden" name="csrf" value="'+confirmationToken(request)+'">'+
    '<label><input type="checkbox" name="confirm" value="yes" required> '+
    'I confirm the additional Blue Bin job is not already in Squeegee.</label>'+
    '<button type="submit">Add original £15 job to existing customer ONCE</button></form>'+
    '<p><small>This does not resubmit the website form or change the customer number. '+
    'A single attempted import permanently locks this recovery.</small></p>';
  return page(html);
}
export const config={
  path:"/api/squeegee-preview-held-groomsport-recovery",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
