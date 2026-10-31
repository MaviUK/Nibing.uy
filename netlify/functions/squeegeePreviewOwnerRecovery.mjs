// Owner-only one-time recovery of a previously accepted £120 Preview 1 booking.
// Uses the original audited booking; NEVER creates a second website booking.
// No public API writes, no customer-submitted data, no released old claims.
// Protected by exact Netlify preview scope, signed owner session and CSRF.
import crypto from "node:crypto";
import {getStore} from "@netlify/blobs";
import api from "./lib/squeegeeApiV3.js";
import session from "./lib/squeegeePreviewTestSession.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import recovery from "./lib/squeegeeOwnerRecovery.js";
import stage from "./lib/squeegeeBookingStage.js";
import matcher from "./lib/squeegeeCustomerMatcher.js";
import planner from "./lib/squeegeeBookingPreparation.js";
import grouping from "./lib/squeegeeJobGrouping.js";

const PATH="/api/squeegee-preview-owner-recovery";
const BOOKING_ID=recovery.TARGET_BOOKING_ID;
const RECOVERY_STORE="squeegee-preview1-owner-recovery-status";
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
function safe(value){
  return String(value??"").replace(/&/g,"&amp;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function page(inner,status=200){
  const html='<!doctype html><html lang="en"><head>'+
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
  '<title>Owner Squeegee Recovery — NI Bin Guy</title><style>'+
  'body{margin:0;background:#0f1423;color:#f7f7fa;font:16px/1.55 system-ui,sans-serif;padding:14px}'+
  'main{max-width:620px;margin:16px auto;padding:20px;background:#252b3f;border:2px solid #f4d447}'+
  'h1{line-height:1.15;font-size:26px;margin:0 0 12px}h2{font-size:20px}'+
  'a{color:#ffe17c}button{background:#f4d447;color:#151515;border:2px solid #0c0c0c;font:inherit;font-weight:800;padding:13px;width:100%;margin:15px 0}'+
  'label{display:block;padding:10px;background:#333b50}input{width:20px;height:20px;vertical-align:middle}'+
  '.notice{background:#343d53;border-left:5px solid #f4d447;padding:12px;margin:14px 0}'+
  '.bad{border-left-color:#e7835e}li{margin:6px 0}small{color:#c9d0df}'+
  '</style></head><body><main><h1>NI Bin Guy — Squeegee Recovery</h1>'+
  inner+'<p><small>Owner-only · Preview 1 only · No changes to production or other bookings.</small></p>'+
  '</main></body></html>';
  return new Response(html,{status,headers:HEADERS});
}
function scopeFor(request,context){
  return {
    hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id,
  };
}
function sessionCookie(request){
  return session.sessionCookieFromHeader(request.headers.get("cookie"));
}
function ownerAuthenticated(request,scope){
  return session.verifyTestSessionCookie(sessionCookie(request),
    process.env,Date.now(),scope);
}
function ownerToken(request){
  return crypto.createHmac("sha256",process.env.SQUEEGEE_API_KEY)
    .update("nibinguy-preview77-owner-recovery-v1/"+BOOKING_ID+"/"+sessionCookie(request))
    .digest("hex");
}
function equalToken(a,b) {
  if(!/^[0-9a-f]{64}$/.test(String(a||"")) || !/^[0-9a-f]{64}$/.test(String(b||"")))
    return false;
  return crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function goHome(message){
  return page('<div class="notice bad">'+safe(message)+'</div>'+
    '<p><a href="'+PATH+'">Recheck this booking (read only)</a></p>',409);
}
function recoveredState(){
  return getStore({name:RECOVERY_STORE,consistency:"strong"});
}
async function previouslyRecovered() {
  const proof=await getStore({name:auto.CLAIM_STORE,consistency:"strong"})
    .get(recovery.recoveryClaimKey(),{type:"json",consistency:"strong"});
  const status=await recoveredState().get(BOOKING_ID,{type:"json",consistency:"strong"});
  return {proof,status};
}
async function loadOriginalAudit(){
  const store=getStore({name:"tos-confirmations",consistency:"strong"});
  // The original receipt is written with an ISO date prefix at acceptance.
  // Narrow to the date of this one immutable, user-requested booking.
  const {blobs}=await store.list({prefix:recovery.ORIGINAL_BOOKING_DATE+"T"});
  if(!Array.isArray(blobs) || blobs.length>200)return null;
  let result=null,matching=0;
  for(const {key} of blobs){
    if(typeof key!=="string" || !key.endsWith(".json"))continue;
    const audit=await store.get(key,{type:"json",consistency:"strong"});
    if(audit?.bookingId!==BOOKING_ID)continue;
    matching++;
    if(matching>1)return null; // Ambiguous audit must not trigger a write.
    result=audit;
  }
  return matching===1?result:null;
}
async function verifyForRecovery(){
  const claimsStore=getStore({name:auto.CLAIM_STORE,consistency:"strong"});
  const [status,oldClaim,audit,already]=await Promise.all([
    getStore({name:auto.STATUS_STORE,consistency:"strong"})
      .get(BOOKING_ID,{type:"json",consistency:"strong"}),
    claimsStore.get(auto.BOOKING_CLAIM_PREFIX+BOOKING_ID,
      {type:"json",consistency:"strong"}),
    loadOriginalAudit(),
    previouslyRecovered(),
  ]);
  if(already.proof)
    return {ok:false,reason:"Recovery already attempted. This booking is permanently locked against another automatic write.",already};
  if(!recovery.originalStatusSafe(status))
    return {ok:false,reason:"The original Squeegee status does not match the approved failed booking.",already};
  if(oldClaim?.bookingId!==BOOKING_ID || oldClaim.state!=="requires_reconciliation")
    return {ok:false,reason:"The original immutable booking claim could not be verified.",already};
  const audited=recovery.acceptedAuditPayload(audit);
  if(!audited.ok)
    return {ok:false,reason:"Could not uniquely locate the original accepted booking audit.",already};
  const b=audited.payload;
  const [council,services,jobGroups,customer]=await Promise.all([
    stage.fetchAuthoritativeSchedule(b,fetch,{timeoutMs:16000}),
    api.getServices(),api.getJobGroups(),
    matcher.matchCustomersAcrossPages(b,api.listCustomers,{maxPages:100}),
  ]);
  if(customer?.status!=="not_found")
    return {ok:false,
      reason:"Squeegee reports an existing or uncertain matching customer. No recovery write is allowed.",already};
  if(!council || !Array.isArray(services) || !Array.isArray(jobGroups))
    return {ok:false,
      reason:"The current council schedule or Squeegee service/round catalogue could not be verified.",already};
  const p=planner.prepareReadOnlyBooking(b,council,services,{jobGroups});
  if(p.status!=="prepared_read_only" ||
     p.summary?.blockedReasons?.length || !p.privatePlan)
    return {ok:false,
      reason:"An original booking date, price, service, or Squeegee round did not verify. No write is allowed.",already};
  const groups=grouping.groupedSqueegeeJobs(p.privatePlan.jobs,BOOKING_ID);
  const totals=recovery.safeAmounts(groups);
  if(!totals.ok || p.privatePlan.jobs.length!==recovery.EXPECTED_BIN_LINES)
    return {ok:false,reason:"The original £120 service and job totals did not match.",already};
  return {ok:true,booking:b,groups,customerInput:p.privatePlan.customerInput,already};
}
function detailHtml(check){
  if(!check.ok){
    let extra="";
    if(check.already?.proof) {
      const status=check.already.status;
      const label=status?.stage==="succeeded"?
        "Recovery completed":"Recovery was attempted, but needs manual review";
      extra='<p><strong>'+safe(label)+'</strong></p>'+
        (Number.isInteger(status?.jobsConfirmed)?
          '<p>Jobs confirmed: '+status.jobsConfirmed+'</p>':"");
    }
    return '<div class="notice bad"><strong>Import blocked</strong><p>'+
      safe(check.reason)+'</p></div>'+extra+
      '<p>No Squeegee write was made by viewing this page.</p>';
  }
  const bins=check.booking.bins.map(bin=>
    '<li>'+safe(bin.count)+" x "+safe(bin.type)+
    (bin.sizeLitres?" ("+bin.sizeLitres+"L)":"")+
    ' — '+safe(bin.planId)+'</li>').join("");
  const grouped=check.groups.map(group=>
    '<li>'+safe(group.input.date)+' · '+
    (group.input.frequencyType==="weeks"?"Every four weeks":"One-off")+
    ' · '+group.physicalBinCount+' physical bin(s) · £'+
    Number(group.input.price).toFixed(2)+'</li>').join("");
  return '<p>Original booking: <strong>'+BOOKING_ID+'</strong></p>'+
    '<p>Customer: <strong>'+safe(check.booking.name)+'</strong></p>'+
    '<p>Service address: '+safe(check.booking.address)+'</p>'+
    '<p>Original quoted total: <strong>£120.00</strong></p>'+
    '<h2>Original bins</h2><ul>'+bins+'</ul>'+
    '<h2>Jobs to be created in Squeegee</h2><ul>'+grouped+'</ul>'+
    '<div class="notice"><strong>Verified: no matching Squeegee customer found.</strong>'+
    '<p>Original booking, price, date and service group checks have passed. '+
    'A further read-only customer check runs immediately before the write.</p></div>';
}
async function saveStage(stage,extra={}){
  // Only fixed codes and numeric counts: no personal data or Squeegee IDs.
  return recoveredState().setJSON(BOOKING_ID,{
    bookingId:BOOKING_ID,stage,updatedAt:new Date().toISOString(),...extra,
  });
}
async function runOnce(check,request,scope){
  const store=getStore({name:auto.CLAIM_STORE,consistency:"strong"});
  const key=recovery.recoveryClaimKey();
  // Separate immutable owner recovery reservation. The original uncertain
  // claim is NEVER cleared, reset, overwritten or reused.
  const reserved=await claims.claimOnce({
    key,bookingId:BOOKING_ID,channel:"owner_recovery",store,
  });
  if(!reserved.acquired)
    return goHome("A recovery attempt already exists or could not be safely reserved. Check Squeegee; do not retry.");
  const running=await claims.changeClaimState({
    key,etag:reserved.etag,bookingId:BOOKING_ID,
    state:"request_in_progress",store,
  });
  if(!running.changed)
    return goHome("The one-time recovery reservation could not be confirmed. No Squeegee write was attempted.");
  let stageCode="authorising_squeegee_write",customerPostAttempted=false;
  let jobsConfirmed=0,jobPostAttempted=false;
  try{
    await saveStage("request_in_progress",{failureStage:stageCode,jobsConfirmed:0});
    await api.withApprovedPreviewAutomaticWrite({
      ...reserved,etag:running.etag,
    },async()=>{
      // The customer check was already performed on this POST. Repeat it
      // immediately before the one-time Squeegee customer creation.
      stageCode="rechecking_customer";
      const fresh=await matcher.matchCustomersAcrossPages(check.booking,api.listCustomers,{maxPages:100});
      if(fresh?.status!=="not_found")
        throw new Error("Customer record appeared before recovery");
      stageCode="creating_customer";
      customerPostAttempted=true;
      const created=await api.createCustomer({
        ...check.customerInput,
        notes:"Owner-verified recovery of original NI Bin Guy booking "+BOOKING_ID+
          " (Preview 1). No new website booking or charge.",
      });
      stageCode="validating_customer_result";
      const customerId=api.requireUuid(
        typeof created==="string"?created:created?._id||created?.id||created?.customerId,
        "recovered customer id"
      );
      for(const group of check.groups){
        stageCode="creating_job";
        jobPostAttempted=true;
        await api.addJobToCustomer(customerId,group.input);
        jobsConfirmed++;
      }
    },scope);
    stageCode="committing_recovery_receipt";
    const done=await claims.changeClaimState({
      key,etag:running.etag,bookingId:BOOKING_ID,state:"succeeded",store,
    });
    if(!done.changed)throw new Error("Recovery claim commit uncertain");
    await saveStage("succeeded",{jobsConfirmed,jobCount:check.groups.length});
    return page('<div class="notice"><h2>Recovery completed</h2>'+
      '<p>Customer created and <strong>'+jobsConfirmed+
      ' Squeegee job(s) confirmed</strong> for the original £120 booking.</p></div>'+
      '<p>Booking reference: <strong>'+BOOKING_ID+'</strong></p>'+
      '<p>Nothing was resubmitted to the website and the customer was not charged again.</p>');
  }catch(error){
    // NO retry. Any external POST may have been accepted despite a timeout.
    try{await claims.changeClaimState({
      key,etag:running.etag,bookingId:BOOKING_ID,
      state:"requires_reconciliation",store,
    });}catch{}
    const isAPI=error instanceof api.SqueegeeApiError ||
      error?.name==="SqueegeeApiError";
    const httpStatus=isAPI&&Number.isInteger(error?.status)?
      error.status:null;
    try{await saveStage("requires_reconciliation",{
      failureStage:stageCode,
      failureClass:isAPI?"squeegee_api":"internal_error",
      ...(httpStatus!==null?{squeegeeHttpStatus:httpStatus}:{}),
      customerPostAttempted,jobPostAttempted,
      jobsConfirmed,jobCount:check.groups.length,
    });}catch{}
    return page('<div class="notice bad"><h2>Recovery stopped — do not retry</h2>'+
      '<p>Stopped at: <strong>'+safe(stageCode)+'</strong></p>'+
      '<p>Jobs confirmed: '+jobsConfirmed+'</p>'+
      (httpStatus!==null?'<p>Squeegee HTTP status: '+httpStatus+'</p>':"")+
      '<p>Check Squeegee before making any other changes. '+
      'The one-time recovery is permanently locked.</p></div>',409);
  }
}
export default async function handler(request,context){
  const scope=scopeFor(request,context);
  if(!api.isExactPreview1(process.env,scope))
    return new Response("Not found",{status:404});
  if(!["GET","POST"].includes(request.method))
    return page("Method not allowed",405);
  if(!ownerAuthenticated(request,scope)){
    const returnPath=encodeURIComponent(PATH);
    return page('<div class="notice">Owner authentication required. No Squeegee customer or job is created by signing in.</div>'+
      '<p><a href="/api/squeegee-preview-test?returnTo='+returnPath+
      '">Email and enter your one-time owner code</a></p>',403);
  }
  if(request.method==="POST"){
    if(request.headers.get("origin")!=="https://deploy-preview-77--nibinguy.netlify.app")
      return page("Request origin could not be verified.",403);
    if(!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
      return page("Expected confirmation form.",415);
    const text=await request.text();
    if(text.length>1024)return page("Confirmation form too large.",413);
    const params=new URLSearchParams(text);
    if(params.get("bookingId")!==BOOKING_ID ||
       params.get("confirm")!=="yes" ||
       !equalToken(params.get("csrf"),ownerToken(request)))
      return page("Owner confirmation missing or invalid.",403);
  }
  let check;
  try{check=await verifyForRecovery();}
  catch {
    return goHome("The original booking audit or the latest Squeegee data could not be read. No write was attempted.");
  }
  if(request.method==="POST"){
    if(!check.ok)return goHome(check.reason);
    return runOnce(check,request,scope);
  }
  const content=detailHtml(check);
  const confirm=check.ok?'<form method="post" action="'+PATH+'">'+
    '<input type="hidden" name="bookingId" value="'+BOOKING_ID+'">'+
    '<input type="hidden" name="csrf" value="'+ownerToken(request)+'">'+
    '<label><input type="checkbox" name="confirm" value="yes" required> '+
    'I confirm that I checked Squeegee and the customer and jobs from this booking do not exist.</label>'+
    '<button type="submit">Import this original booking to Squeegee ONCE</button></form>':"";
  return page(content+confirm+
    '<p><small>No action is taken until the owner presses the import button. '+
    'After any attempted Squeegee write, automatic retries remain disabled.</small></p>');
}
export const config={
  path:"/api/squeegee-preview-owner-recovery",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
