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
const accounts=[
  {id:ids[0],email:"alpha@example.co.uk",firstName:"Alice",town:"Bangor"},
  {id:ids[1],email:"bravo@example.co.uk",firstName:"Bob",town:"Comber"},
  {id:ids[2],email:"charlie@example.co.uk",firstName:"Carol",town:"Newtownards"}
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
function get({customerId=ids[0],points=600,consent=consentSnapshot,
              years=[board([[0,120],[2,80]],2024),
                     board([[1,240],[0,90]],2026)],
              overall=board([[1,750],[0,600],[2,500]])}={}){
  return personal.fromBoards({
    customerId,points,privateCustomers,eligibleAliases,
    consentSnapshot:consent,secretKey,
    overallBoard:overall,yearlyBoards:years
  });
}
test("verified customer gets total XP and exact public rank, plus years with earned XP only",()=>{
  const summary=get();
  assert.deepEqual(summary,{
    points:600,rank:2,rankingAvailable:true,
    yearly:{"2024":{points:120,rank:1},"2026":{points:90,rank:2}}
  });
  // Annual XP cannot be reverse-calculated from lifetime XP. Older undated
  // earnings remain in Overall, never misattributed to 2026.
  assert.equal(summary.points,600);
  assert.equal(summary.yearly["2025"],undefined);
  const publicOverall=names.previewFirstNameScoreboard(
    privateCustomers,board([[1,750],[0,600],[2,500]]),
    eligibleAliases,consentSnapshot,secretKey);
  assert.equal(publicOverall.entries[1].rank,summary.rank);
  assert.equal(publicOverall.entries[1].customerRef,personal.publicRef(aliases[0],secretKey));
});
test("customer with a public withdrawal keeps private points but has no public position",()=>{
  const withdrawn={
    ...consentSnapshot,
    records:consentSnapshot.records.map((item,i)=>i===0
      ?{...item,consent:"withdrawn",withdrawnAt:"2026-11-01T12:00:00Z"}:item)
  };
  const summary=get({consent:withdrawn});
  assert.equal(summary.points,600);
  assert.equal(summary.rank,null);
  assert.equal(summary.yearly["2024"].points,120);
  assert.equal(summary.yearly["2024"].rank,null);
  assert.equal(summary.yearly["2026"].rank,null);
});
test("no verified customer identity never yields another customer's public rank",()=>{
  const other=get({customerId:"44444444-4444-4444-8444-444444444444"});
  assert.equal(other.points,600);
  assert.equal(other.rank,null);
  assert.deepEqual(other.yearly,{});
  assert.equal(other.rankingAvailable,false);
  assert.equal(personal.publicRef(ids[0],secretKey),null);
});
test("homepage only requests rank summary through verified session and not browser XP",()=>{
  const root=path.resolve(__dirname,"..");
  const server=fs.readFileSync(path.join(root,"netlify/functions/customerHQ.mjs"),"utf8");
  const ui=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  const style=fs.readFileSync(path.join(root,"src/n64-finale.css"),"utf8");
  const gate=server.indexOf("const session=await lookupVerifiedSession(request,ledger);");
  const summary=server.indexOf('get("view")==="rank-summary"');
  assert.ok(gate>=0 && summary>gate,"customer identity must be verified first");
  assert.match(server,/summary=await personalRanks\.getPersonalSummary/);
  assert.match(server,/return respond\(200,\{ready:true,authenticated:true,summary\}\)/);
  assert.match(ui,/CUSTOMER_SUMMARY_ENDPOINT="\/api\/customer-hq\?view=rank-summary"/);
  assert.match(ui,/credentials:"same-origin"/);
  assert.match(ui,/★ \{shownCustomerPeriod==="overall"\?"TOTAL XP"/);
  assert.match(ui,/LEADERBOARD POSITION/);
  assert.match(ui,/customerPeriods=\["overall",\.\.\.Object\.keys\(customerSummary\?\.yearly\|\|\{\}\)/);
  assert.match(ui,/onClick=\{\(\)=>setCustomerPeriod\(period\)\}/);
  assert.doesNotMatch(ui,/ARCADE XP ON THIS PHONE|localScore\.points/);
  assert.match(ui,/Sign in to see your total XP, leaderboard position and years with points/);
  assert.match(style,/n64-personal-year-active/);
});
