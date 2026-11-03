// Preview 77 only: owner-approved, one-time reuse of a held booking AFTER
// the owner manually reactivates the existing customer in Squeegee.
// Clicking/opening the email link is GET-only; no Squeegee writes on GET.
import crypto from "node:crypto";
import {getStore} from "@netlify/blobs";
import api from "./lib/squeegeeApiV3.js";
import session from "./lib/squeegeePreviewTestSession.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import matcher from "./lib/squeegeeCustomerMatcher.js";
import stage from "./lib/squeegeeBookingStage.js";
import prepare from "./lib/squeegeeBookingPreparation.js";
import reactivate from "./lib/squeegeeOwnerReactivation.js";
import ownerLink from "./lib/squeegeeOwnerReviewLink.js";

const PATH="/api/squeegee-preview-owner-reactivation";
const BUILD="preview77-owner-reactivation-v1";
const CLAIM_STORE=auto.CLAIM_STORE;
const STATUS_STORE=auto.STATUS_STORE;
const OUTCOME_STORE="squeegee-preview1-owner-reactivation-status";
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
function safe(v){
  return String(v??"").replace(/&/g,"&amp;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function page(content,status=200){
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>NI Bin Guy — Reactivated Booking</title><style>'+
    'body{margin:0;background:#10182c;color:#fff;font:16px/1.55 system-ui,sans-serif;padding:14px}'+
    'main{max-width:620px;margin:15px auto;padding:24px;background:#25314a;border:2px solid #f0d149}'+
    'h1{font-size:26px;line-height:1.2}h2{font-size:20px}'+
    '.notice{background:#35425c;padding:13px;border-left:5px solid #f0d149;margin:14px 0}'+
    'button{background:#f0d149;color:#151819;border:0;padding:15px;font-weight:800;font-size:16px;width:100%;margin:16px 0}'+
    'a{color:#ffe070}label{display:block;padding:12px}input{vertical-align:middle;width:20px;height:20px}'+
    'small{color:#c6ccda}li{margin:6px 0}</style></head><body><main>'+
    '<h1>NI Bin Guy — Resume Booking</h1>'+content+
    '<p><small>Build '+BUILD+' · Owner only · N64 preview #77 · No live-site changes</small></p>'+
    '</main></body></html>';
  return new Response(html,{status,headers:HEADERS});
}
function scopeFor(request,context){
  return {hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
}
function ownerCookie(request){
  return session.sessionCookieFromHeader(request.headers.get("cookie"));
}
function signedOwner(request,scope){
  return session.verifyTestSessionCookie(ownerCookie(request),
    process.env,Date.now(),scope);
}
function token(request,id,day){
  return crypto.createHmac("sha256",process.env.SQUEEGEE_API_KEY)
    .update("nibinguy-reactivation-v1/"+id+"/"+day+"/"+ownerCookie(request))
    .digest("hex");
}
function secureEqual(input,expected){
  if(!/^[a-f0-9]{64}$/.test(String(input||"")))return false;
  return crypto.timingSafeEqual(Buffer.from(input,"hex"),
    Buffer.from(expected,"hex"));
}
const claimsStore=()=>getStore({name:CLAIM_STORE,consistency:"strong"});
const statusStore=()=>getStore({name:STATUS_STORE,consistency:"strong"});
const outcomeStore=()=>getStore({name:OUTCOME_STORE,consistency:"strong"});
async function originalAudit(id,day){
  const store=getStore({name:"tos-confirmations",consistency:"strong"});
  const days=[day,new Date(Date.parse(day+"T00:00:00Z")+86400000)
    .toISOString().slice(0,10)];
  let found=null,count=0,scanned=0;
  for(const targetDay of days){
    let pages=0;
    // Netlify Blobs list({paginate:true}) exposes an async iterator.
    // Do not assume the initial (possibly partial) listing is complete:
    // an unknown audit page must NEVER authorise a Squeegee write.
    for await(const response of store.list({
      prefix:targetDay+"T",paginate:true,
    })){
      if(++pages>10 || !Array.isArray(response?.blobs))return null;
      for(const item of response.blobs){
        scanned++;
        if(scanned>750)return null;
        if(!String(item?.key||"").endsWith(".json"))continue;
        const audit=await store.get(item.key,{
          type:"json",consistency:"strong",
        });
        if(audit?.bookingId!==id)continue;
        if(++count>1)return null;
        found=audit;
      }
    }
  }
  return count===1?found:null;
}
async function preflight(id,day){
  const store=claimsStore();
  const [status,oldClaim,resumeClaim,audit]=await Promise.all([
    statusStore().get(id,{type:"json",consistency:"strong"}),
    store.get(auto.BOOKING_CLAIM_PREFIX+id,{
      type:"json",consistency:"strong"}),
    store.get(reactivate.recoveryKey(id),{
      type:"json",consistency:"strong"}),
    originalAudit(id,day),
  ]);
  if(resumeClaim)return {ok:false,reason:"This booking has already had its one-time resume attempt. Check Squeegee before taking further action."};
  if(!reactivate.safeHeld(status,oldClaim,resumeClaim,id))
    return {ok:false,reason:"The original booking is not an untouched inactive-account hold, or it has already been processed."};
  const accepted=reactivate.auditedBooking(audit,id,day);
  if(!accepted.ok)
    return {ok:false,reason:"The original accepted booking audit could not be securely verified."};
  const booking=accepted.booking;
  const [schedules,services,groups,match]=await Promise.all([
    stage.fetchAuthoritativeSchedule(booking,fetch,{timeoutMs:16000}),
    api.getServices(),api.getJobGroups(),
    matcher.matchCustomersAcrossPages(booking,api.listCustomers,{maxPages:100}),
  ]);
  if(match?.status==="reactivation_required")
    return {ok:false,reason:"Customer is still INACTIVE in Squeegee. Reactivate the existing account in Squeegee, then reopen this page."};
  if(match?.status!=="matched" ||
     !["exact_property_and_name","exact_property_and_contact","external_reference"]
       .includes(match.reason))
    return {ok:false,reason:"Could not match exactly one existing Squeegee customer. No job was sent."};
  const customerId=match.customerId;
  const customer=await api.getCustomer(customerId);
  if(!reactivate.exactActiveCustomer(customer,booking))
    return {ok:false,reason:"The matched Squeegee account is not active or its identity/address differs."};
  const prepared=prepare.prepareReadOnlyBooking(booking,schedules,services,{
    jobGroups:groups,
    // Trusted original audit only; never supplied by a new public booking.
    legacyLargeCommercialPrice:reactivate.acceptedLegacyCommercialPrice(booking.submittedAt),
  });
  const grouped=reactivate.preparedJobs(prepared,booking,Date.now());
  if(!grouped)
    return {ok:false,reason:"A booking date, round, service or price cannot be verified today. No job was sent."};
  const risk=reactivate.existingJobRisk(customer.jobs,grouped,id);
  if(risk)
    return {ok:false,reason:"Existing customer jobs need review before import ("+risk+")."};
  return {ok:true,booking,customerId,grouped,
    originalAcceptedAt:Date.parse(booking.submittedAt)};
}
async function outcome(id,stage,extra={}){
  try{await outcomeStore().setJSON(id,{
    bookingId:id,stage,updatedAt:new Date().toISOString(),...extra,
  });}catch{}
}
function blocked(text,id,day,reviewPath=null){
  const back=reviewPath||PATH+"?bookingId="+encodeURIComponent(id)+
    "&day="+encodeURIComponent(day);
  return page('<div class="notice"><h2>Import not started</h2><p>'+
    safe(text)+'</p></div>'+
    '<p><a href="'+safe(back)+'">Recheck booking (read-only)</a></p>',409);
}
async function resumeOnce(check,id,day,scope,reviewPath){
  const store=claimsStore(),key=reactivate.recoveryKey(id);
  const reserved=await claims.claimOnce({
    key,bookingId:id,channel:"owner_reactivation",store,
  });
  if(!reserved.acquired)
    return blocked("A one-time resume already exists, or could not be reserved safely.",id,day,reviewPath);
  const started=await claims.changeClaimState({
    key,etag:reserved.etag,bookingId:id,
    state:"request_in_progress",store,
  });
  if(!started.changed)
    return blocked("The one-time reservation could not be confirmed. Nothing was sent.",id,day,reviewPath);
  await outcome(id,"request_in_progress");
  let result={status:"requires_reconciliation",
    reason:"owner_reactivation_worker_exception"};
  // Track only POSTs that returned a confirmed Squeegee success in this
  // owner-approved invocation. The current job alone must be absent; a
  // previous successful group from the same booking is expected.
  const acceptedGroups=[];
  try{
    // The original signed accepted submission remains immutable. Only the
    // date-limited input-validity comparison uses its server receipt time.
    // Current-date/round checks have already been performed in preflight.
    result=await auto.executeAutomaticPreviewBooking(check.booking,{
      channel:"email",runtimeScope:scope,
      now:check.originalAcceptedAt,
      deps:{
        claim:args=>claims.claimOnce({...args,store}),
        changeState:args=>claims.changeClaimState({...args,store}),
        save:(bid,state,extra)=>auto.saveAutoStatus(bid,state,extra,{
          store:statusStore(),
        }),
        // Never create a new customer even if a different customer is matched.
        createCustomer:async()=>{
          throw new Error("owner_reactivation_new_customer_forbidden");
        },
        getCustomer:async(customerId)=>{
          if(customerId!==check.customerId)
            throw new Error("owner_reactivation_customer_changed");
          const latest=await api.getCustomer(customerId);
          if(!reactivate.exactActiveCustomer(latest,check.booking) ||
             reactivate.existingJobRisk(latest.jobs,check.grouped,id))
            throw new Error("owner_reactivation_customer_or_jobs_changed");
          return latest;
        },
        addJob:async(customerId,input)=>{
          if(customerId!==check.customerId)
            throw new Error("owner_reactivation_job_target_changed");
          const expected=check.grouped[acceptedGroups.length];
          if(!expected || expected.input.date!==input.date ||
             expected.input.price!==input.price ||
             expected.input.frequencyType!==input.frequencyType ||
             expected.input.jobGroup!==input.jobGroup ||
             JSON.stringify(expected.input.services)!==
               JSON.stringify(input.services))
            throw new Error("owner_reactivation_job_order_changed");
          // Before EVERY POST, verify the still-missing group is absent.
          // Previously acknowledged groups from this very same invocation
          // are allowed, but only when their saved date/services match.
          const latest=await api.getCustomer(customerId);
          if(!reactivate.exactActiveCustomer(latest,check.booking) ||
             reactivate.existingJobRisk(latest.jobs,
               check.grouped.slice(acceptedGroups.length),id,
               {acceptedGroups}))
            throw new Error("owner_reactivation_existing_job_appeared");
          const created=await api.addJobToCustomer(customerId,input);
          acceptedGroups.push(expected); // Only after confirmed API success.
          return created;
        },
        alert:async()=>({sent:false,reason:"owner_confirmation_on_page"}),
        completedAlert:async()=>({sent:false,
          reason:"owner_confirmation_on_page"}),
        duplicateAlert:async()=>({sent:false}),
        quantityAlert:async()=>({sent:false}),
      },
    });
  }catch{}
  const good=result?.status==="completed" &&
    result.createdCustomer===false &&
    result.createdJobs===check.grouped.length;
  try{
    await claims.changeClaimState({
      key,etag:started.etag,bookingId:id,
      state:good?"succeeded":"requires_reconciliation",store,
    });
  }catch{}
  await outcome(id,good?"succeeded":"requires_reconciliation",{
    resultStatus:typeof result?.status==="string"?result.status:"unknown",
    reason:/^[a-z][a-z0-9_]{0,90}$/.test(String(result?.reason||""))?
      result.reason:"none",
    jobsConfirmed:good?result.createdJobs:0,
  });
  if(good)return page('<div class="notice"><h2>Booking imported</h2>'+
    '<p><strong>'+check.grouped.length+' Squeegee job(s)</strong> '+
    'have been created on the existing reactivated customer account.</p>'+
    '<p>Customer number unchanged. No new booking or customer was created.</p></div>'+
    '<p><strong>Original reference:</strong> '+safe(id)+'</p>');
  return page('<div class="notice"><h2>Import stopped — do not press again</h2>'+
    '<p>Result: '+safe(result?.status||"unconfirmed")+'</p>'+
    '<p>Reason: '+safe(result?.reason||"unknown")+'</p>'+
    '<p>Some Squeegee work might have been accepted without confirmation. '+
    'Please check the customer before attempting further changes.</p></div>',409);
}
export default async function handler(request,context){
  const scope=scopeFor(request,context);
  if(!api.isExactPreview1(process.env,scope))
    return new Response("Not found",{status:404});
  const u=new URL(request.url);
  const id=u.searchParams.get("bookingId")?.trim().toUpperCase()||"";
  const day=u.searchParams.get("day")?.trim()||"";
  if(!reactivate.validId(id) || !reactivate.validDay(day))
    return page("Invalid booking reference or original booking date",400);
  if(!["GET","POST"].includes(request.method))
    return page("Method not allowed",405);
  // A valid private owner-email link replaces the extra OTP step. Old
  // notifications without a signed link keep the existing session fallback.
  const authParams={
    bookingId:id,day,
    expires:u.searchParams.get("expires")||"",
    signature:u.searchParams.get("signature")||"",
  };
  const viaEmailLink=ownerLink.verifyLink(authParams,{env:process.env});
  const reviewPath=viaEmailLink?
    PATH+"?"+new URLSearchParams(authParams).toString():
    PATH+"?bookingId="+encodeURIComponent(id)+"&day="+encodeURIComponent(day);
  if(!viaEmailLink && !signedOwner(request,scope)){
    return page('<div class="notice"><p>This older or expired email link '+
      'requires owner verification. New notification emails open the '+
      'booking review directly. Opening a link never creates a job.</p></div>'+
      '<p><a href="/api/squeegee-preview-test?returnTo='+
      encodeURIComponent(reviewPath)+'">Email me an owner access code</a></p>',403);
  }
  const expectedCsrf=viaEmailLink?
    ownerLink.confirmationToken(authParams,process.env):token(request,id,day);
  if(request.method==="POST"){
    if(!request.headers.get("content-type")?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded"))
      return page("Invalid confirmation form",415);
    const raw=await request.text();
    if(raw.length>1200)return page("Confirmation form too large",413);
    const form=new URLSearchParams(raw);
    if(form.get("bookingId")!==id || form.get("day")!==day ||
       form.get("confirm")!=="yes" ||
       !secureEqual(form.get("csrf"),expectedCsrf))
      return page("Owner confirmation is missing or invalid",403);
  }
  let check;
  try{check=await preflight(id,day);}
  catch{
    return blocked("An original audit, Squeegee or council read-only verification failed. No write was attempted.",id,day,reviewPath);
  }
  if(!check.ok)return blocked(check.reason,id,day,reviewPath);
  if(request.method==="POST")return resumeOnce(check,id,day,scope,reviewPath);
  const list=check.booking.bins.map(bin=>'<li>'+
    safe(bin.count)+' × '+safe(bin.type)+
    (bin.sizeLitres?' ('+safe(bin.sizeLitres)+'L)':'')+
    ' — '+safe(bin.planId)+'</li>').join("");
  const groups=check.grouped.map(j=>'<li>'+safe(j.input.date)+
    ' · '+(j.input.frequencyType==="adhoc"?"One-off":"Every four weeks")+
    ' · £'+Number(j.input.price).toFixed(2)+'</li>').join("");
  const action=reviewPath;
  return page('<p><strong>Original booking:</strong> '+safe(id)+'</p>'+
    '<p><strong>Existing customer:</strong> '+safe(check.booking.name)+'</p>'+
    '<p><strong>Service address:</strong> '+safe(check.booking.address)+'</p>'+
    '<p><strong>Original price:</strong> £'+
      Number(check.booking.pricing.total).toFixed(2)+'</p>'+
    '<h2>Bins</h2><ul>'+list+'</ul><h2>Jobs to create</h2><ul>'+
    groups+'</ul><div class="notice"><strong>Verified: existing Squeegee account is active.</strong>'+
    '<p>The saved booking, council dates, services and prices have been '+
    'checked, and no matching job was found in the available records.</p></div>'+
    '<form method="post" action="'+safe(action)+'">'+
    '<input type="hidden" name="bookingId" value="'+safe(id)+'">'+
    '<input type="hidden" name="day" value="'+safe(day)+'">'+
    '<input type="hidden" name="csrf" value="'+expectedCsrf+'">'+
    '<label><input type="checkbox" name="confirm" value="yes" required>'+
    ' I have reactivated this customer in Squeegee and confirm these jobs are not already present.</label>'+
    '<button type="submit">Confirm &amp; Process Booking</button></form>'+
    '<p><small>Opening the link never writes to Squeegee. '+
    'Once import is attempted, automatic retries are permanently disabled.</small></p>');
}
export const config={
  path:"/api/squeegee-preview-owner-reactivation",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
