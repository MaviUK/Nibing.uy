"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const guard=require("../netlify/functions/lib/squeegeeProductionGuard");
const preview=require("../netlify/functions/lib/squeegeeApiV3");
const claims=require("../netlify/functions/lib/squeegeeAutomaticBooking");

const goodScope={
  hostname:"nibing.uy",deployContext:"production",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
};
const readyEnv=Object.freeze({
  SQUEEGEE_PRODUCTION_API_KEY:"synthetic-production-only-api-key-NOT-REAL",
  SQUEEGEE_PRODUCTION_EVENT_SECRET:"synthetic-independent-event-secret-NOT-REAL",
  SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED:"true",
  SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES:"true",
  SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY:"true",
  SQUEEGEE_PRODUCTION_WRITES_PAUSED:"false",
});
const booked={
  acquired:true,key:"claim-v1/production/auto-bookings/NBG-K7P4R2XM",
  etag:"fictitious-proof-from-test",
};
const allow=(env=readyEnv,scope=goodScope,proof=booked)=>
  guard.productionWriteAdmission({env,scope,proof});

test("production scope requires the exact host, actual Netlify production context and site",()=>{
  assert.equal(guard.isVerifiedProductionScope(goodScope),true);
  for(const scope of [
    {...goodScope,hostname:"www.nibing.uy"},
    {...goodScope,hostname:"deploy-preview-77--nibinguy.netlify.app"},
    {...goodScope,hostname:"deploy-preview-80--nibinguy.netlify.app"},
    {...goodScope,deployContext:"deploy-preview"},
    {...goodScope,siteId:"11111111-1111-4111-8111-111111111111"},
    {...goodScope,siteId:undefined},
    null,{},undefined,
  ]) assert.equal(guard.isVerifiedProductionScope(scope),false);
});

test("production is OFF by default even with the right host",()=>{
  assert.equal(allow({}),false);
  assert.equal(allow(undefined,null),false);
  assert.equal(allow({SQUEEGEE_API_KEY:"synthetic-preview-secret"},goodScope),false);
});

test("every independent production switch and secret must be explicitly present",()=>{
  assert.equal(allow(),true);
  for(const key of Object.keys(readyEnv)){
    const changed={...readyEnv};
    delete changed[key];
    assert.equal(allow(changed),false,key+" must default OFF");
  }
  for(const name of [
    "SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED",
    "SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES",
    "SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY",
  ]) assert.equal(allow({...readyEnv,[name]:"false"}),false);
  assert.equal(allow({...readyEnv,SQUEEGEE_PRODUCTION_WRITES_PAUSED:"true"}),false);
  assert.equal(allow({...readyEnv,SQUEEGEE_PRODUCTION_WRITES_PAUSED:undefined}),false);
  assert.equal(allow({...readyEnv,SQUEEGEE_PRODUCTION_API_KEY:"short"}),false);
  assert.equal(allow({...readyEnv,SQUEEGEE_PRODUCTION_EVENT_SECRET:"short"}),false);
});

test("only a claimed canonical booking is eligible, never a caller-supplied short ref or preview claim",()=>{
  assert.equal(guard.admittedClaim(booked),true);
  for(const key of [
    "claim-v1/auto-bookings/NBG-K7P4R2XM",
    "claim-v1/production/auto-bookings/NBG-261031",
    "claim-v1/production/auto-bookings/NBG-K7P4R2XM/again",
    "claim-v1/production/auto-bookings/NBG-TOOSHORT",
    "claim-v1/production/auto-bookings/"+"x".repeat(120),
  ])assert.equal(allow(readyEnv,goodScope,{...booked,key}),false);
  assert.equal(allow(readyEnv,goodScope,{...booked,acquired:false}),false);
  assert.equal(allow(readyEnv,goodScope,{...booked,etag:""}),false);
});

test("signed production event is valid only in the proper verified production context",()=>{
  const timestamp=Date.now();
  const body=JSON.stringify({channel:"email",booking:{bookingId:"NBG-K7P4R2XM"}});
  const signature=guard.signProductionEvent(body,String(timestamp),{
    env:readyEnv,scope:goodScope,
  });
  assert.match(signature,/^[a-f0-9]{64}$/);
  assert.equal(guard.verifyProductionEvent(body,String(timestamp),signature,{
    env:readyEnv,scope:goodScope,now:timestamp,
  }),true);
  assert.equal(guard.verifyProductionEvent(body+" ",String(timestamp),signature,{
    env:readyEnv,scope:goodScope,now:timestamp,
  }),false);
  assert.equal(guard.verifyProductionEvent(body,String(timestamp),signature,{
    env:readyEnv,scope:{...goodScope,deployContext:"deploy-preview"},now:timestamp,
  }),false);
  assert.equal(guard.verifyProductionEvent(body,String(timestamp),signature,{
    env:{...readyEnv,SQUEEGEE_PRODUCTION_WRITES_PAUSED:"true"},
    scope:goodScope,now:timestamp,
  }),false);
  assert.equal(guard.verifyProductionEvent(body,String(timestamp),signature,{
    env:readyEnv,scope:goodScope,now:timestamp+100000,
  }),false);
  assert.equal(guard.verifyProductionEvent(body,String(timestamp),signature,{
    env:readyEnv,scope:goodScope,now:timestamp-50000,
  }),false);
});

test("release preview remains unable to acquire existing Preview #77 write rights",()=>{
  assert.equal(preview.isExactPreview1(readyEnv,goodScope),false);
  assert.equal(claims.canAutoSync(readyEnv,goodScope),false);
  assert.equal(preview.isExactPreview1(readyEnv,{
    ...goodScope,hostname:"deploy-preview-80--nibinguy.netlify.app",
    deployContext:"deploy-preview"
  }),false);
});
