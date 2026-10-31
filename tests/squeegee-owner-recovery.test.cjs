"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const r=require("../netlify/functions/lib/squeegeeOwnerRecovery");
const {withApprovedPreviewAutomaticWrite}=require("../netlify/functions/lib/squeegeeApiV3");
const runtime={
  hostname:"deploy-preview-77--nibinguy.netlify.app",
  deployContext:"deploy-preview",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
};
const env={
  SQUEEGEE_API_KEY:"local-test-key-Only-Not-A-Real-Secret-123456",
  SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"true",
};
function audit(){
  const bins=[
    {type:"Black Bin",planId:"domestic_4w",count:1},
    {type:"Brown Bin",planId:"domestic_4w",count:1},
    {type:"Green Bin",planId:"comm_gt660_4w",sizeLitres:1100,count:1},
    {type:"Brown Bin",planId:"comm_gt660_oneoff",sizeLitres:1100,count:1},
    {type:"Black Bin",planId:"comm_gt660_oneoff",sizeLitres:1100,count:1},
    {type:"Black Bin",planId:"comm_gt660_4w",sizeLitres:660,count:1},
  ];
  return {
    bookingId:r.TARGET_BOOKING_ID,createdAt:"2026-10-31T19:20:47.000Z",
    channel:"email",name:"Recovery Test User",
    email:"example@example.org",phone:"07123456789",
    address:"Test Street BT19 1QD",bins,termsAccepted:true,
    pricing:{total:120,lines:[]},
    bookingScheduleSnapshot:{version:1,results:[]},
  };
}
test("only original audit is eligible and never changes its booking reference",()=>{
  const result=r.acceptedAuditPayload(audit());
  assert.equal(result.ok,true);
  assert.equal(result.payload.bookingId,r.TARGET_BOOKING_ID);
  assert.equal(result.payload.submittedAt,audit().createdAt);
  for(const bad of [
    {...audit(),bookingId:"NBG-OTHERS"},
    {...audit(),channel:"whatsapp"},
    {...audit(),termsAccepted:false},
    {...audit(),bins:[]},
    {...audit(),pricing:{total:20}},
  ])assert.equal(r.acceptedAuditPayload(bad).ok,false);
});
test("only original uncertain zero-confirmation status permits this recovery",()=>{
  const base={bookingId:r.TARGET_BOOKING_ID,stage:"requires_reconciliation",
    reason:"partial_or_ambiguous_squeegee_write",jobsConfirmed:0};
  assert.equal(r.originalStatusSafe(base),true);
  for(const change of [
    {jobsConfirmed:1},{reason:"created_customer_and_jobs"},
    {stage:"created_customer_and_jobs"},{bookingId:"NBG-OTHER123"},
  ])assert.equal(r.originalStatusSafe({...base,...change}),false);
});
test("one-time recovery proof is deterministic and accepted only in exact preview",async()=>{
  const key=r.recoveryClaimKey();
  assert.match(key,/^claim-v1\/auto-bookings\/NBG-OWNERREC-[A-F0-9]{8}$/);
  assert.equal(key,r.recoveryClaimKey());
  assert.throws(()=>r.recoveryClaimKey("NBG-OTHER123"),/restricted/);
  const proof={acquired:true,key,etag:'"v1"'};
  assert.equal(await withApprovedPreviewAutomaticWrite(proof,async()=>"allowed",runtime,env),"allowed");
  await assert.rejects(withApprovedPreviewAutomaticWrite(proof,
    async()=>true,{...runtime,hostname:"nibing.uy"},env),/unavailable/);
});
test("grouped prices must sum to the original customer-accepted £120",()=>{
  const group=(price)=>({
    members:[{index:0}],
    input:{price,date:"2026-11-17",frequencyType:"weeks",services:["service-id"]},
  });
  assert.equal(r.safeAmounts([group(30),group(90)]).ok,true);
  assert.equal(r.safeAmounts([group(30),group(89)]).ok,false);
});

test("owner recovery endpoint is owner-session-gated, explicitly confirmed, and one-use",()=>{
  const fs=require("node:fs");
  const path=require("node:path");
  const source=fs.readFileSync(
    path.join(__dirname,"../netlify/functions/squeegeePreviewOwnerRecovery.mjs"),
    "utf8"
  );
  assert.match(source,/if\(!ownerAuthenticated\(request,scope\)\)/);
  assert.match(source,/session\.verifyTestSessionCookie/);
  // Netlify extracts route config statically: it must be a literal path.
  assert.match(source,/path:"\/api\/squeegee-preview-owner-recovery"/);
  assert.match(source,/if\(request\.method==="POST"\)/);
  assert.match(source,/params\.get\("confirm"\)!=="yes"/);
  assert.match(source,/claims\.claimOnce\(/);
  assert.match(source,/claims\.changeClaimState\(/);
  assert.match(source,/api\.withApprovedPreviewAutomaticWrite/);
  assert.match(source,/matcher\.matchCustomersAcrossPages/);
  assert.match(source,/recovery\.originalStatusSafe/);
  assert.match(source,/loadOriginalAudit/);
  assert.match(source,/cache-control/i);
  assert.doesNotMatch(source,/localStorage/);
});


test("mobile form origin fallback requires same-origin browser metadata and owner confirmation",()=>{
  const fs=require("node:fs");
  const path=require("node:path");
  const src=fs.readFileSync(
    path.join(__dirname,"../netlify/functions/squeegeePreviewOwnerRecovery.mjs"),"utf8"
  );
  assert.match(src,/const origin=request\.headers\.get\("origin"\)/);
  assert.match(src,/const fetchSite=request\.headers\.get\("sec-fetch-site"\)/);
  assert.match(src,/origin==="https:\/\/deploy-preview-77--nibinguy\.netlify\.app"/);
  assert.match(src,/!origin && fetchSite==="same-origin"/);
  assert.match(src,/if\(!trustedOrigin\)/);
  assert.match(src,/ownerAuthenticated\(request,scope\)/);
  assert.match(src,/equalToken\(params\.get\("csrf"\),ownerToken\(request\)\)/);
  assert.match(src,/params\.get\("confirm"\)!=="yes"/);
});
