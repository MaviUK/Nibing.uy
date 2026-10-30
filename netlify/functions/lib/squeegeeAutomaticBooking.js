"use strict";

/**
 * Preview 1 only: server-side accepted booking -> Squeegee API v3.
 *
 * NO writes until SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED=true is explicitly
 * configured on the isolated Preview 1 branch. Every real POST is protected
 * by permanent CAS claims and a trusted context-scoped write capability.
 *
 * Booking email, WhatsApp and leaderboard logic never depend on this worker.
 * Failures are held, not retried. Site-wide Blob store names are preview-only.
 */
const api=require("./squeegeeApiV3");
const {prepareReadOnlyBooking}=require("./squeegeeBookingPreparation");
const {fetchAuthoritativeSchedule}=require("./squeegeeBookingStage");
const {matchCustomersAcrossPages}=require("./squeegeeCustomerMatcher");
const {customerKey,jobKey,claimOnce,changeClaimState}=require("./squeegeeIdempotencyClaims");
const {validateBookingSubmission}=require("./bookingSubmissionGuard");

const STATUS_STORE="squeegee-preview1-auto-sync-status";
const CLAIM_STORE="squeegee-preview1-write-claims";
const BOOKING_CLAIM_PREFIX="claim-v1/auto-bookings/";
const MAX_BOOKING_JOBS=12;
const MAX_DAYS_AHEAD=90;

function ukToday(now) {
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date(now));
  const items=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return [items.year,items.month,items.day].join("-");
}
function validUpcomingDate(date,now) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))return false;
  const today=ukToday(now);
  const days=(Date.parse(date+"T12:00:00Z")-
    Date.parse(today+"T12:00:00Z"))/86400000;
  return Number.isInteger(days) && days>=0 && days<=MAX_DAYS_AHEAD;
}
function overlappingJobs(existingJobs,plannedJobs) {
  if(!Array.isArray(existingJobs))return "cannot_inspect_existing_jobs";
  const plannedServices=new Set(plannedJobs.flatMap(job=>job.input.services));
  for(const old of existingJobs) {
    if(!old || !Array.isArray(old.services))return "cannot_inspect_existing_jobs";
    if(old.services.some(id=>typeof id!=="string" ||
       !/^[0-9a-f-]{36}$/i.test(id)))return "cannot_inspect_existing_jobs";
    if(old.services.some(id=>plannedServices.has(id)))
      return "existing_job_for_selected_bin_requires_review";
  }
  return null;
}
async function saveAutoStatus(bookingId,stage,extra={}, {store}={}) {
  const record={
    bookingId,stage,updatedAt:new Date().toISOString(),...extra,
  };
  const handle=store||require("@netlify/blobs").getStore({
    name:STATUS_STORE,consistency:"strong",
  });
  await handle.setJSON(bookingId,record);
  return record;
}
function outcome(status,reason,extra={}) {
  return {status,reason,...extra};
}
function canAutoSync(env,runtimeScope) {
  return api.isExactPreview1(env,runtimeScope) &&
    env?.SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED==="true" &&
    typeof env?.SQUEEGEE_API_KEY==="string" &&
    env.SQUEEGEE_API_KEY.trim().length>=20;
}

/**
 * Must be called only after an atomic per-booking accepted receipt exists.
 * Dependencies default to REAL Squeegee GET/POST methods, but are injected by
 * tests or by the ESM Netlify entrypoint for strong-consistency Blob claims.
 */
async function executeAutomaticPreviewBooking(payload,{
  channel,env=process.env,runtimeScope=null,now=Date.now(),deps={},
}={}) {
  if(!canAutoSync(env,runtimeScope))
    return outcome("not_started","automatic_preview_writes_disabled");
  if(!["email","whatsapp"].includes(channel))
    return outcome("not_started","unsupported_booking_channel");
  const valid=validateBookingSubmission(payload,{now});
  if(!valid.ok)return outcome("not_started","invalid_or_expired_booking");
  const bookingId=valid.bookingId;
  const bins=Array.isArray(payload?.bins)?payload.bins.filter(x=>x?.type):[];
  if(!bins.length || bins.length>MAX_BOOKING_JOBS)
    return outcome("held","too_many_or_no_booking_lines");
  if(payload.termsAccepted!==true)
    return outcome("held","booking_terms_not_accepted");

  const use={
    getSchedule:deps.getSchedule||fetchAuthoritativeSchedule,
    getServices:deps.getServices||api.getServices,
    getJobGroups:deps.getJobGroups||api.getJobGroups,
    listCustomers:deps.listCustomers||api.listCustomers,
    getCustomer:deps.getCustomer||api.getCustomer,
    claim:deps.claim||claimOnce,
    changeState:deps.changeState||changeClaimState,
    createCustomer:deps.createCustomer||api.createCustomer,
    addJob:deps.addJob||api.addJobToCustomer,
    withWrite:deps.withWrite||api.withApprovedPreviewAutomaticWrite,
    save:deps.save||saveAutoStatus,
  };
  const mark=(stage,extra={})=>use.save(bookingId,stage,extra);
  const held=async(reason,extra={})=>{
    await mark("held_for_review",{reason,...extra});
    return outcome("held",reason);
  };
  const uncertain=async(reason,extra={})=>{
    try{await mark("requires_reconciliation",{reason,...extra});}catch{}
    return outcome("requires_reconciliation",reason);
  };
  try {
    // If status storage fails, stop immediately (no API write).
    await mark("validating",{channel});
    const [schedule,services,groups]=await Promise.allSettled([
      use.getSchedule(payload),use.getServices(),use.getJobGroups(),
    ]);
    if([schedule,services,groups].some(x=>x.status!=="fulfilled"||!x.value))
      return await held("schedule_services_or_groups_unavailable");
    let prepared;
    try {
      prepared=prepareReadOnlyBooking(payload,
        schedule.value,services.value,{jobGroups:groups.value});
    }catch{return await held("booking_validation_failed");}
    const plan=prepared.privatePlan,summary=prepared.summary;
    if(prepared.status!=="prepared_read_only" ||
       !summary.pricingVerified || !summary.datesVerified ||
       summary.blockedReasons.length || !plan ||
       plan.blockedJobs!==0 || plan.readyJobs!==bins.length ||
       plan.jobs.length!==bins.length ||
       !plan.jobs.every(x=>x.status==="ready" &&
         x.input?.jobGroup && validUpcomingDate(x.date,now)) ||
       !summary.jobs.every(x=>x.roundStatus==="mapped")) {
      return await held("date_price_service_or_round_not_verified",{
        blockedReasons:summary.blockedReasons.slice(0,8),
      });
    }
    const customerMatch=await matchCustomersAcrossPages(payload,
      args=>use.listCustomers(args),{maxPages:100});
    if(!["matched","not_found"].includes(customerMatch.status))
      return await held("customer_match_ambiguous_or_incomplete");
    const existing=customerMatch.status==="matched";
    let customerId=existing?customerMatch.customerId:null;
    if(existing) {
      let record;
      try{record=await use.getCustomer(customerId);}
      catch{return await held("existing_customer_details_unavailable");}
      const overlap=overlappingJobs(record?.jobs,plan.jobs);
      if(overlap)return await held(overlap);
    }

    await mark("ready_for_claims",{
      jobs:plan.jobs.length,customerMode:existing?"existing":"new",
      dates:plan.jobs.map(j=>j.date),
      rounds:summary.jobs.map(j=>j.roundNumber),
    });

    // Permanent per-booking claim prevents a second dispatch; separate
    // property and job claims protect other booking IDs for the same bin.
    // A failed claim is never released or automatically retried.
    const bookingClaim=await use.claim({
      key:BOOKING_CLAIM_PREFIX+bookingId,bookingId,channel});
    if(!bookingClaim.acquired)return await held("booking_already_claimed_or_uncertain");
    let propertyClaim=null;
    if(!existing) {
      propertyClaim=await use.claim({key:customerKey(payload),bookingId,channel});
      if(!propertyClaim.acquired)
        return await held("customer_property_claimed_or_uncertain");
    }
    const jobs=[];
    for(const job of plan.jobs) {
      const bin=bins[job.index];
      const record=await use.claim({
        key:jobKey(payload,{date:job.date,type:bin.type,planId:bin.planId}),
        bookingId,channel,
      });
      if(!record.acquired)return await held("job_claimed_or_uncertain");
      jobs.push({job,claim:record});
    }
    const bookingRunning=await use.changeState({
      key:bookingClaim.key,etag:bookingClaim.etag,bookingId,
      state:"request_in_progress",
    });
    if(!bookingRunning.changed)return await held("booking_claim_transition_failed");
    let propertyEtag=propertyClaim?.etag;
    if(propertyClaim) {
      const running=await use.changeState({
        key:propertyClaim.key,etag:propertyEtag,bookingId,
        state:"request_in_progress",
      });
      if(!running.changed)return await held("property_claim_transition_failed");
      propertyEtag=running.etag;
    }

    let postAttempted=false,completed=0,creatingCustomer=false;
    let customerCreated=false,customerClaimSettled=!propertyClaim;
    try {
      await use.withWrite({...bookingClaim,etag:bookingRunning.etag},
        async()=>{
        if(!existing) {
          // Existing Squeegee customers are never overwritten.
          await mark("creating_customer",{jobCount:jobs.length});
          creatingCustomer=true;
          postAttempted=true;
          const response=await use.createCustomer({
            ...plan.customerInput,
            notes:"NI Bin Guy website booking (Preview 1) - verify before operational launch.",
          });
          customerCreated=true;
          const rawId=typeof response==="string"?response:
            response?._id||response?.id||response?.customerId;
          customerId=api.requireUuid(rawId,"created customer id");
          const customerDone=await use.changeState({
            key:propertyClaim.key,etag:propertyEtag,bookingId,state:"succeeded",
          });
          if(!customerDone.changed)throw new Error("property_claim_commit_uncertain");
          propertyEtag=customerDone.etag;customerClaimSettled=true;
          creatingCustomer=false;
        }
        for(let index=0;index<jobs.length;index++){
          const entry=jobs[index];
          const jobRunning=await use.changeState({
            key:entry.claim.key,etag:entry.claim.etag,bookingId,
            state:"request_in_progress",
          });
          if(!jobRunning.changed)throw new Error("job_claim_transition_failed");
          entry.etag=jobRunning.etag;
          await mark("creating_job",{jobNumber:index+1,jobCount:jobs.length});
          postAttempted=true;
          await use.addJob(customerId,entry.job.input);
          completed++;
          const done=await use.changeState({
            key:entry.claim.key,etag:entry.etag,bookingId,state:"succeeded",
          });
          if(!done.changed)throw new Error("job_claim_commit_uncertain");
          entry.etag=done.etag;
        }
      },runtimeScope,env);
      const done=await use.changeState({
        key:bookingClaim.key,etag:bookingRunning.etag,bookingId,state:"succeeded",
      });
      if(!done.changed)throw new Error("booking_claim_commit_uncertain");
      await mark("created_customer_and_jobs",{
        customerMode:existing?"existing":"new",
        createdCustomer:customerCreated,
        createdJobs:completed,firstCleanDates:plan.jobs.map(j=>j.date),
        rounds:summary.jobs.map(j=>j.roundNumber),
        recurrence:plan.jobs.map(j=>j.input.frequencyType==="weeks"?
          "every_"+j.input.frequencyInterval+"_weeks":"one_off"),
      });
      return outcome("completed","created_customer_and_jobs",{
        createdCustomer:customerCreated,createdJobs:completed});
    }catch{
      // Never retry ANY ambiguous external POST, even if only part of the
      // booking was completed. Claims remain occupied for manual review.
      if(propertyClaim && !customerClaimSettled) {
        try{await use.changeState({
          key:propertyClaim.key,etag:propertyEtag,bookingId,
          state:"requires_reconciliation",
        });}catch{}
      }
      for(const entry of jobs) {
        if(entry.etag) {
          try{await use.changeState({
            key:entry.claim.key,etag:entry.etag,bookingId,
            state:"requires_reconciliation",
          });}catch{}
        }
      }
      try{await use.changeState({
        key:bookingClaim.key,etag:bookingRunning.etag,bookingId,
        state:"requires_reconciliation",
      });}catch{}
      return await uncertain("partial_or_ambiguous_squeegee_write",{
        customerPostMayHaveSucceeded:creatingCustomer||customerCreated,
        jobPostMayHaveSucceeded:postAttempted,
        jobsConfirmed:completed,jobCount:jobs.length,
      });
    }
  }catch{
    // Could be a storage or API GET failure, or a partly committed claim.
    // Stop indefinitely rather than assuming safe retries.
    return await uncertain("unexpected_auto_sync_failure");
  }
}
module.exports={
  STATUS_STORE,CLAIM_STORE,BOOKING_CLAIM_PREFIX,
  MAX_BOOKING_JOBS,ukToday,validUpcomingDate,overlappingJobs,
  saveAutoStatus,canAutoSync,executeAutomaticPreviewBooking,
};
