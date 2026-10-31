"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {emailContent,notifyOwnerOfSyncHold}=
  require("../netlify/functions/lib/squeegeeSyncOwnerAlert");

test("held Squeegee import produces a concise action-needed owner alert with no customer PII",async()=>{
  const bookingId="NBG-MVVCDC3D-83AB713D58";
  const a=emailContent(bookingId,"customer_match_ambiguous_or_incomplete",{
    matchReason:"possible_existing_address",
  });
  assert.match(a.subject,/Squeegee booking needs review/);
  assert.match(a.text,/possible_existing_address/);
  assert.match(a.text,/Do NOT submit a new website booking/);
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
  assert.match(worker,/await use\.alert\(bookingId,reason,extra\)/);
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

test("ordinary sync holds stay plain-text and never inherit special customer details",()=>{
  const content=emailContent("NBG-ABCDE-ABCDEFGH",
    "date_price_service_or_round_not_verified",{});
  assert.match(content.subject,/Squeegee booking needs review/);
  assert.equal(content.html,undefined);
});
