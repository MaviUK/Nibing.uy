"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const p=require("../netlify/functions/lib/squeegeePartialGreenReconciliation");
const {verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
const autoApi=require("../netlify/functions/lib/squeegeeApiV3");
const scope={hostname:"deploy-preview-77--nibinguy.netlify.app",
  deployContext:"deploy-preview",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84"};
const env={SQUEEGEE_API_KEY:"mock-test-only-api-key-not-real-123456",
  SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"true"};
const sid="11111111-1111-4111-8111-111111111111";
const bid="22222222-2222-4222-8222-222222222222";
const gid="33333333-3333-4333-8333-333333333333";
function audit(){
 const bins=[
  {type:"Black Bin",planId:"domestic_4w",count:1},
  {type:"Brown Bin",planId:"domestic_4w",count:1},
  {type:"Green Bin",planId:"comm_gt660_oneoff",sizeLitres:1100,count:1},
 ];
 return{
  bookingId:p.BOOKING_ID,channel:"email",
  createdAt:"2026-10-31T21:24:07.000Z",
  name:"Gavin Stevenson",email:"example@example.org",phone:"07555178484",
  address:"78 Groomsport Rd, Bangor BT20 5NF",termsAccepted:true,
  bins,pricing:verifyAndPriceBooking(bins,"",{}).canonical,
  bookingScheduleSnapshot:{postcode:"BT20 5NF",results:bins.map(
   bin=>({bin:bin.type,assignedCleanDate:"2026-11-17"}))},
 };
}
function planned(){
 const b=audit();
 return{status:"prepared_read_only",summary:{
   blockedReasons:[],datesVerified:true,pricingVerified:true,
 },privatePlan:{readyJobs:3,blockedJobs:0,jobs:b.bins.map((bin,index)=>({
   index,bin:bin.type,sizeLitres:bin.sizeLitres||null,
   quantity:1,status:"ready",date:"2026-11-17",
   input:{date:"2026-11-17",jobGroup:"99999999-9999-4999-8999-999999999999",
    services:[[sid],[bid],[gid]][index],tags:[],
    firstAppointment:{initialDate:"2026-11-17",tags:[]},
    frequencyType:index===2?"adhoc":"weeks",
    ...(index===2?{}:{frequencyInterval:4}),
    price:index===2?45:5,notes:"Original booking",
   },
 }))}};
}
test("only the exact original partial status can authorise a missing-job check",()=>{
 const s={
  bookingId:p.BOOKING_ID,stage:"requires_reconciliation",
  reason:"partial_or_ambiguous_squeegee_write",failureClass:"internal_error",
  failureStage:"creating_job",customerPostMayHaveSucceeded:false,
  jobsConfirmed:1,jobCount:2,
 };
 const original={bookingId:p.BOOKING_ID,state:"requires_reconciliation"};
 const owner={...original};
 assert.equal(p.partialStatusSafe(s,original,owner,null),true);
 for(const bad of [
   {jobsConfirmed:0},{jobCount:3},{stage:"completed"},
   {reason:"failed"},{failureClass:"squeegee_api"},
   {failureStage:"creating_customer"},{customerPostMayHaveSucceeded:true},
 ])assert.equal(p.partialStatusSafe({...s,...bad},original,owner,null),false);
 assert.equal(p.partialStatusSafe(s,{...original,state:"succeeded"},owner,null),false);
 assert.equal(p.partialStatusSafe(s,original,{...owner,state:"succeeded"},null),false);
 assert.equal(p.partialStatusSafe(s,original,owner,{state:"reserved"}),false);
});
test("only verified Black/Brown £10 and Green 1100L £45 groups can be posted",()=>{
 const a=audit(),d=p.approvedGroups(a,planned());
 assert.ok(d);
 assert.equal(d.first.input.price,10);
 assert.equal(d.missing.input.price,45);
 assert.equal(d.missing.input.frequencyType,"adhoc");
 assert.equal(d.missing.members[0].bin,"Green Bin");
 assert.equal(p.approvedGroups({...a,bookingId:"NBG-3FYB9UY4"},planned()),null);
 const changed=planned();changed.privatePlan.jobs[2].input.price=35;
 assert.equal(p.approvedGroups(a,changed),null);
 const changedDate=planned();changedDate.privatePlan.jobs[2].date="2026-11-18";
 assert.equal(p.approvedGroups(a,changedDate),null);
});
test("a verified first job and no Green job permit review; ambiguity blocks",()=>{
 const groups=p.approvedGroups(audit(),planned());
 assert.ok(groups);
 const first={date:"2026-11-17",price:10,
  notes:"NI Bin Guy website booking: "+p.BOOKING_ID,
  services:[{_id:sid},{_id:bid}]};
 assert.deepEqual(p.inspectJobs([first],groups.first,groups.missing),{
  ok:true,firstFound:1,greenMissing:true,
 });
 const green={date:"2026-11-17",price:45,services:[{_id:gid}]};
 const check=(jobs,reason)=>assert.equal(p.inspectJobs(jobs,groups.first,groups.missing).reason,reason);
 check([first,green],"green_job_already_exists");
 check([first,{...green,date:undefined}],"green_job_date_unverifiable");
 check([first,{...first}],"duplicate_first_job_found");
 check([{...first,notes:""}],"first_job_not_independently_confirmed");
 check([{...first,services:[{_id:sid}]}],"another_job_with_original_reference_found");
 check(null,"customer_jobs_unavailable");
 check([{...first,services:null}],"customer_services_cannot_be_verified");
});
test("Squeegee partial write scope requires a new atomic exact-claim proof",async()=>{
 const proof={acquired:true,key:p.CLAIM_KEY,etag:'"v123"'};
 const fakeRun=await autoApi.withApprovedPreviewPartialGreenWrite(proof,
  async()=>{autoApi.assertWriteAllowed();return "permitted";},scope,env);
 assert.equal(fakeRun,"permitted");
 for(const broken of [
  {...proof,key:"claim-v1/auto-bookings/"+p.BOOKING_ID},
  {...proof,key:"claim-v1/owner-partial-green/NBG-3FYB9UY4"},
  {...proof,acquired:false},{...proof,etag:""},
 ])await assert.rejects(()=>autoApi.withApprovedPreviewPartialGreenWrite(broken,
  async()=>true,scope,env),/unavailable/);
 await assert.rejects(()=>autoApi.withApprovedPreviewPartialGreenWrite(proof,
   async()=>true,{...scope,deployContext:"production"},env),/unavailable/);
});
test("owner-only reconciliation route is read-only on GET and one-use on POST",()=>{
 const src=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewPartialGreenReconciliation.mjs"),"utf8");
 const otp=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewTest.mjs"),"utf8");
 assert.match(src,/api\.isExactPreview1\(process\.env,scope\)/);
 assert.match(src,/session\.verifyTestSessionCookie/);
 assert.match(src,/if\(request\.method==="POST"\)/);
 assert.match(src,/secureToken\(input\.get\("csrf"\),request\)/);
 assert.match(src,/claims\.claimOnce\(/);
 assert.match(src,/claims\.changeClaimState\(/);
 assert.match(src,/api\.withApprovedPreviewPartialGreenWrite\(/);
 assert.match(src,/api\.getCustomer\(check\.customerId\)/);
 assert.match(src,/api\.addJobToCustomer\(check\.customerId,check\.missing\.input\)/);
 assert.doesNotMatch(src,/api\.createCustomer\(/);
 assert.doesNotMatch(src,/executeAutomaticPreviewBooking\(/);
 assert.match(otp,/value==="\/api\/squeegee-preview-partial-green-reconciliation"/);
});
