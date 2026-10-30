"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createTestSessionCookie,verifyTestSessionCookie,
  sessionCookieFromHeader,COOKIE_NAME,
  issueOwnerCode,verifyOwnerCode,
} = require("../netlify/functions/lib/squeegeePreviewTestSession");
const {executeOneApprovedTestBooking,GLOBAL_TEST_KEY,isEligibleOneBooking,saveTestStatus}=
  require("../netlify/functions/lib/squeegeeOneBookingTest");
const {claimOnce,changeClaimState}=
  require("../netlify/functions/lib/squeegeeIdempotencyClaims");
const {withOneApprovedPreviewTestWrite,isExactPreview1,assertWriteAllowed}=
  require("../netlify/functions/lib/squeegeeApiV3");
const {reconcileAcceptedBooking,findAcceptedAudit}=
  require("../netlify/functions/lib/squeegeeOneBookingReconcile");
const {RECOVERY_BOOKING_ID,originalAcceptedBooking,inspectAcceptedBooking}=
  require("../netlify/functions/lib/squeegeeAcceptedBookingRecovery");

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

test("the deployed worker has an exported durable status writer before any Squeegee POST",async()=>{
  assert.equal(typeof saveTestStatus,"function");
  const store=fakeStore();
  const saved=await saveTestStatus("NBG-ABCDE-ABCDEFGH","validating",{}, {store});
  assert.equal(saved.stage,"validating");
  assert.equal(store.records.get("NBG-ABCDE-ABCDEFGH")?.value?.stage,"validating");
  assert.equal(store.records.size,1);
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


test("modern Netlify context validates Preview 1 even without build-time environment variables",()=>{
  const runtime={
    hostname:"deploy-preview-77--nibinguy.netlify.app",
    deployContext:"deploy-preview",
    siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
  };
  const runtimeEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY};
  assert.equal(isExactPreview1(runtimeEnv,runtime),true);
  const cookie=createTestSessionCookie(runtimeEnv,fixedNow,runtime);
  assert.equal(verifyTestSessionCookie(cookie,runtimeEnv,fixedNow,runtime),true);
  assert.equal(isExactPreview1(runtimeEnv,{...runtime,hostname:"nibing.uy"}),false);
  assert.equal(isExactPreview1(runtimeEnv,{...runtime,deployContext:"production"}),false);
  assert.equal(isExactPreview1(runtimeEnv,{...runtime,
    siteId:"00000000-0000-4000-8000-000000000000"}),false);
});
test("one booking test can run with trusted context even without reserved runtime variables",async()=>{
  const h=harness();
  const runtimeScope={
    hostname:"deploy-preview-77--nibinguy.netlify.app",
    deployContext:"deploy-preview",
    siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
  };
  const runtimeEnv={SQUEEGEE_API_KEY:env.SQUEEGEE_API_KEY};
  const cookie=COOKIE_NAME+"="+createTestSessionCookie(runtimeEnv,fixedNow,runtimeScope);
  const result=await executeOneApprovedTestBooking(booking(),{
    env:runtimeEnv,runtimeScope,cookieHeader:cookie,
    now:fixedNow,channel:"email",deps:h.deps,
  });
  assert.equal(result.status,"test_completed");
  assert.equal(h.events.length,2);
});


function mockAcceptedAuditStore(rows=[]) {
  return {
    async list({prefix}) {
      return {blobs:rows.filter(item=>item.key.startsWith(prefix))
        .map(item=>({key:item.key}))};
    },
    async get(key) {return rows.find(x=>x.key===key)?.row||null;},
  };
}
function mockAcceptedAuditRecord() {
  return {
    bookingId:"NBG-ABCDE-ABCDEFGH",channel:"email",termsAccepted:true,
    name:"Original Test Person",email:"test.person@example.org",
    address:"17 Example Street, Bangor BT20 4AA",phone:"07000000000",
    bins:[{type:"Black Bin",planId:"domestic_4w",count:1}],
  };
}
const archived=(row=mockAcceptedAuditRecord())=>mockAcceptedAuditStore([{
  key:"2026-10-30T15:28:57.700Z__test.person@example.org.json",
  row,
}]);

test("reconciliation never accesses Squeegee when accepted booking audit is absent",async()=>{
  let requested=false;
  const result=await reconcileAcceptedBooking("NBG-ABCDE-ABCDEFGH",{
    auditStore:mockAcceptedAuditStore(),
    listCustomers:async()=>{requested=true;throw Error("unexpected");},
    getCustomer:async()=>{requested=true;throw Error("unexpected");},
  });
  assert.equal(result.audit,"not_found");
  assert.equal(result.customer,"not_checked");
  assert.equal(requested,false);
});

test("owner-only reconciliation scans the existing customers without creating any records",async()=>{
  let reads=0;
  const result=await reconcileAcceptedBooking("NBG-ABCDE-ABCDEFGH",{
    auditStore:archived(),
    listCustomers:async()=>{reads++;return{
      customers:[],hasMore:false,page:1,pageSize:100,
    };},
    getCustomer:async()=>{throw Error("not expected");},
  });
  assert.equal(result.audit,"found");
  assert.equal(result.customer,"not_found");
  assert.equal(result.pagesScanned,1);
  assert.equal(reads,1);
  assert.ok(!JSON.stringify(result).includes("test.person@example.org"));
});

test("read-only reconciliation recognizes the labelled API test customer",async()=>{
  const id="33333333-3333-4333-8333-333333333333";
  let details=0;
  const result=await reconcileAcceptedBooking("NBG-ABCDE-ABCDEFGH",{
    auditStore:archived(),
    listCustomers:async()=>({customers:[{
      _id:id,email:"test.person@example.org",status:"active",
      name:"TEST API - Original Test Person",
      address:{addressDescription:"17 Example Street, Bangor BT20 4AA"},
      jobs:[{_id:"55555555-5555-4555-8555-555555555555"}],
    }],hasMore:false,page:1,pageSize:100}),
    getCustomer:async customerId=>{
      assert.equal(customerId,id);details++;
      return {
        name:"TEST API - Original Test Person",
        jobs:[{_id:"55555555-5555-4555-8555-555555555555"}],
      };
    },
  });
  assert.equal(result.customer,"test_customer_found");
  assert.equal(result.jobCount,1);
  assert.equal(details,1);
  assert.ok(!JSON.stringify(result).includes("Original Test Person"));
});

test("incomplete customer pagination is never mistaken for no existing customer",async()=>{
  let reads=0;
  const result=await reconcileAcceptedBooking("NBG-ABCDE-ABCDEFGH",{
    auditStore:archived(),
    listCustomers:async()=>{reads++;return{customers:[],hasMore:true,page:1,pageSize:100};},
    getCustomer:async()=>{throw Error("not expected");},
  });
  assert.equal(reads,40);
  assert.equal(result.customer,"requires_review");
});

test("invalid accepted audit cannot trigger live Squeegee reads",async()=>{
  const invalid=mockAcceptedAuditRecord();
  invalid.termsAccepted=false;
  let reads=0;
  const result=await reconcileAcceptedBooking("NBG-ABCDE-ABCDEFGH",{
    auditStore:archived(invalid),
    listCustomers:async()=>{reads++;return{};},
    getCustomer:async()=>{reads++;return{};},
  });
  assert.equal(result.audit,"not_eligible_test_audit");
  assert.equal(reads,0);
  const missing=await findAcceptedAudit("invalid",archived());
  assert.equal(missing.status,"invalid_reference");
});


// Operator recovery is allowed only for the one accepted booking, recorded
// before the first worker failed. All fake Squeegee clients below are GET-only.
function archivedOriginalRow(){
  return {
    ...booking(RECOVERY_BOOKING_ID),
    channel:"email",
    createdAt:"2026-10-30T15:28:57.800Z",
  };
}
function originalArchiveStore(row=archivedOriginalRow()){
  return mockAcceptedAuditStore([{
    key:"2026-10-30T15:28:57.800Z__original@example.org.json",
    row,
  }]);
}
function recoveryHarness(overrides={}){
  const events=[];
  return {
    events,
    deps:{
      auditStore:originalArchiveStore(),
      statusStore:{get:async(key)=>{events.push("read_status");return null;}},
      claimsStore:{get:async(key)=>{events.push("read_claim");return null;}},
      getSchedule:async()=>{events.push("get_schedule");return schedule();},
      getServices:async()=>{events.push("get_services");return services;},
      getJobGroups:async()=>{events.push("get_job_groups");return groups;},
      listCustomers:async()=>{events.push("list_customers");return{
        customers:[],hasMore:false,page:1,pageSize:100,
      };},
      now:Date.parse("2026-10-30T15:52:00Z"),
      ...overrides,
    },
  };
}

test("original accepted Squeegee booking is reconstructed from private audit only",async()=>{
  const accepted=await originalAcceptedBooking(RECOVERY_BOOKING_ID,
    originalArchiveStore(),Date.parse("2026-10-30T15:52:00Z"));
  assert.equal(accepted.reason,null);
  assert.equal(accepted.booking.bookingId,RECOVERY_BOOKING_ID);
  assert.equal(accepted.booking.submittedAt,"2026-10-30T15:52:00.000Z");
  const incorrect=await originalAcceptedBooking("NBG-ABCDE-ABCDEFGH",
    originalArchiveStore(),Date.parse("2026-10-30T15:52:00Z"));
  assert.equal(incorrect.reason,"not_approved_original_booking");
  const changed=archivedOriginalRow();
  changed.createdAt="2026-10-31T12:00:00Z";
  const altered=await originalAcceptedBooking(RECOVERY_BOOKING_ID,
    originalArchiveStore(changed),Date.parse("2026-10-30T15:52:00Z"));
  assert.equal(altered.reason,"accepted_booking_window_unverified");
});

test("read-only recovery preflight verifies original £5 four-weekly round 11 date",async()=>{
  const h=recoveryHarness();
  const result=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
  assert.equal(result.ready,true);
  assert.equal(result.firstClean,"2026-11-02");
  assert.equal(result.round,11);
  assert.equal(result.price,5);
  assert.equal(result.frequency,"every_4_weeks");
  assert.equal(result.pagesScanned,1);
  assert.deepEqual(h.events.sort(),[
    "read_status","read_claim","get_schedule","get_services",
    "get_job_groups","list_customers",
  ].sort());
  assert.ok(!JSON.stringify({ready:result.ready,round:result.round,price:result.price})
    .includes("original@example.org"));
});

test("no new Squeegee write permitted when original test was reserved already",async()=>{
  for(const blocked of ["status","global_claim"]){
    const h=recoveryHarness(blocked==="status"?
      {statusStore:{get:async()=>({stage:"queued"})}}:
      {claimsStore:{get:async()=>({state:"reserved"})}});
    const result=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
    assert.equal(result.ready,false);
    assert.equal(result.reason,"existing_or_uncertain_test_reservation");
    assert.ok(!h.events.includes("list_customers"));
  }
});

test("recovery holds when account already has a customer for the test property",async()=>{
  const customer={_id:customerId,name:"Existing",status:"active",
    email:booking().email,address:{addressDescription:booking().address},
    jobs:[]};
  const h=recoveryHarness({listCustomers:async()=>({
    customers:[customer],hasMore:false,page:1,pageSize:100,
  })});
  const r=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
  assert.equal(r.ready,false);
  assert.equal(r.reason,"squeegee_customer_exists_or_needs_review");
});

test("recovery refuses a changed or missing displayed website date",async()=>{
  const changed=archivedOriginalRow();
  changed.bookingScheduleSnapshot.results[0].assignedCleanDate="2026-11-03";
  const h=recoveryHarness({auditStore:originalArchiveStore(changed)});
  const r=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
  assert.equal(r.ready,false);
  assert.equal(r.reason,"date_price_round_or_service_not_verified");
  assert.ok(!h.events.includes("list_customers"));
});

test("recovery refuses a missing job group or unverified account service",async()=>{
  const h=recoveryHarness({getJobGroups:async()=>[]});
  const r=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
  assert.equal(r.ready,false);
  assert.equal(r.reason,"date_price_round_or_service_not_verified");
  assert.ok(!h.events.includes("list_customers"));
});

test("recovery refuses a date in the past even if its round looks plausible",async()=>{
  const h=recoveryHarness({now:Date.parse("2026-12-01T12:00:00Z")});
  const r=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
  assert.equal(r.ready,false);
  assert.equal(r.reason,"first_date_outside_45_day_window");
});

test("recovery refuses any missing or non-unique original booking acceptance",async()=>{
  const h=recoveryHarness({auditStore:mockAcceptedAuditStore()});
  const r=await inspectAcceptedBooking(RECOVERY_BOOKING_ID,h.deps);
  assert.equal(r.ready,false);
  assert.equal(r.reason,"accepted_booking_not_found");
  assert.deepEqual(h.events,[]);
});

test("owner recovery route rejects unauthorised users before any storage or writes",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewRecoverOriginal.mjs");
  const scope={
    deploy:{context:"deploy-preview"},
    site:{id:"d63c829f-3ed7-48e9-9633-a042de3f2e84"},
  };
  const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-recover-original";
  const unauthorised=await handler(new Request(url),scope);
  assert.equal(unauthorised.status,403);
  const wrong=await handler(new Request(url),{
    ...scope,deploy:{context:"production"},
  });
  assert.equal(wrong.status,404);
});

test("owner recovery POST fails closed when after-response worker is unavailable",async()=>{
  const {default:handler}=await import(
    "../netlify/functions/squeegeePreviewRecoverOriginal.mjs");
  const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-recover-original";
  const validScope={hostname:"deploy-preview-77--nibinguy.netlify.app",
    deployContext:"deploy-preview",
    siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84"};
  const cookie=createTestSessionCookie(process.env,Date.now(),validScope);
  const request=new Request(url,{
    method:"POST",headers:{
      "Cookie":COOKIE_NAME+"="+cookie,
      "Origin":"https://deploy-preview-77--nibinguy.netlify.app",
      "Content-Type":"application/x-www-form-urlencoded",
    },
    body:"action=confirm-original",
  });
  const result=await handler(request,{
    deploy:{context:"deploy-preview"},site:{id:validScope.siteId},
  });
  assert.equal(result.status,503);
});
