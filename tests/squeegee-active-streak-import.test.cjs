"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {RULE_VERSION}=require("../netlify/functions/lib/squeegeeCleaningStreak");
const {canonicalLegacyRef,normalizeActiveImport,combinedPublicBoard,
  eligibleHistoricalEntries}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const C="12345678-1111-4111-8111-123456789abc";
const D="abcdefab-2222-4222-8222-abcdefabcdef";
const fields=[
  "squeegee_customer_uuid_PRIVATE", "squeegee_customer_reference_PRIVATE",
  "public_customer_reference","town","squeegee_state_PRIVATE",
  "deleted_in_backup_PRIVATE","verified_paid_clean_points","public_eligibility",
  "streak_points","current_consecutive_clean_visits",
  "next_completed_visit_bonus","recorded_skipped_visits",
  "max_consecutive_clean_visits","scoring_version"
];
function record(id,town,paid,streakPoints,streak,next,skips=0,state="active") {
  const eligibility=paid===0?"no_verified_paid_history":
    town==="Town unavailable"?"needs_town_review":"eligible_pending_notice_and_consent";
  return [id,"PRIVATE-REF",canonicalLegacyRef(id),town,state,"0",paid,eligibility,
    streakPoints,streak,next,skips,Math.max(streak,4),RULE_VERSION].join(",");
}
const opts={asOf:"2026-10-31",now:Date.parse("2026-11-01T02:00:00Z")};
const source=fields.join(",")+"\n"+
  record(C,"Bangor",5,108,2,24,1)+"\n"+
  record(D,"Newtownards",3,66,3,26)+"\n";

test("version-2 import scores 20,22,24 and resets after recorded Squeegee skips",()=>{
  const snapshot=normalizeActiveImport(source,opts);
  assert.equal(snapshot.version,2);
  assert.equal(snapshot.scoringVersion,RULE_VERSION);
  assert.equal(snapshot.summary.paidCleanCount,8);
  assert.equal(snapshot.summary.historicalPaidPoints,174);
  assert.equal(snapshot.summary.publishedCandidates,2);
  assert.equal(eligibleHistoricalEntries(snapshot).length,2);
  assert.equal(snapshot.accounts.find(x=>x.id===C).historicalPoints,108);
  assert.equal(snapshot.accounts.find(x=>x.id===C).recordedSkippedVisits,1);
  assert.equal(combinedPublicBoard(snapshot).entries[0].points,108);
  assert.equal(combinedPublicBoard(snapshot,new Map([[C,550]])).entries[0].points,658);
  assert.equal(combinedPublicBoard(snapshot,new Map([[C,550]])).totalPlayers,2);
  assert.ok(!JSON.stringify(combinedPublicBoard(snapshot)).includes(C));
});

test("old one-point files remain readable but cannot pretend to be v2",()=>{
  const withoutStreakFields=fields.slice(0,8).join(",")+"\n"+
    [C,"PRIVATE",canonicalLegacyRef(C),"Bangor","active","0","1",
      "eligible_pending_notice_and_consent"].join(",")+"\n";
  const legacy=normalizeActiveImport(withoutStreakFields,opts);
  assert.equal(legacy.version,1);
  assert.equal(legacy.scoringVersion,"legacy-one-point-per-clean");
  assert.equal(legacy.summary.historicalPaidPoints,1);
});

test("reject any missing or tampered streak columns, points or account status",()=>{
  assert.throws(()=>normalizeActiveImport(source.replace("streak_points,",""),opts),
    /csv_invalid_row|incomplete_streak_scoring_columns/);
  assert.throws(()=>normalizeActiveImport(source.replace(",108,2,24,1,",",4,2,24,1,"),opts),
    /invalid_streak_scoring_values/);
  assert.throws(()=>normalizeActiveImport(source.replace(",2,24,1,",",2,28,1,"),opts),
    /invalid_streak_scoring_values/);
  assert.throws(()=>normalizeActiveImport(source.replace(",active,0,5,",",inactive,0,5,"),opts),
    /inactive_or_invalid_account_row/);
  assert.throws(()=>normalizeActiveImport(source.replace(RULE_VERSION,"mystery_version"),opts),
    /streak_scoring_version_invalid/);
});
