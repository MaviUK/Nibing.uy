"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const personal=require("../netlify/functions/lib/squeegeePersonalLeaderboard");
const names=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const history=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");
const historic=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");

const ids=[
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"
];
const aliases=ids.map(historic.canonicalLegacyRef);
const CLEAN=(date,points)=>({event:"paid_completed_clean",date,points});
const accounts=[
  {id:ids[0],email:"alpha@example.co.uk",firstName:"Alice",town:"Bangor",
    events:[CLEAN("2025-04-01",22)]},
  {id:ids[1],email:"bravo@example.co.uk",firstName:"Bob",town:"Comber",
    events:[CLEAN("2026-02-01",30)]},
  {id:ids[2],email:"charlie@example.co.uk",firstName:"Carol",town:"Newtownards",
    events:[]}
];
const privateCustomers={version:1,asOf:history.AS_OF,accounts};
const eligibleAliases=new Set(aliases);
const consentSnapshot={
  version:1,sourceAsOf:history.AS_OF,
  records:accounts.map((a,i)=>({alias:aliases[i],town:a.town,
    firstName:a.firstName,consent:"pending",withdrawnAt:null}))
};
const secretKey=Buffer.alloc(32,91);
function board(points,year=null){
  return {sourceAsOf:history.AS_OF,status:"squeegee_active_only",
    ...(year===null?{}:{year}),
    entries:points.map(([i,score])=>({customerRef:aliases[i],
      town:accounts[i].town,points:score}))
  };
}
function get({customerId=ids[0],consent=consentSnapshot,
              years=[board([[0,22],[1,10]],2025),
                     board([[1,470],[0,425]],2026)],
              overall=board([[1,480],[0,447],[2,100]])}={}){
  return personal.fromBoards({
    customerId,privateCustomers,eligibleAliases,
    consentSnapshot:consent,secretKey,
    overallBoard:overall,yearlyBoards:years
  });
}
test("known 2025/26 XP sums to 447, and 60 legacy XP never enters any total",()=>{
  const summary=get();
  assert.deepEqual(summary,{
    points:447,cleaningPoints:22,websiteXp:425,
    rank:2,rankingAvailable:true,
    yearly:{"2025":{points:22,rank:1},"2026":{points:425,rank:2}},
    yearlyXpTotal:447
  });
  assert.equal(summary.yearly["2024"],undefined);
  assert.equal(summary.yearlyXpTotal,summary.points);
  assert.equal(Object.hasOwn(summary,"unassignedXp"),false);
  const publicOverall=names.previewFirstNameScoreboard(
    privateCustomers,board([[1,480],[0,447],[2,100]]),
    eligibleAliases,consentSnapshot,secretKey);
  assert.equal(publicOverall.entries[1].rank,summary.rank);
  assert.equal(publicOverall.entries[1].customerRef,
    personal.publicRef(aliases[0],secretKey));
});
test("a stale Overall still showing 507 is rejected, not silently credited",()=>{
  assert.throws(()=>get({overall:board([[1,700],[0,507],[2,100]])}),
    /personal_dated_total_mismatch/);
});
test("signed-in withdrawal retains known XP but disables public rank",()=>{
  const withdrawn={
    ...consentSnapshot,
    records:consentSnapshot.records.map((item,i)=>i===0
      ?{...item,consent:"withdrawn",withdrawnAt:"2026-11-01T12:00:00Z"}:item)
  };
  const summary=get({consent:withdrawn});
  assert.equal(summary.points,447);
  assert.equal(summary.rank,null);
  assert.equal(summary.yearly["2025"].points,22);
  assert.equal(summary.yearly["2025"].rank,null);
  assert.equal(summary.yearly["2026"].rank,null);
});
test("other customer identity cannot display this person's private XP or rank",()=>{
  assert.throws(()=>get({
    customerId:"44444444-4444-4444-8444-444444444444"
  }),/personal_customer_not_in_backup/);
  assert.equal(personal.publicRef(ids[0],secretKey),null);
});
test("signed-in customers outside public rankings retain dated website XP, but not old unknown claims",async()=>{
  const now=Date.parse("2026-11-01T18:00:00Z");
  const entry={
    claimed:["a:bin-checker"],firstRecordedAt:"2026-11-01T15:00:00Z",
    events:[{key:"a:customer-portal@2026-11-01",earnedAt:"2026-11-01T14:00:00Z"}]
  };
  const stores={
    activity:{
      async list(){return {blobs:[{key:"customer:"+ids[0]}]};},
      async get(){return entry;}
    },
    links:{async list(){return {blobs:[]};}},
    private:{},public:{}
  };
  const result=await personal.getPersonalSummary({
    stores,privateCustomers,customerId:ids[0],
    consentSnapshot,secretKey,now
  });
  assert.deepEqual(result,{
    points:47,cleaningPoints:22,websiteXp:25,
    rank:null,yearly:{
      "2025":{points:22,rank:null},
      "2026":{points:25,rank:null}
    },
    yearlyXpTotal:47,rankingAvailable:false
  });
});
test("homepage and Customer HQ use the same verified totals and never show unknown XP",()=>{
  const root=path.resolve(__dirname,"..");
  const server=fs.readFileSync(path.join(root,"netlify/functions/customerHQ.mjs"),"utf8");
  const api=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  const ui=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  const style=fs.readFileSync(path.join(root,"src/n64-finale.css"),"utf8");
  const gate=server.indexOf("const session=await lookupVerifiedSession(request,ledger);");
  const summary=server.indexOf('get("view")==="rank-summary"');
  assert.ok(gate>=0&&summary>gate,"email-code session must be checked first");
  assert.match(server,/const summary=await verifiedPersonalSummary\(session,snapshot\)/);
  assert.match(server,/points:summary\.points,cleaningPoints:summary\.cleaningPoints/);
  assert.match(api,/yearlyPreview\.getDatedScoreBoards\(/);
  assert.doesNotMatch(api,/await historicalPreview\.getStaticPreviewBoard\(stores,now,true\)/);
  assert.match(ui,/CUSTOMER_SUMMARY_ENDPOINT="\/api\/customer-hq\?view=rank-summary"/);
  assert.match(ui,/credentials:"same-origin"/);
  assert.match(ui,/verifiedYearTotal!==sum\.points/);
  assert.match(ui,/★ \{shownCustomerPeriod==="overall"\?"TOTAL XP"/);
  assert.match(ui,/LEADERBOARD POSITION/);
  assert.match(ui,/customerPeriods=\["overall",\.\.\.Object\.keys\(customerSummary\?\.yearly\|\|\{\}\)/);
  assert.match(ui,/onClick=\{\(\)=>setCustomerPeriod\(period\)\}/);
  assert.doesNotMatch(ui,/ARCADE XP ON THIS PHONE|localScore\.points|unassignedXp|YEAR UNKNOWN XP/);
  assert.match(ui,/Sign in to see your total XP, leaderboard position and years with points/);
  assert.match(style,/n64-personal-year-active/);
  assert.doesNotMatch(style,/n64-personal-reconciliation/);
});
