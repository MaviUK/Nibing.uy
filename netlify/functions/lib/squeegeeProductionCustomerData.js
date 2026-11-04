"use strict";
// Production-only secure customer history, annual cleaning scores and opt-in.
// Do not import the frozen Preview #77 customer cohort or public data seed.
const crypto=require("node:crypto");
const {RULE_VERSION}=require("./squeegeeCleaningStreak");
const {safePublicTown}=require("./arcadePublicIdentity");

const DATA_STORE="nibinguy-production-hq-history";
const AUTH_STORE="nibinguy-production-hq-auth";
const CONSENT_STORE="nibinguy-production-hq-consents";
const DATA_KEY="latest-verified-history-v1";
const CONSENT_KEY="production-public-optins-v1";
const NOTICE_VERSION="nibinguy-production-firstname-town-xp-v1";
const SCHEMA_VERSION=1;
const MAX_ACCOUNTS=10000;
const MAX_EVENTS=2500;
const FRESH_MS=7*86400000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]{1,80}@[^\s@]{1,160}\.[^\s@]{2,24}$/;
const REF=/^(?:[0-9]{1,12}|CUS[0-9]{1,15}|[Aa]{2}[0-9]{3,8})$/;
const FIRST=/^[\p{L}][\p{L}'’\-]{0,39}$/u;
const TYPES=new Set(["paid_completed_clean","completed_payment_not_verified","recorded_skip"]);
function dateValue(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const ms=Date.parse(value+"T12:00:00.000Z");
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:null;
}
function ukDay(now){
  if(!Number.isFinite(now))return null;
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date(now));
  const row=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return [row.year,row.month,row.day].join("-");
}
function validSourceDay(asOf,now=Date.now()){
  const day=dateValue(asOf),today=ukDay(now);
  if(day===null||dateValue(today)===null||
     asOf>today)return false;
  const days=(dateValue(today)-day)/86400000;
  return Number.isInteger(days)&&days>=0&&days<=7;
}
function snapshotFresh(snapshot,now=Date.now()){
  return snapshot?.version===SCHEMA_VERSION&&
    validSourceDay(snapshot.asOf,now)&&
    snapshot.scoringVersion===RULE_VERSION&&
    typeof snapshot.sourceHash==="string"&&/^[a-f0-9]{64}$/.test(snapshot.sourceHash)&&
    Array.isArray(snapshot.accounts)&&snapshot.accounts.length>0;
}
function normalizeEmail(email){
  if(email==="")return "";
  if(typeof email!=="string"||email.length>260)return null;
  const value=email.trim().toLowerCase();
  return EMAIL.test(value)?value:null;
}
function validateSource(raw,{now=Date.now()}={}){
  if(!raw||raw.version!==1||!validSourceDay(raw.asOf,now)||
     raw.scoringVersion!==RULE_VERSION||
     !Array.isArray(raw.accounts)||raw.accounts.length<1||
     raw.accounts.length>MAX_ACCOUNTS)
    throw Error("invalid_production_history_source");
  const usedId=new Set(),usedRef=new Set(),emailCounts=new Map();
  const accounts=[];
  let events=0,paidEvents=0,points=0;
  for(const original of raw.accounts){
    if(!original||!UUID.test(String(original.id||""))||
       !REF.test(String(original.ref||""))||
       typeof original.firstName!=="string"||
       (original.firstName!==""&&!FIRST.test(original.firstName))||
       typeof original.town!=="string"||original.town.length>60||
       (original.town!=="Town unavailable"&&
         safePublicTown(original.town)!==original.town)||
       !Array.isArray(original.events)||original.events.length>MAX_EVENTS||
       !Number.isSafeInteger(original.points)||original.points<0||
       original.points>100000||
       !Number.isSafeInteger(original.paidCleans)||
       original.paidCleans<0||original.paidCleans>MAX_EVENTS||
       !Number.isSafeInteger(original.currentStreak)||
       original.currentStreak<0||original.currentStreak>MAX_EVENTS||
       !Number.isSafeInteger(original.recordedSkips)||
       original.recordedSkips<0||original.recordedSkips>MAX_EVENTS||
       original.nextBonus!==20+2*original.currentStreak)
      throw Error("invalid_production_customer_record");
    const id=original.id.toLowerCase();
    const ref=original.ref.toUpperCase();
    if(usedId.has(id)||usedRef.has(ref))
      throw Error("duplicate_production_customer_id_or_ref");
    usedId.add(id);usedRef.add(ref);
    const email=normalizeEmail(original.email);
    if(email===null||email!==original.email)
      throw Error("invalid_production_customer_email");
    if(email)emailCounts.set(email,(emailCounts.get(email)||0)+1);
    const cleanEvents=[];
    let paid=0,score=0,skips=0,previous="";
    for(const event of original.events){
      if(!event||dateValue(event.date)===null||
         event.date>raw.asOf||event.date<previous||
         !TYPES.has(event.event)||
         !Number.isSafeInteger(event.streak)||
         event.streak<0||event.streak>MAX_EVENTS||
         !Number.isSafeInteger(event.points)||
         event.points<0||event.points>1000||
         (event.event==="paid_completed_clean" &&
          (event.streak<1||event.points!==20+2*(event.streak-1)))||
         (event.event!=="paid_completed_clean"&&event.points!==0))
        throw Error("production_history_event_unverified");
      previous=event.date;
      score+=event.points;
      if(event.event==="paid_completed_clean")paid++;
      if(event.event==="recorded_skip")skips++;
      cleanEvents.push({date:event.date,event:event.event,
        points:event.points,streak:event.streak});
    }
    if(paid!==original.paidCleans||
       skips!==original.recordedSkips||
       score!==original.points)
      throw Error("production_history_totals_do_not_reconcile");
    events+=cleanEvents.length;paidEvents+=paid;points+=score;
    accounts.push({
      id,ref,email,firstName:original.firstName,town:original.town,
      points:score,paidCleans:paid,currentStreak:original.currentStreak,
      nextBonus:original.nextBonus,recordedSkips:skips,events:cleanEvents,
    });
  }
  return {
    version:SCHEMA_VERSION,asOf:raw.asOf,scoringVersion:RULE_VERSION,
    accounts,summary:{
      activeAccounts:accounts.length,
      emailAvailable:accounts.filter(a=>a.email).length,
      duplicateEmailCount:[...emailCounts.values()].filter(n=>n>1).length,
      historyEvents:events,paidEvents,cleaningPoints:points,
    },
  };
}
function hashSource(text){
  return crypto.createHash("sha256").update(text,"utf8").digest("hex");
}
function accountForEmail(snapshot,email){
  if(!snapshot?.accounts||typeof email!=="string")return null;
  const matches=snapshot.accounts.filter(a=>a.email===email);
  return matches.length===1?matches[0]:null;
}
function secret(env=process.env){
  const s=env?.SQUEEGEE_PRODUCTION_HQ_SECRET;
  return typeof s==="string"&&s.length>=32?s:null;
}
function portalEnv(env=process.env){
  const s=secret(env);
  return s?{SQUEEGEE_API_KEY:s}:{};
}
function publicRef(id,env=process.env){
  const s=secret(env);
  if(!s||!UUID.test(String(id||"")))return null;
  return "NBG-"+crypto.createHmac("sha256",s)
    .update("nibinguy-production-public-ref-v1:"+id.toLowerCase())
    .digest("hex").slice(0,10).toUpperCase();
}
function consentRecord(account,previous){
  const same=previous?.customerId===account.id &&
    previous?.ref===account.ref &&
    previous?.firstName===account.firstName &&
    previous?.town===account.town &&
    previous?.noticeVersion===NOTICE_VERSION;
  return {
    customerId:account.id,ref:account.ref,
    firstName:account.firstName,town:account.town,
    consent:same&&["granted","withdrawn"].includes(previous?.consent)?
      previous.consent:"pending",
    consentAt:same?previous?.consentAt||null:null,
    withdrawnAt:same?previous?.withdrawnAt||null:null,
    method:same?previous?.method||null:null,
    evidenceRef:same?previous?.evidenceRef||null:null,
    noticeVersion:same?previous?.noticeVersion||null:null,
  };
}
function buildConsent(snapshot,prior=null){
  const old=new Map((Array.isArray(prior?.records)?prior.records:[])
    .filter(row=>UUID.test(String(row?.customerId||"")))
    .map(row=>[row.customerId,row]));
  return {
    version:1,noticeVersion:NOTICE_VERSION,
    sourceHash:snapshot.sourceHash,sourceAsOf:snapshot.asOf,
    records:snapshot.accounts.map(a=>consentRecord(a,old.get(a.id))),
  };
}
function visibleConsent(account,consent){
  return Boolean(account?.email&&
    consent?.customerId===account.id &&
    consent.ref===account.ref &&
    consent.firstName===account.firstName &&
    consent.town===account.town &&
    consent.consent==="granted" &&
    typeof consent.consentAt==="string" &&
    consent.noticeVersion===NOTICE_VERSION &&
    !consent.withdrawnAt && FIRST.test(account.firstName));
}
function updateConsent(consents,account,{
  action,agree,firstName,sessionEvidence,
},now=Date.now()){
  if(consents?.version!==1||!Array.isArray(consents.records)||
     !["leaderboard-opt-in","leaderboard-withdraw"].includes(action))
    throw Error("invalid_production_consent_state");
  const index=consents.records.findIndex(r=>r.customerId===account.id);
  if(index<0)throw Error("consent_customer_not_found");
  const old=consents.records[index];
  if(old.ref!==account.ref)throw Error("consent_identity_changed");
  const next={...old};
  if(action==="leaderboard-opt-in"){
    if(agree!==true||typeof sessionEvidence!=="string"||
       sessionEvidence.length<16||
       typeof firstName!=="string"||!FIRST.test(firstName)||
       firstName!==account.firstName||!account.email)
      throw Error("consent_proof_required");
    Object.assign(next,{
      consent:"granted",firstName,consentAt:new Date(now).toISOString(),
      withdrawnAt:null,method:"portal_email_code",
      noticeVersion:NOTICE_VERSION,evidenceRef:sessionEvidence,
    });
  }else{
    Object.assign(next,{consent:"withdrawn",
      withdrawnAt:new Date(now).toISOString()});
  }
  const records=consents.records.slice();
  records[index]=next;
  return {...consents,records,updatedAt:new Date(now).toISOString()};
}
function tally(events,asOf){
  const byYear=new Map();
  for(const item of Array.isArray(events)?events:[]){
    if(item.event!=="paid_completed_clean"||
       item.date>asOf||!Number.isSafeInteger(item.points))continue;
    const year=Number(item.date.slice(0,4));
    if(year<2000||year>2099)continue;
    byYear.set(year,(byYear.get(year)||0)+item.points);
  }
  return byYear;
}
function availableYears(snapshot,now=Date.now()){
  const current=new Date(now).getUTCFullYear();
  let earliest=2024;
  for(const account of snapshot?.accounts||[]){
    for(const year of tally(account.events,snapshot.asOf).keys()){
      earliest=Math.min(earliest,year);
    }
  }
  return Array.from({length:Math.max(0,current-earliest+1)},
    (_,i)=>earliest+i);
}
function scores(snapshot,consent,env=process.env,{
  year=null,now=Date.now(),allowStale=false,
}={}){
  const years=availableYears(snapshot,now);
  if(!snapshotFresh(snapshot,now)&&!allowStale)
    return {entries:[],totalPlayers:0,
      status:"active_status_refresh_required",
      period:year===null?"overall":String(year),availableYears:years,
      sourceAsOf:snapshot?.asOf||null};
  if(year!==null&&!years.includes(year))
    throw Error("invalid_production_leaderboard_year");
  const records=new Map(
    (Array.isArray(consent?.records)?consent.records:[])
      .map(c=>[c.customerId,c])
  );
  if(!secret(env)||consent?.sourceHash!==snapshot?.sourceHash||
     consent?.version!==1)
    return {entries:[],totalPlayers:0,
      status:"consent_pending",sourceAsOf:snapshot.asOf,
      period:year===null?"overall":String(year),availableYears:years};
  const entries=[];
  for(const account of snapshot.accounts){
    if(!visibleConsent(account,records.get(account.id)))continue;
    const annual=tally(account.events,snapshot.asOf);
    const points=year===null?
      [...annual.values()].reduce((a,b)=>a+b,0):annual.get(year)||0;
    if(!points)continue;
    const ref=publicRef(account.id,env);
    if(!ref)continue;
    entries.push({customerRef:ref,
      displayName:account.firstName,town:account.town,points});
  }
  entries.sort((a,b)=>b.points-a.points||
    a.customerRef.localeCompare(b.customerRef));
  return {
    entries:entries.map((e,i)=>({...e,rank:i+1})),
    totalPlayers:entries.length,publicNamedCount:entries.length,
    status:"public_eligible_scores",
    sourceAsOf:snapshot.asOf,
    lastUpdatedAt:snapshot.importedAt||null,
    period:year===null?"overall":String(year),availableYears:years,
  };
}
function personalSummary(snapshot,consents,account,env=process.env,now=Date.now()){
  const years=availableYears(snapshot,now);
  const annual=tally(account.events,snapshot.asOf);
  const overall=scores(snapshot,consents,env,{now});
  const consent=consents?.records?.find(r=>r.customerId===account.id);
  const consented=visibleConsent(account,consent);
  const key=publicRef(account.id,env);
  const yearEntries={};
  for(const year of years){
    const points=annual.get(year)||0;
    if(!points)continue;
    const board=scores(snapshot,consents,env,{year,now});
    const rank=consented?
      board.entries.find(e=>e.customerRef===key)?.rank??null:null;
    yearEntries[String(year)]={points,rank};
  }
  const cleaningPoints=[...annual.values()].reduce((a,b)=>a+b,0);
  return {
    points:cleaningPoints,cleaningPoints,websiteXp:0,
    rank:consented?overall.entries.find(e=>e.customerRef===key)?.rank??null:null,
    yearly:yearEntries,yearlyXpTotal:cleaningPoints,
    rankingAvailable:consented&&overall.status==="public_eligible_scores",
    firstRecordedServiceYear:account.events?.length?
      Number(account.events[0].date.slice(0,4)):null,
  };
}
module.exports={
  DATA_STORE,AUTH_STORE,CONSENT_STORE,DATA_KEY,CONSENT_KEY,NOTICE_VERSION,
  validSourceDay,snapshotFresh,validateSource,hashSource,accountForEmail,
  secret,portalEnv,publicRef,buildConsent,visibleConsent,updateConsent,
  tally,availableYears,scores,personalSummary,
};
