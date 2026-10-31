"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const {verifyAndPriceBooking,validateCommercialBinSizes}=
  require("../netlify/functions/lib/squeegeeBookingPricing");
const {prepareReadOnlyBooking}=
  require("../netlify/functions/lib/squeegeeBookingPreparation");
const {resolveSqueegeeServiceIds,resolvedServiceIdForBin}=
  require("../netlify/functions/lib/squeegeeServiceCatalog");
const {groupedSqueegeeJobs}=
  require("../netlify/functions/lib/squeegeeJobGrouping");
const {buildBookingEmailHtml}=
  require("../netlify/functions/lib/bookingEmailTemplate");
const {emailContent}=
  require("../netlify/functions/lib/squeegeeSyncOwnerAlert");

const B660="11111111-1111-4111-8111-111111111111";
const G1100="22222222-2222-4222-8222-222222222222";
const GROUP1="33333333-3333-4333-8333-333333333333";
const STANDARD="44444444-4444-4444-8444-444444444444";
const services=[
  {id:B660,description:"Blue 660L (4 weekly)"},
  {id:G1100,description:"Green 1100L (one-off)"},
  {id:STANDARD,description:"Blue"},
];
const jobGroups=[{id:GROUP1,description:"1"}];
const date="2026-11-16";
const postcode="BT20 4AA";

function booking(planId="comm_gt660_4w",sizeLitres=660,type="Blue Bin") {
  const price=planId.endsWith("oneoff")?45:15;
  const bin={type,count:1,planId,sizeLitres};
  const line={idx:0,type,count:1,planId,sizeLitres,
    baseUnit:price,unitPrice:price,lineTotal:price,
    freeCount:0,multiBuyDiscount:0,discounted:false};
  return {
    bookingId:"NBG-XGU9MPEE",name:"Commercial Test",
    email:"commercial@example.org",phone:"07123456789",
    address:"1 Example Street, Bangor "+postcode,
    bins:[bin],
    pricing:{
      lines:[line],total:price,subtotal:price,
      multiBuyDiscount:0,multiBuyFreeBins:0,
    },
    bookingScheduleSnapshot:{
      version:1,postcode,matched:true,
      results:[{type,assignedCleanDate:date,automatic:true}],
    },
  };
}
function schedule(type="Blue Bin") {
  return {postcode,town:"BANGOR",matched:true,
    results:[{bin:type,town:"BANGOR",assignedCleanDate:date,automatic:true}]};
}
function prepare(b) {
  return prepareReadOnlyBooking(b,schedule(b.bins[0].type),services,{
    jobGroups,
  });
}

test("660L commercial Blue four-weekly uses the exact Squeegee 660L service",()=>{
  const b=booking();
  const prepared=prepare(b);
  assert.equal(prepared.status,"prepared_read_only");
  assert.equal(prepared.summary.datesVerified,true);
  assert.equal(prepared.summary.pricingVerified,true);
  assert.deepEqual(prepared.summary.blockedReasons,[]);
  assert.equal(prepared.privatePlan.jobs[0].input.services[0],B660);
  assert.equal(prepared.privatePlan.jobs[0].input.jobGroup,GROUP1);
  assert.equal(prepared.privatePlan.jobs[0].input.frequencyType,"weeks");
  assert.equal(prepared.privatePlan.jobs[0].input.frequencyInterval,4);
  assert.equal(prepared.privatePlan.jobs[0].input.price,15);
  assert.equal(prepared.privatePlan.jobs[0].sizeLitres,660);
  assert.match(prepared.privatePlan.jobs[0].input.notes,/Commercial bin size: 660L/);
});
test("1100L commercial Green one-off uses the exact Squeegee 1100L one-off service",()=>{
  const b=booking("comm_gt660_oneoff",1100,"Green Bin");
  const prepared=prepare(b);
  assert.equal(prepared.status,"prepared_read_only");
  assert.equal(prepared.privatePlan.jobs[0].input.services[0],G1100);
  assert.equal(prepared.privatePlan.jobs[0].input.frequencyType,"adhoc");
  assert.equal(prepared.privatePlan.jobs[0].input.frequencyInterval,undefined);
  assert.equal(prepared.privatePlan.jobs[0].input.price,45);
  assert.equal(prepared.privatePlan.jobs[0].sizeLitres,1100);
  assert.match(prepared.privatePlan.jobs[0].input.notes,/Commercial bin size: 1100L/);
});
test("one-off 660L and recurring 1100L never silently use another service",()=>{
  for(const [planId,size,type] of [
    ["comm_gt660_oneoff",660,"Green Bin"],
    ["comm_gt660_4w",1100,"Blue Bin"],
    ["comm_gt660_4w",660,"Black Bin"],
  ]){
    const b=booking(planId,size,type);
    const prepared=prepare(b);
    assert.equal(prepared.status,"held_for_review",planId+size+type);
    assert.equal(prepared.summary.datesVerified,true);
    assert.equal(prepared.summary.pricingVerified,true);
    assert.ok(prepared.summary.blockedReasons.includes("unmapped_squeegee_services"));
    assert.deepEqual(prepared.summary.unmappedServices,[{
      binType:type.split(" ")[0].toLowerCase(),
      planId,sizeLitres:size,
    }]);
    assert.equal(prepared.privatePlan.jobs[0].status,"service_mapping_required");
  }
});
test("invalid or missing large-bin capacity is rejected by server before confirmation",()=>{
  for(const size of [null,undefined,0,360,661,750,1101,"660","1100",{}]){
    // Explicitly overwrite: passing undefined would otherwise use the
    // fixture helper's default parameter (660L) and test a valid booking.
    const b=booking("comm_gt660_4w",660);
    b.bins[0].sizeLitres=size;
    const result=verifyAndPriceBooking(b.bins,null,b.pricing);
    assert.equal(result.ok,false);
    assert.equal(result.reason,"large_commercial_size_required");
    assert.equal(validateCommercialBinSizes(b.bins).ok,false);
  }
  const wrong=booking("domestic_4w",660);
  assert.equal(validateCommercialBinSizes(wrong.bins).reason,"unexpected_commercial_size");
  assert.equal(validateCommercialBinSizes([{type:"Blue Bin",planId:"domestic_4w"}]).ok,true);
});
test("customer cannot switch the Squeegee service by altering only quoted size",()=>{
  const b=booking();
  b.pricing.lines[0].sizeLitres=1100;
  const result=verifyAndPriceBooking(b.bins,null,b.pricing);
  assert.equal(result.reason,"client_price_mismatch");
});
test("duplicate Squeegee service labels are never silently selected",()=>{
  const ids=resolveSqueegeeServiceIds([
    ...services,{id:"55555555-5555-4555-8555-555555555555",
      description:"Blue 660L (4 weekly)"},
  ]);
  assert.equal(resolvedServiceIdForBin(ids.serviceIds,booking().bins[0]),null);
  assert.ok(ids.unresolved.some(x=>x.description==="Blue 660L (4 weekly)"&&
    x.reason==="duplicate_service_label"));
});
test("grouping regular and commercial bins preserves each quantity and capacity in notes",()=>{
  const b=booking();
  const commercial=prepare(b).privatePlan.jobs[0];
  const regular={
    ...commercial,index:1,bin:"Blue Bin",sizeLitres:null,
    input:{
      ...commercial.input,services:[STANDARD],price:5,
      notes:"NI Bin Guy website booking: "+b.bookingId+" | 1 x Blue Bin | Every 4 weeks",
    },
  };
  const grouped=groupedSqueegeeJobs([commercial,regular],b.bookingId);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].input.price,20);
  assert.equal(grouped[0].physicalBinCount,2);
  assert.deepEqual(grouped[0].input.services,[B660,STANDARD]);
  assert.match(grouped[0].input.notes,/1 x Blue Bin \(660L\)/);
  assert.match(grouped[0].input.notes,/1 x Blue Bin/);
});
test("customer and owner email templates show large-bin capacity",()=>{
  const b=booking("comm_gt660_oneoff",1100,"Green Bin");
  const html=buildBookingEmailHtml({
    bookingId:b.bookingId,name:b.name,address:b.address,
    phone:b.phone,bins:b.bins,pricing:b.pricing,
    termsVersion:"August 2026",
  });
  assert.match(html,/1 × Green Bin \(1100L\)/);
  const owner=emailContent(b.bookingId,"squeegee_service_not_mapped",{
    requestedBinCounts:["1 x Green Bin (1100L)"],
    unmappedServices:[{
      binType:"green",planId:"comm_gt660_oneoff",sizeLitres:1100,
    }],
    bookingTotal:45,
  });
  assert.match(owner.text,/Requested: 1 x Green Bin \(1100L\)/);
  assert.match(owner.text,/Missing Squeegee service: Green \(1100L\)/);
});
test("both booking forms show a conditional required 660L/1100L selector",()=>{
  const root=path.join(__dirname,"..");
  for(const file of ["src/LandingPage.jsx","src/pages/StreetBookingPage.jsx"]){
    const source=fs.readFileSync(path.join(root,file),"utf8");
    assert.match(source,/isLargeCommercialPlan\(bin.planId\) &&/);
    assert.match(source,/Commercial bin size \(required\)/);
    assert.match(source,/<option value="660">660 litres \(660L\)<\/option>/);
    assert.match(source,/<option value="1100">1100 litres \(1100L\)<\/option>/);
    assert.match(source,/sizeLitres: null/);
  }
  for(const file of [
    "netlify/functions/sendBookingEmail.js",
    "netlify/functions/sendStreetBookingEmail.js",
  ]){
    assert.match(fs.readFileSync(path.join(root,file),"utf8"),
      /validateCommercialBinSizes/);
  }
});
