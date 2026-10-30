// Temporary read-only diagnostic for one previously accepted Preview 1 booking.
// Publishes no customer data. Automatically expires after 31 October 2026.
// No accepted booking replay, claim mutation or Squeegee write is possible.
import {getStore} from "@netlify/blobs";
import api from "./lib/squeegeeApiV3.js";

const BOOKING_ID="NBG-MVVCDC3D-83AB713D58";
const STATUS_STORE="squeegee-preview1-auto-sync-status";
const CLAIM_STORE="squeegee-preview1-write-claims";
const ALLOWED_STAGES=new Set([
  "accepted_for_validation","validating","held_for_review",
  "ready_for_claims","creating_customer","creating_job",
  "created_customer_and_jobs","requires_reconciliation",
]);
const ALLOWED_STATES=new Set([
  "reserved","request_in_progress","succeeded","requires_reconciliation",
]);
const safeCode=x=>typeof x==="string" && /^[a-z][a-z0-9_]{0,90}$/.test(x)?x:null;
function json(status,body) {
  return new Response(JSON.stringify(body),{status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"private, no-store, max-age=0",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
    "X-Robots-Tag":"noindex,nofollow,noarchive",
  }});
}
export default async function handler(request,context) {
  const runtime={
    hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id,
  };
  if(!api.isExactPreview1(process.env,runtime))
    return new Response("Not found",{status:404});
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  if(Date.now()>Date.parse("2026-10-31T23:59:59Z"))
    return new Response("Diagnostic retired",{status:410});
  try {
    const [record,claim]=await Promise.all([
      getStore({name:STATUS_STORE,consistency:"strong"})
        .get(BOOKING_ID,{type:"json",consistency:"strong"}),
      getStore({name:CLAIM_STORE,consistency:"strong"})
        .get("claim-v1/auto-bookings/"+BOOKING_ID,
          {type:"json",consistency:"strong"}),
    ]);
    const stage=ALLOWED_STAGES.has(record?.stage)?record.stage:
      record?"unknown_stage":"not_found";
    const claimState=ALLOWED_STATES.has(claim?.state)?claim.state:
      claim?"unknown_state":"not_found";
    return json(200,{
      stage,claimState,
      reason:safeCode(record?.reason),
      blockedReasons:Array.isArray(record?.blockedReasons)?
        record.blockedReasons.map(safeCode).filter(Boolean).slice(0,8):[],
      createdJobs:Number.isInteger(record?.createdJobs)?record.createdJobs:null,
      customerMode:["existing","new","additional_property"].includes(record?.customerMode)?
        record.customerMode:null,
    });
  } catch {
    return json(503,{error:"read_only_status_storage_unavailable"});
  }
}
export const config={
  path:"/api/nibinguy-preview77-readonly-diagnostic",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:8},
};
