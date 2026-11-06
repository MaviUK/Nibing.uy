"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  roundForCleaningDate, resolveSqueegeeRoundJobGroup,
  isNorthernIrelandMondayShift, normalizedGroupNumber,
} = require("../netlify/functions/lib/squeegeeRoundCycle");

const GROUP11="11111111-1111-4111-8111-111111111111";
const GROUP12="22222222-2222-4222-8222-222222222222";
const GROUP16="33333333-3333-4333-8333-333333333333";
const GROUP01="44444444-4444-4444-8444-444444444444";
const accountGroups=[
  {id:GROUP11,description:"11"},
  {id:GROUP12,description:"12"},
  {id:GROUP16,description:"16"},
  {id:GROUP01,description:"01"},
];

test("owner-confirmed Monday 2 Nov 2026 = Round 11, week 3",()=>{
  const r=roundForCleaningDate("2026-11-02");
  assert.equal(r.matched,true);
  assert.equal(r.roundNumber,11);
  assert.equal(r.weekNumber,3);
  assert.equal(r.operationalDayIndex,1);
  assert.equal(r.weekdayMappingVerified,true);
  assert.equal(r.bankHolidayShifted,false);
});

test("each weekday has its own sequential round in Week 3",()=>{
  const days=[
    ["2026-11-02",11],["2026-11-03",12],["2026-11-04",13],
    ["2026-11-05",14],["2026-11-06",15],
  ];
  for(const [date,round] of days){
    const r=roundForCleaningDate(date);
    assert.equal(r.weekNumber,3);
    assert.equal(r.roundNumber,round,date);
    assert.equal(r.weekdayMappingVerified,true);
  }
  assert.equal(new Set(days.map(([d])=>roundForCleaningDate(d).roundNumber)).size,5);
});

test("rotates weeks 1-4 and returns to Round 11 every 28 days",()=>{
  for(const [date,week,round] of [
    ["2026-10-19",1,1],
    ["2026-10-23",1,5],
    ["2026-10-26",2,6],
    ["2026-10-30",2,10],
    ["2026-11-02",3,11],
    ["2026-11-06",3,15],
    ["2026-11-09",4,16],
    ["2026-11-13",4,20],
    ["2026-11-16",1,1],
    ["2026-11-20",1,5],
    ["2026-11-23",2,6],
    ["2026-11-27",2,10],
    ["2026-11-30",3,11],
    ["2026-12-04",3,15],
  ]){
    const r=roundForCleaningDate(date);
    assert.equal(r.weekNumber,week,date);
    assert.equal(r.roundNumber,round,date);
  }
});

test("missing account groups stay missing despite their calendar dates being known",()=>{
  for(const [date,round] of [
    ["2026-11-06",15],["2026-11-13",20],
    ["2026-11-20",5],["2026-11-23",6],
    ["2026-11-24",7],["2026-11-27",10],
  ]){
    const result=resolveSqueegeeRoundJobGroup(date,accountGroups);
    assert.equal(result.roundNumber,round,date);
    assert.equal(result.status,"round_missing_in_account",date);
    assert.equal(result.jobGroupId,null,date);
  }
});

test("missing 6 and 7 are Monday/Tuesday cleaning rounds, not proof of Friday scheduling",()=>{
  assert.equal(roundForCleaningDate("2026-11-23").roundNumber,6);
  assert.equal(roundForCleaningDate("2026-11-24").roundNumber,7);
  // Friday bin COLLECTION coverage is distinct from a Friday CLEAN.
});

test("active round numbers map to account UUIDs without inventing missing groups",()=>{
  for(const [date,round,id] of [
    ["2026-11-02",11,GROUP11],
    ["2026-11-03",12,GROUP12],
    ["2026-11-09",16,GROUP16],
    ["2026-11-16",1,GROUP01],
    ["2026-11-30",11,GROUP11],
  ]){
    const result=resolveSqueegeeRoundJobGroup(date,accountGroups,{recurring:true});
    assert.equal(result.status,"mapped",date);
    assert.equal(result.roundNumber,round,date);
    assert.equal(result.jobGroupId,id,date);
  }
});

test("missing/duplicated/invalid account group UUIDs are all held",()=>{
  const missing=resolveSqueegeeRoundJobGroup("2026-11-02",[]);
  assert.equal(missing.status,"round_missing_in_account");
  const duplicate=resolveSqueegeeRoundJobGroup("2026-11-02",[
    {id:GROUP11,description:"11"},
    {id:GROUP12,description:"011".slice(1)},
  ]);
  assert.equal(duplicate.status,"duplicate_round_labels");
  const malformed=resolveSqueegeeRoundJobGroup("2026-11-02",[
    {id:"not-a-uuid",description:"11"},
  ]);
  assert.equal(malformed.status,"invalid_account_group_id");
});

test("invalid dates, prior-to-coverage dates and ordinary weekends never map",()=>{
  for(const date of ["2026-09-21","not-a-date","2026-11-07","2026-11-08","2026-02-30"]){
    assert.equal(roundForCleaningDate(date).matched,false,date);
  }
});

test("bank holiday shifts weekdays Tuesday-Saturday without shifting the round sequence",()=>{
  assert.equal(isNorthernIrelandMondayShift(new Date("2027-05-03T12:00:00Z")),true);
  assert.equal(roundForCleaningDate("2027-05-03").matched,false);
  const t=roundForCleaningDate("2027-05-04");
  const w=roundForCleaningDate("2027-05-05");
  const sat=roundForCleaningDate("2027-05-08");
  assert.equal(t.roundNumber+1,w.roundNumber);
  assert.equal(t.operationalDayIndex,1);
  assert.equal(sat.operationalDayIndex,5);
  assert.equal(t.bankHolidayShifted,true);
  assert.equal(t.recurringDateNeedsReview,true);
});

test("recurring shifted bank-holiday first appointment remains held for review",()=>{
  const result=resolveSqueegeeRoundJobGroup("2027-05-04",accountGroups,{recurring:true});
  assert.equal(result.status,"bank_holiday_recurrence_review");
  assert.equal(result.jobGroupId,null);
});

test("Christmas substitute Monday follows existing NI Bin Guy exception",()=>{
  const result=roundForCleaningDate("2026-12-28");
  assert.equal(result.roundNumber,11);
  assert.equal(result.bankHolidayShifted,false);
});

test("job group labels must match real numeric codes",()=>{
  assert.equal(normalizedGroupNumber("01"),1);
  assert.equal(normalizedGroupNumber("11"),11);
  assert.equal(normalizedGroupNumber("20"),20);
  assert.equal(normalizedGroupNumber("21"),null);
  assert.equal(normalizedGroupNumber("Round 11"),null);
  assert.equal(normalizedGroupNumber("011"),null);
});


test("31 Oct Squeegee quantity-aware plan counts physical bins instead of jobs", async () => {
  const { FOUR_WEEK_PLAN, CYCLE_SNAPSHOT } = await import("../src/data/cleaningCycleData.mjs");
  assert.equal(CYCLE_SNAPSHOT.backupDate, "2026-10-31");
  assert.equal(CYCLE_SNAPSHOT.weekOneMonday, "2026-10-19");
  assert.equal(CYCLE_SNAPSHOT.activeFourWeeklyCustomers, 785);
  assert.equal(CYCLE_SNAPSHOT.activeFourWeeklyJobs, 1065);
  assert.equal(CYCLE_SNAPSHOT.scheduledFourWeeklyBinServices, 1288);
  assert.equal(CYCLE_SNAPSHOT.scheduledFourWeeklyBinsPerCycle, 1343);
  assert.equal(CYCLE_SNAPSHOT.lastCycleWashedFourWeeklyJobs, 984);
  assert.equal(CYCLE_SNAPSHOT.lastCycleWashedFourWeeklyServiceEntries, 1186);
  assert.equal(CYCLE_SNAPSHOT.lastCycleWashedFourWeeklyBins, 1222);
  assert.equal(CYCLE_SNAPSHOT.completedBinsThroughBackup, 30803);
  assert.match(CYCLE_SNAPSHOT.countingMethod, /service\.quantity/);
  const days = ["Mon", "Tue", "Wed", "Thu"];
  const expected = [
    [[1,122,111],[2,97,93],[3,103,100],[4,140,131]],
    [[6,0,0],[7,0,0],[8,81,72],[9,56,51]],
    [[11,102,100],[12,67,42],[13,98,92],[14,125,115]],
    [[16,85,77],[17,76,62],[18,98,93],[19,93,83]]
  ];
  let bins=0, washed=0, jobs=0, cleanedJobs=0;
  for(let w=0;w<4;w++) for(let d=0;d<4;d++){
    const row=FOUR_WEEK_PLAN[w][days[d]];
    assert.deepEqual([row.round,row.bins,row.washedLastCycle],expected[w][d]);
    assert.ok(row.bins>=row.scheduledJobs);
    assert.ok(row.washedLastCycle>=row.washedJobsLastCycle);
    bins+=row.bins;washed+=row.washedLastCycle;
    jobs+=row.scheduledJobs;cleanedJobs+=row.washedJobsLastCycle;
  }
  assert.deepEqual([bins,washed,jobs,cleanedJobs],[1343,1222,1065,984]);
  assert.equal(FOUR_WEEK_PLAN[3].Tue.bins,76);
  assert.equal(FOUR_WEEK_PLAN[3].Tue.scheduledJobs,59);
  assert.equal(FOUR_WEEK_PLAN[1].Mon.bins,0);
  assert.equal(FOUR_WEEK_PLAN[1].Tue.bins,0);
  assert.equal(roundForCleaningDate("2026-11-02").roundNumber,FOUR_WEEK_PLAN[2].Mon.round);
  assert.equal(FOUR_WEEK_PLAN[0].Thu.washedLastCycle,89+42);
  const fs=require("node:fs"),path=require("node:path");
  const stats=fs.readFileSync(path.join(__dirname,"../src/data/statsPlan.js"),"utf8");
  assert.match(stats,/totalBinsCleaned: TOTAL_COMPLETED_BINS/);
  assert.match(stats,/PRE_SQUEEGEE_COMPLETED_BINS = VERIFIED_COMPLETED_SERVICES\.beforeSqueegeeBins/);
  assert.match(stats,/Verified completed bins through the Squeegee audit remain immutable/);
  assert.match(stats,/Keep the previous 14,000 cleans separate from Squeegee's 31,212 bins/);
  assert.doesNotMatch(stats,/computeEstimatedRouteTotals/);
  assert.match(stats,/CYCLE_SNAPSHOT\.weekOneMonday/);
});


test("owner confirmed current week revenue records 399 physical bins without inventing a route", async () => {
  const { OWNER_CONFIRMED_WEEK, getOwnerConfirmedWeekReconciliation, FOUR_WEEK_PLAN } =
    await import("../src/data/cleaningCycleData.mjs");
  assert.equal(OWNER_CONFIRMED_WEEK.monday, "2026-11-02");
  assert.equal(OWNER_CONFIRMED_WEEK.cycleWeek, 3);
  assert.equal(OWNER_CONFIRMED_WEEK.perBinGBP, 5);
  assert.equal(OWNER_CONFIRMED_WEEK.scheduledValueGBP, 1995);
  assert.equal(OWNER_CONFIRMED_WEEK.scheduledPhysicalBins, 399);
  assert.equal(OWNER_CONFIRMED_WEEK.scheduledValueGBP / OWNER_CONFIRMED_WEEK.perBinGBP,
    OWNER_CONFIRMED_WEEK.scheduledPhysicalBins);
  const result = getOwnerConfirmedWeekReconciliation();
  assert.equal(result.allocatedBinsFromBackup, 392);
  assert.equal(result.unallocatedBins, 7);
  assert.equal(FOUR_WEEK_PLAN[2].Mon.bins, 102);
  assert.equal(FOUR_WEEK_PLAN[2].Tue.bins, 67);
  assert.equal(FOUR_WEEK_PLAN[2].Wed.bins, 98);
  assert.equal(FOUR_WEEK_PLAN[2].Thu.bins, 125);
  // No daily fabrication or addition to the historic completed-wash total.
  const { CYCLE_SNAPSHOT } = await import("../src/data/cleaningCycleData.mjs");
  assert.equal(CYCLE_SNAPSHOT.completedBinsThroughBackup, 30803);
});
