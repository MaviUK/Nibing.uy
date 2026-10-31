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
const {DUPLICATE_SIGNAL_CODES}=require("./squeegeeCustomerMatcher");
const KNOWN_FLAGS=new Set(DUPLICATE_SIGNAL_CODES);
const FLAG_LABELS=Object.freeze({
  email_already_registered:"Email is already registered on another Squeegee record",
  email_used_at_other_property:"Same email is associated with another service property",
  multiple_records_with_email:"More than one existing Squeegee record uses this email",
  address_already_registered:"Service address already exists in Squeegee",
  address_registered_to_other_name:"Same address has a customer with a different name",
  multiple_records_at_address:"Multiple Squeegee customer records share this address",
  same_name_address_contact_changed:"Same name and address, but email and phone differ",
  possible_duplicate_address:"Possible address duplication or differently formatted street",
  phone_already_registered:"Phone number is already registered",
  phone_used_at_other_property:"Phone number is also used at another property",
});
function allowedFlags(value){
  if(!Array.isArray(value))return [];
  return [...new Set(value.filter(code=>KNOWN_FLAGS.has(code)))];
}
function duplicateFlagLabels(flags){
  return allowedFlags(flags).map(code=>FLAG_LABELS[code]);
}


/** Only these definitive owner-review holds are allowed to use customer
 * details. They are sent to the same private BOOKINGS_TO mailbox as the
 * normal accepted booking email; status storage and logs stay PII-free.
 */
const INACTIVE_REASONS=new Set([
  "existing_customer_reactivation_required","existing_customer_inactive",
]);
const CUSTOMER_REVIEW_REASONS=new Set([
  ...INACTIVE_REASONS,"customer_match_ambiguous_or_incomplete",
]);
function cleanOwnerField(value,max=200){
  return String(value??"").replace(/[\x00-\x1f\x7f]+/g," ")
    .replace(/\s+/g," ").trim().slice(0,max);
}
function emailHtmlEscape(value){
  return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function inactiveSignupEmailContent(bookingId,reason,extra={}){
  if(!BOOKING_RE.test(String(bookingId||""))||
     !CUSTOMER_REVIEW_REASONS.has(reason))return null;
  const ambiguous=reason==="customer_match_ambiguous_or_incomplete";
  const name=cleanOwnerField(extra.customerName,120);
  const address=cleanOwnerField(extra.serviceAddress,250);
  const email=cleanOwnerField(extra.customerEmail,180);
  const phone=cleanOwnerField(extra.customerPhone,35);
  const status=cleanOwnerField(extra.squeegeeAccountStatus,30).toLowerCase();
  const knownStatuses=new Set([
    "inactive","deactivated","deleted","archived","cancelled","canceled",
  ]);
  const accountStatus=ambiguous?"not confirmed":
    knownStatuses.has(status)?status:"not confirmed";
  const matchReason=CODE_RE.test(String(extra.matchReason||""))?
    extra.matchReason:"not_verified";
  const binCounts=Array.isArray(extra.requestedBinCounts)?
    extra.requestedBinCounts.filter(x=>typeof x==="string"&&
      /^(?:[1-9]\d?|1\d{2}|200) x (?:Black|Brown|Blue|Green) Bin$/.test(x))
      .slice(0,12):[];
  const firstDates=Array.isArray(extra.firstCleanDates)?
    [...new Set(extra.firstCleanDates.filter(x=>typeof x==="string"&&
      /^\d{4}-\d{2}-\d{2}$/.test(x)))].slice(0,12):[];
  const total=Number(extra.bookingTotal);
  const bookingTotal=Number.isFinite(total)&&total>=0&&total<=5000?
    "£"+total.toFixed(2):"See original booking";
  const needsReactivation=reason==="existing_customer_reactivation_required";
  const statusCopy=ambiguous?
    "The website booking matches overlapping or incompletely formatted Squeegee customer information. We cannot safely identify the correct account or verify whether it is inactive. No customer or job was created.":
    needsReactivation?
      "An existing customer is inactive or deactivated in Squeegee. Their website sign-up has been received, but no customer or job was created.":
      "A previously registered customer has a closed or archived Squeegee record. Review its status before deciding whether it can be reactivated. No customer or job was created.";
  const actionCopy=ambiguous?
    "Search Squeegee using the customer's full name, address, postcode and contact details. Check for duplicate records and confirm whether the correct account is inactive. Reactivate it only after verification.":
    needsReactivation?
      "Locate the existing Squeegee customer and reactivate them manually if appropriate.":
      "Locate the existing Squeegee customer and review whether the account can be restored.";
  const statusUrl="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-status?bookingId="+bookingId;
  const text=[
    ambiguous?
      "CUSTOMER SIGN-UP NEEDS REVIEW — MANUAL ACTION REQUIRED":
      "INACTIVE CUSTOMER SIGN-UP — MANUAL ACTION REQUIRED",
    "",
    statusCopy,
    "Booking reference: "+bookingId,
    "Existing Squeegee status: "+accountStatus,
    ambiguous?"Customer matching issue: "+matchReason:"",
    name?"Customer: "+name:"",
    address?"Service address: "+address:"",
    email?"Email: "+email:"",
    phone?"Phone: "+phone:"",
    ...binCounts.map(value=>"Requested bin: "+value),
    ...firstDates.map(value=>"Proposed first clean: "+value),
    "New booking total: "+bookingTotal,
    "",
    "WHAT TO DO",
    "1. "+actionCopy,
    "2. Check the original Squeegee jobs, payment settings and cleaning round.",
    "3. Add the requested services/quantities, price and appointments manually.",
    "4. Confirm the arrangement with the customer. Do not ask them to submit another booking.",
    "",
    "This website booking is HELD and will not automatically retry.",
    "No Squeegee customer or job was created for this submission.",
    "Read-only booking status: "+statusUrl,
    "Preview 1 only. Production and Preview 2 are unchanged.",
  ].filter(x=>x!==null&&x!==undefined&&x!=="").join("\n");
  const row=(label,value)=>value?
    '<tr><td style="font-size:13px;color:#596176;padding:8px 12px 8px 0;vertical-align:top;width:42%">'+emailHtmlEscape(label)+'</td>'+
    '<td style="font-size:14px;color:#16191e;padding:8px 0;font-weight:600;vertical-align:top;overflow-wrap:anywhere">'+emailHtmlEscape(value)+'</td></tr>':"";
  const statusText=ambiguous?"POSSIBLE EXISTING ACCOUNT — REVIEW REQUIRED":
    needsReactivation?"REACTIVATION REQUIRED":"CLOSED ACCOUNT — REVIEW REQUIRED";
  const heading=ambiguous?"Customer Sign-Up Needs Review":"Inactive Customer Sign-Up";
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
    '<body style="margin:0;background:#0d0e11;font-family:Arial,Helvetica,sans-serif">'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0d0e11"><tr><td align="center" style="padding:24px 12px">'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-collapse:collapse">'+
    '<tr><td style="background:#090909;color:#fff;text-align:center;padding:26px 20px">'+
    '<div style="font-size:25px;font-weight:900;letter-spacing:1px">NI BIN GUY</div>'+
    '<div style="font-size:12px;color:#f5d84f;letter-spacing:1.8px;margin-top:8px">BOOKING SYSTEM ALERT</div></td></tr>'+
    '<tr><td style="height:7px;background:#f5d84f"></td></tr>'+
    '<tr><td style="padding:26px 25px 8px">'+
    '<div style="font-size:12px;color:#926000;font-weight:800;letter-spacing:1px">'+emailHtmlEscape(statusText)+'</div>'+
    '<h1 style="font-size:24px;color:#121212;margin:10px 0 14px">'+emailHtmlEscape(heading)+'</h1>'+
    '<p style="font-size:15px;line-height:1.6;color:#333;margin:0">'+emailHtmlEscape(statusCopy)+'</p></td></tr>'+
    '<tr><td style="padding:10px 25px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #e4e6e9;border-bottom:1px solid #e4e6e9">'+
    row("Booking reference",bookingId)+row("Squeegee account status",accountStatus)+
    (ambiguous?row("Match issue",matchReason):"")+
    row("Customer",name)+row("Service address",address)+
    row("Email",email)+row("Phone",phone)+
    row("Requested bins",binCounts.join(" + "))+row("First clean(s)",firstDates.join(", "))+row("New booking total",bookingTotal)+
    '</table></td></tr>'+
    '<tr><td style="padding:0 25px 20px">'+
    '<h2 style="font-size:17px;margin:0 0 12px;color:#111">Action required</h2>'+
    '<p style="font-size:14px;color:#242424;line-height:1.6;margin:0 0 9px">1. '+emailHtmlEscape(actionCopy)+'</p>'+
    '<p style="font-size:14px;color:#242424;line-height:1.6;margin:0 0 9px">2. Review the existing jobs, payments and cleaning round.</p>'+
    '<p style="font-size:14px;color:#242424;line-height:1.6;margin:0 0 9px">3. Add the requested bins and appointments manually, then confirm with the customer.</p>'+
    '<a href="'+emailHtmlEscape(statusUrl)+'" style="display:block;background:#111;color:#f5d84f;font-size:14px;text-align:center;font-weight:800;padding:14px;text-decoration:none;margin-top:16px">VIEW READ-ONLY BOOKING STATUS</a>'+
    '<p style="font-size:13px;line-height:1.6;color:#72530c;background:#fff6d8;padding:12px;margin:18px 0 0">No new Squeegee customer or job was created. Do not resubmit or replay this booking automatically.</p>'+
    '</td></tr><tr><td style="background:#f2f3f5;padding:18px 25px;font-size:12px;color:#676767">'+
    'Preview 1 integration notification · Owner only · No change to the live site'+
    '</td></tr></table></td></tr></table></body></html>';
  return {
    subject:ambiguous?
      "NI Bin Guy — CUSTOMER SIGN-UP NEEDS REVIEW — "+bookingId:
      "NI Bin Guy — INACTIVE CUSTOMER SIGN-UP — "+bookingId,
    text,html,
  };
}

function emailContent(bookingId,reason,extra={}) {
  if(!BOOKING_RE.test(String(bookingId||"")) ||
     !CODE_RE.test(String(reason||"")))return null;
  if(CUSTOMER_REVIEW_REASONS.has(reason))
    return inactiveSignupEmailContent(bookingId,reason,extra);
  const matchReason=CODE_RE.test(String(extra?.matchReason||""))?
    extra.matchReason:"";
  const duplicateFlags=allowedFlags(extra?.duplicateFlags);
  const requestedBinCounts=Array.isArray(extra?.requestedBinCounts)?
    extra.requestedBinCounts.filter(x=>typeof x==="string" &&
      /^(?:[1-9]\d?|1\d{2}|200) x (?:Black|Brown|Blue|Green) Bin$/.test(x)).slice(0,12):[];
  const quantityAdvice={
    service_quantity_requires_manual_configuration:
      "This booking requests multiple physical bins of one colour. The Squeegee API cannot set verified per-service quantities. No customer or job was automatically created. Check the original booking email and manually create the correct service quantities, job price, round and dates in Squeegee.",
    duplicate_bin_types_in_same_booking:
      "The booking repeats a bin colour on separate lines. Check whether this means multiple physical bins. No customer or job was automatically created. Review and set the correct service quantities manually.",
    existing_job_for_selected_bin_requires_review:
      "The customer already has the selected bin service. Confirm whether the request is an ADDITIONAL physical bin or an accidental repeat. If additional, edit the existing Squeegee job's service quantity and price manually. Do not create a duplicate job.",
  };
  return {
    subject:"NI Bin Guy — Squeegee booking needs review: "+bookingId,
    text:[
      "A website booking was accepted, but Squeegee import did NOT complete.",
      "Booking reference: "+bookingId,
      "Import status: "+(reason==="requires_reconciliation"?
        "UNCONFIRMED / may be partially created":"HELD — no automatic retry"),
      "Reason: "+reason,
      matchReason?"Customer match: "+matchReason:"",
      ...requestedBinCounts.map(value=>"Requested: "+value),
      quantityAdvice[reason]?"Action required: "+quantityAdvice[reason]:"",
      ...duplicateFlags.map(flag=>"Duplicate flag: "+FLAG_LABELS[flag]),
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
  return deliverOwnerEmail(email,{env,send});
}


/** Informational message about repeated email/address/phone data after a
 * successful import. Never claims duplicates necessarily represent errors.
 * The already-delivered admin booking email supplies customer details.
 */
function duplicateSignalsEmailContent(bookingId,flags){
  if(!BOOKING_RE.test(String(bookingId||"")))return null;
  const codes=allowedFlags(flags);
  if(!codes.length)return null;
  return {
    subject:"NI Bin Guy — duplicate details flagged: "+bookingId,
    text:[
      "The website booking has been processed by the Squeegee integration.",
      "Booking reference: "+bookingId,
      "",
      "Existing Squeegee details matched:",
      ...codes.map(flag=>"- "+FLAG_LABELS[flag]),
      "",
      "Repeated email addresses are often legitimate for different properties.",
      "This is an informational flag, not proof that a duplicate job was created.",
      "Check the normal booking email for the new customer details.",
      "Do not submit the booking again solely because of these flags.",
      "Preview 1 only. Production and Preview 2 are unchanged.",
    ].join("\n"),
  };
}
async function notifyOwnerOfDuplicateSignals(bookingId,flags,{
  env=process.env,send=null,
}={}){
  const content=duplicateSignalsEmailContent(bookingId,flags);
  if(!content)return {sent:false,reason:"no_valid_duplicate_flags"};
  return deliverOwnerEmail(content,{env,send});
}

function quantityBookedEmailContent(bookingId,details={}) {
  if(!BOOKING_RE.test(String(bookingId||"")))return null;
  const requested=Array.isArray(details.requestedBinCounts)?
    details.requestedBinCounts.filter(x=>
      typeof x==="string" && /^(?:[1-9]\d?|1\d{2}|200) x (?:Black|Brown|Blue|Green) Bin$/.test(x)).slice(0,12):[];
  const additional=Array.isArray(details.additionalExistingBins)?
    details.additionalExistingBins.filter(x=>
      ["black","brown","green","blue"].includes(x)).slice(0,4):[];
  return {
    subject:"NI Bin Guy — Multiple bins synced; check quantities: "+bookingId,
    text:[
      "A website booking has been successfully written to Squeegee.",
      "Booking reference: "+bookingId,
      ...requested.map(x=>"Booked: "+x),
      additional.length?
        "This booking adds bin(s) of colours already present on the customer's account: "+additional.join(", "):"",
      "",
      "Total job price and physical bin quantities are recorded in the new job's notes.",
      "The documented Squeegee public API cannot specify the service quantity field.",
      "Check the Squeegee job notes and, if necessary, update the displayed service quantity manually.",
      additional.length?
        "Existing jobs were not edited: consolidate same-day jobs manually where appropriate.":"",
      "Do not resubmit the website booking.",
      "Preview 1 only. Production and Preview 2 are unchanged.",
    ].filter(Boolean).join("\n"),
  };
}
async function notifyOwnerOfQuantityBooking(bookingId,details={},options={}) {
  const content=quantityBookedEmailContent(bookingId,details);
  if(!content)return {sent:false,reason:"invalid_quantity_booking"};
  return deliverOwnerEmail(content,options);
}
function resolveOwnerEmailSettings(env={}) {
  // The normal booking email uses the info mailbox when BOOKINGS_TO isn't
  // configured. Operational owner alerts must use the SAME fallback.
  const recipient=typeof env.BOOKINGS_TO==="string"?
    env.BOOKINGS_TO.trim():"";
  return {
    from:env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
    to:[recipient||"info@nibing.uy"],
  };
}
async function deliverOwnerEmail(email,{env=process.env,send=null}={}){
  // BOOKINGS_TO is optional: it defaults to info@nibing.uy exactly
  // as sendBookingEmail.js does. Only a missing provider key stops sending.
  if(typeof send!=="function" && !env.RESEND_API_KEY)
    return {sent:false,reason:"owner_alert_not_configured"};
  try{
    const deliver=send||((args)=>{
      const {Resend}=require("resend");
      return new Resend(env.RESEND_API_KEY).emails.send(args);
    });
    const message={
      ...resolveOwnerEmailSettings(env),
      subject:email.subject,
      text:email.text,
    };
    if(typeof email.html==="string")message.html=email.html;
    const result=await deliver(message);
    if(result?.error)return {sent:false,reason:"owner_alert_provider_error"};
    return {sent:true};
  }catch {
    return {sent:false,reason:"owner_alert_delivery_failed"};
  }
}

module.exports={emailContent,inactiveSignupEmailContent,notifyOwnerOfSyncHold,
  resolveOwnerEmailSettings,
  duplicateSignalsEmailContent,notifyOwnerOfDuplicateSignals,
  quantityBookedEmailContent,notifyOwnerOfQuantityBooking,
  allowedFlags,duplicateFlagLabels};
