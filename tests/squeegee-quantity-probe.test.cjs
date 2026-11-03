"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const PROBE_PATH="../netlify/functions/squeegeePreviewQuantityProbe.mjs";
const BROWN="11111111-1111-4111-8111-111111111111";
const simulated=(status)=>Object.assign(new Error("simulated"),{status});
async function probe(){return import(PROBE_PATH);}
function harness({found=false,codes=[404,400,400],services=[{id:BROWN,description:"Brown"}],allowed=true,customerError=null}={}){
  const posts=[];let claims=0,lookups=0;
  return {posts,get claims(){return claims;},get lookups(){return lookups;},deps:{
    getCustomer:async id=>{lookups++;const {ABSENT_ID}=await probe();assert.equal(id,ABSENT_ID);
      if(customerError!==null)throw simulated(customerError);if(!found)throw simulated(404);
      return {id};},
    getServices:async()=>services,
    reserve:async()=>{claims++;return allowed;},
    post:async(id,body)=>{posts.push(body);return {httpStatus:codes[posts.length-1]};},
  }};
}
test("only three fixed formats tested and no real customer ID accepted",async()=>{
 const {buildQuantityVariants,ABSENT_ID}=await probe();
 const v=buildQuantityVariants(BROWN);
 assert.deepEqual(v.map(r=>r.body.services),[
   [BROWN],[{id:BROWN,quantity:2}],[{_id:BROWN,quantity:2}],
 ]);
 assert.equal(ABSENT_ID,"00000000-0000-4000-8000-000000000000");
 for(const item of v)assert.equal(item.body.frequencyInterval,4);
});
test("present or unreadable customer stops all POSTs and all claims",async()=>{
 const {runQuantityProbe}=await probe();
 for(const options of [{found:true},{customerError:401},{customerError:500}]){
   const h=harness(options);const r=await runQuantityProbe(h.deps);
   assert.equal(r.status,"blocked_customer_not_proven_absent");
   assert.equal(h.claims,0);assert.equal(h.posts.length,0);
 }
});
test("ambiguous or missing Brown service blocks upstream write",async()=>{
 const {runQuantityProbe}=await probe();
 for(const services of [[],[{id:"bad",description:"Brown"}],
   [{id:BROWN,description:"Brown"},{id:BROWN,description:"Brown"}]]){
   const h=harness({services});const r=await runQuantityProbe(h.deps);
   assert.equal(r.status,"blocked_brown_service_unverified");
   assert.equal(h.claims,0);assert.equal(h.posts.length,0);
 }
});
test("one-shot claim failure never posts",async()=>{
 const {runQuantityProbe}=await probe();
 const h=harness({allowed:false});const r=await runQuantityProbe(h.deps);
 assert.equal(r.status,"blocked_test_already_attempted_or_uncertain");
 assert.equal(h.posts.length,0);
});
test("control 404 and quantity objects 400 suggest rejection, NOT successful quantity 2",async()=>{
 const {runQuantityProbe}=await probe();
 const h=harness();const r=await runQuantityProbe(h.deps);
 assert.equal(r.status,"candidate_rejected_before_customer_lookup");
 assert.equal(h.posts.length,3);
 assert.deepEqual(r.results.map(x=>x.httpStatus),[404,400,400]);
 assert.ok(!JSON.stringify(r).includes(BROWN));
});
test("all 404 is inconclusive; unexpected 2xx stops immediately",async()=>{
 const {runQuantityProbe}=await probe();
 const h=harness({codes:[404,404,404]});
 assert.equal((await runQuantityProbe(h.deps)).status,
   "inconclusive_customer_or_payload_validation_order");
 const x=harness({codes:[404,200,404]});
 assert.equal((await runQuantityProbe(x.deps)).status,
   "unexpected_upstream_acceptance_stop_and_review");
 assert.equal(x.posts.length,2);
});
test("network ambiguity never triggers another POST",async()=>{
 const {runQuantityProbe}=await probe();const h=harness();
 h.deps.post=async(id,body)=>{h.posts.push(body);throw Error("timeout");};
 assert.equal((await runQuantityProbe(h.deps)).status,"inconclusive_network_failure");
 assert.equal(h.posts.length,1);
});
test("owner-only, exact-preview, CSRF and immutable claim gates remain present",()=>{
 const s=fs.readFileSync(path.join(__dirname,PROBE_PATH),"utf8");
 for(const name of ["api.isExactPreview1","owner.verifyTestSessionCookie",
   "validCsrf","claims.claimOnce","claims.changeClaimState",
   "request.headers.get(\"origin\")!==ORIGIN","id=>api.getCustomer(id)"]){
   assert.ok(s.includes(name),name);
 }
 assert.ok(!s.includes("api.createCustomer("));
 assert.ok(!s.includes("api.addJobToCustomer("));
});
