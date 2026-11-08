// One-time production-only owner attestation, 8 November 2026.
// Specifically approved in the NI Bin Guy conversation. Never sends customer
// emails, changes Squeegee, or changes cleaning points.
// Remove this scheduled function immediately after verified completion.
import {getStore} from "@netlify/blobs";
import names from "./lib/squeegeeLeaderboardNameConsent.js";
import hq from "./lib/customerHQ.js";
import guard from "./lib/squeegeeProductionGuard.js";

const SWITCH="N64_OWNER_EMAIL_CONSENT_ONCE_20261108";
const APPROVAL="owner-attested-chat-2026-11-08";
const EVIDENCE="Owner-attested 8 Nov 2026: previously received affirmative customer email replies in Zoho Mail";
const log=value=>console.info("Owner consent one-time 2026-11-08",JSON.stringify(value));
export default async function handler(_request,context){
  const scope={
    hostname:"nibing.uy",
    deployContext:context?.deploy?.context||process.env.CONTEXT,
    siteId:context?.site?.id||process.env.SITE_ID,
  };
  if(!guard.isVerifiedProductionScope(scope)||
     process.env[SWITCH]!==APPROVAL ||
     process.env.N64_PRODUCTION_LEADERBOARD_ENABLED!=="true"||
     process.env.N64_PRODUCTION_CUSTOMER_HQ_ENABLED!=="true"){
    log({result:"not_authorised_or_wrong_context"});
    return;
  }
  try{
    const store=label=>getStore({name:label,consistency:"strong"});
    const db=store(names.STORE_NAME);
    const [current,privateData]=await Promise.all([
      db.getWithMetadata(names.KEY,{type:"json",consistency:"strong"}),
      store(hq.DATA_STORE).get(hq.DATA_KEY,{type:"json",consistency:"strong"}),
    ]);
    if(!current?.data || !current?.etag || !privateData){
      log({result:"blocked_missing_data"});
      return;
    }
    // Idempotence: a completed attestation never reapplies or rewrites grants.
    if(current.data.ownerEmailReplyAttestation?.evidenceRef===EVIDENCE){
      log({result:"already_applied",eligible:current.data.ownerEmailReplyAttestation.eligible,
        newlyGranted:current.data.ownerEmailReplyAttestation.approved,
        withdrawalsPreserved:current.data.ownerEmailReplyAttestation.withdrawn});
      return;
    }
    const eligible=hq.eligibleRankedEmailAccounts(privateData);
    if(!eligible || !eligible.aliases || eligible.count<1){
      log({result:"blocked_eligibility_missing"});
      return;
    }
    const answer=names.approveOwnerReviewedEmailReplies(
      current.data,privateData,eligible.aliases,
      {confirm:"yes",evidenceRef:EVIDENCE});
    const n=answer.counts;
    if(n.qualifying<1 ||
       n.approved+n.alreadyApproved+n.withdrawn+n.needsNameReview!==n.qualifying){
      log({result:"blocked_counts_inconsistent"});
      return;
    }
    // Preservation check BEFORE writing: every pre-existing withdrawal
    // stays withdrawn with its original audit date and no changes to points.
    const old=new Map(current.data.records.map(r=>[r.alias,r]));
    for(const r of answer.snapshot.records){
      const previous=old.get(r.alias);
      if(!previous){log({result:"blocked_unknown_identity"});return;}
      if((previous.consent==="withdrawn"||previous.withdrawnAt) &&
         (r.consent!=="withdrawn"||r.withdrawnAt!==previous.withdrawnAt)){
        log({result:"blocked_withdrawal_changed"});return;
      }
    }
    const saved=await db.setJSON(names.KEY,answer.snapshot,
      {onlyIfMatch:current.etag});
    if(!saved?.modified || !saved?.etag){
      log({result:"write_not_confirmed"});return;
    }
    const readback=await db.getWithMetadata(names.KEY,
      {type:"json",consistency:"strong"});
    const proof=readback?.data?.ownerEmailReplyAttestation;
    if(readback?.etag!==saved.etag || 
       proof?.evidenceRef!==EVIDENCE ||
       proof?.sourceAsOf!==privateData.asOf ||
       proof.approved!==n.approved){
      log({result:"readback_not_verified"});return;
    }
    log({result:"verified_success",eligible:n.eligible,qualifying:n.qualifying,
      newlyGranted:n.approved,alreadyGranted:n.alreadyApproved,
      withdrawalsPreserved:n.withdrawn,needsNameReview:n.needsNameReview,
      sourceAsOf:privateData.asOf});
  }catch(e){
    // Log only the broad error code, never customer information.
    log({result:"failed_closed",reason:[
      "consent_dataset_missing","consent_customer_mismatch",
      "email_eligibility_missing","owner_attestation_required"
    ].includes(e?.message)?e.message:"operation_failed"});
  }
}
export const config={schedule:"*/2 * * * *"};
