// PREVIEW 1 / draft PR #77 only.
// Recover exactly one previously accepted TWO-BIN test email booking without
// sending a new email, awarding XP, or trusting browser-supplied customer data.
// GET is read-only. POST requires a fresh owner session, session-bound CSRF,
// repeat GET-only preflight, and atomic one-use receipt before any API write.
import owner from "./lib/squeegeePreviewTestSession.js";
import api from "./lib/squeegeeApiV3.js";
import rollout from "./lib/squeegeePreviewAutoRollout.js";
import recovery from "./lib/squeegeeAutoPilotRecovery.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import {getStore} from "@netlify/blobs";
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";

const TARGET=recovery.TARGET;
const TOKEN_AGE=10*60*1000;
const PURPOSE="nibinguy-preview77-pilot2-owner-verified-recovery-1";
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const safe=x=>String(x??"")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
function page(contents,status=200) {
  const start='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Existing booking recovery — NI Bin Guy</title>'+
    '<style>body{font:16px/1.5 system-ui;background:#0e1220;color:#fff;padding:18px 12px}'+
    'main{max-width:580px;margin:14px auto;background:#24283a;border:2px solid #f7da52;padding:22px}'+
    'h1{font-size:24px;line-height:1.2}p{margin:12px 0}'+
    'button{display:block;background:#f7da52;color:#121b31;width:100%;border:2px solid #111;'+
    'font:bold 16px system-ui;padding:16px;margin:24px 0;cursor:pointer}'+
    '.notice{background:#343b53;border-left:4px solid #f7da52;padding:12px;margin:12px 0}'+
    'a{color:#f7da52}small{color:#d6dce8}</style></head><body><main>'+
    '<h1>NI Bin Guy - Recover existing automatic booking</h1>';
  const end='<p><small>Preview 1 only. Read-only checks never create Squeegee records.'+
    ' Do not submit another booking or manually retry an uncertain Squeegee request.'+
    ' Production and Preview 2 remain unchanged.</small></p></main></body></html>';
  return new Response(start+contents+end,{status,headers:HEADERS});
}
function scope(request,context) {
  return {hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
}
function csrfSignature(cookie,issuedAt,nonce,runtime,env) {
  if(typeof env?.SQUEEGEE_API_KEY!=="string"||
     env.SQUEEGEE_API_KEY.length<20)return null;
  const key=createHmac("sha256",env.SQUEEGEE_API_KEY)
    .update(PURPOSE).digest();
  const message=[
    TARGET,"approve-recovery-two-jobs",runtime.hostname,
    runtime.deployContext,runtime.siteId,issuedAt,nonce,cookie,
  ].join("\u001f");
  return createHmac("sha256",key).update(message).digest("hex");
}
export function mintPilotRecoveryToken(cookie,runtime,env=process.env,now=Date.now()) {
  if(typeof cookie!=="string" || cookie.length<40 ||
     !Number.isSafeInteger(now))return null;
  const nonce=randomBytes(16).toString("hex");
  const signature=csrfSignature(cookie,now,nonce,runtime,env);
  return signature?now+"."+nonce+"."+signature:null;
}
export function verifyPilotRecoveryToken(token,cookie,runtime,
  env=process.env,now=Date.now()) {
  if(typeof token!=="string"||token.length>160||typeof cookie!=="string"||
     cookie.length<40)return false;
  const m=token.match(/^(\d{13})\.([0-9a-f]{32})\.([0-9a-f]{64})$/);
  if(!m)return false;
  const time=Number(m[1]);
  if(!Number.isSafeInteger(time)||!Number.isSafeInteger(now)||
     time>now+30000||now-time>TOKEN_AGE)return false;
  const expected=csrfSignature(cookie,time,m[2],runtime,env);
  return expected!==null && timingSafeEqual(
    Buffer.from(m[3],"hex"),Buffer.from(expected,"hex"));
}
export function acceptablePilotOrigin(request,runtime) {
  const origin=request.headers.get("origin");
  if(origin && origin!=="null" && origin!=="https://"+runtime.hostname)
    return false;
  const site=request.headers.get("sec-fetch-site");
  return !site || site==="same-origin" || site==="none";
}
function stores(){
  return {
    auditStore:getStore({name:"tos-confirmations",consistency:"strong"}),
    statusStore:getStore({name:auto.STATUS_STORE,consistency:"strong"}),
    claimsStore:getStore({name:auto.CLAIM_STORE,consistency:"strong"}),
  };
}
function resultsPage(result,token) {
  if(!result?.ready) {
    return page('<div class="notice"><strong>Recovery held — no new Squeegee write.</strong>'+
      '<p>Reason: '+safe(result?.reason||"read_only_preflight_unavailable")+'</p>'+
      (result?.checks?.length?
        '<p>Checks: '+result.checks.map(safe).join(", ")+'</p>':"")+
      '<p>Check any existing customer or claim before taking further action.</p></div>'+
      '<p><a href="/api/squeegee-preview-auto-status?bookingId='+TARGET+
      '">Read-only automatic booking status</a></p>');
  }
  if(!token)return page('<p>Could not issue secure owner confirmation. No records changed.</p>',503);
  let lines='<div class="notice"><strong>Read-only checks passed</strong>'+
    '<p>Original accepted booking: <strong>'+TARGET+'</strong></p>'+
    '<p>Customer: TEST API - Pilot 2</p>';
  for(const row of result.checks) {
    lines+='<p><strong>'+safe(row.bin)+'</strong> — '+
      safe(row.date)+' · Round '+safe(row.round)+
      ' · £'+safe(row.price)+' every 4 weeks</p>';
  }
  lines+='<p>Total: <strong>£10</strong></p>'+
    '<p>Squeegee customer: not found after '+safe(result.pagesScanned)+' pages</p>'+
    '<p>Previous sync receipt and pilot reservation: not found</p></div>';
  return page(lines+
    '<p>After confirmation this will create <strong>one REAL TEST API customer'+
    ' and two real four-weekly jobs</strong> in Squeegee. It will not submit'+
    ' another website booking, resend emails, or award leaderboard points.'+
    ' Do not dispatch, clean or bill these test jobs; remove them after verification.</p>'+
    '<form method="post">'+
    '<input type="hidden" name="action" value="confirm-pilot2">'+
    '<input type="hidden" name="csrf" value="'+safe(token)+'">'+
    '<button type="submit">Create ONE test customer and TWO jobs</button></form>'+
    '<p><small>Only press once. An uncertain result must not be retried.</small></p>'+
    '<p><a href="/api/squeegee-preview-auto-status?bookingId='+TARGET+
    '">Back without creating anything</a></p>');
}
export default async function handler(request,context) {
  const runtime=scope(request,context);
  if(!api.isExactPreview1(process.env,runtime) ||
     !process.env.SQUEEGEE_API_KEY)
    return new Response("Not found",{status:404});
  if(request.method!=="GET" && request.method!=="POST")
    return new Response("Method not allowed",{status:405});
  if(!auto.canAutoSync(process.env,runtime) ||
     rollout.autoMode(process.env)!=="pilot")
    return page('<p>Single-booking Preview 1 pilot is not enabled.</p>',403);
  const cookie=owner.sessionCookieFromHeader(request.headers.get("cookie"));
  if(!owner.verifyTestSessionCookie(cookie,process.env,Date.now(),runtime)) {
    return page('<div class="notice">Owner session expired. Use the owner code page'+
      ' to re-authorise this browser, then reopen this recovery link.</div>'+
      '<p><a href="/api/squeegee-preview-test?bookingId='+TARGET+
      '">Re-authorise owner access</a></p>',403);
  }
  if(request.method==="POST") {
    if(!acceptablePilotOrigin(request,runtime))
      return page("<p>Cross-site request blocked. No records changed.</p>",403);
    if(!request.headers.get("content-type")?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded"))
      return page("<p>Invalid form. No records changed.</p>",415);
    let form;
    try{form=await request.formData();}
    catch{return page("<p>Invalid form. No records changed.</p>",400);}
    if(form.getAll("action").length!==1 ||
       form.getAll("csrf").length!==1 ||
       [...form.keys()].length!==2 ||
       form.get("action")!=="confirm-pilot2" ||
       !verifyPilotRecoveryToken(String(form.get("csrf")||""),
         cookie,runtime,process.env,Date.now()))
      return page("<p>Owner confirmation expired or invalid. No records changed.</p>",403);
    if(typeof context?.waitUntil!=="function")
      return page("<p>Reliable worker unavailable. No records changed.</p>",503);
  }
  let handles;
  try{handles=stores();}
  catch{return page("<p>Private status storage unavailable. No records changed.</p>",503);}
  let verified;
  try{
    verified=await recovery.inspectAcceptedPilot(TARGET,handles);
  }catch(error){
    console.error("Preview 1 pilot recovery verification failed",error?.name||"unknown");
    return page("<p>Read-only preflight failed safely. No Squeegee records changed.</p>",503);
  }
  if(request.method==="GET")return resultsPage(verified,
    mintPilotRecoveryToken(cookie,runtime));
  if(!verified?.ready)return resultsPage(verified,null);
  // The permanent receipt is written before any API work, and cannot be
  // released by refreshing, double-clicking or repeating the form POST.
  let receipt;
  try{
    receipt=await handles.statusStore.setJSON(TARGET,{
      bookingId:TARGET,stage:"accepted_for_validation",
      channel:"email",source:"existing_accepted_pilot2_recovery",
      updatedAt:new Date().toISOString(),
    },{onlyIfNew:true});
  }catch{return page("<p>Cannot reserve sync. No Squeegee write attempted.</p>",503);}
  if(receipt?.modified!==true||!receipt.etag)
    return page('<p>This booking was already queued or its result is uncertain.'+
      ' Do not press again. Check the read-only status page.</p>',409);
  const task=auto.executeAutomaticPreviewBooking(verified.booking,{
    channel:"email",runtimeScope:runtime,
    deps:{
      claim:args=>claims.claimOnce({...args,store:handles.claimsStore}),
      changeState:args=>claims.changeClaimState({...args,store:handles.claimsStore}),
      save:(id,stage,extra)=>auto.saveAutoStatus(id,stage,extra,
        {store:handles.statusStore}),
    },
  }).catch(async error=>{
    console.error("Preview 1 pilot recovery worker uncertain",error?.name||"unknown");
    try{await auto.saveAutoStatus(TARGET,"requires_reconciliation",
      {reason:"pilot_recovery_worker_exception_no_retry"},
      {store:handles.statusStore});}catch{}
  });
  try{context.waitUntil(task);}
  catch(error){
    console.error("Preview 1 pilot recovery worker registration uncertain",
      error?.name||"unknown");
    return page("<p>Worker result uncertain. Do not retry. Check status.</p>",503);
  }
  return new Response(null,{status:303,headers:{
    Location:"/api/squeegee-preview-auto-status?bookingId="+TARGET,
    "Cache-Control":"no-store","Referrer-Policy":"no-referrer",
  }});
}
export const config={
  path:"/api/squeegee-preview-auto-recover",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10},
};
