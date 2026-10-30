"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { roundForCleaningDate,resolveSqueegeeRoundJobGroup,
  isNorthernIrelandMondayShift,normalizedGroupNumber }=
  require("../netlify/functions/lib/squeegeeRoundCycle");
const GROUP11="11111111-1111-4111-8111-111111111111";
const GROUP12="22222222-2222-4222-8222-222222222222";
const GROUP16="33333333-3333-4333-8333-333333333333";
const GROUP01="44444444-4444-4444-8444-444444444444";
const availableGroups=[
  {id:GROUP11,description:"11"},
  {id:GROUP12,description:"12"},
  {id:GROUP16,description:"16"},
  {id:GROUP01,description:"01"},
];

test("Monday 2 November 2026 is Week 3 Round 11 as confirmed by the owner",()=>{
 const d=roundForCleaningDate("2026-11-02");
 assert.equal(d.matched,true);
 assert.equal(d.roundNumber,11);
 assert.equal(d.weekNumber,3);
 assert.equal(d.operationalDayIndex,1);
 assert.equal(d.bankHolidayShifted,false);
});
test("rounds increment each weekday of Week 3, Monday-Friday",()=>{
 for(const [day,round] of [
  ["2026-11-02",11],["2026-11-03",12],["2026-11-04",13],
  ["2026-11-05",14],["2026-11-06",15]]) {
  assert.equal(roundForCleaningDate(day).roundNumber,round,day);
 }
});
test("Week 4 then Week 1 then Week 2 then Week 3",()=>{
 for(const [day,round,week] of [
  ["2026-11-09",16,4],["2026-11-13",20,4],
  ["2026-11-16",1,1],["2026-11-20",5,1],
  ["2026-11-23",6,2],["2026-11-27",10,2],
  ["2026-11-30",11,3],["2026-12-04",15,3],
 ]) {
  const r=roundForCleaningDate(day);
  assert.equal(r.roundNumber,round,day);
  assert.equal(r.weekNumber,week,day);
 }
});
test("historic Week 1 aligns to website's October 19 2026 rota anchor",()=>{
 assert.equal(roundForCleaningDate("2026-10-19").roundNumber,1);
 assert.equal(roundForCleaningDate("2026-10-23").roundNumber,5);
 assert.equal(roundForCleaningDate("2026-10-26").roundNumber,6);
 assert.equal(roundForCleaningDate("2026-10-30").roundNumber,10);
});
test("cycle repeats every 28 days",()=>{
 assert.equal(roundForCleaningDate("2027-01-25").roundNumber,
  roundForCleaningDate("2027-02-22").roundNumber);
});
test("invalid or pre-anchor dates and ordinary weekends cannot choose a round",()=>{
 for(const day of ["2026-09-21","not-a-date","2026-11-07","2026-11-08","2026-02-30"]) {
  assert.equal(roundForCleaningDate(day).matched,false,day);
 }
});
test("bank holiday Tuesday represents Monday's shifted round",()=>{
 const firstWeekMayMonday=new Date("2027-05-03T12:00:00Z");
 assert.equal(isNorthernIrelandMondayShift(firstWeekMayMonday),true);
 assert.equal(roundForCleaningDate("2027-05-03").matched,false);
 const tue=roundForCleaningDate("2027-05-04");
 const wed=roundForCleaningDate("2027-05-05");
 const saturday=roundForCleaningDate("2027-05-08");
 assert.equal(tue.matched,true);
 assert.equal(tue.operationalDayIndex,1);
 assert.equal(wed.operationalDayIndex,2);
 assert.equal(saturday.operationalDayIndex,5);
 assert.equal(tue.bankHolidayShifted,true);
 assert.equal(tue.recurringDateNeedsReview,true);
 assert.equal(tue.roundNumber+1,wed.roundNumber);
});
test("shifted recurring booking held to avoid anchoring all future cycles on a Tuesday",()=>{
 const result=resolveSqueegeeRoundJobGroup("2027-05-04",availableGroups,{recurring:true});
 assert.equal(result.status,"bank_holiday_recurrence_review");
 assert.equal(result.jobGroupId,null);
});
test("NI bank holiday exception: December 28 2026 stays on its ordinary Monday round",()=>{
 const d=roundForCleaningDate("2026-12-28");
 assert.equal(d.matched,true);
 assert.equal(d.roundNumber,11);
 assert.equal(d.bankHolidayShifted,false);
});
test("loads real group UUID from Squeegee by number only and never guesses",()=>{
 const group=resolveSqueegeeRoundJobGroup("2026-11-02",availableGroups,{recurring:true});
 assert.equal(group.status,"mapped");
 assert.equal(group.jobGroupId,GROUP11);
 assert.equal(group.roundNumber,11);
});
test("a missing round in Squeegee remains on hold",()=>{
 const group=resolveSqueegeeRoundJobGroup("2026-11-04",availableGroups);
 assert.equal(group.roundNumber,13);
 assert.equal(group.status,"round_missing_in_account");
 assert.equal(group.jobGroupId,null);
});
test("a duplicated round label remains on hold",()=>{
 const groups=[...availableGroups,{id:"55555555-5555-4555-8555-555555555555",description:"011"}];
 const first=resolveSqueegeeRoundJobGroup("2026-11-02",groups);
 assert.equal(first.status,"mapped");
 groups.push({id:"66666666-6666-4666-8666-666666666666",description:"11"});
 const duplicate=resolveSqueegeeRoundJobGroup("2026-11-02",groups);
 assert.equal(duplicate.status,"duplicate_round_labels");
});
test("malformed and missing group UUIDs cannot be assigned",()=>{
 const r=resolveSqueegeeRoundJobGroup("2026-11-02",[{description:"11",id:"invalid"}]);
 assert.equal(r.status,"invalid_account_group_id");
 assert.equal(r.jobGroupId,null);
});
test("parse zero-padded Squeegee codes and reject unrecognized descriptions",()=>{
 assert.equal(normalizedGroupNumber("01"),1);
 assert.equal(normalizedGroupNumber("11"),11);
 assert.equal(normalizedGroupNumber("20"),20);
 assert.equal(normalizedGroupNumber("21"),null);
 assert.equal(normalizedGroupNumber("Round 11"),null);
 assert.equal(normalizedGroupNumber("011"),null);
});
