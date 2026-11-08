"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=relative=>fs.readFileSync(path.resolve(__dirname,"..",relative),"utf8");
const homepage=read("src/LandingPage.jsx");
const form=homepage.slice(homepage.indexOf("function BookingForm("),homepage.indexOf("function ContactForm("));
const sender=read("netlify/functions/sendBookingEmail.js");
const guard=read("netlify/functions/lib/bookingSubmissionGuard.js");
const owner=read("netlify/functions/squeegeePreviewAutoStatus.mjs");
test("customer booking errors are inline, actionable, and keep the submitted data",()=>{
  assert.doesNotMatch(form,/\balert\(/);
  assert.match(form,/setFieldErrors\(errors\)/);
  assert.match(form,/field\?\.focus\?\.\(\)/);
  assert.match(form,/Your entries have been kept/);
  assert.match(form,/renderFieldError\("name"\)/);
  assert.match(form,/renderFieldError\("email"\)/);
  assert.match(form,/renderFieldError\("address"\)/);
  assert.match(form,/renderFieldError\("phone"\)/);
  assert.match(form,/renderFieldError\("terms"\)/);
  assert.match(form,/emailSubmissionInFlightRef\.current = true/);
});
test("a Google suggestion without postcode can be completed manually, without guessing",()=>{
  assert.match(form,/Add your BT postcode/);
  assert.match(form,/findNiPostcode\(manualPostcode\)/);
  assert.match(form,/booking-postcode-helper/);
  assert.match(form,/setAddress\(current =>/);
  assert.match(form,/setPlaceId\(null\); \/\/ Street-only Google location/);
  assert.match(form,/We won't guess one/);
  const component=read("src/components/BookingAddressAutocomplete.jsx");
  assert.match(component,/aria-invalid=\{invalid\}/);
  assert.match(component,/setAddressNotice\(postal/);
});
test("security proof begins concurrently with council date lookup, before the one booking POST",()=>{
  const challenge=form.indexOf("const securityWork =");
  const schedule=form.indexOf("window.nbgEnsureBookingSchedule()");
  const verification=form.indexOf("const verified = await securityWork");
  const post=form.indexOf('fetch("/.netlify/functions/sendBookingEmail"');
  assert.ok(challenge>0&&challenge<schedule);
  assert.ok(schedule<verification&&verification<post);
  assert.match(form,/getPreviewBookingProof\(\)/);
  assert.match(form,/getRecaptchaToken\(recaptchaAction\)/);
});
test("eligible Squeegee handoff runs alongside Resend after atomic claim and audit",()=>{
  assert.ok(sender.indexOf("const claim = await claimBookingSubmission")<
    sender.indexOf("const squeegeeDispatchTask"));
  assert.ok(sender.indexOf("const auditPromise = buildAuditPromise")<
    sender.indexOf("const squeegeeDispatchTask"));
  assert.ok(sender.indexOf("const squeegeeDispatchTask")<
    sender.indexOf("const [adminResult, customerResult]"));
  assert.match(sender,/Promise\.resolve\(auditPromise\)/);
  assert.match(sender,/const dispatched=squeegeeDispatchTask/);
  assert.match(sender,/\? await squeegeeDispatchTask/);
  assert.match(sender,/await recordNoDispatch\(submission\.bookingId/);
});
test("the booking replay guard uses atomic CAS and never accepts a storage failure",()=>{
  assert.match(guard,/\{ onlyIfNew: true \}/);
  assert.match(guard,/reason: "booking_reservation_uncertain"/);
  assert.doesNotMatch(guard,/dedupeUnavailable: true/);
  assert.match(guard,/safeToRetry: notReady/);
});
test("owner review inbox remains behind one-time owner authentication and read-only GET",()=>{
  assert.ok(owner.indexOf("verifyTestSessionCookie(")<
    owner.indexOf('searchParams.get("review")'));
  assert.match(owner,/request\.method!=="GET"/);
  assert.match(owner,/reviewInbox\.findOwnerReviewItems/);
  assert.match(owner,/booking-submission-ids/);
  assert.doesNotMatch(owner,/\.post\(/);
});

test("customer booking receipt does not falsely claim a council date lookup failure",()=>{
  const {buildBookingEmailHtml}=require("../netlify/functions/lib/bookingEmailTemplate.js");
  const html=buildBookingEmailHtml({
    bookingId:"NBG-K7P4R2XM",
    name:"Test Booking",address:"1 Test Street, Bangor BT20 5NF",
    phone:"",bins:[{type:"Black Bin",count:1,planId:"4w"}],
    pricing:{total:5,subtotal:5,lines:[]},
    termsVersion:"2026-09",termsTimestamp:"2026-11-08T00:00:00Z",
    termsPdfAttached:true
  });
  assert.match(html,/Your first clean date is being checked against the collection schedule/);
  assert.match(html,/There's no need to send another booking request/);
  assert.doesNotMatch(html,/We couldn't automatically confirm your address or first clean date/);
});

test("customer receipt includes first-clean dates in HTML and plain text when council lookup matched",()=>{
  const {bookingReceiptDates,buildBookingEmailHtml}=
    require("../netlify/functions/lib/bookingEmailTemplate.js");
  const address="8 Example Street, Bangor BT20 5NF";
  const bins=[{type:"Black Bin",planId:"domestic_4w",count:1}];
  const snapshot={
    version:1,matched:true,postcode:"BT20 5NF",
    results:[{type:"Black Bin",automatic:true,assignedCleanDate:"2026-11-17"}],
  };
  const dates=bookingReceiptDates(snapshot,{address,bins});
  assert.deepEqual(dates,[{
    bin:"Black",isoDate:"2026-11-17",date:"Tuesday, 17 November 2026",
  }]);
  const html=buildBookingEmailHtml({
    bookingId:"NBG-K7P4R2XM",name:"Test Booking",address,bins,
    firstCleanDates:dates,pricing:{total:5,subtotal:5,lines:[]},
    termsVersion:"September 2026",termsTimestamp:"2026-11-08T00:00:00Z",
    termsPdfAttached:true,
  });
  assert.match(html,/YOUR FIRST CLEAN DATE/);
  assert.match(html,/Black: Tuesday, 17 November 2026/);
  assert.doesNotMatch(html,/The Squeegee appointment/);
  assert.doesNotMatch(html,/Your first clean date is being checked against the collection schedule/);
  assert.match(sender,/const firstCleanDates=bookingReceiptDates\(payload\.bookingScheduleSnapshot/);
  assert.match(sender,/const firstCleanDatesText=firstCleanDates\.length/);
  assert.match(sender,/\$\{firstCleanDatesText\}/);
  assert.match(sender,/firstCleanDates,\s*\}\)/);
});
test("customer receipt shows each clean date, never a mismatched or fabricated date",()=>{
  const {bookingReceiptDates,buildBookingEmailHtml}=
    require("../netlify/functions/lib/bookingEmailTemplate.js");
  const address="8 Example Street, Bangor BT20 5NF";
  const bins=[{type:"Black Bin"},{type:"Brown Bin"}];
  const snapshot={
    version:1,matched:true,postcode:"BT20 5NF",results:[
      {type:"Black Bin",automatic:true,assignedCleanDate:"2026-11-17"},
      {type:"Brown Bin",automatic:true,assignedCleanDate:"2026-11-18"},
    ],
  };
  const dates=bookingReceiptDates(snapshot,{address,bins});
  assert.equal(dates.length,2);
  const html=buildBookingEmailHtml({
    bookingId:"NBG-K7P4R2XM",name:"Test Booking",address,bins,
    firstCleanDates:dates,pricing:{total:10,subtotal:10,lines:[]},
    termsVersion:"September 2026",termsTimestamp:"2026-11-08T00:00:00Z",
  });
  assert.match(html,/Black: Tuesday, 17 November 2026/);
  assert.match(html,/Brown: Wednesday, 18 November 2026/);
  const inspect=(s,a=address,b=bins)=>bookingReceiptDates(s,{address:a,bins:b});
  assert.deepEqual(inspect({...snapshot,matched:false}),[]);
  assert.deepEqual(inspect({...snapshot,postcode:"BT20 5NG"}),[]);
  assert.deepEqual(inspect(snapshot,"8 Example Street, Bangor BT20 5NG"),[]);
  assert.deepEqual(inspect(snapshot,address,[{type:"Black Bin"}]),[]);
  assert.deepEqual(inspect({...snapshot,results:[
    {...snapshot.results[0],automatic:false},snapshot.results[1],
  ]}),[]);
  assert.deepEqual(inspect({...snapshot,results:[
    {...snapshot.results[0],assignedCleanDate:"2026-02-30"},snapshot.results[1],
  ]}),[]);
});
