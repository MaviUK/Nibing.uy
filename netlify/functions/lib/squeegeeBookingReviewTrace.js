"use strict";
// Preview-77 only: durable, PII-free operational trace if the normal booking
// sender never obtained a Squeegee worker receipt. A worker receipt always
// takes precedence, so a timeout cannot overwrite a real in-progress import.
const STATUS_STORE="squeegee-preview1-auto-sync-status";
const VALID_REF=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const CODE=/^[a-z][a-z0-9_]{0,100}$/;
function isReviewTrace(value) {
  return Boolean(value && VALID_REF.test(value.bookingId) &&
    typeof value.stage==="string" &&
    !/[@\r\n]/.test(value.stage) &&
    typeof value.updatedAt==="string");
}
async function recordNoDispatch(bookingId,{
  reason="dispatch_unavailable",ownerAlertDelivery="not_sent",
}={}, {store=null}={}) {
  if(!VALID_REF.test(String(bookingId||"")))return{recorded:false,reason:"invalid_reference"};
  const safeReason=CODE.test(reason)?reason:"dispatch_unavailable";
  const delivery=ownerAlertDelivery==="sent"?"sent":"not_sent";
  try{
    const handle=store||require("@netlify/blobs").getStore({
      name:STATUS_STORE,consistency:"strong",
    });
    const status={
      bookingId,stage:"requires_reconciliation",reason:safeReason,
      ownerAlertDelivery:delivery,updatedAt:new Date().toISOString(),
      // Deliberately no PII, no keys, and no asserted Squeegee success.
    };
    const result=await handle.setJSON(bookingId,status,{onlyIfNew:true});
    return {recorded:result?.modified===true,reason:result?.modified===false?
      "existing_worker_receipt":"record_uncertain"};
  }catch(error){
    console.error("Preview 77 review receipt unavailable:",error?.name||"storage_error");
    return {recorded:false,reason:"storage_unavailable"};
  }
}
module.exports={STATUS_STORE,VALID_REF,isReviewTrace,recordNoDispatch};
