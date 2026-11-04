"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const SCOPE={
  site:{id:"d63c829f-3ed7-48e9-9633-a042de3f2e84"},
  deploy:{context:"deploy-preview"},
};

test("customer portal and private importer cannot access production data from release preview",async()=>{
  const {default:hq}=await import("../netlify/functions/customerHQ.mjs");
  const {default:producer}=await import("../netlify/functions/customerHQProduction.mjs");
  const {default:upload}=await import("../netlify/functions/squeegeeProductionCustomerHQImport.mjs");
  const request=new Request("https://deploy-preview-80--nibinguy.netlify.app/api/customer-hq",{
    method:"GET",
  });
  assert.equal((await hq(request,SCOPE)).status,404);
  assert.equal((await producer(request,SCOPE)).status,404);
  const source=new Request("https://deploy-preview-80--nibinguy.netlify.app/api/squeegee-production-hq-import",{
    method:"GET",
  });
  assert.equal((await upload(source,SCOPE)).status,404);
});

test("production Customer HQ requires independently enabled read-only Squeegee and portal secrets",async()=>{
  const {default:hq}=await import("../netlify/functions/customerHQProduction.mjs");
  const result=await hq(new Request("https://nibing.uy/api/customer-hq"),{
    site:SCOPE.site,deploy:{context:"production"},
  });
  // The test environment intentionally has no production credentials.
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.ready,false);
  assert.equal(body.authenticated,false);
  assert.equal(body.reason,"production_setup_pending");
});

test("production private importer is owner-only, HMAC-CSRF protected, and never permits preview or arbitrary origins",()=>{
  const src=read("netlify/functions/squeegeeProductionCustomerHQImport.mjs");
  assert.match(src,/owner\.validCookie\(/);
  assert.match(src,/csrfValid\(/);
  assert.match(src,/SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET/);
  assert.match(src,/form\.get\("verifiedSource"\)!=="yes"/);
  assert.match(src,/data\.validateSource\(JSON\.parse\(source\)\)/);
  assert.match(src,/onlyIfMatch:oldConsent\.etag/);
  assert.match(src,/onlyIfMatch:prior\.etag/);
  assert.match(src,/CONSENT FIRST, HISTORY SECOND/);
  assert.doesNotMatch(src,/SQUEEGEE_API_KEY|createCustomer\(|addJobToCustomer\(/);
});

test("public live scoreboard uses distinct private production data and consent, not old Preview 1 seed",()=>{
  const leader=read("netlify/functions/arcadeLeaderboard.js");
  assert.match(leader,/prodData\.scores\(snapshot,consent,process\.env,\{year\}\)/);
  assert.match(leader,/prodData\.DATA_STORE/);
  assert.match(leader,/prodData\.CONSENT_STORE/);
  assert.match(leader,/host==="nibing\.uy"/);
  assert.match(leader,/if\(isExactN64PreviewRequest\(event\)\)/);
});
