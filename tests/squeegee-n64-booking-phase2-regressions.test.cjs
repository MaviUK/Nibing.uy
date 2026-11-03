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
