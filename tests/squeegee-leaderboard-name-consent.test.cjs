"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const engine=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const snapshotSource=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");
const alias=snapshotSource.ENTRIES[0][0];
const town=snapshotSource.ENTRIES[0][1];
const points=snapshotSource.ENTRIES[0][2];
const consentSnapshot=()=>({
  version:1,sourceAsOf:snapshotSource.AS_OF,
  records:[{alias,ref:"CUS123456",firstName:"Alex",town,
    quality:"ready_for_consent",consent:"pending",
    consentAt:null,withdrawnAt:null,noticeVersion:null,method:null,evidenceRef:null}]
});
const fullBoard={entries:[{rank:1,customerRef:alias,town,points}],
  totalPlayers:941,sourceAsOf:snapshotSource.AS_OF,status:"squeegee_active_only"};
const when=Date.parse("2026-11-01T12:00:00Z");

test("pending customer cannot appear publicly, despite a valid first name",()=>{
  const result=engine.publicConsentBoard(consentSnapshot(),fullBoard,new Set([alias]));
  assert.equal(result.totalPlayers,0);
  assert.equal(result.status,"consent_pending");
  assert.deepEqual(result.entries,[]);
  assert.ok(!JSON.stringify(result).includes("Alex"));
});
test("verified evidence permits ONLY first name, town and XP, no Squeegee reference",()=>{
  const granted=engine.changeConsent(consentSnapshot(),{
    action:"grant",reference:"CUS123456",method:"email_reply",
    evidenceRef:"reply-thread-verified-001",confirm:"yes"
  },when);
  assert.equal(granted.records[0].consent,"granted");
  assert.equal(granted.records[0].consentAt,"2026-11-01T12:00:00.000Z");
  assert.equal(granted.records[0].noticeVersion,engine.NOTICE_VERSION);
  const result=engine.publicConsentBoard(granted,fullBoard,new Set([alias]));
  assert.equal(result.status,"consent_only");
  assert.equal(result.totalPlayers,1);
  assert.equal(result.entries[0].displayName,"Alex");
  assert.equal(result.entries[0].town,town);
  assert.equal(result.entries[0].points,points);
  assert.equal(result.entries[0].customerRef,alias);
  assert.ok(!JSON.stringify(result).includes("CUS123456"));
  assert.ok(!JSON.stringify(result).includes("reply-thread"));
});
test("consent is explicit, granular and unsupported evidence does not count",()=>{
  for(const changes of [
    {action:"grant",reference:"CUS123456",method:"email_reply",evidenceRef:"thread1",confirm:""},
    {action:"grant",reference:"CUS123456",method:"email_reply",evidenceRef:"",confirm:"yes"},
    {action:"grant",reference:"CUS123456",method:"magical_default",evidenceRef:"thread1",confirm:"yes"}
  ])assert.throws(()=>engine.changeConsent(consentSnapshot(),changes,when),/consent_proof_required/);
});
test("withdrawal immediately removes public name, retains private points",()=>{
  const granted=engine.changeConsent(consentSnapshot(),{
    action:"grant",reference:"CUS123456",method:"signed_form",
    evidenceRef:"paper-consent-2",confirm:"yes"
  },when);
  const revoked=engine.changeConsent(granted,{
    action:"withdraw",reference:"CUS123456"
  },when+1000);
  assert.equal(revoked.records[0].consent,"withdrawn");
  assert.equal(revoked.records[0].firstName,"Alex");
  assert.equal(engine.publicConsentBoard(revoked,fullBoard,new Set([alias])).entries.length,0);
  assert.equal(engine.publicConsentBoard(revoked,fullBoard,new Set([alias])).totalPlayers,0);
  assert.equal(fullBoard.entries[0].points,points);
});
test("first name, identity, town and account status must match trusted source",()=>{
  assert.equal(engine.safeFirstName("Mary-Jane"),"Mary-Jane");
  assert.equal(engine.safeFirstName("Eimear"),"Eimear");
  assert.equal(engine.safeFirstName("<img onerror=x>"),null);
  assert.equal(engine.safeFirstName("Full Address"),null);
  assert.equal(engine.safeFirstName("Test123"),null);
  const granted=engine.changeConsent(consentSnapshot(),{
    action:"grant",reference:"CUS123456",method:"recorded_call",
    evidenceRef:"call-log-20261101",confirm:"yes"
  },when);
  assert.equal(engine.publicConsentBoard(granted,{
    ...fullBoard,entries:[{...fullBoard.entries[0],town:"Different Town"}]
  },new Set([alias])).entries.length,0);
  assert.equal(engine.publicConsentBoard(granted,{
    ...fullBoard,status:"active_status_refresh_required",
    entries:[]
  },new Set([alias])).entries.length,0);
  assert.throws(()=>engine.preparePrivateConsentImport("anything"),/invalid_private_consent_csv|unexpected_private_customer_count/);
});

test("a customer without a verified registered email is NEVER counted, even with consent",()=>{
  const granted=engine.changeConsent(consentSnapshot(),{
    action:"grant",reference:"CUS123456",method:"signed_form",
    evidenceRef:"permission-2026-11-01",confirm:"yes"
  },when);
  const disqualified=engine.publicConsentBoard(granted,fullBoard,new Set());
  assert.equal(disqualified.totalPlayers,0);
  assert.deepEqual(disqualified.entries,[]);
  assert.equal(disqualified.status,"consent_pending");
  assert.equal(engine.publicConsentBoard(granted,fullBoard),null);
  assert.throws(()=>engine.changeConsent(consentSnapshot(),{
    action:"grant",reference:"CUS123456",method:"signed_form",
    evidenceRef:"permission-2026-11-01",confirm:"yes"
  },when,new Set()),/email_required_for_leaderboard/);
  assert.equal(granted.records[0].consent,"granted");
  // The private points remain untouched; eligibility is not deletion.
  assert.equal(fullBoard.entries[0].points,points);
});
