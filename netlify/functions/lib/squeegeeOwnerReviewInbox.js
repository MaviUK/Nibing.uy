"use strict";
const {VALID_REF}=require("./squeegeeBookingReviewTrace");
const PREVIEW_HOST="deploy-preview-77--nibinguy.netlify.app";
const STALE_MS=5*60*1000;
const REVIEW=new Set(["held_for_review","requires_reconciliation"]);
const age=(v,n)=>n-Date.parse(String(v||""));
function reasonForReview(status,claim,now=Date.now()) {
  if(["not_sent","failed"].includes(status?.ownerAlertDelivery))
    return "owner_alert_not_delivered";
  if(REVIEW.has(status?.stage))return String(status.reason||"manual_review_required");
  if(status && status.stage!=="created_customer_and_jobs" &&
      age(status.updatedAt||status.acceptedAt,now)>STALE_MS)
    return "sync_status_stalled";
  if(!status && claim?.sourceHost===PREVIEW_HOST &&
      age(claim.claimedAt,now)>STALE_MS)
    return "accepted_booking_without_sync_receipt";
  return null;
}
// Owner-only and read-only. Limits protect Blob lookups on large sites.
// Individual booking search remains available if list is truncated.
async function findOwnerReviewItems({statusStore,claimStore,now=Date.now(),maxScanned=400}={}) {
  const [statusList,claimList]=await Promise.all([
    statusStore.list({prefix:"NBG-"}),claimStore.list({prefix:"NBG-"}),
  ]);
  const keys=new Set();
  for(const list of [statusList?.blobs,claimList?.blobs])
    for(const item of list||[])if(VALID_REF.test(item?.key||""))keys.add(item.key);
  const limited=[...keys].slice(0,maxScanned),items=[];
  let cursor=0;
  async function worker(){
    while(cursor<limited.length){
      const bookingId=limited[cursor++];
      let status,claim;
      try{
        [status,claim]=await Promise.all([
          statusStore.get(bookingId,{type:"json",consistency:"strong"}),
          claimStore.get(bookingId,{type:"json",consistency:"strong"}),
        ]);
      }catch{
        items.push({bookingId,stage:"status_unavailable",
          reason:"owner_review_storage_unavailable",
          ownerAlertDelivery:"unknown",updatedAt:null});continue;
      }
      if(!status && claim?.sourceHost!==PREVIEW_HOST)continue;
      const reason=reasonForReview(status,claim,now);
      if(!reason)continue;
      items.push({bookingId,stage:String(status?.stage||"unconfirmed").slice(0,55),
        reason:String(reason).slice(0,100),
        ownerAlertDelivery:String(status?.ownerAlertDelivery||"unknown").slice(0,30),
        updatedAt:status?.updatedAt||claim?.claimedAt||null});
    }
  }
  await Promise.all(Array.from({length:Math.min(limited.length,10)},worker));
  items.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  return {items:items.slice(0,70),scanned:limited.length,
    truncated:keys.size>maxScanned||items.length>70};
}
module.exports={PREVIEW_HOST,STALE_MS,reasonForReview,findOwnerReviewItems};
