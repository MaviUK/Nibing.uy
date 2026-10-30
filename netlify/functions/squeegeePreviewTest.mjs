// PREVIEW 1 ONLY — mobile owner approval for one Squeegee test.
// No production access, no customer records returned, no browser-held API key.
import session from "./lib/squeegeePreviewTestSession.js";

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
function previewReady(request,context) {
  const url=new URL(request.url);
  return url.hostname==="deploy-preview-77--nibinguy.netlify.app" &&
    context?.deploy?.context==="deploy-preview" &&
    session.validScope(process.env);
}
function getAuthorized(request) {
  return session.verifyTestSessionCookie(
    session.sessionCookieFromHeader(request.headers.get("cookie")));
}
async function getStatus(bookingId) {
  if(!/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i.test(bookingId))return null;
  const {getStore}=await import("@netlify/blobs");
  const status=await getStore({name:"squeegee-preview1-one-booking-test-status",
    consistency:"strong"}).get(bookingId,{type:"json",consistency:"strong"});
  if(!status || status.bookingId!==bookingId)return null;
  return status;
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
function armedPage(status,bookingId){
  let state="";
  if(bookingId){
    state=status ? '<div class="notice"><strong>Test status:</strong> '+safe(status.stage)+
      '<p>'+safe(status.reason||"")+'</p>'+
      (status.firstClean?'<p>First clean: '+safe(status.firstClean)+'</p>':"")+
      (status.round?'<p>Squeegee round: '+safe(status.round)+'</p>':"")+
      (status.frequency?'<p>Frequency: '+safe(status.frequency)+'</p>':"")+
      '</div>' :
      '<div class="notice">No test status for this booking reference yet. Check the ID or refresh after confirmation.</div>';
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
  try{
    const active=getAuthorized(request);
    if(request.method==="GET"){
      if(!active) return authPage();
      const bookingId=new URL(request.url).searchParams.get("bookingId")?.trim()||"";
      const status=bookingId ? await getStatus(bookingId) : null;
      return armedPage(status,bookingId);
    }
    if(request.method!=="POST") return new Response("Method not allowed",{status:405});
    const data=await request.formData();
    const action=String(data.get("action")||"");
    if(action==="request"){
      const issued=await session.issueOwnerCode();
      if(issued.ok)return challengePage(issued.challengeId);
      return page("<p>Unable to issue test access. Try again after the request limit resets or check Preview 1 booking emails.</p>",503);
    }
    if(action==="verify"){
      const verified=await session.verifyOwnerCode({
        challengeId:String(data.get("challengeId")||""),
        code:String(data.get("code")||""),
      });
      if(!verified.ok)return page("<p>The code is invalid, expired or already used. Please start again.</p>",403);
      return new Response(null,{status:303,
        headers:{"Location":"/api/squeegee-preview-test",
          "Set-Cookie":session.cookieHeaderValue(verified.cookie,20*60),
          "Cache-Control":"no-store",
          "Referrer-Policy":"no-referrer"}});
    }
    return page("<p>Unknown request.</p>",400);
  }catch {
    return page("<p>Test setup could not be completed safely. No Squeegee records were changed by this page.</p>",503);
  }
}
export const config={
  path:"/api/squeegee-preview-test",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
