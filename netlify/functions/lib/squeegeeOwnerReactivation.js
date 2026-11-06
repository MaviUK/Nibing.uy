"use strict";
// Preview #77: ONE owner-confirmed resume of an original accepted booking
// held before any Squeegee write because its existing account was inactive.
const {validateBookingSubmission}=require("./bookingSubmissionGuard");
const {verifyAndPriceBooking}=require("./squeegeeBookingPricing");
const {addressKey,normalName,normalEmail,normalPhone}=require("./squeegeeCustomerMatcher");
const {validUpcomingDate}=require("./squeegeeAutomaticBooking");
const {groupedSqueegeeJobs}=require("./squeegeeJobGrouping");
const ID_RE=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;
const PATH="/api/squeegee-preview-owner-reactivation";
const HOLD_REASON="existing_customer_reactivation_required";
const MAX_LINES=12;
function validId(value){return ID_RE.test(String(value||""));}
function validDay(value,now=Date.now()){
  if(!DAY_RE.test(String(value||"")))return false;
  const ms=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0,10)===value &&
    ms<=now+2*86400000 && ms>=now-366*86400000;
}
function recoveryKey(id){
  if(!validId(id))throw new Error("invalid_booking_reference");
  return "claim-v1/owner-reactivations/"+id;
}
function safeHeld(status,oldClaim,recoveryClaim,id){
  return validId(id) && status?.bookingId===id &&
    status.stage==="held_for_review" &&
    status.reason===HOLD_REASON &&
    status.matchReason==="inactive_exact_customer" &&
    (status.jobsConfirmed===undefined ||
     status.jobsConfirmed===null || status.jobsConfirmed===0) &&
    (oldClaim===undefined||oldClaim===null) &&
    (recoveryClaim===undefined||recoveryClaim===null);
}
function auditedBooking(audit,id,day){
  if(!safeAuditShape(audit,id,day))
    return {ok:false,reason:"original_accepted_audit_not_verified"};
  const original={
    bookingId:audit.bookingId,
    submittedAt:audit.createdAt,
    name:audit.name,email:audit.email,phone:audit.phone,
    address:audit.address,bins:audit.bins,pricing:audit.pricing,
    discountCode:audit.discountCode||"",
    bookingScheduleSnapshot:audit.bookingScheduleSnapshot,
    termsAccepted:true,termsVersion:audit.termsVersion,
    termsTimestamp:audit.termsTimestamp,
    termsAcceptanceText:audit.termsAcceptanceText,
    placeId:audit.placeId,lat:audit.lat,lng:audit.lng,
    source:audit.source||"website",
  };
  if(!validateBookingSubmission(original,{
    now:Date.parse(audit.createdAt),
  }).ok)return {ok:false,reason:"original_submission_invalid"};
  const verified=verifyAndPriceBooking(original.bins,original.discountCode,
    original.pricing,{now:Date.parse(audit.createdAt)});
  if(!verified.ok || Number(verified.canonical?.total)!==Number(original.pricing.total))
    return {ok:false,reason:"original_price_unverified"};
  return {ok:true,booking:original};
}
function safeAuditShape(a,id,day){
  return a?.bookingId===id &&
    a?.channel==="email" &&
    a?.termsAccepted===true &&
    typeof a.createdAt==="string" &&
    Number.isFinite(Date.parse(a.createdAt)) &&
    (a.createdAt.slice(0,10)===day ||
      a.createdAt.slice(0,10)===nextDay(day)) &&
    typeof a.name==="string" && a.name.trim().length>1 &&
    typeof a.email==="string" && a.email.includes("@") &&
    typeof a.phone==="string" && a.phone.trim().length>6 &&
    typeof a.address==="string" && a.address.trim().length>6 &&
    Array.isArray(a.bins) && a.bins.length>0 &&
    a.bins.length<=MAX_LINES &&
    a.pricing && Number.isFinite(Number(a.pricing.total)) &&
    Array.isArray(a.bookingScheduleSnapshot?.results) &&
    a.bookingScheduleSnapshot.results.length===a.bins.length;
}
function nextDay(day) {
  const n=Date.parse(day+"T00:00:00Z");
  return Number.isFinite(n)?
    new Date(n+86400000).toISOString().slice(0,10):"";
}
function exactActiveCustomer(record,booking){
  const state=String(record?.status||"").trim().toLowerCase();
  if(state!=="active" ||
     !addressKey(record?.address) ||
     addressKey(record.address)!==addressKey(booking.address))return false;
  const byName=normalName(record.name) &&
    normalName(record.name)===normalName(booking.name);
  const sameEmail=normalEmail(booking.email) &&
    normalEmail(record.email)===normalEmail(booking.email);
  const phone=normalPhone(booking.phone);
  const samePhone=phone.length>=10 &&
    [record.phoneNumber,record.phoneNumberOther]
      .some(v=>normalPhone(v)===phone);
  return Boolean(byName || (sameEmail && samePhone));
}
function preparedJobs(prepared,booking,now=Date.now()){
  if(prepared?.status!=="prepared_read_only" ||
     prepared.summary?.blockedReasons?.length ||
     !prepared.summary?.datesVerified ||
     !prepared.summary?.pricingVerified ||
     prepared.privatePlan?.blockedJobs!==0 ||
     prepared.privatePlan?.readyJobs!==booking.bins.length ||
     prepared.privatePlan?.jobs?.length!==booking.bins.length)return null;
  const jobs=prepared.privatePlan.jobs;
  if(jobs.some(j=>j.status!=="ready" || !validUpcomingDate(j.date,now) ||
    !j.input?.jobGroup || !Array.isArray(j.input.services) ||
    !j.input.services.length))return null;
  let grouped;
  try{grouped=groupedSqueegeeJobs(jobs,booking.bookingId);}
  catch{return null;}
  const inPence=Math.round(Number(booking.pricing.total)*100);
  const sum=grouped.reduce((n,j)=>n+Math.round(Number(j.input.price)*100),0);
  if(!Number.isSafeInteger(inPence)||inPence!==sum ||
     grouped.length<1||grouped.length>MAX_LINES)return null;
  return grouped;
}
// Once THIS owner-confirmed request receives a successful POST for a job,
// that verified group may appear in subsequent Squeegee GETs. Treat it as
// already completed in THIS request, not a duplicate of the remaining job.
// This is never used to replay an earlier uncertain claim.
function acceptedGroupMatchesJob(old,group){
  const ids=old?.services?.map(s=>typeof s==="string"?s:s?._id||s?.id);
  const wanted=group?.input?.services;
  const rawDate=old?.date||old?.startDate||old?.firstAppointment?.date||
    old?.firstAppointment?.initialDate||old?.appointments?.[0]?.date;
  const date=typeof rawDate==="string"?rawDate.slice(0,10):"";
  if(!Array.isArray(ids)||!Array.isArray(wanted)||ids.length!==wanted.length ||
     !date || date!==group.input.date ||
     ids.some(s=>typeof s!=="string") ||
     [...ids].sort().join("|")!==[...wanted].sort().join("|"))return false;
  if(old.price!==undefined && old.price!==null &&
     (typeof old.price!=="number" ||
      Math.abs(old.price-group.input.price)>0.001))return false;
  return true;
}
function existingJobRisk(customerJobs,grouped,id,{acceptedGroups=[]}={}){
  if(!Array.isArray(customerJobs))return "cannot_verify_existing_jobs";
  const acceptedCounts=new Map();
  for(const old of customerJobs) {
    if(!old || !Array.isArray(old.services))return "cannot_verify_existing_jobs";
    const prior=acceptedGroups.find(group=>acceptedGroupMatchesJob(old,group));
    if(prior){
      const count=(acceptedCounts.get(prior)||0)+1;
      acceptedCounts.set(prior,count);
      if(count>1)return "repeated_accepted_group_in_customer";
      continue;
    }
    const parts=[old.notes,old.description,old.reference,old.referenceNumber]
      .filter(v=>typeof v==="string").join(" ").toUpperCase();
    if(parts.includes(id.toUpperCase()))return "original_booking_already_in_jobs";
    const oldIds=old.services.map(s=>typeof s==="string"?s:s?._id||s?.id)
      .filter(x=>typeof x==="string");
    for(const next of grouped){
      if(!next.input.services.some(s=>oldIds.includes(s)))continue;
      const first=old.date||old.startDate||old.firstAppointment?.date||
        old.firstAppointment?.initialDate||old.appointments?.[0]?.date;
      const date=typeof first==="string"?first.slice(0,10):"";
      if(!date)return "matching_service_without_verifiable_date";
      if(date===next.input.date)return "matching_date_and_service_already_exists";
    }
  }
  return null;
}
module.exports={
  ID_RE,PATH,HOLD_REASON,validId,validDay,recoveryKey,safeHeld,
  auditedBooking,exactActiveCustomer,preparedJobs,existingJobRisk,
};
