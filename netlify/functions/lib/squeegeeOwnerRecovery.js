"use strict";

const crypto=require("node:crypto");
const {validateBookingSubmission}=require("./bookingSubmissionGuard");

const TARGET_BOOKING_ID="NBG-P7KVB3NA";
const ORIGINAL_BOOKING_DATE="2026-10-31";
const EXPECTED_TOTAL=120;
const EXPECTED_BIN_LINES=6;
const ORIGINAL_REQUIRED_STAGE="requires_reconciliation";
const ORIGINAL_REQUIRED_REASON="partial_or_ambiguous_squeegee_write";

function recoveryClaimKey(bookingId=TARGET_BOOKING_ID) {
  if(bookingId!==TARGET_BOOKING_ID)
    throw new Error("Recovery is restricted to the approved original booking");
  const suffix=crypto.createHash("sha256")
    .update("nibinguy-owner-recovery-v1/"+bookingId)
    .digest("hex").slice(0,8).toUpperCase();
  return "claim-v1/auto-bookings/NBG-OWNERREC-"+suffix;
}
function originalStatusSafe(status){
  return status?.bookingId===TARGET_BOOKING_ID &&
    status.stage===ORIGINAL_REQUIRED_STAGE &&
    status.reason===ORIGINAL_REQUIRED_REASON &&
    status.jobsConfirmed===0;
}
function acceptedAuditPayload(audit){
  if(!audit || audit.bookingId!==TARGET_BOOKING_ID ||
     audit.channel!=="email" ||
     typeof audit.createdAt!=="string" ||
     !audit.createdAt.startsWith(ORIGINAL_BOOKING_DATE+"T") ||
     !Number.isFinite(Date.parse(audit.createdAt)) ||
     audit.termsAccepted!==true ||
     !Array.isArray(audit.bins) ||
     audit.bins.length!==EXPECTED_BIN_LINES ||
     Number(audit.pricing?.total)!==EXPECTED_TOTAL ||
     typeof audit.name!=="string" || !audit.name.trim() ||
     typeof audit.email!=="string" || !audit.email.includes("@") ||
     typeof audit.phone!=="string" || !audit.phone.trim() ||
     typeof audit.address!=="string" || !audit.address.trim() ||
     !audit.bookingScheduleSnapshot ||
     !Array.isArray(audit.bookingScheduleSnapshot.results)) {
    return {ok:false,reason:"original_audit_unavailable_or_invalid"};
  }
  const source= {
    bookingId:audit.bookingId,
    submittedAt:audit.createdAt,
    name:audit.name,email:audit.email,phone:audit.phone,
    address:audit.address,
    bins:audit.bins,
    pricing:audit.pricing,
    bookingScheduleSnapshot:audit.bookingScheduleSnapshot,
    discountCode:audit.discountCode||"",
    termsAccepted:true,
    termsTimestamp:audit.termsTimestamp,
    termsVersion:audit.termsVersion,
    placeId:audit.placeId,
    lat:audit.lat,lng:audit.lng,
    source:audit.source||"website",
  };
  // This is an earlier signed/accepted, audited submission. Its timestamp
  // must be the original audit timestamp; a new timestamp is never forged.
  const original=validateBookingSubmission(source,{now:Date.parse(audit.createdAt)});
  if(!original.ok)return {ok:false,reason:"original_audit_not_a_valid_submission"};
  return {ok:true,payload:source};
}

function safeAmounts(groups,expectedTotal=EXPECTED_TOTAL){
  if(!Array.isArray(groups)||!groups.length||groups.length>12)
    return {ok:false,reason:"invalid_job_groups"};
  const value=groups.reduce((sum,group)=>
    sum+Math.round(Number(group?.input?.price)*100),0);
  if(!Number.isSafeInteger(value)||value!==Math.round(expectedTotal*100))
    return {ok:false,reason:"grouped_price_mismatch"};
  if(groups.some(group=>
    !Array.isArray(group.members)||!group.members.length ||
    !Array.isArray(group.input?.services)||!group.input.services.length ||
    typeof group.input.date!=="string"||
    !/^\d{4}-\d{2}-\d{2}$/.test(group.input.date) ||
    !["weeks","adhoc"].includes(group.input.frequencyType)))
    return {ok:false,reason:"job_groups_incomplete"};
  return {ok:true};
}

module.exports={
 TARGET_BOOKING_ID,ORIGINAL_BOOKING_DATE,EXPECTED_TOTAL,
 EXPECTED_BIN_LINES,originalStatusSafe,
 acceptedAuditPayload,recoveryClaimKey,safeAmounts,
};
