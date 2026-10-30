// PREVIEW 1 ONLY — mobile owner approval for one Squeegee test.
// No production access, no customer records returned, no browser-held API key.
import session from "./lib/squeegeePreviewTestSession.js";
import { getStore } from "@netlify/blobs";
import { Resend } from "resend";

// Import external services in this ESM entrypoint rather than relying on
// late CommonJS requires during an owner-authorisation POST.
function ownerAuthStore() {
  return getStore({name:session.AUTH_STORE_NAME, consistency:"strong"});
}
async function sendOwnerTestCode({to,code}) {
  if(!process.env.RESEND_API_KEY) throw new Error("owner_code_email_unavailable");
  const resend=new Resend(process.env.RESEND_API_KEY);
  const result=await resend.emails.send({
    from:process.env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
    to,
    subject:"NI Bin Guy - Preview 1 Squeegee one-booking test code",
    text:"Your one-time Squeegee test access code is: "+code+
      "\n\nEnter it into the Preview 1 test page within 15 minutes."+
      "\nThis only authorises ONE supervised TEST booking, not live customer imports."+
      "\nIf you did not request this, ignore the email.",
  });
  if(result?.error) throw new Error("owner_code_email_unavailable");
}

const headerMap={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const safe=x=>String(x??"").replace(/&/g,"&amp;")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const head='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Squeegee Test - NI Bin Guy</title>'+
  '<style>body{margin:0;background:#10121c;color:#f8f8fa;font:16px/1.5 system-ui,sans-serif;padding:24px 12px}'+
  'main{max-width:550px;margin:24px auto;background:#222638;border:2px solid #f5dd51;padding:24px}'+
  'h1{font-size:27px;line-height:1.1;margin:0 0 15px}p{margin:12px 0}'+
  'input,button{font:inherit;box-sizing:border-box;width:100%;padding:13px;margin:8px 0 12px;border-radius:0}'+
  'input{color:#111;border:2px solid #f5dd51;background:#fff}'+
  'button{background:#f5dd51;border:2px solid #000;color:#121212;font-weight:800;cursor:pointer}'+
  'a{color:#f5dd51}small{font-size:14px;color:#d2d5e1}'+
  '.notice{border-left:4px solid #f5dd51;padding:8px 14px;background:#32384e}'+
  'label{display:block;font-weight:700}</style></head><body><main>'+
  '<h1>NI Bin Guy — Squeegee test</h1>';
const end='<p><small>Preview 1 only. One supervised customer and job maximum. Production unchanged.</small></p></main></body></html>';
function page(body,status=200,additional={}) {
  return new Response(head+body+end,{status,headers:{...headerMap,...additional}});
}
function runtimeScope(request,context) {
  return {
    hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id,
  };
}
function previewReady(request,context) {
  return session.validScope(process.env,runtimeScope(request,context));
}
function getAuthorized(request,scope) {
  return session.verifyTestSessionCookie(
    session.sessionCookieFromHeader(request.headers.get("cookie")),
    process.env,Date.now(),scope);
}
// Read-only reconciliation for a previously accepted booking. Never attempt
// another Squeegee write or release the immutable one-use reservation here.
const TEST_GLOBAL_KEY="claim-v1/approved-preview-1/one-customer-one-job";
const TEST_STATUS_STORE="squeegee-preview1-one-booking-test-status";
const TEST_CLAIM_STORE="squeegee-preview1-write-claims";
const SHADOW_STORE="squeegee-preview1-booking-readonly";
async function diagnosticRecord(storeName,key) {
  try {
    const record=await getStore({name:storeName,consistency:"strong"})
      .get(key,{type:"json",consistency:"strong"});
    return {readable:true,record};
  } catch(error) {
    // Never log values from a private Blob or Squeegee API.
    console.warn("Owner-only test audit read unavailable",storeName,
      error?.name||"unknown");
    return {readable:false,record:null};
  }
}
async function getDiagnostic(bookingId) {
  if(!/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i.test(bookingId)) {
    return {status:null,stored:"invalid_reference",
      shadow:"not_checked",claim:"not_checked"};
  }
  const [saved,shadow,claimed]=await Promise.all([
    diagnosticRecord(TEST_STATUS_STORE,bookingId),
    diagnosticRecord(SHADOW_STORE,bookingId),
    diagnosticRecord(TEST_CLAIM_STORE,TEST_GLOBAL_KEY),
  ]);
  const status=saved.record?.bookingId===bookingId?saved.record:null;
  const savedStatus=!saved.readable?"read_unavailable":
    status?"found":"not_found";
  const shadowStatus=!shadow.readable?"read_unavailable":
    shadow.record?.bookingId===bookingId?
      String(shadow.record.status||"present"):"not_found";
  const globalRecord=claimed.record;
  const claimStatus=!claimed.readable?"read_unavailable":
    !globalRecord?"not_found":
    globalRecord.bookingId!==bookingId?"reserved_for_different_booking":
    String(globalRecord.state||"reserved");
  // Only PII-free status strings, a date and a numbered round may reach HTML.
  const oneJob=shadow.record?.bookingId===bookingId?
    shadow.record.jobs?.[0]:null;
  const firstClean=typeof oneJob?.date==="string"&&
    /^\\d{4}-\\d{2}-\\d{2}$/.test(oneJob.date)?oneJob.date:null;
  const round=Number.isInteger(oneJob?.roundNumber) &&
    oneJob.roundNumber>=1 && oneJob.roundNumber<=20?
    oneJob.roundNumber:null;
  return {status,stored:savedStatus,shadow:shadowStatus,claim:claimStatus,
    firstClean,round};
}
function authPage(){
  return page('<p>This lets NI Bin Guy approve <strong>one</strong> test booking without enabling imports for anyone else.</p>'+
  '<p>Request an access code to your usual business bookings mailbox. The code is not shown on this page.</p>'+
  '<form method="post"><input type="hidden" name="action" value="request">'+
  '<button type="submit">Email my one-time test code</button></form>'+
  '<div class="notice">Do not submit a normal booking until you have entered the code and the test is armed.</div>');
}
function challengePage(challengeId){
  return page('<p>A 10-digit code has been sent to your bookings email. Enter it here within 15 minutes.</p>'+
  '<form method="post"><input type="hidden" name="action" value="verify">'+
  '<input type="hidden" name="challengeId" value="'+safe(challengeId)+'">'+
  '<label for="code">Access code</label><input id="code" name="code" type="text" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" autocomplete="one-time-code" required>'+
  '<button type="submit">Arm one test booking</button></form>');
}
function armedPage(diagnostic,bookingId){
  let state="";
  if(bookingId){
    const status=diagnostic?.status;
    state=status ? '<div class="notice"><strong>Test status:</strong> '+safe(status.stage)+
      '<p>'+safe(status.reason||"")+'</p>'+
      (status.firstClean?'<p>First clean: '+safe(status.firstClean)+'</p>':"")+
      (status.round?'<p>Squeegee round: '+safe(status.round)+'</p>':"")+
      (status.frequency?'<p>Frequency: '+safe(status.frequency)+'</p>':"")+
      '</div>' :
      '<div class="notice">No Squeegee worker status was saved for this reference. <strong>Do not submit this booking again.</strong> Check the read-only reservation below.</div>';
    state+='<div class="notice"><strong>Read-only reconciliation (no new Squeegee write)</strong>'+
      '<p>Worker status record: '+safe(diagnostic?.stored||"not_checked")+'</p>'+
      '<p>One-use test reservation: '+safe(diagnostic?.claim||"not_checked")+'</p>'+
      '<p>Booking shadow preparation: '+safe(diagnostic?.shadow||"not_checked")+'</p>'+
      (diagnostic?.firstClean?'<p>Website first clean: '+safe(diagnostic.firstClean)+'</p>':"")+
      (diagnostic?.round?'<p>Website round candidate: '+safe(diagnostic.round)+'</p>':"")+
      '<p><small>Shadow dates or claims do not prove a job was created. Do not retry an uncertain Squeegee POST.</small></p></div>';
  }
  return page('<div class="notice"><strong>Owner test authorised for this browser.</strong></div>'+
  '<p>Complete <strong>ONE NEW CUSTOMER</strong> booking on Preview 1. Select exactly <strong>one domestic bin, four-weekly at £5</strong>, using <strong>Email booking</strong>. You must use an address not already in Squeegee with an actual clean date shown.</p>'+
  '<p>This creates a <strong>real Squeegee test customer and recurring job</strong>, clearly prefixed TEST API. Do not dispatch or bill it; remove the test record after checking.</p>'+
  '<p>Use this browser within 20 minutes. Normal booking confirmation emails and leaderboard processing still run.</p>'+
  '<p><a href="/">Open Preview 1 booking form</a></p>'+
  '<form method="get"><label for="bookingId">Check status using booking reference</label>'+
  '<input id="bookingId" type="text" name="bookingId" placeholder="NBG-..." value="'+safe(bookingId||"")+'">'+
  '<button type="submit">Check Squeegee test status</button></form>'+state);
}
export default async function handler(request,context) {
  if(!previewReady(request,context))return new Response("Not found",{status:404});
  let phase="initial";
  try{
    const scope=runtimeScope(request,context);
    const active=getAuthorized(request,scope);
    if(request.method==="GET"){
      if(!active) return authPage();
      const bookingId=new URL(request.url).searchParams.get("bookingId")?.trim()||"";
      const diagnostic=bookingId?await getDiagnostic(bookingId):null;
      return armedPage(diagnostic,bookingId);
    }
    if(request.method!=="POST") return new Response("Method not allowed",{status:405});
    const data=await request.formData();
    const action=String(data.get("action")||"");
    if(action==="request"){
      phase="request_code";
      const issued=await session.issueOwnerCode({
        runtimeScope:scope, store:ownerAuthStore(), sendCode:sendOwnerTestCode,
      });
      if(issued.ok)return challengePage(issued.challengeId);
      return page("<p>Unable to issue test access. Try again after the request limit resets or check Preview 1 booking emails.</p>",503);
    }
    if(action==="verify"){
      phase="verify_code";
      const verified=await session.verifyOwnerCode({
        store:ownerAuthStore(),
        challengeId:String(data.get("challengeId")||""),
        code:String(data.get("code")||""),
        runtimeScope:scope,
      });
      if(!verified.ok)return page("<p>The code is invalid, expired or already used. Please start again.</p>",403);
      const headers=new Headers({
        "Location":"/api/squeegee-preview-test",
        "Cache-Control":"no-store",
        "Referrer-Policy":"no-referrer",
      });
      headers.append("Set-Cookie",session.cookieHeaderValue(verified.cookie,20*60));
      // UI-only hint, intentionally not a security credential. The signed
      // HttpOnly cookie remains the only server-side authorisation.
      headers.append("Set-Cookie",
        "nbgSqTestArmed=1; Path=/; Secure; SameSite=Strict; Max-Age=1200");
      return new Response(null,{status:303,headers});
    }
    return page("<p>Unknown request.</p>",400);
  }catch(error) {
    // Safe diagnostics only: never log an OTP, API key, contact or customer data.
    console.error("Preview 1 owner test setup error",phase,error?.name||"unknown");
    return page("<p>Test setup could not be completed safely. No Squeegee records were changed by this page.</p>",503);
  }
}
export const config={
  path:"/api/squeegee-preview-test",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
