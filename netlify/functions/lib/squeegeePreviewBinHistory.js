"use strict";
// Preview #77 only: private, verified Squeegee history scored PER PHYSICAL BIN.
// This module holds no customer records. Real customer JSON is imported only
// through the owner's authenticated, CSRF-protected private Netlify upload.
const {canonicalLegacyRef}=require("./squeegeeActiveLeaderboardImport");
const {safePublicTown}=require("./arcadePublicIdentity");
const VERSION="2026-11-streak-20-plus-2-per-paid-bin-v1";
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REF=/^(?:[0-9]{1,12}|CUS[0-9]{1,15}|[Aa]{2}[0-9]{3,8})$/;
const EMAIL=/^[^\s@]{1,80}@[^\s@]{1,160}\.[^\s@]{2,24}$/;
const FIRST=/^[\p{L}][\p{L}'’\-]{0,39}$/u;
const EVENTS=new Set(["paid_completed_clean","completed_payment_not_verified",
  "completed_non_bin_service","recorded_skip"]);
function dateValue(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const t=Date.parse(value+"T12:00:00Z");
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value?t:null;
}
function ukToday(now=Date.now()){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now));
  const a=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return a.year+"-"+a.month+"-"+a.day;
}
function fresh(asOf,now=Date.now()){
  const day=dateValue(asOf),today=dateValue(ukToday(now));
  if(day===null||today===null||day>today)return false;
  const days=(today-day)/86400000;
  return Number.isInteger(days)&&days>=0&&days<=7;
}
function isBinSnapshot(raw){
  return raw?.version===1&&raw.scoringVersion===VERSION &&
    typeof raw.asOf==="string"&&Array.isArray(raw.accounts)&&
    raw.accounts.length>=1&&raw.accounts.length<=5000;
}
function validateBinSource(raw,{now=Date.now()}={}){
  if(!isBinSnapshot(raw)||!fresh(raw.asOf,now))
    throw Error("per_bin_history_source_invalid_or_stale");
  const accounts=[],ids=new Set(),refs=new Set(),aliases=new Set();
  const emailCounts=new Map();
  let points=0,paidBins=0,paidVisits=0,historyEvents=0,ranked=0;
  for(const row of raw.accounts){
    if(!row || typeof row.id!=="string"||!UUID.test(row.id)||
       typeof row.ref!=="string"||!REF.test(row.ref)||
       typeof row.email!=="string"||
       (row.email!==""&&(!EMAIL.test(row.email)||row.email!==row.email.toLowerCase()))||
       typeof row.firstName!=="string"||
       (row.firstName!==""&&!FIRST.test(row.firstName))||
       typeof row.town!=="string" || row.town.length>60 ||
       (row.town!=="Town unavailable"&&safePublicTown(row.town)!==row.town)||
       !Number.isSafeInteger(row.points)||row.points<0||row.points>100000||
       !Number.isSafeInteger(row.paidCleans)||row.paidCleans<0||row.paidCleans>50000||
       !Number.isSafeInteger(row.currentStreak)||row.currentStreak<0||row.currentStreak>2000||
       row.nextBonus!==20+2*row.currentStreak||
       !Number.isSafeInteger(row.recordedSkips)||row.recordedSkips<0||
       !Array.isArray(row.events)||row.events.length>2500)
      throw Error("per_bin_customer_invalid");
    const id=row.id.toLowerCase(), ref=row.ref.toUpperCase();
    const alias=canonicalLegacyRef(id);
    if(ids.has(id)||refs.has(ref)||!alias||aliases.has(alias))
      throw Error("per_bin_duplicate_customer");
    ids.add(id);refs.add(ref);aliases.add(alias);
    if(row.email)emailCounts.set(row.email,(emailCounts.get(row.email)||0)+1);
    let previous="",score=0,units=0,visits=0,skips=0;
    const events=[];
    for(const e of row.events){
      if(!e||dateValue(e.date)===null||e.date<"2000-01-01"||
         e.date>raw.asOf||e.date<previous||!EVENTS.has(e.event)||
         !Number.isSafeInteger(e.streak)||e.streak<0||e.streak>2000||
         !Number.isSafeInteger(e.quantity)||e.quantity<0||e.quantity>20||
         !Number.isSafeInteger(e.points)||e.points<0||e.points>1000||
         (e.event==="paid_completed_clean"&&
           (e.quantity<1||e.streak<1||
            e.points!==(20+2*(e.streak-1))*e.quantity))||
         (e.event==="completed_payment_not_verified"&&e.quantity<1)||
         ((e.event==="recorded_skip"||e.event==="completed_non_bin_service")&&e.quantity!==0)||
         (e.event!=="paid_completed_clean"&&e.points!==0))
        throw Error("per_bin_event_invalid");
      previous=e.date;
      score+=e.points;
      if(e.event==="paid_completed_clean"){units+=e.quantity;visits++;}
      if(e.event==="recorded_skip")skips++;
      events.push({date:e.date,event:e.event,points:e.points,
        streak:e.streak,quantity:e.quantity});
    }
    if(score!==row.points||units!==row.paidCleans||skips!==row.recordedSkips)
      throw Error("per_bin_reconciliation_failed");
    if(score>0&&row.town!=="Town unavailable")ranked++;
    points+=score;paidBins+=units;paidVisits+=visits;historyEvents+=events.length;
    accounts.push({id,ref:row.ref,email:row.email,firstName:row.firstName,
      town:row.town,points:score,paidCleans:units,
      currentStreak:row.currentStreak,nextBonus:row.nextBonus,
      recordedSkips:skips,events,historyAsOf:raw.asOf});
  }
  // Lock the initial 5 November source to independently verified totals.
  // Later weekly backups are dynamic and require owner authentication.
  if(raw.asOf==="2026-11-05" &&
     (accounts.length!==1020||points!==1008106||paidBins!==25921))
    throw Error("five_nov_audit_totals_mismatch");
  const countShared=[...emailCounts.values()].filter(n=>n>1).length;
  return {version:1,asOf:raw.asOf,scoringVersion:VERSION,accounts,
    summary:{activeAccounts:accounts.length,rankedCustomers:ranked,
      rankedPoints:points,historyEvents,allHistoricalPoints:points,
      emailAvailable:accounts.filter(x=>x.email).length,
      duplicateEmailCount:countShared,verifiedPaidBins:paidBins,
      verifiedPaidVisits:paidVisits,rankedWithEmail:0,
      rankedWithEmailPoints:0}};
}
function eligibleBinAccounts(snapshot){
  if(!isBinSnapshot(snapshot)||!fresh(snapshot.asOf))return null;
  const seen=new Set(),emails=new Map(),aliases=new Set();
  let verifiedActiveEmailAccounts=0,historicalPoints=0,verifiedPaidBins=0;
  for(const a of snapshot.accounts){
    if(!UUID.test(String(a?.id||""))||seen.has(a.id))return null;
    seen.add(a.id);
    if(a.email&&EMAIL.test(a.email)){
      verifiedActiveEmailAccounts++;
      emails.set(a.email,(emails.get(a.email)||0)+1);
    }
  }
  for(const a of snapshot.accounts){
    if(!a.email||emails.get(a.email)!==1||
       a.points<=0||a.town==="Town unavailable" ||
       safePublicTown(a.town)!==a.town)continue;
    const alias=canonicalLegacyRef(a.id);
    aliases.add(alias);historicalPoints+=a.points;
    verifiedPaidBins+=a.paidCleans;
  }
  return {aliases,count:aliases.size,historicalPoints,verifiedPaidBins,
    verifiedAliases:aliases,verifiedCount:aliases.size,
    verifiedImportedActiveAccounts:snapshot.accounts.length,
    verifiedActiveEmailAccounts,verificationAsOf:snapshot.asOf,
    verificationStatus:"verified_from_squeegee_backup"};
}
module.exports={VERSION,fresh,isBinSnapshot,validateBinSource,eligibleBinAccounts};
