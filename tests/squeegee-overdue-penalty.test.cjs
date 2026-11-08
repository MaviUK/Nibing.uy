"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const penalty=require("../netlify/functions/lib/squeegeeOverduePenalty");
const bin=require("../netlify/functions/lib/squeegeePreviewBinHistory");
const yearly=require("../netlify/functions/lib/squeegeeYearlyPreviewBoard");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");

function move(day,n){
  return new Date(Date.parse(day+"T00:00:00Z")+n*86400000)
    .toISOString().slice(0,10);
}
function todayUK(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const fields=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return fields.year+"-"+fields.month+"-"+fields.day;
}
test("day 28 is free, then -1, -2, -3 daily (cumulative 1, 3, 6)",()=>{
  const due="2026-10-01";
  assert.equal(penalty.pointsThrough(due,"2026-10-29"),0);
  assert.equal(penalty.pointsThrough(due,"2026-10-30"),1);
  assert.equal(penalty.pointsThrough(due,"2026-10-31"),3);
  assert.equal(penalty.pointsThrough(due,"2026-11-01"),6);
  assert.equal(penalty.pointsThrough(due,"2026-11-08"),55);
});
test("two unpaid jobs incur two independent penalties, not one per customer",()=>{
  const candidates=[
    {id:"job-black",dueOn:"2026-10-01"},
    {id:"job-brown",dueOn:"2026-10-01"}];
  const ledger=penalty.reconcileLedger([],candidates,"2026-11-01");
  assert.equal(penalty.penaltyTotal(ledger),12);
  assert.equal(ledger.length,2);
});
test("repeated import never deducts twice; later unpaid import adds only delta",()=>{
  const pending=[{id:"job-1",dueOn:"2026-10-01"}];
  const d29=penalty.reconcileLedger([],pending,"2026-10-30");
  assert.equal(penalty.penaltyTotal(d29),1);
  const repeated=penalty.reconcileLedger(d29,pending,"2026-10-30");
  assert.deepEqual(repeated,d29);
  const d30=penalty.reconcileLedger(repeated,pending,"2026-10-31");
  assert.equal(penalty.penaltyTotal(d30),3);
  assert.equal(penalty.penaltyTotal(d30)-penalty.penaltyTotal(repeated),2);
});
test("a newly settled account stops penalties; earned debt history is retained",()=>{
  const pending=[{id:"job-1",dueOn:"2026-10-01"}];
  const lastOpen=penalty.reconcileLedger([],pending,"2026-11-01");
  const zeroBalance=penalty.reconcileLedger(lastOpen,[],"2026-11-06");
  assert.deepEqual(zeroBalance,lastOpen);
  assert.equal(penalty.penaltyTotal(zeroBalance),6);
});
test("year attribution reconciles penalties across New Year",()=>{
  const due="2026-11-30";
  const ledger=penalty.reconcileLedger([],[{id:"job-1",dueOn:due}],"2027-01-01");
  assert.equal(penalty.penaltyForYear(ledger,2026),6);
  assert.equal(penalty.penaltyForYear(ledger,2027),4);
  assert.equal(penalty.penaltyTotal(ledger),10);
});
test("year totals always sum to overall net XP without negative display values",()=>{
  const annual=penalty.netByYear(new Map([[2024,100],[2025,50],[2026,20]]),60);
  assert.deepEqual([...annual].sort((a,b)=>a[0]-b[0]),[[2024,100],[2025,10],[2026,0]]);
  assert.equal([...annual.values()].reduce((a,b)=>a+b),110);
  assert.equal([...penalty.netByYear(new Map([[2025,20]]),100).values()][0],0);
});
test("conflicting due dates, duplicate jobs and older imports are rejected",()=>{
  assert.throws(()=>penalty.reconcileLedger([],
    [{id:"a",dueOn:"2026-02-30"}],"2026-11-01"),/invalid/);
  assert.throws(()=>penalty.reconcileLedger([],
    [{id:"a",dueOn:"2026-10-01"},{id:"a",dueOn:"2026-10-01"}],
    "2026-11-01"),/invalid/);
  const first=penalty.reconcileLedger([],[{id:"a",dueOn:"2026-10-01"}],
    "2026-11-01");
  assert.throws(()=>penalty.reconcileLedger(first,
    [{id:"a",dueOn:"2026-10-02"}],"2026-11-04"),/date_changed/);
  assert.throws(()=>penalty.reconcileLedger(first,[],"2026-10-31"),/invalid/);
});
test("private importer validates overdue evidence; paid balances cannot invent unpaid jobs",async()=>{
  const asOf=todayUK(),due=move(asOf,-31),paidDay=move(asOf,-1);
  const id="11111111-1111-4111-8111-111111111111";
  const job="22222222-2222-4222-8222-222222222222";
  const occurrence="33333333-3333-4333-8333-333333333333";
  const row={id,ref:"1001",email:"test@example.test",
    firstName:"Alex",town:"Bangor",points:22,paidCleans:1,
    currentStreak:2,nextBonus:24,recordedSkips:0,balanceState:"outstanding",
    jobs:[{id:job,label:"Brown",currentStreak:2,nextBonus:24,
      paidCleans:1,points:22,recordedSkips:0,lastCompletedOn:paidDay}],
    events:[{date:due,event:"completed_payment_not_verified",
      j:0,quantity:1,streak:1,points:0},
      {date:paidDay,event:"paid_completed_clean",
        j:0,quantity:1,streak:2,points:22}],
    outstandingJobs:[{id:occurrence,dueOn:due,j:0}]};
  const source={version:1,asOf,scoringVersion:bin.VERSION,
    penaltySourceVersion:penalty.VERSION,accounts:[row]};
  const verified=bin.validateBinSource(source);
  assert.equal(verified.accounts[0].outstandingJobs.length,1);
  const ledger=penalty.reconcileLedger([],
    verified.accounts[0].outstandingJobs,asOf);
  assert.equal(penalty.penaltyTotal(ledger),6);
  const account={...verified.accounts[0],penaltyLedger:ledger};
  const year=Number(paidDay.slice(0,4));
  const alias=canonicalLegacyRef(id);
  const annual=await yearly.getAnnualPreviewBoard({},{
    ...verified,accounts:[account]},new Set([alias]),year,Date.now(),
    new Map([[alias,new Map([[year,60]])]]));
  assert.deepEqual(annual.entries.map(row=>row.points),[76]);
  const zero=structuredClone(source);
  zero.accounts[0].balanceState="settled";
  assert.throws(()=>bin.validateBinSource(zero),/overdue_pending_job_invalid/);
  const forged=structuredClone(source);
  forged.accounts[0].outstandingJobs[0].dueOn=paidDay;
  assert.throws(()=>bin.validateBinSource(forged),/overdue_pending_job_invalid/);
});
