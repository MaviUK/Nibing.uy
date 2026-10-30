"use strict";

/**
 * PREVIEW 1 only. Read-only recovery preflight for one accepted email booking
 * excluded by the initial one-bin pilot. Reuses the existing acceptance audit
 * rather than resending customer emails or awarding any second XP.
 *
 * Does not call Squeegee POST or edit claims. Browser never supplies customer
 * PII or a new booking body. Exact booking ID, server-created time window,
 * name, both bin lines, signed owner session and one-use CAS are mandatory.
 */
const rollout=require("./squeegeePreviewAutoRollout");
const auto=require("./squeegeeAutomaticBooking");
const api=require("./squeegeeApiV3");
const {prepareReadOnlyBooking}=require("./squeegeeBookingPreparation");
const {fetchAuthoritativeSchedule}=require("./squeegeeBookingStage");
const {matchCustomersAcrossPages}=require("./squeegeeCustomerMatcher");
const {customerKey,jobKey}=require("./squeegeeIdempotencyClaims");
const {verifyAndPriceBooking}=require("./squeegeeBookingPricing");

const TARGET=rollout.PILOT_BOOKING_ID;
const AUDIT_PREFIXES=Object.freeze([
  "2026-10-30T17:37","2026-10-30T17:38","2026-10-30T17:39",
]);
const FIRST_ACCEPTED_MS=Date.parse("2026-10-30T17:37:30Z");
const LAST_ACCEPTED_MS=Date.parse("2026-10-30T17:40:00Z");
const MAX_AUDIT_ROWS=150;
function stopped(reason,extra={}) {
  return {ready:false,reason,bookingId:TARGET,...extra};
}
async function acceptedPilotAudit(bookingId,auditStore) {
  if(bookingId!==TARGET)return {status:"not_approved_booking"};
  if(!auditStore || typeof auditStore.list!=="function" ||
      typeof auditStore.get!=="function")return {status:"audit_storage_unavailable"};
  try {
    let inspected=0;
    const found=[];
    for(const prefix of AUDIT_PREFIXES) {
      const pages=await auditStore.list({prefix});
      if(!Array.isArray(pages?.blobs))return {status:"audit_list_unavailable"};
      for(const item of pages.blobs) {
        if(typeof item.key!=="string"||!item.key.startsWith(prefix))continue;
        if(++inspected>MAX_AUDIT_ROWS)return {status:"audit_scan_limit_reached"};
        const record=await auditStore.get(item.key,{type:"json",consistency:"strong"});
        if(record?.bookingId===bookingId)found.push(record);
      }
    }
    if(!found.length)return {status:"accepted_audit_not_found"};
    if(found.length!==1)return {status:"duplicate_accepted_audit"};
    const record=found[0];
    const createdAt=Date.parse(record.createdAt);
    if(record.channel!=="email" ||
       !Number.isFinite(createdAt) ||
       createdAt<FIRST_ACCEPTED_MS || createdAt>LAST_ACCEPTED_MS ||
       !rollout.isPilotBooking(record,"email") ||
       typeof record.address!=="string" ||
       typeof record.email!=="string" || !record.email.trim() ||
       typeof record.phone!=="string" || !record.phone.trim() ||
       !Array.isArray(record.bookingScheduleSnapshot?.results) ||
       record.bookingScheduleSnapshot.results.length!==2 ||
       verifyAndPriceBooking(record.bins,record.discountCode,
         record.pricing).ok!==true ||
       Number(record.pricing.total)!==10) {
      return {status:"accepted_audit_failed_validation"};
    }
    return {status:"found",record};
  } catch {
    return {status:"audit_storage_unavailable"};
  }
}
function withinDateWindow(date,now) {
  if(typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/London",day:"2-digit",month:"2-digit",year:"numeric",
  }).formatToParts(new Date(now));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const today=p.year+"-"+p.month+"-"+p.day;
  const days=(Date.parse(date+"T12:00:00Z")-Date.parse(today+"T12:00:00Z"))/86400000;
  return Number.isInteger(days)&&days>=0&&days<=60;
}
async function inspectAcceptedPilot(bookingId,{
  auditStore,statusStore,claimsStore,
  getSchedule=fetchAuthoritativeSchedule,
  getServices=api.getServices,
  getJobGroups=api.getJobGroups,
  listCustomers=api.listCustomers,
  now=Date.now(),
}={}) {
  if(!auditStore||!statusStore||!claimsStore)
    return stopped("private_storage_unavailable");
  const original=await acceptedPilotAudit(bookingId,auditStore);
  if(original.status!=="found")return stopped(original.status);
  // The original client request was accepted at 17:38 on Oct 30. The fresh
  // timestamp is minted SERVER-SIDE here so the usual 15-minute submission
  // check can be re-applied without asking the customer to book again.
  const booking={...original.record,submittedAt:new Date(now).toISOString()};
  if(!rollout.isPilotBooking(booking,"email"))
    return stopped("booking_changed_since_acceptance");

  let existingStatus,globalClaim,bookingClaim,propertyClaim;
  try {
    [existingStatus,globalClaim,bookingClaim,propertyClaim]=await Promise.all([
      statusStore.get(bookingId,{type:"json",consistency:"strong"}),
      claimsStore.get(rollout.PILOT_CLAIM_KEY,{type:"json",consistency:"strong"}),
      claimsStore.get(auto.BOOKING_CLAIM_PREFIX+bookingId,
        {type:"json",consistency:"strong"}),
      claimsStore.get(customerKey(booking),{type:"json",consistency:"strong"}),
    ]);
  }catch{return stopped("reservation_status_unavailable");}
  if(existingStatus||globalClaim||bookingClaim||propertyClaim)
    return stopped("previous_or_uncertain_squeegee_reservation");

  const reqs=await Promise.allSettled([
    getSchedule(booking),getServices(),getJobGroups(),
  ]);
  if(reqs.some(x=>x.status!=="fulfilled"||!x.value))
    return stopped("schedule_or_catalog_unavailable");
  let prepared;
  try {
    prepared=prepareReadOnlyBooking(booking,reqs[0].value,
      reqs[1].value,{jobGroups:reqs[2].value});
  }catch{return stopped("cannot_validate_booking_dates_rounds_or_prices");}
  const {summary,privatePlan:plan}=prepared;
  if(prepared.status!=="prepared_read_only" ||
     !summary.datesVerified||!summary.pricingVerified||
     summary.blockedReasons.length!==0 ||
     !plan||plan.blockedJobs!==0||plan.readyJobs!==2||plan.jobs.length!==2||
     summary.jobs.length!==2) {
    return stopped("date_price_service_or_round_needs_review",{
      checks:summary?.blockedReasons?.slice(0,8)||[],
    });
  }
  const checked=[];
  for(let i=0;i<2;i++){
    const bin=booking.bins[i],job=plan.jobs[i],line=summary.jobs[i];
    if(job.status!=="ready" || !withinDateWindow(job.date,now) ||
       job.input?.date!==job.date ||
       job.input?.firstAppointment?.initialDate!==job.date ||
       job.input?.frequencyType!=="weeks" ||
       job.input?.frequencyInterval!==4 ||
       job.input?.price!==5 ||
       line.roundStatus!=="mapped" ||
       !Number.isInteger(line.roundNumber) ||
       line.roundNumber<1 || line.roundNumber>20 ||
       typeof job.input.jobGroup!=="string") {
      return stopped("job_date_round_price_or_frequency_not_verified");
    }
    checked.push({
      bin:bin.type,date:job.date,
      round:line.roundNumber,price:job.input.price,
      frequency:"every_4_weeks",
    });
    try {
      const claim=await claimsStore.get(jobKey(booking,{
        date:job.date,type:bin.type,planId:bin.planId,
      }),{type:"json",consistency:"strong"});
      if(claim)return stopped("existing_or_uncertain_bin_job_claim");
    } catch {return stopped("bin_job_claim_check_unavailable");}
  }
  let existing;
  try {
    existing=await matchCustomersAcrossPages(booking,
      args=>listCustomers(args),{maxPages:100});
  }catch{return stopped("squeegee_customer_scan_unavailable");}
  if(existing.status!=="not_found")
    return stopped("customer_exists_or_match_requires_review");
  return {
    ready:true,reason:null,bookingId,
    booking, // Internal only. NEVER render, return over HTTP or log.
    checks:checked,total:10,pagesScanned:existing.pagesScanned,
    claimStatus:"not_found",
  };
}
module.exports={TARGET,AUDIT_PREFIXES,acceptedPilotAudit,
  withinDateWindow,inspectAcceptedPilot};
