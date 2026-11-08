"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const bin=require("../netlify/functions/lib/squeegeePreviewBinHistory");
const hq=require("../netlify/functions/lib/customerHQ");
const names=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");

function today(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return v.year+"-"+v.month+"-"+v.day;
}
const ids=[
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const refs=ids.map(canonicalLegacyRef);
function fixture(){
  const namesList=["Alice","Bob","Carol"];
  const towns=["Bangor","Comber","Holywood"];
  const emails=["alice@example.test","bob@example.test",""];
  return hq.validateSource({
    version:1,asOf:today(),scoringVersion:bin.VERSION,
    accounts:ids.map((id,i)=>({
      id,ref:String(2001+i),email:emails[i],
      firstName:namesList[i],town:towns[i],points:20,paidCleans:1,
      currentStreak:1,nextBonus:21,recordedSkips:0,
      jobs:[{id,label:"Brown",currentStreak:1,nextBonus:21,
        paidCleans:1,points:20,recordedSkips:0,lastCompletedOn:"2026-06-01"}],
      events:[{date:"2026-06-01",event:"paid_completed_clean",
        quantity:1,streak:1,points:20,j:0}]
    })),
  });
}
const evidence="Zoho Mail - owner manually verified positive replies on 6 Nov 2026";

test("owner-confirmed replies approve eligible registered emails, never no-email accounts",()=>{
  const privateAccounts=fixture();
  const eligible=hq.eligibleRankedEmailAccounts(privateAccounts);
  assert.equal(eligible.count,2);
  const pending=names.initialiseFromPrivateCustomerHQ(privateAccounts);
  const result=names.approveOwnerReviewedEmailReplies(
    pending,privateAccounts,eligible.aliases,{confirm:"yes",evidenceRef:evidence});
  assert.equal(result.counts.eligible,2);
  assert.equal(result.counts.approved,2);
  assert.equal(result.counts.alreadyApproved,0);
  assert.equal(result.counts.withdrawn,0);
  assert.equal(result.snapshot.ownerEmailReplyAttestation.method,
    "owner_manually_checked_positive_email_replies");
  assert.equal(result.snapshot.ownerEmailReplyAttestation.evidenceRef,evidence);
  const approved=result.snapshot.records.filter(r=>r.consent==="granted");
  assert.equal(approved.length,2);
  assert.ok(approved.every(r=>r.method==="email_reply" && r.evidenceRef===evidence));
  assert.equal(result.snapshot.records.find(r=>r.alias===refs[2]).consent,"pending");
  const full={status:"squeegee_active_only",sourceAsOf:privateAccounts.asOf,
    lastUpdatedAt:new Date().toISOString(),entries:refs.map((alias,i)=>({
      customerRef:alias,town:privateAccounts.accounts[i].town,points:20}))};
  const publicBoard=names.previewFirstNameScoreboard(
    privateAccounts,full,eligible.aliases,result.snapshot,Buffer.alloc(32,9));
  assert.equal(publicBoard.totalPlayers,2);
  assert.deepEqual(publicBoard.entries.map(x=>x.displayName).sort(),["Alice","Bob"]);
  assert.ok(!JSON.stringify(publicBoard).includes("Carol"));
  assert.ok(!JSON.stringify(publicBoard).includes("@"));
});

test("bulk attestation never reverses existing customer withdrawal or rewrites a prior grant",()=>{
  const privateAccounts=fixture();
  const eligible=hq.eligibleRankedEmailAccounts(privateAccounts);
  const pending=names.initialiseFromPrivateCustomerHQ(privateAccounts);
  // Match the rolling source-as-of date; a fixed 6 November time becomes
  // earlier than the generated import once the calendar advances.
  const now=Date.now();
  const before={...pending,records:pending.records.map(r=>
    r.alias===refs[1]?{...r,consent:"withdrawn",withdrawnAt:"2026-11-05T15:00:00Z"}:r)};
  const once=names.approveOwnerReviewedEmailReplies(before,privateAccounts,
    eligible.aliases,{confirm:"yes",evidenceRef:evidence},now);
  assert.equal(once.counts.approved,1);
  assert.equal(once.counts.withdrawn,1);
  const twice=names.approveOwnerReviewedEmailReplies(once.snapshot,privateAccounts,
    eligible.aliases,{confirm:"yes",evidenceRef:"A later owner evidence note"},now+1000);
  assert.equal(twice.counts.approved,0);
  assert.equal(twice.counts.alreadyApproved,1);
  assert.equal(twice.counts.withdrawn,1);
  assert.equal(twice.snapshot.records.find(r=>r.alias===refs[0]).evidenceRef,evidence);
  assert.equal(twice.snapshot.records.find(r=>r.alias===refs[1]).consent,"withdrawn");
  assert.equal(twice.snapshot.records.find(r=>r.alias===refs[1]).withdrawnAt,
    "2026-11-05T15:00:00Z");
});

test("missing or changed first names stay unapproved pending verification",()=>{
  const privateAccounts=fixture();
  const eligible=hq.eligibleRankedEmailAccounts(privateAccounts);
  const pending=names.initialiseFromPrivateCustomerHQ(privateAccounts);
  const broken={...pending,records:pending.records.map(r=>
    r.alias===refs[0]?{...r,firstName:"Wrong"}:r)};
  const out=names.approveOwnerReviewedEmailReplies(broken,privateAccounts,
    eligible.aliases,{confirm:"yes",evidenceRef:evidence});
  assert.equal(out.counts.needsNameReview,1);
  assert.equal(out.counts.approved,1);
  assert.equal(out.snapshot.records.find(r=>r.alias===refs[0]).consent,"pending");
});

test("owner email-reply attestation fails closed on missing proof or changed source",()=>{
  const s=fixture(),allowed=hq.eligibleRankedEmailAccounts(s).aliases;
  const initial=names.initialiseFromPrivateCustomerHQ(s);
  const grant=(ledger,source,aliases,opts)=>names.approveOwnerReviewedEmailReplies(
    ledger,source,aliases,opts);
  assert.throws(()=>grant(initial,s,allowed,{confirm:"",evidenceRef:evidence}),
    /owner_attestation_required/);
  assert.throws(()=>grant(initial,s,allowed,{confirm:"yes",evidenceRef:"none"}),
    /owner_attestation_required/);
  assert.throws(()=>grant({...initial,sourceAsOf:"2026-10-31"},s,allowed,
    {confirm:"yes",evidenceRef:evidence}),/consent_dataset_missing/);
  assert.throws(()=>grant(initial,s,new Set([...allowed,"unknown"]),{
    confirm:"yes",evidenceRef:evidence}),/consent_customer_mismatch/);
  assert.throws(()=>grant({...initial,records:initial.records.slice(1)},s,allowed,{
    confirm:"yes",evidenceRef:evidence}),/consent_customer_mismatch/);
});

test("one-time bulk confirmation remains behind Preview 77 owner OTP and same-origin POST",()=>{
  const source=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewLeaderboardNames.mjs"),"utf8");
  const gate=source.indexOf("verifyTestSessionCookie(");
  const origin=source.indexOf('request.headers.get("origin")!==(isProduction?LIVE_ORIGIN:ORIGIN)');
  const action=source.indexOf('if(action==="record-owner-reviewed-email-replies")');
  assert.ok(gate>=0 && origin>gate && action>origin);
  assert.match(source,/onlyIfMatch:current\.etag/);
  assert.match(source,/owner\.sessionCookieFromHeader/);
  assert.match(source,/Record verified email permissions for eligible customers/);
  assert.match(source,/Another permission update occurred/);
});


test("email-eligible zero-score accounts do not block publishing other verified replies",()=>{
  // The private consent ledger intentionally excludes accounts with no
  // verified cleaning points, but email eligibility still counts them.
  const source=fixture();
  source.accounts[1]={...source.accounts[1],points:0,paidCleans:0,
    currentStreak:0,nextBonus:20,events:[],jobs:[]};
  const eligible=hq.eligibleRankedEmailAccounts(source);
  assert.equal(eligible.count,2);
  const pending=names.initialiseFromPrivateCustomerHQ(source);
  assert.equal(pending.records.length,1);
  const attested=names.approveOwnerReviewedEmailReplies(
    pending,source,eligible.aliases,{confirm:"yes",evidenceRef:evidence});
  assert.equal(attested.counts.eligible,2);
  assert.equal(attested.counts.qualifying,1);
  assert.equal(attested.counts.approved,1);
  assert.equal(attested.snapshot.records.length,1);
  assert.equal(attested.snapshot.records[0].consent,"granted");
  // Missing a positive-score consent row must still fail closed.
  const missing={...pending,records:[]};
  assert.throws(()=>names.approveOwnerReviewedEmailReplies(
    missing,source,eligible.aliases,{confirm:"yes",evidenceRef:evidence}),
    /consent_customer_mismatch/);
});

test("live bulk consent route requires a production-only owner session and verified ETag write",()=>{
 const source=fs.readFileSync(path.join(__dirname,
   "../netlify/functions/squeegeePreviewLeaderboardNames.mjs"),"utf8");
 assert.match(source,/productionGuard\.isVerifiedProductionScope\(scope\)/);
 assert.match(source,/productionOwner\.validCookie\(/);
 assert.match(source,/productionOwner\.fromHeader\(authHeader\)/);
 assert.match(source,/isProduction\?LIVE_ORIGIN:ORIGIN/);
 assert.match(source,/if\(request\.method==="POST"\)/);
 assert.match(source,/onlyIfMatch:current\.etag/);
 assert.match(source,/saved\?\.modified!==true \|\| !saved\?\.etag/);
 assert.match(source,/verified\?\.etag!==saved\.etag/);
 assert.match(source,/if\(isProduction\)return page\("<section>Bulk CSV import is unavailable on the live site/);
 assert.match(source,/ownerEmailReplyAttestation/);
 assert.match(source,/Record verified email permissions for eligible customers/);
});
