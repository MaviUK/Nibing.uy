"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createProductionClient}=require("../netlify/functions/lib/squeegeeProductionApi");
const guard=require("../netlify/functions/lib/squeegeeProductionGuard");
const scope={hostname:"nibing.uy",deployContext:"production",
  siteId:guard.SITE_ID||"d63c829f-3ed7-48e9-9633-a042de3f2e84"};
const safe={
  SQUEEGEE_PRODUCTION_API_KEY:"synthetic-testing-key-not-real-1234",
  SQUEEGEE_PRODUCTION_READ_ENABLED:"true",
  SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED:"false",
  SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES:"false",
  SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY:"false",
  SQUEEGEE_PRODUCTION_WRITES_PAUSED:"true",
};
const file=name=>fs.readFileSync(path.join(__dirname,"../netlify/functions/",name),"utf8");
test("read-only production preflight uses exact runtime and a private owner session",()=>{
 const source=file("squeegeeProductionAutoStatus.mjs");
 assert.match(source,/if\(!guard\.isVerifiedProductionScope\(scope\)\)/);
 assert.match(source,/owner\.validCookie\(/);
 assert.match(source,/if\(url\.searchParams\.get\("connectivity"\)==="1"\)/);
 assert.ok(source.indexOf('if(url.searchParams.get("connectivity")==="1")')>
   source.indexOf("owner.validCookie("));
 assert.match(source,/api\.getServices\(\)/);
 assert.match(source,/api\.getJobGroups\(\)/);
 assert.match(source,/SQUEEGEE_PRODUCTION_WRITES_PAUSED!=="true"/);
 assert.match(source,/SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED!=="false"/);
 assert.match(source,/SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES!=="false"/);
 assert.match(source,/SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY!=="false"/);
 assert.doesNotMatch(source,/api\.createCustomer|api\.addJobToCustomer/);
});
test("GET-only production integration can be checked while all writes stay blocked",async()=>{
 assert.equal(guard.productionConfigured(safe,scope),false);
 const accessed=[];
 const api=createProductionClient({env:safe,scope,
  fetchImpl:async(url,options)=>{
   accessed.push({path:url.pathname,method:options.method});
   assert.equal(options.method,"GET");
   assert.ok(!options.body);
   return {ok:true,status:200,json:async()=>({success:true,data:[]})};
  }});
 await Promise.all([api.getServices(),api.getJobGroups()]);
 assert.deepEqual(accessed.map(x=>x.method),["GET","GET"]);
 assert.ok(accessed.some(x=>x.path.endsWith("/services")));
 assert.ok(accessed.some(x=>x.path.endsWith("/job-groups")));
 await assert.rejects(()=>api.createCustomer({name:"NEVER POST"}),/disabled/);
 await assert.rejects(()=>api.addJobToCustomer("11111111-1111-4111-8111-111111111111",{}),/disabled/);
 assert.equal(accessed.length,2);
});
test("preview cannot use production read permissions or API credential",async()=>{
 const preview={hostname:"deploy-preview-77--nibinguy.netlify.app",
  deployContext:"deploy-preview",siteId:scope.siteId};
 const api=createProductionClient({env:safe,scope:preview,
   fetchImpl:async()=>{throw Error("should not contact Squeegee");}});
 await assert.rejects(()=>api.getServices(),/disabled/);
 await assert.rejects(()=>api.createCustomer({}),/disabled/);
});
test("prelaunch PDF, duplicate, dates and owner alerts have dedicated regression tests",()=>{
 const tests=[
  "tests/squeegee-prepared-terms-pdf.test.cjs",
  "tests/squeegee-owner-certificate.test.cjs",
  "tests/squeegee-idempotency-claims.test.cjs",
  "tests/squeegee-created-job-verification.test.cjs",
  "tests/squeegee-schedule-check.test.cjs",
  "tests/squeegee-sync-owner-alert.test.cjs"
 ];
 for(const p of tests)
   assert.ok(fs.statSync(path.join(__dirname,"..",p)).size>300,p);
 const receiver=file("squeegeeProductionAutoSync.mjs");
 assert.match(receiver,/signed_owner_terms_copy_required/);
 assert.match(receiver,/notifyOwnerOfSyncHold/);
 assert.match(receiver,/getStore\(\{name:guard.CLAIM_STORE,consistency:"strong"\}\)/);
});
