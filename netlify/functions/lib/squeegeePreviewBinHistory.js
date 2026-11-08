"use strict";
// Preview #77 only: private, verified Squeegee history scored PER PHYSICAL BIN.
// This module holds no customer records. Real customer JSON is imported only
// through the owner's authenticated, CSRF-protected private Netlify upload.
const {canonicalLegacyRef}=require("./squeegeeActiveLeaderboardImport");
const {safePublicTown}=require("./arcadePublicIdentity");
const overdue=require("./squeegeeOverduePenalty");
const VERSION="2026-11-streak-20-plus-2-per-job-per-paid-bin-v2";
const LEGACY_VERSION="2026-11-streak-20-plus-2-per-paid-bin-v1";
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
// A dated public scoreboard may remain readable briefly when a weekly import
// runs late. This does not certify any new clean, reactivate customers, or
// permit importing old data. The source as-of date must stay visible.
const DISPLAY_GRACE_DAYS=35;
function displayable(asOf,now=Date.now()){
  const day=dateValue(asOf),today=dateValue(ukToday(now));
  if(day===null||today===null||day>today)return false;
  const days=(today-day)/86400000;
  return Number.isInteger(days)&&days>=0&&days<=DISPLAY_GRACE_DAYS;
}
function isBinSnapshot(raw){
  return raw?.version===1&&
    [VERSION,LEGACY_VERSION].includes(raw.scoringVersion) &&
    typeof raw.asOf==="string"&&Array.isArray(raw.accounts)&&
    raw.accounts.length>=1&&raw.accounts.length<=5000;
}
function validateBinSource(raw,{now=Date.now()}={}){
  if(!isBinSnapshot(raw)||raw.scoringVersion!==VERSION||!fresh(raw.asOf,now))
    throw Error("per_job_history_source_invalid_or_stale");
  if(Object.hasOwn(raw,"penaltySourceVersion")&&
     raw.penaltySourceVersion!==overdue.VERSION)
    throw Error("overdue_evidence_invalid");
  const hasOverdueSource=raw.penaltySourceVersion===overdue.VERSION;
  const accounts=[],ids=new Set(),refs=new Set(),aliases=new Set();
  const globalJobOwners=new Map();
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
       !Array.isArray(row.events)||row.events.length>2500||
       !Array.isArray(row.jobs)||row.jobs.length>200||
       (hasOverdueSource&&(!["settled","outstanding","unknown"].includes(row.balanceState)||
         !Array.isArray(row.outstandingJobs)||row.outstandingJobs.length>2500||
         !Array.isArray(row.settledJobs)||row.settledJobs.length>2500)))
      throw Error("per_bin_customer_invalid");
    const id=row.id.toLowerCase(), ref=row.ref.toUpperCase();
    const alias=canonicalLegacyRef(id);
    if(ids.has(id)||refs.has(ref)||!alias||aliases.has(alias))
      throw Error("per_bin_duplicate_customer");
    ids.add(id);refs.add(ref);aliases.add(alias);
    if(row.email)emailCounts.set(row.email,(emailCounts.get(row.email)||0)+1);
    const jobKeys=new Set();
    const jobs=row.jobs.map(job=>{
      if(!job||!UUID.test(String(job.id||""))||
         jobKeys.has(job.id.toLowerCase())||
         typeof job.label!=="string"||
         !/^(?:(?:Black|Brown|Blue|Green)(?: \+ (?:Black|Brown|Blue|Green))*|Other job)$/.test(job.label)||
         !Number.isSafeInteger(job.currentStreak)||job.currentStreak<0||
         job.currentStreak>2000||job.nextBonus!==20+2*job.currentStreak||
         !Number.isSafeInteger(job.paidCleans)||job.paidCleans<0||
         !Number.isSafeInteger(job.points)||job.points<0||
         !Number.isSafeInteger(job.recordedSkips)||job.recordedSkips<0||
         (job.lastCompletedOn!==null&&dateValue(job.lastCompletedOn)===null))
         throw Error("per_job_summary_invalid");
      const canonicalId=job.id.toLowerCase();
      const jobOwner=globalJobOwners.get(canonicalId);
      if(jobOwner && jobOwner!==id)throw Error("per_job_cross_customer_conflict");
      globalJobOwners.set(canonicalId,id);
      jobKeys.add(canonicalId);
      return {...job,id:canonicalId};
    });
    if(jobs.length>0&&!Array.isArray(row.events))
      throw Error("per_job_events_missing");
    const state=jobs.map(()=>({streak:0,lastVisitDay:null,
      points:0,paidCleans:0,skips:0,lastCompletedOn:null}));
    let previous="",score=0,units=0,visits=0,skips=0;
    const events=[];
    for(const e of row.events){
      if(!e||dateValue(e.date)===null||e.date<"2000-01-01"||
         e.date>raw.asOf||e.date<previous||!EVENTS.has(e.event)||
         !Number.isSafeInteger(e.j)||e.j<0||e.j>=jobs.length||
         !Number.isSafeInteger(e.streak)||e.streak<0||e.streak>2000||
         !Number.isSafeInteger(e.quantity)||e.quantity<0||e.quantity>20||
         !Number.isSafeInteger(e.points)||e.points<0||e.points>20000||
         (e.event==="paid_completed_clean"&&e.quantity<1)||
         (e.event==="completed_payment_not_verified"&&e.quantity<1)||
         ((e.event==="recorded_skip"||e.event==="completed_non_bin_service")&&e.quantity!==0)||
         (e.event!=="paid_completed_clean"&&e.points!==0))
        throw Error("per_job_event_invalid");
      const job=state[e.j];
      previous=e.date;
      if(e.event==="recorded_skip"){
        job.streak=0;job.lastVisitDay=null;job.skips++;skips++;
      }else if(e.event==="paid_completed_clean"||
                e.event==="completed_payment_not_verified"){
        if(job.lastVisitDay!==e.date){
          job.streak++;job.lastVisitDay=e.date;
        }
        job.lastCompletedOn=e.date;
        if(e.event==="paid_completed_clean"){
          const expected=e.quantity*(20+2*(job.streak-1));
          if(e.points!==expected)throw Error("per_job_points_mismatch");
          job.points+=expected;job.paidCleans+=e.quantity;
          score+=expected;units+=e.quantity;visits++;
        }
      }
      if(e.streak!==job.streak)throw Error("per_job_streak_mismatch");
      events.push({date:e.date,event:e.event,points:e.points,
        streak:e.streak,quantity:e.quantity,j:e.j});
    }
    for(let j=0;j<jobs.length;j++){
      const derived=state[j],reported=jobs[j];
      if(derived.streak!==reported.currentStreak||
         derived.points!==reported.points||
         derived.paidCleans!==reported.paidCleans||
         derived.skips!==reported.recordedSkips||
         derived.lastCompletedOn!==reported.lastCompletedOn)
        throw Error("per_job_summary_mismatch");
    }
    if(score!==row.points||units!==row.paidCleans||
       skips!==row.recordedSkips||
       row.currentStreak!==Math.max(0,...jobs.map(j=>j.currentStreak)))
      throw Error("per_job_reconciliation_failed");
    const pending=[],settled=[];
    if(hasOverdueSource){
      const unpaid=new Set(events.filter(e=>e.event==="completed_payment_not_verified")
        .map(e=>e.j+":"+e.date));
      const paid=new Set(events.filter(e=>e.event==="paid_completed_clean")
        .map(e=>e.j+":"+e.date));
      const seenCandidates=new Set(),seenJobsOnDay=new Set();
      for(const candidate of row.outstandingJobs){
        const id=String(candidate?.id||"").toLowerCase();
        const j=candidate?.j,dueOn=candidate?.dueOn;
        const signature=j+":"+dueOn;
        const occurrenceUUID=UUID.test(id);
        const qualified=id===jobs[j]?.id+dueOn;
        if(row.balanceState!=="outstanding" ||
           !Number.isSafeInteger(j)||j<0||j>=jobs.length||
           dateValue(dueOn)===null||dueOn>raw.asOf||
           (!occurrenceUUID&&!qualified)||
           seenCandidates.has(id)||seenJobsOnDay.has(signature)||
           !unpaid.has(signature))throw Error("overdue_pending_job_invalid");
        seenCandidates.add(id);seenJobsOnDay.add(signature);
        pending.push({id,dueOn,j});
      }
      const seenSettled=new Set(),seenPaidVisits=new Set();
      for(const candidate of row.settledJobs){
        const id=String(candidate?.id||"").toLowerCase();
        const j=candidate?.j,dueOn=candidate?.dueOn,paidOn=candidate?.paidOn;
        const signature=j+":"+dueOn;
        const occurrenceUUID=UUID.test(id);
        const qualified=id===jobs[j]?.id+dueOn;
        const start=dateValue(dueOn),finish=dateValue(paidOn);
        if(!Number.isSafeInteger(j)||j<0||j>=jobs.length||
           start===null||finish===null||dueOn>raw.asOf||paidOn>raw.asOf||
           finish-start<=28*86400000||
           (!occurrenceUUID&&!qualified)||seenSettled.has(id)||
           seenCandidates.has(id)||seenPaidVisits.has(signature)||
           !paid.has(signature))
          throw Error("overdue_settled_job_invalid");
        seenSettled.add(id);seenPaidVisits.add(signature);
        settled.push({id,dueOn,paidOn,j});
      }
      if(row.balanceState==="settled"&&pending.length)
        throw Error("overdue_zero_balance_conflict");
    }
    if(score>0&&row.town!=="Town unavailable")ranked++;
    points+=score;paidBins+=units;paidVisits+=visits;historyEvents+=events.length;
    accounts.push({id,ref:row.ref,email:row.email,firstName:row.firstName,
      town:row.town,points:score,paidCleans:units,
      currentStreak:row.currentStreak,nextBonus:row.nextBonus,
      recordedSkips:skips,events,jobs,historyAsOf:raw.asOf,
      ...(hasOverdueSource?{balanceState:row.balanceState,
        outstandingJobs:pending,settledJobs:settled}:{}),
    });
  }
  // Lock the initial 5 November source to independently verified totals.
  // Later weekly backups are dynamic and require owner authentication.
  if(raw.asOf==="2026-11-05" &&
     (accounts.length!==1020||paidBins!==25921))
    throw Error("five_nov_paid_bin_audit_mismatch");
  // The old customer-day point total (1,008,106) is deliberately NOT a
  // valid assertion after switching to independent recurring-job streaks.
  const countShared=[...emailCounts.values()].filter(n=>n>1).length;
  const qualified=accounts.filter(a=>a.email && emailCounts.get(a.email)===1 &&
    a.points>0 && a.town!=="Town unavailable");
  const rankedWithEmail=qualified.length;
  const rankedWithEmailPoints=qualified.reduce((s,a)=>s+a.points,0);
  return {version:1,asOf:raw.asOf,scoringVersion:VERSION,
    ...(hasOverdueSource?{penaltySourceVersion:overdue.VERSION}:{}),accounts,
    summary:{activeAccounts:accounts.length,rankedCustomers:ranked,
      rankedPoints:points,historyEvents,allHistoricalPoints:points,
      emailAvailable:accounts.filter(x=>x.email).length,
      duplicateEmailCount:countShared,verifiedPaidBins:paidBins,
      verifiedPaidVisits:paidVisits,rankedWithEmail,
      rankedWithEmailPoints}};
}
function eligibleBinAccounts(snapshot){
  if(!isBinSnapshot(snapshot)||!displayable(snapshot.asOf))return null;
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
    perJobScoringVerified:snapshot.scoringVersion===VERSION,
    verifiedAliases:aliases,verifiedCount:aliases.size,
    verifiedImportedActiveAccounts:snapshot.accounts.length,
    verifiedActiveEmailAccounts,verificationAsOf:snapshot.asOf,
    verificationStatus:"verified_from_squeegee_backup"};
}
module.exports={VERSION,LEGACY_VERSION,fresh,displayable,DISPLAY_GRACE_DAYS,isBinSnapshot,validateBinSource,eligibleBinAccounts};
