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
test("admin displays the achievements only after owner-session verification",()=>{
 const src=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 assert.match(src,/import achievements from "\.\/lib\/squeegeePreviewOwnerAchievements\.js"/);
 assert.match(src,/function achievementsPanel\(snapshot\)/);
 assert.match(src,/achievementsPanel\(snapshot\)\+filters/);
 assert.match(src,/id="high-achievements"/);
 assert.match(src,/id="owner-job-/);
 assert.match(src,/Longest "\+colour\+" bin streak/);
 assert.match(src,/Longest unbroken · all jobs/);
 assert.match(src,/Longest ongoing job streak/);
 assert.match(src,/Most paid physical bins/);
 assert.match(src,/Most separate jobs/);
 assert.match(src,/owner\.verifyTestSessionCookie\(cookie,process\.env,Date\.now\(\),scope\)/);
 const auth=src.indexOf("if(!owner.verifyTestSessionCookie");
 const snapshot=src.indexOf("const snapshot=await getStore");
 assert.ok(auth>=0 && snapshot>auth);
 assert.doesNotMatch(src,/addJobToCustomer|createCustomer\(/);
});
