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
const rollout=require("./squeegeePreviewAutoRollout");
const {prepareReadOnlyBooking}=require("./squeegeeBookingPreparation");
const {groupedSqueegeeJobs}=require("./squeegeeJobGrouping");
const {fetchAuthoritativeSchedule}=require("./squeegeeBookingStage");
const {matchCustomersAcrossPages,addressKey,normalName}=require("./squeegeeCustomerMatcher");
const {resolveSqueegeeServiceIds}=require("./squeegeeServiceCatalog");
const {normalizedBinType}=require("./squeegeeBookingPlan");
const {customerKey,jobKey,activeBinKey,claimOnce,changeClaimState}=require("./squeegeeIdempotencyClaims");
const {validateBookingSubmission}=require("./bookingSubmissionGuard");
const {notifyOwnerOfSyncHold}=require("./squeegeeSyncOwnerAlert");

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
function overlappingJobs(existingJobs,plannedJobs,serviceIds=null) {
  if(!Array.isArray(existingJobs))return "cannot_inspect_existing_jobs";
  const plannedServices=new Set(plannedJobs.flatMap(job=>job.input.services));
  if(serviceIds && typeof serviceIds==="object") {
    // A Brown one-off and Brown 4-weekly job use different service UUIDs.
    // Never add a second job for the same physical bin just because the plan
    // differs. Include all verified service IDs for each requested bin type.
    const selectedTypes=new Set(plannedJobs.map(job=>normalizedBinType(job.bin)));
    for(const values of Object.values(serviceIds)) {
      for(const type of selectedTypes) {
        const id=values?.[type];
        if(id)plannedServices.add(id);
      }
    }
  }
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
    rollout.automaticEnabled(env) &&
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
  if(!rollout.acceptedForRollout(payload,channel,env))
    return outcome("not_started","outside_approved_preview_email_pilot");
  const valid=validateBookingSubmission(payload,{now});
  if(!valid.ok)return outcome("not_started","invalid_or_expired_booking");
  const bookingId=valid.bookingId;
  const bins=Array.isArray(payload?.bins)?payload.bins.filter(x=>x?.type):[];
  if(!bins.length || bins.length>MAX_BOOKING_JOBS)
    return outcome("held","too_many_or_no_booking_lines");
  // Each selected line is a distinct bin colour at this property. Multiple
  // lines may later share ONE grouped job if their schedules are identical.
  // Repeated colours in one booking cannot be distinguished as separate bins
  // with this Squeegee API shape. Hold them before claiming anything.
  const distinctBins=new Set(bins.map(x=>normalizedBinType(x.type)));
  if(distinctBins.size!==bins.length)
    return outcome("held","duplicate_bin_types_in_same_booking");
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
    alert:deps.alert||((id,reason,extra)=>notifyOwnerOfSyncHold(id,reason,extra,{env})),
  };
  const mark=(stage,extra={})=>use.save(bookingId,stage,extra);
  const held=async(reason,extra={})=>{
    await mark("held_for_review",{reason,...extra});
    // The normal website/admin booking email already succeeded. A separate
    // PII-free owner notice prevents an unimported job being silently missed.
    // The alert can fail safely; there is NEVER an automatic Squeegee retry.
    try{await use.alert(bookingId,reason,extra);}catch{}
    return outcome("held",reason);
  };
  const uncertain=async(reason,extra={})=>{
    try{await mark("requires_reconciliation",{reason,...extra});}catch{}
    try{await use.alert(bookingId,"requires_reconciliation",{
      matchReason:reason,
    });}catch{}
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
    // Plans, exact dates, account services and prices have all been verified.
    // Group compatible bin lines into ONE Squeegee job per identical date,
    // round and recurrence; conflicting schedules must stay separate.
    let groupedJobs;
    try{groupedJobs=groupedSqueegeeJobs(plan.jobs,bookingId);}
    catch{return await held("cannot_safely_group_bin_jobs");}
    const groupedPennies=groupedJobs.reduce((sum,group)=>
      sum+Math.round(group.input.price*100),0);
    const bookingPennies=Math.round(Number(payload.pricing?.total)*100);
    if(!Number.isSafeInteger(groupedPennies) ||
       !Number.isSafeInteger(bookingPennies) ||
       groupedPennies!==bookingPennies ||
       !groupedJobs.length || groupedJobs.length>bins.length) {
      return await held("grouped_job_price_or_service_mismatch");
    }

    const customerMatch=await matchCustomersAcrossPages(payload,
      args=>use.listCustomers(args),{maxPages:100});
    if(!["matched","not_found","reactivation_required"].includes(customerMatch.status))
      return await held("customer_match_ambiguous_or_incomplete",{
        matchReason:customerMatch.reason||"unspecified_match_reason",
      });
    const existing=customerMatch.status!=="not_found";
    const anotherProperty=customerMatch.relatedContactAtDifferentAddress===true;
    const customerMode=existing?"existing":
      anotherProperty?"additional_property":"new";
    let customerId=existing?customerMatch.customerId:null;
    if(existing) {
      let record;
      try{record=await use.getCustomer(customerId);}
      catch{return await held("existing_customer_details_unavailable");}
      // A matched name+address is sufficient even if contact details changed.
      // Recheck authoritative customer details; never trust only a list row.
      const recordAddress=addressKey(record?.address);
      if(!recordAddress || recordAddress!==addressKey(payload.address))
        return await held("existing_customer_address_unverified");
      const matchedByName=customerMatch.reason==="exact_property_and_name" ||
        customerMatch.matchReason==="exact_property_and_name";
      if(matchedByName &&
         (!normalName(record?.name) ||
          normalName(record.name)!==normalName(payload.name))) {
        return await held("existing_customer_name_unverified");
      }
      const recordStatus=String(record?.status||"").trim().toLowerCase();
      // Squeegee currently documents an in-app Activate action, but the
      // verified public v3 API does NOT expose customer reactivation. Hold
      // this exact matched customer for activation instead of creating a
      // duplicate or guessing an undocumented mutation endpoint.
      if(["inactive","deactivated"].includes(recordStatus))
        return await held("existing_customer_reactivation_required",{
          matchReason:"inactive_exact_customer",
        });
      if(["deleted","archived","cancelled","canceled"].includes(recordStatus))
        return await held("existing_customer_inactive");
      // A previously inactive LIST row may be stale; only the authoritative
      // detail response can permit continued normal append-only job creation.
      if(customerMatch.status==="reactivation_required" &&
         recordStatus!=="active")
        return await held("existing_customer_reactivation_required",{
          matchReason:"inactive_exact_customer",
        });
      const catalog=resolveSqueegeeServiceIds(services.value);
      const overlap=overlappingJobs(record?.jobs,plan.jobs,catalog.serviceIds);
      if(overlap)return await held(overlap);
    }

    await mark("ready_for_claims",{
      jobs:groupedJobs.length,binServices:plan.jobs.length,customerMode,
      dates:groupedJobs.map(group=>group.input.date),
      rounds:groupedJobs.map(group=>
        summary.jobs[group.members[0].index].roundNumber),
      binsPerJob:groupedJobs.map(group=>group.members.length),
    });

    // First Preview 1 rollout: ONE TEST API email booking in total. Reserve
    // the global pilot slot atomically AFTER read-only validations and customer
    // matching, but BEFORE any Squeegee customer/job POST. Never release it
    // automatically even if the worker is interrupted or a POST is uncertain.
    let pilotClaim=null;
    if(rollout.autoMode(env)==="pilot") {
      const reserved=await use.claim({
        key:rollout.PILOT_CLAIM_KEY,bookingId,channel,
      });
      if(!reserved.acquired)
        return await held("pilot_first_booking_already_consumed_or_uncertain");
      const started=await use.changeState({
        key:reserved.key,etag:reserved.etag,bookingId,
        state:"request_in_progress",
      });
      if(!started.changed)return await held("pilot_reservation_uncertain");
      pilotClaim={...reserved,etag:started.etag};
    }

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
      // No two concurrent bookings may add the same bin at the same property,
      // even if they differ by plan or website first-clean date.
      const activeBin=await use.claim({
        key:activeBinKey(payload,bin),bookingId,channel,
      });
      if(!activeBin.acquired)
        return await held("property_bin_already_claimed_or_uncertain");
      const record=await use.claim({
        key:jobKey(payload,{date:job.date,type:bin.type,planId:bin.planId}),
        bookingId,channel,
      });
      if(!record.acquired)return await held("job_claimed_or_uncertain");
      jobs.push({job,claim:record,activeBin});
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
          await mark("creating_customer",{jobCount:groupedJobs.length,
            binServices:bins.length});
          creatingCustomer=true;
          postAttempted=true;
          const response=await use.createCustomer({
            ...plan.customerInput,
            notes:anotherProperty
              ? "NI Bin Guy website booking (Preview 1). Additional service property for an existing contact. Separate service/billing account; do not merge without review."
              : "NI Bin Guy website booking (Preview 1) - verify before operational launch.",
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
        // Every physical bin retains its own permanent job + active-bin CAS
        // claim. Transition ALL member claims BEFORE the single grouped POST.
        // On any uncertain response, never retry the group or any of its bins.
        const entriesByIndex=new Map(jobs.map(entry=>[entry.job.index,entry]));
        for(let index=0;index<groupedJobs.length;index++){
          const group=groupedJobs[index];
          const entries=group.members.map(member=>entriesByIndex.get(member.index));
          if(entries.some(entry=>!entry))
            throw new Error("missing_group_member_claim");
          for(const entry of entries){
            const activeRunning=await use.changeState({
              key:entry.activeBin.key,etag:entry.activeBin.etag,bookingId,
              state:"request_in_progress",
            });
            if(!activeRunning.changed)throw new Error("active_bin_claim_transition_failed");
            entry.activeEtag=activeRunning.etag;
            const jobRunning=await use.changeState({
              key:entry.claim.key,etag:entry.claim.etag,bookingId,
              state:"request_in_progress",
            });
            if(!jobRunning.changed)throw new Error("job_claim_transition_failed");
            entry.etag=jobRunning.etag;
          }
          await mark("creating_job",{
            jobNumber:index+1,jobCount:groupedJobs.length,
            binsOnJob:entries.length,
          });
          postAttempted=true;
          await use.addJob(customerId,group.input);
          completed++;
          for(const entry of entries){
            const done=await use.changeState({
              key:entry.claim.key,etag:entry.etag,bookingId,state:"succeeded",
            });
            if(!done.changed)throw new Error("job_claim_commit_uncertain");
            entry.etag=done.etag;
            const activeDone=await use.changeState({
              key:entry.activeBin.key,etag:entry.activeEtag,bookingId,
              state:"succeeded",
            });
            if(!activeDone.changed)throw new Error("active_bin_claim_commit_uncertain");
            entry.activeEtag=activeDone.etag;
          }
        }
      },runtimeScope,env);
      const done=await use.changeState({
        key:bookingClaim.key,etag:bookingRunning.etag,bookingId,state:"succeeded",
      });
      if(!done.changed)throw new Error("booking_claim_commit_uncertain");
      if(pilotClaim) {
        const pilotDone=await use.changeState({
          key:pilotClaim.key,etag:pilotClaim.etag,bookingId,state:"succeeded",
        });
        if(!pilotDone.changed)throw new Error("pilot_claim_commit_uncertain");
        pilotClaim.etag=pilotDone.etag;
      }
      await mark("created_customer_and_jobs",{
        customerMode,
        createdCustomer:customerCreated,
        createdJobs:completed,binServices:plan.jobs.length,
        binsPerJob:groupedJobs.map(group=>group.members.length),
        firstCleanDates:groupedJobs.map(group=>group.input.date),
        rounds:groupedJobs.map(group=>
          summary.jobs[group.members[0].index].roundNumber),
        recurrence:groupedJobs.map(group=>
          group.input.frequencyType==="weeks"
            ?"every_"+group.input.frequencyInterval+"_weeks":"one_off"),
      });
      return outcome("completed","created_customer_and_jobs",{
        createdCustomer:customerCreated,createdJobs:completed,
        binServices:plan.jobs.length});
    }catch{
      // A pilot is one-use even on partial or uncertain external success.
      if(pilotClaim) {
        try {
          await use.changeState({
            key:pilotClaim.key,etag:pilotClaim.etag,bookingId,
            state:"requires_reconciliation",
          });
        }catch{}
      }
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
        if(entry.activeEtag) {
          try{await use.changeState({
            key:entry.activeBin.key,etag:entry.activeEtag,bookingId,
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
        jobsConfirmed:completed,jobCount:groupedJobs.length,
        binServicesPlanned:bins.length,
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
