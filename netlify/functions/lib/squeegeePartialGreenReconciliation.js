"use strict";
// Only the remaining Green 1100L one-off job from the partially successful,
// original £55 owner reactivation. No original claims are ever reset.
const react=require("./squeegeeOwnerReactivation");
const BOOKING_ID="NBG-4QUNP343";
const ACCEPTED_DAY="2026-10-31";
const FIRST_DATE="2026-11-17";
const CLAIM_KEY="claim-v1/owner-partial-green/NBG-4QUNP343";
const PATH="/api/squeegee-preview-partial-green-reconciliation";
function partialStatusSafe(status,bookingClaim,ownerClaim,partialClaim){
  return status?.bookingId===BOOKING_ID &&
    status.stage==="requires_reconciliation" &&
    status.reason==="partial_or_ambiguous_squeegee_write" &&
    status.failureClass==="internal_error" &&
    status.failureStage==="creating_job" &&
    status.customerPostMayHaveSucceeded===false &&
    status.jobsConfirmed===1 &&
    status.jobCount===2 &&
    bookingClaim?.bookingId===BOOKING_ID &&
    bookingClaim.state==="requires_reconciliation" &&
    ownerClaim?.bookingId===BOOKING_ID &&
    ownerClaim.state==="requires_reconciliation" &&
    !partialClaim;
}
// Explain which secure check is blocking the original accepted booking,
// without returning any customer PII or Squeegee account identifiers.
function checkApprovedGroups(audit,prepared,now=Date.now()){
  const accepted=react.auditedBooking(audit,BOOKING_ID,ACCEPTED_DAY);
  if(!accepted.ok)return {ok:false,reason:"accepted_booking_audit_invalid"};
  const b=accepted.booking,bins=b.bins;
  if(bins.length!==3)return {ok:false,reason:"original_bin_count_differs"};
  const standardRecurring=new Set(["domestic_4w","comm_lt360_4w"]);
  // Both domestic and commercial-under-360L four-weekly plans are £5
  // and resolve to the SAME existing Squeegee colour services.
  if(bins[0].type!=="Black Bin" ||
     !standardRecurring.has(bins[0].planId) ||
     bins[1].type!=="Brown Bin" ||
     !standardRecurring.has(bins[1].planId))
    return {ok:false,reason:"black_brown_service_plan_differs"};
  if(bins[2].type!=="Green Bin" ||
     bins[2].planId!=="comm_gt660_oneoff" ||
     bins[2].sizeLitres!==1100)
    return {ok:false,reason:"green_1100L_service_plan_differs"};
  if(bins.some(bin=>bin.count!==1) ||
     Number(b.pricing.total)!==55)
    return {ok:false,reason:"original_quantity_or_total_differs"};
  if(prepared?.status!=="prepared_read_only" ||
     !prepared?.summary?.datesVerified ||
     !prepared?.summary?.pricingVerified ||
     prepared?.summary?.blockedReasons?.length){
    const codes=new Set(prepared?.summary?.blockedReasons||[]);
    const reason=codes.has("unverified_or_changed_dates")?
      "schedule_reverification_failed":
      codes.has("job_group_round_mapping_required")?
        "round_mapping_reverification_failed":
      codes.has("unmapped_squeegee_services")?
        "squeegee_service_mapping_failed":
      codes.has("price_mismatch")?
        "original_pricing_reverification_failed":
      "read_only_booking_preparation_failed";
    return {ok:false,reason};
  }
  const groups=react.preparedJobs(prepared,b,now);
  if(!groups)return {ok:false,reason:"prepared_verified_jobs_invalid"};
  if(groups.length!==2)return {ok:false,reason:"job_group_count_differs"};
  const [first,missing]=groups;
  if(first.input.date!==FIRST_DATE || missing.input.date!==FIRST_DATE)
    return {ok:false,reason:"first_clean_date_differs"};
  if(first.input.price!==10 || missing.input.price!==45)
    return {ok:false,reason:"original_job_prices_differ"};
  if(first.input.frequencyType!=="weeks" ||
     first.input.frequencyInterval!==4 ||
     first.input.services.length!==2 ||
     missing.input.frequencyType!=="adhoc" ||
     missing.input.frequencyInterval!==undefined ||
     missing.input.services.length!==1)
    return {ok:false,reason:"job_frequency_or_service_count_differs"};
  if(!first.input.jobGroup || !missing.input.jobGroup)
    return {ok:false,reason:"squeegee_round_group_not_verified"};
  const blackBrown=first.members.map(x=>x.bin).sort().join("|");
  if(blackBrown!=="Black Bin|Brown Bin" ||
     missing.members.length!==1 ||
     missing.members[0].bin!=="Green Bin" ||
     missing.members[0].sizeLitres!==1100)
    return {ok:false,reason:"grouped_bin_identity_differs"};
  return {ok:true,booking:b,first,missing};
}
function approvedGroups(audit,prepared,now=Date.now()){
  const verified=checkApprovedGroups(audit,prepared,now);
  return verified.ok?{
    booking:verified.booking,first:verified.first,missing:verified.missing,
  }:null;
}
// The public Squeegee GET /customers/:id jobs[] schema exposes only
// _id, services, jobGroup and price. It does NOT expose notes, first
// appointment date or recurrence. Never require unavailable fields or infer
// that a job has the correct appointment date from this GET response.
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idOf(value){
  const raw=typeof value==="string"?value:
    value?._id||value?.id||value?.serviceId||value?.jobGroupId;
  return typeof raw==="string"&&UUID_RE.test(raw)?raw.toLowerCase():null;
}
function jobServices(job){
  if(!Array.isArray(job?.services))return null;
  const ids=job.services.map(idOf);
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)return null;
  return ids;
}
function sameServices(first,second){
  if(!first||!second||first.length!==second.length)return false;
  return [...first].sort().join("|")===[...second].sort().join("|");
}
function publicJobEvidence(jobs,first,missing){
  if(!Array.isArray(jobs))return null;
  const expected=(first?.input?.services||[]).map(idOf);
  const green=idOf(missing?.input?.services?.[0]);
  const group=idOf(first?.input?.jobGroup);
  let sameServiceCount=0,exactGroupCount=0,exactPriceCount=0;
  let greenPresent=0,unreadableServices=0,unreadableGroup=0;
  for(const job of jobs){
    const services=jobServices(job);
    if(!services){unreadableServices++;continue;}
    if(green&&services.includes(green))greenPresent++;
    if(sameServices(services,expected)){
      sameServiceCount++;
      const matchedGroup=idOf(job?.jobGroup)===group;
      if(!idOf(job?.jobGroup))unreadableGroup++;
      if(matchedGroup)exactGroupCount++;
      if(matchedGroup && Number(job?.price)===Number(first.input.price))
        exactPriceCount++;
    }
  }
  // Counts only. No personal data, actual customer/job IDs or API values.
  return {jobsReturned:jobs.length,sameServiceCount,exactGroupCount,
    exactPriceCount,greenPresent,unreadableServices,unreadableGroup};
}
function inspectJobs(jobs,first,missing){
  if(!Array.isArray(jobs))return {ok:false,reason:"customer_jobs_unavailable"};
  const expected=(first?.input?.services||[]).map(idOf);
  const green=idOf(missing?.input?.services?.[0]);
  const expectedGroup=idOf(first?.input?.jobGroup);
  if(expected.length!==2||!expected.every(Boolean)||
     !green||!expectedGroup||!Number.isFinite(Number(first?.input?.price)))
    return {ok:false,reason:"verified_plan_identifiers_invalid"};
  let firstFound=0, firstNearMiss=false;
  for(const old of jobs){
    if(!old||typeof old!=="object")
      return {ok:false,reason:"customer_jobs_incomplete"};
    const services=jobServices(old);
    if(!services)
      return {ok:false,reason:"customer_services_cannot_be_verified"};
    // With no appointment date in Squeegee's public customer GET, ANY
    // occurrence of the missing Green service makes a POST unsafe.
    if(services.includes(green))
      return {ok:false,reason:"green_service_already_present"};
    if(sameServices(services,expected)){
      if(idOf(old.jobGroup)!==expectedGroup ||
         !Number.isFinite(Number(old.price)) ||
         Number(old.price)!==Number(first.input.price)){
        firstNearMiss=true;
        continue;
      }
      firstFound++;
      if(firstFound>1)
        return {ok:false,reason:"duplicate_first_job_found"};
    }else{
      // Notes are usually unavailable, but honour them if supplied.
      const notes=[old.notes,old.description,old.reference,old.referenceNumber]
        .filter(x=>typeof x==="string").join(" ").toUpperCase();
      if(notes.includes(BOOKING_ID))
        return {ok:false,reason:"another_job_with_original_reference_found"};
    }
  }
  if(firstNearMiss)return {ok:false,reason:"first_job_group_or_price_mismatch"};
  if(firstFound!==1)
    return {ok:false,reason:"first_job_not_independently_confirmed"};
  return {ok:true,firstFound:1,greenMissing:true};
}
module.exports={BOOKING_ID,ACCEPTED_DAY,FIRST_DATE,CLAIM_KEY,PATH,
  partialStatusSafe,approvedGroups,checkApprovedGroups,inspectJobs,publicJobEvidence};
