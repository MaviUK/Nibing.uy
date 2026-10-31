"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const h=require("../netlify/functions/lib/squeegeeHeldGroomsportRecovery");
const {verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
const {addressKey}=require("../netlify/functions/lib/squeegeeCustomerMatcher");
function audit(){
  const bins=[{type:"Blue Bin",planId:"domestic_oneoff",count:1}];
  const pricing=verifyAndPriceBooking(bins,"",{}).canonical;
  return {
    bookingId:h.BOOKING_ID,channel:"email",createdAt:"2026-10-31T20:36:42Z",
    name:"Gavin",email:"example@example.org",phone:"07555178484",
    address:"78 Groomsport Rd, Bangor BT20 5NF",
    bins,pricing,termsAccepted:true,
    bookingScheduleSnapshot:{
      version:1,postcode:"BT20 5NF",
      results:[{type:"Blue Bin",assignedCleanDate:"2026-11-10"}],
    },
  };
}
test("only this originally accepted £15 Blue one-off booking may be replayed",()=>{
  const a=h.acceptedAudit(audit());
  assert.equal(a.ok,true);
  assert.equal(a.booking.bookingId,h.BOOKING_ID);
  assert.equal(a.booking.submittedAt,audit().createdAt);
  assert.equal(a.booking.pricing.total,15);
  const mutations=[
    {bookingId:"NBG-OTHER-ID-12345678"}, {createdAt:"2026-11-01T20:36:42Z"},
    {name:"Different Resident"},{address:"79 Groomsport Rd, Bangor BT20 5NF"},
    {bins:[{type:"Brown Bin",planId:"domestic_oneoff",count:1}]},
    {pricing:{total:15,lines:[]}},{termsAccepted:false},
  ];
  for(const item of mutations)assert.equal(h.acceptedAudit({...audit(),...item}).ok,false);
  const wrongDate=audit();
  wrongDate.bookingScheduleSnapshot.results[0].assignedCleanDate="2026-11-17";
  assert.equal(h.acceptedAudit(wrongDate).ok,false);
});
test("original status must be held before any POST or claim",()=>{
  const s={bookingId:h.BOOKING_ID,stage:"held_for_review",
    reason:"customer_match_ambiguous_or_incomplete",
    matchReason:"possible_existing_address"};
  assert.equal(h.heldBeforeAnyWrite(s,null,null),true);
  for(const extra of [
    {stage:"requires_reconciliation"},
    {stage:"created_customer_and_jobs"},
    {matchReason:"different_address"},
    {reason:"job_post_uncertain"},
    {jobsConfirmed:1},{bookingId:"NBG-OTHER-ID-12345678"},
  ])assert.equal(h.heldBeforeAnyWrite({...s,...extra},null,null),false);
  assert.equal(h.heldBeforeAnyWrite(s,{state:"reserved"},null),false);
  assert.equal(h.heldBeforeAnyWrite(s,null,{state:"reserved"}),false);
});
test("existing County Down address matches, different house or street cannot",()=>{
  const b=h.acceptedAudit(audit()).booking;
  const existing={name:"Gavin",status:"active",address:{
    addressDescription:"78 Groomsport Road, Bangor, County Down, BT20 5NF"}};
  assert.equal(h.existingCustomerMatches(existing,b),true);
  assert.equal(h.existingCustomerMatches({...existing,status:"inactive"},b),false);
  assert.equal(h.existingCustomerMatches({...existing,name:"Another"},b),false);
  assert.equal(h.existingCustomerMatches({...existing,address:{text:
    "79 Groomsport Road, Bangor BT20 5NF"}},b),false);
  assert.equal(h.existingCustomerMatches({...existing,address:{text:
    "78 Another Road, Bangor BT20 5NF"}},b),false);
  assert.equal(addressKey(existing.address),addressKey(b.address));
});
test("do not import when exact job reference or date+service already exists",()=>{
  const uuid="11111111-1111-4111-8111-111111111114";
  const oldJob={notes:"Prior work",date:"2025-08-12",
    services:[{_id:uuid,quantity:1}]};
  assert.equal(h.existingJobsSafe([oldJob],uuid),true);
  assert.equal(h.existingJobsSafe([{
    ...oldJob,notes:"original "+h.BOOKING_ID,
  }],uuid),false);
  assert.equal(h.existingJobsSafe([{...oldJob,date:h.CLEAN_DATE}],uuid),false);
  assert.equal(h.existingJobsSafe([{...oldJob,date:h.CLEAN_DATE,
    services:["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}],uuid),true);
  assert.equal(h.existingJobsSafe(null,uuid),false);
  assert.equal(h.existingJobsSafe([{services:null}],uuid),false);
});
test("prepared job must be one-off £15 Blue on 10 November and future",()=>{
  const job={status:"ready",date:h.CLEAN_DATE,
    input:{frequencyType:"adhoc",price:15,jobGroup:"22222222-2222-4222-8222-222222222222",
      services:["11111111-1111-4111-8111-111111111114"]}};
  const p={status:"prepared_read_only",summary:{blockedReasons:[]},
    privatePlan:{readyJobs:1,blockedJobs:0,jobs:[job]}};
  const at=Date.parse("2026-10-31T21:00:00Z");
  assert.equal(h.validPreparedPlan(p,at),true);
  assert.equal(h.validPreparedPlan(p,Date.parse("2026-11-11T00:00:00Z")),false);
  assert.equal(h.validPreparedPlan({...p,summary:{blockedReasons:["unmapped_squeegee_services"]}},at),false);
  assert.equal(h.validPreparedPlan({...p,privatePlan:{...p.privatePlan,jobs:[{
    ...job,input:{...job.input,price:45}}]}},at),false);
});
test("owner-only route uses original audited booking and normal immutable worker claims",()=>{
  const code=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewHeldGroomsportRecovery.mjs"),"utf8");
  const auth=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewTest.mjs"),"utf8");
  assert.match(code,/path:"\/api\/squeegee-preview-held-groomsport-recovery"/);
  assert.match(code,/api\.isExactPreview1\(process\.env,scope\)/);
  assert.match(code,/ownerIsAuthenticated\(request,scope\)/);
  assert.match(code,/session\.verifyTestSessionCookie/);
  assert.match(code,/validToken\(form\.get\("csrf"\),request\)/);
  assert.match(code,/form\.get\("confirm"\)!=="yes"/);
  assert.match(code,/claims\.claimOnce\(/);
  assert.match(code,/claims\.changeClaimState/);
  assert.match(code,/auto\.executeAutomaticPreviewBooking\(/);
  assert.match(code,/now:check\.originalAcceptedAt/);
  assert.match(code,/return page\(html\)/);
  assert.doesNotMatch(code,/api\.createCustomer\(/);
  // A recovery must never make a new customer, even if Squeegee list results
  // change between preview and POST.
  assert.match(code,/createCustomer:async\(\)=>/);
  assert.match(code,/owner_recovery_new_customer_not_permitted/);
  assert.match(code,/if\(id!==check\.customerId\)/);
  assert.match(code,/api\.getCustomer\(id\)/);
  assert.match(code,/api\.addJobToCustomer\(id,input\)/);
  assert.match(code,/existingJobsSafe\(latest\.jobs,check\.serviceId\)/);
  assert.doesNotMatch(code,/withApprovedPreviewAutomaticWrite\(.*=>/);
  assert.doesNotMatch(code,/Request origin could not be verified/);
  assert.match(auth,/value==="\/api\/squeegee-preview-held-groomsport-recovery"/);
});
