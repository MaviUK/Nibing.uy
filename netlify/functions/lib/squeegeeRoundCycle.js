"use strict";

/**
 * NI Bin Guy's confirmed 20-round, four-week rota.
 *
 * Owner confirmed: Monday 2026-11-02 = Round 11 (Week 3).
 * Assumed ordering (subject to test-record approval): consecutive round
 * numbers are Monday-Friday within each week.
 *
 * Website rule: on an NI Monday bank holiday, Monday-Friday's work moves to
 * Tuesday-Saturday. Christmas/Boxing Day substitute Mondays are intentionally
 * not shifts: this mirrors bookingSchedule.js's existing local collection rule.
 *
 * This is mapping logic only. No Squeegee customer/job creation occurs here.
 */
const { validDate } = require("./squeegeeBookingPlan");
const { requireUuid } = require("./squeegeeApiV3");

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_ANCHOR_MONDAY = "2026-11-02";
const FIRST_CONFIRMED_WEEK_MONDAY = "2026-10-19";
const ANCHOR_WEEK_INDEX = 2; // Zero-based Week 3
const WEEK_GROUPS = Object.freeze([
  [1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10],
  [11, 12, 13, 14, 15],
  [16, 17, 18, 19, 20],
]);

function utcDate(isoDate) {
  return new Date(isoDate + "T12:00:00Z");
}
function asIso(date) {
  return date.toISOString().slice(0, 10);
}
function mondayOfWeek(date) {
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * DAY_MS);
}
function normalizedMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
function easterSundayUtc(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),
        e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
        h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
        l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
        month=Math.floor((h+l-7*m+114)/31),
        day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day,12));
}
function nthWeekdayUtc(year,month,weekday,n) {
  const first = new Date(Date.UTC(year,month,1,12));
  const offset = (weekday-first.getUTCDay()+7)%7;
  return new Date(Date.UTC(year,month,1+offset+(n-1)*7,12));
}
function lastWeekdayUtc(year,month,weekday) {
  const last = new Date(Date.UTC(year,month+1,0,12));
  const offset = (last.getUTCDay()-weekday+7)%7;
  return new Date(Date.UTC(year,month,last.getUTCDate()-offset,12));
}
function observedFixedUtc(year,month,day) {
  const date = new Date(Date.UTC(year,month,day,12));
  const weekday = date.getUTCDay();
  if (weekday===6) return new Date(date.getTime()+2*DAY_MS);
  if (weekday===0) return new Date(date.getTime()+DAY_MS);
  return date;
}
function isNorthernIrelandMondayShift(monday) {
  if (monday.getUTCDay() !== 1) return false;
  const year=monday.getUTCFullYear(),key=asIso(monday);
  const candidates=[
    observedFixedUtc(year,0,1),
    observedFixedUtc(year,2,17),
    new Date(easterSundayUtc(year).getTime()+DAY_MS),
    nthWeekdayUtc(year,4,1,1),
    lastWeekdayUtc(year,4,1),
    observedFixedUtc(year,6,12),
    lastWeekdayUtc(year,7,1),
  ];
  // Intentionally does NOT move the week for Christmas/Boxing Day substitute
  // Mondays, matching the existing bookingSchedule.js business exception.
  return candidates.some(date => date.getUTCDay()===1 && asIso(date)===key);
}
function roundForCleaningDate(dateString) {
  if (!validDate(dateString)) {
    return { matched:false, reason:"invalid_clean_date" };
  }
  const date=utcDate(dateString);
  const monday=mondayOfWeek(date);
  const weekMonday=asIso(monday);
  if (weekMonday < FIRST_CONFIRMED_WEEK_MONDAY) {
    return { matched:false, reason:"before_confirmed_round_cycle" };
  }
  const shifted=isNorthernIrelandMondayShift(monday);
  const actualWeekday=date.getUTCDay(); // 1 Monday ... 6 Saturday
  const operationalDayIndex=shifted ? actualWeekday-1 : actualWeekday;
  if (operationalDayIndex<1 || operationalDayIndex>5 ||
      (!shifted && actualWeekday===6)) {
    return { matched:false, reason:shifted?"outside_shifted_cleaning_week":"outside_normal_cleaning_week" };
  }
  const weeksFromAnchor=Math.round((monday.getTime()-utcDate(CYCLE_ANCHOR_MONDAY).getTime())/(7*DAY_MS));
  const weekIndex=normalizedMod(ANCHOR_WEEK_INDEX+weeksFromAnchor,4);
  const roundNumber=WEEK_GROUPS[weekIndex][operationalDayIndex-1];
  return {
    matched:true,
    date:dateString,
    weekMonday,
    weekNumber:weekIndex+1,
    operationalDayIndex,
    roundNumber,
    roundLabel:String(roundNumber).padStart(2,"0"),
    bankHolidayShifted:shifted,
    // A four-weekly recurrence anchored to a shifted Tuesday/Saturday can
    // carry the WRONG day into a normal non-bank-holiday week.
    recurringDateNeedsReview:shifted,
    source:"owner_confirmed_four_week_cycle_2026_11_02",
  };
}

function normalizedGroupNumber(description) {
  const raw=String(description ?? "").trim();
  if (!/^\d{1,2}$/.test(raw)) return null;
  const value=Number(raw);
  return Number.isInteger(value) && value>=1 && value<=20 ? value : null;
}

function resolveSqueegeeRoundJobGroup(dateString, accountGroups, { recurring=false }={}) {
  const rotation=roundForCleaningDate(dateString);
  if (!rotation.matched) return {...rotation,status:"requires_review",jobGroupId:null};
  if (recurring && rotation.recurringDateNeedsReview) {
    return {...rotation,status:"bank_holiday_recurrence_review",jobGroupId:null};
  }
  if (!Array.isArray(accountGroups)) {
    return {...rotation,status:"job_groups_not_loaded",jobGroupId:null};
  }
  const candidates=accountGroups.filter(group =>
    normalizedGroupNumber(group?.description)===rotation.roundNumber);
  if (candidates.length!==1) {
    return {...rotation,status:candidates.length?"duplicate_round_labels":"round_missing_in_account",jobGroupId:null};
  }
  try {
    return {...rotation,status:"mapped",jobGroupId:requireUuid(candidates[0].id,"jobGroupId")};
  } catch {
    return {...rotation,status:"invalid_account_group_id",jobGroupId:null};
  }
}
module.exports={
  CYCLE_ANCHOR_MONDAY,
  FIRST_CONFIRMED_WEEK_MONDAY,
  WEEK_GROUPS,
  isNorthernIrelandMondayShift,
  roundForCleaningDate,
  normalizedGroupNumber,
  resolveSqueegeeRoundJobGroup,
};
