"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createTestSessionCookie,verifyTestSessionCookie,
  sessionCookieFromHeader,COOKIE_NAME,
  issueOwnerCode,verifyOwnerCode,
} = require("../netlify/functions/lib/squeegeePreviewTestSession");
const {executeOneApprovedTestBooking,GLOBAL_TEST_KEY,isEligibleOneBooking}=
  require("../netlify/functions/lib/squeegeeOneBookingTest");
const {claimOnce,changeClaimState}=
  require("../netlify/functions/lib/squeegeeIdempotencyClaims");
const {withOneApprovedPreviewTestWrite,isExactPreview1,assertWriteAllowed}=
  require("../netlify/functions/lib/squeegeeApiV3");

const env={
  CONTEXT:"deploy-preview",REVIEW_ID:"77",
  BRANCH:"preview/n64-retro-site",
  DEPLOY_PRIME_URL:"https://deploy-preview-77--nibinguy.netlify.app",
  SQUEEGEE_API_KEY:"test-only-fake-secret-00112233445566778899AABBCC",
};
const fixedNow=Date.parse("2026-10-30T14:00:00Z");
const validCookie=()=>COOKIE_NAME+"="+createTestSessionCookie(env,fixedNow);
const serviceId="11111111-1111-4111-8111-111111111111";
const groupId="22222222-2222-4222-8222-222222222222";
const customerId="33333333-3333-4333-8333-333333333333";
const services=[{id:serviceId,description:"Black"}];
const groups=[{id:groupId,description:"11"}];

function booking(id="NBG-ABCDE-ABCDEFGH"){
  return{
    bookingId:id,submittedAt:new Date().toISOString(),
    name:"One Test Customer",email:"owned.test@example.org",
    phone:"07000000000",address:"17 Example Street, Bangor BT20 4AA",
    termsAccepted:true,discountCode:"",
    bins:[{type:"Black Bin",count:1,planId:"domestic_4w"}],
    pricing:{
      lines:[{idx:0,type:"Black Bin",count:1,planId:"domestic_4w",
        baseUnit:5,unitPrice:5,lineTotal:5,freeCount:0,
        multiBuyDiscount:0,discounted:false}],
      subtotal:5,total:5,multiBuyDiscount:0,multiBuyFreeBins:0,
    },
    bookingScheduleSnapshot:{
      version:1,postcode:"BT20 4AA",matched:true,
      results:[{type:"Black Bin",automatic:true,assignedCleanDate:"2026-11-02"}],
    },
  };
}
const schedule=()=>({
  matched:true,postcode:"BT20 4AA",town:"BANGOR",
  results:[{bin:"Black Bin",town:"BANGOR",automatic:true,assignedCleanDate:"2026-11-02"}],
});
function fakeStore(){
  const records=new Map();let counter=0;
  return {
    records,
    async setJSON(key,value,{onlyIfNew,onlyIfMatch}={}){
      const original=records.get(key);
      if(onlyIfNew && original)return{modified:false};
      if(onlyIfMatch && (!original||original.etag!==onlyIfMatch))return{modified:false};
      const etag='"v'+(++counter)+'"';
      records.set(key,{etag,value});
      return {modified:true,etag};
    },
    async get(key){return records.get(key)?.value||null;},
  };
}
function harness({customerRows=[],createError=null,jobError=null,groupList=groups,
  accountPages=null}={}){
  const ledger=fakeStore();const events=[],statuses=[];
  const deps={
    getServices:async()=>services,
    getJobGroups:async()=>groupList,
    getSchedule:async()=>schedule(),
    listCustomers:async({page})=> accountPages?
      accountPages(page):
      {customers:customerRows,hasMore:false,page:1,pageSize:100},
    claim:args=>claimOnce({...args,store:ledger}),
    changeState:args=>changeClaimState({...args,store:ledger}),
    createCustomer:async input=>{
      events.push({event:"POST_customer",input});
      if(createError)throw createError;
      return customerId;
    },
    addJob:async (id,job)=>{
      events.push({event:"POST_job",id,job});
      if(jobError)throw jobError;
      return{success:true};
    },
    withWrite:async (proof,fn)=>{
      assert.equal(proof.key,GLOBAL_TEST_KEY);
      return fn();
    },
    save:async(bookingId,stage,extra)=>{
      statuses.push({bookingId,stage,...extra});
      return {saved:true};
    },
  };
  return{deps,ledger,events,statuses};
}
const run=(b,h,cookie=validCookie(),extra={})=>
  executeOneApprovedTestBooking(b,{
    cookieHeader:cookie,channel:"email",env,now:fixedNow,
    deps:h.deps,...extra,
  });

test("a preview-only session cookie is signed, expires, and never authenticates other contexts",()=>{
  assert.equal(isExactPreview1(env),true);
  const cookie=createTestSessionCookie(env,fixedNow);
  assert.equal(verifyTestSessionCookie(cookie,env,fixedNow),true);
  assert.equal(verifyTestSessionCookie(cookie,env,fixedNow+20*60*1000),false);
  assert.equal(verifyTestSessionCookie(cookie+"a",env,fixedNow),false);
  assert.equal(verifyTestSessionCookie(cookie,{...env,REVIEW_ID:"78"},fixedNow),false);
  assert.equal(verifyTestSessionCookie(cookie,{...env,BRANCH:"preview/voxel-arcade-v2"},fixedNow),false);
  assert.equal(verifyTestSessionCookie(cookie,{...env,CONTEXT:"production"},fixedNow),false);
  assert.equal(sessionCookieFromHeader("foo=bar; "+COOKIE_NAME+"="+cookie+"; something=1"),cookie);
});

test("OTP is emailed only to the configured business mailbox, can arm only once",async()=>{
  const store=fakeStore();let sent=null;
  const issued=await issueOwnerCode({
    env:{...env,BOOKINGS_TO:"info@nibing.uy"},
    now:fixedNow,store,sendCode:async x=>{sent=x;},
  });
  assert.equal(issued.ok,true);
  assert.equal(sent.to,"info@nibing.uy");
  assert.equal(sent.code.length,10);
  assert.equal(JSON.stringify([...store.records]).includes(sent.code),false);
  const wrong=await verifyOwnerCode({
    env,store,challengeId:issued.challengeId,code:"0000000000",now:fixedNow,
  });
  // A random 10-digit code may technically equal all zeroes, but negligible.
  if(sent.code!=="0000000000")assert.equal(wrong.ok,false);
  const valid=await verifyOwnerCode({
    env,store,challengeId:issued.challengeId,code:sent.code,now:fixedNow,
  });
  assert.equal(valid.ok,true);
  assert.equal(verifyTestSessionCookie(valid.cookie,env,fixedNow),true);
  const reused=await verifyOwnerCode({
    env,store,challengeId:issued.challengeId,code:sent.code,now:fixedNow,
  });
  assert.equal(reused.ok,false);
  const second=await issueOwnerCode({env,store,now:fixedNow,sendCode:async()=>{}});
  assert.equal(second.ok,false);
});

test("ordinary booking without owner session never calls external API or claims",async()=>{
  const h=harness();
  const result=await run(booking(),h,"");
  assert.equal(result.status,"not_started");
  assert.equal(h.events.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("a controlled booking creates exactly one new labelled customer and one 4-weekly round-11 job",async()=>{
  const h=harness();
  const result=await run(booking(),h);
  assert.equal(result.status,"test_completed");
  assert.equal(result.round,11);
  assert.equal(result.date,"2026-11-02");
  assert.deepEqual(h.events.map(e=>e.event),["POST_customer","POST_job"]);
  assert.ok(h.events[0].input.name.startsWith("TEST API - "));
  assert.equal(h.events[0].input.email,booking().email);
  assert.equal(h.events[1].id,customerId);
  assert.equal(h.events[1].job.date,"2026-11-02");
  assert.equal(h.events[1].job.firstAppointment.initialDate,"2026-11-02");
  assert.equal(h.events[1].job.frequencyType,"weeks");
  assert.equal(h.events[1].job.frequencyInterval,4);
  assert.equal(h.events[1].job.price,5);
  assert.equal(h.events[1].job.jobGroup,groupId);
  assert.deepEqual(h.events[1].job.services,[serviceId]);
  assert.equal(h.statuses.at(-1).stage,"created_one_customer_one_job");
  assert.equal(h.ledger.records.get(GLOBAL_TEST_KEY)?.value?.state,"succeeded");
});

test("a second booking can't reuse the one-shot test and can't create a duplicate",async()=>{
  const h=harness();
  const first=await run(booking(),h);
  const second=await run(booking("NBG-FGHIJ-HIJKLMNO"),h);
  assert.equal(first.status,"test_completed");
  assert.equal(second.status,"held");
  assert.equal(second.reason,"one_test_already_used_or_reservation_uncertain");
  assert.equal(h.events.filter(e=>e.event==="POST_customer").length,1);
  assert.equal(h.events.filter(e=>e.event==="POST_job").length,1);
});

test("existing Squeegee customer, even matching this address, blocks test creation",async()=>{
  const h=harness({customerRows:[{
    _id:customerId,name:"Existing",status:"active",
    email:booking().email,address:{addressDescription:booking().address},
    jobs:[],
  }]});
  const result=await run(booking(),h);
  assert.equal(result.status,"held");
  assert.equal(h.events.length,0);
  assert.equal(h.ledger.records.size,0);
});
test("customer list pagination must be exhausted before any Squeegee POST",async()=>{
  const h=harness({accountPages:()=>({customers:[],hasMore:true,page:1,pageSize:100})});
  const result=await run(booking(),h);
  assert.equal(result.status,"held");
  assert.equal(h.events.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("unknown or absent Squeegee job group blocks test, not assigned to another round",async()=>{
  const h=harness({groupList:[]});
  const result=await run(booking(),h);
  assert.equal(result.status,"held");
  assert.equal(result.reason,"prepared_booking_not_ready");
  assert.equal(h.events.length,0);
  assert.equal(h.ledger.records.size,0);
});

test("tampered website displayed date blocks test, even if account group exists",async()=>{
  const b=booking();
  b.bookingScheduleSnapshot.results[0].assignedCleanDate="2026-11-03";
  const h=harness();
  const result=await run(b,h);
  assert.equal(result.status,"held");
  assert.equal(h.events.length,0);
});

test("two bins, one-off plans, discounts or unsigned terms block one-shot test",async()=>{
  const cases=[
    {...booking(),bins:[...booking().bins,...booking().bins]},
    {...booking(),bins:[{...booking().bins[0],planId:"domestic_oneoff"}]},
    {...booking(),discountCode:"FRESH20"},
    {...booking(),termsAccepted:false},
  ];
  for(const b of cases){
    const h=harness();
    assert.equal(isEligibleOneBooking(b).eligible,false);
    const result=await run(b,h);
    assert.equal(result.status,"not_started");
    assert.equal(h.events.length,0);
  }
});

test("an ambiguous customer POST never creates the job and never retries",async()=>{
  const h=harness({createError:new Error("upstream timeout after possibly creating customer")});
  const first=await run(booking(),h);
  assert.equal(first.status,"requires_reconciliation");
  assert.equal(h.events.filter(e=>e.event==="POST_customer").length,1);
  assert.equal(h.events.filter(e=>e.event==="POST_job").length,0);
  assert.equal(h.statuses.at(-1).customerCreationMayHaveSucceeded,true);
  const second=await run(booking("NBG-QWERT-ZXCVBNMA"),h);
  assert.equal(second.status,"held");
  assert.equal(h.events.length,1);
});

test("an ambiguous job POST never repeats job creation",async()=>{
  const h=harness({jobError:new Error("upstream timeout after job was accepted")});
  const first=await run(booking(),h);
  assert.equal(first.status,"requires_reconciliation");
  assert.equal(h.events.filter(e=>e.event==="POST_customer").length,1);
  assert.equal(h.events.filter(e=>e.event==="POST_job").length,1);
  const second=await run(booking("NBG-ABCDE-BBBBBBBB"),h);
  assert.equal(second.status,"held");
  assert.equal(h.events.length,2);
});

test("normal public write attempts still require the existing multi-flag gate",()=>{
  assert.throws(()=>assertWriteAllowed(),/disabled/);
  assert.equal(typeof withOneApprovedPreviewTestWrite,"function");
});
