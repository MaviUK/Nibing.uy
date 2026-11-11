"use strict";

/**
 * Read-only confirmation after a Squeegee POST.
 *
 * The public GET /customers/:id exposes job _id, services, jobGroup and
 * price, but not the appointment date, notes or recurrence. Therefore only
 * claim that a new job is VISIBLE and matches its services/group/price.
 * Never infer that the appointment date was verified by this readback.
 * A 2xx POST or JSON success:true alone is NOT proof that a job exists.
 */
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS=3;

function idOf(value) {
  const raw=typeof value==="string"?value:
    value?._id||value?.id||value?.jobId||value?.serviceId||value?.jobGroupId;
  return typeof raw==="string"&&UUID_RE.test(raw)?
    raw.toLowerCase():null;
}
function returnedJobId(response) {
  return idOf(response?.data?.job)||
    idOf(response?.data)||
    idOf(response?.job)||
    idOf(response);
}
function serviceIds(services) {
  if(!Array.isArray(services)||services.length===0)return null;
  const ids=services.map(idOf);
  return ids.every(Boolean)&&new Set(ids).size===ids.length?ids:null;
}
function matchesPlannedJob(job,planned,{manualSchedule=false}={}) {
  const actual=serviceIds(job?.services);
  const expected=serviceIds(planned?.services);
  if(!actual||!expected||actual.length!==expected.length ||
     [...actual].sort().join("|")!==[...expected].sort().join("|"))
    return false;
  if(!planned?.jobGroup && !manualSchedule)return false;
  if(planned?.jobGroup ?
     (!idOf(job?.jobGroup)||idOf(job.jobGroup)!==idOf(planned.jobGroup)) :
     (job?.jobGroup!==undefined && job?.jobGroup!==null && job?.jobGroup!==""))
    return false;
  const actualPennies=Number(job?.price)*100;
  const expectedPennies=Number(planned?.price)*100;
  return Number.isFinite(actualPennies) &&
    Number.isFinite(expectedPennies) &&
    Math.round(actualPennies)===Math.round(expectedPennies) &&
    Math.abs(actualPennies-Math.round(actualPennies))<0.001 &&
    Math.abs(expectedPennies-Math.round(expectedPennies))<0.001;
}
function identifyNewJob(jobs,{planned,knownJobIds=[],writeResult,baselineComplete=true,manualSchedule=false}={}) {
  if(!Array.isArray(jobs))return null;
  const prior=new Set([...knownJobIds].map(idOf).filter(Boolean));
  const returned=returnedJobId(writeResult);
  // If prior jobs lacked identifiers, an unmatched new-looking job
  // might actually have existed before the POST. Require a POST job ID.
  if(!baselineComplete && !returned)return null;
  const matches=jobs.filter(job=>{
    const id=idOf(job);
    return Boolean(id && !prior.has(id) &&
      (!returned || returned===id) &&
      matchesPlannedJob(job,planned,{manualSchedule}));
  });
  return matches.length===1?idOf(matches[0]):null;
}
async function confirmPostedJob({
  getCustomer,customerId,planned,knownJobIds=[],baselineComplete=true,
  writeResult,maxAttempts=MAX_ATTEMPTS,
  manualSchedule=false,
  pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}={}) {
  if(typeof getCustomer!=="function"||!idOf(customerId) ||
     !serviceIds(planned?.services)||
     (manualSchedule ? (planned?.jobGroup!==undefined || planned?.date!==undefined ||
       planned?.firstAppointment?.initialDate!==undefined) : !idOf(planned?.jobGroup)) ||
     !Number.isFinite(Number(planned?.price)))return {verified:false};
  const attempts=Math.max(1,Math.min(MAX_ATTEMPTS,Number(maxAttempts)||1));
  for(let attempt=0;attempt<attempts;attempt++){
    try {
      const customer=await getCustomer(customerId);
      const jobId=identifyNewJob(customer?.jobs,{
        planned,knownJobIds,writeResult,baselineComplete,manualSchedule,
      });
      if(jobId)return {verified:true,jobId};
    }catch{
      // A failed GET must never be interpreted as a successful POST.
    }
    if(attempt+1<attempts)await pause(350*(attempt+1));
  }
  return {verified:false};
}
module.exports={
  idOf,returnedJobId,serviceIds,matchesPlannedJob,identifyNewJob,
  confirmPostedJob,
};
