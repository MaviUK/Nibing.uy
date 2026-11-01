"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const {ownerPrivateLeaderboardPreview}=
  require("../netlify/functions/lib/squeegeeOwnerLeaderboardPreview");
const {publicConsentBoard}=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");

const ROOT=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");

test("owner-only leaderboard can show all eligible customers, not just the top 20",()=>{
  const accounts=Array.from({length:662},(_,i)=>({
    id:"12345678-1234-4123-8123-"+String(i+1).padStart(12,"0"),
    ref:"CUS"+(500000+i),
    email:"test"+i+"@example.co.uk",
    firstName:"Customer",town:i%2?"Bangor":"Newtownards",
    points:(i+1)*2,
  }));
  const verified=new Set(accounts.map(x=>canonicalLegacyRef(x.id)));
  const eligible={aliases:verified,count:662,historicalPoints:accounts.reduce((a,b)=>a+b.points,0)};
  const records=accounts.map(x=>({
    alias:canonicalLegacyRef(x.id),town:x.town,consent:"pending"
  }));
  const privateData={asOf:"2026-10-31",accounts};
  const p=ownerPrivateLeaderboardPreview(privateData,{records},eligible,941);
  assert.equal(p.count,662);
  assert.equal(p.verified,662);
  assert.equal(p.approved,0);
  assert.equal(p.rows.length,662);
  assert.equal(p.rows[0].points,1324);
  assert.equal(p.rows[661].points,2);
  assert.equal(p.rows[0].permission,"pending");
  assert.equal(p.rows[0].firstName,"Customer");
  assert.equal(p.rows[0].town,"Bangor");
  // Public rankings still do not release any first name without opt-in.
  const fullBoard={status:"squeegee_active_only",entries:accounts.map((a,i)=>({
    rank:i+1,customerRef:canonicalLegacyRef(a.id),town:a.town,points:a.points
  }))};
  const consentData={version:1,sourceAsOf:"2026-10-31",records};
  assert.equal(publicConsentBoard(consentData,fullBoard,verified).totalPlayers,0);
  assert.equal(ownerPrivateLeaderboardPreview(privateData,{records},eligible,942),null);
});

test("private owner route is session-gated and emits only minimal display fields",()=>{
  const server=read("netlify/functions/squeegeePreviewVerifiedLeaderboard.mjs");
  assert.match(server,/api\.isExactPreview1\(process\.env,scope\)/);
  assert.match(server,/owner\.verifyTestSessionCookie\(/);
  assert.match(server,/owner\.sessionCookieFromHeader\(/);
  assert.match(server,/request\.method!=="GET"/);
  assert.match(server,/path:"\/api\/squeegee-preview-verified-leaderboard"/);
  assert.match(server,/Cache-Control":"private, no-store, max-age=0"/);
  assert.match(server,/Vary":"Cookie"/);
  assert.match(server,/return json\(401,\{error:"owner_sign_in_required"\}\)/);
  assert.match(server,/customerHQ\.eligibleRankedEmailAccounts\(history\)/);
  assert.match(server,/ranking\.ownerPrivateLeaderboardPreview\(/);
  assert.match(server,/return json\(200,\{/);
  assert.match(server,/firstName:consent\.safeFirstName\(entry\.firstName\)/);
  assert.match(server,/town:safePublicTown\(entry\.town\)/);
  assert.match(server,/points:entry\.points/);
  assert.doesNotMatch(server,/\bconsent:\s*["']granted["']/);
  assert.doesNotMatch(server,/\bsetJSON\(/);
  assert.doesNotMatch(server,/Access-Control-Allow-Origin/);
});

test("N64 home page offers public and private owner views with no private client storage",()=>{
  const client=read("src/components/ArcadeLeaderboard.jsx");
  const css=read("src/n64-finale.css");
  assert.match(client,/TEST: ALL FIRST NAMES/);
  assert.match(client,/TEST: SHOW ALL FIRST NAMES/);
  assert.match(client,/SIMULATED CONSENT — YOUR VIEW ONLY/);
  assert.match(client,/ownerPresentation==="simulation"/);
  assert.match(client,/n64-simulated-scoreboard/);
  assert.match(client,/simulatedOwnerRows=ownerRows\.filter\(row=>row\.permission!=="withdrawn"\)/);
  assert.match(client,/No permission statuses/);
  assert.match(client,/VIEW REAL PERMISSION STATUS/);
  assert.match(client,/Customer HQ/);
  assert.match(client,/PUBLIC LEADERBOARD/);
  assert.match(client,/rankingMode==="owner"/);
  assert.match(client,/owner-board/);
  assert.match(client,/credentials:"same-origin",cache:"no-store"/);
  assert.match(client,/owner-login-required/);
  assert.match(client,/\/api\/squeegee-preview-leaderboard-names/);
  assert.match(client,/SEARCH VERIFIED CUSTOMERS BY FIRST NAME OR TOWN/);
  assert.match(client,/SHOW 25 MORE/);
  assert.match(client,/PUBLIC PERMISSION NOT RECORDED/);
  assert.match(client,/Customer consent records/);
  assert.match(client,/CUSTOMER CONSENT/);
  assert.match(css,/\.n64-rank-public\[hidden\]/);
  assert.match(css,/\.n64-owner-ranking\[hidden\]/);
  assert.doesNotMatch(client,/localStorage\.setItem\([^)]*owner/i);
  assert.doesNotMatch(client,/sessionStorage\.setItem\([^)]*owner/i);
  assert.doesNotMatch(client,/\.consent\s*=\s*["']granted/);
});

test("existing signed-in owner can return directly to full leaderboard",()=>{
  const manager=read("netlify/functions/squeegeePreviewLeaderboardNames.mjs");
  assert.match(manager,/owner-board=1#live-leaderboard/);
  assert.match(manager,/VIEW ALL VERIFIED CUSTOMERS IN THE N64 LEADERBOARD/);
  assert.match(manager,/owner\.verifyTestSessionCookie\(/);
  const publicApi=read("netlify/functions/arcadeLeaderboard.js");
  assert.doesNotMatch(publicApi,/squeegeePreviewVerifiedLeaderboard/);
  assert.match(publicApi,/publicEligibleScoreboard\(/);
  assert.match(publicApi,/customerHQ\.eligibleRankedEmailAccounts/);
});


test("simulated all-customer permissions are only client-side owner display, never written as real consent",()=>{
  const client=read("src/components/ArcadeLeaderboard.jsx");
  const ownerApi=read("netlify/functions/squeegeePreviewVerifiedLeaderboard.mjs");
  const publicApi=read("netlify/functions/arcadeLeaderboard.js");
  const secureAudit=read("netlify/functions/lib/squeegeeLeaderboardNameConsent.js");
  const css=read("src/n64-finale.css");

  assert.match(client,/ownerState==="ready" && ownerInfo/);
  assert.match(client,/const response=await fetch\(OWNER_ENDPOINT/);
  assert.match(client,/data\.ownerView!==true \|\| data\.private!==true/);
  assert.match(client,/OWNER TEST MODE — NOT THE PUBLIC WEBSITE/);
  assert.match(client,/ownerPresentation==="simulation"/);
  assert.match(client,/setOwnerPresentation\("simulation"\)/);
  assert.match(client,/simulatedOwnerRows\.slice\(0,ownerShowCount\)/);
  assert.match(client,/row\.firstName\|\|"Name needs checking"/);
  assert.match(client,/row\.town/);
  assert.match(client,/row\.points\.toLocaleString/);
  assert.match(client,/onClick=\{openHQ\}/); // Still authenticates for own private details.
  assert.match(css,/\.n64-simulated-scoreboard/);
  assert.match(css,/Re-use the actual public leaderboard list appearance/);

  // The owner endpoint must require an owner session; a query string alone
  // never unlocks the private first-name records.
  assert.match(ownerApi,/owner\.verifyTestSessionCookie\(/);
  assert.match(ownerApi,/return json\(401,\{error:"owner_sign_in_required"\}\)/);
  assert.doesNotMatch(ownerApi,/\bsetJSON\(/);
  assert.doesNotMatch(publicApi,/ownerPrivateLeaderboardPreview/);
  assert.match(publicApi,/nameConsents\.publicEligibleScoreboard/);
  assert.match(secureAudit,/permission\?\.consent==="granted"/);
  assert.doesNotMatch(client,/localStorage\.setItem\(/);
  assert.doesNotMatch(client,/sessionStorage\.setItem\(/);
});
