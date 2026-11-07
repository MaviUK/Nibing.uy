"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const bin=require("../netlify/functions/lib/squeegeePreviewBinHistory");
const hq=require("../netlify/functions/lib/customerHQ");
const names=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const years=require("../netlify/functions/lib/squeegeeYearlyPreviewBoard");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");

function today(){
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",
    day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(new Date());
  const d=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return d.year+"-"+d.month+"-"+d.day;
}
const id1="11111111-1111-4111-8111-111111111111";
const id2="22222222-2222-4222-8222-222222222222";
const paid=(date,quantity,streak)=>({date,event:"paid_completed_clean",
  quantity,streak,points:quantity*(20+2*(streak-1)),j:0});
const firstJob="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondJob="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function source(){
  return {version:1,asOf:today(),scoringVersion:bin.VERSION,
    accounts:[
      {id:id1,ref:"1001",email:"alice@example.test",firstName:"Alice",
        town:"Bangor",points:100,paidCleans:5,currentStreak:1,
        nextBonus:22,recordedSkips:1,jobs:[{id:firstJob,label:"Brown",
          currentStreak:1,nextBonus:22,paidCleans:5,points:100,
          recordedSkips:1,lastCompletedOn:"2026-06-01"}],events:[
          paid("2024-03-10",2,1),
          {date:"2025-05-20",event:"recorded_skip",points:0,streak:0,quantity:0,j:0},
          paid("2026-06-01",3,1),
          {date:"2026-06-02",event:"completed_non_bin_service",
            points:0,streak:1,quantity:0,j:0},
        ]},
      {id:id2,ref:"1002",email:"bob@example.test",firstName:"Bob",
        town:"Comber",points:20,paidCleans:1,currentStreak:1,
        nextBonus:22,recordedSkips:0,jobs:[{id:secondJob,label:"Blue",
          currentStreak:1,nextBonus:22,paidCleans:1,points:20,
          recordedSkips:0,lastCompletedOn:"2025-05-18"}],
        events:[paid("2025-05-18",1,1)]}
    ]};
}
test("Preview 77 accepts new per-bin private schema without changing old 31 October preview scoring",()=>{
  const raw=source();
  const s=hq.validateSource(raw);
  assert.equal(s.asOf,raw.asOf);
  assert.equal(s.summary.activeAccounts,2);
  assert.equal(s.summary.verifiedPaidBins,6);
  assert.equal(s.summary.verifiedPaidVisits,3);
  assert.equal(s.summary.allHistoricalPoints,120);
  assert.deepEqual(s.accounts[0].events[0],paid("2024-03-10",2,1));
  assert.equal(s.accounts[0].historyAsOf,raw.asOf);
  assert.equal(years.annualCleaningXP(s.accounts[0].events,2024,s.asOf),40);
  assert.equal(years.annualCleaningXP(s.accounts[0].events,2025,s.asOf),0);
  assert.equal(years.annualCleaningXP(s.accounts[0].events,2026,s.asOf),60);
  assert.equal(years.annualCleaningXP(s.accounts[1].events,2025,s.asOf),20);
  const eligible=hq.eligibleRankedEmailAccounts(s);
  assert.equal(eligible.count,2);
  assert.equal(eligible.historicalPoints,120);
  assert.equal(eligible.verifiedPaidBins,6);
});
test("Preview 77 yearly board uses completed service dates and bin quantities",async()=>{
  const s=hq.validateSource(source());
  const eligible=hq.eligibleRankedEmailAccounts(s);
  const a2024=await years.getAnnualPreviewBoard({},s,eligible.aliases,2024,
    Date.now(),new Map());
  const a2025=await years.getAnnualPreviewBoard({},s,eligible.aliases,2025,
    Date.now(),new Map());
  const a2026=await years.getAnnualPreviewBoard({},s,eligible.aliases,2026,
    Date.now(),new Map());
  assert.deepEqual(a2024.entries.map(x=>x.points),[40]);
  assert.deepEqual(a2025.entries.map(x=>x.points),[20]);
  assert.deepEqual(a2026.entries.map(x=>x.points),[60]);
  assert.equal([a2024,a2025,a2026].reduce((v,x)=>v+x.entries
    .reduce((n,r)=>n+r.points,0),0),120);
});
test("Preview 77 refresh carries withdrawals forward and prevents stale permissions",()=>{
  const s=hq.validateSource(source());
  const eligible=hq.eligibleRankedEmailAccounts(s);
  const consent=names.initialiseFromPrivateCustomerHQ(s);
  assert.equal(consent.sourceAsOf,s.asOf);
  assert.equal(consent.records.length,2);
  assert.equal(consent.records[0].consent,"pending");
  const first=canonicalLegacyRef(id1);
  const updated={...consent,records:consent.records.map(r=>
    r.alias===first?{...r,consent:"withdrawn",withdrawnAt:new Date().toISOString()}:r)};
  const restored=names.initialiseFromPrivateCustomerHQ(s,updated);
  assert.equal(restored.records.find(x=>x.alias===first).consent,"withdrawn");
  const full={entries:[
    {customerRef:first,town:"Bangor",points:100},
    {customerRef:canonicalLegacyRef(id2),town:"Comber",points:20},
  ],sourceAsOf:s.asOf,lastUpdatedAt:new Date().toISOString()};
  const key=Buffer.alloc(32,42);
  const board=names.previewFirstNameScoreboard(s,full,eligible.aliases,restored,key);
  assert.equal(board.totalPlayers,1);
  assert.equal(board.entries[0].displayName,"Bob");
  const mismatch=names.previewFirstNameScoreboard(s,full,eligible.aliases,
    {...restored,sourceAsOf:"2026-10-31"},key);
  assert.equal(mismatch.totalPlayers,0);
  assert.equal(mismatch.status,"consent_pending");
});
test("Preview 77 rejects forged quantities, paid XP, duplicated account ids and stale updates",()=>{
  const edits=[
    r=>{r.accounts[0].events[0].quantity=3;},
    r=>{r.accounts[0].points++;},
    r=>{r.accounts[0].paidCleans++;},
    r=>{r.accounts[0].events[2].points=40;},
    r=>{r.accounts[1].id=id1;},
    r=>{r.scoringVersion="2026-11-streak-20-plus-2-squeegee-skip-reset-v1";},
  ];
  for(const edit of edits){
    const v=source(); edit(v);
    assert.throws(()=>bin.validateBinSource(v));
  }
  const stale=source();
  stale.asOf="2026-10-20";
  assert.throws(()=>bin.validateBinSource(stale));
});
