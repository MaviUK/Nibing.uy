"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const pub=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const staticHistory=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");

const secret=crypto.randomBytes(32);
const ids=["NBG-0000000001","NBG-0000000002","NBG-0000000003"];
const emails=new Set(ids.slice(0,2)); // Third customer has no valid email.
const data={
  status:"squeegee_active_only",
  sourceAsOf:staticHistory.AS_OF,
  lastUpdatedAt:staticHistory.AS_OF+"T23:59:59Z",
  totalPlayers:3,
  entries:[
    {customerRef:ids[0],town:"Bangor",points:44},
    {customerRef:ids[1],town:"Newtownards",points:22},
    {customerRef:ids[2],town:"Holywood",points:20},
  ],
};
const pending=()=>({version:1,sourceAsOf:staticHistory.AS_OF,
  records:[
    {alias:ids[0],firstName:"Sarah",town:"Bangor",consent:"pending"},
    {alias:ids[1],firstName:"John",town:"Newtownards",consent:"pending"},
    {alias:ids[2],firstName:"Paul",town:"Holywood",consent:"pending"},
  ]});
const approve=record=>({
  ...record,consent:"granted",consentAt:"2026-11-01T12:00:00Z",
  method:"email_reply",evidenceRef:"evidence-registered",
  withdrawnAt:null,noticeVersion:pub.NOTICE_VERSION,
});

test("scores are public without account login; no email means excluded",()=>{
  const result=pub.publicEligibleScoreboard(pending(),data,emails,secret);
  assert.equal(result.status,"public_eligible_scores");
  assert.equal(result.totalPlayers,2);
  assert.equal(result.approvedCount,0);
  assert.deepEqual(result.entries.map(x=>x.points),[44,22]);
  assert.ok(result.entries.every(x=>x.anonymous===true));
  assert.ok(result.entries.every(x=>x.town==="Town unavailable"));
  assert.ok(result.entries.every(x=>/^NBG-[A-F0-9]{10}$/.test(x.customerRef)));
  const serialized=JSON.stringify(result);
  for(const sensitive of ["Sarah","John","Paul","Bangor","Newtownards","Holywood",
    "NBG-0000000001","NBG-0000000002"])
    assert.ok(!serialized.includes(sensitive),"Unexpected identity disclosure: "+sensitive);
});
test("public first name + town appear only when permission can be proven",()=>{
  const ledger=pending();
  ledger.records[0]=approve(ledger.records[0]);
  const result=pub.publicEligibleScoreboard(ledger,data,emails,secret);
  assert.equal(result.totalPlayers,2);
  assert.equal(result.approvedCount,1);
  assert.equal(result.entries[0].displayName,"Sarah");
  assert.equal(result.entries[0].town,"Bangor");
  assert.equal(result.entries[1].anonymous,true);
  assert.ok(!JSON.stringify(result).includes("John"));
  assert.ok(!JSON.stringify(result).includes("Newtownards"));
});
test("a withdrawal removes the publicly visible row entirely, not only its name",()=>{
  const ledger=pending();
  ledger.records[0]=approve(ledger.records[0]);
  ledger.records[0].consent="withdrawn";
  ledger.records[0].withdrawnAt="2026-11-01T13:00:00Z";
  const result=pub.publicEligibleScoreboard(ledger,data,emails,secret);
  assert.equal(result.totalPlayers,1);
  assert.equal(result.entries[0].points,22);
  assert.equal(result.approvedCount,0);
  assert.equal(data.entries[0].points,44); // Private history remains intact.
});
test("missing or altered consent snapshot exposes no first names or towns",()=>{
  for(const value of [null,{version:1,records:[]},{...pending(),sourceAsOf:"1999-01-01"}]){
    const r=pub.publicEligibleScoreboard(value,data,emails,secret);
    assert.equal(r.totalPlayers,2);
    assert.ok(r.entries.every(x=>x.anonymous===true && !x.displayName));
  }
});
test("no private account eligibility or secret means no public leaderboard",()=>{
  assert.equal(pub.publicEligibleScoreboard(pending(),data,null,secret),null);
  assert.equal(pub.publicEligibleScoreboard(pending(),data,emails,null),null);
  const stale={...data,status:"active_status_refresh_required"};
  const r=pub.publicEligibleScoreboard(pending(),stale,emails,secret);
  assert.equal(r.status,"active_status_refresh_required");
  assert.equal(r.totalPlayers,0);
  assert.deepEqual(r.entries,[]);
});
test("UI uses a public scoreboard; login is only for private Customer HQ stats",()=>{
  const root=path.resolve(__dirname,"..");
  const board=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  const api=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  const hq=fs.readFileSync(path.join(root,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(board,/SHOW MORE PUBLIC SCORES/);
  assert.match(board,/ARCADE PLAYER/);
  assert.match(board,/Everyone can see the N64 test leaderboard by first name, town and points/);
  assert.match(board,/showOwnerControls/);
  assert.match(board,/setPublicShownCount/);
  assert.match(board,/<CustomerHQ embedded/);
  assert.match(api,/previewFirstNameScoreboard/);
  assert.match(api,/public_eligible_scores/);
  assert.match(api,/anonymous:true/);
  assert.match(hq,/request-code/);
  assert.match(hq,/verify-code/);
  assert.doesNotMatch(api,/ownerPrivateLeaderboardPreview/);
});
