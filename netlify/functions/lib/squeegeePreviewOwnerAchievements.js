"use strict";
// Read-only awards derived from the verified PRIVATE per-job backup.
// An achievement does not grant XP, publish customer data, or change a job.
// Use recorded attended VISITS, not physical-bin quantities, for streaks.
const COLOURS=["Black","Blue","Brown","Green"];
// Display Green and Brown together as one ranked category; source job colours stay unchanged.
const RECORD_CATEGORIES=["Black","Blue","Green & Brown"];
const CLEAN=new Set(["paid_completed_clean","completed_payment_not_verified"]);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
function dateDay(value) {
 return typeof value==="string"&&DAY.test(value)&&
  Number.isFinite(Date.parse(value+"T12:00:00Z"))?value:null;
}
function metric(entry,key){
 if(key==="best")return entry.best;
 if(key==="active")return entry.active;
 if(key==="combined")return entry.combined;
 if(key==="activeCombined")return entry.activeCombined;
 if(key==="paidBins")return entry.paidBins;
 if(key==="jobs")return entry.jobs;
 return 0;
}
function top(entries,key,limit=5){
 return entries.filter(e=>metric(e,key)>0)
  .sort((a,b)=>metric(b,key)-metric(a,key)||
   // A current-streak tie favours the most recently cleaned job. Historical
   // ties favour the earliest first achievement. Both are deterministic.
   (key==="active"||key==="activeCombined"
    ?(b.lastCompletedOn||"").localeCompare(a.lastCompletedOn||"")
    :(a.achievedOn||"9999-99-99").localeCompare(b.achievedOn||"9999-99-99"))||
   a.ref.localeCompare(b.ref)||String(a.jobIndex??0).localeCompare(String(b.jobIndex??0)))
  .slice(0,limit);
}
function addDays(date,days){
 const t=Date.parse(date+"T12:00:00Z");
 if(!Number.isFinite(t))return null;
 return new Date(t+days*86400000).toISOString().slice(0,10);
}
function jobRecords(account,asOf,year=null) {
 if(!Array.isArray(account.jobs)||!Array.isArray(account.events))return [];
 const byJob=account.jobs.map(()=>[]);
 for(const e of account.events)if(Number.isSafeInteger(e?.j)&&
  e.j>=0&&e.j<byJob.length)byJob[e.j].push(e);
 return account.jobs.map((job,index)=>{
  let best=0,achievedOn=null;
  const cutoff=year===null?asOf:year+"-12-31"<asOf?year+"-12-31":asOf;
  // Calendar-year records count documented cleaning VISITS inside that year,
  // not the source's lifetime event.streak. A 32-clean lifetime run that
  // reaches November 2026 must not show as 32 cleans in 2026.
  const timeline=new Map();
  for(const event of byJob[index]){
   const day=dateDay(event?.date);
   if(!day||day>cutoff)continue;
   if(year!==null){
    if(!day.startsWith(year+"-"))continue;
    if(!timeline.has(day))timeline.set(day,{skip:false,streak:0});
    const dayEvents=timeline.get(day);
    if(event.event==="recorded_skip")dayEvents.skip=true;
    else if(CLEAN.has(event.event)&&Number.isSafeInteger(event.streak)&&event.streak>0)
     dayEvents.streak=Math.max(dayEvents.streak,event.streak);
   }else{
    // Overall retains the original lifetime/Squeegee per-job streak record.
    if(!CLEAN.has(event.event)||!Number.isSafeInteger(event.streak)||
       event.streak<1)continue;
    if(event.streak>best){
     best=event.streak;
     achievedOn=day;
    }else if(event.streak===best&&(!achievedOn||day<achievedOn)){
     achievedOn=day;
    }
   }
  }
  let last=dateDay(job.lastCompletedOn);
  let current=Number.isSafeInteger(job.currentStreak)&&job.currentStreak>0
   ?job.currentStreak:0;
  if(year!==null){
   let run=0,lastSourceStreak=0;
   last=null;
   for(const [day,entry] of [...timeline].sort(([a],[b])=>a.localeCompare(b))){
    if(entry.skip){
     // A skip on the same date as a clean takes precedence.
     run=0;lastSourceStreak=0;last=null;
    }else if(entry.streak>0){
     // The original streak signals a break even if a skip wasn't imported.
     // Never credit missing visits or multiple bins on the same day.
     run=lastSourceStreak>0&&entry.streak<=lastSourceStreak?1:run+1;
     lastSourceStreak=entry.streak;
     last=day;
     if(run>best){best=run;achievedOn=day;}
    }
   }
   current=run;
  }
  const active=last && cutoff<=addDays(last,35)?current:0;
  return {
   ref:account.ref,firstName:account.firstName,town:account.town,
   jobId:job.id,jobIndex:index,label:job.label,
   best,achievedOn,active,lastCompletedOn:last,
   paidBins:year===null?(Number.isSafeInteger(job.paidCleans)?job.paidCleans:0):
    byJob[index].filter(e=>e?.event==="paid_completed_clean" &&
      typeof e.date==="string"&&e.date.startsWith(year+"-")&&e.date<=cutoff)
     .reduce((sum,e)=>sum+(Number.isSafeInteger(e.quantity)&&e.quantity>0?e.quantity:1),0)
  };
 });
}
function customerCleanDateRecord(account,asOf=null,year=null){
 // Customer-wide achievement, NOT an XP scoring streak. Multiple jobs on
 // one date count as one completed visit. Any skipped job resets the
 // customer-wide award even if another job was completed on that same date.
 const byDate=new Map();
 for(const e of Array.isArray(account.events)?account.events:[]){
  const day=dateDay(e?.date);
  if(!day||(asOf!==null&&day>asOf)||
     (year!==null&&!day.startsWith(year+"-")))continue;
  if(!byDate.has(day))byDate.set(day,{clean:false,skip:false});
  const record=byDate.get(day);
  if(CLEAN.has(e.event))record.clean=true;
  if(e.event==="recorded_skip")record.skip=true;
 }
 let run=0,best=0,achievedOn=null,lastCompletedOn=null;
 for(const day of [...byDate.keys()].sort()){
  const {clean,skip}=byDate.get(day);
  if(skip){run=0;lastCompletedOn=null;}
  else if(clean){run++;lastCompletedOn=day;}
  if(run>best){best=run;achievedOn=day;}
 }
 // As-of is the verified backup date, not a live schedule lookup. A
 // record with no completed visit during the last 35 days is not current.
 const activeCombined=run>0&&lastCompletedOn&&dateDay(asOf)&&
  asOf<=addDays(lastCompletedOn,35)?run:0;
 return {
  combined:best,achievedOn,
  ...(asOf!==null?{activeCombined,lastCompletedOn}:{}),
 };
}
function awards(accounts,{asOf="",limit=5,year=null}={}){
 if(!Array.isArray(accounts)||!dateDay(asOf)||
    (year!==null&&(!Number.isSafeInteger(year)||year<2024||
      year>Number(asOf.slice(0,4)))))return null;
 const cutoff=year===null?asOf:year+"-12-31"<asOf?year+"-12-31":asOf;
 // A legacy customer-wide import cannot give truthful per-job awards.
 if(accounts.some(account=>!Array.isArray(account?.jobs)||
  !Array.isArray(account?.events)))return null;
 const allJobs=[],customers=[];
 for(const account of accounts){
  if(typeof account?.ref!=="string")continue;
  const jobs=jobRecords(account,asOf,year);
  allJobs.push(...jobs);
  const {combined,achievedOn,activeCombined,lastCompletedOn}=
   customerCleanDateRecord(account,cutoff,year);
  const yearEvents=year===null?[]:account.events.filter(e=>
    typeof e?.date==="string"&&e.date.startsWith(year+"-")&&e.date<=cutoff);
  const cleanedJobs=new Set(yearEvents.filter(e=>CLEAN.has(e.event)&&
    Number.isSafeInteger(e.j)&&e.j>=0&&e.j<account.jobs.length).map(e=>e.j));
  customers.push({
   ref:account.ref,firstName:account.firstName,town:account.town,
   combined,achievedOn,activeCombined,lastCompletedOn,
   jobs:year===null?jobs.length:cleanedJobs.size,
   paidBins:year===null?(Number.isSafeInteger(account.paidCleans)?account.paidCleans:0):
    yearEvents.filter(e=>e.event==="paid_completed_clean").reduce(
      (sum,e)=>sum+(Number.isSafeInteger(e.quantity)&&e.quantity>0?e.quantity:1),0)
  });
 }
 const byColour=Object.fromEntries(COLOURS.map(colour=>[
  colour,top(allJobs.filter(j=>j.label===colour),"best",limit)
 ]));
 const byColourCurrent=Object.fromEntries(COLOURS.map(colour=>[
  colour,top(allJobs.filter(j=>j.label===colour),"active",limit)
 ]));
 // Merge the rankings, NOT the jobs: never add two jobs' streak counts.
 // Mixed-colour Squeegee job labels still compete in "any job" only.
 const greenBrownJobs=allJobs.filter(j=>j.label==="Green"||j.label==="Brown");
 byColour["Green & Brown"]=top(greenBrownJobs,"best",limit);
 byColourCurrent["Green & Brown"]=top(greenBrownJobs,"active",limit);
 return {
  asOf,year,periodEnd:cutoff,
  jobCount:allJobs.length,
  byColour,
  byColourCurrent,
  longestJob:top(allJobs,"best",limit),
  activeJob:top(allJobs,"active",limit),
  combined:top(customers,"combined",limit),
  combinedCurrent:top(customers,"activeCombined",limit),
  paidBins:top(customers,"paidBins",limit),
  mostJobs:top(customers,"jobs",limit)
 };
}
// All comparisons are scoped to a verified, exact imported town name.
// "Town unavailable" is included in the global records, not assigned to a
// fictional town. No geolocation, inference or fuzzy grouping is used.
function townGroups(accounts) {
 const groups=new Map();
 if(!Array.isArray(accounts))return groups;
 for(const account of accounts){
  const town=account?.town;
  if(typeof town!=="string"||!town.trim()||town==="Town unavailable")continue;
  if(!groups.has(town))groups.set(town,[]);
  groups.get(town).push(account);
 }
 return groups;
}
function townRecords(accounts,{asOf="",limit=5,year=null}={}){
 const towns=townGroups(accounts);
 const records=[];
 for(const [town,customers] of towns){
  const summary=awards(customers,{asOf,limit,year});
  if(!summary)continue;
  records.push({
   town,customers:customers.length,
   current:summary.activeJob[0]||null,
   highest:summary.longestJob[0]||null
  });
 }
 return records.sort((a,b)=>a.town.localeCompare(b.town,"en-GB"));
}
module.exports={awards,jobRecords,customerCleanDateRecord,townGroups,townRecords,COLOURS,RECORD_CATEGORIES};
