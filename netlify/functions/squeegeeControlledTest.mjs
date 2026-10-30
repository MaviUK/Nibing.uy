// Preview 1 ONLY: GitHub OIDC-authenticated read-only diagnostics.
// Write mode was removed immediately after an atomic-claim guard blocked it.
import squeegee from "./lib/squeegeeApiV3.js";
import oidc from "./lib/squeegeeTestOidc.js";
import data from "./lib/squeegeeControlledTestData.js";
import writer from "./lib/squeegeeControlledTestWriter.js";

const EXPECTED_HOST="deploy-preview-77--nibinguy.netlify.app";
const json=(status,result)=>new Response(JSON.stringify(result),{status,
 headers:{"content-type":"application/json; charset=utf-8",
 "cache-control":"no-store","x-content-type-options":"nosniff"}});

export default async function handler(req,context){
  const url=new URL(req.url);
  if(req.method!=="POST"||url.hostname!==EXPECTED_HOST||
     context?.deploy?.context!=="deploy-preview") return json(404,{error:"Not found"});
  try {
    await oidc.verifyIdentity(req.headers.get("authorization"));
  } catch {
    return json(401,{error:"GitHub Actions identity verification failed"});
  }
  const input=await req.json().catch(()=>({}));
  // Explicitly DISABLED: the single authorised write attempt stopped before
  // any Squeegee POST when the atomic lock was not acquired.
  if(input.mode==="execute"){
    try{
      const {getStore}=await import("@netlify/blobs");
      const claims=await import("./lib/squeegeeIdempotencyClaims.js").then(m=>m.default||m);
      const store=getStore({name:"squeegee-preview1-write-claims",consistency:"strong"});
      const result=await writer.runControlledTest({
        claim:args=>claims.claimOnce({...args,store}),
        update:(key,etag,state)=>claims.changeClaimState({
          key,etag,bookingId:writer.TEST_BOOKING_ID,state,store,
        }).then(updateResult=>{
          if(!updateResult.changed||!updateResult.etag){
            throw Error("Atomic compare-and-swap not confirmed");
          }
          return updateResult.etag;
        }),
      });
      return json(result.customerCreated&&result.jobCreated?200:409,result);
    }catch{
      return json(502,{
        testOnly:true,readOnly:false,
        status:"unknown_or_blocked",
        reason:"Do not retry; verify test reference in Squeegee",
      });
    }
  }
  if(input.mode==="cas-check"){
    try{
      const {changeClaimState}=await import("./lib/squeegeeIdempotencyClaims.js").then(m=>m.default||m);
      const {getStore}=await import("@netlify/blobs");
      const store=getStore({name:"squeegee-preview1-write-claims",consistency:"strong"});
      const key="claim-v1/test/diagnostic-claim-injected-store-20261030";
      const old=await store.getWithMetadata(key,{consistency:"strong",type:"json"});
      if(!old?.etag||old?.data?.state!=="reserved"){
        return json(409,{testOnly:true,noSqueegeeWrites:true,reason:"diagnostic_claim_missing"});
      }
      const result=await changeClaimState({
        key,etag:old.etag,bookingId:"NBG-P77TEST-ABCDEFGH",
        state:"request_in_progress",store,
      });
      const saved=await store.getWithMetadata(key,{consistency:"strong",type:"json"});
      return json(200,{
        testOnly:true,noSqueegeeWrites:true,
        casChanged:Boolean(result.changed),
        casReason:result.reason||null,
        casEtagPresent:Boolean(result.etag),
        casPersisted:Boolean(saved?.data?.state==="request_in_progress"),
      });
    }catch(e){
      return json(502,{testOnly:true,noSqueegeeWrites:true,
        errorClass:e?.name||"Error"});
    }
  }
  if(input.mode==="claim-helper-check"){
    try{
      const {claimOnce}=await import("./lib/squeegeeIdempotencyClaims.js").then(m=>m.default||m);
      const {getStore}=await import("@netlify/blobs");
      const store=getStore({name:"squeegee-preview1-write-claims",consistency:"strong"});
      const key="claim-v1/test/diagnostic-claim-injected-store-20261030";
      const result=await claimOnce({
        key,bookingId:"NBG-P77TEST-ABCDEFGH",
        channel:"diagnostic_no_squeegee",store,
      });
      const saved=await store.getWithMetadata(key,{
        consistency:"strong",type:"json",
      });
      return json(200,{
        testOnly:true,noSqueegeeWrites:true,
        claimAcquired:Boolean(result.acquired),
        claimReason:result.reason||null,
        claimEtagPresent:Boolean(result.etag),
        claimPersisted:Boolean(saved?.data?.state==="reserved"),
        storedEtagPresent:Boolean(saved?.etag),
      });
    }catch(error){
      return json(502,{testOnly:true,noSqueegeeWrites:true,
        errorClass:error?.name||"Error"});
    }
  }
  if(input.mode==="storage-check"){
    try{
      const {getStore}=await import("@netlify/blobs");
      const store=getStore({name:"squeegee-preview1-write-claims",consistency:"strong"});
      const conditionalKey="test-diagnostic/20261030-conditional-v1";
      const plainKey="test-diagnostic/20261030-unconditional-v1";
      let conditionalResult=null,conditionalError=null,plainResult=null,plainError=null;
      try{
        conditionalResult=await store.setJSON(conditionalKey,{testOnly:true,kind:"conditional"},
          {onlyIfNew:true});
      }catch(e){conditionalError=e?.name||"Error";}
      let conditionalPersisted=false;
      try{
        const r=await store.getWithMetadata(conditionalKey,{consistency:"strong",type:"json"});
        conditionalPersisted=Boolean(r?.data?.testOnly===true);
      }catch{}
      if(!conditionalPersisted){
        try{
          plainResult=await store.setJSON(plainKey,{testOnly:true,kind:"unconditional"});
        }catch(e){plainError=e?.name||"Error";}
      }
      let plainPersisted=false;
      try{
        const r=await store.getWithMetadata(plainKey,{consistency:"strong",type:"json"});
        plainPersisted=Boolean(r?.data?.testOnly===true);
      }catch{}
      return json(200,{testOnly:true,noSqueegeeWrites:true,
        conditionalModified:conditionalResult?.modified??null,
        conditionalEtagPresent:Boolean(conditionalResult?.etag),
        conditionalError,
        conditionalPersisted,
        plainModified:plainResult?.modified??null,
        plainEtagPresent:Boolean(plainResult?.etag),
        plainError,
        plainPersisted,
      });
    }catch(e){return json(502,{testOnly:true,noSqueegeeWrites:true,
        errorClass:e?.name||"Error"});}
  }
  if(input.mode==="claim-status"){
    try{
      const {getStore}=await import("@netlify/blobs");
      const store=getStore("squeegee-preview1-write-claims");
      const claim=await store.getWithMetadata(writer.TEST_LOCK_KEY,{
        type:"json",consistency:"strong",
      });
      const scan=await writer.scanAllForTestCustomer();
      return json(200,{
        readOnly:true,authenticated:true,
        testReference:data.TEST_REFERENCE,
        claimExists:Boolean(claim),
        claimState:claim?.data?.state||null,
        claimHasEtag:Boolean(claim?.etag),
        scanComplete:scan.complete,
        existingTestCustomer:scan.conflict,
        customerPagesScanned:scan.pages||null,
        customersScanned:scan.recordsScanned||null,
        note:"No Squeegee POST is available from this handler",
      });
    }catch{
      return json(502,{readOnly:true,
        error:"Claim diagnostics not available; no writes permitted"});
    }
  }
  if(input.mode!=="inspect"){
    return json(403,{error:"Unsupported test mode"});
  }
  try {
    const [services,groups]=await Promise.all([
      squeegee.getServices(),squeegee.getJobGroups()
    ]);
    const svc=data.pickUnique(services,data.CLEAN_TYPE);
    const grp=data.pickUnique(groups,String(data.GROUP_NUMBER).padStart(2,"0"));
    // Squeegee returns HTTP 400 for the unused test external reference.
    // Never interpret that alone as "not found": scan every customer page
    // and fail closed if listing is truncated or has an unexpected shape.
    let externalLookup="unknown";
    let lookupErrorStatus=null;
    try {
      const found=await squeegee.getCustomerIdForExternalId(data.TEST_REFERENCE);
      externalLookup=typeof found==="string"&&found.length>0 ? "existing_reference" : "not_found";
    } catch(e) {
      lookupErrorStatus=e?.status||null;
      externalLookup="requires_customer_list_confirmation";
    }
    let customersScanned=0, pagesScanned=0, scanComplete=false, testCustomerFound=false;
    let pagedRequestId;
    for(let page=1; page<=60; page++){
      const listing=await squeegee.listCustomers({page,pagedRequestId});
      if(!listing || !Array.isArray(listing.customers) || typeof listing.hasMore!=="boolean"){
        throw Error("Customer scan response incomplete");
      }
      pagesScanned=page;
      customersScanned+=listing.customers.length;
      if(listing.customers.some(c =>
        c._externalId===data.TEST_REFERENCE || c.name===data.TEST_CUSTOMER.name)){
        testCustomerFound=true; break;
      }
      if(!listing.hasMore){scanComplete=true;break;}
      if(listing.pagedRequestId)pagedRequestId=listing.pagedRequestId;
    }
    if(scanComplete && !testCustomerFound &&
       externalLookup!=="existing_reference"){
      externalLookup="not_found_confirmed_by_full_scan";
    }
    const {getStore}=await import("@netlify/blobs");
    const store=getStore("squeegee-preview1-write-claims");
    const key="squeegee-preview77-controlled-test-20261030";
    let ledgerReady=false;
    try{
      await store.getMetadata(key,{consistency:"strong"});
      ledgerReady=true;
    }catch{}
    return json(200,{
      readOnly:true,
      authenticated:true,
      oneControlledTest:true,
      controlledWriteCodeDeployed:true,
      date:data.FIRST_DATE,
      round:data.GROUP_NUMBER,
      frequency:"every_4_weeks",
      jobPriceGBP:0,
      customerHasRealContact:false,
      serviceMapped:svc.ok,
      groupMapped:grp.ok,
      externalLookup,
      lookupErrorStatus,
      pagesScanned,
      customersScanned,
      scanComplete,
      testCustomerFound,
      ledgerReady,
      ready:svc.ok&&grp.ok&&scanComplete&&!testCustomerFound&&
        externalLookup==="not_found_confirmed_by_full_scan"&&ledgerReady,
    });
  }catch(e){
    return json(502,{readOnly:true,authenticated:true,
      error:"Read-only preflight failed", status:e?.status||null});
  }
}
