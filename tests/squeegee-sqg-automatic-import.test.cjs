"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const base=path.resolve(__dirname,"..");
const load=()=>import(pathToFileURL(path.join(base,
  "public/customer-hq-sqg-converter.mjs")).href);
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
     _id:uuid(counter+20000),customerId:id,
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
   customerId:customerIds[0],_id:uuid(987654),status:2,
   isoDueDate:"2026-11-05",skipReason:"Not Out"});
  const result=finishSqueegeeImport(state,day);
  return {result,state,uuid,customerIds,finishSqueegeeImport};
 });
}
test("only owner Squeegee .sqg is accepted; browser and worker never upload raw archive",()=>{
 const page=content("netlify/functions/squeegeePreviewCustomerHQImport.mjs");
 const ui=content("public/customer-hq-sqg-import.mjs");
 const worker=content("public/customer-hq-sqg-worker.mjs");
 assert.match(page,/\\.sqg,application\\/octet-stream/);
 assert.match(page,/referenceMap/);
 assert.match(page,/verifyTestSessionCookie/);
 assert.match(page,/uploadCsrf\.isAllowedOwnerUpload/);
 assert.match(page,/worker-src 'self'/);
 assert.match(ui,/new Worker\\("\\/customer-hq-sqg-worker\\.mjs"/);
 assert.match(ui,/fetch\\(form\\.action,\\{method:"POST"/);
 assert.match(ui,/body\\.append\\("history",bytes,/);
 assert.doesNotMatch(ui,/body\\.append\\("history",file/);
 assert.ok(worker.includes("filter(x=>/^data-"));
 assert.match(worker,/callMain\\(\\["x"/);
 assert.match(worker,/MAX|500000000/);
 assert.match(worker,/githubusercontent.com\\/use-strict\\/7z-wasm\\/521d2cf93f5964f4e77b01049e19f1b29305c454/);
});
test("the archive parser uses customer status and amount signs, never counts deleted records",async()=>{
 const {makeState,acceptSqueegeeRecord}=await load(),state=makeState();
 const id="11111111-1111-4111-8111-111111111111";
 acceptSqueegeeRecord(state,{resourceType:"customers",_id:id,_externalId:"121",
  state:"inactive",address:{addressDescription:"Bangor"}});
 acceptSqueegeeRecord(state,{resourceType:"customers",_id:id,_externalId:"121",
  state:"active",_deleted:true});
 assert.equal(state.customers.size,0);
 acceptSqueegeeRecord(state,{resourceType:"customers",_id:id,_externalId:"121",state:"active"});
 assert.equal(state.customers.size,1);
 acceptSqueegeeRecord(state,{resourceType:"transactions",_id:id,customerId:id,
  amount:10,transactionType:0,invoice:{paid:false}});
 acceptSqueegeeRecord(state,{resourceType:"transactions",
  customerId:id,amount:-10,transactionType:1});
 assert.equal(state.balance.get(id),0);
 assert.equal(state.invoices.get(id).paid,false);
});
test("automatic conversion matches physical bin quantities and customer-day streaks",async()=>{
 const {result}=await seed();
 assert.equal(result.snapshot.accounts.length,901);
 assert.equal(result.summary.verifiedPaidBins,901*12*2);
 const first=result.snapshot.accounts.find(x=>x.ref==="2001");
 assert.equal(first.paidCleans,24);
 assert.equal(first.points,480);
 assert.equal(first.currentStreak,1);
 assert.equal(first.nextBonus,22);
 assert.equal(first.events.filter(x=>x.event==="paid_completed_clean").length,12);
 assert.ok(first.events.every(x=>x.streak===1));
 assert.equal(result.summary.points,901*480);
 assert.equal(result.summary.heldOccurrences,0);
});
test("recorded skips reset streaks but never create XP or physical bins",async()=>{
 const {result}=await seed({skip:true});
 const first=result.snapshot.accounts.find(x=>x.ref==="2001");
 assert.equal(first.recordedSkips,1);
 assert.equal(first.events[0].event,"recorded_skip");
 assert.equal(first.events[0].points,0);
 assert.equal(result.summary.verifiedPaidBins,901*24);
});
test("known November 6 audit cannot be silently overwritten by an invalid reconciliation",async()=>{
 const {result,state,finishSqueegeeImport}=await seed();
 assert.equal(result.snapshot.asOf,"2026-11-07");
 assert.throws(()=>finishSqueegeeImport(state,"2026-11-06"),
   /known_6_nov_backup_mismatch/);
});
