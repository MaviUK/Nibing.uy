"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {ABANDONED_BOOKING_ID,isPilotBooking,PILOT_NAME}=
  require("../netlify/functions/lib/squeegeePreviewAutoRollout");

const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-recover";
const context={
  deploy:{context:"deploy-preview"},
  site:{id:"d63c829f-3ed7-48e9-9633-a042de3f2e84"},
};

test("old two-bin pilot is permanently abandoned and cannot qualify as a fresh test",()=>{
  assert.equal(ABANDONED_BOOKING_ID,"NBG-MVV99LDX-7BEDD59D85");
  assert.equal(PILOT_NAME,"TEST API - Fresh Sync");
  const old={
    bookingId:ABANDONED_BOOKING_ID,name:"TEST API - Pilot 2",
    termsAccepted:true,
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
  };
  assert.equal(isPilotBooking(old,"email"),false);
  assert.equal(isPilotBooking({
    ...old,name:PILOT_NAME,
    bins:old.bins.slice(0,1),
  },"email"),false);
});

test("retired recovery GET is a safe 410 without an owner code or any Squeegee writes",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewAutoRecover.mjs");
  const result=await handler(new Request(url),context);
  assert.equal(result.status,410);
  const html=await result.text();
  assert.match(html,/Old Squeegee test retired/);
  assert.match(html,/fresh one-bin booking/);
  assert.match(html,/normal Submit Booking/);
  assert.equal(result.headers.get("cache-control"),
    "private, no-store, max-age=0");
  assert.equal(result.headers.get("set-cookie"),null);
});

test("retired recovery POST cannot create, enqueue, claim or retry anything",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewAutoRecover.mjs");
  const result=await handler(new Request(url,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:"action=confirm-pilot2&csrf=anything",
  }),context);
  assert.equal(result.status,410);
  const html=await result.text();
  assert.match(html,/will not create/);
  const code=fs.readFileSync(
    path.join(__dirname,"../netlify/functions/squeegeePreviewAutoRecover.mjs"),
    "utf8");
  for(const blocked of [
    "executeAutomaticPreviewBooking","setJSON","claimOnce",
    "createCustomer","addJobToCustomer","SQUEEGEE_API_KEY",
    "verifyOwnerCode","getStore",
  ]) assert.ok(!code.includes(blocked),blocked);
});

test("the retired endpoint cannot be used in production or Preview 2",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewAutoRecover.mjs");
  assert.equal((await handler(new Request(url),{
    deploy:{context:"production"},site:context.site,
  })).status,404);
  assert.equal((await handler(new Request(
    "https://deploy-preview-78--nibinguy.netlify.app/api/squeegee-preview-auto-recover",
  ),context)).status,404);
});
