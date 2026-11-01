"use strict";
const crypto = require("node:crypto");
const { canonicalLegacyRef } = require("./squeegeeActiveLeaderboardImport");
const staticHistory = require("./squeegeeActivePreviewSnapshot");
const { safePublicTown } = require("./arcadePublicIdentity");

const STORE_NAME = "n64-preview1-arcade-leaderboard-names-private";
const KEY = "first-name-consents-v1";
const NOTICE_VERSION = "nibinguy-leaderboard-firstname-town-xp-v1";
const MAX_BYTES = 250000;
const EXPECTED = 941;
const FIRST = /^[\p{L}][\p{L}'’\-]{0,39}$/u;
const SQUEEGEE_REF = /^[A-Za-z0-9\-]{1,30}$/;
const RELEVANT = [
  "squeegee_customer_uuid_PRIVATE",
  "squeegee_customer_reference_PRIVATE",
  "public_customer_reference_INTERNAL",
  "first_name_PRIVATE",
  "town",
  "streak_points",
  "name_quality",
  "consent_status",
];
const allowedQuality = new Set([
  "ready_for_consent", "review_single_name",
  "needs_review_title_and_one_word", "needs_review_unclear_first_name",
  "needs_review_multiple_or_number", "needs_review_possible_business",
  "needs_review_missing_name", "needs_review_only_title",
]);

function safeFirstName(value) {
  return typeof value === "string" && FIRST.test(value) ? value : null;
}
function parseSimpleCsv(input) {
  if(typeof input!=="string" || Buffer.byteLength(input,"utf8")>MAX_BYTES ||
     input.includes("\0"))throw new Error("invalid_private_consent_csv");
  const csv=input.replace(/^\uFEFF/,"");
  const records=[];let cols=[],field="",quoted=false;
  for(let i=0;i<csv.length;i++){
    const ch=csv[i];
    if(quoted){
      if(ch==='"'&&csv[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"'&&field==="")quoted=true;
    else if(ch===","){cols.push(field);field="";}
    else if(ch==="\n"||ch==="\r"){
      if(ch==="\r"&&csv[i+1]==="\n")i++;
      cols.push(field);field="";
      if(cols.some(x=>x!==""))records.push(cols);
      cols=[];
      if(records.length>EXPECTED+1)throw new Error("consent_csv_overflow");
    }else if(ch==='"')throw new Error("invalid_consent_csv_quote");
    else field+=ch;
    if(field.length>2000)throw new Error("consent_csv_field_too_long");
  }
  if(quoted)throw new Error("unterminated_consent_csv_quote");
  cols.push(field);
  if(cols.some(x=>x!==""))records.push(cols);
  if(records.length!==EXPECTED+1)throw new Error("unexpected_private_customer_count");
  const columns=records.shift();
  if(new Set(columns).size!==columns.length || RELEVANT.some(c=>!columns.includes(c)))
    throw new Error("invalid_consent_csv_header");
  const ix=Object.fromEntries(columns.map((c,i)=>[c,i]));
  return records.map(row=>{
    if(row.length!==columns.length)throw new Error("invalid_consent_csv_row");
    return Object.fromEntries(RELEVANT.map(c=>[c,row[ix[c]].trim()]));
  });
}
function preparePrivateConsentImport(csv,prior=null,now=Date.now()){
  const sourceRows=parseSimpleCsv(csv);
  const base=new Map(staticHistory.ENTRIES.map(([alias,town,points])=>
    [alias,{town,points}]));
  const existing=new Map((Array.isArray(prior?.records)?prior.records:[])
    .map(row=>[row.alias,row]));
  const aliases=new Set(),refs=new Set();
  const records=[];
  for(const row of sourceRows){
    const alias=row.public_customer_reference_INTERNAL;
    const ref=row.squeegee_customer_reference_PRIVATE;
    const baseline=base.get(alias);
    const firstName=safeFirstName(row.first_name_PRIVATE);
    if(!baseline || canonicalLegacyRef(row.squeegee_customer_uuid_PRIVATE)!==alias ||
       baseline.town!==safePublicTown(row.town) ||
       baseline.town!==row.town ||
       baseline.points!==Number(row.streak_points) ||
       !SQUEEGEE_REF.test(ref) ||
       row.consent_status!=="pending" ||
       !allowedQuality.has(row.name_quality) ||
       (row.first_name_PRIVATE && !firstName) ||
       aliases.has(alias) || refs.has(ref.toLowerCase()))
      throw new Error("consent_source_validation_failed");
    aliases.add(alias);refs.add(ref.toLowerCase());
    const old=existing.get(alias);
    const unchanged=old && old.ref===ref && old.firstName===firstName &&
      old.town===row.town;
    records.push({
      alias,ref,firstName:firstName||null,town:row.town,
      quality:row.name_quality,
      // Never infer consent from import CSV or site activity.
      consent:unchanged && ["granted","withdrawn"].includes(old.consent)
        ? old.consent:"pending",
      consentAt:unchanged?old.consentAt||null:null,
      withdrawnAt:unchanged?old.withdrawnAt||null:null,
      method:unchanged?old.method||null:null,
      evidenceRef:unchanged?old.evidenceRef||null:null,
      noticeVersion:unchanged?old.noticeVersion||null:null,
    });
  }
  records.sort((a,b)=>a.alias.localeCompare(b.alias));
  return {version:1,sourceAsOf:staticHistory.AS_OF,
    importedAt:new Date(now).toISOString(),
    sourceHash:crypto.createHash("sha256").update(csv).digest("hex"),
    records};
}
function changeConsent(snapshot,{
  reference,action,method,evidenceRef,confirm,correctedFirstName
},now=Date.now(),emailEligibleAliases=null){
  if(snapshot?.version!==1||!Array.isArray(snapshot.records)||
     snapshot.sourceAsOf!==staticHistory.AS_OF)
    throw new Error("consent_dataset_missing");
  if(!SQUEEGEE_REF.test(String(reference||""))||
     !["grant","withdraw"].includes(action))
    throw new Error("consent_change_invalid");
  const index=snapshot.records.findIndex(r=>r.ref===reference);
  if(index<0)throw new Error("consent_reference_not_found");
  const old=snapshot.records[index];
  const revised={...old};
  if(action==="grant"){
    if(emailEligibleAliases instanceof Set && !emailEligibleAliases.has(old.alias))
      throw new Error("email_required_for_leaderboard");
    if(confirm!=="yes"||!["signed_form","email_reply","recorded_call","portal_email_code"].includes(method)||
       typeof evidenceRef!=="string"||evidenceRef.trim().length<3||
       evidenceRef.length>120)throw new Error("consent_proof_required");
    const firstName=correctedFirstName
      ?safeFirstName(correctedFirstName.trim()):safeFirstName(revised.firstName);
    if(!firstName)throw new Error("first_name_needs_verification");
    revised.firstName=firstName;
    revised.consent="granted";revised.consentAt=new Date(now).toISOString();
    revised.withdrawnAt=null;revised.noticeVersion=NOTICE_VERSION;
    revised.method=method;revised.evidenceRef=evidenceRef.trim();
  }else{
    revised.consent="withdrawn";revised.withdrawnAt=new Date(now).toISOString();
  }
  const next=[...snapshot.records];next[index]=revised;
  return {...snapshot,updatedAt:new Date(now).toISOString(),records:next};
}

function initialiseFromPrivateCustomerHQ(snapshot,previous=null,now=Date.now()){
  if(!snapshot || !Array.isArray(snapshot.accounts) ||
     snapshot.asOf!==staticHistory.AS_OF)
    throw new Error("invalid_portal_consents_source");
  const rank=new Map(staticHistory.ENTRIES.map(([alias,town,points])=>
    [alias,{town,points}]));
  const existing=new Map((Array.isArray(previous?.records)?previous.records:[])
    .map(r=>[r.alias,r]));
  const records=[];
  for(const account of snapshot.accounts){
    const alias=canonicalLegacyRef(account.id);
    const seeded=rank.get(alias);
    if(!seeded)continue;
    if(seeded.town!==account.town || seeded.points!==account.points)
      throw new Error("mismatched_portal_consents_source");
    const firstName=safeFirstName(account.firstName);
    const prev=existing.get(alias);
    const same=prev && prev.ref===account.ref &&
      prev.firstName===(firstName||null) && prev.town===account.town;
    records.push({
      alias,ref:account.ref,firstName:firstName||null,town:account.town,
      quality:firstName?"ready_for_consent":"needs_review_missing_name",
      consent:same && ["granted","withdrawn"].includes(prev.consent)
        ?prev.consent:"pending",
      consentAt:same?prev.consentAt||null:null,
      withdrawnAt:same?prev.withdrawnAt||null:null,
      method:same?prev.method||null:null,
      evidenceRef:same?prev.evidenceRef||null:null,
      noticeVersion:same?prev.noticeVersion||null:null,
    });
  }
  if(records.length!==EXPECTED)throw new Error("incomplete_portal_consents_source");
  records.sort((a,b)=>a.alias.localeCompare(b.alias));
  return {version:1,sourceAsOf:staticHistory.AS_OF,
    importedAt:new Date(now).toISOString(),records};
}

function consentStats(snapshot) {
  const rows=Array.isArray(snapshot?.records)?snapshot.records:[];
  return {
    total:rows.length,
    consented:rows.filter(r=>r.consent==="granted").length,
    pending:rows.filter(r=>r.consent==="pending").length,
    withdrawn:rows.filter(r=>r.consent==="withdrawn").length,
    requiresNameReview:rows.filter(r=>r.quality!=="ready_for_consent").length,
  };
}
function publicConsentBoard(snapshot,fullBoard,emailEligibleAliases){
  // Without the PRIVATE Customer HQ email eligibility set, nothing is public.
  // A valid consent alone can never re-add an account with no email.
  if(snapshot?.version!==1 || snapshot?.sourceAsOf!==staticHistory.AS_OF ||
     !Array.isArray(snapshot.records) || !(emailEligibleAliases instanceof Set))
    return null;
  if(fullBoard?.status==="active_status_refresh_required")
    return {...fullBoard,entries:[],totalPlayers:0};
  const approved=new Map(snapshot.records.filter(r=>
    emailEligibleAliases.has(r.alias) &&
    r.consent==="granted" && !r.withdrawnAt &&
    r.noticeVersion===NOTICE_VERSION && r.consentAt &&
    r.method && r.evidenceRef && safeFirstName(r.firstName) &&
    safePublicTown(r.town)===r.town
  ).map(r=>[r.alias,r]));
  const all=Array.isArray(fullBoard?.entries)?fullBoard.entries:[];
  const ranked=all.filter(row=>approved.has(row.customerRef) &&
    approved.get(row.customerRef).town===row.town)
    .map(row=>({...row,displayName:approved.get(row.customerRef).firstName}))
    .sort((a,b)=>b.points-a.points ||
      a.customerRef.localeCompare(b.customerRef));
  return {entries:ranked.slice(0,10).map((r,i)=>({...r,rank:i+1})),
    totalPlayers:ranked.length,
    sourceAsOf:staticHistory.AS_OF,
    lastUpdatedAt:snapshot.updatedAt||snapshot.importedAt||null,
    status:ranked.length?"consent_only":"consent_pending",
  };
}
module.exports={
  STORE_NAME,KEY,NOTICE_VERSION,EXPECTED,MAX_BYTES,
  safeFirstName,parseSimpleCsv,preparePrivateConsentImport,
  changeConsent,initialiseFromPrivateCustomerHQ,consentStats,publicConsentBoard,
};
