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
  assert.match(booking,/aria-disabled=\{!termsConfirmed \|\| !agreeToTerms \|\| isEmailSubmitting \|\| bookingStatus !== "idle" \|\| emailBookingUncertain\}/);
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


test("only explicitly enabled preview or production bookings defer owner email",()=>{
  const server=fs.readFileSync(path.join(ROOT,"netlify/functions/sendBookingEmail.js"),"utf8");
  const transport=fs.readFileSync(path.join(ROOT,"netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  assert.match(server,/const isPreview1=syncHost===/);
  assert.match(server,/const previewSyncEnabled=isPreview1 &&/);
  assert.match(server,/const deferAdminForPreview=previewSyncEnabled &&/);
  assert.match(server,/const deferAdminForProduction=productionSyncEnabled &&/);
  assert.match(server,/autoDispatchConfigured\(process\.env\)/);
  assert.match(server,/rollout\.acceptedForRollout\(payload,"email",process\.env\)/);
  assert.match(server,/deferAdminForAuto\?\s*Promise\.resolve\(\{error:null,deferred:true\}\)/);
  assert.match(server,/ownerReceipt:deferAdminForAuto\?ownerReceipt:null/);
  assert.match(server,/if\(deferAdminForAuto && !deferredDispatchAccepted\)/);
  assert.match(server,/resend\.emails\.send\(previewSyncUnavailable\?/);
  assert.match(server,/resend\.emails\.send\(fallbackMessage\|\|adminEmailMessage\)/);
  assert.match(server,/const customerEmailPromise = email/);
  assert.match(transport,/completedAlert=ownerReceipt\?async\(id,details=\{\}\)=>/);
  assert.match(transport,/ownerAlerts\.notifyOwnerOfCompletedBooking/);
  assert.match(transport,/ownerAlerts\.notifyOwnerOfSyncHold/);
  assert.match(transport,/ownerCertificate\.loadCustomerCertificate/);
  assert.match(transport,/withActualOwnerCertificateStatus/);
  assert.doesNotMatch(transport,/import\("\.\/lib\/termsPdf\.js"\)/);
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
  assert.match(source,/if\(!quantityNeedsAttention && duplicateFlags\.length && !use\.completedAlert\)/);
  assert.match(egress,/completedAlert=ownerReceipt\?async\(id,details=\{\}\)=>/);
  assert.match(egress,/attention:?.*undefined|attachments,attention/);
  assert.match(alerts,/completedQuantityAttentionContent/);
  assert.match(alerts,/ACCOUNT NEEDS ATTENTION/);
  assert.match(source,/if\(quantityNeedsAttention && !use\.completedAlert\)/);
});


test("Preview 1 new booking reference is short, copyable, and included in customer confirmations",()=>{
  const helper=fs.readFileSync(path.join(ROOT,"src/bookingReference.mjs"),"utf8");
  const server=fs.readFileSync(path.join(ROOT,"netlify/functions/sendBookingEmail.js"),"utf8");
  const template=fs.readFileSync(path.join(ROOT,
    "netlify/functions/lib/bookingEmailTemplate.js"),"utf8");
  assert.match(landing,/import \{ createFriendlyBookingReference \} from "\.\/bookingReference\.mjs"/);
  assert.match(landing,/bookingId: createFriendlyBookingReference\(\)/);
  assert.match(helper,/SAFE_BASE32="23456789ABCDEFGHJKLMNPQRSTUVWXYZ"/);
  assert.doesNotMatch(helper,/Math\.random/);
  assert.match(booking,/Booking reference:/);
  assert.match(booking,/Copy booking reference/);
  assert.match(booking,/navigator\.clipboard\.writeText\(bookingConfirmation\.bookingId\)/);
  assert.match(booking,/setReferenceCopied\("copied"\)/);
  assert.match(server,/subject: \`🗑️ Booking received — \$\{submission\.bookingId\}\`/);
  assert.match(server,/Booking reference: \$\{submission\.bookingId\}/);
  assert.match(server,/bookingId: submission\.bookingId,\s*name,/);
  assert.match(template,/YOUR BOOKING REFERENCE/);
  assert.match(template,/Keep this reference if you need to contact us/);
});


test("owner booking receipt shows concise acceptance and attaches customer certificate PDF",()=>{
  const {buildOwnerTermsSummary}=require("../netlify/functions/lib/ownerBookingTermsSummary");
  const accepted=buildOwnerTermsSummary({
    termsAccepted:true,termsVersion:"August 2026",
    termsTimestamp:"2026-10-31T22:11:23.000Z",pdfAttached:true,
  });
  assert.match(accepted.text,/Terms & Conditions: Accepted/);
  assert.match(accepted.text,/Version: August 2026/);
  assert.match(accepted.text,/Certificate PDF attached \(customer copy\)/);
  assert.match(accepted.html,/Certificate PDF attached \(customer copy\)/);
  assert.doesNotMatch(accepted.html,/<pre|Terms agreed to|13-clean minimum|Acceptance line/i);
  const absent=buildOwnerTermsSummary({
    termsAccepted:true,termsVersion:"August 2026",pdfAttached:false,
  });
  assert.doesNotMatch(absent.text,/Certificate PDF attached/);
  assert.match(absent.text,/PDF not attached/);
  const escaped=buildOwnerTermsSummary({
    termsAccepted:true,termsVersion:'<script>alert("x")</script>',
    termsTimestamp:"2026-10-31T20:00:00.000Z",pdfAttached:true,
  });
  assert.doesNotMatch(escaped.html,/<script>/);
  assert.match(escaped.html,/&lt;script&gt;/);

  const sender=fs.readFileSync(path.join(ROOT,"netlify/functions/sendBookingEmail.js"),"utf8");
  const preview=fs.readFileSync(path.join(ROOT,"netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  assert.match(sender,/buildOwnerTermsSummary\(/);
  assert.match(sender,/\$\{ownerTerms\.text\}/);
  assert.match(sender,/\$\{ownerTerms\.html\}/);
  assert.doesNotMatch(sender,/function tosHtmlBlock\(/);
  assert.doesNotMatch(sender,/\$\{escapeHtml\(TERMS_BODY\)\}/);
  assert.match(sender,/const attachments = termsPdfAttachment \? \[termsPdfAttachment\] : undefined/);
  assert.match(sender,/to:TO_ADMIN,subject:subjectAdmin/);
  assert.match(sender,/replyTo:email\|\|undefined,attachments/);
  assert.match(sender,/to: email,/);
  assert.match(sender,/replyTo: TO_ADMIN,\s*attachments/);
  assert.match(sender,/ownerCertificate\.storeCustomerCertificate\(/);
  assert.match(preview,/ownerCertificate\.loadCustomerCertificate\(/);
  assert.match(preview,/ownerPdfSha256/);
  assert.match(preview,/ownerAlerts\.notifyOwnerOfCompletedBooking\(/);
  assert.match(preview,/id,verifiedOwnerReceipt,\{\.\.\.alertOptions,attachments,attention\}/);
});
