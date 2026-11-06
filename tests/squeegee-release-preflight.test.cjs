"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const api=require("../netlify/functions/lib/squeegeeApiV3.js");
const booking=require("../netlify/functions/lib/squeegeeAutomaticBooking.js");

const root=path.resolve(__dirname,"..");
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");
const siteId="d63c829f-3ed7-48e9-9633-a042de3f2e84";
const live={hostname:"nibing.uy",deployContext:"production",siteId};
const fakeEnv={
  CONTEXT:"production",BRANCH:"main",
  DEPLOY_PRIME_URL:"https://nibing.uy",
  SQUEEGEE_API_KEY:"synthetic-test-only-not-a-real-squeegee-key",
  SQUEEGEE_WRITE_ENABLED:"true",
  SQUEEGEE_OWNER_APPROVED_WRITES:"true",
  SQUEEGEE_ATOMIC_LEDGER_READY:"true",
  SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"true",
};

test("release candidate cannot use preview-only Squeegee automatic-booking rights on live host",()=>{
  assert.equal(api.isExactPreview1(fakeEnv,live),false);
  assert.equal(booking.canAutoSync(fakeEnv,live),false);
});

test("even a synthetic claimed booking cannot grant the current preview-only writer production access",async()=>{
  const proof={acquired:true,
    key:"claim-v1/auto-bookings/NBG-K7P4R2XM",
    etag:"synthetic-etag"};
  let called=false;
  await assert.rejects(
    api.withApprovedPreviewAutomaticWrite(proof,async()=>{
      called=true;
    },live,fakeEnv),
    /Preview-only automatic booking write capability unavailable/
  );
  assert.equal(called,false);
});

test("customer HQ and dated Squeegee rankings remain preview-scoped until a separate safe production cutover",()=>{
  const hq=read("netlify/functions/customerHQ.mjs");
  const board=read("netlify/functions/arcadeLeaderboard.js");
  assert.match(hq,/if\(!api\.isExactPreview1\(process\.env,scope\(request,context\)\)\)/);
  assert.match(board,/function isExactN64PreviewRequest\(event\)/);
  assert.match(board,/host==="deploy-preview-77--nibinguy\.netlify\.app"/);
});

test("the reconciled 1,734 customer count uses the owner-confirmed planning source",()=>{
  const counters=read("src/data/statsPlan.js");
  const plan=read("src/data/ownerMonthlyPlan.mjs");
  assert.match(counters,/monthlyCustomers:\s*OWNER_MONTHLY_PLAN\.monthlyCustomers/);
  assert.match(plan,/monthlyCustomers:\s*1734\b/);
});

test("live release cannot silently delete the booking safety net or its terms-PDF gate",()=>{
  const netlify=read("netlify.toml");
  const bookingSender=read("netlify/functions/sendBookingEmail.js");
  assert.match(netlify,/node --test tests\/squeegee-\*\.test\.cjs && npm run build/);
  assert.match(bookingSender,/if \(!termsPdfAttachment\)/);
  assert.match(bookingSender,/termsPdfAttached: Boolean\(termsPdfAttachment\)/);
});
