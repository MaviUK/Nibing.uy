"use strict";

/** Preview 1 only. PII-free owner alert for an accepted website booking
 * that cannot safely be imported to Squeegee. Sends no customer, address,
 * email or phone information; the already-delivered booking receipt has it.
 *
 * This is an OUTGOING admin notification, not an automatic retry mechanism.
 * Absence of Resend credentials or alert failure does not change the worker
 * hold or allow any Squeegee write.
 */
const BOOKING_RE=/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i;
const CODE_RE=/^[a-z][a-z0-9_]{0,100}$/;

function emailContent(bookingId,reason,extra={}) {
  if(!BOOKING_RE.test(String(bookingId||"")) ||
     !CODE_RE.test(String(reason||"")))return null;
  const matchReason=CODE_RE.test(String(extra?.matchReason||""))?
    extra.matchReason:"";
  return {
    subject:"NI Bin Guy — Squeegee booking needs review: "+bookingId,
    text:[
      "A website booking was accepted, but Squeegee import did NOT complete.",
      "Booking reference: "+bookingId,
      "Import status: "+(reason==="requires_reconciliation"?
        "UNCONFIRMED / may be partially created":"HELD — no automatic retry"),
      "Reason: "+reason,
      matchReason?"Customer match: "+matchReason:"",
      "",
      "Open the existing website booking email for contact details.",
      "Inspect Squeegee and verify the correct customer, property and job.",
      "Do NOT submit a new website booking or retry an uncertain Squeegee POST.",
      "Preview 1 only. Production and Preview 2 are unchanged.",
    ].filter(Boolean).join("\n"),
  };
}

async function notifyOwnerOfSyncHold(bookingId,reason,extra={},{
  env=process.env,send=null,
}={}) {
  const email=emailContent(bookingId,reason,extra);
  if(!email)return {sent:false,reason:"invalid_alert_details"};
  if(typeof send!=="function" &&
     (!env.RESEND_API_KEY || !env.BOOKINGS_TO)) {
    return {sent:false,reason:"owner_alert_not_configured"};
  }
  try{
    const deliver=send||((args)=>{
      const {Resend}=require("resend");
      return new Resend(env.RESEND_API_KEY).emails.send(args);
    });
    const result=await deliver({
      from:env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
      to:[env.BOOKINGS_TO||"info@nibing.uy"],
      subject:email.subject,
      text:email.text,
    });
    if(result?.error)return {sent:false,reason:"owner_alert_provider_error"};
    return {sent:true};
  }catch {
    return {sent:false,reason:"owner_alert_delivery_failed"};
  }
}

module.exports={emailContent,notifyOwnerOfSyncHold};
