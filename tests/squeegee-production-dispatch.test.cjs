"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const dispatch=require("../netlify/functions/lib/squeegeeProductionDispatch.js");
const guard=require("../netlify/functions/lib/squeegeeProductionGuard.js");

const scope={
  hostname:"nibing.uy",deployContext:"production",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
};
const env={
  SQUEEGEE_PRODUCTION_API_KEY:"synthetic-not-a-real-api-key-123456789",
  SQUEEGEE_PRODUCTION_EVENT_SECRET:"synthetic-not-a-real-signature-secret-123456789",
  SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED:"true",
  SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES:"true",
  SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY:"true",
  SQUEEGEE_PRODUCTION_WRITES_PAUSED:"false",
};
const payload={
  bookingId:"NBG-K7P4R2XM",
  submittedAt:new Date().toISOString(),
  name:"Synthetic QA",email:"example@example.test",
  phone:"02891000000",address:"1 Example Street BT20 5NF",
  termsAccepted:true,bins:[{type:"Brown Bin",count:1}],
};
const ownerReceipt={
  subject:"🗑️ New Bin Cleaning Booking (website)",
  text:"New Booking ".repeat(20),
  html:"<p>"+"Synthetic booking ".repeat(18)+"</p>",
  termsBody:"Example terms ".repeat(12),
  binsText:"1 x Brown Bin",pricingText:"Total £5",
  ownerPdfSha256:"a".repeat(64),
};

test("production sender is strictly disabled by default and on preview host",()=>{
  assert.equal(dispatch.issuerConfigured({},"nibing.uy"),false);
  assert.equal(dispatch.issuerConfigured(env,"deploy-preview-80--nibinguy.netlify.app"),false);
  assert.equal(dispatch.issuerConfigured(env,"deploy-preview-77--nibinguy.netlify.app"),false);
  assert.equal(dispatch.issuerConfigured(env,"www.nibing.uy"),false);
  assert.equal(dispatch.issuerConfigured(env,"nibing.uy"),true);
  assert.equal(dispatch.issuerConfigured({...env,
    SQUEEGEE_PRODUCTION_WRITES_PAUSED:"true"},"nibing.uy"),false);
});

test("signed production handoff uses independent credentials and never calls fetch on disabled site",async()=>{
  let called=0;
  const result=await dispatch.dispatchAcceptedProductionBooking(payload,{
    channel:"email",eventHost:"deploy-preview-80--nibinguy.netlify.app",
    ownerReceipt,env,fetchImpl:async()=>{called++;return {status:202};},
  });
  assert.equal(result.queued,false);
  assert.equal(called,0);
});

test("production handoff is email-only and requires original signed PDF reference",async()=>{
  let called=0;const fetchImpl=async()=>{called++;return {status:202};};
  for(const [channel,owner] of [
    ["whatsapp",ownerReceipt],["email",null],
    ["email",{...ownerReceipt,ownerPdfSha256:undefined}],
  ]){
    const r=await dispatch.dispatchAcceptedProductionBooking(payload,{
      channel,eventHost:"nibing.uy",ownerReceipt:owner,env,fetchImpl,
    });
    assert.equal(r.queued,false);
  }
  assert.equal(called,0);
});

test("synthetic signed production event is accepted only in an exact mock HTTP 202",async()=>{
  let calls=0;
  const timestamp=Date.now();
  const result=await dispatch.dispatchAcceptedProductionBooking(payload,{
    channel:"email",eventHost:"nibing.uy",ownerReceipt,env,now:timestamp,
    fetchImpl:async(url,options)=>{
      calls++;
      assert.equal(url,"https://nibing.uy/api/squeegee-production-auto-sync");
      assert.equal(options.method,"POST");
      assert.equal(options.redirect,"error");
      const body=JSON.parse(options.body);
      assert.equal(body.channel,"email");
      assert.equal(body.booking.bookingId,payload.bookingId);
      assert.equal(body.ownerReceipt.ownerPdfSha256,ownerReceipt.ownerPdfSha256);
      assert.equal(guard.verifyProductionEvent(options.body,
        options.headers["X-NBG-Auto-Timestamp"],
        options.headers["X-NBG-Auto-Signature"],
        {env,scope,now:timestamp}),true);
      assert.equal(options.body.includes("SQUEEGEE_PRODUCTION_API_KEY"),false);
      return {status:202};
    },
  });
  assert.equal(result.queued,true);
  assert.equal(calls,1);
});

test("HTTP 500 and uncertain timeouts are never retried",async()=>{
  let calls=0;
  const fail=await dispatch.dispatchAcceptedProductionBooking(payload,{
    channel:"email",eventHost:"nibing.uy",ownerReceipt,env,
    fetchImpl:async()=>{calls++;return {status:500};},
  });
  const timeout=await dispatch.dispatchAcceptedProductionBooking(payload,{
    channel:"email",eventHost:"nibing.uy",ownerReceipt,env,
    fetchImpl:async()=>{calls++;throw new Error("network uncertain");},
  });
  assert.equal(fail.queued,false);
  assert.equal(timeout.queued,false);
  assert.equal(timeout.reason,"production_handoff_uncertain_reconcile");
  assert.equal(calls,2);
});

test("production receiver requires trusted Netlify scope and has its own isolated stores",async()=>{
  const {default:handler}=await import("../netlify/functions/squeegeeProductionAutoSync.mjs");
  const response=await handler(
    new Request("https://deploy-preview-80--nibinguy.netlify.app/api/squeegee-production-auto-sync"),
    {deploy:{context:"deploy-preview"},site:{id:scope.siteId}});
  assert.equal(response.status,404);
  assert.equal(guard.STATUS_STORE,"nibinguy-production-squeegee-status");
  assert.equal(guard.CLAIM_STORE,"nibinguy-production-squeegee-claims");
  assert.equal(guard.CERT_STORE,"nibinguy-production-owner-pdfs");
  assert.notEqual(guard.STATUS_STORE,"squeegee-preview1-auto-sync-status");
});

test("ordinary live booking receipts are unchanged while production feature flags are unset",()=>{
  const source=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/sendBookingEmail.js"),"utf8");
  assert.match(source,/const productionSyncEnabled=productionDispatch\.issuerConfigured\(/);
  assert.match(source,/const deferAdminForAuto=deferAdminForPreview\|\|deferAdminForProduction/);
  assert.match(source,/const adminEmailPromise=deferAdminForAuto\?/);
  assert.match(source,/dispatchAcceptedProductionBooking\(payload/);
  assert.match(source,/productionGuard\.CERT_STORE:ownerCertificate\.STORE/);
  assert.match(source,/recordAutoNoDispatch/);
});
