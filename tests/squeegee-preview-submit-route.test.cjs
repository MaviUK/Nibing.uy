"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

// This file executes the ACTUAL modern Netlify function with fake secrets and
// no real Squeegee client calls, and never invokes context.waitUntil.
process.env.SQUEEGEE_API_KEY="FAKE-LOCAL-SUPERVISED-PREVIEW-SQUEEGEE-KEY-ONLY";
process.env.N64_PREVIEW_LEADERBOARD_SECRET="FAKE-LOCAL-ARCADE-BOOKING-SIGNATURE-KEY-ONLY";
const session=require("../netlify/functions/lib/squeegeePreviewTestSession");
const arcade=require("../netlify/functions/lib/arcadeBookingProof");

const scope={hostname:"deploy-preview-77--nibinguy.netlify.app",
  deployContext:"deploy-preview",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84"};
const context={
  deploy:{context:"deploy-preview"},
  site:{id:"d63c829f-3ed7-48e9-9633-a042de3f2e84"},
  // NO waitUntil: even an accepted owner+booking proof can't run POST here.
};
const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-test-submit";
function booking(){
  return {
    bookingId:"NBG-ABCDE-ABCDEFGH",submittedAt:new Date().toISOString(),
    name:"One Test Customer",email:"test@example.com",
    phone:"07000000000",address:"17 Example Street, Bangor, BT20 4AA",
    termsAccepted:true,discountCode:"",
    bins:[{type:"Black Bin",planId:"domestic_4w",count:1}],
    bookingScheduleSnapshot:{version:1,postcode:"BT20 4AA",
      results:[{type:"Black Bin",automatic:true,assignedCleanDate:"2026-11-02"}]},
  };
}
function request(body,withOwnerCookie=false,host=url){
  return new Request(host,{
    method:"POST",headers:{
      "Content-Type":"application/json",
      ...(withOwnerCookie?{"Cookie":session.COOKIE_NAME+"="+
        session.createTestSessionCookie(process.env,Date.now(),scope)}:{}),
    },
    body:JSON.stringify(body),
  });
}

test("unauthorised POST to the modern route cannot trigger Squeegee",async()=>{
  const {default:handler}=await import("../netlify/functions/squeegeePreviewTestSubmit.mjs");
  const b=booking();
  const response=await handler(request({booking:b,bookingProof:arcade.signBooking(b)}),context);
  assert.equal(response.status,403);
});
test("a valid owner test session still requires an accepted signed booking proof",async()=>{
  const {default:handler}=await import("../netlify/functions/squeegeePreviewTestSubmit.mjs");
  const b=booking();
  assert.equal((await handler(request({booking:b,bookingProof:"forged"},true),context)).status,403);
  const other={...b,email:"different@example.org"};
  assert.equal((await handler(request({booking:other,bookingProof:arcade.signBooking(b)},true),context)).status,403);
});
test("signed booking and owner cookie are not enough without reliable modern worker",async()=>{
  const {default:handler}=await import("../netlify/functions/squeegeePreviewTestSubmit.mjs");
  const b=booking();
  const response=await handler(request({booking:b,bookingProof:arcade.signBooking(b)},true),context);
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error,"Reliable post-response processing unavailable");
});
test("public production hostname or another Netlify site cannot use Preview 1 route",async()=>{
  const {default:handler}=await import("../netlify/functions/squeegeePreviewTestSubmit.mjs");
  const b=booking(),proof=arcade.signBooking(b);
  assert.equal((await handler(request({booking:b,bookingProof:proof},true,
    "https://nibing.uy/api/squeegee-preview-test-submit"),context)).status,404);
  assert.equal((await handler(request({booking:b,bookingProof:proof},true),{
    ...context,site:{id:"00000000-0000-4000-8000-000000000000"},
  })).status,404);
});
