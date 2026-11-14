// Scheduled, read-only booking reconciliation. Never contacts Squeegee or
// resubmits a booking. Digest contains references only, not customer PII.
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";
import guard from "./lib/squeegeeProductionGuard.js";

const MAX_SCAN=10000;
const REVIEW_STAGES=new Set(["held_for_review","requires_reconciliation"]);
const FAILURE_DELIVERY=new Set(["not_sent","failed"]);
const validId=x=>/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i.test(x);
const ownerEmail=env=>env.BOOKINGS_TO||"info@nibing.uy";
const sender=env=>env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>";
const safeAge=x=>{const t=Date.parse(x||"");return Number.isFinite(t)?Date.now()-t:Infinity;};
const needsReview=record=>{
  if(!record || typeof record!=="object")return true;
  if(REVIEW_STAGES.has(record.stage) || record.ownerNotificationNeedsAttention===true ||
    FAILURE_DELIVERY.has(record.ownerAlertDelivery))return true;
  if(record.stage==="created_customer_and_jobs")return false;
  return safeAge(record.updatedAt||record.acceptedAt)>5*60*1000;
};
export default async function handler(_request,context){
  const scope={hostname:"nibing.uy",deployContext:context?.deploy?.context,siteId:context?.site?.id};
  if(!guard.isVerifiedProductionScope(scope))return;
  if(!process.env.RESEND_API_KEY){console.error("Booking reconciliation: owner email provider unavailable");return;}
  const store=getStore({name:guard.STATUS_STORE,consistency:"strong"});
  const alertStore=getStore({name:"nibinguy-production-booking-reconciliation-alerts",consistency:"strong"});
  const pending=[];
  let cursor,scanned=0,complete=true;
  try{
    do{
      const page=await store.list({prefix:"NBG-",paginate:true,cursor});
      for(const item of page.blobs||[]){
        if(++scanned>MAX_SCAN){complete=false;break;}
        if(!validId(item.key))continue;
        const record=await store.get(item.key,{type:"json",consistency:"strong"});
        if(record?.bookingId===item.key && needsReview(record))pending.push(item.key);
      }
      if(!complete)break;
      cursor=page.cursor;
    }while(cursor);
  }catch(error){complete=false;console.error("Booking reconciliation scan failed",error?.name);}
  // No false all-clear: an incomplete scan itself warrants attention.
  if(!pending.length && complete)return;
  pending.sort();
  const hour=new Date().toISOString().slice(0,13);
  // Reserve an hourly fallback alert before sending; concurrent invocations cannot spam.
  // A failed email is recorded, not silently treated as delivered.
  const key="digest-"+hour;
  let claim;
  try{claim=await alertStore.setJSON(key,{state:"sending",createdAt:new Date().toISOString()}, {onlyIfNew:true});}
  catch(error){console.error("Booking reconciliation alert reservation failed",error?.name);return;}
  if(claim?.modified!==true)return;
  const summary=pending.slice(0,60).join("\n");
  const text=["NI BIN GUY — BOOKING NEEDS ATTENTION",
    "Outstanding booking references: "+pending.length,
    "Scan complete: "+(complete?"yes":"NO — manual review required"),
    "No bookings have been retried or changed.",
    "Review: https://nibing.uy/api/squeegee-production-auto-status?review=1",
    "",summary, pending.length>60?"Additional bookings are on the owner review page.":""].join("\n");
  try{
    const response=await new Resend(process.env.RESEND_API_KEY).emails.send({
      from:sender(process.env),to:[ownerEmail(process.env)],
      subject:"NI Bin Guy — BOOKING NEEDS ATTENTION — Outstanding booking alert",text,
    });
    await alertStore.setJSON(key,{state:response?.error?"failed":"sent",
      sentAt:new Date().toISOString(),count:pending.length,complete});
    if(response?.error)console.error("Booking reconciliation digest provider rejected email");
  }catch(error){
    console.error("Booking reconciliation digest delivery failed",error?.name);
    try{await alertStore.setJSON(key,{state:"failed",count:pending.length,complete});}catch{}
  }
}
// Repeat while unresolved, at most once per UTC hour. This is a fallback\n// notification, NOT a replay of the original signed owner email.\nexport const config={schedule:"0 * * * *"};
