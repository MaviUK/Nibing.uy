"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
const rollout=require("../netlify/functions/lib/squeegeePreviewAutoRollout");
const {acceptedPilotAudit,inspectAcceptedPilot,TARGET}=
  require("../netlify/functions/lib/squeegeeAutoPilotRecovery");
const {COOKIE_NAME,createTestSessionCookie}=
  require("../netlify/functions/lib/squeegeePreviewTestSession");

const date=Date.parse("2026-10-30T17:49:00Z");
const runtime={
  hostname:"deploy-preview-77--nibinguy.netlify.app",
  deployContext:"deploy-preview",
  siteId:"d63c829f-3ed7-48e9-9633-a042de3f2e84",
};
const fakeEnv={SQUEEGEE_API_KEY:"fake-for-tests-strong-preview-key-0123456789"};
const brownService="11111111-1111-4111-8111-111111111111";
const blackService="11111111-1111-4111-8111-111111111112";
const groups=[
  {id:"22222222-2222-4222-8222-222222222221",description:"01"},
  {id:"22222222-2222-4222-8222-222222222222",description:"02"},
];
const services=[
  {id:brownService,description:"Brown"},
  {id:blackService,description:"Black"},
];

function originalAudit(overrides={}) {
  const bins=[
    {type:"Brown Bin",planId:"domestic_4w",count:1},
    {type:"Black Bin",planId:"domestic_4w",count:1},
  ];
  const canonical=verifyAndPriceBooking(bins,"",{}).canonical;
  return {
    bookingId:TARGET,name:"TEST API - Pilot 2",channel:"email",
    email:"pilot@example.org",phone:"07123456789",
    address:"162 Example Lane, Newtownards BT23 4LN",
    bins,pricing:canonical,discountCode:"",termsAccepted:true,
    bookingScheduleSnapshot:{
      version:1,postcode:"BT23 4LN",
      results:[
        {type:"Brown Bin",automatic:true,assignedCleanDate:"2026-11-16"},
        {type:"Black Bin",automatic:true,assignedCleanDate:"2026-11-17"},
      ],
    },
    createdAt:"2026-10-30T17:38:07.000Z",
    ...overrides,
  };
}
function auditStore(record=originalAudit()) {
  const key="2026-10-30T17:38:07.000Z__pilot@example.org.json";
  return{
    async list({prefix}){return{blobs:key.startsWith(prefix)?[{key}]:[]};},
    async get(lookup){return lookup===key?record:null;},
  };
}
function emptyStore() {return{async get(){return null;}};}
function config(overrides={}) {
  const calls=[];
  const deps={
    auditStore:auditStore(),
    statusStore:emptyStore(),
    claimsStore:emptyStore(),
    getSchedule:async()=>{calls.push("schedule");return{
      postcode:"BT23 4LN",town:"NEWTOWNARDS",
      results:[
        {bin:"Brown Bin",automatic:true,town:"NEWTOWNARDS",assignedCleanDate:"2026-11-16"},
        {bin:"Black Bin",automatic:true,town:"NEWTOWNARDS",assignedCleanDate:"2026-11-17"},
      ],
    };},
    getServices:async()=>{calls.push("services");return services;},
    getJobGroups:async()=>{calls.push("groups");return groups;},
    listCustomers:async()=>{calls.push("listCustomers");return{
      customers:[],hasMore:false,page:1,pageSize:100,
    };},
    now:date,
    ...overrides,
  };
  return {deps,calls};
}

test("accepted audit is fixed to the real two-bin booking reference and window",async()=>{
  const found=await acceptedPilotAudit(TARGET,auditStore());
  assert.equal(found.status,"found");
  assert.equal(found.record.bins.length,2);
  assert.equal((await acceptedPilotAudit("NBG-OTHER-12345678",auditStore())).status,
    "not_approved_booking");
  assert.equal((await acceptedPilotAudit(TARGET,auditStore(
    originalAudit({createdAt:"2026-10-31T12:30:00Z"})
  ))).status,"accepted_audit_failed_validation");
  assert.equal((await acceptedPilotAudit(TARGET,auditStore(
    originalAudit({name:"TEST API - Other"})
  ))).status,"accepted_audit_failed_validation");
  assert.equal((await acceptedPilotAudit(TARGET,auditStore(
    originalAudit({bins:originalAudit().bins.slice(0,1)})
  ))).status,"accepted_audit_failed_validation");
  assert.equal((await acceptedPilotAudit(TARGET,auditStore(
    originalAudit({pricing:{...originalAudit().pricing,total:0}})
  ))).status,"accepted_audit_failed_validation");
});

test("read-only preflight verifies both bins, first clean dates, rounds and total £10",async()=>{
  const h=config();
  const result=await inspectAcceptedPilot(TARGET,h.deps);
  assert.equal(result.ready,true,JSON.stringify(result));
  assert.equal(result.total,10);
  assert.deepEqual(result.checks.map(x=>({
    bin:x.bin,date:x.date,round:x.round,price:x.price,frequency:x.frequency,
  })),[
    {bin:"Brown Bin",date:"2026-11-16",round:1,price:5,frequency:"every_4_weeks"},
    {bin:"Black Bin",date:"2026-11-17",round:2,price:5,frequency:"every_4_weeks"},
  ]);
  assert.equal(result.booking.submittedAt,new Date(date).toISOString());
  assert.equal(result.booking.createdAt,"2026-10-30T17:38:07.000Z");
  assert.equal(result.pagesScanned,1);
  assert.deepEqual(h.calls.sort(),["schedule","services","groups","listCustomers"].sort());
});

test("any previous status, claim or existing customer holds the recovery",async()=>{
  for(const store of ["statusStore","claimsStore"]){
    const h=config({[store]:{async get(){return{state:"reserved"};}}});
    const result=await inspectAcceptedPilot(TARGET,h.deps);
    assert.equal(result.ready,false);
    assert.equal(result.reason,"previous_or_uncertain_squeegee_reservation");
    assert.deepEqual(h.calls,[]);
  }
  const h=config({listCustomers:async()=>({
    customers:[{
      _id:"33333333-3333-4333-8333-333333333333",
      email:"pilot@example.org",status:"active",
      address:{addressDescription:"162 Example Lane, Newtownards BT23 4LN"},
      jobs:[],
    }],
    hasMore:false,page:1,pageSize:100,
  })});
  const r=await inspectAcceptedPilot(TARGET,h.deps);
  assert.equal(r.ready,false);
  assert.equal(r.reason,"customer_exists_or_match_requires_review");
});

test("changed dates, missing round and incomplete customer scan block all recovery",async()=>{
  const altered=originalAudit();
  altered.bookingScheduleSnapshot.results[0].assignedCleanDate="2026-11-18";
  const a=await inspectAcceptedPilot(TARGET,config({
    auditStore:auditStore(altered),
  }).deps);
  assert.equal(a.ready,false);
  assert.equal(a.reason,"date_price_service_or_round_needs_review");

  const b=await inspectAcceptedPilot(TARGET,config({getJobGroups:async()=>[]}).deps);
  assert.equal(b.ready,false);
  assert.equal(b.reason,"date_price_service_or_round_needs_review");

  const c=await inspectAcceptedPilot(TARGET,config({listCustomers:async()=>({
    customers:[],hasMore:true,page:1,pageSize:100,
  })}).deps);
  assert.equal(c.ready,false);
  assert.equal(c.reason,"customer_exists_or_match_requires_review");

  const future=await inspectAcceptedPilot(TARGET,config({
    now:Date.parse("2027-01-01T12:00:00Z"),
  }).deps);
  assert.equal(future.ready,false);
  assert.equal(future.reason,"job_date_round_price_or_frequency_not_verified");
});

test("new recovery route is owner-only; signed token supports Android Origin:null",async()=>{
  const original=process.env.SQUEEGEE_API_KEY;
  process.env.SQUEEGEE_API_KEY=fakeEnv.SQUEEGEE_API_KEY;
  try {
    const {
      default:handler,mintPilotRecoveryToken,
      verifyPilotRecoveryToken,acceptablePilotOrigin,
    }=await import("../netlify/functions/squeegeePreviewAutoRecover.mjs");
    const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-recover";
    const ctx={deploy:{context:"deploy-preview"},site:{id:runtime.siteId}};
    const denied=await handler(new Request(url),ctx);
    assert.equal(denied.status,403);
    const wrong=await handler(new Request(url),{
      ...ctx,deploy:{context:"production"},
    });
    assert.equal(wrong.status,404);

    const issued=Date.now();
    const cookie=createTestSessionCookie(process.env,issued,runtime);
    const token=mintPilotRecoveryToken(cookie,runtime,process.env,issued);
    assert.match(token,/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
    assert.equal(verifyPilotRecoveryToken(token,cookie,runtime,process.env,issued),true);
    assert.equal(verifyPilotRecoveryToken(token,cookie,runtime,process.env,issued+11*60000),false);
    assert.equal(verifyPilotRecoveryToken(token,cookie,{
      ...runtime,hostname:"deploy-preview-78--nibinguy.netlify.app",
    },process.env,issued),false);
    assert.equal(verifyPilotRecoveryToken(token,cookie+"x",runtime,process.env,issued),false);

    const req=headers=>new Request(url,{headers});
    assert.equal(acceptablePilotOrigin(req({Origin:"null"}),runtime),true);
    assert.equal(acceptablePilotOrigin(req({Origin:"https://evil.example"}),runtime),false);
    assert.equal(acceptablePilotOrigin(req({"Sec-Fetch-Site":"cross-site"}),runtime),false);

    const post=new Request(url,{method:"POST",headers:{
      Cookie:COOKIE_NAME+"="+cookie,
      Origin:"null",
      "Sec-Fetch-Site":"same-origin",
      "Content-Type":"application/x-www-form-urlencoded",
    },body:"action=confirm-pilot2&csrf="+encodeURIComponent(token)});
    // No waitUntil is provided, so it must reject BEFORE opening storage or
    // any Squeegee API call, even with a correctly signed owner token.
    const blocked=await handler(post,ctx);
    assert.equal(blocked.status,503);
  } finally {
    if(original===undefined)delete process.env.SQUEEGEE_API_KEY;
    else process.env.SQUEEGEE_API_KEY=original;
  }
});


test("re-authorisation stays in the browser and returns to exact two-bin recovery",async()=>{
  const previousKey=process.env.SQUEEGEE_API_KEY;
  process.env.SQUEEGEE_API_KEY=fakeEnv.SQUEEGEE_API_KEY;
  try {
    const {
      default:authHandler,safeOwnerReturnPath,
    }=await import("../netlify/functions/squeegeePreviewTest.mjs");
    const origin="https://deploy-preview-77--nibinguy.netlify.app";
    const authUrl=origin+"/api/squeegee-preview-test";
    const returnPath="/api/squeegee-preview-auto-recover";
    const ctx={deploy:{context:"deploy-preview"},site:{id:runtime.siteId}};
    assert.equal(safeOwnerReturnPath(returnPath),returnPath);
    for(const value of [
      null,"","//evil.example","https://evil.example","/api/squeegee-preview-test",
      "/api/squeegee-preview-auto-recover?unsafe=1",
      "/api/squeegee-preview-auto-recover/../admin",
      "/api/squeegee-preview-auto-recover%0a",
    ]) assert.equal(safeOwnerReturnPath(value),null);
    // The unauthorised GET presents the OWNER code form in this browser
    // with the same-site recovery path, rather than switching tabs.
    const url=authUrl+"?returnTo="+encodeURIComponent(returnPath);
    const before=await authHandler(new Request(url),ctx);
    assert.equal(before.status,200);
    const form=await before.text();
    assert.match(form,/<input type="hidden" name="returnTo" value="\/api\/squeegee-preview-auto-recover">/);
    assert.match(form,/return directly to the same recovery page in this browser/);

    // Once the owner session exists, the GET must redirect without another OTP
    // or a new booking, and without sending Squeegee data.
    const cookie=createTestSessionCookie(process.env,Date.now(),runtime);
    const authorised=await authHandler(new Request(url,{
      headers:{Cookie:COOKIE_NAME+"="+cookie},
    }),ctx);
    assert.equal(authorised.status,303);
    assert.equal(authorised.headers.get("location"),returnPath);
    assert.equal(authorised.headers.get("cache-control"),"no-store");

    // Malicious redirect destinations cannot redirect, even with a signed cookie.
    const unsafe=await authHandler(new Request(
      authUrl+"?returnTo="+encodeURIComponent("https://evil.example"),{
        headers:{Cookie:COOKIE_NAME+"="+cookie},
      }),ctx);
    assert.equal(unsafe.status,200);
    assert.equal(unsafe.headers.get("location"),null);
    // A completely different preview must never authorise the return flow.
    const wrong=await authHandler(new Request(url),{
      ...ctx,deploy:{context:"production"},
    });
    assert.equal(wrong.status,404);

    // Regression: OTP challenge and completion retain exactly the validated
    // returnTo value, not the previously displayed old one-booking status.
    const source=require("node:fs").readFileSync(
      require("node:path").join(__dirname,
        "../netlify/functions/squeegeePreviewTest.mjs"),"utf8");
    assert.match(source,/challengePage\(issued.challengeId,returnTo\)/);
    assert.match(source,/returnField\(returnTo\)/);
    assert.match(source,/"Location":returnTo\|\|"\/api\/squeegee-preview-test"/);
  } finally {
    if(previousKey===undefined)delete process.env.SQUEEGEE_API_KEY;
    else process.env.SQUEEGEE_API_KEY=previousKey;
  }
});

test("expired two-bin recovery links back to owner login with browser-local return",async()=>{
  const previousKey=process.env.SQUEEGEE_API_KEY;
  process.env.SQUEEGEE_API_KEY=fakeEnv.SQUEEGEE_API_KEY;
  try {
    const {default:recoveryHandler}=await import(
      "../netlify/functions/squeegeePreviewAutoRecover.mjs");
    const url="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-recover";
    const response=await recoveryHandler(new Request(url),{
      deploy:{context:"deploy-preview"},site:{id:runtime.siteId},
    });
    assert.equal(response.status,403);
    const html=await response.text();
    assert.match(html,/same browser/);
    assert.match(html,/href="\/api\/squeegee-preview-test\?returnTo=%2Fapi%2Fsqueegee-preview-auto-recover"/);
  } finally {
    if(previousKey===undefined)delete process.env.SQUEEGEE_API_KEY;
    else process.env.SQUEEGEE_API_KEY=previousKey;
  }
});
