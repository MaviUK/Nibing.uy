"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const bin=require("../netlify/functions/lib/squeegeePreviewBinHistory");
const names=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const history=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const prod=require("../netlify/functions/lib/n64ProductionPublicBoard");
const auth=require("../netlify/functions/lib/customerHQ");
const guard=require("../netlify/functions/lib/squeegeeProductionGuard");
const id1="11111111-1111-4111-8111-111111111111",id2="22222222-2222-4222-8222-222222222222";
const a1=history.canonicalLegacyRef(id1),a2=history.canonicalLegacyRef(id2);
const key=Buffer.alloc(32,7),asOf="2026-11-05";
function fixture(){
 const accounts=[
  {id:id1,ref:"123",email:"sarah@example.test",firstName:"Sarah",town:"Bangor",points:20},
  {id:id2,ref:"124",email:"john@example.test",firstName:"John",town:"Comber",points:30}
 ];
 const privateData={version:1,asOf,scoringVersion:bin.VERSION,accounts};
 const ledger={version:1,sourceAsOf:asOf,records:accounts.map((row,i)=>({
  alias:i?a2:a1,ref:row.ref,town:row.town,firstName:row.firstName,
  consent:"granted",consentAt:"2026-11-06T09:00:00Z",withdrawnAt:null,
  method:"email_reply",evidenceRef:"Owner checked positive replies 6 Nov 2026",
  noticeVersion:names.NOTICE_VERSION
 }))};
 const scores={entries:[{customerRef:a2,town:"Comber",points:30},{customerRef:a1,town:"Bangor",points:20}],
  sourceAsOf:asOf,lastUpdatedAt:asOf+"T23:59:59Z"};
 return {privateData,ledger,scores,eligible:new Set([a1,a2])};
}
test("production public rankings preserve verified first names and towns only for recorded opt-in",()=>{
 const x=fixture();
 const out=prod.approvedBoard(x.privateData,x.scores,x.eligible,x.ledger,key);
 assert.equal(out.status,"public_eligible_scores");
 assert.deepEqual(out.entries.map(x=>x.displayName),["John","Sarah"]);
 assert.deepEqual(out.entries.map(x=>x.town),["Comber","Bangor"]);
 assert.equal(out.totalPlayers,2);
 assert.ok(!JSON.stringify(out).includes("@"));
 assert.ok(!JSON.stringify(out).includes("11111111"));
 assert.ok(out.entries.every(x=>x.customerRef!=="123"));
});
test("production ignores pending, revoked and unsupported evidence without changing original XP",()=>{
 const x=fixture();const rows=x.ledger.records;
 x.ledger.records=[{...rows[0],consent:"withdrawn",withdrawnAt:"2026-11-06T11:00:00Z"},
  {...rows[1],consent:"pending"}];
 const o=prod.approvedBoard(x.privateData,x.scores,x.eligible,x.ledger,key);
 assert.equal(o.totalPlayers,0);
 assert.equal(x.privateData.accounts.reduce((sum,p)=>sum+p.points,0),50);
 x.ledger.records[1]={...rows[1],evidenceRef:""};
 assert.equal(prod.approvedBoard(x.privateData,x.scores,x.eligible,x.ledger,key).totalPlayers,0);
});
test("production fails closed without its separate signing credentials and release flags",()=>{
 assert.equal(prod.publicSecret({}),null);
 const k=prod.publicSecret({N64_PRODUCTION_PUBLIC_LEADERBOARD_SECRET:"x".repeat(64)});
 assert.equal(k.length,32);
 assert.equal(auth.secret({N64_PRODUCTION_CUSTOMER_HQ_ENABLED:"true",SQUEEGEE_API_KEY:"x".repeat(64)}),null);
 assert.ok(auth.secret({SQUEEGEE_API_KEY:"x".repeat(64)}));
 assert.ok(auth.secret({N64_PRODUCTION_CUSTOMER_HQ_ENABLED:"true",N64_PRODUCTION_CUSTOMER_HQ_SECRET:"x".repeat(64)}));
 assert.equal(guard.productionConfigured({},{
  hostname:"nibing.uy",deployContext:"production",siteId:guard.SITE_ID}),false);
 const backend=read("netlify/functions/n64ProductionLeaderboard.mjs");
 assert.match(backend,/isVerifiedProductionScope/);
 assert.match(backend,/N64_PRODUCTION_LEADERBOARD_ENABLED/);
 assert.match(backend,/N64_PRODUCTION_CUSTOMER_HQ_ENABLED/);
 assert.match(backend,/verified_history_or_consent_not_ready/);
 const hq=read("netlify/functions/customerHQ.mjs");
 assert.match(hq,/readContext\(request,context\)/);
 assert.match(hq,/SQUEEGEE_PRODUCTION_READ_ENABLED/);
 assert.match(hq,/access.reader/);
});
test("late weekly update remains dated for 35 days while ingestion still rejects old data",()=>{
 assert.equal(bin.fresh("2026-11-05",Date.parse("2026-11-13T12:00:00Z")),false);
 assert.equal(bin.displayable("2026-11-05",Date.parse("2026-11-13T12:00:00Z")),true);
 assert.equal(bin.displayable("2026-11-05",Date.parse("2026-12-10T12:00:00Z")),true);
 assert.equal(bin.displayable("2026-11-05",Date.parse("2026-12-11T12:00:00Z")),false);
 const x=fixture();const late=Date.parse("2026-11-15T12:00:00Z");
 const changed=names.changeConsent(x.ledger,{
  reference:"123",action:"withdraw",method:"portal_email_code",
 },late);
 assert.equal(changed.records[0].consent,"withdrawn");
 assert.throws(()=>names.changeConsent(x.ledger,{
  reference:"123",action:"grant",method:"email_reply",
  evidenceRef:"new proof",confirm:"yes",
 },late),/consent_dataset_missing/);
});
test("live and preview route selection is separate; privacy explains participation",()=>{
 const ui=read("src/components/ArcadeLeaderboard.jsx");
 assert.match(ui,/PRODUCTION_ENDPOINT/);
 assert.match(ui,/hostname==="nibing.uy"/);
 const privacy=read("public/privacy-policy.html");
 for(const term of ["Customer HQ and optional public leaderboard",
  "first name, town, XP points and ranking","Netlify","Resend",
  "Withdrawal removes your public leaderboard entry"])
  assert.ok(privacy.includes(term),term);
 const plan=read("src/data/ownerMonthlyPlan.mjs");
 assert.match(plan,/MONTHLY PLANNING TARGET/);
 const estimated=read("src/data/dailyBinCounter.mjs");
 assert.match(estimated,/OWNER_ESTIMATED_BINS_PER_DAY = 200/);
});

test("live Records tab uses only already consented public names",()=>{
 const highlights=require("../netlify/functions/lib/squeegeePublicAchievementHighlights");
 const data=fixture();
 const sarah=data.privateData.accounts[0];
 sarah.jobs=[{id:"BLACK-1",label:"Black",currentStreak:1,
   lastCompletedOn:asOf,paidCleans:1}];
 sarah.events=[{j:0,date:asOf,event:"paid_completed_clean",
   streak:1,points:20,quantity:1}];
 const john=data.privateData.accounts[1];
 john.jobs=[{id:"BLACK-2",label:"Black",currentStreak:20,
   lastCompletedOn:asOf,paidCleans:20}];
 john.events=[{j:0,date:asOf,event:"paid_completed_clean",
   streak:20,points:30,quantity:1}];
 // Consent only Sarah; even John's much higher private streak must
 // never appear in public records, just as it cannot appear in ranks.
 data.ledger.records[1]={...data.ledger.records[1],
   consent:"pending",consentAt:null,method:null,evidenceRef:null};
 const publicScores=prod.approvedBoard(
   data.privateData,data.scores,data.eligible,data.ledger,key);
 assert.equal(publicScores.entries.length,1);
 assert.equal(publicScores.entries[0].displayName,"Sarah");
 const record=highlights.highlights(
   data.privateData,data.eligible,data.ledger,"overall",publicScores,key);
 assert.equal(record.status,"preview_public_named_records");
 assert.equal(record.colours[0].colour,"Black");
 assert.equal(record.colours[0].highestTop.length,1);
 assert.equal(record.colours[0].highestTop[0].displayName,"Sarah");
 assert.ok(!JSON.stringify(record).includes("John"));
 assert.ok(!JSON.stringify(record).includes("@"));
 assert.ok(!JSON.stringify(record).includes("BLACK-2"));
 const live=read("netlify/functions/n64ProductionLeaderboard.mjs");
 assert.match(live,/publicRecords\.highlights\(privateData,eligible\.aliases,ledger,period,result,key\)/);
 const ui=read("src/components/ArcadeLeaderboard.jsx");
 assert.match(ui,/★ RECORDS<\/button>/);
 assert.match(ui,/n64-board-tab-content n64-board-records-tab/);
 assert.doesNotMatch(ui,/!LIVE_N64 && <button type="button"\s+className=\{activePanel==="records"/);
 assert.doesNotMatch(ui,/!LIVE_N64 && i<3 && <span className="n64-board-medal"/);
});
test("revoked public permission removes both ranking and cleaning records",()=>{
 const highlights=require("../netlify/functions/lib/squeegeePublicAchievementHighlights");
 const data=fixture();
 data.privateData.accounts[0].jobs=[{id:"BLACK-1",label:"Black",
   currentStreak:1,lastCompletedOn:asOf,paidCleans:1}];
 data.privateData.accounts[0].events=[{j:0,date:asOf,
   event:"paid_completed_clean",streak:1,points:20,quantity:1}];
 data.ledger.records=data.ledger.records.map(x=>({
   ...x,consent:"withdrawn",withdrawnAt:asOf+"T12:00:00Z"
 }));
 const publicScores=prod.approvedBoard(
   data.privateData,data.scores,data.eligible,data.ledger,key);
 assert.equal(publicScores.entries.length,0);
 assert.equal(highlights.highlights(
   data.privateData,data.eligible,data.ledger,"overall",publicScores,key),null);
});
