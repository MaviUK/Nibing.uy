"use strict";
// Preview #77 only. Deterministic overdue XP charged per unpaid Squeegee
// cleaning occurrence, never per customer and never per physical-bin quantity.
// A verified zero/credit account balance supplies NO open occurrences.
// Without a fresh verified backup we do not assume a still-unpaid balance.
const VERSION="2026-11-escalating-overdue-per-job-v2";
const LEGACY_VERSION="2026-11-escalating-overdue-per-job-v1";
const DAY_MS=86400000;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
function dayNumber(date){
  if(typeof date!=="string"||!DAY.test(date))return null;
  const time=Date.parse(date+"T00:00:00Z");
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date
    ?time/DAY_MS:null;
}
function pointsThrough(dueOn,through){
  const start=dayNumber(dueOn),end=dayNumber(through);
  if(start===null||end===null||end<start||end-start>20000)
    throw Error("overdue_date_invalid");
  // Days 1-28: free. Day 29: -1, day 30: -2, etc.
  const days=Math.max(0,end-start-28);
  return days*(days+1)/2;
}
function reconcileLedger(previous=[],pending=[],asOf,settled=[]){
  if(dayNumber(asOf)===null||!Array.isArray(previous)||
     !Array.isArray(pending)||!Array.isArray(settled)||
     previous.length>2500||pending.length>2500||settled.length>2500)
    throw Error("overdue_evidence_invalid");
  const ledger=new Map();
  for(const row of previous){
    if(!row||typeof row.id!=="string"||row.id.length>150||
       ledger.has(row.id)||dayNumber(row.dueOn)===null||
       dayNumber(row.until)===null||row.until>asOf||
       !Number.isSafeInteger(row.points)||
       row.points!==pointsThrough(row.dueOn,row.until)||
       (row.settledOn!==undefined&&(dayNumber(row.settledOn)===null||
          row.settledOn>asOf)))
      throw Error("overdue_previous_ledger_invalid");
    ledger.set(row.id,{id:row.id,dueOn:row.dueOn,
      until:row.until,points:row.points,
      ...(Number.isSafeInteger(row.j)?{j:row.j}:{}),
      ...(row.settledOn?{settledOn:row.settledOn}:{})});
  }
  const ids=new Set();
  for(const row of settled){
    if(!row||typeof row.id!=="string"||!row.id||row.id.length>150||
       dayNumber(row.dueOn)===null||dayNumber(row.paidOn)===null||
       row.dueOn>asOf||row.paidOn>asOf||row.paidOn<row.dueOn||
       ids.has(row.id))
      throw Error("overdue_settled_job_invalid");
    ids.add(row.id);
    const earlier=ledger.get(row.id);
    if(earlier&&earlier.dueOn!==row.dueOn)
      throw Error("overdue_occurrence_due_date_changed");
    const points=pointsThrough(row.dueOn,row.paidOn);
    if(points<=0)throw Error("overdue_settled_job_not_late");
    // The source has this occurrence's actual Squeegee paidDate. It
    // supersedes a previous snapshot's provisional accrual. No repeated
    // subtraction or extra deductions after the verified settlement day.
    ledger.set(row.id,{id:row.id,dueOn:row.dueOn,until:row.paidOn,
      settledOn:row.paidOn,points,
      ...(Number.isSafeInteger(row.j)?{j:row.j}:
        Number.isSafeInteger(earlier?.j)?{j:earlier.j}:{})});
  }
  const seen=new Set();
  for(const row of pending){
    if(!row||typeof row.id!=="string"||!row.id||row.id.length>150||
       dayNumber(row.dueOn)===null||row.dueOn>asOf||
       seen.has(row.id)||ids.has(row.id))
      throw Error("overdue_pending_job_invalid");
    seen.add(row.id);
    const older=ledger.get(row.id);
    if(older&&older.dueOn!==row.dueOn)
      throw Error("overdue_occurrence_due_date_changed");
    if(older?.settledOn)
      throw Error("overdue_settled_job_reopened");
    const points=pointsThrough(row.dueOn,asOf);
    if(older&&points<older.points)
      throw Error("overdue_penalty_would_decrease");
    ledger.set(row.id,{id:row.id,dueOn:row.dueOn,until:asOf,points,
      ...(Number.isSafeInteger(row.j)?{j:row.j}:
        Number.isSafeInteger(older?.j)?{j:older.j}:{})});
  }
  return [...ledger.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function penaltyTotal(ledger){
  if(!Array.isArray(ledger))return 0;
  return ledger.reduce((sum,row)=>sum+row.points,0);
}
function penaltyForYear(ledger,year){
  if(!Number.isSafeInteger(year)||year<2000||year>2100||
     !Array.isArray(ledger))return 0;
  const start=(year-1)+"-12-31",end=year+"-12-31";
  return ledger.reduce((sum,row)=>{
    if(!row||!row.dueOn||!row.until)return sum;
    const throughEnd=row.until<end?row.until:end;
    if(throughEnd<row.dueOn)return sum;
    const throughStart=row.until<start?row.until:start;
    const before=throughStart<row.dueOn?0:pointsThrough(row.dueOn,throughStart);
    return sum+pointsThrough(row.dueOn,throughEnd)-before;
  },0);
}
// Display-year values never go below zero. Apply deductions against newest
// earned XP first, carrying any excess into earlier years. Thus the sum of
// visible year scores always equals max(0, lifetime gross XP - lifetime loss).
function netByYear(gross,penalties){
  if(!(gross instanceof Map)||!Number.isSafeInteger(penalties)||penalties<0)
    throw Error("overdue_yearly_scores_invalid");
  let loss=penalties;
  const net=new Map();
  for(const year of [...gross.keys()].sort((a,b)=>b-a)){
    const points=gross.get(year);
    if(!Number.isSafeInteger(points)||points<0)
      throw Error("overdue_yearly_gross_invalid");
    const charged=Math.min(points,loss);
    net.set(year,points-charged);
    loss-=charged;
  }
  return net;
}
module.exports={VERSION,LEGACY_VERSION,dayNumber,pointsThrough,reconcileLedger,
  penaltyTotal,penaltyForYear,netByYear};
