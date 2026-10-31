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

test("existing-job merge owner email requests verified date/frequency before editing and never exposes PII",()=>{
  const id="NBG-ABCDE-ABCDEFGH";
  const detail=emailContent(id,"existing_job_merge_required",{
    requestedBinCounts:["1 x Blue Bin","2 x Brown Bin","<script>"],
    mergeFirstCleanDates:["2026-11-10","wrong"],
    mergeRoundNumbers:[17,99],
    newBookingPrice:15,
  });
  assert.match(detail.subject,/Edit existing Squeegee job/);
  assert.match(detail.text,/NO second job was created/);
  assert.match(detail.text,/Proposed first-clean date: 2026-11-10/);
  assert.match(detail.text,/Proposed round: 17/);
  assert.match(detail.text,/New booking amount per clean: £15.00/);
  assert.match(detail.text,/appointment date or recurrence/);
  assert.doesNotMatch(detail.text,/99|<script>|wrong/);
});
