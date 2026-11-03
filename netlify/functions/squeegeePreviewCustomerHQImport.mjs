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
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
function page(html,status=200){
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Customer HQ • Private History Setup</title>'+
    '<style>body{background:#121728;color:white;font:16px/1.5 system-ui;'+
    'margin:0;padding:18px}main{max-width:620px;margin:auto}h1{font-size:27px}'+
    'section{padding:16px;margin:16px 0;background:#28334c;border-left:4px solid #f7c948}'+
    'button,input{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:9px 0}'+
    'button{background:#f7c948;color:#171717;border:0;font-weight:800}'+
    'a{color:#f7c948}small{color:#ddd}</style><main>'+
    '<h1>NI Bin Guy • Customer HQ Setup</h1>'+html+
    '<p><small>Owner-only N64 preview. Customer account data remains in private Netlify storage; it is not added to the public website or GitHub.</small></p>'+
    '</main>',{status,headers});
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
    const summary=existing?.summary;
    const eligible=hq.eligibleRankedEmailAccounts(existing);
    return page('<section><strong>'+(summary?"PRIVATE HISTORY IMPORTED":"NOT IMPORTED")+
      '</strong><p>'+(summary?
        'Active customer records: '+summary.activeAccounts+
        ' · Ranked customers with an email: '+(eligible?.count??'Unverified')+
        ' · Email-eligible cleaning XP: '+(eligible?.historicalPoints??'Unverified')+
        ' · Unranked due to no email: '+(eligible?summary.rankedCustomers-eligible.count:'Unverified')+
        ' · Cleaning history events: '+summary.historyEvents+
        ' · Active accounts with registered email: '+summary.emailAvailable+
        ' · Shared-email conflicts held for review: '+summary.duplicateEmailCount+
        ' · Source: '+escape(existing.asOf):
        'Upload the private Customer HQ JSON built from your 31 October Squeegee backup. No customer can sign in to see their points until that private file is imported.')+
      '</p></section>'+
      '<section><h2>Upload private customer points history</h2>'+
      '<form method="post" enctype="multipart/form-data" action="'+PATH+'">'+
      '<input type="hidden" name="csrf" value="'+escape(csrfToken)+'">'+
      '<input type="file" name="history" required>'+
      '<p><small>On Android, select the NI_Bin_Guy_Customer_HQ_Secure_Import_PRIVATE_2026-10-31.json file (about 2 MB). All file types can now be selected; the server checks the JSON content securely before importing.</small></p>'+
      '<button type="submit">Import customer history privately</button></form>'+
      '<p><small>Maximum 3 MB. A newer, checked import replaces the old private snapshot. Repeating the same file does not duplicate points.</small></p></section>'+
      '<p><a href="/customer-hq?ntl-drawer-state=hidden">Open Customer HQ</a></p>');
  }
  // Some Samsung/Android in-app browser uploads send Origin: null (or
  // omit Origin). Verify an unpredictable token tied to this exact signed
  // owner session instead of rejecting legitimate same-origin forms.
  try{
    const size=Number(request.headers.get("content-length")||0);
    if(!Number.isFinite(size)||size>3_500_000)
      return page("<section>The selected file is too large. No customer data was imported.</section>",413);
    const form=await request.formData();
    if(!uploadCsrf.isAllowedOwnerUpload({
      cookie,token:form.get("csrf"),env:process.env,headers:request.headers,
    }))return page('<section>The secure upload session was not verified. No customer data was imported. '+
      '<a href="'+PATH+'">Return to the import form and select the file again.</a></section>',403);
    const file=form.get("history");
    if(!file||typeof file.text!=="function"||file.size<100||
       file.size>3_000_000)
      return page("<section>Choose the private JSON file (under 3 MB).</section>",400);
    const source=await file.text();
    const validated=hq.validateSource(JSON.parse(source));
    const previous=await store.get(hq.DATA_KEY,{type:"json",consistency:"strong"});
    if(previous?.asOf && validated.asOf<previous.asOf)
      return page("<section>Older customer history cannot replace newer data.</section>",409);
    const hash=crypto.createHash("sha256").update(source).digest("hex");
    if(previous?.sourceHash===hash)
      return page("<section>Already imported — no duplicate points awarded.</section>"+
        '<p><a href="'+PATH+'">Return to setup</a></p>');
    const pendingConsent=nameConsents.initialiseFromPrivateCustomerHQ(validated);
    const consentStore=getStore({name:nameConsents.STORE_NAME,consistency:"strong"});
    const saved=await store.setJSON(hq.DATA_KEY,{
      ...validated,sourceHash:hash,importedAt:new Date().toISOString()
    });
    if(saved?.modified!==true)
      return page("<section>Unable to save private history. No public change made.</section>",503);
    // First import creates 941 PENDING opt-ins, never automatically grants.
    // Existing permission choices are not overwritten by later imports.
    const existingConsent=await consentStore.get(nameConsents.KEY,{
      type:"json",consistency:"strong"
    });
    if(!existingConsent){
      const created=await consentStore.setJSON(nameConsents.KEY,pendingConsent,{
        onlyIfNew:true
      });
      if(created?.modified!==true)
        return page("<section>Customer history saved, but the optional leaderboard consent list needs owner review. No first names were published.</section>",503);
    }
    return page('<section><strong>PRIVATE CUSTOMER HQ HISTORY READY</strong>'+
      '<p>Validated '+validated.summary.activeAccounts+' active customers and '+
      validated.summary.historyEvents+' clean history entries. '+
      validated.summary.rankedWithEmail+' ranking-eligible customers have an email, '+
      'representing '+validated.summary.rankedWithEmailPoints+' cleaning XP. '+
      'No Squeegee customer/job/payment was changed.</p>'+
      '<p>Customer sign-ins can now be tested on the N64 preview. '+
      'No-email accounts are excluded from the public leaderboard but their historical XP is retained. '+
      'Four customers with shared emails require manual identity verification for portal sign-in.</p></section>'+
      '<p><a href="/customer-hq?ntl-drawer-state=hidden">Open Customer HQ</a></p>');
  }catch{
    return page("<section>Private history validation failed. No records were imported. Check that you selected the correct NI Bin Guy Customer HQ JSON.</section>",422);
  }
}
// Netlify's static route manifest requires a literal path here, not PATH.
export const config={path:"/api/squeegee-preview-hq-import"};
