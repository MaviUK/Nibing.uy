"use strict";
// Immutable, owner-authorised recovery of ONE accepted booking held before
// any Squeegee write. Do not permit recovery of ambiguous post-write cases.
const {verifyAndPriceBooking}=require("./squeegeeBookingPricing");
const {validateBookingSubmission}=require("./bookingSubmissionGuard");
const {addressKey,normalName}=require("./squeegeeCustomerMatcher");
const {validUpcomingDate}=require("./squeegeeAutomaticBooking");

const BOOKING_ID="NBG-MVWV3A59-2BD66130D3";
const ACCEPTED_DAY="2026-10-31";
const CLEAN_DATE="2026-11-10";
const EXPECTED_PRICE=15;
const PATH="/api/squeegee-preview-held-groomsport-recovery";
const RECOVERY_CLAIM="claim-v1/owner-held-bookings/"+BOOKING_ID;
const REASON="customer_match_ambiguous_or_incomplete";

function heldBeforeAnyWrite(status, originalClaim, recoveryClaim) {
  return status?.bookingId===BOOKING_ID &&
    status.stage==="held_for_review" &&
    status.reason===REASON &&
    status.matchReason==="possible_existing_address" &&
    (status.jobsConfirmed===null ||
      status.jobsConfirmed===undefined || status.jobsConfirmed===0) &&
    (originalClaim===null || originalClaim===undefined) &&
    (recoveryClaim===null || recoveryClaim===undefined);
}
function acceptedAudit(audit) {
  if(audit?.bookingId!==BOOKING_ID ||
     audit.channel!=="email" ||
     typeof audit.createdAt!=="string" ||
     !audit.createdAt.startsWith(ACCEPTED_DAY+"T") ||
     !Number.isFinite(Date.parse(audit.createdAt)) ||
     audit.termsAccepted!==true ||
     normalName(audit.name)!=="GAVIN" ||
     addressKey(audit.address)!==
       addressKey("78 Groomsport Road, Bangor BT20 5NF") ||
     !Array.isArray(audit.bins) || audit.bins.length!==1 ||
     audit.bins[0]?.type!=="Blue Bin" ||
     audit.bins[0]?.count!==1 ||
     !["domestic_oneoff","comm_lt360_oneoff"].includes(audit.bins[0]?.planId) ||
     (audit.bins[0]?.sizeLitres!==undefined &&
      audit.bins[0]?.sizeLitres!==null && audit.bins[0]?.sizeLitres!=="") ||
     Number(audit.pricing?.total)!==EXPECTED_PRICE ||
     !Array.isArray(audit.bookingScheduleSnapshot?.results) ||
     audit.bookingScheduleSnapshot.results.length!==1 ||
     audit.bookingScheduleSnapshot.results[0]?.assignedCleanDate!==CLEAN_DATE ||
     !audit.email || !audit.phone) {
    return {ok:false,reason:"original_accepted_booking_not_verified"};
  }
  const original={
    bookingId:audit.bookingId,
    submittedAt:audit.createdAt,
    name:audit.name,email:audit.email,phone:audit.phone,
    address:audit.address,
    bins:audit.bins,pricing:audit.pricing,
    bookingScheduleSnapshot:audit.bookingScheduleSnapshot,
    discountCode:audit.discountCode||"",
    placeId:audit.placeId,lat:audit.lat,lng:audit.lng,
    termsAccepted:true,termsVersion:audit.termsVersion,
    termsTimestamp:audit.termsTimestamp,
    termsAcceptanceText:audit.termsAcceptanceText,
    source:audit.source||"website",
  };
  if(!validateBookingSubmission(original,{
    now:Date.parse(original.submittedAt),
  }).ok)
    return {ok:false,reason:"original_submission_invalid"};
  const price=verifyAndPriceBooking(original.bins,original.discountCode,
    original.pricing,{now:Date.parse(original.submittedAt)});
  if(!price.ok || price.canonical.total!==EXPECTED_PRICE)
    return {ok:false,reason:"original_price_not_verified"};
  return {ok:true,booking:original};
}
function existingCustomerMatches(record,booking) {
  if(!record || normalName(record.name)!==normalName(booking.name) ||
     addressKey(record.address)!==addressKey(booking.address))return false;
  return !["inactive","deactivated","deleted","archived","cancelled","canceled"]
    .includes(String(record.status||"").toLowerCase());
}
// A previous manual job for this same date and Blue one-off service must
// never be imported again, even if Squeegee has not saved its booking ref.
function existingJobsSafe(jobs,serviceId) {
  if(!Array.isArray(jobs) || !jobs.length && jobs!==undefined)return Array.isArray(jobs);
  for(const job of jobs) {
    if(!job || !Array.isArray(job.services))return false;
    const info=[
      job.notes,job.description,job.reference,job.referenceNumber,
    ].filter(x=>typeof x==="string").join(" ").toUpperCase();
    if(info.includes(BOOKING_ID))return false;
    const date=job.date || job.firstAppointment?.initialDate ||
      job.firstAppointment?.date || job.startDate;
    if(date===CLEAN_DATE &&
       job.services.some(s=>{
         const id=typeof s==="string"?s:(s?._id||s?.id);
         return id===serviceId;
       }))return false;
  }
  return true;
}
function validPreparedPlan(prepared,now=Date.now()) {
  if(prepared?.status!=="prepared_read_only" ||
     prepared.summary?.blockedReasons?.length ||
     prepared.privatePlan?.readyJobs!==1 ||
     prepared.privatePlan?.blockedJobs!==0 ||
     prepared.privatePlan?.jobs?.length!==1)return false;
  const job=prepared.privatePlan.jobs[0];
  return job?.status==="ready" &&
    job.date===CLEAN_DATE &&
    validUpcomingDate(CLEAN_DATE,now) &&
    job.input?.frequencyType==="adhoc" &&
    Number(job.input?.price)===EXPECTED_PRICE &&
    Array.isArray(job.input.services) &&
    job.input.services.length===1 &&
    typeof job.input.services[0]==="string" &&
    typeof job.input.jobGroup==="string";
}
module.exports={
  BOOKING_ID,ACCEPTED_DAY,CLEAN_DATE,EXPECTED_PRICE,PATH,RECOVERY_CLAIM,
  heldBeforeAnyWrite,acceptedAudit,existingCustomerMatches,
  existingJobsSafe,validPreparedPlan,
};
