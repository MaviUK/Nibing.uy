"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const guard=require("../netlify/functions/lib/squeegeeProductionGuard");

const endpoint="https://nibing.uy/api/squeegee-production-readiness";
const context={
  site:{id:guard.SITE_ID},
  deploy:{context:"production"},
};
const keys=[
  "SQUEEGEE_PRODUCTION_API_KEY",
  "SQUEEGEE_PRODUCTION_EVENT_SECRET",
  "SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED",
  "SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES",
  "SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY",
  "SQUEEGEE_PRODUCTION_WRITES_PAUSED",
];
const fake={
  SQUEEGEE_PRODUCTION_API_KEY:"synthetic-api-key-not-real-0123456789",
  SQUEEGEE_PRODUCTION_EVENT_SECRET:"synthetic-signature-secret-not-real-0123456789",
  SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED:"true",
  SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES:"true",
  SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY:"true",
  SQUEEGEE_PRODUCTION_WRITES_PAUSED:"false",
};

test("production readiness probes only safe Squeegee GETs after all write gates are ready",async()=>{
  const {default:handler,config}=await import(
    "../netlify/functions/squeegeeProductionReadiness.mjs");
  assert.equal(config.path,"/api/squeegee-production-readiness");
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const realFetch=globalThis.fetch;
  const calls=[];
  try{
    Object.assign(process.env,fake);
    globalThis.fetch=async (url,options)=>{
      calls.push({path:new URL(url).pathname,method:options.method});
      return new Response(JSON.stringify({success:true,data:[]}),{
        status:200,headers:{"Content-Type":"application/json"},
      });
    };
    const ready=await handler(new Request(endpoint),context);
    assert.equal(ready.status,200);
    assert.deepEqual(await ready.json(),{
      ready:true,readOnlyConnectionVerified:true,
    });
    assert.deepEqual(calls.map(c=>c.method),["GET","GET"]);
    assert.ok(calls.some(c=>c.path.endsWith("/services")));
    assert.ok(calls.some(c=>c.path.endsWith("/job-groups")));

    const post=await handler(new Request(endpoint,{method:"POST"}),context);
    assert.equal(post.status,405);
    assert.equal(calls.length,2,"POST readiness must not contact Squeegee");

    const preview=await handler(new Request(endpoint.replace("nibing.uy",
      "deploy-preview-77--nibinguy.netlify.app")),{
      site:context.site,deploy:{context:"deploy-preview"},
    });
    assert.equal(preview.status,404);
    assert.equal(calls.length,2);

    process.env.SQUEEGEE_PRODUCTION_WRITES_PAUSED="true";
    const paused=await handler(new Request(endpoint),context);
    assert.equal(paused.status,503);
    assert.equal((await paused.json()).ready,false);
    assert.equal(calls.length,2,"Paused readiness must fail closed before GET");

    process.env.SQUEEGEE_PRODUCTION_WRITES_PAUSED="false";
    globalThis.fetch=async()=>{
      throw new Error("Synthetic network failure");
    };
    const failure=await handler(new Request(endpoint),context);
    assert.equal(failure.status,503);
    assert.equal((await failure.json()).ready,false);
  }finally{
    globalThis.fetch=realFetch;
    for(const k of keys){
      if(saved[k]===undefined)delete process.env[k];
      else process.env[k]=saved[k];
    }
  }
});
