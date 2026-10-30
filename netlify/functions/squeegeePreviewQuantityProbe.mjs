// Preview 1 only: owner-authorised one-shot schema test against a MISSING customer.
// The remote POST target is a fixed nonexistent UUID, never a real account.
import crypto from "node:crypto";
import api from "./lib/squeegeeApiV3.js";
import owner from "./lib/squeegeePreviewTestSession.js";
import claims from "./lib/squeegeeIdempotencyClaims.js";
import {getStore} from "@netlify/blobs";

export const ABSENT_ID="00000000-0000-4000-8000-000000000000";
const ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";
const CLAIM="claim-v1/quantity-probe/preview77-v1";
const BOOKING="NBG-QTYPROBE-12345678";
const HISTORY="squeegee-preview1-quantity-probe";
const IDENTIFIER="one-shot-v1";
const HEADERS={
  "Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store",
  "X-Robots-Tag":"noindex,nofollow","Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none';style-src 'unsafe-inline';form-action 'self';base-uri 'none';frame-ancestors 'none'",
};
function escapeHtml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function view(inner,status=200){
  const html='<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta charset="utf-8"><title>Squeegee quantity test</title><style>'+
    'body{font:16px/1.5 system-ui;background:#10121c;color:#fff;padding:16px}'+
    'main{max-width:560px;margin:auto;padding:20px;background:#232739;border:2px solid #f5dd51}'+
    'button{display:block;width:100%;padding:14px;font:700 17px system-ui;background:#f5dd51;color:#111}'+
    'a{color:#f5dd51}section{background:#32384e;padding:12px;margin:12px 0}</style></head>'+
    '<body><main><h1>NI Bin Guy — quantity API test</h1>'+inner+
    '<p><small>Preview 1 only. We test the API format against a verified non-existent customer. This test will not create a customer or job.</small></p></main></body></html>';
  return new Response(html,{status,headers:HEADERS});
}
const hmac=(cookie,env)=>crypto.createHmac("sha256",env.SQUEEGEE_API_KEY)
  .update("quantity-schema-probe-csrf-v1:"+cookie).digest("hex");
function validCsrf(cookie,value,env){
  if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))return false;
  const expected=hmac(cookie,env);
  return crypto.timingSafeEqual(Buffer.from(value,"hex"),Buffer.from(expected,"hex"));
}
function showResults(saved){
  if(!saved)return "<p>No test has been run.</p>";
  const results=Array.isArray(saved.results)?saved.results:[];
  return '<section><strong>'+escapeHtml(saved.status)+'</strong><ul>'+
    results.map(r=>'<li>'+escapeHtml(r.variant)+': HTTP '+escapeHtml(r.httpStatus)+'</li>').join('')+
    '</ul><small>A 404 usually means Squeegee checked customer existence before the service format. That is inconclusive, not evidence the format supports quantity 2.</small></section>';
}
export function buildQuantityVariants(uuid){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))
    throw new Error("Invalid Brown service UUID");
  const base={date:"2026-11-10",frequencyType:"weeks",frequencyInterval:4,
    services:[uuid],price:10,tags:[],
    firstAppointment:{initialDate:"2026-11-10",tags:[]},
    notes:"NI Bin Guy Preview1 quantity format test - INVALID customer UUID"};
  return [
    {variant:"documented_ID_array",body:base},
    {variant:"quantity_object_id",body:{...base,services:[{id:uuid,quantity:2}]}},
    {variant:"quantity_object__id",body:{...base,services:[{_id:uuid,quantity:2}]}},
  ];
}
export async function runQuantityProbe({getCustomer,getServices,reserve,post}){
  // No remote POST unless Squeegee explicitly returns HTTP 404 for this ID.
  try{await getCustomer(ABSENT_ID);return {status:"blocked_customer_not_proven_absent",results:[]};}
  catch(error){if(error?.status!==404)return {status:"blocked_customer_not_proven_absent",results:[]};}
  let rows;
  try{rows=await getServices();}
  catch{return {status:"blocked_services_unavailable",results:[]};}
  const brown=Array.isArray(rows)?rows.filter(r=>r?.description==="Brown"):[];
  if(brown.length!==1 || typeof brown[0].id!=="string")
    return {status:"blocked_brown_service_unverified",results:[]};
  let variants;
  try{variants=buildQuantityVariants(brown[0].id);}
  catch{return {status:"blocked_brown_service_unverified",results:[]};}
  // A one-use atomic claim is required; failed or uncertain claims never retry.
  let permit=false;
  try{permit=(await reserve())===true;}
  catch{}
  if(!permit)return {status:"blocked_test_already_attempted_or_uncertain",results:[]};
  const results=[];
  for(const item of variants){
    let result;
    try{result=await post(ABSENT_ID,item.body);}
    catch{return {status:"inconclusive_network_failure",results};}
    if(!Number.isInteger(result?.httpStatus))
      return {status:"inconclusive_upstream_response",results};
    results.push({variant:item.variant,httpStatus:result.httpStatus});
    if(result.httpStatus>=200 && result.httpStatus<300)
      return {status:"unexpected_upstream_acceptance_stop_and_review",results};
  }
  const [control,...candidates]=results.map(x=>x.httpStatus);
  return {status:control===404 && candidates.some(s=>[400,415,422].includes(s))?
    "candidate_rejected_before_customer_lookup":
    "inconclusive_customer_or_payload_validation_order",results};
}
async function reserveSingleAttempt(){
  const store=getStore({name:"squeegee-preview1-write-claims",consistency:"strong"});
  const claim=await claims.claimOnce({key:CLAIM,bookingId:BOOKING,
    channel:"quantity_api_probe",store});
  if(!claim.acquired)return false;
  const next=await claims.changeClaimState({
    key:CLAIM,bookingId:BOOKING,etag:claim.etag,
    state:"request_in_progress",store,
  });
  return next.changed===true;
}
async function postAbsentCustomerOnly(customerId,body){
  if(customerId!==ABSENT_ID || !process.env.SQUEEGEE_API_KEY ||
     body?.frequencyType!=="weeks" || body?.frequencyInterval!==4 ||
     body?.date!=="2026-11-10" || !Array.isArray(body?.services) ||
     body.services.length!==1)throw new Error("Invalid fixed schema probe");
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
  try{
    const r=await fetch("https://api02.sqgee.com/api/v3/public/customers/"+ABSENT_ID+"/jobs",{
      method:"POST",redirect:"error",cache:"no-store",signal:abort.signal,
      headers:{Authorization:"Bearer "+process.env.SQUEEGEE_API_KEY,
        "Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify(body),
    });
    return {httpStatus:r.status};
  }finally{clearTimeout(timer);}
}
export default async function handler(request,context){
  const runtime={hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
  if(!api.isExactPreview1(process.env,runtime))
    return new Response("Not found",{status:404});
  if(request.method!=="GET" && request.method!=="POST")
    return new Response("Method not allowed",{status:405});
  const cookie=owner.sessionCookieFromHeader(request.headers.get("cookie"));
  if(!owner.verifyTestSessionCookie(cookie,process.env,Date.now(),runtime))
    return view('<p>Authorise your browser first: <a href="/api/squeegee-preview-test">Owner access</a>. Return here afterwards.</p>',403);
  let history;
  const store=getStore({name:HISTORY,consistency:"strong"});
  try{history=await store.get(IDENTIFIER,{type:"json",consistency:"strong"});}
  catch{return view("<p>Test status storage unavailable. No Squeegee request sent.</p>",503);}
  if(request.method==="GET")return view(
    "<p>This one-time test compares the documented service-ID array against two possible service-quantity objects. We first verify the target customer does not exist.</p>"+
    showResults(history)+
    (history?"<p>The test is finished. It cannot be run again automatically.</p>":
      '<form method="post"><input type="hidden" name="csrf" value="'+escapeHtml(hmac(cookie,process.env))+'">'+
      '<button type="submit">Run safe Squeegee quantity-format test</button></form>'));
  const form=await request.formData().catch(()=>null);
  if(request.headers.get("origin")!==ORIGIN ||
     !validCsrf(cookie,form?.get("csrf"),process.env))
    return view("<p>Invalid request. Nothing was sent.</p>",403);
  if(history)return view(showResults(history)+"<p>No duplicate test was run.</p>");
  const result=await runQuantityProbe({
    getCustomer:id=>api.getCustomer(id),
    getServices:()=>api.getServices(),
    reserve:reserveSingleAttempt,
    post:postAbsentCustomerOnly,
  });
  try{await store.setJSON(IDENTIFIER,result);}
  catch{}
  return view(showResults(result)+'<p><a href="/api/squeegee-preview-quantity-probe">Read-only result</a></p>');
}
export const config={
  path:"/api/squeegee-preview-quantity-probe",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:6},
};
