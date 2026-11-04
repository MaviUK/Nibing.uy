"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {createProductionClient}=require("../netlify/functions/lib/squeegeeProductionApi.js");
const production=require("../netlify/functions/lib/squeegeeProductionGuard.js");
const {executeAutomaticProductionBooking,canAutoSync}=
  require("../netlify/functions/lib/squeegeeAutomaticBooking.js");

const scope=Object.freeze({
  hostname:"nibing.uy",deployContext:"production",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
});
const env=Object.freeze({
  SQUEEGEE_PRODUCTION_API_KEY:"fake-api-key-with-appropriate-test-length",
  SQUEEGEE_PRODUCTION_EVENT_SECRET:"fake-event-secret-with-appropriate-test-length",
  SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED:"true",
  SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES:"true",
  SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY:"true",
  SQUEEGEE_PRODUCTION_WRITES_PAUSED:"false",
});
const proof=Object.freeze({
  acquired:true,key:"claim-v1/production/auto-bookings/NBG-K7P4R2XM",
  etag:"synthetic-etag",
});
const fakeUUID="20d799d2-46d1-40e4-83c0-7f57ca75575b";

test("production client cannot GET or POST Squeegee with disabled environment",async()=>{
  let calls=0;
  const client=createProductionClient({env:{},scope,
    fetchImpl:async()=>{calls++;throw new Error("Never call real API");}});
  await assert.rejects(client.getServices(),/disabled/);
  await assert.rejects(client.createCustomer({}),/disabled/);
  assert.equal(calls,0);
});

test("production client can read only with all flags, and does not permit an unclaimed POST",async()=>{
  const calls=[];
  const client=createProductionClient({env,scope,fetchImpl:async(url,options)=>{
    calls.push({method:options.method,url:String(url)});
    assert.ok(String(url).startsWith("https://api02.sqgee.com/api/v3/public/"));
    assert.equal(options.headers.Authorization,"Bearer "+env.SQUEEGEE_PRODUCTION_API_KEY);
    return {ok:true,status:200,json:async()=>({success:true,data:[]})};
  }});
  assert.deepEqual(await client.getServices(),[]);
  await assert.rejects(client.createCustomer({name:"DO NOT CREATE"}),/not authorised/);
  await assert.rejects(client.addJobToCustomer(fakeUUID,{price:5}),/not authorised/);
  assert.deepEqual(calls.map(x=>x.method),["GET"]);
});

test("production POST remains denied without a real CAS booking grant",async()=>{
  let calls=0;
  const client=createProductionClient({env,scope,fetchImpl:async()=>{
    calls++;return {ok:true,status:200,json:async()=>({success:true,data:{}})};
  }});
  const candidates=[
    {...proof,acquired:false},
    {...proof,key:"claim-v1/auto-bookings/NBG-K7P4R2XM"},
    {...proof,key:"claim-v1/production/auto-bookings/NBG-BAD"},
    {...proof,etag:""},
  ];
  for(const candidate of candidates){
    assert.throws(()=>client.withWrite(candidate,async()=>{} ,scope,env),
      /write capability unavailable/);
  }
  assert.equal(calls,0);
});

test("production write proof grants one scoped internal call in a fake test only",async()=>{
  const calls=[];
  const client=createProductionClient({env,scope,fetchImpl:async(url,options)=>{
    calls.push({method:options.method,path:new URL(url).pathname});
    return {ok:true,status:200,json:async()=>({success:true,data:{_id:fakeUUID}})};
  }});
  const result=await client.withWrite(proof,async()=>{
    const customer=await client.createCustomer({name:"Synthetic test customer"});
    assert.equal(customer._id,fakeUUID);
    return client.addJobToCustomer(fakeUUID,{services:[],price:5});
  },scope,env);
  assert.equal(result.success,true);
  assert.deepEqual(calls.map(x=>x.method),["POST","POST"]);
  await assert.rejects(client.createCustomer({}),/not authorised/);
});

test("production client refuses preview host even if the switch variables are set",async()=>{
  const previewScope={...scope,hostname:"deploy-preview-80--nibinguy.netlify.app",
    deployContext:"deploy-preview"};
  const client=createProductionClient({env,scope:previewScope,fetchImpl:async()=>{
    throw new Error("Must never call live Squeegee");
  }});
  await assert.rejects(client.getServices(),/disabled/);
  assert.throws(()=>client.withWrite(proof,()=>{},previewScope,env),
    /write capability unavailable/);
});

test("production engine is disabled by default and requires injected dependencies",async()=>{
  const request={bookingId:"NBG-K7P4R2XM",
    submittedAt:new Date().toISOString(),bins:[{type:"Brown Bin",count:1}],
    termsAccepted:true};
  const disabled=await executeAutomaticProductionBooking(request,{
    channel:"email",env:{},runtimeScope:scope,
  });
  assert.equal(disabled.status,"not_started");
  const absent=await executeAutomaticProductionBooking(request,{
    channel:"email",env,runtimeScope:scope,
  });
  assert.equal(absent.status,"not_started");
  assert.equal(absent.reason,"production_dependencies_not_configured");
  assert.equal(canAutoSync(env,scope,"production"),true);
  assert.equal(canAutoSync(env,scope,"not-a-mode"),false);
  assert.equal(canAutoSync(env,{...scope,deployContext:"deploy-preview"},"production"),false);
});
