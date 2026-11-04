"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const model=require("../netlify/functions/lib/squeegeeProductionCustomerData.js");
const {RULE_VERSION}=require("../netlify/functions/lib/squeegeeCleaningStreak.js");

const now=Date.parse("2026-11-04T22:00:00Z");
const env={SQUEEGEE_PRODUCTION_HQ_SECRET:
  "synthetic-independent-hq-secret-DO-NOT-DEPLOY-123456789"};
const idA="11111111-1111-4111-8111-111111111111";
const idB="22222222-2222-4222-8222-222222222222";
const idC="33333333-3333-4333-8333-333333333333";
const paid=(date,points,streak)=>({
  date,event:"paid_completed_clean",points,streak,
});
const skipped=date=>({date,event:"recorded_skip",points:0,streak:0});
const source=()=>({
  version:1,asOf:"2026-11-04",scoringVersion:RULE_VERSION,
  accounts:[
    {id:idA,ref:"3024",email:"alpha@example.test",
      firstName:"Alice",town:"Bangor",points:66,paidCleans:3,
      currentStreak:3,nextBonus:26,recordedSkips:0,
      events:[paid("2024-01-15",20,1),paid("2025-05-15",22,2),
        paid("2026-11-02",24,3)]},
    {id:idB,ref:"3025",email:"bravo@example.test",
      firstName:"Bob",town:"Comber",points:40,paidCleans:2,
      currentStreak:1,nextBonus:22,recordedSkips:1,
      events:[paid("2025-04-15",20,1),skipped("2025-06-15"),
        paid("2026-02-15",20,1)]},
    {id:idC,ref:"3026",email:"shared@example.test",
      firstName:"Clare",town:"Donaghadee",points:0,paidCleans:0,
      currentStreak:1,nextBonus:22,recordedSkips:0,
      events:[{date:"2024-02-01",event:"completed_payment_not_verified",
        points:0,streak:1}]},
  ],
});
function validated(raw=source()){
  const out=model.validateSource(raw,{now});
  return {...out,sourceHash:model.hashSource(JSON.stringify(raw)),
    importedAt:"2026-11-04T22:00:00Z"};
}
function consented(snapshot,account){
  const first=model.buildConsent(snapshot);
  const evidence=crypto.createHash("sha256").update("test-session").digest("hex");
  return model.updateConsent(first,account,{
    action:"leaderboard-opt-in",firstName:account.firstName,agree:true,
    sessionEvidence:evidence,
  },now);
}
test("private import validates changing account counts, years and verified paid points without frozen 2026-10-31 seed",()=>{
  const s=validated();
  assert.equal(s.summary.activeAccounts,3);
  assert.equal(s.summary.historyEvents,7);
  assert.equal(s.summary.paidEvents,5);
  assert.equal(s.summary.cleaningPoints,106);
  assert.equal(s.accounts[0].points,66);
  assert.deepEqual(model.availableYears(s,now),[2024,2025,2026]);
  const a=model.tally(s.accounts[0].events,s.asOf);
  assert.deepEqual([...a],[ [2024,20],[2025,22],[2026,24] ]);
  assert.equal([...a.values()].reduce((sum,x)=>sum+x,0),
    s.accounts[0].points);
});
test("tampered points, false paid cleans, duplicate customer and invalid payments are all rejected",()=>{
  for(const change of [
    raw=>{raw.accounts[0].points++;},
    raw=>{raw.accounts[0].paidCleans++;},
    raw=>{raw.accounts[1].events[2].points=24;},
    raw=>{raw.accounts[1].ref="3024";},
    raw=>{raw.accounts[1].id=idA;},
    raw=>{raw.accounts[1].events[1].points=20;},
    raw=>{raw.accounts[2].email="BAD-NON-EMAIL";},
    raw=>{raw.accounts[0].events[2].date="2026-12-02";},
  ]){
    const raw=source();change(raw);
    assert.throws(()=>model.validateSource(raw,{now}));
  }
});
test("source date must be recent and cannot be future or unparseable",()=>{
  assert.equal(model.validSourceDay("2026-11-04",now),true);
  assert.equal(model.validSourceDay("2026-10-20",now),false);
  assert.equal(model.validSourceDay("2026-11-19",now),false);
  assert.equal(model.validSourceDay("2026-02-31",now),false);
  const raw=source();raw.asOf="2026-10-20";
  assert.throws(()=>model.validateSource(raw,{now}));
});
test("without verified opt-in no public first names, references or scores are shown",()=>{
  const s=validated(),c=model.buildConsent(s);
  const all=model.scores(s,c,env,{now});
  assert.equal(all.totalPlayers,0);
  assert.equal(all.status,"public_eligible_scores");
  assert.equal(model.publicRef(idA,{}),null);
  assert.notEqual(model.publicRef(idA,env),idA);
  assert.match(model.publicRef(idA,env),/^NBG-[A-F0-9]{10}$/);
  assert.equal(JSON.stringify(all).includes("alpha@example.test"),false);
});
test("overall equals all annual points exactly and only consented users show their first names",()=>{
  const s=validated();
  const c=consented(s,s.accounts[0]);
  const all=model.scores(s,c,env,{now});
  assert.deepEqual(all.entries.map(e=>e.displayName),["Alice"]);
  assert.equal(all.totalPlayers,1);
  assert.equal(all.entries[0].points,66);
  const years=[2024,2025,2026].map(year=>
    model.scores(s,c,env,{year,now}));
  assert.deepEqual(years.map(x=>x.entries[0].points),[20,22,24]);
  assert.equal(years.reduce((sum,b)=>sum+b.entries[0].points,0),66);
  assert.equal(JSON.stringify(all).includes(idA),false);
  assert.equal(JSON.stringify(all).includes("alpha@example.test"),false);
  const my=model.personalSummary(s,c,s.accounts[0],env,now);
  assert.equal(my.rank,1);
  assert.equal(my.yearlyXpTotal,66);
  assert.equal(my.websiteXp,0);
  assert.equal(my.yearly["2024"].points+my.yearly["2025"].points+
    my.yearly["2026"].points,my.points);
});
test("withdrawal immediately removes public display but never erases private cleaning points",()=>{
  const s=validated();
  let c=consented(s,s.accounts[0]);
  const withdrawn=model.updateConsent(c,s.accounts[0],{
    action:"leaderboard-withdraw",
  },now+1000);
  assert.equal(model.scores(s,withdrawn,env,{now}).entries.length,0);
  assert.equal(model.personalSummary(s,withdrawn,s.accounts[0],env,now).points,66);
});
test("refreshed source preserves proven consent only for unchanged identity",()=>{
  const a=validated(),first=consented(a,a.accounts[0]);
  const newSnapshot={...a,sourceHash:"a".repeat(64)};
  const carried=model.buildConsent(newSnapshot,first);
  assert.equal(carried.records[0].consent,"granted");
  const changed={...newSnapshot,accounts:newSnapshot.accounts.map(v=>
    v.id===idA?{...v,firstName:"Alicia"}:v)};
  const reset=model.buildConsent(changed,first);
  assert.equal(reset.records[0].consent,"pending");
});
test("stale or out-of-sync consent never leaks public names",()=>{
  const s=validated(),c=consented(s,s.accounts[0]);
  const old={...s,asOf:"2026-10-20"};
  assert.equal(model.scores(old,c,env,{now}).status,
    "active_status_refresh_required");
  const mismatched={...c,sourceHash:"b".repeat(64)};
  assert.equal(model.scores(s,mismatched,env,{now}).totalPlayers,0);
});
test("shared email accounts do not silently identify one of several customers",()=>{
  const raw=source();
  raw.accounts[1].email=raw.accounts[0].email;
  const s=validated(raw);
  assert.equal(s.summary.duplicateEmailCount,1);
  assert.equal(model.accountForEmail(s,"alpha@example.test"),null);
  assert.equal(model.accountForEmail(s,"shared@example.test").id,idC);
});
