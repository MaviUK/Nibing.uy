// One-time READ-ONLY diagnosis of the already accepted 20:06 Preview 1 booking.
// No customer PII, Squeegee API operations, claims or writes. Remove after check.
import api from "./lib/squeegeeApiV3.js";
import customerMatcher from "./lib/squeegeeCustomerMatcher.js";
import {getStore} from "@netlify/blobs";
const BOOKING_ID="NBG-MVVEKILD-31F3D9F612";
const knownStages=new Set([
  "accepted_for_validation","validating","held_for_review",
  "ready_for_claims","creating_customer","creating_job",
  "created_customer_and_jobs","requires_reconciliation",
]);
const validClaimStates=new Set([
  "reserved","request_in_progress","succeeded","requires_reconciliation",
]);
const code=value=>typeof value==="string" &&
  /^[a-z][a-z0-9_]{0,100}$/.test(value)?value:null;
const toCodes=value=>Array.isArray(value)?
  value.slice(0,15).map(code).filter(Boolean):[];
export default async function handler(request,context) {
  const runtime={hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id};
  if(!api.isExactPreview1(process.env,runtime))
    return new Response("Not found",{status:404});
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  if(Date.now()>Date.parse("2026-10-31T23:59:59Z"))
    return new Response("Retired",{status:410});
  try{
    const [status,claim]=await Promise.all([
      getStore({name:"squeegee-preview1-auto-sync-status",consistency:"strong"})
        .get(BOOKING_ID,{type:"json",consistency:"strong"}),
      getStore({name:"squeegee-preview1-write-claims",consistency:"strong"})
        .get("claim-v1/auto-bookings/"+BOOKING_ID,
          {type:"json",consistency:"strong"}),
    ]);
    // Only the audited booking is used to find its verified existing
    // customer. GET-only customer matching and GET /customers/:id. No
    // customer name, address, ID, email, phone or job values are returned.
    let customerJobShape={check:"not_attempted"};
    try {
      const audit=getStore({name:"tos-confirmations",consistency:"strong"});
      const listed=await audit.list({prefix:"2026-10-30T20:06"});
      const blobKeys=Array.isArray(listed?.blobs)?listed.blobs:[];
      if(blobKeys.length>0 && blobKeys.length<=40 && !listed.cursor) {
        let accepted=null;
        for(const item of blobKeys) {
          const record=await audit.get(item.key,{
            type:"json",consistency:"strong",
          });
          if(record?.bookingId===BOOKING_ID) {
            accepted=record;break;
          }
        }
        if(accepted) {
          const matched=await customerMatcher.matchCustomersAcrossPages(
            accepted,args=>api.listCustomers(args),{maxPages:100});
          if(matched.status==="matched" ||
             matched.status==="reactivation_required") {
            const record=await api.getCustomer(matched.customerId);
            const kind=value=>Array.isArray(value)?"array":
              value===null?"null":typeof value;
            const jobs=record?.jobs;
            const first=Array.isArray(jobs)?jobs[0]:null;
            const meta={
              check:"completed",
              jobsType:kind(jobs),
              jobsCount:Array.isArray(jobs)?jobs.length:null,
              customerJobRelatedKeys:record&&typeof record==="object"?
                Object.keys(record).filter(k=>/job|service|work|appointment/i.test(k)).slice(0,12):[],
              firstJobKeys:first&&typeof first==="object"?
                Object.keys(first).slice(0,24):[],
              firstJobServicesType:kind(first?.services),
              firstJobServicesCount:Array.isArray(first?.services)?first.services.length:null,
              firstJobServiceValueType:Array.isArray(first?.services)&&
                first.services.length?kind(first.services[0]):null,
              firstJobServiceObjectKeys:Array.isArray(first?.services)&&
                first.services[0]&&typeof first.services[0]==="object"?
                  Object.keys(first.services[0]).slice(0,16):[],
            };
            customerJobShape=meta;
          }else{
            customerJobShape={check:"match_"+matched.status};
          }
        }else{
          customerJobShape={check:"accepted_audit_not_found"};
        }
      }else{
        customerJobShape={check:"audit_page_incomplete_or_missing"};
      }
    }catch{
      customerJobShape={check:"read_only_customer_shape_unavailable"};
    }
    const body={
      customerJobShape,
      stage:knownStages.has(status?.stage)?status.stage:
        status?"other":"not_found",
      reason:code(status?.reason),
      matchReason:code(status?.matchReason),
      blockedReasons:toCodes(status?.blockedReasons),
      duplicateFlags:toCodes(status?.duplicateFlags),
      customerMode:["existing","new","additional_property"]
        .includes(status?.customerMode)?status.customerMode:null,
      createdJobs:Number.isInteger(status?.createdJobs)?status.createdJobs:null,
      jobsConfirmed:Number.isInteger(status?.jobsConfirmed)?status.jobsConfirmed:null,
      claimState:validClaimStates.has(claim?.state)?claim.state:
        claim?"other":"not_found",
    };
    return new Response(JSON.stringify(body),{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"private, no-store, max-age=0",
      "X-Robots-Tag":"noindex,nofollow,noarchive",
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
    }});
  }catch{
    return new Response('{"error":"read_only_status_unavailable"}',
      {status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  }
}
export const config={
  path:"/api/preview77-readonly-2010",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:8},
};
