"use strict";
// Owner-approved, preview-only migration of an ALREADY verified per-job
// customer history. No Squeegee API calls, no guessed visits or payments.
// An old +2-per-streak event must match the original exact equation before
// it can be converted to +1; all cumulative fields are then re-verified.
const bin=require("./squeegeePreviewBinHistory");
const overdue=require("./squeegeeOverduePenalty");
const OLD=bin.PREVIOUS_VERSION;
const NEW=bin.VERSION;
const VERSION="2026-11-owner-recalculate-saved-plus1-v1";
function migrate(snapshot,{now=Date.now()}={}){
  if(snapshot?.version!==1||snapshot.scoringVersion!==OLD||
    snapshot.penaltySourceVersion!==overdue.VERSION||
    !bin.fresh(snapshot.asOf,now)||
    !Array.isArray(snapshot.accounts)||snapshot.accounts.length<1||
    snapshot.accounts.length>5000)
    throw Error("stored_plus1_migration_source_invalid");
  const converted=snapshot.accounts.map(account=>{
    if(!account||!Array.isArray(account.jobs)||account.jobs.length>200||
      !Array.isArray(account.events)||account.events.length>2500||
      !Number.isSafeInteger(account.currentStreak)||
      account.nextBonus!==20+2*account.currentStreak)
      throw Error("stored_plus1_migration_account_invalid");
    const oldJob=account.jobs.map(()=>0);
    const newJob=account.jobs.map(()=>0);
    let oldTotal=0,newTotal=0;
    const events=account.events.map(event=>{
      if(event?.event!=="paid_completed_clean")return event;
      const j=event.j,qty=event.quantity,streak=event.streak;
      if(!Number.isSafeInteger(j)||j<0||j>=account.jobs.length||
         !Number.isSafeInteger(qty)||qty<1||qty>20||
         !Number.isSafeInteger(streak)||streak<1||streak>2000)
        throw Error("stored_plus1_migration_event_invalid");
      const original=qty*(20+2*(streak-1));
      if(event.points!==original)
        throw Error("stored_plus1_migration_old_points_mismatch");
      const revised=qty*(20+(streak-1));
      oldTotal+=original;newTotal+=revised;
      oldJob[j]+=original;newJob[j]+=revised;
      return {...event,points:revised};
    });
    if(oldTotal!==account.points)
      throw Error("stored_plus1_migration_old_total_mismatch");
    const jobs=account.jobs.map((job,j)=>{
      if(job?.points!==oldJob[j]||!Number.isSafeInteger(job.currentStreak)||
         job.nextBonus!==20+2*job.currentStreak)
        throw Error("stored_plus1_migration_job_mismatch");
      return {...job,points:newJob[j],nextBonus:20+job.currentStreak};
    });
    return {...account,events,jobs,points:newTotal,
      nextBonus:20+account.currentStreak};
  });
  // The independent importer validator verifies every job's streak, event,
  // paid-bin quantity, skip, date, and points against the new equation.
  // This also refuses malformed account IDs, conflicting job IDs, etc.
  const checked=bin.validateBinSource({
    ...snapshot,scoringVersion:NEW,accounts:converted
  },{now});
  if(snapshot.summary?.activeAccounts!==undefined&&
     snapshot.summary.activeAccounts!==checked.summary.activeAccounts)
    throw Error("stored_plus1_migration_account_count_mismatch");
  if(snapshot.summary?.verifiedPaidBins!==undefined&&
     snapshot.summary.verifiedPaidBins!==checked.summary.verifiedPaidBins)
    throw Error("stored_plus1_migration_paid_bins_mismatch");
  if(snapshot.summary?.allHistoricalPoints!==undefined&&
     snapshot.summary.allHistoricalPoints!==snapshot.accounts.reduce(
       (sum,account)=>sum+account.points,0))
    throw Error("stored_plus1_migration_old_summary_mismatch");
  const prior=new Map(snapshot.accounts.map(a=>[a.id,a]));
  // Never discard the verified payment ledger or customer permissions.
  // The validator strips those private computed fields by design.
  const accounts=checked.accounts.map(account=>{
    const former=prior.get(account.id);
    const penaltyLedger=former?.penaltyLedger;
    if(!Array.isArray(penaltyLedger))
      throw Error("stored_plus1_migration_penalty_ledger_missing");
    const verified=overdue.reconcileLedger(
      penaltyLedger,[],snapshot.asOf,[],overdue.VERSION);
    if(overdue.penaltyTotal(verified)!==overdue.penaltyTotal(penaltyLedger))
      throw Error("stored_plus1_migration_penalty_ledger_mismatch");
    return {...account,penaltyLedger:verified,
      penaltyPoints:overdue.penaltyTotal(verified)};
  });
  const oldSummary=snapshot.summary||{};
  const summary={...oldSummary,...checked.summary,
    overduePenaltyPoints:accounts.reduce((t,a)=>t+a.penaltyPoints,0)};
  const change=Number(oldSummary.allHistoricalPoints)-Number(summary.allHistoricalPoints);
  if(!Number.isSafeInteger(change)||change<0)
    throw Error("stored_plus1_migration_score_difference_invalid");
  return {...snapshot,scoringVersion:NEW,accounts,summary,
    scoreMigration:{version:VERSION,previousScoringVersion:OLD,
      newScoringVersion:NEW,recalculatedAt:new Date(now).toISOString(),
      pointsReduced:change}};
}
module.exports={OLD,NEW,VERSION,migrate};
