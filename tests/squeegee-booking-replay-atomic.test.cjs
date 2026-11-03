"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {claimBookingSubmission,submissionErrorResponse}=
  require("../netlify/functions/lib/bookingSubmissionGuard");
const input={
  bookingId:"NBG-ABCDE-ABCDEFGH",
  submittedAt:"2026-11-03T15:00:00.000Z",
  serverReceivedAt:"2026-11-03T15:00:01.000Z",
  channel:"email",
};
function casStore(){
  const entries=new Map();let serial=0;
  return {
    entries,
    async setJSON(key,value,options={}){
      assert.equal(options.onlyIfNew,true);
      if(entries.has(key))return {modified:false};
      const etag='"'+(++serial)+'"';
      entries.set(key,{value,etag});
      return {modified:true,etag};
    },
  };
}
test("atomic receipt accepts exactly one concurrent booking submission",async()=>{
  const store=casStore();
  const receipts=await Promise.all(Array.from({length:12},
    ()=>claimBookingSubmission(input,{store})));
  assert.equal(receipts.filter(x=>x.ok).length,1);
  assert.equal(receipts.filter(x=>x.duplicate).length,11);
  assert.equal(store.entries.size,1);
});
test("booking guard fails closed when storage times out, rather than emailing twice",async()=>{
  const timedOut={async setJSON(){throw new Error("mock blob timeout");}};
  const result=await claimBookingSubmission(input,{store:timedOut});
  assert.equal(result.ok,false);
  assert.equal(result.reason,"booking_reservation_uncertain");
  const response=submissionErrorResponse({...input,...result});
  assert.equal(response.statusCode,503);
  assert.equal(JSON.parse(response.body).safeToRetry,false);
});
test("an ambiguous missing ETag fails closed and may not be replayed",async()=>{
  const result=await claimBookingSubmission(input,{
    store:{async setJSON(){return {modified:true,etag:""};}},
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,"booking_reservation_uncertain");
});
test("duplicate receipt is a 409 that retains original booking reference",async()=>{
  const store=casStore();
  await claimBookingSubmission(input,{store});
  const duplicate=await claimBookingSubmission(input,{store});
  const response=submissionErrorResponse({...input,...duplicate});
  assert.equal(response.statusCode,409);
  assert.equal(JSON.parse(response.body).bookingId,input.bookingId);
});
test("storage-not-ready response is retryable only when no reservation was attempted",()=>{
  const response=submissionErrorResponse({...input,reason:"booking_guard_not_ready"});
  assert.equal(response.statusCode,503);
  assert.equal(JSON.parse(response.body).safeToRetry,true);
});