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

function emailContent(bookingId,reason,extra={}) {
  if(!BOOKING_RE.test(String(bookingId||"")) ||
     !CODE_RE.test(String(reason||"")))return null;
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
async function deliverOwnerEmail(email,{env=process.env,send=null}={}){
  if(typeof send!=="function" &&
     (!env.RESEND_API_KEY || !env.BOOKINGS_TO))
    return {sent:false,reason:"owner_alert_not_configured"};
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

module.exports={emailContent,notifyOwnerOfSyncHold,
  duplicateSignalsEmailContent,notifyOwnerOfDuplicateSignals,
  quantityBookedEmailContent,notifyOwnerOfQuantityBooking,
  allowedFlags,duplicateFlagLabels};
