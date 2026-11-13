// Owner-only, read-only Squeegee booking reconciliation on live site.
// Requires an independent production email-code session and never exposes
// customer contact details, API credentials, invoice data or write actions.
import guard from "./lib/squeegeeProductionGuard.js";
import owner from "./lib/squeegeeProductionOwnerAuth.js";
import {getStore} from "@netlify/blobs";
import {createProductionClient} from "./lib/squeegeeProductionApi.js";
import {Resend} from "resend";

const RE=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"same-origin",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const esc=x=>String(x??"").replace(/&/g,"&amp;")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const style='<style>body{background:#11141e;color:#f7f7f7;font:16px/1.5 system-ui;padding:16px;margin:0}'+
  'main{max-width:680px;margin:20px auto;border:2px solid #f5dd51;padding:22px;background:#252838}'+
  'h1{font-size:25px;line-height:1.2}h2{font-size:19px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font:inherit;border-radius:0}'+
  'input{border:2px solid #f5dd51;background:#fff;color:#111}button{border:2px solid #111;background:#f5dd51;color:#111;font-weight:800}'+
  'a{color:#f5dd51}.notice{padding:12px;border-left:4px solid #f5dd51;background:#30364c;margin:14px 0}'+
  'small{color:#ddd}section{border-top:1px solid #555;padding-top:12px;margin-top:14px}</style>';
function page(inner,status=200,extra={}){
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>NI Bin Guy - production booking status</title>'+style+
    '</head><body><main><h1>Production Squeegee booking status</h1>'+
    inner+'<p><small>Owner only. Read-only: this page never resubmits or changes a Squeegee booking.</small></p>'+
    '</main></body></html>';
  return new Response(html,{status,headers:{...HEADERS,...extra}});
}
const safeRef=value=>RE.test(String(value||""))?
  String(value).toUpperCase():"";
function runtime(request,context){
  return {hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id};
}
const statusStore=()=>getStore({name:guard.STATUS_STORE,consistency:"strong"});
const authStore=()=>getStore({name:owner.STORE,consistency:"strong"});
function simpleStatus(record){
  if(!record || typeof record!=="object")return null;
  const limited=value=>/^[a-z0-9_]{1,100}$/i.test(String(value||""))?
    String(value):"unknown";
  return {
    stage:limited(record.stage),
    reason:limited(record.reason),
    ownerAlertDelivery:limited(record.ownerAlertDelivery),
    manualScheduleRequired:record.manualScheduleRequired===true,
    updatedAt:typeof record.updatedAt==="string" &&
      !Number.isNaN(Date.parse(record.updatedAt))?
        record.updatedAt:record.acceptedAt||null,
    jobsConfirmed:Number.isSafeInteger(record.createdJobs)&&record.createdJobs>=0?
      record.createdJobs:0,
    duplicateFlags:Array.isArray(record.duplicateFlags)?
      record.duplicateFlags.filter(x=>/^[a-z_]{1,65}$/.test(x)).slice(0,12):[],
  };
}
function sourceSummary(summary){
  if(!summary)return '<div class="notice">No record found for this booking. Check the original owner email before making a manual change.</div>';
  const line=(title,value)=>'<p><strong>'+esc(title)+':</strong> '+esc(value)+'</p>';
  return '<div class="notice">'+
    line("Stage",summary.stage)+line("Reason",summary.reason)+
    line("Owner email",summary.ownerAlertDelivery)+
    line("Confirmed Squeegee jobs",summary.jobsConfirmed)+
    (summary.manualScheduleRequired?
      line("Action required","Job created in Squeegee. Set the first cleaning date and round manually; do not create another job."):"")+
    line("Updated",summary.updatedAt||"unknown")+
    (summary.duplicateFlags.length?
      line("Duplicate detail flags",summary.duplicateFlags.join(", ")):"")+
    '</div><p><strong>Never retry an uncertain or partially completed booking.</strong> Check Squeegee first.</p>';
}

const connectionForm=()=>'<section><h2>Read-only Squeegee connection check</h2>'+
  '<p>Checks only services and job groups. No customer or booking is changed. The emergency stop must remain ON.</p>'+
  '<form method="get"><input type="hidden" name="connectivity" value="1">'+
  '<button type="submit">Check Squeegee connection (GET ONLY)</button></form></section>';
async function connectivityCheck(scope,env=process.env,fetchImpl=globalThis.fetch){
  if(!guard.isVerifiedProductionScope(scope) ||
      env.SQUEEGEE_PRODUCTION_READ_ENABLED!=="true" ||
      env.SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED!=="false" ||
      env.SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES!=="false" ||
      env.SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY!=="false" ||
      env.SQUEEGEE_PRODUCTION_WRITES_PAUSED!=="true")
    return {ok:false,reason:"read_only_safety_gates_not_ready"};
  try{
    const api=createProductionClient({env,scope,fetchImpl});
    await Promise.all([api.getServices(),api.getJobGroups()]);
    return {ok:true,reason:"services_and_job_groups_readable"};
  }catch{
    return {ok:false,reason:"squeegee_read_only_connection_failed"};
  }
}
const lookupForm=(ref="")=>'<form method="get">'+
  '<label for="bookingId">Booking reference</label>'+
  '<input id="bookingId" name="bookingId" value="'+esc(ref)+'" placeholder="NBG-..." required>'+
  '<button type="submit">Check booking status</button></form>'+
  '<p><a href="/api/squeegee-production-auto-status?review=1">Outstanding bookings (read-only)</a></p>';
async function outstanding(){
  let listing;
  try{listing=await statusStore().list({prefix:"NBG-"});}
  catch{return '<div class="notice">Production status list currently unavailable.</div>';}
  const keys=(listing?.blobs||[]).map(x=>x.key).filter(safeRef);
  const selected=keys.slice(0,200),out=[];
  let cursor=0;
  async function worker(){
    while(cursor<selected.length){
      const id=selected[cursor++];
      let record;
      try{record=await statusStore().get(id,{type:"json",consistency:"strong"});}
      catch{continue;}
      const status=simpleStatus(record);
      if(!status)continue;
      const isReview=["held_for_review","requires_reconciliation"].includes(status.stage) ||
        status.manualScheduleRequired ||
        ["not_sent","failed"].includes(status.ownerAlertDelivery) ||
        (status.stage!=="created_customer_and_jobs" &&
          Date.now()-Date.parse(status.updatedAt||0)>5*60*1000);
      if(isReview)out.push({id,status});
    }
  }
  await Promise.all(Array.from({length:Math.min(8,selected.length)},worker));
  out.sort((a,b)=>String(b.status.updatedAt||"")
    .localeCompare(String(a.status.updatedAt||"")));
  let inner='<h2>Booking reviews</h2><p><small>Checked up to 200 stored references. This is a partial view if there are more records.</small></p>';
  for(const {id,status} of out.slice(0,60)){
    inner+='<section><a href="/api/squeegee-production-auto-status?bookingId='+
      encodeURIComponent(id)+'">'+esc(id)+'</a>'+
      '<p>Stage: '+esc(status.stage)+' | Reason: '+esc(status.reason)+
      ' | Owner email: '+esc(status.ownerAlertDelivery)+'</p></section>';
  }
  return inner+(out.length===0?
    '<div class="notice">No outstanding items found in the checked records.</div>':"");
}
const loginForm=ref=>'<h2>Owner sign-in required</h2>'+
  '<p>Request a one-time code at the NI Bin Guy owner mailbox to view booking status.</p>'+
  '<form method="post"><input type="hidden" name="action" value="request-code">'+
  '<input type="hidden" name="bookingId" value="'+esc(ref)+'">'+
  '<button type="submit">Email my owner access code</button></form>';
const codeForm=(id,ref)=>'<h2>Enter your code</h2>'+
  '<p>Check the owner inbox for the 10-digit access code.</p>'+
  '<form method="post"><input type="hidden" name="action" value="verify-code">'+
  '<input type="hidden" name="challengeId" value="'+esc(id)+'">'+
  '<input type="hidden" name="bookingId" value="'+esc(ref)+'">'+
  '<label for="code">One-time code</label>'+
  '<input id="code" name="code" inputmode="numeric" pattern="[0-9]{10}" minlength="10" maxlength="10" autocomplete="one-time-code" required>'+
  '<button type="submit">View my booking status</button></form>';
export default async function handler(request,context){
  const scope=runtime(request,context);
  if(!guard.isVerifiedProductionScope(scope))
    return new Response("Not found",{status:404});
  if(!["GET","POST"].includes(request.method))
    return new Response("Method not allowed",{status:405});
  if(!owner.configured(process.env,scope))
    return page('<div class="notice">Production owner status login is not configured.</div>',503);
  const url=new URL(request.url);
  if(request.method==="POST"){
    // Some Android in-app browsers omit Origin on same-origin form POSTs.
    // Keep the cross-site POST guard: accept a missing Origin only with
    // positive same-origin evidence from Fetch Metadata or Referer.
    const origin=request.headers.get("origin");
    const fetchSite=request.headers.get("sec-fetch-site");
    const referer=request.headers.get("referer");
    let sameOriginReferer=false;
    try{sameOriginReferer=Boolean(referer &&
      new URL(referer).origin==="https://nibing.uy");}catch{}
    const trustedPost=origin==="https://nibing.uy" &&
      fetchSite!=="cross-site" ||
      !origin && fetchSite==="same-origin" ||
      !origin && !fetchSite && sameOriginReferer;
    if(!trustedPost)
      return page('<div class="notice">Invalid request origin.</div>',403);
    if(!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded"))
      return page('<div class="notice">Form required.</div>',415);
    let raw;
    try{raw=await request.text();}catch{return page("Invalid request",400);}
    if(raw.length>2500)return page("Request too large",413);
    const form=new URLSearchParams(raw);
    const action=form.get("action");
    const ref=safeRef(form.get("bookingId"));
    if(action==="request-code"){
      if(!process.env.RESEND_API_KEY)
        return page('<div class="notice">Email provider unavailable.</div>',503);
      const provider=new Resend(process.env.RESEND_API_KEY);
      let outcome;
      try{outcome=await owner.issueCode({
        env:process.env,scope,store:authStore(),
        sendCode:async({to,code})=>{
          const r=await provider.emails.send({
            from:process.env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
            to,subject:"NI Bin Guy - secure owner access code",
            text:"Your one-time NI Bin Guy owner code is: "+code+
              "\n\nThis code signs you into owner tools for 20 minutes."+
              "\nSqueegee booking status is read-only; recording customer email permissions requires a separate owner action."+
              "\nIt cannot create or retry Squeegee jobs."+
              "\nIf you didn't request this, ignore the message.",
          });
          if(r?.error)throw Error("mail_failed");
        },
      });}catch{return page('<div class="notice">Could not send code.</div>',503);}
      return outcome.ok?
        page(codeForm(outcome.challengeId,ref)):
        page('<div class="notice">A code was recently requested or the service is unavailable. Check your owner inbox or try again later.</div>',429);
    }
    if(action==="verify-code"){
      let verified;
      try{verified=await owner.verifyCode({
        env:process.env,scope,store:authStore(),
        challengeId:form.get("challengeId"),code:form.get("code"),
      });}catch{return page('<div class="notice">Code verification unavailable.</div>',503);}
      if(!verified.ok)
        return page('<div class="notice">Code invalid, expired or already used.</div>'+
          loginForm(ref),401);
      const path="/api/squeegee-production-auto-status"+
        (ref?"?bookingId="+encodeURIComponent(ref):"");
      return new Response(null,{status:303,headers:{
        ...HEADERS,Location:path,
        "Set-Cookie":owner.cookieHeader(verified.cookie,20*60),
      }});
    }
    if(action==="logout")
      return new Response(null,{status:303,headers:{
        ...HEADERS,Location:"/api/squeegee-production-auto-status",
        "Set-Cookie":owner.cookieHeader("",0),
      }});
    return page("Unknown action",400);
  }
  const ref=safeRef(url.searchParams.get("bookingId"));
  if(!owner.validCookie(owner.fromHeader(request.headers.get("cookie")),
      process.env,Date.now(),scope))
    return page(loginForm(ref),401);
  let inner=connectionForm()+lookupForm(ref)+
    '<div class="notice"><strong>Customer leaderboard permissions</strong>'+
    '<p>Use the existing customer email replies to record owner-verified public first-name, town and XP permissions. No customer emails or Squeegee jobs are changed.</p>'+
    '<a href="/api/squeegee-preview-leaderboard-names">Open secure leaderboard permissions</a></div>'+
    '<form method="post"><input type="hidden" name="action" value="logout">'+
    '<button type="submit">Sign out</button></form>';
  if(url.searchParams.get("connectivity")==="1"){
    const checked=await connectivityCheck(scope);
    inner+='<div class="notice"><strong>Read-only API check:</strong> '+
      esc(checked.ok?"PASS - GET services and job groups":"NOT READY - "+checked.reason)+
      '</div><p><small>This never performs a Squeegee POST. A PASS does not authorise automatic bookings.</small></p>';
  }
  if(ref){
    try{
      const record=await statusStore().get(ref,{type:"json",consistency:"strong"});
      inner+=sourceSummary(record?.bookingId===ref?simpleStatus(record):null);
    }catch{inner+='<div class="notice">Status storage unavailable. Do not retry the booking.</div>';}
  }else if(url.searchParams.get("review")==="1"){
    inner+=await outstanding();
  }
  return page(inner);
}
export const config={
  path:"/api/squeegee-production-auto-status",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:25},
};
