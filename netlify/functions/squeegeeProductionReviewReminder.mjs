// Daily owner reminder for unresolved production booking reviews.
// Email-only; never calls Squeegee or modifies booking records.
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";
import guard from "./lib/squeegeeProductionGuard.js";

const REVIEW_STORE="squeegee-production-owner-review-ack-v1";
const REF=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const DATE_FMT=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"});
const HOUR_FMT=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23"});
const statusStore=()=>getStore({name:guard.STATUS_STORE,consistency:"strong"});
const reviewStore=()=>getStore({name:REVIEW_STORE,consistency:"strong"});
const sendStore=()=>getStore({name:"squeegee-production-review-digest-send-v1",consistency:"strong"});
function needsReview(s){
  return ["held_for_review","requires_reconciliation"].includes(s.stage) ||
    s.manualScheduleRequired===true ||
    ["not_sent","failed"].includes(s.ownerAlertDelivery) ||
    (s.stage!=="created_customer_and_jobs" &&
      Date.now()-Date.parse(s.updatedAt||s.acceptedAt||0)>5*60*1000);
}
async function unresolved(){
  const status=statusStore(),reviews=reviewStore(),out=[];
  let cursor;
  do{
    const page=await status.list({prefix:"NBG-",paginate:true,cursor});
    for(const item of page.blobs||[]){
      const ref=item.key;
      if(!REF.test(ref))continue;
      const record=await status.get(ref,{type:"json",consistency:"strong"});
      if(!record || record.bookingId!==ref || !needsReview(record))continue;
      const ack=await reviews.get("resolved-"+ref,{type:"json",consistency:"strong"});
      if(ack?.resolved===true && ack.bookingId===ref &&
        ack.statusUpdatedAt===record.updatedAt)continue;
      out.push({ref,stage:String(record.stage||"unknown"),
        reason:String(record.reason||"unknown"),
        ownerEmail:String(record.ownerAlertDelivery||"unknown")});
    }
    cursor=page.cursor;
  }while(cursor);
  return out;
}
export default async function handler(request,context){
  // Scheduled functions must execute in the real production deployment only.
  if(context?.deploy?.context!=="production" ||
     context?.site?.id!=="d63c829f-3ed7-48e9-9633-a042de3f2e84" ||
     process.env.CONTEXT!=="production")return new Response("Skipped",{status:200});
  const now=new Date();
  if(HOUR_FMT.format(now)!=="09")return new Response("Outside UK 09:00",{status:200});
  if(!process.env.RESEND_API_KEY)return new Response("Email not configured",{status:503});
  let tickets;
  try{tickets=await unresolved();}catch(e){
    console.error("Owner review reminder scan failed",e);
    return new Response("Review scan unavailable",{status:503});
  }
  if(!tickets.length)return new Response("No unresolved tickets",{status:200});
  const day=DATE_FMT.format(now);
  const marker=await sendStore().setJSON("digest-"+day,
    {day,count:tickets.length,startedAt:now.toISOString()},
    {onlyIfNew:true});
  if(marker?.modified!==true || !marker?.etag)
    return new Response("Reminder already attempted",{status:200});
  const lines=tickets.map(t=>t.ref+" | "+t.stage+" | "+t.reason+
    " | owner email: "+t.ownerEmail+
    "\nhttps://nibing.uy/api/squeegee-production-auto-status?bookingId="+encodeURIComponent(t.ref));
  const mail=new Resend(process.env.RESEND_API_KEY);
  try{
    const result=await mail.emails.send({
      from:process.env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
      to:"info@nibing.uy",
      subject:"NI Bin Guy: "+tickets.length+" unresolved booking review"+(tickets.length===1?"":"s"),
      text:"These booking reviews remain unresolved as of 9am UK time.\n\n"+
        lines.join("\n\n")+"\n\nReview all: https://nibing.uy/api/squeegee-production-auto-status?review=1"+
        "\n\nThis reminder does not retry or modify Squeegee bookings.",
    });
    if(result?.error)throw new Error("Resend rejected owner digest");
    await sendStore().setJSON("digest-"+day,
      {day,count:tickets.length,sentAt:new Date().toISOString()});
    return new Response("Reminder accepted",{status:200});
  }catch(e){
    console.error("Owner review reminder send failed",e);
    // Leave the attempt marker: prevent duplicate emails on ambiguous provider outcomes.
    return new Response("Reminder send failed; inspect provider logs",{status:503});
  }
}
export const config={schedule:"0 8,9 * * *"};
