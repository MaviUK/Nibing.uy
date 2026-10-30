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

test("owner-confirmed Monday 2 November 2026 is Week 3 Round 11",()=>{
 const d=roundForCleaningDate("2026-11-02");
 assert.equal(d.matched,true);
 assert.equal(d.roundNumber,11);
 assert.equal(d.weekNumber,3);
 assert.equal(d.operationalDayIndex,1);
 assert.equal(d.weekdayMappingVerified,true);
 assert.equal(d.bankHolidayShifted,false);
});
test("Week 3 weekday sequence remains a hypothesis, not an assignable job group",()=>{
 for(const [day,candidate] of [
  ["2026-11-03",12],["2026-11-04",13],["2026-11-05",14],["2026-11-06",15]
 ]) {
  const d=roundForCleaningDate(day);
  assert.equal(d.candidateRoundNumber,candidate,day);
  assert.equal(d.roundNumber,null,day);
  assert.equal(d.weekdayMappingVerified,false,day);
  const mapped=resolveSqueegeeRoundJobGroup(day,[
    {id:GROUP12,description:String(candidate).padStart(2,"0")},
  ]);
  assert.equal(mapped.status,"weekday_mapping_unverified",day);
  assert.equal(mapped.jobGroupId,null,day);
 }
});
test("four-week rotation is confirmed even where daily group assignment is not",()=>{
 for(const [day,week,candidate] of [
  ["2026-10-19",1,1],["2026-10-26",2,6],
  ["2026-11-02",3,11],["2026-11-09",4,16],
  ["2026-11-16",1,1],["2026-11-23",2,6],
  ["2026-11-30",3,11]
 ]) {
  const d=roundForCleaningDate(day);
  assert.equal(d.weekNumber,week,day);
  assert.equal(d.candidateRoundNumber,candidate,day);
  assert.equal(d.roundNumber,week===3?11:null,day);
 }
});
test("previously missing 06 and 07 are not incorrectly reported as confirmed Friday rounds",()=>{
 for(const date of ["2026-11-23","2026-11-24"]){
  const proposed=roundForCleaningDate(date);
  assert.ok([6,7].includes(proposed.candidateRoundNumber));
  assert.equal(proposed.roundNumber,null);
  assert.equal(resolveSqueegeeRoundJobGroup(date,availableGroups).status,"weekday_mapping_unverified");
 }
});
test("anchor Monday Round 11 repeats every 28 days",()=>{
 for(const date of ["2026-11-02","2026-11-30","2026-12-28","2027-01-25"]){
  const result=roundForCleaningDate(date);
  assert.equal(result.roundNumber,11,date);
  assert.equal(result.weekNumber,3,date);
 }
});
test("invalid or pre-anchor dates and ordinary weekends never pick a round",()=>{
 for(const date of ["2026-09-21","not-a-date","2026-11-07","2026-11-08","2026-02-30"]){
  assert.equal(roundForCleaningDate(date).matched,false,date);
 }
});
test("bank holiday Tuesday represents Monday's shifted operational day but is held",()=>{
 const mayMonday=new Date("2027-05-03T12:00:00Z");
 assert.equal(isNorthernIrelandMondayShift(mayMonday),true);
 assert.equal(roundForCleaningDate("2027-05-03").matched,false);
 const tue=roundForCleaningDate("2027-05-04");
 const wed=roundForCleaningDate("2027-05-05");
 const sat=roundForCleaningDate("2027-05-08");
 assert.equal(tue.matched,true);
 assert.equal(tue.operationalDayIndex,1);
 assert.equal(wed.operationalDayIndex,2);
 assert.equal(sat.operationalDayIndex,5);
 assert.equal(tue.bankHolidayShifted,true);
 assert.equal(tue.recurringDateNeedsReview,true);
 assert.equal(tue.roundNumber,null);
 assert.equal(tue.candidateRoundNumber+1,wed.candidateRoundNumber);
});
test("shifted recurring booking stays on hold to prevent wrong future weekday",()=>{
 const result=resolveSqueegeeRoundJobGroup("2027-05-04",availableGroups,{recurring:true});
 assert.equal(result.status,"bank_holiday_recurrence_review");
 assert.equal(result.jobGroupId,null);
});
test("Christmas/Boxing substitute Monday remains normal under existing site rule",()=>{
 const result=roundForCleaningDate("2026-12-28");
 assert.equal(result.matched,true);
 assert.equal(result.roundNumber,11);
 assert.equal(result.bankHolidayShifted,false);
});
test("verified Round 11 can be resolved to its real Squeegee UUID",()=>{
 const result=resolveSqueegeeRoundJobGroup("2026-11-02",availableGroups,{recurring:true});
 assert.equal(result.status,"mapped");
 assert.equal(result.jobGroupId,GROUP11);
 assert.equal(result.roundNumber,11);
});
test("missing verified Round 11 is held rather than silently created",()=>{
 const result=resolveSqueegeeRoundJobGroup("2026-11-02",availableGroups.filter(g=>g.description!=="11"));
 assert.equal(result.status,"round_missing_in_account");
 assert.equal(result.jobGroupId,null);
});
test("duplicated verified group labels are blocked",()=>{
 const groups=[...availableGroups,{id:"66666666-6666-4666-8666-666666666666",description:"11"}];
 const result=resolveSqueegeeRoundJobGroup("2026-11-02",groups);
 assert.equal(result.status,"duplicate_round_labels");
});
test("invalid verified group UUID is blocked",()=>{
 const result=resolveSqueegeeRoundJobGroup("2026-11-02",[{description:"11",id:"wrong"}]);
 assert.equal(result.status,"invalid_account_group_id");
 assert.equal(result.jobGroupId,null);
});
test("zero-padded labels only, no fabricated group aliases",()=>{
 assert.equal(normalizedGroupNumber("01"),1);
 assert.equal(normalizedGroupNumber("11"),11);
 assert.equal(normalizedGroupNumber("20"),20);
 assert.equal(normalizedGroupNumber("21"),null);
 assert.equal(normalizedGroupNumber("Round 11"),null);
 assert.equal(normalizedGroupNumber("011"),null);
});
