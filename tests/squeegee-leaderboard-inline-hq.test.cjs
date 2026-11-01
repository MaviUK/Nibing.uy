"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const {ownerPrivateLeaderboardPreview}=require("../netlify/functions/lib/squeegeeOwnerLeaderboardPreview");
const {publicConsentBoard,NOTICE_VERSION}=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const {ENTRIES,AS_OF}=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");

const ID="12345678-1234-4123-8123-123456789abc",ALIAS=canonicalLegacyRef(ID);
const customer={
  id:ID,ref:"CUS1298",email:"test@example.co.uk",
  firstName:"Sarah",town:"Bangor",points:80
};
const el={aliases:new Set([ALIAS]),historicalPoints:80,count:1};
const privateData={asOf:AS_OF,accounts:[customer]};
const pending={
  records:[{alias:ALIAS,ref:"CUS1298",firstName:"Sarah",town:"Bangor",
    consent:"pending",consentAt:null,withdrawnAt:null,method:null,
    noticeVersion:null,evidenceRef:null}]
};
test("owner-only preview shows actual Squeegee customer ranks while pending consent",()=>{
  const p=ownerPrivateLeaderboardPreview(privateData,pending,el);
  assert.equal(p.count,1);
  assert.equal(p.verified,1);
  assert.equal(p.verifiedAsOf,AS_OF);
  assert.equal(p.approved,0);
  assert.equal(p.cleaningXp,80);
  assert.deepEqual(p.rows,[{rank:1,customerReference:"CUS1298",
    firstName:"Sarah",town:"Bangor",points:80,
    verification:"verified_from_squeegee_backup",permission:"pending"}]);
  assert.equal(ownerPrivateLeaderboardPreview(privateData,pending,null),null);
  assert.equal(ownerPrivateLeaderboardPreview(privateData,pending,{aliases:new Set(),historicalPoints:0}).count,0);
});
test("owner preview distinguishes approved and withdrawn; public still requires consent",()=>{
  const approved={records:[{...pending.records[0],firstName:"Saoirse",
    consent:"granted",consentAt:"2026-11-01T13:15:00Z",
    withdrawnAt:null,method:"email_reply",evidenceRef:"owner-proof-123",
    noticeVersion:NOTICE_VERSION}]};
  const a=ownerPrivateLeaderboardPreview(privateData,approved,el);
  assert.equal(a.approved,1);
  assert.equal(a.rows[0].firstName,"Saoirse");
  const withdrawn={records:[{...approved.records[0],consent:"withdrawn",
    withdrawnAt:"2026-11-01T13:20:00Z"}]};
  const b=ownerPrivateLeaderboardPreview(privateData,withdrawn,el);
  assert.equal(b.approved,0);
  assert.equal(b.verified,1);
  assert.equal(b.rows[0].verification,"verified_from_squeegee_backup");
  assert.equal(b.rows[0].permission,"withdrawn");
  const actualPublicSource={version:1,sourceAsOf:AS_OF,records:pending.records};
  const fullBoard={entries:[{rank:1,customerRef:ALIAS,town:"Bangor",points:80}],
    status:"squeegee_active_only"};
  assert.equal(publicConsentBoard(actualPublicSource,fullBoard,el.aliases).totalPlayers,0);
});
test("homepage leaderboard embeds customer sign-in as a switchable tab",()=>{
  const root=path.resolve(__dirname,"..");
  const board=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  const hq=fs.readFileSync(path.join(root,"src/pages/CustomerHQ.jsx"),"utf8");
  const css=fs.readFileSync(path.join(root,"src/n64-finale.css"),"utf8");
  assert.match(board,/activePanel/);
  assert.match(board,/My Customer HQ|MY CUSTOMER HQ/);
  assert.match(board,/<CustomerHQ embedded\s*\/>/);
  assert.match(board,/n64-board-tab-content/);
  assert.match(board,/hidden=\{activePanel!==/);
  assert.match(board,/const CustomerHQ=React.lazy\(\(\)=>import\("\.\.\/pages\/CustomerHQ"\)\)/);
  assert.match(hq,/function CustomerHQ\(\{embedded=false\}\)/);
  assert.match(hq,/n64:leaderboard-updated/);
  assert.match(hq,/const Container=embedded\?"div":"main"/);
  assert.match(css,/\.n64-board-tab-content\[hidden\]/);
  assert.match(board,/eligibleCleaningXp/);
  assert.match(board,/SHOW MORE PUBLIC SCORES/);
  assert.match(board,/Everyone can see the N64 test leaderboard by first name, town and points/);
});
test("owner private ranking cannot leak through public leaderboard; public API remains opt-in only",()=>{
  const root=path.resolve(__dirname,"..");
  const owner=fs.readFileSync(path.join(root,"netlify/functions/squeegeePreviewLeaderboardNames.mjs"),"utf8");
  const api=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  assert.match(owner,/verifyTestSessionCookie/);
  assert.match(owner,/ownerPrivateLeaderboardPreview/);
  assert.match(owner,/PRIVATE OWNER VIEW/);
  assert.match(owner,/no-store/);
  assert.doesNotMatch(api,/ownerPrivateLeaderboardPreview/);
  assert.match(api,/previewFirstNameScoreboard/);
  assert.match(api,/anonymous:true/);
  assert.match(api,/eligibleCleaningXp:eligible\.historicalPoints/);
});


test("verified Squeegee membership is separate from public permission",()=>{
  const root=path.resolve(__dirname,"..");
  const verification=fs.readFileSync(path.join(root,"netlify/functions/lib/customerHQ.js"),"utf8");
  const api=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  const owner=fs.readFileSync(path.join(root,"netlify/functions/squeegeePreviewLeaderboardNames.mjs"),"utf8");
  assert.match(verification,/verificationStatus:"verified_from_squeegee_backup"/);
  assert.match(verification,/verifiedCount:aliases\.size/);
  assert.match(verification,/verifiedActiveEmailAccounts/);
  assert.match(api,/verifiedPlayers:eligible\.verifiedCount/);
  assert.match(api,/verifiedAsOf:eligible\.verificationAsOf/);
  assert.match(owner,/VERIFIED TOP 20/);
  assert.match(owner,/Waiting for permission/);
  assert.match(owner,/verifyTestSessionCookie/);
  const consent=fs.readFileSync(path.join(root,"netlify/functions/lib/squeegeeLeaderboardNameConsent.js"),"utf8");
  assert.match(consent,/r\.consent==="granted"/);
  assert.match(consent,/emailEligibleAliases\.has\(r\.alias\)/);
  assert.doesNotMatch(api,/r\.consent="granted"/);
});
