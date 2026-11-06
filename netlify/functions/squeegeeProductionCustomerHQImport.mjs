// Owner-only private import of a NEW verified Squeegee cleaning-history JSON.
// Never posts to Squeegee. Production origin only, independent owner OTP,
// HMAC-bound anti-CSRF, replay-safe CAS writes. No raw file in public/GitHub.
import crypto from "node:crypto";
import {getStore} from "@netlify/blobs";
import guard from "./lib/squeegeeProductionGuard.js";
import owner from "./lib/squeegeeProductionOwnerAuth.js";
import data from "./lib/squeegeeProductionCustomerData.js";

const PATH="/api/squeegee-production-hq-import";
const MAX_FILE=5_000_000;
const MAX_POST=5_800_000;
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private,no-store,max-age=0",
  "Pragma":"no-cache","X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const esc=value=>String(value??"").replace(/&/g,"&amp;")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const style='<style>body{background:#11141e;color:#fff;font:16px/1.5 system-ui;margin:0;padding:16px}'+
  'main{max-width:690px;margin:20px auto;border:2px solid #f5dd51;padding:22px;background:#252838}'+
  'h1{font-size:26px}h2{font-size:19px}a{color:#f5dd51}'+
  'input,button{font:inherit;box-sizing:border-box;padding:12px;margin:8px 0}input[type=file],button{width:100%}'+
  'button{background:#f5dd51;color:#111;font-weight:bold;border:2px solid #111}'+
  'section{padding:14px;background:#30364c;margin:14px 0}small{color:#ddd}</style>';
const page=(content,status=200)=>
  new Response('<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>NI Bin Guy - private production history import</title>'+style+
    '</head><body><main><h1>Production Customer HQ history</h1>'+content+
    '<p><small>Owner-only, private import. Never creates or changes a Squeegee customer or job.</small></p></main></body></html>',
    {status,headers:HEADERS});
const store=name=>getStore({name,consistency:"strong"});
function scope(req,ctx){
  return {hostname:new URL(req.url).hostname,
    deployContext:ctx?.deploy?.context,siteId:ctx?.site?.id};
}
function csrfFor(cookie,env=process.env){
  const key=env?.SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET;
  if(typeof cookie!=="string"||cookie.length<50 ||
     typeof key!=="string"||key.length<32)return null;
  return crypto.createHmac("sha256",key)
    .update("nibinguy-production-hq-import-csrf-v1:"+cookie).digest("hex");
}
function csrfValid(actual,cookie,env=process.env){
  const expected=csrfFor(cookie,env);
  return Boolean(expected&&typeof actual==="string"&&
    /^[a-f0-9]{64}$/.test(actual)&&
    crypto.timingSafeEqual(Buffer.from(actual,"hex"),
      Buffer.from(expected,"hex")));
}
export default async function handler(request,context){
  const runtime=scope(request,context);
  if(!guard.isVerifiedProductionScope(runtime))
    return new Response("Not found",{status:404});
  if(!["GET","POST"].includes(request.method))
    return new Response("Method not allowed",{status:405});
  const cookie=owner.fromHeader(request.headers.get("cookie"));
  if(!owner.validCookie(cookie,process.env,Date.now(),runtime))
    return request.method==="GET"?
      page('<section><strong>Owner sign-in required</strong>'+
        '<p><a href="/api/squeegee-production-auto-status">Sign in with your owner access code</a> then return to this page.</p></section>',403):
      page("<section>Owner session expired. No history changed.</section>",403);
  const csrf=csrfFor(cookie);
  if(!csrf)return page("<section>Secure upload unavailable.</section>",503);
  const historyStore=store(data.DATA_STORE);
  const consentStore=store(data.CONSENT_STORE);
  if(request.method==="GET"){
    let existing;
    try{existing=await historyStore.get(data.DATA_KEY,{
      type:"json",consistency:"strong",
    });}catch{return page("<section>Private history storage unavailable.</section>",503);}
    const summary=existing?.summary;
    return page('<section><strong>'+
      (summary?"PRIVATE HISTORY IMPORTED":"NOT YET IMPORTED")+
      '</strong><p>'+(summary?
      'Verified backup: '+esc(existing.asOf)+
      ' · Accounts: '+summary.activeAccounts+
      ' · Email accounts: '+summary.emailAvailable+
      ' · Shared-email matches needing review: '+summary.duplicateEmailCount+
      ' · Verified paid visits: '+summary.paidEvents+
      ' · Cleaning XP: '+summary.cleaningPoints+
      ' · Source: '+(data.snapshotFresh(existing)?"current":"STALE — refresh required"):
      'Prepare a fresh private customer-history JSON from your verified Squeegee export.')+
      '</p></section>'+
      '<section><h2>Import verified history</h2>'+
      '<form method="post" enctype="multipart/form-data" action="'+PATH+'">'+
      '<input name="csrf" type="hidden" value="'+esc(csrf)+'">'+
      '<label for="history">Private Squeegee history JSON (max 5 MB)</label>'+
      '<input type="file" id="history" name="history" accept=".json,application/json" required>'+
      '<p><label><input type="checkbox" name="verifiedSource" value="yes" required> '+
      'I confirm this file contains current active customers and paid-completed cleans from a verified Squeegee export, with no invented payments or cleaning dates.</label></p>'+
      '<button type="submit">Verify and import privately</button></form>'+
      '<p><small>No names are published automatically. Existing genuine production opt-ins are kept only where the account identity and first name still match.</small></p></section>');
  }
  const origin=request.headers.get("origin");
  if(origin!==null&&origin!=="null"&&origin!=="https://nibing.uy")
    return page("<section>Cross-site import blocked.</section>",403);
  const size=Number(request.headers.get("content-length")||"0");
  if(!Number.isFinite(size)||size>MAX_POST)
    return page("<section>File too large. No import performed.</section>",413);
  let form;
  try{form=await request.formData();}
  catch{return page("<section>Invalid multipart upload.</section>",400);}
  if(!csrfValid(form.get("csrf"),cookie)||
     form.get("verifiedSource")!=="yes")
    return page("<section>Signed owner permission required.</section>",403);
  const file=form.get("history");
  if(!file ||typeof file.text!=="function"||
     file.size<100||file.size>MAX_FILE)
    return page("<section>Choose a private JSON file under 5 MB.</section>",400);
  try{
    const source=await file.text();
    const validated=data.validateSource(JSON.parse(source));
    const prior=await historyStore.getWithMetadata(data.DATA_KEY,{
      type:"json",consistency:"strong",
    });
    if(prior?.data?.asOf && validated.asOf<prior.data.asOf)
      return page("<section>Older history cannot replace newer data.</section>",409);
    const sourceHash=data.hashSource(source);
    if(prior?.data?.sourceHash===sourceHash)
      return page("<section>Already imported. No points were duplicated.</section>",200);
    const savedSnapshot={...validated,sourceHash,importedAt:new Date().toISOString()};
    const oldConsent=await consentStore.getWithMetadata(data.CONSENT_KEY,{
      type:"json",consistency:"strong",
    });
    const nextConsent=data.buildConsent(savedSnapshot,oldConsent?.data||null);
    // CONSENT FIRST, HISTORY SECOND: an error can only hide old names;
    // never serve old authorisations against a new account list.
    const consents=await consentStore.setJSON(data.CONSENT_KEY,nextConsent,
      oldConsent?.etag?{onlyIfMatch:oldConsent.etag}:{onlyIfNew:true});
    if(consents?.modified!==true||!consents?.etag)
      return page("<section>Consent reconciliation uncertain; no new history was published.</section>",503);
    const result=await historyStore.setJSON(data.DATA_KEY,savedSnapshot,
      prior?.etag?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
    if(result?.modified!==true||!result?.etag)
      return page("<section>History storage result uncertain. Do not upload again until the owner status has been checked.</section>",503);
    return page('<section><h2>PRIVATE IMPORT VERIFIED</h2>'+
      '<p>Source: '+esc(savedSnapshot.asOf)+
      ' · Active accounts: '+validated.summary.activeAccounts+
      ' · Paid visits: '+validated.summary.paidEvents+
      ' · Cleaning XP: '+validated.summary.cleaningPoints+
      ' · Shared-email accounts held: '+validated.summary.duplicateEmailCount+
      '</p><p>No customer data was published. No Squeegee writes occurred.</p></section>'+
      '<p><a href="/customer-hq">Open Customer HQ</a></p>');
  }catch{
    return page("<section>Import validation failed or storage is unavailable. No public names have been enabled. Check the export is current, complete and internally reconciled.</section>",422);
  }
}
export const config={path:"/api/squeegee-production-hq-import"};
