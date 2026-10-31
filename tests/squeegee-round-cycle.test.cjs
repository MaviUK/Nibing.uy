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
