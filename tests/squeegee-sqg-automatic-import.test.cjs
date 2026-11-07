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
test("only owner Squeegee .sqg is accepted; browser and worker never upload raw archive",()=>{
 const page=content("netlify/functions/squeegeePreviewCustomerHQImport.mjs");
 const ui=content("public/customer-hq-sqg-import.mjs");
 const worker=content("public/customer-hq-sqg-worker.mjs");
 assert.ok(page.includes('accept=".sqg,application/octet-stream,.json,application/json"'));
 assert.ok(page.includes("referenceMap"));
 assert.ok(page.includes("verifyTestSessionCookie"));
 assert.ok(page.includes("uploadCsrf.isAllowedOwnerUpload"));
 assert.ok(page.includes("worker-src 'self'"));
 assert.ok(ui.includes('new Worker("/customer-hq-sqg-worker.mjs?v=per-job-v2-20261107"'));
 assert.ok(ui.includes('result?.snapshot?.scoringVersion!=="2026-11-streak-20-plus-2-per-job-per-paid-bin-v2"'));
 assert.ok(worker.includes('customer-hq-sqg-converter.mjs?v=per-job-v2-20261107'));
 assert.ok(worker.includes('SCORE_VERSION!=="2026-11-streak-20-plus-2-per-job-per-paid-bin-v2"'));
 assert.ok(ui.includes('fetch(form.action,{method:"POST"'));
 assert.ok(ui.includes('body.append("history",bytes,'));
 assert.ok(!ui.includes('body.append("history",file'));
 assert.ok(worker.includes("filter(x=>/^data-"));
 assert.ok(worker.includes('callMain(["x"'));
 assert.ok(worker.includes("500000000"));
 assert.ok(worker.includes("githubusercontent.com/use-strict/7z-wasm/521d2cf93f5964f4e77b01049e19f1b29305c454"));
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
test("automatic conversion matches physical bin quantities with independent job streaks",async()=>{
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
test("different jobs on one customer earn independently and one skipped job does not reset the other",async()=>{
 const {state,uuid,customerIds,finishSqueegeeImport}=await seed();
 const firstId=customerIds[0];
 const invoice=uuid(999991);
 const {acceptSqueegeeRecord}=await load();
 acceptSqueegeeRecord(state,{resourceType:"transactions",
  _id:invoice,customerId:firstId,transactionType:0,
  amount:5,invoice:{paid:true}});
 // Keep the original customer's account balance at zero: the first
 // source invoice is only marked 'invoiced' and requires zero balance.
 acceptSqueegeeRecord(state,{resourceType:"transactions",
  _id:uuid(999994),customerId:firstId,transactionType:1,amount:-5});
 // The original first job was completed on Nov 6. Second occurrence on
 // Nov 7 earns +22, despite a skip on a DIFFERENT Brown job the same day.
 acceptSqueegeeRecord(state,{resourceType:"joboccurrences",
  _id:uuid(999992),jobId:uuid(501000),customerId:firstId,
  status:1,isoDueDate:"2026-11-07",
  invoiceTransactionId:invoice,paymentStatus:"paid",paidDate:"2026-11-07",
  services:[{description:"Brown",quantity:1}]});
 acceptSqueegeeRecord(state,{resourceType:"joboccurrences",
  _id:uuid(999993),jobId:uuid(501001),customerId:firstId,
  status:2,isoDueDate:"2026-11-07"});
 const next=finishSqueegeeImport(state,"2026-11-07");
 const customer=next.snapshot.accounts.find(a=>a.id===firstId);
 const brownA=customer.jobs.find(j=>j.id===uuid(501000));
 const brownB=customer.jobs.find(j=>j.id===uuid(501001));
 assert.equal(brownA.currentStreak,2);
 assert.equal(brownA.nextBonus,24);
 assert.equal(brownB.currentStreak,0);
 assert.equal(brownB.nextBonus,20);
 assert.equal(customer.paidCleans,25);
 assert.equal(customer.points,502);
 assert.equal(customer.recordedSkips,1);
 assert.equal(next.summary.verifiedPaidBins,901*24+1);
 assert.equal(next.snapshot.scoringVersion,
  "2026-11-streak-20-plus-2-per-job-per-paid-bin-v2");
});
test("genuine Squeegee .sqg occurrence IDs bind the recurring job UUID and YYYY-MM-DD",async()=>{
 const {makeState,acceptSqueegeeRecord}=await load();
 const state=makeState();
 const customerId="11111111-1111-4111-8111-111111111111";
 const jobId="22222222-2222-4222-8222-222222222222";
 const paid={resourceType:"joboccurrences",customerId,jobId,status:1,
  _id:jobId+"2026-11-06",isoDueDate:"2026-11-06",
  services:[{description:"Brown",quantity:2}]};
 acceptSqueegeeRecord(state,paid);
 assert.equal(state.occurrences.length,1);
 assert.equal(state.occurrences[0].id,jobId+"2026-11-06");
 assert.equal(state.occurrences[0].jobId,jobId);
 // Exact duplicates from replicated backup parts never create another clean.
 acceptSqueegeeRecord(state,{...paid});
 assert.equal(state.occurrences.length,1);
 // A recorded skip on the same job and a different date stays a separate event.
 acceptSqueegeeRecord(state,{...paid,status:2,isoDueDate:"2026-11-07",
  _id:jobId+"2026-11-07",services:[]});
 assert.equal(state.occurrences.length,2);
 assert.equal(state.occurrences[1].status,2);
});
test("Squeegee occurrence identity fails closed if job or date does not match",async()=>{
 const {makeState,acceptSqueegeeRecord}=await load();
 const customerId="11111111-1111-4111-8111-111111111111";
 const jobId="22222222-2222-4222-8222-222222222222";
 const secondJob="33333333-3333-4333-8333-333333333333";
 const make=(changes={})=>({resourceType:"joboccurrences",
  _id:jobId+"2026-11-06",jobId,customerId,status:1,
  isoDueDate:"2026-11-06",services:[{description:"Brown"}],...changes});
 for(const mutation of [
  {_id:jobId+"2026-11-07"}, // date mismatch
  {jobId:secondJob},       // wrong recurring job
  {_id:jobId+"2026-11-06-extra"}, // not an authoritative ID
  {_id:""},                // absent identity
 ]){
  assert.throws(()=>acceptSqueegeeRecord(makeState(),make(mutation)),
   /squeegee_occurrence/);
 }
 const state=makeState();
 acceptSqueegeeRecord(state,make());
 assert.throws(()=>acceptSqueegeeRecord(state,
  make({services:[{description:"Blue"}]})),/conflicting_squeegee_occurrence/);
 assert.equal(state.occurrences.length,1);
});
test("an occurrence without a stable Squeegee job ID is rejected, not guessed from colour",async()=>{
 const {makeState,acceptSqueegeeRecord}=await load();
 const state=makeState();
 assert.throws(()=>acceptSqueegeeRecord(state,{
  resourceType:"joboccurrences",
  _id:"11111111-1111-4111-8111-111111111111",
  customerId:"22222222-2222-4222-8222-222222222222",
  isoDueDate:"2026-11-06",status:1,services:[{description:"Brown"}]
 }),/missing_squeegee_recurring_job_id/);
});
test("the same recurring job ID cannot be attached to two customers",async()=>{
 const {makeState,acceptSqueegeeRecord}=await load();
 const state=makeState();
 const jobId="11111111-1111-4111-8111-111111111111";
 const build=(customerId,occurrenceId)=>({
  resourceType:"joboccurrences",jobId,customerId,
  _id:occurrenceId,isoDueDate:"2026-11-06",status:2
 });
 acceptSqueegeeRecord(state,build("22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"));
 assert.throws(()=>acceptSqueegeeRecord(state,
  build("44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555")),
  /squeegee_job_shared_by_multiple_customers/);
});
test("known November 6 audit cannot be silently overwritten by an invalid reconciliation",async()=>{
 const {result,state,finishSqueegeeImport}=await seed();
 assert.equal(result.snapshot.asOf,"2026-11-07");
 assert.throws(()=>finishSqueegeeImport(state,"2026-11-06"),
   /known_6_nov_backup_mismatch/);
});
