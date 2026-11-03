"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const r=require("../netlify/functions/lib/squeegeeOwnerReactivation");
const {verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
function sample(){
  const bins=[
    {type:"Black Bin",planId:"domestic_4w",count:1},
    {type:"Brown Bin",planId:"domestic_4w",count:1},
    {type:"Green Bin",planId:"comm_gt660_oneoff",sizeLitres:1100,count:1},
  ];
  const pricing=verifyAndPriceBooking(bins,"",{}, {legacyLargeCommercialPrice:true}).canonical;
  return{
    bookingId:"NBG-4QUNP343",channel:"email",
    createdAt:"2026-10-31T21:24:07.000Z",
    termsAccepted:true,name:"Gavin Stevenson",
    email:"example@example.org",phone:"07555178484",
    address:"78 Groomsport Rd, Bangor BT20 5NF",
    bins,pricing,
    bookingScheduleSnapshot:{
      version:1,postcode:"BT20 5NF",results:[
        {bin:"Black Bin",assignedCleanDate:"2026-11-17"},
        {bin:"Brown Bin",assignedCleanDate:"2026-11-17"},
        {bin:"Green Bin",assignedCleanDate:"2026-11-17"},
      ],
    },
  };
}
test("link accepts valid short IDs and days but no arbitrary dates",()=>{
  assert.equal(r.validId("NBG-4QUNP343"),true);
  assert.equal(r.validId("NBG-X"),false);
  assert.equal(r.validDay("2026-10-31",Date.parse("2026-11-01")),true);
  assert.equal(r.validDay("2026-02-31",Date.parse("2026-11-01")),false);
  assert.equal(r.validDay("2026-10-31%2F",Date.parse("2026-11-01")),false);
  assert.equal(r.recoveryKey("NBG-4QUNP343"),
    "claim-v1/owner-reactivations/NBG-4QUNP343");
});
test("only a pristine inactive hold and unclaimed booking can be resumed",()=>{
  const s={bookingId:"NBG-4QUNP343",stage:"held_for_review",
    reason:"existing_customer_reactivation_required",
    matchReason:"inactive_exact_customer"};
  assert.equal(r.safeHeld(s,null,null,s.bookingId),true);
  for(const bad of [
    {stage:"created_customer_and_jobs"},
    {stage:"requires_reconciliation"},
    {reason:"customer_match_ambiguous_or_incomplete"},
    {matchReason:"other_match"},
    {jobsConfirmed:1},
    {bookingId:"NBG-2ABCDEFGH"},
  ])assert.equal(r.safeHeld({...s,...bad},null,null,s.bookingId),false);
  assert.equal(r.safeHeld(s,{state:"succeeded"},null,s.bookingId),false);
  assert.equal(r.safeHeld(s,null,{state:"reserved"},s.bookingId),false);
});
test("original £55 three-bin booking is rebuilt from server audit without creating another booking",()=>{
  const aud=sample(),res=r.auditedBooking(aud,"NBG-4QUNP343","2026-10-31");
  assert.equal(res.ok,true);
  assert.equal(res.booking.bookingId,"NBG-4QUNP343");
  assert.equal(res.booking.pricing.total,55);
  assert.equal(res.booking.bins.length,3);
  for(const bad of [
    {...aud,bookingId:"NBG-2ABCDEFGH"},
    {...aud,channel:"whatsapp"},
    {...aud,termsAccepted:false},
    {...aud,pricing:{total:5}},
    {...aud,createdAt:"2026-10-28T21:24:07Z"},
  ])assert.equal(r.auditedBooking(bad,"NBG-4QUNP343","2026-10-31").ok,false);
});
test("active same-property customer qualifies but inactive/mismatched property does not",()=>{
  const b=r.auditedBooking(sample(),"NBG-4QUNP343","2026-10-31").booking;
  const c={status:"active",name:"Gavin Stevenson",
    address:{addressDescription:"78 Groomsport Road, Bangor, County Down BT20 5NF"}};
  assert.equal(r.exactActiveCustomer(c,b),true);
  assert.equal(r.exactActiveCustomer({...c,status:"inactive"},b),false);
  assert.equal(r.exactActiveCustomer({...c,status:"deactivated"},b),false);
  assert.equal(r.exactActiveCustomer({...c,address:"79 Groomsport Rd, Bangor BT20 5NF"},b),false);
  assert.equal(r.exactActiveCustomer({...c,name:"Different Name"},b),false);
});
test("only future verified groups with original price are resumable",()=>{
  const b=r.auditedBooking(sample(),"NBG-4QUNP343","2026-10-31").booking;
  const items=b.bins.map((bin,index)=>({
    status:"ready",bin:bin.type,quantity:1,index,
    date:"2026-11-17",input:{
      frequencyType:index===2?"adhoc":"weeks",
      frequencyInterval:index===2?undefined:4,
      jobGroup:"88888888-8888-4888-8888-888888888888",
      price:index===2?45:5,
      services:[[
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ][index]],
      date:"2026-11-17",
      firstAppointment:{initialDate:"2026-11-17",tags:[]},
      tags:[],
    },
  }));
  const p={status:"prepared_read_only",
    summary:{blockedReasons:[],datesVerified:true,pricingVerified:true},
    privatePlan:{blockedJobs:0,readyJobs:3,jobs:items}};
  const now=Date.parse("2026-10-31T22:00:00Z");
  const g=r.preparedJobs(p,b,now);
  assert.equal(g.length,2);
  assert.equal(g.reduce((n,x)=>n+x.input.price,0),55);
  assert.equal(r.preparedJobs(p,b,Date.parse("2026-11-18T12:00:00Z")),null);
  assert.equal(r.preparedJobs({...p,summary:{...p.summary,blockedReasons:["date"]}},b,now),null);
});
test("matching date and service or original booking reference blocks duplicate creation",()=>{
  const groups=[{input:{
    date:"2026-11-17",services:["blue-service"],price:15,
  }}];
  assert.equal(r.existingJobRisk([{date:"2025-10-31",
    services:[{_id:"blue-service"}],notes:"Old completed booking"}],
    groups,"NBG-4QUNP343"),null);
  assert.equal(r.existingJobRisk([{date:"2026-11-17",
    services:[{_id:"blue-service"}]}],groups,"NBG-4QUNP343"),
    "matching_date_and_service_already_exists");
  assert.equal(r.existingJobRisk([{services:[{_id:"blue-service"}]}],groups,
    "NBG-4QUNP343"),"matching_service_without_verifiable_date");
  assert.equal(r.existingJobRisk([{date:"2025-10-31",
    notes:"Created from NBG-4QUNP343",services:[]}],
    groups,"NBG-4QUNP343"),"original_booking_already_in_jobs");
  assert.equal(r.existingJobRisk(null,groups,"NBG-4QUNP343"),"cannot_verify_existing_jobs");
});
test("owner route is GET-only until signed owner confirmation POST; import remains one-use",()=>{
  const src=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewOwnerReactivation.mjs"),"utf8");
  assert.match(src,/path:"\/api\/squeegee-preview-owner-reactivation"/);
  assert.match(src,/api\.isExactPreview1\(process\.env,scope\)/);
  assert.match(src,/session\.verifyTestSessionCookie/);
  assert.match(src,/if\(request\.method==="POST"\)/);
  assert.match(src,/ownerLink\.verifyLink\(authParams/);
  assert.match(src,/secureEqual\(form\.get\("csrf"\),expectedCsrf\)/);
  assert.match(src,/claims\.claimOnce\(/);
  assert.match(src,/claims\.changeClaimState\(/);
  assert.match(src,/auto\.executeAutomaticPreviewBooking\(/);
  assert.match(src,/createCustomer:async\(\)=>/);
  assert.match(src,/if\(customerId!==check\.customerId\)/);
  assert.match(src,/api\.getCustomer\(customerId\)/);
  assert.match(src,/api\.addJobToCustomer\(customerId,input\)/);
  assert.doesNotMatch(src,/Request origin could not be verified/);
  assert.doesNotMatch(src,/api\.createCustomer\(/);
});


test("recovery permits the first group it just posted when creating a second group",()=>{
  const id="NBG-4QUNP343";
  const first={input:{date:"2026-11-17",price:10,
    services:["11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"]}};
  const missing={input:{date:"2026-11-17",price:45,
    services:["33333333-3333-4333-8333-333333333333"]}};
  const saved={date:"2026-11-17",price:10,notes:"NI Bin Guy website booking: "+id,
    services:first.input.services.map(_id=>({_id}))};
  assert.equal(r.existingJobRisk([saved],[first,missing],id),
    "original_booking_already_in_jobs");
  assert.equal(r.existingJobRisk([saved],[missing],id,{acceptedGroups:[first]}),null);
  assert.equal(r.existingJobRisk([saved,{...saved}],[missing],id,
    {acceptedGroups:[first]}),"repeated_accepted_group_in_customer");
  assert.equal(r.existingJobRisk([{...saved,price:30}],[missing],id,
    {acceptedGroups:[first]}),"original_booking_already_in_jobs");
  const green={date:"2026-11-17",services:[{_id:missing.input.services[0]}]};
  assert.equal(r.existingJobRisk([saved,green],[missing],id,
    {acceptedGroups:[first]}),"matching_date_and_service_already_exists");
});
