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
  '.notice{background:#303950;border-left:4px solid #f5dd51;padding:12px;margin:12px 0;overflow-wrap:anywhere}'+
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
    // Preserve the selected booking reference through the emailed owner-code
    // flow. Previously this linked to the retired one-use TEST status instead.
    const selected=new URL(request.url).searchParams.get("bookingId")?.trim()||"";
    const returnTo=bookingRe.test(selected)&&selected.length<=100?
      "/api/squeegee-preview-auto-status?bookingId="+selected.toUpperCase():
      "/api/squeegee-preview-auto-status";
    const authorise="/api/squeegee-preview-test?returnTo="+
      encodeURIComponent(returnTo);
    return page('<div class="notice"><strong>Owner authorisation required.</strong>'+
      '<p>Enter your emailed one-time owner access code. After verification, '+
      'you will return to this automatic booking status page.</p></div>'+
      '<p><a href="'+authorise+'">Authorise owner access and return here</a></p>',403);
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
    // A previous read-only staging record can retain per-bin date-check
    // reasons even if the older automatic worker only saved aggregate codes.
    let staged=null;
    try {
      staged=await getStore({name:"squeegee-preview1-booking-readonly",
        consistency:"strong"}).get(id,{type:"json",consistency:"strong"});
    }catch{}
    if(staged?.bookingId!==id)staged=null;
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
      const dateHolds=Array.isArray(status.heldDates)&&status.heldDates.length?
        status.heldDates:Array.isArray(staged?.heldDates)?staged.heldDates:[];
      const dateDiagnosis=status.reason==="date_price_service_or_round_not_verified"?
        '<p><strong>No Squeegee job was created.</strong> The dates and rounds must be verified before scheduling. Do not resubmit this booking.</p>'+
        (status.browserSnapshotPresent===false?
          '<p>The website had no saved date snapshot at submission.</p>':""):"";
      const heldDetail=dateHolds.length?
        '<p><strong>Specific date checks:</strong></p><ul>'+
        dateHolds.slice(0,12).map(row=>
          '<li>'+safe(row?.bin||"Bin")+': '+safe(row?.reason||"unverified")+'</li>'
        ).join("")+'</ul>':"";
      const flags=alerts.duplicateFlagLabels(status.duplicateFlags);
      const duplicateDetail=flags.length?
        '<div class="notice"><strong>Duplicate information detected</strong>'+
        '<ul>'+flags.map(label=>'<li>'+safe(label)+'</li>').join('')+'</ul>'+
        '<p><small>Repeated emails can be legitimate across multiple properties.'+
        ' This alert does not mean a duplicate job was created.</small></p></div>':'';
      const quantityHelp=status.reason==="service_quantity_requires_manual_configuration"?
        "Multiple bins of one colour require manual service quantity setup in Squeegee. No customer/job was automatically created for this booking.":
        status.reason==="existing_job_for_selected_bin_requires_review"?
        "Check whether this is an additional physical bin or accidental duplicate. Edit the existing Squeegee job quantity/price manually if needed; no new job was created.":
        status.reason==="duplicate_bin_types_in_same_booking"?
        "Repeated bin colour lines need manual quantity clarification; no new job was created.":"";
      content+='<div class="notice"><strong>Stage: '+safe(status.stage)+'</strong>'+
        simple("reason")+dateDiagnosis+heldDetail+
        simple("channel")+simple("customerMode")+
        simple("manualAction")+previewRows("requestedBinCounts")+
        simple("ownerAlertDelivery")+simple("ownerAlertReason")+
        (quantityHelp?'<p><strong>Manual action: '+safe(quantityHelp)+'</strong></p>':'')+
        simple("createdCustomer")+simple("createdJobs")+simple("jobsConfirmed")+
        simple("physicalBins")+previewRows("physicalBinsPerJob")+
        simple("quantityVerificationRecommended")+previewRows("additionalExistingBins")+
        previewRows("firstCleanDates")+previewRows("dates")+previewRows("rounds")+
        previewRows("recurrence")+previewRows("blockedReasons")+
        previewRows("roundStatuses")+
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
