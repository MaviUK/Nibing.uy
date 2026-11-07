"use strict";
// Read-only awards derived from the verified PRIVATE per-job backup.
// An achievement does not grant XP, publish customer data, or change a job.
// Use recorded attended VISITS, not physical-bin quantities, for streaks.
const COLOURS=["Black","Blue","Brown","Green"];
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
 if(key==="paidBins")return entry.paidBins;
 if(key==="jobs")return entry.jobs;
 return 0;
}
function top(entries,key,limit=5){
 return entries.filter(e=>metric(e,key)>0)
  .sort((a,b)=>metric(b,key)-metric(a,key)||
   // For ties in a historical record, credit the earlier achievement.
   (a.achievedOn||"9999-99-99").localeCompare(b.achievedOn||"9999-99-99")||
   a.ref.localeCompare(b.ref)||String(a.jobIndex??0).localeCompare(String(b.jobIndex??0)))
  .slice(0,limit);
}
function addDays(date,days){
 const t=Date.parse(date+"T12:00:00Z");
 if(!Number.isFinite(t))return null;
 return new Date(t+days*86400000).toISOString().slice(0,10);
}
function jobRecords(account,asOf) {
 if(!Array.isArray(account.jobs)||!Array.isArray(account.events))return [];
 const byJob=account.jobs.map(()=>[]);
 for(const e of account.events)if(Number.isSafeInteger(e?.j)&&
  e.j>=0&&e.j<byJob.length)byJob[e.j].push(e);
 return account.jobs.map((job,index)=>{
  let best=0,achievedOn=null;
  for(const event of byJob[index]){
   if(!CLEAN.has(event?.event)||!dateDay(event.date)||
      !Number.isSafeInteger(event.streak)||event.streak<1)continue;
   if(event.streak>best){
    best=event.streak;
    achievedOn=event.date;
   }else if(event.streak===best && (!achievedOn||event.date<achievedOn)){
    achievedOn=event.date;
   }
  }
  const last=dateDay(job.lastCompletedOn);
  // Existing HQ projects a next clean back to 20 XP after 35 days.
  // An achievement labelled "active" must apply that SAME staleness rule.
  const current=Number.isSafeInteger(job.currentStreak)&&job.currentStreak>0
   ?job.currentStreak:0;
  const active=last && asOf<=addDays(last,35)?current:0;
  return {
   ref:account.ref,firstName:account.firstName,town:account.town,
   jobId:job.id,jobIndex:index,label:job.label,
   best,achievedOn,active,lastCompletedOn:last,
   paidBins:Number.isSafeInteger(job.paidCleans)?job.paidCleans:0
  };
 });
}
function customerCleanDateRecord(account){
 // Awards-only metric across all of a customer's jobs. Multiple jobs
 // completed on the same day count ONCE, and a skip on ANY job interrupts it.
 // This deliberately does not affect independently scored per-job streaks.
 const byDate=new Map();
 for(const e of Array.isArray(account.events)?account.events:[]){
  const day=dateDay(e?.date);
  if(!day)continue;
  if(!byDate.has(day))byDate.set(day,{clean:false,skip:false});
  const record=byDate.get(day);
  if(CLEAN.has(e.event))record.clean=true;
  if(e.event==="recorded_skip")record.skip=true;
 }
 let run=0,best=0,achievedOn=null;
 for(const day of [...byDate.keys()].sort()){
  const {clean,skip}=byDate.get(day);
  if(skip)run=0;
  else if(clean)run++;
  if(run>best){best=run;achievedOn=day;}
 }
 return {combined:best,achievedOn};
}
function awards(accounts,{asOf="",limit=5}={}){
 if(!Array.isArray(accounts)||!dateDay(asOf))return null;
 // A legacy customer-wide import cannot give truthful per-job awards.
 if(accounts.some(account=>!Array.isArray(account?.jobs)||
  !Array.isArray(account?.events)))return null;
 const allJobs=[],customers=[];
 for(const account of accounts){
  if(typeof account?.ref!=="string")continue;
  const jobs=jobRecords(account,asOf);
  allJobs.push(...jobs);
  const {combined,achievedOn}=customerCleanDateRecord(account);
  customers.push({
   ref:account.ref,firstName:account.firstName,town:account.town,
   combined,achievedOn,jobs:jobs.length,
   paidBins:Number.isSafeInteger(account.paidCleans)?account.paidCleans:0
  });
 }
 const byColour=Object.fromEntries(COLOURS.map(colour=>[
  colour,top(allJobs.filter(j=>j.label===colour),"best",limit)
 ]));
 return {
  asOf,
  jobCount:allJobs.length,
  byColour,
  longestJob:top(allJobs,"best",limit),
  activeJob:top(allJobs,"active",limit),
  combined:top(customers,"combined",limit),
  paidBins:top(customers,"paidBins",limit),
  mostJobs:top(customers,"jobs",limit)
 };
}
module.exports={awards,jobRecords,customerCleanDateRecord,COLOURS};
