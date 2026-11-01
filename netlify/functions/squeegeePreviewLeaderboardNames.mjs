// Preview 1 owner-only first-name leaderboard consent controls.
// Never returns unconsented names in a public endpoint.
import { getStore } from "@netlify/blobs";
import owner from "./lib/squeegeePreviewTestSession.js";
import api from "./lib/squeegeeApiV3.js";
import names from "./lib/squeegeeLeaderboardNameConsent.js";
import customerHQ from "./lib/customerHQ.js";
import privatePreview from "./lib/squeegeeOwnerLeaderboardPreview.js";

const PATH="/api/squeegee-preview-leaderboard-names";
const ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";
const pageHeaders={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const safe=value=>String(value??"").replace(/&/g,"&amp;")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const page=(body,status=200)=>new Response(
  '<!doctype html><html lang="en"><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>NI Bin Guy • Private leaderboard permissions</title>'+
  '<style>body{background:#101727;color:#fff;font:16px/1.5 system-ui;margin:0;padding:16px}'+
  'main{max-width:720px;margin:auto}h1{font-size:25px}h2{font-size:19px}'+
  'section{background:#1d2b43;border-left:4px solid #facc15;padding:15px;margin:14px 0}'+
  'label{display:block;margin-top:9px}input,select,button{font:inherit;box-sizing:border-box;'+
  'width:100%;padding:11px;margin-top:5px}input[type=checkbox]{width:auto}'+
  'button{background:#facc15;color:#111;border:0;font-weight:750;margin:13px 0}'+
  'strong,a{color:#facc15}small{color:#b8c5d7}</style><main>'+
  '<h1>NI Bin Guy • Private leaderboard permissions</h1>'+body+
  '<p><small>Draft N64 Preview 1 only. This tool never changes Squeegee accounts or sends permission emails. '+ 
  'Customer first names and original Squeegee references are stored only in owner-protected Netlify Blobs.</small></p></main>',
  {status,headers:pageHeaders}
);
function runtimeScope(request,ctx){
  return {hostname:new URL(request.url).hostname,
    deployContext:ctx?.deploy?.context,siteId:ctx?.site?.id};
}
function store(){return getStore({name:names.STORE_NAME,consistency:"strong"});}
function ownerPreviewSection(preview){
  if(!preview)return '<section><h2>Private ranking preview</h2>'+
    '<p>Import the private Customer HQ history to calculate the email-eligible rankings.</p></section>';
  const entries=preview.rows.map(row=>
    '<li style="display:flex;justify-content:space-between;gap:10px;'+
    'border-bottom:1px solid #596b87;padding:11px 0;align-items:start">'+
    '<div><strong style="color:#ffe175">#'+row.rank+' '+safe(row.firstName||"NAME TO CHECK")+'</strong>'+
    '<div>'+safe(row.town)+'</div>'+
    '<small>Private Squeegee ref: '+safe(row.customerReference)+
    ' · Verified from Squeegee backup · '+safe(row.permission==='approved'?'Consent recorded':row.permission==='withdrawn'?
      'Withdrawn':'Waiting for permission')+'</small></div>'+
    '<strong style="white-space:nowrap;color:#82f1bb">'+Number(row.points).toLocaleString('en-GB')+' XP</strong></li>'
  ).join('');
  return '<section style="border-left-color:#81e4b1">'+
    '<h2>OWNER PREVIEW — VERIFIED TOP 20</h2>'+
    '<p><strong>'+preview.verified+'</strong> verified ranked accounts from the '+
    safe(preview.verifiedAsOf||"dated")+' Squeegee backup · '+
    '<strong>'+Number(preview.cleaningXp).toLocaleString('en-GB')+
    '</strong> historic cleaning XP · <strong>'+preview.approved+
    '</strong> with recorded consent.</p>'+
    '<p><small>PRIVATE OWNER VIEW. Names and scores below are not public. '+
    'The website displays first name, town and XP ONLY after individual consent; '+
    'no-email accounts are excluded. This is based on the dated Squeegee backup.</small></p>'+
    '<ol style="list-style:none;margin:0;padding:0">'+entries+'</ol></section>';
}

function renderDashboard(snapshot,note="",emailEligibility=null,preview=null){
  const stats=names.consentStats(snapshot);
  return (note?'<section><strong>'+safe(note)+'</strong></section>':'')+
    '<section><h2>Private first-name preparation</h2>'+
    '<p><a style="display:block;background:#f7d45a;color:#14213b;text-decoration:none;padding:13px;font-weight:900;text-align:center" '+
    'href="/?ntl-drawer-state=hidden&amp;owner-board=1#live-leaderboard">'+
    '★ VIEW ALL VERIFIED CUSTOMERS IN THE N64 LEADERBOARD →</a></p>'+
    '<p><strong>'+stats.total+'</strong> imported • <strong>'+stats.consented+
    '</strong> permission granted • '+stats.pending+' pending • '+
    stats.withdrawn+' withdrawn • '+stats.requiresNameReview+
    ' first names needing review (account verification is separate).</p>'+
    '<p><strong>'+(emailEligibility?
      emailEligibility.verifiedCount+' imported ranked accounts are VERIFIED':
      'Email eligibility not loaded yet')+
      '</strong>. '+(emailEligibility?
        'Verification is based on the '+safe(emailEligibility.verificationAsOf)+
        ' backup, NOT a live status check. ':'')+
      'Account verification is separate from publication permission. '+
      'Accounts without a valid Squeegee email address are excluded '+
      'from rankings and player counts, even if they have past cleans. '+
      'Their historical points are not deleted.</p>'+
    '<p>Original Squeegee reference stays private. Public entries use only '+ 
    '<strong>first name · town · XP</strong> and require recorded permission.'+
    ' When the first list is imported, customers without recorded consent '+ 
    'are hidden from the public leaderboard, but their XP is preserved.</p></section>'+
    ownerPreviewSection(preview)+
    '<section><h2>1. Import the private first-name CSV</h2>'+
    '<p>Use the private 941-customer consent-tracking CSV; every record must '+ 
    'start with consent pending. Reimporting preserves approved or withdrawn '+ 
    'choices only when that customer’s reference, first name and town match.</p>'+
    '<form method="post" enctype="multipart/form-data" action="'+PATH+'">'+
    '<input type="hidden" name="action" value="import">'+
    '<label for="file">Private consent list (.csv, max 250 KB)</label>'+
    '<input id="file" name="file" type="file" accept=".csv,text/csv" required>'+
    '<button>Save private consent list (no names published)</button></form></section>'+
    '<section><h2>2. Record an individual customer’s permission</h2>'+
    '<p>Use the exact Squeegee customer reference (e.g. 3027 or CUS…). '+ 
    'Do not record permission without evidence from the customer.</p>'+
    '<form method="post" action="'+PATH+'">'+
    '<input type="hidden" name="action" value="grant">'+
    '<label for="ref">Squeegee customer reference</label>'+
    '<input id="ref" name="ref" maxlength="30" required>'+
    '<label for="firstName">Corrected first name (optional)</label>'+
    '<input id="firstName" name="firstName" maxlength="40">'+
    '<label for="method">How did they give permission?</label>'+
    '<select id="method" name="method" required>'+
    '<option value="">Select evidence type</option>'+
    '<option value="email_reply">Customer email reply</option>'+
    '<option value="signed_form">Signed form</option>'+
    '<option value="recorded_call">Documented call</option></select>'+
    '<label for="evidence">Evidence ID / where consent is recorded</label>'+
    '<input id="evidence" name="evidence" maxlength="120" required>'+
    '<label><input type="checkbox" name="confirm" value="yes" required> I verified the customer expressly '+ 
    'agreed to display their first name, town and loyalty score publicly, and '+ 
    'explained how they can withdraw.</label>'+
    '<button>Record permission & show first name publicly</button></form></section>'+
    '<section><h2>3. Remove public visibility</h2>'+
    '<form method="post" action="'+PATH+'">'+
    '<input type="hidden" name="action" value="withdraw">'+
    '<label for="removeRef">Squeegee customer reference</label>'+
    '<input id="removeRef" name="ref" maxlength="30" required>'+
    '<button>Withdraw permission — remove from leaderboard</button></form></section>';
}
export default async function handler(request,ctx){
  const scope=runtimeScope(request,ctx);
  if(!api.isExactPreview1(process.env,scope))
    return new Response("Not found",{status:404});
  if(!["GET","POST"].includes(request.method))
    return new Response("Method not allowed",{status:405});
  const cookie=owner.sessionCookieFromHeader(request.headers.get("cookie"));
  if(!owner.verifyTestSessionCookie(cookie,process.env,Date.now(),scope)){
    if(request.method==="POST")return page("<section>Owner session expired. Nothing changed.</section>",403);
    return page('<section><strong>Owner sign-in required.</strong>'+
      '<p>Use the emailed owner code to access this private first-name list.</p>'+
      '<a href="/api/squeegee-preview-test?returnTo='+
      encodeURIComponent(PATH)+'">Sign in with your owner code</a></section>',403);
  }
  const db=store();
  if(request.method==="GET"){
    const [snapshot,customerSnapshot]=await Promise.all([
      db.get(names.KEY,{type:"json",consistency:"strong"}),
      getStore({name:customerHQ.DATA_STORE,consistency:"strong"})
        .get(customerHQ.DATA_KEY,{type:"json",consistency:"strong"}),
    ]);
    const eligible=customerHQ.eligibleRankedEmailAccounts(customerSnapshot);
    const preview=privatePreview.ownerPrivateLeaderboardPreview(
      customerSnapshot,snapshot,eligible,20
    );
    return page(renderDashboard(snapshot,"",eligible,preview));
  }
  if(request.headers.get("origin")!==ORIGIN)
    return page("<section>Cross-site request blocked. Nothing changed.</section>",403);
  try{
    const form=await request.formData();
    const action=String(form.get("action")||"");
    if(action==="import"){
      const file=form.get("file");
      if(!file || typeof file.text!=="function" ||
         file.size<50 || file.size>names.MAX_BYTES)
        return page("<section>Choose the private consent CSV (max 250 KB).</section>",400);
      const previous=await db.get(names.KEY,{type:"json",consistency:"strong"});
      const next=names.preparePrivateConsentImport(await file.text(),previous);
      if(previous?.sourceHash===next.sourceHash)
        return page(renderDashboard(previous,"This consent list was already imported."));
      const saved=await db.setJSON(names.KEY,next);
      if(saved?.modified!==true)return page("<section>Import failed. No changes made.</section>",503);
      return page(renderDashboard(next,"Private names imported; no customer names published."));
    }
    if(action==="grant"||action==="withdraw"){
      const current=await db.getWithMetadata(names.KEY,{type:"json",consistency:"strong"});
      if(!current?.data || !current?.etag)
        return page("<section>Import the private first-name CSV first.</section>",409);
      const privateSnapshot=await getStore({
        name:customerHQ.DATA_STORE,consistency:"strong"
      }).get(customerHQ.DATA_KEY,{type:"json",consistency:"strong"});
      const eligible=customerHQ.eligibleRankedEmailAccounts(privateSnapshot);
      if(action==="grant" && !eligible)
        return page("<section>Import the private Customer HQ history first. No customer can be ranked until email eligibility is verified.</section>",409);
      const next=names.changeConsent(current.data,{
        reference:String(form.get("ref")||""),
        action,method:String(form.get("method")||""),
        evidenceRef:String(form.get("evidence")||""),
        confirm:String(form.get("confirm")||""),
        correctedFirstName:String(form.get("firstName")||""),
      },Date.now(),eligible?.aliases||null);
      const saved=await db.setJSON(names.KEY,next,{onlyIfMatch:current.etag});
      if(saved?.modified!==true)
        return page("<section>Another update was saved. Refresh and check again.</section>",409);
      return page(renderDashboard(next,action==="grant"
        ?"Permission recorded. First name and town are now eligible for public display."
        :"Permission withdrawn. Entry removed from the public leaderboard.",
        eligible));
    }
    return page("<section>Unsupported action.</section>",400);
  }catch(err){
    // Never echo submitted names, references or raw CSV into logs/HTML.
    const known=new Set(["unexpected_private_customer_count","consent_proof_required",
      "first_name_needs_verification","consent_reference_not_found",
      "consent_source_validation_failed","invalid_consent_csv_header",
      "invalid_private_consent_csv","consent_csv_overflow",
      "email_required_for_leaderboard"]);
    const code=known.has(err?.message)?err.message:"invalid_or_conflicting_request";
    return page('<section><strong>Could not save the change.</strong>'+
      '<p>Reason: '+safe(code)+'. Please review the private file or account reference.</p></section>',422);
  }
}
// Netlify's static route manifest requires a literal path here, not PATH.
export const config={path:"/api/squeegee-preview-leaderboard-names"};
