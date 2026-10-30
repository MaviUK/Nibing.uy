// PREVIEW 1 / PR 77 ONLY. Recovery of one previously accepted owner booking.
// GET is read-only. POST requires a fresh signed owner session, same-origin
// user action, successful rechecks, and an immutable one-use receipt.
// No new booking email, leaderboard claim or Squeegee retry is performed here.
import session from "./lib/squeegeePreviewTestSession.js";
import controlled from "./lib/squeegeeOneBookingTest.js";
import recovery from "./lib/squeegeeAcceptedBookingRecovery.js";
import api from "./lib/squeegeeApiV3.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import {getStore} from "@netlify/blobs";

const TARGET=recovery.RECOVERY_BOOKING_ID;
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const safe=value=>String(value??"")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const mainStart='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Recover original Squeegee test - NI Bin Guy</title>'+
  '<style>body{background:#10121c;color:#f8f8fa;padding:20px 12px;font:16px/1.5 system-ui,sans-serif}'+
  'main{max-width:560px;margin:16px auto;padding:24px;background:#222638;border:2px solid #f5dd51}'+
  'h1{font-size:25px;line-height:1.2}p{margin:12px 0}'+
  'button{display:block;width:100%;padding:14px;margin:20px 0;background:#f5dd51;color:#111;border:2px solid #111;font:800 17px system-ui;cursor:pointer}'+
  '.notice{background:#333b51;border-left:4px solid #f5dd51;padding:10px 14px}a{color:#f5dd51}'+
  'small{color:#d2d5e1}</style></head><body><main><h1>NI Bin Guy - Original test recovery</h1>';
const end='<p><small>Preview 1 only. No automatic imports, no duplicate booking emails or XP. Production and Preview 2 unchanged.</small></p></main></body></html>';
function page(body,status=200) {
  return new Response(mainStart+body+end,{status,headers:HEADERS});
}
function scope(request,context) {
  return {hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
}
function ownerAuthenticated(request,context) {
  const runtime=scope(request,context);
  return session.verifyTestSessionCookie(
    session.sessionCookieFromHeader(request.headers.get("cookie")),
    process.env,Date.now(),runtime);
}
function stores() {
  return {
    auditStore:getStore({name:"tos-confirmations",consistency:"strong"}),
    statusStore:getStore({name:controlled.STATUS_STORE,consistency:"strong"}),
    claimsStore:getStore({name:"squeegee-preview1-write-claims",consistency:"strong"}),
  };
}
function recoveryPage(result) {
  if(!result?.ready) {
    let reasons=Array.isArray(result?.blockedReasons)?
      result.blockedReasons.concat(result.heldDates||[]):[];
    reasons=reasons.slice(0,8).map(safe);
    return page('<div class="notice"><strong>Recovery is on hold.</strong>'+
      '<p>Reason: '+safe(result?.reason||"read_only_check_unavailable")+'</p>'+
      (reasons.length?'<p>Checks: '+reasons.join(", ")+'</p>':"")+
      '<p>No Squeegee customer or job was created by this check. Do not submit another website booking.</p></div>'+
      '<p><a href="/api/squeegee-preview-test?bookingId='+TARGET+'">Back to original status</a></p>');
  }
  return page('<div class="notice"><strong>Read-only checks passed</strong>'+
    '<p>Original accepted booking: '+TARGET+'</p>'+
    '<p>First clean: <strong>'+safe(result.firstClean)+'</strong></p>'+
    '<p>Squeegee round: <strong>'+safe(result.round)+'</strong></p>'+
    '<p>Plan: exactly one domestic bin, <strong>£5 every four weeks</strong></p>'+
    '<p>Existing Squeegee customer: <strong>not found across '+safe(result.pagesScanned)+' pages</strong></p>'+
    '<p>One-use test reservation: not found</p></div>'+
    '<p>This will create <strong>ONE real TEST API customer and ONE real recurring job</strong> in Squeegee.'+
    ' It will not submit another booking, send emails or award leaderboard points.'+
    ' Do not dispatch, invoice or clean the test record; inspect and remove it afterwards.</p>'+
    '<form method="post">'+
    '<input type="hidden" name="action" value="confirm-original">'+
    '<button type="submit">Create ONE Squeegee test customer + job</button></form>'+
    '<p><small>Only press once. A missing or ambiguous result must be reconciled, never retried.</small></p>'+
    '<p><a href="/api/squeegee-preview-test?bookingId='+TARGET+'">Back without creating anything</a></p>');
}
export default async function handler(request,context) {
  const runtime=scope(request,context);
  if(!api.isExactPreview1(process.env,runtime) ||
     !process.env.SQUEEGEE_API_KEY) {
    return new Response("Not found",{status:404});
  }
  if(!ownerAuthenticated(request,context)) {
    return page('<div class="notice">Owner session expired or not authorised.'+
      ' Return to the owner test page, request a fresh email code if necessary,'+
      ' then open original booking recovery again.</div>'+
      '<p><a href="/api/squeegee-preview-test?bookingId='+TARGET+'">Owner test page</a></p>',403);
  }
  if(request.method!=="GET" && request.method!=="POST")
    return new Response("Method not allowed",{status:405});

  if(request.method==="POST") {
    // SameSite=Strict session cookie plus exact Origin protect the write
    // against cross-site form submissions. No arbitrary customer data is sent.
    if(request.headers.get("origin")!=="https://"+runtime.hostname)
      return page("<p>Same-origin authorisation required. No records changed.</p>",403);
    if(!request.headers.get("content-type")?.toLowerCase()
       .startsWith("application/x-www-form-urlencoded"))
      return page("<p>Invalid form. No records changed.</p>",415);
    let body;
    try{body=await request.formData();}
    catch{return page("<p>Invalid form. No records changed.</p>",400);}
    if(body.get("action")!=="confirm-original" || [...body.keys()].length!==1)
      return page("<p>Unexpected request. No records changed.</p>",403);
    if(typeof context?.waitUntil!=="function")
      return page("<p>Reliable worker unavailable. No Squeegee records changed.</p>",503);
  }

  let storage;
  try{storage=stores();}
  catch{return page("<p>Secure test storage unavailable. No records changed.</p>",503);}
  let checked;
  try{checked=await recovery.inspectAcceptedBooking(TARGET,storage);}
  catch(error){
    console.error("Preview 1 accepted-booking recovery preflight failed",
      error?.name||"unknown");
    return page("<p>Recovery preflight failed safely. No Squeegee records changed.</p>",503);
  }
  if(request.method==="GET")return recoveryPage(checked);
  if(!checked.ready)return recoveryPage(checked);

  // A durable, permanent receipt is written BEFORE responding to the owner.
  // onlyIfNew prevents simultaneous taps and preserves uncertain outcomes.
  let receipt;
  try {
    receipt=await storage.statusStore.setJSON(TARGET,{
      bookingId:TARGET,stage:"original_recovery_queued",
      updatedAt:new Date().toISOString(),
    },{onlyIfNew:true});
  }catch{return page("<p>Could not reserve test. No Squeegee write attempted.</p>",503);}
  if(receipt?.modified!==true || !receipt.etag) {
    return page('<div class="notice"><strong>The original booking has already been queued or its state is uncertain.</strong>'+
      ' Do not press again.</div>'+
      '<p><a href="/api/squeegee-preview-test?bookingId='+TARGET+'">Check existing status</a></p>',409);
  }

  const task=controlled.executeOneApprovedTestBooking(checked.booking,{
    cookieHeader:request.headers.get("cookie")||"",
    channel:"email",runtimeScope:runtime,
    deps:{
      claim:args=>claims.claimOnce({...args,store:storage.claimsStore}),
      changeState:args=>claims.changeClaimState({...args,store:storage.claimsStore}),
      save:(bookingId,stage,extra)=>controlled.saveTestStatus(
        bookingId,stage,extra,{store:storage.statusStore}),
    },
  }).catch(async error=>{
    console.error("Preview 1 original recovery worker exception",
      error?.name||"unknown");
    try{await controlled.saveTestStatus(TARGET,"requires_reconciliation",
      {reason:"uncertain_recovery_worker_result"},
      {store:storage.statusStore});}catch{}
  });
  try{context.waitUntil(task);}
  catch(error){
    console.error("Preview 1 original recovery worker registration failed",
      error?.name||"unknown");
    return page('<p>The worker result is uncertain. Do not retry. Check existing status.</p>',503);
  }
  return new Response(null,{status:303,headers:{
    "Location":"/api/squeegee-preview-test?bookingId="+TARGET,
    "Cache-Control":"no-store",
    "Referrer-Policy":"no-referrer",
  }});
}
export const config={
  path:"/api/squeegee-preview-recover-original",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:8},
};