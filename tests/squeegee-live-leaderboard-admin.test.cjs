"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const base=path.resolve(__dirname,"..");
const load=()=>import(pathToFileURL(path.join(base,
  "public/leaderboard-admin-sqg-converter-20261128.mjs")).href);
const content=p=>fs.readFileSync(path.join(base,p),"utf8");
function seed({day="2026-11-07",skip=false}={}){
 return load().then(({makeState,acceptSqueegeeRecord,finishSqueegeeImport})=>{
  const state=makeState();
  const uuid=i=>"00000000-0000-4000-8000-"+i.toString(16).padStart(12,"0");
  let counter=1;
  const customerIds=[];
  for(let i=1;i<=901;i++){
   const id=uuid(i);customerIds.push(id);
   acceptSqueegeeRecord(state,{resourceType:"customers",_id:id,
    _externalId:String(2000+i),name:"Customer Example",
    state:"active",address:{addressDescription:"Bangor, County Down"},
    email:"customer"+i+"@example.test"});
   for(let j=0;j<12;j++){
    const invoice=uuid(counter+10000);counter++;
    const unfinished=i===1&&j===0;
    acceptSqueegeeRecord(state,{resourceType:"transactions",
     _id:invoice,customerId:id,transactionType:0,
     amount:10,invoice:{paid:!unfinished}});
    acceptSqueegeeRecord(state,{resourceType:"joboccurrences",
     _id:uuid(counter+20000),jobId:uuid(500000+i*1000+j),customerId:id,
     status:1,isoDueDate:"2026-11-06",
     paymentStatus:unfinished?"invoiced":"paid",
     paidDate:unfinished?null:"2026-11-06",invoiceTransactionId:invoice,
     services:j===0?[{description:"Brown",quantity:1},{description:"Black",quantity:1}]:
      [{description:"Brown",quantity:2}]});
   }
  }
  acceptSqueegeeRecord(state,{resourceType:"transactions",
   _id:uuid(888888),customerId:customerIds[0],transactionType:1,amount:-120});
  if(skip)acceptSqueegeeRecord(state,{resourceType:"joboccurrences",
   customerId:customerIds[0],jobId:uuid(501000),_id:uuid(987654),status:2,
   isoDueDate:"2026-11-05",skipReason:"Not Out"});
  const result=finishSqueegeeImport(state,day);
  return {result,state,uuid,customerIds,finishSqueegeeImport};
 });
}

test("live backup converter accepts new NBG reference; server verifies entire current snapshot",async()=>{
 const {state,customerIds,finishSqueegeeImport}=await seed();
 state.customers.get(customerIds[0]).ref="NBG-ABCDEFG2";
 const {snapshot}=finishSqueegeeImport(state,"2026-11-07");
 assert.equal(snapshot.accounts.find(a=>a.id===customerIds[0]).ref,"NBG-ABCDEFG2");
 const validator=require("../netlify/functions/lib/squeegeePreviewBinHistory");
 assert.doesNotThrow(()=>validator.validateBinSource(snapshot,{now:Date.parse("2026-11-07T12:00:00Z")}));
 state.customers.get(customerIds[0]).ref="NBG-INVALID!";
 assert.throws(()=>finishSqueegeeImport(state,"2026-11-07"),/unverified_squeegee_customer_reference/);
});
test("live leaderboard login is independently scoped and cannot authorise other owner tools",()=>{
 const owner=require("../netlify/functions/lib/leaderboardOwnerAuth");
 const booking=require("../netlify/functions/lib/squeegeeProductionOwnerAuth");
 const csrf=require("../netlify/functions/lib/leaderboardOwnerCsrf");
 const env={SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET:"a".repeat(64)};
 const scope={hostname:"nibing.uy",deployContext:"production",siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84"};
 const now=Date.parse("2026-11-28T14:00:00Z");
 const cookie=owner.issueCookie(env,now,scope);
 assert.equal(owner.validCookie(cookie,env,now,scope),true);
 assert.equal(owner.validCookie(cookie,env,now,{...scope,deployContext:"deploy-preview"}),false);
 assert.equal(owner.validCookie(cookie,env,now,{...scope,hostname:"deploy-preview-77--nibinguy.netlify.app"}),false);
 assert.equal(booking.validCookie(cookie,env,now,scope),false);
 assert.equal(owner.validCookie(booking.issueCookie(env,now,scope),env,now,scope),false);
 assert.equal(owner.validCookie(cookie,env,now+owner.COOKIE_MS,scope),false);
 const token=csrf.tokenForOwnerSession(cookie,env);
 assert.ok(token);
 assert.equal(csrf.isAllowedOwnerUpload({cookie,token,env,headers:new Headers({origin:"https://nibing.uy"})}),true);
 assert.equal(csrf.isAllowedOwnerUpload({cookie,token,env,headers:new Headers({origin:"https://foreign.example"})}),false);
 assert.equal(csrf.isAllowedOwnerUpload({cookie,token:"invalid",env,headers:new Headers({origin:"https://nibing.uy"})}),false);
});
test("production dashboard and uploader keep private routes and new importer filenames isolated",()=>{
 const page=content("netlify/functions/leaderboardAdminUpload.mjs");
 const admin=content("netlify/functions/leaderboardAdmin.mjs");
 const login=content("netlify/functions/leaderboardAdminLogin.mjs");
 const ui=content("public/leaderboard-admin-sqg-import-20261128.mjs");
 const worker=content("public/leaderboard-admin-sqg-worker-20261128.mjs");
 for(const source of [page,admin,login]){
   assert.ok(source.includes("isVerifiedProductionScope"));
   assert.ok(!source.includes("squeegeePreviewTestSession"));
   assert.ok(!source.includes("squeegee-preview-test?"));
 }
 assert.ok(page.includes("session.validCookie"));
 assert.ok(page.includes("uploadCsrf.isAllowedOwnerUpload"));
 assert.ok(page.includes("onlyIfMatch:previousRecord.etag"));
 assert.ok(admin.includes("owner.validCookie"));
 assert.ok(page.includes("leaderboard-admin-sqg-import-20261128.mjs"));
 assert.ok(ui.includes("leaderboard-admin-sqg-worker-20261128.mjs"));
 assert.ok(worker.includes("leaderboard-admin-sqg-converter-20261128.mjs"));
});
