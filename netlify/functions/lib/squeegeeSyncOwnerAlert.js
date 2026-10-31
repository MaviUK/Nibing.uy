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
  const duplicateLabels=ambiguous?
    allowedFlags(extra.duplicateFlags).map(code=>FLAG_LABELS[code]):[];
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
    ...duplicateLabels.map(label=>"Duplicate flag: "+label),
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
    (ambiguous?row("Match issue",matchReason)+
      row("Possible duplicate signals",duplicateLabels.join("; ")):"")+
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


const REVIEW_HELP=Object.freeze({
  schedule_services_or_groups_unavailable:{
    category:"Council dates or Squeegee services unavailable",
    action:"Check the council bin collection date, available Squeegee services and job group. Add the booking manually after confirming the correct schedule.",
  },
  date_price_service_or_round_not_verified:{
    category:"Cleaning date, round or price could not be verified",
    action:"Confirm the correct collection date, bin colour, four-weekly round and price. Add the booking in Squeegee manually when verified.",
  },
  booking_validation_failed:{
    category:"Booking details could not be validated",
    action:"Review the submitted address, selected bins, pricing and booking details. Create the job manually after checking the information.",
  },
  grouped_job_price_or_service_mismatch:{
    category:"Bin grouping or total price mismatch",
    action:"Compare the booked bins against the expected job grouping and total. Correct the details manually before creating any job.",
  },
  cannot_safely_group_bin_jobs:{
    category:"Bins could not safely be grouped",
    action:"Check which bins share the same council date and round, then create separate or combined jobs manually as appropriate.",
  },
  conflicting_same_colour_schedules:{
    category:"Conflicting dates for the same bin colour",
    action:"Verify the correct collection dates for repeated bins of the same colour, then enter the jobs manually.",
  },
  customer_match_ambiguous_or_incomplete:{
    category:"Customer account requires review",
    action:"Search existing Squeegee customers by full name and property before making changes.",
  },
  automatic_sync_not_enabled:{
    category:"Automatic Squeegee syncing is unavailable",
    action:"The booking was received by the website, but the automatic Squeegee integration was not enabled. Check Squeegee before adding it manually.",
  },
  outside_approved_preview_email_pilot:{
    category:"Booking is outside the current automatic Squeegee rollout",
    action:"This booking requires manual entry because the automatic Squeegee import is not enabled for it.",
  },
  service_quantity_requires_manual_configuration:{
    category:"Multiple bins need manual quantity configuration",
    action:"Check the original booking and manually create the correct service quantities, job price, round and dates in Squeegee.",
  },
  existing_job_for_selected_bin_requires_review:{
    category:"Customer is buying a bin colour already registered",
    action:"Confirm whether this is an ADDITIONAL physical bin or an accidental repeat. If additional, edit the existing Squeegee job quantity and price manually.",
  },
  duplicate_bin_types_in_same_booking:{
    category:"Repeated bin colours need checking",
    action:"Check the physical bin count and manually enter the right quantity and price.",
  },
  existing_customer_details_unavailable:{
    category:"Existing Squeegee customer could not be verified",
    action:"Open the customer in Squeegee and confirm that their status, service address and existing jobs are correct.",
  },
  existing_customer_address_unverified:{
    category:"Existing customer's service address could not be verified",
    action:"Verify the property before assigning any service to the existing account.",
  },
  existing_customer_identity_unverified:{
    category:"Customer identity could not be confirmed",
    action:"Compare the full name, email and phone number with Squeegee before attaching a job to the customer.",
  },
  existing_customer_name_unverified:{
    category:"Existing customer's name did not match",
    action:"Check the full customer name and registered address in Squeegee before adding the booking.",
  },
  customer_property_claimed_or_uncertain:{
    category:"Property was previously registered or processing is uncertain",
    action:"Look up the property and any existing customer/job before creating a manual job.",
  },
  property_bin_already_claimed_or_uncertain:{
    category:"A bin at this property may already be registered",
    action:"Check the existing job and bin quantities before entering anything manually.",
  },
  booking_already_claimed_or_uncertain:{
    category:"Booking may already have been processed",
    action:"Search Squeegee and read the booking's sync status before changing any job. Do not automatically retry.",
  },
  schedule_not_verified:{
    category:"Cleaning schedule could not be verified",
    action:"Confirm the collection dates and Squeegee round manually.",
  },
  schedule_services_or_groups_unverified:{
    category:"Squeegee schedule and services could not be verified",
    action:"Check the correct job group and bin services in Squeegee.",
  },
  booking_terms_not_accepted:{
    category:"Terms acceptance could not be verified",
    action:"Check the accepted terms record before confirming the service manually.",
  },
  too_many_or_no_booking_lines:{
    category:"Bin selection requires manual review",
    action:"Check the booking for missing or excessive bin selections and arrange the correct service with the customer.",
  },
  dispatch_not_accepted:{
    category:"Squeegee automatic handoff was not accepted",
    action:"Check the protected booking status and Squeegee before manually creating a job. The booking was accepted by the website, but automatic processing was not confirmed.",
  },
  dispatch_uncertain_reconcile:{
    category:"Squeegee automatic handoff status is uncertain",
    action:"Check whether the booking was received by Squeegee before making changes. A delayed worker could still have run.",
  },
  dispatch_unavailable:{
    category:"Squeegee automatic handoff was unavailable",
    action:"Review the booking status and manually enter the job after confirming nothing was already created.",
  },
  worker_failed_unsafely_no_retry:{
    category:"Squeegee booking worker stopped unexpectedly",
    action:"Check the protected status and Squeegee for any existing or partial job before reconciling manually.",
  },
  unexpected_auto_sync_failure:{
    category:"Unexpected Squeegee integration error",
    action:"Check the job/customer in Squeegee and reconcile this booking manually. Do not automatically retry.",
  },
  partial_or_ambiguous_squeegee_write:{
    category:"Squeegee customer or jobs may have been partially created",
    action:"URGENT: Inspect Squeegee for any customer and appointments that may have been created before the error. Add only missing services manually; never replay the whole booking.",
  },
  requires_reconciliation:{
    category:"Squeegee import outcome requires manual reconciliation",
    action:"URGENT: Verify whether any part of the customer or job creation succeeded. Do not create a duplicate or automatically retry.",
  },
});
const UNCERTAIN_REASONS=new Set([
  "requires_reconciliation","partial_or_ambiguous_squeegee_write",
  "unexpected_auto_sync_failure","worker_failed_unsafely_no_retry",
  "dispatch_uncertain_reconcile","dispatch_not_accepted",
]);
function genericReviewContent(bookingId,reason,extra={}){
  const help=REVIEW_HELP[reason]||{
    category:"Squeegee job not automatically confirmed",
    action:"Check the full booking against the customer and jobs in Squeegee, then create or correct the booking manually when safe.",
  };
  const uncertain=UNCERTAIN_REASONS.has(reason) ||
    extra.customerPostMayHaveSucceeded===true ||
    extra.jobPostMayHaveSucceeded===true;
  const status=uncertain?
    "UNCONFIRMED — a customer or job may already exist":
    "HELD FOR REVIEW — no new job was intentionally posted";
  const intro=uncertain?
    "The website accepted a booking, but the Squeegee import outcome is not confirmed. Some work may already have been created. Check Squeegee before taking further action.":
    "The website accepted this booking, but it could not be automatically added to Squeegee. Manual action is required.";
  const name=cleanOwnerField(extra.customerName,120);
  const address=cleanOwnerField(extra.serviceAddress,250);
  const email=cleanOwnerField(extra.customerEmail,180);
  const phone=cleanOwnerField(extra.customerPhone,35);
  const bins=Array.isArray(extra.requestedBinCounts)?
    extra.requestedBinCounts.filter(x=>typeof x==="string" &&
      /^(?:[1-9]\d?|1\d{2}|200) x (?:Black|Brown|Blue|Green) Bin$/.test(x)).slice(0,12):[];
  const dates=Array.isArray(extra.firstCleanDates)?
    [...new Set(extra.firstCleanDates.filter(x=>typeof x==="string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(x)))].slice(0,12):[];
  const duplicateFlags=allowedFlags(extra.duplicateFlags);
  const blocked=Array.isArray(extra.blockedReasons)?
    extra.blockedReasons.filter(x=>typeof x==="string" &&
      CODE_RE.test(x)).slice(0,10):[];
  const amount=Number(extra.bookingTotal);
  const total=Number.isFinite(amount)&&amount>=0&&amount<=5000?
    "£"+amount.toFixed(2):"See submitted booking";
  const jobsConfirmed=Number.isSafeInteger(extra.jobsConfirmed)&&
    extra.jobsConfirmed>=0 && extra.jobsConfirmed<=50?
      extra.jobsConfirmed:null;
  const originalReason=CODE_RE.test(String(extra.matchReason||""))?
    extra.matchReason:"";
  const refUrl="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-status?bookingId="+bookingId;
  const subject=uncertain?
    "NI Bin Guy — URGENT: SQUEEGEE IMPORT UNCONFIRMED — "+bookingId:
    "NI Bin Guy — Squeegee booking needs review: "+bookingId;
  const text=[
    "NI BIN GUY — SQUEEGEE JOB NEEDS ATTENTION",
    intro,"",
    "Booking reference: "+bookingId,
    "Squeegee status: "+status,
    "Problem: "+help.category,
    "Reason code: "+reason,
    originalReason?"Additional detail: "+originalReason:"",
    name?"Customer: "+name:"",
    address?"Service address: "+address:"",
    email?"Email: "+email:"",
    phone?"Phone: "+phone:"",
    ...bins.map(x=>"Requested: "+x),
    ...dates.map(x=>"Proposed first clean: "+x),
    "New booking total: "+total,
    jobsConfirmed!==null?"Jobs confirmed before problem: "+jobsConfirmed:"",
    ...blocked.map(x=>"Date/round check: "+x),
    ...duplicateFlags.map(x=>"Duplicate flag: "+FLAG_LABELS[x]),
    "",
    "ACTION REQUIRED",
    help.action,
    "Check Squeegee's customer and job records before entering or updating anything.",
    uncertain?
      "Some Squeegee writes MAY have succeeded. Never automatically retry or recreate the entire booking.":
      "This booking is held and will not automatically retry.",
    "Do NOT submit a new website booking or retry an uncertain Squeegee POST.",
    "Read-only booking status: "+refUrl,
    "Preview 1 only. Production and Preview 2 are unchanged.",
  ].filter(Boolean).join("\n");
  const row=(label,value)=>value?
    '<tr><td style="font-size:13px;color:#596176;padding:8px 12px 8px 0;vertical-align:top;width:40%">'+emailHtmlEscape(label)+'</td>'+
    '<td style="font-size:14px;color:#16191e;padding:8px 0;font-weight:600;vertical-align:top;overflow-wrap:anywhere">'+emailHtmlEscape(value)+'</td></tr>':"";
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
    '<div style="font-size:12px;color:#926000;font-weight:800;letter-spacing:1px">'+
      emailHtmlEscape(uncertain?"URGENT — CHECK SQUEEGEE FIRST":"MANUAL ACTION REQUIRED")+'</div>'+
    '<h1 style="font-size:24px;color:#121212;margin:10px 0 14px">Squeegee Booking Needs Review</h1>'+
    '<p style="font-size:15px;line-height:1.6;color:#333;margin:0">'+emailHtmlEscape(intro)+'</p></td></tr>'+
    '<tr><td style="padding:10px 25px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #e4e6e9;border-bottom:1px solid #e4e6e9">'+
    row("Booking reference",bookingId)+row("Import status",status)+
    row("Problem",help.category)+row("Reason code",reason)+
    row("Additional detail",originalReason)+
    row("Customer",name)+row("Service address",address)+
    row("Email",email)+row("Phone",phone)+
    row("Requested bins",bins.join(" + "))+
    row("First clean(s)",dates.join(", "))+row("New booking total",total)+
    (jobsConfirmed!==null?row("Jobs confirmed",String(jobsConfirmed)):"")+
    row("Date and round checks",blocked.join("; "))+
    row("Duplicate concerns",duplicateFlags.map(x=>FLAG_LABELS[x]).join("; "))+
    '</table></td></tr><tr><td style="padding:0 25px 20px">'+
    '<h2 style="font-size:17px;margin:0 0 12px;color:#111">What to do next</h2>'+
    '<p style="font-size:14px;color:#242424;line-height:1.6;margin:0 0 12px">'+
      emailHtmlEscape(help.action)+'</p>'+
    '<p style="font-size:14px;color:#242424;line-height:1.6;margin:0 0 14px">'+
      emailHtmlEscape(uncertain?
        "The customer or some jobs might already exist. Check Squeegee before adding anything.":
        "The booking was held; check the details and add it manually when safe.")+'</p>'+
    '<a href="'+emailHtmlEscape(refUrl)+'" style="display:block;background:#111;color:#f5d84f;font-size:14px;text-align:center;font-weight:800;padding:14px;text-decoration:none">VIEW BOOKING STATUS (READ ONLY)</a>'+
    '<p style="font-size:13px;line-height:1.6;color:#72530c;background:#fff6d8;padding:12px;margin:18px 0 0">'+
      'Do not submit the website booking again. No automatic Squeegee retry has been scheduled.</p>'+
    '</td></tr><tr><td style="background:#f2f3f5;padding:18px 25px;font-size:12px;color:#676767">'+
      'Preview 1 integration notification · Owner only · Production unchanged'+
    '</td></tr></table></td></tr></table></body></html>';
  return {subject,text,html};
}

function emailContent(bookingId,reason,extra={}) {
  if(!BOOKING_RE.test(String(bookingId||"")) ||
     !CODE_RE.test(String(reason||"")))return null;
  if(CUSTOMER_REVIEW_REASONS.has(reason))
    return inactiveSignupEmailContent(bookingId,reason,extra);
  return genericReviewContent(bookingId,reason,extra);
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

/**
 * Only after a CONFIRMED successful Squeegee customer/job write:
 * replace (never supplement) the ordinary business booking email with one
 * black/yellow ACCOUNT NEEDS ATTENTION email. The documented Add Job API
 * receives one service UUID even if the purchaser bought 3 physical bins.
 * The job price already includes all the bins: it must not be multiplied.
 *
 * The receipt comes from an HMAC-signed, server-authored accepted booking,
 * never from a browser-chosen sender or recipient. Keep its original full
 * details and signed terms attachment.
 */
function completedQuantityAttentionContent(bookingId,receipt,details={}) {
  if(!BOOKING_RE.test(String(bookingId||"")) ||
     !details || details.quantityAttentionRequired!==true)return null;
  const changes=Array.isArray(details.quantityChanges)?
    details.quantityChanges.filter(item=>
      item && typeof item==="object" &&
      /^(Black|Brown|Blue|Green) Bin$/.test(String(item.bin||"")) &&
      Number.isSafeInteger(item.quantity) &&
      item.quantity>=2 && item.quantity<=200).slice(0,12):[];
  const additional=Array.isArray(details.additionalExistingBins)?
    [...new Set(details.additionalExistingBins.filter(x=>
      ["black","brown","blue","green"].includes(x)))].slice(0,4):[];
  if(!changes.length && !additional.length)return null;
  const requested=Array.isArray(details.requestedBinCounts)?
    details.requestedBinCounts.filter(x=>typeof x==="string" &&
      /^(?:[1-9]\d?|1\d{2}|200) x (?:Black|Brown|Blue|Green) Bin$/.test(x))
      .slice(0,12):[];
  const dates=Array.isArray(details.firstCleanDates)?
    [...new Set(details.firstCleanDates.filter(x=>
      typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)))].slice(0,12):[];
  const rounds=Array.isArray(details.rounds)?
    [...new Set(details.rounds.filter(x=>
      Number.isSafeInteger(x)&&x>=1&&x<=20))].slice(0,12):[];
  const total=Number(details.bookingTotal);
  const verifiedTotal=Number.isFinite(total)&&total>=0&&total<=5000?
    "£"+total.toFixed(2):"See created Squeegee job(s)";
  const name=cleanOwnerField(details.customerName,120);
  const address=cleanOwnerField(details.serviceAddress,250);
  const customerEmail=cleanOwnerField(details.customerEmail,180);
  const phone=cleanOwnerField(details.customerPhone,35);
  const dup=allowedFlags(details.duplicateFlags);
  const actionLines=[
    ...changes.map(item=>
      "Set "+item.bin+" service quantity to "+item.quantity+
      " on the newly created Squeegee job."),
    ...additional.map(colour=>
      "An existing job already uses "+colour.charAt(0).toUpperCase()+
      colour.slice(1)+" Bin. The website created an ADDITIONAL job; "+
      "check whether same-day jobs need to be merged manually."),
  ];
  const headline=changes.length===1?
    "Set "+changes[0].bin+" to "+changes[0].quantity:
    changes.length?"Check bin quantities":"Review additional bin job";
  const subject="NI Bin Guy — ACCOUNT NEEDS ATTENTION: "+headline+
    " — "+bookingId;
  const refUrl="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-status?bookingId="+bookingId;
  const text=[
    "NI BIN GUY — ACCOUNT NEEDS ATTENTION",
    "Squeegee customer and job(s) were created successfully.",
    "The public API does not set the service quantity for repeated bins.",
    "Booking reference: "+bookingId,
    name?"Customer: "+name:"",
    address?"Service address: "+address:"",
    customerEmail?"Email: "+customerEmail:"",
    phone?"Phone: "+phone:"",
    ...requested.map(item=>"Booked: "+item),
    ...dates.map(date=>"First clean: "+date),
    ...rounds.map(round=>"Squeegee round: "+round),
    "Total new booking price: "+verifiedTotal,
    "",
    "MANUAL ACTION REQUIRED IN SQUEEGEE",
    ...actionLines.map((action,i)=>(i+1)+". "+action),
    "The job price has ALREADY been set for the full booked quantity ("+
      verifiedTotal+"). Do NOT multiply the price again.",
    "The physical bin quantity is also recorded in the new job's notes.",
    "If merging with an older same-colour job, preserve its existing bin "+
      "count and add the new purchased bins; check the combined price.",
    ...dup.map(code=>"Possible duplicate detail: "+FLAG_LABELS[code]),
    "Do not create another Squeegee customer or website booking.",
    "Read-only booking status: "+refUrl,
    "",
    "ORIGINAL ACCEPTED BOOKING",
    receipt.text,
  ].filter(Boolean).join("\n");
  const row=(label,value)=>value?
    '<tr><td style="font-size:13px;color:#596176;padding:8px 12px 8px 0;vertical-align:top;width:39%">'+
      emailHtmlEscape(label)+'</td><td style="font-size:14px;color:#16191e;padding:8px 0;font-weight:600;vertical-align:top;overflow-wrap:anywhere">'+
      emailHtmlEscape(value)+'</td></tr>':"";
  const actionHtml=actionLines.map(action=>
    '<tr><td style="padding:11px 13px;border-bottom:1px solid #e4e6e9;font-weight:700;font-size:15px;color:#0d1421">'+
      emailHtmlEscape(action)+'</td></tr>').join("");
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
    '<body style="margin:0;background:#090909;font-family:Arial,Helvetica,sans-serif">'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#090909"><tr><td align="center" style="padding:24px 12px">'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:650px;background:#fff;border-collapse:collapse">'+
    '<tr><td style="background:#080808;color:#fff;text-align:center;padding:28px 22px">'+
    '<div style="font-size:27px;font-weight:900;letter-spacing:1px">NI BIN GUY</div>'+
    '<div style="font-size:12px;color:#ffdd42;letter-spacing:2px;margin-top:8px">AUTOMATIC BOOKING REVIEW</div></td></tr>'+
    '<tr><td style="height:7px;background:#ffdc3f"></td></tr>'+
    '<tr><td style="padding:25px 23px 10px">'+
    '<div style="font-size:12px;font-weight:800;color:#805d03;letter-spacing:1px">CUSTOMER AND JOB CREATED IN SQUEEGEE</div>'+
    '<h1 style="font-size:25px;color:#0a0a0a;margin:9px 0 11px">Account Needs Attention</h1>'+
    '<p style="font-size:15px;color:#333;line-height:1.6;margin:0">'+
      'The customer and new job have been created, but Squeegee needs a manual service quantity adjustment.</p></td></tr>'+
    '<tr><td style="padding:9px 23px 15px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #e4e6e9;border-bottom:1px solid #e4e6e9">'+
    row("Booking reference",bookingId)+row("Customer",name)+row("Service address",address)+
    row("Email",customerEmail)+row("Phone",phone)+
    row("Physical bins",requested.join(" + "))+row("First clean",dates.join(", "))+
    row("Round",rounds.join(", "))+row("Website booking total",verifiedTotal)+
    '</table></td></tr>'+
    '<tr><td style="padding:10px 23px 18px">'+
    '<h2 style="font-size:18px;margin:0 0 13px;color:#111">Change these service quantities in Squeegee</h2>'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7da;border:2px solid #ffdc3f">'+
    actionHtml+'</table>'+
    '<p style="font-size:14px;line-height:1.6;color:#262626;margin:15px 0 6px">'+
    '<strong>Price is already set:</strong> '+emailHtmlEscape(verifiedTotal)+
    ' for the entire new booking. Do not multiply the price again.</p>'+
    '<p style="font-size:13px;line-height:1.6;color:#555;margin:0 0 12px">'+
    'Squeegee job notes contain the actual physical bin quantities. '+
    'If merging an older same-colour job, preserve its existing bins and check the combined price.</p>'+
    '<a href="'+emailHtmlEscape(refUrl)+'" style="display:block;background:#111;color:#ffdc3f;text-align:center;font-size:14px;font-weight:800;text-decoration:none;padding:15px">'+
    'VIEW BOOKING STATUS (READ ONLY)</a></td></tr>'+
    (dup.length?
      '<tr><td style="padding:0 23px 15px;font-size:12px;color:#5b4c31">'+
      emailHtmlEscape(dup.map(x=>FLAG_LABELS[x]).join("; "))+'</td></tr>':"")+
    '<tr><td style="padding:5px 23px 28px">'+
    '<h2 style="font-size:15px;color:#171717">Original accepted booking details</h2>'+
    '<div style="font-size:13px;color:#333;line-height:1.5">'+receipt.html+'</div>'+
    '</td></tr><tr><td style="background:#f1f1f1;font-size:12px;color:#666;padding:18px 23px">'+
    'Preview 1 only · Manual quantity change required · No automatic job retry'+
    '</td></tr></table></td></tr></table></body></html>';
  return {...receipt,subject,text,html};
}

async function notifyOwnerOfCompletedBooking(bookingId,receipt,{
  env=process.env,send=null,attachments=undefined,attention=null,
}={}) {
  if(!BOOKING_RE.test(String(bookingId||"")))
    return {sent:false,reason:"invalid_completed_booking_ref"};
  // Require the same signed receipt structure checked by the internal
  // accepted-event transport, not a browser-supplied email destination.
  const {normalOwnerReceipt}=require("./squeegeePreviewAutoDispatch");
  const safe=normalOwnerReceipt(receipt);
  if(!safe)return {sent:false,reason:"missing_completed_owner_receipt"};
  const selected=attention?.quantityAttentionRequired===true?
    completedQuantityAttentionContent(bookingId,safe,attention):safe;
  if(!selected)return {sent:false,reason:"invalid_quantity_attention_details"};
  return deliverOwnerEmail({
    ...selected,
    attachments:Array.isArray(attachments)?attachments:undefined,
  },{env,send});
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
    if(typeof email.replyTo==="string" && email.replyTo.includes("@"))
      message.replyTo=email.replyTo;
    if(Array.isArray(email.attachments) && email.attachments.length)
      message.attachments=email.attachments;
    const result=await deliver(message);
    if(result?.error)return {sent:false,reason:"owner_alert_provider_error"};
    return {sent:true};
  }catch {
    return {sent:false,reason:"owner_alert_delivery_failed"};
  }
}

module.exports={emailContent,inactiveSignupEmailContent,genericReviewContent,
  notifyOwnerOfSyncHold,
  resolveOwnerEmailSettings,
  duplicateSignalsEmailContent,notifyOwnerOfDuplicateSignals,
  quantityBookedEmailContent,notifyOwnerOfQuantityBooking,
  notifyOwnerOfCompletedBooking,completedQuantityAttentionContent,
  allowedFlags,duplicateFlagLabels};
