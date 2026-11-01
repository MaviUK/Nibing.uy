"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  canonicalLegacyRef,normalizeActiveImport,eligibleHistoricalEntries,
  combinedPublicBoard,snapshotIsFresh
}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const A="12345678-1111-4111-8111-123456789abc";
const B="abcdefab-2222-4222-8222-abcdefabcdef";
const C="11111111-3333-4333-8333-111111111111";
const headers=[
  "squeegee_customer_uuid_PRIVATE","squeegee_customer_reference_PRIVATE",
  "public_customer_reference","town","town_evidence",
  "squeegee_state_PRIVATE","deleted_in_backup_PRIVATE",
  "verified_paid_clean_points","cleans_held_for_review",
  "first_paid_clean","last_paid_clean","public_eligibility"
].join(",");
const row=(id,town,points,state="active",deleted="0")=>[
  id,"SQUEEGEE-PRIVATE-REF",canonicalLegacyRef(id),town,"explicit_postal_town",
  state,deleted,points,0,"2026-10-01","2026-10-31",
  points===0?"no_verified_paid_history":
  town==="Town unavailable"?"needs_town_review":"eligible_pending_notice_and_consent"
].join(",");
const CSV=[headers,row(A,"Bangor",91),row(B,"Newtownards",25),
  row(C,"Town unavailable",8)].join("\r\n")+"\r\n";
const opts={asOf:"2026-10-31",now:Date.parse("2026-11-01T02:00:00Z")};

test("historic active-only import preserves UUID mapping privately, excludes unknown town",()=>{
  const state=normalizeActiveImport(CSV,opts);
  assert.deepEqual(state.summary,{
    activeAccounts:3,publishedCandidates:2,heldTown:1,zeroPoints:0,
    historicalPaidPoints:116,
  });
  assert.equal(state.published,false);
  assert.equal(eligibleHistoricalEntries(state).length,2);
  const board=combinedPublicBoard(state);
  assert.equal(board.totalPlayers,2);
  assert.equal(board.entries[0].points,91);
  assert.equal(board.entries[0].town,"Bangor");
  assert.deepEqual(Object.keys(board.entries[0]).sort(),[
    "rank","customerRef","town","points"].sort());
  assert.ok(!JSON.stringify(board).includes(A));
  assert.ok(!JSON.stringify(board).includes("SQUEEGEE-PRIVATE-REF"));
  assert.equal(normalizeActiveImport(CSV,opts).sourceHash,state.sourceHash);
  assert.equal(snapshotIsFresh(state,Date.parse("2026-11-01T03:00:00Z")),true);
  assert.equal(snapshotIsFresh(state,Date.parse("2026-11-15T03:00:00Z")),false);
});

test("only a single verified Squeegee UUID link can add website XP once",()=>{
  const state=normalizeActiveImport(CSV,opts);
  const scores=new Map([[A,550],[B,100]]);
  const board=combinedPublicBoard(state,scores);
  assert.equal(board.entries[0].points,641);
  assert.equal(board.entries[1].points,125);
  assert.equal(board.totalPlayers,2);
  assert.equal(combinedPublicBoard(state,scores).entries[0].points,641);
});

test("inactive and deleted customers are rejected, not silently published",()=>{
  assert.throws(()=>normalizeActiveImport([headers,row(A,"Bangor",3,"inactive")].join("\n"),opts),
    /inactive_or_invalid_account_row/);
  assert.throws(()=>normalizeActiveImport([headers,row(A,"Bangor",3,"active","1")].join("\n"),opts),
    /inactive_or_invalid_account_row/);
  assert.throws(()=>normalizeActiveImport([headers,row(A,"Bangor",3),row(A,"Bangor",3)].join("\n"),opts),
    /duplicate_account/);
});

test("tampered pseudonym, unknown schema, future source date fail closed",()=>{
  assert.throws(()=>normalizeActiveImport([headers,row(A,"Bangor",3).replace(canonicalLegacyRef(A),"NBG-1234567890")].join("\n"),opts),
    /inactive_or_invalid_account_row/);
  assert.throws(()=>normalizeActiveImport("customerRef,town,points\nNBG-1234567890,Bangor,2",opts),
    /csv_missing_or_duplicate_columns/);
  assert.throws(()=>normalizeActiveImport(CSV,{...opts,asOf:"2026-11-12"}),/invalid_source_date/);
  assert.throws(()=>normalizeActiveImport(CSV,{...opts,asOf:"2026-99-99"}));
  assert.throws(()=>normalizeActiveImport([headers,row(A,"Bangor",3),row(A,"Bangor",3)].join("\n"),opts),
    /duplicate_account/);
});

test("quoted Squeegee references remain private and parser supports RFC CSV quotes",()=>{
  const csv=headers+"\n"+
    [A,'"SQUEEGEE, REF ""PRIVATE"""',canonicalLegacyRef(A),"Bangor","explicit_postal_town","active","0","4","0","2026-10-01","2026-10-31","eligible_pending_notice_and_consent"].join(",")+"\n";
  const state=normalizeActiveImport(csv,opts);
  assert.equal(state.summary.historicalPaidPoints,4);
  assert.ok(!JSON.stringify(combinedPublicBoard(state)).includes("PRIVATE"));
});
