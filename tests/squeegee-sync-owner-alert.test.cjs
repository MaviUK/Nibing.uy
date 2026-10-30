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
