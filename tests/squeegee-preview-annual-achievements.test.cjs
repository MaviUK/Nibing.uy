"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const award=require("../netlify/functions/lib/squeegeePreviewOwnerAchievements");
const pub=require("../netlify/functions/lib/squeegeePublicAchievementHighlights");
const history=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const asOf="2026-11-06";
const id1="11111111-1111-4111-8111-111111111111";
const id2="22222222-2222-4222-8222-222222222222";
const paid=(date,j,streak,quantity=1)=>({
 date,j,event:"paid_completed_clean",streak,quantity,points:20
});
const skip=(date,j)=>({date,j,event:"recorded_skip",streak:0,points:0,quantity:0});
const primary={
 id:id1,ref:"101",firstName:"Alex",town:"Bangor",paidCleans:99,
 jobs:[
  {id:"j-blue",label:"Blue",currentStreak:3,lastCompletedOn:asOf,paidCleans:99},
  {id:"j-black",label:"Black",currentStreak:0,lastCompletedOn:"2025-07-01",paidCleans:99}
 ],
 events:[
  paid("2024-10-01",1,1),
  paid("2024-11-12",0,3,2),
  paid("2024-12-10",0,4),
  paid("2025-01-07",0,5),
  skip("2025-02-04",0),
  paid("2025-05-02",0,1,2),
  paid("2025-07-01",1,2),
  paid("2026-10-09",0,2,2),
  paid(asOf,0,3)
 ]
};
const second={
 id:id2,ref:"202",firstName:"Private",town:"Comber",paidCleans:1000,
 jobs:[{id:"j-private",label:"Blue",currentStreak:21,lastCompletedOn:asOf,paidCleans:1000}],
 events:[paid(asOf,0,21)]
};
test("year-specific streaks use that year's actual recorded events, not today's job state",()=>{
 const y24=award.awards([primary],{asOf,year:2024});
 const y25=award.awards([primary],{asOf,year:2025});
 const y26=award.awards([primary],{asOf,year:2026});
 const all=award.awards([primary],{asOf});
 assert.equal(y24.byColour.Blue[0].best,4);
 assert.equal(y24.byColourCurrent.Blue[0].active,4);
 assert.equal(y24.periodEnd,"2024-12-31");
 assert.equal(y25.byColour.Blue[0].best,5);
 assert.equal(y25.byColourCurrent.Blue.length,0);
 assert.equal(y25.periodEnd,"2025-12-31");
 assert.equal(y26.byColour.Blue[0].best,3);
 assert.equal(y26.byColourCurrent.Blue[0].active,3);
 assert.equal(y26.periodEnd,asOf);
 assert.equal(all.byColour.Blue[0].best,5);
 assert.equal(all.byColourCurrent.Blue[0].active,3);
 assert.equal(award.awards([primary],{asOf,year:2027}),null);
});
test("a year counts paid physical quantities and only jobs cleaned that year",()=>{
 const r=award.awards([primary],{asOf,year:2025});
 assert.equal(r.paidBins[0].paidBins,4);
 assert.equal(r.mostJobs[0].jobs,2);
 assert.equal(r.combined[0].combined,4);
 assert.equal(r.combinedCurrent.length,0);
 const y26=award.awards([primary],{asOf,year:2026});
 assert.equal(y26.paidBins[0].paidBins,3);
 assert.equal(y26.mostJobs[0].jobs,1);
});
test("town record results follow year selection and leave original import unchanged",()=>{
 const original=JSON.stringify([primary,second]);
 const towns=award.townRecords([primary,second],{asOf,year:2024});
 assert.equal(towns.find(t=>t.town==="Bangor").highest.best,4);
 assert.equal(towns.find(t=>t.town==="Comber").highest,null);
 assert.equal(JSON.stringify([primary,second]),original);
});
test("public records are anonymous, exclude withdrawals, and preserve the chosen period",()=>{
 const snapshot={version:1,asOf,accounts:[primary,second]};
 const a1=history.canonicalLegacyRef(id1),a2=history.canonicalLegacyRef(id2);
 const aliases=new Set([a1,a2]);
 const permissions={version:1,sourceAsOf:asOf,records:[
  {alias:a1,consent:"pending"},{alias:a2,consent:"withdrawn",withdrawnAt:asOf}
 ]};
 const year=pub.highlights(snapshot,aliases,permissions,"2025");
 assert.equal(year.period,"2025");
 assert.equal(year.colours.find(row=>row.colour==="Blue").highest,5);
 assert.equal(year.colours.find(row=>row.colour==="Blue").current,0);
 assert.deepEqual(Object.keys(year.colours[0]).sort(),["colour","current","highest"]);
 const json=JSON.stringify(pub.highlights(snapshot,aliases,permissions,"overall"));
 for(const secret of ["Alex","Bangor","Private","Comber",id1,id2,a1,a2,"j-blue"])
   assert.ok(!json.includes(secret),secret);
 const wrong={...permissions,sourceAsOf:"2025-01-01"};
 assert.equal(pub.highlights(snapshot,aliases,wrong,"overall"),null);
 assert.equal(pub.highlights(snapshot,aliases,permissions,"2027"),null);
 assert.equal(pub.highlights(snapshot,new Set([a2]),permissions,"overall"),null);
});
test("public achievements run only inside Preview 77 and cannot publish private winners",()=>{
 const api=fs.readFileSync(path.join(__dirname,"../netlify/functions/arcadeLeaderboard.js"),"utf8");
 assert.match(api,/if\(isExactN64PreviewRequest\(event\)\)/);
 assert.match(api,/publicRecords\.highlights\(privateCustomers,eligible\.aliases,privateNames,period\)/);
 assert.match(api,/publicScores\?\.status==="preview_public_first_names"/);
 assert.ok(api.indexOf("const publicAchievements=")>api.indexOf("if(isExactN64PreviewRequest(event))"));
});
