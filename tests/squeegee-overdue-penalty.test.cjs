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
test("one XP per overdue job per day, no escalating daily loss",()=>{
  const due="2026-10-01";
  assert.equal(penalty.pointsThrough(due,"2026-10-29"),0);
  assert.equal(penalty.pointsThrough(due,"2026-10-30"),1);
  assert.equal(penalty.pointsThrough(due,"2026-10-31"),2);
  assert.equal(penalty.pointsThrough(due,"2026-11-01"),3);
  assert.equal(penalty.pointsThrough(due,"2026-11-08"),10);
});
test("two unpaid jobs incur two independent penalties, not one per customer",()=>{
  const candidates=[
    {id:"job-black",dueOn:"2026-10-01"},
    {id:"job-brown",dueOn:"2026-10-01"}];
  const ledger=penalty.reconcileLedger([],candidates,"2026-11-01");
  assert.equal(penalty.penaltyTotal(ledger),3);
  assert.equal(ledger.length,2);
});
test("repeated import never deducts twice; later unpaid import adds only delta",()=>{
  const pending=[{id:"job-1",dueOn:"2026-10-01"}];
  const d29=penalty.reconcileLedger([],pending,"2026-10-30");
  assert.equal(penalty.penaltyTotal(d29),1);
  const repeated=penalty.reconcileLedger(d29,pending,"2026-10-30");
  assert.deepEqual(repeated,d29);
  const d30=penalty.reconcileLedger(repeated,pending,"2026-10-31");
  assert.equal(penalty.penaltyTotal(d30),2);
  assert.equal(penalty.penaltyTotal(d30)-penalty.penaltyTotal(repeated),1);
});
test("a newly settled account stops penalties; earned debt history is retained",()=>{
  const pending=[{id:"job-1",dueOn:"2026-10-01"}];
  const lastOpen=penalty.reconcileLedger([],pending,"2026-11-01");
  const zeroBalance=penalty.reconcileLedger(lastOpen,[],"2026-11-06");
  assert.deepEqual(zeroBalance,lastOpen);
  assert.equal(penalty.penaltyTotal(zeroBalance),3);
});
test("year attribution reconciles penalties across New Year",()=>{
  const due="2026-11-30";
  const ledger=penalty.reconcileLedger([],[{id:"job-1",dueOn:due}],"2027-01-01");
  assert.equal(penalty.penaltyForYear(ledger,2026),3);
  assert.equal(penalty.penaltyForYear(ledger,2027),1);
  assert.equal(penalty.penaltyTotal(ledger),4);
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
    outstandingJobs:[{id:occurrence,dueOn:due,j:0}],settledJobs:[]};
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
  assert.deepEqual(annual.entries.map(row=>row.points),[79]);
  const zero=structuredClone(source);
  zero.accounts[0].balanceState="settled";
  assert.throws(()=>bin.validateBinSource(zero),/overdue_pending_job_invalid/);
  const forged=structuredClone(source);
  forged.accounts[0].outstandingJobs[0].dueOn=paidDay;
  assert.throws(()=>bin.validateBinSource(forged),/overdue_pending_job_invalid/);
  const latePaid=structuredClone(source);
  const account2=latePaid.accounts[0];
  account2.balanceState="settled";account2.outstandingJobs=[];
  account2.events[0]={date:due,event:"paid_completed_clean",quantity:1,
    points:20,streak:1,j:0};
  account2.points=42;account2.paidCleans=2;
  account2.jobs[0].points=42;account2.jobs[0].paidCleans=2;
  account2.settledJobs=[{id:occurrence,dueOn:due,paidOn:asOf,j:0}];
  const imported=bin.validateBinSource(latePaid);
  assert.equal(imported.accounts[0].settledJobs.length,1);
  const deduction=penalty.reconcileLedger([],[],asOf,imported.accounts[0].settledJobs);
  assert.equal(penalty.penaltyTotal(deduction),3);
  const badPaid=structuredClone(latePaid);
  badPaid.accounts[0].settledJobs[0].paidOn=due;
  assert.throws(()=>bin.validateBinSource(badPaid),/overdue_settled_job_invalid/);
});

test("late paid September and October jobs lose 58 XP, not a compounded 842",()=>{
  const settlements=[
    {id:"sep-09",dueOn:"2026-09-09",paidOn:"2026-11-05",j:0},
    {id:"sep-10",dueOn:"2026-09-10",paidOn:"2026-11-05",j:1},
    {id:"oct-07",dueOn:"2026-10-07",paidOn:"2026-11-05",j:0}
  ];
  const historical=penalty.reconcileLedger([],[],"2026-11-06",settlements);
  assert.equal(penalty.penaltyTotal(historical),58);
  assert.deepEqual(historical.map(row=>row.points).sort((a,b)=>b-a),[29,28,1]);
  assert.ok(historical.every(x=>x.settledOn==="2026-11-05"));
  assert.equal(penalty.penaltyTotal(penalty.reconcileLedger(
    historical,[],"2026-11-08",settlements)),58);
  assert.equal(penalty.penaltyForYear(historical,2026),58);
});
test("historical settled date overrides an older provisional unpaid penalty",()=>{
  const candidate={id:"sep-09",dueOn:"2026-09-09"};
  const provisional=penalty.reconcileLedger([],[candidate],"2026-11-02");
  const done=penalty.reconcileLedger(provisional,[],"2026-11-08",
    [{...candidate,paidOn:"2026-11-05",j:1}]);
  assert.equal(done[0].points,29);
  assert.equal(done[0].settledOn,"2026-11-05");
  assert.equal(done[0].j,1);
  assert.deepEqual(penalty.reconcileLedger(done,[],"2026-11-08"),done);
});
test("settled evidence must be dated, attributable and non-duplicated",()=>{
  const paid={id:"a",dueOn:"2026-09-01",paidOn:"2026-10-20"};
  assert.throws(()=>penalty.reconcileLedger([],[],"2026-10-01",[paid]),
    /settled_job_invalid/);
  assert.throws(()=>penalty.reconcileLedger([],[],"2026-11-01",[
    paid,paid]),/settled_job_invalid/);
  assert.throws(()=>penalty.reconcileLedger([],[{
    id:"a",dueOn:"2026-09-01"}],"2026-11-01",[paid]),
    /pending_job_invalid/);
});

test("previous escalating V2 penalty entries migrate to flat daily XP",()=>{
  const pending=[{id:"sep09",dueOn:"2026-09-09"}];
  const old={id:"sep09",dueOn:"2026-09-09",
    until:"2026-11-05",points:435};
  const updated=penalty.reconcileLedger([old],[],"2026-11-08",[],
    penalty.LEGACY_VERSION_V2);
  assert.equal(updated[0].points,29);
  assert.equal(updated[0].until,"2026-11-05");
  assert.deepEqual(penalty.reconcileLedger(updated,[],"2026-11-08"),updated);
  const withPayment=penalty.reconcileLedger([old],[],"2026-11-08",
    [{id:"sep09",dueOn:"2026-09-09",paidOn:"2026-11-05"}],
    penalty.LEGACY_VERSION_V2);
  assert.equal(withPayment[0].points,29);
  assert.equal(withPayment[0].settledOn,"2026-11-05");
  assert.throws(()=>penalty.reconcileLedger([old],[],"2026-11-08",[],
    "bad-version"),/policy_unrecognised/);
});
test("one unpaid job cannot accumulate more than one point per overdue day",()=>{
 const original="2026-10-01";
 const after=penalty.reconcileLedger([],[{id:"one",dueOn:original}],"2026-11-08");
 assert.equal(after[0].points,10);
 const two=penalty.reconcileLedger(after,[{id:"one",dueOn:original}],"2026-11-09");
 assert.equal(two[0].points,11);
 assert.equal(two[0].points-after[0].points,1);
});
