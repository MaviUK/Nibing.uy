"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {validateBookingSubmission}=require("../netlify/functions/lib/bookingSubmissionGuard");
const {buildBookingEmailHtml}=require("../netlify/functions/lib/bookingEmailTemplate");
const {isPilotBooking,acceptedForRollout,PILOT_NAME}=
  require("../netlify/functions/lib/squeegeePreviewAutoRollout");
const {additionalBinKey}=require("../netlify/functions/lib/squeegeeIdempotencyClaims");
const {emailContent}=require("../netlify/functions/lib/squeegeeSyncOwnerAlert");

test("new customer booking references have exactly two sections and 40 bits of secure randomness",async()=>{
  const {createFriendlyBookingReference}=await import("../src/bookingReference.mjs");
  const fakeCrypto={getRandomValues:out=>{
    out.set([0,1,2,3,4,5,6,31]);return out;
  }};
  const code=createFriendlyBookingReference(fakeCrypto);
  assert.equal(code,"NBG-2345678Z");
  assert.equal(code.length,12);
  assert.equal(code.split("-").length,2);
  assert.match(code,/^NBG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.doesNotMatch(code.slice(4),/[IO01]/);
  const submittedAt="2026-10-31T16:06:00Z";
  assert.equal(validateBookingSubmission({bookingId:code,submittedAt},
    {now:Date.parse(submittedAt)+1000}).ok,true);
  assert.throws(()=>createFriendlyBookingReference(null),
    /secure_booking_reference_unavailable/);
  assert.throws(()=>createFriendlyBookingReference({getRandomValues:null}),
    /secure_booking_reference_unavailable/);
});

test("new references remain unique in repeated submissions, even during one second",async()=>{
  const {createFriendlyBookingReference}=await import("../src/bookingReference.mjs");
  const result=new Set();
  for(let i=0;i<1000;i++){
    const id=createFriendlyBookingReference();
    assert.match(id,/^NBG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    result.add(id);
  }
  assert.equal(result.size,1000);
});

test("legacy booking IDs stay supported but a date-only ID is rejected to prevent collisions",()=>{
  const date="2026-10-31T16:04:00.000Z", now=Date.parse(date)+1000;
  for(const bookingId of [
    "NBG-MVWLD81D-B7B2821F3E",
    "NBG-MVW4K9IF-6D53202757",
    "NBG-261031-2345678Z",
    "NBG-K7P4R2XM",
  ])assert.equal(validateBookingSubmission({bookingId,submittedAt:date},
    {now}).ok,true,bookingId);
  for(const bookingId of [
    "NBG-261031","NBG-ABCDEFG","NBG-2345678O",
    "NBG-23456780","NBG-23456781","NBG-2345678I",
    "NBG-TOO-LONG-FOR-CUSTOMERS",
  ])assert.equal(validateBookingSubmission({bookingId,submittedAt:date},
    {now}).ok,false,bookingId);
  const status=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewAutoStatus.mjs"),"utf8");
  assert.match(status,/const bookingRe=\/\^NBG-\(\?:/);
  assert.match(status,/A-Z0-9\]\{8,12\}/);
});

test("Squeegee pilot matching and immutable additional-bin claims accept new two-section reference",()=>{
  const bookingId="NBG-K7P4R2XM";
  const booking={
    bookingId,name:PILOT_NAME,termsAccepted:true,
    address:"11 Ballycrochan Avenue, Bangor BT19 7LA",
    bins:[{type:"Brown Bin",planId:"domestic_4w",count:1}],
  };
  assert.equal(isPilotBooking(booking,"email"),true);
  assert.equal(acceptedForRollout(booking,"email",{}),true);
  assert.equal(isPilotBooking({...booking,bookingId:"NBG-261031"},"email"),false);
  const key=additionalBinKey(booking,{type:"Black Bin"});
  assert.match(key,/^claim-v1\/additional-bin\/[a-f0-9]{64}$/);
});

test("owner's branded review emails accept new short canonical reference",()=>{
  const ref="NBG-K7P4R2XM";
  const email=emailContent(ref,"customer_match_ambiguous_or_incomplete",{
    customerName:"Test Example",
    serviceAddress:"11 Ballycrochan Avenue, Bangor BT19 7LA",
    customerEmail:"example@example.org",
    requestedBinCounts:["2 x Black Bin"],
  });
  assert.ok(email);
  assert.match(email.subject,/NBG-K7P4R2XM/);
  assert.match(email.html,/NBG-K7P4R2XM/);
});

test("customer HTML email prominently shows the same two-section reference",()=>{
  const ref="NBG-K7P4R2XM";
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
  assert.match(html,/NBG-K7P4R2XM/);
  assert.match(html,/Keep this reference if you need to contact us/);
  assert.match(html,/3 × Black Bin/);
  assert.match(html,/£15/);
  assert.equal((html.match(/NBG-K7P4R2XM/g)||[]).length,1);
  const legacy=buildBookingEmailHtml({
    bookingId:"NBG-261031-2345678Z",name:"Legacy Booking",
  });
  assert.match(legacy,/NBG-261031-2345678Z/);
  assert.doesNotMatch(buildBookingEmailHtml({
    name:"Example Customer",address:"11 Example Road",
  }),/YOUR BOOKING REFERENCE/);
  assert.doesNotMatch(buildBookingEmailHtml({
    bookingId:"<script>bad</script>",name:"Example Customer",
  }),/<script>bad<\/script>/);
});


test("short reference completes Squeegee booking planning AND job grouping using the correct website date",()=>{
  const {prepareReadOnlyBooking}=
    require("../netlify/functions/lib/squeegeeBookingPreparation");
  const {groupedSqueegeeJobs}=
    require("../netlify/functions/lib/squeegeeJobGrouping");
  const ref="NBG-XGU9MPEE";
  const date="2026-11-02",post="BT20 4AA";
  const b={
    bookingId:ref,name:"Example Customer",email:"example@example.org",
    phone:"07000000000",address:"17 Example Street, Bangor "+post,
    bins:[{type:"Black Bin",count:1,planId:"domestic_4w"}],
    pricing:{
      lines:[{idx:0,type:"Black Bin",count:1,planId:"domestic_4w",
        baseUnit:5,unitPrice:5,lineTotal:5,freeCount:0,
        multiBuyDiscount:0,discounted:false}],
      subtotal:5,total:5,multiBuyFreeBins:0,multiBuyDiscount:0,
    },
    bookingScheduleSnapshot:{
      version:1,postcode:post,
      results:[{type:"Black Bin",automatic:true,assignedCleanDate:date}],
    },
  };
  const schedule={
    postcode:post,town:"BANGOR",
    results:[{bin:"Black Bin",town:"BANGOR",
      automatic:true,assignedCleanDate:date}],
  };
  const black="11111111-1111-4111-8111-111111111111";
  const group="22222222-2222-4222-8222-222222222222";
  for(const bookingId of [ref,"NBG-261031-K7P4R2XM",
     "NBG-MVWLD81D-B7B2821F3E"]){
    const checked=prepareReadOnlyBooking({...b,bookingId},
      schedule,[{id:black,description:"Black"}],{
        jobGroups:[{id:group,description:"11"}],
      });
    assert.equal(checked.status,"prepared_read_only",bookingId);
    assert.equal(checked.summary.datesVerified,true,bookingId);
    assert.equal(checked.summary.pricingVerified,true,bookingId);
    assert.deepEqual(checked.summary.blockedReasons,[],bookingId);
    assert.equal(checked.privatePlan.readyJobs,1,bookingId);
    assert.equal(checked.privatePlan.jobs[0].date,date,bookingId);
    const grouped=groupedSqueegeeJobs(checked.privatePlan.jobs,bookingId);
    assert.equal(grouped.length,1);
    assert.equal(grouped[0].input.price,5);
    assert.equal(grouped[0].input.date,date);
    assert.equal(grouped[0].input.jobGroup,group);
  }
});

test("new short IDs also work in arcade booking recovery and owner-code status return",async()=>{
  const {getBookingTimestamp}=require("../netlify/functions/arcadeRecoverBooking");
  assert.deepEqual(getBookingTimestamp("NBG-XGU9MPEE"),
    {id:"NBG-XGU9MPEE",stamped:null});
  assert.deepEqual(getBookingTimestamp("nbg-k7p4r2xm"),
    {id:"NBG-K7P4R2XM",stamped:null});
  assert.deepEqual(getBookingTimestamp("NBG-261031-K7P4R2XM"),
    {id:"NBG-261031-K7P4R2XM",stamped:null});
  assert.equal(getBookingTimestamp("NBG-261031"),null);
  const {safeOwnerReturnPath}=await import(
    "../netlify/functions/squeegeePreviewTest.mjs");
  const url="/api/squeegee-preview-auto-status?bookingId=NBG-XGU9MPEE";
  assert.equal(safeOwnerReturnPath(url),url);
  assert.equal(safeOwnerReturnPath(url.toLowerCase()),url);
  assert.equal(safeOwnerReturnPath(url+"&next=https://evil.example"),null);
});
