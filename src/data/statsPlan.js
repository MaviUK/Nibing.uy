import { useEffect, useMemo, useState } from "react";

// Only actual completed physical-bin quantities from a verified Squeegee
// snapshot count as "Bins Cleaned". Never add scheduled rounds, estimated
// progress, job counts or animation increments.
import { CYCLE_SNAPSHOT, FOUR_WEEK_PLAN, OWNER_CONFIRMED_WEEK, getOwnerConfirmedWeekReconciliation } from "./cleaningCycleData.mjs";
import { OWNER_MONTHLY_PLAN, MONTHLY_CLEANING_TARGET } from "./ownerMonthlyPlan.mjs";
export { OWNER_MONTHLY_PLAN, MONTHLY_CLEANING_TARGET } from "./ownerMonthlyPlan.mjs";
export { CYCLE_SNAPSHOT, FOUR_WEEK_PLAN, OWNER_CONFIRMED_WEEK, getOwnerConfirmedWeekReconciliation };

export const STATS_BASE = {
  totalBinsCleaned: CYCLE_SNAPSHOT.completedBinsThroughBackup,
  // The new round is not yet in the 31 Oct Squeegee backup.
  monthlyCustomers: OWNER_MONTHLY_PLAN.monthlyCustomers,
};

const ANCHOR_MONDAY = new Date(CYCLE_SNAPSHOT.weekOneMonday + "T00:00:00Z");
const DAY_MAP = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weeksBetween(a,b) {
  const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  return Math.floor((day(b)-day(a))/(7*24*60*60*1000));
}
function getPlanForDate(date) {
  const dayKey=DAY_MAP[date.getDay()];
  if(dayKey==="Fri")return "Office Day";
  if(dayKey==="Sat"||dayKey==="Sun")return "Closed";
  const weekIndex=((weeksBetween(ANCHOR_MONDAY,date)%4)+4)%4;
  const plan=FOUR_WEEK_PLAN[weekIndex]?.[dayKey];
  return plan?.bins>0?plan.area:"No cleans scheduled";
}
export function useLiveCounters() {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{
    const timer=setInterval(()=>setNow(new Date()),60000);
    return ()=>clearInterval(timer);
  },[]);
  const todaysArea=useMemo(()=>getPlanForDate(now),[now]);
  return {
    totalBinsCleaned:CYCLE_SNAPSHOT.completedBinsThroughBackup,
    verifiedThrough:new Date(CYCLE_SNAPSHOT.backupDate+"T12:00:00Z").toLocaleDateString("en-GB",{
      day:"numeric",month:"short",year:"numeric",timeZone:"Europe/London"
    }),
    todaysArea,
    totalMonthlyCustomers:OWNER_MONTHLY_PLAN.monthlyCustomers,
    monthlyCleansTarget:MONTHLY_CLEANING_TARGET.monthlyCleans,
    weeklyCleaningTargets:MONTHLY_CLEANING_TARGET.weekly,
    weeklyAverageCleans:MONTHLY_CLEANING_TARGET.averageCleansPerWeek,
    dailyAverageCleans:MONTHLY_CLEANING_TARGET.averageCleansPerWorkday,
    monthlyRevenueTargetGBP:OWNER_MONTHLY_PLAN.monthlyRevenueTargetGBP,
    pricePerPaidCleanGBP:OWNER_MONTHLY_PLAN.pricePerPaidCleanGBP,
  };
}
