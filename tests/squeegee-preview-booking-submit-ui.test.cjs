"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const ROOT=path.resolve(__dirname,"..");
const landing=fs.readFileSync(path.join(ROOT,"src/LandingPage.jsx"),"utf8");
const harden=fs.readFileSync(path.join(ROOT,"scripts/hardenBookingSubmissions.cjs"),"utf8");
const start=landing.indexOf("function BookingForm(");
const finish=landing.indexOf("function ContactForm(",start);
assert.ok(start>0 && finish>start,"BookingForm and ContactForm must remain independent");
const booking=landing.slice(start,finish);
const contact=landing.slice(finish);

test("booking offers exactly one customer action named Submit Booking",()=>{
  assert.match(booking,/onClick=\{handleSubmitBooking\}/);
  assert.match(booking,/isEmailSubmitting \? bookingSendingText : "Submit Booking"/);
  assert.equal((booking.match(/onClick=\{handleSubmitBooking\}/g)||[]).length,1);
  assert.ok(!booking.includes("Send via Email"));
  assert.ok(!booking.includes("Send via WhatsApp"));
  assert.ok(!booking.includes("handleSendWhatsApp"));
  assert.ok(!booking.includes("handleSendEmail"));
});

test("new one-button booking keeps its signed preview security, anti-duplicate and success UI",()=>{
  assert.match(booking,/emailSubmissionInFlightRef\.current = true/);
  assert.match(booking,/emailSubmissionRef\.current \|\| createBookingSubmissionMeta\(\)/);
  assert.match(booking,/getPreviewBookingProof\(\)/);
  assert.match(booking,/getRecaptchaToken\(recaptchaAction\)/);
  assert.match(booking,/fetch\("\/\.netlify\/functions\/sendBookingEmail"/);
  assert.match(booking,/emailSubmissionMeta/);
  assert.match(booking,/setBookingStatus\("confirmed"\)/);
  assert.match(booking,/Booking confirmed/);
  assert.match(booking,/Booking reference:/);
  assert.match(booking,/aria-busy=\{isEmailSubmitting\}/);
  assert.match(booking,/animate-spin/);
  assert.match(booking,/aria-disabled=\{!agreeToTerms \|\| isEmailSubmitting \|\| bookingStatus !== "idle" \|\| emailBookingUncertain\}/);
  assert.match(booking,/setEmailBookingUncertain\(true\)/);
  assert.match(booking,/TermsModal/);
});

test("no extra booking writes via WhatsApp or retired supervised test endpoint",()=>{
  assert.ok(!booking.includes("sendTosReceipt"));
  assert.ok(!booking.includes("/api/squeegee-preview-test-submit"));
  assert.ok(!booking.includes("nbgSqTestArmed"));
  assert.ok(!booking.includes("window.open("));
  assert.ok(!booking.includes("sendBeacon"));
  assert.ok(!booking.includes("whatsapp://"));
  assert.ok(!booking.includes("intent://send"));
  // The Contact Us form remains a separate workflow and still offers WhatsApp.
  assert.match(contact,/const handleWhatsApp = \(\) =>/);
  assert.match(contact,/https:\/\/wa\.me\//);
});

test("build hardening cannot reintroduce the old WhatsApp booking choice",()=>{
  assert.ok(!harden.includes("WhatsApp submission metadata"));
  assert.ok(!harden.includes("const submissionMeta = createBookingSubmissionMeta();"));
  assert.match(harden,/const emailSubmissionMeta = emailSubmissionRef\.current \|\| createBookingSubmissionMeta\(\)/);
});

test("server booking still emails receipts, awards XP and optionally dispatches signed Squeegee sync",()=>{
  const server=fs.readFileSync(path.join(ROOT,"netlify/functions/sendBookingEmail.js"),"utf8");
  const dispatch=fs.readFileSync(path.join(ROOT,"netlify/functions/lib/squeegeePreviewAutoDispatch.js"),"utf8");
  assert.match(server,/await claimBookingSubmission/);
  assert.match(server,/adminEmailPromise/);
  assert.match(server,/customerEmailPromise/);
  assert.match(server,/autoEnrollBooking\(payload\)/);
  assert.match(server,/await dispatchAcceptedBooking\(payload/);
  assert.match(dispatch,/autoDispatchConfigured/);
  assert.match(dispatch,/squeegeePreviewAutoRollout/);
  const rollout=fs.readFileSync(path.join(ROOT,"netlify/functions/lib/squeegeePreviewAutoRollout.js"),"utf8");
  assert.match(rollout,/SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED/);
  assert.match(rollout,/PILOT_CLAIM_KEY/);
});


test("fresh test confirmation reports queue acceptance without claiming job creation or requiring OTP",()=>{
  const server=fs.readFileSync(path.join(ROOT,"netlify/functions/sendBookingEmail.js"),"utf8");
  assert.match(server,/const isPreview1=syncHost===/);
  assert.match(server,/const freshPilot=name===PILOT_NAME/);
  assert.match(server,/if\(isPreview1\) \{/);
  assert.match(server,/if\(isPreview1\) squeegeePilot=\{queued:false/);
  assert.match(booking,/bookingConfirmation\?\.squeegeePilot \? "Booking received"/);
  assert.match(server,/squeegeePilot=\{/);
  assert.match(server,/queued:dispatched.queued===true/);
  assert.match(server,/squeegeePilot,/);
  assert.match(server,/reason:dispatched.reason/);
  assert.match(booking,/bookingConfirmation\?\.squeegeePilot/);
  assert.match(booking,/Squeegee test handoff/);
  assert.match(booking,/Accepted for Squeegee validation/);
  assert.match(booking,/does not yet confirm a customer or job was created/);
  assert.match(booking,/Do not submit another booking/);
  // The customer-facing Submit Booking path never asks for an owner access
  // code, opens a second recovery tab, or calls a Squeegee POST itself.
  assert.ok(!booking.includes("Arm one test booking"));
  assert.ok(!booking.includes("squeegee-preview-auto-recover"));
  assert.ok(!booking.includes("squeegee-preview-auto-sync"));
});


test("booking confirmation does not block customers buying extra bins",()=>{
  assert.ok(!booking.includes("Extra bins of the same colour need manual confirmation"));
  assert.ok(!booking.includes("requiresManualQuantityCheck"));
  assert.match(booking,/Booking confirmed/);
  assert.match(booking,/Booking reference:/);
});

test("Preview 1 allows a slow date lookup to finish but never invents a confirmed date",()=>{
  const bridge=fs.readFileSync(path.join(ROOT,"src/bookingScheduleBridge.js"),"utf8");
  assert.match(booking,/const previewScheduleWait=window\.location\.hostname===N64_BOOKING_PREVIEW_HOST/);
  assert.match(booking,/\? 22000 : 5500/);
  assert.match(booking,/bookingScheduleSnapshot: window\.nbgGetBookingScheduleSnapshot\?\.\(\) \|\| null/);
  assert.match(bridge,/if \(latestLookupPromise\) return latestLookupPromise/);
  assert.match(bridge,/if \(latestLookupData\) return latestLookupData/);
  assert.match(bridge,/root\.addEventListener\("input", relevantChange\)/);
  assert.match(bridge,/field===addressField \|\| findBinSelects\(root\)\.includes\(field\)/);
  const fn=bridge.slice(bridge.indexOf("function lookupKey("),bridge.indexOf("function positionPanel("));
  assert.doesNotMatch(fn,/\.sort\(/);
});


test("only accepted Preview 1 bookings defer the normal owner booking email",()=>{
  const server=fs.readFileSync(path.join(ROOT,"netlify/functions/sendBookingEmail.js"),"utf8");
  const transport=fs.readFileSync(path.join(ROOT,"netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  assert.match(server,/const isPreview1=syncHost===/);
  assert.match(server,/const deferAdminForPreview=isPreview1 &&/);
  assert.match(server,/autoDispatchConfigured\(process\.env\)/);
  assert.match(server,/rollout\.acceptedForRollout\(payload,"email",process\.env\)/);
  assert.match(server,/deferAdminForPreview\?\s*Promise\.resolve\(\{error:null,deferred:true\}\)/);
  assert.match(server,/ownerReceipt:deferAdminForPreview\?ownerReceipt:null/);
  assert.match(server,/if\(deferAdminForPreview && !deferredDispatchAccepted\)/);
  assert.match(server,/resend\.emails\.send\(previewSyncUnavailable\?/);
  assert.match(server,/resend\.emails\.send\(fallbackMessage\|\|adminEmailMessage\)/);
  assert.match(server,/const customerEmailPromise = email/);
  assert.match(transport,/completedAlert=ownerReceipt\?async\(id\)=>/);
  assert.match(transport,/ownerAlerts\.notifyOwnerOfCompletedBooking/);
  assert.match(transport,/ownerAlerts\.notifyOwnerOfSyncHold/);
  assert.match(transport,/terms\.buildTermsAcceptancePdfAttachment/);
  assert.match(transport,/ownerNoticeAttempted/);
  assert.match(transport,/getStore/);
  // No website change can ever send an additional owner email itself.
  assert.ok(!booking.includes("squeegee-preview-auto-sync"));
});


test("a failed Squeegee handoff gives the owner one REVIEW email, not a normal successful receipt",()=>{
  const handler=fs.readFileSync(path.join(ROOT,
    "netlify/functions/sendBookingEmail.js"),"utf8");
  const egress=fs.readFileSync(path.join(ROOT,
    "netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  assert.match(handler,/emailContent:buildOwnerReviewEmail/);
  assert.match(handler,/const reviewOwnerMessage=/);
  assert.match(handler,/const previewSyncUnavailable=isPreview1 && !deferAdminForPreview/);
  assert.match(handler,/resend\.emails\.send\(previewSyncUnavailable\?/);
  assert.match(handler,/const uncertain=dispatchFailureReason===/);
  assert.match(handler,/resend\.emails\.send\(fallbackMessage\|\|adminEmailMessage\)/);
  assert.match(egress,/const rescueOwnerNotice=async/);
  assert.match(egress,/await rescueOwnerNotice\(result\?\.reason\|\|/);
  assert.match(egress,/await auto\.saveAutoStatus\(bookingId,stage/);
  assert.match(egress,/ownerNoticeAttempted/);
  assert.match(egress,/if\(result\?\.status==="completed"\)/);
});


test("successful Squeegee imports with repeated Black bins send one owner quantity email",()=>{
  const source=fs.readFileSync(path.join(ROOT,
    "netlify/functions/lib/squeegeeAutomaticBooking.js"),"utf8");
  const egress=fs.readFileSync(path.join(ROOT,
    "netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  const alerts=fs.readFileSync(path.join(ROOT,
    "netlify/functions/lib/squeegeeSyncOwnerAlert.js"),"utf8");
  assert.match(source,/const quantityChanges=/);
  assert.match(source,/quantityAttentionRequired:quantityNeedsAttention/);
  assert.match(source,/use\.completedAlert\(bookingId,\{/);
  assert.match(source,/if\(quantityNeedsAttention && !use\.completedAlert\)/);
  assert.match(source,/if\(!quantityNeedsAttention && duplicateFlags\.length\)/);
  assert.match(egress,/completedAlert=ownerReceipt\?async\(id,details=\{\}\)=>/);
  assert.match(egress,/attention:?.*undefined|attachments,attention/);
  assert.match(alerts,/completedQuantityAttentionContent/);
  assert.match(alerts,/ACCOUNT NEEDS ATTENTION/);
  assert.match(source,/if\(quantityNeedsAttention && !use\.completedAlert\)/);
});
