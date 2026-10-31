// Preview #77 owner-only reconciliation. Can POST ONLY the missing one-off
// Green 1100L job after independently confirming the first £10 job exists.
// Never retries the original £55 booking or clears old Squeegee claims.
import crypto from "node:crypto";
import {getStore} from "@netlify/blobs";
import session from "./lib/squeegeePreviewTestSession.js";
import api from "./lib/squeegeeApiV3.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import matcher from "./lib/squeegeeCustomerMatcher.js";
import prepare from "./lib/squeegeeBookingPreparation.js";
import schedule from "./lib/squeegeeBookingStage.js";
import react from "./lib/squeegeeOwnerReactivation.js";
import safePartial from "./lib/squeegeePartialGreenReconciliation.js";

const BUILD="preview77-partial-green-reconciliation-v1";
const {BOOKING_ID,ACCEPTED_DAY,CLAIM_KEY,PATH}=safePartial;
const HEADERS={
 "Content-Type":"text/html; charset=utf-8",
 "Cache-Control":"private, no-store, max-age=0",
 "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
 "X-Robots-Tag":"noindex,nofollow,noarchive",
 "Content-Security-Policy":
   "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
function page(content,status=200){
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>NI Bin Guy — Partial Booking Check</title><style>'+
  'body{background:#101725;color:#fff;font:16px/1.5 system-ui,sans-serif;padding:12px}'+
  'main{max-width:650px;margin:18px auto;background:#25314b;border:2px solid #f0d34c;padding:22px}'+
  'h1{font-size:25px}h2{font-size:19px}.box{background:#35425b;padding:14px;border-left:5px solid #f0d34c;margin:18px 0}'+
  'button{width:100%;background:#f0d34c;border:0;padding:16px;font-weight:800;font-size:16px}'+
  'a{color:#ffe477}label{display:block;margin:18px 0}input{width:19px;height:19px;vertical-align:middle}'+
  'small{color:#ced4e4}</style></head><body><main>'+
  '<h1>NI Bin Guy — Partial Booking Check</h1>'+content+
  '<p><small>Build '+BUILD+' · Owner only · Preview #77 · Original booking preserved</small></p>'+
  '</main></body></html>';
 return new Response(html,{status,headers:HEADERS});
}
function scopeFor(req,context){
 return {hostname:new URL(req.url).hostname,
  deployContext:context?.deploy?.context,siteId:context?.site?.id};
}
const ownerCookie=req=>session.sessionCookieFromHeader(req.headers.get("cookie"));
const ownerOk=(req,scope)=>session.verifyTestSessionCookie(
 ownerCookie(req),process.env,Date.now(),scope);
const token=req=>crypto.createHmac("sha256",process.env.SQUEEGEE_API_KEY)
 .update("nibinguy-owner-partial-green-v1/"+BOOKING_ID+"/"+ownerCookie(req))
 .digest("hex");
function secureToken(given,req){
 if(!/^[a-f0-9]{64}$/.test(String(given||"")))return false;
 return crypto.timingSafeEqual(Buffer.from(given,"hex"),Buffer.from(token(req),"hex"));
}
const ledger=()=>getStore({name:auto.CLAIM_STORE,consistency:"strong"});
const statusStore=()=>getStore({name:auto.STATUS_STORE,consistency:"strong"});
const resultStore=()=>getStore({name:"squeegee-preview1-partial-green-outcome",consistency:"strong"});
async function uniqueAudit(){
 const auditStore=getStore({name:"tos-confirmations",consistency:"strong"});
 let record=null,count=0,scanned=0,pages=0;
 for(const day of [ACCEPTED_DAY,"2026-11-01"]){
  for await(const response of auditStore.list({prefix:day+"T",paginate:true})){
   if(++pages>10 || !Array.isArray(response?.blobs))return null;
   for(const blob of response.blobs){
    if(++scanned>750)return null;
    if(!String(blob?.key||"").endsWith(".json"))continue;
    const item=await auditStore.get(blob.key,{type:"json",consistency:"strong"});
    if(item?.bookingId===BOOKING_ID){record=item;count++;}
    if(count>1)return null;
   }
  }
 }
 return count===1?record:null;
}
async function preflight(){
 const store=ledger();
 const [status,originalClaim,reactivationClaim,partialClaim,audit]=await Promise.all([
  statusStore().get(BOOKING_ID,{type:"json",consistency:"strong"}),
  store.get(auto.BOOKING_CLAIM_PREFIX+BOOKING_ID,{type:"json",consistency:"strong"}),
  store.get(react.recoveryKey(BOOKING_ID),{type:"json",consistency:"strong"}),
  store.get(CLAIM_KEY,{type:"json",consistency:"strong"}),
  uniqueAudit(),
 ]);
 if(partialClaim)return {ok:false,reason:
  partialClaim.state==="succeeded"?"This one-time Green job has already been imported. No further processing is available.":
   "The one-time Green job recovery was attempted or reserved. Do not retry."};
 if(!safePartial.partialStatusSafe(status,originalClaim,reactivationClaim,partialClaim))
  return {ok:false,reason:"The original partial-import status could not be verified; automatic recovery remains blocked."};
 const accepted=react.auditedBooking(audit,BOOKING_ID,ACCEPTED_DAY);
 if(!accepted.ok)return {ok:false,reason:"The original customer-approved booking audit could not be verified."};
 const b=accepted.booking;
 const [calendar,services,groups,match]=await Promise.all([
   schedule.fetchAuthoritativeSchedule(b,fetch,{timeoutMs:16000}),
   api.getServices(),api.getJobGroups(),
   matcher.matchCustomersAcrossPages(b,api.listCustomers,{maxPages:100}),
 ]);
 if(match?.status!=="matched" ||
    !["exact_property_and_name","exact_property_and_contact","external_reference"]
       .includes(match.reason))
  return {ok:false,reason:"An existing Squeegee customer could not be uniquely matched."};
 const customer=await api.getCustomer(match.customerId);
 if(!react.exactActiveCustomer(customer,b))
  return {ok:false,reason:"The matching Squeegee customer is not active or verified."};
 const prepared=prepare.prepareReadOnlyBooking(b,calendar,services,{jobGroups:groups});
 const selected=safePartial.approvedGroups(audit,prepared);
 if(!selected)return {ok:false,reason:"Original services, dates, round or £55 pricing could not be reverified."};
 const jobs=safePartial.inspectJobs(customer.jobs,selected.first,selected.missing);
 if(!jobs.ok)return {ok:false,reason:jobs.reason};
 return {ok:true,booking:b,customerId:match.customerId,
   first:selected.first,missing:selected.missing};
}
function blocked(msg){
 return page('<div class="box"><h2>Import not started</h2><p>'+esc(msg)+'</p></div>'+
  '<p>Nothing was sent by this check. Review the Squeegee jobs before any manual changes.</p>',409);
}
async function saveOutcome(stage,extra={}){
 try{await resultStore().setJSON(BOOKING_ID,{
  bookingId:BOOKING_ID,stage,updatedAt:new Date().toISOString(),...extra,
 });}catch{}
}
async function submitOnce(check,scope){
 const store=ledger();
 const reserved=await claims.claimOnce({
  key:CLAIM_KEY,bookingId:BOOKING_ID,channel:"owner_partial_reconciliation",store,
 });
 if(!reserved.acquired)return blocked("This one-time import has already been reserved.");
 const started=await claims.changeClaimState({
  key:CLAIM_KEY,etag:reserved.etag,bookingId:BOOKING_ID,
  state:"request_in_progress",store,
 });
 if(!started.changed)return blocked("The claim could not be securely confirmed. No job was submitted.");
 await saveOutcome("request_in_progress");
 let postSucceeded=false,errorClass="internal";
 try{
  await api.withApprovedPreviewPartialGreenWrite({...reserved,etag:started.etag},
   async()=>{
    const current=await api.getCustomer(check.customerId);
    if(!react.exactActiveCustomer(current,check.booking))throw new Error("customer_changed");
    const proof=safePartial.inspectJobs(current.jobs,check.first,check.missing);
    if(!proof.ok)throw new Error("squeegee_jobs_changed");
    await api.addJobToCustomer(check.customerId,check.missing.input);
    postSucceeded=true;
   },scope);
 }catch(error){
  errorClass=error?.name==="SqueegeeApiError"?"squeegee_api":"internal";
 }
 let settled=false;
 try{
  settled=(await claims.changeClaimState({
    key:CLAIM_KEY,etag:started.etag,bookingId:BOOKING_ID,
    state:postSucceeded?"succeeded":"requires_reconciliation",store,
  })).changed===true;
 }catch{}
 await saveOutcome(postSucceeded&&settled?"succeeded":"requires_reconciliation",{
  jobPostAccepted:postSucceeded,failureClass:postSucceeded?"none":errorClass,
 });
 if(postSucceeded&&settled)
  return page('<div class="box"><h2>Missing Green job imported</h2>'+
   '<p>The original £45 Green Bin (1100L) one-off job was added to '+
   'Gavin’s existing Squeegee customer for 17 November 2026.</p>'+
   '<p>The existing £10 four-weekly Black + Brown job and customer number were unchanged.</p></div>');
 return page('<div class="box"><h2>Recovery stopped — do not retry</h2>'+
  '<p>The job may have been accepted by Squeegee without a confirmed record, '+
  'or a safety check failed. Check the existing customer before any further action.</p>'+
  '<p>This one-time attempt is permanently locked.</p></div>',409);
}
export default async function handler(request,context){
 const scope=scopeFor(request,context);
 if(!api.isExactPreview1(process.env,scope))return new Response("Not found",{status:404});
 if(!["GET","POST"].includes(request.method))return page("Method not allowed",405);
 if(!ownerOk(request,scope)){
  return page('<div class="box">Owner verification is required before viewing '+
   'or processing this booking. Opening the link never writes to Squeegee.</div>'+
   '<p><a href="/api/squeegee-preview-test?returnTo='+
   encodeURIComponent(PATH)+'">Email me an owner access code</a></p>',403);
 }
 if(request.method==="POST"){
  if(!request.headers.get("content-type")?.toLowerCase()
     .startsWith("application/x-www-form-urlencoded"))return page("Invalid form",415);
  const raw=await request.text();
  if(raw.length>1024)return page("Form too large",413);
  const input=new URLSearchParams(raw);
  if(input.get("bookingId")!==BOOKING_ID ||
     input.get("confirm")!=="yes" || !secureToken(input.get("csrf"),request))
   return page("Owner confirmation invalid",403);
 }
 let check;
 try{check=await preflight();}
 catch{return blocked("Read-only status, Squeegee or audit verification could not be completed.");}
 if(!check.ok)return blocked(check.reason);
 if(request.method==="POST")return submitOnce(check,scope);
 return page('<p><strong>Booking:</strong> '+BOOKING_ID+'</p>'+
  '<p><strong>Customer:</strong> '+esc(check.booking.name)+'</p>'+
  '<p><strong>Address:</strong> '+esc(check.booking.address)+'</p>'+
  '<div class="box"><h2>Reconciled with Squeegee</h2>'+
  '<p>Confirmed existing job: Black + Brown, 4-weekly, £10 — 17 November 2026.</p>'+
  '<p><strong>Missing job:</strong> Green Bin 1100L, one-off, £45 — 17 November 2026.</p>'+
  '<p>No new customer or changes to the first job are required.</p></div>'+
  '<form method="post" action="'+PATH+'">'+
  '<input type="hidden" name="bookingId" value="'+BOOKING_ID+'">'+
  '<input type="hidden" name="csrf" value="'+token(request)+'">'+
  '<label><input type="checkbox" name="confirm" value="yes" required> '+
  'I have checked Squeegee and confirm the £45 Green 1100L job is not already present.</label>'+
  '<button type="submit">Add ONLY the missing £45 Green job ONCE</button></form>'+
  '<p><small>A new one-time recovery claim is reserved immediately before the '+
  'write. The original booking and recovery claims are not reset.</small></p>');
}
export const config={
 path:"/api/squeegee-preview-partial-green-reconciliation",
 rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10},
};
