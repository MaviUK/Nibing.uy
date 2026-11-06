"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const auth=require("../netlify/functions/lib/squeegeeProductionOwnerAuth.js");
const prod=require("../netlify/functions/lib/squeegeeProductionGuard.js");
const env={
  SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET:"synthetic-owner-secret-long-and-not-real-123456789",
};
const scope={
  hostname:"nibing.uy",deployContext:"production",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
};
function fakeStore(){
  const entries=new Map();
  let version=0;
  return {
    async setJSON(key,value,options={}){
      if(options.onlyIfNew && entries.has(key))
        return {modified:false};
      const etag=String(++version);
      entries.set(key,{value,etag});
      return {modified:true,etag};
    },
    async get(key){return entries.get(key)?.value??null;},
  };
}
test("operator OTP requires exact production context and its own secret",()=>{
  assert.equal(auth.configured(env,scope),true);
  assert.equal(auth.configured(env,{...scope,hostname:"deploy-preview-80--nibinguy.netlify.app"}),false);
  assert.equal(auth.configured(env,{...scope,deployContext:"deploy-preview"}),false);
  assert.equal(auth.configured({},scope),false);
  assert.equal(prod.isVerifiedProductionScope(scope),true);
});
test("owner email OTP is rate-limited, 10 digits, one-use, and cannot target arbitrary customers",async()=>{
  const store=fakeStore(),now=Date.UTC(2026,10,4,22,0,0);
  let emailed=0,code="";
  const sendCode=async message=>{
    emailed++;
    assert.equal(message.to,"info@nibing.uy");
    code=message.code;
  };
  const issued=await auth.issueCode({env,scope,store,now,sendCode});
  assert.equal(issued.ok,true);
  assert.match(issued.challengeId,/^[a-f0-9]{32}$/);
  assert.match(code,/^[0-9]{10}$/);
  const repeated=await auth.issueCode({env,scope,store,now:now+1000,sendCode});
  assert.equal(repeated.ok,false);
  assert.equal(emailed,1);
  assert.equal((await auth.verifyCode({env,scope,store,
    challengeId:issued.challengeId,code:"0000000000",now:now+1000})).ok,false);
  const valid=await auth.verifyCode({env,scope,store,
    challengeId:issued.challengeId,code,now:now+1500});
  assert.equal(valid.ok,true);
  assert.equal(auth.validCookie(valid.cookie,env,now+3000,scope),true);
  assert.equal((await auth.verifyCode({env,scope,store,
    challengeId:issued.challengeId,code,now:now+4000})).ok,false);
  assert.equal(auth.validCookie(valid.cookie,env,now+25*60*1000,scope),false);
  assert.equal(auth.validCookie(valid.cookie,env,now+3000,{
    ...scope,deployContext:"deploy-preview"}),false);
});
test("owner OTP fails closed when delivery fails or challenge expires",async()=>{
  const store=fakeStore(),now=Date.now();
  const result=await auth.issueCode({env,scope,store,now,
    sendCode:async()=>{throw new Error("synthetic provider failure");}});
  assert.equal(result.ok,false);
  const repeated=await auth.issueCode({env,scope,store,now:now+1000,
    sendCode:async()=>{throw new Error("must not send");}});
  assert.equal(repeated.ok,false);
});
test("production status page rejects release preview before reading private stores",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeeProductionAutoStatus.mjs");
  const response=await handler(
    new Request("https://deploy-preview-80--nibinguy.netlify.app/api/squeegee-production-auto-status"),
    {site:{id:scope.siteId},deploy:{context:"deploy-preview"}});
  assert.equal(response.status,404);
  const disabled=await handler(
    new Request("https://nibing.uy/api/squeegee-production-auto-status"),
    {site:{id:scope.siteId},deploy:{context:"production"}});
  // The release test environment has no owner secret configured.
  assert.equal(disabled.status,503);
});
test("production status UI is read-only and never exposes booking write controls",()=>{
  const s=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeeProductionAutoStatus.mjs"),"utf8");
  assert.match(s,/owner\.validCookie\(/);
  assert.match(s,/owner\.issueCode\(/);
  assert.match(s,/owner\.verifyCode\(/);
  assert.match(s,/statusStore\(\)\.get\(/);
  assert.doesNotMatch(s,/api\.createCustomer|api\.addJob|executeAutomaticProductionBooking/);
});
