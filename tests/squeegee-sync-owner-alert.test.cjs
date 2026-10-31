"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {emailContent,notifyOwnerOfSyncHold}=
  require("../netlify/functions/lib/squeegeeSyncOwnerAlert");

test("ambiguous Squeegee match produces an owner-only manual review alert",async()=>{
  const bookingId="NBG-MVVCDC3D-83AB713D58";
  const a=emailContent(bookingId,"customer_match_ambiguous_or_incomplete",{
    matchReason:"possible_existing_address",
  });
  assert.match(a.subject,/CUSTOMER SIGN-UP NEEDS REVIEW/);
  assert.match(a.text,/Existing Squeegee status: not confirmed/i);
  assert.match(a.text,/verify whether it is inactive/i);
  assert.match(a.html,/Customer Sign-Up Needs Review/);
  assert.match(a.text,/possible_existing_address/);
  assert.match(a.text,/Do not ask them to submit another booking/i);
  assert.ok(!a.text.includes("78 Groomsport"));
  assert.ok(!a.text.includes("gav@"));
  let sent=null,invocations=0;
  const r=await notifyOwnerOfSyncHold(bookingId,
    "customer_match_ambiguous_or_incomplete",{
      matchReason:"possible_existing_address",
    },{
      env:{BOOKINGS_TO:"info@nibing.uy",RESEND_FROM:"NI Bin Guy <noreply@nibing.uy>"},
      send:async args=>{invocations++;sent=args;return {data:{id:"fake-message-id"}};},
    });
  assert.equal(r.sent,true);
  assert.equal(invocations,1);
  assert.deepEqual(sent.to,["info@nibing.uy"]);
  assert.equal(sent.text,a.text);
  assert.equal(sent.html,a.html);
});

test("only safe booking refs and finite hold reasons may appear in notices",async()=>{
  assert.equal(emailContent("garbage","held"),null);
  assert.equal(emailContent("NBG-ABCDE-ABCDEFGH","bad\nthing"),null);
  const result=await notifyOwnerOfSyncHold("invalid","some_reason",{},{
    send:()=>{throw new Error("should not be called");},
  });
  assert.equal(result.sent,false);
});

test("unconfigured provider and delivery failures never throw or request Squeegee retries",async()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  const reason="customer_match_ambiguous_or_incomplete";
  const missing=await notifyOwnerOfSyncHold(id,reason,{},{
    env:{},send:null,
  });
  assert.equal(missing.sent,false);
  let calls=0;
  const error=await notifyOwnerOfSyncHold(id,reason,{},{
    env:{BOOKINGS_TO:"info@nibing.uy"},
    send:()=>{calls++;throw new Error("test-only email failure");},
  });
  assert.equal(error.sent,false);
  assert.equal(calls,1);
});

test("worker holds and uncertainty both invoke best-effort alert, without any claim retry",()=>{
  const worker=fs.readFileSync(
    path.join(__dirname,"../netlify/functions/lib/squeegeeAutomaticBooking.js"),
    "utf8");
  assert.match(worker,/alert:deps\.alert\|\|/);
  assert.match(worker,/await use\.alert\(bookingId,reason,\{/);
  assert.match(worker,/\.\.\.extra,\.\.\.ownerEmailOnly,/);
  assert.match(worker,/await use\.alert\(bookingId,"requires_reconciliation"/);
  assert.match(worker,/matchReason:customerMatch\.reason/);
});


test("same-colour quantity and repeat-bin owner holds give actionable instructions without exposing PII",()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  const multiple=emailContent(id,"service_quantity_requires_manual_configuration",{
    requestedBinCounts:["2 x Brown Bin","1 x Blue Bin","<script>test</script>"],
  });
  assert.match(multiple.text,/Requested: 2 x Brown Bin/);
  assert.match(multiple.text,/manually create the correct service quantities/);
  assert.doesNotMatch(multiple.text,/<script>/);
  const repeat=emailContent(id,"existing_job_for_selected_bin_requires_review",{
    requestedBinCounts:["1 x Brown Bin"],
  });
  assert.match(repeat.text,/ADDITIONAL physical bin or an accidental repeat/);
  assert.match(repeat.text,/edit the existing Squeegee job/);
});

test("completed quantity booking owner notice states physical counts, limitations and extra job without customer data",async()=>{
  const {quantityBookedEmailContent,notifyOwnerOfQuantityBooking}=
    require("../netlify/functions/lib/squeegeeSyncOwnerAlert");
  const ref="NBG-ABCDE-ABCDEFGH";
  const details={requestedBinCounts:["2 x Black Bin","1 x Brown Bin","<script>alert(1)</script>"],
    additionalExistingBins:["brown"]};
  const msg=quantityBookedEmailContent(ref,details);
  assert.match(msg.subject,/Multiple bins synced/);
  assert.match(msg.text,/Booked: 2 x Black Bin/);
  assert.doesNotMatch(msg.text,/<script>/);
  assert.match(msg.text,/service quantity field/);
  assert.match(msg.text,/Existing jobs were not edited/);
  let sent;
  const outcome=await notifyOwnerOfQuantityBooking(ref,details,{
    env:{BOOKINGS_TO:"info@nibing.uy",RESEND_FROM:"NI Bin Guy <noreply@nibing.uy>"},
    send:async(args)=>{sent=args;return {data:{id:"fake"}};},
  });
  assert.equal(outcome.sent,true);
  assert.equal(sent.subject,msg.subject);
  assert.deepEqual(sent.to,["info@nibing.uy"]);
});

test("inactive re-sign-up sends a distinctive branded owner email with customer and booking details",async()=>{
  const booking="NBG-ABCDE-ABCDEFGH";
  const details={
    customerName:"A Returning Customer",
    serviceAddress:"11 Test Street, Bangor BT19 7ZW",
    customerEmail:"returning@example.org",
    customerPhone:"07700900123",
    squeegeeAccountStatus:"inactive",
    requestedBinCounts:["2 x Black Bin","1 x Brown Bin"],
    firstCleanDates:["2026-11-16","2026-11-16"],
    bookingTotal:15,
  };
  const content=emailContent(booking,"existing_customer_reactivation_required",details);
  assert.match(content.subject,/INACTIVE CUSTOMER SIGN-UP/);
  assert.match(content.text,/A Returning Customer/);
  assert.match(content.text,/11 Test Street/);
  assert.match(content.text,/Requested bin: 2 x Black Bin/);
  assert.match(content.text,/Proposed first clean: 2026-11-16/);
  assert.equal((content.text.match(/Proposed first clean:/g)||[]).length,1);
  assert.match(content.text,/£15.00/);
  assert.match(content.text,/No Squeegee customer or job was created/);
  assert.match(content.text,/reactivate them manually/);
  assert.match(content.html,/<table role="presentation"/);
  assert.match(content.html,/VIEW READ-ONLY BOOKING STATUS/);
  assert.match(content.html,/A Returning Customer/);
  const sent=[];
  const result=await notifyOwnerOfSyncHold(
    booking,"existing_customer_reactivation_required",details,{
      env:{BOOKINGS_TO:"info@nibing.uy",RESEND_FROM:"NI Bin Guy <noreply@nibing.uy>"},
      send:async m=>{sent.push(m);return {data:{id:"test-only"}};},
    });
  assert.equal(result.sent,true);
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].to,["info@nibing.uy"]);
  assert.equal(sent[0].html,content.html);
  assert.equal(sent[0].text,content.text);
});

test("deactivated and archived customer alerts are distinct from generic holds, but never imply automatic activation",()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  for(const status of ["deactivated","archived","deleted"]){
    const reason=status==="deactivated"?
      "existing_customer_reactivation_required":"existing_customer_inactive";
    const content=emailContent(id,reason,{
      squeegeeAccountStatus:status,
      customerName:"<img src=x onerror=alert(1)>",
      serviceAddress:"13 <Other> Avenue, Bangor BT19 7ZW",
      requestedBinCounts:["1 x Blue Bin","<script>bad</script>"],
    });
    assert.match(content.subject,/INACTIVE CUSTOMER SIGN-UP/);
    assert.match(content.text,new RegExp(status));
    assert.match(content.html,/&lt;img/);
    assert.doesNotMatch(content.html,/<img src=x/);
    assert.match(content.html,/&lt;Other&gt;/);
    assert.doesNotMatch(content.html,/<script>/);
    assert.match(content.text,/No Squeegee customer or job was created/);
    if(status!=="deactivated")
      assert.match(content.text,/review whether the account can be restored/);
  }
  assert.equal(emailContent("wrong","existing_customer_reactivation_required"),null);
});

test("generic sync holds use the same branded action-required design as inactive alerts",()=>{
  const content=emailContent("NBG-ABCDE-ABCDEFGH",
    "date_price_service_or_round_not_verified",{});
  assert.match(content.subject,/Squeegee booking needs review/);
  assert.match(content.html,/<table role="presentation"/);
  assert.match(content.html,/NI BIN GUY/);
  assert.match(content.html,/Squeegee Booking Needs Review/);
  assert.match(content.html,/VIEW BOOKING STATUS \(READ ONLY\)/);
  assert.match(content.text,/no new job was intentionally posted/i);
});

test("operational notices resolve the same default owner mailbox as normal booking emails",async()=>{
  const {resolveOwnerEmailSettings}=require("../netlify/functions/lib/squeegeeSyncOwnerAlert");
  assert.deepEqual(resolveOwnerEmailSettings({}),{
    from:"NI Bin Guy <noreply@nibing.uy>",
    to:["info@nibing.uy"],
  });
  assert.deepEqual(resolveOwnerEmailSettings({BOOKINGS_TO:"   "}).to,
    ["info@nibing.uy"]);
  assert.deepEqual(resolveOwnerEmailSettings({
    BOOKINGS_TO:"accounts@my-cleaning-business.example",
    RESEND_FROM:"New Name <noreply@nibing.uy>",
  }).to,["accounts@my-cleaning-business.example"]);
  const calls=[];
  const id="NBG-ABCDE-ABCDEFGH";
  const result=await notifyOwnerOfSyncHold(
    id,"existing_customer_reactivation_required",{
      customerName:"A Returning Customer",
      squeegeeAccountStatus:"inactive",
      requestedBinCounts:["1 x Brown Bin"],
    },{
      env:{RESEND_API_KEY:"fake-test-key-not-real"},
      send:async details=>{calls.push(details);return {data:{id:"unit-test"}};},
    });
  assert.equal(result.sent,true);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].to,["info@nibing.uy"]);
  assert.match(calls[0].subject,/INACTIVE CUSTOMER SIGN-UP/);
  assert.match(calls[0].html,/Inactive Customer Sign-Up/);
  // A configured recipient is optional; no impossible BOOKING_TO gate.
  const src=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/lib/squeegeeSyncOwnerAlert.js"),"utf8");
  assert.doesNotMatch(src,/!env\.BOOKINGS_TO/);
  assert.match(src,/!env\.RESEND_API_KEY/);
});

test("ambiguous returning customer gets detailed branded email without falsely claiming inactive",async()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  const details={
    matchReason:"possible_existing_address",
    customerName:"Example Customer",
    serviceAddress:"78 Groomsport Road, Bangor BT20 5NF",
    customerEmail:"example@example.org",
    customerPhone:"07700900123",
    squeegeeAccountStatus:"inactive", // not yet verified by Squeegee GET
    requestedBinCounts:["1 x Brown Bin"],
    firstCleanDates:["2026-11-16"],
    bookingTotal:5,
  };
  const draft=emailContent(id,"customer_match_ambiguous_or_incomplete",details);
  assert.match(draft.subject,/CUSTOMER SIGN-UP NEEDS REVIEW/);
  assert.doesNotMatch(draft.subject,/INACTIVE CUSTOMER/);
  assert.match(draft.text,/Existing Squeegee status: not confirmed/);
  assert.match(draft.text,/Customer matching issue: possible_existing_address/);
  assert.match(draft.text,/78 Groomsport Road/);
  assert.match(draft.text,/Requested bin: 1 x Brown Bin/);
  assert.match(draft.text,/£5\.00/);
  assert.match(draft.text,/confirm whether the correct account is inactive/);
  assert.match(draft.text,/No Squeegee customer or job was created/);
  assert.match(draft.html,/Customer Sign-Up Needs Review/);
  assert.match(draft.html,/Example Customer/);
  const sent=[];
  const result=await notifyOwnerOfSyncHold(id,
    "customer_match_ambiguous_or_incomplete",details,{
      env:{RESEND_API_KEY:"fake-test-key-not-real"},
      send:async email=>{sent.push(email);return {data:{id:"fake"}};},
    });
  assert.equal(result.sent,true);
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].to,["info@nibing.uy"]);
  assert.match(sent[0].html,/VIEW READ-ONLY BOOKING STATUS/);
  const hostile=emailContent(id,"customer_match_ambiguous_or_incomplete",{
    ...details,customerName:"<script>alert(1)</script>",
    matchReason:"<script>malicious</script>",
  });
  assert.doesNotMatch(hostile.html,/<script>/);
  assert.match(hostile.html,/&lt;script&gt;/);
  assert.doesNotMatch(hostile.html,/malicious/);
});

test("deployed modern Netlify worker injects the statically imported Resend email transport",()=>{
  const source=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  assert.match(source,/import \{Resend\} from "resend"/);
  assert.match(source,/import ownerAlerts from "\.\/lib\/squeegeeSyncOwnerAlert\.js"/);
  assert.match(source,/send:message=>provider\.emails\.send\(message\)/);
  for(const name of [
    "notifyOwnerOfSyncHold",
    "notifyOwnerOfDuplicateSignals",
    "notifyOwnerOfQuantityBooking",
  ])assert.ok(source.includes("ownerAlerts."+name));
});


test("completed Squeegee booking owner email uses the original signed email and company address only",async()=>{
  const {notifyOwnerOfCompletedBooking}=require(
    "../netlify/functions/lib/squeegeeSyncOwnerAlert");
  const ref="NBG-ABCDE-ABCDEFGH";
  const receipt={
    subject:"🗑️ New Bin Cleaning Booking (website)",
    text:"New Bin Cleaning Booking\nCustomer: A Customer\n1x Brown Bin",
    html:"<h2>New Bin Cleaning Booking</h2><p>"+("Verified booking. ".repeat(8))+"</p>",
    replyTo:"customer@example.org",
    termsBody:"These are the accepted business terms. ".repeat(6),
    binsText:"1 x Brown Bin (plan: domestic_4w)",
    pricingText:"1 x Brown Bin £5",
  };
  let sent=null;
  const result=await notifyOwnerOfCompletedBooking(ref,receipt,{
    env:{RESEND_FROM:"NI Bin Guy <noreply@nibing.uy>"},
    send:async message=>{sent=message;return{data:{id:"test-only"}};},
    attachments:[{filename:"signed-terms.pdf",content:"ZHVtbXk=",contentType:"application/pdf"}],
  });
  assert.equal(result.sent,true);
  assert.deepEqual(sent.to,["info@nibing.uy"]);
  assert.equal(sent.subject,receipt.subject);
  assert.equal(sent.text,receipt.text);
  assert.equal(sent.html,receipt.html);
  assert.equal(sent.replyTo,receipt.replyTo);
  assert.equal(sent.attachments[0].filename,"signed-terms.pdf");
  assert.equal(sent.from,"NI Bin Guy <noreply@nibing.uy>");
  assert.equal((await notifyOwnerOfCompletedBooking(ref,{subject:"invalid"},{
    send:async()=>{throw Error("must not send");},
  })).sent,false);
});

test("other held reasons include full customer details in ONE review email when normal receipt was deferred",()=>{
  const ref="NBG-ABCDE-ABCDEFGH";
  const r=emailContent(ref,"date_price_service_or_round_not_verified",{
    customerName:"Returning Customer",
    serviceAddress:"78 Groomsport Road, Bangor BT20 5NF",
    customerEmail:"person@example.org",customerPhone:"07700900123",
    firstCleanDates:["2026-11-16"],
    requestedBinCounts:["1 x Brown Bin"],bookingTotal:5,
  });
  assert.match(r.subject,/needs review/i);
  assert.match(r.text,/Customer: Returning Customer/);
  assert.match(r.text,/Service address: 78 Groomsport Road/);
  assert.match(r.text,/Email: person@example.org/);
  assert.match(r.text,/Phone: 07700900123/);
  assert.match(r.text,/Proposed first clean: 2026-11-16/);
  assert.match(r.text,/New booking total: £5.00/);
});


test("all non-import outcomes send clear, safe, customer-specific branded owner notices",()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  const reasons=[
    ["schedule_services_or_groups_unavailable","Council dates or Squeegee services unavailable"],
    ["date_price_service_or_round_not_verified","Cleaning date, round or price could not be verified"],
    ["booking_validation_failed","Booking details could not be validated"],
    ["grouped_job_price_or_service_mismatch","Bin grouping or total price mismatch"],
    ["conflicting_same_colour_schedules","Conflicting dates for the same bin colour"],
    ["automatic_sync_not_enabled","Automatic Squeegee syncing is unavailable"],
    ["outside_approved_preview_email_pilot","outside the current automatic Squeegee rollout"],
    ["dispatch_unavailable","Squeegee automatic handoff was unavailable"],
    ["existing_customer_details_unavailable","Existing Squeegee customer could not be verified"],
    ["booking_already_claimed_or_uncertain","Booking may already have been processed"],
    ["existing_customer_identity_unverified","Customer identity could not be confirmed"],
    ["property_bin_already_claimed_or_uncertain","A bin at this property may already be registered"],
  ];
  for(const [reason,label] of reasons){
    const out=emailContent(id,reason,{
      customerName:"Test Returning Customer",
      serviceAddress:"78 Groomsport Road, Bangor BT20 5NF",
      customerEmail:"returning@example.org",
      customerPhone:"07700900123",
      requestedBinCounts:["1 x Brown Bin","2 x Black Bin","<script>"],
      firstCleanDates:["2026-11-16","2026-11-16"],
      bookingTotal:15,
    });
    assert.match(out.subject,/Squeegee booking needs review/);
    assert.ok(out.text.includes(label),reason+" missing label");
    assert.match(out.text,/Booking reference: NBG-ABCDE-ABCDEFGH/);
    assert.match(out.text,/Customer: Test Returning Customer/);
    assert.match(out.text,/Service address: 78 Groomsport Road/);
    assert.match(out.text,/Email: returning@example.org/);
    assert.match(out.text,/Phone: 07700900123/);
    assert.match(out.text,/Requested: 2 x Black Bin/);
    assert.match(out.text,/Proposed first clean: 2026-11-16/);
    assert.equal((out.text.match(/Proposed first clean:/g)||[]).length,1);
    assert.match(out.text,/New booking total: £15\.00/);
    assert.match(out.text,/Do NOT submit a new website booking/);
    assert.match(out.html,/VIEW BOOKING STATUS/);
    assert.match(out.html,/background:#090909/);
    assert.match(out.html,/New booking total/);
    assert.ok(!out.html.includes("<script>"));
  }
});

test("Squeegee partial/uncertain import uses an URGENT message that never says nothing was created",()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  for(const reason of [
    "requires_reconciliation","partial_or_ambiguous_squeegee_write",
    "unexpected_auto_sync_failure","dispatch_uncertain_reconcile",
    "dispatch_not_accepted","worker_failed_unsafely_no_retry",
  ]){
    const out=emailContent(id,reason,{
      customerName:"<script>alert(1)</script>",
      serviceAddress:"78 <Other> Road, Bangor BT20 5NF",
      customerEmail:"customer@example.org",
      customerPhone:"07700900123",
      requestedBinCounts:["1 x Brown Bin"],
      firstCleanDates:["2026-11-16"],
      bookingTotal:5,
      jobsConfirmed:1,
      customerPostMayHaveSucceeded:true,
      jobPostMayHaveSucceeded:true,
      duplicateFlags:["address_already_registered"],
      blockedReasons:["date_not_verified","<script>"],
    });
    assert.match(out.subject,/URGENT: SQUEEGEE IMPORT UNCONFIRMED/);
    assert.match(out.text,/may already exist/);
    assert.match(out.text,/Jobs confirmed before problem: 1/);
    assert.match(out.text,/Duplicate flag:/);
    assert.match(out.text,/Date\/round check: date_not_verified/);
    assert.match(out.text,/Never automatically retry or recreate the entire booking/);
    assert.doesNotMatch(out.text,/No Squeegee customer or job was created/);
    assert.match(out.html,/URGENT/);
    assert.match(out.html,/&lt;script&gt;/);
    assert.match(out.html,/&lt;Other&gt;/);
    assert.doesNotMatch(out.html,/<script>/);
    assert.doesNotMatch(out.html,/Date\/round check: <script>/);
  }
});
test("unknown safe import reason also receives a branded manual review email",()=>{
  const out=emailContent("NBG-ABCDE-ABCDEFGH","unknown_safe_reason",{
    customerName:"Example",
  });
  assert.match(out.text,/Squeegee job not automatically confirmed/);
  assert.match(out.html,/Example/);
  assert.equal(emailContent("NBG-ABCDE-ABCDEFGH","malicious\nheader"),null);
});
