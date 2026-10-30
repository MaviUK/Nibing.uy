"use strict";

/**
 * An explicitly approved, one-shot API TEST ONLY on Preview 1.
 *
 * This never accepts customer/job data from the HTTP caller. Each write body
 * is fixed, labelled DO NOT CLEAN/BILL and has £0 price and no real contact.
 * Caller authentication and preview/hostname restrictions live in
 * squeegeeControlledTest.mjs. General Squeegee writes remain disabled.
 */
const { getServices, getJobGroups, listCustomers, requireUuid } =
  require("./squeegeeApiV3");
const { claimOnce, changeClaimState, jobKey } =
  require("./squeegeeIdempotencyClaims");
const {
  TEST_REFERENCE, TEST_CUSTOMER, FIRST_DATE, CLEAN_TYPE, GROUP_NUMBER,
  createTestJob, pickUnique,
} = require("./squeegeeControlledTestData");

const API_ORIGIN="https://api02.sqgee.com";
const TEST_BOOKING_ID="NBG-P77TEST-ABCDEFGH";
const TEST_LOCK_KEY="claim-v1/test/preview77-controlled-20261030";
const TEST_JOB_DETAILS={
  type:"Black Bin",planId:"domestic_4w",date:FIRST_DATE,count:1,
};

async function scanAllForTestCustomer(listPage = listCustomers, { maxPages = 60 } = {}){
  let pagedRequestId;
  let count=0;
  for(let page=1;page<=maxPages;page++){
    const response=await listPage({page,pagedRequestId});
    if(!response || !Array.isArray(response.customers) ||
       typeof response.hasMore!=="boolean"){
      return {complete:false,conflict:false,reason:"unexpected_customer_page"};
    }
    for(const item of response.customers){
      count++;
      if(item?._externalId===TEST_REFERENCE ||
         item?.name===TEST_CUSTOMER.name){
        return {complete:true,conflict:true,pages:page,recordsScanned:count};
      }
    }
    if(!response.hasMore){
      return {complete:true,conflict:false,pages:page,recordsScanned:count};
    }
    if(response.pagedRequestId)pagedRequestId=response.pagedRequestId;
  }
  return {complete:false,conflict:false,reason:"pagination_limit"};
}

async function postOneTest(path, body, fetchImpl = global.fetch){
  if(path!=="/api/v3/public/customers" &&
     !/^\/api\/v3\/public\/customers\/[0-9a-f-]{36}\/jobs$/i.test(path)){
    throw Error("Disallowed Squeegee test POST route");
  }
  const key=String(process.env.SQUEEGEE_API_KEY||"").trim();
  if(!key)throw Error("Branch-only Squeegee key missing");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),14000);
  try {
    const response=await fetchImpl(API_ORIGIN+path,{
      method:"POST",redirect:"error",signal:controller.signal,
      headers:{
        Authorization:"Bearer "+key,
        "Content-Type":"application/json",Accept:"application/json",
      },
      body:JSON.stringify(body),
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.success!==true){
      const e=new Error("Controlled Squeegee test POST rejected");
      e.httpStatus=response.status;
      e.apiCode=Number.isInteger(data?.code)?data.code:null;
      throw e;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function advance(key,etag,state){
  const result=await changeClaimState({
    key,etag,bookingId:TEST_BOOKING_ID,state,
  });
  if(!result.changed || !result.etag){
    throw Error("Atomic test claim update failed; do not retry automatically");
  }
  return result.etag;
}

async function runControlledTest({
  listPage=listCustomers,
  readServices=getServices,
  readGroups=getJobGroups,
  post=postOneTest,
  claim=claimOnce,
  update=advance,
}={}){
  const output={
    testOnly:true,readOnly:false,
    externalReference:TEST_REFERENCE,
    scheduledDate:FIRST_DATE,
    groupNumber:GROUP_NUMBER,
    recurrence:"weeks:4",
    priceGBP:0,
    realCustomerContact:false,
    customerCreated:false,
    jobCreated:false,
    requiresManualVerification:true,
  };
  // These GETs must succeed BEFORE reserving any write.
  const [services,groups,scan]=await Promise.all([
    readServices(),readGroups(),scanAllForTestCustomer(listPage),
  ]);
  const service=pickUnique(services,CLEAN_TYPE);
  const group=pickUnique(groups,String(GROUP_NUMBER).padStart(2,"0"));
  if(!service.ok||!group.ok||!scan.complete||scan.conflict){
    return {...output,status:"blocked_read_only",
      reason:scan.conflict?"test_customer_already_exists":
        !scan.complete?"customer_scan_incomplete":"service_or_group_unavailable",
      pagesChecked:scan.pages||null};
  }

  // Reserve precisely ONE test, including across separate GitHub workflow
  // runs, different POSTs or Squeegee timeouts.
  const lock=await claim({
    key:TEST_LOCK_KEY,bookingId:TEST_BOOKING_ID,channel:"approved_test",
  });
  if(!lock.acquired||!lock.etag){
    return {...output,status:"already_claimed_or_uncertain",
      reason:"No automatic retry. Inspect Squeegee before continuing."};
  }

  let version=lock.etag;
  try {
    version=await update(TEST_LOCK_KEY,version,"request_in_progress");
  } catch {
    return {...output,status:"blocked_pre_write",
      reason:"Unable to mark atomic test lock in progress"};
  }

  let customerId;
  try {
    const result=await post("/api/v3/public/customers",TEST_CUSTOMER);
    customerId=requireUuid(result?.data,"test customer ID");
    output.customerCreated=true;
  } catch(e) {
    await update(TEST_LOCK_KEY,version,"requires_reconciliation").catch(()=>{});
    return {...output,status:"customer_post_uncertain",
      httpStatus:e.httpStatus||null,apiCode:e.apiCode||null,
      reason:"Do not retry until the Squeegee test reference has been checked"};
  }
  try {
    version=await update(TEST_LOCK_KEY,version,"succeeded");
  } catch {
    return {...output,status:"customer_created_claim_unconfirmed",
      reason:"Customer exists; automatic job creation stopped"};
  }

  // A second independent atomic claim reserves the specific property, plan,
  // bin and first date before the single intended job POST.
  const jobClaimKey=jobKey({
    address:TEST_CUSTOMER.address.text,
    email:"test-only@example.invalid",
  },TEST_JOB_DETAILS);
  const jobLock=await claim({
    key:jobClaimKey,bookingId:TEST_BOOKING_ID,channel:"approved_test",
  });
  if(!jobLock.acquired||!jobLock.etag){
    return {...output,status:"customer_created_job_not_claimed",
      reason:"Job already claimed or uncertain. Never retry automatically."};
  }
  let jobVersion=jobLock.etag;
  try{
    jobVersion=await update(jobClaimKey,jobVersion,"request_in_progress");
  }catch {
    return {...output,status:"customer_created_job_blocked",
      reason:"Unable to confirm atomic job reservation"};
  }

  try{
    const jobData=createTestJob({serviceId:service.id,groupId:group.id});
    if(jobData.price!==0||jobData.date!==FIRST_DATE||
       jobData.frequencyInterval!==4||jobData.frequencyType!=="weeks"||
       !jobData.notes.includes("DO NOT")){
      throw Error("Immutable one-test job body failed safety validation");
    }
    await post("/api/v3/public/customers/"+customerId+"/jobs",jobData);
    output.jobCreated=true;
  }catch(e){
    await update(jobClaimKey,jobVersion,"requires_reconciliation").catch(()=>{});
    return {...output,status:"job_post_uncertain",
      httpStatus:e.httpStatus||null,apiCode:e.apiCode||null,
      reason:"Do not repeat the job POST; verify manually in Squeegee"};
  }
  try{
    await update(jobClaimKey,jobVersion,"succeeded");
  }catch{
    return {...output,status:"job_created_claim_unconfirmed",
      reason:"Job POST succeeded; manual verification required"};
  }
  return {...output,status:"test_customer_and_job_created",
    reason:"Check Round 11, 2 Nov 2026 and 4-weekly recurrence in Squeegee"};
}

module.exports={
  TEST_BOOKING_ID,TEST_LOCK_KEY,scanAllForTestCustomer,
  postOneTest,runControlledTest,
};
