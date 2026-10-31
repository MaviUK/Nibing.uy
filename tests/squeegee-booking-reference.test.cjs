"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateBookingSubmission}=require("../netlify/functions/lib/bookingSubmissionGuard");
const {buildBookingEmailHtml}=require("../netlify/functions/lib/bookingEmailTemplate");
const {readFileSync}=require("node:fs");
const path=require("node:path");

test("secure human-friendly booking ID has local YYMMDD and eight readable random characters",async()=>{
  const {createFriendlyBookingReference}=await import("../src/bookingReference.mjs");
  const fakeCrypto={getRandomValues:out=>{
    out.set([0,1,2,3,4,5,6,31]);return out;
  }};
  const date=new Date("2026-10-31T16:06:00Z");
  const code=createFriendlyBookingReference(date,fakeCrypto);
  assert.equal(code,"NBG-261031-2345678Z");
  assert.match(code,/^NBG-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.doesNotMatch(code,/[IO01]/);
  assert.equal(code.length,19);
  assert.equal(validateBookingSubmission({bookingId:code,submittedAt:date.toISOString()},
    {now:date.getTime()+1000}).ok,true);
  // Explicitly test BST: 23:30 UTC is 00:30 local the following day.
  assert.equal(
    createFriendlyBookingReference(new Date("2026-07-01T23:30:00Z"),fakeCrypto),
    "NBG-260702-2345678Z");
  // UK autumn clock change must be stable and use actual local calendar date.
  assert.equal(
    createFriendlyBookingReference(new Date("2026-10-25T00:30:00Z"),fakeCrypto),
    "NBG-261025-2345678Z");
  assert.throws(()=>createFriendlyBookingReference(date,null),
    /secure_booking_reference_unavailable/);
  assert.throws(()=>createFriendlyBookingReference(new Date("invalid"),fakeCrypto),
    /invalid_booking_reference_date/);
});

test("new references use strong random bytes and remain individually unique",async()=>{
  const {createFriendlyBookingReference}=await import("../src/bookingReference.mjs");
  const result=new Set();
  const fixedDate=new Date("2026-10-31T17:00:00Z");
  for(let i=0;i<400;i++){
    const id=createFriendlyBookingReference(fixedDate);
    assert.match(id,/^NBG-261031-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    result.add(id);
  }
  assert.equal(result.size,400);
});

test("older opaque references remain valid for protected Squeegee status and booking history",()=>{
  const date="2026-10-31T16:04:00.000Z";
  for(const bookingId of [
    "NBG-MVWLD81D-B7B2821F3E",
    "NBG-MVW4K9IF-6D53202757",
    "NBG-261031-2345678Z",
  ]){
    assert.equal(validateBookingSubmission({bookingId,submittedAt:date},
      {now:Date.parse(date)+1000}).ok,true,bookingId);
  }
  const status=readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewAutoStatus.mjs"),"utf8");
  assert.match(status,/NBG-\[A-Z0-9\]\+-\[A-Z0-9\]\{8,12\}/);
});

test("customer HTML booking confirmation prominently shows the same reference",()=>{
  const ref="NBG-261031-2345678Z";
  const html=buildBookingEmailHtml({
    bookingId:ref,
    name:"Example Customer",address:"11 Example Road, Bangor BT19 1AA",
    phone:"07700900222",
    bins:[{type:"Black Bin",count:3,planId:"domestic_4w"}],
    pricing:{total:15,subtotal:15,
      lines:[{type:"Black Bin",count:3,lineTotal:15,planLabel:"Every 4 weeks"}]},
    termsVersion:"August 2026",termsTimestamp:"2026-10-31T16:06:00Z",
    termsPdfAttached:true,
  });
  assert.match(html,/YOUR BOOKING REFERENCE/);
  assert.match(html,/NBG-261031-2345678Z/);
  assert.match(html,/Keep this reference if you need to contact us/);
  assert.match(html,/3 × Black Bin/);
  assert.match(html,/£15/);
  assert.equal((html.match(/NBG-261031-2345678Z/g)||[]).length,1);
  assert.doesNotMatch(buildBookingEmailHtml({
    name:"Example Customer",address:"11 Example Road",
  }),/YOUR BOOKING REFERENCE/);
  assert.doesNotMatch(buildBookingEmailHtml({
    bookingId:"<script>bad</script>",name:"Example Customer",
  }),/<script>bad<\/script>/);
});
