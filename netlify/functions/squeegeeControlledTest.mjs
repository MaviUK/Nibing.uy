// Preview 1 ONLY: a one-time, signed GitHub Actions inspection.
// This first version has NO write path whatsoever.
import squeegee from "./lib/squeegeeApiV3.js";
import oidc from "./lib/squeegeeTestOidc.js";
import data from "./lib/squeegeeControlledTestData.js";

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
  if(input.mode!=="inspect"){
    return json(403,{error:"Test booking creation is not yet enabled"});
  }
  try {
    const [services,groups]=await Promise.all([
      squeegee.getServices(),squeegee.getJobGroups()
    ]);
    const svc=data.pickUnique(services,data.CLEAN_TYPE);
    const grp=data.pickUnique(groups,String(data.GROUP_NUMBER).padStart(2,"0"));
    let externalLookup="unknown";
    try {
      const found=await squeegee.getCustomerIdForExternalId(data.TEST_REFERENCE);
      externalLookup=typeof found==="string"&&found.length>0 ? "existing_reference" : "not_found";
    } catch(e) {
      externalLookup=e.status===404 ? "not_found" : "unverified_error_"+String(e.status||"unknown");
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
      date:data.FIRST_DATE,
      round:data.GROUP_NUMBER,
      frequency:"every_4_weeks",
      jobPriceGBP:0,
      customerHasRealContact:false,
      serviceMapped:svc.ok,
      groupMapped:grp.ok,
      externalLookup,
      ledgerReady,
      ready:svc.ok&&grp.ok&&externalLookup==="not_found"&&ledgerReady,
    });
  }catch(e){
    return json(502,{readOnly:true,authenticated:true,
      error:"Read-only preflight failed", status:e?.status||null});
  }
}
