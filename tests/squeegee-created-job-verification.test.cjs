"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  idOf,returnedJobId,matchesPlannedJob,identifyNewJob,confirmPostedJob,
}=require("../netlify/functions/lib/squeegeeCreatedJobVerification");

const customer="33333333-3333-4333-8333-333333333333";
const black="11111111-1111-4111-8111-111111111111";
const blue="22222222-2222-4222-8222-222222222222";
const group="44444444-4444-4444-8444-444444444444";
const before="55555555-5555-4555-8555-555555555555";
const after="66666666-6666-4666-8666-666666666666";
const planned={services:[black,blue],jobGroup:group,price:10,
  date:"2026-11-10",frequencyType:"weeks",frequencyInterval:4};
const job=id=>({_id:id,services:[{_id:blue},{_id:black}],
  jobGroup:{_id:group},price:10});

test("independently matches a new Black+Blue job using public customer GET fields",async()=>{
  assert.equal(idOf({_id:after}),after);
  assert.equal(returnedJobId({success:true,data:{_id:after}}),after);
  assert.equal(matchesPlannedJob(job(after),planned),true);
  const read=await confirmPostedJob({
    customerId:customer,planned,knownJobIds:[before],
    writeResult:{success:true,data:{_id:after}},
    getCustomer:async()=>({jobs:[job(before),job(after)]}),
    pause:async()=>{},
  });
  assert.deepEqual(read,{verified:true,jobId:after});
});
test("an old matching job is never mistaken for this booking",async()=>{
  const read=await confirmPostedJob({
    customerId:customer,planned,knownJobIds:[before],
    writeResult:{success:true},
    getCustomer:async()=>({jobs:[job(before)]}),
    pause:async()=>{},
  });
  assert.deepEqual(read,{verified:false});
});
test("post success:true without a visible new job is unconfirmed",async()=>{
  let requests=0;
  const read=await confirmPostedJob({
    customerId:customer,planned,knownJobIds:[],
    writeResult:{success:true},
    getCustomer:async()=>{requests++;return {jobs:[]};},
    pause:async()=>{},
  });
  assert.deepEqual(read,{verified:false});
  assert.equal(requests,3);
});
test("rejects mismatched service, job group and price even with a new job ID",()=>{
  const reference={planned,knownJobIds:[],writeResult:{data:{_id:after}}};
  assert.equal(identifyNewJob([{...job(after),price:5}],reference),null);
  assert.equal(identifyNewJob([{...job(after),jobGroup:{_id:blue}}],reference),null);
  assert.equal(identifyNewJob([{...job(after),services:[{_id:black}]}],reference),null);
  assert.equal(identifyNewJob([job(before)],reference),null);
});
test("retries a briefly stale Squeegee read without repeating the POST",async()=>{
  let reads=0;
  const result=await confirmPostedJob({
    customerId:customer,planned,knownJobIds:[before],writeResult:{success:true},
    getCustomer:async()=>({jobs:++reads===1?[job(before)]:[job(before),job(after)]}),
    pause:async()=>{},
  });
  assert.equal(reads,2);
  assert.deepEqual(result,{verified:true,jobId:after});
});
test("unknown baseline job IDs need a matching ID returned by the POST",()=>{
  assert.equal(identifyNewJob([job(after)],{
    planned,knownJobIds:[],baselineComplete:false,writeResult:{success:true},
  }),null);
  assert.equal(identifyNewJob([job(after)],{
    planned,knownJobIds:[],baselineComplete:false,
    writeResult:{success:true,data:{_id:after}},
  }),after);
});
test("GET errors and missing fields cannot imply job creation",async()=>{
  const result=await confirmPostedJob({
    customerId:customer,planned,knownJobIds:[],writeResult:{success:true},
    getCustomer:async()=>{throw new Error("network_unavailable");},
    pause:async()=>{},
  });
  assert.deepEqual(result,{verified:false});
  assert.equal(identifyNewJob([{...job(after),_id:null}],{
    planned,knownJobIds:[],writeResult:{success:true},
  }),null);
});

test("an undated job needs a new matching ungrouped record; missing and older records cannot confirm it",async()=>{
  const manual={services:[black,blue],price:10,frequencyType:"weeks",frequencyInterval:4};
  const actual={...job(after),jobGroup:null};
  assert.equal(identifyNewJob([actual],{planned:manual,knownJobIds:[]}),null);
  assert.equal(identifyNewJob([actual],{planned:manual,manualSchedule:true,knownJobIds:[]}),after);
  assert.equal(identifyNewJob([actual],{planned:manual,manualSchedule:true,knownJobIds:[after]}),null);
  assert.equal(identifyNewJob([job(after)],{planned:manual,manualSchedule:true,knownJobIds:[]}),null);
  const result=await confirmPostedJob({customerId:customer,planned:manual,manualSchedule:true,knownJobIds:[before],
    getCustomer:async()=>({jobs:[actual]}),pause:async()=>{}});
  assert.deepEqual(result,{verified:true,jobId:after});
});
