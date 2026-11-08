"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const migration=require("../netlify/functions/lib/squeegeeSavedStreakMigration");
const bin=require("../netlify/functions/lib/squeegeePreviewBinHistory");
const overdue=require("../netlify/functions/lib/squeegeeOverduePenalty");
const date=Date.parse("2026-11-08T13:00:00Z");
function sample(){
 const accountId="11111111-1111-4111-8111-111111111111";
 const brown="22222222-2222-4222-8222-222222222222";
 const invoice="33333333-3333-4333-8333-333333333333";
 return {version:1,asOf:"2026-11-08",
  scoringVersion:migration.OLD,penaltySourceVersion:overdue.VERSION,
  sourceHash:"old verified backup hash",importedAt:"2026-11-08T12:00:00Z",
  accounts:[{
   id:accountId,ref:"2397",email:"alice@example.test",firstName:"Alice",
   town:"Bangor",points:86,paidCleans:4,currentStreak:3,
   nextBonus:26,recordedSkips:0,balanceState:"settled",
   jobs:[{id:brown,label:"Brown",currentStreak:3,nextBonus:26,
     paidCleans:4,points:86,recordedSkips:0,lastCompletedOn:"2026-11-08"}],
   events:[
    {date:"2026-10-01",event:"paid_completed_clean",j:0,
      quantity:2,streak:1,points:40},
    {date:"2026-10-29",event:"paid_completed_clean",j:0,
      quantity:1,streak:2,points:22},
    {date:"2026-11-08",event:"paid_completed_clean",j:0,
      quantity:1,streak:3,points:24}
   ],
   outstandingJobs:[],
   settledJobs:[{id:invoice,dueOn:"2026-10-01",paidOn:"2026-11-08",j:0}],
   penaltyLedger:[{id:invoice,dueOn:"2026-10-01",until:"2026-11-08",
     settledOn:"2026-11-08",j:0,points:10}],penaltyPoints:10
  }],
  summary:{activeAccounts:1,verifiedPaidBins:4,
    allHistoricalPoints:86,rankedPoints:86,rankedWithEmailPoints:86,
    overduePenaltyPoints:10,historicalLatePaidJobs:1,outstandingJobs:0}
 };
}
test("owner migration changes saved per-bin paid event points 40/22/24 to 40/21/22",()=>{
 const original=sample();
 const migrated=migration.migrate(original,{now:date});
 assert.equal(original.scoringVersion,migration.OLD);
 assert.equal(migrated.scoringVersion,migration.NEW);
 assert.deepEqual(migrated.accounts[0].events.map(e=>e.points),[40,21,22]);
 assert.equal(migrated.accounts[0].points,83);
 assert.equal(migrated.accounts[0].jobs[0].points,83);
 assert.equal(migrated.accounts[0].jobs[0].nextBonus,23);
 assert.equal(migrated.accounts[0].nextBonus,23);
 assert.equal(migrated.summary.allHistoricalPoints,83);
 assert.equal(migrated.summary.rankedWithEmailPoints,83);
 assert.equal(migrated.summary.verifiedPaidBins,4);
 assert.equal(migrated.scoreMigration.pointsReduced,3);
 assert.equal(migrated.sourceHash,original.sourceHash);
 assert.equal(migrated.importedAt,original.importedAt);
 assert.deepEqual(migrated.accounts[0].penaltyLedger,original.accounts[0].penaltyLedger);
 assert.equal(migrated.accounts[0].penaltyPoints,10);
 assert.equal(migrated.summary.overduePenaltyPoints,10);
 assert.equal(migrated.summary.historicalLatePaidJobs,1);
 assert.equal(bin.validateBinSource(migrated,{now:date}).accounts[0].points,83);
});
test("migration refuses replays, mismatched old points, old penalties and stale history",()=>{
 const correct=migration.migrate(sample(),{now:date});
 assert.throws(()=>migration.migrate(correct,{now:date}),/source_invalid/);
 const mismatch=sample();mismatch.accounts[0].events[2].points=22;
 assert.throws(()=>migration.migrate(mismatch,{now:date}),/old_points_mismatch/);
 const mismatchTotal=sample();mismatchTotal.accounts[0].points++;
 assert.throws(()=>migration.migrate(mismatchTotal,{now:date}),/old_total_mismatch/);
 const oldPenalty=sample();oldPenalty.penaltySourceVersion=overdue.LEGACY_VERSION_V2;
 assert.throws(()=>migration.migrate(oldPenalty,{now:date}),/source_invalid/);
 const oldTime=sample();oldTime.asOf="2026-10-01";
 assert.throws(()=>migration.migrate(oldTime,{now:date}),/source_invalid/);
});
test("only owner-authenticated POST with session-bound CSRF and etag may rescore stored XP",()=>{
 const src=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 assert.match(src,/owner\.verifyTestSessionCookie\(cookie,process\.env,Date\.now\(\),scope\)/);
 assert.match(src,/body\.get\("action"\)==="recalculate_plus1"/);
 assert.match(src,/uploadCsrf\.isAllowedOwnerUpload\(\{/);
 assert.match(src,/token:body\.get\("csrf"\)/);
 assert.match(src,/store\.getWithMetadata\(hq\.DATA_KEY/);
 assert.match(src,/scorePolicy\.migrate\(previous\.data\)/);
 assert.match(src,/onlyIfMatch:previous\.etag/);
 assert.match(src,/saved\?\.modified!==true/);
 assert.match(src,/SAVED XP STILL USES \+2 PER STREAK/);
 assert.match(src,/RECALCULATE SAVED XP TO \+1 RULE/);
 assert.match(src,/savedScoreBanner\(snapshot,cookie\)/);
 assert.doesNotMatch(src,/api\.createCustomer|api\.addJobToCustomer/);
});
