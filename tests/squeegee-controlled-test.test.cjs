"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
 TEST_LOCK_KEY,TEST_BOOKING_ID,runControlledTest,
 scanAllForTestCustomer,postOneTest,
}=require("../netlify/functions/lib/squeegeeControlledTestWriter");
const data=require("../netlify/functions/lib/squeegeeControlledTestData");

const CUSTOMER_ID="11111111-1111-4111-8111-111111111111";
const SERVICE_ID="22222222-2222-4222-8222-222222222222";
const GROUP_ID="33333333-3333-4333-8333-333333333333";
const services=async()=>[{id:SERVICE_ID,description:"Black"}];
const groups=async()=>[{id:GROUP_ID,description:"11"}];
const customers=async()=>({customers:[],hasMore:false});
function deps(opts={}){
 let created=0,claimed=0,changed=0;
 const requests=[];
 const writes={
   readServices:services,
   readGroups:groups,
   listPage:customers,
   claim:async ()=>{claimed++;return {acquired:true,etag:'"claim-'+claimed+'"'};},
   update:async()=>{changed++;return '"updated-'+changed+'"';},
   post:async(path,body)=>{
     created++;
     requests.push({path,body});
     return created===1?{success:true,data:CUSTOMER_ID}:{success:true};
   },
   ...opts,
 };
 return {writes,requests,counts:()=>({created,claimed,changed})};
}

test("test customer is synthetic, has no real phone or email, and never bills",()=>{
 const c=data.TEST_CUSTOMER;
 assert.match(c.name,/TEST/);
 assert.match(c.name,/DO NOT CLEAN/);
 assert.match(c.notes,/DO NOT VISIT/);
 assert.match(c.notes,/DO NOT BILL|INVOICE OR BILL/);
 assert.equal(c.email,undefined);
 assert.equal(c.phone,undefined);
 assert.equal(c.address.coords,undefined);
 assert.equal(data.FIRST_DATE,"2026-11-02");
 assert.equal(TEST_BOOKING_ID,"NBG-P77TEST-ABCDEFGH");
 assert.match(TEST_LOCK_KEY,/test/);
 const body=data.createTestJob({serviceId:SERVICE_ID,groupId:GROUP_ID});
 assert.equal(body.date,"2026-11-02");
 assert.equal(body.firstAppointment.initialDate,"2026-11-02");
 assert.equal(body.frequencyType,"weeks");
 assert.equal(body.frequencyInterval,4);
 assert.equal(body.price,0);
 assert.equal(body.jobGroup,GROUP_ID);
 assert.deepEqual(body.services,[SERVICE_ID]);
});

test("creates at most one synthetic customer and one 4-weekly test job",async()=>{
 const a=deps();
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"test_customer_and_job_created");
 assert.equal(result.customerCreated,true);
 assert.equal(result.jobCreated,true);
 assert.equal(result.priceGBP,0);
 assert.equal(result.groupNumber,11);
 assert.equal(a.counts().created,2);
 assert.equal(a.counts().claimed,2);
 assert.equal(a.requests[0].path,"/api/v3/public/customers");
 assert.equal(a.requests[1].path,"/api/v3/public/customers/"+CUSTOMER_ID+"/jobs");
 assert.equal(a.requests[1].body.price,0);
 assert.equal(a.requests[1].body.frequencyInterval,4);
});

test("duplicate control claim blocks both Squeegee POSTs",async()=>{
 const a=deps({claim:async()=>({acquired:false})});
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"already_claimed_or_uncertain");
 assert.equal(a.counts().created,0);
});

test("pre-existing test external reference aborts before any claim or POST",async()=>{
 const a=deps({
   listPage:async()=>({customers:[{_externalId:data.TEST_REFERENCE}],
     hasMore:false}),
 });
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"blocked_read_only");
 assert.equal(result.reason,"test_customer_already_exists");
 assert.equal(a.counts().created,0);
 assert.equal(a.counts().claimed,0);
});

test("all customer pages are scanned before finding no duplicate",async()=>{
 const pages=[];
 const result=await scanAllForTestCustomer(async({page,pagedRequestId})=>{
   pages.push({page,pagedRequestId});
   return page===1?{customers:[],hasMore:true,pagedRequestId:"snapshot"}
      :{customers:[],hasMore:false};
 });
 assert.equal(result.complete,true);
 assert.equal(result.conflict,false);
 assert.equal(result.pages,2);
 assert.deepEqual(pages,[{page:1,pagedRequestId:undefined},
    {page:2,pagedRequestId:"snapshot"}]);
});

test("truncated customer list never allows a Squeegee write",async()=>{
 const a=deps({listPage:async()=>({customers:[],hasMore:true})});
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"blocked_read_only");
 assert.equal(result.reason,"customer_scan_incomplete");
 assert.equal(a.counts().created,0);
});

test("failed customer create stops before job POST and marks result uncertain",async()=>{
 const a=deps({post:async()=>{
   const e=Error("Expected simulated rejection");e.httpStatus=400;throw e;
 }});
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"customer_post_uncertain");
 assert.equal(result.customerCreated,false);
 assert.equal(result.jobCreated,false);
 assert.equal(result.httpStatus,400);
});

test("job POST failure retains customer and never repeats the job",async()=>{
 let counter=0;
 const a=deps({post:async()=>{
   counter++;
   if(counter===1)return {success:true,data:CUSTOMER_ID};
   const e=Error("Simulated API error");e.httpStatus=403;throw e;
 }});
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"job_post_uncertain");
 assert.equal(result.customerCreated,true);
 assert.equal(result.jobCreated,false);
 assert.equal(counter,2);
});

test("bad Squeegee POST routes fail closed before making fetch requests",async()=>{
 await assert.rejects(
   postOneTest("/api/v3/public/customers/123/invoices",{amount:100},async()=>{throw Error("must not fetch");}),
   /Disallowed/
 );
});

test("service or round missing blocks all test writes",async()=>{
 const a=deps({readGroups:async()=>[]});
 const result=await runControlledTest(a.writes);
 assert.equal(result.status,"blocked_read_only");
 assert.equal(a.counts().created,0);
});
