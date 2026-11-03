"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("owner-reported new round gives 1734 monthly customers and GBP12000 of GBP5 bin cleans",async()=>{
  const {OWNER_MONTHLY_PLAN,MONTHLY_CLEANING_TARGET}=await import("../src/data/ownerMonthlyPlan.mjs");
  assert.equal(OWNER_MONTHLY_PLAN.monthlyCustomers,1734);
  assert.equal(OWNER_MONTHLY_PLAN.pricePerPaidCleanGBP,5);
  assert.equal(OWNER_MONTHLY_PLAN.monthlyRevenueTargetGBP,12000);
  assert.equal(MONTHLY_CLEANING_TARGET.monthlyCleans,2400);
  assert.equal(MONTHLY_CLEANING_TARGET.averageCleansPerWeek,600);
  assert.equal(MONTHLY_CLEANING_TARGET.averageCleansPerWorkday,150);
  assert.deepEqual(MONTHLY_CLEANING_TARGET.weekly.map(x=>x.cleans),[600,600,600,600]);
  assert.equal(MONTHLY_CLEANING_TARGET.weekly.reduce((sum,x)=>sum+x.revenueGBP,0),12000);
});
test("new business forecast never rewrites verified October backup or route assignments",async()=>{
  const {CYCLE_SNAPSHOT,FOUR_WEEK_PLAN}=await import("../src/data/cleaningCycleData.mjs");
  assert.equal(CYCLE_SNAPSHOT.activeFourWeeklyCustomers,785);
  assert.equal(CYCLE_SNAPSHOT.completedBinsThroughBackup,30803);
  assert.equal(FOUR_WEEK_PLAN[2].Mon.bins,102);
  const stats=fs.readFileSync(path.join(__dirname,"../src/data/statsPlan.js"),"utf8");
  assert.match(stats,/totalBinsCleaned:CYCLE_SNAPSHOT\.completedBinsThroughBackup/);
  assert.match(stats,/monthlyCustomers: OWNER_MONTHLY_PLAN\.monthlyCustomers/);
  assert.match(stats,/totalMonthlyCustomers:OWNER_MONTHLY_PLAN\.monthlyCustomers/);
});
test("homepage retains the customer count but removes the four-week forecast panel",()=>{
  const hero=fs.readFileSync(path.join(__dirname,"../src/LandingPage.jsx"),"utf8");
  assert.match(hero,/Monthly Customers/);
  assert.match(hero,/Including our new round/);
  assert.match(hero,/Verified to \{verifiedThrough\}/);
  assert.doesNotMatch(hero,/n64-cleaning-plan|planned cleans per month|Planning averages for the new round/);
});
