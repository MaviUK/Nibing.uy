"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {recordNoDispatch}=require("../netlify/functions/lib/squeegeeBookingReviewTrace");
const {findOwnerReviewItems,reasonForReview,PREVIEW_HOST,STALE_MS}=
  require("../netlify/functions/lib/squeegeeOwnerReviewInbox");
const id="NBG-ABCDE-ABCDEFGH",id2="NBG-FGHIJ-HIJKLMNO";
function store(rows={}){
  const map=new Map(Object.entries(rows));
  return {
    map,async list(){return {blobs:[...map.keys()].map(key=>({key}))};},
    async get(key){return map.get(key)||null;},
    async setJSON(key,data,{onlyIfNew}={}){
      assert.equal(onlyIfNew,true);
      if(map.has(key))return {modified:false};
      map.set(key,data);return {modified:true,etag:'"v1"'};
    },
  };
}
const now=Date.parse("2026-11-03T18:00:00Z");
test("failed owner review alert stays in durable PII-free status",async()=>{
  const statuses=store();
  const result=await recordNoDispatch(id,{
    reason:"dispatch_uncertain_reconcile",ownerAlertDelivery:"not_sent",
  },{store:statuses});
  assert.equal(result.recorded,true);
  assert.deepEqual(Object.keys(statuses.map.get(id)).sort(),
    ["bookingId","ownerAlertDelivery","reason","stage","updatedAt"].sort());
  assert.equal(statuses.map.get(id).stage,"requires_reconciliation");
});
test("an existing worker receipt cannot be overwritten by sender fallback",async()=>{
  const statuses=store({[id]:{bookingId:id,stage:"accepted_for_validation"}});
  const r=await recordNoDispatch(id,{reason:"dispatch_uncertain_reconcile"},
    {store:statuses});
  assert.equal(r.recorded,false);
  assert.equal(statuses.map.get(id).stage,"accepted_for_validation");
});
test("owner inbox finds failed emails, held bookings and missing queue receipts",async()=>{
  const statuses=store({[id]:{bookingId:id,stage:"created_customer_and_jobs",
    updatedAt:"2026-11-03T17:50:00Z",ownerAlertDelivery:"not_sent"}});
  const claims=store({[id]:{bookingId:id,sourceHost:PREVIEW_HOST,
      claimedAt:"2026-11-03T17:49:00Z"},
    [id2]:{bookingId:id2,sourceHost:PREVIEW_HOST,
      claimedAt:"2026-11-03T17:40:00Z"}});
  const r=await findOwnerReviewItems({statusStore:statuses,claimStore:claims,now});
  assert.equal(r.items.length,2);
  assert.ok(r.items.some(x=>x.bookingId===id&&x.reason==="owner_alert_not_delivered"));
  assert.ok(r.items.some(x=>x.bookingId===id2&&x.reason==="accepted_booking_without_sync_receipt"));
});
test("no false alarm while worker is still active or after a successful email",()=>{
  assert.equal(reasonForReview({stage:"created_customer_and_jobs",ownerAlertDelivery:"sent"},null,now),null);
  assert.equal(reasonForReview({stage:"accepted_for_validation",updatedAt:new Date(now-1000).toISOString()},null,now),null);
  assert.equal(reasonForReview(null,{sourceHost:PREVIEW_HOST,
    claimedAt:new Date(now-STALE_MS-1).toISOString()},now),
    "accepted_booking_without_sync_receipt");
});
test("live-site claims never appear in preview owner inbox",async()=>{
  const r=await findOwnerReviewItems({
    statusStore:store({}),claimStore:store({[id]:{
      bookingId:id,sourceHost:"other",claimedAt:"2026-10-30T12:00:00Z",
    }}),now,
  });
  assert.equal(r.items.length,0);
});
test("invalid booking IDs are never persisted or presented",async()=>{
  const statuses=store();
  assert.equal((await recordNoDispatch("random email@evil.com",{},
    {store:statuses})).recorded,false);
  assert.equal(statuses.map.size,0);
});