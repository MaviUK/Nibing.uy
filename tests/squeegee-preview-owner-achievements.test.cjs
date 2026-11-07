"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const achievement=require("../netlify/functions/lib/squeegeePreviewOwnerAchievements");

const paid=(date,j,streak,quantity=1)=>({
 date,event:"paid_completed_clean",j,streak,points:quantity*(20+2*(streak-1)),quantity
});
const unpaid=(date,j,streak)=>({
 date,event:"completed_payment_not_verified",j,streak,points:0,quantity:1
});
const skip=(date,j)=>({
 date,event:"recorded_skip",j,streak:0,points:0,quantity:0
});
function job(label,currentStreak,lastCompletedOn,paidCleans=1){
 return {id:label+"-job",label,currentStreak,lastCompletedOn,
  paidCleans,recordedSkips:0,nextBonus:20+2*currentStreak};
}
const snap=[
 {id:"a",ref:"10",firstName:"Glen",town:"Bangor",paidCleans:12,
  jobs:[job("Blue",1,"2026-11-06",7),job("Black",3,"2026-11-05",5)],
  events:[
   paid("2024-03-01",0,1,2),
   paid("2024-04-01",0,2,2),
   unpaid("2024-05-01",0,3),
   paid("2024-05-01",1,1), // distinct job, same date
   paid("2024-06-01",0,4,2),
   skip("2024-07-01",0), // resets only Blue
   paid("2024-07-01",1,2),
   paid("2026-11-05",1,3),
   paid("2026-11-06",0,1)
  ]},
 {id:"b",ref:"20",firstName:"Ronnie",town:"Donaghadee",paidCleans:20,
  jobs:[job("Brown",3,"2026-11-02",11),job("Green",1,"2026-11-01",9)],
  events:[
   paid("2024-01-01",0,1),
   paid("2024-02-01",0,2),
   paid("2024-03-01",0,3),
   paid("2026-11-01",1,1),
   paid("2026-11-02",0,3)
  ]},
 {id:"c",ref:"30",firstName:"Helen",town:"Newtownards",paidCleans:8,
  jobs:[job("Blue + Brown",5,"2026-11-06",8)],
  events:[
   paid("2024-01-01",0,1),
   paid("2024-02-01",0,2),
   paid("2024-03-01",0,3),
   paid("2024-04-01",0,4),
   paid("2026-11-06",0,5)
  ]},
 {id:"d",ref:"40",firstName:"Tom",town:"Comber",paidCleans:3,
  jobs:[job("Green",3,"2026-04-01",3)],
  events:[paid("2026-02-01",0,1),paid("2026-03-01",0,2),
   paid("2026-04-01",0,3)]
 }
];
const asOf="2026-11-06";

test("records retain the highest-ever job streak even after later skips",()=>{
 const records=achievement.awards(snap,{asOf});
 assert.equal(records.byColour.Blue[0].ref,"10");
 assert.equal(records.byColour.Blue[0].best,4);
 assert.equal(records.byColour.Blue[0].active,1);
 assert.equal(records.byColour.Blue[0].achievedOn,"2024-06-01");
 assert.equal(records.byColour.Black[0].best,3);
 assert.equal(records.byColour.Black[0].label,"Black");
 assert.equal(records.byColour.Brown[0].ref,"20");
 assert.equal(records.byColour.Green[0].ref,"40");
});
test("multi-colour jobs cannot be mislabelled as a Blue/Brown colour record",()=>{
 const result=achievement.awards(snap,{asOf});
 assert.equal(result.longestJob[0].ref,"30");
 assert.equal(result.longestJob[0].best,5);
 assert.ok(!result.byColour.Blue.some(r=>r.ref==="30"));
 assert.ok(!result.byColour.Brown.some(r=>r.ref==="30"));
 assert.equal(result.jobCount,6);
});
test("a job with seven bins is ONE clean visit for streak purposes",()=>{
 const one={ref:"50",firstName:"A",town:"Bangor",paidCleans:7,
  jobs:[job("Blue",1,asOf,7)],
  events:[paid(asOf,0,1,7)]};
 const r=achievement.awards([one],{asOf});
 assert.equal(r.longestJob[0].best,1);
 assert.equal(r.paidBins[0].paidBins,7);
});
test("longest all-jobs customer streak uses unique dates and stops at ANY recorded skip",()=>{
 const sample={ref:"10",events:[
  paid("2025-01-01",0,1),paid("2025-01-01",1,1),
  unpaid("2025-02-01",0,2),paid("2025-03-01",1,2),
  skip("2025-04-01",0),paid("2025-04-01",1,3),
  paid("2025-05-01",1,4),paid("2025-06-01",0,1)
 ]};
 assert.deepEqual(achievement.customerCleanDateRecord(sample),
  {combined:3,achievedOn:"2025-03-01"});
 assert.equal(achievement.awards(snap,{asOf}).combined[0].ref,"20");
});
test("ongoing record applies same 35-day expiry used for the next clean bonus",()=>{
 const result=achievement.awards(snap,{asOf});
 assert.equal(result.activeJob[0].ref,"30");
 assert.equal(result.activeJob[0].active,5);
 const old=achievement.jobRecords(snap[3],asOf)[0];
 assert.equal(old.best,3);
 assert.equal(old.active,0);
});
test("record list sorts by award, with earliest achiever winning tied first place",()=>{
 const abc=[
  {ref:"b",firstName:"B",town:"Bangor",paidCleans:1,
   jobs:[job("Black",1,"2026-11-06")],
   events:[paid("2026-11-06",0,1)]},
  {ref:"a",firstName:"A",town:"Bangor",paidCleans:1,
   jobs:[job("Black",1,"2026-11-05")],
   events:[paid("2026-11-05",0,1)]}
 ];
 const ranked=achievement.awards(abc,{asOf});
 assert.deepEqual(ranked.byColour.Black.map(x=>x.ref),["a","b"]);
});
test("legacy customer-wide scores do not fabricate per-job achievements",()=>{
 assert.equal(achievement.awards([{ref:"10",events:[paid(asOf,0,1)]}],{asOf}),null);
 assert.equal(achievement.awards(snap,{asOf:"not-a-day"}),null);
});
test("award calculations do not mutate the private customer or job history",()=>{
 const before=JSON.stringify(snap);
 achievement.awards(snap,{asOf});
 assert.equal(JSON.stringify(snap),before);
});
test("current Blue and Green leaders differ from their lifetime record holders",()=>{
 const records=achievement.awards(snap,{asOf});
 assert.equal(records.byColour.Blue[0].ref,"10");
 assert.equal(records.byColour.Blue[0].best,4);
 assert.equal(records.byColourCurrent.Blue[0].ref,"10");
 assert.equal(records.byColourCurrent.Blue[0].active,1);
 assert.equal(records.byColour.Green[0].ref,"40");
 assert.equal(records.byColour.Green[0].best,3);
 assert.equal(records.byColourCurrent.Green[0].ref,"20");
 assert.equal(records.byColourCurrent.Green[0].active,1);
 assert.equal(records.byColourCurrent.Green.some(x=>x.ref==="40"),false);
});
test("a skipped job loses its current streak, but keeps its highest historical streak",()=>{
 const customer={
  ref:"55",firstName:"Sample",town:"Bangor",paidCleans:3,
  jobs:[job("Black",0,"2026-10-01",3)],
  events:[
   paid("2026-08-01",0,1),
   paid("2026-09-01",0,2),
   paid("2026-10-01",0,3),
   skip("2026-10-03",0)
  ]
 };
 const records=achievement.awards([customer],{asOf});
 assert.equal(records.byColour.Black[0].best,3);
 assert.deepEqual(records.byColourCurrent.Black,[]);
 assert.equal(records.activeJob.length,0);
 const detail=achievement.jobRecords(customer,asOf)[0];
 assert.equal(detail.best,3);
 assert.equal(detail.active,0);
});
test("the customer-wide current record differs from the historical highest record",()=>{
 const records=achievement.awards(snap,{asOf});
 assert.equal(records.combined[0].ref,"20");
 assert.equal(records.combined[0].combined,5);
 assert.equal(records.combinedCurrent[0].ref,"30");
 assert.equal(records.combinedCurrent[0].activeCombined,5);
 assert.equal(records.combinedCurrent[0].lastCompletedOn,"2026-11-06");
});
test("customer-wide current run expires, while the lifetime high is preserved",()=>{
 const source={ref:"77",events:[
   paid("2026-01-01",0,1),paid("2026-02-01",0,2),
   paid("2026-03-01",1,1)
 ]};
 const row=achievement.customerCleanDateRecord(source,asOf);
 assert.equal(row.combined,3);
 assert.equal(row.activeCombined,0);
 assert.equal(row.achievedOn,"2026-03-01");
});
test("same-day skip ends customer-wide current run without resetting other job's independent XP streak",()=>{
 const source={
  ref:"88",firstName:"Example",town:"Comber",paidCleans:3,
  jobs:[job("Brown",0,"2026-11-05",1),job("Blue",2,"2026-11-06",2)],
  events:[
    paid("2026-11-04",0,1),
    skip("2026-11-05",0),
    paid("2026-11-05",1,1),
    paid("2026-11-06",1,2)
  ]
 };
 const scores=achievement.awards([source],{asOf});
 assert.equal(scores.byColourCurrent.Blue[0].active,2);
 assert.equal(scores.byColourCurrent.Brown.length,0);
 assert.equal(scores.combinedCurrent[0].activeCombined,1);
 assert.equal(scores.combined[0].combined,1);
});
test("admin headings and private customer detail explicitly separate both streak measures",()=>{
 const src=fs.readFileSync(path.join(__dirname,
   "../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 for(const label of [
  "CURRENT STREAKS","HISTORICAL HIGHEST STREAKS",
  "Current streak</th>","Historical highest</th>",
  "current-achievements","historical-achievements"
 ])assert.ok(src.includes(label),label);
 assert.ok(src.includes("jobAwards[index]?.active||0"));
 assert.ok(src.includes("jobAwards[index]?.best||0"));
 assert.ok(src.includes("20+2*(jobAwards[index]?.active||0)"));
});

test("admin displays the achievements only after owner-session verification",()=>{
 const src=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 assert.match(src,/import achievements from "\.\/lib\/squeegeePreviewOwnerAchievements\.js"/);
 assert.match(src,/function achievementsPanel\(snapshot\)/);
 assert.match(src,/if\(recordView\)/);
 assert.match(src,/achievementsPanel\(snapshot\)/);
 assert.match(src,/stats\+nav\+filters\(q,mode,year\)/);
 assert.match(src,/url\(\{view:"records"\}\)/);
 assert.match(src,/fromRecords\?'← HIGH ACHIEVEMENTS':'← ALL CUSTOMERS'/);
 assert.match(src,/id="high-achievements"/);
 assert.match(src,/id="owner-job-/);
 assert.match(src,/colour\+" bin · current"/);
 assert.match(src,/colour\+" bin · highest ever"/);
 assert.match(src,/Current unbroken · all jobs/);
 assert.match(src,/Historical highest · all jobs/);
 assert.match(src,/Current longest · any job/);
 assert.match(src,/Historical highest · any job/);
 assert.match(src,/Most paid physical bins/);
 assert.match(src,/Most separate jobs/);
 assert.match(src,/owner\.verifyTestSessionCookie\(cookie,process\.env,Date\.now\(\),scope\)/);
 const auth=src.indexOf("if(!owner.verifyTestSessionCookie");
 const snapshot=src.indexOf("const snapshot=await getStore");
 assert.ok(auth>=0 && snapshot>auth);
 assert.doesNotMatch(src,/addJobToCustomer|createCustomer\(/);
});
