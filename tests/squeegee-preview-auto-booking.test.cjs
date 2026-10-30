"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
const {claimOnce,changeClaimState,customerKey,jobKey}=
  require("../netlify/functions/lib/squeegeeIdempotencyClaims");
const {assertWriteAllowed,withApprovedPreviewAutomaticWrite}=
  require("../netlify/functions/lib/squeegeeApiV3");
const {
  executeAutomaticPreviewBooking,canAutoSync,overlappingJobs,
  BOOKING_CLAIM_PREFIX,
}=require("../netlify/functions/lib/squeegeeAutomaticBooking");
const {
  acceptedEventBooking,dispatchAcceptedBooking,verifyAcceptedEvent,
  signAcceptedEvent,
}=require("../netlify/functions/lib/squeegeePreviewAutoDispatch");

const rollout=require("../netlify/functions/lib/squeegeePreviewAutoRollout");
const now=Date.parse("2026-10-30T16:30:00Z");
const runtime={
  hostname:"deploy-preview-77--nibinguy.netlify.app",
  deployContext:"deploy-preview",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
};
const env={
  SQUEEGEE_API_KEY:"fake-Squeegee-API-key-for-tests-only-NOT-REAL-123456",
  SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"true",
};
const customerId="33333333-3333-4333-8333-333333333333";
const brownService="11111111-1111-4111-8111-111111111111";
const blackService="11111111-1111-4111-8111-111111111112";
const brownOneOffService="11111111-1111-4111-8111-111111111113";
const group1="22222222-2222-4222-8222-222222222221";
const group2="22222222-2222-4222-8222-222222222222";
const accountServices=[
  {id:brownService,description:"Brown"},
  {id:blackService,description:"Black"},
  {id:brownOneOffService,description:"(One Off) Brown"},
];
const accountGroups=[
  {id:group1,description:"01"}, {id:group2,description:"02"},
];
const address="7 Example Drive, Bangor BT19 7ZW";
function sampleBooking({
  bookingId="NBG-ABCDE-ABCDEFGH",
  bins=[{type:"Brown Bin",planId:"domestic_4w",count:1}],
  dates=["2026-11-16"],discountCode="",modified=null,
}={}) {
  const priced=verifyAndPriceBooking(bins,discountCode,{});
  assert.ok(priced.canonical,priced.reason);
  const booking={
    bookingId,submittedAt:new Date(now).toISOString(),
    name:"An Example Test Customer",email:"customer@example.org",
    phone:"07123456789",address,termsAccepted:true,discountCode,
    bins,pricing:priced.canonical,
    bookingScheduleSnapshot:{
      version:1,postcode:"BT19 7ZW",
      results:bins.map((bin,i)=>({
        type:bin.type,automatic:true,assignedCleanDate:dates[i],
      })),
    },
  };
  return modified?modified(booking):booking;
}
function fakeBlobStore(){
  const records=new Map();let counter=0;
  return {
    records,
    async setJSON(key,value,{onlyIfNew,onlyIfMatch}={}){
      const old=records.get(key);
      if(onlyIfNew && old)return{modified:false};
      if(onlyIfMatch && (!old||old.etag!==onlyIfMatch))return{modified:false};
      const etag='"v'+(++counter)+'"';
      records.set(key,{value,etag});
      return{modified:true,etag};
    },
    async get(key){return records.get(key)?.value||null;},
  };
}
function fakeSchedule(booking){
  return{
    matched:true,postcode:"BT19 7ZW",town:"BANGOR",
    results:booking.bins.map((bin,i)=>({
      bin:bin.type,town:"BANGOR",automatic:true,
      assignedCleanDate:booking.bookingScheduleSnapshot.results[i].assignedCleanDate,
    })),
  };
}
function makeHarness(booking,options={}){
  const ledger=options.ledger||fakeBlobStore();
  const posts=[],statuses=[];
  let pages=0;
  const deps={
    getSchedule:async()=>options.schedule||fakeSchedule(booking),
    getServices:async()=>options.services||accountServices,
    getJobGroups:async()=>options.groups||accountGroups,
    listCustomers:async()=>{
      pages++;
      if(options.listCustomers)return options.listCustomers();
      return {customers:options.existingRows||[],hasMore:false,page:1,pageSize:100};
    },
    getCustomer:async()=>options.existingCustomer||{jobs:[]},
    claim:args=>claimOnce({...args,store:ledger}),
    changeState:args=>changeClaimState({...args,store:ledger}),
    withWrite:async(proof,operation,scope)=>{
      assert.equal(scope.hostname,runtime.hostname);
      assert.equal(proof.acquired,true);
      assert.equal(proof.key,BOOKING_CLAIM_PREFIX+booking.bookingId);
      assert.match(proof.etag,/v\d+/);
      return operation();
    },
    createCustomer:async(input)=>{
      posts.push({kind:"customer",input});
      if(options.customerError)throw new Error("ambiguous external customer result");
      return customerId;
    },
    addJob:async(id,job)=>{
      posts.push({kind:"job",id,job});
      if(options.jobErrorAt && posts.filter(x=>x.kind==="job").length===options.jobErrorAt)
        throw new Error("ambiguous external job result");
      return{success:true};
    },
    save:async(id,stage,extra={})=>{
      statuses.push({id,stage,...extra});
      return{saved:true};
    },
    ...options.deps,
  };
  return{
    deps,ledger,posts,statuses,get pages(){return pages;},
    run:(payload=booking)=>executeAutomaticPreviewBooking(payload,{
      channel:options.channel||"email",env,runtimeScope:runtime,now,deps,
    }),
  };
}

test("automatic writes are disabled without explicit preview-only flag and trusted scope",async()=>{
  assert.equal(canAutoSync({...env,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false"},runtime),false);
  assert.equal(canAutoSync(env,{...runtime,deployContext:"production"}),false);
  assert.equal(canAutoSync(env,{...runtime,hostname:"nibing.uy"}),false);
  assert.equal(canAutoSync(env,{...runtime,hostname:"deploy-preview-78--nibinguy.netlify.app"}),false);
  const booking=sampleBooking(),h=makeHarness(booking);
  const r=await executeAutomaticPreviewBooking(booking,{
    channel:"email",env:{...env,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false"},
    runtimeScope:runtime,now,deps:h.deps,
  });
  assert.equal(r.status,"not_started");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
  assert.throws(()=>assertWriteAllowed(),/disabled/);
  await assert.rejects(
    withApprovedPreviewAutomaticWrite({
      acquired:true,key:BOOKING_CLAIM_PREFIX+booking.bookingId,
      etag:'"v1"',
    },async()=>{}, {...runtime,deployContext:"production"},env),
    /unavailable/,
  );
});

test("signed accepted dispatch is server-only, body-bound, time-limited and preview-scoped",async()=>{
  const b=sampleBooking();
  const packet=JSON.stringify({channel:"email",booking:acceptedEventBooking(b)});
  const signature=signAcceptedEvent(packet,String(now),env);
  assert.equal(verifyAcceptedEvent(packet,String(now),signature,env,now),true);
  assert.equal(verifyAcceptedEvent(packet,String(now),signature,env,now+91000),false);
  assert.equal(verifyAcceptedEvent(packet+" ",String(now),signature,env,now),false);
  assert.equal(verifyAcceptedEvent(packet,String(now),signature.slice(0,-1)+"f",
    {...env,SQUEEGEE_API_KEY:"a-different-test-only-API-key-123456789"},now),false);
  let observed=null;
  const fetchImpl=async(url,opts)=>{
    observed={url,opts};
    assert.equal(verifyAcceptedEvent(opts.body,
      opts.headers["X-NBG-Auto-Timestamp"],
      opts.headers["X-NBG-Auto-Signature"],env,now),true);
    return{status:202};
  };
  const accepted=await dispatchAcceptedBooking(b,{
    channel:"email",eventHost:runtime.hostname,env,now,fetchImpl,
  });
  assert.equal(accepted.queued,true);
  assert.equal(observed.url,
    "https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-sync");
  assert.equal(JSON.parse(observed.opts.body).booking.email,b.email);
  assert.equal(JSON.parse(observed.opts.body).booking.recaptchaToken,undefined);
  const disallowed=await dispatchAcceptedBooking(b,{
    channel:"whatsapp",eventHost:"nibing.uy",env,now,fetchImpl:async()=>{
      throw new Error("never use network");
    },
  });
  assert.equal(disallowed.queued,false);
});

test("new Preview 1 booking creates exactly one customer and correctly scheduled job",async()=>{
  const b=sampleBooking(),h=makeHarness(b);
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,true);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,2);
  assert.equal(h.posts[0].kind,"customer");
  assert.equal(h.posts[0].input.name,b.name);
  assert.equal(h.posts[1].kind,"job");
  assert.equal(h.posts[1].job.date,"2026-11-16");
  assert.equal(h.posts[1].job.firstAppointment.initialDate,"2026-11-16");
  assert.equal(h.posts[1].job.frequencyType,"weeks");
  assert.equal(h.posts[1].job.frequencyInterval,4);
  assert.equal(h.posts[1].job.price,5);
  assert.equal(h.posts[1].job.jobGroup,group1);
  assert.deepEqual(h.posts[1].job.services,[brownService]);
  assert.equal(h.statuses.at(-1).stage,"created_customer_and_jobs");
  assert.equal(h.ledger.records.get(BOOKING_CLAIM_PREFIX+b.bookingId)?.value?.state,"succeeded");
  assert.equal(h.ledger.records.get(customerKey(b))?.value?.state,"succeeded");
  assert.equal(h.ledger.records.get(jobKey(b,{
    date:"2026-11-16",type:"Brown Bin",planId:"domestic_4w",
  }))?.value?.state,"succeeded");
  assert.ok(!JSON.stringify(h.statuses).includes(b.email));
  assert.ok(!JSON.stringify(h.statuses).includes(b.address));
});

test("same booking ID or new booking ID at same property cannot silently duplicate",async()=>{
  const b=sampleBooking(),h=makeHarness(b);
  assert.equal((await h.run()).status,"completed");
  const duplicate=await h.run();
  assert.equal(duplicate.status,"held");
  const newId=sampleBooking({bookingId:"NBG-ZYXWV-ABCDEFGH"});
  const second=await h.run(newId);
  assert.equal(second.status,"held");
  assert.equal(h.posts.filter(x=>x.kind==="customer").length,1);
  assert.equal(h.posts.filter(x=>x.kind==="job").length,1);
});

test("an existing matched customer with a DIFFERENT bin gets one job and no customer overwrite",async()=>{
  const b=sampleBooking();
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:b.email,
      address:{addressDescription:b.address},status:"active",
      jobs:[{services:[blackService]}],
    }],
    existingCustomer:{jobs:[{services:[blackService]}]},
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,false);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].kind,"job");
  assert.equal(h.posts[0].id,customerId);
});

test("matching existing job service or unreadable jobs block creation safely",async()=>{
  const b=sampleBooking();
  const row={
    _id:customerId,name:b.name,email:b.email,
    address:{addressDescription:b.address},status:"active",jobs:[],
  };
  for(const jobs of [[{services:[brownService]}],null,[{services:null}]]){
    const h=makeHarness(b,{existingRows:[row],existingCustomer:{jobs}});
    const r=await h.run();
    assert.equal(r.status,"held");
    assert.equal(h.posts.length,0);
    assert.equal(h.ledger.records.size,0);
  }
  assert.equal(overlappingJobs([{services:[brownService]}],[{input:{services:[brownService]}}]),
    "existing_job_for_selected_bin_requires_review");
});

test("two bins on different dates become two jobs with distinct rounds",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-17"],
  });
  const h=makeHarness(b);
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdJobs,2);
  assert.deepEqual(h.posts.filter(p=>p.kind==="job").map(x=>x.job.jobGroup),[group1,group2]);
  assert.deepEqual(h.posts.filter(p=>p.kind==="job").map(x=>x.job.date),
    ["2026-11-16","2026-11-17"]);
  assert.equal(h.posts.filter(p=>p.kind==="customer").length,1);
});

test("seven-for-six pricing uses verified £30 total and exact per-job quantity notes",async()=>{
  const b=sampleBooking({
    bins:[{type:"Brown Bin",planId:"domestic_4w",count:7}],
  });
  assert.equal(b.pricing.total,30);
  const h=makeHarness(b);
  const result=await h.run();
  assert.equal(result.status,"completed");
  const job=h.posts.find(p=>p.kind==="job").job;
  assert.equal(job.price,30);
  assert.match(job.notes,/7 x Brown Bin/);
});

test("one-off uses adhoc frequency and matching one-off service",async()=>{
  const b=sampleBooking({
    bins:[{type:"Brown Bin",planId:"domestic_oneoff",count:1}],
  });
  const h=makeHarness(b);
  const result=await h.run();
  assert.equal(result.status,"completed");
  const job=h.posts.find(p=>p.kind==="job").job;
  assert.equal(job.price,15);
  assert.equal(job.frequencyType,"adhoc");
  assert.deepEqual(job.services,[brownOneOffService]);
  assert.equal(job.frequencyInterval,undefined);
});

test("changed website date, missing round and tampered price always hold with zero Squeegee POSTs",async()=>{
  const b=sampleBooking();
  const cases=[
    {schedule:{...fakeSchedule(b),results:[{
      bin:"Brown Bin",town:"BANGOR",automatic:true,assignedCleanDate:"2026-11-17",
    }]}},
    {groups:[]},
  ];
  for(const opts of cases){
    const h=makeHarness(b,opts),result=await h.run();
    assert.equal(result.status,"held");
    assert.equal(h.posts.length,0);
    assert.equal(h.ledger.records.size,0);
  }
  const tampered=sampleBooking({modified:booking=>({
    ...booking,pricing:{...booking.pricing,total:0},
  })});
  const h=makeHarness(tampered);
  assert.equal((await h.run()).status,"held");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("an ambiguous customer match, or incomplete customer pagination, cannot write",async()=>{
  const b=sampleBooking();
  const h=makeHarness(b,{
    listCustomers:()=>({customers:[],hasMore:true,page:1,pageSize:100}),
  });
  const result=await h.run();
  assert.equal(result.status,"held");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
  assert.equal(h.pages,100);
});

test("an ambiguous customer POST never creates a job, and never auto-retries",async()=>{
  const b=sampleBooking(),h=makeHarness(b,{customerError:true});
  const r=await h.run();
  assert.equal(r.status,"requires_reconciliation");
  assert.equal(h.posts.filter(p=>p.kind==="customer").length,1);
  assert.equal(h.posts.filter(p=>p.kind==="job").length,0);
  assert.equal(h.ledger.records.get(BOOKING_CLAIM_PREFIX+b.bookingId)?.value?.state,
    "requires_reconciliation");
  const second=await h.run();
  assert.equal(second.status,"held");
  assert.equal(h.posts.length,1);
});

test("second job failure holds booking for manual reconciliation with no second customer",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-17"],
  });
  const h=makeHarness(b,{jobErrorAt:2});
  const r=await h.run();
  assert.equal(r.status,"requires_reconciliation");
  assert.equal(h.posts.filter(p=>p.kind==="customer").length,1);
  assert.equal(h.posts.filter(p=>p.kind==="job").length,2);
  assert.equal(h.statuses.at(-1).jobsConfirmed,1);
  const dup=await h.run();
  assert.equal(dup.status,"held");
  assert.equal(h.posts.length,3);
});

test("invalid/old booking and wrong channel never call Squeegee",async()=>{
  const b=sampleBooking({modified:x=>({...x,submittedAt:"2025-01-01T00:00:00Z"})});
  const h=makeHarness(b);
  assert.equal((await h.run()).status,"not_started");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
  const h2=makeHarness(sampleBooking(),{channel:"manual"});
  assert.equal((await h2.run()).status,"not_started");
  assert.equal(h2.posts.length,0);
});

test("public auto-sync function denies wrong site and disabled preview before any storage",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewAutoSync.mjs");
  const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-sync";
  const denied=await handler(new Request(url,{method:"POST"}),{
    deploy:{context:"production"},site:{id:runtime.siteId},
  });
  assert.equal(denied.status,404);
  const correctSite=await handler(new Request(url,{method:"POST"}),{
    deploy:{context:"deploy-preview"},site:{id:runtime.siteId},
  });
  assert.ok([403,415].includes(correctSite.status));
});


test("WhatsApp stays separately approval-gated even when email preview sync is enabled",async()=>{
  const b=sampleBooking();
  let network=0;
  const denied=await dispatchAcceptedBooking(b,{
    channel:"whatsapp",eventHost:runtime.hostname,env,now,
    fetchImpl:async()=>{network++;return{status:202};},
  });
  assert.equal(denied.queued,false);
  assert.equal(denied.reason,"whatsapp_auto_sync_requires_separate_approval");
  assert.equal(network,0);
  const approved=await dispatchAcceptedBooking(b,{
    channel:"whatsapp",eventHost:runtime.hostname,
    env:{...env,SQUEEGEE_PREVIEW_AUTO_WHATSAPP_ENABLED:"true"},
    now,fetchImpl:async()=>{network++;return{status:202};},
  });
  assert.equal(approved.queued,true);
  assert.equal(network,1);
});

test("owner-only automatic sync status page does not permit unauthorised inspection",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewAutoStatus.mjs");
  const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-status?bookingId=NBG-ABCDE-ABCDEFGH";
  const denied=await handler(new Request(url),{
    deploy:{context:"production"},site:{id:runtime.siteId},
  });
  assert.equal(denied.status,404);
  const preview=await handler(new Request(url),{
    deploy:{context:"deploy-preview"},site:{id:runtime.siteId},
  });
  assert.ok([403,404].includes(preview.status));
  assert.match(await preview.text(),/authorisation required|Not found/i);
});


test("branch-isolated pilot enables ONLY one TEST API email booking with no shared flag",async()=>{
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY};
  assert.equal(rollout.autoMode(pilotEnv),"pilot");
  assert.equal(rollout.automaticEnabled(pilotEnv),true);
  assert.equal(rollout.autoMode({...pilotEnv,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false"}),"off");
  assert.equal(canAutoSync(pilotEnv,runtime),true);
  assert.equal(canAutoSync(pilotEnv,{...runtime,hostname:"deploy-preview-78--nibinguy.netlify.app"}),false);
  assert.equal(canAutoSync(pilotEnv,{...runtime,deployContext:"production"}),false);
  const normal=sampleBooking();
  const pilot=sampleBooking({modified:booking=>({...booking,name:"TEST API - Pilot One"})});
  assert.equal(rollout.acceptedForRollout(normal,"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout(pilot,"email",pilotEnv),true);
  assert.equal(rollout.acceptedForRollout(pilot,"whatsapp",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({
    ...pilot,bins:[...pilot.bins,{...pilot.bins[0]}],
  },"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot,name:"TEST API - Pilot One"},
    "email",{...pilotEnv,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false"}),false);

  let sends=0;
  const notSent=await dispatchAcceptedBooking(normal,{
    channel:"email",env:pilotEnv,eventHost:runtime.hostname,now,
    fetchImpl:async()=>{sends++;return{status:202};},
  });
  assert.equal(notSent.queued,false);
  assert.equal(sends,0);
  const one=await dispatchAcceptedBooking(pilot,{
    channel:"email",env:pilotEnv,eventHost:runtime.hostname,now,
    fetchImpl:async()=>{sends++;return{status:202};},
  });
  assert.equal(one.queued,true);
  assert.equal(sends,1);
  assert.equal(rollout.PILOT_CLAIM_KEY,"claim-v1/auto-pilot/preview77-first-email");
});

test("one-use atomic pilot claim prevents a second Test API customer at another property",async()=>{
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY};
  const ledger=fakeBlobStore();
  const first=sampleBooking({modified:b=>({...b,name:"TEST API - Pilot One"})});
  const firstH=makeHarness(first,{ledger});
  const options={channel:"email",env:pilotEnv,runtimeScope:runtime,now};
  const completed=await executeAutomaticPreviewBooking(first,{
    ...options,deps:firstH.deps,
  });
  assert.equal(completed.status,"completed");
  assert.equal(completed.createdCustomer,true);
  assert.equal(completed.createdJobs,1);
  assert.equal(firstH.posts.length,2);
  assert.equal(ledger.records.get(rollout.PILOT_CLAIM_KEY)?.value?.state,"succeeded");

  const second=sampleBooking({
    bookingId:"NBG-ZYXWV-ABCDEFGH",
    modified:b=>({...b,name:"TEST API - Pilot Two",
      address:"8 Example Drive, Bangor BT19 7ZW"}),
  });
  const secondH=makeHarness(second,{ledger});
  const blocked=await executeAutomaticPreviewBooking(second,{
    ...options,deps:secondH.deps,
  });
  assert.equal(blocked.status,"held");
  assert.equal(blocked.reason,"pilot_first_booking_already_consumed_or_uncertain");
  assert.equal(secondH.posts.length,0);
  assert.equal(firstH.posts.length,2);
});

test("pilot claim stays occupied after an uncertain customer POST",async()=>{
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY};
  const b=sampleBooking({modified:x=>({...x,name:"TEST API - Pilot Failure"})});
  const h=makeHarness(b,{customerError:true});
  const r=await executeAutomaticPreviewBooking(b,{
    channel:"email",env:pilotEnv,runtimeScope:runtime,now,deps:h.deps,
  });
  assert.equal(r.status,"requires_reconciliation");
  assert.equal(h.posts.filter(x=>x.kind==="customer").length,1);
  assert.equal(h.posts.filter(x=>x.kind==="job").length,0);
  assert.equal(h.ledger.records.get(rollout.PILOT_CLAIM_KEY)?.value?.state,
    "requires_reconciliation");
  const again=await executeAutomaticPreviewBooking(b,{
    channel:"email",env:pilotEnv,runtimeScope:runtime,now,deps:h.deps,
  });
  assert.equal(again.status,"held");
  assert.equal(h.posts.length,1);
});
