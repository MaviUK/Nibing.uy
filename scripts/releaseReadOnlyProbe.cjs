"use strict";
/*
 * Safe release-candidate smoke probe: GET requests only. Never signs a booking,
 * calls Squeegee to create a customer/job, sends email, or triggers a payment.
 * Host is fixed to draft PR #80, not nibing.uy or the operational Preview #77.
 */
const assert=require("node:assert/strict");
const origin="https://deploy-preview-80--nibinguy.netlify.app";

async function get(path,expected,type){
  const url=new URL(path,origin);
  assert.equal(url.hostname,"deploy-preview-80--nibinguy.netlify.app");
  const response=await fetch(url,{
    method:"GET",redirect:"manual",cache:"no-store",
    signal:AbortSignal.timeout(20000),
  });
  let raw="";
  try {raw=await response.text();}catch{}
  console.log("GET "+url.pathname+": HTTP "+response.status+
    " (expected "+expected+")");
  assert.equal(response.status,expected,url.pathname+" has an unexpected response");
  if(type==="html"){
    assert.match(response.headers.get("content-type")||"",/text\/html/i);
    assert.match(raw,/<html/i);
  }
  if(type==="blocked"){
    // The release preview MUST NOT authorise Preview #77's Squeegee
    // owner tools, secure customer login, or automatic booking endpoints.
    assert.ok(raw.length<6000,"A blocked endpoint returned too much data");
  }
}

(async()=>{
  await get("/",200,"html");
  await get("/street-booking",200,"html");
  await get("/customer-hq",200,"html");
  await get("/privacy-policy.html",200,"html");
  await get("/api/customer-hq",404,"blocked");
  await get("/api/squeegee-preview-auto-sync",404,"blocked");
  await get("/api/squeegee-production-auto-sync",404,"blocked");
  await get("/api/squeegee-production-auto-status",404,"blocked");
  await get("/api/squeegee-production-hq-import",404,"blocked");
  console.log("PASS: release preview is accessible, protected APIs remain fail-closed");
})().catch(err=>{
  console.error("Release read-only smoke FAILED:",err.message);
  process.exitCode=1;
});
