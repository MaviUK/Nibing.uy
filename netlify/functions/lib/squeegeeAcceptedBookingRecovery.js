"use strict";

// Owner-only recovery of one previously accepted Preview 1 booking.
// Never accepts browser-supplied customer details or sends another booking
// email/leaderboard claim. This module performs GET-only preflight checks;
// the actual writer keeps its original permanent three-key one-use claims.
const {findAcceptedAudit}=require("./squeegeeOneBookingReconcile");
const {matchCustomersAcrossPages}=require("./squeegeeCustomerMatcher");
const {prepareReadOnlyBooking}=require("./squeegeeBookingPreparation");
const {fetchAuthoritativeSchedule}=require("./squeegeeBookingStage");
const {isEligibleOneBooking,GLOBAL_TEST_KEY}=require("./squeegeeOneBookingTest");
const api=require("./squeegeeApiV3");

const RECOVERY_BOOKING_ID="NBG-MVV4NNRF-8BAE3806EA";
const EARLIEST_ACCEPTED=Date.parse("2026-10-30T15:27:00Z");
const LATEST_ACCEPTED=Date.parse("2026-10-30T15:31:00Z");

async function originalAcceptedBooking(bookingId,auditStore,now=Date.now()) {
  if(bookingId!==RECOVERY_BOOKING_ID)return {reason:"not_approved_original_booking"};
  const audit=await findAcceptedAudit(bookingId,auditStore);
  if(audit.status!=="found")return {reason:"accepted_booking_"+audit.status};
  const originalTime=Date.parse(audit.record.createdAt);
  if(!Number.isFinite(originalTime) ||
     originalTime<EARLIEST_ACCEPTED || originalTime>LATEST_ACCEPTED) {
    return {reason:"accepted_booking_window_unverified"};
  }
  // The original booking exists as a SERVER-SAVED acceptance audit. The
  // normal 15-minute submission age check has expired, so the original
  // accepted fields are revalidated with a fresh SERVER timestamp. This is
  // NOT a new website submission; only the signed owner may reach this flow.
  const booking={...audit.record,submittedAt:new Date(now).toISOString()};
  const eligible=isEligibleOneBooking(booking);
  if(!eligible.eligible)return {reason:"accepted_booking_"+eligible.reason};
  if(booking.bookingId!==RECOVERY_BOOKING_ID)
    return {reason:"accepted_booking_reference_mismatch"};
  return {reason:null,booking};
}

function withinUpcomingWindow(date,now) {
  if(typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/London",day:"2-digit",month:"2-digit",year:"numeric",
  }).formatToParts(new Date(now));
  const fields=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const today=fields.year+"-"+fields.month+"-"+fields.day;
  const delta=Date.parse(date+"T12:00:00Z")-Date.parse(today+"T12:00:00Z");
  return date>=today && Number.isFinite(delta) && delta<=45*86400000;
}

// Everything in this result is safe to render on the authenticated page
// except booking, which stays internal to the Function and worker only.
async function inspectAcceptedBooking(bookingId,{
  auditStore,statusStore,claimsStore,getSchedule=fetchAuthoritativeSchedule,
  getServices=api.getServices,getJobGroups=api.getJobGroups,
  listCustomers=api.listCustomers,
  now=Date.now(),
}={}) {
  const rejected=(reason)=>({ready:false,reason,bookingId:RECOVERY_BOOKING_ID});
  if(!auditStore || !statusStore || !claimsStore)
    return rejected("private_storage_unavailable");
  const archived=await originalAcceptedBooking(bookingId,auditStore,now);
  if(archived.reason)return rejected(archived.reason);
  let prior,claimed;
  try {
    [prior,claimed]=await Promise.all([
      statusStore.get(bookingId,{type:"json",consistency:"strong"}),
      claimsStore.get(GLOBAL_TEST_KEY,{type:"json",consistency:"strong"}),
    ]);
  }catch{return rejected("could_not_verify_one_use_reservations");}
  if(prior || claimed)return rejected("existing_or_uncertain_test_reservation");
  const booking=archived.booking;

  const results=await Promise.allSettled([
    getSchedule(booking),getServices(),getJobGroups(),
  ]);
  if(results.some(x=>x.status!=="fulfilled" || !x.value))
    return rejected("could_not_recheck_schedule_services_or_rounds");

  let prepared;
  try {
    prepared=prepareReadOnlyBooking(
      booking,results[0].value,results[1].value,
      {jobGroups:results[2].value},
    );
  }catch{return rejected("cannot_prepare_original_booking");}
  const {summary,privatePlan}=prepared;
  if(prepared.status!=="prepared_read_only" ||
     summary.blockedReasons.length!==0 || summary.jobs.length!==1 ||
     !summary.datesVerified || !summary.pricingVerified ||
     !privatePlan || privatePlan.readyJobs!==1 ||
     privatePlan.blockedJobs!==0 || privatePlan.jobs.length!==1 ||
     privatePlan.jobs[0].status!=="ready" ||
     !privatePlan.jobs[0].input?.jobGroup) {
    // These are invariant, non-personal validation codes.
    return { ...rejected("date_price_round_or_service_not_verified"),
      blockedReasons:summary.blockedReasons.slice(0,7),
      heldDates:summary.heldDates.map(x=>x.reason).slice(0,3),
    };
  }
  const job=privatePlan.jobs[0],line=summary.jobs[0];
  if(!withinUpcomingWindow(job.date,now))return rejected("first_date_outside_45_day_window");
  if(job.input.date!==job.date ||
     job.input.firstAppointment?.initialDate!==job.date ||
     job.input.frequencyType!=="weeks" ||
     job.input.frequencyInterval!==4 || job.input.price!==5 ||
     line.roundStatus!=="mapped" ||
     !Number.isInteger(line.roundNumber) ||
     line.roundNumber<1 || line.roundNumber>20) {
    return rejected("job_date_round_price_or_recurrence_mismatch");
  }

  let matched;
  try {
    matched=await matchCustomersAcrossPages(
      booking,args=>listCustomers(args),{maxPages:100},
    );
  }catch{return rejected("squeegee_customer_scan_unavailable");}
  if(matched.status!=="not_found")
    return rejected("squeegee_customer_exists_or_needs_review");

  return {
    ready:true,reason:null,bookingId,booking,
    firstClean:job.date,round:line.roundNumber,
    plan:"domestic_4w",price:5,frequency:"every_4_weeks",
    pagesScanned:matched.pagesScanned,
  };
}

module.exports={
  RECOVERY_BOOKING_ID,originalAcceptedBooking,withinUpcomingWindow,
  inspectAcceptedBooking,
};