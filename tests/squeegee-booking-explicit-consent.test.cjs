"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const consent=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const id="123e4567-e89b-42d3-a456-426614174000";
const booking={bookingId:"NBG-ABCDEFGH",leaderboardConsent:true,
  leaderboardConsentNotice:consent.NOTICE_VERSION};
const row={alias:canonicalLegacyRef(id),ref:"12345",firstName:"Alex",
  town:"Bangor",consent:"pending",withdrawnAt:null};
const snapshot=record=>({version:1,records:[record]});
test("verified booking opt-in grants existing consent record",()=>{
  const result=consent.grantVerifiedBookingConsent(snapshot(row),
    {squeegeeId:id,booking,linked:true});
  assert.equal(result.changed,true);
  assert.equal(result.snapshot.records[0].method,"signed_form");
  assert.equal(result.snapshot.records[0].evidenceRef,"booking:NBG-ABCDEFGH");
});
test("withdrawal cannot be overridden by new booking",()=>{
  const result=consent.grantVerifiedBookingConsent(snapshot({...row,
    consent:"withdrawn",withdrawnAt:"2026-11-01T00:00:00Z"}),
    {squeegeeId:id,booking,linked:true});
  assert.equal(result.changed,false);
  assert.equal(result.reason,"withdrawal_protected");
});
test("unlinked, unchecked, and unknown customer never grant",()=>{
  for(const args of [
    {squeegeeId:id,booking,linked:false},
    {squeegeeId:id,booking:{...booking,leaderboardConsent:false},linked:true},
    {squeegeeId:"123e4567-e89b-42d3-a456-426614174001",booking,linked:true},
  ])assert.equal(consent.grantVerifiedBookingConsent(snapshot(row),args).changed,false);
});
