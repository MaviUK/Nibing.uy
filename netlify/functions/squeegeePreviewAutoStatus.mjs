// Preview 1 owner-only read-only Squeegee automatic booking status.
// Uses the existing emailed 10-digit owner code session. No API POSTs here.
import api from "./lib/squeegeeApiV3.js";
import owner from "./lib/squeegeePreviewTestSession.js";
import auto from "./lib/squeegeeAutomaticBooking.js";
import rollout from "./lib/squeegeePreviewAutoRollout.js";
import alerts from "./lib/squeegeeSyncOwnerAlert.js";
import {getStore} from "@netlify/blobs";

const style='<style>body{font:16px/1.5 system-ui;background:#10121c;color:#fafafa;padding:18px}'+
  'main{background:#222638;border:2px solid #f5dd51;padding:22px;max-width:600px;margin:20px auto}'+
  'h1{font-size:26px;line-height:1.2}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border:2px solid #f5dd51}'+
  'button{background:#f5dd51;color:#111;font-weight:bold}a{color:#f5dd51}'+
  '.notice{background:#303950;border-left:4px solid #f5dd51;padding:12px;margin:12px 0}'+
  'small{color:#cbd1db}</style>';
const headers={
  "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
  "X-Robots-Tag":"noindex,nofollow","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const safe=x=>String(x??"").replace(/&/g,"&amp;")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const page=(html,status=200)=>new Response(
  '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta charset="utf-8"><title>Preview 1 Squeegee booking status</title>'+
  style+'</head><body><main><h1>NI Bin Guy - Automatic Squeegee sync</h1>'+
  html+'<p><small>Read only. Preview 1 only. No Squeegee records are changed by this page.</small></p>'+
  '</main></body></html>',
  {status,headers},
);
const bookingRe=/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i;
export default async function handler(request,context) {
  const runtime={hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
  if(!api.isExactPreview1(process.env,runtime))return new Response("Not found",{status:404});
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const cookie=owner.sessionCookieFromHeader(request.headers.get("cookie"));
  if(!owner.verifyTestSessionCookie(cookie,process.env,Date.now(),runtime)) {
    return page('<div class="notice"><strong>Owner authorisation required.</strong>'+
      '<p>Use the emailed one-time code on the owner test page first.</p></div>'+
      '<p><a href="/api/squeegee-preview-test">Authorise owner access</a></p>',403);
  }
  const enabled=auto.canAutoSync(process.env,runtime);
  const mode=rollout.autoMode(process.env);
  const id=new URL(request.url).searchParams.get("bookingId")?.trim()||"";
  const description=!enabled?"OFF":
    mode==="pilot"?"ENABLED — ONE FRESH TEST API BROWN-BIN EMAIL BOOKING ONLY":
    "ENABLED — ALL VALID EMAIL BOOKINGS ON PREVIEW 1 (duplicates held)";
  let content='<div class="notice">Automatic Preview 1 Squeegee sync: <strong>'+
    safe(description)+'</strong></div>'+
    '<p><a href="/api/squeegee-preview-test">Owner test page</a></p>'+
    '<form method="get"><label for="bookingId">Booking reference</label>'+
    '<input id="bookingId" name="bookingId" value="'+safe(id)+'" placeholder="NBG-..." required>'+
    '<button type="submit">Check automatic sync status (READ ONLY)</button></form>';
  if(id) {
    if(!bookingRe.test(id))return page(content+'<div class="notice">Invalid booking reference.</div>',400);
    let status;
    try{
      status=await getStore({name:auto.STATUS_STORE,consistency:"strong"})
        .get(id,{type:"json",consistency:"strong"});
    }catch {
      return page(content+'<div class="notice">Status storage unavailable. Do not retry an uncertain booking.</div>',503);
    }
    if(!status || status.bookingId!==id) {
      content+='<div class="notice"><strong>No automatic sync receipt for this reference.</strong>'+
        '<p>The booking email may have succeeded without an eligible Squeegee dispatch.'+
        ' No retry has been attempted.</p>'+
        (id===rollout.ABANDONED_BOOKING_ID?
          '<p><strong>The previous Brown and Black pilot was abandoned.</strong>'+
          ' It will not be replayed. Do not submit that booking again.'+
          ' The new pilot uses one fresh Brown-bin booking and its own permanent claim.</p>':
          '<p>This does not confirm Squeegee has no customer. The normal booking remains valid.</p>')+
        '</div>';
    }else{
      const simple=(key)=>status[key]===undefined?"":'<p>'+safe(key)+': '+safe(status[key])+'</p>';
      const previewRows=(key)=>{
        const rows=Array.isArray(status[key])?status[key]:[];
        if(!rows.length)return "";
        return '<p>'+safe(key)+': '+rows.map(safe).join(", ")+'</p>';
      };
      const flags=alerts.duplicateFlagLabels(status.duplicateFlags);
      const duplicateDetail=flags.length?
        '<div class="notice"><strong>Duplicate information detected</strong>'+
        '<ul>'+flags.map(label=>'<li>'+safe(label)+'</li>').join('')+'</ul>'+
        '<p><small>Repeated emails can be legitimate across multiple properties.'+
        ' This alert does not mean a duplicate job was created.</small></p></div>':'';
      content+='<div class="notice"><strong>Stage: '+safe(status.stage)+'</strong>'+
        simple("reason")+simple("channel")+simple("customerMode")+
        simple("createdCustomer")+simple("createdJobs")+simple("jobsConfirmed")+
        previewRows("firstCleanDates")+previewRows("dates")+previewRows("rounds")+
        previewRows("recurrence")+previewRows("blockedReasons")+
        '<p><small>A queued response is not proof of a Squeegee job. An ambiguous or partial result must never be retried automatically.</small></p>'+
        '</div>'+duplicateDetail;
    }
  }
  return page(content);
}
export const config={
  path:"/api/squeegee-preview-auto-status",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
