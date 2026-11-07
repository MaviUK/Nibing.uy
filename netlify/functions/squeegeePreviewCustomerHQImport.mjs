// Owner-only one-time import of PRIVATE Customer HQ cleaning history.
// No private Squeegee records or raw customer-email CSV are committed to GitHub.
// Preview 1 only; no calls that create or edit customers, jobs, or payments.
import api from "./lib/squeegeeApiV3.js";
import session from "./lib/squeegeePreviewTestSession.js";
import hq from "./lib/customerHQ.js";
import nameConsents from "./lib/squeegeeLeaderboardNameConsent.js";
import {getStore} from "@netlify/blobs";
import crypto from "node:crypto";
import uploadCsrf from "./lib/squeegeePreviewHQImportCsrf.js";

const PATH="/api/squeegee-preview-hq-import";
const HOST="https://deploy-preview-77--nibinguy.netlify.app";
const escape=x=>String(x??"").replace(/&/g,"&amp;")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const headers={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://raw.githubusercontent.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
function page(html,status=200,extraHeaders={}){
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Customer HQ • Private History Setup</title>'+
    '<script type="module" src="/customer-hq-sqg-import.mjs"></script>'+
    '<style>body{background:#121728;color:white;font:16px/1.5 system-ui;'+
    'margin:0;padding:18px}main{max-width:620px;margin:auto}h1{font-size:27px}'+
    'section{padding:16px;margin:16px 0;background:#28334c;border-left:4px solid #f7c948}'+
    'button,input{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:9px 0}'+
    'button{background:#f7c948;color:#171717;border:0;font-weight:800}'+
    'a{color:#f7c948}small{color:#ddd}</style><main>'+
    '<h1>NI Bin Guy • Customer HQ Setup</h1>'+html+
    '<p><small>Owner-only N64 preview. Customer account data remains in private Netlify storage; it is not added to the public website or GitHub.</small></p>'+
    '</main>',{status,headers:{...headers,...extraHeaders}});
}
// Deliberately log and show only fixed, non-identifying validation codes.
// Do not log the uploaded backup, customer names, IDs, email, cookies or body.
const OWNER_IMPORT_CODES=new Set([
  "per_job_history_source_invalid_or_stale","per_bin_customer_invalid",
  "per_bin_duplicate_customer","per_job_summary_invalid",
  "per_job_cross_customer_conflict","per_job_events_missing",
  "per_job_event_invalid","per_job_points_mismatch",
  "per_job_streak_mismatch","per_job_summary_mismatch",
  "per_job_reconciliation_failed","five_nov_paid_bin_audit_mismatch",
  "invalid_hq_source","unverified_per_bin_consent_source",
  "invalid_portal_consents_source","mismatched_portal_consents_source",
  "incomplete_portal_consents_source","unexpected_ranked_hq_customer",
  "hq_event_validation_failed","hq_history_balance_mismatch",
  "hq_customer_validation_failed","hq_public_score_mismatch",
  "hq_active_leaderboard_reconciliation_failed"
]);
function safeImportReason(err){
  const code=err instanceof Error?err.message:"";
  return OWNER_IMPORT_CODES.has(code)?code:"unexpected_failure";
}
function importFailure(stage,err){
  const safeStage=["parse_json","verify_history","load_previous","load_consents",
    "prepare_consents","save_consents","save_history"].includes(stage)?stage:"upload";
  const reason=safeImportReason(err);
  console.warn("preview77_private_hq_import_rejected",safeStage,reason);
  const verification=safeStage==="parse_json"||safeStage==="verify_history";
  const message=verification?
    "The backup was unpacked but its private scoring file did not pass the independent job-history checks.":
    "The private update could not be completed or verified.";
  const guidance=verification?
    "Your previous verified cleaning XP remains unchanged. The owner can report the diagnostic below; do not alter or extract customer records.":
    "Please do not assume that the new scores were saved. Check the private import summary before retrying.";
  const diagnostic=safeStage+" / "+reason;
  return page('<section><strong>IMPORT NOT APPLIED</strong><p>'+message+
    '</p><p>'+guidance+'</p><p><b>Diagnostic:</b> <code>'+
    escape(diagnostic)+'</code></p><p><a href="/api/squeegee-preview-hq-import">'+
    'Return to customer-history import</a></p></section>',
    verification?422:503,{"X-Private-Import-Reason":diagnostic});
}
function scope(req,ctx){return {
  hostname:new URL(req.url).hostname,
  deployContext:ctx?.deploy?.context,
  siteId:ctx?.site?.id,
};}
export default async function handler(request,ctx){
  const runtime=scope(request,ctx);
  if(!api.isExactPreview1(process.env,runtime))
    return new Response("Not found",{status:404});
  if(!["GET","POST"].includes(request.method))
    return new Response("Method not allowed",{status:405});
  const cookie=session.sessionCookieFromHeader(request.headers.get("cookie"));
  if(!session.verifyTestSessionCookie(cookie,process.env,Date.now(),runtime))
    return request.method==="GET"?
      page('<section><strong>Owner sign-in required</strong><p>Request your regular emailed owner access code before uploading the private customer history.</p>'+
        '<p><a href="/api/squeegee-preview-test?returnTo='+
        encodeURIComponent(PATH)+'">Sign in with my owner code</a></p></section>',403):
      page("<section>Session expired. No file processed.</section>",403);
  const csrfToken=uploadCsrf.tokenForOwnerSession(cookie,process.env);
  if(!csrfToken)return page("<section>Secure upload form is temporarily unavailable. No customer information was changed.</section>",503);
  const store=getStore({name:hq.DATA_STORE,consistency:"strong"});
  if(request.method==="GET"){
    let existing=null;
    try{existing=await store.get(hq.DATA_KEY,{type:"json",consistency:"strong"});}
    catch{return page("<section>Private storage temporarily unavailable. No changes made.</section>",503);}
    if(new URL(request.url).searchParams.get("referenceMap")==="1"){
      const records=Array.isArray(existing?.accounts)
        ?existing.accounts.map(a=>({id:a.id,ref:a.ref,
          firstName:a.firstName,town:a.town})): [];
      return new Response(JSON.stringify({sourceAsOf:existing?.asOf||null,records}),{
        status:200,headers:{
          "Content-Type":"application/json; charset=utf-8",
          "Cache-Control":"private, no-store, max-age=0",
          "X-Robots-Tag":"noindex, nofollow",
          "X-Content-Type-Options":"nosniff",
          "Referrer-Policy":"no-referrer"
        }
      });
    }
    const summary=existing?.summary;
    const eligible=hq.eligibleRankedEmailAccounts(existing);
    return page('<section><strong>'+(summary?"PRIVATE HISTORY IMPORTED":"NOT IMPORTED")+
      '</strong><p>'+(summary?
        'Active customer records: '+summary.activeAccounts+
        ' · Verified paid physical bins: '+(summary.verifiedPaidBins??'Not available')+
        ' · Verified cleaning XP: '+(summary.allHistoricalPoints??'Not available')+
        ' · Ranked customers with an email: '+(eligible?.count??'Unverified')+
        ' · Email-eligible cleaning XP: '+(eligible?.historicalPoints??'Unverified')+
        ' · Unranked due to no email: '+(eligible?summary.rankedCustomers-eligible.count:'Unverified')+
        ' · Cleaning history events: '+summary.historyEvents+
        ' · Active accounts with registered email: '+summary.emailAvailable+
        ' · Shared-email conflicts held for review: '+summary.duplicateEmailCount+
        ' · Source: '+escape(existing.asOf):
        'Upload the latest private Customer HQ JSON prepared from the verified Squeegee backup. Only an owner can replace cleaning scores. No customer can sign in until history is privately imported.')+
      '</p></section>'+
      '<section><h2>Upload your normal Squeegee backup</h2>'+
      '<form id="hq-history-upload-form" method="post" enctype="multipart/form-data" action="'+PATH+'">'+
      '<input type="hidden" name="csrf" value="'+escape(csrfToken)+'">'+
      '<label for="hq-history-file">Choose your latest Squeegee .sqg backup</label>'+
      '<input id="hq-history-file" type="file" name="history" accept=".sqg,application/octet-stream,.json,application/json" aria-describedby="hq-upload-help hq-upload-error" required>'+
      '<p id="hq-upload-help"><small>Select the manual backup downloaded from Squeegee (usually about 30 MB). Preview 77 unpacks and checks it on your phone, then privately uploads only the small verified customer-score history. No more JSON conversion or separate spreadsheet is needed. Keep this tab open during processing. The original backup is not uploaded.</small></p>'+
      '<p id="hq-upload-error" role="alert" aria-live="assertive"></p>'+
      '<progress id="hq-upload-progress" value="0" max="100" style="width:100%;display:none"></progress>'+
      '<button id="hq-import-button" type="submit" disabled>Process Squeegee backup and update points</button></form>'+
      '<p><small>The usual Squeegee archive can be up to 65 MB. The reduced private import must fit below 3.8 MB. Customer names, emails, invoices and raw backup files are never sent to the archive decoder. Updated scores replace the last verified snapshot without doubling points, and existing withdrawals are preserved.</small></p></section>'+
      '<p><a href="/customer-hq?ntl-drawer-state=hidden">Open Customer HQ</a></p>');
  }
  // Some Samsung/Android in-app browser uploads send Origin: null (or
  // omit Origin). Verify an unpredictable token tied to this exact signed
  // owner session instead of rejecting legitimate same-origin forms.
  let stage="upload";
  try{
    const size=Number(request.headers.get("content-length")||0);
    if(!Number.isFinite(size)||size>4_200_000)
      return page("<section>The selected file is too large. No customer data was imported.</section>",413);
    const form=await request.formData();
    if(!uploadCsrf.isAllowedOwnerUpload({
      cookie,token:form.get("csrf"),env:process.env,headers:request.headers,
    }))return page('<section>The secure upload session was not verified. No customer data was imported. '+
      '<a href="'+PATH+'">Return to the import form and select the file again.</a></section>',403);
    const file=form.get("history");
    if(!file||typeof file.text!=="function"||file.size<100||
       file.size>3_800_000)
      return page("<section>Choose the prepared private Customer HQ JSON (under 3.8 MB). The original Squeegee .sqg backup is not supported by this form.</section>",400);
    if(typeof file.name!=="string"||!/\.json$/i.test(file.name))
      return page("<section>You selected a Squeegee backup or another unsupported file. Please select the prepared Customer HQ .json file instead. No customer records were changed.</section>",415);
    const source=await file.text();
    stage="parse_json";
    const parsed=JSON.parse(source);
    stage="verify_history";
    const validated=hq.validateSource(parsed);
    stage="load_previous";
    const previous=await store.get(hq.DATA_KEY,{type:"json",consistency:"strong"});
    if(previous?.asOf && validated.asOf<previous.asOf)
      return page("<section>Older customer history cannot replace newer data.</section>",409);
    const hash=crypto.createHash("sha256").update(source).digest("hex");
    if(previous?.sourceHash===hash)
      return page("<section>Already imported — no duplicate points awarded.</section>"+
        '<p><a href="'+PATH+'">Return to setup</a></p>');
    // Save the refreshed permissions before the refreshed history. Any
    // mismatch of source dates hides public names, including withdrawals.
    // A withheld or withdrawn customer never becomes public on refresh.
    const consentStore=getStore({name:nameConsents.STORE_NAME,consistency:"strong"});
    stage="load_consents";
    const oldConsent=await consentStore.getWithMetadata(nameConsents.KEY,{
      type:"json",consistency:"strong"
    });
    stage="prepare_consents";
    const nextConsent=nameConsents.initialiseFromPrivateCustomerHQ(
      validated,oldConsent?.data||null);
    stage="save_consents";
    const permissionsSaved=await consentStore.setJSON(
      nameConsents.KEY,nextConsent,oldConsent?.etag
        ?{onlyIfMatch:oldConsent.etag}:{onlyIfNew:true}
    );
    if(permissionsSaved?.modified!==true)
      return page("<section>Leaderboard consent records changed elsewhere. No private history was replaced. Please try again.</section>",409);
    stage="save_history";
    const saved=await store.setJSON(hq.DATA_KEY,{
      ...validated,sourceHash:hash,importedAt:new Date().toISOString()
    });
    if(saved?.modified!==true)
      return page("<section>Unable to save private history. Public scoring is withheld until a successful retry.</section>",503);
    return page('<section><strong>PRIVATE CUSTOMER HQ HISTORY READY</strong>'+
      '<p>Validated '+validated.summary.activeAccounts+' active customers, '+
      validated.summary.verifiedPaidBins+' fully paid physical bins, '+
      validated.summary.allHistoricalPoints+' cleaning XP and '+
      validated.summary.historyEvents+' clean history entries. '+
      validated.summary.rankedWithEmail+' ranking-eligible customers have an email, '+
      'representing '+validated.summary.rankedWithEmailPoints+' cleaning XP. '+
      'No Squeegee customer/job/payment was changed.</p>'+
      '<p>Customer sign-ins can now be tested on the N64 preview. '+
      'No-email accounts are excluded from the public leaderboard but their historical XP is retained. '+
      validated.summary.duplicateEmailCount+' shared-email addresses require manual identity verification for portal sign-in.</p></section>'+
      '<p><a href="/customer-hq?ntl-drawer-state=hidden">Open Customer HQ</a></p>');
  }catch(error){
    return importFailure(stage,error);
  }
}
// Netlify's static route manifest requires a literal path here, not PATH.
export const config={path:"/api/squeegee-preview-hq-import"};
