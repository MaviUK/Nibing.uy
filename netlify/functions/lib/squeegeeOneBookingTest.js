"use strict";

/**
 * One supervised Preview 1 booking-to-Squeegee integration test.
 *
 * Never called as part of ordinary bookings unless the operator entered an
 * emailed, single-use access code and the browser now has a valid HttpOnly
 * test-session cookie. Read-only checks precede an atomic one-use reservation.
 * At most one new customer and one job can be attempted; no POST retries.
 *
 * This is NOT a general live sync engine. Nothing here enables production.
 */
const api = require("./squeegeeApiV3");
const { prepareReadOnlyBooking } = require("./squeegeeBookingPreparation");
const { fetchAuthoritativeSchedule } = require("./squeegeeBookingStage");
const { matchCustomersAcrossPages } = require("./squeegeeCustomerMatcher");
const { customerKey, jobKey, claimOnce, changeClaimState } = require("./squeegeeIdempotencyClaims");
const { validateBookingSubmission } = require("./bookingSubmissionGuard");
const { verifyTestSessionCookie, sessionCookieFromHeader } = require("./squeegeePreviewTestSession");

const GLOBAL_TEST_KEY = "claim-v1/approved-preview-1/one-customer-one-job";
const STATUS_STORE = "squeegee-preview1-one-booking-test-status";

function isEligibleOneBooking(payload, now = Date.now()) {
  const check = validateBookingSubmission(payload, {now});
  if (!check.ok) return { eligible:false, reason:"invalid_or_expired_booking" };
  const bins = Array.isArray(payload?.bins) ? payload.bins.filter(b => b?.type) : [];
  if (bins.length !== 1 || bins[0].count !== 1 ||
      bins[0].planId !== "domestic_4w" ||
      !["black","brown","green","blue"].includes(
        String(bins[0].type || "").toLowerCase().replace(/\s+bin$/,"").trim())) {
    return { eligible:false, reason:"test_requires_exactly_one_domestic_four_weekly_bin" };
  }
  if (payload?.termsAccepted !== true || String(payload?.discountCode || "").trim()) {
    return { eligible:false, reason:"test_terms_or_discount_not_eligible" };
  }
  if (!String(payload.email || "").trim() || !String(payload.address || "").trim() ||
      !String(payload.name || "").trim()) {
    return { eligible:false, reason:"missing_test_customer_details" };
  }
  return { eligible:true, bookingId:check.bookingId, bin:bins[0] };
}

async function saveTestStatus(bookingId, stage, extra = {}, { store } = {}) {
  const safe = {
    bookingId, stage, updatedAt:new Date().toISOString(),
    ...extra, // caller must provide only approved non-PII fields
  };
  const handle = store || require("@netlify/blobs").getStore({
    name:STATUS_STORE, consistency:"strong",
  });
  await handle.setJSON(bookingId, safe);
  return safe;
}

function privateStatus(status, reason, extra={}) {
  return { status, reason, ...extra };
}

async function executeOneApprovedTestBooking(payload, {
  cookieHeader,
  channel="email",
  serverSchedule,
  env=process.env,
  runtimeScope=null,
  now=Date.now(),
  deps={},
}={}) {
  if (!api.isExactPreview1(env,runtimeScope) || !env.SQUEEGEE_API_KEY) {
    return privateStatus("not_started", "not_exact_preview_1");
  }
  const cookie = sessionCookieFromHeader(cookieHeader);
  if (!verifyTestSessionCookie(cookie, env, now, runtimeScope)) {
    return privateStatus("not_started", "operator_authorization_missing_or_expired");
  }
  const eligibility=isEligibleOneBooking(payload);
  if (!eligibility.eligible) {
    return privateStatus("not_started",eligibility.reason);
  }
  const bookingId=eligibility.bookingId;
  const depsResolved={
    getServices:deps.getServices || api.getServices,
    getJobGroups:deps.getJobGroups || api.getJobGroups,
    listCustomers:deps.listCustomers || api.listCustomers,
    getSchedule:deps.getSchedule || fetchAuthoritativeSchedule,
    claim:deps.claim || claimOnce,
    changeState:deps.changeState || changeClaimState,
    createCustomer:deps.createCustomer || api.createCustomer,
    addJob:deps.addJob || api.addJobToCustomer,
    withWrite:deps.withWrite || api.withOneApprovedPreviewTestWrite,
    save:deps.save || saveTestStatus,
  };
  const mark=async(stage,extra={}) => depsResolved.save(bookingId,stage,extra);

  try {
    // If status persistence fails, do not touch Squeegee.
    await mark("validating");

    const [scheduleResult,servicesResult,groupsResult] = await Promise.allSettled([
      serverSchedule !== undefined ? Promise.resolve(serverSchedule) : depsResolved.getSchedule(payload),
      depsResolved.getServices(),
      depsResolved.getJobGroups(),
    ]);
    if ([scheduleResult,servicesResult,groupsResult].some(x=>x.status!=="fulfilled")) {
      await mark("held", {reason:"could_not_revalidate_squeegee_services_groups_or_dates"});
      return privateStatus("held","could_not_revalidate_squeegee_services_groups_or_dates");
    }

    const { summary, privatePlan, status } = prepareReadOnlyBooking(
      payload, scheduleResult.value, servicesResult.value,
      {jobGroups:groupsResult.value});
    if (status!=="prepared_read_only" ||
        summary.blockedReasons.length ||
        summary.jobs.length!==1 || !summary.datesVerified ||
        !summary.pricingVerified || !privatePlan ||
        privatePlan.jobs.length!==1 ||
        privatePlan.jobs[0].status!=="ready" ||
        privatePlan.readyJobs!==1 || privatePlan.blockedJobs!==0 ||
        !privatePlan.jobs[0].input?.jobGroup) {
      await mark("held", {reason:"prepared_booking_not_ready",
        blocked:summary.blockedReasons.slice(0,8)});
      return privateStatus("held","prepared_booking_not_ready");
    }
    const job=privatePlan.jobs[0];
    // Prevent testing an old or distant appointment. Only the customer's
    // immediately assigned upcoming date qualifies.
    const date=job.date;
    const ukParts=new Intl.DateTimeFormat("en-GB",{
      timeZone:"Europe/London",day:"2-digit",month:"2-digit",year:"numeric",
    }).formatToParts(new Date(now));
    const ukDate=Object.fromEntries(ukParts.map(part=>[part.type,part.value]));
    const today=ukDate.year+"-"+ukDate.month+"-"+ukDate.day;
    if (date < today || Date.parse(date+"T12:00:00Z")-
          Date.parse(today+"T12:00:00Z")>45*24*60*60*1000) {
      await mark("held",{reason:"test_date_outside_45_day_window"});
      return privateStatus("held","test_date_outside_45_day_window");
    }

    const matched=await matchCustomersAcrossPages(payload,
      args=>depsResolved.listCustomers(args),{maxPages:100});
    // TEST MUST CREATE NEW customer: never modify someone's existing work.
    if (matched.status!=="not_found") {
      await mark("held", {reason:matched.status==="matched" ?
        "customer_already_exists":"customer_match_requires_review"});
      return privateStatus("held","customer_not_confirmed_new");
    }

    await mark("ready_for_one_shot_claim",{
      firstClean:date,round:summary.jobs[0].roundNumber,
      frequency:"every_4_weeks",
    });
    // Three independent single-key permanent claims. The global one limits
    // total attempts to one; property/job claims prevent duplicate imports.
    // There is deliberately NO release or automatic retry after any claim.
    const global=await depsResolved.claim({key:GLOBAL_TEST_KEY,bookingId,channel});
    if (!global.acquired) {
      await mark("held",{reason:"one_test_already_used_or_reservation_uncertain"});
      return privateStatus("held","one_test_already_used_or_reservation_uncertain");
    }
    const customer=await depsResolved.claim({
      key:customerKey(payload),bookingId,channel,
    });
    if (!customer.acquired) {
      await mark("held",{reason:"customer_reservation_unavailable"});
      return privateStatus("held","customer_reservation_unavailable");
    }
    const jobClaim=await depsResolved.claim({
      key:jobKey(payload,{
        date:job.date,type:eligibility.bin.type,
        planId:eligibility.bin.planId,
      }),bookingId,channel,
    });
    if (!jobClaim.acquired) {
      await mark("held",{reason:"job_reservation_unavailable"});
      return privateStatus("held","job_reservation_unavailable");
    }

    const running=await depsResolved.changeState({
      key:GLOBAL_TEST_KEY,etag:global.etag,bookingId,state:"request_in_progress",
    });
    if (!running.changed) {
      await mark("held",{reason:"global_claim_cas_failed"});
      return privateStatus("held","global_claim_cas_failed");
    }
    const customerRunning=await depsResolved.changeState({
      key:customer.key,etag:customer.etag,bookingId,state:"request_in_progress",
    });
    if (!customerRunning.changed) {
      await mark("held",{reason:"customer_claim_cas_failed"});
      return privateStatus("held","customer_claim_cas_failed");
    }

    let customerPostAttempted=false, jobPostAttempted=false;
    let customerCreated=false, jobCreated=false;
    let customerEtag=customerRunning.etag,jobEtag=jobClaim.etag;
    try {
      await mark("creating_customer");
      await depsResolved.withWrite(global,async()=>{
        // TEST label visibly marks record so it can be removed after checking.
        const input={...privatePlan.customerInput,
          name:("TEST API - "+privatePlan.customerInput.name).slice(0,52),
          notes:"NI Bin Guy PREVIEW 1 Squeegee API TEST - Not a live customer service. Please delete after verification.",
        };
        customerPostAttempted=true;
        const response=await depsResolved.createCustomer(input);
        customerCreated=true; // Even an unparseable response could mean POST succeeded.
        const id=typeof response==="string" ? response :
          response?._id || response?.id || response?.customerId;
        let safeId;
        try { safeId=api.requireUuid(id,"created customer id"); }
        catch { throw new Error("customer_response_requires_reconciliation"); }

        const customerDone=await depsResolved.changeState({
          key:customer.key,etag:customerEtag,bookingId,state:"succeeded",
        });
        if (!customerDone.changed) throw new Error("customer_claim_commit_requires_reconciliation");
        customerEtag=customerDone.etag;

        const jobRunning=await depsResolved.changeState({
          key:jobClaim.key,etag:jobEtag,bookingId,state:"request_in_progress",
        });
        if (!jobRunning.changed)throw new Error("job_claim_cas_failed");
        jobEtag=jobRunning.etag;

        await mark("creating_job",{
          firstClean:date,round:summary.jobs[0].roundNumber,
        });
        jobPostAttempted=true;
        await depsResolved.addJob(safeId,job.input);
        jobCreated=true;
        const jobDone=await depsResolved.changeState({
          key:jobClaim.key,etag:jobEtag,bookingId,state:"succeeded",
        });
        if (!jobDone.changed)throw new Error("job_claim_commit_requires_reconciliation");
        jobEtag=jobDone.etag;
      },runtimeScope);
    } catch {
      // At least one POST may have succeeded. Preserve ALL claims permanently.
      // No retry, no cleanup/delete and no second test until manual review.
      if (customerPostAttempted && customerEtag) {
        await depsResolved.changeState({
          key:customer.key,etag:customerEtag,bookingId,
          state:"requires_reconciliation",
        });
      }
      if (jobEtag) {
        await depsResolved.changeState({
          key:jobClaim.key,etag:jobEtag,bookingId,
          state:"requires_reconciliation",
        });
      }
      await depsResolved.changeState({
        key:GLOBAL_TEST_KEY,etag:running.etag,bookingId,
        state:"requires_reconciliation",
      });
      await mark("requires_reconciliation",{
        customerCreationMayHaveSucceeded:customerPostAttempted,
        jobCreationMayHaveSucceeded:jobPostAttempted,
      });
      return privateStatus("requires_reconciliation","do_not_retry_check_squeegee");
    }

    const finished=await depsResolved.changeState({
      key:GLOBAL_TEST_KEY,etag:running.etag,bookingId,state:"succeeded",
    });
    if (!finished.changed) {
      await mark("requires_reconciliation",{reason:"global_claim_commit_failed"});
      return privateStatus("requires_reconciliation","global_claim_commit_failed");
    }
    await mark("created_one_customer_one_job",{
      firstClean:date, round:summary.jobs[0].roundNumber,
      frequency:"every_4_weeks",status:"test_completed",
    });
    return privateStatus("test_completed","created_one_customer_one_job",{
      date,round:summary.jobs[0].roundNumber});
  } catch {
    // Never leak customer PII or upstream errors into public logs.
    try {await mark("requires_reconciliation",{reason:"unexpected_test_processing_error"});}
    catch {}
    return privateStatus("requires_reconciliation","unexpected_test_processing_error");
  }
}

module.exports={
  GLOBAL_TEST_KEY,STATUS_STORE,
  isEligibleOneBooking,
  saveTestStatus,
  executeOneApprovedTestBooking,
};
