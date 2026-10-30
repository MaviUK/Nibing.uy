"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
const {claimOnce,changeClaimState,customerKey,jobKey,activeBinKey}=
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
const blueService="11111111-1111-4111-8111-111111111114";
const brownOneOffService="11111111-1111-4111-8111-111111111113";
const group1="22222222-2222-4222-8222-222222222221";
const group2="22222222-2222-4222-8222-222222222222";
const accountServices=[
  {id:brownService,description:"Brown"},
  {id:blackService,description:"Black"},
  {id:blueService,description:"Blue"},
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
    getCustomer:async()=>({name:booking.name,address:{text:booking.address},jobs:[],
      ...(options.existingCustomer||{})}),
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
    existingCustomer:{address:{text:b.address},jobs:[{services:[blackService]}]},
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
    const h=makeHarness(b,{existingRows:[row],existingCustomer:{address:{text:b.address},jobs}});
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




function freshPilot({
  bookingId="NBG-FRESH-ABCDEF1234",
  addressValue=address,
}={}) {
  return sampleBooking({
    bookingId,
    bins:[{type:"Brown Bin",planId:"domestic_4w",count:1}],
    dates:["2026-11-16"],
    modified:b=>({...b,name:rollout.PILOT_NAME,address:addressValue}),
  });
}

test("Fresh Sync pilot accepts a NEW one-Brown-bin booking, rejects abandoned one",async()=>{
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY,
    SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"pilot"};
  assert.equal(rollout.autoMode(pilotEnv),"pilot");
  assert.equal(rollout.automaticEnabled(pilotEnv),true);
  assert.equal(rollout.autoMode({
    ...pilotEnv,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false",
  }),"off");
  assert.equal(canAutoSync(pilotEnv,runtime),true);
  assert.equal(canAutoSync(pilotEnv,{
    ...runtime,hostname:"deploy-preview-78--nibinguy.netlify.app",
  }),false);
  assert.equal(canAutoSync(pilotEnv,{
    ...runtime,deployContext:"production",
  }),false);

  const normal=sampleBooking();
  const pilot=freshPilot();
  assert.equal(rollout.acceptedForRollout(normal,"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout(pilot,"email",pilotEnv),true);
  assert.equal(rollout.acceptedForRollout(pilot,"whatsapp",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot,name:"TEST API - Pilot 2"},
    "email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot,
    bookingId:rollout.ABANDONED_BOOKING_ID},"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot,bins:[
    ...pilot.bins,{type:"Black Bin",planId:"domestic_4w",count:1},
  ]},"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot,bins:[{
    ...pilot.bins[0],count:2,
  }]},"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot,bins:[{
    ...pilot.bins[0],planId:"domestic_oneoff",
  }]},"email",pilotEnv),false);
  assert.equal(rollout.acceptedForRollout({...pilot},
    "email",{...pilotEnv,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false"}),false);

  let posts=0;
  const blocked=await dispatchAcceptedBooking(normal,{
    channel:"email",env:pilotEnv,eventHost:runtime.hostname,now,
    fetchImpl:async()=>{posts++;return{status:202};},
  });
  assert.equal(blocked.queued,false);
  assert.equal(posts,0);
  const old=await dispatchAcceptedBooking({
    ...pilot,bookingId:rollout.ABANDONED_BOOKING_ID,
  },{
    channel:"email",env:pilotEnv,eventHost:runtime.hostname,now,
    fetchImpl:async()=>{posts++;return{status:202};},
  });
  assert.equal(old.queued,false);
  assert.equal(posts,0);
  const accepted=await dispatchAcceptedBooking(pilot,{
    channel:"email",env:pilotEnv,eventHost:runtime.hostname,now,
    fetchImpl:async()=>{posts++;return{status:202};},
  });
  assert.equal(accepted.queued,true);
  assert.equal(posts,1);
  assert.equal(rollout.PILOT_CLAIM_KEY,
    "claim-v1/auto-pilot/preview77-fresh-brown-v1");
  assert.notEqual(rollout.PILOT_CLAIM_KEY,
    "claim-v1/auto-pilot/preview77-first-email");
});

test("fresh pilot creates only one customer and one £5 four-weekly Brown job",async()=>{
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY,
    SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"pilot"};
  const ledger=fakeBlobStore();
  const pilot=freshPilot();
  const h=makeHarness(pilot,{ledger});
  const opts={channel:"email",env:pilotEnv,runtimeScope:runtime,now};
  const result=await executeAutomaticPreviewBooking(pilot,{
    ...opts,deps:h.deps,
  });
  assert.equal(result.status,"completed");
  assert.equal(result.createdCustomer,true);
  assert.equal(result.createdJobs,1);
  assert.equal(h.posts.length,2);
  assert.equal(h.posts[0].kind,"customer");
  assert.equal(h.posts[1].kind,"job");
  assert.equal(h.posts[1].job.date,"2026-11-16");
  assert.equal(h.posts[1].job.jobGroup,group1);
  assert.equal(h.posts[1].job.price,5);
  assert.equal(h.posts[1].job.frequencyType,"weeks");
  assert.equal(h.posts[1].job.frequencyInterval,4);
  assert.deepEqual(h.posts[1].job.services,[brownService]);
  assert.equal(h.statuses.at(-1).stage,"created_customer_and_jobs");
  assert.equal(ledger.records.get(rollout.PILOT_CLAIM_KEY)?.value?.state,"succeeded");

  // Same reference is never posted a second time.
  const duplicate=await executeAutomaticPreviewBooking(pilot,{
    ...opts,deps:h.deps,
  });
  assert.equal(duplicate.status,"held");
  assert.equal(duplicate.reason,
    "pilot_first_booking_already_consumed_or_uncertain");
  assert.equal(h.posts.length,2);

  // A second, genuinely different accepted website booking with the same
  // approved test name STILL cannot create a second Squeegee customer.
  const next=freshPilot({
    bookingId:"NBG-FRESHA-ABCDEF5678",
    addressValue:"8 Example Drive, Bangor BT19 7ZW",
  });
  const h2=makeHarness(next,{ledger});
  const second=await executeAutomaticPreviewBooking(next,{
    ...opts,deps:h2.deps,
  });
  assert.equal(second.status,"held");
  assert.equal(h2.posts.length,0);
  assert.equal(h.posts.length,2);
});

test("pilot claim remains permanently held if customer POST result is ambiguous",async()=>{
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY,
    SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"pilot"};
  const b=freshPilot();
  const h=makeHarness(b,{customerError:true});
  const opts={channel:"email",env:pilotEnv,runtimeScope:runtime,now};
  const result=await executeAutomaticPreviewBooking(b,{
    ...opts,deps:h.deps,
  });
  assert.equal(result.status,"requires_reconciliation");
  assert.equal(h.posts.filter(x=>x.kind==="customer").length,1);
  assert.equal(h.posts.filter(x=>x.kind==="job").length,0);
  assert.equal(h.ledger.records.get(rollout.PILOT_CLAIM_KEY)?.value?.state,
    "requires_reconciliation");
  const retry=await executeAutomaticPreviewBooking(b,{
    ...opts,deps:h.deps,
  });
  assert.equal(retry.status,"held");
  assert.equal(h.posts.length,1);
});

test("the exact new site host is required before signed booking dispatch",async()=>{
  const testBooking=freshPilot();
  const pilotEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY,
    SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"pilot"};
  let network=0;
  for(const host of ["", "nibing.uy",
    "deploy-preview-78--nibinguy.netlify.app"]) {
    const result=await dispatchAcceptedBooking(testBooking,{
      channel:"email",env:pilotEnv,eventHost:host,now,
      fetchImpl:async()=>{network++;return{status:202};},
    });
    assert.equal(result.queued,false);
    assert.equal(result.reason,"not_exact_preview_1");
  }
  assert.equal(network,0);
});


test("full Preview 1 Email rollout accepts regular and two-bin bookings but not WhatsApp or old replay",async()=>{
  const fullEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY};
  assert.equal(rollout.autoMode(fullEnv),"full");
  assert.equal(rollout.automaticEnabled(fullEnv),true);
  const ordinary=sampleBooking();
  assert.equal(rollout.acceptedForRollout(ordinary,"email",fullEnv),true);
  assert.equal(rollout.acceptedForRollout(ordinary,"whatsapp",fullEnv),false);
  const two=sampleBooking({bins:[
    {type:"Brown Bin",planId:"domestic_4w",count:1},
    {type:"Black Bin",planId:"domestic_4w",count:1},
  ],dates:["2026-11-16","2026-11-17"]});
  assert.equal(rollout.acceptedForRollout(two,"email",fullEnv),true);
  assert.equal(rollout.acceptedForRollout({
    ...ordinary,bookingId:rollout.ABANDONED_BOOKING_ID,
  },"email",fullEnv),false);
  assert.equal(rollout.acceptedForRollout(ordinary,"email",{
    ...fullEnv,SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED:"false",
  }),false);
  assert.equal(canAutoSync(fullEnv,runtime),true);
  assert.equal(canAutoSync(fullEnv,{...runtime,deployContext:"production"}),false);
  assert.equal(canAutoSync(fullEnv,{...runtime,hostname:"deploy-preview-78--nibinguy.netlify.app"}),false);
  const h=makeHarness(two);
  const made=await executeAutomaticPreviewBooking(two,{
    channel:"email",env:fullEnv,runtimeScope:runtime,now,deps:h.deps,
  });
  assert.equal(made.status,"completed");
  assert.equal(made.createdJobs,2);
  assert.equal(h.posts.filter(p=>p.kind==="customer").length,1);
  assert.equal(h.posts.filter(p=>p.kind==="job").length,2);
});

test("existing account adding a different bin reuses exact property customer and keeps old job",async()=>{
  const b=sampleBooking({
    bins:[{type:"Black Bin",planId:"domestic_4w",count:1}],
  });
  const existingRow={
    _id:customerId,name:b.name,email:b.email,
    address:{addressDescription:b.address},status:"active",
  };
  const h=makeHarness(b,{
    existingRows:[existingRow],
    existingCustomer:{
      address:{text:b.address},jobs:[{services:[brownService]}],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,false);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].kind,"job");
  assert.equal(h.posts[0].id,customerId);
  assert.deepEqual(h.posts[0].job.services,[blackService]);
  assert.equal(h.posts[0].job.price,5);
  assert.equal(h.statuses.at(-1).customerMode,"existing");
  assert.equal(h.ledger.records.get(activeBinKey(b,b.bins[0]))?.value?.state,"succeeded");
});

test("same customer already has that bin under one-off: hold rather than create a second regular Brown job",async()=>{
  const b=sampleBooking();
  const row={
    _id:customerId,name:b.name,email:b.email,
    address:{addressDescription:b.address},status:"active",
  };
  const h=makeHarness(b,{
    existingRows:[row],
    existingCustomer:{
      address:{text:b.address},
      jobs:[{services:[brownOneOffService]}],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_job_for_selected_bin_requires_review");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("different property with same email, even same postcode, creates a separate address-specific customer",async()=>{
  const b=sampleBooking();
  const otherAddress="8 Example Drive, Bangor BT19 7ZW";
  const oldRow={
    _id:customerId,name:b.name,email:b.email,status:"active",
    address:{addressDescription:otherAddress},
  };
  const h=makeHarness(b,{existingRows:[oldRow]});
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,true);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,2);
  assert.equal(h.posts[0].input.address.text,b.address);
  assert.notEqual(h.posts[0].input.address.text,otherAddress);
  assert.match(h.posts[0].input.notes,/Additional service property/);
  assert.match(h.posts[0].input.notes,/Separate service\/billing account/);
  assert.equal(h.statuses.at(-1).customerMode,"additional_property");
});

test("another postcode with same email creates new service address without modifying old customer",async()=>{
  const b=sampleBooking({modified:x=>({
    ...x,address:"34 Another Street, Newtownards BT23 4LN",
    bookingScheduleSnapshot:{
      ...x.bookingScheduleSnapshot,postcode:"BT23 4LN",
    },
  })});
  const existing={
    _id:customerId,email:b.email,
    address:{addressDescription:"8 Example Drive, Bangor BT19 7ZW"},
    status:"active",
  };
  const schedule={
    matched:true,postcode:"BT23 4LN",town:"NEWTOWNARDS",
    results:[{bin:"Brown Bin",town:"NEWTOWNARDS",automatic:true,
      assignedCleanDate:"2026-11-16"}],
  };
  const h=makeHarness(b,{existingRows:[existing],schedule});
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,true);
  assert.equal(h.posts[0].input.address.text,b.address);
  assert.equal(h.statuses.at(-1).customerMode,"additional_property");
  assert.equal(h.posts[1].job.price,5);
});

test("same number and postcode but a different street never reuses a customer",async()=>{
  const b=sampleBooking();
  const row={_id:customerId,name:b.name,email:b.email,status:"active",
    address:{addressDescription:"7 Other Road, Bangor BT19 7ZW"}};
  const h=makeHarness(b,{existingRows:[row]});
  const result=await h.run();
  assert.equal(result.status,"held");
  assert.equal(result.reason,"customer_match_ambiguous_or_incomplete");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("same exact customer name and property with changed contact reuses existing customer",async()=>{
  const b=sampleBooking();
  const row={_id:customerId,name:"an  example test customer",
    email:"old-contact@example.org",phoneNumber:"02891460000",
    status:"active",address:{addressDescription:b.address}};
  const h=makeHarness(b,{
    existingRows:[row],
    existingCustomer:{name:"AN EXAMPLE TEST CUSTOMER",
      status:"active",address:{text:b.address},jobs:[]},
  });
  const result=await h.run();
  assert.equal(result.status,"completed");
  assert.equal(result.createdCustomer,false);
  assert.equal(result.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].kind,"job");
  assert.equal(h.posts[0].id,customerId);
  assert.equal(h.posts[0].job.price,5);
  assert.equal(h.statuses.at(-1).customerMode,"existing");
  assert.equal(h.ledger.records.get(BOOKING_CLAIM_PREFIX+b.bookingId)?.value?.state,"succeeded");
});

test("Squeegee customer id match must also have verified property address before adding jobs",async()=>{
  const b=sampleBooking();
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:b.email,status:"active",
      address:{addressDescription:b.address},
    }],
    existingCustomer:{
      address:{text:"999 Other Road, Bangor BT19 7ZW"},jobs:[],
    },
  });
  const result=await h.run();
  assert.equal(result.status,"held");
  assert.equal(result.reason,"existing_customer_address_unverified");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("two new bookings with different first dates cannot race to create the same bin at an existing address",async()=>{
  const b=sampleBooking();
  const later=sampleBooking({
    bookingId:"NBG-ZYXWV-ABCDEFGH",
    dates:["2026-11-17"],
  });
  const ledger=fakeBlobStore();
  const rows=[{
    _id:customerId,name:b.name,email:b.email,status:"active",
    address:{addressDescription:b.address},
  }];
  const settings={
    ledger,existingRows:rows,existingCustomer:{address:{text:b.address},jobs:[]},
  };
  const first=makeHarness(b,settings);
  const second=makeHarness(later,settings);
  assert.equal((await first.run()).status,"completed");
  const blocked=await second.run();
  assert.equal(blocked.status,"held");
  assert.equal(blocked.reason,"property_bin_already_claimed_or_uncertain");
  assert.equal(second.posts.length,0);
  assert.equal(first.posts.length,1);
  assert.notEqual(jobKey(b,{type:"Brown Bin",planId:"domestic_4w",date:"2026-11-16"}),
    jobKey(later,{type:"Brown Bin",planId:"domestic_4w",date:"2026-11-17"}));
  assert.equal(activeBinKey(b,b.bins[0]),activeBinKey(later,later.bins[0]));
});

test("duplicate bin colour lines are held before any claim or Squeegee POST",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Brown Bin",planId:"domestic_oneoff",count:1},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  const h=makeHarness(b);
  const result=await h.run();
  assert.equal(result.status,"held");
  assert.equal(result.reason,"duplicate_bin_types_in_same_booking");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});


test("inactive Squeegee customer is never silently reactivated by existing account booking",async()=>{
  const {externalCustomerReference}=
    require("../netlify/functions/lib/squeegeeBookingPlan");
  const b=sampleBooking();
  const reference=externalCustomerReference(b);
  for(const caseName of ["inactive_reference","inactive_detail"]) {
    const row={
      _id:customerId,name:b.name,email:b.email,status:
        caseName==="inactive_reference"?"inactive":"active",
      _externalId:reference,address:{text:b.address},
    };
    const h=makeHarness(b,{
      existingRows:[row],
      existingCustomer:{
        status:"inactive",address:{text:b.address},jobs:[],
      },
    });
    const r=await h.run();
    assert.equal(r.status,"held");
    assert.equal(h.posts.length,0);
    assert.equal(h.ledger.records.size,0);
  }
});


test("two domestic bins with the same verified date and recurrence make ONE £10 Squeegee job with two services",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  const h=makeHarness(b);
  const result=await h.run();
  assert.equal(result.status,"completed");
  assert.equal(result.createdCustomer,true);
  assert.equal(result.createdJobs,1);
  assert.equal(result.binServices,2);
  const jobs=h.posts.filter(x=>x.kind==="job");
  assert.equal(h.posts.filter(x=>x.kind==="customer").length,1);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].job.date,"2026-11-16");
  assert.equal(jobs[0].job.firstAppointment.initialDate,"2026-11-16");
  assert.equal(jobs[0].job.jobGroup,group1);
  assert.equal(jobs[0].job.frequencyType,"weeks");
  assert.equal(jobs[0].job.frequencyInterval,4);
  assert.equal(jobs[0].job.price,10);
  assert.deepEqual(jobs[0].job.services,[brownService,blackService]);
  assert.match(jobs[0].job.notes,/1 x Brown Bin \+ 1 x Black Bin/);
  assert.deepEqual(h.statuses.at(-1).binsPerJob,[2]);
  assert.deepEqual(h.statuses.at(-1).firstCleanDates,["2026-11-16"]);
  assert.deepEqual(h.statuses.at(-1).rounds,[1]);
  for(const bin of b.bins) {
    assert.equal(h.ledger.records.get(activeBinKey(b,bin))?.value?.state,"succeeded");
    assert.equal(h.ledger.records.get(jobKey(b,{
      date:"2026-11-16",type:bin.type,planId:bin.planId,
    }))?.value?.state,"succeeded");
  }
  const retry=await h.run();
  assert.equal(retry.status,"held");
  assert.equal(h.posts.length,2);
});

test("three bins with two on Monday and one on Tuesday create TWO jobs, never three",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
      {type:"Blue Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-16","2026-11-17"],
  });
  const h=makeHarness(b);
  const result=await h.run();
  assert.equal(result.status,"completed");
  assert.equal(result.createdJobs,2);
  assert.equal(result.binServices,3);
  const posts=h.posts.filter(x=>x.kind==="job");
  assert.equal(posts.length,2);
  assert.deepEqual(posts.map(x=>x.job.services),[
    [brownService,blackService],[blueService],
  ]);
  assert.deepEqual(posts.map(x=>x.job.price),[10,5]);
  assert.deepEqual(posts.map(x=>x.job.date),["2026-11-16","2026-11-17"]);
  assert.deepEqual(posts.map(x=>x.job.jobGroup),[group1,group2]);
  assert.deepEqual(h.statuses.at(-1).binsPerJob,[2,1]);
});

test("same date but different recurrence cannot be merged into one Squeegee job",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_oneoff",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  const h=makeHarness(b);
  const result=await h.run();
  assert.equal(result.status,"completed");
  assert.equal(result.createdJobs,2);
  const posts=h.posts.filter(x=>x.kind==="job");
  assert.equal(posts.length,2);
  assert.deepEqual(posts.map(p=>p.job.price),[15,5]);
  assert.deepEqual(posts.map(p=>p.job.frequencyType),["adhoc","weeks"]);
  assert.equal(posts[0].job.frequencyInterval,undefined);
  assert.equal(posts[1].job.frequencyInterval,4);
  assert.deepEqual(posts.map(p=>p.job.services),[
    [brownOneOffService],[blackService],
  ]);
});

test("same-day mixed-bin 7-for-6 discount stays £30 in one job, not £35",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:4},
      {type:"Black Bin",planId:"domestic_4w",count:3},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  assert.equal(b.pricing.total,30);
  assert.equal(b.pricing.multiBuyFreeBins,1);
  const h=makeHarness(b);
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdJobs,1);
  const job=h.posts.filter(x=>x.kind==="job")[0].job;
  assert.equal(job.price,30);
  assert.deepEqual(job.services,[brownService,blackService]);
  assert.match(job.notes,/4 x Brown Bin \+ 3 x Black Bin/);
});

test("existing customer receives one combined new-bin job without modifying their existing other service",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  const customerRow={
    _id:customerId,name:b.name,email:b.email,status:"active",
    address:{addressDescription:b.address},
  };
  const oldJobs=[{services:[blueService]}];
  const h=makeHarness(b,{
    existingRows:[customerRow],
    existingCustomer:{address:{text:b.address},jobs:oldJobs},
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,false);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].id,customerId);
  assert.deepEqual(h.posts[0].job.services,[brownService,blackService]);
  assert.deepEqual(oldJobs,[{services:[blueService]}]);
});

test("existing customer with one selected bin already present holds the entire same-date bundle",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:b.email,status:"active",
      address:{addressDescription:b.address},
    }],
    existingCustomer:{
      address:{text:b.address},jobs:[{services:[brownService]}],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_job_for_selected_bin_requires_review");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("ambiguous same-day bundled POST locks both services; no automatic retry",async()=>{
  const b=sampleBooking({
    bins:[
      {type:"Brown Bin",planId:"domestic_4w",count:1},
      {type:"Black Bin",planId:"domestic_4w",count:1},
    ],
    dates:["2026-11-16","2026-11-16"],
  });
  const h=makeHarness(b,{jobErrorAt:1});
  const r=await h.run();
  assert.equal(r.status,"requires_reconciliation");
  assert.equal(h.posts.filter(x=>x.kind==="customer").length,1);
  const posted=h.posts.filter(x=>x.kind==="job");
  assert.equal(posted.length,1);
  assert.deepEqual(posted[0].job.services,[brownService,blackService]);
  assert.equal(h.statuses.at(-1).jobCount,1);
  assert.equal(h.statuses.at(-1).binServicesPlanned,2);
  for(const bin of b.bins) {
    assert.equal(h.ledger.records.get(activeBinKey(b,bin))?.value?.state,
      "requires_reconciliation");
    assert.equal(h.ledger.records.get(jobKey(b,{
      date:"2026-11-16",type:bin.type,planId:bin.planId,
    }))?.value?.state,"requires_reconciliation");
  }
  assert.equal((await h.run()).status,"held");
  assert.equal(h.posts.length,2);
});

test("grouping rejects a malformed or duplicate service plan before a real job POST",async()=>{
  const {groupedSqueegeeJobs}=
    require("../netlify/functions/lib/squeegeeJobGrouping");
  const base={
    index:0,status:"ready",bin:"Brown Bin",quantity:1,date:"2026-11-16",
    input:{
      date:"2026-11-16",frequencyType:"weeks",frequencyInterval:4,
      services:[brownService],notes:"Brown",tags:[],
      firstAppointment:{initialDate:"2026-11-16",tags:[]},
      price:5,jobGroup:group1,
    },
  };
  assert.throws(()=>groupedSqueegeeJobs([base,{
    ...base,index:1,bin:"Black Bin",input:{
      ...base.input,notes:"Black",
    },
  }],"NBG-ABCDE-ABCDEFGH"),/Incomplete or inconsistent/);
  assert.throws(()=>groupedSqueegeeJobs([{
    ...base,input:{...base.input,price:1.237},
  }],"NBG-ABCDE-ABCDEFGH"),/Incomplete or inconsistent/);
  assert.throws(()=>groupedSqueegeeJobs([{
    ...base,input:{...base.input,firstAppointment:{
      ...base.input.firstAppointment,initialDate:"2026-11-17",
    }},
  }],"NBG-ABCDE-ABCDEFGH"),/Incomplete or inconsistent/);
});


test("inactive exact name+address customer with changed contact is held for activation; no duplicate customer or job",async()=>{
  const b=sampleBooking();
  const alerts=[];
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,
      name:"An Example Test Customer",
      email:"old-owner@example.org",
      phoneNumber:"02891460000",
      status:"inactive",
      address:{addressDescription:b.address},
    }],
    existingCustomer:{
      name:b.name,status:"inactive",address:{text:b.address},jobs:[],
    },
    deps:{alert:async(...args)=>{alerts.push(args);return{sent:true};}},
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_customer_reactivation_required");
  assert.equal(h.statuses.at(-1).matchReason,"inactive_exact_customer");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
  assert.equal(alerts.length,1);
  assert.equal(alerts[0][0],b.bookingId);
  assert.equal(alerts[0][1],"existing_customer_reactivation_required");
});

test("deactivated exact name+address is never mistaken for a new customer",async()=>{
  const b=sampleBooking();
  const row={
    _id:customerId,name:b.name,
    email:"old@example.org",phoneNumber:"07700000000",
    status:"deactivated",address:{addressDescription:b.address},
  };
  const h=makeHarness(b,{
    existingRows:[row],
    existingCustomer:{
      name:b.name,status:"deactivated",address:{text:b.address},jobs:[],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_customer_reactivation_required");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("active detail with stale inactive listing can accept new bin without creating another customer",async()=>{
  const b=sampleBooking();
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:"old@example.org",
      status:"inactive",address:{addressDescription:b.address},
    }],
    existingCustomer:{
      name:b.name,status:"active",address:{text:b.address},jobs:[],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,false);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].id,customerId);
});

test("authoritative customer name mismatch after list match prevents appending a job",async()=>{
  const b=sampleBooking();
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:"old@example.org",
      status:"active",address:{addressDescription:b.address},
    }],
    existingCustomer:{
      name:"A Different Resident",status:"active",
      address:{text:b.address},jobs:[],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_customer_name_unverified");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});


test("successful return booking surfaces all duplicate flags in status and sends one informational owner alert",async()=>{
  const b=sampleBooking();
  const sent=[];
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:"older@example.org",
      phoneNumber:"02891469999",status:"active",
      address:{addressDescription:b.address},
    }],
    existingCustomer:{name:b.name,status:"active",
      address:{text:b.address},jobs:[]},
    deps:{duplicateAlert:async(id,flags)=>{
      sent.push({id,flags});return{sent:true};
    }},
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,false);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(sent.length,1);
  assert.equal(sent[0].id,b.bookingId);
  assert.deepEqual(sent[0].flags,[
    "address_already_registered","same_name_address_contact_changed",
  ]);
  assert.deepEqual(h.statuses.at(-1).duplicateFlags,sent[0].flags);
  assert.deepEqual(r.duplicateFlags,sent[0].flags);
});

test("email used at a second property is flagged but allowed to create its own address-specific customer",async()=>{
  const b=sampleBooking();
  const sent=[];
  const row={
    _id:customerId,name:b.name,email:b.email,
    phoneNumber:"07700900000",status:"active",
    address:{addressDescription:"23 Another Drive, Holywood BT18 9ZZ"},
  };
  const h=makeHarness(b,{
    existingRows:[row],
    deps:{duplicateAlert:async(id,flags)=>{
      sent.push({id,flags});return {sent:true};
    }},
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,true);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts[0].kind,"customer");
  assert.match(h.posts[0].input.notes,/Additional service property/);
  assert.deepEqual(h.statuses.at(-1).duplicateFlags,[
    "email_already_registered","email_used_at_other_property",
  ]);
  assert.equal(sent.length,1);
});

test("different customer at the same address is held, with address duplicate flags in the owner hold alert",async()=>{
  const b=sampleBooking();
  const sent=[],normalNotices=[];
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:"Another Resident",
      email:"other@example.org",phoneNumber:"07700900000",
      status:"active",address:{addressDescription:b.address},
    }],
    deps:{
      alert:async(id,reason,extra)=>{normalNotices.push({id,reason,extra});},
      duplicateAlert:async(...args)=>{sent.push(args);},
    },
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"customer_match_ambiguous_or_incomplete");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
  assert.equal(normalNotices.length,1);
  assert.deepEqual(normalNotices[0].extra.duplicateFlags,[
    "address_already_registered","address_registered_to_other_name",
  ]);
  assert.equal(sent.length,0);
  assert.deepEqual(h.statuses.at(-1).duplicateFlags,
    normalNotices[0].extra.duplicateFlags);
});

test("informational duplicate alert delivery failures never turn a successful Squeegee import into a retry",async()=>{
  const b=sampleBooking();
  let attempts=0;
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:b.email,
      address:{addressDescription:b.address},status:"active",
    }],
    deps:{duplicateAlert:async()=>{attempts++;
      throw new Error("fake email failure");}},
  });
  const result=await h.run();
  assert.equal(result.status,"completed");
  assert.equal(result.createdJobs,1);
  assert.equal(attempts,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.ledger.records.get(BOOKING_CLAIM_PREFIX+b.bookingId)?.value?.state,
    "succeeded");
});

test("unique new customer with no repeated information sends no informational duplicate email",async()=>{
  const b=sampleBooking();
  let duplicateEmails=0;
  const h=makeHarness(b,{
    deps:{duplicateAlert:async()=>{duplicateEmails++;}},
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.deepEqual(r.duplicateFlags,[]);
  assert.equal(duplicateEmails,0);
  assert.deepEqual(h.statuses.at(-1).duplicateFlags,[]);
});


test("real Squeegee service-object format permits Blue at existing Brown property",async()=>{
  const b=sampleBooking({
    bins:[{type:"Blue Bin",planId:"domestic_4w",count:1}],
    modified:x=>({...x,email:"new-contact@example.org",phone:"02891469191"}),
  });
  const previousJobs=[{
    _id:"88888888-8888-4888-8888-888888888888",
    services:[{_id:brownService,description:"Brown",quantity:1}],
    jobGroup:group1,price:5,
  }];
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,
      email:"old-contact@example.org",phoneNumber:"07700900000",
      address:{addressDescription:b.address},status:"active",
    }],
    existingCustomer:{name:b.name,status:"active",
      address:{text:b.address},jobs:previousJobs},
  });
  const r=await h.run();
  assert.equal(r.status,"completed");
  assert.equal(r.createdCustomer,false);
  assert.equal(r.createdJobs,1);
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].kind,"job");
  assert.equal(h.posts[0].id,customerId);
  assert.deepEqual(h.posts[0].job.services,[blueService]);
  assert.equal(h.posts[0].job.frequencyInterval,4);
  assert.equal(h.posts[0].job.price,5);
  assert.deepEqual(previousJobs[0].services,[{
    _id:brownService,description:"Brown",quantity:1,
  }]);
  assert.equal(h.statuses.at(-1).customerMode,"existing");
});

test("real Squeegee service-object format rejects duplicate Blue service at property",async()=>{
  const b=sampleBooking({
    bins:[{type:"Blue Bin",planId:"domestic_4w",count:1}],
  });
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:b.email,
      address:{addressDescription:b.address},status:"active",
    }],
    existingCustomer:{address:{text:b.address},
      jobs:[{services:[{_id:blueService,description:"Blue",quantity:1}]}]},
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_job_for_selected_bin_requires_review");
  assert.equal(h.posts.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("existing one-off service object also blocks another recurring bin of same colour",async()=>{
  const b=sampleBooking();
  const h=makeHarness(b,{
    existingRows:[{
      _id:customerId,name:b.name,email:b.email,
      address:{addressDescription:b.address},status:"active",
    }],
    existingCustomer:{
      address:{text:b.address},
      jobs:[{services:[{
        _id:brownOneOffService,description:"(One Off) Brown",quantity:1,
      }]}],
    },
  });
  const r=await h.run();
  assert.equal(r.status,"held");
  assert.equal(r.reason,"existing_job_for_selected_bin_requires_review");
  assert.equal(h.posts.length,0);
});

test("existing job with two service objects is inspected by every UUID",()=>{
  const existing=[{services:[
    {_id:brownService,description:"Brown",quantity:1},
    {_id:blackService,description:"Black",quantity:1},
  ]}];
  assert.equal(overlappingJobs(existing,[{
    input:{services:[blueService]},bin:"Blue Bin",
  }]),null);
  assert.equal(overlappingJobs(existing,[{
    input:{services:[blackService]},bin:"Black Bin",
  }]),"existing_job_for_selected_bin_requires_review");
});

test("unsupported existing service objects still fail closed; no Squeegee POST",async()=>{
  const b=sampleBooking({
    bins:[{type:"Blue Bin",planId:"domestic_4w",count:1}],
  });
  const badServices=[
    {description:"Brown",quantity:1},
    {_id:"bad-uuid",description:"Brown",quantity:1},
    {_id:brownService,id:blackService,description:"Brown"},
    null,
    123,
    [],
  ];
  for(const bad of badServices){
    const h=makeHarness(b,{
      existingRows:[{
        _id:customerId,name:b.name,email:b.email,
        address:{addressDescription:b.address},status:"active",
      }],
      existingCustomer:{address:{text:b.address},
        jobs:[{services:[bad]}]},
    });
    const r=await h.run();
    assert.equal(r.status,"held");
    assert.equal(r.reason,"cannot_inspect_existing_jobs");
    assert.equal(h.posts.length,0);
    assert.equal(h.ledger.records.size,0);
  }
});

test("valid existing service ID-only format remains supported for compatibility",()=>{
  const wanted=[{input:{services:[blueService]},bin:"Blue Bin"}];
  assert.equal(overlappingJobs([
    {services:[brownService]},
  ],wanted),null);
  assert.equal(overlappingJobs([
    {services:[blueService]},
  ],wanted),"existing_job_for_selected_bin_requires_review");
  assert.equal(overlappingJobs([
    {services:[{id:brownService,description:"Brown",quantity:1}]},
  ],wanted),null);
});
